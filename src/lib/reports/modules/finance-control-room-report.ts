/**
 * Financeiro · Control Room → board-ready PDF report on the shared engine.
 *
 * Consumes the SAME derived values the Sala Financeira Executiva renders
 * (managerial DRE rows + top variation drivers + hero metrics). All monetary
 * inputs are in CENTS (the finance-store convention) and converted to reais for
 * display only — no financial calculation happens here.
 */

import { BRL, compactBRL, esc, fmtInt } from '@/lib/reports/report-formatters';
import { C } from '@/lib/reports/report-theme';
import { svgHorizontalBar } from '@/lib/reports/report-charts';
import {
  reportCover, sectionTitle, kpiGrid, chartBlock, dataTable, dataQualityBox,
  type KpiCardSpec,
} from '@/lib/reports/report-blocks';
import { renderReportDocument } from '@/lib/reports/report-shell';
import { openReport, buildReportMeta, buildReportFileName } from '@/lib/reports/report-export';
import type { ReportExportResult } from '@/lib/reports/report-types';

/** Managerial DRE line — amounts in cents. */
export interface ControlRoomDreLine {
  label: string;
  actual: number;
  budget: number;
  forecast: number;
}

/** Top variation driver — amounts in cents. */
export interface ControlRoomDriver {
  categoryName: string;
  groupLabel?: string;
  projectName?: string;
  actual: number;
  budget: number;
  varianceAbs: number;
  variancePct: number;
}

export interface FinanceControlRoomReportPayload {
  periodLabel: string;
  scenarioLabel: string;
  source?: string;
  brandName?: string;
  generatedBy?: string;
  /** Hero metrics in cents (margins in %). */
  healthScore: number;
  netRevenue: number;
  ebitda: number;
  ebitdaMargin: number;
  operatingResult: number;
  forecastGap: number;
  cashRisk: number;
  pendingActions: number;
  dreRows: ControlRoomDreLine[];
  drivers: ControlRoomDriver[];
}

const c2r = (cents: number) => (cents ?? 0) / 100;

export function buildFinanceControlRoomReportHtml(payload: FinanceControlRoomReportPayload): string {
  const brand = payload.brandName ?? 'INSIGHT — Governança Corporativa';
  const fileName = buildReportFileName({ module: 'financeiro', context: 'control-room' });
  const meta = buildReportMeta({
    brand,
    periodLabel: payload.periodLabel,
    filtersLabel: `Cenário: ${payload.scenarioLabel}`,
    source: payload.source ?? 'demonstração',
    generatedBy: payload.generatedBy,
  });

  const cover = reportCover({
    meta,
    kicker: 'Relatório Executivo · Financeiro',
    title: 'Sala Financeira Executiva',
    context: `EBITDA <b>${esc(compactBRL(c2r(payload.ebitda)))}</b><span class="sep">·</span>margem ${payload.ebitdaMargin.toFixed(1)}%`,
  });

  const kpiCards: KpiCardSpec[] = [
    { label: 'Receita líquida', value: compactBRL(c2r(payload.netRevenue)), color: C.primary },
    { label: 'EBITDA', value: compactBRL(c2r(payload.ebitda)), color: C.success, helper: `margem ${payload.ebitdaMargin.toFixed(1)}%` },
    { label: 'Resultado operacional', value: compactBRL(c2r(payload.operatingResult)), color: C.info },
    { label: 'Gap vs orçado (fcst)', value: compactBRL(c2r(payload.forecastGap)), color: payload.forecastGap >= 0 ? C.success : C.critical, chip: payload.forecastGap < 0 ? { label: 'abaixo', cls: 'crit' } : undefined },
    { label: 'Health score', value: `${fmtInt(payload.healthScore)}/100`, color: C.purple },
    { label: 'Risco de caixa', value: compactBRL(c2r(payload.cashRisk)), color: payload.cashRisk < 0 ? C.critical : C.success, helper: `${fmtInt(payload.pendingActions)} ações pendentes` },
  ];
  const kpis = `${sectionTitle('Indicadores Executivos', `Cenário: ${esc(payload.scenarioLabel)}`)}${kpiGrid(kpiCards)}`;

  // ── DRE table ──
  const dreTable = dataTable(
    [
      { key: 'linha', label: 'Linha gerencial' },
      { key: 'real', label: 'Realizado', num: true },
      { key: 'orc', label: 'Orçado', num: true },
      { key: 'fcst', label: 'Forecast', num: true },
      { key: 'varr', label: 'Var. vs orçado', num: true },
    ],
    payload.dreRows.map((r) => {
      const varAbs = r.actual - r.budget;
      return {
        linha: r.label,
        real: { html: `<span class="mono">${esc(BRL(c2r(r.actual)))}</span>` },
        orc: { html: `<span class="mono">${esc(BRL(c2r(r.budget)))}</span>` },
        fcst: { html: `<span class="mono">${esc(BRL(c2r(r.forecast)))}</span>` },
        varr: { html: `<span class="mono" style="color:${varAbs >= 0 ? C.success : C.critical};font-weight:700">${esc(BRL(c2r(varAbs)))}</span>` },
      };
    }),
  );
  const dreSection = `${sectionTitle('Resultado Gerencial (DRE)', 'realizado × orçado × forecast')}${dreTable}`;

  // ── Top drivers ──
  const driverBars = chartBlock({
    title: 'Top Variações vs Orçado',
    sub: 'principais drivers de variação (R$)',
    svg: svgHorizontalBar(
      [...payload.drivers]
        .sort((a, b) => Math.abs(b.varianceAbs) - Math.abs(a.varianceAbs))
        .slice(0, 8)
        .map((d) => ({ label: `${d.categoryName}${d.projectName ? ` · ${d.projectName}` : ''}`, value: c2r(d.varianceAbs), color: d.varianceAbs >= 0 ? C.success : C.critical })),
      { width: 1040, fmtValue: compactBRL, labelW: 220 },
    ),
  });
  const driverTable = dataTable(
    [
      { key: 'cat', label: 'Categoria' },
      { key: 'grupo', label: 'Grupo' },
      { key: 'proj', label: 'Projeto' },
      { key: 'real', label: 'Realizado', num: true },
      { key: 'orc', label: 'Orçado', num: true },
      { key: 'var', label: 'Variação', num: true },
      { key: 'pct', label: 'Var. %', num: true },
    ],
    [...payload.drivers]
      .sort((a, b) => Math.abs(b.varianceAbs) - Math.abs(a.varianceAbs))
      .slice(0, 12)
      .map((d) => ({
        cat: d.categoryName,
        grupo: d.groupLabel ?? '—',
        proj: d.projectName ?? 'Corporativo',
        real: { html: `<span class="mono">${esc(BRL(c2r(d.actual)))}</span>` },
        orc: { html: `<span class="mono">${esc(BRL(c2r(d.budget)))}</span>` },
        var: { html: `<span class="mono" style="color:${d.varianceAbs >= 0 ? C.success : C.critical};font-weight:700">${esc(BRL(c2r(d.varianceAbs)))}</span>` },
        pct: `${d.variancePct >= 0 ? '+' : ''}${d.variancePct.toFixed(1)}%`,
      })),
  );
  const driverSection = `${sectionTitle('Drivers de Custo & Variação')}${driverBars}${payload.drivers.length ? driverTable : '<p class="empty">Sem variações relevantes no período.</p>'}`;

  // ── Data quality ──
  const issues: string[] = [];
  if (!payload.dreRows.length) issues.push('DRE gerencial sem linhas para o cenário/período selecionado.');
  if ((payload.source ?? 'demonstração') === 'demonstração') issues.push('Relatório gerado a partir de dados de demonstração da Sala Financeira.');
  const dqSection = `${sectionTitle('Qualidade dos Dados')}${dataQualityBox(issues)}`;

  const page1 = `<section class="section">${cover}</section><section class="section">${kpis}</section>`;
  const page2 = `<section class="section">${dreSection}</section>`;
  const page3 = `<section class="section">${driverSection}</section><section class="section">${dqSection}</section>`;

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: 'Sala Financeira Executiva',
    pages: [page1, page2, page3],
    orientation: 'landscape',
  });
}

export function openFinanceControlRoomReport(payload: FinanceControlRoomReportPayload): ReportExportResult {
  try {
    return openReport(buildFinanceControlRoomReportHtml(payload), { width: 1280, height: 860 });
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : 'Falha ao gerar o relatório.' };
  }
}
