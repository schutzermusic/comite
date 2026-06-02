/**
 * Workforce Period Data Layer
 * ───────────────────────────────────────────────────────────────────────────
 * Single source of truth for the Pessoas & Custos overview when filtered by a
 * period. Everything the overview renders (KPIs, cost concentration, alerts,
 * payroll risk, trend chart, PDF payload) is DERIVED from a monthly time-series
 * of workforce records through pure selectors — no component hardcodes numbers.
 *
 * The monthly series below is a MOCK that intentionally reproduces the existing
 * dashboard numbers for the latest competence month, so the default view
 * ("Mês atual") is identical to what shipped before this filter existed.
 *
 * Replacing the mock with Supabase later only requires swapping
 * `getWorkforceMonthlySeries()` for a query that returns the same
 * `WorkforceMonthlyRecord[]`. When approved `PayrollClosingBatch` rows exist,
 * they become the payroll source: map each batch's `competence_month` +
 * `total_amount_cents` (and cost-center / contract splits from the parse
 * result) onto a `WorkforceMonthlyRecord`. "Todo período" then aggregates every
 * available batch. See [[payroll-closing]].
 */

import {
  type WorkforceMetrics,
  type CostConcentrationData,
  type CostCenter,
  type PayrollRiskData,
  determinePayrollRiskStatus,
  calculatePayrollRiskScore,
} from '@/lib/workforce-data';
import type { PayrollClosingBatchApproved } from '@/lib/types/payroll-closing';

// ============================================
// PERIOD TYPES & OPTIONS
// ============================================

export type WorkforcePeriodKey =
  | 'current-month'
  | 'previous-month'
  | 'current-quarter'
  | 'current-year'
  | 'custom'
  | 'all';

export interface WorkforcePeriodSelection {
  key: WorkforcePeriodKey;
  /** Custom range start, competence month 'YYYY-MM'. Only for key === 'custom'. */
  customStart?: string;
  /** Custom range end, competence month 'YYYY-MM'. Only for key === 'custom'. */
  customEnd?: string;
}

export const WORKFORCE_PERIOD_OPTIONS: { value: WorkforcePeriodKey; label: string }[] = [
  { value: 'current-month', label: 'Mês atual' },
  { value: 'previous-month', label: 'Mês anterior' },
  { value: 'current-quarter', label: 'Trimestre atual' },
  { value: 'current-year', label: 'Ano atual' },
  { value: 'custom', label: 'Personalizado' },
  { value: 'all', label: 'Todo período' },
];

export const DEFAULT_WORKFORCE_PERIOD: WorkforcePeriodSelection = { key: 'current-month' };

// ============================================
// SOURCE LAYER — monthly workforce records
// ============================================

export interface WorkforceMonthlyCostCenter {
  id: string;
  name: string;
  department?: string;
  manager?: string;
  payrollValue: number;
  headcount: number;
}

export interface WorkforceMonthlyRecord {
  /** Competence month, 'YYYY-MM'. Matches PayrollClosingBatch.competence_month. */
  competenceMonth: string;
  headcount: number;
  /** Total monthly payroll (equals the sum of costCenters.payrollValue). */
  payroll: number;
  /** Monthly revenue, used for the Folha/Receita ratio. */
  revenue: number;
  pj: number;
  clt: number;
  pjCost: number;
  cltCost: number;
  costCenters: WorkforceMonthlyCostCenter[];
}

interface CostCenterSeed {
  id: string;
  name: string;
  department: string;
  manager: string;
  /** Latest-month payroll value (BRL). */
  baseValue: number;
  /** Latest-month headcount. */
  baseHeadcount: number;
  /** Month-over-month growth rate (e.g. 0.125 = +12.5%/mo). Drives history + alerts. */
  growth: number;
}

// Latest-month seeds reproduce the previously hardcoded dashboard exactly:
// Σ baseValue = 12_850_000, top-3 (Eng+Ops+Com) ≈ 69.8% concentration.
const COST_CENTER_SEEDS: CostCenterSeed[] = [
  { id: 'cc-001', name: 'Engenharia', department: 'Tecnologia', manager: 'Carlos Silva', baseValue: 3_850_000, baseHeadcount: 185, growth: 0.125 },
  { id: 'cc-002', name: 'Operações', department: 'Operações', manager: 'Ana Costa', baseValue: 2_950_000, baseHeadcount: 245, growth: 0.082 },
  { id: 'cc-003', name: 'Comercial', department: 'Vendas', manager: 'Roberto Mendes', baseValue: 2_180_000, baseHeadcount: 120, growth: 0.185 },
  { id: 'cc-004', name: 'Administrativo', department: 'Corporativo', manager: 'Maria Santos', baseValue: 1_420_000, baseHeadcount: 95, growth: 0.032 },
  { id: 'cc-005', name: 'P&D', department: 'Inovação', manager: 'Paulo Lima', baseValue: 1_250_000, baseHeadcount: 65, growth: 0.228 },
  { id: 'cc-006', name: 'Marketing', department: 'Marketing', manager: 'Fernanda Rocha', baseValue: 720_000, baseHeadcount: 42, growth: 0.055 },
  { id: 'cc-007', name: 'RH', department: 'Pessoas', manager: 'Juliana Alves', baseValue: 480_000, baseHeadcount: 35, growth: 0.021 },
];

// Latest-month aggregate seeds (also matching the prior dashboard).
const LATEST_SEED = {
  competenceMonth: '2025-12',
  headcount: 847,
  pj: 312,
  clt: 535,
  pjCost: 5_460_000,
  cltCost: 7_390_000,
  // revenue chosen so payroll(12.85M) / revenue = 28.4% → matches prior ratio.
  revenue: 12_850_000 / 0.284,
};

const MONTHS_OF_HISTORY = 24; // 2024-01 … 2025-12 → enables MoM, QoQ, YoY, all.

function shiftCompetenceMonth(latest: string, monthsBack: number): string {
  const [y, m] = latest.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - monthsBack, 1));
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
}

/**
 * Build the deterministic monthly series. The latest record reproduces the
 * existing dashboard; earlier months are derived by discounting each series by
 * its growth rate so every comparison window (month/quarter/year) has data.
 */
function buildWorkforceMonthlySeries(): WorkforceMonthlyRecord[] {
  const records: WorkforceMonthlyRecord[] = [];

  for (let i = MONTHS_OF_HISTORY - 1; i >= 0; i--) {
    // k = months before the latest record (0 = latest).
    const k = i;
    const competenceMonth = shiftCompetenceMonth(LATEST_SEED.competenceMonth, k);

    const costCenters: WorkforceMonthlyCostCenter[] = COST_CENTER_SEEDS.map((cc) => ({
      id: cc.id,
      name: cc.name,
      department: cc.department,
      manager: cc.manager,
      payrollValue: Math.round(cc.baseValue / Math.pow(1 + cc.growth, k)),
      headcount: Math.round(cc.baseHeadcount / Math.pow(1.004, k)),
    }));

    const payroll = costCenters.reduce((s, c) => s + c.payrollValue, 0);
    const headcount = Math.round(LATEST_SEED.headcount / Math.pow(1.004, k));
    const pj = Math.round(LATEST_SEED.pj / Math.pow(1.005, k));
    const clt = Math.round(LATEST_SEED.clt / Math.pow(1.0035, k));
    const pjCost = Math.round(LATEST_SEED.pjCost / Math.pow(1.015, k));
    const cltCost = Math.round(LATEST_SEED.cltCost / Math.pow(1.013, k));
    const revenue = Math.round(LATEST_SEED.revenue / Math.pow(1.012, k));

    records.push({
      competenceMonth,
      headcount,
      payroll,
      revenue,
      pj,
      clt,
      pjCost,
      cltCost,
      costCenters,
    });
  }

  // Oldest → newest.
  return records;
}

let _series: WorkforceMonthlyRecord[] | null = null;

export function getWorkforceMonthlySeries(): WorkforceMonthlyRecord[] {
  if (!_series) _series = buildWorkforceMonthlySeries();
  return _series;
}

/** Available competence months (oldest → newest) for the custom-range picker. */
export function getAvailableCompetenceMonths(): string[] {
  return getWorkforceMonthlySeries().map((r) => r.competenceMonth);
}

// ============================================
// PERIOD RESOLUTION
// ============================================

interface ResolvedRange {
  /** Records in the selected period (oldest → newest). */
  current: WorkforceMonthlyRecord[];
  /** Records in the comparison period, or [] when no clear baseline exists. */
  previous: WorkforceMonthlyRecord[];
  label: string;
}

function quarterOf(competenceMonth: string): number {
  const m = Number(competenceMonth.split('-')[1]);
  return Math.floor((m - 1) / 3) + 1;
}

function monthLabel(competenceMonth: string): string {
  const [y, m] = competenceMonth.split('-').map(Number);
  const names = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${names[m - 1]}/${y}`;
}

/**
 * Resolve a period selection into current + comparison windows over the series.
 * Resolution is index/competence based (not wall-clock) because the data is a
 * fixed mock; the latest record is treated as the "current month".
 * Pass `seriesOverride` to use an effective merged series instead of the cached mock.
 */
export function resolvePeriodRange(selection: WorkforcePeriodSelection, seriesOverride?: WorkforceMonthlyRecord[]): ResolvedRange {
  const series = seriesOverride ?? getWorkforceMonthlySeries();
  const latestIdx = series.length - 1;
  const latest = series[latestIdx];

  switch (selection.key) {
    case 'current-month': {
      return {
        current: [latest],
        previous: latestIdx >= 1 ? [series[latestIdx - 1]] : [],
        label: monthLabel(latest.competenceMonth),
      };
    }
    case 'previous-month': {
      const cur = latestIdx >= 1 ? [series[latestIdx - 1]] : [latest];
      const prev = latestIdx >= 2 ? [series[latestIdx - 2]] : [];
      return { current: cur, previous: prev, label: monthLabel(cur[0].competenceMonth) };
    }
    case 'current-quarter': {
      const y = latest.competenceMonth.split('-')[0];
      const q = quarterOf(latest.competenceMonth);
      const inQuarter = (r: WorkforceMonthlyRecord) =>
        r.competenceMonth.startsWith(y) && quarterOf(r.competenceMonth) === q;
      const current = series.filter(inQuarter);
      // Previous quarter = the 3 months immediately preceding the current window.
      const firstIdx = series.findIndex((r) => r.competenceMonth === current[0].competenceMonth);
      const previous = series.slice(Math.max(0, firstIdx - current.length), firstIdx);
      return { current, previous, label: `${q}º Tri ${y}` };
    }
    case 'current-year': {
      const y = latest.competenceMonth.split('-')[0];
      const current = series.filter((r) => r.competenceMonth.startsWith(y));
      const prevYear = String(Number(y) - 1);
      const previous = series.filter((r) => r.competenceMonth.startsWith(prevYear));
      return { current, previous, label: `Ano ${y}` };
    }
    case 'custom': {
      const start = selection.customStart ?? series[0].competenceMonth;
      const end = selection.customEnd ?? latest.competenceMonth;
      const [lo, hi] = start <= end ? [start, end] : [end, start];
      const current = series.filter((r) => r.competenceMonth >= lo && r.competenceMonth <= hi);
      const safeCurrent = current.length ? current : [latest];
      // Previous = an equal-length window immediately before the custom window.
      const firstIdx = series.findIndex((r) => r.competenceMonth === safeCurrent[0].competenceMonth);
      const previous = series.slice(Math.max(0, firstIdx - safeCurrent.length), firstIdx);
      const label =
        safeCurrent.length === 1
          ? monthLabel(safeCurrent[0].competenceMonth)
          : `${monthLabel(safeCurrent[0].competenceMonth)} – ${monthLabel(safeCurrent[safeCurrent.length - 1].competenceMonth)}`;
      return { current: safeCurrent, previous, label };
    }
    case 'all':
    default: {
      return { current: series, previous: [], label: 'Todo período' };
    }
  }
}

// ============================================
// AGGREGATION
// ============================================

interface RangeAggregate {
  headcount: number;
  /** Average monthly payroll across the window (== the month value for 1 month). */
  avgPayroll: number;
  /** Accumulated payroll across the window. */
  totalPayroll: number;
  avgRevenue: number;
  avgCost: number;
  pj: number;
  clt: number;
  pjCost: number;
  cltCost: number;
  payrollAsRevenue: number;
  months: number;
}

function aggregateRange(records: WorkforceMonthlyRecord[]): RangeAggregate | null {
  if (records.length === 0) return null;
  const latest = records[records.length - 1];
  const months = records.length;

  const totalPayroll = records.reduce((s, r) => s + r.payroll, 0);
  const avgPayroll = Math.round(totalPayroll / months);
  const avgRevenue = Math.round(records.reduce((s, r) => s + r.revenue, 0) / months);
  const headcount = latest.headcount; // point-in-time (latest in window)
  const avgCost = headcount > 0 ? Math.round(avgPayroll / headcount) : 0;
  const payrollAsRevenue = avgRevenue > 0 ? (avgPayroll / avgRevenue) * 100 : 0;

  return {
    headcount,
    avgPayroll,
    totalPayroll,
    avgRevenue,
    avgCost,
    pj: latest.pj,
    clt: latest.clt,
    pjCost: latest.pjCost,
    cltCost: latest.cltCost,
    payrollAsRevenue,
    months,
  };
}

function pctChange(current: number, previous: number): number {
  if (!previous) return 0;
  return ((current - previous) / previous) * 100;
}

// ============================================
// PERIOD META (comparison labels)
// ============================================

export interface WorkforcePeriodMeta {
  periodKey: WorkforcePeriodKey;
  periodLabel: string;
  /** True when a clear baseline exists → show variation deltas. */
  hasComparison: boolean;
  /** "vs mês anterior" / "vs trim. anterior" / "vs ano anterior" / "vs período anterior". */
  comparisonLabel: string;
  /** Per-KPI label when there is no comparison (accumulated/average view). */
  accumulatedLabels: {
    headcount: string;
    payroll: string;
    avgCost: string;
  };
  /** 'point' = single month; 'average' = averaged across a multi-month window. */
  aggregation: 'point' | 'average';
  monthsInRange: number;
  /** Accumulated payroll across the window (for PDF / "todo período" totals). */
  totalPayrollAccum: number;
  generatedAt: string;
  source: string;
}

function comparisonLabelFor(key: WorkforcePeriodKey, hasComparison: boolean): string {
  if (!hasComparison) return '';
  switch (key) {
    case 'current-month':
    case 'previous-month':
      return 'vs mês anterior';
    case 'current-quarter':
      return 'vs trim. anterior';
    case 'current-year':
      return 'vs ano anterior';
    case 'custom':
      return 'vs período anterior';
    default:
      return '';
  }
}

function buildMeta(
  selection: WorkforcePeriodSelection,
  range: ResolvedRange,
  agg: RangeAggregate,
): WorkforcePeriodMeta {
  const hasComparison = range.previous.length > 0;
  const aggregation: 'point' | 'average' = agg.months > 1 ? 'average' : 'point';
  return {
    periodKey: selection.key,
    periodLabel: range.label,
    hasComparison,
    comparisonLabel: comparisonLabelFor(selection.key, hasComparison),
    accumulatedLabels: {
      headcount: 'posição atual',
      payroll: aggregation === 'average' ? 'média mensal' : 'acumulado histórico',
      avgCost: 'média histórica',
    },
    aggregation,
    monthsInRange: agg.months,
    totalPayrollAccum: agg.totalPayroll,
    generatedAt: new Date().toISOString(),
    source: 'eSocial',
  };
}

// ============================================
// SELECTORS (period-aware)
// ============================================

export interface WorkforceOverviewResult {
  metrics: WorkforceMetrics;
  meta: WorkforcePeriodMeta;
}

/** KPI cards + PJ vs CLT, period-aware. */
export function selectWorkforceOverview(selection: WorkforcePeriodSelection, seriesOverride?: WorkforceMonthlyRecord[]): WorkforceOverviewResult {
  const range = resolvePeriodRange(selection, seriesOverride);
  const agg = aggregateRange(range.current)!;
  const prev = aggregateRange(range.previous);
  const meta = buildMeta(selection, range, agg);

  const headcountTrend = prev ? pctChange(agg.headcount, prev.headcount) : 0;
  const payrollTrend = prev ? pctChange(agg.avgPayroll, prev.avgPayroll) : 0;
  const avgCostTrend = prev ? pctChange(agg.avgCost, prev.avgCost) : 0;

  const pjPercent = agg.pj + agg.clt > 0 ? (agg.pj / (agg.pj + agg.clt)) * 100 : 0;
  const cltPercent = 100 - pjPercent;

  const metrics: WorkforceMetrics = {
    headcount: {
      total: agg.headcount,
      trend: Number(headcountTrend.toFixed(1)),
      delta: prev ? agg.headcount - prev.headcount : 0,
      sparkline: range.current.map((r) => r.headcount),
    },
    monthlyPayroll: {
      value: agg.avgPayroll,
      currency: 'BRL',
      trend: Number(payrollTrend.toFixed(1)),
      sparkline: range.current.map((r) => r.payroll),
    },
    avgCostPerEmployee: {
      value: agg.avgCost,
      trend: Number(avgCostTrend.toFixed(1)),
      currency: 'BRL',
    },
    payrollAsRevenuePercent: {
      value: Number(agg.payrollAsRevenue.toFixed(1)),
      threshold: 30,
      status: agg.payrollAsRevenue >= 35 ? 'risk' : agg.payrollAsRevenue >= 30 ? 'attention' : 'healthy',
      previousValue: prev ? Number(prev.payrollAsRevenue.toFixed(1)) : undefined,
    },
    contractDistribution: {
      pj: agg.pj,
      clt: agg.clt,
      pjPercent: Number(pjPercent.toFixed(1)),
      cltPercent: Number(cltPercent.toFixed(1)),
      pjCost: agg.pjCost,
      cltCost: agg.cltCost,
    },
  };

  return { metrics, meta };
}

/** Alias for the KPI surface — same payload as the overview. */
export const selectPayrollKpis = selectWorkforceOverview;

/** Cost-center concentration, period-aware (accumulated payroll across window). */
export function selectCostCenterConcentration(selection: WorkforcePeriodSelection, seriesOverride?: WorkforceMonthlyRecord[]): CostConcentrationData {
  const range = resolvePeriodRange(selection, seriesOverride);

  // When imported records supply their own CCs (non-empty costCenters on the
  // latest record in the window), use those directly instead of the mock seeds.
  const latestRecord = range.current[range.current.length - 1];
  const useImportedCCs = (latestRecord?.costCenters.length ?? 0) > 0 &&
    latestRecord.costCenters.some((c) => c.id.startsWith('cc-imported-'));

  if (useImportedCCs) {
    const allIds = [...new Set(range.current.flatMap((r) => r.costCenters.map((c) => c.id)))];
    const costCenters: CostCenter[] = allIds.map((id) => {
      const curRows = range.current.map((r) => r.costCenters.find((c) => c.id === id)!).filter(Boolean);
      const prevRows = range.previous.map((r) => r.costCenters.find((c) => c.id === id)!).filter(Boolean);
      const payrollValue = curRows.reduce((s, c) => s + c.payrollValue, 0);
      const latestCC = curRows[curRows.length - 1];
      const prevSum = prevRows.reduce((s, c) => s + c.payrollValue, 0);
      const growthVsPrevious = prevSum > 0 ? Number(pctChange(payrollValue, prevSum).toFixed(1)) : 0;
      return {
        id,
        name: latestCC?.name ?? id,
        payrollValue,
        headcount: latestCC?.headcount ?? 0,
        growthVsPrevious,
        isAbnormal: Math.abs(growthVsPrevious) > 15,
        department: latestCC?.department ?? '',
        manager: latestCC?.manager ?? '',
      };
    });
    const totalPayroll = costCenters.reduce((s, c) => s + c.payrollValue, 0);
    const sorted = [...costCenters].sort((a, b) => b.payrollValue - a.payrollValue);
    const top3 = sorted.slice(0, 3).reduce((s, c) => s + c.payrollValue, 0);
    const top3Concentration = totalPayroll > 0 ? Number(((top3 / totalPayroll) * 100).toFixed(1)) : 0;
    return { costCenters: sorted, totalPayroll, top3Concentration, currency: 'BRL' };
  }

  // Original mock path — uses COST_CENTER_SEEDS.
  const ids = COST_CENTER_SEEDS.map((s) => s.id);
  const costCenters: CostCenter[] = ids.map((id) => {
    const seed = COST_CENTER_SEEDS.find((s) => s.id === id)!;
    const curRows = range.current.map((r) => r.costCenters.find((c) => c.id === id)!).filter(Boolean);
    const prevRows = range.previous.map((r) => r.costCenters.find((c) => c.id === id)!).filter(Boolean);

    const payrollValue = curRows.reduce((s, c) => s + c.payrollValue, 0);
    const latestRow = curRows[curRows.length - 1];
    const headcount = latestRow ? latestRow.headcount : 0;

    let growthVsPrevious: number;
    if (prevRows.length > 0) {
      const prevSum = prevRows.reduce((s, c) => s + c.payrollValue, 0);
      growthVsPrevious = pctChange(payrollValue, prevSum);
    } else if (curRows.length > 1) {
      growthVsPrevious = pctChange(curRows[curRows.length - 1].payrollValue, curRows[0].payrollValue);
    } else {
      growthVsPrevious = seed.growth * 100;
    }

    return {
      id: seed.id,
      name: seed.name,
      payrollValue,
      headcount,
      growthVsPrevious: Number(growthVsPrevious.toFixed(1)),
      isAbnormal: growthVsPrevious > 15,
      department: seed.department,
      manager: seed.manager,
    };
  });

  const totalPayroll = costCenters.reduce((s, c) => s + c.payrollValue, 0);
  const sorted = [...costCenters].sort((a, b) => b.payrollValue - a.payrollValue);
  const top3 = sorted.slice(0, 3).reduce((s, c) => s + c.payrollValue, 0);
  const top3Concentration = totalPayroll > 0 ? Number(((top3 / totalPayroll) * 100).toFixed(1)) : 0;

  return { costCenters, totalPayroll, top3Concentration, currency: 'BRL' };
}

export interface WorkforceAlert {
  id: string;
  type: 'abnormal_growth' | 'threshold_exceeded';
  severity: 'warning' | 'error';
  title: string;
  description: string;
  costCenterId?: string;
  value?: number;
}

/** Period-aware alert list — same logic the Alert Center renders, for counts/PDF. */
export function selectWorkforceAlerts(selection: WorkforcePeriodSelection, seriesOverride?: WorkforceMonthlyRecord[]): WorkforceAlert[] {
  const { costCenters } = selectCostCenterConcentration(selection, seriesOverride);
  const { metrics } = selectWorkforceOverview(selection, seriesOverride);
  const alerts: WorkforceAlert[] = [];

  costCenters.forEach((c) => {
    if (c.isAbnormal) {
      alerts.push({
        id: `abnormal-${c.id}`,
        type: 'abnormal_growth',
        severity: c.growthVsPrevious > 20 ? 'error' : 'warning',
        title: c.name,
        description: `Crescimento de ${c.growthVsPrevious > 0 ? '+' : ''}${c.growthVsPrevious.toFixed(1)}% acima do esperado`,
        costCenterId: c.id,
        value: c.growthVsPrevious,
      });
    }
  });

  const pr = metrics.payrollAsRevenuePercent;
  if (pr.value >= pr.threshold) {
    alerts.push({
      id: 'threshold-payroll-revenue',
      type: 'threshold_exceeded',
      severity: pr.value >= pr.threshold + 5 ? 'error' : 'warning',
      title: 'Folha/Receita',
      description: `${pr.value.toFixed(1)}% atingiu o limite de ${pr.threshold}%`,
      value: pr.value,
    });
  }

  return alerts;
}

/** Payroll risk indicator, period-aware (payroll growth vs revenue growth). */
export function selectPayrollRisk(selection: WorkforcePeriodSelection, seriesOverride?: WorkforceMonthlyRecord[]): PayrollRiskData {
  const range = resolvePeriodRange(selection, seriesOverride);
  const agg = aggregateRange(range.current)!;
  const prev = aggregateRange(range.previous);

  // With no baseline (e.g. "Todo período") fall back to first-vs-last within range.
  const payrollGrowth = prev
    ? pctChange(agg.avgPayroll, prev.avgPayroll)
    : pctChange(range.current[range.current.length - 1].payroll, range.current[0].payroll);
  const revenueGrowth = prev
    ? pctChange(agg.avgRevenue, prev.avgRevenue)
    : pctChange(range.current[range.current.length - 1].revenue, range.current[0].revenue);

  const status = determinePayrollRiskStatus(payrollGrowth, revenueGrowth);
  const riskScore = calculatePayrollRiskScore(payrollGrowth, revenueGrowth);

  return {
    payrollGrowth: Number(payrollGrowth.toFixed(1)),
    revenueGrowth: Number(revenueGrowth.toFixed(1)),
    status,
    riskScore,
    message:
      status === 'healthy'
        ? 'Crescimento da folha alinhado com receita'
        : status === 'attention'
        ? 'Folha crescendo ligeiramente acima da receita'
        : 'Alerta: Folha crescendo significativamente acima da receita',
  };
}

export interface WorkforceTrendPoint {
  period: string;
  payroll: number;
  headcount: number;
  avgCost: number;
}

/** Trend chart series scoped to the selected window. */
export function selectWorkforceTrend(selection: WorkforcePeriodSelection, seriesOverride?: WorkforceMonthlyRecord[]): WorkforceTrendPoint[] {
  const range = resolvePeriodRange(selection, seriesOverride);
  // For a single-month selection the chart is uninformative; show the trailing
  // 12 months ending at that month instead so the trend stays meaningful.
  let rows = range.current;
  if (rows.length < 2) {
    const series = seriesOverride ?? getWorkforceMonthlySeries();
    const endIdx = series.findIndex((r) => r.competenceMonth === rows[0].competenceMonth);
    rows = series.slice(Math.max(0, endIdx - 11), endIdx + 1);
  }
  return rows.map((r) => ({
    period: monthLabel(r.competenceMonth),
    payroll: r.payroll,
    headcount: r.headcount,
    avgCost: r.headcount > 0 ? Math.round(r.payroll / r.headcount) : 0,
  }));
}

// ============================================
// COMPOSED VIEW MODEL (one call for the page)
// ============================================

export interface WorkforceViewModel {
  metrics: WorkforceMetrics;
  costConcentration: CostConcentrationData;
  payrollRisk: PayrollRiskData;
  alerts: WorkforceAlert[];
  trend: WorkforceTrendPoint[];
  meta: WorkforcePeriodMeta;
}

export function selectWorkforceView(selection: WorkforcePeriodSelection): WorkforceViewModel {
  const { metrics, meta } = selectWorkforceOverview(selection);
  return {
    metrics,
    costConcentration: selectCostCenterConcentration(selection),
    payrollRisk: selectPayrollRisk(selection),
    alerts: selectWorkforceAlerts(selection),
    trend: selectWorkforceTrend(selection),
    meta,
  };
}

// ============================================
// PAYROLL CLOSING ADAPTERS
// ============================================

/**
 * Map an approved PayrollClosingBatch (enriched with cost-center summaries and
 * headcount) into a WorkforceMonthlyRecord suitable for the period selectors.
 */
export function mapPayrollClosingBatchToWorkforceMonth(
  batch: PayrollClosingBatchApproved,
): WorkforceMonthlyRecord {
  const totalBRL = batch.total_amount_cents / 100;
  const costCenters: WorkforceMonthlyCostCenter[] = batch.cost_center_summaries.map((s) => ({
    id: s.matched_cost_center_id ?? `cc-imported-${s.cost_center_label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`,
    name: s.cost_center_label,
    payrollValue: s.amount_cents / 100,
    headcount: 0,
  }));
  const safeCostCenters =
    costCenters.length > 0
      ? costCenters
      : [{ id: 'cc-imported-total', name: 'Folha Importada', payrollValue: totalBRL, headcount: batch.headcount }];
  return {
    competenceMonth: batch.competence_month,
    headcount: batch.headcount,
    payroll: totalBRL,
    revenue: 0,
    pj: 0,
    clt: batch.headcount,
    pjCost: 0,
    cltCost: totalBRL,
    costCenters: safeCostCenters,
  };
}

/**
 * Merge approved PayrollClosingBatch records into the base mock series.
 * Imported months replace the corresponding mock record (or extend beyond it).
 * Returns a sorted series (oldest → newest).
 */
export function buildEffectiveSeries(approvedBatches: PayrollClosingBatchApproved[]): WorkforceMonthlyRecord[] {
  if (approvedBatches.length === 0) return getWorkforceMonthlySeries();
  const base = getWorkforceMonthlySeries();
  const overrides = new Map(
    approvedBatches.map((b) => [b.competence_month, mapPayrollClosingBatchToWorkforceMonth(b)]),
  );

  // The mock series ends well before an imported competence (e.g. 2026-04), so a
  // batch may have no preceding record for the month-over-month comparison. When
  // the batch carries its own previous_month_amount_cents and no real record
  // exists for that prior month, synthesize a minimal previous-month record so
  // the overview shows the imported variation exactly (not a mock baseline).
  for (const b of approvedBatches) {
    if (b.previous_month_amount_cents == null) continue;
    const prevMonth = shiftCompetenceMonth(b.competence_month, 1);
    if (overrides.has(prevMonth)) continue;
    const prevPayroll = b.previous_month_amount_cents / 100;
    overrides.set(prevMonth, {
      competenceMonth: prevMonth,
      headcount: 0,
      payroll: prevPayroll,
      revenue: 0,
      pj: 0,
      clt: 0,
      pjCost: 0,
      cltCost: prevPayroll,
      costCenters: [{ id: 'cc-imported-total', name: 'Folha Importada', payrollValue: prevPayroll, headcount: 0 }],
    });
  }

  const merged = base.map((r) => overrides.get(r.competenceMonth) ?? r);
  for (const [month, record] of overrides) {
    if (!merged.find((r) => r.competenceMonth === month)) merged.push(record);
  }
  return merged.sort((a, b) => a.competenceMonth.localeCompare(b.competenceMonth));
}

/**
 * Drop-in replacement for selectWorkforceView that feeds approved
 * PayrollClosingBatch records as the primary payroll source.
 * Falls back to the mock series when approvedBatches is empty.
 */
export function selectWorkforceViewWithClosings(
  selection: WorkforcePeriodSelection,
  approvedBatches: PayrollClosingBatchApproved[],
): WorkforceViewModel & { hasMockFallback: boolean } {
  const series = buildEffectiveSeries(approvedBatches);
  const { metrics, meta } = selectWorkforceOverview(selection, series);
  return {
    metrics,
    costConcentration: selectCostCenterConcentration(selection, series),
    payrollRisk: selectPayrollRisk(selection, series),
    alerts: selectWorkforceAlerts(selection, series),
    trend: selectWorkforceTrend(selection, series),
    meta,
    hasMockFallback: approvedBatches.length === 0,
  };
}
