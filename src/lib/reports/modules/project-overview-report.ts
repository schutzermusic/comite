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
import { C, REPORT_BRAND_NAME } from '@/lib/reports/report-theme';
import { svgDonut, svgGauge, svgBullet, svgTimelineStrip, type TimelineMarker } from '@/lib/reports/report-charts';
import {
  reportCover, sectionTitle, kpiGrid, chartBlock, dataTable, warningBox, dataQualityBox, summaryBox,
  type KpiCardSpec,
} from '@/lib/reports/report-blocks';
import {
  composePages, block, mmForChart, mmForColumns, mmForCover, mmForKpiGrid,
  mmForSectionTitle, mmForSummary, mmForTable, mmForWarningBox, type ReportBlock,
} from '@/lib/reports/report-compose';
import { insightPanel, mmForInsightPanel, type InsightItem } from '@/lib/reports/report-insights';
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
  const brand = payload.brandName ?? REPORT_BRAND_NAME;
  const fileName = buildReportFileName({ module: 'projeto', context: `overview-${payload.code}` });
  const meta = buildReportMeta({
    brand,
    periodLabel: payload.startDate ? `Início ${fmtDate(payload.startDate)}${payload.endDate ? ` · Fim ${fmtDate(payload.endDate)}` : ''}` : undefined,
    source: payload.source,
    generatedBy: payload.generatedBy,
  });

  const openRisks = payload.risks.filter((r) => r.status !== 'resolved').length;
  const overdueMs = payload.milestones.filter((m) => m.status === 'overdue').length;
  const delayedTasks = payload.tasks.filter((t) => t.status === 'delayed').length;
  const blocks: ReportBlock[] = [];

  blocks.push(block(reportCover({
    meta,
    kicker: 'Relatório Executivo · Projeto',
    title: payload.name,
    context: `<b>${esc(payload.code)}</b>${payload.client ? `<span class="sep">·</span>${esc(payload.client)}` : ''}`,
    statusChip: { label: payload.statusLabel, color: payload.status === 'concluido' ? C.success : payload.status === 'cancelado' ? C.critical : payload.status === 'pausado' ? C.warning : C.info },
    coverKpis: [
      { label: 'Progresso', value: `${payload.progressPercent.toFixed(0)}%` },
      ...(payload.healthScore != null ? [{ label: 'Health', value: `${fmtInt(payload.healthScore)}/100` }] : []),
      ...(payload.revenue ? [{ label: 'Contrato', value: formatMoney(payload.revenue.totalContracted, true) }] : []),
      { label: 'Riscos abertos', value: fmtInt(openRisks) },
    ],
  }), mmForCover(true)));

  // ── Executive summary ──
  const narrativeParas = [
    `Projeto ${payload.name} (${payload.code})${payload.client ? ` para ${payload.client}` : ''} — status ${payload.statusLabel}, ${payload.progressPercent.toFixed(0)}% concluído${payload.healthScore != null ? `, health score ${fmtInt(payload.healthScore)}/100` : ''}.`,
    `${fmtInt(payload.milestones.length)} marcos (${fmtInt(overdueMs)} atrasados), ${fmtInt(payload.tasks.length)} tarefas (${fmtInt(delayedTasks)} atrasadas) e ${fmtInt(openRisks)} risco(s) em aberto.${payload.responsible ? ` Responsável: ${payload.responsible}.` : ' Responsável não definido.'}`,
  ];
  const narrative = summaryBox(narrativeParas);

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
  blocks.push(block(sectionTitle('Resumo do Projeto', undefined, 1), mmForSectionTitle(), { keepWithNext: true }));
  blocks.push(block(narrative, mmForSummary(narrativeParas), { keepWithNext: true }));
  blocks.push(block(`<div style="margin-top:8px">${kpiGrid(kpiCards)}</div>`, mmForKpiGrid(kpiCards.length, kpiCards.length % 5 === 0 ? 5 : 4) + 3));

  // ── Progress gauge + cost bullet ──
  const progressGauge = chartBlock({
    title: 'Avanço Físico',
    sub: payload.healthScore != null ? `health score ${fmtInt(payload.healthScore)}/100` : undefined,
    svg: svgGauge(payload.progressPercent, {
      width: 490,
      height: 124,
      label: 'Concluído',
      color: payload.progressPercent >= 70 ? C.success : payload.progressPercent >= 40 ? C.primary : C.warning,
    }),
  });
  const centsOf = (m: MoneyAmount | number) => (typeof m === 'number' ? m : (m?.amountCents ?? 0) / 100);
  const financeBullet = payload.finance
    ? chartBlock({
      title: 'Execução de Custo — AC × EAC vs BAC',
      sub: `variação ${payload.finance.variancePercent.toFixed(1)}%`,
      svg: svgBullet(
        [
          { label: 'Custo real (AC)', value: centsOf(payload.finance.ac), target: centsOf(payload.finance.bac), color: C.cost },
          { label: 'Estimado (EAC)', value: centsOf(payload.finance.eac), target: centsOf(payload.finance.bac), color: C.info },
        ],
        { width: 490, fmtValue: (n) => formatMoney(n, true), labelW: 130 },
      ),
    })
    : payload.revenue
      ? chartBlock({
        title: 'Receita — Faturado × A Faturar',
        svg: svgDonut(
          [
            { label: 'Faturado', value: centsOf(payload.revenue.billed), color: C.success },
            { label: 'A faturar', value: centsOf(payload.revenue.toBill), color: C.cost },
          ],
          { width: 490, height: 124, centerLabel: formatMoney(payload.revenue.totalContracted, true), fmtValue: (n) => formatMoney(n, true) },
        ),
      })
      : '';
  if (financeBullet) {
    blocks.push(block(
      `<div class="two-col">${progressGauge}${financeBullet}</div>`,
      mmForColumns(
        mmForChart(124, { svgWidthPx: 490, cols: 2, title: true }),
        mmForChart(124, { svgWidthPx: 490, cols: 2, title: true }),
      ),
    ));
  } else {
    blocks.push(block(progressGauge, mmForChart(124, { svgWidthPx: 490, title: true })));
  }

  // ── Health reasons ──
  if (payload.healthReasons?.length) {
    blocks.push(block(
      warningBox('Sinais de saúde — fatores considerados', payload.healthReasons, payload.healthScore != null && payload.healthScore < 50 ? 'warn' : 'ok'),
      mmForWarningBox(payload.healthReasons.length),
    ));
  }

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
      { width: 490, height: 150, centerLabel: fmtInt(payload.risks.length), fmtValue: (n) => fmtInt(n) },
    ),
  });
  // ── Milestone timeline strip (next 12 months) ──
  blocks.push(block(sectionTitle('Cronograma & Riscos', undefined, 2), mmForSectionTitle(), { breakBefore: true, keepWithNext: true }));
  const now = new Date();
  const monthLabels: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const mon = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
    monthLabels.push(i === 0 || d.getMonth() === 0 ? `${mon} ${String(d.getFullYear()).slice(2)}` : mon);
  }
  const msWindow = payload.milestones.filter((m) => {
    const t = new Date(m.date).getTime();
    return t >= new Date(now.getFullYear(), now.getMonth(), 1).getTime() && t < new Date(now.getFullYear(), now.getMonth() + 12, 1).getTime();
  });
  const monthIdxOf = (iso: string) => {
    const d = new Date(iso);
    return (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth();
  };
  const msCounts = Array.from({ length: 12 }, () => 0);
  msWindow.forEach((m) => { msCounts[monthIdxOf(m.date)] += 1; });
  const msMarkers: TimelineMarker[] = msWindow.slice(0, 9).map((m) => ({
    monthIdx: monthIdxOf(m.date),
    label: m.name.length > 22 ? `${m.name.slice(0, 21)}…` : m.name,
    color: m.status === 'overdue' ? C.critical : m.status === 'completed' ? C.success : C.info,
  }));
  if (msWindow.length) {
    blocks.push(block(chartBlock({
      title: 'Marcos — Próximos 12 Meses',
      sub: `${fmtInt(msWindow.length)} marcos na janela`,
      svg: svgTimelineStrip(monthLabels, msMarkers, { width: 1000, counts: msCounts, accent: C.info }),
    }), mmForChart(msMarkers.length ? 128 : 68, { svgWidthPx: 1000, title: true })));
  }
  blocks.push(block(
    `<div class="two-col"><div><h3>Marcos</h3>${payload.milestones.length ? msTable : '<p class="empty">Sem marcos cadastrados.</p>'}</div>${riskDonut}</div>`,
    mmForColumns(
      mmForTable(payload.milestones.length, { rowMm: 5.6 }) + 6,
      mmForChart(150, { svgWidthPx: 490, cols: 2, title: true }),
    ),
  ));

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
  blocks.push(block(sectionTitle('Riscos do Projeto', `${fmtInt(payload.risks.length)} riscos`, 3), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));
  blocks.push(block(payload.risks.length ? riskTable : '<p class="empty">Nenhum risco cadastrado.</p>', payload.risks.length ? mmForTable(Math.min(payload.risks.length, 20)) : 8));

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
  blocks.push(block(sectionTitle('Tarefas (foco em atrasos e em andamento)', `${fmtInt(payload.tasks.length)} tarefas`, 4), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));
  blocks.push(block(payload.tasks.length ? taskTable : '<p class="empty">Sem tarefas cadastradas.</p>', payload.tasks.length ? mmForTable(focusTasks.length) : 8));

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
  blocks.push(block(sectionTitle('Equipe & Documentos', undefined, 5), mmForSectionTitle(), { breakBefore: true, keepWithNext: true }));
  blocks.push(block(
    `<div class="two-col"><div><h3>Equipe alocada</h3>${payload.allocations.length ? teamTable : '<p class="empty">Sem alocação registrada.</p>'}</div><div><h3>Documentos</h3>${payload.documents.length ? docTable : '<p class="empty">Sem documentos.</p>'}</div></div>`,
    mmForColumns(
      mmForTable(payload.allocations.length, { rowMm: 5 }) + 6,
      mmForTable(Math.min(payload.documents.length, 20), { rowMm: 5 }) + 6,
    ),
  ));

  // ── Insights ──
  const insights: InsightItem[] = [];
  if (overdueMs) insights.push({ kind: 'alert', title: 'Marcos atrasados', detail: `${fmtInt(overdueMs)} marco(s) vencido(s) sem conclusão registrada.`, value: fmtInt(overdueMs) });
  if (delayedTasks) insights.push({ kind: 'alert', title: 'Tarefas atrasadas', detail: `${fmtInt(delayedTasks)} tarefa(s) além do prazo previsto.`, value: fmtInt(delayedTasks) });
  if (payload.finance && payload.finance.variancePercent > 0) {
    insights.push({ kind: 'alert', title: 'Custo projetado acima do orçado', detail: `EAC ${formatMoney(payload.finance.eac, true)} contra BAC ${formatMoney(payload.finance.bac, true)} (${payload.finance.variancePercent.toFixed(1)}%).`, value: `+${payload.finance.variancePercent.toFixed(1)}%` });
  }
  if (payload.revenue) {
    const toBill = centsOf(payload.revenue.toBill);
    if (toBill > 0) insights.push({ kind: 'fact', title: 'Saldo a faturar', detail: `${formatMoney(payload.revenue.toBill, true)} do contrato ainda não faturados.`, value: formatMoney(payload.revenue.toBill, true) });
  }
  const superAlloc = payload.allocations.filter((a) => a.allocationPercent > 100);
  if (superAlloc.length) insights.push({ kind: 'recommendation', title: 'Rebalancear alocação', detail: `${fmtInt(superAlloc.length)} membro(s) acima de 100% de alocação: ${superAlloc.slice(0, 3).map((a) => a.memberName).join(', ')}.` });
  if (insights.length) {
    blocks.push(block(insightPanel(insights.slice(0, 6), { cols: 2 }), mmForInsightPanel(Math.min(insights.length, 6), 2)));
  }

  // ── Data quality ──
  const issues: string[] = [];
  if (!payload.responsible) issues.push('Projeto sem responsável definido.');
  if (!payload.milestones.length) issues.push('Nenhum marco cadastrado.');
  if (payload.allocations.some((a) => a.allocationPercent > 100)) issues.push('Há membros com alocação acima de 100% (superalocação).');
  blocks.push(block(sectionTitle('Qualidade dos Dados'), mmForSectionTitle(), { keepWithNext: true }));
  blocks.push(block(dataQualityBox(issues), mmForWarningBox(Math.max(1, issues.length))));

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: `${payload.name} · ${payload.code}`,
    pages: composePages(blocks, { orientation: 'landscape' }),
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
