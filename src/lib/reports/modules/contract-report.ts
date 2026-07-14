/**
 * Contratos → board-ready PDF report on the shared engine (pilot of the
 * premium executive layout).
 *
 * Consumes the SAME enriched governance records used by the on-screen contracts
 * module (ContractGovernanceRecord from enrichContractsForGovernance) and the
 * SAME portfolio aggregation as the Executive Band
 * (computeContractPortfolioStats), so screen and PDF never diverge. The caller
 * passes the already-filtered records so the report matches the screen.
 *
 * Six chapters — Visão Executiva, Carteira & Exposição, Risco & Governança,
 * Renovações & Timeline, Insights Executivos, Apêndices — packed into pages by
 * composePages (sparse chapters merge; footer numbering stays accurate).
 */

import type { ContractGovernanceRecord } from '@/components/contracts/contract-governance-data';
import { computeContractPortfolioStats } from '@/components/contracts/contract-portfolio-stats';
import { BRL, compactBRL, esc, fmtDate, fmtInt } from '@/lib/reports/report-formatters';
import { C, REPORT_BRAND_NAME } from '@/lib/reports/report-theme';
import {
  svgDonut, svgGauge, svgHorizontalBar, svgStackedBar, svgWaterfall,
  svgHeatmapGrid, svgTimelineStrip, type TimelineMarker,
} from '@/lib/reports/report-charts';
import {
  reportCover, sectionTitle, kpiGrid, chartBlock, dataTable, dataTableChunked,
  dataQualityBox, warningBox, type KpiCardSpec,
} from '@/lib/reports/report-blocks';
import {
  composePages, block, mmForChart, mmForColumns, mmForCover, mmForKpiGrid,
  mmForSectionTitle, mmForTable, mmForWarningBox, type ReportBlock,
} from '@/lib/reports/report-compose';
import { insightPanel, mmForInsightPanel, type InsightItem } from '@/lib/reports/report-insights';
import { renderReportDocument } from '@/lib/reports/report-shell';
import { openReport, buildReportMeta, buildReportFileName } from '@/lib/reports/report-export';
import type { ReportExportResult } from '@/lib/reports/report-types';

export interface ContractReportPayload {
  records: ContractGovernanceRecord[];
  brandName?: string;
  periodLabel?: string;
  filtersLabel?: string;
  source?: string;
  generatedBy?: string;
}

const RENEWAL_LABEL: Record<ContractGovernanceRecord['renewalStatus'], string> = {
  expired: 'Vencido',
  critical: 'Crítico (≤30d)',
  attention: 'Atenção (≤90d)',
  planned: 'Planejado (≤180d)',
  stable: 'Estável',
};
const RENEWAL_COLOR: Record<ContractGovernanceRecord['renewalStatus'], string> = {
  expired: C.critical,
  critical: C.cost,
  attention: C.warning,
  planned: C.info,
  stable: C.success,
};
const OBLIGATION_LABEL: Record<ContractGovernanceRecord['obligations'][number]['status'], string> = {
  open: 'Em aberto',
  due_soon: 'Vence em breve',
  overdue: 'Atrasada',
  done: 'Concluída',
};

const renewalPill = (s: ContractGovernanceRecord['renewalStatus']): string =>
  `<span class="pill ${s === 'expired' || s === 'critical' ? 'crit' : s === 'attention' ? 'warn' : 'ok'}">${esc(RENEWAL_LABEL[s])}</span>`;

export function buildContractReportHtml(payload: ContractReportPayload): string {
  const records = payload.records ?? [];
  const brand = payload.brandName ?? REPORT_BRAND_NAME;
  const fileName = buildReportFileName({ module: 'contratos' });
  const meta = buildReportMeta({
    brand,
    periodLabel: payload.periodLabel,
    filtersLabel: payload.filtersLabel,
    source: payload.source,
    generatedBy: payload.generatedBy,
  });

  const stats = computeContractPortfolioStats(records);
  const allObligations = records.flatMap((r) => r.obligations);
  const blocks: ReportBlock[] = [];

  /* ── 01 · Visão Executiva ── */

  const cover = reportCover({
    meta,
    kicker: 'Relatório Executivo · Contratos',
    title: 'Carteira de Contratos',
    context: `<b>${fmtInt(records.length)}</b> contratos<span class="sep">·</span>valor total <b>${esc(compactBRL(stats.totalValue))}</b>`,
    coverKpis: [
      { label: 'Valor total', value: compactBRL(stats.totalValue) },
      { label: 'Execução financeira', value: `${stats.billedPct}%` },
      { label: 'Contratos', value: fmtInt(records.length) },
      { label: 'Alto risco', value: fmtInt(stats.highRisk) },
    ],
  });
  blocks.push(block(cover, mmForCover(true)));

  const kpiCards: KpiCardSpec[] = [
    { label: 'Valor total contratado', value: compactBRL(stats.totalValue), color: C.info, helper: `${fmtInt(records.length)} contratos` },
    { label: 'Faturado', value: compactBRL(stats.billedValue), color: C.success, helper: `${stats.billedPct}% do total` },
    { label: 'Saldo a faturar', value: compactBRL(stats.remainingValue), color: C.cost, helper: `${stats.backlogPct}% · ${fmtInt(stats.contractsWithBalance)} contratos com saldo` },
    { label: 'Exposição alto risco', value: compactBRL(stats.highRiskExposure), color: stats.highRisk ? C.critical : C.success, helper: `${fmtInt(stats.highRisk)} contratos` },
    { label: 'Vencendo ≤90d', value: fmtInt(stats.expiring), color: stats.expiring ? C.warning : C.success, helper: `${fmtInt(stats.within30)} em ≤30d`, chip: stats.within30 ? { label: 'urgente', cls: 'crit' } : undefined },
    { label: 'Obrigações atrasadas', value: fmtInt(stats.overdue), color: stats.overdue ? C.critical : C.success, helper: `${fmtInt(stats.contractsWithOverdue)} contratos` },
    { label: 'SLA médio de aprovação', value: `${fmtInt(stats.avgSla)}h`, color: C.primary, chip: { label: stats.slaLive ? 'ao vivo' : 'estimado', cls: stats.slaLive ? 'ok' : 'info' } },
    { label: 'Docs pendentes', value: fmtInt(stats.missingDocs), color: stats.missingDocs ? C.warning : C.success, helper: `${fmtInt(stats.contractsWithMissing)} contratos` },
  ];
  blocks.push(block(sectionTitle('Visão Executiva', 'indicadores consolidados da carteira', 1), mmForSectionTitle(true), { keepWithNext: true }));
  blocks.push(block(kpiGrid(kpiCards, 4), mmForKpiGrid(8, 4)));

  const gaugeBlock = chartBlock({
    title: 'Execução Financeira da Carteira',
    sub: `faturado ${compactBRL(stats.billedValue)} de ${compactBRL(stats.totalValue)}`,
    svg: svgGauge(stats.billedPct, { width: 490, height: 132, label: 'Faturado', sublabel: `${fmtInt(stats.contractsWithBalance)} contratos com saldo` }),
  });
  const compositionBlock = chartBlock({
    title: 'Composição Financeira',
    svg: svgDonut(
      [
        { label: 'Faturado', value: stats.billedValue, color: C.success },
        { label: 'A faturar', value: stats.remainingValue, color: C.cost },
      ],
      { width: 490, height: 132, centerLabel: compactBRL(stats.totalValue), fmtValue: compactBRL },
    ),
  });
  blocks.push(block(
    `<div class="two-col">${gaugeBlock}${compositionBlock}</div>`,
    mmForColumns(
      mmForChart(132, { svgWidthPx: 490, cols: 2, title: true }),
      mmForChart(132, { svgWidthPx: 490, cols: 2, title: true }),
    ),
  ));

  const alerts: string[] = [];
  if (stats.within30) alerts.push(`${fmtInt(stats.within30)} contrato(s) vencem em até 30 dias.`);
  if (stats.overdue) alerts.push(`${fmtInt(stats.overdue)} obrigação(ões) contratual(is) em atraso em ${fmtInt(stats.contractsWithOverdue)} contrato(s).`);
  const blocked = records.filter((r) => r.financialStatus === 'blocked');
  if (blocked.length) alerts.push(`${fmtInt(blocked.length)} contrato(s) com status financeiro bloqueado (${blocked.slice(0, 3).map((r) => r.code).join(', ')}${blocked.length > 3 ? '…' : ''}).`);
  if (stats.highRisk) alerts.push(`Exposição de ${compactBRL(stats.highRiskExposure)} em ${fmtInt(stats.highRisk)} contrato(s) de alto risco.`);
  if (alerts.length) blocks.push(block(warningBox('Principais alertas', alerts, 'crit'), mmForWarningBox(alerts.length)));

  /* ── 02 · Carteira & Exposição Financeira ── */

  blocks.push(block(sectionTitle('Carteira & Exposição Financeira', 'concentração, execução e saldo por contrato', 2), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));

  const byCompany: Record<string, number> = {};
  records.forEach((r) => { byCompany[r.companyName] = (byCompany[r.companyName] || 0) + r.totalValue; });
  const companyRows = Object.entries(byCompany).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  const topShare = stats.totalValue ? Math.round(((companyRows[0]?.value ?? 0) / stats.totalValue) * 100) : 0;
  const companyBlock = chartBlock({
    title: 'Valor por Empresa / Fornecedor',
    sub: `top ${companyRows.length} · maior concentração: ${companyRows[0] ? `${esc(companyRows[0].label)} (${topShare}%)` : '—'}`,
    svg: svgHorizontalBar(companyRows, { width: 490, fmtValue: compactBRL }),
  });
  const waterfallBlock = chartBlock({
    title: 'Do Contratado ao Saldo',
    sub: 'ponte financeira da carteira',
    svg: svgWaterfall(
      [
        { label: 'Contratado', value: stats.totalValue, type: 'total', color: C.info },
        { label: 'Faturado', value: -stats.billedValue },
        { label: 'Saldo a faturar', value: 0, type: 'total', color: C.cost },
      ],
      { width: 490, height: 170 },
    ),
  });
  blocks.push(block(
    `<div class="two-col">${companyBlock}${waterfallBlock}</div>`,
    mmForColumns(
      mmForChart(companyRows.length * 26 + 8, { svgWidthPx: 490, cols: 2, title: true }),
      mmForChart(170, { svgWidthPx: 490, cols: 2, title: true }),
    ),
  ));

  const topExposure = [...records].sort((a, b) => b.remainingValue - a.remainingValue).slice(0, 10);
  const exposureTable = dataTable(
    [
      { key: 'code', label: 'Contrato' },
      { key: 'company', label: 'Empresa' },
      { key: 'total', label: 'Contratado', num: true },
      { key: 'billed', label: 'Faturado', num: true },
      { key: 'saldo', label: 'Saldo', num: true },
      { key: 'exec', label: 'Execução', num: true },
      { key: 'renewal', label: 'Renovação' },
    ],
    topExposure.map((r) => ({
      code: r.code,
      company: r.companyName,
      total: { html: `<span class="mono">${esc(compactBRL(r.totalValue))}</span>` },
      billed: { html: `<span class="mono">${esc(compactBRL(r.billedValue))}</span>` },
      saldo: { html: `<span class="mono" style="font-weight:700">${esc(compactBRL(r.remainingValue))}</span>` },
      exec: r.totalValue ? `${Math.round((r.billedValue / r.totalValue) * 100)}%` : '—',
      renewal: { html: renewalPill(r.renewalStatus) },
    })),
  ).replace('</table>', `<tfoot><tr><td>Total (top ${topExposure.length})</td><td></td>` +
    `<td class="num">${esc(compactBRL(topExposure.reduce((s, r) => s + r.totalValue, 0)))}</td>` +
    `<td class="num">${esc(compactBRL(topExposure.reduce((s, r) => s + r.billedValue, 0)))}</td>` +
    `<td class="num">${esc(compactBRL(topExposure.reduce((s, r) => s + r.remainingValue, 0)))}</td><td></td><td></td></tr></tfoot></table>`);
  blocks.push(block(
    `<p class="chart-title">Maiores Exposições — Saldo a Faturar</p>${exposureTable}`,
    mmForTable(topExposure.length + 1, { rowMm: 5.6 }) + 5,
  ));

  /* ── 03 · Risco & Governança ── */

  blocks.push(block(sectionTitle('Risco & Governança', 'classificação de risco, obrigações e aprovações', 3), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));

  const riskColor = { low: C.success, medium: C.warning, high: C.critical } as const;
  const riskLabel = { low: 'Baixo', medium: 'Médio', high: 'Alto' } as const;
  const riskCounts = (['high', 'medium', 'low'] as const)
    .map((k) => ({ label: riskLabel[k], value: records.filter((r) => r.contract.riskClassification === k).length, color: riskColor[k] }))
    .filter((s) => s.value > 0);
  const riskBlock = chartBlock({
    title: 'Distribuição de Risco dos Contratos',
    svg: svgDonut(riskCounts, { width: 490, height: 132, centerLabel: fmtInt(records.length), fmtValue: fmtInt }),
  });

  const renewalKeys = ['expired', 'critical', 'attention', 'planned', 'stable'] as const;
  const heatValues = (['high', 'medium', 'low'] as const).map((rk) =>
    renewalKeys.map((nk) => records.filter((r) => r.contract.riskClassification === rk && r.renewalStatus === nk).length));
  const heatBlock = chartBlock({
    title: 'Risco × Janela de Renovação',
    sub: 'nº de contratos por combinação',
    svg: svgHeatmapGrid(
      ['Alto', 'Médio', 'Baixo'],
      ['Vencido', '≤30d', '≤90d', '≤180d', 'Estável'],
      heatValues,
      { width: 490, labelW: 60, color: C.critical },
    ),
  });
  blocks.push(block(
    `<div class="two-col">${riskBlock}${heatBlock}</div>`,
    mmForColumns(
      mmForChart(132, { svgWidthPx: 490, cols: 2, title: true }),
      mmForChart(3 * 26 + 40, { svgWidthPx: 490, cols: 2, title: true }),
    ),
  ));

  const oblByStatus = (['overdue', 'due_soon', 'open', 'done'] as const)
    .map((k) => ({
      label: OBLIGATION_LABEL[k],
      value: allObligations.filter((o) => o.status === k).length,
      color: k === 'overdue' ? C.critical : k === 'due_soon' ? C.warning : k === 'done' ? C.success : C.info,
    }))
    .filter((s) => s.value > 0);
  const oblBlock = chartBlock({
    title: 'Obrigações por Situação',
    sub: `${fmtInt(allObligations.length)} obrigações mapeadas`,
    svg: svgHorizontalBar(oblByStatus, { width: 490, fmtValue: fmtInt, labelW: 130 }),
  });

  const legalBlock = chartBlock({
    title: 'Aprovações Jurídicas e Financeiras',
    svg: svgStackedBar(
      [
        { label: 'Jurídico aprovado', value: records.filter((r) => r.legalStatus === 'approved').length, color: C.success },
        { label: 'Em revisão', value: records.filter((r) => r.legalStatus === 'review').length, color: C.warning },
        { label: 'Pendente', value: records.filter((r) => r.legalStatus === 'pending').length, color: C.critical },
      ],
      { width: 490, fmtValue: fmtInt },
    ) + svgStackedBar(
      [
        { label: 'Financeiro ok', value: records.filter((r) => r.financialStatus === 'ok').length, color: C.success },
        { label: 'Atenção', value: records.filter((r) => r.financialStatus === 'attention').length, color: C.warning },
        { label: 'Bloqueado', value: records.filter((r) => r.financialStatus === 'blocked').length, color: C.critical },
      ],
      { width: 490, fmtValue: fmtInt },
    ),
  });
  blocks.push(block(
    `<div class="two-col">${oblBlock}${legalBlock}</div>`,
    mmForColumns(
      mmForChart(oblByStatus.length * 26 + 8, { svgWidthPx: 490, cols: 2, title: true }),
      mmForChart(120, { svgWidthPx: 490, cols: 2, title: true }),
    ),
  ));

  const criticalObligations = allObligations
    .filter((o) => o.status === 'overdue' || o.status === 'due_soon')
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
    .slice(0, 8);
  if (criticalObligations.length) {
    const recByObl = new Map(records.flatMap((r) => r.obligations.map((o) => [o.id, r] as const)));
    const criticalTable = dataTable(
      [
        { key: 'titulo', label: 'Obrigação crítica' },
        { key: 'contrato', label: 'Contrato' },
        { key: 'owner', label: 'Responsável' },
        { key: 'due', label: 'Prazo' },
        { key: 'status', label: 'Situação' },
      ],
      criticalObligations.map((o) => ({
        titulo: o.title,
        contrato: recByObl.get(o.id)?.code ?? '—',
        owner: o.owner,
        due: { html: `<span class="mono" style="${o.status === 'overdue' ? `color:${C.critical};font-weight:700` : ''}">${esc(fmtDate(o.dueDate))}</span>` },
        status: { html: `<span class="pill ${o.status === 'overdue' ? 'crit' : 'warn'}">${esc(OBLIGATION_LABEL[o.status])}</span>` },
      })),
    );
    blocks.push(block(`<p class="chart-title">Obrigações Críticas — Atrasadas e Próximas do Prazo</p>${criticalTable}`, mmForTable(criticalObligations.length) + 6));
  }

  /* ── 04 · Renovações & Timeline ── */

  blocks.push(block(sectionTitle('Renovações & Timeline', 'vencimentos dos próximos 12 meses', 4), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));

  const now = new Date();
  const monthLabels: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const mon = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
    monthLabels.push(i === 0 || d.getMonth() === 0 ? `${mon} ${String(d.getFullYear()).slice(2)}` : mon);
  }
  const expiring12 = records.filter((r) => r.daysUntilExpiration != null && r.daysUntilExpiration >= 0 && r.daysUntilExpiration <= 365);
  const monthIdxFor = (days: number) => Math.min(11, Math.floor(days / 30.44));
  const expCounts = Array.from({ length: 12 }, () => 0);
  expiring12.forEach((r) => { expCounts[monthIdxFor(r.daysUntilExpiration as number)] += 1; });
  const expMarkers: TimelineMarker[] = [...expiring12]
    .sort((a, b) => b.totalValue - a.totalValue)
    .slice(0, 6)
    .map((r) => ({
      monthIdx: monthIdxFor(r.daysUntilExpiration as number),
      label: r.code,
      value: compactBRL(r.totalValue),
      color: RENEWAL_COLOR[r.renewalStatus],
    }));
  const expirationStrip = chartBlock({
    title: 'Vencimentos de Contratos — Próximos 12 Meses',
    sub: `${fmtInt(expiring12.length)} contratos com vencimento na janela · marcadores = maiores valores`,
    svg: svgTimelineStrip(monthLabels, expMarkers, { width: 1000, counts: expCounts, accent: C.warning }),
  });
  blocks.push(block(expirationStrip, mmForChart(expMarkers.length ? 128 : 68, { svgWidthPx: 1000, title: true })));

  const oblCounts = Array.from({ length: 12 }, () => 0);
  allObligations
    .filter((o) => o.status !== 'done')
    .forEach((o) => {
      const days = Math.floor((o.dueDate.getTime() - now.getTime()) / 86_400_000);
      if (days >= 0 && days <= 365) oblCounts[monthIdxFor(days)] += 1;
    });
  const renewalDonut = chartBlock({
    title: 'Contratos por Status de Renovação',
    svg: svgDonut(
      renewalKeys
        .map((k) => ({ label: RENEWAL_LABEL[k], value: records.filter((r) => r.renewalStatus === k).length, color: RENEWAL_COLOR[k] }))
        .filter((s) => s.value > 0),
      { width: 490, height: 132, centerLabel: fmtInt(records.length), fmtValue: fmtInt },
    ),
  });
  const oblStrip = chartBlock({
    title: 'Obrigações em Aberto por Mês de Vencimento',
    svg: svgTimelineStrip(monthLabels, [], { width: 490, counts: oblCounts, accent: C.info }),
  });
  blocks.push(block(
    `<div class="two-col">${renewalDonut}${oblStrip}</div>`,
    mmForColumns(
      mmForChart(132, { svgWidthPx: 490, cols: 2, title: true }),
      mmForChart(68, { svgWidthPx: 490, cols: 2, title: true }),
    ),
  ));

  const expiring180 = records
    .filter((r) => r.daysUntilExpiration != null && r.daysUntilExpiration >= 0 && r.daysUntilExpiration <= 180)
    .sort((a, b) => (a.daysUntilExpiration as number) - (b.daysUntilExpiration as number))
    .slice(0, 8);
  if (expiring180.length) {
    const renewTable = dataTable(
      [
        { key: 'code', label: 'Contrato' },
        { key: 'company', label: 'Empresa' },
        { key: 'valor', label: 'Valor', num: true },
        { key: 'saldo', label: 'Saldo', num: true },
        { key: 'dias', label: 'Vence em', num: true },
        { key: 'renewal', label: 'Status' },
        { key: 'owner', label: 'Gestor' },
      ],
      expiring180.map((r) => ({
        code: r.code,
        company: r.companyName,
        valor: { html: `<span class="mono">${esc(compactBRL(r.totalValue))}</span>` },
        saldo: { html: `<span class="mono">${esc(compactBRL(r.remainingValue))}</span>` },
        dias: { html: `<span class="mono" style="${(r.daysUntilExpiration as number) <= 30 ? `color:${C.critical};font-weight:700` : ''}">${fmtInt(r.daysUntilExpiration as number)}d</span>` },
        renewal: { html: renewalPill(r.renewalStatus) },
        owner: r.owner,
      })),
    );
    blocks.push(block(`<p class="chart-title">Contratos Vencendo em até 180 Dias</p>${renewTable}`, mmForTable(expiring180.length) + 6));
  }

  /* ── 05 · Insights Executivos ── */

  const insights: InsightItem[] = [];
  if (companyRows[0] && stats.totalValue) {
    insights.push({
      kind: 'fact',
      title: 'Concentração da carteira',
      detail: `${companyRows[0].label} responde por ${topShare}% do valor contratado (${compactBRL(companyRows[0].value)}).`,
      value: `${topShare}%`,
    });
  }
  if (stats.totalValue) {
    insights.push({
      kind: 'fact',
      title: 'Execução financeira',
      detail: `${compactBRL(stats.billedValue)} faturados de ${compactBRL(stats.totalValue)} contratados; saldo de ${compactBRL(stats.remainingValue)}.`,
      value: `${stats.billedPct}%`,
    });
  }
  const largestBalance = [...records].sort((a, b) => b.remainingValue - a.remainingValue)[0];
  if (largestBalance && largestBalance.remainingValue > 0) {
    insights.push({
      kind: 'fact',
      title: 'Maior saldo a faturar',
      detail: `${largestBalance.code} · ${largestBalance.companyName} concentra o maior saldo em aberto da carteira.`,
      value: compactBRL(largestBalance.remainingValue),
    });
  }
  const expiredCritical = records.filter((r) => r.renewalStatus === 'expired' || r.renewalStatus === 'critical');
  if (expiredCritical.length) {
    insights.push({
      kind: 'alert',
      title: 'Risco de renovação imediato',
      detail: `${fmtInt(expiredCritical.length)} contrato(s) vencidos ou vencendo em ≤30d, somando ${compactBRL(expiredCritical.reduce((s, r) => s + r.totalValue, 0))}.`,
      value: fmtInt(expiredCritical.length),
    });
  }
  if (stats.overdue) {
    insights.push({
      kind: 'alert',
      title: 'Obrigações contratuais em atraso',
      detail: `${fmtInt(stats.overdue)} obrigação(ões) vencida(s) em ${fmtInt(stats.contractsWithOverdue)} contrato(s) exigem regularização.`,
      value: fmtInt(stats.overdue),
    });
  }
  if (blocked.length) {
    insights.push({
      kind: 'alert',
      title: 'Faturamento bloqueado',
      detail: `${fmtInt(blocked.length)} contrato(s) com pendência financeira bloqueante (${compactBRL(blocked.reduce((s, r) => s + r.remainingValue, 0))} de saldo represado).`,
    });
  }
  if (stats.expiring) {
    insights.push({
      kind: 'recommendation',
      title: 'Priorizar pipeline de renovação',
      detail: `Iniciar tratativas para os ${fmtInt(stats.expiring)} contrato(s) que vencem em ≤90 dias antes da janela crítica de 30 dias.`,
    });
  }
  if (stats.missingDocs) {
    insights.push({
      kind: 'recommendation',
      title: 'Regularizar documentação',
      detail: `${fmtInt(stats.missingDocs)} documento(s) pendente(s) em ${fmtInt(stats.contractsWithMissing)} contrato(s) — condição para aprovação jurídica plena.`,
    });
  }
  const noExpiration = records.filter((r) => r.daysUntilExpiration == null).length;
  if (noExpiration) {
    insights.push({
      kind: 'data-quality',
      title: 'Vigência não cadastrada',
      detail: `${fmtInt(noExpiration)} contrato(s) sem data de expiração — janela de renovação não monitorável.`,
    });
  }
  if (stats.semProjeto) {
    insights.push({
      kind: 'data-quality',
      title: 'Contratos sem projeto vinculado',
      detail: `${fmtInt(stats.semProjeto)} contrato(s) sem vínculo com projeto, fora da visão consolidada de portfólio.`,
    });
  }

  const shownInsights = insights.slice(0, 9);
  if (shownInsights.length) {
    blocks.push(block(sectionTitle('Insights Executivos', 'leituras factuais geradas a partir dos dados deste relatório', 5), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));
    blocks.push(block(insightPanel(shownInsights, { cols: 2 }), mmForInsightPanel(shownInsights.length, 2)));
  }

  /* ── 06 · Apêndices ── */

  blocks.push(block(sectionTitle('Apêndice — Contratos', `${fmtInt(records.length)} contratos · top 60 por valor`, 6), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));
  const appendixRows = [...records].sort((a, b) => b.totalValue - a.totalValue).slice(0, 60);
  blocks.push(...dataTableChunked(
    [
      { key: 'code', label: 'Código' },
      { key: 'company', label: 'Empresa' },
      { key: 'project', label: 'Projeto' },
      { key: 'type', label: 'Tipo' },
      { key: 'total', label: 'Valor total', num: true },
      { key: 'billed', label: 'Faturado', num: true },
      { key: 'expira', label: 'Expira em', num: true },
      { key: 'renewal', label: 'Renovação' },
      { key: 'risk', label: 'Risco', num: true },
    ],
    appendixRows.map((r) => ({
      code: r.code,
      company: r.companyName,
      project: r.project ? `${r.project.codigo}` : '—',
      type: r.contractType,
      total: { html: `<span class="mono">${esc(BRL(r.totalValue))}</span>` },
      billed: { html: `<span class="mono">${esc(BRL(r.billedValue))}</span>` },
      expira: r.daysUntilExpiration == null ? '—' : `${fmtInt(r.daysUntilExpiration)}d`,
      renewal: { html: renewalPill(r.renewalStatus) },
      risk: fmtInt(r.riskScore),
    })),
    {
      rowsPerChunk: 30,
      rowMm: 4.6,
      totalsRow: {
        code: `Total (${fmtInt(appendixRows.length)})`,
        total: { html: `<span class="mono">${esc(BRL(appendixRows.reduce((s, r) => s + r.totalValue, 0)))}</span>` },
        billed: { html: `<span class="mono">${esc(BRL(appendixRows.reduce((s, r) => s + r.billedValue, 0)))}</span>` },
      },
    },
  ));

  const oblRows = records.flatMap((r) => r.obligations.map((o) => ({ rec: r, o })))
    .sort((a, b) => a.o.dueDate.getTime() - b.o.dueDate.getTime())
    .slice(0, 40);
  if (oblRows.length) {
    blocks.push(block(sectionTitle('Apêndice — Obrigações', `${fmtInt(allObligations.length)} obrigações · próximas 40 por prazo`), mmForSectionTitle(true), { keepWithNext: true }));
    blocks.push(...dataTableChunked(
      [
        { key: 'titulo', label: 'Obrigação' },
        { key: 'contrato', label: 'Contrato' },
        { key: 'owner', label: 'Responsável' },
        { key: 'due', label: 'Prazo' },
        { key: 'status', label: 'Situação' },
      ],
      oblRows.map(({ rec, o }) => ({
        titulo: o.title,
        contrato: rec.code,
        owner: o.owner,
        due: { html: `<span class="mono" style="${o.status === 'overdue' ? `color:${C.critical};font-weight:700` : ''}">${esc(fmtDate(o.dueDate))}</span>` },
        status: { html: `<span class="pill ${o.status === 'overdue' ? 'crit' : o.status === 'due_soon' ? 'warn' : o.status === 'done' ? 'ok' : ''}">${esc(OBLIGATION_LABEL[o.status])}</span>` },
      })),
      { rowsPerChunk: 22 },
    ));
  }

  const clauseRows = records
    .flatMap((r) => r.clauses.filter((c) => c.category === 'SLA' || c.risk === 'high').map((c) => ({ rec: r, c })))
    .slice(0, 30);
  if (clauseRows.length) {
    blocks.push(block(sectionTitle('Apêndice — Cláusulas / Penalidades', 'SLA e alto risco'), mmForSectionTitle(true), { keepWithNext: true }));
    blocks.push(block(dataTable(
      [
        { key: 'titulo', label: 'Cláusula / penalidade' },
        { key: 'contrato', label: 'Contrato' },
        { key: 'cat', label: 'Categoria' },
        { key: 'risk', label: 'Risco' },
        { key: 'status', label: 'Status' },
      ],
      clauseRows.map(({ rec, c }) => ({
        titulo: c.title,
        contrato: rec.code,
        cat: c.category,
        risk: { html: `<span class="pill ${c.risk === 'high' ? 'crit' : c.risk === 'medium' ? 'warn' : 'ok'}">${esc(c.risk)}</span>` },
        status: c.status,
      })),
    ), mmForTable(clauseRows.length)));
  }

  const issues: string[] = [];
  if (!records.length) issues.push('Nenhum contrato no recorte selecionado.');
  if (noExpiration) issues.push(`${fmtInt(noExpiration)} contrato(s) sem data de expiração cadastrada.`);
  if (stats.contractsWithMissing) issues.push(`${fmtInt(stats.contractsWithMissing)} contrato(s) com documentos pendentes.`);
  if (stats.semProjeto) issues.push(`${fmtInt(stats.semProjeto)} contrato(s) sem projeto vinculado.`);
  if (stats.semIa) issues.push(`${fmtInt(stats.semIa)} contrato(s) com análise de IA pendente.`);
  blocks.push(block(sectionTitle('Qualidade dos Dados'), mmForSectionTitle(), { keepWithNext: true }));
  blocks.push(block(dataQualityBox(issues), mmForWarningBox(Math.max(1, issues.length))));

  const pages = composePages(blocks, { orientation: 'landscape' });

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: 'Carteira de Contratos',
    pages,
    orientation: 'landscape',
  });
}

export function openContractReport(payload: ContractReportPayload): ReportExportResult {
  try {
    return openReport(buildContractReportHtml(payload), { width: 1280, height: 860 });
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : 'Falha ao gerar o relatório.' };
  }
}
