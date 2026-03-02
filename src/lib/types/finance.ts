// ============================================================
// Finance Module — Canonical Type Definitions
// ============================================================

export type ManagementGroupKey = 'revenue' | 'cogs' | 'opex' | 'financial' | 'taxes';
export type CostCenterType = 'direct' | 'indirect' | 'admin';
export type LedgerEntryType = 'actual' | 'budget' | 'forecast' | 'adjustment';
export type LedgerEntryStatus = 'draft' | 'in_review' | 'approved' | 'posted' | 'reconciled' | 'void';
export type PayrollBatchStatus = 'draft' | 'approved' | 'posted';
export type AllocationMethod = 'fixed_pct' | 'headcount' | 'revenue' | 'timesheet_hh';
export type AllocationRuleStatus = 'draft' | 'active' | 'archived';
export type AllocationResultStatus = 'preview' | 'posted' | 'reversed';
export type APARType = 'payable' | 'receivable';
export type APARStatus = 'open' | 'partial' | 'paid' | 'overdue' | 'cancelled';
export type PeriodCloseStatus = 'open' | 'soft_close' | 'closed';
export type IngestionBatchStatus = 'running' | 'completed' | 'failed';
export type SourceSystem = 'manual' | 'sankhya' | 'payroll_alloc' | 'other';

export type FinanceAuditAction =
  | 'created' | 'updated' | 'status_changed'
  | 'approved' | 'voided' | 'closed'
  | 'submitted' | 'posted' | 'reversed';

export type ReasonCode =
  | 'correction' | 'late_invoice' | 'reclassification'
  | 'period_adjustment' | 'void_duplicate' | 'void_error'
  | 'approval_override';

export type FinanceRole =
  | 'finance_admin' | 'finance_analyst' | 'project_manager'
  | 'approver' | 'auditor' | 'executive_readonly';

// ============================================================
// Entities
// ============================================================

export interface BusinessUnit {
  id: string;
  code: string;
  name: string;
  cnpj?: string;
  uf: string;
  city?: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CostCenter {
  id: string;
  code: string;
  name: string;
  business_unit_id: string;
  parent_id?: string;
  type: CostCenterType;
  active: boolean;
  created_at: string;
  updated_at: string;
  business_unit?: BusinessUnit;
}

export interface ManagementCategory {
  id: string;
  code: string;
  name: string;
  level: 1 | 2 | 3;
  parent_id?: string;
  group_key: ManagementGroupKey;
  sign: 1 | -1;
  requires_project: boolean;
  active: boolean;
  children?: ManagementCategory[];
  parent?: ManagementCategory;
}

export interface Supplier {
  id: string;
  name: string;
  cpf_cnpj?: string;
  category?: string;
  uf?: string;
  active: boolean;
  source_system: string;
  external_key?: string;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: string;
  name: string;
  cnpj?: string;
  segment?: string;
  active: boolean;
  source_system: string;
  external_key?: string;
  created_at: string;
  updated_at: string;
}

export interface LedgerEntry {
  id: string;
  entry_date: string;
  description: string;
  amount_cents: number;
  currency: string;
  category_id: string;
  cost_center_id: string;
  project_id?: string;
  contract_id?: string;
  supplier_id?: string;
  client_id?: string;
  business_unit_id: string;
  period_key: string;
  entry_type: LedgerEntryType;
  status: LedgerEntryStatus;
  source_system: SourceSystem;
  source_ref?: string;
  external_key?: string;
  ingestion_batch_id?: string;
  payroll_batch_id?: string;
  allocation_result_id?: string;
  parent_entry_id?: string;
  evidence_required: boolean;
  evidence_provided: boolean;
  template_key?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  created_by: string;
  approved_by?: string;
  approved_at?: string;
  posted_by?: string;
  posted_at?: string;
  voided_by?: string;
  voided_at?: string;
  void_reason?: string;
  created_at: string;
  updated_at: string;
  // Joined fields for display
  category?: ManagementCategory;
  cost_center?: CostCenter;
  business_unit?: BusinessUnit;
  supplier?: Supplier;
  project_name?: string;
  contract_name?: string;
  attachments?: Attachment[];
}

export interface PayrollBatch {
  id: string;
  period_key: string;
  business_unit_id: string;
  total_gross_cents: number;
  total_charges_cents: number;
  total_benefits_cents: number;
  headcount: number;
  status: PayrollBatchStatus;
  evidence_url?: string;
  notes?: string;
  source_system: string;
  created_by: string;
  approved_by?: string;
  approved_at?: string;
  created_at: string;
  updated_at: string;
  business_unit?: BusinessUnit;
}

export interface AllocationRuleTarget {
  target_project_id: string;
  target_project_name?: string;
  target_cc_id: string;
  target_cc_name?: string;
  weight: number;
}

export interface AllocationRule {
  id: string;
  name: string;
  version: number;
  cost_center_id: string;
  method: AllocationMethod;
  rules_json: AllocationRuleTarget[];
  effective_from: string;
  effective_to?: string;
  status: AllocationRuleStatus;
  created_by: string;
  approved_by?: string;
  created_at: string;
  updated_at: string;
  cost_center?: CostCenter;
}

export interface AllocationResultEntry {
  target_project_id: string;
  target_project_name: string;
  target_cc_id: string;
  target_cc_name: string;
  amount_cents: number;
  weight_pct: number;
}

export interface AllocationResult {
  id: string;
  rule_id: string;
  period_key: string;
  payroll_batch_id?: string;
  source_amount_cents: number;
  result_entries: AllocationResultEntry[];
  status: AllocationResultStatus;
  posted_at?: string;
  reversed_at?: string;
  reverse_reason?: string;
  created_by: string;
  created_at: string;
  rule?: AllocationRule;
}

export interface APARTitle {
  id: string;
  type: APARType;
  title_number: string;
  supplier_id?: string;
  client_id?: string;
  contract_id?: string;
  project_id?: string;
  issue_date: string;
  due_date: string;
  amount_cents: number;
  paid_amount_cents: number;
  status: APARStatus;
  linked_entry_id?: string;
  source_system: string;
  external_key?: string;
  notes?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  supplier?: Supplier;
  client?: Client;
}

export interface Attachment {
  id: string;
  entity_type: 'ledger_entry' | 'payroll_batch' | 'apar_title';
  entity_id: string;
  file_name: string;
  file_url: string;
  file_size_bytes?: number;
  mime_type?: string;
  uploaded_by: string;
  created_at: string;
}

export interface PeriodClose {
  id: string;
  period_key: string;
  status: PeriodCloseStatus;
  soft_closed_at?: string;
  closed_at?: string;
  closed_by?: string;
  snapshot_json?: PnLSnapshot;
  notes?: string;
}

export interface PnLSnapshot {
  revenue: number;
  cogs: number;
  gross_margin: number;
  opex: number;
  operating_result: number;
  financial: number;
  taxes: number;
  net_result: number;
  generated_at: string;
}

export interface IngestionBatch {
  id: string;
  source_system: string;
  started_at: string;
  finished_at?: string;
  status: IngestionBatchStatus;
  records_total?: number;
  records_created?: number;
  records_updated?: number;
  records_skipped?: number;
  error_log?: Record<string, unknown>;
}

export interface FinanceAuditLog {
  id: string;
  entity_type: string;
  entity_id: string;
  action: FinanceAuditAction;
  changed_fields?: Record<string, { old: unknown; new: unknown }>;
  reason_code?: ReasonCode;
  reason_text?: string;
  performed_by: string;
  performed_at: string;
  ip_address?: string;
}

export interface CategoryMapping {
  id: string;
  source_system: string;
  source_account_code: string;
  source_account_name?: string;
  management_category_id: string;
  confidence?: number;
  active: boolean;
  notes?: string;
  management_category?: ManagementCategory;
}

// ============================================================
// Template definitions
// ============================================================

export interface EntryTemplate {
  key: string;
  label: string;
  category_code: string;
  default_fields: Partial<LedgerEntry>;
  extra_fields: { key: string; label: string; type: 'text' | 'number' | 'date' | 'select'; required?: boolean; options?: string[] }[];
}

// ============================================================
// Dashboard aggregation types
// ============================================================

export interface PnLRow {
  group_key: ManagementGroupKey;
  group_label: string;
  actual: number;
  budget: number;
  forecast: number;
  variance_abs: number;
  variance_pct: number;
}

export interface CostStackMonth {
  period_key: string;
  revenue: number;
  cogs: number;
  opex: number;
  financial: number;
  taxes: number;
}

export interface ProjectMargin {
  project_id: string;
  project_name: string;
  revenue: number;
  cogs: number;
  margin_pct: number;
}

export interface DataQualityIndicator {
  key: string;
  label: string;
  value: number;
  threshold_green: number;
  threshold_yellow: number;
  status: 'green' | 'yellow' | 'red';
}

export interface AgingBucket {
  label: string;
  payable: number;
  receivable: number;
}

export interface TopDriver {
  rank: number;
  category_id: string;
  category_name: string;
  group_key: ManagementGroupKey;
  group_label: string;
  project_id?: string;
  project_name?: string;
  actual: number;
  budget: number;
  variance_abs: number;
  variance_pct: number;
  contribution_pct: number;
}

export interface PendingAction {
  id: string;
  description: string;
  category_name: string;
  period_key: string;
  amount_cents: number;
  aging_days: number;
  created_by: string;
  status: LedgerEntryStatus;
}

// ============================================================
// Finance global filter state
// ============================================================

export interface FinanceFilters {
  period_from: string;
  period_to: string;
  project_ids: string[];
  contract_ids: string[];
  business_unit_ids: string[];
  cost_center_ids: string[];
  uf_list: string[];
  entry_type: LedgerEntryType | 'all';
}

export const DEFAULT_FINANCE_FILTERS: FinanceFilters = {
  period_from: new Date().toISOString().slice(0, 7),
  period_to: new Date().toISOString().slice(0, 7),
  project_ids: [],
  contract_ids: [],
  business_unit_ids: [],
  cost_center_ids: [],
  uf_list: [],
  entry_type: 'actual',
};
