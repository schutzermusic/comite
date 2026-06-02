/**
 * Finance Module — Client-side data store (mock-backed, Supabase-ready).
 * All mutations go through this layer so switching to real API is a single-point change.
 */

import type {
  LedgerEntry, LedgerEntryStatus, LedgerEntryType, LedgerAllocationStatus,
  PayrollBatch, PayrollAllocation, PayrollAllocationStatus, AllocationRule, AllocationResult,
  PeriodClose, APARTitle, APARType, FinanceAuditLog,
  ManagementCategory, ManagementGroupKey, BusinessUnit, CostCenter, Supplier, Client,
  FinanceFilters, PnLRow, CostStackMonth, ProjectMargin, DataQualityIndicator, AgingBucket,
  TopDriver, PendingAction,
  TaxObligation, TaxStatus, TaxType,
} from '@/lib/types/finance';
import {
  mockLedgerEntries, mockPayrollBatches, mockPayrollAllocations, mockAllocationRules,
  mockAllocationResults, mockPeriodCloses, mockAPARTitles,
  mockTaxObligations,
} from '@/data/finance/mock-ledger';
import {
  managementCategories, businessUnits, costCenters, suppliers, clients,
  findCategoryByCode, isPnlGroup, isClearingGroup, isClearingCategory,
} from '@/data/finance/seed-categories';
import { isPayrollBatchOverallocated } from '@/lib/finance/selectors/payroll';
import { selectFinanceDataQuality, type FinanceDataQualityReport } from '@/lib/finance/selectors/data-quality';
import { FINANCE_TODAY } from '@/lib/finance/selectors/apar';
import {
  projects as referenceProjects,
  contracts as referenceContracts,
  scenarios as referenceScenarios,
  type ProjectRef, type ContractRef, type ScenarioRef,
} from '@/data/finance/reference';

let ledgerEntries = [...mockLedgerEntries];
let payrollBatches = [...mockPayrollBatches];
let payrollAllocations = [...mockPayrollAllocations];
let allocationRules = [...mockAllocationRules];
let allocationResults = [...mockAllocationResults];
let periodCloses = [...mockPeriodCloses];
let aparTitles = [...mockAPARTitles];
let taxObligations = [...mockTaxObligations];
const auditLog: FinanceAuditLog[] = [];

// ── Helpers ─────────────────────────────────────────────────

export function centsToReais(cents: number): number {
  return cents / 100;
}

export function reaisToCents(reais: number): number {
  return Math.round(reais * 100);
}

// Currency formatters — delegate to canonical pt-BR helpers so the whole SaaS
// renders identically regardless of which helper a module imports.
import { formatCurrency } from '@/lib/i18n/format';

export function formatBRL(cents: number): string {
  return formatCurrency(centsToReais(cents ?? 0));
}

export function formatCompactBRL(cents: number): string {
  return formatCurrency(centsToReais(cents ?? 0), { compact: true, maxFraction: 1 });
}

function generateId(): string {
  return `le-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function addAudit(entityType: string, entityId: string, action: FinanceAuditLog['action'], changedFields?: Record<string, { old: unknown; new: unknown }>, reason?: string) {
  auditLog.push({
    id: `audit-${Date.now()}`,
    entity_type: entityType,
    entity_id: entityId,
    action,
    changed_fields: changedFields,
    reason_text: reason,
    performed_by: 'user-admin-001',
    performed_at: new Date().toISOString(),
  });
}

// ── Reference Data ──────────────────────────────────────────

export function getCategories(): ManagementCategory[] { return managementCategories; }
export function getBusinessUnits(): BusinessUnit[] { return businessUnits; }
export function getCostCenters(): CostCenter[] { return costCenters; }

/**
 * Create a Finance cost center on the fly — used by the payroll-closing mapping
 * step when an imported name has no counterpart in the master data yet. Pushes
 * into the shared `costCenters` array so every existing lookup (`costCenters.find`)
 * sees it immediately. The generated `code` is a slug of the name unless one is
 * given; the business unit defaults to the first BU.
 */
export function createCostCenter(data: {
  name: string;
  code?: string;
  business_unit_id?: string;
  type?: CostCenter['type'];
}): CostCenter {
  const now = new Date().toISOString();
  const slug = (data.code || data.name)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 16) || 'CC';
  let code = slug;
  let n = 1;
  while (costCenters.some((c) => c.code === code)) code = `${slug}-${++n}`;
  const cc: CostCenter = {
    id: `cc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    code,
    name: data.name.trim(),
    business_unit_id: data.business_unit_id || businessUnits[0]?.id || '',
    type: data.type ?? 'indirect',
    active: true,
    created_at: now,
    updated_at: now,
  };
  costCenters.push(cc);
  addAudit('cost_center', cc.id, 'created');
  return cc;
}
export function getSuppliers(): Supplier[] { return suppliers; }
export function getClients(): Client[] { return clients; }
export function getProjects(): ProjectRef[] { return referenceProjects; }
export function getContracts(): ContractRef[] { return referenceContracts; }
export function getScenarios(): ScenarioRef[] { return referenceScenarios; }
export function getAuditLog(entityType?: string, entityId?: string): FinanceAuditLog[] {
  if (entityType && entityId) return auditLog.filter(a => a.entity_type === entityType && a.entity_id === entityId);
  return auditLog;
}

// ── Ledger Entries ──────────────────────────────────────────

/**
 * Allocation lifecycle derived purely from the project/contract dimensions so
 * it can never drift from reality:
 *   project_id present → 'allocated'
 *   contract_id only   → 'pending_project' (a pre-project cost awaiting linkage)
 *   neither            → 'unallocated' (corporate/overhead)
 */
export function deriveAllocationStatus(e: Pick<LedgerEntry, 'project_id' | 'contract_id'>): LedgerAllocationStatus {
  if (e.project_id) return 'allocated';
  if (e.contract_id) return 'pending_project';
  return 'unallocated';
}

function enrichEntry(e: LedgerEntry): LedgerEntry {
  return {
    ...e,
    allocation_status: deriveAllocationStatus(e),
    category: managementCategories.find(c => c.id === e.category_id),
    cost_center: costCenters.find(c => c.id === e.cost_center_id),
    business_unit: businessUnits.find(b => b.id === e.business_unit_id),
    supplier: suppliers.find(s => s.id === e.supplier_id),
  };
}

export function getLedgerEntries(filters?: Partial<FinanceFilters>, statusFilter?: LedgerEntryStatus | 'all'): LedgerEntry[] {
  let result = ledgerEntries;

  if (statusFilter && statusFilter !== 'all') {
    result = result.filter(e => e.status === statusFilter);
  }

  if (filters) {
    if (filters.period_from) result = result.filter(e => e.period_key >= filters.period_from!);
    if (filters.period_to) result = result.filter(e => e.period_key <= filters.period_to!);
    if (filters.project_ids?.length) result = result.filter(e => e.project_id && filters.project_ids!.includes(e.project_id));
    if (filters.business_unit_ids?.length) result = result.filter(e => filters.business_unit_ids!.includes(e.business_unit_id));
    if (filters.cost_center_ids?.length) result = result.filter(e => filters.cost_center_ids!.includes(e.cost_center_id));
    if (filters.entry_type && filters.entry_type !== 'all') result = result.filter(e => e.entry_type === filters.entry_type);
  }

  return result.map(enrichEntry).sort((a, b) => b.entry_date.localeCompare(a.entry_date));
}

export function getLedgerEntry(id: string): LedgerEntry | undefined {
  const e = ledgerEntries.find(e => e.id === id);
  return e ? enrichEntry(e) : undefined;
}

export function createLedgerEntry(data: Partial<LedgerEntry>): LedgerEntry {
  const now = new Date().toISOString();
  const entryDate = data.entry_date || now.slice(0, 10);
  const periodKey = data.competence_month || entryDate.slice(0, 7);
  // Most manual entries start as draft; system-generated entries (e.g. AP/AR
  // settlement cash legs) may be created already posted/reconciled.
  const status: LedgerEntryStatus = data.status || 'draft';
  const isSettled = status === 'posted' || status === 'reconciled';
  const entry: LedgerEntry = {
    id: generateId(),
    entry_date: entryDate,
    competence_month: periodKey,
    due_date: data.due_date,
    description: data.description || '',
    amount_cents: data.amount_cents || 0,
    currency: 'BRL',
    category_id: data.category_id || '',
    dre_line: data.dre_line,
    cost_center_id: data.cost_center_id || '',
    project_id: data.project_id,
    contract_id: data.contract_id,
    allocation_status: deriveAllocationStatus(data),
    allocation_notes: data.allocation_notes,
    supplier_id: data.supplier_id,
    client_id: data.client_id,
    business_unit_id: data.business_unit_id || '',
    account: data.account,
    scenario: data.scenario ?? scenarioFromEntryType(data.entry_type || 'actual'),
    period_key: periodKey,
    entry_type: data.entry_type || 'actual',
    status,
    source_system: data.source_system || 'manual',
    source_ref: data.source_ref,
    evidence_required: (data.amount_cents || 0) >= 500000,
    evidence_provided: data.evidence_provided ?? false,
    template_key: data.template_key,
    tags: data.tags,
    notes: data.notes,
    metadata: data.metadata,
    created_by: 'user-admin-001',
    posted_by: isSettled ? 'user-admin-001' : undefined,
    posted_at: isSettled ? now : undefined,
    created_at: now,
    updated_at: now,
  };
  ledgerEntries = [entry, ...ledgerEntries];
  addAudit('ledger_entry', entry.id, 'created');
  return enrichEntry(entry);
}

export function updateLedgerEntry(id: string, data: Partial<LedgerEntry>): LedgerEntry | undefined {
  const idx = ledgerEntries.findIndex(e => e.id === id);
  if (idx === -1) return undefined;
  const old = ledgerEntries[idx];
  if (old.status !== 'draft') return undefined;

  const updated = { ...old, ...data, updated_at: new Date().toISOString() };
  // Competence month drives the period_key used by every dashboard selector.
  updated.period_key = updated.competence_month || (updated.entry_date ? updated.entry_date.slice(0, 7) : updated.period_key);
  updated.competence_month = updated.period_key;
  updated.allocation_status = deriveAllocationStatus(updated);
  if (data.entry_type && data.scenario === undefined) {
    updated.scenario = scenarioFromEntryType(data.entry_type);
  }
  if (updated.amount_cents >= 500000) updated.evidence_required = true;

  ledgerEntries[idx] = updated;
  addAudit('ledger_entry', id, 'updated');
  return enrichEntry(updated);
}

/** Default scenario key inferred from entry_type so dashboards bucket the entry correctly. */
function scenarioFromEntryType(entryType: LedgerEntryType): LedgerEntry['scenario'] {
  switch (entryType) {
    case 'budget': return 'budget';
    case 'forecast': return 'forecast';
    default: return 'realized';
  }
}

// ── Validation ──────────────────────────────────────────────

export interface LedgerEntryValidationError {
  field: string;
  message: string;
}

/**
 * Validate a draft ledger entry before create/update. Returns an array of
 * field-level errors (empty when valid). Centralized here in the service
 * layer so the same rules apply when a Supabase/ERP repository replaces the
 * mock store.
 */
export function validateLedgerEntryInput(data: Partial<LedgerEntry>): LedgerEntryValidationError[] {
  const errors: LedgerEntryValidationError[] = [];

  if (data.amount_cents === undefined || data.amount_cents === null || data.amount_cents <= 0) {
    errors.push({ field: 'amount_cents', message: 'Valor é obrigatório e deve ser maior que zero.' });
  }
  if (!data.entry_date) {
    errors.push({ field: 'entry_date', message: 'Data é obrigatória.' });
  }
  if (!data.competence_month) {
    errors.push({ field: 'competence_month', message: 'Competência é obrigatória.' });
  }
  if (!data.category_id && !data.dre_line) {
    errors.push({ field: 'category_id', message: 'Categoria ou linha DRE é obrigatória.' });
  }
  if (!data.entry_type) {
    errors.push({ field: 'entry_type', message: 'Tipo de lançamento é obrigatório.' });
  }
  if (!data.description) {
    errors.push({ field: 'description', message: 'Descrição é obrigatória.' });
  }

  // Category-driven requirement rules. Falls back to the expense heuristic for
  // cost-center when the category does not declare requires_cost_center, so
  // legacy categories keep their existing behavior.
  const category = data.category_id
    ? managementCategories.find(c => c.id === data.category_id)
    : data.dre_line
      ? findCategoryByCode(data.dre_line)
      : undefined;
  const isExpense = category ? category.group_key !== 'revenue' : false;
  const isClearing = category ? category.group_key === 'clearing' : false;

  // Project required when the category master demands it (e.g. Mobilização/Hotel,
  // Mobilização/Passagem aérea, project revenue). Clearing never requires a project.
  if (category?.requires_project && !isClearing && !data.project_id) {
    errors.push({ field: 'project_id', message: `Projeto é obrigatório para "${category.name}".` });
  }

  // Contract required when declared (e.g. Receita de Contrato).
  if (category?.requires_contract && !data.contract_id) {
    errors.push({ field: 'contract_id', message: `Contrato é obrigatório para "${category.name}".` });
  }

  // Cost center: required when the category declares it, or (legacy fallback)
  // for any non-revenue P&L expense. Clearing/treasury legs are exempt.
  const needsCostCenter = category?.requires_cost_center ?? (isExpense && !isClearing);
  if (needsCostCenter && !data.cost_center_id) {
    errors.push({ field: 'cost_center_id', message: 'Centro de custo é obrigatório para despesas.' });
  }

  return errors;
}

export function transitionEntryStatus(id: string, newStatus: LedgerEntryStatus, reason?: string): LedgerEntry | undefined {
  const idx = ledgerEntries.findIndex(e => e.id === id);
  if (idx === -1) return undefined;

  const old = { ...ledgerEntries[idx] };
  const now = new Date().toISOString();

  const entry = { ...old, status: newStatus, updated_at: now };
  if (newStatus === 'in_review') { /* submitted */ }
  if (newStatus === 'approved') { entry.approved_by = 'user-admin-001'; entry.approved_at = now; }
  if (newStatus === 'posted') { entry.posted_by = 'user-admin-001'; entry.posted_at = now; }
  if (newStatus === 'void') { entry.voided_by = 'user-admin-001'; entry.voided_at = now; entry.void_reason = reason || ''; }

  ledgerEntries[idx] = entry;
  addAudit('ledger_entry', id, newStatus === 'in_review' ? 'submitted' : newStatus === 'void' ? 'voided' : 'status_changed',
    { status: { old: old.status, new: newStatus } }, reason);
  return enrichEntry(entry);
}

// ── Project allocation (pre-project costs) ──────────────────

export interface LinkEntriesToProjectResult {
  /** Entries successfully (re)allocated to the project. */
  linked: LedgerEntry[];
  /** Entries skipped, with the reason they could not be linked. */
  skipped: { id: string; reason: 'not_found' | 'void' | 'clearing' | 'already_linked' }[];
  project_id: string;
}

/**
 * Link/reclassify one or more ledger entries to a project — the controlled
 * path for resolving "pending project allocation" costs once the project
 * exists. This is a DIMENSION reclassification only (it never touches
 * amount/date/category), so it is permitted even when the entry is already
 * posted/reconciled in a closed period (Phase rule 8). Every change is audited.
 *
 * Guards:
 *   - the target project must exist;
 *   - void entries are skipped;
 *   - clearing/treasury entries are skipped — they must NEVER become project
 *     cost (Phase rule 9);
 *   - entries already on the project are skipped (idempotent).
 *
 * When an entry has no contract_id it inherits the project's contract so the
 * lineage stays intact.
 *
 * TODO(supabase): run the UPDATE ledger_entries + INSERT audit_log per entry in
 * one transaction so a partial batch can never leave entries half-linked.
 */
export function linkEntriesToProject(entryIds: string[], projectId: string, notes?: string): LinkEntriesToProjectResult {
  const linked: LedgerEntry[] = [];
  const skipped: LinkEntriesToProjectResult['skipped'] = [];

  const project = referenceProjects.find(p => p.id === projectId);
  if (!project) {
    return { linked, skipped: entryIds.map(id => ({ id, reason: 'not_found' as const })), project_id: projectId };
  }

  const now = new Date().toISOString();
  for (const id of entryIds) {
    const idx = ledgerEntries.findIndex(e => e.id === id);
    if (idx === -1) { skipped.push({ id, reason: 'not_found' }); continue; }
    const e = ledgerEntries[idx];
    if (e.status === 'void') { skipped.push({ id, reason: 'void' }); continue; }
    if (isClearingCategory(e.category_id)) { skipped.push({ id, reason: 'clearing' }); continue; }
    if (e.project_id === projectId) { skipped.push({ id, reason: 'already_linked' }); continue; }

    const prevProject = e.project_id ?? null;
    const prevStatus = e.allocation_status ?? deriveAllocationStatus(e);
    const updated: LedgerEntry = {
      ...e,
      project_id: projectId,
      contract_id: e.contract_id ?? project.contract_id,
      allocation_status: 'allocated',
      allocation_notes: notes ?? e.allocation_notes,
      updated_at: now,
    };
    ledgerEntries[idx] = updated;
    addAudit('ledger_entry', id, 'updated', {
      project_id: { old: prevProject, new: projectId },
      allocation_status: { old: prevStatus, new: 'allocated' },
    }, notes ?? `Custo vinculado ao projeto ${projectId}`);
    linked.push(enrichEntry(updated));
  }

  return { linked, skipped, project_id: projectId };
}

// ── Payroll ─────────────────────────────────────────────────

export function getPayrollBatches(periodKey?: string): PayrollBatch[] {
  let result = payrollBatches;
  if (periodKey) result = result.filter(b => b.period_key === periodKey);
  return result.map(b => ({ ...b, business_unit: businessUnits.find(bu => bu.id === b.business_unit_id) }));
}

export function createPayrollBatch(data: Partial<PayrollBatch>): PayrollBatch {
  const now = new Date().toISOString();
  const batch: PayrollBatch = {
    id: `pb-${Date.now()}`,
    period_key: data.period_key || '',
    business_unit_id: data.business_unit_id || '',
    total_gross_cents: data.total_gross_cents || 0,
    total_charges_cents: data.total_charges_cents || 0,
    total_benefits_cents: data.total_benefits_cents || 0,
    headcount: data.headcount || 0,
    status: 'draft',
    evidence_url: data.evidence_url,
    notes: data.notes,
    source_system: 'manual',
    created_by: 'user-admin-001',
    created_at: now,
    updated_at: now,
  };
  payrollBatches = [batch, ...payrollBatches];
  addAudit('payroll_batch', batch.id, 'created');
  return batch;
}

/**
 * Inject a PayrollBatch that was created externally (e.g. by the supabase
 * payroll-closing sendToFinance API). Idempotent — silently skips if the id
 * already exists in the in-memory store.
 */
export function injectPayrollBatch(batch: PayrollBatch): void {
  if (payrollBatches.some((b) => b.id === batch.id)) return;
  payrollBatches = [{ ...batch, business_unit: businessUnits.find((bu) => bu.id === batch.business_unit_id) }, ...payrollBatches];
}

/**
 * Hydrate the in-memory store with the persisted Finance PayrollBatch records
 * from Supabase (via /api/finance/payroll-batches), so Financeiro > Folha &
 * Alocação shows real batches created by the payroll-closing sendToFinance flow
 * even after a reload / server restart.
 *
 * Fallback-safe: only runs in supabase mode; on any network/parse failure it
 * silently keeps the existing in-memory batches (mock seed + same-session
 * injectPayrollBatch mirror). Idempotent — injectPayrollBatch dedupes by id, so
 * calling sendToFinance twice (and hydrating) never creates a duplicate batch.
 * Read-only: it never creates a LedgerEntry.
 *
 * @returns the number of NEW batches added to the store (0 when nothing changed).
 */
export async function hydratePayrollBatchesFromServer(periodKey?: string): Promise<number> {
  if (process.env.NEXT_PUBLIC_PAYROLL_CLOSING_REPOSITORY_MODE !== 'supabase') return 0;
  try {
    const url = periodKey ? `/api/finance/payroll-batches?period=${encodeURIComponent(periodKey)}` : '/api/finance/payroll-batches';
    const res = await fetch(url);
    const data = (await res.json()) as { ok: boolean; batches?: PayrollBatch[] };
    if (!data.ok || !data.batches) return 0;
    let added = 0;
    for (const b of data.batches) {
      if (payrollBatches.some((x) => x.id === b.id)) continue;
      injectPayrollBatch(b);
      added++;
    }
    return added;
  } catch {
    return 0;
  }
}

export function approvePayrollBatch(id: string): PayrollBatch | undefined {
  const idx = payrollBatches.findIndex(b => b.id === id);
  if (idx === -1) return undefined;
  const now = new Date().toISOString();
  payrollBatches[idx] = { ...payrollBatches[idx], status: 'approved', approved_by: 'user-admin-001', approved_at: now, updated_at: now };
  addAudit('payroll_batch', id, 'approved');
  return payrollBatches[idx];
}

// ── Payroll Allocation ──────────────────────────────────────

/**
 * P&L payroll categories used when a payroll allocation is posted.
 *
 * Payroll allocation is economic recognition of workforce COST by competence,
 * so it lands in the managerial DRE — NOT in the clearing group used by AP/AR
 * and tax cash settlements. Project-linked work is a direct cost (COGS folha
 * direta, B.1.1); structural roles are indirect (OPEX folha indireta, C.1.1).
 */
const PAYROLL_DIRECT_CATEGORY = 'B.1.1';   // Salários — Equipe de Campo (cogs)
const PAYROLL_INDIRECT_CATEGORY = 'C.1.1'; // Salários — Administração (opex)
const DEFAULT_PAYROLL_CC = 'cc-admin-sp';
const DEFAULT_PAYROLL_BU = 'bu-sp';

function payrollPostingCategoryId(alloc: PayrollAllocation): string {
  const code = alloc.project_id ? PAYROLL_DIRECT_CATEGORY : PAYROLL_INDIRECT_CATEGORY;
  return findCategoryByCode(code)?.id || (alloc.project_id ? 'cat-b11' : 'cat-c11');
}

function enrichPayrollAllocation(a: PayrollAllocation): PayrollAllocation {
  return {
    ...a,
    cost_center: costCenters.find(c => c.id === a.cost_center_id),
    business_unit: businessUnits.find(b => b.id === a.business_unit_id),
    project_name: a.project_id ? referenceProjects.find(p => p.id === a.project_id)?.name ?? a.project_id : undefined,
    contract_name: a.contract_id ? referenceContracts.find(c => c.id === a.contract_id)?.code ?? a.contract_id : undefined,
  };
}

export interface PayrollAllocationFilter {
  competenceMonth?: string;
  status?: PayrollAllocationStatus | 'all';
  projectId?: string;
  contractId?: string;
  costCenterId?: string;
  businessUnitId?: string;
  departmentId?: string;
  payrollBatchId?: string;
  employeeId?: string;
}

export function getPayrollAllocations(filter?: PayrollAllocationFilter): PayrollAllocation[] {
  let result = payrollAllocations;
  if (filter) {
    if (filter.competenceMonth) result = result.filter(a => a.competence_month === filter.competenceMonth);
    if (filter.status && filter.status !== 'all') result = result.filter(a => a.status === filter.status);
    if (filter.projectId) result = result.filter(a => a.project_id === filter.projectId);
    if (filter.contractId) result = result.filter(a => a.contract_id === filter.contractId);
    if (filter.costCenterId) result = result.filter(a => a.cost_center_id === filter.costCenterId);
    if (filter.businessUnitId) result = result.filter(a => a.business_unit_id === filter.businessUnitId);
    if (filter.departmentId) result = result.filter(a => a.department_id === filter.departmentId);
    if (filter.payrollBatchId) result = result.filter(a => a.payroll_batch_id === filter.payrollBatchId);
    if (filter.employeeId) result = result.filter(a => a.employee_id === filter.employeeId);
  }
  return result.map(enrichPayrollAllocation);
}

export function getPayrollAllocation(id: string): PayrollAllocation | undefined {
  const a = payrollAllocations.find(a => a.id === id);
  return a ? enrichPayrollAllocation(a) : undefined;
}

/** Derive total cost + allocation percentage from the monetary parts. */
function normalizePayrollAmounts(data: Partial<PayrollAllocation>) {
  const gross = data.gross_amount_cents ?? 0;
  const taxes = data.taxes_amount_cents ?? 0;
  const benefits = data.benefits_amount_cents ?? 0;
  const total = data.total_cost_cents ?? gross + taxes + benefits;
  const allocated = Math.min(data.allocated_amount_cents ?? total, total);
  const pct = data.allocation_percentage ?? (total > 0 ? Math.round((allocated / total) * 10000) / 100 : 0);
  return { gross, taxes, benefits, total, allocated, pct };
}

export function createPayrollAllocation(data: Partial<PayrollAllocation>): PayrollAllocation {
  const now = new Date().toISOString();
  const { gross, taxes, benefits, total, allocated, pct } = normalizePayrollAmounts(data);
  const allocation: PayrollAllocation = {
    id: `pa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    employee_id: data.employee_id || '',
    employee_name: data.employee_name || '',
    department_id: data.department_id || '',
    department_name: data.department_name || '',
    role: data.role || '',
    competence_month: data.competence_month || now.slice(0, 7),
    payroll_batch_id: data.payroll_batch_id,
    gross_amount_cents: gross,
    taxes_amount_cents: taxes,
    benefits_amount_cents: benefits,
    total_cost_cents: total,
    allocated_amount_cents: allocated,
    allocation_percentage: pct,
    project_id: data.project_id,
    contract_id: data.contract_id,
    cost_center_id: data.cost_center_id,
    business_unit_id: data.business_unit_id,
    status: data.status || 'draft',
    linked_entry_id: data.linked_entry_id,
    notes: data.notes,
    source_system: data.source_system || 'payroll_alloc',
    created_by: 'user-admin-001',
    created_at: now,
    updated_at: now,
  };
  payrollAllocations = [allocation, ...payrollAllocations];
  addAudit('payroll_allocation', allocation.id, 'created');
  return enrichPayrollAllocation(allocation);
}

export function updatePayrollAllocation(id: string, data: Partial<PayrollAllocation>): PayrollAllocation | undefined {
  const idx = payrollAllocations.findIndex(a => a.id === id);
  if (idx === -1) return undefined;
  const old = payrollAllocations[idx];
  // Posted / cancelled allocations are immutable — a correction must be a new
  // allocation (and, if needed, a reversing ledger entry).
  if (old.status === 'posted' || old.status === 'cancelled') return undefined;

  const merged = { ...old, ...data };
  const { gross, taxes, benefits, total, allocated, pct } = normalizePayrollAmounts(merged);
  const updated: PayrollAllocation = {
    ...merged,
    gross_amount_cents: gross,
    taxes_amount_cents: taxes,
    benefits_amount_cents: benefits,
    total_cost_cents: total,
    allocated_amount_cents: allocated,
    allocation_percentage: pct,
    updated_at: new Date().toISOString(),
  };
  payrollAllocations[idx] = updated;
  addAudit('payroll_allocation', id, 'updated');
  return enrichPayrollAllocation(updated);
}

/**
 * Reconciliation guard: never approve/post an allocation whose payroll batch is
 * over-allocated (sum of live allocated_amount_cents exceeds the batch's
 * fully-loaded total). The whole batch must be corrected first.
 */
function isAllocationBatchOverallocated(alloc: PayrollAllocation): boolean {
  const batch = payrollBatches.find(b => b.id === alloc.payroll_batch_id);
  return isPayrollBatchOverallocated(payrollAllocations, batch);
}

export function approvePayrollAllocation(id: string): PayrollAllocation | undefined {
  const idx = payrollAllocations.findIndex(a => a.id === id);
  if (idx === -1) return undefined;
  const old = payrollAllocations[idx];
  if (old.status === 'posted' || old.status === 'cancelled') return undefined;
  if (isAllocationBatchOverallocated(old)) return undefined;
  const now = new Date().toISOString();
  const updated: PayrollAllocation = { ...old, status: 'approved', approved_by: 'user-admin-001', approved_at: now, updated_at: now };
  payrollAllocations[idx] = updated;
  addAudit('payroll_allocation', id, 'approved', { status: { old: old.status, new: 'approved' } });
  return enrichPayrollAllocation(updated);
}

export function cancelPayrollAllocation(id: string, reason?: string): PayrollAllocation | undefined {
  const idx = payrollAllocations.findIndex(a => a.id === id);
  if (idx === -1) return undefined;
  const old = payrollAllocations[idx];
  // A posted allocation already hit the DRE — cancelling it here would orphan
  // the ledger entry, so block it (reverse the entry first in a future phase).
  if (old.status === 'posted' || old.status === 'cancelled') return undefined;
  const now = new Date().toISOString();
  const updated: PayrollAllocation = { ...old, status: 'cancelled', cancelled_at: now, updated_at: now };
  payrollAllocations[idx] = updated;
  addAudit('payroll_allocation', id, 'voided', { status: { old: old.status, new: 'cancelled' } }, reason);
  return enrichPayrollAllocation(updated);
}

export interface PostPayrollAllocationResult {
  allocation: PayrollAllocation;
  /** P&L LedgerEntry created (or already linked) for this allocation. */
  entry?: LedgerEntry;
}

/**
 * Post a payroll allocation: recognize its allocated cost in the managerial
 * DRE by generating an 'actual' LedgerEntry under a P&L folha category and
 * linking it back via linked_entry_id.
 *
 * Accounting:
 *   - Category is COGS folha direta (B.1.1) for project-linked work, else OPEX
 *     folha indireta (C.1.1). NEVER the clearing group — payroll allocation is
 *     economic recognition, not a cash movement. Any later cash payment of the
 *     payroll is a separate treasury/clearing concern.
 *   - competence_month / period_key are set from the allocation's competence
 *     so the cost lands in the right month regardless of posting date.
 *   - project / contract / cost center / business unit are preserved on the entry.
 *
 * Duplicate prevention (counts the cost exactly once):
 *   - A 'posted'/'cancelled' allocation, or one that already has linked_entry_id,
 *     returns its existing (linked) entry without creating another.
 *   - Allocations with zero allocated amount post nothing.
 *
 * TODO(supabase): wrap the INSERT ledger_entries + UPDATE payroll_allocations
 * + INSERT audit_log in one transaction so the link can never be half-written.
 */
export function postPayrollAllocation(id: string): PostPayrollAllocationResult | undefined {
  const idx = payrollAllocations.findIndex(a => a.id === id);
  if (idx === -1) return undefined;
  const allocation = payrollAllocations[idx];

  // Dedupe: already posted / linked → return the existing entry, post nothing.
  if (allocation.status === 'posted' || allocation.linked_entry_id) {
    const existing = allocation.linked_entry_id ? getLedgerEntry(allocation.linked_entry_id) : undefined;
    return { allocation: enrichPayrollAllocation(allocation), entry: existing };
  }
  if (allocation.status === 'cancelled') {
    return { allocation: enrichPayrollAllocation(allocation) };
  }
  // Reconciliation guard: block posting when the batch is over-allocated.
  if (isAllocationBatchOverallocated(allocation)) {
    return { allocation: enrichPayrollAllocation(allocation) };
  }
  // Nothing to recognize.
  if (allocation.allocated_amount_cents <= 0) {
    return { allocation: enrichPayrollAllocation(allocation) };
  }

  const now = new Date().toISOString();
  const enriched = enrichPayrollAllocation(allocation);
  const entry = createLedgerEntry({
    entry_date: `${allocation.competence_month}-01`,
    competence_month: allocation.competence_month,
    description: `Folha alocada — ${allocation.employee_name}${enriched.project_name ? ` → ${enriched.project_name}` : ''}`,
    amount_cents: allocation.allocated_amount_cents,
    category_id: payrollPostingCategoryId(allocation),
    cost_center_id: allocation.cost_center_id || DEFAULT_PAYROLL_CC,
    project_id: allocation.project_id,
    contract_id: allocation.contract_id,
    business_unit_id: allocation.business_unit_id || DEFAULT_PAYROLL_BU,
    entry_type: 'actual',
    status: 'posted',
    evidence_provided: true,
    source_system: 'payroll_alloc',
    source_ref: allocation.id,
    payroll_batch_id: allocation.payroll_batch_id,
    metadata: { payroll_allocation_id: allocation.id, employee_id: allocation.employee_id },
  });

  const updated: PayrollAllocation = {
    ...allocation,
    status: 'posted',
    linked_entry_id: entry.id,
    posted_at: now,
    updated_at: now,
  };
  payrollAllocations[idx] = updated;
  addAudit('payroll_allocation', id, 'posted', { status: { old: allocation.status, new: 'posted' } });
  addAudit('payroll_allocation', id, 'updated', { linked_entry_id: { old: null, new: entry.id } });

  return { allocation: enrichPayrollAllocation(updated), entry };
}

// ── Allocation ──────────────────────────────────────────────

export function getAllocationRules(): AllocationRule[] {
  return allocationRules.map(r => ({ ...r, cost_center: costCenters.find(c => c.id === r.cost_center_id) }));
}

export function createAllocationRule(data: Partial<AllocationRule>): AllocationRule {
  const now = new Date().toISOString();
  const rule: AllocationRule = {
    id: `ar-${Date.now()}`,
    name: data.name || '',
    version: 1,
    cost_center_id: data.cost_center_id || '',
    method: data.method || 'fixed_pct',
    rules_json: data.rules_json || [],
    effective_from: data.effective_from || new Date().toISOString().slice(0, 10),
    status: 'draft',
    created_by: 'user-admin-001',
    created_at: now,
    updated_at: now,
  };
  allocationRules = [rule, ...allocationRules];
  addAudit('allocation_rule', rule.id, 'created');
  return rule;
}

export function getAllocationResults(periodKey?: string): AllocationResult[] {
  let result = allocationResults;
  if (periodKey) result = result.filter(r => r.period_key === periodKey);
  return result.map(r => ({ ...r, rule: allocationRules.find(ar => ar.id === r.rule_id) }));
}

export function previewAllocation(ruleId: string, periodKey: string): AllocationResult | undefined {
  const rule = allocationRules.find(r => r.id === ruleId);
  if (!rule) return undefined;

  const batch = payrollBatches.find(b => b.period_key === periodKey && b.business_unit_id === costCenters.find(c => c.id === rule.cost_center_id)?.business_unit_id);
  const sourceAmount = batch ? batch.total_gross_cents + batch.total_charges_cents + batch.total_benefits_cents : 0;

  const entries = rule.rules_json.map(target => ({
    target_project_id: target.target_project_id,
    target_project_name: target.target_project_name || target.target_project_id,
    target_cc_id: target.target_cc_id,
    target_cc_name: target.target_cc_name || target.target_cc_id,
    amount_cents: Math.round(sourceAmount * target.weight / 100),
    weight_pct: target.weight,
  }));

  const result: AllocationResult = {
    id: `alloc-${Date.now()}`,
    rule_id: ruleId,
    period_key: periodKey,
    payroll_batch_id: batch?.id,
    source_amount_cents: sourceAmount,
    result_entries: entries,
    status: 'preview',
    created_by: 'user-admin-001',
    created_at: new Date().toISOString(),
  };
  allocationResults = [result, ...allocationResults];
  addAudit('allocation_result', result.id, 'created');
  return result;
}

export function postAllocation(resultId: string): AllocationResult | undefined {
  const idx = allocationResults.findIndex(r => r.id === resultId);
  if (idx === -1) return undefined;
  const now = new Date().toISOString();
  const result = { ...allocationResults[idx], status: 'posted' as const, posted_at: now };
  allocationResults[idx] = result;

  result.result_entries.forEach(re => {
    const cat = findCategoryByCode('B.1.1');
    createLedgerEntry({
      entry_date: `${result.period_key}-01`,
      description: `Alocação folha → ${re.target_project_name} (${re.weight_pct}%)`,
      amount_cents: re.amount_cents,
      category_id: cat?.id || 'cat-b11',
      cost_center_id: re.target_cc_id,
      project_id: re.target_project_id,
      business_unit_id: costCenters.find(c => c.id === re.target_cc_id)?.business_unit_id || 'bu-rj',
      entry_type: 'actual',
      source_system: 'payroll_alloc',
    });
  });

  addAudit('allocation_result', resultId, 'posted');
  return result;
}

export function reverseAllocation(resultId: string, reason: string): AllocationResult | undefined {
  const idx = allocationResults.findIndex(r => r.id === resultId);
  if (idx === -1) return undefined;
  const now = new Date().toISOString();
  allocationResults[idx] = { ...allocationResults[idx], status: 'reversed', reversed_at: now, reverse_reason: reason };
  addAudit('allocation_result', resultId, 'reversed', undefined, reason);
  return allocationResults[idx];
}

// ── Period Close ────────────────────────────────────────────

export function getPeriodCloses(): PeriodClose[] { return periodCloses; }

export function getPeriodClose(periodKey: string): PeriodClose | undefined {
  return periodCloses.find(p => p.period_key === periodKey);
}

export function getCloseChecklist(periodKey: string) {
  const entries = ledgerEntries.filter(e => e.period_key === periodKey);
  const batches = payrollBatches.filter(b => b.period_key === periodKey);
  const allocs = allocationResults.filter(a => a.period_key === periodKey);

  return {
    allEntriesPosted: entries.filter(e => e.entry_type === 'actual').every(e => e.status === 'posted' || e.status === 'void' || e.status === 'reconciled'),
    payrollPosted: batches.length === 0 || batches.every(b => b.status === 'posted'),
    allocationsPosted: allocs.length === 0 || allocs.filter(a => a.status !== 'reversed').every(a => a.status === 'posted'),
    noPendingEntries: !entries.some(e => e.status === 'draft' || e.status === 'in_review'),
    allEvidenceProvided: !entries.some(e => e.evidence_required && !e.evidence_provided),
  };
}

export function softClosePeriod(periodKey: string): PeriodClose | undefined {
  const idx = periodCloses.findIndex(p => p.period_key === periodKey);
  if (idx === -1) {
    const pc: PeriodClose = { id: `pc-${Date.now()}`, period_key: periodKey, status: 'soft_close', soft_closed_at: new Date().toISOString() };
    periodCloses.push(pc);
    addAudit('period_close', pc.id, 'status_changed', { status: { old: 'open', new: 'soft_close' } });
    return pc;
  }
  periodCloses[idx] = { ...periodCloses[idx], status: 'soft_close', soft_closed_at: new Date().toISOString() };
  addAudit('period_close', periodCloses[idx].id, 'status_changed');
  return periodCloses[idx];
}

export function hardClosePeriod(periodKey: string): PeriodClose | undefined {
  const pnl = computePnL(periodKey, periodKey);
  const snapshot = {
    revenue: pnl.find(r => r.group_key === 'revenue')?.actual || 0,
    cogs: pnl.find(r => r.group_key === 'cogs')?.actual || 0,
    gross_margin: 0, opex: pnl.find(r => r.group_key === 'opex')?.actual || 0,
    operating_result: 0, financial: pnl.find(r => r.group_key === 'financial')?.actual || 0,
    taxes: pnl.find(r => r.group_key === 'taxes')?.actual || 0, net_result: 0,
    generated_at: new Date().toISOString(),
  };
  snapshot.gross_margin = snapshot.revenue + snapshot.cogs;
  snapshot.operating_result = snapshot.gross_margin + snapshot.opex;
  snapshot.net_result = snapshot.operating_result + snapshot.financial + snapshot.taxes;

  const idx = periodCloses.findIndex(p => p.period_key === periodKey);
  if (idx === -1) return undefined;

  const now = new Date().toISOString();
  periodCloses[idx] = { ...periodCloses[idx], status: 'closed', closed_at: now, closed_by: 'user-admin-001', snapshot_json: snapshot };
  addAudit('period_close', periodCloses[idx].id, 'closed');
  return periodCloses[idx];
}

// ── AP/AR ───────────────────────────────────────────────────

function enrichAPARTitle(t: APARTitle): APARTitle {
  return {
    ...t,
    supplier: suppliers.find(s => s.id === t.supplier_id),
    client: clients.find(c => c.id === t.client_id),
  };
}

export function getAPARTitles(type?: 'payable' | 'receivable'): APARTitle[] {
  let result = aparTitles;
  if (type) result = result.filter(t => t.type === type);
  return result.map(enrichAPARTitle);
}

export function getAPARTitle(id: string): APARTitle | undefined {
  const t = aparTitles.find(t => t.id === id);
  return t ? enrichAPARTitle(t) : undefined;
}

export function createAPARTitle(data: Partial<APARTitle>): APARTitle {
  const now = new Date().toISOString();
  const title: APARTitle = {
    id: `apar-${Date.now()}`,
    type: data.type || 'payable',
    title_number: data.title_number || '',
    supplier_id: data.supplier_id,
    client_id: data.client_id,
    contract_id: data.contract_id,
    project_id: data.project_id,
    issue_date: data.issue_date || now.slice(0, 10),
    due_date: data.due_date || now.slice(0, 10),
    amount_cents: data.amount_cents || 0,
    paid_amount_cents: 0,
    status: 'open',
    source_system: 'manual',
    created_by: 'user-admin-001',
    created_at: now,
    updated_at: now,
  };
  aparTitles = [title, ...aparTitles];
  addAudit('apar_title', title.id, 'created');
  return enrichAPARTitle(title);
}

/**
 * Management category for the cash leg generated on settlement.
 *
 * Settlements are CASH/TREASURY movements, not economic recognition — they
 * must never inflate managerial-DRE revenue/cost (the invoice/accrual already
 * recognized that). So both legs use the 'clearing' group, which every P&L
 * selector excludes. The category sign still encodes cash direction
 * (receivable = cash-in +1, payable = cash-out −1) for cash-flow analysis.
 */
const SETTLEMENT_CATEGORY: Record<APARType, string> = {
  receivable: 'cat-f11', // Recebimento (Cash-in Clearing)
  payable: 'cat-f12',    // Pagamento (Cash-out Clearing)
};
const DEFAULT_SETTLEMENT_CC = 'cc-financeiro';
const DEFAULT_SETTLEMENT_BU = 'bu-sp';

export interface RecordAPARPaymentResult {
  title: APARTitle;
  /** The cash LedgerEntry created for this settlement (undefined when nothing was applied). */
  entry?: LedgerEntry;
}

/**
 * Record a payment/receipt against an AP/AR title and post the matching
 * cash LedgerEntry, linking the two. Safe, reversible in-memory mutation:
 *   1. increments paid_amount_cents (capped at the title amount)
 *   2. creates a reconciled 'actual' LedgerEntry (cash-in for receivables,
 *      cash-out for payables) preserving supplier/client, contract, project
 *   3. links it via linked_entry_id (latest) + settlement_entry_ids (history)
 *   4. transitions the title to 'partial' or 'paid'
 *
 * When amountCents is omitted the title is settled in full. Idempotent for
 * repeated full-settlement clicks: a 'paid'/'cancelled' title or a zero
 * remaining balance returns without creating a duplicate entry.
 *
 * TODO(supabase): the real backend must run steps 1–3 in a single
 * transaction — UPDATE apar_titles, INSERT ledger_entries, INSERT audit_log —
 * so a partial failure never leaves a title settled without its cash entry
 * (or vice-versa).
 */
export function recordAPARPayment(id: string, amountCents?: number, paymentDate?: string): RecordAPARPaymentResult | undefined {
  const idx = aparTitles.findIndex(t => t.id === id);
  if (idx === -1) return undefined;
  const title = aparTitles[idx];
  // Dedupe: never settle (and never re-post a cash entry for) a closed title.
  if (title.status === 'cancelled' || title.status === 'paid') {
    return { title: enrichAPARTitle(title) };
  }

  const remaining = Math.max(0, title.amount_cents - title.paid_amount_cents);
  const applied = amountCents === undefined ? remaining : Math.min(Math.max(0, amountCents), remaining);
  // Nothing left to settle → no ledger entry, no state change.
  if (applied <= 0) return { title: enrichAPARTitle(title) };

  const now = new Date().toISOString();
  const payDate = paymentDate || now.slice(0, 10);
  const period = payDate.slice(0, 7);
  const isReceivable = title.type === 'receivable';

  // Cash leg — born reconciled so it immediately feeds every dashboard selector.
  const entry = createLedgerEntry({
    entry_date: payDate,
    competence_month: period,
    description: `${isReceivable ? 'Recebimento' : 'Pagamento'} ${title.title_number}`,
    amount_cents: applied,
    category_id: SETTLEMENT_CATEGORY[title.type],
    cost_center_id: title.cost_center_id || DEFAULT_SETTLEMENT_CC,
    // Preserve project/contract on the clearing cash leg: when the title has a
    // project_id the settlement feeds that project's received/cash curve; when
    // it only has a contract_id it stays contract-linked (pending cash context,
    // never official project received — the received selector requires project_id).
    project_id: title.project_id,
    contract_id: title.contract_id,
    supplier_id: title.supplier_id,
    client_id: title.client_id,
    business_unit_id: DEFAULT_SETTLEMENT_BU,
    entry_type: 'actual',
    status: 'reconciled',
    evidence_provided: true,
    source_system: 'other',
    source_ref: title.id,
    account: 'caixa',
    metadata: { settlement_of: title.id, apar_type: title.type },
  });

  const newPaid = title.paid_amount_cents + applied;
  const fullySettled = newPaid >= title.amount_cents;
  const updated: APARTitle = {
    ...title,
    paid_amount_cents: newPaid,
    status: fullySettled ? 'paid' : 'partial',
    linked_entry_id: entry.id,
    settlement_entry_ids: [...(title.settlement_entry_ids ?? []), entry.id],
    updated_at: now,
  };
  aparTitles[idx] = updated;

  // Audit: settlement status change + the linked relationship.
  // (the cash LedgerEntry already logged its own 'created' event.)
  addAudit('apar_title', id, 'status_changed', { status: { old: title.status, new: updated.status } });
  addAudit('apar_title', id, 'updated', { linked_entry_id: { old: title.linked_entry_id ?? null, new: entry.id } });

  return { title: enrichAPARTitle(updated), entry };
}

// ── Tax Obligations ─────────────────────────────────────────

/**
 * Clearing category used for the cash leg generated when a tax obligation is
 * paid. Tax payment is a CASH movement — the competence/accrual already hit
 * the managerial DRE via group_key='taxes'. So this leg is posted to
 * group_key='clearing' which every P&L selector excludes.
 */
const TAX_SETTLEMENT_CATEGORY = 'cat-f31';
const DEFAULT_TAX_CC = 'cc-financeiro';
const DEFAULT_TAX_BU = 'bu-sp';

function enrichTaxObligation(t: TaxObligation): TaxObligation {
  return {
    ...t,
    supplier: suppliers.find(s => s.id === t.supplier_id),
    client: clients.find(c => c.id === t.client_id),
  };
}

export interface TaxObligationFilter {
  taxType?: TaxType;
  status?: TaxStatus | 'all';
  competenceMonth?: string;
  dueFrom?: string;
  dueTo?: string;
  clientId?: string;
  supplierId?: string;
  contractId?: string;
  projectId?: string;
  costCenterId?: string;
}

export function getTaxObligations(filter?: TaxObligationFilter): TaxObligation[] {
  let result = taxObligations;
  if (filter) {
    if (filter.taxType) result = result.filter(t => t.tax_type === filter.taxType);
    if (filter.status && filter.status !== 'all') result = result.filter(t => t.status === filter.status);
    if (filter.competenceMonth) result = result.filter(t => t.competence_month === filter.competenceMonth);
    if (filter.dueFrom) result = result.filter(t => t.due_date >= filter.dueFrom!);
    if (filter.dueTo) result = result.filter(t => t.due_date <= filter.dueTo!);
    if (filter.clientId) result = result.filter(t => t.client_id === filter.clientId);
    if (filter.supplierId) result = result.filter(t => t.supplier_id === filter.supplierId);
    if (filter.contractId) result = result.filter(t => t.contract_id === filter.contractId);
    if (filter.projectId) result = result.filter(t => t.project_id === filter.projectId);
    if (filter.costCenterId) result = result.filter(t => t.cost_center_id === filter.costCenterId);
  }
  return result.map(enrichTaxObligation);
}

export function getTaxObligation(id: string): TaxObligation | undefined {
  const t = taxObligations.find(t => t.id === id);
  return t ? enrichTaxObligation(t) : undefined;
}

export function createTaxObligation(data: Partial<TaxObligation>): TaxObligation {
  const now = new Date().toISOString();
  const obligation: TaxObligation = {
    id: `tax-${Date.now()}`,
    tax_type: (data.tax_type as TaxType) || 'OTHER',
    title: data.title || '',
    description: data.description,
    competence_month: data.competence_month || now.slice(0, 7),
    due_date: data.due_date || now.slice(0, 10),
    paid_date: data.paid_date,
    status: data.status || 'open',
    amount_cents: data.amount_cents || 0,
    paid_amount_cents: data.paid_amount_cents || 0,
    supplier_id: data.supplier_id,
    client_id: data.client_id,
    contract_id: data.contract_id,
    project_id: data.project_id,
    cost_center_id: data.cost_center_id,
    linked_entry_id: data.linked_entry_id,
    linked_apar_title_id: data.linked_apar_title_id,
    source_document: data.source_document,
    invoice_number: data.invoice_number,
    notes: data.notes,
    created_by: 'user-admin-001',
    created_at: now,
    updated_at: now,
  };
  taxObligations = [obligation, ...taxObligations];
  addAudit('tax_obligation', obligation.id, 'created');
  return enrichTaxObligation(obligation);
}

export function updateTaxObligation(id: string, data: Partial<TaxObligation>): TaxObligation | undefined {
  const idx = taxObligations.findIndex(t => t.id === id);
  if (idx === -1) return undefined;
  const old = taxObligations[idx];
  if (old.status === 'paid' || old.status === 'cancelled') return undefined;
  const updated = { ...old, ...data, updated_at: new Date().toISOString() };
  taxObligations[idx] = updated;
  addAudit('tax_obligation', id, 'updated');
  return enrichTaxObligation(updated);
}

export function cancelTaxObligation(id: string, reason?: string): TaxObligation | undefined {
  const idx = taxObligations.findIndex(t => t.id === id);
  if (idx === -1) return undefined;
  const old = taxObligations[idx];
  if (old.status === 'paid' || old.status === 'cancelled') return undefined;
  const updated = { ...old, status: 'cancelled' as TaxStatus, updated_at: new Date().toISOString() };
  taxObligations[idx] = updated;
  addAudit('tax_obligation', id, 'voided', { status: { old: old.status, new: 'cancelled' } }, reason);
  return enrichTaxObligation(updated);
}

export type LinkTaxAccrualError =
  | 'obligation_not_found'
  | 'entry_not_found'
  | 'entry_not_pnl'        // entry is a clearing/cash leg, not a P&L recognition
  | 'competence_mismatch'; // entry competence ≠ obligation competence

export interface LinkTaxAccrualResult {
  obligation?: TaxObligation;
  error?: LinkTaxAccrualError;
}

/**
 * Link a TaxObligation to its P&L accrual LedgerEntry (the entry that
 * recognized the tax expense at competence). Stored in `accrual_entry_id`,
 * kept distinct from the cash settlement entries (linked_entry_id /
 * settlement_entry_ids) so recognition and payment never conflate.
 *
 * Validations:
 *   - the entry exists and belongs to a P&L group (NOT clearing) — accrual is
 *     economic recognition, a clearing/cash leg can never be an accrual;
 *   - the entry's competence matches the obligation's competence_month (when
 *     both are known) so the recognition lands in the right period.
 *
 * Idempotent and non-destructive: re-linking the same entry is a no-op success;
 * the cash-settlement linkage is never touched.
 */
export function linkTaxObligationToAccrual(obligationId: string, entryId: string): LinkTaxAccrualResult {
  const idx = taxObligations.findIndex(t => t.id === obligationId);
  if (idx === -1) return { error: 'obligation_not_found' };
  const obligation = taxObligations[idx];

  const entry = ledgerEntries.find(e => e.id === entryId);
  if (!entry) return { error: 'entry_not_found' };

  const cat = managementCategories.find(c => c.id === entry.category_id);
  // Must be a P&L recognition entry — reject clearing/cash legs (and entries
  // with no resolvable P&L category).
  if (!cat || isClearingGroup(cat.group_key) || !isPnlGroup(cat.group_key)) {
    return { error: 'entry_not_pnl' };
  }

  const entryCompetence = entry.competence_month || entry.period_key;
  if (obligation.competence_month && entryCompetence && obligation.competence_month !== entryCompetence) {
    return { error: 'competence_mismatch' };
  }

  if (obligation.accrual_entry_id === entryId) {
    return { obligation: enrichTaxObligation(obligation) }; // already linked
  }

  const updated: TaxObligation = { ...obligation, accrual_entry_id: entryId, updated_at: new Date().toISOString() };
  taxObligations[idx] = updated;
  addAudit('tax_obligation', obligationId, 'updated', { accrual_entry_id: { old: obligation.accrual_entry_id ?? null, new: entryId } });
  return { obligation: enrichTaxObligation(updated) };
}

export interface RecordTaxPaymentResult {
  obligation: TaxObligation;
  /** Cash LedgerEntry created for this settlement (undefined when nothing was applied). */
  entry?: LedgerEntry;
}

/**
 * Record a payment for a tax obligation and post the matching cash LedgerEntry.
 *
 * Accounting:
 *   - The TAX EXPENSE (accrual) is recognized at competence by a separate
 *     ledger entry with group_key='taxes' (already in the ledger). That hit
 *     the managerial DRE when posted.
 *   - This payment posts a CASH entry under group_key='clearing'
 *     (cat-f31 — DARF/GPS/Guia), which every P&L selector excludes. Net DRE
 *     impact of this call: zero. Net cash impact: −amount.
 *
 * Idempotent for repeat clicks: a 'paid'/'cancelled' obligation or a zero
 * remaining balance returns without creating a duplicate entry. Traceability:
 * the cash entry carries source_ref=obligation.id and metadata
 * { settlement_of, tax_obligation_id, tax_type }.
 */
export function recordTaxPayment(id: string, amountCents?: number, paymentDate?: string): RecordTaxPaymentResult | undefined {
  const idx = taxObligations.findIndex(t => t.id === id);
  if (idx === -1) return undefined;
  const obligation = taxObligations[idx];
  if (obligation.status === 'cancelled' || obligation.status === 'paid') {
    return { obligation: enrichTaxObligation(obligation) };
  }

  const remaining = Math.max(0, obligation.amount_cents - obligation.paid_amount_cents);
  const applied = amountCents === undefined ? remaining : Math.min(Math.max(0, amountCents), remaining);
  if (applied <= 0) return { obligation: enrichTaxObligation(obligation) };

  const now = new Date().toISOString();
  const payDate = paymentDate || now.slice(0, 10);
  const period = payDate.slice(0, 7);

  const entry = createLedgerEntry({
    entry_date: payDate,
    competence_month: period,
    description: `Pagamento ${obligation.tax_type} — ${obligation.title}`,
    amount_cents: applied,
    category_id: TAX_SETTLEMENT_CATEGORY,
    cost_center_id: obligation.cost_center_id || DEFAULT_TAX_CC,
    project_id: obligation.project_id,
    contract_id: obligation.contract_id,
    client_id: obligation.client_id,
    business_unit_id: DEFAULT_TAX_BU,
    entry_type: 'actual',
    status: 'reconciled',
    evidence_provided: true,
    source_system: 'other',
    source_ref: obligation.id,
    account: 'caixa',
    metadata: { settlement_of: obligation.id, tax_obligation_id: obligation.id, tax_type: obligation.tax_type },
  });

  const newPaid = obligation.paid_amount_cents + applied;
  const fullySettled = newPaid >= obligation.amount_cents;
  const updated: TaxObligation = {
    ...obligation,
    paid_amount_cents: newPaid,
    paid_date: payDate,
    status: fullySettled ? 'paid' : 'partial',
    linked_entry_id: obligation.linked_entry_id ?? entry.id,
    settlement_entry_ids: [...(obligation.settlement_entry_ids ?? []), entry.id],
    updated_at: now,
  };
  taxObligations[idx] = updated;

  addAudit('tax_obligation', id, 'status_changed', { status: { old: obligation.status, new: updated.status } });

  return { obligation: enrichTaxObligation(updated), entry };
}

// ── Dashboard Aggregations ──────────────────────────────────

export function computePnL(periodFrom: string, periodTo: string, entryType: LedgerEntryType | 'all' = 'actual'): PnLRow[] {
  const entries = ledgerEntries.filter(e =>
    e.period_key >= periodFrom && e.period_key <= periodTo &&
    (e.status === 'posted' || e.status === 'reconciled')
  );

  const groups: Record<string, { actual: number; budget: number; forecast: number }> = {
    revenue: { actual: 0, budget: 0, forecast: 0 },
    cogs: { actual: 0, budget: 0, forecast: 0 },
    opex: { actual: 0, budget: 0, forecast: 0 },
    financial: { actual: 0, budget: 0, forecast: 0 },
    taxes: { actual: 0, budget: 0, forecast: 0 },
  };

  entries.forEach(e => {
    const cat = managementCategories.find(c => c.id === e.category_id);
    if (!cat || !isPnlGroup(cat.group_key)) return; // exclude clearing/treasury
    const gk = cat.group_key;
    const signed = e.amount_cents * cat.sign;
    if (e.entry_type === 'actual') groups[gk].actual += signed;
    else if (e.entry_type === 'budget') groups[gk].budget += signed;
    else if (e.entry_type === 'forecast') groups[gk].forecast += signed;
  });

  const labels: Record<string, string> = {
    revenue: 'Receita', cogs: 'Custos Diretos', opex: 'Despesas Operacionais', financial: 'Financeiro', taxes: 'Tributos',
  };

  return Object.entries(groups).map(([key, vals]) => ({
    group_key: key as any,
    group_label: labels[key],
    actual: vals.actual,
    budget: vals.budget,
    forecast: vals.forecast,
    variance_abs: vals.actual - vals.budget,
    variance_pct: vals.budget !== 0 ? ((vals.actual - vals.budget) / Math.abs(vals.budget)) * 100 : 0,
  }));
}

export function computeCostStackMonthly(periodFrom: string, periodTo: string): CostStackMonth[] {
  const entries = ledgerEntries.filter(e =>
    e.period_key >= periodFrom && e.period_key <= periodTo &&
    e.entry_type === 'actual' && (e.status === 'posted' || e.status === 'reconciled')
  );

  const byMonth = new Map<string, CostStackMonth>();
  entries.forEach(e => {
    const cat = managementCategories.find(c => c.id === e.category_id);
    if (!cat || !isPnlGroup(cat.group_key)) return; // exclude clearing/treasury
    if (!byMonth.has(e.period_key)) byMonth.set(e.period_key, { period_key: e.period_key, revenue: 0, cogs: 0, opex: 0, financial: 0, taxes: 0 });
    const m = byMonth.get(e.period_key)!;
    const signed = e.amount_cents * cat.sign;
    m[cat.group_key as Exclude<ManagementGroupKey, 'clearing'>] += signed;
  });

  return Array.from(byMonth.values()).sort((a, b) => a.period_key.localeCompare(b.period_key));
}

export function computeMarginByProject(periodFrom: string, periodTo: string): ProjectMargin[] {
  const entries = ledgerEntries.filter(e =>
    e.project_id && e.period_key >= periodFrom && e.period_key <= periodTo &&
    e.entry_type === 'actual' && (e.status === 'posted' || e.status === 'reconciled')
  );

  const byProject = new Map<string, { revenue: number; cogs: number; name: string }>();
  entries.forEach(e => {
    const cat = managementCategories.find(c => c.id === e.category_id);
    if (!cat || !e.project_id) return;
    if (!byProject.has(e.project_id)) byProject.set(e.project_id, { revenue: 0, cogs: 0, name: e.project_name || e.project_id });
    const p = byProject.get(e.project_id)!;
    const signed = e.amount_cents * cat.sign;
    if (cat.group_key === 'revenue') p.revenue += signed;
    if (cat.group_key === 'cogs') p.cogs += signed;
  });

  return Array.from(byProject.entries())
    .map(([id, vals]) => ({
      project_id: id,
      project_name: vals.name,
      revenue: vals.revenue,
      cogs: vals.cogs,
      margin_pct: vals.revenue !== 0 ? ((vals.revenue + vals.cogs) / vals.revenue) * 100 : 0,
    }))
    .sort((a, b) => b.margin_pct - a.margin_pct);
}

export function computeDataQuality(periodKey: string): DataQualityIndicator[] {
  const entries = ledgerEntries.filter(e => e.period_key === periodKey && e.entry_type === 'actual');
  const total = entries.length || 1;

  const requiresProject = entries.filter(e => {
    const cat = managementCategories.find(c => c.id === e.category_id);
    return cat?.requires_project && !e.project_id;
  });
  const missingPct = (requiresProject.length / total) * 100;

  const pendingEvidence = entries.filter(e => e.evidence_required && !e.evidence_provided);
  const staleDrafts = entries.filter(e => {
    if (e.status !== 'draft') return false;
    const created = new Date(e.created_at).getTime();
    return Date.now() - created > 5 * 24 * 60 * 60 * 1000;
  });

  return [
    { key: 'missing_dimensions', label: 'Dimensões Faltantes', value: Math.round(missingPct * 10) / 10, threshold_green: 5, threshold_yellow: 15, status: missingPct < 5 ? 'green' : missingPct < 15 ? 'yellow' : 'red' },
    { key: 'pending_evidence', label: 'Evidências Pendentes', value: pendingEvidence.length, threshold_green: 0.5, threshold_yellow: 1, status: pendingEvidence.length === 0 ? 'green' : 'red' },
    { key: 'stale_drafts', label: 'Rascunhos > 5 dias', value: staleDrafts.length, threshold_green: 0.5, threshold_yellow: 1, status: staleDrafts.length === 0 ? 'green' : 'yellow' },
    { key: 'duplicates', label: 'Duplicatas Potenciais', value: 0, threshold_green: 0.5, threshold_yellow: 1, status: 'green' },
  ];
}

export function computeAgingBuckets(): AgingBucket[] {
  const today = new Date();
  const buckets: AgingBucket[] = [
    { label: 'A Vencer', payable: 0, receivable: 0 },
    { label: '1-30 dias', payable: 0, receivable: 0 },
    { label: '31-60 dias', payable: 0, receivable: 0 },
    { label: '61-90 dias', payable: 0, receivable: 0 },
    { label: '90+ dias', payable: 0, receivable: 0 },
  ];

  aparTitles.filter(t => t.status === 'open' || t.status === 'overdue' || t.status === 'partial').forEach(t => {
    const due = new Date(t.due_date);
    const days = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
    const remaining = t.amount_cents - t.paid_amount_cents;
    const key = t.type === 'payable' ? 'payable' : 'receivable';

    if (days < 0) buckets[0][key] += remaining;
    else if (days <= 30) buckets[1][key] += remaining;
    else if (days <= 60) buckets[2][key] += remaining;
    else if (days <= 90) buckets[3][key] += remaining;
    else buckets[4][key] += remaining;
  });

  return buckets;
}

export function getPendingActionCount(): number {
  return ledgerEntries.filter(e => e.status === 'draft' || e.status === 'in_review').length;
}

export function computeTopDrivers(periodFrom: string, periodTo: string, limit = 10): TopDriver[] {
  const entries = ledgerEntries.filter(e =>
    e.period_key >= periodFrom && e.period_key <= periodTo &&
    (e.status === 'posted' || e.status === 'reconciled')
  );

  // Group by L2 category (parent of L3)
  const byCat = new Map<string, { actual: number; budget: number; cat: ManagementCategory; project_id?: string; project_name?: string }>();

  entries.forEach(e => {
    const cat = managementCategories.find(c => c.id === e.category_id);
    if (!cat || !isPnlGroup(cat.group_key)) return; // exclude clearing/treasury
    // Find L2 parent (or use self if already L2)
    const l2 = cat.level === 3
      ? managementCategories.find(c => c.id === cat.parent_id) || cat
      : cat;
    const key = `${l2.id}::${e.project_id || '_corp'}`;
    const signed = e.amount_cents * cat.sign;

    if (!byCat.has(key)) {
      byCat.set(key, { actual: 0, budget: 0, cat: l2, project_id: e.project_id, project_name: e.project_name });
    }
    const row = byCat.get(key)!;
    if (e.entry_type === 'actual') row.actual += signed;
    else if (e.entry_type === 'budget') row.budget += signed;
  });

  const rows = Array.from(byCat.values()).map(r => ({
    category_id: r.cat.id,
    category_name: r.cat.name,
    group_key: r.cat.group_key,
    group_label: { revenue: 'A. Receita', cogs: 'B. Custos Diretos', opex: 'C. Despesas Operacionais', financial: 'D. Financeiro', taxes: 'E. Tributos', clearing: 'F. Tesouraria' }[r.cat.group_key],
    project_id: r.project_id,
    project_name: r.project_name || (r.project_id ? r.project_id : 'Corporativo'),
    actual: r.actual,
    budget: r.budget,
    variance_abs: r.actual - r.budget,
    variance_pct: r.budget !== 0 ? ((r.actual - r.budget) / Math.abs(r.budget)) * 100 : 0,
  }));

  const totalAbsVariance = rows.reduce((sum, r) => sum + Math.abs(r.variance_abs), 0) || 1;

  return rows
    .filter(r => r.variance_abs !== 0)
    .sort((a, b) => Math.abs(b.variance_abs) - Math.abs(a.variance_abs))
    .slice(0, limit)
    .map((r, i) => ({
      ...r,
      rank: i + 1,
      contribution_pct: (Math.abs(r.variance_abs) / totalAbsVariance) * 100,
    }));
}

/**
 * Whole-module integrity report — scans every finance entity for missing
 * dimensions and broken links. Gathers the in-memory state and delegates to
 * the pure selectFinanceDataQuality selector. Supabase-ready: the future
 * repository can feed the same shape from real queries.
 */
export function getFinanceDataQualityReport(opts?: { unmappedProjectIds?: string[] }): FinanceDataQualityReport {
  return selectFinanceDataQuality({
    ledger: ledgerEntries,
    apar: aparTitles,
    taxes: taxObligations,
    payroll: payrollAllocations,
    categories: managementCategories,
    isClearingGroup: (g) => isClearingGroup(g as ManagementGroupKey),
    today: FINANCE_TODAY,
    // Project↔finance mapping lives in the projects domain; callers there pass
    // selectProjectsWithoutFinanceMapping(getProjectsV2()) when available.
    unmappedProjectIds: opts?.unmappedProjectIds,
  });
}

export function getPendingActions(): PendingAction[] {
  const now = Date.now();
  return ledgerEntries
    .filter(e => e.status === 'in_review')
    .map(e => {
      const cat = managementCategories.find(c => c.id === e.category_id);
      return {
        id: e.id,
        description: e.description,
        category_name: cat?.name || e.category_id,
        period_key: e.period_key,
        amount_cents: e.amount_cents,
        aging_days: Math.floor((now - new Date(e.created_at).getTime()) / (1000 * 60 * 60 * 24)),
        created_by: e.created_by,
        status: e.status,
      };
    })
    .sort((a, b) => Math.abs(b.amount_cents) - Math.abs(a.amount_cents));
}
