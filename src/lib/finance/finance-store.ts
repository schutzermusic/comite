/**
 * Finance Module — Client-side data store (mock-backed, Supabase-ready).
 * All mutations go through this layer so switching to real API is a single-point change.
 */

import type {
  LedgerEntry, LedgerEntryStatus, LedgerEntryType,
  PayrollBatch, AllocationRule, AllocationResult,
  PeriodClose, APARTitle, FinanceAuditLog,
  ManagementCategory, BusinessUnit, CostCenter, Supplier, Client,
  FinanceFilters, PnLRow, CostStackMonth, ProjectMargin, DataQualityIndicator, AgingBucket,
  TopDriver, PendingAction,
} from '@/lib/types/finance';
import {
  mockLedgerEntries, mockPayrollBatches, mockAllocationRules,
  mockAllocationResults, mockPeriodCloses, mockAPARTitles,
} from '@/data/finance/mock-ledger';
import {
  managementCategories, businessUnits, costCenters, suppliers, clients,
  findCategoryByCode,
} from '@/data/finance/seed-categories';

let ledgerEntries = [...mockLedgerEntries];
let payrollBatches = [...mockPayrollBatches];
let allocationRules = [...mockAllocationRules];
let allocationResults = [...mockAllocationResults];
let periodCloses = [...mockPeriodCloses];
let aparTitles = [...mockAPARTitles];
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
export function getSuppliers(): Supplier[] { return suppliers; }
export function getClients(): Client[] { return clients; }
export function getAuditLog(entityType?: string, entityId?: string): FinanceAuditLog[] {
  if (entityType && entityId) return auditLog.filter(a => a.entity_type === entityType && a.entity_id === entityId);
  return auditLog;
}

// ── Ledger Entries ──────────────────────────────────────────

function enrichEntry(e: LedgerEntry): LedgerEntry {
  return {
    ...e,
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
  const entry: LedgerEntry = {
    id: generateId(),
    entry_date: data.entry_date || now.slice(0, 10),
    description: data.description || '',
    amount_cents: data.amount_cents || 0,
    currency: 'BRL',
    category_id: data.category_id || '',
    cost_center_id: data.cost_center_id || '',
    project_id: data.project_id,
    contract_id: data.contract_id,
    supplier_id: data.supplier_id,
    client_id: data.client_id,
    business_unit_id: data.business_unit_id || '',
    period_key: data.entry_date ? data.entry_date.slice(0, 7) : now.slice(0, 7),
    entry_type: data.entry_type || 'actual',
    status: 'draft',
    source_system: data.source_system || 'manual',
    evidence_required: (data.amount_cents || 0) >= 500000,
    evidence_provided: false,
    template_key: data.template_key,
    tags: data.tags,
    metadata: data.metadata,
    created_by: 'user-admin-001',
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
  if (updated.entry_date) updated.period_key = updated.entry_date.slice(0, 7);
  if (updated.amount_cents >= 500000) updated.evidence_required = true;

  ledgerEntries[idx] = updated;
  addAudit('ledger_entry', id, 'updated');
  return enrichEntry(updated);
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

export function approvePayrollBatch(id: string): PayrollBatch | undefined {
  const idx = payrollBatches.findIndex(b => b.id === id);
  if (idx === -1) return undefined;
  const now = new Date().toISOString();
  payrollBatches[idx] = { ...payrollBatches[idx], status: 'approved', approved_by: 'user-admin-001', approved_at: now, updated_at: now };
  addAudit('payroll_batch', id, 'approved');
  return payrollBatches[idx];
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

export function getAPARTitles(type?: 'payable' | 'receivable'): APARTitle[] {
  let result = aparTitles;
  if (type) result = result.filter(t => t.type === type);
  return result.map(t => ({
    ...t,
    supplier: suppliers.find(s => s.id === t.supplier_id),
    client: clients.find(c => c.id === t.client_id),
  }));
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
  return title;
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
    if (!cat) return;
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
    if (!cat) return;
    if (!byMonth.has(e.period_key)) byMonth.set(e.period_key, { period_key: e.period_key, revenue: 0, cogs: 0, opex: 0, financial: 0, taxes: 0 });
    const m = byMonth.get(e.period_key)!;
    const signed = e.amount_cents * cat.sign;
    m[cat.group_key] += signed;
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
    if (!cat) return;
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
    group_label: { revenue: 'A. Receita', cogs: 'B. Custos Diretos', opex: 'C. Despesas Operacionais', financial: 'D. Financeiro', taxes: 'E. Tributos' }[r.cat.group_key],
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
