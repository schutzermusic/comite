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
import { C } from '@/lib/reports/report-theme';
import { svgDonut, svgHorizontalBar } from '@/lib/reports/report-charts';
import {
  reportCover, sectionTitle, kpiGrid, chartBlock, dataTable, dataQualityBox,
  type KpiCardSpec,
} from '@/lib/reports/report-blocks';
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
  const brand = payload.brandName ?? 'INSIGHT — Governança Corporativa';
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

  const cover = reportCover({
    meta,
    kicker: 'Relatório Executivo · Agenda & Tarefas',
    title: 'Agenda Executiva',
    context: `<b>${fmtInt(meetings.length)}</b> reuniões<span class="sep">·</span><b>${fmtInt(tasks.length)}</b> tarefas<span class="sep">·</span>${fmtInt(overdueTasks.length)} atrasadas`,
  });

  const kpiCards: KpiCardSpec[] = [
    { label: 'Reuniões', value: fmtInt(meetings.length), color: C.primary },
    { label: 'Tarefas (total)', value: fmtInt(tasks.length), color: C.info },
    { label: 'Tarefas em aberto', value: fmtInt(openTasks.length), color: C.warning },
    { label: 'Tarefas atrasadas', value: fmtInt(overdueTasks.length), color: overdueTasks.length ? C.critical : C.success, chip: overdueTasks.length ? { label: 'atenção', cls: 'crit' } : undefined },
    { label: 'Prazos críticos', value: fmtInt(criticalDeadlines), color: criticalDeadlines ? C.cost : C.success, helper: 'alta/crítica em aberto' },
    { label: 'Vinculadas a módulos', value: fmtInt(linkedTasks), color: C.purple },
  ];
  const kpis = `${sectionTitle('Indicadores da Agenda')}${kpiGrid(kpiCards)}`;

  // ── Tasks by status (donut) + by priority (bars) ──
  const statusCounts = (Object.keys(TASK_STATUS_LABELS) as TaskStatus[])
    .map((k) => ({ label: TASK_STATUS_LABELS[k], value: tasks.filter((t) => t.status === k).length, color: STATUS_COLOR[k] }))
    .filter((s) => s.value > 0);
  const statusBlock = chartBlock({
    title: 'Tarefas por Status',
    svg: svgDonut(statusCounts, { width: 360, centerLabel: fmtInt(tasks.length), fmtValue: fmtInt }),
  });
  const priorityCounts = (Object.keys(TASK_PRIORITY_LABELS) as TaskPriority[])
    .map((k) => ({ label: TASK_PRIORITY_LABELS[k], value: tasks.filter((t) => t.priority === k).length, color: PRIORITY_COLOR[k] }))
    .filter((s) => s.value > 0);
  const priorityBlock = chartBlock({
    title: 'Tarefas por Prioridade',
    svg: svgHorizontalBar(priorityCounts.map((p) => ({ label: p.label, value: p.value, color: p.color })), { width: 520, fmtValue: fmtInt }),
  });
  const chartsSection = `${sectionTitle('Distribuição de Tarefas')}<div class="two-col">${statusBlock}${priorityBlock}</div>`;

  // ── Tasks by responsible ──
  const byOwner: Record<string, number> = {};
  openTasks.forEach((t) => { const k = nameOf(t.assigneeUserId); byOwner[k] = (byOwner[k] || 0) + 1; });
  const ownerBlock = chartBlock({
    title: 'Tarefas em Aberto por Responsável',
    svg: svgHorizontalBar(
      Object.entries(byOwner).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8),
      { width: 1040, fmtValue: fmtInt },
    ),
  });
  const ownerSection = `${sectionTitle('Carga por Responsável')}${ownerBlock}`;

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
  const meetingSection = `${sectionTitle('Agenda — Próximos 30 dias', `${fmtInt(upcoming.length)} reuniões agendadas`)}${upcoming.length ? meetingTable : '<p class="empty">Sem reuniões nos próximos 30 dias.</p>'}`;

  // ── Appendix: open tasks ──
  const taskTable = dataTable(
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
  );
  const taskSection = `${sectionTitle('Apêndice — Tarefas em Aberto', `${fmtInt(openTasks.length)} tarefas`)}${openTasks.length ? taskTable : '<p class="empty">Nenhuma tarefa em aberto.</p>'}`;

  // ── Data quality ──
  const issues: string[] = [];
  if (!tasks.length && !meetings.length) issues.push('Nenhuma reunião ou tarefa no recorte selecionado.');
  const noDue = openTasks.filter((t) => !t.dueAt).length;
  if (noDue) issues.push(`${fmtInt(noDue)} tarefa(s) em aberto sem prazo definido.`);
  const noOwner = openTasks.filter((t) => !t.assigneeUserId).length;
  if (noOwner) issues.push(`${fmtInt(noOwner)} tarefa(s) em aberto sem responsável.`);
  const dqSection = `${sectionTitle('Qualidade dos Dados')}${dataQualityBox(issues)}`;

  const page1 = `<section class="section">${cover}</section><section class="section">${kpis}</section>`;
  const page2 = `<section class="section">${chartsSection}</section><section class="section">${ownerSection}</section>`;
  const page3 = `<section class="section">${meetingSection}</section><section class="section">${taskSection}</section><section class="section">${dqSection}</section>`;

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: 'Agenda & Tarefas',
    pages: [page1, page2, page3],
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
