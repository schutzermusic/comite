/**
 * ProjectPdfExportTemplate
 *
 * Renders the Projetos portfolio report (executive top-10 or full list) on the
 * SHARED report engine (src/lib/reports): branded cover, premium light print
 * theme, 2.5D charts, insight cards and accurate "Página X de Y" via
 * composePages — replacing the old standalone HTML template whose CSS
 * `counter(pages)` printed "de 0" in Chromium.
 *
 * Architecture (kept stable):
 *   buildReportModel(payload) → ReportModel   (pure data — no DOM)
 *   renderReportToHtml(model) → string        (shared-engine renderer)
 */

import type { Project } from '@/lib/types';
import type { ProjectV2 } from '@/lib/types/project-v2';
import { compactBRL, esc, fmtInt } from '@/lib/reports/report-formatters';
import { C, REPORT_BRAND_NAME } from '@/lib/reports/report-theme';
import { svgDonut, svgHorizontalBar, svgGauge } from '@/lib/reports/report-charts';
import {
  reportCover, sectionTitle, kpiGrid, chartBlock, dataTableChunked, type KpiCardSpec,
} from '@/lib/reports/report-blocks';
import {
  composePages, block, mmForChart, mmForColumns, mmForCover, mmForKpiGrid,
  mmForSectionTitle, type ReportBlock,
} from '@/lib/reports/report-compose';
import { insightPanel, mmForInsightPanel, type InsightItem } from '@/lib/reports/report-insights';
import { renderReportDocument } from '@/lib/reports/report-shell';
import { openReport, buildReportMeta, buildReportFileName } from '@/lib/reports/report-export';

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

function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n || 0);
}

function healthColor(score: number): string {
  if (score >= 80) return C.success;
  if (score >= 60) return C.info;
  if (score >= 40) return C.warning;
  return C.critical;
}

function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function buildKpis(projects: Project[], v2Map: Map<string, ProjectV2>): ReportKpis {
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

export function buildReportModel(payload: ProjectPdfPayload): ReportModel {
  const {
    projects,
    v2Map,
    filters,
    mode = 'executive',
    brandName = REPORT_BRAND_NAME,
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

const FILTER_LABEL: Record<keyof ProjectPdfFilters, string> = {
  search: 'busca',
  status: 'status',
  client: 'cliente',
  health: 'health',
  impact: 'impacto',
  committee: 'comitê',
};

export function renderReportToHtml(model: ReportModel): string {
  const { title, brandName, generatedBy, mode, filters, kpis, rows, totalProjectsInScope } = model;
  const fileName = buildReportFileName({ module: 'projetos', context: mode === 'executive' ? 'executivo' : 'completo' });
  const activeFilters = Object.entries(filters ?? {})
    .filter(([, v]) => v && v !== 'all')
    .map(([k, v]) => `${FILTER_LABEL[k as keyof ProjectPdfFilters] ?? k}: ${v}`);
  const meta = buildReportMeta({
    brand: brandName,
    filtersLabel: activeFilters.length ? activeFilters.join(' · ') : undefined,
    generatedBy,
  });
  const blocks: ReportBlock[] = [];

  /* ── 01 · Visão do Portfólio ── */

  blocks.push(block(reportCover({
    meta,
    kicker: 'Relatório Executivo · Projetos',
    title,
    context: `<b>${fmtInt(totalProjectsInScope)}</b> projetos no escopo<span class="sep">·</span>valor total <b>${esc(compactBRL(kpis.totalValue))}</b>`,
    statusChip: { label: mode === 'executive' ? 'Sumário Executivo' : 'Portfólio Completo', color: C.brandGreen },
    coverKpis: [
      { label: 'Projetos', value: fmtInt(kpis.total) },
      { label: 'Valor do portfólio', value: compactBRL(kpis.totalValue) },
      { label: 'Health médio', value: `${kpis.avgHealth}%` },
      { label: 'Críticos', value: fmtInt(kpis.critical) },
    ],
  }), mmForCover(true)));

  const kpiCards: KpiCardSpec[] = [
    { label: 'Total de projetos', value: fmtInt(kpis.total), color: C.primary },
    { label: 'Em andamento', value: fmtInt(kpis.inProgress), color: C.success, helper: `${fmtInt(kpis.completed)} concluídos` },
    { label: 'Valor do portfólio', value: compactBRL(kpis.totalValue), color: C.info },
    { label: 'Impacto alto/crítico', value: fmtInt(kpis.critical), color: kpis.critical ? C.critical : C.success },
    { label: 'Health médio', value: `${kpis.avgHealth}%`, color: healthColor(kpis.avgHealth) },
    { label: 'Riscos abertos', value: fmtInt(kpis.openRisks), color: kpis.openRisks ? C.critical : C.success, helper: 'altos/críticos' },
    { label: 'Progresso médio', value: `${kpis.avgProgress}%`, color: C.info },
    { label: 'Tarefas atrasadas', value: fmtInt(kpis.delayed), color: kpis.delayed ? C.warning : C.success },
  ];
  blocks.push(block(sectionTitle('Visão do Portfólio', undefined, 1), mmForSectionTitle(), { keepWithNext: true }));
  blocks.push(block(kpiGrid(kpiCards, 4), mmForKpiGrid(8, 4)));

  const healthGauge = chartBlock({
    title: 'Health Médio do Portfólio',
    sub: `${fmtInt(kpis.inProgress)} projetos em andamento`,
    svg: svgGauge(kpis.avgHealth, {
      width: 490,
      height: 124,
      label: 'Health',
      color: healthColor(kpis.avgHealth),
      bands: [[0, 40, C.critical], [40, 70, C.warning], [70, 100, C.success]],
    }),
  });
  const other = Math.max(0, kpis.total - kpis.inProgress - kpis.completed);
  const statusDonut = chartBlock({
    title: 'Projetos por Status',
    svg: svgDonut(
      [
        { label: 'Em andamento', value: kpis.inProgress, color: C.info },
        { label: 'Concluídos', value: kpis.completed, color: C.success },
        { label: 'Outros', value: other, color: C.subtle },
      ],
      { width: 490, height: 124, centerLabel: fmtInt(kpis.total), fmtValue: fmtInt },
    ),
  });
  blocks.push(block(
    `<div class="two-col">${healthGauge}${statusDonut}</div>`,
    mmForColumns(
      mmForChart(124, { svgWidthPx: 490, cols: 2, title: true }),
      mmForChart(124, { svgWidthPx: 490, cols: 2, title: true }),
    ),
  ));

  /* ── 02 · Maiores Projetos ── */

  const topByValue = [...rows].sort((a, b) => b.valor - a.valor).slice(0, 8);
  if (topByValue.length) {
    blocks.push(block(sectionTitle('Concentração de Valor', 'maiores projetos do recorte', 2), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));
    blocks.push(block(chartBlock({
      title: 'Top Projetos por Valor',
      svg: svgHorizontalBar(
        topByValue.map((r) => ({ label: `${r.codigo || r.nome}`, value: r.valor, color: r.healthColor })),
        { width: 1000, fmtValue: compactBRL, labelW: 190 },
      ),
    }), mmForChart(topByValue.length * 26 + 8, { svgWidthPx: 1000, title: true })));
  }

  /* ── Insights ── */

  const insights: InsightItem[] = [];
  if (topByValue[0] && kpis.totalValue > 0) {
    const share = Math.round((topByValue[0].valor / kpis.totalValue) * 100);
    insights.push({ kind: 'fact', title: 'Concentração do portfólio', detail: `${topByValue[0].nome} responde por ${share}% do valor do recorte (${compactBRL(topByValue[0].valor)}).`, value: `${share}%` });
  }
  if (kpis.openRisks) insights.push({ kind: 'alert', title: 'Riscos altos/críticos abertos', detail: `${fmtInt(kpis.openRisks)} risco(s) de severidade alta ou crítica sem resolução no portfólio.`, value: fmtInt(kpis.openRisks) });
  if (kpis.delayed) insights.push({ kind: 'alert', title: 'Tarefas atrasadas', detail: `${fmtInt(kpis.delayed)} tarefa(s) além do prazo nos projetos do recorte.`, value: fmtInt(kpis.delayed) });
  if (kpis.avgHealth < 60) insights.push({ kind: 'recommendation', title: 'Revisar projetos de baixa saúde', detail: `Health médio de ${kpis.avgHealth}% — priorizar planos de recuperação nos projetos abaixo de 60.` });
  if (insights.length) blocks.push(block(insightPanel(insights.slice(0, 4), { cols: 2 }), mmForInsightPanel(Math.min(insights.length, 4), 2)));

  /* ── 03 · Tabela do portfólio ── */

  blocks.push(block(sectionTitle(
    mode === 'executive' ? 'Top 10 Projetos por Valor' : `Portfólio Completo (${fmtInt(rows.length)} projetos)`,
    mode === 'executive' && totalProjectsInScope > rows.length ? `${fmtInt(totalProjectsInScope)} projetos no escopo — exibindo os 10 maiores` : undefined,
    3,
  ), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));

  blocks.push(...dataTableChunked(
    [
      { key: 'proj', label: 'Projeto' },
      { key: 'status', label: 'Status' },
      { key: 'health', label: 'Health', num: true },
      { key: 'prog', label: 'Progresso' },
      { key: 'valor', label: 'Valor', num: true },
      { key: 'impacto', label: 'Impacto' },
      { key: 'riscos', label: 'Riscos', num: true },
      { key: 'comite', label: 'Comitê' },
    ],
    rows.map((r) => ({
      proj: { html: `<div><span style="font-weight:600;color:${C.ink}">${esc(r.nome)}</span><br/><span style="font-size:8.5px;color:${C.subtle}">${esc(r.codigo)} · ${esc(r.cliente)}</span></div>` },
      status: r.statusLabel,
      health: { html: `<span class="mono" style="color:${r.healthColor};font-weight:700">${r.health}</span>` },
      prog: { html: `<div style="width:92px;height:6px;background:${C.grid};border-radius:99px;overflow:hidden"><span style="display:block;height:100%;width:${r.progress}%;background:${r.healthColor};border-radius:99px"></span></div><span style="font-size:8.5px;color:${C.subtle}" class="mono">${r.progress}%</span>` },
      valor: { html: `<span class="mono">${esc(r.valorFormatted)}</span>` },
      impacto: { html: `<span class="pill ${r.impacto === 'critico' ? 'crit' : r.impacto === 'alto' ? 'warn' : 'ok'}">${esc(r.impactoLabel)}</span>` },
      riscos: { html: r.openHighRisks > 0 ? `<span class="mono" style="color:${C.critical};font-weight:700">${r.openHighRisks}</span>` : '—' },
      comite: r.comite,
    })),
    { rowsPerChunk: 18, rowMm: 8 },
  ));

  return renderReportDocument({
    fileName,
    brand: brandName,
    logoUrl: meta.logoUrl,
    footerLabel: title,
    pages: composePages(blocks, { orientation: 'landscape' }),
    orientation: 'landscape',
  });
}

export type PdfExportResult =
  | { ok: true }
  | { ok: false; reason: 'popup_blocked' | 'empty' | 'error'; message: string };

export function openProjectPortfolioReport(payload: ProjectPdfPayload): PdfExportResult {
  if (!payload.projects || payload.projects.length === 0) {
    return { ok: false, reason: 'empty', message: 'Nenhum projeto no escopo para exportar.' };
  }
  try {
    const result = openReport(buildProjectPortfolioReport(payload), { width: 1280, height: 860 });
    if (result.ok) return { ok: true };
    return { ok: false, reason: result.reason === 'popup_blocked' ? 'popup_blocked' : 'error', message: result.message ?? 'Falha ao gerar o relatório.' };
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      message: err instanceof Error ? err.message : 'Falha desconhecida ao gerar o relatório.',
    };
  }
}
