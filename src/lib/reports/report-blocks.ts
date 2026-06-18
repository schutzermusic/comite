/**
 * Composable HTML building blocks for reports — the brief's ReportCover,
 * ReportSection, ReportKpiGrid/Card, ReportChartBlock, ReportTable,
 * ReportWarningBox, ReportSummaryBox and ReportDataQualityBox, as pure
 * string-returning functions styled by the shared shell CSS.
 */

import { esc } from './report-formatters';
import { C } from './report-theme';
import type { ReportMeta } from './report-types';

export function sectionTitle(title: string, subtitle?: string): string {
  return `<div class="sec-head"><div class="sec-rule"></div><div><h2>${esc(title)}</h2>${subtitle ? `<p class="sec-sub">${esc(subtitle)}</p>` : ''}</div></div>`;
}

export interface ReportCoverInput {
  meta: ReportMeta;
  /** Big report title (module-specific). */
  title: string;
  /** Kicker above the title (e.g. "Relatório Executivo · Riscos"). */
  kicker?: string;
  /** Entity / context line, rendered under the title (HTML-escaped). */
  context?: string;
  /** Optional status chip { label, color }. */
  statusChip?: { label: string; color: string };
}

/** Branded cover band: centered logo, title, context line, metadata + notes. */
export function reportCover(input: ReportCoverInput): string {
  const { meta, title, kicker, context, statusChip } = input;
  const generated = new Date(meta.generatedAt).toLocaleString('pt-BR');
  const confidentiality = meta.confidentiality ?? 'Confidencial — uso interno';

  const chip = statusChip
    ? `<span class="status-chip" style="border-color:${statusChip.color};color:${statusChip.color}">${esc(statusChip.label)}</span>`
    : '';

  const metaItems: string[] = [];
  if (meta.periodLabel) metaItems.push(`<span><b>Período:</b> ${esc(meta.periodLabel)}</span>`);
  if (meta.filtersLabel) metaItems.push(`<span><b>Filtros:</b> ${esc(meta.filtersLabel)}</span>`);
  metaItems.push(`<span><b>Gerado em:</b> ${esc(generated)}</span>`);
  if (meta.generatedBy) metaItems.push(`<span><b>Por:</b> ${esc(meta.generatedBy)}</span>`);
  if (meta.source) metaItems.push(`<span><b>Fonte:</b> ${esc(meta.source)}</span>`);

  return `
  <div class="cover-band">
    <img class="cover-logo" src="${esc(meta.logoUrl)}" alt="${esc(meta.brand)}" />
    ${kicker ? `<div class="cover-kicker">${esc(kicker)}</div>` : ''}
    <div class="cover-title">${esc(title)}</div>
    ${context ? `<div class="cover-proj">${context}${chip}</div>` : (chip ? `<div class="cover-proj">${chip}</div>` : '')}
    <div class="cover-meta">${metaItems.join('')}</div>
    <div class="cover-note">${esc(confidentiality)} · ${esc(meta.brand)}</div>
  </div>`;
}

export interface KpiCardSpec {
  label: string;
  value: string;
  color?: string;
  helper?: string;
  missing?: boolean;
  chip?: { label: string; cls: 'ok' | 'warn' | 'crit' | 'info' };
}

export function kpiCard(k: KpiCardSpec): string {
  const color = k.color ?? C.primary;
  const valColor = k.missing ? C.subtle : C.ink;
  const chip = k.chip ? `<span class="pill ${k.chip.cls}">${esc(k.chip.label)}</span>` : '';
  return `<div class="kpi"><span class="bar" style="background:${color}"></span>` +
    `<div class="kpi-l">${esc(k.label)}</div>` +
    `<div class="kpi-v" style="color:${valColor}">${esc(k.value)}</div>` +
    `<div class="kpi-foot"><span class="kpi-h">${esc(k.helper ?? '')}</span>${chip}</div>` +
    `</div>`;
}

/** KPI grid. cols defaults to a sensible value for the card count. */
export function kpiGrid(cards: KpiCardSpec[], cols?: 2 | 3 | 4 | 5): string {
  const c = cols ?? (cards.length % 5 === 0 ? 5 : cards.length % 4 === 0 ? 4 : cards.length <= 3 ? cards.length as 2 | 3 : 4);
  return `<div class="kpis cols-${c}">${cards.map(kpiCard).join('')}</div>`;
}

export interface ChartBlockInput {
  title?: string;
  sub?: string;
  /** Inline SVG markup. */
  svg: string;
  /** Optional legend HTML (use `legend()` from report-charts). */
  legendHtml?: string;
  /** Optional supporting table HTML below the chart. */
  table?: string;
}

export function chartBlock(input: ChartBlockInput): string {
  const head = input.title ? `<p class="chart-title">${esc(input.title)}</p>` : '';
  const sub = input.sub ? `<p class="chart-sub">${esc(input.sub)}</p>` : '';
  return `<div class="chart">${head}${sub}${input.svg}${input.legendHtml ?? ''}${input.table ?? ''}</div>`;
}

export interface TableColumn {
  key: string;
  label: string;
  /** Right-align numeric columns. */
  num?: boolean;
}

export type TableCell = string | { html: string };

/** Compact supporting/appendix table. Rows are keyed by column.key. */
export function dataTable(columns: TableColumn[], rows: Record<string, TableCell>[]): string {
  if (!rows.length) return `<p class="empty">Sem dados para exibir.</p>`;
  const thead = `<thead><tr>${columns
    .map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`)
    .join('')}</tr></thead>`;
  const body = rows
    .map((r) => `<tr>${columns
      .map((c) => {
        const cell = r[c.key];
        const content = cell == null ? '' : typeof cell === 'object' ? cell.html : esc(cell);
        return `<td class="${c.num ? 'num' : ''}">${content}</td>`;
      })
      .join('')}</tr>`)
    .join('');
  return `<table class="data">${thead}<tbody>${body}</tbody></table>`;
}

export type BoxTone = 'warn' | 'ok' | 'crit' | 'info';

/** Warning / alert box with a bulleted list. */
export function warningBox(title: string, items: string[], tone: BoxTone = 'warn'): string {
  const cls = tone === 'warn' ? '' : tone;
  const list = items.length
    ? `<ul class="warn-list">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
    : `<p class="warn-list" style="list-style:none;padding-left:0">Nenhum item.</p>`;
  return `<div class="warn-box ${cls}"><div class="warn-title">${esc(title)}</div>${list}</div>`;
}

/** Narrative executive-summary box (paragraphs). */
export function summaryBox(paragraphs: string[]): string {
  return `<div class="narrative">${paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}</div>`;
}

/**
 * Data-quality / "dados insuficientes" box. Pass the list of detected gaps;
 * an empty list renders a clean "no issues" confirmation instead of an empty
 * chart, per the brief's data rules.
 */
export function dataQualityBox(issues: string[]): string {
  if (!issues.length) {
    return warningBox('Qualidade dos dados', ['Sem inconsistências detectadas neste recorte.'], 'ok');
  }
  return warningBox('Qualidade dos dados / atenção', issues, 'warn');
}
