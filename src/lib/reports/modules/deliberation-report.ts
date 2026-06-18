/**
 * Deliberações → board-ready PDF report on the shared engine.
 *
 * Consumes the SAME DeliberationItem[] the on-screen module renders (from
 * listDeliberations / the demo fallback). The caller passes the filtered list.
 */

import type { DeliberationItem, DeliberationStatus } from '@/lib/types';
import { compactBRL, esc, fmtDate, fmtInt } from '@/lib/reports/report-formatters';
import { C } from '@/lib/reports/report-theme';
import { svgDonut, svgHorizontalBar, svgLineChart, legend } from '@/lib/reports/report-charts';
import {
  reportCover, sectionTitle, kpiGrid, chartBlock, dataTable, dataQualityBox,
  type KpiCardSpec,
} from '@/lib/reports/report-blocks';
import { renderReportDocument } from '@/lib/reports/report-shell';
import { openReport, buildReportMeta, buildReportFileName } from '@/lib/reports/report-export';
import type { ReportExportResult } from '@/lib/reports/report-types';

export interface DeliberationReportPayload {
  deliberations: DeliberationItem[];
  brandName?: string;
  periodLabel?: string;
  filtersLabel?: string;
  source?: string;
  generatedBy?: string;
}

const STATUS_LABEL: Record<DeliberationStatus, string> = {
  draft: 'Rascunho',
  submitted: 'Submetida',
  in_review: 'Em análise',
  in_voting: 'Em votação',
  awaiting_minutes: 'Aguardando ata',
  resolved: 'Resolvida',
  in_execution: 'Em execução',
  closed: 'Encerrada',
  returned_for_revision: 'Devolvida',
  withdrawn: 'Retirada',
};

const APPROVED: DeliberationStatus[] = ['resolved', 'in_execution', 'closed'];
const PENDING: DeliberationStatus[] = ['submitted', 'in_review', 'in_voting', 'awaiting_minutes', 'returned_for_revision', 'draft'];

const MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export function buildDeliberationReportHtml(payload: DeliberationReportPayload): string {
  const items = payload.deliberations ?? [];
  const brand = payload.brandName ?? 'INSIGHT — Governança Corporativa';
  const fileName = buildReportFileName({ module: 'deliberacoes' });
  const meta = buildReportMeta({
    brand,
    periodLabel: payload.periodLabel,
    filtersLabel: payload.filtersLabel,
    source: payload.source,
    generatedBy: payload.generatedBy,
  });

  const now = Date.now();
  const isApproved = (d: DeliberationItem) => APPROVED.includes(d.deliberationStatus);
  const isPending = (d: DeliberationItem) => PENDING.includes(d.deliberationStatus);
  const isOverdue = (d: DeliberationItem) => !!d.dueDate && d.dueDate.getTime() < now && !isApproved(d) && d.deliberationStatus !== 'withdrawn';

  const approved = items.filter(isApproved).length;
  const pending = items.filter(isPending).length;
  const overdue = items.filter(isOverdue).length;
  const totalImpact = items.reduce((s, d) => s + (d.financialImpact ?? 0), 0);
  const allActions = items.flatMap((d) => d.executionItems ?? []);
  const openActions = allActions.filter((a) => a.status !== 'completed').length;

  const cover = reportCover({
    meta,
    kicker: 'Relatório Executivo · Deliberações',
    title: 'Governança de Deliberações',
    context: `<b>${fmtInt(items.length)}</b> deliberações<span class="sep">·</span>${fmtInt(approved)} aprovadas<span class="sep">·</span>${fmtInt(pending)} pendentes`,
  });

  const kpiCards: KpiCardSpec[] = [
    { label: 'Total', value: fmtInt(items.length), color: C.primary },
    { label: 'Aprovadas', value: fmtInt(approved), color: C.success },
    { label: 'Pendentes', value: fmtInt(pending), color: C.warning },
    { label: 'Em atraso', value: fmtInt(overdue), color: overdue ? C.critical : C.success, chip: overdue ? { label: 'atenção', cls: 'crit' } : undefined },
    { label: 'Impacto financeiro', value: compactBRL(totalImpact), color: C.info },
    { label: 'Follow-ups abertos', value: fmtInt(openActions), color: openActions ? C.cost : C.success, helper: `${fmtInt(allActions.length)} no total` },
  ];
  const kpis = `${sectionTitle('Indicadores de Governança')}${kpiGrid(kpiCards)}`;

  // ── Status donut + by committee ──
  const statusCounts: Record<string, number> = {};
  items.forEach((d) => { statusCounts[STATUS_LABEL[d.deliberationStatus]] = (statusCounts[STATUS_LABEL[d.deliberationStatus]] || 0) + 1; });
  const statusBlock = chartBlock({
    title: 'Distribuição por Status',
    svg: svgDonut(
      Object.entries(statusCounts).map(([label, value]) => ({ label, value })),
      { width: 360, centerLabel: fmtInt(items.length), fmtValue: fmtInt },
    ),
  });
  const byCommittee: Record<string, number> = {};
  items.forEach((d) => { const k = d.ownerCommitteeName || 'Sem comitê'; byCommittee[k] = (byCommittee[k] || 0) + 1; });
  const committeeBlock = chartBlock({
    title: 'Deliberações por Comitê',
    svg: svgHorizontalBar(
      Object.entries(byCommittee).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8),
      { width: 520, fmtValue: fmtInt },
    ),
  });
  const chartsSection = `${sectionTitle('Distribuição')}<div class="two-col">${statusBlock}${committeeBlock}</div>`;

  // ── Monthly trend (created vs resolved, 6 months) ──
  const months: { key: string; label: string }[] = [];
  const ref = new Date();
  for (let m = 5; m >= 0; m--) {
    const d = new Date(ref.getFullYear(), ref.getMonth() - m, 1);
    months.push({ key: monthKey(d), label: MONTHS_PT[d.getMonth()] });
  }
  const createdSeries = months.map((mo) => items.filter((d) => monthKey(d.createdAt) === mo.key).length);
  const resolvedSeries = months.map((mo) => items.filter((d) => d.resolvedAt && monthKey(d.resolvedAt) === mo.key).length);
  const trendBlock = chartBlock({
    title: 'Tendência Mensal (6 meses)',
    sub: 'deliberações criadas × resolvidas',
    svg: svgLineChart(
      months.map((m) => m.label),
      [
        { name: 'Criadas', color: C.info, values: createdSeries, endLabel: true },
        { name: 'Resolvidas', color: C.success, values: resolvedSeries, endLabel: true },
      ],
      { width: 1040, height: 220, fmtValue: fmtInt },
    ),
    legendHtml: legend([{ name: 'Criadas', color: C.info }, { name: 'Resolvidas', color: C.success }]),
  });
  const trendSection = `${sectionTitle('Tendência de Decisões')}${trendBlock}`;

  // ── Action items table ──
  const actionTable = dataTable(
    [
      { key: 'titulo', label: 'Item de ação' },
      { key: 'owner', label: 'Responsável' },
      { key: 'due', label: 'Prazo' },
      { key: 'status', label: 'Status' },
      { key: 'link', label: 'Vínculo' },
    ],
    [...allActions]
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
      .slice(0, 40)
      .map((a) => {
        const overdueItem = a.dueDate.getTime() < now && a.status !== 'completed';
        return {
          titulo: a.title,
          owner: a.ownerName,
          due: { html: `<span class="mono" style="${overdueItem ? `color:${C.critical};font-weight:700` : ''}">${esc(fmtDate(a.dueDate))}</span>` },
          status: { html: `<span class="pill ${a.status === 'completed' ? 'ok' : overdueItem ? 'crit' : 'warn'}">${esc(a.status === 'completed' ? 'Concluído' : a.status === 'in_progress' ? 'Em andamento' : 'Pendente')}</span>` },
          link: a.linkedEntityType ?? '—',
        };
      }),
  );
  const actionSection = `${sectionTitle('Itens de Ação / Follow-ups', `${fmtInt(allActions.length)} itens · ${fmtInt(openActions)} em aberto`)}${allActions.length ? actionTable : '<p class="empty">Nenhum item de ação registrado.</p>'}`;

  // ── Appendix: full list ──
  const fullTable = dataTable(
    [
      { key: 'titulo', label: 'Deliberação' },
      { key: 'committee', label: 'Comitê' },
      { key: 'status', label: 'Status' },
      { key: 'owner', label: 'Relator' },
      { key: 'impact', label: 'Impacto', num: true },
      { key: 'due', label: 'Prazo' },
    ],
    [...items]
      .sort((a, b) => (b.financialImpact ?? 0) - (a.financialImpact ?? 0))
      .slice(0, 60)
      .map((d) => ({
        titulo: d.title,
        committee: d.ownerCommitteeName || '—',
        status: { html: `<span class="pill ${isApproved(d) ? 'ok' : isOverdue(d) ? 'crit' : 'warn'}">${esc(STATUS_LABEL[d.deliberationStatus])}</span>` },
        owner: d.ownerName || '—',
        impact: { html: `<span class="mono">${esc(d.financialImpact ? compactBRL(d.financialImpact) : '—')}</span>` },
        due: d.dueDate ? { html: `<span class="mono" style="${isOverdue(d) ? `color:${C.critical};font-weight:700` : ''}">${esc(fmtDate(d.dueDate))}</span>` } : '—',
      })),
  );
  const appendixSection = `${sectionTitle('Apêndice — Deliberações', `${fmtInt(items.length)} deliberações · top 60 por impacto`)}${items.length ? fullTable : '<p class="empty">Nenhuma deliberação no escopo.</p>'}`;

  // ── Data quality ──
  const issues: string[] = [];
  if (!items.length) issues.push('Nenhuma deliberação no recorte selecionado.');
  const noCommittee = items.filter((d) => !d.ownerCommitteeName).length;
  if (noCommittee) issues.push(`${fmtInt(noCommittee)} deliberação(ões) sem comitê responsável.`);
  const noDue = items.filter((d) => !isApproved(d) && !d.dueDate).length;
  if (noDue) issues.push(`${fmtInt(noDue)} deliberação(ões) pendente(s) sem prazo definido.`);
  const dqSection = `${sectionTitle('Qualidade dos Dados')}${dataQualityBox(issues)}`;

  const page1 = `<section class="section">${cover}</section><section class="section">${kpis}</section>`;
  const page2 = `<section class="section">${chartsSection}</section><section class="section">${trendSection}</section>`;
  const page3 = `<section class="section">${actionSection}</section><section class="section">${appendixSection}</section><section class="section">${dqSection}</section>`;

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: 'Deliberações',
    pages: [page1, page2, page3],
    orientation: 'landscape',
  });
}

export function openDeliberationReport(payload: DeliberationReportPayload): ReportExportResult {
  try {
    return openReport(buildDeliberationReportHtml(payload), { width: 1280, height: 860 });
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : 'Falha ao gerar o relatório.' };
  }
}
