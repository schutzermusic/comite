/**
 * Selectors for /financeiro/centros-custo.
 *
 * Source of truth:
 *   - costCenters (src/data/finance/seed-categories.ts) for the dimensional list.
 *   - costCenterRefs (src/data/finance/reference.ts) for director + headcount.
 *   - mockLedgerEntries for budget/actual + composition + trend, grouped by
 *     cost_center_id. Sign is normalized so cost centers always show as
 *     positive expenditure (Math.abs of cogs/opex/financial/taxes lines).
 */

import type { FinanceKpi } from '../kpi';
import { variancePct } from '../kpi';
import { fmtBRL, fmtCompactBRL, fmtPct } from '@/components/finance/shared';
import type { LedgerEntry } from '@/lib/types/finance';
import { mockLedgerEntries } from '@/data/finance/mock-ledger';
import { managementCategories, costCenters as ccSeed } from '@/data/finance/seed-categories';
import { costCenterRefs, findCostCenterRef } from '@/data/finance/reference';

// ── Public types (preserved) ───────────────────────────────────────

export interface CostCenterMockCategory {
  category: string;
  value: number;
}

export interface CostCenterMock {
  id: string;
  code: string;
  name: string;
  director: string;
  budget: number;
  actual: number;
  headcount: number;
  /** Last 6 months actual, in thousands (BRL). */
  trend: number[];
  composition: CostCenterMockCategory[];
}

export const COST_CENTERS_MONTHS_REF = ['Nov', 'Dez', 'Jan', 'Fev', 'Mar', 'Abr'];
const TREND_PERIODS = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04'];

// ── Derivation ─────────────────────────────────────────────────────

/**
 * Build CostCenterMock[] for the given period from the ledger.
 * Every monetary number is derived from mockLedgerEntries (or the entries
 * parameter when injecting a different source).
 */
export function selectCostCenters(
  periodKey: string = '2026-04',
  entries: LedgerEntry[] = mockLedgerEntries,
): CostCenterMock[] {
  // Pre-index entries by (cost_center_id, period_key, entry_type)
  const expenseGroups = new Set(['cogs', 'opex', 'financial', 'taxes']);

  return ccSeed.map(cc => {
    const ref = findCostCenterRef(cc.id);

    let budget = 0;
    let actual = 0;
    const compositionByL2 = new Map<string, number>();
    const trendByPeriod = new Map<string, number>();

    for (const e of entries) {
      if (e.cost_center_id !== cc.id || e.status === 'void') continue;
      const cat = managementCategories.find(c => c.id === e.category_id);
      if (!cat || !expenseGroups.has(cat.group_key)) continue;

      const expenseReais = Math.abs(e.amount_cents) / 100;

      if (e.entry_type === 'budget' && e.period_key === periodKey) budget += expenseReais;
      if (e.entry_type === 'actual') {
        if (e.period_key === periodKey) actual += expenseReais;

        const l2 = cat.level === 3 ? managementCategories.find(c => c.id === cat.parent_id) ?? cat : cat;
        if (e.period_key === periodKey) {
          compositionByL2.set(l2.name, (compositionByL2.get(l2.name) ?? 0) + expenseReais);
        }
        if (TREND_PERIODS.includes(e.period_key)) {
          trendByPeriod.set(e.period_key, (trendByPeriod.get(e.period_key) ?? 0) + expenseReais);
        }
      }
    }

    const trend = TREND_PERIODS.map(p => Math.round((trendByPeriod.get(p) ?? 0) / 1000));
    const composition: CostCenterMockCategory[] = Array.from(compositionByL2.entries())
      .map(([category, value]) => ({ category, value }))
      .sort((a, b) => b.value - a.value);

    return {
      id: cc.id,
      code: cc.code,
      name: cc.name,
      director: ref?.director ?? '—',
      budget,
      actual,
      headcount: ref?.headcount ?? 0,
      trend,
      composition,
    } satisfies CostCenterMock;
  })
  // Drop CCs with zero financial activity in the period: the consumer pages
  // divide by budget for variance/execution metrics, and a 0-budget row
  // produces NaN/Infinity that breaks chart rendering + hydration.
  .filter(c => c.budget !== 0 || c.actual !== 0);
}

/** Snapshot for the page's default period. Ledger-derived. */
export const COST_CENTERS: CostCenterMock[] = selectCostCenters('2026-04');

// ── KPI selectors (kept identical for back-compat) ─────────────────

export function buildCostCentersKpis(centers: CostCenterMock[], asOf?: string): FinanceKpi[] {
  const totalBudget = centers.reduce((a, c) => a + c.budget, 0);
  const totalActual = centers.reduce((a, c) => a + c.actual, 0);
  const totalHc = centers.reduce((a, c) => a + c.headcount, 0);
  const overruns = centers.filter((c) => c.actual > c.budget).length;
  const variance = variancePct(totalActual, totalBudget);

  const breakdownByCenter = centers
    .map((c) => ({
      label: `${c.code} ${c.name}`,
      value: c.actual,
      formattedValue: fmtCompactBRL(c.actual),
      tone: (c.actual > c.budget ? 'danger' : 'success') as 'danger' | 'success',
    }))
    .sort((a, b) => b.value - a.value);

  return [
    {
      id: 'n', title: 'Centros de Custo', value: centers.length, format: 'number', tone: 'info', category: 'operational',
      source: 'ledger', helper: 'Ativos no período',
      details: 'Quantidade de CCs com lançamentos no período. Derivado de mockLedgerEntries.',
      asOf,
    },
    {
      id: 'b', title: 'Orçado total', value: totalBudget, format: 'compactCurrency', tone: 'info', category: 'budget',
      source: 'ledger', helper: 'Soma dos CCs',
      details: 'Soma dos entries com entry_type=budget agrupados por cost_center_id.', asOf,
    },
    {
      id: 'a', title: 'Realizado total', value: totalActual, format: 'compactCurrency', tone: 'warning', category: 'cost',
      source: 'ledger', helper: 'Total executado',
      details: 'Soma dos entries com entry_type=actual agrupados por cost_center_id.', drilldown: breakdownByCenter, asOf,
    },
    {
      id: 'd', title: 'Δ vs Orçado', value: variance, format: 'percent', tone: variance > 0 ? 'danger' : 'success', category: 'variance',
      source: 'derived', helper: `Δ ${fmtBRL(totalActual - totalBudget)}`,
      details: 'variancePct(actual, budget). Mesma fórmula em todo o módulo.', asOf,
    },
    {
      id: 'h', title: 'Headcount', value: totalHc, format: 'number', tone: 'info', category: 'operational',
      source: 'mock', helper: 'Colaboradores ativos',
      details: 'Soma de headcount alocado nos CCs. Atributo dimensional (reference.ts).',
      asOf,
    },
    {
      id: 'o', title: 'Em overrun', value: overruns, format: 'number', tone: overruns > 0 ? 'warning' : 'success', category: 'risk',
      source: 'derived', helper: 'CCs acima do orçado',
      details: 'CCs com realizado > orçado para o período corrente.', asOf,
    },
  ];
}

export function buildTopCostCentersTrend(centers: CostCenterMock[], topN = 4) {
  const palette = ['accent', 'info', 'success', 'warning'] as const;
  return [...centers]
    .sort((a, b) => b.actual - a.actual)
    .slice(0, topN)
    .map((c, idx) => ({
      name: c.name,
      data: c.trend.map((v) => v * 1000),
      tone: palette[idx],
    }));
}

export { variancePct, fmtBRL, fmtCompactBRL, fmtPct };
// Re-export dimensional refs in case pages need them
export { costCenterRefs };
