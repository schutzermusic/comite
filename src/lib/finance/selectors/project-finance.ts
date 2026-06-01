/**
 * Project detail financial selectors — ledger-derived BAC / AC / EAC / ETC,
 * cost & revenue breakdowns and S-curves for the project detail FinanceView.
 *
 * Everything here derives from the unified Finance ledger filtered by
 * project_id, using the SAME shared cost rule as Projects & Margins
 * (isProjectActualCost / projectCostBucket in project-allocation). So the
 * project detail tab and the portfolio page always agree.
 *
 * Accounting rules:
 *   - Budget entries (entry_type='budget') feed BAC.
 *   - Actual posted/reconciled P&L entries feed AC and realized revenue.
 *   - Forecast entries (entry_type='forecast') feed EAC; ETC = EAC − AC.
 *   - Clearing/treasury entries never feed project cost (only "received" cash).
 *   - Pending pre-project costs (no project_id) are excluded — surfaced
 *     separately via selectPendingProjectCostsForProject.
 */

import type { LedgerEntry, ManagementCategory } from '@/lib/types/finance';
import { managementCategories } from '@/data/finance/seed-categories';
import { projects as projectRefs, contracts as contractRefs, type ProjectRef } from '@/data/finance/reference';
import {
  isProjectCostEntry, isProjectActualCost, isSettledEntry, projectCostBucket, entryReais,
  isProjectRevenueEntry, isProjectActualRevenue,
  selectProjectFinancialSummary, selectPendingProjectCostsForProject,
  type ProjectFinancialSummary, type PendingProjectCosts, type ProjectCostBucket,
} from './project-allocation';

const catOf = (e: LedgerEntry): ManagementCategory | undefined =>
  managementCategories.find(c => c.id === e.category_id);
const isClearing = (e: LedgerEntry): boolean => catOf(e)?.group_key === 'clearing';
/** Clearing cash-in (sign +1) settlement — feeds "received", never revenue. */
const isReceivedCashIn = (e: LedgerEntry): boolean =>
  isClearing(e) && (catOf(e)?.sign ?? 0) > 0 && isSettledEntry(e);
const reaisAbs = (e: LedgerEntry): number => entryReais(e);

// ── BAC / AC / EAC / ETC ───────────────────────────────────────────

export interface ProjectBudgetActualForecast {
  /** Budget at Completion — Σ budget project-cost entries (reais). */
  bac: number;
  /** Actual Cost — Σ posted/reconciled actual project cost (reais). */
  ac: number;
  /** Estimate at Completion — Σ forecast project cost (falls back to AC) (reais). */
  eac: number;
  /** Estimate to Complete — max(0, EAC − AC) (reais). */
  etc: number;
  /** EAC − BAC (reais). */
  variance: number;
  variancePct: number;
}

export function selectProjectBudgetActualForecast(entries: LedgerEntry[], projectId: string): ProjectBudgetActualForecast {
  let bac = 0, ac = 0, eacForecast = 0;
  let hasForecast = false;
  for (const e of entries) {
    if (e.project_id !== projectId || e.status === 'void') continue;
    if (!isProjectCostEntry(e)) continue;
    if (e.entry_type === 'budget') bac += reaisAbs(e);
    else if (e.entry_type === 'forecast') { eacForecast += reaisAbs(e); hasForecast = true; }
    else if (isProjectActualCost(e)) ac += reaisAbs(e);
  }
  const eac = hasForecast ? eacForecast : ac;
  const etc = Math.max(0, eac - ac);
  const variance = eac - bac;
  return { bac, ac, eac, etc, variance, variancePct: bac > 0 ? (variance / bac) * 100 : 0 };
}

// ── Cost breakdown by bucket ───────────────────────────────────────

export interface ProjectCostBreakdownRow {
  category: ProjectCostBucket;
  bac: number;
  ac: number;
  eac: number;
}

export function selectProjectCostBreakdown(entries: LedgerEntry[], projectId: string): ProjectCostBreakdownRow[] {
  const map = new Map<ProjectCostBucket, ProjectCostBreakdownRow>();
  const ensure = (k: ProjectCostBucket) =>
    map.get(k) ?? (map.set(k, { category: k, bac: 0, ac: 0, eac: 0 }), map.get(k)!);

  for (const e of entries) {
    if (e.project_id !== projectId || e.status === 'void') continue;
    if (!isProjectCostEntry(e)) continue;
    const row = ensure(projectCostBucket(e));
    if (e.entry_type === 'budget') row.bac += reaisAbs(e);
    else if (e.entry_type === 'forecast') row.eac += reaisAbs(e);
    else if (isProjectActualCost(e)) row.ac += reaisAbs(e);
  }
  // EAC falls back to AC for buckets without a forecast line.
  for (const row of map.values()) if (row.eac === 0) row.eac = row.ac;
  return Array.from(map.values()).sort((a, b) => b.eac - a.eac);
}

// ── Revenue breakdown ──────────────────────────────────────────────

export interface ProjectRevenueBreakdown {
  /** Contracted ceiling from the linked contract (reais). */
  contracted: number;
  /** Realized (posted/reconciled actual) revenue (reais). */
  billed: number;
  /** Cash received — clearing cash-in tied to the project (reais). */
  received: number;
  toBill: number;
  toReceive: number;
}

export function selectProjectRevenueBreakdown(
  entries: LedgerEntry[],
  projectId: string,
  refs: ProjectRef[] = projectRefs,
): ProjectRevenueBreakdown {
  let billed = 0, received = 0;
  for (const e of entries) {
    if (e.project_id !== projectId || e.status === 'void') continue;
    if (isProjectActualRevenue(e)) billed += reaisAbs(e);
    // Cash received = clearing cash-in (sign +1) settlements on the project.
    if (isReceivedCashIn(e)) received += reaisAbs(e);
  }
  const project = refs.find(p => p.id === projectId);
  const contract = project?.contract_id ? contractRefs.find(c => c.id === project.contract_id) : undefined;
  const contracted = contract ? contract.total_value_cents / 100 : billed;
  return {
    contracted,
    billed,
    received,
    toBill: Math.max(0, contracted - billed),
    toReceive: Math.max(0, billed - received),
  };
}

// ── S-curves (cumulative) ──────────────────────────────────────────

export interface ProjectCostCurvePoint { period: string; BAC: number; AC: number | null; EAC: number; }
export interface ProjectRevenueCurvePoint { period: string; planned: number; billed: number | null; received: number | null; }

export interface ProjectSCurve {
  cost: ProjectCostCurvePoint[];
  revenue: ProjectRevenueCurvePoint[];
  cutoffPeriod: string;
}

function sortedPeriods(set: Set<string>): string[] {
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function selectProjectSCurve(entries: LedgerEntry[], projectId: string): ProjectSCurve {
  // Per-period buckets for cost and revenue.
  const cost = new Map<string, { budget: number; actual: number; forecast: number }>();
  const rev = new Map<string, { planned: number; billed: number; received: number }>();
  const periods = new Set<string>();
  let cutoff = '';

  for (const e of entries) {
    if (e.project_id !== projectId || e.status === 'void') continue;
    const pk = e.period_key;
    if (isProjectCostEntry(e)) {
      periods.add(pk);
      const c = cost.get(pk) ?? { budget: 0, actual: 0, forecast: 0 };
      if (e.entry_type === 'budget') c.budget += reaisAbs(e);
      else if (e.entry_type === 'forecast') c.forecast += reaisAbs(e);
      else if (isProjectActualCost(e)) { c.actual += reaisAbs(e); if (pk > cutoff) cutoff = pk; }
      cost.set(pk, c);
    } else if (isProjectRevenueEntry(e)) {
      periods.add(pk);
      const r = rev.get(pk) ?? { planned: 0, billed: 0, received: 0 };
      if (e.entry_type === 'budget') r.planned += reaisAbs(e);
      else if (isProjectActualRevenue(e)) r.billed += reaisAbs(e);
      rev.set(pk, r);
    } else if (isReceivedCashIn(e)) {
      periods.add(pk);
      const r = rev.get(pk) ?? { planned: 0, billed: 0, received: 0 };
      r.received += reaisAbs(e);
      rev.set(pk, r);
    }
  }

  const ordered = sortedPeriods(periods);
  if (!cutoff && ordered.length) cutoff = ordered[ordered.length - 1];

  let cBac = 0, cAc = 0, cEac = 0;
  const costCurve: ProjectCostCurvePoint[] = ordered.map(pk => {
    const c = cost.get(pk) ?? { budget: 0, actual: 0, forecast: 0 };
    cBac += c.budget;
    cAc += c.actual;
    cEac += c.forecast || c.actual || c.budget;
    return { period: pk, BAC: cBac, AC: pk <= cutoff ? cAc : null, EAC: cEac };
  });

  let rPlanned = 0, rBilled = 0, rReceived = 0;
  const revenueCurve: ProjectRevenueCurvePoint[] = ordered.map(pk => {
    const r = rev.get(pk) ?? { planned: 0, billed: 0, received: 0 };
    rPlanned += r.planned;
    rBilled += r.billed;
    rReceived += r.received;
    return { period: pk, planned: rPlanned, billed: pk <= cutoff ? rBilled : null, received: pk <= cutoff ? rReceived : null };
  });

  return { cost: costCurve, revenue: revenueCurve, cutoffPeriod: cutoff };
}

// ── Composite view for the project detail FinanceView ──────────────

export interface ProjectFinanceView {
  projectId: string;
  summary: ProjectFinancialSummary;
  baf: ProjectBudgetActualForecast;
  costBreakdown: ProjectCostBreakdownRow[];
  revenue: ProjectRevenueBreakdown;
  sCurve: ProjectSCurve;
  pending: PendingProjectCosts;
  /** True when the project has any ledger data (cost or revenue). */
  hasLedgerData: boolean;
}

export function selectProjectFinanceView(
  entries: LedgerEntry[],
  projectId: string,
  refs: ProjectRef[] = projectRefs,
): ProjectFinanceView {
  const baf = selectProjectBudgetActualForecast(entries, projectId);
  const summary = selectProjectFinancialSummary(entries, projectId, refs);
  const costBreakdown = selectProjectCostBreakdown(entries, projectId);
  const revenue = selectProjectRevenueBreakdown(entries, projectId, refs);
  const sCurve = selectProjectSCurve(entries, projectId);
  const pending = selectPendingProjectCostsForProject(entries, projectId, refs);
  const hasLedgerData = baf.ac > 0 || baf.bac > 0 || revenue.billed > 0 || summary.officialEntryCount > 0;
  return { projectId, summary, baf, costBreakdown, revenue, sCurve, pending, hasLedgerData };
}
