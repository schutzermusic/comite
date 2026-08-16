/**
 * Modelo único da Visão Geral de Pessoas & Custos.
 *
 * Uma função pura e síncrona compõe TUDO que a tela mostra e TUDO que os três
 * documentos imprimem, a partir dos seletores de `period.ts` — que não mudam.
 * A tela chama daqui num `useMemo`; a rota do PowerPoint, o harness de preview
 * e o de QA chamam a mesma função. Por construção, não existe caminho em que a
 * tela e um documento formatem o mesmo indicador de formas diferentes.
 *
 * É a disciplina do `visibleProjection` da Projeção Financeira aplicada a um
 * payload maior: um objeto derivado, já filtrado, e todo consumidor bebe dele.
 *
 * ─── Onde a regra "somente dado apurado" é aplicada ────────────────────────
 *
 * Aqui, e só aqui. Os seletores devolvem `number | undefined` e listas que
 * podem vir vazias; este módulo traduz isso para `Measured<T>` UMA vez,
 * consultando `degradations` para saber se a ausência é falta de fonte ou
 * consequência do recorte. Depois deste ponto, nenhum renderizador precisa
 * saber de onde o dado veio — só se ele existe.
 */

import {
  selectAbsenteeismByArea,
  selectAbsenteeismMonthlyByArea,
  selectAdmissionsVsDismissals,
  selectBenefitsByType,
  selectMonthlyIndicatorMatrix,
  selectOvertimeTrend,
  selectPayrollComposition,
  selectPayrollSCurve,
  selectPayrollVsRevenue,
  selectTurnoverByArea,
  selectTurnoverTrend,
  selectWorkforceEfficiency,
  selectWorkforceOverview,
  selectWorkforceViewWithClosings,
  resolvePeriodRange,
  type WorkforceMonthlyRecord,
  type WorkforcePeriodSelection,
} from '@/lib/workforce/period';
import { buildComplianceSnapshot, competenceLabel, type EsocialLinkState } from '@/lib/workforce/compliance';
import { formatWorkforceCurrency } from '@/lib/workforce-data';
import type { CompetenceCoverage } from '@/lib/workforce/esocial-coverage';
import type { PayrollClosingBatch, PayrollClosingBatchApproved } from '@/lib/types/payroll-closing';
import type { WorkforceComplianceKpis } from '@/hooks/use-workforce-compliance-kpis';

import {
  FALLBACK_REPORT_BRANDING,
  type ReportBranding,
} from '@/lib/reports/report-branding';

import { applyWorkforceFilters, HEADCOUNT_SOURCE_LABEL } from './filters';
import { buildWorkforceUnits, describeUnitSelection } from './units';
import { resolveComparisonSelection } from './comparison';
import {
  EMPTY_WORKFORCE_FILTERS,
  fromNullable,
  measured,
  unmeasured,
  type ComparisonMode,
  type Degradation,
  type Measured,
  type WorkforceKpi,
  type WorkforceOverviewFilters,
  type WorkforceOverviewModel,
  type WorkforceSignal,
} from './types';

export interface BuildWorkforceOverviewInput {
  period: WorkforcePeriodSelection;
  comparison: ComparisonMode;
  filters?: WorkforceOverviewFilters;
  /** Série já enriquecida (folha aprovada → receita → apurado do eSocial). */
  rawSeries: WorkforceMonthlyRecord[];
  approvedBatches: PayrollClosingBatchApproved[];
  allBatches?: PayrollClosingBatch[];
  esocialLink: EsocialLinkState;
  figuresByCompetence?: Record<string, Parameters<typeof buildComplianceSnapshot>[0]['figures']>;
  coverageByCompetence?: Record<string, CompetenceCoverage>;
  metricsByCompetence?: Record<string, { admissions?: number; terminations?: number; absence_events?: number }>;
  complianceKpis?: WorkforceComplianceKpis;
  drilldownCostCenterId?: string | null;
  /** Marca da empresa; omitida = marca do produto. */
  branding?: ReportBranding;
  brandName?: string;
  generatedAt?: string;
}

export function buildWorkforceOverviewModel(
  input: BuildWorkforceOverviewInput,
): WorkforceOverviewModel {
  const filters = input.filters ?? EMPTY_WORKFORCE_FILTERS;
  const branding = input.branding ?? FALLBACK_REPORT_BRANDING;
  const { period, comparison, rawSeries, approvedBatches } = input;

  // ── 1. Recorte ───────────────────────────────────────────────────────────
  const { series, degradations } = applyWorkforceFilters(rawSeries, filters);
  const degraded = (field: Degradation['field']) => degradations.some((d) => d.field === field);

  const allUnits = buildWorkforceUnits(rawSeries);
  const unitsInScope =
    filters.unitIds.length > 0 ? allUnits.filter((u) => filters.unitIds.includes(u.id)) : allUnits;

  // ── 2. Seletores, intactos, todos sobre a série recortada ────────────────
  const view = selectWorkforceViewWithClosings(period, approvedBatches, series);
  const { metrics, meta: periodMeta, costConcentration, payrollRisk, alerts } = view;

  const composition = selectPayrollComposition(period, series);
  const scurve = selectPayrollSCurve(period, series);
  const vsRevenue = selectPayrollVsRevenue(period, series);
  const benefits = selectBenefitsByType(period, series);
  const movement = selectAdmissionsVsDismissals(period, series);
  const turnover = selectTurnoverTrend(period, series);
  const absenteeismByArea = selectAbsenteeismByArea(period, series);
  const absenteeismMonthly = selectAbsenteeismMonthlyByArea(period, series);
  const turnoverByArea = selectTurnoverByArea(period, series);
  const overtime = selectOvertimeTrend(period, series);
  const efficiency = selectWorkforceEfficiency(period, series);
  const matrix = selectMonthlyIndicatorMatrix(period, series);

  const hasData = series.length > 0;

  // ── 3. Comparação ────────────────────────────────────────────────────────
  const baseline = resolveComparisonSelection(period, series, comparison);
  const baselineMetrics = baseline.selection.measured
    ? selectWorkforceOverview(baseline.selection.value, series).metrics
    : null;

  /**
   * Delta contra a base escolhida.
   *
   * Sem base, `unmeasured('no-baseline')` — e os KPIs mostram o rótulo de
   * acumulado no lugar da variação, que é exatamente para isso que
   * `meta.accumulatedLabels` existe.
   */
  const deltaOf = (
    current: Measured<number>,
    previous: number | undefined,
    upIsGood: boolean,
  ): Measured<WorkforceKpi['delta'] extends Measured<infer D> ? D : never> => {
    if (!baseline.label.measured) return unmeasured('no-baseline');
    if (!current.measured || previous === undefined || previous === 0) {
      return unmeasured('no-baseline');
    }
    const abs = current.value - previous;
    return measured({
      pct: Number(((abs / Math.abs(previous)) * 100).toFixed(1)),
      abs,
      label: baseline.label.value,
      upIsGood,
    });
  };

  // ── 4. Indicadores, embrulhados uma única vez ────────────────────────────
  const latestEfficiency = efficiency[efficiency.length - 1];
  const latestTurnover = turnover[turnover.length - 1];
  const latestOvertime = overtime[overtime.length - 1];
  const latestComposition = composition[composition.length - 1];

  const headcount: Measured<number> = degraded('headcount')
    ? unmeasured('not-attributable')
    : hasData && metrics.headcount.total > 0
      ? measured(metrics.headcount.total)
      : unmeasured('no-source');

  const payroll: Measured<number> =
    hasData && metrics.monthlyPayroll.value > 0
      ? measured(metrics.monthlyPayroll.value)
      : unmeasured('no-source');

  const avgCost: Measured<number> =
    headcount.measured && metrics.avgCostPerEmployee.value > 0
      ? measured(metrics.avgCostPerEmployee.value)
      : unmeasured(degraded('headcount') ? 'not-attributable' : 'no-source');

  // A razão só existe com as duas pontas. Sem receita, "0,0%" seria lido como
  // folha irrisória diante do faturamento — o oposto do que se sabe.
  const payrollAsRevenue: Measured<number> = degraded('revenue')
    ? unmeasured('not-attributable')
    : metrics.payrollAsRevenuePercent.value > 0
      ? measured(metrics.payrollAsRevenuePercent.value)
      : unmeasured('not-comparable');

  const revenuePerEmployee: Measured<number> = degraded('revenue')
    ? unmeasured('not-attributable')
    : fromNullable(
        latestEfficiency?.revenuePerEmployee && latestEfficiency.revenuePerEmployee > 0
          ? latestEfficiency.revenuePerEmployee
          : undefined,
        'not-comparable',
      );

  const turnoverPct = fromNullable(latestTurnover?.turnoverPct, 'no-source');
  const overtimePct = degraded('overtime')
    ? unmeasured<number>('not-attributable')
    : fromNullable(latestOvertime?.overtimePct, 'no-source');
  const maxAbsenteeism = fromNullable(absenteeismByArea[0]?.pct, 'no-source');

  const benefitsTotal = degraded('benefits')
    ? unmeasured<number>('not-attributable')
    : fromNullable(latestComposition?.benefits, 'no-source');
  const chargesTotal = degraded('composition')
    ? unmeasured<number>('not-attributable')
    : fromNullable(latestComposition?.charges, 'no-source');
  const directPct: Measured<number> = latestComposition
    ? measured(
        Number(
          (
            (latestComposition.salary /
              (latestComposition.salary + latestComposition.benefits + latestComposition.charges)) *
            100
          ).toFixed(1),
        ),
      )
    : unmeasured(degraded('composition') ? 'not-attributable' : 'no-source');

  const riskComparable = payrollRisk.comparable;
  const riskScore: Measured<number> = riskComparable
    ? measured(payrollRisk.riskScore)
    : unmeasured('not-comparable');

  const top3: Measured<number> =
    costConcentration.totalPayroll > 0
      ? measured(Number(costConcentration.top3Concentration.toFixed(1)))
      : unmeasured('no-source');

  // ── 5. Competência corrente e conformidade ───────────────────────────────
  const currentCompetence =
    series[series.length - 1]?.competenceMonth ??
    matrix.rows[matrix.rows.length - 1]?.competenceMonth ??
    new Date().toISOString().slice(0, 7);

  const batchByCompetence = new Map<string, PayrollClosingBatch>();
  for (const b of [...approvedBatches, ...(input.allBatches ?? [])]) {
    if (b.status === 'cancelled') continue;
    batchByCompetence.set(b.competence_month, b);
  }

  const snapshot = buildComplianceSnapshot({
    competence: currentCompetence,
    batch: batchByCompetence.get(currentCompetence),
    esocial: input.esocialLink,
    figures: input.figuresByCompetence?.[currentCompetence],
  });

  const byCompetence: WorkforceOverviewModel['compliance']['byCompetence'] = {};
  for (const row of matrix.rows) {
    const snap = buildComplianceSnapshot({
      competence: row.competenceMonth,
      batch: batchByCompetence.get(row.competenceMonth),
      esocial: input.esocialLink,
      figures: input.figuresByCompetence?.[row.competenceMonth],
    });
    byCompetence[row.competenceMonth] = { payrollStatus: snap.payrollStatus, score: snap.score };
  }

  const currentMetric = input.metricsByCompetence?.[currentCompetence];
  const kpisCompliance = input.complianceKpis;

  // Cada fonte de conformidade tem permissão própria e pode faltar sozinha; um
  // zero aqui afirmaria que não há CAT e ninguém está sem reajuste.
  const permissionAware = (value: number | undefined): Measured<number> =>
    fromNullable(value, 'no-permission');

  // ── 6. KPIs ──────────────────────────────────────────────────────────────
  const kpis: WorkforceKpi[] = [
    {
      id: 'headcount',
      group: 'volume',
      label: 'Total de colaboradores',
      value: headcount,
      format: 'int',
      helper: periodMeta.accumulatedLabels.headcount,
      delta: deltaOf(headcount, baselineMetrics?.headcount.total, true),
      sparkline: metrics.headcount.sparkline,
      target: { kind: 'anchor', to: 'wf-dinamica' },
    },
    {
      id: 'payroll',
      group: 'custo',
      label: `Folha mensal${periodMeta.aggregation === 'average' ? ' (média)' : ''}`,
      value: payroll,
      format: 'currency',
      helper: periodMeta.accumulatedLabels.payroll,
      delta: deltaOf(payroll, baselineMetrics?.monthlyPayroll.value, false),
      sparkline: metrics.monthlyPayroll.sparkline,
      target: { kind: 'anchor', to: 'wf-custo' },
    },
    {
      id: 'avg-cost',
      group: 'custo',
      label: 'Custo médio por colaborador',
      value: avgCost,
      format: 'currency',
      helper: periodMeta.accumulatedLabels.avgCost,
      delta: deltaOf(avgCost, baselineMetrics?.avgCostPerEmployee.value, false),
      target: { kind: 'anchor', to: 'wf-eficiencia' },
    },
    {
      id: 'payroll-rev',
      group: 'eficiencia',
      label: 'Folha sobre receita',
      value: payrollAsRevenue,
      format: 'pct',
      helper: `limite ${metrics.payrollAsRevenuePercent.threshold}%`,
      delta: deltaOf(payrollAsRevenue, baselineMetrics?.payrollAsRevenuePercent.value, false),
      tone: payrollAsRevenue.measured
        ? payrollAsRevenue.value >= metrics.payrollAsRevenuePercent.threshold + 5
          ? 'danger'
          : payrollAsRevenue.value >= metrics.payrollAsRevenuePercent.threshold
            ? 'warning'
            : 'success'
        : 'neutral',
      target: { kind: 'anchor', to: 'wf-risco' },
    },
    {
      id: 'rev-per-emp',
      group: 'eficiencia',
      label: 'Receita por colaborador',
      value: revenuePerEmployee,
      format: 'currency',
      helper: 'Eficiência produtiva',
      delta: unmeasured('no-baseline'),
      target: { kind: 'anchor', to: 'wf-eficiencia' },
    },
    {
      id: 'turnover',
      group: 'volume',
      label: 'Turnover',
      value: turnoverPct,
      format: 'pct',
      helper: 'Rotatividade mensal',
      delta: unmeasured('no-baseline'),
      tone: turnoverPct.measured
        ? turnoverPct.value > 3
          ? 'danger'
          : turnoverPct.value > 2
            ? 'warning'
            : 'success'
        : 'neutral',
      target: { kind: 'anchor', to: 'wf-dinamica' },
    },
    {
      id: 'overtime',
      group: 'volume',
      label: 'Horas extras',
      value: overtimePct,
      format: 'pct',
      helper: '% da massa salarial',
      delta: unmeasured('no-baseline'),
      tone: overtimePct.measured && overtimePct.value > 12 ? 'warning' : 'neutral',
      target: { kind: 'anchor', to: 'wf-dinamica' },
    },
    {
      id: 'absenteeism',
      group: 'volume',
      label: 'Absenteísmo (pico por área)',
      value: maxAbsenteeism,
      format: 'pct',
      helper: 'Maior taxa entre as lotações',
      delta: unmeasured('no-baseline'),
      tone: maxAbsenteeism.measured
        ? maxAbsenteeism.value > 5
          ? 'danger'
          : maxAbsenteeism.value > 4
            ? 'warning'
            : 'success'
        : 'neutral',
      target: { kind: 'anchor', to: 'wf-dinamica' },
    },
    {
      id: 'concentration',
      group: 'custo',
      label: 'Concentração Top-3',
      value: top3,
      format: 'pct',
      helper: 'Participação dos 3 maiores centros',
      delta: unmeasured('no-baseline'),
      tone: top3.measured ? (top3.value > 80 ? 'danger' : top3.value > 70 ? 'warning' : 'neutral') : 'neutral',
      target: { kind: 'anchor', to: 'wf-risco' },
    },
    {
      id: 'movement',
      group: 'conformidade',
      label: 'Admissões · Desligamentos',
      value: fromNullable(currentMetric?.admissions, 'no-source'),
      format: 'text',
      display:
        currentMetric?.admissions === undefined && currentMetric?.terminations === undefined
          ? unmeasured<string>('no-source')
          : measured(`${currentMetric?.admissions ?? 0} · ${currentMetric?.terminations ?? 0}`),
      helper: 'Na competência apurada',
      delta: unmeasured('no-baseline'),
      target: { kind: 'anchor', to: 'wf-dinamica' },
    },
    {
      id: 'cats',
      group: 'conformidade',
      label: 'CATs no mês',
      value: permissionAware(kpisCompliance?.catsInMonth),
      format: 'int',
      helper: 'Acidentes comunicados',
      delta: unmeasured('no-baseline'),
      tone:
        kpisCompliance?.catsInMonth !== undefined && kpisCompliance.catsInMonth > 0
          ? 'danger'
          : 'neutral',
      target: { kind: 'route', to: '/workforce-cost/sst' },
    },
    {
      id: 'aso',
      group: 'conformidade',
      label: 'ASOs vencidos · a vencer',
      value: permissionAware(kpisCompliance?.asoExpired),
      format: 'text',
      display:
        kpisCompliance?.asoExpired === undefined && kpisCompliance?.asoExpiring === undefined
          ? unmeasured<string>('no-permission')
          : measured(`${kpisCompliance?.asoExpired ?? 0} · ${kpisCompliance?.asoExpiring ?? 0}`),
      helper:
        kpisCompliance?.workersWithoutAso !== undefined && kpisCompliance.workersWithoutAso > 0
          ? `${kpisCompliance.workersWithoutAso} sem ASO no acervo`
          : 'Vencimento apurável no periódico',
      delta: unmeasured('no-baseline'),
      tone:
        kpisCompliance?.asoExpired !== undefined && kpisCompliance.asoExpired > 0 ? 'warning' : 'neutral',
      target: { kind: 'route', to: '/workforce-cost/sst' },
    },
    {
      id: 'raise',
      group: 'conformidade',
      label: 'Sem reajuste há +12 meses',
      value: permissionAware(kpisCompliance?.withoutRaise12m),
      format: 'int',
      helper: 'Comprovado pela série de folha',
      delta: unmeasured('no-baseline'),
      tone:
        kpisCompliance?.withoutRaise12m !== undefined && kpisCompliance.withoutRaise12m > 0
          ? 'warning'
          : 'neutral',
      target: { kind: 'route', to: '/workforce-cost/custos' },
    },
    {
      id: 'compliance',
      group: 'conformidade',
      label: 'Conformidade da competência',
      value: measured(snapshot.score),
      format: 'int',
      helper: snapshot.competenceLabel,
      delta: unmeasured('no-baseline'),
      tone: snapshot.score >= 85 ? 'success' : snapshot.score >= 60 ? 'warning' : 'danger',
      target: { kind: 'anchor', to: 'wf-conformidade' },
    },
  ];

  // ── 7. Radar de sinais ───────────────────────────────────────────────────
  //
  // Só entra o indicador APURADO. O radar anterior empurrava um chip verde
  // "Crescimento · alinhado com receita" mesmo sem receita nenhuma: folha e
  // receita ambas em zero passavam nos limiares e acendiam a luz verde.
  const signals: WorkforceSignal[] = [];

  if (riskComparable) {
    const gap = payrollRisk.payrollGrowth - payrollRisk.revenueGrowth;
    signals.push({
      id: 'growth',
      level: gap > 5 ? 'error' : gap > 2 ? 'warn' : 'ok',
      label: 'Crescimento',
      detail:
        gap > 2
          ? `Folha ${fmtSigned(payrollRisk.payrollGrowth)} vs receita ${fmtSigned(payrollRisk.revenueGrowth)}`
          : 'Alinhado com a receita',
    });
  }
  if (overtimePct.measured) {
    signals.push({
      id: 'overtime',
      level: overtimePct.value > 12 ? 'warn' : 'ok',
      label: 'Horas extras',
      detail: `${overtimePct.value.toFixed(1).replace('.', ',')}%`,
    });
  }
  if (maxAbsenteeism.measured) {
    signals.push({
      id: 'absenteeism',
      level: maxAbsenteeism.value > 5 ? 'error' : maxAbsenteeism.value > 4 ? 'warn' : 'ok',
      label: 'Absenteísmo',
      detail: `Pico ${maxAbsenteeism.value.toFixed(1).replace('.', ',')}%`,
    });
  }
  if (turnoverPct.measured) {
    signals.push({
      id: 'turnover',
      level: turnoverPct.value > 3 ? 'error' : turnoverPct.value > 2 ? 'warn' : 'ok',
      label: 'Turnover',
      detail: `${turnoverPct.value.toFixed(2).replace('.', ',')}%/mês`,
    });
  }
  if (top3.measured) {
    signals.push({
      id: 'concentration',
      level: top3.value > 80 ? 'error' : top3.value > 70 ? 'warn' : 'ok',
      label: 'Concentração',
      detail: `Top-3: ${top3.value.toFixed(0)}%`,
    });
  }
  if (payrollAsRevenue.measured) {
    const t = metrics.payrollAsRevenuePercent.threshold;
    signals.push({
      id: 'payroll-revenue',
      level: payrollAsRevenue.value >= t + 5 ? 'error' : payrollAsRevenue.value >= t ? 'warn' : 'ok',
      label: 'Folha/Receita',
      detail: `${payrollAsRevenue.value.toFixed(1).replace('.', ',')}% (limite ${t}%)`,
    });
  }

  // ── 8. Legendas e procedência ────────────────────────────────────────────
  const filtersLabel = [
    describeUnitSelection(allUnits, filters.unitIds),
    filters.headcountSource !== 'all' ? HEADCOUNT_SOURCE_LABEL[filters.headcountSource] : null,
    `${periodMeta.monthsInRange} ${periodMeta.monthsInRange === 1 ? 'mês' : 'meses'} no escopo`,
  ]
    .filter(Boolean)
    .join(' · ');

  const headcountSource = fromNullable(
    series[series.length - 1]?.actuals?.headcountSource,
    'no-source',
  );

  return {
    meta: {
      periodLabel: periodMeta.periodLabel,
      periodKey: periodMeta.periodKey,
      monthsInRange: periodMeta.monthsInRange,
      aggregation: periodMeta.aggregation,
      comparison: {
        mode: comparison,
        label: baseline.label,
        windowLabel: baseline.windowLabel,
      },
      filtersLabel,
      generatedAt: input.generatedAt ?? periodMeta.generatedAt,
      source: periodMeta.source,
      coverage: fromNullable(input.coverageByCompetence?.[currentCompetence], 'no-source'),
      brandName: input.brandName ?? branding.companyName,
      branding,
    },
    scope: { filters, degradations, unitsInScope, allUnits, hasData },
    executive: {
      headline: buildHeadline({ hasData, payroll, headcount, payrollAsRevenue, riskScore, periodLabel: periodMeta.periodLabel }),
      kpis,
      signals,
      risk: {
        score: riskScore,
        status: riskComparable ? measured(payrollRisk.status) : unmeasured('not-comparable'),
        payrollGrowth: riskComparable ? measured(payrollRisk.payrollGrowth) : unmeasured('not-comparable'),
        revenueGrowth: riskComparable ? measured(payrollRisk.revenueGrowth) : unmeasured('not-comparable'),
        message: payrollRisk.message,
        raw: payrollRisk,
      },
      alerts,
    },
    efficiency: {
      series: efficiency,
      revenuePerEmployee,
      costPerEmployee: avgCost,
      payrollAsRevenuePct: payrollAsRevenue,
      threshold: metrics.payrollAsRevenuePercent.threshold,
    },
    dynamics: {
      movement,
      turnover,
      turnoverByArea,
      absenteeismByArea,
      absenteeismMonthly,
      overtime,
      headcountSource,
      latestTurnoverPct: turnoverPct,
      latestOvertimePct: overtimePct,
      maxAbsenteeismPct: maxAbsenteeism,
    },
    costStructure: {
      composition,
      benefits,
      scurve,
      vsRevenue,
      trend: view.trend,
      matrix,
      totalPayrollAccum: periodMeta.totalPayrollAccum,
      benefitsTotal,
      chargesTotal,
      directPct,
    },
    concentration: {
      data: costConcentration,
      top3,
      abnormal: costConcentration.costCenters.filter((c) => c.isAbnormal),
      hasBaseline: resolvePeriodRange(period, series).previous.length > 0,
      drilldown:
        costConcentration.costCenters.find((c) => c.id === input.drilldownCostCenterId) ?? null,
    },
    compliance: {
      snapshot,
      byCompetence,
      kpis: {
        admissions: fromNullable(currentMetric?.admissions, 'no-source'),
        terminations: fromNullable(currentMetric?.terminations, 'no-source'),
        activeAbsences: degraded('absenceEvents')
          ? unmeasured('not-attributable')
          : fromNullable(currentMetric?.absence_events, 'no-source'),
        catsInMonth: permissionAware(kpisCompliance?.catsInMonth),
        asoExpired: permissionAware(kpisCompliance?.asoExpired),
        asoExpiring: permissionAware(kpisCompliance?.asoExpiring),
        workersWithoutAso: permissionAware(kpisCompliance?.workersWithoutAso),
        withoutRaise12m: permissionAware(kpisCompliance?.withoutRaise12m),
      },
      esocialLink: input.esocialLink,
      currentCompetence,
      currentCompetenceLabel: competenceLabel(currentCompetence),
    },
    simulator: {
      avgCostPerEmployee: avgCost,
      currentPayroll: payroll,
      // A página alimentava isto com `?? 0`, e uma receita ausente virava uma
      // simulação de impacto catastrófico por motivo inventado.
      currentRevenue: degraded('revenue')
        ? unmeasured('not-attributable')
        : fromNullable(
            latestEfficiency?.revenue && latestEfficiency.revenue > 0 ? latestEfficiency.revenue : undefined,
            'no-source',
          ),
      currentHeadcount: headcount,
      payrollRevenueThreshold: metrics.payrollAsRevenuePercent.threshold,
    },
  };
}

function fmtSigned(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(1).replace('.', ',')}%`;
}

/**
 * A frase de abertura — a mesma na tela, no PDF, no deck e no PowerPoint.
 *
 * Lê só o que foi apurado. Sem competência, diz isso em vez de descrever um
 * cockpit vazio como se fosse um cockpit saudável.
 */
function buildHeadline(args: {
  hasData: boolean;
  payroll: Measured<number>;
  headcount: Measured<number>;
  payrollAsRevenue: Measured<number>;
  riskScore: Measured<number>;
  periodLabel: string;
}): string {
  if (!args.hasData) return 'Nenhuma competência apurada no período selecionado.';

  const parts: string[] = [];
  if (args.payroll.measured) {
    parts.push(`folha de ${formatWorkforceCurrency(args.payroll.value)}`);
  }
  if (args.headcount.measured) {
    parts.push(`${args.headcount.value} colaboradores`);
  }
  if (args.payrollAsRevenue.measured) {
    // Separador decimal pt-BR: a frase abre a capa dos três documentos.
    parts.push(`${args.payrollAsRevenue.value.toFixed(1).replace('.', ',')}% da receita`);
  }

  if (parts.length === 0) return `${args.periodLabel} — sem indicadores apurados no recorte.`;
  return `${args.periodLabel}: ${parts.join(', ')}.`;
}
