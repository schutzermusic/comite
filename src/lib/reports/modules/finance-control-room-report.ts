/**
 * Financeiro · Control Room → board-ready PDF report on the shared engine
 * (premium executive layout — composePages + 2.5D charts + insight cards).
 *
 * Consumes the SAME derived values the Sala Financeira Executiva renders
 * (managerial DRE rows + top variation drivers + hero metrics). All monetary
 * inputs are in CENTS (the finance-store convention) and converted to reais for
 * display only — no financial calculation happens here.
 */

import { BRL, compactBRL, esc, fmtInt } from '@/lib/reports/report-formatters';
import { C, REPORT_BRAND_NAME } from '@/lib/reports/report-theme';
import { svgHorizontalBar, svgGauge, svgBullet } from '@/lib/reports/report-charts';
import {
  reportCover, sectionTitle, kpiGrid, chartBlock, dataTable, dataQualityBox,
  type KpiCardSpec,
} from '@/lib/reports/report-blocks';
import {
  composePages, block, mmForChart, mmForColumns, mmForCover, mmForKpiGrid,
  mmForSectionTitle, mmForTable, mmForWarningBox, type ReportBlock,
} from '@/lib/reports/report-compose';
import { insightPanel, mmForInsightPanel, type InsightItem } from '@/lib/reports/report-insights';
import { renderReportDocument } from '@/lib/reports/report-shell';
import { openReport, buildReportMeta, buildReportFileName } from '@/lib/reports/report-export';
import type { ReportExportResult } from '@/lib/reports/report-types';

/** Managerial DRE line — amounts in cents. */
export interface ControlRoomDreLine {
  label: string;
  actual: number;
  budget: number;
  forecast: number;
}

/** Top variation driver — amounts in cents. */
export interface ControlRoomDriver {
  categoryName: string;
  groupLabel?: string;
  projectName?: string;
  actual: number;
  budget: number;
  varianceAbs: number;
  variancePct: number;
}

export interface FinanceControlRoomReportPayload {
  periodLabel: string;
  scenarioLabel: string;
  source?: string;
  brandName?: string;
  generatedBy?: string;
  /** Hero metrics in cents (margins in %). */
  healthScore: number;
  netRevenue: number;
  ebitda: number;
  ebitdaMargin: number;
  operatingResult: number;
  forecastGap: number;
  cashRisk: number;
  pendingActions: number;
  dreRows: ControlRoomDreLine[];
  drivers: ControlRoomDriver[];
}

const c2r = (cents: number) => (cents ?? 0) / 100;

export function buildFinanceControlRoomReportHtml(payload: FinanceControlRoomReportPayload): string {
  const brand = payload.brandName ?? REPORT_BRAND_NAME;
  const fileName = buildReportFileName({ module: 'financeiro', context: 'control-room' });
  const meta = buildReportMeta({
    brand,
    periodLabel: payload.periodLabel,
    filtersLabel: `Cenário: ${payload.scenarioLabel}`,
    source: payload.source ?? 'demonstração',
    generatedBy: payload.generatedBy,
  });
  const blocks: ReportBlock[] = [];

  /* ── 01 · Visão Executiva ── */

  blocks.push(block(reportCover({
    meta,
    kicker: 'Relatório Executivo · Financeiro',
    title: 'Sala Financeira Executiva',
    context: `EBITDA <b>${esc(compactBRL(c2r(payload.ebitda)))}</b><span class="sep">·</span>margem ${payload.ebitdaMargin.toFixed(1)}%`,
    coverKpis: [
      { label: 'Receita líquida', value: compactBRL(c2r(payload.netRevenue)) },
      { label: 'EBITDA', value: compactBRL(c2r(payload.ebitda)) },
      { label: 'Margem EBITDA', value: `${payload.ebitdaMargin.toFixed(1)}%` },
      { label: 'Health score', value: `${fmtInt(payload.healthScore)}/100` },
    ],
  }), mmForCover(true)));

  const kpiCards: KpiCardSpec[] = [
    { label: 'Receita líquida', value: compactBRL(c2r(payload.netRevenue)), color: C.primary },
    { label: 'EBITDA', value: compactBRL(c2r(payload.ebitda)), color: C.success, helper: `margem ${payload.ebitdaMargin.toFixed(1)}%` },
    { label: 'Resultado operacional', value: compactBRL(c2r(payload.operatingResult)), color: C.info },
    { label: 'Gap vs orçado (fcst)', value: compactBRL(c2r(payload.forecastGap)), color: payload.forecastGap >= 0 ? C.success : C.critical, chip: payload.forecastGap < 0 ? { label: 'abaixo', cls: 'crit' } : undefined },
    { label: 'Health score', value: `${fmtInt(payload.healthScore)}/100`, color: C.purple },
    { label: 'Risco de caixa', value: compactBRL(c2r(payload.cashRisk)), color: payload.cashRisk < 0 ? C.critical : C.success, helper: `${fmtInt(payload.pendingActions)} ações pendentes` },
  ];
  blocks.push(block(sectionTitle('Visão Executiva', `Cenário: ${payload.scenarioLabel}`, 1), mmForSectionTitle(true), { keepWithNext: true }));
  blocks.push(block(kpiGrid(kpiCards, 3), mmForKpiGrid(6, 3)));

  const gaugeBlock = chartBlock({
    title: 'Health Score Financeiro',
    sub: `${fmtInt(payload.pendingActions)} ações pendentes no período`,
    svg: svgGauge(payload.healthScore, {
      width: 490,
      height: 124,
      label: 'Health',
      valueText: `${fmtInt(payload.healthScore)}/100`,
      color: payload.healthScore >= 70 ? C.success : payload.healthScore >= 40 ? C.warning : C.critical,
      bands: [[0, 40, C.critical], [40, 70, C.warning], [70, 100, C.success]],
    }),
  });
  const dreTop = payload.dreRows.slice(0, 5);
  const bulletBlock = chartBlock({
    title: 'Realizado × Orçado — Linhas Gerenciais',
    sub: 'barra = realizado · marcador = orçado',
    svg: svgBullet(
      dreTop.map((r) => ({ label: r.label, value: c2r(r.actual), target: c2r(r.budget) })),
      { width: 490, rowH: 24, fmtValue: compactBRL, labelW: 150 },
    ),
  });
  blocks.push(block(
    `<div class="two-col">${gaugeBlock}${bulletBlock}</div>`,
    mmForColumns(
      mmForChart(124, { svgWidthPx: 490, cols: 2, title: true }),
      mmForChart(dreTop.length * 24 + 8, { svgWidthPx: 490, cols: 2, title: true }),
    ),
  ));

  /* ── 02 · Resultado Gerencial ── */

  blocks.push(block(sectionTitle('Resultado Gerencial (DRE)', 'realizado × orçado × forecast', 2), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));
  const dreTable = dataTable(
    [
      { key: 'linha', label: 'Linha gerencial' },
      { key: 'real', label: 'Realizado', num: true },
      { key: 'orc', label: 'Orçado', num: true },
      { key: 'fcst', label: 'Forecast', num: true },
      { key: 'varr', label: 'Var. vs orçado', num: true },
    ],
    payload.dreRows.map((r) => {
      const varAbs = r.actual - r.budget;
      return {
        linha: r.label,
        real: { html: `<span class="mono">${esc(BRL(c2r(r.actual)))}</span>` },
        orc: { html: `<span class="mono">${esc(BRL(c2r(r.budget)))}</span>` },
        fcst: { html: `<span class="mono">${esc(BRL(c2r(r.forecast)))}</span>` },
        varr: { html: `<span class="mono" style="color:${varAbs >= 0 ? C.success : C.critical};font-weight:700">${esc(BRL(c2r(varAbs)))}</span>` },
      };
    }),
  );
  blocks.push(block(dreTable, mmForTable(payload.dreRows.length, { rowMm: 5 })));

  /* ── 03 · Drivers de Variação ── */

  blocks.push(block(sectionTitle('Drivers de Custo & Variação', 'principais desvios vs orçado', 3), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));
  const sortedDrivers = [...payload.drivers].sort((a, b) => Math.abs(b.varianceAbs) - Math.abs(a.varianceAbs));
  const topBars = sortedDrivers.slice(0, 8);
  blocks.push(block(chartBlock({
    title: 'Top Variações vs Orçado',
    sub: 'principais drivers de variação (R$)',
    svg: svgHorizontalBar(
      topBars.map((d) => ({ label: `${d.categoryName}${d.projectName ? ` · ${d.projectName}` : ''}`, value: c2r(d.varianceAbs), color: d.varianceAbs >= 0 ? C.success : C.critical })),
      { width: 1000, fmtValue: compactBRL, labelW: 220 },
    ),
  }), mmForChart(topBars.length * 26 + 8, { svgWidthPx: 1000, title: true })));

  if (payload.drivers.length) {
    blocks.push(block(dataTable(
      [
        { key: 'cat', label: 'Categoria' },
        { key: 'grupo', label: 'Grupo' },
        { key: 'proj', label: 'Projeto' },
        { key: 'real', label: 'Realizado', num: true },
        { key: 'orc', label: 'Orçado', num: true },
        { key: 'var', label: 'Variação', num: true },
        { key: 'pct', label: 'Var. %', num: true },
      ],
      sortedDrivers.slice(0, 12).map((d) => ({
        cat: d.categoryName,
        grupo: d.groupLabel ?? '—',
        proj: d.projectName ?? 'Corporativo',
        real: { html: `<span class="mono">${esc(BRL(c2r(d.actual)))}</span>` },
        orc: { html: `<span class="mono">${esc(BRL(c2r(d.budget)))}</span>` },
        var: { html: `<span class="mono" style="color:${d.varianceAbs >= 0 ? C.success : C.critical};font-weight:700">${esc(BRL(c2r(d.varianceAbs)))}</span>` },
        pct: `${d.variancePct >= 0 ? '+' : ''}${d.variancePct.toFixed(1)}%`,
      })),
    ), mmForTable(Math.min(payload.drivers.length, 12), { rowMm: 5 })));
  } else {
    blocks.push(block('<p class="empty">Sem variações relevantes no período.</p>', 8));
  }

  /* ── 04 · Insights & Qualidade ── */

  const insights: InsightItem[] = [];
  insights.push({
    kind: 'fact',
    title: 'Margem EBITDA do período',
    detail: `EBITDA de ${compactBRL(c2r(payload.ebitda))} sobre receita líquida de ${compactBRL(c2r(payload.netRevenue))}.`,
    value: `${payload.ebitdaMargin.toFixed(1)}%`,
  });
  if (sortedDrivers[0]) {
    const d = sortedDrivers[0];
    insights.push({
      kind: 'fact',
      title: 'Maior driver de variação',
      detail: `${d.categoryName}${d.projectName ? ` (${d.projectName})` : ''} desvia ${compactBRL(c2r(d.varianceAbs))} (${d.variancePct >= 0 ? '+' : ''}${d.variancePct.toFixed(1)}%) vs orçado.`,
    });
  }
  if (payload.forecastGap < 0) {
    insights.push({
      kind: 'alert',
      title: 'Forecast abaixo do orçado',
      detail: `Gap de ${compactBRL(c2r(payload.forecastGap))} entre forecast e orçamento do período.`,
      value: compactBRL(c2r(payload.forecastGap)),
    });
  }
  if (payload.cashRisk < 0) {
    insights.push({
      kind: 'alert',
      title: 'Risco de caixa',
      detail: `Posição projetada negativa de ${compactBRL(c2r(payload.cashRisk))} no horizonte do cenário.`,
    });
  }
  if (payload.pendingActions > 0) {
    insights.push({
      kind: 'recommendation',
      title: 'Executar ações pendentes',
      detail: `${fmtInt(payload.pendingActions)} ação(ões) financeiras aguardando execução no Control Room.`,
      value: fmtInt(payload.pendingActions),
    });
  }
  if ((payload.source ?? 'demonstração') === 'demonstração') {
    insights.push({
      kind: 'data-quality',
      title: 'Dados de demonstração',
      detail: 'Números gerados a partir do modo demonstração da Sala Financeira — não refletem lançamentos reais.',
    });
  }
  blocks.push(block(sectionTitle('Insights Executivos', 'leituras factuais do período', 4), mmForSectionTitle(true), { keepWithNext: true }));
  blocks.push(block(insightPanel(insights.slice(0, 6), { cols: 2 }), mmForInsightPanel(Math.min(insights.length, 6), 2)));

  const issues: string[] = [];
  if (!payload.dreRows.length) issues.push('DRE gerencial sem linhas para o cenário/período selecionado.');
  if ((payload.source ?? 'demonstração') === 'demonstração') issues.push('Relatório gerado a partir de dados de demonstração da Sala Financeira.');
  blocks.push(block(dataQualityBox(issues), mmForWarningBox(Math.max(1, issues.length))));

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: 'Sala Financeira Executiva',
    pages: composePages(blocks, { orientation: 'landscape' }),
    orientation: 'landscape',
  });
}

export function openFinanceControlRoomReport(payload: FinanceControlRoomReportPayload): ReportExportResult {
  try {
    return openReport(buildFinanceControlRoomReportHtml(payload), { width: 1280, height: 860 });
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : 'Falha ao gerar o relatório.' };
  }
}
