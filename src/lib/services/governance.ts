/**
 * Governance service (migration 047) — Fase 7, diferencial D3.
 * Detecta e persiste exceções operacionais (sobre-alocação, quebra de
 * segregação de funções, horas em projeto encerrado, custo sem centro de
 * custo, correções de ponto recorrentes, folha sem alocação) com workflow
 * de análise/resolução. Não acusa fraude (ADR-008): classifica para
 * análise. O scan é idempotente por fingerprint (upsert).
 */
import { createClient } from '@/utils/supabase/client';
import { logAuditEvent } from '@/lib/audit/log-audit-event';
import type {
  GovernanceException,
  GovernanceExceptionType,
  GovernanceSeverity,
  GovernanceStatus,
} from '@/lib/types/people';
import {
  getCurrentOrgAndUser,
  mapPersonRow,
  rlsFriendlyMessage,
  type PersonRow,
} from './people';
import { monthBounds } from './capacity';
import { LIVE_ALLOCATION_STATUSES } from './allocations';
import { getProjectsAsync } from './projects';

export const EXCEPTIONS_TABLE = 'governance_exceptions';

/* ─────────────────────────── mapping ─────────────────────────── */

type ExceptionRow = {
  id: string;
  organization_id: string;
  type: GovernanceExceptionType;
  severity: GovernanceSeverity;
  status: GovernanceStatus;
  person_id: string | null;
  project_id: string | null;
  allocation_id: string | null;
  title: string;
  evidence: Record<string, unknown> | null;
  fingerprint: string;
  detected_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_notes: string | null;
  created_at: string;
  updated_at: string;
  people?: PersonRow | null;
};

function mapException(row: ExceptionRow): GovernanceException {
  return {
    id: row.id,
    organizationId: row.organization_id,
    type: row.type,
    severity: row.severity,
    status: row.status,
    personId: row.person_id,
    projectId: row.project_id,
    allocationId: row.allocation_id,
    title: row.title,
    evidence: row.evidence ?? {},
    fingerprint: row.fingerprint,
    detectedAt: row.detected_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    resolutionNotes: row.resolution_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    person: row.people ? mapPersonRow(row.people) : undefined,
  };
}

/* ─────────────────────────── queries ─────────────────────────── */

export interface ExceptionFilters {
  status?: GovernanceStatus | 'all';
  type?: GovernanceExceptionType | 'all';
}

export async function listExceptions(
  filters: ExceptionFilters = {},
): Promise<GovernanceException[]> {
  const supabase = createClient();
  let query = supabase
    .from(EXCEPTIONS_TABLE)
    .select('*, people(*)')
    .order('detected_at', { ascending: false });
  if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
  if (filters.type && filters.type !== 'all') query = query.eq('type', filters.type);

  const { data, error } = await query;
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar exceções', error));
  return (data ?? []).map((r) => mapException(r as unknown as ExceptionRow));
}

/* ─────────────────────────── detection ───────────────────────── */

type DetectedException = {
  type: GovernanceExceptionType;
  severity: GovernanceSeverity;
  title: string;
  fingerprint: string;
  person_id?: string | null;
  project_id?: string | null;
  allocation_id?: string | null;
  evidence: Record<string, unknown>;
};

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Scans live data and upserts exceptions (idempotent by fingerprint).
 * Existing rows keep their status (a resolved item is not re-opened);
 * only evidence/severity/detected_at are refreshed. Returns the scan
 * summary.
 */
export async function scanExceptions(): Promise<{ detected: number; byType: Record<string, number> }> {
  const supabase = createClient();
  const { userId, orgId } = await getCurrentOrgAndUser(supabase);
  const month = currentMonth();
  const [monthStart, monthEnd] = monthBounds(month);

  const detected: DetectedException[] = [];

  // ── fetch source data in parallel ──
  const [
    { data: allocations },
    { data: entries },
    { data: corrections },
    { data: people },
    projects,
  ] = await Promise.all([
    supabase
      .from('project_allocations')
      .select('id, person_id, project_id, planned_percentage, status, cost_center_id, allocation_type, requested_by, approved_by, start_date, end_date')
      .in('status', LIVE_ALLOCATION_STATUSES),
    supabase
      .from('time_entries')
      .select('id, person_id, project_id, created_by, approved_by, status, work_date')
      .gte('work_date', monthStart)
      .lte('work_date', monthEnd),
    supabase
      .from('attendance_punches')
      .select('person_id, status, source, occurred_at')
      .gte('occurred_at', `${monthStart}T00:00:00`)
      .lte('occurred_at', `${monthEnd}T23:59:59`),
    supabase.from('people').select('id, full_name, payroll_name_key, source, status'),
    getProjectsAsync().catch(() => []),
  ]);

  const projectStatusById = new Map(
    projects.map((p) => [p.id, (p.status ?? '').toString()]),
  );
  const closedStatuses = new Set(['concluido', 'cancelado', 'encerrado']);
  const peopleById = new Map((people ?? []).map((p) => [p.id as string, p]));

  // ── 1. over_allocation: Σ% live > 100 per person in the month ──
  const pctByPerson = new Map<string, number>();
  for (const a of allocations ?? []) {
    const start = a.start_date as string;
    const end = (a.end_date as string) ?? '9999-12-31';
    if (start > monthEnd || end < monthStart) continue;
    const pid = a.person_id as string;
    pctByPerson.set(pid, (pctByPerson.get(pid) ?? 0) + Number(a.planned_percentage));
  }
  for (const [pid, pct] of pctByPerson) {
    if (pct > 100) {
      detected.push({
        type: 'over_allocation',
        severity: pct > 130 ? 'critical' : 'high',
        title: `${peopleById.get(pid)?.full_name ?? 'Colaborador'} com ${pct.toFixed(0)}% de comprometimento`,
        fingerprint: `over_allocation:${pid}:${month}`,
        person_id: pid,
        evidence: { total_percentage: pct, month },
      });
    }
  }

  // ── 2. self_approval (SoD) ──
  for (const a of allocations ?? []) {
    if (a.approved_by && a.requested_by && a.approved_by === a.requested_by) {
      detected.push({
        type: 'self_approval',
        severity: 'high',
        title: `Alocação solicitada e aprovada pela mesma pessoa`,
        fingerprint: `self_approval:allocation:${a.id}`,
        person_id: a.person_id as string,
        project_id: a.project_id as string,
        allocation_id: a.id as string,
        evidence: { user_id: a.approved_by },
      });
    }
  }
  for (const e of entries ?? []) {
    if (
      e.approved_by &&
      e.created_by &&
      e.approved_by === e.created_by &&
      (e.status === 'approved' || e.status === 'locked')
    ) {
      detected.push({
        type: 'self_approval',
        severity: 'high',
        title: `Apontamento criado e aprovado pela mesma pessoa`,
        fingerprint: `self_approval:time_entry:${e.id}`,
        person_id: e.person_id as string,
        project_id: e.project_id as string,
        evidence: { user_id: e.approved_by, work_date: e.work_date },
      });
    }
  }

  // ── 3. cost_without_cost_center: billable live allocation, no CC ──
  for (const a of allocations ?? []) {
    if (a.allocation_type === 'billable' && !a.cost_center_id) {
      detected.push({
        type: 'cost_without_cost_center',
        severity: 'low',
        title: `Alocação faturável sem centro de custo`,
        fingerprint: `cost_without_cost_center:allocation:${a.id}`,
        person_id: a.person_id as string,
        project_id: a.project_id as string,
        allocation_id: a.id as string,
        evidence: {},
      });
    }
  }

  // ── 4. closed_project_time: time entries on a closed project ──
  const closedSeen = new Set<string>();
  for (const e of entries ?? []) {
    const st = projectStatusById.get(e.project_id as string);
    if (st && closedStatuses.has(st)) {
      const key = `${e.project_id}:${e.person_id}`;
      if (closedSeen.has(key)) continue;
      closedSeen.add(key);
      detected.push({
        type: 'closed_project_time',
        severity: 'high',
        title: `Horas apontadas em projeto ${st}`,
        fingerprint: `closed_project_time:${e.project_id}:${e.person_id}:${month}`,
        person_id: e.person_id as string,
        project_id: e.project_id as string,
        evidence: { project_status: st, month },
      });
    }
  }

  // ── 5. recurring_correction: ≥3 corrections in the month ──
  const corrByPerson = new Map<string, number>();
  for (const c of corrections ?? []) {
    if (c.status === 'corrected' || c.source === 'manager_adjustment') {
      const pid = c.person_id as string;
      corrByPerson.set(pid, (corrByPerson.get(pid) ?? 0) + 1);
    }
  }
  for (const [pid, count] of corrByPerson) {
    if (count >= 3) {
      detected.push({
        type: 'recurring_correction',
        severity: 'medium',
        title: `${count} correções de ponto no mês`,
        fingerprint: `recurring_correction:${pid}:${month}`,
        person_id: pid,
        evidence: { corrections: count, month },
      });
    }
  }

  // ── 6. payroll_without_allocation: on payroll, no live allocation ──
  const allocatedPeople = new Set((allocations ?? []).map((a) => a.person_id as string));
  for (const p of people ?? []) {
    if (
      (p.source === 'payroll_import' || p.payroll_name_key) &&
      p.status === 'active' &&
      !allocatedPeople.has(p.id as string)
    ) {
      detected.push({
        type: 'payroll_without_allocation',
        severity: 'medium',
        title: `${p.full_name ?? 'Colaborador'} na folha sem alocação ativa`,
        fingerprint: `payroll_without_allocation:${p.id}:${month}`,
        person_id: p.id as string,
        evidence: { month },
      });
    }
  }

  // ── upsert (idempotent; status preserved on conflict) ──
  if (detected.length > 0) {
    const payload = detected.map((d) => ({
      organization_id: orgId,
      type: d.type,
      severity: d.severity,
      title: d.title,
      fingerprint: d.fingerprint,
      person_id: d.person_id ?? null,
      project_id: d.project_id ?? null,
      allocation_id: d.allocation_id ?? null,
      evidence: d.evidence,
      detected_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from(EXCEPTIONS_TABLE)
      .upsert(payload, { onConflict: 'organization_id,fingerprint', ignoreDuplicates: false });
    if (error) throw new Error(rlsFriendlyMessage('Erro ao gravar exceções', error));
  }

  const byType: Record<string, number> = {};
  for (const d of detected) byType[d.type] = (byType[d.type] ?? 0) + 1;

  void logAuditEvent({
    organizationId: orgId,
    action: 'governance.scan',
    entityType: 'governance_exception',
    metadata: { detected: detected.length, by_type: byType, month, by: userId },
  });

  return { detected: detected.length, byType };
}

/* ─────────────────────────── workflow ────────────────────────── */

async function transition(
  id: string,
  patch: Record<string, unknown>,
  action: string,
): Promise<GovernanceException> {
  const supabase = createClient();
  const { orgId } = await getCurrentOrgAndUser(supabase);
  const { data, error } = await supabase
    .from(EXCEPTIONS_TABLE)
    .update(patch)
    .eq('id', id)
    .select('*, people(*)')
    .single();
  if (error) throw new Error(rlsFriendlyMessage('Erro ao atualizar exceção', error));

  void logAuditEvent({
    organizationId: orgId,
    action,
    entityType: 'governance_exception',
    entityId: id,
    metadata: { status: (data as ExceptionRow).status },
  });
  return mapException(data as unknown as ExceptionRow);
}

export function startReview(id: string): Promise<GovernanceException> {
  return transition(id, { status: 'under_review' }, 'governance.review_started');
}

export async function resolveException(
  id: string,
  notes: string,
): Promise<GovernanceException> {
  const supabase = createClient();
  const { userId } = await getCurrentOrgAndUser(supabase);
  return transition(
    id,
    {
      status: 'resolved',
      resolved_by: userId,
      resolved_at: new Date().toISOString(),
      resolution_notes: notes,
    },
    'governance.resolved',
  );
}

export async function dismissException(
  id: string,
  notes: string,
): Promise<GovernanceException> {
  const supabase = createClient();
  const { userId } = await getCurrentOrgAndUser(supabase);
  return transition(
    id,
    {
      status: 'dismissed',
      resolved_by: userId,
      resolved_at: new Date().toISOString(),
      resolution_notes: notes,
    },
    'governance.dismissed',
  );
}
