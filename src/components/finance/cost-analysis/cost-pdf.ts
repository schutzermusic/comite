/**
 * Análise de Custos → print-ready HTML report (browser print → PDF).
 *
 * Built on the shared enterprise report engine (src/lib/reports), so it shares
 * the branded cover, light print theme, KPI grid, charts and tables with every
 * other module report. The report ALWAYS reflects the SAME active scope as the
 * on-screen table / CSV export (the caller passes already-filtered entries), so
 * the three exports never disagree. No financial rule lives here — only sums of
 * the values the selectors already produced.
 */

import type { LedgerEntry } from '@/lib/types/finance';
import {
  managementCategories,
  resolveCategoryPath,
  costCenters,
  suppliers as supplierRefs,
} from '@/data/finance/seed-categories';
import { projects as projectRefs, contracts as contractRefs } from '@/data/finance/reference';
import { BRL, esc, fmtInt } from '@/lib/reports/report-formatters';
import { CATEGORICAL } from '@/lib/reports/report-theme';
import { svgHorizontalBar } from '@/lib/reports/report-charts';
import { reportCover, sectionTitle, kpiGrid, chartBlock, dataTable, type KpiCardSpec } from '@/lib/reports/report-blocks';
import { renderReportDocument } from '@/lib/reports/report-shell';
import { openReport, buildReportMeta, buildReportFileName } from '@/lib/reports/report-export';
import type { ReportExportResult } from '@/lib/reports/report-types';

const catName = (id: string) => managementCategories.find((c) => c.id === id);
const projName = (id?: string) => projectRefs.find((p) => p.id === id)?.name ?? '';
const ccName = (id?: string) => costCenters.find((c) => c.id === id)?.name ?? '';
const supName = (id?: string) => supplierRefs.find((s) => s.id === id)?.name ?? '';
const ctrName = (id?: string) => {
  const c = contractRefs.find((x) => x.id === id);
  return c ? `${c.code} — ${c.client_name}` : '';
};

export interface CostReportKpi { label: string; value: string; helper?: string }
export interface CostReportRanking { title: string; rows: { label: string; value: number; share?: number }[] }

export interface CostReportPayload {
  title: string;
  scopeLabel: string;
  periodLabel: string;
  isDemo?: boolean;
  kpis: CostReportKpi[];
  rankings: CostReportRanking[];
  /** Same filtered/sorted entries shown in the table / exported to CSV. */
  entries: LedgerEntry[];
  brandName?: string;
  /** Cap the entries table to keep the PDF light. Default 250. */
  maxRows?: number;
}

export function buildCostReportHtml(payload: CostReportPayload): string {
  const brand = payload.brandName ?? 'INSIGHT — Governança Corporativa';
  const maxRows = payload.maxRows ?? 250;
  const total = payload.entries.reduce((s, e) => s + Math.abs(e.amount_cents) / 100, 0);
  const shown = payload.entries.slice(0, maxRows);
  const truncated = payload.entries.length - shown.length;
  const fileName = buildReportFileName({ module: 'financeiro', context: `custos-${payload.scopeLabel}` });

  const meta = buildReportMeta({
    brand,
    periodLabel: payload.periodLabel,
    filtersLabel: payload.scopeLabel,
    source: payload.isDemo ? 'demonstração' : 'Supabase',
  });

  const cover = reportCover({
    meta,
    kicker: 'Relatório Executivo · Financeiro',
    title: 'Análise de Custos',
    context: `<b>${esc(payload.scopeLabel)}</b><span class="sep">·</span>Realizado`,
  });

  const kpiCards: KpiCardSpec[] = payload.kpis.map((k, i) => ({
    label: k.label,
    value: k.value,
    helper: k.helper,
    color: CATEGORICAL[i % CATEGORICAL.length],
  }));
  const kpis = `${sectionTitle('Indicadores do recorte')}${kpiGrid(kpiCards)}`;

  const rankingBlocks = payload.rankings
    .filter((r) => r.rows.length > 0)
    .map((r) => chartBlock({
      title: r.title,
      svg: svgHorizontalBar(
        r.rows.slice(0, 8).map((row) => ({ label: row.label, value: row.value })),
        { width: 520, fmtValue: BRL },
      ),
    }))
    .join('');
  const rankingsSection = rankingBlocks
    ? `${sectionTitle('Rankings do recorte', 'principais categorias, projetos e fornecedores por valor')}<div class="two-col">${rankingBlocks}</div>`
    : '';

  const entryRows = shown.map((e) => {
    const cat = catName(e.category_id);
    const path = cat ? resolveCategoryPath(cat) : undefined;
    return {
      data: { html: `<span class="mono">${esc(e.entry_date)}</span>` },
      desc: e.description,
      categoria: path?.categoryName ?? '',
      sub: path?.subcategoryName ?? path?.categoryName ?? '',
      projeto: projName(e.project_id),
      contrato: ctrName(e.contract_id),
      cc: ccName(e.cost_center_id),
      fornecedor: supName(e.supplier_id),
      valor: { html: `<span class="mono">${esc(BRL(Math.abs(e.amount_cents) / 100))}</span>` },
    };
  });

  const entriesTable = dataTable(
    [
      { key: 'data', label: 'Data' },
      { key: 'desc', label: 'Descrição' },
      { key: 'categoria', label: 'Categoria' },
      { key: 'sub', label: 'Subcategoria' },
      { key: 'projeto', label: 'Projeto' },
      { key: 'contrato', label: 'Contrato' },
      { key: 'cc', label: 'Centro de Custo' },
      { key: 'fornecedor', label: 'Fornecedor' },
      { key: 'valor', label: 'Valor', num: true },
    ],
    entryRows,
  );

  const totalbar = `<p class="interp">Total do recorte: <b>${esc(BRL(total))}</b> · ${fmtInt(payload.entries.length)} lançamentos${truncated > 0 ? ` (exibindo ${fmtInt(shown.length)}; +${fmtInt(truncated)} no CSV)` : ''}</p>`;

  const page1 = `<section class="section">${cover}</section><section class="section">${kpis}</section>${rankingsSection ? `<section class="section">${rankingsSection}</section>` : ''}`;
  const page2 = `<section class="section">${sectionTitle('Lançamentos do recorte', 'detalhamento — mesma base do CSV')}${totalbar}${entriesTable}</section>`;

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: `Análise de Custos · ${payload.scopeLabel}`,
    pages: [page1, page2],
    orientation: 'landscape',
  });
}

export type CostExportResult = ReportExportResult;

/** Open the print-ready report in a new window (user prints / saves as PDF). */
export function openCostReport(payload: CostReportPayload): CostExportResult {
  try {
    return openReport(buildCostReportHtml(payload), { width: 1280, height: 860 });
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : 'Falha ao gerar o PDF.' };
  }
}
