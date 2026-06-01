/**
 * Payroll allocation selectors.
 *
 * Source of truth: PayrollAllocation entities held in finance-store
 * (getPayrollAllocations). Each row is one (employee, competence) line carrying
 * the employee's fully-loaded cost (total_cost_cents) and the portion directed
 * to a project (allocated_amount_cents). One row per employee per competence,
 * so totals never double-count an employee.
 *
 * Accounting note: posting an allocation recognizes its allocated cost in the
 * managerial DRE under a P&L folha category (COGS direct / OPEX indirect),
 * never the clearing group — see [[finance-store.postPayrollAllocation]].
 * These selectors derive only from the allocation entities, so they stay
 * consistent whether or not the cost has been posted to the ledger yet.
 */

import type { PayrollAllocation, PayrollAllocationStatus, PayrollBatch } from '@/lib/types/finance';

const isLive = (a: PayrollAllocation) => a.status !== 'cancelled';

/** Fully-loaded cost of a payroll batch (gross + employer charges + benefits). */
export function payrollBatchTotalCents(b: PayrollBatch): number {
  return b.total_gross_cents + b.total_charges_cents + b.total_benefits_cents;
}

// ── Summary KPIs ───────────────────────────────────────────────────

export interface PayrollSummary {
  /** Fully-loaded payroll cost in scope (cents). */
  totalCost: number;
  /** Cost directed to projects/cost centers (cents). */
  allocatedCost: number;
  /** Structural / idle remainder = total − allocated (cents). */
  unallocatedCost: number;
  /** allocatedCost / totalCost * 100. */
  allocationRate: number;
  /** Distinct employees (live allocations). */
  headcount: number;
  /** totalCost / headcount (cents). */
  avgCostPerEmployee: number;
  /** Sum of gross / taxes / benefits (cents). */
  grossTotal: number;
  taxesTotal: number;
  benefitsTotal: number;
  /** Cost already recognized in the DRE (status = posted) (cents). */
  postedCost: number;
  /** Live cost not yet posted (cents). */
  pendingCost: number;
  /** Counts by lifecycle. */
  postedCount: number;
  pendingCount: number;
  cancelledCount: number;
}

export function selectPayrollSummary(allocs: PayrollAllocation[]): PayrollSummary {
  let totalCost = 0, allocatedCost = 0, grossTotal = 0, taxesTotal = 0, benefitsTotal = 0;
  let postedCost = 0, pendingCost = 0;
  let postedCount = 0, pendingCount = 0, cancelledCount = 0;
  const employees = new Set<string>();

  for (const a of allocs) {
    if (a.status === 'cancelled') { cancelledCount += 1; continue; }
    totalCost += a.total_cost_cents;
    allocatedCost += a.allocated_amount_cents;
    grossTotal += a.gross_amount_cents;
    taxesTotal += a.taxes_amount_cents;
    benefitsTotal += a.benefits_amount_cents;
    employees.add(a.employee_id);
    if (a.status === 'posted') { postedCost += a.allocated_amount_cents; postedCount += 1; }
    else { pendingCost += a.allocated_amount_cents; pendingCount += 1; }
  }

  const headcount = employees.size;
  const unallocatedCost = Math.max(0, totalCost - allocatedCost);
  return {
    totalCost,
    allocatedCost,
    unallocatedCost,
    allocationRate: totalCost > 0 ? (allocatedCost / totalCost) * 100 : 0,
    headcount,
    avgCostPerEmployee: headcount > 0 ? Math.round(totalCost / headcount) : 0,
    grossTotal,
    taxesTotal,
    benefitsTotal,
    postedCost,
    pendingCost,
    postedCount,
    pendingCount,
    cancelledCount,
  };
}

// ── Roll-up rows ───────────────────────────────────────────────────

export interface PayrollGroupRow {
  key: string;
  label: string;
  totalCost: number;
  allocatedCost: number;
  unallocatedCost: number;
  headcount: number;
  /** allocatedCost share of the scope's allocated total (0–100). */
  sharePct: number;
}

function rollup(
  allocs: PayrollAllocation[],
  keyOf: (a: PayrollAllocation) => string | undefined,
  labelOf: (a: PayrollAllocation) => string,
  fallback: { key: string; label: string },
): PayrollGroupRow[] {
  const map = new Map<string, PayrollGroupRow & { _emp: Set<string> }>();
  let allocatedScope = 0;
  for (const a of allocs) {
    if (!isLive(a)) continue;
    const key = keyOf(a) ?? fallback.key;
    const label = keyOf(a) ? labelOf(a) : fallback.label;
    const row = map.get(key) ?? { key, label, totalCost: 0, allocatedCost: 0, unallocatedCost: 0, headcount: 0, sharePct: 0, _emp: new Set<string>() };
    row.totalCost += a.total_cost_cents;
    row.allocatedCost += a.allocated_amount_cents;
    row._emp.add(a.employee_id);
    map.set(key, row);
    allocatedScope += a.allocated_amount_cents;
  }
  return Array.from(map.values())
    .map(({ _emp, ...r }) => ({
      ...r,
      headcount: _emp.size,
      unallocatedCost: Math.max(0, r.totalCost - r.allocatedCost),
      sharePct: allocatedScope > 0 ? (r.allocatedCost / allocatedScope) * 100 : 0,
    }))
    .sort((a, b) => b.allocatedCost - a.allocatedCost);
}

const UNALLOCATED = { key: '_none', label: 'Não alocado (estrutural)' };

export function selectPayrollByDepartment(allocs: PayrollAllocation[]): PayrollGroupRow[] {
  return rollup(allocs, a => a.department_id || undefined, a => a.department_name || a.department_id, { key: '_dept', label: 'Sem departamento' });
}

export function selectPayrollByProject(allocs: PayrollAllocation[]): PayrollGroupRow[] {
  return rollup(allocs, a => a.project_id, a => a.project_name || a.project_id || '', UNALLOCATED);
}

export function selectPayrollByCostCenter(allocs: PayrollAllocation[]): PayrollGroupRow[] {
  return rollup(allocs, a => a.cost_center_id, a => a.cost_center?.name || a.cost_center_id || '', { key: '_cc', label: 'Sem centro de custo' });
}

export function selectPayrollByContract(allocs: PayrollAllocation[]): PayrollGroupRow[] {
  return rollup(allocs, a => a.contract_id, a => a.contract_name || a.contract_id || '', UNALLOCATED);
}

export interface PayrollByCompetenceRow {
  competence_month: string;
  totalCost: number;
  allocatedCost: number;
  unallocatedCost: number;
  headcount: number;
}

export function selectPayrollByCompetence(allocs: PayrollAllocation[]): PayrollByCompetenceRow[] {
  const map = new Map<string, PayrollByCompetenceRow & { _emp: Set<string> }>();
  for (const a of allocs) {
    if (!isLive(a)) continue;
    const row = map.get(a.competence_month) ?? { competence_month: a.competence_month, totalCost: 0, allocatedCost: 0, unallocatedCost: 0, headcount: 0, _emp: new Set<string>() };
    row.totalCost += a.total_cost_cents;
    row.allocatedCost += a.allocated_amount_cents;
    row._emp.add(a.employee_id);
    map.set(a.competence_month, row);
  }
  return Array.from(map.values())
    .map(({ _emp, ...r }) => ({ ...r, headcount: _emp.size, unallocatedCost: Math.max(0, r.totalCost - r.allocatedCost) }))
    .sort((a, b) => a.competence_month.localeCompare(b.competence_month));
}

export interface PayrollByStatusRow {
  status: PayrollAllocationStatus;
  totalCost: number;
  allocatedCost: number;
  count: number;
}

export function selectPayrollByStatus(allocs: PayrollAllocation[]): PayrollByStatusRow[] {
  const order: PayrollAllocationStatus[] = ['draft', 'allocated', 'approved', 'posted', 'cancelled'];
  const map = new Map<PayrollAllocationStatus, PayrollByStatusRow>();
  for (const a of allocs) {
    const row = map.get(a.status) ?? { status: a.status, totalCost: 0, allocatedCost: 0, count: 0 };
    row.totalCost += a.total_cost_cents;
    row.allocatedCost += a.allocated_amount_cents;
    row.count += 1;
    map.set(a.status, row);
  }
  return order.filter(s => map.has(s)).map(s => map.get(s)!);
}

// ── Batch reconciliation ───────────────────────────────────────────
//
// Guards that allocated cost never exceeds the source payroll batch, and
// flags batches that are still under-allocated. Compares the sum of LIVE
// allocated_amount_cents per payroll_batch_id against the batch's fully-loaded
// total. Allocation amounts are status-independent, so the status here is a
// property of the whole batch — used both for display and to block
// approve/post in finance-store when a batch is over-allocated.

export type PayrollReconciliationStatus = 'fully_allocated' | 'underallocated' | 'overallocated';

export interface PayrollBatchReconciliation {
  batch_id: string;
  period_key: string;
  business_unit_id: string;
  /** gross + charges + benefits (cents). */
  batchTotalCents: number;
  /** Sum of allocated_amount_cents across live allocations (cents). */
  allocatedTotalCents: number;
  /** Sum of total_cost_cents across live allocations (cents). */
  loadedTotalCents: number;
  /** allocatedTotalCents − batchTotalCents (positive = over-allocated). */
  varianceCents: number;
  /** allocatedTotalCents / batchTotalCents * 100. */
  utilizationPct: number;
  status: PayrollReconciliationStatus;
  allocationCount: number;
  /** Distinct employees with a live allocation on the batch. */
  headcount: number;
}

/** Tolerance (cents) for treating a batch as fully allocated (rounding slack). */
const RECON_TOLERANCE_CENTS = 100;

function reconcile(batch: PayrollBatch, allocs: PayrollAllocation[]): PayrollBatchReconciliation {
  const live = allocs.filter(a => isLive(a) && a.payroll_batch_id === batch.id);
  const allocatedTotalCents = live.reduce((s, a) => s + a.allocated_amount_cents, 0);
  const loadedTotalCents = live.reduce((s, a) => s + a.total_cost_cents, 0);
  const batchTotalCents = payrollBatchTotalCents(batch);
  const varianceCents = allocatedTotalCents - batchTotalCents;
  const status: PayrollReconciliationStatus =
    varianceCents > RECON_TOLERANCE_CENTS ? 'overallocated'
      : varianceCents < -RECON_TOLERANCE_CENTS ? 'underallocated'
        : 'fully_allocated';
  return {
    batch_id: batch.id,
    period_key: batch.period_key,
    business_unit_id: batch.business_unit_id,
    batchTotalCents,
    allocatedTotalCents,
    loadedTotalCents,
    varianceCents,
    utilizationPct: batchTotalCents > 0 ? (allocatedTotalCents / batchTotalCents) * 100 : 0,
    status,
    allocationCount: live.length,
    headcount: new Set(live.map(a => a.employee_id)).size,
  };
}

/** Reconciliation rows for the given batches (one per batch). */
export function selectPayrollBatchReconciliation(allocs: PayrollAllocation[], batches: PayrollBatch[]): PayrollBatchReconciliation[] {
  return batches
    .map(b => reconcile(b, allocs))
    .sort((a, b) => b.batchTotalCents - a.batchTotalCents);
}

/** Reconciliation for a single batch (undefined when the batch is unknown). */
export function reconcilePayrollBatch(allocs: PayrollAllocation[], batch: PayrollBatch | undefined): PayrollBatchReconciliation | undefined {
  return batch ? reconcile(batch, allocs) : undefined;
}

/** True when a batch's live allocations exceed its fully-loaded total. */
export function isPayrollBatchOverallocated(allocs: PayrollAllocation[], batch: PayrollBatch | undefined): boolean {
  return !!batch && reconcile(batch, allocs).status === 'overallocated';
}

// ── Filtering / sorting helpers ────────────────────────────────────

export interface PayrollAllocationListFilter {
  competenceMonth?: string;
  status?: PayrollAllocationStatus | 'all';
  projectId?: string;
  costCenterId?: string;
  departmentId?: string;
  businessUnitId?: string;
}

export function filterPayrollAllocations(allocs: PayrollAllocation[], f: PayrollAllocationListFilter): PayrollAllocation[] {
  return allocs.filter(a => {
    if (f.competenceMonth && a.competence_month !== f.competenceMonth) return false;
    if (f.status && f.status !== 'all' && a.status !== f.status) return false;
    if (f.projectId && a.project_id !== f.projectId) return false;
    if (f.costCenterId && a.cost_center_id !== f.costCenterId) return false;
    if (f.departmentId && a.department_id !== f.departmentId) return false;
    if (f.businessUnitId && a.business_unit_id !== f.businessUnitId) return false;
    return true;
  });
}

export function sortPayrollByCost(allocs: PayrollAllocation[], dir: 'asc' | 'desc' = 'desc'): PayrollAllocation[] {
  return [...allocs].sort((a, b) =>
    dir === 'asc' ? a.total_cost_cents - b.total_cost_cents : b.total_cost_cents - a.total_cost_cents,
  );
}

/** True when the allocation can be approved (pending, has cost). */
export function canApprovePayroll(a: PayrollAllocation): boolean {
  return (a.status === 'draft' || a.status === 'allocated') && a.allocated_amount_cents > 0;
}

/** True when the allocation can be posted to the DRE (approved, has cost, not yet linked). */
export function canPostPayroll(a: PayrollAllocation): boolean {
  return a.status === 'approved' && a.allocated_amount_cents > 0 && !a.linked_entry_id;
}
