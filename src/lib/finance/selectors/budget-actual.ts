/**
 * Selectors for /financeiro/orcado-realizado.
 *
 * Source of truth: the canonical ledger (mockLedgerEntries). This selector
 * groups ledger entries by category L2 + cost center + project, splits the
 * sums by entry_type (actual / budget) and projects them into the legacy
 * BudgetActualRow shape consumed by the page.
 *
 * Drop-in replacement target: once Supabase queries return LedgerEntry[],
 * just swap the import below — the page and the rest of the selector
 * surface stay identical.
 */

import type { FinanceKpi } from '../kpi';
import { variancePct } from '../kpi';
import { fmtBRL, fmtCompactBRL, fmtPct } from '@/components/finance/shared';
import type { FinanceStatus } from '@/components/finance/shared';
import type { LedgerEntry, ManagementCategory } from '@/lib/types/finance';
import { mockLedgerEntries } from '@/data/finance/mock-ledger';
import { managementCategories, costCenters } from '@/data/finance/seed-categories';
import { projects } from '@/data/finance/reference';

// ── Public types (preserved for back-compat with the page) ─────────

export type BudgetActualArea =
  | 'Receita'
  | 'Custo'
  | 'OPEX'
  | 'Financeiro'
  | 'Impostos';

export interface BudgetActualTransaction {
  date: string;
  ref: string;
  description: string;
  value: number;
  user: string;
}

export interface BudgetActualRow {
  id: string;
  category: string;
  area: BudgetActualArea;
  project?: string;
  costCenter?: string;
  budget: number;
  actual: number;
  ytdBudget: number;
  ytdActual: number;
  status: FinanceStatus;
  reason?: string;
  transactions: BudgetActualTransaction[];
}

export const BUDGET_ACTUAL_AREAS: BudgetActualArea[] = ['Receita', 'Custo', 'OPEX', 'Financeiro', 'Impostos'];

// ── Ledger-derived row builder ─────────────────────────────────────

const GROUP_TO_AREA: Record<string, BudgetActualArea> = {
  revenue: 'Receita', cogs: 'Custo', opex: 'OPEX', financial: 'Financeiro', taxes: 'Impostos',
};

function ytdRange(periodKey: string): { from: string; to: string } {
  const year = periodKey.slice(0, 4);
  return { from: `${year}-01`, to: periodKey };
}

function l2Of(categoryId: string): ManagementCategory | undefined {
  const cat = managementCategories.find(c => c.id === categoryId);
  if (!cat) return undefined;
  if (cat.level === 2 || cat.level === 1) return cat;
  return managementCategories.find(c => c.id === cat.parent_id);
}

/**
 * Build BudgetActualRow[] for the given period by grouping ledger entries
 * along (category L2, cost_center, project). Each row aggregates:
 *   - budget (period)   = sum of entry_type='budget'   ledger entries in period
 *   - actual (period)   = sum of entry_type='actual'   ledger entries in period
 *   - ytdBudget         = same, but Jan..period
 *   - ytdActual         = same, but Jan..period
 *   - transactions      = up to 6 most-recent actual entries inside the group
 *
 * Pages may pass their own ledger source (e.g. filtered or supabase-backed)
 * via `entries`; defaults to the canonical mock ledger.
 */
export function selectBudgetActualRows(
  periodKey: string,
  entries: LedgerEntry[] = mockLedgerEntries,
): BudgetActualRow[] {
  const { from: ytdFrom, to: ytdTo } = ytdRange(periodKey);

  type Bucket = {
    key: string;
    l2: ManagementCategory;
    costCenterCode?: string;
    projectCode?: string;
    budget: number; actual: number; ytdBudget: number; ytdActual: number;
    transactions: BudgetActualTransaction[];
  };
  const buckets = new Map<string, Bucket>();

  for (const e of entries) {
    if (e.status === 'void') continue;
    const l2 = l2Of(e.category_id);
    if (!l2 || l2.group_key === 'clearing') continue; // exclude treasury/cash settlements

    const cc = costCenters.find(c => c.id === e.cost_center_id);
    const proj = projects.find(p => p.id === e.project_id);
    const key = `${l2.id}::${cc?.code ?? '_'}::${proj?.code ?? '_'}`;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        key, l2,
        costCenterCode: cc?.code,
        projectCode: proj?.code,
        budget: 0, actual: 0, ytdBudget: 0, ytdActual: 0,
        transactions: [],
      };
      buckets.set(key, bucket);
    }

    const signedReais = (e.amount_cents * l2.sign) / 100;
    const isPeriod = e.period_key === periodKey;
    const isYtd = e.period_key >= ytdFrom && e.period_key <= ytdTo;

    if (e.entry_type === 'budget') {
      if (isPeriod) bucket.budget += signedReais;
      if (isYtd) bucket.ytdBudget += signedReais;
    } else if (e.entry_type === 'actual') {
      if (isPeriod) bucket.actual += signedReais;
      if (isYtd) bucket.ytdActual += signedReais;

      if (isPeriod && bucket.transactions.length < 6) {
        bucket.transactions.push({
          date: e.entry_date,
          ref: e.id,
          description: e.description,
          value: signedReais,
          user: e.created_by,
        });
      }
    }
  }

  return Array.from(buckets.values())
    .filter(b => b.budget !== 0 || b.actual !== 0 || b.ytdBudget !== 0 || b.ytdActual !== 0)
    .map(b => {
      const variance = variancePct(b.actual, b.budget);
      const isCost = b.l2.sign === -1;
      const overrun = isCost ? variance > 0 : variance < 0;
      const absVar = Math.abs(variance);
      const status: FinanceStatus = absVar < 3 ? 'ok' : !overrun ? 'ok' : absVar >= 7 ? 'critical' : 'attention';

      return {
        id: b.key,
        category: b.l2.name,
        area: GROUP_TO_AREA[b.l2.group_key] ?? 'OPEX',
        project: b.projectCode,
        costCenter: b.costCenterCode,
        budget: b.budget,
        actual: b.actual,
        ytdBudget: b.ytdBudget,
        ytdActual: b.ytdActual,
        status,
        transactions: b.transactions,
      } satisfies BudgetActualRow;
    })
    .sort((a, b) => Math.abs(b.actual) - Math.abs(a.actual));
}

/** Snapshot for the page's default period. Derived from ledger so any
 *  change to mockLedgerEntries (or future Supabase source) flows through. */
export const BUDGET_ACTUAL_ROWS: BudgetActualRow[] = selectBudgetActualRows('2026-04');

// ── KPI / chart selectors (kept identical for back-compat) ────────

export function buildBudgetActualKpis(rows: BudgetActualRow[], asOf?: string): FinanceKpi[] {
  const totalBudget = rows.reduce((a, r) => a + r.budget, 0);
  const totalActual = rows.reduce((a, r) => a + r.actual, 0);
  const overruns = rows.filter((r) => r.status === 'critical' || r.status === 'attention').length;
  const justified = rows.filter((r) => r.status === 'justified').length;
  const variance = variancePct(totalActual, totalBudget);

  const overrunRows = rows
    .filter((r) => r.status === 'critical' || r.status === 'attention')
    .map((r) => ({
      label: r.category,
      value: r.actual - r.budget,
      formattedValue: `${fmtBRL(r.actual - r.budget)} (${fmtPct(variancePct(r.actual, r.budget))})`,
      tone: (r.status === 'critical' ? 'danger' : 'warning') as 'danger' | 'warning',
    }));

  return [
    {
      id: 'b', title: 'Orçado (mês)', value: totalBudget, format: 'compactCurrency', tone: 'info', category: 'budget',
      source: 'ledger', helper: 'Soma das linhas filtradas',
      details: 'Soma do orçado do período corrente para as linhas filtradas. Derivado de entries com entry_type=budget no ledger canônico.',
      asOf,
    },
    {
      id: 'a', title: 'Realizado (mês)', value: totalActual, format: 'compactCurrency', tone: 'success', category: 'cost',
      source: 'ledger', helper: 'Soma do realizado',
      details: 'Total de lançamentos com entry_type=actual no período. Mesma fonte do DRE Gerencial e do Control Room.',
      asOf,
    },
    {
      id: 'd', title: 'Δ Realizado vs Orçado', value: variance, format: 'percent', tone: variance >= 0 ? 'success' : 'danger', category: 'variance',
      source: 'derived', helper: `Δ total ${fmtBRL(totalActual - totalBudget)}`,
      details: 'Variação percentual do realizado sobre o orçado. variancePct() centralizada em src/lib/finance/kpi.ts.',
      asOf,
    },
    {
      id: 'o', title: 'Linhas com overrun', value: overruns, format: 'number', tone: overruns > 0 ? 'warning' : 'success', category: 'risk',
      source: 'derived', helper: 'Crítico + atenção',
      details: 'Linhas P&L em status Crítico ou Atenção. Clique para abrir a justificativa.',
      drilldown: overrunRows, asOf,
    },
    {
      id: 'j', title: 'Justificadas', value: justified, format: 'number', tone: 'info', category: 'operational',
      source: 'derived', helper: 'Linhas com racional formal',
      details: 'Linhas com justificativa anexada e aprovada no workflow de fechamento mensal.',
      asOf,
    },
  ];
}

export interface HeatmapAreaCell {
  area: BudgetActualArea;
  vp: number;
  count: number;
}

export function buildHeatmapAreas(rows: BudgetActualRow[]): HeatmapAreaCell[] {
  return BUDGET_ACTUAL_AREAS.map((area) => {
    const inArea = rows.filter((r) => r.area === area);
    const b = inArea.reduce((a, r) => a + r.budget, 0);
    const ac = inArea.reduce((a, r) => a + r.actual, 0);
    return { area, vp: variancePct(ac, b), count: inArea.length };
  });
}

export function buildVarianceRanking(rows: BudgetActualRow[], limit = 5) {
  return [...rows]
    .map((r) => ({ ...r, vp: variancePct(r.actual, r.budget) }))
    .filter((r) => r.actual < 0)
    .sort((a, b) => a.vp - b.vp)
    .slice(0, limit);
}

export { variancePct, fmtCompactBRL, fmtBRL, fmtPct };
