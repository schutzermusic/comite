/**
 * Domain types for the enterprise allocation / capacity / timesheet
 * layer (migrations 038–042). DB-backed — these gradually replace the
 * mock-only `ProjectAllocation` (src/lib/types.ts) and
 * `ProjectAllocationV2` (src/lib/types/project-v2.ts) in the Equipe tab.
 *
 * Naming: camelCase here, snake_case in the DB (mapped in services).
 */

/* ─────────────────────────── Person ─────────────────────────── */

export type PersonStatus = 'active' | 'inactive';
export type PersonSource = 'manual' | 'payroll_import' | 'profile';
export type PersonContractType = 'clt' | 'pj' | 'estagio' | 'temporario' | 'outro';

export interface Person {
  id: string;
  organizationId: string;
  /** profiles.id when the person has a login; null otherwise */
  profileId: string | null;
  fullName: string;
  /** normalized name used to match payroll_employee_lines */
  payrollNameKey: string | null;
  /** CPF (11 dígitos) — chave legal do trabalhador (Portaria 671) */
  cpf: string | null;
  email: string | null;
  jobTitle: string | null;
  department: string | null;
  contractType: PersonContractType | null;
  /** contractual weekly hours — base of derived capacity */
  weeklyHours: number;
  costCenterId: string | null;
  managerPersonId: string | null;
  status: PersonStatus;
  source: PersonSource;
  hiredAt: string | null;
  terminatedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ResidenceMunicipalitySource =
  | 'hr_registration'
  | 'employee_declaration'
  | 'migration'
  | 'manual_adjustment';
export type ResidenceMunicipalityStatus = 'pending_validation' | 'validated' | 'expired';

export interface PersonResidenceMunicipality {
  id: string;
  organizationId: string;
  personId: string;
  municipalityCode: string;
  municipalityName: string;
  stateCode: string;
  validFrom: string;
  validUntil: string | null;
  source: ResidenceMunicipalitySource;
  status: ResidenceMunicipalityStatus;
  validationMetadata: Record<string, unknown>;
  verifiedBy: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ──────────────────────── Allocation ────────────────────────── */

export type AllocationType =
  | 'billable'
  | 'non_billable'
  | 'overhead'
  | 'bench'
  | 'training';

export type AllocationStatus =
  | 'draft'
  | 'pending_approval'
  | 'active'
  | 'ended'
  | 'cancelled'
  | 'rejected';

export type AllocationSource = 'manual' | 'project_plan' | 'import';

export interface PersonProjectAllocation {
  id: string;
  organizationId: string;
  personId: string;
  projectId: string;
  roleTitle: string | null;
  allocationType: AllocationType;
  startDate: string;
  endDate: string | null;
  plannedPercentage: number;
  plannedHoursWeek: number | null;
  status: AllocationStatus;
  source: AllocationSource;
  costCenterId: string | null;
  justification: string | null;
  /** exige registro de ponto (dispara provisionamento de acesso) */
  requiresPonto: boolean;
  requestedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  /** joined person (when selected with people(*)) */
  person?: Person;
}

/* ─────────────────────────── Leave ──────────────────────────── */

export type LeaveType =
  | 'vacation'
  | 'medical'
  | 'parental'
  | 'unpaid'
  | 'training'
  | 'other';

export type LeaveStatus = 'planned' | 'approved' | 'active' | 'completed' | 'cancelled';

export interface LeavePeriod {
  id: string;
  organizationId: string;
  personId: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  /** null = full-day unavailability */
  hoursPerDay: number | null;
  status: LeaveStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ────────────────────────── Timesheet ───────────────────────── */

export type WorkSessionSource = 'web_timer' | 'manual_entry' | 'manager_adjustment';
export type WorkSessionStatus = 'running' | 'draft' | 'consolidated' | 'discarded';

export interface ProjectWorkSession {
  id: string;
  organizationId: string;
  personId: string;
  projectId: string;
  allocationId: string | null;
  timelineItemId: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
  description: string | null;
  source: WorkSessionSource;
  status: WorkSessionStatus;
  timeEntryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TimeEntryStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'locked';

export type TimesheetExceptionFlag =
  | 'no_active_allocation'
  | 'time_overlap'
  | 'over_capacity'
  | 'over_planned';

export interface TimeEntry {
  id: string;
  organizationId: string;
  personId: string;
  projectId: string;
  allocationId: string | null;
  timelineItemId: string | null;
  workDate: string;
  minutes: number;
  description: string | null;
  sourceSessionId: string | null;
  status: TimeEntryStatus;
  exceptionFlags: TimesheetExceptionFlag[];
  autoApproved: boolean;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  /** future payroll-cost phase (competence snapshot) */
  hourlyCostCents: number | null;
  costCents: number | null;
  createdAt: string;
  updatedAt: string;
  person?: Person;
  /** Etapa do cronograma escolhida pelo colaborador no app de Ponto. */
  timelineItem?: { title: string; wbsCode: string | null };
}

/* ──────────────── Geofence (migration 050) ──────────────────── */

export interface ProjectGeofence {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  accuracyToleranceMeters: number;
  active: boolean;
  municipalityCode: string | null;
  municipalityName: string | null;
  stateCode: string | null;
  municipalitySource: 'manual' | 'reverse_geocoding' | 'migration' | null;
  municipalityVerifiedAt: string | null;
  municipalityVerifiedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ──────────────── Inteligência (Fase 8, derivado) ───────────── */

/** Entrada do simulador de nova demanda (spec §17). */
export interface DemandSimulationInput {
  startMonth: string; // YYYY-MM
  endMonth: string; // YYYY-MM
  neededPercentage: number;
  maxMonthlyCostCents?: number | null;
  competencies?: string; // texto livre
  department?: string;
}

export type CandidateConflict = 'none' | 'partial' | 'overloaded';

/** Candidato ranqueado do simulador. */
export interface DemandCandidate {
  person: Person;
  /** menor disponibilidade % ao longo do período */
  availablePct: number;
  estimatedMonthlyCostCents: number | null;
  /** aderência de competência 0–100 (heurística de tokens) */
  competencyScore: number;
  conflict: CandidateConflict;
  /** compatibilidade composta 0–100 */
  compatibility: number;
  reasons: string[];
}

/** Ponto de forecast de capacidade corporativa. */
export interface CapacityForecastPoint {
  month: string;
  /** FTE comprometido (Σ % ÷ 100) */
  demandFte: number;
  /** FTE de capacidade (headcount ativo) */
  capacityFte: number;
  overloadedCount: number;
  idleCount: number;
}

/** Resumo forward-looking para o painel e para a narrativa de IA. */
export interface WorkforceIntelligenceSummary {
  month: string;
  headcount: number;
  fteDemand: number;
  overloaded: Array<{ personId: string; name: string; totalPct: number }>;
  idle: Array<{ personId: string; name: string; totalPct: number }>;
  forecast: CapacityForecastPoint[];
}

/** Insight gerado pela IA (narrativa executiva). */
export interface WorkforceInsight {
  title: string;
  detail: string;
  severity: GovernanceSeverity;
}

export interface WorkforceAdvice {
  headline: string;
  insights: WorkforceInsight[];
  recommendations: string[];
}

/* ────────────────── Governança (migration 047) ──────────────── */

export type GovernanceExceptionType =
  | 'over_allocation'
  | 'self_approval'
  | 'closed_project_time'
  | 'cost_without_cost_center'
  | 'recurring_correction'
  | 'payroll_without_allocation';

export type GovernanceSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type GovernanceStatus = 'open' | 'under_review' | 'resolved' | 'dismissed';

export interface GovernanceException {
  id: string;
  organizationId: string;
  type: GovernanceExceptionType;
  severity: GovernanceSeverity;
  status: GovernanceStatus;
  personId: string | null;
  projectId: string | null;
  allocationId: string | null;
  title: string;
  evidence: Record<string, unknown>;
  fingerprint: string;
  detectedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNotes: string | null;
  createdAt: string;
  updatedAt: string;
  person?: Person;
}

export const GOVERNANCE_TYPE_LABELS: Record<GovernanceExceptionType, string> = {
  over_allocation: 'Sobrecarga (>100%)',
  self_approval: 'Segregação de funções',
  closed_project_time: 'Horas em projeto encerrado',
  cost_without_cost_center: 'Custo sem centro de custo',
  recurring_correction: 'Correções de ponto recorrentes',
  payroll_without_allocation: 'Folha sem alocação ativa',
};

export const GOVERNANCE_SEVERITY_LABELS: Record<GovernanceSeverity, string> = {
  info: 'Informativo',
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  critical: 'Crítica',
};

/* ────────────────── Jornada (migration 045) ─────────────────── */

export type PunchType = 'clock_in' | 'break_start' | 'break_end' | 'clock_out';
export type PunchSource = 'web' | 'mobile' | 'import' | 'manager_adjustment';
export type PunchStatus = 'accepted' | 'under_review' | 'corrected' | 'cancelled';

export interface AttendancePunch {
  id: string;
  organizationId: string;
  personId: string;
  type: PunchType;
  occurredAt: string;
  receivedAt: string;
  timezone: string;
  source: PunchSource;
  status: PunchStatus;
  originalPunchId: string | null;
  correctionReason: string | null;
  correctedBy: string | null;
  clientEventId: string | null;
  notes: string | null;
  /** Número Sequencial de Registro (Portaria 671) — atribuído pelo banco */
  nsr: number | null;
  /** SHA-256 encadeado com o registro anterior (integridade fiscal) */
  integrityHash: string | null;
  createdAt: string;
  updatedAt: string;
  person?: Person;
}

/* ─────────────── Ponto Oficial / REP-P (migration 052) ──────── */

export interface RepSettings {
  organizationId: string;
  employerIdType: 'cnpj' | 'cpf';
  employerId: string;
  employerName: string;
  employerCei: string | null;
  timezone: string;
  developerIdType: 'cnpj' | 'cpf';
  developerId: string;
  developerName: string;
  repPVersion: string;
  active: boolean;
  notes: string | null;
  updatedAt: string;
}

export type RepFileType = 'afd' | 'aej' | 'espelho' | 'comprovante';

export interface RepFileExport {
  id: string;
  organizationId: string;
  fileType: RepFileType;
  periodStart: string | null;
  periodEnd: string | null;
  personId: string | null;
  fileName: string;
  sha256: string;
  recordCount: number;
  params: Record<string, unknown>;
  generatedBy: string | null;
  generatedAt: string;
}

/** Derived journey of one person on one day (never a table). */
export interface DayJourney {
  personId: string;
  date: string; // YYYY-MM-DD
  firstIn: string | null;
  lastOut: string | null;
  /** productive minutes = worked spans − breaks */
  workedMinutes: number;
  breakMinutes: number;
  /** contractual expected minutes (weekly_hours/5 × 60) */
  expectedMinutes: number;
  /** worked above expected */
  overtimeMinutes: number;
  /** minutes worked in the 22:00–05:00 window (adicional noturno) */
  nightMinutes: number;
  /** workedMinutes − expectedMinutes (can be negative) */
  balanceMinutes: number;
  /** open journey (clock_in without matching clock_out) */
  incomplete: boolean;
  punches: AttendancePunch[];
}

/** Journey × timesheet reconciliation of one day (D4). */
export interface JourneyReconciliation {
  personId: string;
  date: string;
  /** productive minutes from punches */
  workedMinutes: number;
  /** approved/submitted apontamento minutes */
  reportedMinutes: number;
  /** worked − reported (journey time not applied to any project) */
  unclassifiedMinutes: number;
  /** reported − worked (project time outside the journey) */
  outsideJourneyMinutes: number;
}

export const PUNCH_TYPE_LABELS: Record<PunchType, string> = {
  clock_in: 'Entrada',
  break_start: 'Início do intervalo',
  break_end: 'Fim do intervalo',
  clock_out: 'Saída',
};

/* ────────────────── Labor cost (migration 043) ──────────────── */

export type CostSnapshotSource = 'estimated' | 'payroll' | 'manual';
export type CostSnapshotStatus = 'estimated' | 'processed' | 'reconciled' | 'superseded';

/** Loaded cost of one person in a competence (frozen snapshot). Cents. */
export interface EmployeeCostSnapshot {
  id: string;
  organizationId: string;
  personId: string;
  competenceMonth: string; // YYYY-MM
  salaryCents: number;
  payrollTaxesCents: number;
  benefitsCents: number;
  provisionsCents: number;
  otherCostsCents: number;
  loadedMonthlyCostCents: number;
  productiveCapacityHours: number;
  loadedHourlyCostCents: number;
  source: CostSnapshotSource;
  sourcePayrollBatchId: string | null;
  status: CostSnapshotStatus;
  version: number;
  supersedesId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  person?: Person;
}

export type LaborCostStatus =
  | 'open'
  | 'estimated'
  | 'payroll_processed'
  | 'reconciled'
  | 'locked';

/** Consolidated labor cost of a project/person in a competence. Cents. */
export interface ProjectLaborCostPeriod {
  id: string;
  organizationId: string;
  projectId: string;
  personId: string | null;
  competenceMonth: string;
  plannedHours: number;
  approvedHours: number;
  plannedCostCents: number;
  estimatedActualCostCents: number;
  reconciledActualCostCents: number;
  varianceAmountCents: number;
  variancePercentage: number | null;
  status: LaborCostStatus;
  employeeCostSnapshotId: string | null;
  computedAt: string | null;
  createdAt: string;
  updatedAt: string;
  person?: Person;
}

/** Project margin roll-up (differential D1). Cents. */
export interface ProjectMargin {
  projectId: string;
  month: string;
  revenueCents: number | null;
  laborCostCents: number;
  otherCostCents: number;
  marginCents: number | null;
  marginPercentage: number | null;
}

/* ─────────────────── Derived (never tables) ─────────────────── */

/** Capacity/commitment summary of one person over a period. */
export interface PersonCapacitySummary {
  personId: string;
  periodStart: string;
  periodEnd: string;
  /** contractual hours in the period (weekly_hours pro-rata) */
  contractualHours: number;
  /** hours removed by overlapping leave periods */
  leaveHours: number;
  /** contractualHours − leaveHours */
  capacityHours: number;
  /** Σ planned_percentage of live allocations overlapping the period */
  allocatedPct: number;
  /** 100 − allocatedPct (negative = overload) */
  availablePct: number;
  overloaded: boolean;
  /** live allocations considered in the sum */
  allocations: PersonProjectAllocation[];
}

/** One row of the corporate allocation matrix (person × projects). */
export interface AllocationMatrixRow {
  person: Person;
  /** projectId -> Σ % in the reference month */
  byProject: Record<string, number>;
  totalPct: number;
  /** 100 − totalPct (negative = overload) */
  freePct: number;
  /** capacity hours in the month after leaves */
  capacityHours: number;
  onLeave: boolean;
}

/** Planned × reported × approved hours of a project in a month. */
export interface TimesheetReconciliation {
  projectId: string;
  month: string; // YYYY-MM
  plannedHours: number;
  reportedHours: number;
  approvedHours: number;
  pendingHours: number;
  /** reported ÷ planned (null when nothing planned) */
  executionRatio: number | null;
}

/* ─────────────────────────── Helpers ────────────────────────── */

export const ALLOCATION_TYPE_LABELS: Record<AllocationType, string> = {
  billable: 'Faturável',
  non_billable: 'Não faturável',
  overhead: 'Overhead',
  bench: 'Bench',
  training: 'Treinamento',
};

export const ALLOCATION_STATUS_LABELS: Record<AllocationStatus, string> = {
  draft: 'Rascunho',
  pending_approval: 'Aguardando aprovação',
  active: 'Ativa',
  ended: 'Encerrada',
  cancelled: 'Cancelada',
  rejected: 'Rejeitada',
};

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  vacation: 'Férias',
  medical: 'Afastamento médico',
  parental: 'Licença parental',
  unpaid: 'Licença não remunerada',
  training: 'Treinamento',
  other: 'Outro',
};

export const TIME_ENTRY_STATUS_LABELS: Record<TimeEntryStatus, string> = {
  draft: 'Rascunho',
  submitted: 'Enviado',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
  locked: 'Travado',
};

export const EXCEPTION_FLAG_LABELS: Record<TimesheetExceptionFlag, string> = {
  no_active_allocation: 'Sem alocação ativa',
  time_overlap: 'Sobreposição de horários',
  over_capacity: 'Acima da capacidade diária',
  over_planned: 'Acima do planejado',
};

export const CONTRACT_TYPE_LABELS: Record<PersonContractType, string> = {
  clt: 'CLT',
  pj: 'PJ',
  estagio: 'Estágio',
  temporario: 'Temporário',
  outro: 'Outro',
};
