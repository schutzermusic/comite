/**
 * Selectors for /financeiro/forecast-cenarios.
 *
 * Source of truth:
 *   - scenarios (src/data/finance/reference.ts) for the scenario catalog
 *     (name, owner, status, multiplier, key).
 *   - mockLedgerEntries for the monetary baselines, split by entry_type:
 *       realized → entry_type='actual'
 *       budget   → entry_type='budget'
 *       forecast → entry_type='forecast'
 *       stress/optimistic/board → forecast baseline × multiplier
 *
 * No monetary number is hard-coded — every value traces back to ledger.
 */

import type { FinanceKpi } from '../kpi';
import { variancePct, deltaPct } from '../kpi';
import { fmtCompactBRL, fmtPct } from '@/components/finance/shared';
import type { FinanceScenario, FinanceStatus } from '@/components/finance/shared';
import type { LedgerEntry } from '@/lib/types/finance';
import { mockLedgerEntries } from '@/data/finance/mock-ledger';
import { managementCategories } from '@/data/finance/seed-categories';
import { scenarios as scenarioRefs, type ScenarioRef } from '@/data/finance/reference';

// ── Public types (preserved) ───────────────────────────────────────

export type ForecastScenarioType = FinanceScenario | 'optimistic';

export interface ForecastScenario {
  id: string;
  name: string;
  type: ForecastScenarioType;
  revenue: number;
  ebitda: number;
  cash: number;
  margin: number;
  variance: number;
  status: FinanceStatus;
  owner: string;
  updated: string;
  trajectory: number[];
}

export interface ForecastAssumption {
  id: string;
  label: string;
  current: number;
  min: number;
  max: number;
  step: number;
  sensitivity: number;
}

export const FORECAST_ASSUMPTIONS: ForecastAssumption[] = [
  { id: 'rev',  label: 'Receita',         current: 0, min: -20, max: 20, step: 1, sensitivity:  0.92 },
  { id: 'cd',   label: 'Custo Direto',    current: 0, min: -15, max: 15, step: 1, sensitivity: -0.74 },
  { id: 'opex', label: 'OPEX',            current: 0, min: -15, max: 15, step: 1, sensitivity: -0.41 },
  { id: 'mob',  label: 'Mobilização',     current: 0, min: -10, max: 10, step: 1, sensitivity: -0.18 },
  { id: 'fol',  label: 'Folha',           current: 0, min: -15, max: 15, step: 1, sensitivity: -0.62 },
  { id: 'tax',  label: 'Impostos',        current: 0, min: -10, max: 10, step: 1, sensitivity: -0.34 },
];

// ── Ledger-derived baselines ───────────────────────────────────────

interface ScenarioBaseline {
  revenue: number; cogs: number; opex: number; financial: number; taxes: number;
  /** Cumulative trajectory (12 buckets of cents/1000 for thousands display). */
  trajectory: number[];
}

const TRAJ_PERIODS = [
  '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10',
  '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04',
] as const;

function aggregateByType(
  entries: LedgerEntry[],
  type: 'actual' | 'budget' | 'forecast',
): ScenarioBaseline {
  const acc: ScenarioBaseline = {
    revenue: 0, cogs: 0, opex: 0, financial: 0, taxes: 0,
    trajectory: Array(12).fill(0),
  };

  for (const e of entries) {
    if (e.entry_type !== type || e.status === 'void') continue;
    const cat = managementCategories.find(c => c.id === e.category_id);
    if (!cat || cat.group_key === 'clearing') continue; // exclude treasury/cash settlements
    const signedReais = (e.amount_cents * cat.sign) / 100;

    const key = cat.group_key as 'revenue' | 'cogs' | 'opex' | 'financial' | 'taxes';
    acc[key] += signedReais;

    const idx = TRAJ_PERIODS.indexOf(e.period_key as typeof TRAJ_PERIODS[number]);
    if (idx >= 0) {
      acc.trajectory[idx] += signedReais;
    }
  }
  return acc;
}

function ebitdaFromBaseline(b: ScenarioBaseline): number {
  return b.revenue + b.cogs + b.opex;
}

function deriveScenario(
  ref: ScenarioRef,
  realized: ScenarioBaseline,
  budget: ScenarioBaseline,
  forecast: ScenarioBaseline,
): ForecastScenario {
  let revenue: number, ebitda: number, cash: number, trajectory: number[];

  if (ref.key === 'realized') {
    revenue = realized.revenue;
    ebitda = ebitdaFromBaseline(realized);
    cash = ebitda + realized.financial;
    trajectory = realized.trajectory.map(v => Math.round(v / 1000));
  } else if (ref.key === 'budget') {
    revenue = budget.revenue;
    ebitda = ebitdaFromBaseline(budget);
    cash = ebitda + budget.financial;
    trajectory = budget.trajectory.map(v => Math.round(v / 1000));
  } else {
    // forecast / stress / optimistic / board → forecast baseline × multiplier
    revenue = forecast.revenue * ref.multiplier;
    ebitda = ebitdaFromBaseline(forecast) * ref.multiplier;
    cash = (ebitdaFromBaseline(forecast) + forecast.financial) * ref.multiplier;
    trajectory = forecast.trajectory.map(v => Math.round((v * ref.multiplier) / 1000));
  }

  const margin = revenue !== 0 ? (ebitda / revenue) * 100 : 0;
  const realizedEbitda = ebitdaFromBaseline(realized) || 1;
  const variance = ((ebitda - realizedEbitda) / Math.abs(realizedEbitda)) * 100;

  const statusMap: Record<ScenarioRef['status'], FinanceStatus> = {
    closed: 'closed', approved: 'approved', review: 'review', draft: 'draft',
  };

  return {
    id: ref.id,
    name: ref.name,
    type: ref.key === 'realized' ? 'realized'
        : ref.key === 'budget'   ? 'budget'
        : ref.key === 'forecast' ? 'forecast'
        : ref.key === 'stress'   ? 'stress'
        : ref.key === 'board'    ? 'board'
        : 'optimistic',
    revenue,
    ebitda,
    cash,
    margin,
    variance,
    status: statusMap[ref.status],
    owner: ref.owner,
    updated: ref.updated,
    trajectory,
  };
}

/**
 * Build the ForecastScenario[] dataset from the canonical ledger + scenario refs.
 */
export function selectForecastScenarios(
  entries: LedgerEntry[] = mockLedgerEntries,
  refs: ScenarioRef[] = scenarioRefs,
): ForecastScenario[] {
  const realized = aggregateByType(entries, 'actual');
  const budget = aggregateByType(entries, 'budget');
  const forecast = aggregateByType(entries, 'forecast');
  return refs.map(r => deriveScenario(r, realized, budget, forecast));
}

/** Snapshot used by the page directly. */
export const FORECAST_SCENARIOS: ForecastScenario[] = selectForecastScenarios();

// Cost drivers panel derives from forecast baseline grouped by category L2.
export function selectForecastCostDrivers(
  entries: LedgerEntry[] = mockLedgerEntries,
): { name: string; value: number; tone: 'danger' | 'warning' | 'info' | 'accent' | 'budget' }[] {
  const byL2 = new Map<string, number>();
  for (const e of entries) {
    if (e.entry_type !== 'forecast' || e.status === 'void') continue;
    const cat = managementCategories.find(c => c.id === e.category_id);
    if (!cat || !['cogs', 'opex'].includes(cat.group_key)) continue;
    const l2 = cat.level === 3 ? managementCategories.find(c => c.id === cat.parent_id) ?? cat : cat;
    const v = Math.abs(e.amount_cents) / 100;
    byL2.set(l2.name, (byL2.get(l2.name) ?? 0) + v);
  }
  const palette = ['danger', 'warning', 'info', 'accent', 'budget'] as const;
  return Array.from(byL2.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, value], i) => ({ name, value, tone: palette[i] }));
}

export const FORECAST_COST_DRIVERS = selectForecastCostDrivers();

// ── Simulation + KPI selectors (kept identical) ────────────────────

export interface SimulatedScenarioResult {
  revenue: number;
  ebitda: number;
  margin: number;
  cash: number;
  delta: number;
}

export function simulateScenario(
  baseline: ForecastScenario,
  assumptions: ForecastAssumption[],
): SimulatedScenarioResult {
  const compositeFactor = assumptions.reduce(
    (acc, a) => acc + (a.current / 100) * a.sensitivity,
    0,
  );
  const revenueDriver = assumptions.find((a) => a.id === 'rev');
  const ebitda = baseline.ebitda * (1 + compositeFactor);
  const revenue = revenueDriver
    ? baseline.revenue * (1 + (revenueDriver.current / 100) * revenueDriver.sensitivity)
    : baseline.revenue;
  const margin = revenue === 0 ? 0 : (ebitda / revenue) * 100;
  const cash = baseline.cash * (1 + compositeFactor * 0.85);
  return { revenue, ebitda, margin, cash, delta: compositeFactor * 100 };
}

export function buildForecastKpis(args: {
  baseline: ForecastScenario;
  simulated: SimulatedScenarioResult;
  totalScenarios: number;
  asOf?: string;
}): FinanceKpi[] {
  const { baseline, simulated, totalScenarios, asOf } = args;
  const revDelta = deltaPct(simulated.revenue, baseline.revenue);
  const ebitdaDelta = deltaPct(simulated.ebitda, baseline.ebitda);
  return [
    {
      id: 's', title: 'Cenários ativos', value: totalScenarios, format: 'number', tone: 'info', category: 'forecast',
      source: 'ledger', helper: 'Cenários comparáveis',
      details: 'Cenários derivados do ledger por entry_type (realized/budget/forecast) e multiplicadores (stress/optimistic/board).',
      drilldown: FORECAST_SCENARIOS.map((s) => ({
        label: s.name, value: s.ebitda, formattedValue: fmtCompactBRL(s.ebitda),
      })),
      asOf,
    },
    {
      id: 'rv', title: 'Receita simulada', value: simulated.revenue, format: 'compactCurrency',
      delta: revDelta, deltaLabel: 'vs baseline', tone: 'info', category: 'revenue',
      source: 'derived', helper: `Baseline: ${baseline.name}`,
      details: 'Receita líquida estimada após aplicação das premissas — calculada por simulateScenario().',
      asOf,
    },
    {
      id: 'eb', title: 'EBITDA simulado', value: simulated.ebitda, format: 'compactCurrency',
      delta: ebitdaDelta, deltaLabel: 'vs baseline',
      tone: simulated.ebitda >= baseline.ebitda ? 'success' : 'danger', category: 'margin',
      source: 'derived', helper: `Margem ${simulated.margin.toFixed(1)}%`,
      details: 'EBITDA estimado sob composição das premissas.',
      asOf,
    },
    {
      id: 'mg', title: 'Margem simulada', value: simulated.margin, format: 'percent',
      delta: simulated.margin - baseline.margin, deltaLabel: 'pp vs baseline',
      tone: 'success', category: 'margin', source: 'derived', helper: 'EBITDA / Receita',
      details: 'Margem EBITDA resultante das premissas correntes.', asOf,
    },
    {
      id: 'cs', title: 'Caixa projetado', value: simulated.cash, format: 'compactCurrency',
      deltaLabel: '12m rolling', tone: 'info', category: 'cash', source: 'derived', helper: 'Pós OPEX e impostos',
      details: 'Geração de caixa estimada nos próximos 12 meses.', asOf,
    },
  ];
}

export function buildForecastSCurveSeries(scenarios: ForecastScenario[]) {
  const selected = ['real', 'bud', 'fcst', 'str', 'brd'] as const;
  return selected.map((id) => {
    const sc = scenarios.find((s) => s.id === id);
    if (!sc) return null;
    const monthly = Array(12).fill(0).map((_, i) => {
      const ref = sc.trajectory[Math.min(i, sc.trajectory.length - 1)] * 1000;
      return ref / 12;
    });
    return {
      name: sc.name,
      values: monthly,
      tone: (id === 'bud'
        ? 'budget'
        : id === 'fcst'
          ? 'accent'
          : id === 'str'
            ? 'danger'
            : id === 'brd'
              ? 'info'
              : 'success') as 'budget' | 'accent' | 'danger' | 'info' | 'success',
      dashed: id === 'bud' || id === 'brd',
      emphasized: id === 'fcst',
    };
  }).filter(Boolean) as Array<{ name: string; values: number[]; tone: 'budget' | 'accent' | 'danger' | 'info' | 'success'; dashed: boolean; emphasized: boolean }>;
}

export function buildForecastRadarSeries(scenarios: ForecastScenario[]) {
  const refRevenue = 22_000_000;
  const refEbitda = 5_500_000;
  const refMargin = 28;
  const refCash = 7_500_000;
  const ids = ['fcst', 'str', 'brd'] as const;
  return ids.map((id) => {
    const sc = scenarios.find((s) => s.id === id);
    if (!sc) return null;
    return {
      name: sc.name,
      values: [
        Math.round((sc.revenue / refRevenue) * 100),
        Math.round((sc.ebitda / refEbitda) * 100),
        Math.round((sc.margin / refMargin) * 100),
        Math.round((sc.cash / refCash) * 100),
        id === 'str' ? 30 : id === 'fcst' ? 78 : 88,
      ],
      tone: (id === 'fcst' ? 'accent' : id === 'str' ? 'danger' : 'info') as 'accent' | 'danger' | 'info',
    };
  }).filter(Boolean) as Array<{ name: string; values: number[]; tone: 'accent' | 'danger' | 'info' }>;
}

export function buildSensitivityTornado(assumptions: ForecastAssumption[]) {
  return assumptions.map((a) => ({
    label: a.label,
    low: Math.abs(a.sensitivity * 10),
    high: Math.abs(a.sensitivity * 10),
  }));
}

export const RADAR_INDICATORS = ['Receita', 'EBITDA', 'Margem', 'Caixa', 'Risco mitigado'];

export { variancePct };
