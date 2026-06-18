/**
 * Financeiro · DRE / P&L Gerencial → board-ready PDF report on the shared engine.
 *
 * Consumes the SAME view-model the DRE page renders (managerial rows, KPI strip,
 * expense composition and cumulative result series). Monetary inputs are in
 * reais. No P&L calculation here — formatting + layout only.
 */

import { BRL, compactBRL, esc } from '@/lib/reports/report-formatters';
import { C } from '@/lib/reports/report-theme';
import { svgDonut, svgLineChart, legend } from '@/lib/reports/report-charts';
import {
  reportCover, sectionTitle, kpiGrid, chartBlock, dataTable, dataQualityBox,
  type KpiCardSpec,
} from '@/lib/reports/report-blocks';
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
  const brand = payload.brandName ?? 'INSIGHT — Governança Corporativa';
  const fileName = buildReportFileName({ module: 'financeiro', context: 'dre' });
  const meta = buildReportMeta({
    brand,
    periodLabel: payload.periodLabel,
    filtersLabel: `Cenário: ${payload.scenarioLabel}`,
    source: payload.source ?? 'demonstração',
    generatedBy: payload.generatedBy,
  });

  const cover = reportCover({
    meta,
    kicker: 'Relatório Executivo · Financeiro',
    title: 'DRE / P&L Gerencial',
    context: `Demonstração de Resultado consolidada<span class="sep">·</span>${esc(payload.periodLabel)}`,
  });

  const kpiCards: KpiCardSpec[] = payload.kpis.map((k) => ({
    label: k.label,
    value: k.value,
    color: VARIANT_COLOR[k.variant ?? 'neutral'],
    helper: k.delta != null ? `${k.delta >= 0 ? '+' : ''}${k.delta.toFixed(1)}% vs anterior` : undefined,
  }));
  const kpis = `${sectionTitle('Indicadores do Resultado', `Cenário: ${esc(payload.scenarioLabel)}`)}${kpiGrid(kpiCards, 3)}`;

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
  const dreSection = `${sectionTitle('Demonstração de Resultado (Gerencial)')}${dreTable}`;

  // ── Expense composition donut + cumulative S-curve ──
  const donutBlock = chartBlock({
    title: 'Composição de Despesas',
    sub: 'custos diretos, OPEX e deduções',
    svg: svgDonut(
      [...payload.expenseComposition].sort((a, b) => b.value - a.value).slice(0, 8).map((e) => ({ label: e.name, value: e.value })),
      { width: 360, fmtValue: compactBRL },
    ),
  });
  const curveBlock = chartBlock({
    title: 'Resultado Acumulado (12 meses)',
    sub: 'realizado × orçado × forecast',
    svg: svgLineChart(
      payload.monthLabels,
      payload.cumulative.map((s, i) => ({
        name: s.name,
        color: s.color ?? [C.primary, C.info, C.success][i % 3],
        dashed: s.dashed,
        values: accumulate(s.values),
        endLabel: true,
      })),
      { width: 560, height: 240, xLabel: (x) => x },
    ),
    legendHtml: legend(payload.cumulative.map((s, i) => ({ name: s.name, color: s.color ?? [C.primary, C.info, C.success][i % 3], dashed: s.dashed }))),
  });
  const chartsSection = `${sectionTitle('Análise Gráfica')}<div class="two-col">${donutBlock}${curveBlock}</div>`;

  // ── Data quality ──
  const issues: string[] = [];
  if (!payload.rows.length) issues.push('DRE sem linhas para o período/cenário selecionado.');
  if ((payload.source ?? 'demonstração') === 'demonstração') issues.push('Relatório gerado a partir de dados de demonstração do DRE gerencial.');
  const dqSection = `${sectionTitle('Qualidade dos Dados')}${dataQualityBox(issues)}`;

  const page1 = `<section class="section">${cover}</section><section class="section">${kpis}</section>`;
  const page2 = `<section class="section">${dreSection}</section>`;
  const page3 = `<section class="section">${chartsSection}</section><section class="section">${dqSection}</section>`;

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: 'DRE / P&L Gerencial',
    pages: [page1, page2, page3],
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
