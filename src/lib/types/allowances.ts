/**
 * Domain types for Diárias de Campo (migrations 056–061).
 * ADR-001: uma diária por pessoa/data (DailyAllowance), agrupada num
 * lote semanal único (AllowanceWeek). Fase 1 roda em modo simulação.
 *
 * Naming: camelCase aqui, snake_case no banco (mapeado nos serviços).
 * Valores monetários em centavos (bigint no banco → number aqui).
 */

/* ─────────────────────── Allowance policy ───────────────────── */

export type AllowanceType = 'meal';

export type ScheduleMode = 'derived' | 'explicit_required' | 'not_required';

export type AllowancePolicyStatus = 'draft' | 'active' | 'inactive';

export interface AllowancePolicy {
  id: string;
  organizationId: string;
  name: string;
  allowanceType: AllowanceType;
  /** null = política fallback da organização */
  projectId: string | null;
  /** obra = geofence do projeto (migration 050) */
  geofenceId: string | null;
  amountCents: number;
  currency: 'BRL';
  effectiveFrom: string;
  effectiveUntil: string | null;
  activeEmploymentRequired: boolean;
  activeAllocationRequired: boolean;
  blockOnLeave: boolean;
  blockOnDemobilization: boolean;
  scheduleMode: ScheduleMode;
  attendanceRequiredForReconciliation: boolean;
  geofenceRequiredForReconciliation: boolean;
  geofenceToleranceMeters: number | null;
  autoApprovalEnabled: boolean;
  status: AllowancePolicyStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ──────────────────── Work schedule day ─────────────────────── */

export type WorkScheduleDayStatus = 'planned' | 'excluded' | 'cancelled';
export type WorkScheduleDaySource = 'manual' | 'import' | 'override';

export interface WorkScheduleDay {
  id: string;
  organizationId: string;
  personId: string;
  projectId: string | null;
  geofenceId: string | null;
  workDate: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  status: WorkScheduleDayStatus;
  source: WorkScheduleDaySource;
  overrideReason: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/* ───────────────────────── Allowance week ───────────────────── */

export type AllowanceWeekStatus =
  | 'draft'
  | 'generated'
  | 'manager_review'
  | 'hr_validation'
  | 'finance_approved'
  | 'scheduled'
  | 'processing'
  | 'paid'
  | 'reconciliation'
  | 'closed'
  | 'cancelled';

export interface AllowanceWeek {
  id: string;
  organizationId: string;
  weekStart: string;
  weekEnd: string;
  status: AllowanceWeekStatus;
  totalPeople: number;
  totalItems: number;
  totalAmountCents: number;
  generatedBy: string | null;
  generatedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  simulationMode: boolean;
  version: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ───────────────────────── Daily allowance ──────────────────── */

export type DailyAllowanceStatus =
  | 'candidate'
  | 'planned'
  | 'under_review'
  | 'under_review_missing_schedule'
  | 'blocked'
  | 'approved'
  | 'included_in_batch'
  | 'processing'
  | 'paid'
  | 'confirmed'
  | 'divergent'
  | 'compensation_pending'
  | 'reversed';

export type ScheduleEvidenceSource =
  | 'active_allocation_and_calendar'
  | 'explicit_schedule'
  | 'manual_override'
  | 'not_required';

/**
 * Motivos de elegibilidade/bloqueio — espelham a função de decisão do
 * spec (§5). Cada diária guarda o motivo exato.
 */
export type EligibilityReason =
  | 'planned_eligible'
  | 'blocked_inactive_employment'
  | 'blocked_no_allocation'
  | 'blocked_ineligible_worksite'
  | 'blocked_not_scheduled'
  | 'under_review_missing_schedule'
  | 'blocked_leave'
  | 'blocked_demobilized'
  | 'blocked_duplicate'
  | 'blocked_no_policy';

export interface DailyAllowance {
  id: string;
  organizationId: string;
  allowanceWeekId: string;
  personId: string;
  allocationId: string | null;
  policyId: string;
  projectId: string;
  geofenceId: string | null;
  allowanceDate: string;
  allowanceType: AllowanceType;
  amountCents: number;
  currency: 'BRL';
  status: DailyAllowanceStatus;
  eligibilityReason: EligibilityReason | null;
  blockingReason: string | null;
  scheduleEvidenceSource: ScheduleEvidenceSource | null;
  plannedEvidence: Record<string, unknown>;
  reconciliationEvidence: Record<string, unknown> | null;
  attendancePunchId: string | null;
  locationEvidenceId: string | null;
  timeEntryId: string | null;
  ruleVersion: string;
  paymentBatchId: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  /** joined person (quando selecionado com people(*)) */
  person?: import('./people').Person;
}

/* ─────────────────────────── Labels ─────────────────────────── */

export const SCHEDULE_MODE_LABELS: Record<ScheduleMode, string> = {
  derived: 'Derivada (alocação + calendário)',
  explicit_required: 'Escala explícita obrigatória',
  not_required: 'Sem exigência de escala',
};

export const ALLOWANCE_WEEK_STATUS_LABELS: Record<AllowanceWeekStatus, string> = {
  draft: 'Rascunho',
  generated: 'Prévia gerada',
  manager_review: 'Revisão do gestor',
  hr_validation: 'Validação de RH',
  finance_approved: 'Aprovada pelo Financeiro',
  scheduled: 'Agendada',
  processing: 'Em processamento',
  paid: 'Paga',
  reconciliation: 'Conciliação',
  closed: 'Encerrada',
  cancelled: 'Cancelada',
};

export const DAILY_ALLOWANCE_STATUS_LABELS: Record<DailyAllowanceStatus, string> = {
  candidate: 'Candidata',
  planned: 'Prevista',
  under_review: 'Em revisão',
  under_review_missing_schedule: 'Em revisão · sem escala',
  blocked: 'Bloqueada',
  approved: 'Aprovada',
  included_in_batch: 'No lote',
  processing: 'Processando',
  paid: 'Paga',
  confirmed: 'Confirmada',
  divergent: 'Divergente',
  compensation_pending: 'Compensação pendente',
  reversed: 'Estornada',
};

/** Rótulo humano de cada motivo de elegibilidade/bloqueio. */
export const ELIGIBILITY_REASON_LABELS: Record<EligibilityReason, string> = {
  planned_eligible: 'Elegível',
  blocked_inactive_employment: 'Vínculo inativo',
  blocked_no_allocation: 'Sem alocação ativa',
  blocked_ineligible_worksite: 'Obra não elegível',
  blocked_not_scheduled: 'Fora da escala',
  under_review_missing_schedule: 'Escala não confirmada',
  blocked_leave: 'Férias ou afastamento',
  blocked_demobilized: 'Desmobilizado antes da data',
  blocked_duplicate: 'Diária duplicada',
  blocked_no_policy: 'Sem política aplicável',
};

/** Classificação visual agregada por dia (spec §6). */
export type DayClassification = 'eligible' | 'review' | 'blocked';

export function classifyReason(reason: EligibilityReason): DayClassification {
  if (reason === 'planned_eligible') return 'eligible';
  if (reason === 'under_review_missing_schedule') return 'review';
  return 'blocked';
}
