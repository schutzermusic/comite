/**
 * Projeto · Overview → board-ready PDF report on the shared engine.
 *
 * Consumes the project detail data already loaded on screen (ProjectV2 + legacy
 * fallback): identity, status, financial KPIs, health, milestones, risks, tasks,
 * documents and team allocation. No business calculation — layout only.
 */

import type { ProjectV2, ProjectMilestone, ProjectRiskItem, ProjectTaskV2, ProjectDocument, MoneyAmount } from '@/lib/types/project-v2';
import { formatMoney } from '@/lib/utils/project-utils';
import { esc, fmtDate, fmtInt } from '@/lib/reports/report-formatters';
import { C } from '@/lib/reports/report-theme';
import { svgDonut } from '@/lib/reports/report-charts';
import {
  reportCover, sectionTitle, kpiGrid, chartBlock, dataTable, warningBox, dataQualityBox, summaryBox,
  type KpiCardSpec,
} from '@/lib/reports/report-blocks';
import { renderReportDocument } from '@/lib/reports/report-shell';
import { openReport, buildReportMeta, buildReportFileName } from '@/lib/reports/report-export';
import type { ReportExportResult } from '@/lib/reports/report-types';

export interface ProjectOverviewAllocation {
  memberName: string;
  role: string;
  allocationPercent: number;
}

export interface ProjectOverviewPayload {
  name: string;
  code: string;
  client?: string;
  status: string;
  statusLabel: string;
  responsible?: string;
  description?: string;
  startDate?: string | null;
  endDate?: string | null;
  progressPercent: number;
  healthScore?: number;
  healthReasons?: string[];
  revenue?: { totalContracted: MoneyAmount | number; billed: MoneyAmount | number; toBill: MoneyAmount | number };
  finance?: { bac: MoneyAmount | number; ac: MoneyAmount | number; eac: MoneyAmount | number; variancePercent: number };
  milestones: ProjectMilestone[];
  risks: ProjectRiskItem[];
  tasks: ProjectTaskV2[];
  documents: ProjectDocument[];
  allocations: ProjectOverviewAllocation[];
  brandName?: string;
  source?: string;
  generatedBy?: string;
}

const SEV_PILL: Record<string, 'crit' | 'warn' | 'ok' | ''> = { critical: 'crit', high: 'warn', medium: 'warn', low: 'ok' };
const SEV_LABEL: Record<string, string> = { critical: 'Crítico', high: 'Alto', medium: 'Médio', low: 'Baixo' };
const MS_LABEL: Record<string, string> = { pending: 'Pendente', completed: 'Concluído', overdue: 'Atrasado' };
const TASK_LABEL: Record<string, string> = { not_started: 'Não iniciada', in_progress: 'Em andamento', completed: 'Concluída', delayed: 'Atrasada' };

export function buildProjectOverviewReportHtml(payload: ProjectOverviewPayload): string {
  const brand = payload.brandName ?? 'INSIGHT — Governança Corporativa';
  const fileName = buildReportFileName({ module: 'projeto', context: `overview-${payload.code}` });
  const meta = buildReportMeta({
    brand,
    periodLabel: payload.startDate ? `Início ${fmtDate(payload.startDate)}${payload.endDate ? ` · Fim ${fmtDate(payload.endDate)}` : ''}` : undefined,
    source: payload.source,
    generatedBy: payload.generatedBy,
  });

  const cover = reportCover({
    meta,
    kicker: 'Relatório Executivo · Projeto',
    title: payload.name,
    context: `<b>${esc(payload.code)}</b>${payload.client ? `<span class="sep">·</span>${esc(payload.client)}` : ''}`,
    statusChip: { label: payload.statusLabel, color: payload.status === 'concluido' ? C.success : payload.status === 'cancelado' ? C.critical : payload.status === 'pausado' ? C.warning : C.info },
  });

  const openRisks = payload.risks.filter((r) => r.status !== 'resolved').length;
  const overdueMs = payload.milestones.filter((m) => m.status === 'overdue').length;
  const delayedTasks = payload.tasks.filter((t) => t.status === 'delayed').length;

  // ── Executive summary ──
  const narrative = summaryBox([
    `Projeto ${payload.name} (${payload.code})${payload.client ? ` para ${payload.client}` : ''} — status ${payload.statusLabel}, ${payload.progressPercent.toFixed(0)}% concluído${payload.healthScore != null ? `, health score ${fmtInt(payload.healthScore)}/100` : ''}.`,
    `${fmtInt(payload.milestones.length)} marcos (${fmtInt(overdueMs)} atrasados), ${fmtInt(payload.tasks.length)} tarefas (${fmtInt(delayedTasks)} atrasadas) e ${fmtInt(openRisks)} risco(s) em aberto.`,
    payload.responsible ? `Responsável: ${payload.responsible}.` : 'Responsável não definido.',
  ]);

  const kpiCards: KpiCardSpec[] = [
    { label: 'Progresso', value: `${payload.progressPercent.toFixed(0)}%`, color: C.primary },
    ...(payload.healthScore != null ? [{ label: 'Health score', value: `${fmtInt(payload.healthScore)}/100`, color: payload.healthScore >= 70 ? C.success : payload.healthScore >= 40 ? C.warning : C.critical } as KpiCardSpec] : []),
    ...(payload.revenue ? [
      { label: 'Contrato (receita)', value: formatMoney(payload.revenue.totalContracted, true), color: C.info } as KpiCardSpec,
      { label: 'Faturado', value: formatMoney(payload.revenue.billed, true), color: C.success } as KpiCardSpec,
      { label: 'A faturar', value: formatMoney(payload.revenue.toBill, true), color: C.warning } as KpiCardSpec,
    ] : []),
    ...(payload.finance ? [
      { label: 'EAC (custo)', value: formatMoney(payload.finance.eac, true), color: C.cost, helper: `variação ${payload.finance.variancePercent.toFixed(1)}%` } as KpiCardSpec,
    ] : []),
    { label: 'Riscos em aberto', value: fmtInt(openRisks), color: openRisks ? C.critical : C.success },
  ];
  const kpis = `${sectionTitle('Resumo do Projeto')}${narrative}<div style="margin-top:10px">${kpiGrid(kpiCards)}</div>`;

  // ── Health reasons ──
  const healthSection = payload.healthReasons && payload.healthReasons.length
    ? `${sectionTitle('Sinais de Saúde do Projeto')}${warningBox('Fatores considerados', payload.healthReasons, payload.healthScore != null && payload.healthScore < 50 ? 'warn' : 'ok')}`
    : '';

  // ── Milestones + risks ──
  const msTable = dataTable(
    [
      { key: 'name', label: 'Marco' },
      { key: 'date', label: 'Data' },
      { key: 'status', label: 'Status' },
    ],
    [...payload.milestones].sort((a, b) => (a.date || '').localeCompare(b.date || '')).map((m) => ({
      name: m.name,
      date: { html: `<span class="mono">${esc(fmtDate(m.date))}</span>` },
      status: { html: `<span class="pill ${m.status === 'overdue' ? 'crit' : m.status === 'completed' ? 'ok' : 'warn'}">${MS_LABEL[m.status] ?? m.status}</span>` },
    })),
  );
  const riskDonut = chartBlock({
    title: 'Riscos por severidade',
    svg: svgDonut(
      (['critical', 'high', 'medium', 'low'] as const).map((s) => ({ label: SEV_LABEL[s], value: payload.risks.filter((r) => r.severity === s).length, color: s === 'critical' ? C.critical : s === 'high' ? C.cost : s === 'medium' ? C.warning : C.success })).filter((x) => x.value > 0),
      { width: 360, centerLabel: fmtInt(payload.risks.length), fmtValue: (n) => fmtInt(n) },
    ),
  });
  const msSection = `${sectionTitle('Cronograma & Riscos')}<div class="two-col"><div><h3>Marcos</h3>${payload.milestones.length ? msTable : '<p class="empty">Sem marcos cadastrados.</p>'}</div>${riskDonut}</div>`;

  // ── Risks table ──
  const riskTable = dataTable(
    [
      { key: 'title', label: 'Risco' },
      { key: 'sev', label: 'Severidade' },
      { key: 'owner', label: 'Responsável' },
      { key: 'status', label: 'Status' },
      { key: 'exp', label: 'Exposição', num: true },
    ],
    [...payload.risks].sort((a, b) => b.level - a.level).slice(0, 20).map((r) => ({
      title: r.title,
      sev: { html: `<span class="pill ${SEV_PILL[r.severity] ?? ''}">${SEV_LABEL[r.severity] ?? r.severity}</span>` },
      owner: r.ownerName ?? '—',
      status: r.status === 'resolved' ? 'Resolvido' : r.status === 'mitigating' ? 'Mitigando' : 'Aberto',
      exp: { html: `<span class="mono">${r.exposure ? formatMoney(r.exposure, true) : '—'}</span>` },
    })),
  );
  const riskSection = `${sectionTitle('Riscos do Projeto', `${fmtInt(payload.risks.length)} riscos`)}${payload.risks.length ? riskTable : '<p class="empty">Nenhum risco cadastrado.</p>'}`;

  // ── Tasks (delayed/active focus) ──
  const focusTasks = [...payload.tasks].sort((a, b) => {
    const rank = (t: ProjectTaskV2) => (t.status === 'delayed' ? 0 : t.status === 'in_progress' ? 1 : 2);
    return rank(a) - rank(b) || (a.endDate || '').localeCompare(b.endDate || '');
  }).slice(0, 25);
  const taskTable = dataTable(
    [
      { key: 'name', label: 'Tarefa' },
      { key: 'resp', label: 'Responsável' },
      { key: 'fim', label: 'Término' },
      { key: 'prog', label: 'Progresso', num: true },
      { key: 'status', label: 'Status' },
    ],
    focusTasks.map((t) => ({
      name: t.name,
      resp: t.responsibleName ?? '—',
      fim: { html: `<span class="mono">${esc(fmtDate(t.endDate))}</span>` },
      prog: `${(t.progress ?? 0).toFixed(0)}%`,
      status: { html: `<span class="pill ${t.status === 'delayed' ? 'crit' : t.status === 'completed' ? 'ok' : 'warn'}">${TASK_LABEL[t.status] ?? t.status}</span>` },
    })),
  );
  const taskSection = `${sectionTitle('Tarefas (foco em atrasos e em andamento)', `${fmtInt(payload.tasks.length)} tarefas`)}${payload.tasks.length ? taskTable : '<p class="empty">Sem tarefas cadastradas.</p>'}`;

  // ── Team + documents ──
  const teamTable = dataTable(
    [
      { key: 'member', label: 'Membro' },
      { key: 'role', label: 'Papel' },
      { key: 'alloc', label: 'Alocação', num: true },
    ],
    payload.allocations.map((a) => ({
      member: a.memberName,
      role: a.role,
      alloc: { html: `<span class="mono"${a.allocationPercent > 100 ? ` style="color:${C.critical};font-weight:700"` : ''}>${a.allocationPercent}%</span>` },
    })),
  );
  const docTable = dataTable(
    [
      { key: 'name', label: 'Documento' },
      { key: 'cat', label: 'Categoria' },
      { key: 'ver', label: 'Versão', num: true },
      { key: 'date', label: 'Enviado' },
    ],
    [...payload.documents].sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || '')).slice(0, 20).map((d) => ({
      name: d.name,
      cat: d.category,
      ver: `v${d.version}`,
      date: { html: `<span class="mono">${esc(fmtDate(d.uploadedAt))}</span>` },
    })),
  );
  const teamDocSection = `${sectionTitle('Equipe & Documentos')}<div class="two-col"><div><h3>Equipe alocada</h3>${payload.allocations.length ? teamTable : '<p class="empty">Sem alocação registrada.</p>'}</div><div><h3>Documentos</h3>${payload.documents.length ? docTable : '<p class="empty">Sem documentos.</p>'}</div></div>`;

  // ── Data quality ──
  const issues: string[] = [];
  if (!payload.responsible) issues.push('Projeto sem responsável definido.');
  if (!payload.milestones.length) issues.push('Nenhum marco cadastrado.');
  if (payload.allocations.some((a) => a.allocationPercent > 100)) issues.push('Há membros com alocação acima de 100% (superalocação).');
  const dqSection = `${sectionTitle('Qualidade dos Dados')}${dataQualityBox(issues)}`;

  const page1 = `<section class="section">${cover}</section><section class="section">${kpis}</section>${healthSection ? `<section class="section">${healthSection}</section>` : ''}`;
  const page2 = `<section class="section">${msSection}</section><section class="section">${riskSection}</section>`;
  const page3 = `<section class="section">${taskSection}</section><section class="section">${teamDocSection}</section><section class="section">${dqSection}</section>`;

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: `${payload.name} · ${payload.code}`,
    pages: [page1, page2, page3],
    orientation: 'landscape',
  });
}

export function openProjectOverviewReport(payload: ProjectOverviewPayload): ReportExportResult {
  try {
    return openReport(buildProjectOverviewReportHtml(payload), { width: 1280, height: 860 });
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : 'Falha ao gerar o relatório.' };
  }
}
