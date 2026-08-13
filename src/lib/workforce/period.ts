/**
 * Camada de período de Pessoas & Custos
 * ───────────────────────────────────────────────────────────────────────────
 * Fonte única da Visão Geral quando filtrada por período. Tudo o que a tela
 * mostra — KPIs, concentração de custo, alertas, risco de folha, gráficos, PDF
 * — é DERIVADO de uma série mensal por seletores puros. Nenhum componente
 * carrega número próprio.
 *
 * SOMENTE DADO REAL
 *
 * A série tem exatamente duas fontes, e nenhuma terceira:
 *   • lotes de fechamento da folha APROVADOS — valor e centro de custo;
 *   • métricas apuradas do eSocial — quadro, movimentação, afastamento, guias.
 *
 * A série sintética de demonstração que existia aqui foi removida, junto com
 * todo modelo derivado que preenchia lacuna (composição da folha por senoide,
 * absenteísmo por hash do id, churn estimado sobre a variação de headcount).
 * O motivo é simples: depois de formatado na tela, um número modelado é
 * indistinguível de um número apurado, e quem lê não tem como saber a
 * diferença. Onde não há fonte, o seletor devolve `null` ou lista vazia, e a
 * interface diz que a competência não foi apurada.
 *
 * Em consequência, indicadores que dependem de base ausente ficam AUSENTES:
 * receita por colaborador sem receita lançada, horas extras sem a tabela de
 * rubricas do eSocial (S-1010), composição da folha sem classificação de verba.
 * Ver `esocial-coverage` para a regra de procedência. [[payroll-closing]]
 */

import { competenceCoverage, type CompetenceCoverage } from './esocial-coverage';
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

/**
 * Números APURADOS da competência, vindos do eSocial. Quando presentes, os
 * selectors os preferem aos modelos derivados: um desligamento declarado no
 * S-2299 vale mais que uma estimativa de churn sobre a variação de headcount.
 */
export interface WorkforceActuals {
  admissions: number;
  terminations: number;
  absenceDays: number;
  absenceEvents: number;
  /**
   * Horas extras como % da massa bruta.
   *
   * `undefined` quando a tabela de rubricas não cobre a folha: sem ela as
   * verbas não são classificáveis, e um `0` seria lido como "não houve hora
   * extra" — afirmação que o dado não sustenta.
   */
  overtimePct?: number;
  /** O que dá e o que não dá para afirmar sobre esta competência. */
  coverage?: CompetenceCoverage;
  /**
   * De onde veio o quadro do mês.
   *
   * `manual` quando um administrador informou o número porque o eSocial não
   * entregou o detalhe por trabalhador. É afirmação assinada, não apuração —
   * e a interface precisa poder dizer isso.
   */
  headcountSource?: 'esocial' | 'manual';
  /** Origem declarada no lançamento manual (documento de referência). */
  headcountNote?: string;
  /**
   * Composição da folha, em reais. Presente só quando as verbas foram
   * classificadas pela tabela de rubricas: encargos vêm das guias apuradas
   * (INSS + FGTS), não de um percentual sobre a massa.
   */
  composition?: { salary: number; benefits: number; charges: number };
  /** Benefícios por tipo, agrupados pela natureza declarada da rubrica. */
  benefitsByType?: {
    va: number;
    vr: number;
    health: number;
    dental: number;
    transport: number;
    other: number;
  };
  areas: {
    code: string;
    label: string;
    headcount: number;
    admissions: number;
    terminations: number;
    absenceDays: number;
    payroll: number;
  }[];
}

export interface WorkforceMonthlyRecord {
  /** Competence month, 'YYYY-MM'. Matches PayrollClosingBatch.competence_month. */
  competenceMonth: string;
  /** Presente apenas nas competências já sincronizadas do eSocial. */
  actuals?: WorkforceActuals;
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

function shiftCompetenceMonth(latest: string, monthsBack: number): string {
  const [y, m] = latest.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - monthsBack, 1));
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
}

/**
 * Série vazia — o módulo não tem dado próprio.
 *
 * Antes existia aqui uma série sintética de 24 meses que reproduzia um
 * dashboard de demonstração. Ela foi removida por decisão de produto: um número
 * derivado de seed é indistinguível de um número apurado depois de formatado na
 * tela, e a única defesa contra isso é não produzi-lo.
 *
 * Toda leitura passa a vir de duas fontes reais, e só delas:
 *   • lotes de fechamento da folha aprovados (valor, centro de custo);
 *   • métricas apuradas do eSocial (quadro, movimentação, afastamento, guias).
 *
 * Sem nenhuma das duas, os seletores devolvem vazio e a interface diz que não
 * há competência apurada — que é a informação correta.
 */
const EMPTY_SERIES: WorkforceMonthlyRecord[] = [];

/** Competências disponíveis (mais antiga → mais recente) para o seletor de período. */
export function getAvailableCompetenceMonths(series: WorkforceMonthlyRecord[] = EMPTY_SERIES): string[] {
  return series.map((r) => r.competenceMonth);
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
 * Resolve o período em janela atual + janela de comparação sobre a série.
 *
 * A resolução é por competência, não por calendário: "mês atual" significa a
 * competência mais recente APURADA. Um mês de calendário sem fechamento nem
 * eventos do eSocial não existe na série, e apontar para ele mostraria zeros
 * onde a resposta certa é "ainda não apurado".
 */
export function resolvePeriodRange(selection: WorkforcePeriodSelection, seriesOverride?: WorkforceMonthlyRecord[]): ResolvedRange {
  const series = seriesOverride ?? EMPTY_SERIES;
  const latestIdx = series.length - 1;
  const latest = series[latestIdx];

  // Sem competência apurada não há janela a resolver. Os seletores adiante
  // tratam a janela vazia devolvendo vazio, em vez de dividir por zero.
  if (!latest) return { current: [], previous: [], label: 'Sem competência apurada' };

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

/**
 * Agregado neutro para janela sem competência.
 *
 * Enquanto existia a série de demonstração, `range.current` nunca vinha vazio e
 * o código a jusante assumia isso com um `!`. Sem mock, o primeiro render (antes
 * de o eSocial responder) e a instalação sem nada importado passam por aqui.
 *
 * Os zeros daqui NÃO são exibidos como fato: a tela troca o cockpit inteiro pelo
 * estado vazio quando não há competência (`hasData`). Este objeto existe para
 * manter os seletores puros e totais, não para preencher a interface.
 */
const EMPTY_AGGREGATE: RangeAggregate = {
  headcount: 0,
  avgPayroll: 0,
  totalPayroll: 0,
  avgRevenue: 0,
  avgCost: 0,
  pj: 0,
  clt: 0,
  pjCost: 0,
  cltCost: 0,
  payrollAsRevenue: 0,
  months: 0,
};

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
  const agg = aggregateRange(range.current) ?? EMPTY_AGGREGATE;
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

/**
 * Concentração por centro de custo, acumulada na janela do período.
 *
 * Os centros vêm dos próprios registros — do rateio do lote de folha aprovado
 * ou da lotação tributária apurada no eSocial. Não há mais catálogo fixo de
 * áreas ("Engenharia", "Comercial"…) nem crescimento por seed quando falta
 * comparativo: sem mês anterior, a variação é 0, que é o que se sabe.
 */
export function selectCostCenterConcentration(selection: WorkforcePeriodSelection, seriesOverride?: WorkforceMonthlyRecord[]): CostConcentrationData {
  const range = resolvePeriodRange(selection, seriesOverride);

  const allIds = [...new Set(range.current.flatMap((r) => r.costCenters.map((c) => c.id)))];
  const costCenters: CostCenter[] = allIds.map((id) => {
    const curRows = range.current.flatMap((r) => r.costCenters.filter((c) => c.id === id));
    const prevRows = range.previous.flatMap((r) => r.costCenters.filter((c) => c.id === id));
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
  const agg = aggregateRange(range.current) ?? EMPTY_AGGREGATE;
  const prev = aggregateRange(range.previous);

  // Sem linha de base (ex.: "Todo período"), compara primeiro contra último
  // dentro da janela. Janela vazia não tem crescimento a medir: 0.
  const first = range.current[0];
  const last = range.current[range.current.length - 1];
  const payrollGrowth = prev
    ? pctChange(agg.avgPayroll, prev.avgPayroll)
    : first && last ? pctChange(last.payroll, first.payroll) : 0;
  const revenueGrowth = prev
    ? pctChange(agg.avgRevenue, prev.avgRevenue)
    : first && last ? pctChange(last.revenue, first.revenue) : 0;

  // O diagnóstico só existe com as duas pontas medidas.
  const comparable = agg.avgRevenue > 0 && (prev ? prev.avgRevenue > 0 : true);
  const status = determinePayrollRiskStatus(payrollGrowth, revenueGrowth);
  const riskScore = calculatePayrollRiskScore(payrollGrowth, revenueGrowth);

  return {
    payrollGrowth: Number(payrollGrowth.toFixed(1)),
    revenueGrowth: Number(revenueGrowth.toFixed(1)),
    comparable,
    status: comparable ? status : 'healthy',
    riskScore: comparable ? riskScore : 0,
    message: !comparable
      ? 'Sem receita lançada no período — o risco de folha compara o crescimento da folha com o da receita e não pode ser apurado.'
      : status === 'healthy'
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

const WORKFORCE_CHART_MONTHS = 2;

/**
 * Keep every time-series chart aligned to the two most recent competence
 * months ending at the selected period. A single-month selection therefore
 * includes its immediately preceding month, while longer ranges are capped.
 */
function selectRecentChartRows(
  selection: WorkforcePeriodSelection,
  seriesOverride?: WorkforceMonthlyRecord[],
): WorkforceMonthlyRecord[] {
  const series = seriesOverride ?? EMPTY_SERIES;
  const range = resolvePeriodRange(selection, series);
  const anchor = range.current[range.current.length - 1] ?? series[series.length - 1];
  if (!anchor) return [];
  const endIdx = series.findIndex((r) => r.competenceMonth === anchor.competenceMonth);
  const safeEndIdx = endIdx >= 0 ? endIdx : series.length - 1;
  return series.slice(
    Math.max(0, safeEndIdx - (WORKFORCE_CHART_MONTHS - 1)),
    safeEndIdx + 1,
  );
}

/** Trend chart series scoped to the selected window. */
export function selectWorkforceTrend(selection: WorkforcePeriodSelection, seriesOverride?: WorkforceMonthlyRecord[]): WorkforceTrendPoint[] {
  const rows = selectRecentChartRows(selection, seriesOverride);
  return rows.map((r) => ({
    period: monthLabel(r.competenceMonth),
    payroll: r.payroll,
    headcount: r.headcount,
    avgCost: r.headcount > 0 ? Math.round(r.payroll / r.headcount) : 0,
  }));
}

// ============================================
// EXTENDED ANALYTICS SELECTORS (Sections C–F)
// ============================================

// --- Payroll Composition (salary / benefits / charges) ---

export interface PayrollCompositionPoint {
  period: string;
  salary: number;
  benefits: number;
  charges: number;
}

/**
 * Composição da folha: salário, benefícios e encargos.
 *
 * Só existe onde as verbas foram CLASSIFICADAS pela tabela de rubricas do
 * eSocial (S-1010) — é ela que diz se uma rubrica é provento, benefício ou
 * desconto. Antes havia aqui um rateio por senoide (68,5% salário, 14,8%
 * encargos…) que produzia um gráfico plausível e inteiramente inventado.
 *
 * Competência sem classificação não entra: o gráfico mostra apenas os meses
 * apurados, e vazio quando não há nenhum.
 */
export function selectPayrollComposition(
  selection: WorkforcePeriodSelection,
  seriesOverride?: WorkforceMonthlyRecord[],
): PayrollCompositionPoint[] {
  return selectRecentChartRows(selection, seriesOverride)
    .filter((r) => r.actuals?.coverage?.compositionReliable && r.actuals.composition)
    .map((r) => ({
      period: monthLabel(r.competenceMonth),
      salary: r.actuals!.composition!.salary,
      benefits: r.actuals!.composition!.benefits,
      charges: r.actuals!.composition!.charges,
    }));
}

// --- S-Curve (cumulative payroll, current vs previous period) ---

export interface SCurvePoint {
  period: string;
  cumulative: number;
  cumulativePrev: number | null;
}

export function selectPayrollSCurve(
  selection: WorkforcePeriodSelection,
  seriesOverride?: WorkforceMonthlyRecord[],
): SCurvePoint[] {
  const series = seriesOverride ?? EMPTY_SERIES;
  const curRows = selectRecentChartRows(selection, series);
  const firstIdx = series.findIndex((r) => r.competenceMonth === curRows[0]?.competenceMonth);
  const prevRows = firstIdx > 0
    ? series.slice(Math.max(0, firstIdx - WORKFORCE_CHART_MONTHS), firstIdx)
    : [];
  const maxLen = curRows.length;
  let cumCur = 0;
  let cumPrev = 0;
  const result: SCurvePoint[] = [];
  for (let i = 0; i < maxLen; i++) {
    if (i < curRows.length) cumCur += curRows[i].payroll;
    if (i < prevRows.length) cumPrev += prevRows[i].payroll;
    const period = i < curRows.length
      ? monthLabel(curRows[i].competenceMonth)
      : monthLabel(prevRows[i].competenceMonth);
    result.push({
      period,
      cumulative: i < curRows.length ? cumCur : 0,
      cumulativePrev: prevRows.length > 0 && i < prevRows.length ? cumPrev : null,
    });
  }
  return result;
}

// --- Payroll vs Revenue series ---

export interface PayrollVsRevenuePoint {
  period: string;
  payroll: number;
  revenue: number;
  payrollPct: number;
}

export function selectPayrollVsRevenue(
  selection: WorkforcePeriodSelection,
  seriesOverride?: WorkforceMonthlyRecord[],
): PayrollVsRevenuePoint[] {
  const rows = selectRecentChartRows(selection, seriesOverride);
  return rows.map((r) => ({
    period: monthLabel(r.competenceMonth),
    payroll: r.payroll,
    revenue: r.revenue,
    payrollPct: r.revenue > 0 ? Number(((r.payroll / r.revenue) * 100).toFixed(1)) : 0,
  }));
}

// --- Benefits by Type ---

export interface BenefitTypePoint {
  period: string;
  va: number;
  vr: number;
  health: number;
  dental: number;
  transport: number;
  other: number;
}

/**
 * Benefícios abertos por tipo.
 *
 * Cada tipo vem da NATUREZA da rubrica declarada na tabela do eSocial — é o
 * único lugar onde "vale alimentação" e "plano de saúde" são distinguíveis. O
 * rateio anterior (22% VA, 35% saúde…) desenhava uma composição que ninguém
 * havia declarado.
 *
 * Meses sem classificação de verba não entram.
 */
export function selectBenefitsByType(
  selection: WorkforcePeriodSelection,
  seriesOverride?: WorkforceMonthlyRecord[],
): BenefitTypePoint[] {
  return selectRecentChartRows(selection, seriesOverride)
    .filter((r) => r.actuals?.coverage?.compositionReliable && r.actuals.benefitsByType)
    .map((r) => ({ period: monthLabel(r.competenceMonth), ...r.actuals!.benefitsByType! }));
}

// --- Admissions vs Dismissals ---

export interface AdmissionDismissalPoint {
  period: string;
  admissions: number;
  dismissals: number;
  net: number;
}

/**
 * Admissões e desligamentos declarados (S-2200 / S-2299).
 *
 * Só competências apuradas pelo eSocial. Antes, os meses sem apuração ganhavam
 * um churn sintético — `headcount × 1,5% × (1 + 0,3·sen(i))` — somado à variação
 * de quadro. Movimentação de pessoal é um fato registrado, não uma estimativa:
 * onde o evento não existe, a resposta é ausência.
 */
export function selectAdmissionsVsDismissals(
  selection: WorkforcePeriodSelection,
  seriesOverride?: WorkforceMonthlyRecord[],
): AdmissionDismissalPoint[] {
  return selectRecentChartRows(selection, seriesOverride)
    .filter((r) => r.actuals)
    .map((r) => ({
      period: monthLabel(r.competenceMonth),
      admissions: r.actuals!.admissions,
      dismissals: r.actuals!.terminations,
      net: r.actuals!.admissions - r.actuals!.terminations,
    }));
}

// --- Turnover Trend ---

export interface TurnoverPoint {
  period: string;
  turnoverPct: number;
}

export function selectTurnoverTrend(
  selection: WorkforcePeriodSelection,
  seriesOverride?: WorkforceMonthlyRecord[],
): TurnoverPoint[] {
  // Casado por competência, não por índice: as duas listas agora só contêm
  // meses apurados, e parear por posição trocaria o mês do denominador.
  const headcountByPeriod = new Map(
    selectRecentChartRows(selection, seriesOverride).map((r) => [
      monthLabel(r.competenceMonth),
      r.headcount,
    ]),
  );
  return selectAdmissionsVsDismissals(selection, seriesOverride)
    .filter((d) => (headcountByPeriod.get(d.period) ?? 0) > 0)
    .map((d) => ({
      period: d.period,
      turnoverPct: Number(((d.dismissals / headcountByPeriod.get(d.period)!) * 100).toFixed(2)),
    }));
}

// --- Absenteeism by Area ---

export interface AbsenteeismPoint {
  area: string;
  pct: number;
  headcount: number;
}

/** Áreas exibidas nos gráficos de distribuição; o excedente vira "Outras áreas". */
const MAX_AREAS_IN_CHARTS = 8;
const OTHER_AREA_LABEL = 'Outras áreas';

/** Dias úteis usados como base do absenteísmo — convenção do módulo. */
const WORKDAYS_PER_MONTH = 21;

/**
 * Absenteísmo por área, dos afastamentos declarados no S-2230.
 *
 * Vem por lotação real, evento a evento. A versão anterior atribuía uma taxa
 * fixa por centro de custo (3,2%, 5,8%…) e, para os centros importados da
 * folha, derivava uma taxa do HASH DO ID — um número estável, plausível e sem
 * relação nenhuma com afastamento algum.
 */
export function selectAbsenteeismByArea(
  selection: WorkforcePeriodSelection,
  seriesOverride?: WorkforceMonthlyRecord[],
): AbsenteeismPoint[] {
  const rows = selectRecentChartRows(selection, seriesOverride).filter(
    (r) => r.actuals && r.actuals.areas.length > 0,
  );
  if (rows.length === 0) return [];

  const acc = new Map<string, { label: string; days: number; headcount: number }>();
  for (const r of rows) {
    for (const a of r.actuals!.areas) {
      const cur = acc.get(a.code) ?? { label: a.label, days: 0, headcount: 0 };
      cur.days += a.absenceDays;
      // Headcount é estoque: vale o da competência mais recente da janela.
      cur.headcount = a.headcount;
      acc.set(a.code, cur);
    }
  }

  return [...acc.values()]
    .map((v) => ({
      area: v.label,
      pct:
        v.headcount > 0
          ? Number(((v.days / (v.headcount * WORKDAYS_PER_MONTH * rows.length)) * 100).toFixed(1))
          : 0,
      headcount: v.headcount,
    }))
    .filter((a) => a.headcount > 0)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, MAX_AREAS_IN_CHARTS);
}

// --- Absenteeism by Area × Month (stacked) ---

export interface AbsenteeismMonthlyPoint {
  period: string;
  /** Faltas (dias-homem) por área no mês. */
  areas: { area: string; days: number }[];
  totalDays: number;
}

/**
 * Absenteísmo mensal aberto por área — equivalente ao "Absenteísmo por Projeto"
 * do BI legado, porém ancorado nos centros de custo, que são a dimensão canônica
 * de área no INSIGHT.
 */
export function selectAbsenteeismMonthlyByArea(
  selection: WorkforcePeriodSelection,
  seriesOverride?: WorkforceMonthlyRecord[],
): AbsenteeismMonthlyPoint[] {
  // Só afastamentos declarados no S-2230: dias reais, por lotação real. Meses
  // sem apuração do eSocial não entram — não há de onde tirar dia de falta.
  const rows = selectRecentChartRows(selection, seriesOverride).filter(
    (r) => r.actuals && r.actuals.areas.length > 0,
  );
  if (rows.length === 0) return [];

  // As áreas exibidas são fixadas pelo período inteiro (as de mais faltas), para
  // que a mesma área ocupe a mesma faixa da pilha em todos os meses.
  const totalByArea = new Map<string, number>();
  for (const r of rows) {
    for (const a of r.actuals!.areas) {
      totalByArea.set(a.code, (totalByArea.get(a.code) ?? 0) + a.absenceDays);
    }
  }
  const visible = new Set(
    [...totalByArea.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_AREAS_IN_CHARTS)
      .map(([code]) => code),
  );

  return rows.map((r) => {
    const byArea = new Map<string, number>();
    for (const a of r.actuals!.areas) {
      const label = visible.has(a.code) ? a.label : OTHER_AREA_LABEL;
      byArea.set(label, (byArea.get(label) ?? 0) + a.absenceDays);
    }
    const areas = [...byArea.entries()].map(([area, days]) => ({ area, days }));
    return {
      period: monthLabel(r.competenceMonth),
      areas,
      totalDays: areas.reduce((s, a) => s + a.days, 0),
    };
  });
}

// --- Turnover / Dismissals by Area ---

export interface AreaTurnoverPoint {
  id: string;
  area: string;
  headcount: number;
  dismissals: number;
  turnoverPct: number;
  /** Participação nos desligamentos do período (%). */
  sharePct: number;
}

/**
 * Turnover e desligamentos por área no período.
 *
 * Vem dos S-2299 declarados, que já trazem a lotação — não há o que ratear. A
 * versão anterior distribuía os desligamentos agregados por um peso combinando
 * headcount e absenteísmo da área, "reproduzindo o padrão observado no BI": o
 * gráfico resultante era uma hipótese desenhada com cara de apuração.
 */
export function selectTurnoverByArea(
  selection: WorkforcePeriodSelection,
  seriesOverride?: WorkforceMonthlyRecord[],
): AreaTurnoverPoint[] {
  const rows = selectRecentChartRows(selection, seriesOverride).filter(
    (r) => r.actuals && r.actuals.areas.length > 0,
  );
  if (rows.length === 0) return [];

  const acc = new Map<string, { label: string; headcount: number; dismissals: number }>();
  for (const r of rows) {
    for (const a of r.actuals!.areas) {
      const cur = acc.get(a.code) ?? { label: a.label, headcount: 0, dismissals: 0 };
      // Headcount é estoque, não fluxo: vale o do mês mais recente da janela.
      cur.headcount = a.headcount;
      cur.dismissals += a.terminations;
      acc.set(a.code, cur);
    }
  }

  const areas = [...acc.entries()].map(([code, v]) => ({
    id: code,
    area: v.label,
    headcount: v.headcount,
    dismissals: v.dismissals,
    turnoverPct: v.headcount > 0 ? Number(((v.dismissals / v.headcount) * 100).toFixed(2)) : 0,
    sharePct: 0,
  }));

  const total = areas.reduce((s, r) => s + r.dismissals, 0) || 1;
  return areas
    .map((r) => ({ ...r, sharePct: Number(((r.dismissals / total) * 100).toFixed(1)) }))
    .sort((a, b) => b.dismissals - a.dismissals)
    .slice(0, MAX_AREAS_IN_CHARTS);
}

// --- Overtime Trend ---

export interface OvertimePoint {
  period: string;
  overtimePct: number;
}

/**
 * Horas extras como % da massa, apurado sobre as rubricas do S-1200.
 *
 * Depende da tabela de rubricas (S-1010) estar classificando a folha: sem ela
 * não se sabe qual verba é hora extra. Antes, a lacuna era preenchida por
 * `8,5 + 3,2·sen(i) + 1,5·cos(i)` — o "11,2%" que a tela exibia para meses sem
 * folha nenhuma vinha daí.
 */
export function selectOvertimeTrend(
  selection: WorkforcePeriodSelection,
  seriesOverride?: WorkforceMonthlyRecord[],
): OvertimePoint[] {
  return selectRecentChartRows(selection, seriesOverride)
    .filter((r) => r.actuals?.overtimePct !== undefined)
    .map((r) => ({
      period: monthLabel(r.competenceMonth),
      overtimePct: r.actuals!.overtimePct!,
    }));
}

// --- Workforce Efficiency ---

export interface EfficiencyPoint {
  period: string;
  revenuePerEmployee: number;
  costPerEmployee: number;
  payrollAsRevenuePct: number;
  headcount: number;
  revenue: number;
}

export function selectWorkforceEfficiency(
  selection: WorkforcePeriodSelection,
  seriesOverride?: WorkforceMonthlyRecord[],
): EfficiencyPoint[] {
  const rows = selectRecentChartRows(selection, seriesOverride);
  return rows.map((r) => ({
    period: monthLabel(r.competenceMonth),
    revenuePerEmployee: r.headcount > 0 && r.revenue > 0 ? Math.round(r.revenue / r.headcount) : 0,
    costPerEmployee: r.headcount > 0 ? Math.round(r.payroll / r.headcount) : 0,
    payrollAsRevenuePct: r.revenue > 0 ? Number(((r.payroll / r.revenue) * 100).toFixed(1)) : 0,
    headcount: r.headcount,
    revenue: r.revenue,
  }));
}

// --- Monthly indicator matrix (tabela consolidada da competência) ---

/**
 * Linha da matriz. Indicadores que dependem de uma base ausente na competência
 * (headcount ou receita) vêm como `null` — "não apurado" é informação; um zero
 * ou um 100% derivado de divisão por base vazia seria ruído apresentado como fato.
 */
export interface MonthlyIndicatorRow {
  competenceMonth: string;
  period: string;
  headcount: number;
  admissions: number;
  dismissals: number;
  turnoverPct: number | null;
  absenteeismPct: number | null;
  overtimePct: number;
  payroll: number;
  /** Custo de pessoal como % da receita. */
  payrollAsRevenuePct: number | null;
  revenuePerEmployee: number | null;
}

export interface MonthlyIndicatorMatrix {
  rows: MonthlyIndicatorRow[];
  /** Linha de totais/médias do período (médias para percentuais, soma para volumes). */
  total: Omit<MonthlyIndicatorRow, 'competenceMonth' | 'period'>;
}

/**
 * Matriz consolidada mês a mês — headcount, turnover, absenteísmo, horas extras,
 * custo de pessoal e receita por colaborador na mesma linha da competência.
 * É a tabela que fecha a leitura dos gráficos do cockpit.
 */
export function selectMonthlyIndicatorMatrix(
  selection: WorkforcePeriodSelection,
  seriesOverride?: WorkforceMonthlyRecord[],
): MonthlyIndicatorMatrix {
  const rows0 = selectRecentChartRows(selection, seriesOverride);
  const adm = selectAdmissionsVsDismissals(selection, seriesOverride);
  const turnover = selectTurnoverTrend(selection, seriesOverride);
  const overtime = selectOvertimeTrend(selection, seriesOverride);
  const efficiency = selectWorkforceEfficiency(selection, seriesOverride);
  const absMonthly = selectAbsenteeismMonthlyByArea(selection, seriesOverride);

  // Casado por COMPETÊNCIA, nunca por índice. Os seletores acima agora
  // devolvem apenas os meses que têm fonte, então as listas têm comprimentos
  // diferentes entre si e diferentes de `rows0` — parear por posição atribuiria
  // o absenteísmo de um mês ao headcount de outro.
  const byPeriod = <T extends { period: string }>(list: T[]) =>
    new Map(list.map((item) => [item.period, item]));
  const admBy = byPeriod(adm);
  const turnoverBy = byPeriod(turnover);
  const overtimeBy = byPeriod(overtime);
  const efficiencyBy = byPeriod(efficiency);
  const absBy = byPeriod(absMonthly);

  const rows: MonthlyIndicatorRow[] = rows0.map((r) => {
    const period = monthLabel(r.competenceMonth);
    const hasHeadcount = r.headcount > 0;
    const hasRevenue = r.revenue > 0;
    const eff = efficiencyBy.get(period);
    // Absenteísmo % = dias de falta ÷ dias-homem disponíveis (21 dias úteis).
    const absenteeismPct = hasHeadcount
      ? Number((((absBy.get(period)?.totalDays ?? 0) / (r.headcount * 21)) * 100).toFixed(2))
      : null;
    return {
      competenceMonth: r.competenceMonth,
      period,
      headcount: r.headcount,
      admissions: admBy.get(period)?.admissions ?? 0,
      dismissals: admBy.get(period)?.dismissals ?? 0,
      turnoverPct: hasHeadcount ? turnoverBy.get(period)?.turnoverPct ?? null : null,
      absenteeismPct,
      overtimePct: overtimeBy.get(period)?.overtimePct ?? 0,
      payroll: r.payroll,
      payrollAsRevenuePct: hasRevenue ? eff?.payrollAsRevenuePct ?? null : null,
      revenuePerEmployee: hasRevenue && hasHeadcount ? eff?.revenuePerEmployee ?? null : null,
    };
  });

  /** Média apenas sobre as competências apuradas — meses sem base não entram. */
  const avg = (pick: (r: MonthlyIndicatorRow) => number | null): number | null => {
    const vals = rows.map(pick).filter((v): v is number => v !== null);
    if (vals.length === 0) return null;
    return Number((vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(2));
  };
  const sum = (pick: (r: MonthlyIndicatorRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const avgRevPerEmp = avg((r) => r.revenuePerEmployee);

  return {
    rows,
    total: {
      headcount: rows.length ? rows[rows.length - 1].headcount : 0,
      admissions: sum((r) => r.admissions),
      dismissals: sum((r) => r.dismissals),
      turnoverPct: avg((r) => r.turnoverPct),
      absenteeismPct: avg((r) => r.absenteeismPct),
      overtimePct: avg((r) => r.overtimePct) ?? 0,
      payroll: sum((r) => r.payroll),
      payrollAsRevenuePct: avg((r) => r.payrollAsRevenuePct),
      revenuePerEmployee: avgRevPerEmp === null ? null : Math.round(avgRevPerEmp),
    },
  };
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
 * Série efetiva a partir dos lotes de fechamento APROVADOS.
 *
 * Não há série de base: o que não foi importado não existe. Antes, os lotes
 * eram sobrepostos a 24 meses sintéticos, e bastava um mês sem lote para a tela
 * mostrar o número do seed como se fosse a folha da empresa.
 */
export function buildEffectiveSeries(approvedBatches: PayrollClosingBatchApproved[]): WorkforceMonthlyRecord[] {
  const records = new Map(
    approvedBatches.map((b) => [b.competence_month, mapPayrollClosingBatchToWorkforceMonth(b)]),
  );

  // `previous_month_amount_cents` é declarado pelo próprio lote: é o valor da
  // folha anterior conforme o arquivo do escritório, não uma estimativa. Quando
  // o mês anterior não foi importado, ele sustenta a variação mês a mês.
  for (const b of approvedBatches) {
    if (b.previous_month_amount_cents == null) continue;
    const prevMonth = shiftCompetenceMonth(b.competence_month, 1);
    if (records.has(prevMonth)) continue;
    const prevPayroll = b.previous_month_amount_cents / 100;
    records.set(prevMonth, {
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

  return [...records.values()].sort((a, b) => a.competenceMonth.localeCompare(b.competenceMonth));
}

/**
 * Sobrepõe as métricas apuradas do eSocial na série efetiva.
 *
 * O eSocial é a fonte mais forte que existe para quadro e movimentação: são os
 * eventos que a própria empresa declarou ao governo. Onde ele tem dado, ele
 * manda — headcount, admissões, desligamentos, afastamentos e a abertura por
 * lotação. A folha importada continua mandando no VALOR, que é a competência
 * dela, exceto quando não há lote para o mês.
 */
/** Linha de `esocial_competence_metrics`, no recorte que a série consome. */
export interface EsocialCompetenceMetric {
  competence: string;
  gross_payroll_cents: number;
  overtime_cents: number;
  benefits_cents?: number;
  benefits_by_nature?: Record<string, number> | null;
  inss_cents?: number | null;
  fgts_cents?: number | null;
  headcount: number;
  admissions: number;
  terminations: number;
  absence_days: number;
  absence_events: number;
  /** Colunas da migration 081 — ausentes em bases ainda não migradas. */
  rubric_total_cents?: number | null;
  rubric_mapped_cents?: number | null;
  cp_base_cents?: number | null;
  fgts_base_cents?: number | null;
}

/** Algum totalizador do eSocial chegou para a competência? */
function hasAnyTotalizer(m: EsocialCompetenceMetric): boolean {
  return (
    (m.inss_cents ?? 0) > 0 ||
    (m.fgts_cents ?? 0) > 0 ||
    (m.cp_base_cents ?? 0) > 0 ||
    (m.fgts_base_cents ?? 0) > 0
  );
}

/** Centavos por tipo de benefício → reais, no formato que o gráfico consome. */
function benefitsByType(byNature: Record<string, number> | null | undefined) {
  const cents = byNature ?? {};
  const brl = (k: string) => (cents[k] ?? 0) / 100;
  return {
    va: brl('va'),
    vr: brl('vr'),
    health: brl('health'),
    dental: brl('dental'),
    transport: brl('transport'),
    other: brl('other'),
  };
}

export interface EsocialAreaMetric {
  competence: string;
  area_code: string;
  area_label: string;
  headcount: number;
  admissions: number;
  terminations: number;
  absence_days: number;
  gross_cents: number;
  base_cents?: number | null;
}

/** Quadro informado manualmente, por competência. */
export interface ManualHeadcountByCompetence {
  [competence: string]: { headcount: number; sourceNote: string };
}

export function enrichSeriesWithEsocial(
  series: WorkforceMonthlyRecord[],
  metrics: EsocialCompetenceMetric[],
  areaMetrics: EsocialAreaMetric[] = [],
  manualHeadcount: ManualHeadcountByCompetence = {},
): WorkforceMonthlyRecord[] {
  if (metrics.length === 0) return series;

  // O 13º chega como 'AAAA-13' e não é um mês: entra no banco, mas fora da
  // série mensal, para não distorcer comparações de mês contra mês.
  const isMonthly = (c: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(c);
  const monthly = metrics.filter((m) => isMonthly(m.competence));
  const monthlyAreas = areaMetrics.filter((a) => isMonthly(a.competence));
  if (monthly.length === 0) return series;

  const byCompetence = new Map(monthly.map((m) => [m.competence, m]));
  const areasByCompetence = new Map<string, typeof areaMetrics>();
  for (const a of monthlyAreas) {
    const list = areasByCompetence.get(a.competence) ?? [];
    list.push(a);
    areasByCompetence.set(a.competence, list);
  }

  const merged = series.map((record) => {
    const m = byCompetence.get(record.competenceMonth);
    if (!m) return record;
    return applyEsocial(
      record,
      m,
      areasByCompetence.get(m.competence) ?? [],
      manualHeadcount[record.competenceMonth],
    );
  });

  // Competências que o eSocial conhece e a série ainda não tinha.
  for (const m of monthly) {
    if (merged.some((r) => r.competenceMonth === m.competence)) continue;
    // Mesma regra do merge: massa pela cobertura, não pela soma crua.
    const gross = competenceCoverage(m).payroll;

    // Uma competência só entra na série quando tem SUBSTÂNCIA. Há linhas de
    // métrica que existem apenas por efeito colateral: um afastamento em aberto
    // lança dias nos meses seguintes, e o mês corrente passava a existir sem
    // folha, sem quadro e sem guia. Como "mês atual" é a competência mais
    // recente da série, a tela abria justamente nesse mês oco, com tudo zerado.
    if (m.headcount === 0 && gross === 0 && !hasAnyTotalizer(m)) continue;
    merged.push(
      applyEsocial(
        {
          competenceMonth: m.competence,
          headcount: m.headcount,
          payroll: gross,
          revenue: 0,
          pj: 0,
          clt: m.headcount,
          pjCost: 0,
          cltCost: gross,
          costCenters: [],
        },
        m,
        areasByCompetence.get(m.competence) ?? [],
        manualHeadcount[m.competence],
      ),
    );
  }

  return merged.sort((a, b) => a.competenceMonth.localeCompare(b.competenceMonth));
}

function applyEsocial(
  record: WorkforceMonthlyRecord,
  m: EsocialCompetenceMetric,
  areas: EsocialAreaMetric[],
  manual?: { headcount: number; sourceNote: string },
): WorkforceMonthlyRecord {
  const coverage = competenceCoverage({ ...m, competence: record.competenceMonth });
  // A massa vem da cobertura, não da soma crua das rubricas: num mês em que só
  // os totalizadores sobreviveram à janela de retenção, a soma das rubricas é
  // um resíduo, e a base apurada pelo eSocial é o número real.
  const gross = coverage.payroll;
  const hasPayroll = record.payroll > 0;

  return {
    ...record,
    // O quadro informado manualmente vence o apurado: ele existe justamente
    // para os meses em que o eSocial não entregou o detalhe por trabalhador, e
    // é uma afirmação assinada por um administrador. Fica marcado como manual
    // para que a tela nunca o apresente como apuração.
    headcount: manual ? manual.headcount : m.headcount > 0 ? m.headcount : record.headcount,
    payroll: hasPayroll ? record.payroll : gross,
    cltCost: hasPayroll ? record.cltCost : gross,
    // Sem lote de folha, a abertura por lotação do eSocial vira o centro de custo.
    costCenters:
      record.costCenters.length > 0
        ? record.costCenters
        : areas.map((a) => ({
            id: `esocial-${a.area_code}`,
            name: a.area_label,
            payrollValue: a.gross_cents / 100,
            headcount: a.headcount,
          })),
    actuals: {
      admissions: m.admissions,
      terminations: m.terminations,
      absenceDays: m.absence_days,
      absenceEvents: m.absence_events,
      coverage,
      headcountSource: manual ? 'manual' : 'esocial',
      headcountNote: manual?.sourceNote,
      // Só quando as rubricas foram de fato classificadas. Fora disso o
      // indicador fica ausente, e não zerado.
      overtimePct:
        coverage.compositionReliable && m.gross_payroll_cents > 0
          ? Number(((m.overtime_cents / m.gross_payroll_cents) * 100).toFixed(1))
          : undefined,
      composition: coverage.compositionReliable
        ? {
            salary: (m.gross_payroll_cents - (m.benefits_cents ?? 0)) / 100,
            benefits: (m.benefits_cents ?? 0) / 100,
            // Encargos = o que a empresa recolhe, direto das guias apuradas.
            charges: ((m.inss_cents ?? 0) + (m.fgts_cents ?? 0)) / 100,
          }
        : undefined,
      benefitsByType: coverage.compositionReliable ? benefitsByType(m.benefits_by_nature) : undefined,
      areas: areas.map((a) => ({
        code: a.area_code,
        label: a.area_label,
        headcount: a.headcount,
        admissions: a.admissions,
        terminations: a.terminations,
        absenceDays: a.absence_days,
        // Mesma regra da competência: a base apurada por lotação sustenta o
        // recorte por área mesmo sem a tabela de rubricas.
        payroll: (coverage.payrollSource === 'rubricas' ? a.gross_cents : (a.base_cents ?? a.gross_cents)) / 100,
      })),
    },
  };
}

/**
 * Overlay real revenue (from AR module) onto a workforce series.
 * Only months present in `revenueByMonth` are touched; others keep their
 * existing value (mock revenue for the demo, 0 for imported months).
 */
export function enrichSeriesWithRevenue(
  series: WorkforceMonthlyRecord[],
  revenueByMonth: Record<string, number>,
): WorkforceMonthlyRecord[] {
  if (Object.keys(revenueByMonth).length === 0) return series;
  return series.map((r) => {
    const rev = revenueByMonth[r.competenceMonth];
    return rev !== undefined ? { ...r, revenue: rev } : r;
  });
}

/**
 * Visão consolidada a partir dos lotes de folha aprovados.
 *
 * `hasData` é falso quando nenhuma fonte real produziu competência — e nesse
 * caso a tela mostra o estado vazio, não uma série de demonstração.
 */
export function selectWorkforceViewWithClosings(
  selection: WorkforcePeriodSelection,
  approvedBatches: PayrollClosingBatchApproved[],
  seriesOverride?: WorkforceMonthlyRecord[],
): WorkforceViewModel & { hasData: boolean } {
  const series = seriesOverride ?? buildEffectiveSeries(approvedBatches);
  const { metrics, meta } = selectWorkforceOverview(selection, series);
  return {
    metrics,
    costConcentration: selectCostCenterConcentration(selection, series),
    payrollRisk: selectPayrollRisk(selection, series),
    alerts: selectWorkforceAlerts(selection, series),
    trend: selectWorkforceTrend(selection, series),
    meta,
    hasData: series.length > 0,
  };
}
