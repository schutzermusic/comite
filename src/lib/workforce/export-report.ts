/**
 * Workforce (Pessoas & Custos) overview → print-ready HTML report.
 *
 * Built on the shared enterprise report engine (src/lib/reports): branded cover,
 * light print theme, KPI grid, cost-concentration chart + table and a payroll
 * risk / alerts section. The report ALWAYS reflects the selected period — the
 * cover carries the period label, generated date and data source.
 */

import { formatWorkforceCurrency } from '@/lib/workforce-data';
import type { WorkforceViewModel } from './period';
import { esc, fmtInt, fmtSignedPct } from '@/lib/reports/report-formatters';
import { C } from '@/lib/reports/report-theme';
import { svgHorizontalBar } from '@/lib/reports/report-charts';
import { reportCover, sectionTitle, kpiGrid, chartBlock, dataTable, warningBox, type KpiCardSpec } from '@/lib/reports/report-blocks';
import { renderReportDocument } from '@/lib/reports/report-shell';
import { openReport, buildReportMeta, buildReportFileName } from '@/lib/reports/report-export';
import type { ReportExportResult } from '@/lib/reports/report-types';

export interface WorkforceReportPayload extends WorkforceViewModel {
  brandName?: string;
}

export function buildWorkforceReportHtml(payload: WorkforceReportPayload): string {
  const { metrics, costConcentration, payrollRisk, alerts, meta } = payload;
  const brand = payload.brandName ?? 'INSIGHT — Governança Corporativa';
  const fileName = buildReportFileName({ module: 'pessoas-custos', context: meta.periodLabel });

  const reportMeta = buildReportMeta({
    brand,
    generatedAt: meta.generatedAt,
    periodLabel: meta.periodLabel,
    filtersLabel: `${meta.monthsInRange} ${meta.monthsInRange === 1 ? 'mês' : 'meses'} no escopo`,
    source: meta.source,
  });

  const cover = reportCover({
    meta: reportMeta,
    kicker: 'Relatório Executivo · Pessoas & Custos',
    title: 'Sala de Controle de Custos de Pessoal',
    context: meta.aggregation === 'average'
      ? `Folha acumulada no período: <b>${esc(formatWorkforceCurrency(meta.totalPayrollAccum))}</b>`
      : undefined,
  });

  // ── KPI grid ──
  const refLabel = meta.hasComparison ? meta.comparisonLabel : 'Referência';
  const kpiCards: KpiCardSpec[] = [
    { label: 'Total Funcionários', value: fmtInt(metrics.headcount.total), color: C.primary, helper: meta.hasComparison ? `${fmtSignedPct(metrics.headcount.trend)} vs ${refLabel}` : meta.accumulatedLabels.headcount },
    { label: `Folha Mensal${meta.aggregation === 'average' ? ' (média)' : ''}`, value: formatWorkforceCurrency(metrics.monthlyPayroll.value), color: C.cost, helper: meta.hasComparison ? `${fmtSignedPct(metrics.monthlyPayroll.trend)} vs ${refLabel}` : meta.accumulatedLabels.payroll },
    { label: 'Custo Médio / Funcionário', value: formatWorkforceCurrency(metrics.avgCostPerEmployee.value), color: C.info, helper: meta.hasComparison ? `${fmtSignedPct(metrics.avgCostPerEmployee.trend)} vs ${refLabel}` : meta.accumulatedLabels.avgCost },
    { label: 'Folha / Receita', value: `${metrics.payrollAsRevenuePercent.value.toFixed(1)}%`, color: C.warning, helper: `limite ${metrics.payrollAsRevenuePercent.threshold}%`, chip: metrics.payrollAsRevenuePercent.value > metrics.payrollAsRevenuePercent.threshold ? { label: 'acima do limite', cls: 'warn' } : undefined },
    { label: 'PJ vs CLT', value: `${metrics.contractDistribution.pj} / ${metrics.contractDistribution.clt}`, color: C.purple, helper: `PJ ${metrics.contractDistribution.pjPercent.toFixed(0)}% · CLT ${metrics.contractDistribution.cltPercent.toFixed(0)}%` },
  ];
  const kpis = `${sectionTitle('Indicadores', `Comparação: ${esc(refLabel)}`)}${kpiGrid(kpiCards)}`;

  // ── Cost concentration: chart + table ──
  const ccSorted = [...costConcentration.costCenters].sort((a, b) => b.payrollValue - a.payrollValue);
  const ccChart = chartBlock({
    title: 'Folha por Centro de Custo',
    sub: `Top 3 concentração: ${costConcentration.top3Concentration.toFixed(1)}%`,
    svg: svgHorizontalBar(
      ccSorted.slice(0, 8).map((c) => ({ label: c.name, value: c.payrollValue })),
      { width: 520, fmtValue: (n) => formatWorkforceCurrency(n) },
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
  const ccSection = `${sectionTitle('Concentração de Custos por Centro')}<div class="two-col">${ccChart}<div>${ccTable}</div></div>`;

  // ── Payroll risk + alerts ──
  const riskTone = payrollRisk.status === 'healthy' ? 'ok' : payrollRisk.status === 'attention' ? 'warn' : 'crit';
  const riskBox = warningBox(
    `Risco de Folha — ${payrollRisk.riskScore}/100`,
    [
      payrollRisk.message,
      `Folha ${fmtSignedPct(payrollRisk.payrollGrowth)} · Receita ${fmtSignedPct(payrollRisk.revenueGrowth)}`,
    ],
    riskTone,
  );
  const alertItems = alerts.length
    ? alerts.map((a) => `${a.title} — ${a.description}`)
    : ['Nenhum alerta ativo no período selecionado.'];
  const alertsBox = warningBox('Central de Alertas', alertItems, alerts.length ? 'warn' : 'ok');
  const riskSection = `${sectionTitle('Risco de Folha & Alertas')}${riskBox}${alertsBox}`;

  const page1 = `<section class="section">${cover}</section><section class="section">${kpis}</section><section class="section">${ccSection}</section>`;
  const page2 = `<section class="section">${riskSection}</section>`;

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: reportMeta.logoUrl,
    footerLabel: `Pessoas & Custos · ${meta.periodLabel}`,
    pages: [page1, page2],
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
