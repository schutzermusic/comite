/**
 * Labor cost service (migration 043) — Fase 6.
 * Loaded monthly cost + loaded hourly cost per person/competence
 * (frozen snapshot, ADR-006), consolidated project labor cost, and
 * project margin (differential D1). Cost is sensitive: values are
 * surfaced only to people.cost_view; the SERVICE computes, the UI masks.
 *
 * Custo carregado (spec §8.1) = salário + encargos + benefícios +
 * provisões + outros. Encargos/benefícios são rateados do batch de folha
 * da competência (dados reais); provisões são estimadas por fator (13º +
 * férias+1/3) enquanto não houver componente próprio na folha.
 */
import { createClient } from '@/utils/supabase/client';
import { logAuditEvent } from '@/lib/audit/log-audit-event';
import type {
  EmployeeCostSnapshot,
  ProjectLaborCostPeriod,
  ProjectMargin,
} from '@/lib/types/people';
import { getCurrentOrgAndUser, rlsFriendlyMessage, mapPersonRow, type PersonRow } from './people';
import { countBusinessDays, monthBounds } from './capacity';
import { LIVE_ALLOCATION_STATUSES } from './allocations';

export const SNAPSHOTS_TABLE = 'employee_cost_snapshots';
export const LABOR_COST_TABLE = 'project_labor_cost_periods';

/** Provision rate over salary: 13th (8.33%) + vacation+1/3 (11.11%). */
export const PROVISION_RATE = 0.1944;

/** Payroll batch statuses considered "closed/real" for reconciliation. */
const CLOSED_BATCH_STATUSES = ['approved', 'sent_to_finance', 'posted'];

/* ─────────────────────────── mapping ─────────────────────────── */

type SnapshotRow = {
  id: string;
  organization_id: string;
  person_id: string;
  competence_month: string;
  salary_cents: number | string;
  payroll_taxes_cents: number | string;
  benefits_cents: number | string;
  provisions_cents: number | string;
  other_costs_cents: number | string;
  loaded_monthly_cost_cents: number | string;
  productive_capacity_hours: number | string;
  loaded_hourly_cost_cents: number | string;
  source: EmployeeCostSnapshot['source'];
  source_payroll_batch_id: string | null;
  status: EmployeeCostSnapshot['status'];
  version: number;
  supersedes_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  people?: PersonRow | null;
};

const n = (v: number | string | null | undefined): number => Number(v ?? 0);

function mapSnapshot(row: SnapshotRow): EmployeeCostSnapshot {
  return {
    id: row.id,
    organizationId: row.organization_id,
    personId: row.person_id,
    competenceMonth: row.competence_month,
    salaryCents: n(row.salary_cents),
    payrollTaxesCents: n(row.payroll_taxes_cents),
    benefitsCents: n(row.benefits_cents),
    provisionsCents: n(row.provisions_cents),
    otherCostsCents: n(row.other_costs_cents),
    loadedMonthlyCostCents: n(row.loaded_monthly_cost_cents),
    productiveCapacityHours: n(row.productive_capacity_hours),
    loadedHourlyCostCents: n(row.loaded_hourly_cost_cents),
    source: row.source,
    sourcePayrollBatchId: row.source_payroll_batch_id,
    status: row.status,
    version: row.version,
    supersedesId: row.supersedes_id,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    person: row.people ? mapPersonRow(row.people) : undefined,
  };
}

type LaborRow = {
  id: string;
  organization_id: string;
  project_id: string;
  person_id: string | null;
  competence_month: string;
  planned_hours: number | string;
  approved_hours: number | string;
  planned_cost_cents: number | string;
  estimated_actual_cost_cents: number | string;
  reconciled_actual_cost_cents: number | string;
  variance_amount_cents: number | string;
  variance_percentage: number | string | null;
  status: ProjectLaborCostPeriod['status'];
  employee_cost_snapshot_id: string | null;
  computed_at: string | null;
  created_at: string;
  updated_at: string;
  people?: PersonRow | null;
};

function mapLabor(row: LaborRow): ProjectLaborCostPeriod {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    personId: row.person_id,
    competenceMonth: row.competence_month,
    plannedHours: n(row.planned_hours),
    approvedHours: n(row.approved_hours),
    plannedCostCents: n(row.planned_cost_cents),
    estimatedActualCostCents: n(row.estimated_actual_cost_cents),
    reconciledActualCostCents: n(row.reconciled_actual_cost_cents),
    varianceAmountCents: n(row.variance_amount_cents),
    variancePercentage: row.variance_percentage == null ? null : Number(row.variance_percentage),
    status: row.status,
    employeeCostSnapshotId: row.employee_cost_snapshot_id,
    computedAt: row.computed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    person: row.people ? mapPersonRow(row.people) : undefined,
  };
}

/* ─────────────────────────── queries ─────────────────────────── */

export async function listSnapshots(month: string): Promise<EmployeeCostSnapshot[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(SNAPSHOTS_TABLE)
    .select('*, people(*)')
    .eq('competence_month', month)
    .neq('status', 'superseded')
    .order('created_at', { ascending: false });
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar custos', error));
  return (data ?? []).map((r) => mapSnapshot(r as unknown as SnapshotRow));
}

export async function listProjectLaborCost(
  projectId: string,
  month?: string,
): Promise<ProjectLaborCostPeriod[]> {
  const supabase = createClient();
  let query = supabase
    .from(LABOR_COST_TABLE)
    .select('*, people(*)')
    .eq('project_id', projectId)
    .order('competence_month', { ascending: false });
  if (month) query = query.eq('competence_month', month);
  const { data, error } = await query;
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar custo do projeto', error));
  return (data ?? []).map((r) => mapLabor(r as unknown as LaborRow));
}

/* ─────────────────── snapshot computation ────────────────────── */

/**
 * Builds/refreshes employee cost snapshots for a competence from the
 * payroll batch of that month. Existing active snapshots are versioned
 * (marked 'superseded', new version inserted) so history is preserved.
 * Returns the snapshots produced.
 */
export async function computeCostSnapshots(month: string): Promise<EmployeeCostSnapshot[]> {
  const supabase = createClient();
  const { userId, orgId } = await getCurrentOrgAndUser(supabase);
  const [monthStart, monthEnd] = monthBounds(month);
  const businessDays = countBusinessDays(monthStart, monthEnd);

  // payroll batch of the competence (most recent non-cancelled)
  const { data: batches, error: batchError } = await supabase
    .from('payroll_closing_batches')
    .select('id, status, gross_amount_cents, charges_amount_cents, benefits_amount_cents')
    .eq('competence_month', month)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(1);
  if (batchError) throw new Error(rlsFriendlyMessage('Erro ao carregar folha', batchError));
  const batch = batches?.[0];

  if (!batch) {
    throw new Error(
      `Não há fechamento de folha para a competência ${month}. Importe a folha antes de calcular o custo.`,
    );
  }

  const batchGross = n(batch.gross_amount_cents);
  const chargeRatio = batchGross > 0 ? n(batch.charges_amount_cents) / batchGross : 0;
  const benefitRatio = batchGross > 0 ? n(batch.benefits_amount_cents) / batchGross : 0;
  const isClosed = CLOSED_BATCH_STATUSES.includes(batch.status);

  // employee lines with a resolved person
  const { data: lines, error: linesError } = await supabase
    .from('payroll_employee_lines')
    .select('person_id, gross_amount_cents')
    .eq('batch_id', batch.id)
    .not('person_id', 'is', null);
  if (linesError) throw new Error(rlsFriendlyMessage('Erro ao carregar linhas da folha', linesError));

  if (!lines || lines.length === 0) {
    throw new Error(
      'A folha desta competência não possui linhas vinculadas a pessoas. Vincule os colaboradores em Pessoas & Custos → Pessoas.',
    );
  }

  // people (for weekly_hours capacity) + leaves in the month
  const personIds = Array.from(new Set(lines.map((l) => l.person_id as string)));
  const [{ data: peopleRows }, { data: leaveRows }] = await Promise.all([
    supabase.from('people').select('*').in('id', personIds),
    supabase
      .from('leave_periods')
      .select('person_id, start_date, end_date, hours_per_day, status')
      .in('person_id', personIds)
      .lte('start_date', monthEnd)
      .gte('end_date', monthStart),
  ]);
  const peopleById = new Map((peopleRows ?? []).map((p) => [p.id as string, p as PersonRow]));

  function leaveHoursFor(personId: string, dailyHours: number): number {
    let hours = 0;
    for (const l of leaveRows ?? []) {
      if (l.person_id !== personId) continue;
      if (!['planned', 'approved', 'active'].includes(l.status as string)) continue;
      const start = (l.start_date as string) > monthStart ? (l.start_date as string) : monthStart;
      const end = (l.end_date as string) < monthEnd ? (l.end_date as string) : monthEnd;
      if (start > end) continue;
      hours += countBusinessDays(start, end) * (l.hours_per_day == null ? dailyHours : Number(l.hours_per_day));
    }
    return hours;
  }

  // aggregate salary per person (a person may have multiple lines)
  const salaryByPerson = new Map<string, number>();
  for (const l of lines) {
    const pid = l.person_id as string;
    salaryByPerson.set(pid, (salaryByPerson.get(pid) ?? 0) + n(l.gross_amount_cents));
  }

  const results: EmployeeCostSnapshot[] = [];
  for (const [personId, salary] of salaryByPerson) {
    const person = peopleById.get(personId);
    const weeklyHours = person ? Number(person.weekly_hours ?? 40) : 40;
    const dailyHours = weeklyHours / 5;
    const contractualHours = businessDays * dailyHours;
    const capacityHours = Math.max(contractualHours - leaveHoursFor(personId, dailyHours), 1);

    const taxes = Math.round(salary * chargeRatio);
    const benefits = Math.round(salary * benefitRatio);
    const provisions = Math.round(salary * PROVISION_RATE);
    const loaded = salary + taxes + benefits + provisions;
    const hourly = Math.round(loaded / capacityHours);

    // supersede current active snapshot of this person/competence
    const { data: current } = await supabase
      .from(SNAPSHOTS_TABLE)
      .select('id, version')
      .eq('person_id', personId)
      .eq('competence_month', month)
      .neq('status', 'superseded')
      .maybeSingle();

    if (current) {
      await supabase.from(SNAPSHOTS_TABLE).update({ status: 'superseded' }).eq('id', current.id);
    }

    const { data: inserted, error: insertError } = await supabase
      .from(SNAPSHOTS_TABLE)
      .insert({
        organization_id: orgId,
        person_id: personId,
        competence_month: month,
        salary_cents: salary,
        payroll_taxes_cents: taxes,
        benefits_cents: benefits,
        provisions_cents: provisions,
        other_costs_cents: 0,
        loaded_monthly_cost_cents: loaded,
        productive_capacity_hours: capacityHours,
        loaded_hourly_cost_cents: hourly,
        source: 'payroll',
        source_payroll_batch_id: batch.id,
        status: isClosed ? 'processed' : 'estimated',
        version: current ? (current.version as number) + 1 : 1,
        supersedes_id: current?.id ?? null,
        created_by: userId,
      })
      .select('*, people(*)')
      .single();
    if (insertError) throw new Error(rlsFriendlyMessage('Erro ao gravar custo', insertError));
    results.push(mapSnapshot(inserted as unknown as SnapshotRow));
  }

  void logAuditEvent({
    organizationId: orgId,
    action: 'cost_snapshot.computed',
    entityType: 'employee_cost_snapshot',
    metadata: { competence: month, people: results.length, batch_status: batch.status },
  });
  return results;
}

/* ─────────────── project labor cost consolidation ─────────────── */

/**
 * Consolidates labor cost of a project in a competence from approved
 * time_entries × cost snapshots, and persists project_labor_cost_periods.
 * Also stamps time_entries.hourly_cost_cents/cost_cents (audit trail of
 * the frozen cost). Requires people.cost_manage (enforced by RLS).
 */
export async function computeProjectLaborCost(
  projectId: string,
  month: string,
): Promise<ProjectLaborCostPeriod[]> {
  const supabase = createClient();
  const { userId, orgId } = await getCurrentOrgAndUser(supabase);
  const [monthStart, monthEnd] = monthBounds(month);

  const [{ data: entries, error: entriesError }, snapshots, { data: allocations }] =
    await Promise.all([
      supabase
        .from('time_entries')
        .select('id, person_id, minutes, status')
        .eq('project_id', projectId)
        .gte('work_date', monthStart)
        .lte('work_date', monthEnd)
        .in('status', ['approved', 'locked']),
      listSnapshots(month),
      supabase
        .from('project_allocations')
        .select('person_id, planned_percentage, status, start_date, end_date')
        .eq('project_id', projectId)
        .in('status', LIVE_ALLOCATION_STATUSES),
    ]);
  if (entriesError) throw new Error(rlsFriendlyMessage('Erro ao carregar apontamentos', entriesError));

  const snapshotByPerson = new Map(snapshots.map((s) => [s.personId, s]));
  const businessDays = countBusinessDays(monthStart, monthEnd);

  // approved minutes per person
  const minutesByPerson = new Map<string, number>();
  for (const e of entries ?? []) {
    const pid = e.person_id as string;
    minutesByPerson.set(pid, (minutesByPerson.get(pid) ?? 0) + (e.minutes as number));
  }

  // planned % per person overlapping the month
  const plannedPctByPerson = new Map<string, number>();
  for (const a of allocations ?? []) {
    const start = a.start_date as string;
    const end = (a.end_date as string) ?? '9999-12-31';
    if (start > monthEnd || end < monthStart) continue;
    const pid = a.person_id as string;
    plannedPctByPerson.set(pid, (plannedPctByPerson.get(pid) ?? 0) + Number(a.planned_percentage));
  }

  const affectedPeople = new Set<string>([
    ...minutesByPerson.keys(),
    ...plannedPctByPerson.keys(),
  ]);

  const results: ProjectLaborCostPeriod[] = [];
  for (const personId of affectedPeople) {
    const snapshot = snapshotByPerson.get(personId);
    const approvedHours = (minutesByPerson.get(personId) ?? 0) / 60;
    const plannedPct = plannedPctByPerson.get(personId) ?? 0;

    const hourlyCents = snapshot?.loadedHourlyCostCents ?? 0;
    const loadedMonthly = snapshot?.loadedMonthlyCostCents ?? 0;
    const capacityHours = snapshot?.productiveCapacityHours ?? businessDays * 8;

    const plannedHours = capacityHours * (plannedPct / 100);
    const plannedCost = Math.round(loadedMonthly * (plannedPct / 100));
    const estimatedActual = Math.round(approvedHours * hourlyCents);
    const reconciledActual = snapshot?.status === 'processed' || snapshot?.status === 'reconciled'
      ? estimatedActual
      : 0;
    const variance = (reconciledActual || estimatedActual) - plannedCost;
    const variancePct = plannedCost > 0 ? (variance / plannedCost) * 100 : null;

    const status: ProjectLaborCostPeriod['status'] =
      snapshot?.status === 'reconciled'
        ? 'reconciled'
        : snapshot?.status === 'processed'
          ? 'payroll_processed'
          : snapshot
            ? 'estimated'
            : 'open';

    // stamp cost onto approved time_entries of this person (frozen)
    if (hourlyCents > 0) {
      const ids = (entries ?? [])
        .filter((e) => e.person_id === personId)
        .map((e) => e.id as string);
      if (ids.length > 0) {
        await supabase
          .from('time_entries')
          .update({ hourly_cost_cents: hourlyCents })
          .in('id', ids)
          .is('hourly_cost_cents', null);
      }
    }

    const { data: upserted, error: upsertError } = await supabase
      .from(LABOR_COST_TABLE)
      .upsert(
        {
          organization_id: orgId,
          project_id: projectId,
          person_id: personId,
          competence_month: month,
          planned_hours: plannedHours,
          approved_hours: approvedHours,
          planned_cost_cents: plannedCost,
          estimated_actual_cost_cents: estimatedActual,
          reconciled_actual_cost_cents: reconciledActual,
          variance_amount_cents: variance,
          variance_percentage: variancePct,
          status,
          employee_cost_snapshot_id: snapshot?.id ?? null,
          computed_at: new Date().toISOString(),
          created_by: userId,
        },
        { onConflict: 'organization_id,project_id,person_id,competence_month' },
      )
      .select('*, people(*)')
      .single();
    if (upsertError) throw new Error(rlsFriendlyMessage('Erro ao consolidar custo do projeto', upsertError));
    results.push(mapLabor(upserted as unknown as LaborRow));
  }

  void logAuditEvent({
    organizationId: orgId,
    action: 'project_labor_cost.computed',
    entityType: 'project',
    entityId: projectId,
    metadata: { competence: month, people: results.length },
  });
  return results;
}

/* ─────────────────────────── margin ─────────────────────────── */

/** Roll-up: revenue − labor − other. revenueCents/otherCostCents optional. */
export function computeProjectMargin(
  projectId: string,
  month: string,
  laborRows: ProjectLaborCostPeriod[],
  revenueCents: number | null,
  otherCostCents = 0,
): ProjectMargin {
  const labor = laborRows
    .filter((r) => r.competenceMonth === month)
    .reduce((s, r) => s + (r.reconciledActualCostCents || r.estimatedActualCostCents), 0);
  const margin = revenueCents == null ? null : revenueCents - labor - otherCostCents;
  return {
    projectId,
    month,
    revenueCents,
    laborCostCents: labor,
    otherCostCents,
    marginCents: margin,
    marginPercentage:
      revenueCents && revenueCents > 0 && margin != null ? (margin / revenueCents) * 100 : null,
  };
}

/* ─────────────────────────── format ─────────────────────────── */

export function formatCents(cents: number | null | undefined, compact = false): string {
  if (cents == null) return '—';
  const value = cents / 100;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 2,
  }).format(value);
}
