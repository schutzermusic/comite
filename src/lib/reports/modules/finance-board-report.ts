/**
 * Financeiro · Relatórios da Diretoria → board-ready executive PDF pack.
 *
 * Renders the same board templates the screen builds (DRE mensal, Forecast,
 * Orçado×Realizado, Margens, Riscos, Earnings) as one structured pack: cover,
 * AI executive summary, one section per template (figures + chart + narrative),
 * distribution history and next actions. Monetary inputs are in reais.
 */

import { BRL, compactBRL, esc, fmtInt } from '@/lib/reports/report-formatters';
import { C, REPORT_BRAND_NAME } from '@/lib/reports/report-theme';
import { svgDonut, svgHorizontalBar, svgLineChart, svgGroupedBarChart, legend } from '@/lib/reports/report-charts';
import {
  reportCover, sectionTitle, kpiGrid, chartBlock, dataTable, warningBox, dataQualityBox,
  type KpiCardSpec,
} from '@/lib/reports/report-blocks';
import {
  composePages, block, mmForChart, mmForColumns, mmForCover, mmForKpiGrid,
  mmForSectionTitle, mmForTable, mmForWarningBox, type ReportBlock,
} from '@/lib/reports/report-compose';
import { renderReportDocument } from '@/lib/reports/report-shell';
import { openReport, buildReportMeta, buildReportFileName } from '@/lib/reports/report-export';
import type { ReportExportResult } from '@/lib/reports/report-types';

export type BoardChartSpec =
  | { kind: 'donut'; slices: { label: string; value: number }[]; center?: string }
  | { kind: 'bars'; rows: { label: string; value: number }[] }
  | { kind: 'trend'; labels: string[]; series: { name: string; values: number[] }[] }
  | { kind: 'grouped'; labels: string[]; series: { name: string; values: number[]; color?: string }[]; valueFmt?: 'currency' | 'number' };

export interface BoardTemplateSection {
  code: string;
  title: string;
  audience: string;
  cadence: string;
  status: string;
  summaryBullets: string[];
  chart: BoardChartSpec;
}

export interface BoardReportRun {
  title: string;
  code: string;
  period: string;
  owner: string;
  generatedAt: string;
  recipients: number;
  status: string;
}

export interface FinanceBoardReportPayload {
  periodLabel: string;
  scenarioLabel: string;
  source?: string;
  brandName?: string;
  generatedBy?: string;
  /** Title used when exporting a single template (otherwise the consolidated pack). */
  singleTitle?: string;
  templates: BoardTemplateSection[];
  aiInsights: { tone: 'positive' | 'warning' | 'neutral'; title: string; detail: string }[];
  runs: BoardReportRun[];
  nextActions: string[];
}

const CATEGORICAL_3 = [C.primary, C.info, C.success];

function renderChart(spec: BoardChartSpec): string {
  if (spec.kind === 'donut') {
    return svgDonut(spec.slices, { width: 380, centerLabel: spec.center, fmtValue: compactBRL });
  }
  if (spec.kind === 'bars') {
    return svgHorizontalBar(
      spec.rows.map((r) => ({ label: r.label, value: r.value, color: r.value >= 0 ? C.success : C.critical })),
      { width: 560, fmtValue: BRL, labelW: 150 },
    );
  }
  if (spec.kind === 'trend') {
    return svgLineChart(
      spec.labels,
      spec.series.map((s, i) => ({ name: s.name, color: CATEGORICAL_3[i % 3], values: s.values, endLabel: true })),
      { width: 560, height: 230, xLabel: (x) => x },
    );
  }
  // grouped
  const fmt = spec.valueFmt === 'number' ? (n: number) => fmtInt(n) : compactBRL;
  return svgGroupedBarChart(
    spec.labels,
    spec.series.map((s, i) => ({ name: s.name, color: s.color ?? CATEGORICAL_3[i % 3], values: s.values })),
    { width: 560, height: 240, fmtValue: fmt, xLabel: (x) => x },
  );
}

function chartLegend(spec: BoardChartSpec): string {
  if (spec.kind === 'grouped') {
    return legend(spec.series.map((s, i) => ({ name: s.name, color: s.color ?? CATEGORICAL_3[i % 3] })));
  }
  if (spec.kind === 'trend') {
    return legend(spec.series.map((s, i) => ({ name: s.name, color: CATEGORICAL_3[i % 3] })));
  }
  return '';
}

export function buildFinanceBoardReportHtml(payload: FinanceBoardReportPayload): string {
  const brand = payload.brandName ?? REPORT_BRAND_NAME;
  const fileName = buildReportFileName({ module: 'financeiro', context: payload.singleTitle ? `diretoria-${payload.singleTitle}` : 'diretoria' });
  const meta = buildReportMeta({
    brand,
    periodLabel: payload.periodLabel,
    filtersLabel: `Cenário: ${payload.scenarioLabel}`,
    source: payload.source ?? 'demonstração',
    generatedBy: payload.generatedBy,
  });

  const sent0 = payload.runs.filter((r) => r.status === 'approved' || r.status === 'closed').length;
  const blocks: ReportBlock[] = [];
  blocks.push(block(reportCover({
    meta,
    kicker: 'Relatório da Diretoria',
    title: payload.singleTitle ?? 'Pacote Executivo da Diretoria',
    context: payload.singleTitle
      ? `Pacote individual<span class="sep">·</span>${esc(payload.periodLabel)}`
      : `${fmtInt(payload.templates.length)} relatórios consolidados<span class="sep">·</span>${esc(payload.periodLabel)}`,
    coverKpis: [
      { label: 'Relatórios', value: fmtInt(payload.templates.length) },
      { label: 'Distribuídos', value: fmtInt(sent0) },
      { label: 'Destinatários', value: fmtInt(payload.runs.reduce((a, r) => a + r.recipients, 0)) },
      { label: 'Período', value: payload.periodLabel },
    ],
  }), mmForCover(true)));

  // ── AI executive summary ──
  const positives = payload.aiInsights.filter((i) => i.tone === 'positive').map((i) => `${i.title} — ${i.detail}`);
  const attention = payload.aiInsights.filter((i) => i.tone === 'warning').map((i) => `${i.title} — ${i.detail}`);
  const neutral = payload.aiInsights.filter((i) => i.tone === 'neutral').map((i) => `${i.title} — ${i.detail}`);
  blocks.push(block(sectionTitle('Sumário Executivo (AI)', 'destaques do período para o conselho'), mmForSectionTitle(true), { keepWithNext: true }));
  if (positives.length) blocks.push(block(warningBox('Destaques positivos', positives, 'ok'), mmForWarningBox(positives.length)));
  if (attention.length) blocks.push(block(warningBox('Pontos de atenção', attention, 'warn'), mmForWarningBox(attention.length)));
  if (neutral.length) blocks.push(block(warningBox('Contexto', neutral, 'info'), mmForWarningBox(neutral.length)));

  // ── Pack KPIs ──
  const kpiCards: KpiCardSpec[] = [
    { label: 'Relatórios no pacote', value: fmtInt(payload.templates.length), color: C.primary },
    { label: 'Distribuídos no mês', value: fmtInt(sent0), color: C.success },
    { label: 'Destinatários (acum.)', value: fmtInt(payload.runs.reduce((a, r) => a + r.recipients, 0)), color: C.info },
    { label: 'Período base', value: payload.periodLabel, color: C.purple },
  ];
  blocks.push(block(sectionTitle('Visão do Pacote'), mmForSectionTitle(), { keepWithNext: true }));
  blocks.push(block(kpiGrid(kpiCards, 4), mmForKpiGrid(4, 4)));

  // ── One section per template (chart height depends on the spec kind) ──
  const specDims = (spec: BoardChartSpec): { w: number; h: number } => {
    if (spec.kind === 'donut') return { w: 380, h: 200 };
    if (spec.kind === 'bars') return { w: 560, h: spec.rows.length * 26 + 8 };
    if (spec.kind === 'trend') return { w: 560, h: 230 };
    return { w: 560, h: 240 };
  };
  payload.templates.forEach((t) => {
    const bullets = warningBox('Resumo executivo', t.summaryBullets, 'info');
    const chart = chartBlock({
      title: 'Preview do pacote',
      svg: renderChart(t.chart),
      legendHtml: chartLegend(t.chart),
    });
    const dims = specDims(t.chart);
    blocks.push(block(sectionTitle(`${t.code} · ${t.title}`, `${t.audience} · ${t.cadence} · status ${t.status}`), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));
    blocks.push(block(
      `<div class="two-col"><div>${bullets}</div>${chart}</div>`,
      mmForColumns(
        mmForWarningBox(t.summaryBullets.length),
        mmForChart(dims.h, { svgWidthPx: dims.w, cols: 2, title: true, legend: t.chart.kind === 'trend' || t.chart.kind === 'grouped' }),
      ),
    ));
  });

  // ── Distribution history ──
  const runsTable = dataTable(
    [
      { key: 'tpl', label: 'Relatório' },
      { key: 'code', label: 'Código' },
      { key: 'period', label: 'Período' },
      { key: 'owner', label: 'Owner' },
      { key: 'gen', label: 'Geração' },
      { key: 'rec', label: 'Destinatários', num: true },
      { key: 'status', label: 'Status' },
    ],
    payload.runs.map((r) => ({
      tpl: r.title,
      code: r.code,
      period: { html: `<span class="mono">${esc(r.period)}</span>` },
      owner: r.owner,
      gen: { html: `<span class="mono">${esc(r.generatedAt)}</span>` },
      rec: fmtInt(r.recipients),
      status: { html: `<span class="pill ${r.status === 'approved' || r.status === 'closed' ? 'ok' : r.status === 'review' ? 'warn' : ''}">${esc(r.status)}</span>` },
    })),
  );
  blocks.push(block(sectionTitle('Histórico de Distribuição'), mmForSectionTitle(), { breakBefore: true, keepWithNext: true }));
  blocks.push(block(payload.runs.length ? runsTable : '<p class="empty">Sem pacotes distribuídos no período.</p>', payload.runs.length ? mmForTable(payload.runs.length, { rowMm: 5.6 }) : 8));

  // ── Next actions + data quality ──
  blocks.push(block(sectionTitle('Encerramento'), mmForSectionTitle(), { keepWithNext: true }));
  blocks.push(block(warningBox('Próximas ações', payload.nextActions, 'info'), mmForWarningBox(payload.nextActions.length)));
  blocks.push(block(dataQualityBox((payload.source ?? 'demonstração') === 'demonstração'
    ? ['Pacote gerado a partir de templates de demonstração dos Relatórios da Diretoria.']
    : []), mmForWarningBox(1)));

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: payload.singleTitle ? `Diretoria · ${payload.singleTitle}` : 'Relatórios da Diretoria',
    pages: composePages(blocks, { orientation: 'landscape' }),
    orientation: 'landscape',
  });
}

export function openFinanceBoardReport(payload: FinanceBoardReportPayload): ReportExportResult {
  try {
    return openReport(buildFinanceBoardReportHtml(payload), { width: 1280, height: 860 });
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : 'Falha ao gerar o relatório.' };
  }
}
