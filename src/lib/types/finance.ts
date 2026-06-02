// ============================================================
// Finance Module — Canonical Type Definitions
// ============================================================

/**
 * P&L groups (revenue..taxes) plus 'clearing' — a non-P&L bucket for cash /
 * treasury / settlement movements that must NOT inflate the managerial DRE.
 * Selectors treat 'clearing' as out-of-P&L (see PNL_GROUP_KEYS / isPnlGroup).
 */
export type ManagementGroupKey = 'revenue' | 'cogs' | 'opex' | 'financial' | 'taxes' | 'clearing';
export type CostCenterType = 'direct' | 'indirect' | 'admin';
export type LedgerEntryType = 'actual' | 'budget' | 'forecast' | 'adjustment';
export type LedgerEntryStatus = 'draft' | 'in_review' | 'approved' | 'posted' | 'reconciled' | 'void';
export type PayrollBatchStatus = 'draft' | 'approved' | 'posted';
export type PayrollAllocationStatus = 'draft' | 'allocated' | 'approved' | 'posted' | 'cancelled';
export type AllocationMethod = 'fixed_pct' | 'headcount' | 'revenue' | 'timesheet_hh';
export type AllocationRuleStatus = 'draft' | 'active' | 'archived';
export type AllocationResultStatus = 'preview' | 'posted' | 'reversed';
/**
 * Project-allocation lifecycle for a ledger entry:
 *  - 'allocated'        → project_id is set (counts toward official project AC)
 *  - 'pending_project'  → no project_id yet but contract_id exists (a pre-project
 *                         cost awaiting allocation once the project is created)
 *  - 'unallocated'      → neither project_id nor contract_id (corporate/overhead)
 * Always derived from project_id/contract_id so it can never drift.
 */
export type LedgerAllocationStatus = 'allocated' | 'pending_project' | 'unallocated';
export type APARType = 'payable' | 'receivable';
export type APARStatus = 'open' | 'partial' | 'paid' | 'overdue' | 'cancelled';
export type TaxType =
  | 'ISS' | 'INSS' | 'IRRF' | 'CSLL' | 'IRPJ' | 'PIS' | 'COFINS'
  | 'ICMS' | 'DIFAL' | 'FGTS' | 'CSRF' | 'OTHER';
export type TaxStatus = 'open' | 'scheduled' | 'paid' | 'partial' | 'overdue' | 'cancelled';
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
  /** Whether a contract_id is required for entries on this category (e.g. revenue). */
  requires_contract?: boolean;
  /** Whether a cost_center_id is required (defaults to true for non-revenue/expense). */
  requires_cost_center?: boolean;
  active: boolean;
  /**
   * Tenant scope. `undefined`/null = global default category (shipped seed,
   * shared across orgs). Set when an org clones/customizes its own taxonomy.
   */
  organization_id?: string;
  /** Convenience alias for the L3 leaf name; mirrors `name` for level-3 rows. */
  subcategory?: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
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

/** Forecast / planning scenario key. 'realized' = actual ledger; others overlay budget/forecast variants. */
export type FinanceScenarioKey =
  | 'realized'
  | 'budget'
  | 'forecast'
  | 'stress'
  | 'optimistic'
  | 'board';

export interface LedgerEntry {
  id: string;
  entry_date: string;
  /** Competence month (YYYY-MM). Defaults to period_key. Lets entries be allocated to a different month than entry_date. */
  competence_month?: string;
  /** Due date for AP/AR-style settlement (YYYY-MM-DD). */
  due_date?: string;
  description: string;
  amount_cents: number;
  currency: string;
  category_id: string;
  /** Optional explicit DRE management line code (e.g. "A.1.1"). Falls back to the category's code. */
  dre_line?: string;
  cost_center_id: string;
  /** Nullable: a cost can be booked before its project exists (see allocation_status). */
  project_id?: string;
  contract_id?: string;
  /**
   * Derived allocation lifecycle (allocated / pending_project / unallocated).
   * Populated on create and recomputed on read so it always matches the
   * project_id/contract_id dimensions. See deriveAllocationStatus in finance-store.
   */
  allocation_status?: LedgerAllocationStatus;
  /** Free-form note about the allocation (e.g. who linked it and why). */
  allocation_notes?: string;
  supplier_id?: string;
  client_id?: string;
  business_unit_id: string;
  /** Bank / GL account code. Optional; for treasury reconciliation. */
  account?: string;
  /** Scenario this entry belongs to. Forecast/stress/optimistic entries are tagged with the corresponding key. */
  scenario?: FinanceScenarioKey;
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
  /** Free-form operator note attached to the entry. */
  notes?: string;
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

/**
 * Payroll allocation — distributes a single employee's fully-loaded payroll
 * cost (gross + employer taxes + benefits) for a competence month onto a
 * project / contract / cost center, so workforce cost lands in the managerial
 * DRE by competence.
 *
 * Accounting: this is a P&L COST recognized at competence (NOT a clearing/cash
 * movement). Posting generates an 'actual' LedgerEntry under a P&L payroll
 * category (COGS direct folha for project work, OPEX indirect folha for
 * structural roles) — never the clearing group used by AP/AR & tax settlements.
 * Future cash payment of the payroll is a separate treasury/clearing concern.
 *
 * `total_cost_cents` is the employee's full loaded cost for the month;
 * `allocated_amount_cents` is the portion directed to this project line
 * (= total_cost_cents * allocation_percentage / 100). The unallocated
 * remainder is structural/idle cost. See [[finance-store.postPayrollAllocation]].
 */
export interface PayrollAllocation {
  id: string;
  employee_id: string;
  employee_name: string;
  department_id: string;
  department_name: string;
  role: string;
  /** Competence month (YYYY-MM) the cost belongs to. */
  competence_month: string;
  /** Source payroll batch this allocation draws from. */
  payroll_batch_id?: string;
  gross_amount_cents: number;
  taxes_amount_cents: number;
  benefits_amount_cents: number;
  /** Fully-loaded monthly cost = gross + taxes + benefits. */
  total_cost_cents: number;
  /** Portion of total_cost_cents directed to this project/CC line. */
  allocated_amount_cents: number;
  /** allocated_amount_cents / total_cost_cents * 100. */
  allocation_percentage: number;
  project_id?: string;
  contract_id?: string;
  cost_center_id?: string;
  business_unit_id?: string;
  status: PayrollAllocationStatus;
  /** P&L LedgerEntry generated when the allocation is posted. */
  linked_entry_id?: string;
  notes?: string;
  source_system?: string;
  created_by: string;
  approved_by?: string;
  approved_at?: string;
  posted_at?: string;
  cancelled_at?: string;
  created_at: string;
  updated_at: string;
  // Joined fields for display
  project_name?: string;
  contract_name?: string;
  cost_center?: CostCenter;
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
  /** Most recent cash LedgerEntry generated by a settlement of this title. */
  linked_entry_id?: string;
  /** Full settlement history — every cash LedgerEntry id produced by a payment/receipt. */
  settlement_entry_ids?: string[];
  /** Optional cost center used for the generated cash entry (treasury default applied when absent). */
  cost_center_id?: string;
  source_system: string;
  external_key?: string;
  notes?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  supplier?: Supplier;
  client?: Client;
}

/**
 * Tax obligation — an accrued/scheduled tax with its own lifecycle, separate
 * from the LedgerEntry that recognized the expense at competence. Cash
 * settlement is posted via the clearing group so the managerial DRE is not
 * double-counted; see recordTaxPayment in finance-store.
 */
export interface TaxObligation {
  id: string;
  tax_type: TaxType;
  title: string;
  description?: string;
  competence_month: string;       // YYYY-MM
  due_date: string;               // YYYY-MM-DD
  paid_date?: string;             // YYYY-MM-DD (last payment)
  status: TaxStatus;
  amount_cents: number;
  paid_amount_cents: number;
  supplier_id?: string;
  client_id?: string;
  contract_id?: string;
  project_id?: string;
  cost_center_id?: string;
  /**
   * P&L accrual LedgerEntry that recognized this tax at competence (group
   * 'taxes', non-clearing). Set via linkTaxObligationToAccrual — kept separate
   * from the cash settlement entries so recognition and payment never conflate.
   */
  accrual_entry_id?: string;
  /**
   * Latest cash-settlement LedgerEntry (clearing group) produced by a payment.
   * For full settlement history use settlement_entry_ids. (Historically this
   * field doubled as the accrual link; accrual now lives in accrual_entry_id.)
   */
  linked_entry_id?: string;
  /** Optional AP/AR title if the tax was raised as an obligation. */
  linked_apar_title_id?: string;
  /** Every cash LedgerEntry id produced by recordTaxPayment for this obligation. */
  settlement_entry_ids?: string[];
  source_document?: string;
  invoice_number?: string;
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
