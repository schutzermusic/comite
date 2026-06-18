/**
 * Generic Financeiro report builder — the reusable `exportModuleReport` for the
 * many Finance sub-pages (Forecast, Orçado×Realizado, Margens, AP/AR, Centros de
 * Custo, Impostos, Fechamento, Lançamentos, Folha, Bancos, Contratos & Receita…).
 *
 * A page provides its on-screen KPIs, chart specs and tables; the engine renders
 * the branded cover, KPI grid, charts (with visible numbers) and supporting
 * tables. No financial calculation here — formatting + layout only.
 */

import { esc, BRL, compactBRL, fmtInt } from '@/lib/reports/report-formatters';
import {
  reportCover, sectionTitle, kpiGrid, chartBlock, dataTable, warningBox, dataQualityBox,
  type KpiCardSpec, type TableColumn, type TableCell,
} from '@/lib/reports/report-blocks';
import { renderReportDocument } from '@/lib/reports/report-shell';
import { openReport, buildReportMeta, buildReportFileName } from '@/lib/reports/report-export';
import type { ReportExportResult } from '@/lib/reports/report-types';
import { renderFinanceChart, financeChartLegend, type FinanceChartSpec } from '@/lib/reports/finance-chart-spec';

export interface FinanceReportChart {
  title?: string;
  sub?: string;
  spec: FinanceChartSpec;
}

export interface FinanceReportTable {
  title?: string;
  sub?: string;
  columns: TableColumn[];
  rows: Record<string, TableCell>[];
}

export interface FinanceReportSection {
  title: string;
  sub?: string;
  /** Charts shown side-by-side (1–2) under the section title. */
  charts?: FinanceReportChart[];
  /** Tables stacked under the charts. */
  tables?: FinanceReportTable[];
  /** Optional callout box. */
  note?: { title: string; items: string[]; tone?: 'warn' | 'ok' | 'crit' | 'info' };
}

export interface FinanceReportPayload {
  /** Module-specific report title (e.g. "Forecast & Cenários"). */
  title: string;
  /** Kicker above the title. Defaults to "Relatório Executivo · Financeiro". */
  kicker?: string;
  /** Context line under the title (HTML allowed). */
  context?: string;
  periodLabel?: string;
  scenarioLabel?: string;
  filtersLabel?: string;
  source?: string;
  brandName?: string;
  generatedBy?: string;
  /** Filename context segment (e.g. "forecast"). */
  fileContext: string;
  /** Top KPI grid. */
  kpis: KpiCardSpec[];
  /** Content sections (charts + tables). */
  sections: FinanceReportSection[];
  /** Detected data-quality gaps (empty → "no issues" box). */
  dataQuality?: string[];
}

function renderSection(s: FinanceReportSection): string {
  const charts = (s.charts ?? []).map((c) => chartBlock({
    title: c.title,
    sub: c.sub,
    svg: renderFinanceChart(c.spec),
    legendHtml: financeChartLegend(c.spec),
  }));
  const chartsHtml = charts.length === 0 ? ''
    : charts.length === 1 ? charts[0]
    : `<div class="two-col">${charts.slice(0, 2).join('')}</div>`;
  const tablesHtml = (s.tables ?? []).map((t) => {
    const head = t.title ? `<h3 style="margin-top:8px">${esc(t.title)}</h3>` : '';
    const sub = t.sub ? `<p class="chart-sub">${esc(t.sub)}</p>` : '';
    return `${head}${sub}${dataTable(t.columns, t.rows)}`;
  }).join('');
  const note = s.note ? warningBox(s.note.title, s.note.items, s.note.tone ?? 'info') : '';
  return `<section class="section">${sectionTitle(s.title, s.sub)}${chartsHtml}${tablesHtml}${note}</section>`;
}

export function buildFinanceReportHtml(payload: FinanceReportPayload): string {
  const brand = payload.brandName ?? 'INSIGHT — Governança Corporativa';
  const fileName = buildReportFileName({ module: 'financeiro', context: payload.fileContext });
  const meta = buildReportMeta({
    brand,
    periodLabel: payload.periodLabel,
    filtersLabel: payload.filtersLabel ?? (payload.scenarioLabel ? `Cenário: ${payload.scenarioLabel}` : undefined),
    source: payload.source ?? 'demonstração',
    generatedBy: payload.generatedBy,
  });

  const cover = reportCover({
    meta,
    kicker: payload.kicker ?? 'Relatório Executivo · Financeiro',
    title: payload.title,
    context: payload.context,
  });

  const kpis = payload.kpis.length
    ? `<section class="section">${sectionTitle('Indicadores', payload.scenarioLabel ? `Cenário: ${payload.scenarioLabel}` : undefined)}${kpiGrid(payload.kpis)}</section>`
    : '';

  const sectionHtml = payload.sections.map(renderSection);
  const dq = `<section class="section">${sectionTitle('Qualidade dos Dados')}${dataQualityBox(payload.dataQuality ?? ((payload.source ?? 'demonstração') === 'demonstração' ? [`Relatório gerado a partir de dados de demonstração (${esc(payload.title)}).`] : []))}</section>`;

  // Page 1: cover + KPIs + first section. Remaining sections: 2 per page. Last: data quality.
  const pages: string[] = [];
  const firstSection = sectionHtml.length ? sectionHtml[0] : '';
  pages.push(`<section class="section">${cover}</section>${kpis}${firstSection}`);
  for (let i = 1; i < sectionHtml.length; i += 2) {
    pages.push(sectionHtml.slice(i, i + 2).join(''));
  }
  pages.push(dq);

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: payload.title,
    pages,
    orientation: 'landscape',
  });
}

export function openFinanceReport(payload: FinanceReportPayload): ReportExportResult {
  try {
    return openReport(buildFinanceReportHtml(payload), { width: 1280, height: 860 });
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : 'Falha ao gerar o relatório.' };
  }
}

/**
 * Map a HUD KpiItem-like ({label,value,format,variant,delta,suffix}) into a
 * report KPI card, formatting numeric values per the HUD `format` hint so the
 * PDF shows "R$ 1,2 mi" / "42%" instead of a raw number.
 */
export function kpiFromHud(
  item: { label?: unknown; value?: unknown; formattedValue?: unknown; format?: string; variant?: string; delta?: number; suffix?: string },
  color?: string,
): KpiCardSpec {
  const variantColor: Record<string, string | undefined> = {
    info: '#1D4ED8', success: '#047857', warning: '#B45309', danger: '#B91C1C', critical: '#B91C1C', neutral: '#64748B',
  };
  let value: string;
  if (item.formattedValue != null) {
    value = String(item.formattedValue);
  } else if (typeof item.value === 'number') {
    value = item.format === 'currency' ? BRL(item.value)
      : item.format === 'compactCurrency' ? compactBRL(item.value)
      : item.format === 'percent' ? `${item.value.toFixed(1)}%`
      : fmtInt(item.value);
  } else {
    value = String(item.value ?? '');
  }
  return {
    label: String(item.label ?? ''),
    value: `${value}${item.suffix ?? ''}`,
    color: color ?? variantColor[item.variant ?? 'neutral'],
    helper: typeof item.delta === 'number' ? `${item.delta >= 0 ? '+' : ''}${item.delta.toFixed(1)}%` : undefined,
  };
}
