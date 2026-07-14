/**
 * Riscos → board-ready PDF report on the shared engine (premium executive
 * layout — composePages + 2.5D charts + insight cards).
 *
 * All risk math comes from the SAME pure selectors used by the on-screen Risk
 * Control Room (computeRiskSummary, computeSeverityDistribution,
 * computeOwnerDistribution, computeExposureTrend, computePipeline,
 * computeMatrixCells, computeHeatmap, computeWaterfall, computeInsights).
 * This module performs no risk computation — only layout.
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
  computeHeatmap,
  computeWaterfall,
  computeInsights,
  riskExposure,
  isOverdue,
  hasActionPlan,
} from '@/components/risks/risk-analytics';
import { BRL, compactBRL, esc, fmtDate, fmtInt } from '@/lib/reports/report-formatters';
import { C, REPORT_BRAND_NAME } from '@/lib/reports/report-theme';
import {
  svgRiskMatrix, svgDonut, svgGauge, svgLineChart, svgHorizontalBar,
  svgHeatmapGrid, svgWaterfall, legend,
} from '@/lib/reports/report-charts';
import {
  reportCover, sectionTitle, kpiGrid, chartBlock, dataTable, dataTableChunked,
  dataQualityBox, summaryBox, type KpiCardSpec,
} from '@/lib/reports/report-blocks';
import {
  composePages, block, mmForChart, mmForColumns, mmForCover, mmForKpiGrid,
  mmForSectionTitle, mmForSummary, mmForTable, mmForWarningBox, type ReportBlock,
} from '@/lib/reports/report-compose';
import { insightPanel, mmForInsightPanel, type InsightItem } from '@/lib/reports/report-insights';
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
  const brand = payload.brandName ?? REPORT_BRAND_NAME;
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
  const heatmap = computeHeatmap(risks);
  const waterfall = computeWaterfall(risks);
  const exec = computeInsights(risks, trend);
  const blocks: ReportBlock[] = [];

  /* ── 01 · Resumo Executivo ── */

  blocks.push(block(reportCover({
    meta,
    kicker: 'Relatório Executivo · Riscos',
    title: 'Matriz de Riscos Corporativos',
    context: `<b>${fmtInt(summary.total)}</b> riscos no escopo<span class="sep">·</span>exposição total <b>${esc(compactBRL(summary.totalExposure))}</b>`,
    coverKpis: [
      { label: 'Riscos', value: fmtInt(summary.total) },
      { label: 'Críticos', value: fmtInt(summary.critical) },
      { label: 'Exposição total', value: compactBRL(summary.totalExposure) },
      { label: 'Índice', value: `${summary.score.toFixed(1)}/10` },
    ],
  }), mmForCover(true)));

  const narrativeParas = [
    `${fmtInt(summary.total)} riscos mapeados — ${fmtInt(summary.critical)} críticos, ${fmtInt(summary.high)} altos, ${fmtInt(summary.medium)} médios e ${fmtInt(summary.low)} baixos. Índice corporativo de exposição em ${summary.score.toFixed(1)}/10.`,
    `${fmtInt(summary.open)} em aberto e ${fmtInt(summary.mitigating)} em mitigação; ${fmtInt(summary.overdue)} com mitigação atrasada. ${summary.withPlanPct}% dos riscos ativos têm plano de ação e ${summary.onTimePct}% estão dentro do prazo.`,
  ];
  const kpiCards: KpiCardSpec[] = [
    { label: 'Total de riscos', value: fmtInt(summary.total), color: C.primary },
    { label: 'Críticos', value: fmtInt(summary.critical), color: C.critical, chip: summary.critical > 0 ? { label: 'atenção', cls: 'crit' } : undefined },
    { label: 'Altos', value: fmtInt(summary.high), color: C.cost },
    { label: 'Médios / Baixos', value: `${fmtInt(summary.medium)} / ${fmtInt(summary.low)}`, color: C.warning },
    { label: 'Em aberto', value: fmtInt(summary.open), color: C.info, helper: `${fmtInt(summary.mitigating)} em mitigação` },
    { label: 'Mitigação atrasada', value: fmtInt(summary.overdue), color: summary.overdue ? C.critical : C.success, chip: summary.overdue ? { label: 'crítico', cls: 'crit' } : undefined },
    { label: 'Cobertura de planos', value: `${summary.withPlanPct}%`, color: C.purple, helper: `${summary.onTimePct}% no prazo` },
    { label: 'Exposição total', value: compactBRL(summary.totalExposure), color: C.cost, helper: `aberta ${compactBRL(summary.openExposure)}` },
  ];
  blocks.push(block(sectionTitle('Resumo Executivo de Riscos', undefined, 1), mmForSectionTitle(), { keepWithNext: true }));
  blocks.push(block(summaryBox(narrativeParas), mmForSummary(narrativeParas), { keepWithNext: true }));
  blocks.push(block(`<div style="margin-top:8px">${kpiGrid(kpiCards, 4)}</div>`, mmForKpiGrid(8, 4) + 3));

  /* ── 02 · Matriz, Severidade & Concentração ── */

  blocks.push(block(sectionTitle('Matriz & Concentração', 'probabilidade × impacto, severidade e exposição por área', 2), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));

  const cells5x5: number[][] = Array.from({ length: 5 }, () => Array(5).fill(0));
  matrixCells.forEach((c) => { cells5x5[c.probability - 1][c.impact - 1] = c.count; });
  const matrixBlock = chartBlock({
    title: 'Matriz 5×5 — Probabilidade × Impacto',
    sub: 'número de riscos por célula',
    svg: svgRiskMatrix(cells5x5, { width: 420 }),
  });
  const gaugeBlock = chartBlock({
    title: 'Índice Corporativo de Exposição',
    sub: `${summary.withPlanPct}% dos riscos ativos com plano de ação`,
    svg: svgGauge(summary.score * 10, {
      width: 490,
      height: 128,
      label: 'Exposição',
      valueText: `${summary.score.toFixed(1)}/10`,
      color: summary.score >= 7 ? C.critical : summary.score >= 4 ? C.warning : C.success,
      bands: [[0, 40, C.success], [40, 70, C.warning], [70, 100, C.critical]],
    }),
  });
  const donutBlock = chartBlock({
    title: 'Distribuição por Severidade',
    svg: svgDonut(
      severity.map((s) => ({ label: s.label, value: s.value, color: SEV_COLOR[s.key] })),
      { width: 490, height: 128, centerLabel: fmtInt(summary.total), fmtValue: (n) => fmtInt(n) },
    ),
  });
  const matrixH = 6 + (420 - 92) / 5 * 5 + 40; // svgRiskMatrix computed height
  blocks.push(block(
    `<div class="two-col"><div>${matrixBlock}</div><div>${gaugeBlock}${donutBlock}</div></div>`,
    mmForColumns(
      mmForChart(matrixH, { svgWidthPx: 420, cols: 2, title: true }),
      mmForChart(128, { svgWidthPx: 490, cols: 2, title: true }) * 2,
    ),
  ));

  const heatCells: number[][] = heatmap.rows.map(() => heatmap.cols.map(() => 0));
  heatmap.cells.forEach(([colIdx, rowIdx, count]) => { heatCells[rowIdx][colIdx] = count; });
  const heatBlock = chartBlock({
    title: 'Heatmap — Área × Severidade',
    sub: 'nº de riscos por área e severidade',
    svg: svgHeatmapGrid(heatmap.rows, heatmap.cols.map((c) => c.label), heatCells, { width: 1000, labelW: 150, color: C.critical }),
  });
  blocks.push(block(heatBlock, mmForChart(20 + heatmap.rows.length * 26 + 20, { svgWidthPx: 1000, title: true })));

  const trendBlock = chartBlock({
    title: 'Tendência de Riscos (6 meses)',
    sub: 'contagem por severidade ao longo do tempo',
    svg: svgLineChart(
      trend.map((t) => t.month),
      [
        { name: 'Críticos', color: C.critical, values: trend.map((t) => t.critical), endLabel: true, area: true },
        { name: 'Altos', color: C.cost, values: trend.map((t) => t.high), endLabel: true },
        { name: 'Médios', color: C.warning, values: trend.map((t) => t.medium), endLabel: true },
      ],
      // trend months are already pt-BR labels — bypass the YYYY-MM formatter
      { width: 490, height: 190, fmtValue: (n) => fmtInt(n), xLabel: (s) => s },
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
      owners.slice(0, 7).map((o) => ({ label: `${o.name} (${o.count})`, value: o.exposure })),
      { width: 490, fmtValue: compactBRL },
    ),
  });
  blocks.push(block(
    `<div class="two-col">${trendBlock}${ownersBlock}</div>`,
    mmForColumns(
      mmForChart(190, { svgWidthPx: 490, cols: 2, title: true, legend: true }),
      mmForChart(Math.min(owners.length, 7) * 26 + 8, { svgWidthPx: 490, cols: 2, title: true }),
    ),
  ));

  /* ── 03 · Pipeline & Evolução da Exposição ── */

  blocks.push(block(sectionTitle('Pipeline de Mitigação & Evolução', 'estágios de tratamento e ponte do nível agregado', 3), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));

  const waterfallBlock = chartBlock({
    title: 'Evolução do Nível Agregado de Risco',
    sub: 'ponte: carteira anterior → novos/escalados → mitigados/resolvidos → atual',
    svg: svgWaterfall(
      waterfall.map((s) => ({
        label: s.name,
        value: s.value,
        type: s.kind === 'total' ? 'total' as const : 'delta' as const,
        color: s.kind === 'total' ? C.primary : undefined,
      })),
      { width: 1000, height: 180, fmtValue: (n) => fmtInt(n) },
    ),
  });
  blocks.push(block(waterfallBlock, mmForChart(180, { svgWidthPx: 1000, title: true })));

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
  blocks.push(block(`<p class="chart-title">Pipeline de Mitigação</p>${pipelineTable}`, mmForTable(pipeline.length, { rowMm: 5.6 }) + 5));

  /* ── 04 · Insights Executivos ── */

  const insights: InsightItem[] = [];
  if (exec.topExposure) {
    insights.push({
      kind: 'fact',
      title: 'Maior exposição individual',
      detail: `"${exec.topExposure.title}" concentra a maior exposição financeira ativa da carteira.`,
      value: compactBRL(exec.topExposure.value),
    });
  }
  if (exec.criticalArea) {
    insights.push({
      kind: 'fact',
      title: 'Área mais crítica',
      detail: `${exec.criticalArea.name} lidera o score de risco (${exec.criticalArea.count} riscos ativos).`,
      value: exec.criticalArea.score.toFixed(1),
    });
  }
  if (exec.overdueMitigation.count) {
    insights.push({
      kind: 'alert',
      title: 'Mitigações atrasadas',
      detail: `${fmtInt(exec.overdueMitigation.count)} risco(s) com plano vencido, expondo ${compactBRL(exec.overdueMitigation.exposure)}.`,
      value: fmtInt(exec.overdueMitigation.count),
    });
  }
  if (summary.critical) {
    insights.push({
      kind: 'alert',
      title: 'Riscos críticos ativos',
      detail: `${fmtInt(summary.critical)} risco(s) na faixa crítica exigem plano de resposta imediato.`,
      value: fmtInt(summary.critical),
    });
  }
  if (exec.trend.direction !== 'flat') {
    insights.push({
      kind: exec.trend.direction === 'up' ? 'alert' : 'fact',
      title: exec.trend.direction === 'up' ? 'Tendência de alta' : 'Tendência de queda',
      detail: `Riscos críticos+altos ${exec.trend.direction === 'up' ? 'subiram' : 'caíram'} ${Math.abs(exec.trend.delta)} no período de 6 meses.`,
    });
  }
  if (exec.oldestRisk) {
    insights.push({
      kind: 'recommendation',
      title: 'Revisar risco mais antigo',
      detail: `"${exec.oldestRisk.title}" está aberto há ${fmtInt(exec.oldestRisk.aging)} dias — reavaliar plano ou aceitar formalmente.`,
    });
  }
  if (summary.withPlanPct < 80 && summary.open + summary.mitigating > 0) {
    insights.push({
      kind: 'recommendation',
      title: 'Ampliar cobertura de planos',
      detail: `Apenas ${summary.withPlanPct}% dos riscos ativos têm plano de ação — priorizar os de maior exposição.`,
      value: `${summary.withPlanPct}%`,
    });
  }
  const noOwner = risks.filter((r) => !r.responsibleName).length;
  if (noOwner) {
    insights.push({
      kind: 'data-quality',
      title: 'Riscos sem responsável',
      detail: `${fmtInt(noOwner)} risco(s) sem owner atribuído — accountability indefinida.`,
    });
  }

  const shownInsights = insights.slice(0, 8);
  if (shownInsights.length) {
    blocks.push(block(sectionTitle('Insights Executivos', 'leituras factuais geradas a partir dos dados deste relatório', 4), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));
    blocks.push(block(insightPanel(shownInsights, { cols: 2 }), mmForInsightPanel(shownInsights.length, 2)));
  }

  /* ── 05 · Apêndice ── */

  const ranked = [...risks]
    .sort((a, b) => b.level - a.level || riskExposure(b) - riskExposure(a))
    .filter((r) => r.severity === 'critical' || r.severity === 'high')
    .slice(0, 40);
  blocks.push(block(sectionTitle('Riscos Críticos & Altos', `${fmtInt(ranked.length)} riscos prioritários — ordenados por nível e exposição`, 5), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));
  if (ranked.length) {
    blocks.push(...dataTableChunked(
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
      { rowsPerChunk: 24 },
    ));
  } else {
    blocks.push(block('<p class="empty">Nenhum risco crítico ou alto no escopo atual.</p>', 8));
  }

  const issues: string[] = [];
  if (!risks.length) issues.push('Nenhum risco no recorte selecionado — verifique filtros ou base de dados.');
  const noExposure = risks.filter((r) => typeof r.financialExposure !== 'number').length;
  if (noExposure) issues.push(`${fmtInt(noExposure)} risco(s) sem exposição financeira informada — valores estimados a partir do nível (probabilidade × impacto).`);
  const noDue = risks.filter((r) => r.status !== 'resolved' && !r.dueDate).length;
  if (noDue) issues.push(`${fmtInt(noDue)} risco(s) ativo(s) sem prazo de mitigação definido.`);
  if (noOwner) issues.push(`${fmtInt(noOwner)} risco(s) sem responsável atribuído.`);
  blocks.push(block(sectionTitle('Qualidade dos Dados'), mmForSectionTitle(), { keepWithNext: true }));
  blocks.push(block(dataQualityBox(issues), mmForWarningBox(Math.max(1, issues.length))));

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: 'Riscos Corporativos',
    pages: composePages(blocks, { orientation: 'landscape' }),
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
