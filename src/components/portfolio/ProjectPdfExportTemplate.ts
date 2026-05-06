/**
 * ProjectPdfExportTemplate
 *
 * Renders an HTML report (in a new window) suitable for print → PDF.
 *
 * Modes:
 *   - 'executive' : compact 1–2 page summary for board / directors (Top 10 + KPIs)
 *   - 'full'      : full portfolio report with all filtered projects
 *
 * Architecture (kept stable so we can migrate the renderer later without
 * rewriting the data layer):
 *
 *   buildReportModel(payload) → ReportModel    (pure data — no DOM)
 *   renderReportToHtml(model)  → string         (current renderer — window.print)
 *   renderReportToPdfDoc(model) → jsPDF | ReactPDF.Document   (future)
 *
 * Today only `renderReportToHtml` exists. When migrating to @react-pdf/renderer
 * or jsPDF + jspdf-autotable, build a new renderer that consumes the same
 * `ReportModel` — the page (`exportToPdf`) won't need to change.
 */

import type { Project } from '@/lib/types';
import type { ProjectV2 } from '@/lib/types/project-v2';

export type PdfExportMode = 'executive' | 'full';

export interface ProjectPdfFilters {
  search?: string;
  status?: string;
  client?: string;
  health?: string;
  impact?: string;
  committee?: string;
}

export interface ProjectPdfPayload {
  projects: Project[];
  v2Map: Map<string, ProjectV2>;
  filters?: ProjectPdfFilters;
  mode?: PdfExportMode;
  brandName?: string;
  generatedBy?: string;
}

/**
 * Renderer-agnostic report model. This is the contract any future renderer
 * (jsPDF, @react-pdf/renderer, server-side puppeteer) must consume.
 */
export interface ReportRow {
  id: string;
  codigo: string;
  nome: string;
  cliente: string;
  status: string;
  statusLabel: string;
  health: number;
  healthColor: string;
  progress: number;
  valor: number;
  valorFormatted: string;
  impacto: string;
  impactoLabel: string;
  openHighRisks: number;
  comite: string;
  responsavel: string;
  initials: string;
}

export interface ReportKpis {
  total: number;
  inProgress: number;
  completed: number;
  totalValue: number;
  critical: number;
  avgHealth: number;
  avgProgress: number;
  openRisks: number;
  delayed: number;
}

export interface ReportModel {
  title: string;
  brandName: string;
  generatedAt: string;
  generatedBy?: string;
  mode: PdfExportMode;
  filters?: ProjectPdfFilters;
  kpis: ReportKpis;
  rows: ReportRow[];           // executive: top 10 by value; full: all rows
  totalProjectsInScope: number;
}

const STATUS_LABEL: Record<string, string> = {
  em_andamento: 'Em Andamento',
  concluido: 'Concluído',
  pausado: 'Pausado',
  cancelado: 'Cancelado',
  planejamento: 'Planejamento',
};

const IMPACT_LABEL: Record<string, string> = {
  baixo: 'Baixo',
  medio: 'Médio',
  alto: 'Alto',
  critico: 'Crítico',
};

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n || 0);
}

function compactBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n || 0);
}

function healthColor(score: number): string {
  if (score >= 80) return '#10B981';
  if (score >= 60) return '#22D3EE';
  if (score >= 40) return '#F59E0B';
  return '#EF4444';
}

function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function buildKpis(projects: Project[], v2Map: Map<string, ProjectV2>) {
  const total = projects.length;
  const inProgress = projects.filter((p) => p.status === 'em_andamento').length;
  const completed = projects.filter((p) => p.status === 'concluido').length;
  const totalValue = projects.reduce((s, p) => s + (p.valor_total || 0), 0);
  const critical = projects.filter(
    (p) => p.impacto_financeiro === 'critico' || p.impacto_financeiro === 'alto',
  ).length;

  const v2s = projects.map((p) => v2Map.get(p.id)).filter(Boolean) as ProjectV2[];
  const avgHealth = v2s.length
    ? Math.round(v2s.reduce((s, p) => s + (p.health_score || 0), 0) / v2s.length)
    : 100;
  const avgProgress = total
    ? Math.round(projects.reduce((s, p) => s + (p.progresso_percentual || 0), 0) / total)
    : 0;
  const openRisks = v2s.reduce(
    (s, p) =>
      s +
      (p.risks || []).filter(
        (r) => r.status !== 'resolved' && (r.severity === 'high' || r.severity === 'critical'),
      ).length,
    0,
  );
  const now = new Date().toISOString();
  const delayed = v2s.reduce(
    (s, p) => s + (p.tasks || []).filter((t) => t.status !== 'completed' && t.endDate < now).length,
    0,
  );

  return { total, inProgress, completed, totalValue, critical, avgHealth, avgProgress, openRisks, delayed };
}

function renderKpis(k: ReturnType<typeof buildKpis>): string {
  const cell = (label: string, value: string | number, color = '#0F172A') => `
    <div class="kpi">
      <div class="kpi-label">${escapeHtml(label)}</div>
      <div class="kpi-value" style="color:${color}">${escapeHtml(value)}</div>
    </div>`;
  return `
    <section class="kpi-grid">
      ${cell('Total Projects', k.total, '#0F172A')}
      ${cell('In Progress', k.inProgress, '#10B981')}
      ${cell('Portfolio Value', compactBRL(k.totalValue), '#16A34A')}
      ${cell('Critical', k.critical, k.critical > 0 ? '#EF4444' : '#0F172A')}
      ${cell('Avg Health', `${k.avgHealth}%`, healthColor(k.avgHealth))}
      ${cell('Open Risks', k.openRisks, k.openRisks > 0 ? '#EF4444' : '#0F172A')}
      ${cell('Avg Progress', `${k.avgProgress}%`, '#22D3EE')}
      ${cell('Delayed Tasks', k.delayed, k.delayed > 0 ? '#F59E0B' : '#0F172A')}
    </section>`;
}

function renderFilters(filters?: ProjectPdfFilters): string {
  if (!filters) return '';
  const items = Object.entries(filters)
    .filter(([, v]) => v && v !== 'all')
    .map(([k, v]) => `<span class="chip">${escapeHtml(k)}: ${escapeHtml(v)}</span>`);
  if (!items.length) return '';
  return `<div class="filters"><span class="filters-label">Filtros aplicados:</span>${items.join('')}</div>`;
}

function buildRow(p: Project, v2: ProjectV2 | undefined): ReportRow {
  const health = v2?.health_score ?? 100;
  const openHighRisks = (v2?.risks || []).filter(
    (r) => r.status !== 'resolved' && (r.severity === 'high' || r.severity === 'critical'),
  ).length;
  const progress = Math.max(0, Math.min(100, p.progresso_percentual || 0));
  return {
    id: p.id,
    codigo: p.codigo || '',
    nome: p.nome,
    cliente: p.cliente || '—',
    status: p.status,
    statusLabel: STATUS_LABEL[p.status] || p.status,
    health,
    healthColor: healthColor(health),
    progress,
    valor: p.valor_total || 0,
    valorFormatted: formatBRL(p.valor_total || 0),
    impacto: p.impacto_financeiro,
    impactoLabel: IMPACT_LABEL[p.impacto_financeiro] || p.impacto_financeiro,
    openHighRisks,
    comite: p.comite_nome || '—',
    responsavel: p.responsavel?.nome || '—',
    initials: initialsFor(p.cliente || 'C'),
  };
}

function renderRow(r: ReportRow): string {
  return `
    <tr>
      <td>
        <div class="proj-cell">
          <span class="logo">${escapeHtml(r.initials)}</span>
          <div>
            <div class="proj-name">${escapeHtml(r.nome)}</div>
            <div class="proj-sub">${escapeHtml(r.codigo)} · ${escapeHtml(r.cliente)}</div>
          </div>
        </div>
      </td>
      <td>${escapeHtml(r.statusLabel)}</td>
      <td><span class="dot" style="background:${r.healthColor}"></span><b style="color:${r.healthColor}">${r.health}</b></td>
      <td>
        <div class="bar"><span style="width:${r.progress}%;background:${r.healthColor}"></span></div>
        <div class="bar-label">${r.progress}%</div>
      </td>
      <td class="num">${escapeHtml(r.valorFormatted)}</td>
      <td>${escapeHtml(r.impactoLabel)}</td>
      <td class="num">${r.openHighRisks > 0 ? `<b style="color:#EF4444">${r.openHighRisks}</b>` : '—'}</td>
      <td>${escapeHtml(r.comite)}</td>
    </tr>`;
}

function renderTable(rows: ReportRow[], heading: string): string {
  return `
    <section class="section section-table">
      <h2>${escapeHtml(heading)}</h2>
      <table class="proj-table">
        <thead><tr>
          <th>Projeto</th><th>Status</th><th>Health</th><th>Progresso</th>
          <th class="num">Valor</th><th>Impacto</th><th class="num">Riscos</th><th>Comitê</th>
        </tr></thead>
        <tbody>${rows.map(renderRow).join('')}</tbody>
      </table>
    </section>`;
}

export function buildReportModel(payload: ProjectPdfPayload): ReportModel {
  const {
    projects,
    v2Map,
    filters,
    mode = 'executive',
    brandName = 'INSIGHT — Governança Corporativa',
    generatedBy,
  } = payload;

  const kpis = buildKpis(projects, v2Map);
  const allRows = projects.map((p) => buildRow(p, v2Map.get(p.id)));
  const rows =
    mode === 'executive'
      ? [...allRows].sort((a, b) => b.valor - a.valor).slice(0, 10)
      : allRows;

  return {
    title:
      mode === 'executive' ? 'Relatório Executivo de Portfólio' : 'Relatório Completo de Portfólio',
    brandName,
    generatedAt: new Date().toLocaleString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
    generatedBy,
    mode,
    filters,
    kpis,
    rows,
    totalProjectsInScope: projects.length,
  };
}

export function buildProjectPortfolioReport(payload: ProjectPdfPayload): string {
  const model = buildReportModel(payload);
  return renderReportToHtml(model);
}

export function renderReportToHtml(model: ReportModel): string {
  const { title, brandName, generatedAt, generatedBy, mode, filters, kpis, rows, totalProjectsInScope } = model;
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)} — ${escapeHtml(brandName)}</title>
<style>
  /* Page setup — running header + footer via @page margins */
  @page {
    size: A4;
    margin: 22mm 14mm 22mm;
  }
  @page :first { margin-top: 18mm; }

  * { box-sizing: border-box; }
  html, body {
    padding: 0; margin: 0; background: #fff; color: #0F172A;
    font: 12px/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  /* Running header strip — repeats on every printed page */
  .running-header {
    position: fixed; top: -16mm; left: 0; right: 0;
    display: flex; justify-content: space-between; align-items: center;
    padding: 0 0 4px;
    border-bottom: 1px solid #E2E8F0;
    font-size: 9px; color: #64748B; letter-spacing: 0.08em; text-transform: uppercase;
  }
  .running-header .brand-mini { color: #16A34A; font-weight: 700; }

  /* Running footer strip — repeats on every printed page with page numbers */
  .running-footer {
    position: fixed; bottom: -16mm; left: 0; right: 0;
    display: flex; justify-content: space-between; align-items: center;
    padding: 4px 0 0;
    border-top: 1px solid #E2E8F0;
    font-size: 9px; color: #94A3B8;
  }
  .page-num::before { content: counter(page); }
  .page-total::before { content: counter(pages); }

  /* Document header (only on first page) */
  header.report {
    display: flex; align-items: flex-end; justify-content: space-between; gap: 16px;
    border-bottom: 2px solid #0F172A; padding-bottom: 14px; margin-bottom: 18px;
  }
  .brand { font-weight: 700; letter-spacing: 0.04em; color: #0F172A; }
  .brand small {
    display: block; font-weight: 600; color: #16A34A;
    letter-spacing: .16em; font-size: 9px; text-transform: uppercase; margin-bottom: 4px;
  }
  .brand .mode {
    display: inline-block; margin-top: 8px; padding: 3px 10px; border-radius: 999px;
    background: #ECFDF5; color: #166534; font-size: 10px; font-weight: 600; letter-spacing: 0.04em;
    border: 1px solid #BBF7D0;
  }
  .meta { text-align: right; font-size: 10px; color: #475569; line-height: 1.55; }
  .meta b { color: #0F172A; }
  h1 { margin: 0 0 4px 0; font-size: 22px; color: #0F172A; line-height: 1.2; }
  h2 {
    font-size: 13px; margin: 0 0 10px 0; color: #0F172A;
    text-transform: uppercase; letter-spacing: 0.12em;
    padding-bottom: 6px; border-bottom: 1px solid #E2E8F0;
  }

  .filters {
    display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 18px; font-size: 10px;
    align-items: center;
  }
  .filters-label { color: #64748B; margin-right: 4px; text-transform: uppercase; letter-spacing: 0.1em; font-size: 9px; }
  .chip { background: #F1F5F9; border: 1px solid #E2E8F0; color: #334155; padding: 2px 9px; border-radius: 999px; }

  .section { margin: 0 0 18px; }
  .section-table { page-break-before: auto; }

  .kpi-grid {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
    margin: 0 0 4px;
  }
  .kpi {
    border: 1px solid #E2E8F0; border-radius: 10px; padding: 10px 12px;
    background: #F8FAFC; page-break-inside: avoid;
  }
  .kpi-label { font-size: 9px; text-transform: uppercase; letter-spacing: .14em; color: #64748B; }
  .kpi-value { font-size: 18px; font-weight: 700; margin-top: 6px; }

  table.proj-table {
    width: 100%; border-collapse: collapse; font-size: 10.5px;
    table-layout: auto;
  }
  table.proj-table th, table.proj-table td {
    padding: 8px 10px; border-bottom: 1px solid #E2E8F0; vertical-align: middle; text-align: left;
  }
  table.proj-table thead {
    /* Repeat the header row on every printed page */
    display: table-header-group;
  }
  table.proj-table thead th {
    background: #F8FAFC;
    font-size: 9px; text-transform: uppercase; letter-spacing: .12em; color: #475569;
    border-bottom: 2px solid #CBD5E1;
  }
  table.proj-table tbody tr { page-break-inside: avoid; break-inside: avoid; }
  table.proj-table tbody tr:nth-child(even) { background: #FAFBFC; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }

  .proj-cell { display: flex; gap: 8px; align-items: center; }
  .proj-name { font-weight: 600; color: #0F172A; }
  .proj-sub { font-size: 9.5px; color: #64748B; margin-top: 1px; }
  .logo {
    display: inline-flex; align-items: center; justify-content: center;
    width: 26px; height: 26px; border-radius: 7px; flex-shrink: 0;
    background: linear-gradient(135deg, #16A34A, #0F766E);
    color: #fff; font-weight: 700; font-size: 9.5px; letter-spacing: 0.04em;
  }

  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 99px; margin-right: 5px; vertical-align: middle; }
  .bar { width: 92px; height: 6px; background: #E2E8F0; border-radius: 99px; overflow: hidden; }
  .bar > span { display: block; height: 100%; border-radius: 99px; }
  .bar-label { font-size: 9.5px; color: #475569; margin-top: 2px; font-variant-numeric: tabular-nums; }

  /* Toolbar — only visible on screen, hidden when printing */
  .toolbar {
    position: fixed; top: 12px; right: 12px; z-index: 10;
    background: #0F172A; color: #fff; padding: 8px 12px; border-radius: 10px; display: flex; gap: 8px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18); font-size: 11px;
  }
  .toolbar button {
    background: #16A34A; color: #fff; border: 0; border-radius: 6px; padding: 6px 12px;
    font-weight: 600; cursor: pointer; font-size: 11px;
  }
  .toolbar button.alt { background: transparent; border: 1px solid rgba(255, 255, 255, 0.25); }

  @media print {
    .no-print { display: none !important; }
    .running-header, .running-footer { display: flex; }
  }
  @media screen {
    .running-header, .running-footer { display: none; }
  }
</style>
</head>
<body>
  <div class="toolbar no-print">
    <button onclick="window.print()">Imprimir / Salvar PDF</button>
    <button class="alt" onclick="window.close()">Fechar</button>
  </div>

  <div class="running-header">
    <span><span class="brand-mini">${escapeHtml(brandName)}</span> · ${escapeHtml(title)}</span>
    <span>${escapeHtml(generatedAt)}</span>
  </div>
  <div class="running-footer">
    <span>Confidencial — uso interno do Conselho / Diretoria</span>
    <span>Página <span class="page-num"></span> de <span class="page-total"></span></span>
  </div>

  <header class="report">
    <div class="brand">
      <small>${escapeHtml(brandName)}</small>
      <h1>${escapeHtml(title)}</h1>
      <span class="mode">${escapeHtml(mode === 'executive' ? 'Sumário Executivo' : 'Portfólio Completo')}</span>
    </div>
    <div class="meta">
      <div><b>Gerado em</b> ${escapeHtml(generatedAt)}</div>
      ${generatedBy ? `<div><b>Por</b> ${escapeHtml(generatedBy)}</div>` : ''}
      <div><b>${escapeHtml(totalProjectsInScope)}</b> projetos no escopo</div>
      <div><b>${escapeHtml(rows.length)}</b> exibidos no relatório</div>
    </div>
  </header>

  ${renderFilters(filters)}

  <section class="section">
    <h2>KPIs Executivos</h2>
    ${renderKpis(kpis)}
  </section>

  ${renderTable(rows, mode === 'executive' ? 'Top 10 Projetos por Valor' : `Portfólio Completo (${rows.length} projetos)`)}
</body>
</html>`;
}

export type PdfExportResult =
  | { ok: true }
  | { ok: false; reason: 'popup_blocked' | 'empty' | 'error'; message: string };

export function openProjectPortfolioReport(payload: ProjectPdfPayload): PdfExportResult {
  if (!payload.projects || payload.projects.length === 0) {
    return { ok: false, reason: 'empty', message: 'Nenhum projeto no escopo para exportar.' };
  }
  try {
    const html = buildProjectPortfolioReport(payload);
    const w = window.open('', '_blank', 'width=1024,height=768');
    if (!w) {
      return {
        ok: false,
        reason: 'popup_blocked',
        message: 'O navegador bloqueou a janela de impressão. Habilite pop-ups para este site.',
      };
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      message: err instanceof Error ? err.message : 'Falha desconhecida ao gerar o relatório.',
    };
  }
}
