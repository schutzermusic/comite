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
  PayrollAttachment,
  PayrollAttachmentFileType,
  PayrollClosingBatch,
  PayrollClosingBatchApproved,
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
}

export interface AuditInput {
  entity_type: string;
  entity_id: string;
  action: string;
  metadata?: Record<string, unknown>;
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
  sendToFinance(actor: RepoActor, id: string): Promise<SendToFinanceResult>;

  /** Returns approved/sent_to_finance batches enriched with headcount and cost-center summaries. */
  listApprovedBatches(actor: RepoActor): Promise<PayrollClosingBatchApproved[]>;

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
