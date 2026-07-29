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
export type TravelEligibilityMode = 'different_municipality' | 'not_required' | 'manual_review';

export type AllowancePolicyStatus = 'draft' | 'active' | 'inactive';

/**
 * Faixa de valor por função (migration 078). A política tem um
 * valor-base (fallback) e N faixas; o motor casa `matchJobTitles`
 * contra `people.job_title` (sem acento, minúsculo, por substring)
 * e aplica a de menor `priority` que casar.
 */
export interface AllowancePolicyTier {
  id: string;
  organizationId: string;
  policyId: string;
  /** rótulo da faixa, ex.: "Liderança" */
  name: string;
  amountCents: number;
  /** palavras-chave de função, ex.: ['encarregado','supervisor'] */
  matchJobTitles: string[];
  /** menor primeiro */
  priority: number;
  createdAt: string;
  updatedAt: string;
}

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
  travelEligibilityMode: TravelEligibilityMode;
  residenceMunicipalityRequired: boolean;
  serviceMunicipalityRequired: boolean;
  version: number;
  supersedesPolicyId: string | null;
  attendanceRequiredForReconciliation: boolean;
  geofenceRequiredForReconciliation: boolean;
  geofenceToleranceMeters: number | null;
  autoApprovalEnabled: boolean;
  status: AllowancePolicyStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  /** faixas por função; vazio = valor único (amountCents) */
  tiers: AllowancePolicyTier[];
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
  /** carimbos de segregação de funções (migration 060) */
  managerReviewedBy: string | null;
  managerReviewedAt: string | null;
  hrValidatedBy: string | null;
  hrValidatedAt: string | null;
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
  | 'service_outside_residence_municipality'
  | 'same_residence_and_service_municipality'
  | 'missing_or_unvalidated_residence_municipality'
  | 'missing_service_municipality'
  | 'manual_municipality_review_required'
  | 'manual_include_override'
  | 'manual_exclude_override'
  | 'blocked_inactive_employment'
  | 'blocked_no_allocation'
  | 'blocked_ineligible_worksite'
  | 'blocked_not_scheduled'
  | 'under_review_missing_schedule'
  | 'blocked_leave'
  | 'blocked_demobilized'
  | 'blocked_duplicate'
  | 'blocked_no_policy';

export interface MunicipalitySnapshot {
  code: string | null;
  name: string | null;
  stateCode: string | null;
  source: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  status?: string | null;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  validationMetadata?: Record<string, unknown>;
}

export interface AllowanceMunicipalityEvidence {
  residence: MunicipalitySnapshot | null;
  service: MunicipalitySnapshot | null;
  projectGeofenceId: string | null;
  automaticResult: EligibilityReason;
  finalResult: EligibilityReason;
  override?: {
    id: string;
    action: 'include' | 'exclude';
    reason: string;
    approvedBy: string;
    approvedAt: string;
  } | null;
  evaluatedAt: string;
}

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
  /** faixa aplicada (null = valor-base da política) */
  policyTierId: string | null;
  /** rótulo congelado da faixa no momento da geração */
  tierLabel: string | null;
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

export type AllowanceOverrideAction = 'include' | 'exclude';
export type AllowanceOverrideStatus = 'pending_approval' | 'approved' | 'rejected' | 'cancelled';

export interface AllowanceEligibilityOverride {
  id: string;
  organizationId: string;
  personId: string;
  allowanceDate: string;
  projectId: string;
  geofenceId: string | null;
  action: AllowanceOverrideAction;
  reason: string;
  status: AllowanceOverrideStatus;
  requestedBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ────────────────────── Payment batch (Fase 3) ──────────────── */

export type PaymentBatchStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'exported'
  | 'failed'
  | 'cancelled';

export type PaymentExportFormat = 'csv' | 'pdf' | 'manual_export';

export interface AllowancePaymentBatch {
  id: string;
  organizationId: string;
  allowanceWeekId: string;
  batchCode: string;
  itemCount: number;
  totalAmountCents: number;
  status: PaymentBatchStatus;
  exportFormat: PaymentExportFormat | null;
  simulationMode: boolean;
  requestedBy: string | null;
  approvedBy: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  exportedAt: string | null;
}

export const PAYMENT_BATCH_STATUS_LABELS: Record<PaymentBatchStatus, string> = {
  draft: 'Rascunho',
  pending_approval: 'Aguardando aprovação',
  approved: 'Aprovado',
  exported: 'Exportado',
  failed: 'Falha',
  cancelled: 'Cancelado',
};

/* ─────────────────────── Allowance adjustment ───────────────── */

export type AdjustmentType =
  | 'supplement'
  | 'compensation'
  | 'manual_correction'
  | 'approved_exception'
  | 'write_off';

export type AdjustmentStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'applied'
  | 'cancelled';

export interface AllowanceAdjustment {
  id: string;
  organizationId: string;
  personId: string;
  dailyAllowanceId: string | null;
  sourceWeekId: string | null;
  targetWeekId: string | null;
  type: AdjustmentType;
  /** pode ser negativo (compensação/baixa) ou positivo (suplemento) */
  amountCents: number;
  reason: string;
  status: AdjustmentStatus;
  requestedBy: string | null;
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
  appliedAt: string | null;
}

export const ADJUSTMENT_TYPE_LABELS: Record<AdjustmentType, string> = {
  supplement: 'Suplemento',
  compensation: 'Compensação',
  manual_correction: 'Correção manual',
  approved_exception: 'Exceção aprovada',
  write_off: 'Baixa (não recuperável)',
};

/* ─────────────────────────── Labels ─────────────────────────── */

export const SCHEDULE_MODE_LABELS: Record<ScheduleMode, string> = {
  derived: 'Derivada (alocação + calendário)',
  explicit_required: 'Escala explícita obrigatória',
  not_required: 'Sem exigência de escala',
};

export const TRAVEL_ELIGIBILITY_MODE_LABELS: Record<TravelEligibilityMode, string> = {
  different_municipality: 'Municípios diferentes',
  not_required: 'Não exigido',
  manual_review: 'Revisão manual',
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
  service_outside_residence_municipality: 'Deslocamento elegível',
  same_residence_and_service_municipality: 'Mesmo município',
  missing_or_unvalidated_residence_municipality: 'Residência não validada',
  missing_service_municipality: 'Município do serviço ausente',
  manual_municipality_review_required: 'Revisão municipal obrigatória',
  manual_include_override: 'Exceção aprovada',
  manual_exclude_override: 'Exclusão manual aprovada',
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
  if (
    reason === 'planned_eligible'
    || reason === 'service_outside_residence_municipality'
    || reason === 'manual_include_override'
  ) return 'eligible';
  if (
    reason === 'under_review_missing_schedule'
    || reason === 'missing_or_unvalidated_residence_municipality'
    || reason === 'missing_service_municipality'
    || reason === 'manual_municipality_review_required'
  ) return 'review';
  return 'blocked';
}
