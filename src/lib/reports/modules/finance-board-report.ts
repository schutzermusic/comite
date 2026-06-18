/**
 * Financeiro · Relatórios da Diretoria → board-ready executive PDF pack.
 *
 * Renders the same board templates the screen builds (DRE mensal, Forecast,
 * Orçado×Realizado, Margens, Riscos, Earnings) as one structured pack: cover,
 * AI executive summary, one section per template (figures + chart + narrative),
 * distribution history and next actions. Monetary inputs are in reais.
 */

import { BRL, compactBRL, esc, fmtInt } from '@/lib/reports/report-formatters';
import { C } from '@/lib/reports/report-theme';
import { svgDonut, svgHorizontalBar, svgLineChart, svgGroupedBarChart, legend } from '@/lib/reports/report-charts';
import {
  reportCover, sectionTitle, kpiGrid, chartBlock, dataTable, warningBox, dataQualityBox,
  type KpiCardSpec,
} from '@/lib/reports/report-blocks';
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
  const brand = payload.brandName ?? 'INSIGHT — Governança Corporativa';
  const fileName = buildReportFileName({ module: 'financeiro', context: payload.singleTitle ? `diretoria-${payload.singleTitle}` : 'diretoria' });
  const meta = buildReportMeta({
    brand,
    periodLabel: payload.periodLabel,
    filtersLabel: `Cenário: ${payload.scenarioLabel}`,
    source: payload.source ?? 'demonstração',
    generatedBy: payload.generatedBy,
  });

  const cover = reportCover({
    meta,
    kicker: 'Relatório da Diretoria',
    title: payload.singleTitle ?? 'Pacote Executivo da Diretoria',
    context: payload.singleTitle
      ? `Pacote individual<span class="sep">·</span>${esc(payload.periodLabel)}`
      : `${fmtInt(payload.templates.length)} relatórios consolidados<span class="sep">·</span>${esc(payload.periodLabel)}`,
  });

  // ── AI executive summary ──
  const positives = payload.aiInsights.filter((i) => i.tone === 'positive').map((i) => `${i.title} — ${i.detail}`);
  const attention = payload.aiInsights.filter((i) => i.tone === 'warning').map((i) => `${i.title} — ${i.detail}`);
  const neutral = payload.aiInsights.filter((i) => i.tone === 'neutral').map((i) => `${i.title} — ${i.detail}`);
  const summarySection = `${sectionTitle('Sumário Executivo (AI)', 'destaques do período para o conselho')}`
    + (positives.length ? warningBox('Destaques positivos', positives, 'ok') : '')
    + (attention.length ? warningBox('Pontos de atenção', attention, 'warn') : '')
    + (neutral.length ? warningBox('Contexto', neutral, 'info') : '');

  // ── Pack KPIs ──
  const sent = payload.runs.filter((r) => r.status === 'approved' || r.status === 'closed').length;
  const kpiCards: KpiCardSpec[] = [
    { label: 'Relatórios no pacote', value: fmtInt(payload.templates.length), color: C.primary },
    { label: 'Distribuídos no mês', value: fmtInt(sent), color: C.success },
    { label: 'Destinatários (acum.)', value: fmtInt(payload.runs.reduce((a, r) => a + r.recipients, 0)), color: C.info },
    { label: 'Período base', value: payload.periodLabel, color: C.purple },
  ];
  const kpis = `${sectionTitle('Visão do Pacote')}${kpiGrid(kpiCards, 4)}`;

  // ── One section per template ──
  const templateSections = payload.templates.map((t) => {
    const bullets = warningBox('Resumo executivo', t.summaryBullets, 'info');
    const chart = chartBlock({
      title: 'Preview do pacote',
      svg: renderChart(t.chart),
      legendHtml: chartLegend(t.chart),
    });
    return `<section class="section">${sectionTitle(`${t.code} · ${t.title}`, `${t.audience} · ${t.cadence} · status ${t.status}`)}<div class="two-col"><div>${bullets}</div>${chart}</div></section>`;
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
  const runsSection = `${sectionTitle('Histórico de Distribuição')}${payload.runs.length ? runsTable : '<p class="empty">Sem pacotes distribuídos no período.</p>'}`;

  // ── Next actions + data quality ──
  const actions = warningBox('Próximas ações', payload.nextActions, 'info');
  const dq = dataQualityBox((payload.source ?? 'demonstração') === 'demonstração'
    ? ['Pacote gerado a partir de templates de demonstração dos Relatórios da Diretoria.']
    : []);
  const closingSection = `${sectionTitle('Encerramento')}${actions}${dq}`;

  // ── Assemble pages: cover+summary+kpis, then templates (2 per page), then closing ──
  const pages: string[] = [
    `<section class="section">${cover}</section><section class="section">${summarySection}</section><section class="section">${kpis}</section>`,
  ];
  for (let i = 0; i < templateSections.length; i += 2) {
    pages.push(templateSections.slice(i, i + 2).join(''));
  }
  pages.push(`<section class="section">${runsSection}</section><section class="section">${closingSection}</section>`);

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: payload.singleTitle ? `Diretoria · ${payload.singleTitle}` : 'Relatórios da Diretoria',
    pages,
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
