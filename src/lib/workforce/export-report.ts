/**
 * Workforce (Pessoas & Custos) overview → print-ready HTML report.
 *
 * Built on the shared enterprise report engine (src/lib/reports) with the
 * premium executive layout: composePages, 2.5D charts (payroll-risk gauge,
 * trend area chart, PJ/CLT composition) and factual insight cards. The report
 * ALWAYS reflects the selected period — the cover carries the period label,
 * generated date and data source. All numbers come from the SAME
 * selectWorkforceView view model as the screen.
 */

import { formatWorkforceCurrency } from '@/lib/workforce-data';
import type { WorkforceViewModel } from './period';
import { esc, fmtInt, fmtSignedPct, compactBRL } from '@/lib/reports/report-formatters';
import { C, REPORT_BRAND_NAME } from '@/lib/reports/report-theme';
import { svgHorizontalBar, svgGauge, svgStackedBar, svgAreaChart, legend } from '@/lib/reports/report-charts';
import { reportCover, sectionTitle, kpiGrid, chartBlock, dataTable, warningBox, type KpiCardSpec } from '@/lib/reports/report-blocks';
import {
  composePages, block, mmForChart, mmForColumns, mmForCover, mmForKpiGrid,
  mmForSectionTitle, mmForTable, mmForWarningBox, type ReportBlock,
} from '@/lib/reports/report-compose';
import { insightPanel, mmForInsightPanel, type InsightItem } from '@/lib/reports/report-insights';
import { renderReportDocument } from '@/lib/reports/report-shell';
import { openReport, buildReportMeta, buildReportFileName } from '@/lib/reports/report-export';
import type { ReportExportResult } from '@/lib/reports/report-types';

export interface WorkforceReportPayload extends WorkforceViewModel {
  brandName?: string;
}

export function buildWorkforceReportHtml(payload: WorkforceReportPayload): string {
  const { metrics, costConcentration, payrollRisk, alerts, trend, meta } = payload;
  const brand = payload.brandName ?? REPORT_BRAND_NAME;
  const fileName = buildReportFileName({ module: 'pessoas-custos', context: meta.periodLabel });

  const reportMeta = buildReportMeta({
    brand,
    generatedAt: meta.generatedAt,
    periodLabel: meta.periodLabel,
    filtersLabel: `${meta.monthsInRange} ${meta.monthsInRange === 1 ? 'mês' : 'meses'} no escopo`,
    source: meta.source,
  });
  const blocks: ReportBlock[] = [];

  /* ── 01 · Visão Executiva ── */

  blocks.push(block(reportCover({
    meta: reportMeta,
    kicker: 'Relatório Executivo · Pessoas & Custos',
    title: 'Sala de Controle de Custos de Pessoal',
    context: meta.aggregation === 'average'
      ? `Folha acumulada no período: <b>${esc(formatWorkforceCurrency(meta.totalPayrollAccum))}</b>`
      : undefined,
    coverKpis: [
      { label: 'Headcount', value: fmtInt(metrics.headcount.total) },
      { label: 'Folha mensal', value: formatWorkforceCurrency(metrics.monthlyPayroll.value) },
      { label: 'Folha / receita', value: `${metrics.payrollAsRevenuePercent.value.toFixed(1)}%` },
      { label: 'Risco de folha', value: `${payrollRisk.riskScore}/100` },
    ],
  }), mmForCover(true)));

  const refLabel = meta.hasComparison ? meta.comparisonLabel : 'Referência';
  const kpiCards: KpiCardSpec[] = [
    { label: 'Total Funcionários', value: fmtInt(metrics.headcount.total), color: C.primary, helper: meta.hasComparison ? `${fmtSignedPct(metrics.headcount.trend)} vs ${refLabel}` : meta.accumulatedLabels.headcount },
    { label: `Folha Mensal${meta.aggregation === 'average' ? ' (média)' : ''}`, value: formatWorkforceCurrency(metrics.monthlyPayroll.value), color: C.cost, helper: meta.hasComparison ? `${fmtSignedPct(metrics.monthlyPayroll.trend)} vs ${refLabel}` : meta.accumulatedLabels.payroll },
    { label: 'Custo Médio / Funcionário', value: formatWorkforceCurrency(metrics.avgCostPerEmployee.value), color: C.info, helper: meta.hasComparison ? `${fmtSignedPct(metrics.avgCostPerEmployee.trend)} vs ${refLabel}` : meta.accumulatedLabels.avgCost },
    { label: 'Folha / Receita', value: `${metrics.payrollAsRevenuePercent.value.toFixed(1)}%`, color: C.warning, helper: `limite ${metrics.payrollAsRevenuePercent.threshold}%`, chip: metrics.payrollAsRevenuePercent.value > metrics.payrollAsRevenuePercent.threshold ? { label: 'acima do limite', cls: 'warn' } : undefined },
    { label: 'PJ vs CLT', value: `${metrics.contractDistribution.pj} / ${metrics.contractDistribution.clt}`, color: C.purple, helper: `PJ ${metrics.contractDistribution.pjPercent.toFixed(0)}% · CLT ${metrics.contractDistribution.cltPercent.toFixed(0)}%` },
  ];
  blocks.push(block(sectionTitle('Visão Executiva', `Comparação: ${refLabel}`, 1), mmForSectionTitle(true), { keepWithNext: true }));
  blocks.push(block(kpiGrid(kpiCards, 5), mmForKpiGrid(5, 5)));

  const gaugeColor = payrollRisk.status === 'healthy' ? C.success : payrollRisk.status === 'attention' ? C.warning : C.critical;
  const gaugeBlock = chartBlock({
    title: 'Risco de Folha',
    sub: `folha ${fmtSignedPct(payrollRisk.payrollGrowth)} · receita ${fmtSignedPct(payrollRisk.revenueGrowth)}`,
    svg: svgGauge(payrollRisk.riskScore, {
      width: 490,
      height: 128,
      label: 'Score de risco',
      valueText: `${payrollRisk.riskScore}/100`,
      color: gaugeColor,
      bands: [[0, 40, C.success], [40, 70, C.warning], [70, 100, C.critical]],
    }),
  });
  const compositionBlock = chartBlock({
    title: 'Composição do Quadro — PJ × CLT',
    svg: svgStackedBar(
      [
        { label: 'CLT', value: metrics.contractDistribution.clt, color: C.primary },
        { label: 'PJ', value: metrics.contractDistribution.pj, color: C.purple },
      ],
      { width: 490, fmtValue: (n) => fmtInt(n) },
    ),
  });
  blocks.push(block(
    `<div class="two-col">${gaugeBlock}${compositionBlock}</div>`,
    mmForColumns(
      mmForChart(128, { svgWidthPx: 490, cols: 2, title: true }),
      mmForChart(60, { svgWidthPx: 490, cols: 2, title: true }),
    ),
  ));

  /* ── 02 · Evolução da Folha ── */

  if (trend.length >= 2) {
    blocks.push(block(sectionTitle('Evolução da Folha', 'tendência mensal de folha e custo médio', 2), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));
    const payrollTrend = chartBlock({
      title: 'Folha Mensal — Tendência',
      sub: `${trend.length} meses`,
      svg: svgAreaChart(
        trend.map((t) => t.period),
        [{ name: 'Folha', color: C.cost, values: trend.map((t) => t.payroll), endLabel: true }],
        // trend periods are already formatted labels — bypass the YYYY-MM formatter
        { width: 490, height: 180, fmtValue: compactBRL, xLabel: (s) => s },
      ),
    });
    const avgTrend = chartBlock({
      title: 'Custo Médio por Funcionário',
      sub: `headcount atual ${fmtInt(metrics.headcount.total)}`,
      svg: svgAreaChart(
        trend.map((t) => t.period),
        [{ name: 'Custo médio', color: C.info, values: trend.map((t) => t.avgCost), endLabel: true }],
        { width: 490, height: 180, fmtValue: compactBRL, xLabel: (s) => s },
      ),
      legendHtml: legend([
        { name: 'Folha', color: C.cost },
        { name: 'Custo médio', color: C.info },
      ]),
    });
    blocks.push(block(
      `<div class="two-col">${payrollTrend}${avgTrend}</div>`,
      mmForColumns(
        mmForChart(180, { svgWidthPx: 490, cols: 2, title: true }),
        mmForChart(180, { svgWidthPx: 490, cols: 2, title: true, legend: true }),
      ),
    ));
  }

  /* ── 03 · Concentração de Custos ── */

  blocks.push(block(sectionTitle('Concentração de Custos por Centro', `Top 3 concentração: ${costConcentration.top3Concentration.toFixed(1)}%`, 3), mmForSectionTitle(true), { keepWithNext: true }));

  const ccSorted = [...costConcentration.costCenters].sort((a, b) => b.payrollValue - a.payrollValue);
  const ccChart = chartBlock({
    title: 'Folha por Centro de Custo',
    svg: svgHorizontalBar(
      ccSorted.slice(0, 8).map((c) => ({ label: c.name, value: c.payrollValue })),
      { width: 490, fmtValue: (n) => formatWorkforceCurrency(n) },
    ),
  });
  const ccTable = dataTable(
    [
      { key: 'centro', label: 'Centro de Custo' },
      { key: 'folha', label: 'Folha', num: true },
      { key: 'head', label: 'Headcount', num: true },
      { key: 'var', label: 'Variação', num: true },
    ],
    ccSorted.map((c) => ({
      centro: c.name,
      folha: { html: `<span class="mono">${esc(formatWorkforceCurrency(c.payrollValue))}</span>` },
      head: fmtInt(c.headcount),
      var: { html: `<span style="color:${c.growthVsPrevious > 0 ? C.critical : C.success};font-weight:700">${esc(fmtSignedPct(c.growthVsPrevious))}</span>${c.isAbnormal ? ' <span class="pill warn">⚠</span>' : ''}` },
    })),
  );
  blocks.push(block(
    `<div class="two-col">${ccChart}<div>${ccTable}</div></div>`,
    mmForColumns(
      mmForChart(Math.min(ccSorted.length, 8) * 26 + 8, { svgWidthPx: 490, cols: 2, title: true }),
      mmForTable(ccSorted.length, { rowMm: 5.6 }),
    ),
  ));

  /* ── 04 · Risco, Alertas & Insights ── */

  blocks.push(block(sectionTitle('Risco de Folha & Alertas', undefined, 4), mmForSectionTitle(), { breakBefore: true, keepWithNext: true }));

  const riskTone = payrollRisk.status === 'healthy' ? 'ok' : payrollRisk.status === 'attention' ? 'warn' : 'crit';
  blocks.push(block(warningBox(
    `Risco de Folha — ${payrollRisk.riskScore}/100`,
    [
      payrollRisk.message,
      `Folha ${fmtSignedPct(payrollRisk.payrollGrowth)} · Receita ${fmtSignedPct(payrollRisk.revenueGrowth)}`,
    ],
    riskTone,
  ), mmForWarningBox(2)));
  const alertItems = alerts.length
    ? alerts.map((a) => `${a.title} — ${a.description}`)
    : ['Nenhum alerta ativo no período selecionado.'];
  blocks.push(block(warningBox('Central de Alertas', alertItems, alerts.length ? 'warn' : 'ok'), mmForWarningBox(alertItems.length)));

  const insights: InsightItem[] = [];
  if (ccSorted.length) {
    insights.push({
      kind: 'fact',
      title: 'Concentração de custos',
      detail: `Os 3 maiores centros de custo respondem por ${costConcentration.top3Concentration.toFixed(1)}% da folha; o maior é ${ccSorted[0].name} (${formatWorkforceCurrency(ccSorted[0].payrollValue)}).`,
      value: `${costConcentration.top3Concentration.toFixed(0)}%`,
    });
  }
  insights.push({
    kind: 'fact',
    title: 'Composição do quadro',
    detail: `${fmtInt(metrics.contractDistribution.clt)} CLT e ${fmtInt(metrics.contractDistribution.pj)} PJ (${metrics.contractDistribution.pjPercent.toFixed(0)}% terceirizado).`,
  });
  if (payrollRisk.payrollGrowth > payrollRisk.revenueGrowth) {
    insights.push({
      kind: 'alert',
      title: 'Folha crescendo acima da receita',
      detail: `Folha ${fmtSignedPct(payrollRisk.payrollGrowth)} contra receita ${fmtSignedPct(payrollRisk.revenueGrowth)} no período — pressão de margem.`,
    });
  }
  if (metrics.payrollAsRevenuePercent.value > metrics.payrollAsRevenuePercent.threshold) {
    insights.push({
      kind: 'alert',
      title: 'Folha acima do limite sobre receita',
      detail: `${metrics.payrollAsRevenuePercent.value.toFixed(1)}% da receita comprometida com folha (limite ${metrics.payrollAsRevenuePercent.threshold}%).`,
      value: `${metrics.payrollAsRevenuePercent.value.toFixed(1)}%`,
    });
  }
  const abnormal = ccSorted.filter((c) => c.isAbnormal);
  if (abnormal.length) {
    insights.push({
      kind: 'recommendation',
      title: 'Investigar variações atípicas',
      detail: `${fmtInt(abnormal.length)} centro(s) de custo com crescimento anômalo: ${abnormal.slice(0, 3).map((c) => c.name).join(', ')}${abnormal.length > 3 ? '…' : ''}.`,
    });
  }
  // O aviso de "dados demonstrativos" saiu junto com a série sintética: o
  // relatório só é gerado sobre competência apurada, então não há o que
  // ressalvar quanto à origem. A ressalva que sobrou é a de COBERTURA, que a
  // Visão Geral mostra por competência (ver `esocial-coverage`).
  const shownInsights = insights.slice(0, 6);
  if (shownInsights.length) {
    blocks.push(block(insightPanel(shownInsights, { cols: 2 }), mmForInsightPanel(shownInsights.length, 2)));
  }

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: reportMeta.logoUrl,
    footerLabel: `Pessoas & Custos · ${meta.periodLabel}`,
    pages: composePages(blocks, { orientation: 'landscape' }),
    orientation: 'landscape',
  });
}

export type WorkforceExportResult = ReportExportResult;

export function openWorkforceReport(payload: WorkforceReportPayload): WorkforceExportResult {
  try {
    return openReport(buildWorkforceReportHtml(payload), { width: 1280, height: 860 });
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : 'Falha ao gerar o relatório.' };
  }
}
