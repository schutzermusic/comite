/**
 * Payroll closing domain — the automated "Fechamento da Folha" workflow that
 * lives under Pessoas & Custos. This is a SEPARATE domain from the existing
 * `PayrollBatch` / `PayrollAllocation` in `finance.ts`: HR drives the import,
 * parsing, AI narrative, attachment packaging and e-mail dispatch here, and on
 * approval this feeds the EXISTING `PayrollBatch` consumed by
 * Financeiro > Folha & Alocação (which is the only place that posts to the
 * ledger). See [[payroll-closing-store]] and the plan.
 *
 * Invariants:
 * - The uploaded spreadsheet is the SOURCE OF TRUTH for every number.
 * - AI generates narrative only and never invents values.
 * - A closing batch creates a `PayrollClosingBatch`, never a `LedgerEntry`.
 * - Each `PayrollClosingBatch` may generate at most ONE finance `PayrollBatch`
 *   (anti-duplication guard via `finance_batch_id`).
 */

// ── Enums (string unions) ───────────────────────────────────

export type PayrollImportFileType =
  | 'payroll_spreadsheet'
  | 'bank_payment_spreadsheet'
  | 'holerite'
  | 'external_holerite'
  | 'supporting_document';

export type PayrollClosingStatus =
  | 'imported'
  | 'validated'
  | 'reviewed'
  | 'approved'
  | 'sent_to_finance'
  | 'posted'
  | 'cancelled';

export type PayrollAttachmentFileType =
  | 'executive_pdf'
  | 'dashboard_snapshot'
  | 'payroll_spreadsheet'
  | 'bank_payment_spreadsheet'
  | 'remittance_file'
  | 'holerite'
  | 'external_holerite'
  | 'esocial'
  | 'tax_guide'
  | 'supporting_document'
  | 'other';

export type PayrollSecurityLevel =
  | 'aggregate'
  | 'confidential'
  | 'finance_restricted'
  | 'hr_restricted'
  | 'board_confidential';

export type PayrollReportType =
  | 'executive_email'
  | 'finance_email'
  | 'hr_email'
  | 'executive_pdf'
  | 'board_summary'
  | 'whatsapp'
  | 'detailed';

export type PayrollReportStatus = 'draft' | 'reviewed' | 'approved' | 'sent';

export type PayrollEmailAudience = 'board' | 'finance' | 'hr' | 'custom';

export type PayrollEmailPackageStatus =
  | 'draft'
  | 'reviewed'
  | 'approved'
  | 'sent'
  | 'failed';

export type PayrollDeliveryStatus =
  | 'pending'
  | 'sent'
  | 'failed'
  | 'simulated';

export type PayrollValidationSeverity = 'info' | 'warning' | 'error';

// ── Core entities ───────────────────────────────────────────

export interface PayrollImportFile {
  id: string;
  batch_id: string;
  file_name: string;
  file_type: PayrollImportFileType;
  /** Simulated path in mock mode (e.g. `mock://payroll/<batch>/<file>`). */
  storage_path: string;
  mime_type: string;
  file_size: number;
  /** Cheap content checksum (length+name based in mock mode). */
  checksum: string;
  uploaded_by: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface PayrollClosingBatch {
  id: string;
  organization_id: string;
  /** Competence month YYYY-MM. */
  competence_month: string;
  total_amount_cents: number;
  previous_month_amount_cents: number;
  variation_amount_cents: number;
  variation_percentage: number;
  /** ISO date the payment must clear. */
  payment_deadline?: string;
  status: PayrollClosingStatus;
  created_by: string;
  approved_by?: string;
  created_at: string;
  updated_at: string;
  /**
   * Anti-duplication guard: id of the finance `PayrollBatch` created when this
   * closing was sent to finance. Once set, `sendToFinance` refuses to run again.
   */
  finance_batch_id?: string;
  // ── Soft-delete / lifecycle bookkeeping (migration 023) ──
  /** Set when the closing was cancelled (soft-deleted). */
  deleted_at?: string;
  deleted_by?: string;
  cancellation_reason?: string;
  /** Last reopen (approved/sent_to_finance/cancelled → editable). */
  reopened_at?: string;
  reopened_by?: string;
}

export interface PayrollAttachment {
  id: string;
  batch_id: string;
  file_name: string;
  file_type: PayrollAttachmentFileType;
  security_level: PayrollSecurityLevel;
  storage_path: string;
  file_size: number;
  mime_type: string;
  checksum: string;
  uploaded_by: string;
  approved_by?: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface PayrollGeneratedReport {
  id: string;
  batch_id: string;
  report_type: PayrollReportType;
  generated_text: string;
  generated_html: string;
  status: PayrollReportStatus;
  generated_by_ai: boolean;
  reviewed_by?: string;
  approved_by?: string;
  created_at: string;
  updated_at: string;
}

export interface PayrollEmailPackage {
  id: string;
  batch_id: string;
  audience: PayrollEmailAudience;
  subject: string;
  html_body: string;
  attachment_ids: string[];
  status: PayrollEmailPackageStatus;
  created_by: string;
  approved_by?: string;
  sent_by?: string;
  sent_at?: string;
}

export interface PayrollEmailDispatch {
  id: string;
  package_id: string;
  recipients: string[];
  cc: string[];
  bcc: string[];
  delivery_status: PayrollDeliveryStatus;
  provider_message_id?: string;
  error_message?: string;
  /** Exactly which files left the building — file_name + size, for the audit. */
  attachments_sent: Array<{ file_name: string; file_size: number }>;
  created_at: string;
  sent_at?: string;
}

// ── Parser / validation intermediate shapes ─────────────────

export interface PayrollCostCenterTotal {
  cost_center_label: string;
  /** Matched id in the finance cost-center reference, if any. */
  cost_center_id?: string;
  amount_cents: number;
  previous_amount_cents?: number;
  variation_amount_cents?: number;
  variation_percentage?: number;
  /** How `cost_center_id` was resolved (auto-match / alias / manual). */
  match_method?: CostCenterMatchMethod;
  /** Confidence of the match in [0,1] (1 = exact / explicit alias / manual). */
  match_confidence?: number;
}

/**
 * Strategy that resolved an imported payroll cost-center name to a Finance
 * `cost_center_id`. Ordered loosely from strongest to weakest signal — see
 * `matchCostCenter` in `cost-center-mapping.ts`.
 */
export type CostCenterMatchMethod =
  | 'manual'            // user picked it in the dropdown
  | 'alias'             // saved PayrollCostCenterMapping for this org
  | 'exact'             // name/code identical
  | 'case_insensitive'
  | 'accent_insensitive'
  | 'normalized'        // equal after removing accents + punctuation
  | 'fuzzy'             // bigram (Dice) similarity above threshold
  | 'none';             // unmatched

/**
 * Persisted alias linking an imported payroll cost-center name to a Finance
 * cost center, so future imports of the same name auto-match. The `normalized_name`
 * is the lookup key (see `normalizeCostCenterName`); `imported_name` keeps the
 * original spelling for display/audit. See [[payroll-closing-store]].
 */
export interface PayrollCostCenterMapping {
  id: string;
  organization_id: string;
  imported_name: string;
  normalized_name: string;
  cost_center_id: string;
  /** Confidence at the time the mapping was saved (1 when set by a human). */
  confidence: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

/**
 * One line of the Finance handoff payload. When a closing is sent to
 * Financeiro > Folha & Alocação, each mapped cost center carries exactly this:
 * the original imported name, the resolved Finance `cost_center_id`, the amount,
 * the competence and the originating finance `payroll_batch_id`.
 */
export interface PayrollFinanceHandoffLine {
  imported_name: string;
  cost_center_id: string | null;
  amount_cents: number;
  competence_month: string;
  payroll_batch_id: string;
}

export interface PayrollEmployeeLine {
  employee_name: string;
  cost_center_label?: string;
  contract_type?: 'CLT' | 'PJ' | 'other';
  gross_amount_cents: number;
  net_amount_cents?: number;
}

export interface PayrollBankLine {
  beneficiary: string;
  bank?: string;
  branch?: string;
  account?: string;
  amount_cents: number;
}

export interface PayrollValidationFlag {
  severity: PayrollValidationSeverity;
  code: string;
  message: string;
}

export interface PayrollComparisonRow {
  label: string;
  current_cents: number;
  previous_cents: number;
  variation_cents: number;
  variation_percentage: number;
}

export interface PayrollComparison {
  current_total_cents: number;
  previous_total_cents: number;
  variation_cents: number;
  variation_percentage: number;
  top_increases: PayrollComparisonRow[];
  top_decreases: PayrollComparisonRow[];
}

/**
 * Deterministic output of the SheetJS parser. This — and only this — is what
 * the AI narrative is allowed to read. No raw spreadsheet ever reaches the model.
 */
export interface PayrollParseResult {
  competence_month: string;
  total_amount_cents: number;
  previous_month_amount_cents: number;
  variation_amount_cents: number;
  variation_percentage: number;
  /** Split of the loaded cost when the workbook provides it. */
  gross_amount_cents?: number;
  charges_amount_cents?: number;
  benefits_amount_cents?: number;
  headcount?: number;
  clt_count?: number;
  pj_count?: number;
  payment_deadline?: string;
  cost_centers: PayrollCostCenterTotal[];
  employees: PayrollEmployeeLine[];
  bank_lines: PayrollBankLine[];
  comparison: PayrollComparison;
  flags: PayrollValidationFlag[];
  /** Sheet names detected in the workbook, for transparency in the UI. */
  detected_sheets: string[];
  /** True when the grand total reconciles with the sum of parts. */
  reconciled: boolean;
}

// ── AI narrative shape (returned by the analyze route) ──────

export interface PayrollNarrative {
  executive_summary: string;
  closing_email: string;
  board_summary: string;
  finance_email: string;
  hr_validation: string;
  top_increases: string[];
  top_decreases: string[];
  cost_center_highlights: string[];
  anomalies: string[];
  attention_points: string[];
  recommendations: string[];
  conclusion: string;
  /** True when produced by Claude; false when the deterministic fallback ran. */
  generated_by_ai: boolean;
}

// ── Approved batch with summaries (used by Pessoas & Custos overview) ─────────

export interface PayrollCostCenterSummary {
  cost_center_label: string;
  matched_cost_center_id?: string | null;
  amount_cents: number;
  previous_amount_cents?: number | null;
  variation_amount_cents?: number | null;
  variation_percentage?: number | null;
}

/**
 * Enriched closing batch returned by listApprovedBatches — includes headcount
 * and cost-center summaries for the Pessoas & Custos workforce overview adapter.
 */
export interface PayrollClosingBatchApproved extends PayrollClosingBatch {
  headcount: number;
  cost_center_summaries: PayrollCostCenterSummary[];
}

// ── E-mail package presets (UI) ─────────────────────────────

export interface PayrollPackagePreset {
  audience: PayrollEmailAudience;
  label: string;
  description: string;
  /** Attachment file types included by default in this preset. */
  default_file_types: PayrollAttachmentFileType[];
  /** Highest sensitivity this preset is allowed to carry. */
  max_security_level: PayrollSecurityLevel;
}
