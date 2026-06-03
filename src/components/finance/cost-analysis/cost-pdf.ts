/**
 * Análise de Custos → print-ready HTML report (browser print → PDF).
 *
 * Mirrors the workforce/portfolio export pattern: a pure `buildCostReportHtml`
 * renderer plus `openCostReport` that opens the print window. The report ALWAYS
 * reflects the SAME active scope as the on-screen table / CSV export (the caller
 * passes the already-filtered entries), so the three exports never disagree.
 *
 * It performs no aggregation of its own beyond simple sums of the values the
 * selectors already produced — no financial rule lives here.
 */

import type { LedgerEntry } from '@/lib/types/finance';
import {
  managementCategories,
  resolveCategoryPath,
  costCenters,
  suppliers as supplierRefs,
} from '@/data/finance/seed-categories';
import { projects as projectRefs, contracts as contractRefs } from '@/data/finance/reference';

const BRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

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
  const generated = new Date().toLocaleString('pt-BR');
  const maxRows = payload.maxRows ?? 250;
  const total = payload.entries.reduce((s, e) => s + Math.abs(e.amount_cents) / 100, 0);
  const shown = payload.entries.slice(0, maxRows);
  const truncated = payload.entries.length - shown.length;

  const kpiCards = payload.kpis.map((k) => `
    <div class="kpi">
      <div class="kpi-l">${esc(k.label)}</div>
      <div class="kpi-v">${esc(k.value)}</div>
      ${k.helper ? `<div class="kpi-h">${esc(k.helper)}</div>` : ''}
    </div>`).join('');

  const rankingBlocks = payload.rankings.filter((r) => r.rows.length > 0).map((r) => `
    <div class="rank">
      <h3>${esc(r.title)}</h3>
      <table class="mini">
        <tbody>
          ${r.rows.slice(0, 10).map((row) => `
            <tr>
              <td>${esc(row.label)}</td>
              <td class="num">${esc(BRL(row.value))}</td>
              <td class="num muted">${row.share !== undefined ? `${(row.share * 100).toFixed(1)}%` : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`).join('');

  const entryRows = shown.map((e) => {
    const cat = catName(e.category_id);
    const path = cat ? resolveCategoryPath(cat) : undefined;
    return `
      <tr>
        <td class="mono">${esc(e.entry_date)}</td>
        <td>${esc(e.description)}</td>
        <td>${esc(path?.categoryName ?? '')}</td>
        <td>${esc(path?.subcategoryName ?? path?.categoryName ?? '')}</td>
        <td>${esc(projName(e.project_id))}</td>
        <td>${esc(ctrName(e.contract_id))}</td>
        <td>${esc(ccName(e.cost_center_id))}</td>
        <td>${esc(supName(e.supplier_id))}</td>
        <td class="num mono">${esc(BRL(Math.abs(e.amount_cents) / 100))}</td>
      </tr>`;
  }).join('');

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" />
<title>${esc(payload.title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 28px; }
  header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #0891b2; padding-bottom:10px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  h2 { font-size: 14px; margin: 22px 0 8px; color:#0e7490; }
  h3 { font-size: 12px; margin: 0 0 6px; color:#334155; }
  .sub { color:#64748b; font-size: 11px; }
  .badge { display:inline-block; background:#fef3c7; color:#92400e; border:1px solid #f59e0b; border-radius:999px; padding:2px 8px; font-size:10px; font-weight:600; }
  .kpis { display:grid; grid-template-columns: repeat(3, 1fr); gap:10px; margin-top:14px; }
  .kpi { border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; }
  .kpi-l { font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:#64748b; }
  .kpi-v { font-size:16px; font-weight:700; margin-top:2px; }
  .kpi-h { font-size:10px; color:#94a3b8; margin-top:2px; }
  .ranks { display:grid; grid-template-columns: repeat(2, 1fr); gap:16px; }
  table { width:100%; border-collapse:collapse; }
  table.mini td { padding:3px 0; border-bottom:1px solid #f1f5f9; font-size:11px; }
  table.entries { font-size:10.5px; margin-top:8px; }
  table.entries th { text-align:left; background:#f8fafc; border-bottom:1px solid #cbd5e1; padding:5px 6px; font-size:10px; text-transform:uppercase; letter-spacing:.06em; color:#475569; }
  table.entries td { padding:4px 6px; border-bottom:1px solid #f1f5f9; }
  .num { text-align:right; } .mono { font-variant-numeric: tabular-nums; font-family: ui-monospace, Menlo, monospace; }
  .muted { color:#94a3b8; }
  .totalbar { margin-top:10px; font-size:12px; } .totalbar b { font-size:14px; }
  .bar { margin-top:22px; }
  button { background:#0891b2; color:#fff; border:0; border-radius:6px; padding:8px 14px; font-size:13px; cursor:pointer; }
  @media print { .bar { display:none; } body { margin:0; } }
</style></head>
<body>
  <header>
    <div>
      <h1>Análise de Custos — ${esc(payload.scopeLabel)}</h1>
      <div class="sub">${esc(brand)} · Realizado · ${esc(payload.periodLabel)}</div>
    </div>
    <div style="text-align:right">
      <div class="sub">Gerado em ${esc(generated)}</div>
      ${payload.isDemo ? '<div style="margin-top:4px"><span class="badge">dados demonstrativos</span></div>' : ''}
    </div>
  </header>

  <div class="kpis">${kpiCards}</div>

  ${rankingBlocks ? `<h2>Rankings do recorte</h2><div class="ranks">${rankingBlocks}</div>` : ''}

  <h2>Lançamentos do recorte</h2>
  <div class="totalbar">Total do recorte: <b>${esc(BRL(total))}</b> · ${payload.entries.length} lançamentos${truncated > 0 ? ` (exibindo ${shown.length}; +${truncated} no CSV)` : ''}</div>
  <table class="entries">
    <thead><tr>
      <th>Data</th><th>Descrição</th><th>Categoria</th><th>Subcategoria</th>
      <th>Projeto</th><th>Contrato</th><th>Centro de Custo</th><th>Fornecedor</th><th class="num">Valor</th>
    </tr></thead>
    <tbody>${entryRows || '<tr><td colspan="9" class="muted">Sem lançamentos no recorte.</td></tr>'}</tbody>
  </table>

  <div class="bar"><button onclick="window.print()">Imprimir / Salvar PDF</button></div>
</body></html>`;
}

export type CostExportResult = { ok: true } | { ok: false; message: string };

/** Open the print-ready report in a new window (user prints / saves as PDF). */
export function openCostReport(payload: CostReportPayload): CostExportResult {
  try {
    const w = window.open('', '_blank', 'width=1024,height=768');
    if (!w) return { ok: false, message: 'O navegador bloqueou a janela. Habilite pop-ups para este site.' };
    w.document.open();
    w.document.write(buildCostReportHtml(payload));
    w.document.close();
    w.focus();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Falha ao gerar o PDF.' };
  }
}
