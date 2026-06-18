/**
 * Projeto · Cronograma (Timeline/Gantt) → board-ready PDF report.
 *
 * Consumes the SAME TimelineItem[] the on-screen timeline renders and the same
 * `timelineKpis` selector. Surfaces a high-level schedule summary, delayed
 * activities with reasons/recovery, next critical tasks and milestones.
 */

import type { TimelineItem } from '@/lib/types/project-timeline';
import { timelineKpis, deriveDelayStatus } from '@/lib/projects/timeline-analytics';
import { esc, fmtDate, fmtInt } from '@/lib/reports/report-formatters';
import { C } from '@/lib/reports/report-theme';
import { svgDonut } from '@/lib/reports/report-charts';
import {
  reportCover, sectionTitle, kpiGrid, chartBlock, dataTable, dataQualityBox,
  type KpiCardSpec,
} from '@/lib/reports/report-blocks';
import { renderReportDocument } from '@/lib/reports/report-shell';
import { openReport, buildReportMeta, buildReportFileName } from '@/lib/reports/report-export';
import type { ReportExportResult } from '@/lib/reports/report-types';

export interface ProjectTimelineReportPayload {
  projectName: string;
  projectCode?: string;
  items: TimelineItem[];
  /** Resolve a responsible user id to a display name. */
  resolveUserName?: (userId: string | null) => string;
  brandName?: string;
  source?: string;
  generatedBy?: string;
}

const DELAY_LABEL: Record<string, string> = { on_track: 'No prazo', at_risk: 'Em risco', delayed: 'Atrasada', blocked: 'Bloqueada' };
const DELAY_PILL: Record<string, 'ok' | 'warn' | 'crit'> = { on_track: 'ok', at_risk: 'warn', delayed: 'crit', blocked: 'crit' };
const STATUS_LABEL: Record<string, string> = { not_started: 'Não iniciada', in_progress: 'Em andamento', blocked: 'Bloqueada', delayed: 'Atrasada', completed: 'Concluída', cancelled: 'Cancelada' };

export function buildProjectTimelineReportHtml(payload: ProjectTimelineReportPayload): string {
  const items = payload.items ?? [];
  const nameOf = payload.resolveUserName ?? ((id) => id ?? '—');
  const brand = payload.brandName ?? 'INSIGHT — Governança Corporativa';
  const fileName = buildReportFileName({ module: 'projeto', context: `cronograma-${payload.projectCode ?? payload.projectName}` });
  const now = new Date();
  const kpi = timelineKpis(items, now);

  const meta = buildReportMeta({
    brand,
    periodLabel: kpi.projectFinish ? `Término previsto: ${fmtDate(kpi.projectFinish)}` : undefined,
    source: payload.source,
    generatedBy: payload.generatedBy,
  });

  const cover = reportCover({
    meta,
    kicker: 'Relatório Executivo · Cronograma',
    title: payload.projectName,
    context: `${payload.projectCode ? `<b>${esc(payload.projectCode)}</b><span class="sep">·</span>` : ''}${kpi.overallPercent.toFixed(0)}% concluído<span class="sep">·</span>${fmtInt(kpi.delayedCount)} atrasadas`,
  });

  // ── KPIs ──
  const kpiCards: KpiCardSpec[] = [
    { label: 'Atividades (folha)', value: fmtInt(kpi.totalLeaf), color: C.primary },
    { label: 'Avanço geral', value: `${kpi.overallPercent.toFixed(0)}%`, color: C.info },
    { label: 'Atrasadas', value: fmtInt(kpi.delayedCount), color: kpi.delayedCount ? C.critical : C.success, chip: kpi.delayedCount ? { label: 'atenção', cls: 'crit' } : undefined },
    { label: 'Bloqueadas', value: fmtInt(kpi.blockedCount), color: kpi.blockedCount ? C.warning : C.success },
    { label: 'Concluídas', value: fmtInt(kpi.completedCount), color: C.success },
    { label: 'Sem responsável', value: fmtInt(kpi.missingResponsible), color: kpi.missingResponsible ? C.warning : C.success },
    { label: 'Próximo marco', value: kpi.nextMilestone ? (kpi.daysRemaining != null ? `${fmtInt(kpi.daysRemaining)}d` : '—') : 'sem marco', color: C.purple, helper: kpi.nextMilestone?.title },
    { label: 'Término previsto', value: kpi.projectFinish ? fmtDate(kpi.projectFinish) : '—', color: C.cost },
  ];
  const kpis = `${sectionTitle('Visão Geral do Cronograma')}${kpiGrid(kpiCards)}`;

  // ── Delay distribution donut ──
  const leaves = items.filter((i) => !i.isSummary);
  const delayCounts = (['on_track', 'at_risk', 'delayed', 'blocked'] as const)
    .map((d) => ({ label: DELAY_LABEL[d], value: leaves.filter((i) => deriveDelayStatus(i, now) === d).length, color: d === 'on_track' ? C.success : d === 'at_risk' ? C.warning : C.critical }))
    .filter((x) => x.value > 0);
  const delayBlock = chartBlock({
    title: 'Atividades por situação de prazo',
    svg: svgDonut(delayCounts, { width: 360, centerLabel: fmtInt(leaves.length), fmtValue: (n) => fmtInt(n) }),
  });
  const distSection = `${sectionTitle('Distribuição de Prazos')}${delayBlock}`;

  // ── Delayed / at-risk activities ──
  const delayed = leaves
    .filter((i) => { const d = deriveDelayStatus(i, now); return d === 'delayed' || d === 'blocked' || d === 'at_risk'; })
    .sort((a, b) => (a.forecastFinish || a.plannedFinish || '').localeCompare(b.forecastFinish || b.plannedFinish || ''))
    .slice(0, 40);
  const delayedTable = dataTable(
    [
      { key: 'title', label: 'Atividade' },
      { key: 'resp', label: 'Responsável' },
      { key: 'plan', label: 'Fim previsto' },
      { key: 'fcst', label: 'Fim projetado' },
      { key: 'sit', label: 'Situação' },
      { key: 'reason', label: 'Motivo do atraso' },
    ],
    delayed.map((i) => {
      const d = deriveDelayStatus(i, now);
      return {
        title: i.title,
        resp: nameOf(i.responsibleUserId),
        plan: { html: `<span class="mono">${esc(fmtDate(i.plannedFinish))}</span>` },
        fcst: { html: `<span class="mono">${esc(fmtDate(i.forecastFinish || i.actualFinish))}</span>` },
        sit: { html: `<span class="pill ${DELAY_PILL[d]}">${DELAY_LABEL[d]}</span>` },
        reason: i.delayReasonText || (i.delayReasonCategory ? String(i.delayReasonCategory) : '—'),
      };
    }),
  );
  const delayedSection = `${sectionTitle('Atividades Atrasadas / Em Risco', `${fmtInt(delayed.length)} atividades`)}${delayed.length ? delayedTable : '<p class="empty">Nenhuma atividade atrasada ou em risco.</p>'}`;

  // ── Next critical tasks (upcoming, not completed, by finish) ──
  const upcoming = leaves
    .filter((i) => i.status !== 'completed' && i.status !== 'cancelled' && (i.plannedFinish || i.forecastFinish))
    .sort((a, b) => (a.forecastFinish || a.plannedFinish || '').localeCompare(b.forecastFinish || b.plannedFinish || ''))
    .slice(0, 20);
  const upcomingTable = dataTable(
    [
      { key: 'title', label: 'Atividade' },
      { key: 'resp', label: 'Responsável' },
      { key: 'prio', label: 'Prioridade' },
      { key: 'fim', label: 'Término' },
      { key: 'prog', label: 'Avanço', num: true },
      { key: 'status', label: 'Status' },
    ],
    upcoming.map((i) => ({
      title: i.title,
      resp: nameOf(i.responsibleUserId),
      prio: { html: `<span class="pill ${i.priority === 'critical' ? 'crit' : i.priority === 'high' ? 'warn' : ''}">${i.priority}</span>` },
      fim: { html: `<span class="mono">${esc(fmtDate(i.forecastFinish || i.plannedFinish))}</span>` },
      prog: `${(i.percentComplete ?? 0).toFixed(0)}%`,
      status: STATUS_LABEL[i.status] ?? i.status,
    })),
  );
  const upcomingSection = `${sectionTitle('Próximas Tarefas Críticas')}${upcoming.length ? upcomingTable : '<p class="empty">Sem tarefas pendentes no horizonte.</p>'}`;

  // ── Milestones ──
  const milestones = items.filter((i) => i.isMilestone).sort((a, b) => (a.plannedFinish || a.plannedStart || '').localeCompare(b.plannedFinish || b.plannedStart || ''));
  const msTable = dataTable(
    [
      { key: 'title', label: 'Marco' },
      { key: 'date', label: 'Data' },
      { key: 'status', label: 'Status' },
    ],
    milestones.map((m) => ({
      title: m.title,
      date: { html: `<span class="mono">${esc(fmtDate(m.plannedFinish || m.plannedStart))}</span>` },
      status: { html: `<span class="pill ${m.status === 'completed' ? 'ok' : deriveDelayStatus(m, now) === 'delayed' ? 'crit' : 'warn'}">${STATUS_LABEL[m.status] ?? m.status}</span>` },
    })),
  );
  const msSection = `${sectionTitle('Marcos', `${fmtInt(milestones.length)} marcos`)}${milestones.length ? msTable : '<p class="empty">Sem marcos no cronograma.</p>'}`;

  // ── Data quality ──
  const issues: string[] = [];
  if (!items.length) issues.push('Cronograma vazio — nenhuma atividade importada/cadastrada.');
  if (kpi.missingResponsible) issues.push(`${fmtInt(kpi.missingResponsible)} atividade(s) sem responsável.`);
  const noDates = leaves.filter((i) => !i.plannedFinish && !i.forecastFinish).length;
  if (noDates) issues.push(`${fmtInt(noDates)} atividade(s) sem data de término.`);
  const dqSection = `${sectionTitle('Qualidade dos Dados')}${dataQualityBox(issues)}`;

  const page1 = `<section class="section">${cover}</section><section class="section">${kpis}</section><section class="section">${distSection}</section>`;
  const page2 = `<section class="section">${delayedSection}</section>`;
  const page3 = `<section class="section">${upcomingSection}</section><section class="section">${msSection}</section><section class="section">${dqSection}</section>`;

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: `Cronograma · ${payload.projectName}`,
    pages: [page1, page2, page3],
    orientation: 'landscape',
  });
}

export function openProjectTimelineReport(payload: ProjectTimelineReportPayload): ReportExportResult {
  try {
    return openReport(buildProjectTimelineReportHtml(payload), { width: 1280, height: 860 });
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : 'Falha ao gerar o relatório.' };
  }
}
