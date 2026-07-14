/**
 * Financeiro · DRE / P&L Gerencial → board-ready PDF report on the shared engine.
 *
 * Consumes the SAME view-model the DRE page renders (managerial rows, KPI strip,
 * expense composition and cumulative result series). Monetary inputs are in
 * reais. No P&L calculation here — formatting + layout only.
 */

import { BRL, compactBRL, esc } from '@/lib/reports/report-formatters';
import { C, REPORT_BRAND_NAME } from '@/lib/reports/report-theme';
import { svgDonut, svgAreaChart, legend } from '@/lib/reports/report-charts';
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

export interface DreReportKpi {
  label: string;
  value: string;
  delta?: number;
  variant?: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
}

export interface DreReportRow {
  key: string;
  label: string;
  level: 0 | 1;
  current: number;
  budget: number;
}

export interface DreReportSeries {
  name: string;
  values: number[];
  color?: string;
  dashed?: boolean;
}

export interface FinanceDreReportPayload {
  periodLabel: string;
  scenarioLabel: string;
  source?: string;
  brandName?: string;
  generatedBy?: string;
  kpis: DreReportKpi[];
  rows: DreReportRow[];
  expenseComposition: { name: string; value: number }[];
  cumulative: DreReportSeries[];
  monthLabels: string[];
}

const VARIANT_COLOR: Record<NonNullable<DreReportKpi['variant']>, string> = {
  info: C.info,
  success: C.success,
  warning: C.warning,
  danger: C.critical,
  neutral: C.subtle,
};

export function buildFinanceDreReportHtml(payload: FinanceDreReportPayload): string {
  const brand = payload.brandName ?? REPORT_BRAND_NAME;
  const fileName = buildReportFileName({ module: 'financeiro', context: 'dre' });
  const meta = buildReportMeta({
    brand,
    periodLabel: payload.periodLabel,
    filtersLabel: `Cenário: ${payload.scenarioLabel}`,
    source: payload.source ?? 'demonstração',
    generatedBy: payload.generatedBy,
  });

  const blocks: ReportBlock[] = [];

  blocks.push(block(reportCover({
    meta,
    kicker: 'Relatório Executivo · Financeiro',
    title: 'DRE / P&L Gerencial',
    context: `Demonstração de Resultado consolidada<span class="sep">·</span>${esc(payload.periodLabel)}`,
    coverKpis: payload.kpis.slice(0, 4).map((k) => ({ label: k.label, value: k.value })),
  }), mmForCover(true)));

  const kpiCards: KpiCardSpec[] = payload.kpis.map((k) => ({
    label: k.label,
    value: k.value,
    color: VARIANT_COLOR[k.variant ?? 'neutral'],
    helper: k.delta != null ? `${k.delta >= 0 ? '+' : ''}${k.delta.toFixed(1)}% vs anterior` : undefined,
  }));
  blocks.push(block(sectionTitle('Indicadores do Resultado', `Cenário: ${payload.scenarioLabel}`, 1), mmForSectionTitle(true), { keepWithNext: true }));
  blocks.push(block(kpiGrid(kpiCards, 3), mmForKpiGrid(kpiCards.length, 3)));

  // ── DRE table (indented; group lines bold) ──
  const dreTable = dataTable(
    [
      { key: 'linha', label: 'Linha' },
      { key: 'atual', label: 'Atual', num: true },
      { key: 'orc', label: 'Orçado', num: true },
      { key: 'var', label: 'Variação', num: true },
    ],
    payload.rows.map((r) => {
      const varAbs = r.current - r.budget;
      const labelHtml = r.level === 0
        ? `<b>${esc(r.label)}</b>`
        : `<span style="padding-left:14px;color:${C.muted}">${esc(r.label)}</span>`;
      return {
        linha: { html: labelHtml },
        atual: { html: `<span class="mono"${r.level === 0 ? ' style="font-weight:700"' : ''}>${esc(BRL(r.current))}</span>` },
        orc: { html: `<span class="mono">${esc(BRL(r.budget))}</span>` },
        var: { html: `<span class="mono" style="color:${varAbs >= 0 ? C.success : C.critical};font-weight:700">${esc(BRL(varAbs))}</span>` },
      };
    }),
  );


  // ── Expense composition donut + cumulative S-curve ──
  const donutBlock = chartBlock({
    title: 'Composição de Despesas',
    sub: 'custos diretos, OPEX e deduções',
    svg: svgDonut(
      [...payload.expenseComposition].sort((a, b) => b.value - a.value).slice(0, 8).map((e) => ({ label: e.name, value: e.value })),
      { width: 490, height: 170, fmtValue: compactBRL },
    ),
  });
  const curveBlock = chartBlock({
    title: 'Resultado Acumulado (12 meses)',
    sub: 'realizado × orçado × forecast',
    svg: svgAreaChart(
      payload.monthLabels,
      payload.cumulative.map((s, i) => ({
        name: s.name,
        color: s.color ?? [C.primary, C.info, C.success][i % 3],
        dashed: s.dashed,
        values: accumulate(s.values),
        endLabel: true,
        area: i === 0,
      })),
      { width: 490, height: 190, xLabel: (x) => x },
    ),
    legendHtml: legend(payload.cumulative.map((s, i) => ({ name: s.name, color: s.color ?? [C.primary, C.info, C.success][i % 3], dashed: s.dashed }))),
  });
  blocks.push(block(
    `<div class="two-col">${donutBlock}${curveBlock}</div>`,
    mmForColumns(
      mmForChart(170, { svgWidthPx: 490, cols: 2, title: true }),
      mmForChart(190, { svgWidthPx: 490, cols: 2, title: true, legend: true }),
    ),
  ));

  blocks.push(block(sectionTitle('Demonstração de Resultado (Gerencial)', undefined, 2), mmForSectionTitle(), { breakBefore: true, keepWithNext: true }));
  blocks.push(block(dreTable, mmForTable(payload.rows.length, { rowMm: 5 })));

  const insights: InsightItem[] = [];
  const worstRow = [...payload.rows].filter((r) => r.level === 0).sort((a, b) => (a.current - a.budget) - (b.current - b.budget))[0];
  if (worstRow && worstRow.current - worstRow.budget < 0) {
    insights.push({
      kind: 'alert',
      title: 'Maior desvio negativo vs orçado',
      detail: `${worstRow.label} está ${compactBRL(Math.abs(worstRow.current - worstRow.budget))} abaixo do orçamento no período.`,
    });
  }
  const topExpense = [...payload.expenseComposition].sort((a, b) => b.value - a.value)[0];
  const expenseTotal = payload.expenseComposition.reduce((sum, e) => sum + e.value, 0);
  if (topExpense && expenseTotal > 0) {
    insights.push({
      kind: 'fact',
      title: 'Maior componente de despesa',
      detail: `${topExpense.name} representa ${Math.round((topExpense.value / expenseTotal) * 100)}% da composição de despesas (${compactBRL(topExpense.value)}).`,
      value: `${Math.round((topExpense.value / expenseTotal) * 100)}%`,
    });
  }
  if ((payload.source ?? 'demonstração') === 'demonstração') {
    insights.push({
      kind: 'data-quality',
      title: 'Dados de demonstração',
      detail: 'Números do DRE gerados em modo demonstração — não refletem lançamentos reais.',
    });
  }
  if (insights.length) {
    blocks.push(block(insightPanel(insights, { cols: 2 }), mmForInsightPanel(insights.length, 2)));
  }

  // ── Data quality ──
  const issues: string[] = [];
  if (!payload.rows.length) issues.push('DRE sem linhas para o período/cenário selecionado.');
  if ((payload.source ?? 'demonstração') === 'demonstração') issues.push('Relatório gerado a partir de dados de demonstração do DRE gerencial.');
  blocks.push(block(dataQualityBox(issues), mmForWarningBox(Math.max(1, issues.length))));

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: 'DRE / P&L Gerencial',
    pages: composePages(blocks, { orientation: 'landscape' }),
    orientation: 'landscape',
  });
}

function accumulate(values: number[]): number[] {
  let acc = 0;
  return values.map((v) => (acc += v));
}

export function openFinanceDreReport(payload: FinanceDreReportPayload): ReportExportResult {
  try {
    return openReport(buildFinanceDreReportHtml(payload), { width: 1280, height: 860 });
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : 'Falha ao gerar o relatório.' };
  }
}
