/**
 * Riscos → board-ready PDF report on the shared engine.
 *
 * All risk math comes from the SAME pure selectors used by the on-screen Risk
 * Control Room (computeRiskSummary, computeSeverityDistribution,
 * computeOwnerDistribution, computeExposureTrend, computePipeline,
 * computeMatrixCells). This module performs no risk computation — only layout.
 */

import type { ExtendedRisk } from '@/components/risks/risk-types';
import { SEVERITY_LABELS, STATUS_LABELS } from '@/components/risks/risk-types';
import {
  computeRiskSummary,
  computeSeverityDistribution,
  computeOwnerDistribution,
  computeExposureTrend,
  computePipeline,
  computeMatrixCells,
  riskExposure,
  isOverdue,
  hasActionPlan,
} from '@/components/risks/risk-analytics';
import { BRL, compactBRL, esc, fmtDate, fmtInt } from '@/lib/reports/report-formatters';
import { C } from '@/lib/reports/report-theme';
import { svgRiskMatrix, svgDonut, svgLineChart, svgHorizontalBar, legend } from '@/lib/reports/report-charts';
import {
  reportCover, sectionTitle, kpiGrid, chartBlock, dataTable, dataQualityBox, summaryBox,
  type KpiCardSpec,
} from '@/lib/reports/report-blocks';
import { renderReportDocument } from '@/lib/reports/report-shell';
import { openReport, buildReportMeta, buildReportFileName } from '@/lib/reports/report-export';
import type { ReportExportResult } from '@/lib/reports/report-types';

export interface RiskReportPayload {
  risks: ExtendedRisk[];
  brandName?: string;
  /** Period / scope label for the cover. */
  periodLabel?: string;
  /** Human-readable active filters. */
  filtersLabel?: string;
  /** "Supabase" | "demonstração" — surfaces demo data. */
  source?: string;
  generatedBy?: string;
}

const SEV_COLOR: Record<ExtendedRisk['severity'], string> = {
  critical: C.critical,
  high: C.cost,
  medium: C.warning,
  low: C.success,
};

const SEV_PILL: Record<ExtendedRisk['severity'], 'crit' | 'warn' | 'ok'> = {
  critical: 'crit',
  high: 'warn',
  medium: 'warn',
  low: 'ok',
};

export function buildRiskReportHtml(payload: RiskReportPayload): string {
  const risks = payload.risks ?? [];
  const brand = payload.brandName ?? 'INSIGHT — Governança Corporativa';
  const fileName = buildReportFileName({ module: 'riscos' });
  const meta = buildReportMeta({
    brand,
    periodLabel: payload.periodLabel,
    filtersLabel: payload.filtersLabel,
    source: payload.source,
    generatedBy: payload.generatedBy,
  });

  const summary = computeRiskSummary(risks);
  const severity = computeSeverityDistribution(risks);
  const owners = computeOwnerDistribution(risks);
  const trend = computeExposureTrend(risks, 6);
  const pipeline = computePipeline(risks);
  const matrixCells = computeMatrixCells(risks);

  const cover = reportCover({
    meta,
    kicker: 'Relatório Executivo · Riscos',
    title: 'Matriz de Riscos Corporativos',
    context: `<b>${fmtInt(summary.total)}</b> riscos no escopo<span class="sep">·</span>exposição total <b>${esc(compactBRL(summary.totalExposure))}</b>`,
  });

  // ── Executive summary ──
  const narrative = summaryBox([
    `${fmtInt(summary.total)} riscos mapeados — ${fmtInt(summary.critical)} críticos, ${fmtInt(summary.high)} altos, ${fmtInt(summary.medium)} médios e ${fmtInt(summary.low)} baixos. Índice corporativo de exposição em ${summary.score.toFixed(1)}/10.`,
    `${fmtInt(summary.open)} em aberto e ${fmtInt(summary.mitigating)} em mitigação; ${fmtInt(summary.overdue)} com mitigação atrasada. ${summary.withPlanPct}% dos riscos ativos têm plano de ação e ${summary.onTimePct}% estão dentro do prazo.`,
    `Exposição financeira total de ${BRL(summary.totalExposure)} (${BRL(summary.openExposure)} em riscos ainda ativos).`,
  ]);

  const kpiCards: KpiCardSpec[] = [
    { label: 'Total de riscos', value: fmtInt(summary.total), color: C.primary },
    { label: 'Críticos', value: fmtInt(summary.critical), color: C.critical, chip: summary.critical > 0 ? { label: 'atenção', cls: 'crit' } : undefined },
    { label: 'Altos', value: fmtInt(summary.high), color: C.cost },
    { label: 'Médios / Baixos', value: `${fmtInt(summary.medium)} / ${fmtInt(summary.low)}`, color: C.warning },
    { label: 'Em aberto', value: fmtInt(summary.open), color: C.info, helper: `${fmtInt(summary.mitigating)} em mitigação` },
    { label: 'Mitigação atrasada', value: fmtInt(summary.overdue), color: summary.overdue ? C.critical : C.success, chip: summary.overdue ? { label: 'crítico', cls: 'crit' } : undefined },
    { label: 'Índice de exposição', value: `${summary.score.toFixed(1)}/10`, color: C.purple, helper: `${summary.withPlanPct}% com plano` },
    { label: 'Exposição total', value: compactBRL(summary.totalExposure), color: C.cost, helper: `aberta ${compactBRL(summary.openExposure)}` },
  ];
  const kpis = `${sectionTitle('Resumo Executivo de Riscos')}${narrative}<div style="margin-top:10px">${kpiGrid(kpiCards)}</div>`;

  // ── Matrix + severity donut ──
  const cells5x5: number[][] = Array.from({ length: 5 }, () => Array(5).fill(0));
  matrixCells.forEach((c) => { cells5x5[c.probability - 1][c.impact - 1] = c.count; });
  const matrixBlock = chartBlock({
    title: 'Matriz 5×5 — Probabilidade × Impacto',
    sub: 'número de riscos por célula',
    svg: svgRiskMatrix(cells5x5, { width: 420 }),
  });
  const donutBlock = chartBlock({
    title: 'Distribuição por Severidade',
    svg: svgDonut(
      severity.map((s) => ({ label: s.label, value: s.value, color: SEV_COLOR[s.key] })),
      { width: 360, centerLabel: fmtInt(summary.total), fmtValue: (n) => fmtInt(n) },
    ),
  });
  const matrixSection = `${sectionTitle('Matriz & Severidade')}<div class="two-col">${matrixBlock}${donutBlock}</div>`;

  // ── Trend + owners ──
  const trendBlock = chartBlock({
    title: 'Tendência de Riscos (6 meses)',
    sub: 'contagem por severidade ao longo do tempo',
    svg: svgLineChart(
      trend.map((t) => t.month),
      [
        { name: 'Críticos', color: C.critical, values: trend.map((t) => t.critical), endLabel: true },
        { name: 'Altos', color: C.cost, values: trend.map((t) => t.high), endLabel: true },
        { name: 'Médios', color: C.warning, values: trend.map((t) => t.medium), endLabel: true },
      ],
      { width: 520, height: 230, fmtValue: (n) => fmtInt(n) },
    ),
    legendHtml: legend([
      { name: 'Críticos', color: C.critical },
      { name: 'Altos', color: C.cost },
      { name: 'Médios', color: C.warning },
    ]),
  });
  const ownersBlock = chartBlock({
    title: 'Top Responsáveis por Exposição',
    sub: 'exposição financeira acumulada por responsável',
    svg: svgHorizontalBar(
      owners.slice(0, 8).map((o) => ({ label: `${o.name} (${o.count})`, value: o.exposure })),
      { width: 520, fmtValue: compactBRL },
    ),
  });
  const trendSection = `${sectionTitle('Tendência & Concentração')}<div class="two-col">${trendBlock}${ownersBlock}</div>`;

  // ── Mitigation pipeline ──
  const pipelineTable = dataTable(
    [
      { key: 'etapa', label: 'Etapa' },
      { key: 'count', label: 'Riscos', num: true },
      { key: 'pct', label: '% do total', num: true },
      { key: 'conv', label: 'Conversão', num: true },
      { key: 'aging', label: 'Aging médio (d)', num: true },
      { key: 'overdue', label: 'Atrasados', num: true },
    ],
    pipeline.map((p) => ({
      etapa: p.label,
      count: fmtInt(p.count),
      pct: `${p.pct}%`,
      conv: `${p.conversion}%`,
      aging: fmtInt(p.avgAging),
      overdue: { html: p.overdue ? `<span class="pill crit">${fmtInt(p.overdue)}</span>` : '0' },
    })),
  );
  const pipelineSection = `${sectionTitle('Pipeline de Mitigação')}${pipelineTable}`;

  // ── Critical risks table (criticals + highs, capped) ──
  const ranked = [...risks]
    .sort((a, b) => b.level - a.level || riskExposure(b) - riskExposure(a))
    .filter((r) => r.severity === 'critical' || r.severity === 'high')
    .slice(0, 40);
  const riskTable = dataTable(
    [
      { key: 'titulo', label: 'Risco' },
      { key: 'sev', label: 'Severidade' },
      { key: 'prob', label: 'Prob.', num: true },
      { key: 'imp', label: 'Impacto', num: true },
      { key: 'owner', label: 'Responsável' },
      { key: 'status', label: 'Status' },
      { key: 'plano', label: 'Plano' },
      { key: 'due', label: 'Prazo' },
      { key: 'exp', label: 'Exposição', num: true },
    ],
    ranked.map((r) => ({
      titulo: r.title,
      sev: { html: `<span class="pill ${SEV_PILL[r.severity]}">${esc(SEVERITY_LABELS[r.severity])}</span>` },
      prob: fmtInt(r.probability),
      imp: fmtInt(r.impact),
      owner: r.responsibleName ?? 'Não atribuído',
      status: esc(STATUS_LABELS[r.status]),
      plano: { html: hasActionPlan(r) ? '<span class="pill ok">sim</span>' : '<span class="pill warn">não</span>' },
      due: { html: r.dueDate ? `<span class="${isOverdue(r) ? '' : 'mono'}" style="${isOverdue(r) ? `color:${C.critical};font-weight:700` : ''}">${esc(fmtDate(r.dueDate))}${isOverdue(r) ? ' ⚠' : ''}</span>` : '—' },
      exp: { html: `<span class="mono">${esc(BRL(riskExposure(r)))}</span>` },
    })),
  );
  const tableSection = `${sectionTitle('Riscos Críticos & Altos', `${fmtInt(ranked.length)} riscos prioritários — ordenados por nível e exposição`)}${ranked.length ? riskTable : '<p class="empty">Nenhum risco crítico ou alto no escopo atual.</p>'}`;

  // ── Data quality ──
  const issues: string[] = [];
  if (!risks.length) issues.push('Nenhum risco no recorte selecionado — verifique filtros ou base de dados.');
  const noExposure = risks.filter((r) => typeof r.financialExposure !== 'number').length;
  if (noExposure) issues.push(`${fmtInt(noExposure)} risco(s) sem exposição financeira informada — valores estimados a partir do nível (probabilidade × impacto).`);
  const noDue = risks.filter((r) => r.status !== 'resolved' && !r.dueDate).length;
  if (noDue) issues.push(`${fmtInt(noDue)} risco(s) ativo(s) sem prazo de mitigação definido.`);
  const noOwner = risks.filter((r) => !r.responsibleName).length;
  if (noOwner) issues.push(`${fmtInt(noOwner)} risco(s) sem responsável atribuído.`);
  const dqSection = `${sectionTitle('Qualidade dos Dados')}${dataQualityBox(issues)}`;

  const page1 = `<section class="section">${cover}</section><section class="section">${kpis}</section>`;
  const page2 = `<section class="section">${matrixSection}</section><section class="section">${trendSection}</section>`;
  const page3 = `<section class="section">${pipelineSection}</section><section class="section">${tableSection}</section><section class="section">${dqSection}</section>`;

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: 'Riscos Corporativos',
    pages: [page1, page2, page3],
    orientation: 'landscape',
  });
}

export function openRiskReport(payload: RiskReportPayload): ReportExportResult {
  try {
    return openReport(buildRiskReportHtml(payload), { width: 1280, height: 860 });
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : 'Falha ao gerar o relatório.' };
  }
}
