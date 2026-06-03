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

import type { LedgerEntry, LedgerEntryStatus, LedgerEntryType, ManagementCategory, ManagementGroupKey } from '@/lib/types/finance';
import { mockLedgerEntries } from '@/data/finance/mock-ledger';
import { managementCategories, resolveCategoryPath, findCategoryById } from '@/data/finance/seed-categories';
import { contracts as contractRefs, projects as projectRefs, findCollaborator } from '@/data/finance/reference';
import { costCenters, suppliers as supplierRefs } from '@/data/finance/seed-categories';
import { isProjectActualCost, isProjectCostEntry, entryReais } from './project-allocation';

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
  supplierId?: string;
  /** Restrict to one Grupo DRE (cogs/opex/financial/taxes). 'all' = no filter. */
  groupKey?: ManagementGroupKey | 'all';
  /** Restrict to one L2 categoria id (for drill-down). */
  categoryId?: string;
  /** Restrict to one L3 subcategoria id (for drill-down). */
  subcategoryId?: string;
  /**
   * Restrict to an explicit set of categoria ids (matched against the entry's
   * own category_id). Used to scope a view to a domain such as logistics
   * (see [[selectLogisticsCategoryIds]]). Empty/undefined = no restriction.
   */
  categoryIds?: string[];
  /** Restrict to one collaborator (resolved from entry metadata). */
  collaboratorId?: string;
  /**
   * Restrict to one lifecycle status. Only narrows within the plane's own gate
   * (actuals are always posted/reconciled). 'all' or undefined = no filter.
   */
  status?: LedgerEntryStatus | 'all';
  /**
   * Which ledger plane to analyze. Defaults to 'actual' (posted/reconciled).
   * 'budget'/'forecast' surface planning entries for orçado/forecast views and
   * do NOT require a settled status (planning entries are never posted).
   */
  entryType?: LedgerEntryType;
}

/** Resolve the subcategoria (L3) id of an entry, falling back to its category id. */
function subIdOf(e: LedgerEntry): string | undefined {
  const cat = catOf(e);
  if (!cat) return undefined;
  const path = resolveCategoryPath(cat);
  return path.subcategoryId ?? path.categoryId;
}

/** Resolve the collaborator (id + display name) attributed to an entry, if any. */
function collaboratorOf(e: LedgerEntry): { id: string; name: string } | undefined {
  const id = e.metadata?.collaborator_id as string | undefined;
  if (!id) return undefined;
  const name = (e.metadata?.collaborator_name as string | undefined)
    ?? findCollaborator(id)?.name
    ?? id;
  return { id, name };
}

function inRange(periodKey: string, from?: string, to?: string): boolean {
  if (from && periodKey < from) return false;
  if (to && periodKey > to) return false;
  return true;
}

/**
 * P&L cost entries matching the filter (always excludes clearing/treasury).
 * Defaults to actuals (posted/reconciled); budget/forecast planes are opened
 * via filter.entryType so orçado/forecast can be analyzed separately.
 */
function costEntries(entries: LedgerEntry[], filter: CategoryAnalysisFilter): LedgerEntry[] {
  const entryType = filter.entryType ?? 'actual';
  return entries.filter((e) => {
    // Cost rule: 'actual' uses the official posted/reconciled gate; planning
    // planes only need to be a non-clearing P&L cost of the matching type.
    if (entryType === 'actual') {
      if (!isProjectActualCost(e)) return false;
    } else {
      if (!isProjectCostEntry(e) || e.entry_type !== entryType || e.status === 'void') return false;
    }
    if (!inRange(e.period_key, filter.periodFrom, filter.periodTo)) return false;
    if (filter.projectId && filter.projectId !== 'all' && e.project_id !== filter.projectId) return false;
    if (filter.contractId && filter.contractId !== 'all' && e.contract_id !== filter.contractId) return false;
    if (filter.costCenterId && filter.costCenterId !== 'all' && e.cost_center_id !== filter.costCenterId) return false;
    if (filter.supplierId && filter.supplierId !== 'all' && e.supplier_id !== filter.supplierId) return false;
    if (filter.groupKey && filter.groupKey !== 'all' && catOf(e)?.group_key !== filter.groupKey) return false;
    if (filter.categoryIds && filter.categoryIds.length > 0 && !filter.categoryIds.includes(e.category_id)) return false;
    if (filter.status && filter.status !== 'all' && e.status !== filter.status) return false;
    if (filter.collaboratorId && filter.collaboratorId !== 'all' && collaboratorOf(e)?.id !== filter.collaboratorId) return false;
    if (filter.categoryId) {
      const path = catOf(e) ? resolveCategoryPath(catOf(e)!) : undefined;
      if (path?.categoryId !== filter.categoryId) return false;
    }
    if (filter.subcategoryId && subIdOf(e) !== filter.subcategoryId) return false;
    return true;
  });
}

/**
 * The filtered, sorted cost ledger entries themselves — for the entry-table
 * drilldown. Reuses the exact same cost rule as every aggregate selector so the
 * table can never disagree with the totals above it.
 */
export function selectCostLedgerEntries(
  filter: CategoryAnalysisFilter = {},
  limit?: number,
  entries: LedgerEntry[] = mockLedgerEntries,
): LedgerEntry[] {
  const rows = costEntries(entries, filter).sort(
    (a, b) => Math.abs(b.amount_cents) - Math.abs(a.amount_cents),
  );
  return limit ? rows.slice(0, limit) : rows;
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

type CostDimension = 'project' | 'contract' | 'cost_center' | 'supplier';

function dimensionLabel(kind: CostDimension, id: string | undefined): string {
  if (!id) {
    return kind === 'project' ? 'Sem projeto'
      : kind === 'contract' ? 'Sem contrato'
      : kind === 'supplier' ? 'Sem fornecedor'
      : 'Sem centro de custo';
  }
  if (kind === 'project') return projectRefs.find(p => p.id === id)?.name ?? id;
  if (kind === 'contract') {
    const c = contractRefs.find(c => c.id === id);
    return c ? `${c.code} — ${c.client_name}` : id;
  }
  if (kind === 'supplier') return supplierRefs.find(s => s.id === id)?.name ?? id;
  return costCenters.find(c => c.id === id)?.name ?? id;
}

function costByDimension(
  entries: LedgerEntry[],
  filter: CategoryAnalysisFilter,
  kind: CostDimension,
): DimensionCostRow[] {
  const map = new Map<string, { id: string; name: string; value: number }>();
  for (const e of costEntries(entries, filter)) {
    const id = kind === 'project' ? e.project_id
      : kind === 'contract' ? e.contract_id
      : kind === 'supplier' ? e.supplier_id
      : e.cost_center_id;
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

/** Spend broken down by supplier (top suppliers / fornecedores). */
export function selectCostBySupplier(
  filter: CategoryAnalysisFilter = {},
  entries: LedgerEntry[] = mockLedgerEntries,
): DimensionCostRow[] {
  return costByDimension(entries, filter, 'supplier');
}

// ── Collaborator dimension (logistics / mobilization) ───────

export interface CollaboratorCostRow {
  id: string;
  name: string;
  value: number;
  share: number;
  /** Number of cost entries attributed to the collaborator. */
  entryCount: number;
  /** Highest-spend project name for this collaborator (for the ranking meta). */
  mainProject?: string;
  /** Highest-spend subcategoria name for this collaborator. */
  mainCategory?: string;
}

/**
 * Spend by collaborator — answers "who is driving travel/mobilization cost".
 * Collaborators are resolved from entry metadata (collaborator_id); entries
 * with no collaborator are dropped (they belong to the team, not a person).
 * Each row carries the collaborator's dominant project and subcategoria so the
 * ranking can show context without a second query.
 */
export function selectCostByCollaborator(
  filter: CategoryAnalysisFilter = {},
  entries: LedgerEntry[] = mockLedgerEntries,
): CollaboratorCostRow[] {
  const map = new Map<string, {
    id: string; name: string; value: number; entryCount: number;
    byProject: Map<string, number>; bySub: Map<string, number>;
  }>();
  for (const e of costEntries(entries, filter)) {
    const c = collaboratorOf(e);
    if (!c) continue;
    const v = entryReais(e);
    const cur = map.get(c.id) ?? { id: c.id, name: c.name, value: 0, entryCount: 0, byProject: new Map(), bySub: new Map() };
    cur.value += v;
    cur.entryCount += 1;
    const projName = dimensionLabel('project', e.project_id);
    cur.byProject.set(projName, (cur.byProject.get(projName) ?? 0) + v);
    const cat = catOf(e);
    if (cat) {
      const path = resolveCategoryPath(cat);
      const subName = path.subcategoryName ?? path.categoryName;
      cur.bySub.set(subName, (cur.bySub.get(subName) ?? 0) + v);
    }
    map.set(c.id, cur);
  }
  const top = (m: Map<string, number>) => Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
  return withShare(
    Array.from(map.values()).map((r) => ({
      id: r.id, name: r.name, value: r.value, entryCount: r.entryCount,
      mainProject: top(r.byProject), mainCategory: top(r.bySub),
    })),
  ).sort((a, b) => b.value - a.value);
}

// ── Department dimension (payroll) ──────────────────────────

/**
 * Spend by department — used by the Folha (payroll) dashboards. The department
 * is resolved, in priority order, from: the entry's metadata.department_name,
 * the attributed collaborator's home department, or the cost-center name as a
 * structural proxy. Keeps payroll analytics meaningful even when entries carry
 * no explicit department tag (real folha postings book to a cost center).
 */
export function selectCostByDepartment(
  filter: CategoryAnalysisFilter = {},
  entries: LedgerEntry[] = mockLedgerEntries,
): DimensionCostRow[] {
  const map = new Map<string, { id: string; name: string; value: number }>();
  for (const e of costEntries(entries, filter)) {
    const dept = (e.metadata?.department_name as string | undefined)
      ?? (collaboratorOf(e) ? findCollaborator(collaboratorOf(e)!.id)?.department : undefined)
      ?? costCenters.find((c) => c.id === e.cost_center_id)?.name
      ?? 'Sem departamento';
    const cur = map.get(dept) ?? { id: dept, name: dept, value: 0 };
    cur.value += entryReais(e);
    map.set(dept, cur);
  }
  return withShare(Array.from(map.values())).sort((a, b) => b.value - a.value);
}

// ── Category scope by code roots ────────────────────────────

/**
 * All categoria ids (any level) whose code equals or descends from one of the
 * given roots. Used to scope a category-specific dashboard to a subtree (e.g.
 * ['B.2','C.6'] = Mobilização e Logística incl. historical Viagens). Matching
 * is by code prefix so the scope survives id renames and new subcategorias.
 */
export function categoryIdsUnderCodes(roots: string[]): string[] {
  return managementCategories
    .filter((c) => roots.some((root) => c.code === root || c.code.startsWith(`${root}.`)))
    .map((c) => c.id);
}

/**
 * Category code roots that constitute "logistics": Mobilização e Logística
 * (B.2) plus corporate Travel/Viagens OPEX (C.6) for historical compatibility.
 */
export const LOGISTICS_ROOT_CODES = ['B.2', 'C.6'] as const;

/** All categoria ids (any level) under the logistics roots. */
export function selectLogisticsCategoryIds(): string[] {
  return categoryIdsUnderCodes([...LOGISTICS_ROOT_CODES]);
}

/** Projects consuming a given cost center (used on the Cost Center page). */
export function selectProjectsByCostCenter(
  costCenterId: string,
  filter: CategoryAnalysisFilter = {},
  entries: LedgerEntry[] = mockLedgerEntries,
): DimensionCostRow[] {
  return costByDimension(entries, { ...filter, costCenterId }, 'project');
}

/**
 * Per-supplier month-over-month variation across the last two periods present
 * in the filtered window. Returns supplierId → % change (last vs previous),
 * undefined when the supplier had no spend in the previous period. Powers the
 * "variação vs período anterior" agency KPI without duplicating the cost rule.
 */
export function selectSupplierVariation(
  filter: CategoryAnalysisFilter = {},
  entries: LedgerEntry[] = mockLedgerEntries,
): Map<string, number | undefined> {
  const months = selectMonthlyCostTotals(filter, entries);
  const last = months[months.length - 1]?.period;
  const prev = months[months.length - 2]?.period;
  const out = new Map<string, number | undefined>();
  if (!last) return out;
  const lastBy = new Map(selectCostBySupplier({ ...filter, periodFrom: last, periodTo: last }, entries).map((r) => [r.id, r.value]));
  const prevBy = prev
    ? new Map(selectCostBySupplier({ ...filter, periodFrom: prev, periodTo: prev }, entries).map((r) => [r.id, r.value]))
    : new Map<string, number>();
  for (const [id, lv] of lastBy) {
    const pv = prevBy.get(id);
    out.set(id, pv && pv > 0 ? (lv / pv - 1) * 100 : undefined);
  }
  return out;
}

// ── Grupo DRE breakdown + monthly totals + summary/MoM ──────

/** Spend grouped by Grupo DRE (COGS, OPEX, Financeiro, Tributos…). */
export function selectCostByGroup(
  filter: CategoryAnalysisFilter = {},
  entries: LedgerEntry[] = mockLedgerEntries,
): Array<{ groupKey: ManagementGroupKey; value: number; share: number }> {
  const map = new Map<ManagementGroupKey, number>();
  for (const e of costEntries(entries, filter)) {
    const g = catOf(e)?.group_key;
    if (!g) continue;
    map.set(g, (map.get(g) ?? 0) + entryReais(e));
  }
  return withShare(
    Array.from(map.entries()).map(([groupKey, value]) => ({ groupKey, value })),
  ).sort((a, b) => b.value - a.value);
}

/** Total cost per month (single series) — the headline monthly trend. */
export function selectMonthlyCostTotals(
  filter: CategoryAnalysisFilter = {},
  entries: LedgerEntry[] = mockLedgerEntries,
): CategoryTrendPoint[] {
  const map = new Map<string, number>();
  for (const e of costEntries(entries, filter)) {
    map.set(e.period_key, (map.get(e.period_key) ?? 0) + entryReais(e));
  }
  return Array.from(map.entries())
    .map(([period, value]) => ({ period, value }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

export interface CostAnalysisSummary {
  /** Total cost in the filtered window (reais). */
  total: number;
  /** Number of cost entries counted. */
  entryCount: number;
  /** Distinct categorias / subcategorias / fornecedores touched. */
  categoryCount: number;
  subcategoryCount: number;
  supplierCount: number;
  /** Most recent period in range and its value. */
  lastPeriod?: string;
  lastPeriodValue: number;
  /** Previous period value (for the month-over-month delta). */
  prevPeriodValue: number;
  /** Month-over-month % change (last vs previous period), or undefined if N/A. */
  momPct?: number;
  topCategory?: CategoryCostRow;
  topSubcategory?: SubcategoryCostRow;
  topSupplier?: DimensionCostRow;
}

/**
 * One-shot headline summary for the cost analytics KPI strip: total, counts,
 * month-over-month variation and the leading category / subcategory / supplier.
 * Computed from the same cost rule as every other selector.
 */
export function selectCostAnalysisSummary(
  filter: CategoryAnalysisFilter = {},
  entries: LedgerEntry[] = mockLedgerEntries,
): CostAnalysisSummary {
  const rows = costEntries(entries, filter);
  const total = rows.reduce((s, e) => s + entryReais(e), 0);
  const monthly = selectMonthlyCostTotals(filter, entries);
  const last = monthly[monthly.length - 1];
  const prev = monthly[monthly.length - 2];
  const momPct = prev && prev.value > 0 ? (last.value / prev.value - 1) * 100 : undefined;
  const cats = selectCostByCategory(filter, entries);
  const subs = selectCostBySubcategory(filter, entries);
  const sups = selectCostBySupplier(filter, entries).filter((s) => s.id);
  return {
    total,
    entryCount: rows.length,
    categoryCount: cats.length,
    subcategoryCount: subs.length,
    supplierCount: sups.length,
    lastPeriod: last?.period,
    lastPeriodValue: last?.value ?? 0,
    prevPeriodValue: prev?.value ?? 0,
    momPct,
    topCategory: cats[0],
    topSubcategory: subs[0],
    topSupplier: sups[0],
  };
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
