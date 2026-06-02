/**
 * Payroll closing repository abstraction.
 *
 * Two implementations back this interface:
 *  - SupabasePayrollRepository (server-only): real Postgres + Storage + audit.
 *  - InMemoryServerRepository (server): process-lifetime mock for API testing
 *    without a database.
 *
 * Selected by PAYROLL_CLOSING_REPOSITORY_MODE = 'mock' | 'supabase'.
 *
 * The CLIENT page selects its data source separately via the client facade
 * (closing-client.ts): in 'mock' mode it uses the in-memory client store
 * directly (no network); in 'supabase' mode it calls the API routes that are
 * backed by this repository.
 */

import type {
  CostCenterMatchMethod,
  PayrollAttachment,
  PayrollAttachmentFileType,
  PayrollClosingBatch,
  PayrollClosingBatchApproved,
  PayrollCostCenterMapping,
  PayrollEmailAudience,
  PayrollEmailDispatch,
  PayrollEmailPackage,
  PayrollGeneratedReport,
  PayrollImportFile,
  PayrollImportFileType,
  PayrollParseResult,
  PayrollReportType,
  PayrollSecurityLevel,
} from '@/lib/types/payroll-closing';

export type { PayrollCostCenterMapping };

export type { PayrollClosingBatchApproved };

export type PayrollRepositoryMode = 'mock' | 'supabase';

/** Identity resolved by the API route (auth + tenant). */
export interface RepoActor {
  userId: string;
  organizationId: string;
}

export interface CreateBatchInput {
  competence_month: string;
  payment_deadline?: string;
}

export interface UploadFileInput {
  bytes: Buffer;
  file_name: string;
  file_type: PayrollImportFileType;
  mime_type: string;
}

export interface GeneratedAttachmentInput {
  file_name: string;
  file_type: PayrollAttachmentFileType;
  mime_type: string;
  bytes: Buffer;
  security_level?: PayrollSecurityLevel;
}

export interface SaveReportInput {
  report_type: PayrollReportType;
  generated_text: string;
  generated_html: string;
  generated_by_ai: boolean;
}

export interface CreatePackageInput {
  audience: PayrollEmailAudience;
  subject: string;
  html_body: string;
  attachment_ids: string[];
}

export interface RecordDispatchInput {
  package_id: string;
  recipients: string[];
  cc?: string[];
  bcc?: string[];
  delivery_status: PayrollEmailDispatch['delivery_status'];
  provider_message_id?: string;
  error_message?: string;
  attachments_sent: Array<{ file_name: string; file_size: number }>;
}

export interface AttachmentBytes {
  bytes: Buffer;
  file_name: string;
  mime_type: string;
  file_size: number;
  security_level: PayrollSecurityLevel;
  file_type: PayrollAttachmentFileType;
}

export interface SendToFinanceResult {
  ok: boolean;
  batch?: PayrollClosingBatch;
  finance_batch_id?: string;
  error?: string;
  /** Machine-readable failure reason (e.g. 'unmapped_cost_centers'). */
  code?: string;
  /** When blocked by unmapped centers, how many were missing a cost_center_id. */
  unmapped_count?: number;
}

/** Options for sendToFinance — carries the unmapped-center override decision. */
export interface SendToFinanceOptions {
  /**
   * Proceed even when some cost centers are unmapped. The API route is
   * responsible for verifying the actor is admin or holds
   * `people.payroll_override_mapping` BEFORE setting this — the repository
   * trusts that gate and only records the override in the audit log.
   */
  override?: boolean;
  /** Free-text justification, logged with the override audit entry. */
  overrideReason?: string;
}

/**
 * Org-scoped Finance cost center (finance_cost_centers table). The payroll
 * mapping resolves imported names to one of these uuid ids — never a client
 * 'cc-*' id — so payroll_cost_center_summaries.matched_cost_center_id is always
 * a valid uuid.
 */
export interface FinanceCostCenterRecord {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateFinanceCostCenterInput {
  name: string;
  code?: string;
}

/** Upsert payload for a cost-center alias (keyed by normalized_name per org). */
export interface UpsertCostCenterMappingInput {
  imported_name: string;
  normalized_name: string;
  cost_center_id: string;
  confidence?: number;
  match_method?: CostCenterMatchMethod;
}

/**
 * Persisted Finance `payroll_batch` row mapped to the domain shape consumed by
 * Financeiro > Folha & Alocação. Structurally compatible with the finance
 * `PayrollBatch` type (src/lib/types/finance.ts) so it can be fed straight into
 * the in-memory finance store via injectPayrollBatch without the UI ever seeing
 * a database row. Kept here (instead of importing the finance type) to avoid a
 * hard coupling between the payroll repository and the finance module types.
 */
export interface FinancePayrollBatchRecord {
  id: string;
  period_key: string;
  business_unit_id: string;
  total_gross_cents: number;
  total_charges_cents: number;
  total_benefits_cents: number;
  headcount: number;
  status: 'draft' | 'approved' | 'posted';
  evidence_url?: string;
  notes?: string;
  source_system: string;
  created_by: string;
  approved_by?: string;
  approved_at?: string;
  created_at: string;
  updated_at: string;
}

export interface AuditInput {
  entity_type: string;
  entity_id: string;
  action: string;
  metadata?: Record<string, unknown>;
}

/** Editable fields of a closing batch (only allowed before sent_to_finance). */
export interface UpdateBatchInput {
  competence_month?: string;
  payment_deadline?: string | null;
  notes?: string | null;
}

/** Result of removing one attachment (file_type lets the client react). */
export interface RemoveAttachmentResult {
  ok: boolean;
  file_type?: string;
  /** True when the removed file was the main payroll spreadsheet (parse stale). */
  was_payroll_spreadsheet?: boolean;
  error?: string;
}

export interface DeleteBatchResult {
  ok: boolean;
  error?: string;
}

export interface PayrollRepository {
  readonly mode: PayrollRepositoryMode;

  createClosingBatch(actor: RepoActor, input: CreateBatchInput): Promise<PayrollClosingBatch>;
  getClosingBatch(actor: RepoActor, id: string): Promise<PayrollClosingBatch | null>;
  listClosingBatches(actor: RepoActor): Promise<PayrollClosingBatch[]>;

  addImportFile(actor: RepoActor, batchId: string, input: UploadFileInput): Promise<{ importFile: PayrollImportFile; attachment: PayrollAttachment }>;
  addGeneratedAttachment(actor: RepoActor, batchId: string, input: GeneratedAttachmentInput): Promise<PayrollAttachment>;
  getAttachments(actor: RepoActor, batchId: string): Promise<PayrollAttachment[]>;
  getAttachmentBytes(actor: RepoActor, attachmentId: string): Promise<AttachmentBytes | null>;

  saveParsedPayrollData(actor: RepoActor, batchId: string, parse: PayrollParseResult): Promise<PayrollClosingBatch>;
  saveGeneratedReport(actor: RepoActor, batchId: string, input: SaveReportInput): Promise<PayrollGeneratedReport>;

  createEmailPackage(actor: RepoActor, batchId: string, input: CreatePackageInput): Promise<PayrollEmailPackage>;
  recordDispatch(actor: RepoActor, input: RecordDispatchInput): Promise<PayrollEmailDispatch>;
  getDispatches(actor: RepoActor, batchId: string): Promise<PayrollEmailDispatch[]>;

  approveClosingBatch(actor: RepoActor, id: string): Promise<PayrollClosingBatch>;
  sendToFinance(actor: RepoActor, id: string, options?: SendToFinanceOptions): Promise<SendToFinanceResult>;

  // ── Lifecycle: edit / cancel / reopen / delete ──
  /** Patch editable metadata (competence/deadline/notes). */
  updateClosingBatch(actor: RepoActor, id: string, patch: UpdateBatchInput): Promise<PayrollClosingBatch>;
  /** Soft-delete: status → cancelled + deleted_at/by + reason. Reversible via reopen. */
  cancelClosingBatch(actor: RepoActor, id: string, reason?: string): Promise<PayrollClosingBatch>;
  /** Reopen approved/sent_to_finance/cancelled back to an editable state. */
  reopenClosingBatch(actor: RepoActor, id: string, reason?: string): Promise<PayrollClosingBatch>;
  /** Hard delete: child rows + Storage objects + batch. Blocked when finance_batch_id is set. */
  deleteClosingBatch(actor: RepoActor, id: string): Promise<DeleteBatchResult>;
  /** Remove a single attachment (row + Storage object). */
  removeAttachment(actor: RepoActor, batchId: string, attachmentId: string): Promise<RemoveAttachmentResult>;
  /** Clear parse results + generated reports/attachments and reset to 'imported' (e.g. after replacing the main spreadsheet). */
  invalidateParse(actor: RepoActor, id: string): Promise<PayrollClosingBatch>;

  // ── Finance cost centers (finance_cost_centers) ──
  /** Active Finance cost centers for the org — the mapping dropdown source. */
  listFinanceCostCenters(actor: RepoActor): Promise<FinanceCostCenterRecord[]>;
  /** Create a Finance cost center (used by "Criar centro de custo"). */
  createFinanceCostCenter(actor: RepoActor, input: CreateFinanceCostCenterInput): Promise<FinanceCostCenterRecord>;

  // ── Cost-center mapping aliases (payroll_cost_center_mappings) ──
  /** All saved aliases for the org, newest first. */
  listCostCenterMappings(actor: RepoActor): Promise<PayrollCostCenterMapping[]>;
  /** Upsert one alias (conflict on organization_id + normalized_name). */
  upsertCostCenterMapping(actor: RepoActor, input: UpsertCostCenterMappingInput): Promise<PayrollCostCenterMapping>;
  /** Upsert several aliases in one call (e.g. "Salvar mapeamentos"). */
  saveCostCenterMappings(actor: RepoActor, inputs: UpsertCostCenterMappingInput[]): Promise<PayrollCostCenterMapping[]>;
  /** Delete an alias by id (org-scoped). */
  deleteCostCenterMapping(actor: RepoActor, id: string): Promise<void>;

  /** Returns approved/sent_to_finance batches enriched with headcount and cost-center summaries. */
  listApprovedBatches(actor: RepoActor): Promise<PayrollClosingBatchApproved[]>;

  /**
   * Returns persisted Finance `payroll_batch` rows (manual + payroll_close
   * origin) so Financeiro > Folha & Alocação survives a reload. Read-only — it
   * never creates ledger entries. Optionally scoped to a competence/period.
   */
  listFinancePayrollBatches(actor: RepoActor, filters?: { periodKey?: string }): Promise<FinancePayrollBatchRecord[]>;

  writeAudit(actor: RepoActor, input: AuditInput): Promise<void>;
}

/** Maps an import file type to its attachment classification + bucket. */
export const IMPORT_TYPE_MAP: Record<
  PayrollImportFileType,
  { attachment_type: PayrollAttachmentFileType; security_level: PayrollSecurityLevel; bucket: string }
> = {
  payroll_spreadsheet: { attachment_type: 'payroll_spreadsheet', security_level: 'hr_restricted', bucket: 'payroll-imports' },
  bank_payment_spreadsheet: { attachment_type: 'bank_payment_spreadsheet', security_level: 'finance_restricted', bucket: 'payroll-bank-files' },
  holerite: { attachment_type: 'holerite', security_level: 'confidential', bucket: 'payroll-holerites' },
  external_holerite: { attachment_type: 'external_holerite', security_level: 'confidential', bucket: 'payroll-holerites' },
  supporting_document: { attachment_type: 'supporting_document', security_level: 'aggregate', bucket: 'payroll-supporting-documents' },
};

/** Bucket for generated artifacts (executive PDF / dashboard snapshot). */
export const GENERATED_BUCKET = 'payroll-reports';
