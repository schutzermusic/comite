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
import { C, REPORT_BRAND_NAME } from '@/lib/reports/report-theme';
import { svgDonut, svgGauge, svgTimelineStrip, type TimelineMarker } from '@/lib/reports/report-charts';
import {
  reportCover, sectionTitle, kpiGrid, chartBlock, dataTable, dataTableChunked, dataQualityBox,
  type KpiCardSpec,
} from '@/lib/reports/report-blocks';
import {
  composePages, block, mmForChart, mmForColumns, mmForCover, mmForKpiGrid,
  mmForSectionTitle, mmForTable, mmForWarningBox, type ReportBlock,
} from '@/lib/reports/report-compose';
import { renderReportDocument } from '@/lib/reports/report-shell';
import { openReport, buildReportMeta, buildReportFileName } from '@/lib/reports/report-export';
import type { ReportExportResult } from '@/lib/reports/report-types';

/**
 * Execução por atividade, vinda do apontamento do colaborador.
 *
 * SOMENTE HORAS — nunca custo. O relatório não tem como sondar
 * `people.cost_view`, e a regra do módulo é que custo só sai de
 * project_labor_cost_periods / employee_cost_snapshots, que são RLS-gated.
 */
export interface ExecutionReportRow {
  itemId: string;
  plannedHours: number | null;
  loggedHours: number | null;
  variance: number | null;
  lastActivityAt: string | null;
  collaborators: string[];
}

export interface ProjectTimelineReportPayload {
  projectName: string;
  projectCode?: string;
  items: TimelineItem[];
  /** Resolve a responsible user id to a display name. */
  resolveUserName?: (userId: string | null) => string;
  /**
   * Presente apenas quando o gerador tinha permissão de leitura do timesheet.
   * Ausente ⇒ a seção some e o box de qualidade de dados diz por quê.
   */
  execution?: ExecutionReportRow[];
  brandName?: string;
  source?: string;
  generatedBy?: string;
}

/** Horas em pt-BR; `null` vira travessão — ausente nunca é impresso como zero. */
function fmtHoursCell(hours: number | null): string {
  if (hours == null) return '—';
  return `${hours.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;
}

function fmtVarianceCell(variance: number | null): string {
  if (variance == null) return '—';
  const sign = variance > 0 ? '+' : '';
  return `${sign}${variance.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;
}

const DELAY_LABEL: Record<string, string> = { on_track: 'No prazo', at_risk: 'Em risco', delayed: 'Atrasada', blocked: 'Bloqueada' };
const DELAY_PILL: Record<string, 'ok' | 'warn' | 'crit'> = { on_track: 'ok', at_risk: 'warn', delayed: 'crit', blocked: 'crit' };
const STATUS_LABEL: Record<string, string> = { not_started: 'Não iniciada', in_progress: 'Em andamento', blocked: 'Bloqueada', delayed: 'Atrasada', completed: 'Concluída', cancelled: 'Cancelada' };

export function buildProjectTimelineReportHtml(payload: ProjectTimelineReportPayload): string {
  const items = payload.items ?? [];
  const nameOf = payload.resolveUserName ?? ((id) => id ?? '—');
  const brand = payload.brandName ?? REPORT_BRAND_NAME;
  const fileName = buildReportFileName({ module: 'projeto', context: `cronograma-${payload.projectCode ?? payload.projectName}` });
  const now = new Date();
  const kpi = timelineKpis(items, now);

  const meta = buildReportMeta({
    brand,
    periodLabel: kpi.projectFinish ? `Término previsto: ${fmtDate(kpi.projectFinish)}` : undefined,
    source: payload.source,
    generatedBy: payload.generatedBy,
  });

  const blocks: ReportBlock[] = [];
  blocks.push(block(reportCover({
    meta,
    kicker: 'Relatório Executivo · Cronograma',
    title: payload.projectName,
    context: `${payload.projectCode ? `<b>${esc(payload.projectCode)}</b><span class="sep">·</span>` : ''}${kpi.overallPercent.toFixed(0)}% concluído<span class="sep">·</span>${fmtInt(kpi.delayedCount)} atrasadas`,
    coverKpis: [
      { label: 'Avanço geral', value: `${kpi.overallPercent.toFixed(0)}%` },
      { label: 'Atividades', value: fmtInt(kpi.totalLeaf) },
      { label: 'Atrasadas', value: fmtInt(kpi.delayedCount) },
      { label: 'Término previsto', value: kpi.projectFinish ? fmtDate(kpi.projectFinish) : '—' },
    ],
  }), mmForCover(true)));

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
  blocks.push(block(sectionTitle('Visão Geral do Cronograma', undefined, 1), mmForSectionTitle(), { keepWithNext: true }));
  blocks.push(block(kpiGrid(kpiCards, 4), mmForKpiGrid(kpiCards.length, 4)));

  // ── Delay distribution donut ──
  const leaves = items.filter((i) => !i.isSummary);
  const delayCounts = (['on_track', 'at_risk', 'delayed', 'blocked'] as const)
    .map((d) => ({ label: DELAY_LABEL[d], value: leaves.filter((i) => deriveDelayStatus(i, now) === d).length, color: d === 'on_track' ? C.success : d === 'at_risk' ? C.warning : C.critical }))
    .filter((x) => x.value > 0);
  const delayBlock = chartBlock({
    title: 'Atividades por situação de prazo',
    svg: svgDonut(delayCounts, { width: 490, height: 132, centerLabel: fmtInt(leaves.length), fmtValue: (n) => fmtInt(n) }),
  });
  const progressBlock = chartBlock({
    title: 'Avanço Físico do Cronograma',
    sub: `${fmtInt(kpi.completedCount)} de ${fmtInt(kpi.totalLeaf)} atividades concluídas`,
    svg: svgGauge(kpi.overallPercent, {
      width: 490,
      height: 132,
      label: 'Concluído',
      color: kpi.overallPercent >= 70 ? C.success : kpi.overallPercent >= 40 ? C.primary : C.warning,
    }),
  });
  blocks.push(block(
    `<div class="two-col">${progressBlock}${delayBlock}</div>`,
    mmForColumns(
      mmForChart(132, { svgWidthPx: 490, cols: 2, title: true }),
      mmForChart(132, { svgWidthPx: 490, cols: 2, title: true }),
    ),
  ));

  // ── Milestone strip: next 12 months ──
  const monthLabels: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const mon = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
    monthLabels.push(i === 0 || d.getMonth() === 0 ? `${mon} ${String(d.getFullYear()).slice(2)}` : mon);
  }
  const monthIdxOf = (iso: string) => {
    const d = new Date(iso);
    return (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth();
  };
  const msAll = items.filter((i) => i.isMilestone);
  const msWindow = msAll.filter((m) => {
    const ref = m.plannedFinish || m.plannedStart;
    if (!ref) return false;
    const idx = monthIdxOf(ref);
    return idx >= 0 && idx < 12;
  });
  if (msWindow.length) {
    const msCounts = Array.from({ length: 12 }, () => 0);
    msWindow.forEach((m) => { msCounts[monthIdxOf((m.plannedFinish || m.plannedStart) as string)] += 1; });
    const msMarkers: TimelineMarker[] = msWindow.slice(0, 9).map((m) => ({
      monthIdx: monthIdxOf((m.plannedFinish || m.plannedStart) as string),
      label: m.title.length > 22 ? `${m.title.slice(0, 21)}…` : m.title,
      color: m.status === 'completed' ? C.success : deriveDelayStatus(m, now) === 'delayed' ? C.critical : C.info,
    }));
    blocks.push(block(chartBlock({
      title: 'Marcos — Próximos 12 Meses',
      sub: `${fmtInt(msWindow.length)} marcos na janela`,
      svg: svgTimelineStrip(monthLabels, msMarkers, { width: 1000, counts: msCounts, accent: C.info }),
    }), mmForChart(128, { svgWidthPx: 1000, title: true })));
  }

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
  blocks.push(block(sectionTitle('Atividades Atrasadas / Em Risco', `${fmtInt(delayed.length)} atividades`, 2), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));
  blocks.push(block(delayed.length ? delayedTable : '<p class="empty">Nenhuma atividade atrasada ou em risco.</p>', delayed.length ? mmForTable(delayed.length) : 8));

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
  blocks.push(block(sectionTitle('Próximas Tarefas Críticas', undefined, 3), mmForSectionTitle(), { breakBefore: true, keepWithNext: true }));
  blocks.push(block(upcoming.length ? upcomingTable : '<p class="empty">Sem tarefas pendentes no horizonte.</p>', upcoming.length ? mmForTable(upcoming.length, { rowMm: 5.6 }) : 8));

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
  blocks.push(block(sectionTitle('Marcos', `${fmtInt(milestones.length)} marcos`), mmForSectionTitle(true), { keepWithNext: true }));
  blocks.push(block(milestones.length ? msTable : '<p class="empty">Sem marcos no cronograma.</p>', milestones.length ? mmForTable(milestones.length, { rowMm: 5.6 }) : 8));

  // ── Execução × Planejamento (só quando o apontamento é legível) ──
  const execRows = payload.execution ?? [];
  const execById = new Map(execRows.map((r) => [r.itemId, r]));
  // Só entram folhas com algum sinal de execução — listar o cronograma inteiro
  // com "—" em todas as colunas não informa nada.
  const execLeaves = leaves.filter((i) => {
    const row = execById.get(i.id);
    return row && ((row.loggedHours ?? 0) > 0 || row.plannedHours != null);
  });

  if (execRows.length > 0 && execLeaves.length > 0) {
    const execTable = dataTableChunked(
      [
        { key: 'wbs', label: 'EDT' },
        { key: 'title', label: 'Atividade' },
        { key: 'who', label: 'Colaboradores' },
        { key: 'planned', label: 'Plan.', num: true },
        { key: 'logged', label: 'Apont.', num: true },
        { key: 'delta', label: 'Δ', num: true },
        { key: 'last', label: 'Últ. apontamento' },
      ],
      execLeaves.map((i) => {
        const row = execById.get(i.id)!;
        const over = (row.variance ?? 0) > 0;
        return {
          wbs: { html: `<span class="mono">${esc(i.wbsCode ?? '—')}</span>` },
          title: i.title,
          who: row.collaborators.length ? row.collaborators.join(', ') : '—',
          planned: { html: `<span class="mono">${esc(fmtHoursCell(row.plannedHours))}</span>` },
          logged: { html: `<span class="mono">${esc(fmtHoursCell(row.loggedHours))}</span>` },
          delta: {
            html: `<span class="mono"${over ? ` style="color:${C.warning}"` : ''}>${esc(fmtVarianceCell(row.variance))}</span>`,
          },
          last: { html: `<span class="mono">${esc(row.lastActivityAt ? fmtDate(row.lastActivityAt.slice(0, 10)) : '—')}</span>` },
        };
      }),
    );
    blocks.push(block(
      sectionTitle('Execução × Planejamento', `${fmtInt(execLeaves.length)} atividades com apontamento`),
      mmForSectionTitle(true),
      { keepWithNext: true },
    ));
    // dataTableChunked já devolve blocos paginados — espalhar, não embrulhar.
    blocks.push(...execTable);
  }

  // ── Data quality ──
  const issues: string[] = [];
  if (!items.length) issues.push('Cronograma vazio — nenhuma atividade importada/cadastrada.');
  if (kpi.missingResponsible) issues.push(`${fmtInt(kpi.missingResponsible)} atividade(s) sem responsável.`);
  const noDates = leaves.filter((i) => !i.plannedFinish && !i.forecastFinish).length;
  if (noDates) issues.push(`${fmtInt(noDates)} atividade(s) sem data de término.`);
  // A ausência das horas é declarada, não silenciada: o leitor precisa saber
  // que a seção falta por permissão, não porque ninguém apontou.
  if (!payload.execution) {
    issues.push('Horas de apontamento não incluídas: sem permissão de leitura do timesheet.');
  } else {
    const noDuration = leaves.filter((i) => i.durationMinutes == null).length;
    if (noDuration) issues.push(`${fmtInt(noDuration)} atividade(s) sem duração — horas planejadas ausentes.`);
  }
  blocks.push(block(sectionTitle('Qualidade dos Dados'), mmForSectionTitle(), { keepWithNext: true }));
  blocks.push(block(dataQualityBox(issues), mmForWarningBox(Math.max(1, issues.length))));

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: `Cronograma · ${payload.projectName}`,
    pages: composePages(blocks, { orientation: 'landscape' }),
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
