/**
 * Category / subcategory analysis selectors.
 *
 * Answers the deep cost-analysis questions: spend by categoria, spend by
 * subcategoria, trends by month, breakdown by project / contract / cost center,
 * top cost drivers, the Mobilização breakdown and subcategory anomalies.
 *
 * Single source of truth: the unified Finance ledger + management-category
 * master data. Every selector here reuses the shared P&L cost rule
 * (isProjectActualCost = non-clearing, non-revenue, actual, settled) so the
 * numbers always agree with the DRE and project selectors, and clearing /
 * treasury entries never leak into managerial cost analysis.
 *
 * Components must consume these — never aggregate the ledger inline.
 */

import type { LedgerEntry, ManagementCategory } from '@/lib/types/finance';
import { mockLedgerEntries } from '@/data/finance/mock-ledger';
import { managementCategories, resolveCategoryPath, findCategoryById } from '@/data/finance/seed-categories';
import { contracts as contractRefs, projects as projectRefs } from '@/data/finance/reference';
import { costCenters } from '@/data/finance/seed-categories';
import { isProjectActualCost, entryReais } from './project-allocation';

const catOf = (e: LedgerEntry): ManagementCategory | undefined =>
  managementCategories.find(c => c.id === e.category_id);

// ── Shared filtering ────────────────────────────────────────

export interface CategoryAnalysisFilter {
  /** Inclusive period range (YYYY-MM). Omit for all periods. */
  periodFrom?: string;
  periodTo?: string;
  projectId?: string;
  contractId?: string;
  costCenterId?: string;
  /** Restrict to one L2 categoria id (for drill-down). */
  categoryId?: string;
}

function inRange(periodKey: string, from?: string, to?: string): boolean {
  if (from && periodKey < from) return false;
  if (to && periodKey > to) return false;
  return true;
}

/** Posted/settled actual P&L cost entries matching the filter (excludes clearing). */
function costEntries(entries: LedgerEntry[], filter: CategoryAnalysisFilter): LedgerEntry[] {
  return entries.filter((e) => {
    if (!isProjectActualCost(e)) return false;
    if (!inRange(e.period_key, filter.periodFrom, filter.periodTo)) return false;
    if (filter.projectId && filter.projectId !== 'all' && e.project_id !== filter.projectId) return false;
    if (filter.contractId && filter.contractId !== 'all' && e.contract_id !== filter.contractId) return false;
    if (filter.costCenterId && filter.costCenterId !== 'all' && e.cost_center_id !== filter.costCenterId) return false;
    if (filter.categoryId) {
      const path = catOf(e) ? resolveCategoryPath(catOf(e)!) : undefined;
      if (path?.categoryId !== filter.categoryId) return false;
    }
    return true;
  });
}

// ── Rows ────────────────────────────────────────────────────

export interface CategoryCostRow {
  /** L2 categoria id (or leaf id when category has no L2 parent). */
  id: string;
  code: string;
  name: string;
  groupKey: ManagementCategory['group_key'];
  value: number;
  /** Share of the total in this result set, 0..1. */
  share: number;
}

export interface SubcategoryCostRow extends CategoryCostRow {
  categoryId: string;
  categoryName: string;
}

export interface CategoryTrendPoint {
  period: string;
  value: number;
}

export interface CategoryTrendSeries {
  id: string;
  name: string;
  points: CategoryTrendPoint[];
  total: number;
}

export interface DimensionCostRow {
  /** Project / contract / cost-center id. */
  id: string;
  name: string;
  value: number;
  share: number;
}

export interface TopCostDriverRow {
  subcategoryId: string;
  subcategoryName: string;
  categoryName: string;
  groupKey: ManagementCategory['group_key'];
  value: number;
  share: number;
}

export interface SubcategoryAnomalyRow {
  subcategoryId: string;
  subcategoryName: string;
  categoryName: string;
  period: string;
  value: number;
  /** Trailing average of prior periods used as the baseline. */
  baseline: number;
  /** value / baseline − 1 (e.g. 0.8 = +80% vs baseline). */
  deviationPct: number;
}

function withShare<T extends { value: number }>(rows: T[]): Array<T & { share: number }> {
  const total = rows.reduce((s, r) => s + r.value, 0);
  return rows.map((r) => ({ ...r, share: total > 0 ? r.value / total : 0 }));
}

// ── 1) Cost by categoria (L2) ───────────────────────────────

export function selectCostByCategory(
  filter: CategoryAnalysisFilter = {},
  entries: LedgerEntry[] = mockLedgerEntries,
): CategoryCostRow[] {
  const map = new Map<string, Omit<CategoryCostRow, 'share'>>();
  for (const e of costEntries(entries, filter)) {
    const cat = catOf(e);
    if (!cat) continue;
    const path = resolveCategoryPath(cat);
    const l2 = findCategoryById(path.categoryId) ?? cat;
    const cur = map.get(path.categoryId) ?? {
      id: path.categoryId, code: l2.code, name: path.categoryName, groupKey: cat.group_key, value: 0,
    };
    cur.value += entryReais(e);
    map.set(path.categoryId, cur);
  }
  return withShare(Array.from(map.values())).sort((a, b) => b.value - a.value);
}

// ── 2) Cost by subcategoria (L3) ────────────────────────────

export function selectCostBySubcategory(
  filter: CategoryAnalysisFilter = {},
  entries: LedgerEntry[] = mockLedgerEntries,
): SubcategoryCostRow[] {
  const map = new Map<string, Omit<SubcategoryCostRow, 'share'>>();
  for (const e of costEntries(entries, filter)) {
    const cat = catOf(e);
    if (!cat) continue;
    const path = resolveCategoryPath(cat);
    // For L2/L1 entries with no subcategory, bucket under the category itself.
    const subId = path.subcategoryId ?? path.categoryId;
    const subName = path.subcategoryName ?? path.categoryName;
    const leaf = findCategoryById(subId) ?? cat;
    const cur = map.get(subId) ?? {
      id: subId, code: leaf.code, name: subName, groupKey: cat.group_key, value: 0,
      categoryId: path.categoryId, categoryName: path.categoryName,
    };
    cur.value += entryReais(e);
    map.set(subId, cur);
  }
  return withShare(Array.from(map.values())).sort((a, b) => b.value - a.value);
}

// ── 3) Categoria trend by month ─────────────────────────────

function trendByPath(
  entries: LedgerEntry[],
  filter: CategoryAnalysisFilter,
  pick: 'category' | 'subcategory',
): CategoryTrendSeries[] {
  const series = new Map<string, { name: string; points: Map<string, number> }>();
  for (const e of costEntries(entries, filter)) {
    const cat = catOf(e);
    if (!cat) continue;
    const path = resolveCategoryPath(cat);
    const id = pick === 'category' ? path.categoryId : (path.subcategoryId ?? path.categoryId);
    const name = pick === 'category' ? path.categoryName : (path.subcategoryName ?? path.categoryName);
    const s = series.get(id) ?? { name, points: new Map() };
    s.points.set(e.period_key, (s.points.get(e.period_key) ?? 0) + entryReais(e));
    series.set(id, s);
  }
  return Array.from(series.entries())
    .map(([id, s]) => {
      const points = Array.from(s.points.entries())
        .map(([period, value]) => ({ period, value }))
        .sort((a, b) => a.period.localeCompare(b.period));
      return { id, name: s.name, points, total: points.reduce((t, p) => t + p.value, 0) };
    })
    .sort((a, b) => b.total - a.total);
}

export function selectCategoryTrendByMonth(
  filter: CategoryAnalysisFilter = {},
  entries: LedgerEntry[] = mockLedgerEntries,
): CategoryTrendSeries[] {
  return trendByPath(entries, filter, 'category');
}

export function selectSubcategoryTrendByMonth(
  filter: CategoryAnalysisFilter = {},
  entries: LedgerEntry[] = mockLedgerEntries,
): CategoryTrendSeries[] {
  return trendByPath(entries, filter, 'subcategory');
}

// ── 4) Category by project / contract / cost center ─────────

function dimensionLabel(kind: 'project' | 'contract' | 'cost_center', id: string | undefined): string {
  if (!id) return kind === 'project' ? 'Sem projeto' : kind === 'contract' ? 'Sem contrato' : 'Sem centro de custo';
  if (kind === 'project') return projectRefs.find(p => p.id === id)?.name ?? id;
  if (kind === 'contract') {
    const c = contractRefs.find(c => c.id === id);
    return c ? `${c.code} — ${c.client_name}` : id;
  }
  return costCenters.find(c => c.id === id)?.name ?? id;
}

function costByDimension(
  entries: LedgerEntry[],
  filter: CategoryAnalysisFilter,
  kind: 'project' | 'contract' | 'cost_center',
): DimensionCostRow[] {
  const map = new Map<string, { id: string; name: string; value: number }>();
  for (const e of costEntries(entries, filter)) {
    const id = kind === 'project' ? e.project_id : kind === 'contract' ? e.contract_id : e.cost_center_id;
    const key = id ?? `__none_${kind}`;
    const cur = map.get(key) ?? { id: id ?? '', name: dimensionLabel(kind, id), value: 0 };
    cur.value += entryReais(e);
    map.set(key, cur);
  }
  return withShare(Array.from(map.values())).sort((a, b) => b.value - a.value);
}

/** Spend for one categoria/subcategoria broken down by project (answers "which project spent the most on X"). */
export function selectCategoryByProject(
  filter: CategoryAnalysisFilter = {},
  entries: LedgerEntry[] = mockLedgerEntries,
): DimensionCostRow[] {
  return costByDimension(entries, filter, 'project');
}

export function selectCategoryByContract(
  filter: CategoryAnalysisFilter = {},
  entries: LedgerEntry[] = mockLedgerEntries,
): DimensionCostRow[] {
  return costByDimension(entries, filter, 'contract');
}

export function selectCategoryByCostCenter(
  filter: CategoryAnalysisFilter = {},
  entries: LedgerEntry[] = mockLedgerEntries,
): DimensionCostRow[] {
  return costByDimension(entries, filter, 'cost_center');
}

// ── 5) Top cost drivers (by subcategoria) ───────────────────

export function selectTopCostDrivers(
  filter: CategoryAnalysisFilter = {},
  limit = 10,
  entries: LedgerEntry[] = mockLedgerEntries,
): TopCostDriverRow[] {
  const subs = selectCostBySubcategory(filter, entries);
  return subs.slice(0, limit).map((s) => ({
    subcategoryId: s.id,
    subcategoryName: s.name,
    categoryName: s.categoryName,
    groupKey: s.groupKey,
    value: s.value,
    share: s.share,
  }));
}

// ── 6) Mobilização breakdown ────────────────────────────────

/**
 * Mobilização breakdown by subcategoria (Hotel/Hospedagem, Passagens, Locação
 * de Veículos, Combustível, Pedágio, Alimentação, Diárias, Frete…). Locates the
 * Mobilização categoria by code (B.2) so it survives id renames.
 */
export function selectMobilizationBreakdown(
  filter: CategoryAnalysisFilter = {},
  entries: LedgerEntry[] = mockLedgerEntries,
): SubcategoryCostRow[] {
  const mob = managementCategories.find(c => c.code === 'B.2');
  if (!mob) return [];
  return selectCostBySubcategory({ ...filter, categoryId: mob.id }, entries);
}

// ── 7) Anomalies by subcategoria ────────────────────────────

/**
 * Flag subcategories whose latest-period spend deviates strongly from the
 * trailing average of prior periods (month-over-month spike detection).
 *
 * @param minDeviationPct default 0.5 = flag when ≥ +50% above baseline.
 */
export function selectSubcategoryAnomalies(
  filter: CategoryAnalysisFilter = {},
  minDeviationPct = 0.5,
  entries: LedgerEntry[] = mockLedgerEntries,
): SubcategoryAnomalyRow[] {
  const series = selectSubcategoryTrendByMonth(filter, entries);
  const anomalies: SubcategoryAnomalyRow[] = [];
  for (const s of series) {
    if (s.points.length < 2) continue;
    const last = s.points[s.points.length - 1];
    const prior = s.points.slice(0, -1);
    const baseline = prior.reduce((t, p) => t + p.value, 0) / prior.length;
    if (baseline <= 0) continue;
    const deviationPct = last.value / baseline - 1;
    if (deviationPct >= minDeviationPct) {
      const leaf = findCategoryById(s.id);
      const path = leaf ? resolveCategoryPath(leaf) : undefined;
      anomalies.push({
        subcategoryId: s.id,
        subcategoryName: s.name,
        categoryName: path?.categoryName ?? s.name,
        period: last.period,
        value: last.value,
        baseline,
        deviationPct,
      });
    }
  }
  return anomalies.sort((a, b) => b.deviationPct - a.deviationPct);
}
