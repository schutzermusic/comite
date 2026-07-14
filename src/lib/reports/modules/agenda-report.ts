/**
 * Agenda & Tarefas → board-ready PDF report on the shared engine.
 *
 * Consumes the SAME CalendarEvent[] (meetings) and Task[] the on-screen agenda
 * renders. A user-name resolver maps assignee ids to names (the page already has
 * the org-member directory). No business logic — counting + layout only.
 */

import type { CalendarEvent, Task, TaskStatus, TaskPriority } from '@/lib/types/agenda';
import { TASK_STATUS_LABELS, TASK_PRIORITY_LABELS, RELATED_MODULE_LABELS } from '@/lib/types/agenda';
import { esc, fmtDateTime, fmtDate, fmtInt } from '@/lib/reports/report-formatters';
import { C, REPORT_BRAND_NAME } from '@/lib/reports/report-theme';
import { svgDonut, svgHorizontalBar, svgTimelineStrip } from '@/lib/reports/report-charts';
import {
  reportCover, sectionTitle, kpiGrid, chartBlock, dataTable, dataTableChunked,
  dataQualityBox, type KpiCardSpec,
} from '@/lib/reports/report-blocks';
import {
  composePages, block, mmForChart, mmForColumns, mmForCover, mmForKpiGrid,
  mmForSectionTitle, mmForTable, mmForWarningBox, type ReportBlock,
} from '@/lib/reports/report-compose';
import { insightPanel, mmForInsightPanel, type InsightItem } from '@/lib/reports/report-insights';
import { renderReportDocument } from '@/lib/reports/report-shell';
import { openReport, buildReportMeta, buildReportFileName } from '@/lib/reports/report-export';
import type { ReportExportResult } from '@/lib/reports/report-types';

export interface AgendaReportPayload {
  meetings: CalendarEvent[];
  tasks: Task[];
  /** Resolve an assignee user id to a display name. */
  resolveUserName?: (userId: string | null) => string;
  brandName?: string;
  periodLabel?: string;
  filtersLabel?: string;
  source?: string;
  generatedBy?: string;
}

const OPEN_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'waiting', 'blocked'];
const STATUS_COLOR: Record<TaskStatus, string> = {
  todo: C.subtle,
  in_progress: C.info,
  waiting: C.warning,
  blocked: C.critical,
  done: C.success,
  cancelled: C.borderStrong,
};
const PRIORITY_COLOR: Record<TaskPriority, string> = {
  low: C.success,
  medium: C.info,
  high: C.warning,
  critical: C.critical,
};

const RELATED_KEYS: { field: keyof Task; module: keyof typeof RELATED_MODULE_LABELS }[] = [
  { field: 'relatedProjectId', module: 'project' },
  { field: 'relatedContractId', module: 'contract' },
  { field: 'relatedRiskId', module: 'risk' },
  { field: 'relatedDeliberationId', module: 'deliberation' },
  { field: 'relatedCommitteeId', module: 'committee' },
  { field: 'relatedFinanceItemId', module: 'finance' },
  { field: 'relatedPayrollBatchId', module: 'payroll' },
];

export function buildAgendaReportHtml(payload: AgendaReportPayload): string {
  const meetings = payload.meetings ?? [];
  const tasks = payload.tasks ?? [];
  const nameOf = payload.resolveUserName ?? ((id) => id ?? 'Não atribuído');
  const brand = payload.brandName ?? REPORT_BRAND_NAME;
  const fileName = buildReportFileName({ module: 'agenda' });
  const meta = buildReportMeta({
    brand,
    periodLabel: payload.periodLabel,
    filtersLabel: payload.filtersLabel,
    source: payload.source,
    generatedBy: payload.generatedBy,
  });

  const now = Date.now();
  const isOpen = (t: Task) => OPEN_STATUSES.includes(t.status);
  const isOverdue = (t: Task) => !!t.dueAt && t.dueAt.getTime() < now && isOpen(t);
  const openTasks = tasks.filter(isOpen);
  const overdueTasks = tasks.filter(isOverdue);
  const criticalDeadlines = openTasks.filter((t) => (t.priority === 'high' || t.priority === 'critical')).length;
  const linkedTasks = tasks.filter((t) => RELATED_KEYS.some(({ field }) => t[field])).length;

  const blocks: ReportBlock[] = [];
  blocks.push(block(reportCover({
    meta,
    kicker: 'Relatório Executivo · Agenda & Tarefas',
    title: 'Agenda Executiva',
    context: `<b>${fmtInt(meetings.length)}</b> reuniões<span class="sep">·</span><b>${fmtInt(tasks.length)}</b> tarefas<span class="sep">·</span>${fmtInt(overdueTasks.length)} atrasadas`,
    coverKpis: [
      { label: 'Reuniões', value: fmtInt(meetings.length) },
      { label: 'Tarefas', value: fmtInt(tasks.length) },
      { label: 'Em aberto', value: fmtInt(openTasks.length) },
      { label: 'Atrasadas', value: fmtInt(overdueTasks.length) },
    ],
  }), mmForCover(true)));

  const kpiCards: KpiCardSpec[] = [
    { label: 'Reuniões', value: fmtInt(meetings.length), color: C.primary },
    { label: 'Tarefas (total)', value: fmtInt(tasks.length), color: C.info },
    { label: 'Tarefas em aberto', value: fmtInt(openTasks.length), color: C.warning },
    { label: 'Tarefas atrasadas', value: fmtInt(overdueTasks.length), color: overdueTasks.length ? C.critical : C.success, chip: overdueTasks.length ? { label: 'atenção', cls: 'crit' } : undefined },
    { label: 'Prazos críticos', value: fmtInt(criticalDeadlines), color: criticalDeadlines ? C.cost : C.success, helper: 'alta/crítica em aberto' },
    { label: 'Vinculadas a módulos', value: fmtInt(linkedTasks), color: C.purple },
  ];
  blocks.push(block(sectionTitle('Indicadores da Agenda', undefined, 1), mmForSectionTitle(), { keepWithNext: true }));
  blocks.push(block(kpiGrid(kpiCards, 3), mmForKpiGrid(kpiCards.length, 3)));

  // ── Tasks by status (donut) + by priority (bars) ──
  const statusCounts = (Object.keys(TASK_STATUS_LABELS) as TaskStatus[])
    .map((k) => ({ label: TASK_STATUS_LABELS[k], value: tasks.filter((t) => t.status === k).length, color: STATUS_COLOR[k] }))
    .filter((s) => s.value > 0);
  const statusBlock = chartBlock({
    title: 'Tarefas por Status',
    svg: svgDonut(statusCounts, { width: 490, height: 140, centerLabel: fmtInt(tasks.length), fmtValue: fmtInt }),
  });
  const priorityCounts = (Object.keys(TASK_PRIORITY_LABELS) as TaskPriority[])
    .map((k) => ({ label: TASK_PRIORITY_LABELS[k], value: tasks.filter((t) => t.priority === k).length, color: PRIORITY_COLOR[k] }))
    .filter((s) => s.value > 0);
  const priorityBlock = chartBlock({
    title: 'Tarefas por Prioridade',
    svg: svgHorizontalBar(priorityCounts.map((p) => ({ label: p.label, value: p.value, color: p.color })), { width: 490, fmtValue: fmtInt }),
  });
  blocks.push(block(
    `<div class="two-col">${statusBlock}${priorityBlock}</div>`,
    mmForColumns(
      mmForChart(140, { svgWidthPx: 490, cols: 2, title: true }),
      mmForChart(priorityCounts.length * 26 + 8, { svgWidthPx: 490, cols: 2, title: true }),
    ),
  ));

  // ── Tasks by responsible ──
  const byOwner: Record<string, number> = {};
  openTasks.forEach((t) => { const k = nameOf(t.assigneeUserId); byOwner[k] = (byOwner[k] || 0) + 1; });
  const ownerRows = Object.entries(byOwner).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  const ownerBlock = chartBlock({
    title: 'Tarefas em Aberto por Responsável',
    sub: 'carga de trabalho da equipe',
    svg: svgHorizontalBar(ownerRows, { width: 1000, fmtValue: fmtInt, labelW: 190 }),
  });
  blocks.push(block(sectionTitle('Carga & Prazos', 'distribuição de carga e vencimentos por mês', 2), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));
  blocks.push(block(ownerBlock, mmForChart(ownerRows.length * 26 + 8, { svgWidthPx: 1000, title: true })));

  // ── Deadlines by month (next 12 months) ──
  const nowDate = new Date();
  const monthLabels: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(nowDate.getFullYear(), nowDate.getMonth() + i, 1);
    const mon = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
    monthLabels.push(i === 0 || d.getMonth() === 0 ? `${mon} ${String(d.getFullYear()).slice(2)}` : mon);
  }
  const dueCounts = Array.from({ length: 12 }, () => 0);
  openTasks.forEach((t) => {
    if (!t.dueAt) return;
    const idx = (t.dueAt.getFullYear() - nowDate.getFullYear()) * 12 + t.dueAt.getMonth() - nowDate.getMonth();
    if (idx >= 0 && idx < 12) dueCounts[idx] += 1;
  });
  if (dueCounts.some((c) => c > 0)) {
    blocks.push(block(chartBlock({
      title: 'Tarefas em Aberto por Mês de Vencimento',
      svg: svgTimelineStrip(monthLabels, [], { width: 1000, counts: dueCounts, accent: C.info }),
    }), mmForChart(68, { svgWidthPx: 1000, title: true })));
  }

  // ── Next 30 days agenda (meetings) ──
  const horizon = now + 30 * 86_400_000;
  const upcoming = meetings
    .filter((m) => m.startsAt.getTime() >= now && m.startsAt.getTime() <= horizon)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, 30);
  const meetingTable = dataTable(
    [
      { key: 'quando', label: 'Quando' },
      { key: 'titulo', label: 'Reunião' },
      { key: 'local', label: 'Local / link' },
      { key: 'status', label: 'Status' },
    ],
    upcoming.map((m) => ({
      quando: { html: `<span class="mono">${esc(fmtDateTime(m.startsAt))}</span>` },
      titulo: m.title,
      local: m.location || (m.meetingLink ? 'Online' : '—'),
      status: m.status,
    })),
  );
  blocks.push(block(sectionTitle('Agenda — Próximos 30 dias', `${fmtInt(upcoming.length)} reuniões agendadas`, 3), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));
  blocks.push(block(upcoming.length ? meetingTable : '<p class="empty">Sem reuniões nos próximos 30 dias.</p>', upcoming.length ? mmForTable(upcoming.length, { rowMm: 5 }) : 8));

  // ── Insights ──
  const insights: InsightItem[] = [];
  if (overdueTasks.length) insights.push({ kind: 'alert', title: 'Tarefas atrasadas', detail: `${fmtInt(overdueTasks.length)} tarefa(s) em aberto além do prazo.`, value: fmtInt(overdueTasks.length) });
  if (ownerRows[0] && openTasks.length) {
    insights.push({ kind: 'fact', title: 'Maior carga individual', detail: `${ownerRows[0].label} concentra ${Math.round((ownerRows[0].value / openTasks.length) * 100)}% das tarefas em aberto.`, value: fmtInt(ownerRows[0].value) });
  }
  if (criticalDeadlines) insights.push({ kind: 'recommendation', title: 'Priorizar prazos críticos', detail: `${fmtInt(criticalDeadlines)} tarefa(s) de prioridade alta/crítica em aberto.` });
  const noOwnerCount = openTasks.filter((t) => !t.assigneeUserId).length;
  if (noOwnerCount) insights.push({ kind: 'data-quality', title: 'Tarefas sem responsável', detail: `${fmtInt(noOwnerCount)} tarefa(s) em aberto sem responsável atribuído.` });
  if (insights.length) blocks.push(block(insightPanel(insights.slice(0, 6), { cols: 2 }), mmForInsightPanel(Math.min(insights.length, 6), 2)));

  // ── Appendix: open tasks (chunked) ──
  blocks.push(block(sectionTitle('Apêndice — Tarefas em Aberto', `${fmtInt(openTasks.length)} tarefas`, 4), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));
  if (openTasks.length) {
    blocks.push(...dataTableChunked(
      [
        { key: 'titulo', label: 'Tarefa' },
        { key: 'owner', label: 'Responsável' },
        { key: 'prio', label: 'Prioridade' },
        { key: 'status', label: 'Status' },
        { key: 'due', label: 'Prazo' },
        { key: 'mod', label: 'Vínculo' },
      ],
      [...openTasks]
        .sort((a, b) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity))
        .slice(0, 50)
        .map((t) => {
          const linked = RELATED_KEYS.find(({ field }) => t[field]);
          return {
            titulo: t.title,
            owner: nameOf(t.assigneeUserId),
            prio: { html: `<span class="pill ${t.priority === 'critical' ? 'crit' : t.priority === 'high' ? 'warn' : ''}">${esc(TASK_PRIORITY_LABELS[t.priority])}</span>` },
            status: esc(TASK_STATUS_LABELS[t.status]),
            due: t.dueAt ? { html: `<span class="mono" style="${isOverdue(t) ? `color:${C.critical};font-weight:700` : ''}">${esc(fmtDate(t.dueAt))}${isOverdue(t) ? ' ⚠' : ''}</span>` } : '—',
            mod: linked ? RELATED_MODULE_LABELS[linked.module] : '—',
          };
        }),
      { rowsPerChunk: 24 },
    ));
  } else {
    blocks.push(block('<p class="empty">Nenhuma tarefa em aberto.</p>', 8));
  }

  // ── Data quality ──
  const issues: string[] = [];
  if (!tasks.length && !meetings.length) issues.push('Nenhuma reunião ou tarefa no recorte selecionado.');
  const noDue = openTasks.filter((t) => !t.dueAt).length;
  if (noDue) issues.push(`${fmtInt(noDue)} tarefa(s) em aberto sem prazo definido.`);
  const noOwner = openTasks.filter((t) => !t.assigneeUserId).length;
  if (noOwner) issues.push(`${fmtInt(noOwner)} tarefa(s) em aberto sem responsável.`);
  blocks.push(block(sectionTitle('Qualidade dos Dados'), mmForSectionTitle(), { keepWithNext: true }));
  blocks.push(block(dataQualityBox(issues), mmForWarningBox(Math.max(1, issues.length))));

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: 'Agenda & Tarefas',
    pages: composePages(blocks, { orientation: 'landscape' }),
    orientation: 'landscape',
  });
}

export function openAgendaReport(payload: AgendaReportPayload): ReportExportResult {
  try {
    return openReport(buildAgendaReportHtml(payload), { width: 1280, height: 860 });
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : 'Falha ao gerar o relatório.' };
  }
}
