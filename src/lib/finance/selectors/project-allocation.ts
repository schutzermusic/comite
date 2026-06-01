/**
 * Project allocation selectors — pre-project cost handling.
 *
 * The finance ledger is the source of truth for project numbers. A cost can be
 * booked before its project exists (after a contract/opportunity but before
 * project setup); such entries carry contract_id but no project_id and are
 * treated as "pending project allocation".
 *
 * Rules enforced here:
 *   - Official project financials (AC / margin) count ONLY entries with a
 *     project_id that are posted/reconciled, actual, P&L (non-clearing).
 *   - Pending costs are surfaced separately by contract and never inflate the
 *     official AC until linked via finance-store.linkEntriesToProject.
 *   - Clearing/treasury entries are never counted as project cost.
 */

import type { LedgerEntry, ManagementCategory } from '@/lib/types/finance';
import { managementCategories } from '@/data/finance/seed-categories';
import { projects as projectRefs, type ProjectRef } from '@/data/finance/reference';

// ── Predicates ─────────────────────────────────────────────────────

const catOf = (e: LedgerEntry): ManagementCategory | undefined =>
  managementCategories.find(c => c.id === e.category_id);

/** Posted or reconciled — the only statuses that feed official numbers. */
function isSettled(e: LedgerEntry): boolean {
  return e.status === 'posted' || e.status === 'reconciled';
}

/** A P&L entry that is NOT clearing/treasury (clearing never counts as cost). */
function isPnlNonClearing(e: LedgerEntry): boolean {
  const cat = catOf(e);
  return !!cat && cat.group_key !== 'clearing';
}

/** Non-revenue P&L expense (cogs/opex/financial/taxes), excluding clearing. */
function isExpense(e: LedgerEntry): boolean {
  const cat = catOf(e);
  return !!cat && cat.group_key !== 'revenue' && cat.group_key !== 'clearing';
}

/** Absolute reais value of an entry (sign-normalized via category). */
function reais(e: LedgerEntry): number {
  const cat = catOf(e);
  const sign = cat?.sign ?? 1;
  return Math.abs((e.amount_cents * sign) / 100);
}

// ── Shared project-cost rule (single source of truth) ──────────────
//
// One definition reused by Projects & Margins, the project detail FinanceView
// and the financial summary. "Project cost" = ALL project-attributable P&L
// cost (COGS + payroll allocation + OPEX + financial + taxes), never clearing.

/** Project-attributable P&L cost entry, regardless of status/type. */
export function isProjectCostEntry(e: LedgerEntry): boolean {
  return isExpense(e); // non-revenue, non-clearing P&L
}

/** Official AC cost: a project cost that is posted/reconciled and actual. */
export function isProjectActualCost(e: LedgerEntry): boolean {
  return isProjectCostEntry(e) && e.entry_type === 'actual' && isSettled(e);
}

export type ProjectCostBucket = 'Custo direto' | 'Folha alocada' | 'OPEX' | 'Financeiro' | 'Tributos' | 'Outros';

/** Bucket a cost entry for the breakdown table (payroll split out from COGS). */
export function projectCostBucket(e: LedgerEntry): ProjectCostBucket {
  if (e.source_system === 'payroll_alloc') return 'Folha alocada';
  const cat = catOf(e);
  switch (cat?.group_key) {
    case 'cogs': return 'Custo direto';
    case 'opex': return 'OPEX';
    case 'financial': return 'Financeiro';
    case 'taxes': return 'Tributos';
    default: return 'Outros';
  }
}

/** Absolute reais value (exported for shared cost summation). */
export function entryReais(e: LedgerEntry): number {
  return reais(e);
}

// ── Shared project-revenue rule (single source of truth) ───────────
//
// Reused by Projects & Margins, the project FinanceView and the summary so
// realized revenue is identical everywhere. Clearing cash-in is NEVER revenue
// (it's a received/cash movement) — see isProjectActualRevenue exclusions.

const isRevenueCat = (e: LedgerEntry): boolean => catOf(e)?.group_key === 'revenue';

/** Any project P&L revenue entry (regardless of status/type). */
export function isProjectRevenueEntry(e: LedgerEntry): boolean {
  return isRevenueCat(e);
}

/** Official realized revenue: revenue group, actual, posted/reconciled. */
export function isProjectActualRevenue(e: LedgerEntry): boolean {
  return isRevenueCat(e) && e.entry_type === 'actual' && isSettled(e);
}

export { isSettled as isSettledEntry };

// ── Unallocated / pending entries ──────────────────────────────────

export interface UnallocatedFilter {
  /** Restrict to a single contract. */
  contractId?: string;
  /** 'pending_project' (has contract) | 'unallocated' (no contract) | 'any'. */
  kind?: 'pending_project' | 'unallocated' | 'any';
  /** Only posted/reconciled (what would actually feed AC on linking). */
  settledOnly?: boolean;
  /** Only actual entry_type (default true). */
  actualOnly?: boolean;
  /** Only P&L expense entries (default true — these are the costs to allocate). */
  expenseOnly?: boolean;
}

/**
 * Entries that lack a project_id. Clearing entries and voids are always
 * excluded. Defaults target the common case: actual P&L expense costs.
 */
export function selectUnallocatedFinanceEntries(entries: LedgerEntry[], filter: UnallocatedFilter = {}): LedgerEntry[] {
  const { contractId, kind = 'any', settledOnly = false, actualOnly = true, expenseOnly = true } = filter;
  return entries.filter(e => {
    if (e.project_id) return false;
    if (e.status === 'void') return false;
    if (!isPnlNonClearing(e)) return false;
    if (expenseOnly && !isExpense(e)) return false;
    if (actualOnly && e.entry_type !== 'actual') return false;
    if (settledOnly && !isSettled(e)) return false;
    if (contractId && e.contract_id !== contractId) return false;
    if (kind === 'pending_project' && !e.contract_id) return false;
    if (kind === 'unallocated' && e.contract_id) return false;
    return true;
  });
}

export interface PendingProjectCosts {
  contract_id: string;
  entries: LedgerEntry[];
  /** Total of all pending cost entries (reais). */
  totalCents: number;
  /** Subtotal that is posted/reconciled — what will hit AC once linked (reais=cents here are cents). */
  settledTotalCents: number;
  count: number;
  settledCount: number;
}

/** Pending (no project_id) cost entries tied to a contract. */
export function selectPendingProjectCostsByContract(entries: LedgerEntry[], contractId: string): PendingProjectCosts {
  const pending = selectUnallocatedFinanceEntries(entries, { contractId, kind: 'pending_project' });
  let totalCents = 0, settledTotalCents = 0, settledCount = 0;
  for (const e of pending) {
    const amt = Math.abs(e.amount_cents);
    totalCents += amt;
    if (isSettled(e)) { settledTotalCents += amt; settledCount += 1; }
  }
  return { contract_id: contractId, entries: pending, totalCents, settledTotalCents, count: pending.length, settledCount };
}

/** Pending costs for a project, resolved via the project's contract. */
export function selectPendingProjectCostsForProject(
  entries: LedgerEntry[],
  projectId: string,
  refs: ProjectRef[] = projectRefs,
): PendingProjectCosts {
  const project = refs.find(p => p.id === projectId);
  if (!project?.contract_id) {
    return { contract_id: project?.contract_id ?? '', entries: [], totalCents: 0, settledTotalCents: 0, count: 0, settledCount: 0 };
  }
  return selectPendingProjectCostsByContract(entries, project.contract_id);
}

// ── Official project financial summary ─────────────────────────────

export interface ProjectFinancialSummary {
  project_id: string;
  contract_id?: string;
  /** Official revenue — posted/reconciled actual revenue with this project_id (reais). */
  revenue: number;
  /** Official actual cost (AC) — posted/reconciled actual P&L expense with this project_id (reais). */
  actualCost: number;
  /** revenue − actualCost (reais). */
  margin: number;
  marginPct: number;
  /** Number of official (project-linked, settled, actual) entries counted. */
  officialEntryCount: number;
  /** Pending cost not yet in AC (reais), from the project's contract. */
  pendingCost: number;
  pendingCount: number;
}

/**
 * Official project financials from the ledger. Counts only project-linked,
 * posted/reconciled, actual, P&L (non-clearing) entries — pending costs are
 * reported separately and excluded from AC/margin.
 */
export function selectProjectFinancialSummary(
  entries: LedgerEntry[],
  projectId: string,
  refs: ProjectRef[] = projectRefs,
): ProjectFinancialSummary {
  let revenue = 0, actualCost = 0, officialEntryCount = 0;
  for (const e of entries) {
    if (e.project_id !== projectId) continue;
    if (e.entry_type !== 'actual' || !isSettled(e)) continue;
    const cat = catOf(e);
    if (!cat || cat.group_key === 'clearing') continue; // never count clearing
    if (cat.group_key === 'revenue') revenue += reais(e);
    else actualCost += reais(e);
    officialEntryCount += 1;
  }
  const pending = selectPendingProjectCostsForProject(entries, projectId, refs);
  const margin = revenue - actualCost;
  return {
    project_id: projectId,
    contract_id: refs.find(p => p.id === projectId)?.contract_id,
    revenue,
    actualCost,
    margin,
    marginPct: revenue > 0 ? (margin / revenue) * 100 : 0,
    officialEntryCount,
    pendingCost: pending.settledTotalCents / 100,
    pendingCount: pending.count,
  };
}
