/**
 * Diárias de Campo — serviço de dados (migrations 056–061).
 * Live-first via Supabase RLS (mesmo padrão de people/allocations).
 *
 * Responsabilidades:
 *   - CRUD leve de políticas e leitura de semanas/diárias;
 *   - generateWeeklyAllowancePreview: motor de geração da prévia
 *     semanal (Fase 1 = modo simulação). Reúne pessoas, alocações,
 *     afastamentos, políticas, geofences e escala explícita, chama o
 *     motor PURO (allowance-eligibility.ts) por pessoa/dia e persiste
 *     uma diária por pessoa/data. Idempotente por recomputo: regenerar
 *     apaga as diárias não aprovadas da semana e recria.
 *
 * A regra de negócio vive em allowance-eligibility.ts (sem I/O); aqui
 * só há coleta de dados e persistência.
 */
import { createClient } from '@/utils/supabase/client';
import { logAuditEvent } from '@/lib/audit/log-audit-event';
import type {
  AllocationStatus,
  PersonProjectAllocation,
} from '@/lib/types/people';
import type {
  AllowancePolicy,
  AllowancePolicyStatus,
  AllowanceWeek,
  DailyAllowance,
  EligibilityReason,
} from '@/lib/types/allowances';
import type {
  AdjustmentStatus,
  AdjustmentType,
  AllowanceAdjustment,
  AllowancePaymentBatch,
  PaymentBatchStatus,
  PaymentExportFormat,
} from '@/lib/types/allowances';
import {
  evaluateDailyEligibility,
  statusFromReason,
  type EligibilityInput,
} from './allowance-eligibility';
import {
  canPerform,
  EDITABLE_WEEK_STATUSES,
  nextStatus,
  WEEK_ACTIONS,
  type WeekAction,
} from './allowance-workflow';
import { reconcileDaily, type ReconciliationInput } from './allowance-reconciliation';
import {
  computeAlerts,
  costByProject as computeCostByProject,
  type AllowanceAlert,
  type IntelligenceDaily,
} from './allowance-intelligence';
import { getCurrentOrgAndUser, rlsFriendlyMessage, mapPersonRow, type PersonRow } from './people';
import { getProjectsAsync } from './projects';

export const ALLOWANCE_POLICIES_TABLE = 'allowance_policies';
export const ALLOWANCE_WEEKS_TABLE = 'allowance_weeks';
export const DAILY_ALLOWANCES_TABLE = 'daily_allowances';
export const WORK_SCHEDULE_DAYS_TABLE = 'work_schedule_days';

export const RULE_VERSION = 'v1';

/** Alocações consideradas "vivas" para elegibilidade. */
const LIVE_ALLOCATION_STATUSES: AllocationStatus[] = ['pending_approval', 'active'];
/** Alocações consultadas para detectar desmobilização (inclui encerradas). */
const CONSIDERED_ALLOCATION_STATUSES: AllocationStatus[] = ['pending_approval', 'active', 'ended'];
/** Quantos dias antes da semana ainda contam como "desmobilizado recente". */
const DEMOB_LOOKBACK_DAYS = 45;

/* ─────────────────────────────────────────────────────────────
   Date helpers (YYYY-MM-DD, sem fuso — datas civis)
   ───────────────────────────────────────────────────────────── */

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00`);
}
function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(value: string, delta: number): string {
  const d = parseDate(value);
  d.setDate(d.getDate() + delta);
  return toISO(d);
}
function isWeekday(value: string): boolean {
  const dow = parseDate(value).getDay();
  return dow !== 0 && dow !== 6;
}
function eachDateInclusive(start: string, end: string): string[] {
  const out: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

/** Segunda-feira da próxima semana e seu domingo (semana Seg..Dom). */
export function nextWeekBounds(from: Date = new Date()): { weekStart: string; weekEnd: string } {
  const today = parseDate(toISO(from));
  const dow = today.getDay(); // 0=Dom..6=Sáb
  const daysUntilNextMonday = ((8 - dow) % 7) || 7;
  const weekStart = addDays(toISO(today), daysUntilNextMonday);
  return { weekStart, weekEnd: addDays(weekStart, 6) };
}

export function weekLabel(weekStart: string, weekEnd: string): string {
  const fmt = (v: string) => parseDate(v).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return `${fmt(weekStart)} a ${fmt(weekEnd)}`;
}

/* ─────────────────────────────────────────────────────────────
   Row mappings
   ───────────────────────────────────────────────────────────── */

type PolicyRow = {
  id: string;
  organization_id: string;
  name: string;
  allowance_type: 'meal';
  project_id: string | null;
  geofence_id: string | null;
  amount_cents: number | string;
  currency: 'BRL';
  effective_from: string;
  effective_until: string | null;
  active_employment_required: boolean;
  active_allocation_required: boolean;
  block_on_leave: boolean;
  block_on_demobilization: boolean;
  schedule_mode: AllowancePolicy['scheduleMode'];
  attendance_required_for_reconciliation: boolean;
  geofence_required_for_reconciliation: boolean;
  geofence_tolerance_meters: number | string | null;
  auto_approval_enabled: boolean;
  status: AllowancePolicyStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function mapPolicyRow(row: PolicyRow): AllowancePolicy {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    allowanceType: row.allowance_type,
    projectId: row.project_id,
    geofenceId: row.geofence_id,
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    activeEmploymentRequired: row.active_employment_required,
    activeAllocationRequired: row.active_allocation_required,
    blockOnLeave: row.block_on_leave,
    blockOnDemobilization: row.block_on_demobilization,
    scheduleMode: row.schedule_mode,
    attendanceRequiredForReconciliation: row.attendance_required_for_reconciliation,
    geofenceRequiredForReconciliation: row.geofence_required_for_reconciliation,
    geofenceToleranceMeters:
      row.geofence_tolerance_meters == null ? null : Number(row.geofence_tolerance_meters),
    autoApprovalEnabled: row.auto_approval_enabled,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type WeekRow = {
  id: string;
  organization_id: string;
  week_start: string;
  week_end: string;
  status: AllowanceWeek['status'];
  total_people: number;
  total_items: number;
  total_amount_cents: number | string;
  generated_by: string | null;
  generated_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  manager_reviewed_by: string | null;
  manager_reviewed_at: string | null;
  hr_validated_by: string | null;
  hr_validated_at: string | null;
  simulation_mode: boolean;
  version: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function mapWeekRow(row: WeekRow): AllowanceWeek {
  return {
    id: row.id,
    organizationId: row.organization_id,
    weekStart: row.week_start,
    weekEnd: row.week_end,
    status: row.status,
    totalPeople: row.total_people,
    totalItems: row.total_items,
    totalAmountCents: Number(row.total_amount_cents),
    generatedBy: row.generated_by,
    generatedAt: row.generated_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    managerReviewedBy: row.manager_reviewed_by ?? null,
    managerReviewedAt: row.manager_reviewed_at ?? null,
    hrValidatedBy: row.hr_validated_by ?? null,
    hrValidatedAt: row.hr_validated_at ?? null,
    simulationMode: row.simulation_mode,
    version: row.version,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type DailyRow = {
  id: string;
  organization_id: string;
  allowance_week_id: string;
  person_id: string;
  allocation_id: string | null;
  policy_id: string;
  project_id: string;
  geofence_id: string | null;
  allowance_date: string;
  allowance_type: 'meal';
  amount_cents: number | string;
  currency: 'BRL';
  status: DailyAllowance['status'];
  eligibility_reason: EligibilityReason | null;
  blocking_reason: string | null;
  schedule_evidence_source: DailyAllowance['scheduleEvidenceSource'];
  planned_evidence: Record<string, unknown>;
  reconciliation_evidence: Record<string, unknown> | null;
  attendance_punch_id: string | null;
  location_evidence_id: string | null;
  time_entry_id: string | null;
  rule_version: string;
  payment_batch_id: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
  people?: PersonRow | null;
};

function mapDailyRow(row: DailyRow): DailyAllowance {
  return {
    id: row.id,
    organizationId: row.organization_id,
    allowanceWeekId: row.allowance_week_id,
    personId: row.person_id,
    allocationId: row.allocation_id,
    policyId: row.policy_id,
    projectId: row.project_id,
    geofenceId: row.geofence_id,
    allowanceDate: row.allowance_date,
    allowanceType: row.allowance_type,
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    status: row.status,
    eligibilityReason: row.eligibility_reason,
    blockingReason: row.blocking_reason,
    scheduleEvidenceSource: row.schedule_evidence_source,
    plannedEvidence: row.planned_evidence ?? {},
    reconciliationEvidence: row.reconciliation_evidence,
    attendancePunchId: row.attendance_punch_id,
    locationEvidenceId: row.location_evidence_id,
    timeEntryId: row.time_entry_id,
    ruleVersion: row.rule_version,
    paymentBatchId: row.payment_batch_id,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    person: row.people ? mapPersonRow(row.people) : undefined,
  };
}

/* ─────────────────────────────────────────────────────────────
   Policies (leitura + criação leve para configuração)
   ───────────────────────────────────────────────────────────── */

export async function listAllowancePolicies(activeOnly = false): Promise<AllowancePolicy[]> {
  const supabase = createClient();
  let query = supabase.from(ALLOWANCE_POLICIES_TABLE).select('*').order('name');
  if (activeOnly) query = query.eq('status', 'active');
  const { data, error } = await query;
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar políticas de diária', error));
  return (data ?? []).map((r) => mapPolicyRow(r as PolicyRow));
}

export interface AllowancePolicyInput {
  name: string;
  projectId?: string | null;
  geofenceId?: string | null;
  amountCents: number;
  effectiveFrom: string;
  effectiveUntil?: string | null;
  scheduleMode?: AllowancePolicy['scheduleMode'];
  blockOnLeave?: boolean;
  autoApprovalEnabled?: boolean;
  status?: AllowancePolicyStatus;
  notes?: string | null;
}

export async function createAllowancePolicy(input: AllowancePolicyInput): Promise<AllowancePolicy> {
  const supabase = createClient();
  const { userId, orgId } = await getCurrentOrgAndUser(supabase);
  const { data, error } = await supabase
    .from(ALLOWANCE_POLICIES_TABLE)
    .insert({
      organization_id: orgId,
      name: input.name.trim(),
      project_id: input.projectId ?? null,
      geofence_id: input.geofenceId ?? null,
      amount_cents: input.amountCents,
      effective_from: input.effectiveFrom,
      effective_until: input.effectiveUntil ?? null,
      schedule_mode: input.scheduleMode ?? 'derived',
      block_on_leave: input.blockOnLeave ?? true,
      auto_approval_enabled: input.autoApprovalEnabled ?? true,
      status: input.status ?? 'draft',
      notes: input.notes ?? null,
      created_by: userId,
    })
    .select('*')
    .single();
  if (error) throw new Error(rlsFriendlyMessage('Erro ao criar política de diária', error));
  const policy = mapPolicyRow(data as PolicyRow);
  void logAuditEvent({
    organizationId: orgId,
    action: 'allowance_policy.created',
    entityType: 'allowance_policy',
    entityId: policy.id,
    metadata: { name: policy.name, project_id: policy.projectId, amount_cents: policy.amountCents },
  });
  return policy;
}

export async function setAllowancePolicyStatus(
  id: string,
  status: AllowancePolicyStatus,
): Promise<AllowancePolicy> {
  const supabase = createClient();
  const { orgId } = await getCurrentOrgAndUser(supabase);
  const { data, error } = await supabase
    .from(ALLOWANCE_POLICIES_TABLE)
    .update({ status })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(rlsFriendlyMessage('Erro ao atualizar status da política', error));
  void logAuditEvent({
    organizationId: orgId,
    action: 'allowance_policy.status_changed',
    entityType: 'allowance_policy',
    entityId: id,
    metadata: { status },
  });
  return mapPolicyRow(data as PolicyRow);
}

/* ─────────────────────────────────────────────────────────────
   Weeks + daily allowances (leitura)
   ───────────────────────────────────────────────────────────── */

export async function listAllowanceWeeks(): Promise<AllowanceWeek[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(ALLOWANCE_WEEKS_TABLE)
    .select('*')
    .order('week_start', { ascending: false })
    .order('version', { ascending: false });
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar semanas de diárias', error));
  return (data ?? []).map((r) => mapWeekRow(r as WeekRow));
}

/** Semana mais recente (maior versão) de um período, se existir. */
export async function getLatestWeek(
  weekStart: string,
  weekEnd: string,
): Promise<AllowanceWeek | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(ALLOWANCE_WEEKS_TABLE)
    .select('*')
    .eq('week_start', weekStart)
    .eq('week_end', weekEnd)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar semana de diárias', error));
  return data ? mapWeekRow(data as WeekRow) : null;
}

export async function listDailyAllowancesByWeek(weekId: string): Promise<DailyAllowance[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(DAILY_ALLOWANCES_TABLE)
    .select('*, people(*)')
    .eq('allowance_week_id', weekId)
    .order('allowance_date');
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar diárias', error));
  return (data ?? []).map((r) => mapDailyRow(r as unknown as DailyRow));
}

/* ─────────────────────────────────────────────────────────────
   Geração da prévia semanal (motor)
   ───────────────────────────────────────────────────────────── */

type ConsideredAllocation = Pick<
  PersonProjectAllocation,
  'id' | 'personId' | 'projectId' | 'startDate' | 'endDate' | 'plannedPercentage' | 'status'
>;

/** Política aplicável a (projeto, data): mais específica primeiro. */
function resolvePolicy(
  policies: AllowancePolicy[],
  projectId: string,
  date: string,
): AllowancePolicy | null {
  const inEffect = (p: AllowancePolicy) =>
    p.status === 'active' &&
    p.effectiveFrom <= date &&
    (p.effectiveUntil == null || p.effectiveUntil >= date);
  const forProject = policies.filter((p) => inEffect(p) && p.projectId === projectId);
  // preferir a que fixa geofence (mais específica), depois projeto puro
  const specific = forProject.find((p) => p.geofenceId != null) ?? forProject[0];
  if (specific) return specific;
  // fallback da organização (project_id NULL)
  return policies.find((p) => inEffect(p) && p.projectId == null) ?? null;
}

export interface WeeklyPreviewResult {
  week: AllowanceWeek;
  items: DailyAllowance[];
  /** pessoas/dias sem política aplicável (não persistidos em Fase 1) */
  skippedNoPolicy: number;
  /** pessoas sem qualquer alocação considerada (não persistidos) */
  skippedNoAllocation: number;
}

export interface GeneratePreviewOptions {
  weekStart?: string;
  weekEnd?: string;
}

/**
 * Gera (ou regenera) a prévia da próxima semana em modo simulação.
 * Reprodutível: apaga as diárias não aprovadas da semana e recria a
 * partir do estado atual de pessoas/alocações/afastamentos/políticas.
 */
export async function generateWeeklyAllowancePreview(
  options: GeneratePreviewOptions = {},
): Promise<WeeklyPreviewResult> {
  const supabase = createClient();
  const { userId, orgId } = await getCurrentOrgAndUser(supabase);

  const bounds = nextWeekBounds();
  const weekStart = options.weekStart ?? bounds.weekStart;
  const weekEnd = options.weekEnd ?? bounds.weekEnd;
  const dates = eachDateInclusive(weekStart, weekEnd);

  // ── 1) Reunir dados (org-wide) ─────────────────────────────
  const lookbackStart = addDays(weekStart, -DEMOB_LOOKBACK_DAYS);
  const [
    policies,
    { data: peopleRows, error: peopleErr },
    { data: allocRows, error: allocErr },
    { data: leaveRows, error: leaveErr },
    { data: geofenceRows, error: geoErr },
    { data: scheduleRows, error: schedErr },
  ] = await Promise.all([
    listAllowancePolicies(true),
    supabase.from('people').select('*').eq('status', 'active'),
    supabase
      .from('project_allocations')
      .select('id, person_id, project_id, start_date, end_date, planned_percentage, status')
      .in('status', CONSIDERED_ALLOCATION_STATUSES)
      .lte('start_date', weekEnd)
      .or(`end_date.is.null,end_date.gte.${lookbackStart}`),
    supabase
      .from('leave_periods')
      .select('person_id, start_date, end_date, status')
      .in('status', ['planned', 'approved', 'active'])
      .lte('start_date', weekEnd)
      .gte('end_date', weekStart),
    supabase.from('project_geofences').select('id, project_id, active'),
    supabase
      .from(WORK_SCHEDULE_DAYS_TABLE)
      .select('person_id, project_id, geofence_id, work_date, status, source')
      .in('status', ['planned', 'excluded'])
      .gte('work_date', weekStart)
      .lte('work_date', weekEnd),
  ]);

  if (peopleErr) throw new Error(rlsFriendlyMessage('Erro ao carregar pessoas', peopleErr));
  if (allocErr) throw new Error(rlsFriendlyMessage('Erro ao carregar alocações', allocErr));
  if (leaveErr) throw new Error(rlsFriendlyMessage('Erro ao carregar afastamentos', leaveErr));
  if (geoErr) throw new Error(rlsFriendlyMessage('Erro ao carregar geofences', geoErr));
  if (schedErr) throw new Error(rlsFriendlyMessage('Erro ao carregar escala', schedErr));

  const people = (peopleRows ?? []).map((r) => mapPersonRow(r as PersonRow));
  const allocations: ConsideredAllocation[] = (allocRows ?? []).map((r) => ({
    id: r.id as string,
    personId: r.person_id as string,
    projectId: r.project_id as string,
    startDate: r.start_date as string,
    endDate: (r.end_date as string | null) ?? null,
    plannedPercentage: Number(r.planned_percentage ?? 0),
    status: r.status as AllocationStatus,
  }));

  // geofence ativa? (obra = geofence)
  const geofenceActive = new Map<string, boolean>();
  for (const g of geofenceRows ?? []) geofenceActive.set(g.id as string, Boolean(g.active));

  // afastamento por pessoa (intervalos)
  const leavesByPerson = new Map<string, Array<{ start: string; end: string }>>();
  for (const l of leaveRows ?? []) {
    const arr = leavesByPerson.get(l.person_id as string) ?? [];
    arr.push({ start: l.start_date as string, end: l.end_date as string });
    leavesByPerson.set(l.person_id as string, arr);
  }

  // escala explícita / overrides por pessoa+data
  type Sched = { status: 'planned' | 'excluded'; source: string; geofenceId: string | null };
  const scheduleByKey = new Map<string, Sched>();
  for (const s of scheduleRows ?? []) {
    scheduleByKey.set(`${s.person_id}|${s.work_date}`, {
      status: s.status as 'planned' | 'excluded',
      source: s.source as string,
      geofenceId: (s.geofence_id as string | null) ?? null,
    });
  }

  // alocações por pessoa
  const allocByPerson = new Map<string, ConsideredAllocation[]>();
  for (const a of allocations) {
    const arr = allocByPerson.get(a.personId) ?? [];
    arr.push(a);
    allocByPerson.set(a.personId, arr);
  }

  // diárias já existentes de OUTRAS semanas no período (duplicidade)
  const { data: existingRows, error: existErr } = await supabase
    .from(DAILY_ALLOWANCES_TABLE)
    .select('idempotency_key')
    .neq('status', 'reversed')
    .gte('allowance_date', weekStart)
    .lte('allowance_date', weekEnd);
  if (existErr) throw new Error(rlsFriendlyMessage('Erro ao verificar duplicidade', existErr));
  const existingKeys = new Set((existingRows ?? []).map((r) => r.idempotency_key as string));

  // ── 2) Semana (reusa não-aprovada ou cria nova versão) ─────
  const latest = await getLatestWeek(weekStart, weekEnd);
  let week: AllowanceWeek;
  if (latest && EDITABLE_WEEK_STATUSES.includes(latest.status)) {
    week = latest;
    // recomputo: limpar diárias anteriores desta semana
    const { error: delErr } = await supabase
      .from(DAILY_ALLOWANCES_TABLE)
      .delete()
      .eq('allowance_week_id', week.id);
    if (delErr) throw new Error(rlsFriendlyMessage('Erro ao limpar prévia anterior', delErr));
  } else {
    const nextVersion = (latest?.version ?? 0) + 1;
    const { data: weekRow, error: weekErr } = await supabase
      .from(ALLOWANCE_WEEKS_TABLE)
      .insert({
        organization_id: orgId,
        week_start: weekStart,
        week_end: weekEnd,
        status: 'generated',
        simulation_mode: true,
        version: nextVersion,
        generated_by: userId,
        generated_at: new Date().toISOString(),
        created_by: userId,
      })
      .select('*')
      .single();
    if (weekErr) throw new Error(rlsFriendlyMessage('Erro ao criar semana', weekErr));
    week = mapWeekRow(weekRow as WeekRow);
  }

  // ── 3) Avaliar pessoa × dia e montar as linhas ─────────────
  const rowsToInsert: Record<string, unknown>[] = [];
  const seenKeys = new Set<string>();
  let skippedNoPolicy = 0;
  let skippedNoAllocation = 0;

  for (const person of people) {
    const personAllocs = allocByPerson.get(person.id) ?? [];
    if (personAllocs.length === 0) {
      skippedNoAllocation += 1;
      continue;
    }
    const personLeaves = leavesByPerson.get(person.id) ?? [];
    const employmentActive =
      person.status === 'active' && (person.terminatedAt == null || person.terminatedAt >= weekEnd);

    for (const date of dates) {
      // alocação viva cobrindo a data
      const live = personAllocs
        .filter(
          (a) =>
            LIVE_ALLOCATION_STATUSES.includes(a.status) &&
            a.startDate <= date &&
            (a.endDate == null || a.endDate >= date),
        )
        .sort((a, b) => b.plannedPercentage - a.plannedPercentage);
      const liveAlloc = live[0] ?? null;

      // alocação encerrada antes da data (desmobilização) sem viva
      const demobilized =
        !liveAlloc &&
        personAllocs.some((a) => a.endDate != null && a.endDate < date);

      // projeto de referência: da alocação viva, senão da mais recente
      const refAlloc =
        liveAlloc ??
        [...personAllocs].sort((a, b) => (a.endDate ?? '9999') > (b.endDate ?? '9999') ? -1 : 1)[0];
      const projectId = refAlloc.projectId;

      const policy = resolvePolicy(policies, projectId, date);
      if (!policy) {
        skippedNoPolicy += 1;
        continue;
      }

      const geofenceId = policy.geofenceId ?? null;
      const eligibleWorksite = geofenceId == null ? true : geofenceActive.get(geofenceId) === true;

      const onLeave = personLeaves.some((l) => l.start <= date && l.end >= date);
      const sched = scheduleByKey.get(`${person.id}|${date}`);

      const idempotencyKey = `allowance:${orgId}:${person.id}:${date}:${policy.allowanceType}:${policy.id}`;
      const alreadyHasAllowance = existingKeys.has(idempotencyKey) || seenKeys.has(idempotencyKey);

      const input: EligibilityInput = {
        activeEmployment: employmentActive,
        activeAllocation: liveAlloc != null,
        eligibleWorksite,
        onLeave: policy.blockOnLeave ? onLeave : false,
        demobilizedBeforeDate: policy.blockOnDemobilization ? demobilized : false,
        alreadyHasAllowance,
        hasApplicablePolicy: true,
        scheduleMode: policy.scheduleMode,
        hasExplicitSchedule: sched?.status === 'planned',
        explicitlyIncluded: sched?.status === 'planned' && sched.source === 'override',
        explicitlyExcluded: sched?.status === 'excluded',
        isCalendarWorkday: isWeekday(date),
      };

      const outcome = evaluateDailyEligibility(input);
      const status = statusFromReason(outcome.reason);

      const plannedEvidence = {
        active_employment: input.activeEmployment,
        active_allocation: input.activeAllocation,
        allocation_id: liveAlloc?.id ?? null,
        eligible_worksite: input.eligibleWorksite,
        on_leave: input.onLeave,
        demobilized: input.demobilizedBeforeDate,
        schedule_mode: input.scheduleMode,
        schedule_source: outcome.scheduleEvidenceSource,
        evaluated_at: new Date().toISOString(),
      };

      seenKeys.add(idempotencyKey);
      rowsToInsert.push({
        organization_id: orgId,
        allowance_week_id: week.id,
        person_id: person.id,
        allocation_id: liveAlloc?.id ?? null,
        policy_id: policy.id,
        project_id: projectId,
        geofence_id: geofenceId ?? sched?.geofenceId ?? null,
        allowance_date: date,
        allowance_type: policy.allowanceType,
        amount_cents: policy.amountCents,
        status,
        eligibility_reason: outcome.reason,
        blocking_reason: status === 'blocked' ? outcome.reason : null,
        schedule_evidence_source: outcome.scheduleEvidenceSource,
        planned_evidence: plannedEvidence,
        rule_version: RULE_VERSION,
        idempotency_key: idempotencyKey,
        created_by: userId,
      });
    }
  }

  // ── 4) Persistir diárias + atualizar totais da semana ──────
  if (rowsToInsert.length > 0) {
    const { error: insErr } = await supabase.from(DAILY_ALLOWANCES_TABLE).insert(rowsToInsert);
    if (insErr) throw new Error(rlsFriendlyMessage('Erro ao gravar diárias', insErr));
  }

  const totalItems = rowsToInsert.filter((r) => r.status !== 'blocked').length;
  const totalAmount = rowsToInsert
    .filter((r) => r.status !== 'blocked')
    .reduce((s, r) => s + Number(r.amount_cents), 0);
  const totalPeople = new Set(
    rowsToInsert.filter((r) => r.status !== 'blocked').map((r) => r.person_id),
  ).size;

  const { data: updatedWeek, error: updErr } = await supabase
    .from(ALLOWANCE_WEEKS_TABLE)
    .update({
      status: 'generated',
      total_people: totalPeople,
      total_items: totalItems,
      total_amount_cents: totalAmount,
      generated_by: userId,
      generated_at: new Date().toISOString(),
    })
    .eq('id', week.id)
    .select('*')
    .single();
  if (updErr) throw new Error(rlsFriendlyMessage('Erro ao atualizar totais da semana', updErr));
  week = mapWeekRow(updatedWeek as WeekRow);

  void logAuditEvent({
    organizationId: orgId,
    action: 'allowance_week.generated',
    entityType: 'allowance_week',
    entityId: week.id,
    metadata: {
      period: `${weekStart}..${weekEnd}`,
      version: week.version,
      total_items: totalItems,
      total_people: totalPeople,
      total_amount_cents: totalAmount,
      simulation: true,
    },
  });

  const items = await listDailyAllowancesByWeek(week.id);
  return { week, items, skippedNoPolicy, skippedNoAllocation };
}

/* ─────────────────────────────────────────────────────────────
   Fase 2 — Revisão de exceções
   ───────────────────────────────────────────────────────────── */

/** Diárias que ainda exigem tratamento antes da aprovação financeira. */
const UNRESOLVED_DAILY_STATUSES: DailyAllowance['status'][] = [
  'under_review',
  'under_review_missing_schedule',
];

export type ExceptionDecision = 'include' | 'exclude';

/**
 * Revisão de exceção pelo gestor (spec §4.2). 'include' torna a diária
 * prevista (entra no lote); 'exclude' a bloqueia com motivo. A decisão
 * é registrada no snapshot e auditada — nunca apaga o motivo original.
 */
export async function reviewException(
  dailyAllowanceId: string,
  decision: ExceptionDecision,
  reason: string,
): Promise<DailyAllowance> {
  const supabase = createClient();
  const { userId, orgId } = await getCurrentOrgAndUser(supabase);

  const { data: current, error: readErr } = await supabase
    .from(DAILY_ALLOWANCES_TABLE)
    .select('*')
    .eq('id', dailyAllowanceId)
    .single();
  if (readErr) throw new Error(rlsFriendlyMessage('Erro ao carregar diária', readErr));
  const before = mapDailyRow(current as unknown as DailyRow);

  const newStatus = decision === 'include' ? 'planned' : 'blocked';
  const review = {
    decision,
    reason,
    previous_status: before.status,
    previous_reason: before.eligibilityReason,
    reviewed_by: userId,
    reviewed_at: new Date().toISOString(),
  };
  const plannedEvidence = { ...before.plannedEvidence, exception_review: review };

  const { data, error } = await supabase
    .from(DAILY_ALLOWANCES_TABLE)
    .update({
      status: newStatus,
      blocking_reason: decision === 'exclude' ? reason : null,
      planned_evidence: plannedEvidence,
    })
    .eq('id', dailyAllowanceId)
    .select('*, people(*)')
    .single();
  if (error) throw new Error(rlsFriendlyMessage('Erro ao revisar exceção', error));

  void logAuditEvent({
    organizationId: orgId,
    action: 'allowance_daily.exception_reviewed',
    entityType: 'daily_allowance',
    entityId: dailyAllowanceId,
    metadata: { decision, reason, previous_status: before.status, new_status: newStatus },
  });
  return mapDailyRow(data as unknown as DailyRow);
}

/* ─────────────────────────────────────────────────────────────
   Fase 2 — Transições do lote semanal (workflow + segregação)
   ───────────────────────────────────────────────────────────── */

async function loadWeek(weekId: string): Promise<AllowanceWeek> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(ALLOWANCE_WEEKS_TABLE)
    .select('*')
    .eq('id', weekId)
    .single();
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar semana', error));
  return mapWeekRow(data as WeekRow);
}

async function countUnresolvedReviews(weekId: string): Promise<number> {
  const supabase = createClient();
  const { count, error } = await supabase
    .from(DAILY_ALLOWANCES_TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('allowance_week_id', weekId)
    .in('status', UNRESOLVED_DAILY_STATUSES);
  if (error) throw new Error(rlsFriendlyMessage('Erro ao contar exceções', error));
  return count ?? 0;
}

/**
 * Executa uma ação de transição do lote semanal validando a máquina de
 * estados pura e a segregação de funções (RH validado antes do
 * Financeiro; aprovador ≠ gerador; exceções resolvidas). Nunca
 * sobrescreve silenciosamente: cada transição é auditada.
 */
export async function performWeekAction(
  weekId: string,
  action: WeekAction,
): Promise<AllowanceWeek> {
  const supabase = createClient();
  const { userId, orgId } = await getCurrentOrgAndUser(supabase);
  const week = await loadWeek(weekId);

  const approverDistinct = week.generatedBy == null || week.generatedBy !== userId;
  const unresolved = action === 'approve_finance' ? await countUnresolvedReviews(weekId) : 0;

  const check = canPerform(action, week.status, {
    hrValidated: week.hrValidatedAt != null,
    approverDistinctFromGenerator: approverDistinct,
    hasUnresolvedReviews: unresolved > 0,
  });
  if (!check.ok) throw new Error(check.reason ?? 'Transição não permitida.');

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: nextStatus(action, week.status) };
  if (action === 'complete_manager_review') {
    patch.manager_reviewed_by = userId;
    patch.manager_reviewed_at = now;
  } else if (action === 'validate_hr') {
    patch.hr_validated_by = userId;
    patch.hr_validated_at = now;
  } else if (action === 'approve_finance') {
    patch.approved_by = userId;
    patch.approved_at = now;
  }

  const { data, error } = await supabase
    .from(ALLOWANCE_WEEKS_TABLE)
    .update(patch)
    .eq('id', weekId)
    .select('*')
    .single();
  if (error) throw new Error(rlsFriendlyMessage('Erro ao atualizar a semana', error));

  // ao aprovar, as diárias previstas viram aprovadas (entram no lote)
  if (action === 'approve_finance') {
    const { error: bulkErr } = await supabase
      .from(DAILY_ALLOWANCES_TABLE)
      .update({ status: 'approved' })
      .eq('allowance_week_id', weekId)
      .eq('status', 'planned');
    if (bulkErr) throw new Error(rlsFriendlyMessage('Erro ao aprovar diárias', bulkErr));
  }

  void logAuditEvent({
    organizationId: orgId,
    action: `allowance_week.${action}`,
    entityType: 'allowance_week',
    entityId: weekId,
    metadata: { from: week.status, to: patch.status, label: WEEK_ACTIONS[action].label },
  });
  return mapWeekRow(data as WeekRow);
}

/* ─────────────────────────────────────────────────────────────
   Fase 2 — Ajustes imutáveis (ADR-004)
   ───────────────────────────────────────────────────────────── */

type AdjustmentRow = {
  id: string;
  organization_id: string;
  person_id: string;
  daily_allowance_id: string | null;
  source_week_id: string | null;
  target_week_id: string | null;
  type: AdjustmentType;
  amount_cents: number | string;
  reason: string;
  status: AdjustmentStatus;
  requested_by: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
  applied_at: string | null;
};

function mapAdjustmentRow(row: AdjustmentRow): AllowanceAdjustment {
  return {
    id: row.id,
    organizationId: row.organization_id,
    personId: row.person_id,
    dailyAllowanceId: row.daily_allowance_id,
    sourceWeekId: row.source_week_id,
    targetWeekId: row.target_week_id,
    type: row.type,
    amountCents: Number(row.amount_cents),
    reason: row.reason,
    status: row.status,
    requestedBy: row.requested_by,
    approvedBy: row.approved_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    appliedAt: row.applied_at,
  };
}

export interface AdjustmentInput {
  personId: string;
  dailyAllowanceId?: string | null;
  sourceWeekId?: string | null;
  targetWeekId?: string | null;
  type: AdjustmentType;
  amountCents: number;
  reason: string;
}

/**
 * Cria um ajuste (suplemento/compensação/correção/exceção/baixa). Nunca
 * edita a diária paga: o histórico é preservado e o impacto financeiro
 * fica no ajuste, sujeito a aprovação própria.
 */
export async function createAdjustment(input: AdjustmentInput): Promise<AllowanceAdjustment> {
  const supabase = createClient();
  const { userId, orgId } = await getCurrentOrgAndUser(supabase);
  if (!input.reason.trim()) throw new Error('Informe o motivo do ajuste.');

  const { data, error } = await supabase
    .from('allowance_adjustments')
    .insert({
      organization_id: orgId,
      person_id: input.personId,
      daily_allowance_id: input.dailyAllowanceId ?? null,
      source_week_id: input.sourceWeekId ?? null,
      target_week_id: input.targetWeekId ?? null,
      type: input.type,
      amount_cents: input.amountCents,
      reason: input.reason.trim(),
      status: 'pending_approval',
      requested_by: userId,
    })
    .select('*')
    .single();
  if (error) throw new Error(rlsFriendlyMessage('Erro ao criar ajuste', error));

  const adj = mapAdjustmentRow(data as AdjustmentRow);
  void logAuditEvent({
    organizationId: orgId,
    action: 'allowance_adjustment.created',
    entityType: 'allowance_adjustment',
    entityId: adj.id,
    metadata: { person_id: adj.personId, type: adj.type, amount_cents: adj.amountCents },
  });
  return adj;
}

export async function listAdjustmentsByWeek(weekId: string): Promise<AllowanceAdjustment[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('allowance_adjustments')
    .select('*')
    .or(`source_week_id.eq.${weekId},target_week_id.eq.${weekId}`)
    .order('created_at', { ascending: false });
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar ajustes', error));
  return (data ?? []).map((r) => mapAdjustmentRow(r as AdjustmentRow));
}

/* ─────────────────────────────────────────────────────────────
   Fase 3 — Lote de pagamento (exportação, sem integração bancária)
   ───────────────────────────────────────────────────────────── */

export const ALLOWANCE_PAYMENT_BATCHES_TABLE = 'allowance_payment_batches';

type BatchRow = {
  id: string;
  organization_id: string;
  allowance_week_id: string;
  batch_code: string;
  item_count: number;
  total_amount_cents: number | string;
  status: PaymentBatchStatus;
  export_format: PaymentExportFormat | null;
  simulation_mode: boolean;
  requested_by: string | null;
  approved_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  exported_at: string | null;
};

function mapBatchRow(row: BatchRow): AllowancePaymentBatch {
  return {
    id: row.id,
    organizationId: row.organization_id,
    allowanceWeekId: row.allowance_week_id,
    batchCode: row.batch_code,
    itemCount: row.item_count,
    totalAmountCents: Number(row.total_amount_cents),
    status: row.status,
    exportFormat: row.export_format,
    simulationMode: row.simulation_mode,
    requestedBy: row.requested_by,
    approvedBy: row.approved_by,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    exportedAt: row.exported_at,
  };
}

/** Número ISO-8601 da semana da data (segunda como primeiro dia). */
function isoWeek(dateISO: string): { year: number; week: number } {
  const d = parseDate(dateISO);
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNr = (target.getUTCDay() + 6) % 7; // 0=segunda
  target.setUTCDate(target.getUTCDate() - dayNr + 3); // quinta da semana
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return { year: target.getUTCFullYear(), week };
}

export function batchCodeFor(weekStart: string, version: number): string {
  const { year, week } = isoWeek(weekStart);
  return `DIARIAS-${year}-W${String(week).padStart(2, '0')}-v${version}`;
}

export async function listPaymentBatchesByWeek(weekId: string): Promise<AllowancePaymentBatch[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(ALLOWANCE_PAYMENT_BATCHES_TABLE)
    .select('*')
    .eq('allowance_week_id', weekId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar lotes', error));
  return (data ?? []).map((r) => mapBatchRow(r as BatchRow));
}

/**
 * Gera (ou retorna, se já existir) o lote único da semana aprovada.
 * Idempotente: reexecutar não cria um segundo lote. As diárias
 * aprovadas passam a included_in_batch e a semana avança para
 * 'scheduled'. Fase 3 = exportação; nenhum pagamento é executado.
 */
export async function generatePaymentBatch(weekId: string): Promise<AllowancePaymentBatch> {
  const supabase = createClient();
  const { userId, orgId } = await getCurrentOrgAndUser(supabase);
  const week = await loadWeek(weekId);

  if (week.status !== 'finance_approved') {
    throw new Error('O lote só pode ser gerado após a aprovação financeira da semana.');
  }

  // idempotência: reusa lote existente não cancelado
  const existing = (await listPaymentBatchesByWeek(weekId)).find((b) => b.status !== 'cancelled');
  if (existing) return existing;

  // diárias aprovadas compõem o lote
  const { data: approvedRows, error: apprErr } = await supabase
    .from(DAILY_ALLOWANCES_TABLE)
    .select('id, amount_cents, person_id')
    .eq('allowance_week_id', weekId)
    .eq('status', 'approved');
  if (apprErr) throw new Error(rlsFriendlyMessage('Erro ao carregar diárias aprovadas', apprErr));

  const items = approvedRows ?? [];
  const totalAmount = items.reduce((s, r) => s + Number(r.amount_cents), 0);

  const { data: batchRow, error: batchErr } = await supabase
    .from(ALLOWANCE_PAYMENT_BATCHES_TABLE)
    .insert({
      organization_id: orgId,
      allowance_week_id: weekId,
      batch_code: batchCodeFor(week.weekStart, week.version),
      item_count: items.length,
      total_amount_cents: totalAmount,
      status: 'approved',
      simulation_mode: week.simulationMode,
      requested_by: userId,
      approved_by: week.approvedBy,
    })
    .select('*')
    .single();
  if (batchErr) throw new Error(rlsFriendlyMessage('Erro ao gerar lote', batchErr));
  const batch = mapBatchRow(batchRow as BatchRow);

  // vincula as diárias ao lote (approved → included_in_batch)
  if (items.length > 0) {
    const { error: linkErr } = await supabase
      .from(DAILY_ALLOWANCES_TABLE)
      .update({ payment_batch_id: batch.id, status: 'included_in_batch' })
      .eq('allowance_week_id', weekId)
      .eq('status', 'approved');
    if (linkErr) throw new Error(rlsFriendlyMessage('Erro ao vincular diárias ao lote', linkErr));
  }

  // semana avança para 'scheduled' (lote pronto)
  await supabase.from(ALLOWANCE_WEEKS_TABLE).update({ status: 'scheduled' }).eq('id', weekId);

  void logAuditEvent({
    organizationId: orgId,
    action: 'allowance_batch.generated',
    entityType: 'allowance_payment_batch',
    entityId: batch.id,
    metadata: {
      batch_code: batch.batchCode,
      item_count: batch.itemCount,
      total_amount_cents: batch.totalAmountCents,
      simulation: batch.simulationMode,
    },
  });
  return batch;
}

export interface BatchExport {
  filename: string;
  csv: string;
}

/** Formata centavos como decimal simples (sem símbolo) para CSV. */
function centsToDecimal(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

/**
 * Exporta o lote em CSV (uma linha por colaborador, com nº de diárias e
 * total) e marca o lote como exportado. O pagamento em si continua na
 * ferramenta financeira atual — sem cofre de contas nem integração
 * bancária nesta fase.
 */
export async function exportBatchCsv(batchId: string): Promise<BatchExport> {
  const supabase = createClient();
  const { orgId } = await getCurrentOrgAndUser(supabase);

  const { data: batchRow, error: batchErr } = await supabase
    .from(ALLOWANCE_PAYMENT_BATCHES_TABLE)
    .select('*')
    .eq('id', batchId)
    .single();
  if (batchErr) throw new Error(rlsFriendlyMessage('Erro ao carregar lote', batchErr));
  const batch = mapBatchRow(batchRow as BatchRow);

  const { data: lines, error: linesErr } = await supabase
    .from(DAILY_ALLOWANCES_TABLE)
    .select('person_id, amount_cents, allowance_date, project_id, people(full_name, cpf)')
    .eq('payment_batch_id', batchId)
    .order('allowance_date');
  if (linesErr) throw new Error(rlsFriendlyMessage('Erro ao carregar linhas do lote', linesErr));

  // agrega por colaborador
  type Agg = { name: string; cpf: string; days: number; cents: number };
  const byPerson = new Map<string, Agg>();
  for (const l of lines ?? []) {
    const person = (l.people ?? null) as { full_name?: string; cpf?: string | null } | null;
    const agg = byPerson.get(l.person_id as string) ?? {
      name: person?.full_name ?? (l.person_id as string),
      cpf: person?.cpf ?? '',
      days: 0,
      cents: 0,
    };
    agg.days += 1;
    agg.cents += Number(l.amount_cents);
    byPerson.set(l.person_id as string, agg);
  }

  const header = ['Colaborador', 'CPF', 'Diarias', 'Valor'];
  const rows = Array.from(byPerson.values())
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .map((a) => [a.name, a.cpf, String(a.days), centsToDecimal(a.cents)]);
  const escape = (v: string) => (/[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = [header, ...rows].map((r) => r.map(escape).join(';')).join('\r\n');

  const { error: updErr } = await supabase
    .from(ALLOWANCE_PAYMENT_BATCHES_TABLE)
    .update({ status: 'exported', export_format: 'csv', exported_at: new Date().toISOString() })
    .eq('id', batchId);
  if (updErr) throw new Error(rlsFriendlyMessage('Erro ao marcar lote exportado', updErr));

  void logAuditEvent({
    organizationId: orgId,
    action: 'allowance_batch.exported',
    entityType: 'allowance_payment_batch',
    entityId: batchId,
    metadata: { format: 'csv', batch_code: batch.batchCode, lines: rows.length },
  });

  return { filename: `${batch.batchCode}.csv`, csv };
}

/* ─────────────────────────────────────────────────────────────
   Fase 4 — Conciliação (previsto × realizado)
   ───────────────────────────────────────────────────────────── */

/** Diárias que entram na conciliação (pagas / incluídas no lote). */
const RECONCILABLE_DAILY_STATUSES: DailyAllowance['status'][] = [
  'included_in_batch',
  'paid',
  'confirmed',
  'divergent',
];

export interface ReconciliationSummary {
  week: AllowanceWeek;
  items: DailyAllowance[];
  confirmed: number;
  divergent: number;
}

/**
 * Concilia a semana: cruza cada diária paga com jornada
 * (attendance_punches), geofence (location_evidence) e apontamento
 * (time_entries), grava reconciliation_evidence e marca
 * confirmed/divergent. Nunca desconta nem cria ajuste automático — a
 * divergência é sinalizada para análise (ADR-006). Idempotente:
 * reexecutar recomputa a partir dos sinais atuais.
 */
export async function reconcileWeek(weekId: string): Promise<ReconciliationSummary> {
  const supabase = createClient();
  const { orgId } = await getCurrentOrgAndUser(supabase);
  const week = await loadWeek(weekId);

  if (!['scheduled', 'paid', 'reconciliation'].includes(week.status)) {
    throw new Error('A conciliação só ocorre após o lote da semana (status agendado/pago).');
  }

  const dailies = (await listDailyAllowancesByWeek(weekId)).filter((d) =>
    RECONCILABLE_DAILY_STATUSES.includes(d.status),
  );
  if (dailies.length === 0) {
    return { week, items: await listDailyAllowancesByWeek(weekId), confirmed: 0, divergent: 0 };
  }

  const personIds = Array.from(new Set(dailies.map((d) => d.personId)));
  const from = `${week.weekStart}T00:00:00`;
  const to = `${week.weekEnd}T23:59:59`;

  const [
    policies,
    { data: punchRows, error: punchErr },
    { data: locRows, error: locErr },
    { data: teRows, error: teErr },
    { data: geoRows, error: geoErr },
  ] = await Promise.all([
    listAllowancePolicies(),
    supabase
      .from('attendance_punches')
      .select('id, person_id, occurred_at')
      .eq('type', 'clock_in')
      .eq('status', 'accepted')
      .in('person_id', personIds)
      .gte('occurred_at', from)
      .lte('occurred_at', to),
    supabase
      .from('location_evidence')
      .select('id, person_id, geofence_id, distance_from_geofence_meters, captured_at_device')
      .in('person_id', personIds)
      .gte('captured_at_device', from)
      .lte('captured_at_device', to),
    supabase
      .from('time_entries')
      .select('id, person_id, project_id, work_date, status')
      .in('person_id', personIds)
      .in('status', ['submitted', 'approved'])
      .gte('work_date', week.weekStart)
      .lte('work_date', week.weekEnd),
    supabase.from('project_geofences').select('id, radius_meters, accuracy_tolerance_meters'),
  ]);

  if (punchErr) throw new Error(rlsFriendlyMessage('Erro ao carregar jornada', punchErr));
  if (locErr) throw new Error(rlsFriendlyMessage('Erro ao carregar localização', locErr));
  if (teErr) throw new Error(rlsFriendlyMessage('Erro ao carregar apontamentos', teErr));
  if (geoErr) throw new Error(rlsFriendlyMessage('Erro ao carregar geofences', geoErr));

  const policyById = new Map(policies.map((p) => [p.id, p]));
  const geoById = new Map(
    (geoRows ?? []).map((g) => [
      g.id as string,
      Number(g.radius_meters) + Number(g.accuracy_tolerance_meters),
    ]),
  );

  // índices por pessoa|data (a data vem do occurred_at/captured_at)
  const punchByKey = new Map<string, string>(); // -> punch id
  for (const p of punchRows ?? []) {
    punchByKey.set(`${p.person_id}|${(p.occurred_at as string).slice(0, 10)}`, p.id as string);
  }
  type Loc = { id: string; within: boolean };
  const locByKey = new Map<string, Loc>();
  for (const l of locRows ?? []) {
    const key = `${l.person_id}|${(l.captured_at_device as string).slice(0, 10)}`;
    const limit = l.geofence_id ? geoById.get(l.geofence_id as string) : undefined;
    const dist = l.distance_from_geofence_meters as number | null;
    const within = limit != null && dist != null && dist <= limit;
    const prev = locByKey.get(key);
    // preferir uma evidência dentro da cerca, se houver
    if (!prev || (within && !prev.within)) locByKey.set(key, { id: l.id as string, within });
  }
  const teByKey = new Map<string, string>(); // person|date|project -> time_entry id
  for (const t of teRows ?? []) {
    teByKey.set(`${t.person_id}|${t.work_date}|${t.project_id}`, t.id as string);
  }

  let confirmed = 0;
  let divergent = 0;

  for (const d of dailies) {
    const policy = policyById.get(d.policyId);
    const attendanceRequired = policy?.attendanceRequiredForReconciliation ?? true;
    const geofenceRequired = policy?.geofenceRequiredForReconciliation ?? true;

    const pKey = `${d.personId}|${d.allowanceDate}`;
    const punchId = punchByKey.get(pKey) ?? null;
    const loc = locByKey.get(pKey) ?? null;
    const teId = teByKey.get(`${d.personId}|${d.allowanceDate}|${d.projectId}`) ?? null;

    const input: ReconciliationInput = {
      attendanceRequired,
      geofenceRequired,
      hasAcceptedClockIn: punchId != null,
      locationAvailable: loc != null,
      hasLocationWithinGeofence: loc?.within ?? false,
      hasProjectTimeEntry: teId != null,
    };
    const result = reconcileDaily(input);
    if (result.outcome === 'confirmed') confirmed += 1;
    else divergent += 1;

    const evidence = {
      outcome: result.outcome,
      reasons: result.reasons,
      signals: {
        clock_in: input.hasAcceptedClockIn,
        location_available: input.locationAvailable,
        within_geofence: input.hasLocationWithinGeofence,
        project_time_entry: input.hasProjectTimeEntry,
      },
      reconciled_at: new Date().toISOString(),
    };

    const { error: updErr } = await supabase
      .from(DAILY_ALLOWANCES_TABLE)
      .update({
        status: result.outcome,
        reconciliation_evidence: evidence,
        attendance_punch_id: punchId,
        location_evidence_id: loc?.id ?? null,
        time_entry_id: teId,
      })
      .eq('id', d.id);
    if (updErr) throw new Error(rlsFriendlyMessage('Erro ao gravar conciliação', updErr));
  }

  const { data: updatedWeek, error: weekErr } = await supabase
    .from(ALLOWANCE_WEEKS_TABLE)
    .update({ status: 'reconciliation' })
    .eq('id', weekId)
    .select('*')
    .single();
  if (weekErr) throw new Error(rlsFriendlyMessage('Erro ao atualizar a semana', weekErr));

  void logAuditEvent({
    organizationId: orgId,
    action: 'allowance_week.reconciled',
    entityType: 'allowance_week',
    entityId: weekId,
    metadata: { confirmed, divergent, total: dailies.length },
  });

  return {
    week: mapWeekRow(updatedWeek as WeekRow),
    items: await listDailyAllowancesByWeek(weekId),
    confirmed,
    divergent,
  };
}

/**
 * Encerra a semana conciliada. Reabertura futura exige permissão
 * dedicada (allowances.manage) — aqui apenas fecha reconciliation →
 * closed, preservando todo o histórico e as divergências para
 * auditoria/ajuste.
 */
export async function closeWeek(weekId: string): Promise<AllowanceWeek> {
  const supabase = createClient();
  const { orgId } = await getCurrentOrgAndUser(supabase);
  const week = await loadWeek(weekId);
  if (week.status !== 'reconciliation') {
    throw new Error('Só é possível encerrar uma semana em conciliação.');
  }
  const { data, error } = await supabase
    .from(ALLOWANCE_WEEKS_TABLE)
    .update({ status: 'closed' })
    .eq('id', weekId)
    .select('*')
    .single();
  if (error) throw new Error(rlsFriendlyMessage('Erro ao encerrar a semana', error));
  void logAuditEvent({
    organizationId: orgId,
    action: 'allowance_week.closed',
    entityType: 'allowance_week',
    entityId: weekId,
    metadata: { period: `${week.weekStart}..${week.weekEnd}` },
  });
  return mapWeekRow(data as WeekRow);
}

/* ─────────────────────────────────────────────────────────────
   Fase 5 — Inteligência (alertas de inconsistência + custo)
   ───────────────────────────────────────────────────────────── */

export interface CostByProjectRow {
  projectId: string;
  amountCents: number;
  people: number;
  items: number;
}

export interface WeekIntelligence {
  week: AllowanceWeek;
  alerts: AllowanceAlert[];
  costByProject: CostByProjectRow[];
  totalCents: number;
  totalPeople: number;
  previous: { totalCents: number; people: number } | null;
}

/**
 * Deriva os alertas de inconsistência (§19) e o custo por projeto da
 * semana. Só leitura/agregação — não altera nada. Alertas são sinais
 * para análise, jamais acusação (ADR-006).
 */
export async function computeWeekIntelligence(weekId: string): Promise<WeekIntelligence> {
  const supabase = createClient();
  await getCurrentOrgAndUser(supabase);
  const week = await loadWeek(weekId);

  const dailies = await listDailyAllowancesByWeek(weekId);
  const personIds = Array.from(new Set(dailies.map((d) => d.personId)));

  const prevStart = addDays(week.weekStart, -7);
  const prevEnd = addDays(week.weekEnd, -7);

  const [
    { data: leaveRows, error: leaveErr },
    { data: allocRows, error: allocErr },
    projects,
    previousWeek,
  ] = await Promise.all([
    supabase
      .from('leave_periods')
      .select('person_id, start_date, end_date')
      .in('status', ['planned', 'approved', 'active'])
      .lte('start_date', week.weekEnd)
      .gte('end_date', week.weekStart),
    personIds.length > 0
      ? supabase
          .from('project_allocations')
          .select('person_id, project_id, start_date, end_date, status')
          .in('status', CONSIDERED_ALLOCATION_STATUSES)
          .in('person_id', personIds)
      : Promise.resolve({ data: [], error: null }),
    getProjectsAsync().catch(() => []),
    getLatestWeek(prevStart, prevEnd).catch(() => null),
  ]);

  if (leaveErr) throw new Error(rlsFriendlyMessage('Erro ao carregar afastamentos', leaveErr));
  if (allocErr) throw new Error(rlsFriendlyMessage('Erro ao carregar alocações', allocErr));

  // estado de alocação por pessoa+projeto (viva? última data de fim?)
  type AllocState = { personId: string; projectId: string; hasLive: boolean; lastEndDate: string | null };
  const stateMap = new Map<string, AllocState>();
  const livePeopleByProject = new Map<string, Set<string>>();
  for (const a of allocRows ?? []) {
    const personId = a.person_id as string;
    const projectId = a.project_id as string;
    const key = `${personId}|${projectId}`;
    const endDate = (a.end_date as string | null) ?? null;
    const isLive =
      ['pending_approval', 'active'].includes(a.status as string) &&
      (a.start_date as string) <= week.weekEnd &&
      (endDate == null || endDate >= week.weekStart);

    const prev = stateMap.get(key) ?? { personId, projectId, hasLive: false, lastEndDate: null };
    prev.hasLive = prev.hasLive || isLive;
    if (endDate != null && (prev.lastEndDate == null || endDate > prev.lastEndDate)) {
      prev.lastEndDate = endDate;
    }
    stateMap.set(key, prev);

    if (isLive) {
      const s = livePeopleByProject.get(projectId) ?? new Set<string>();
      s.add(personId);
      livePeopleByProject.set(projectId, s);
    }
  }

  const allocatedPeopleByProject: Record<string, number> = {};
  for (const [projectId, people] of livePeopleByProject) {
    allocatedPeopleByProject[projectId] = people.size;
  }

  const closedProjectIds = projects
    .filter((p) => p.status === 'concluido' || p.status === 'cancelado')
    .map((p) => p.id);

  const intelDailies: IntelligenceDaily[] = dailies.map((d) => ({
    personId: d.personId,
    projectId: d.projectId,
    allowanceDate: d.allowanceDate,
    status: d.status,
    eligibilityReason: d.eligibilityReason,
    amountCents: d.amountCents,
    reconciliationReasons:
      (d.reconciliationEvidence?.reasons as string[] | undefined) ?? undefined,
  }));

  const previous = previousWeek
    ? { totalCents: previousWeek.totalAmountCents, people: previousWeek.totalPeople }
    : null;

  const alerts = computeAlerts({
    dailies: intelDailies,
    leaves: (leaveRows ?? []).map((l) => ({
      personId: l.person_id as string,
      start: l.start_date as string,
      end: l.end_date as string,
    })),
    allocationState: Array.from(stateMap.values()),
    allocatedPeopleByProject,
    closedProjectIds,
    previous: previous ?? undefined,
  });

  // custo por projeto (agrega centavos + pessoas + itens)
  const cents = computeCostByProject(intelDailies);
  const peopleByProject = new Map<string, Set<string>>();
  const itemsByProject = new Map<string, number>();
  for (const d of intelDailies) {
    if (!['planned', 'approved', 'included_in_batch', 'paid', 'confirmed', 'divergent'].includes(d.status))
      continue;
    const s = peopleByProject.get(d.projectId) ?? new Set<string>();
    s.add(d.personId);
    peopleByProject.set(d.projectId, s);
    itemsByProject.set(d.projectId, (itemsByProject.get(d.projectId) ?? 0) + 1);
  }
  const costRows: CostByProjectRow[] = Object.entries(cents)
    .map(([projectId, amountCents]) => ({
      projectId,
      amountCents,
      people: peopleByProject.get(projectId)?.size ?? 0,
      items: itemsByProject.get(projectId) ?? 0,
    }))
    .sort((a, b) => b.amountCents - a.amountCents);

  const totalCents = costRows.reduce((s, r) => s + r.amountCents, 0);
  const totalPeople = new Set(
    intelDailies
      .filter((d) => d.status !== 'blocked' && d.status !== 'reversed')
      .map((d) => d.personId),
  ).size;

  return { week, alerts, costByProject: costRows, totalCents, totalPeople, previous };
}
