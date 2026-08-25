/**
 * Project timeline / enterprise schedule types (migration 032).
 *
 * Mirrors project_schedule_imports, project_timeline_items,
 * project_timeline_dependencies, project_timeline_assignments,
 * project_timeline_comments and project_delay_logs, plus the
 * MS Project import pipeline shapes (parser → preview → diff).
 */

export type TimelineItemType =
  | 'phase'
  | 'milestone'
  | 'deliverable'
  | 'task'
  | 'meeting'
  | 'decision'
  | 'document'
  | 'risk_event'
  | 'financial_event'
  | 'contract_event';

export type TimelineItemStatus =
  | 'not_started'
  | 'in_progress'
  | 'blocked'
  | 'delayed'
  | 'completed'
  | 'cancelled';

export type DelayStatus = 'on_track' | 'at_risk' | 'delayed' | 'blocked';

export type DelayReasonCategory =
  | 'material_delay'
  | 'logistics_delay'
  | 'manpower_delay'
  | 'client_dependency'
  | 'technical_issue'
  | 'supplier_delay'
  | 'safety_compliance'
  | 'weather_external'
  | 'financial_payment'
  | 'other';

export type AssignmentRole = 'responsible' | 'executor' | 'reviewer' | 'approver';

export type ScheduleSourceType = 'ms_project_pdf' | 'csv' | 'xlsx' | 'xml' | 'manual';

export const TIMELINE_STATUS_LABELS: Record<TimelineItemStatus, string> = {
  not_started: 'Não iniciada',
  in_progress: 'Em andamento',
  blocked: 'Bloqueada',
  delayed: 'Atrasada',
  completed: 'Concluída',
  cancelled: 'Cancelada',
};

export const TIMELINE_TYPE_LABELS: Record<TimelineItemType, string> = {
  phase: 'Fase',
  milestone: 'Marco',
  deliverable: 'Entregável',
  task: 'Tarefa',
  meeting: 'Reunião',
  decision: 'Decisão',
  document: 'Documento',
  risk_event: 'Evento de risco',
  financial_event: 'Evento financeiro',
  contract_event: 'Evento contratual',
};

export const DELAY_STATUS_LABELS: Record<DelayStatus, string> = {
  on_track: 'No prazo',
  at_risk: 'Em risco',
  delayed: 'Atrasada',
  blocked: 'Bloqueada',
};

export const DELAY_REASON_LABELS: Record<DelayReasonCategory, string> = {
  material_delay: 'Atraso de material',
  logistics_delay: 'Atraso logístico',
  manpower_delay: 'Atraso de mão de obra',
  client_dependency: 'Dependência do cliente',
  technical_issue: 'Problema técnico',
  supplier_delay: 'Atraso de fornecedor',
  safety_compliance: 'Segurança / compliance',
  weather_external: 'Clima / fator externo',
  financial_payment: 'Financeiro / pagamento',
  other: 'Outro',
};

/** Original MS Project strings kept verbatim for audit. */
export interface RawImportValues {
  original_task_name?: string;
  original_start_raw?: string;
  original_finish_raw?: string;
  original_duration_raw?: string;
  original_percent_raw?: string;
  original_wbs_code?: string;
}

export interface TimelineAssignment {
  id: string;
  organizationId: string;
  projectId: string;
  timelineItemId: string;
  userId: string;
  role: AssignmentRole;
  assignedBy: string | null;
  assignedAt: Date;
  removedAt: Date | null;
  /** Hydrated from list_organization_members for display. */
  userName?: string | null;
  userEmail?: string | null;
  avatarUrl?: string | null;
}

export interface TimelineItem {
  id: string;
  organizationId: string;
  projectId: string;
  parentId: string | null;
  importBatchId: string | null;
  originalMsProjectId: string | null;
  wbsCode: string | null;
  outlineLevel: number;
  rowOrder: number;
  type: TimelineItemType;
  title: string;
  description: string | null;
  plannedStart: string | null; // ISO date (yyyy-MM-dd)
  plannedFinish: string | null;
  actualStart: string | null;
  actualFinish: string | null;
  forecastStart: string | null;
  forecastFinish: string | null;
  durationMinutes: number | null;
  percentComplete: number;
  status: TimelineItemStatus;
  priority: 'low' | 'medium' | 'high' | 'critical';
  responsibleUserId: string | null;
  delayStatus: DelayStatus;
  delayReasonCategory: DelayReasonCategory | null;
  delayReasonText: string | null;
  delayImpactText: string | null;
  recoveryPlanText: string | null;
  relatedAgendaTaskId: string | null;
  relatedMeetingId: string | null;
  relatedRiskId: string | null;
  relatedContractId: string | null;
  relatedDocumentId: string | null;
  isSummary: boolean;
  isMilestone: boolean;
  isActive: boolean;
  rawImport: RawImportValues | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  /** Active assignments (removed_at IS NULL), hydrated by the service. */
  assignments?: TimelineAssignment[];
}

export interface NewTimelineItemInput {
  projectId: string;
  parentId?: string | null;
  wbsCode?: string | null;
  type?: TimelineItemType;
  title: string;
  description?: string | null;
  plannedStart?: string | null;
  plannedFinish?: string | null;
  durationMinutes?: number | null;
  percentComplete?: number;
  status?: TimelineItemStatus;
  priority?: TimelineItem['priority'];
  responsibleUserId?: string | null;
  isMilestone?: boolean;
}

/* ───────────────────── Dependências (migration 032) ───────────────────── */

export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

export const DEPENDENCY_TYPE_LABELS: Record<DependencyType, string> = {
  FS: 'Término → Início',
  SS: 'Início → Início',
  FF: 'Término → Término',
  SF: 'Início → Término',
};

/** Abreviação usada nos chips do drawer, no padrão MS Project. */
export const DEPENDENCY_TYPE_SHORT: Record<DependencyType, string> = {
  FS: 'TI',
  SS: 'II',
  FF: 'TT',
  SF: 'IT',
};

/**
 * Espelha project_timeline_dependencies. A tabela NÃO tem updated_at nem
 * created_by — não inventar colunas aqui.
 */
export interface TimelineDependency {
  id: string;
  organizationId: string;
  projectId: string;
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  lagMinutes: number;
  createdAt: Date;
}

export interface NewDependencyInput {
  projectId: string;
  predecessorId: string;
  successorId: string;
  type?: DependencyType;
  lagMinutes?: number;
}

export interface TimelineComment {
  id: string;
  organizationId: string;
  projectId: string;
  timelineItemId: string;
  authorUserId: string;
  body: string;
  createdAt: Date;
  authorName?: string | null;
}

export interface DelayLog {
  id: string;
  organizationId: string;
  projectId: string;
  timelineItemId: string;
  reportedBy: string | null;
  oldStatus: string | null;
  newStatus: string | null;
  reasonCategory: DelayReasonCategory | null;
  reasonText: string | null;
  impactText: string | null;
  recoveryPlanText: string | null;
  supportNeededText: string | null;
  contractImpact: boolean;
  oldForecastFinish: string | null;
  newForecastFinish: string | null;
  createdAt: Date;
  reporterName?: string | null;
}

export interface DelayReportInput {
  newStatus: Extract<TimelineItemStatus, 'delayed' | 'blocked'>;
  reasonCategory: DelayReasonCategory;
  reasonText: string;
  impactText: string;
  recoveryPlanText: string;
  newForecastFinish: string; // ISO date
  supportNeededText?: string;
  contractImpact?: boolean;
}

export interface ScheduleImport {
  id: string;
  organizationId: string;
  projectId: string;
  sourceFileName: string | null;
  sourceFilePath: string | null;
  sourceFileHash: string;
  sourceType: ScheduleSourceType;
  scheduleVersion: number;
  importedBy: string | null;
  importedAt: Date;
  parseStatus: 'completed' | 'completed_with_warnings' | 'failed';
  parserUsed: 'deterministic' | 'ai' | 'manual';
  parseSummary: Record<string, unknown>;
  warnings: string[];
}

/* ───────────── Import pipeline (parser → preview → diff) ───────────── */

/** One schedule row as parsed from the MS Project PDF. */
export interface ParsedScheduleRow {
  /** MS Project "Id" column (row number). */
  msProjectId: string;
  /** "EDT" / WBS code, e.g. "2.3.11.1". Root row is "0". */
  wbsCode: string;
  title: string;
  /** Normalized values (null when unparseable — never invented). */
  percentComplete: number | null;
  durationMinutes: number | null;
  plannedStart: string | null; // ISO yyyy-MM-dd
  plannedFinish: string | null;
  outlineLevel: number;
  rowOrder: number;
  isSummary: boolean;
  isMilestone: boolean;
  /** Raw strings exactly as printed in the PDF (audit). */
  raw: RawImportValues;
  /** Validation issues attached to this row. */
  issues: string[];
}

export interface ParseStats {
  totalRows: number;
  tasks: number;
  phases: number;
  milestones: number;
  rowsWithIssues: number;
}

export interface ParsePreview {
  rows: ParsedScheduleRow[];
  warnings: string[];
  stats: ParseStats;
  fileHash: string;
  fileName: string;
  parserUsed: 'deterministic' | 'ai';
  /** Diff vs. the project's current timeline (empty timeline → all added). */
  diff: ImportDiffSummary;
}

export interface ImportFieldChange {
  field: string;
  before: string | null;
  after: string | null;
}

export interface ImportRowMatch {
  /** Existing item id (null for added rows). */
  existingItemId: string | null;
  wbsCode: string;
  title: string;
  changes: ImportFieldChange[];
}

export interface ImportDiffSummary {
  added: ImportRowMatch[];
  updated: ImportRowMatch[];
  unchanged: ImportRowMatch[];
  /** Import-sourced items not found in the new file (soft-deactivated on update). */
  removed: { existingItemId: string; wbsCode: string | null; title: string }[];
}

export interface ConfirmImportPayload {
  rows: ParsedScheduleRow[];
  fileHash: string;
  fileName: string;
  /** Storage path of the uploaded PDF (project-files bucket). */
  filePath: string | null;
  mode: 'new' | 'update';
  parserUsed: 'deterministic' | 'ai';
  warnings: string[];
}

export interface ConfirmImportResult {
  ok: boolean;
  importId: string;
  scheduleVersion: number;
  inserted: number;
  updated: number;
  deactivated: number;
}
