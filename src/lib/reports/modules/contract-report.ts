/**
 * Contratos → board-ready PDF report on the shared engine.
 *
 * Consumes the SAME enriched governance records used by the on-screen contracts
 * module (ContractGovernanceRecord from enrichContractsForGovernance). The
 * caller passes the already-filtered records so the report matches the screen.
 */

import type { ContractGovernanceRecord } from '@/components/contracts/contract-governance-data';
import { BRL, compactBRL, esc, fmtDate, fmtInt } from '@/lib/reports/report-formatters';
import { C } from '@/lib/reports/report-theme';
import { svgDonut, svgHorizontalBar } from '@/lib/reports/report-charts';
import {
  reportCover, sectionTitle, kpiGrid, chartBlock, dataTable, dataQualityBox,
  type KpiCardSpec,
} from '@/lib/reports/report-blocks';
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

export function buildContractReportHtml(payload: ContractReportPayload): string {
  const records = payload.records ?? [];
  const brand = payload.brandName ?? 'INSIGHT — Governança Corporativa';
  const fileName = buildReportFileName({ module: 'contratos' });
  const meta = buildReportMeta({
    brand,
    periodLabel: payload.periodLabel,
    filtersLabel: payload.filtersLabel,
    source: payload.source,
    generatedBy: payload.generatedBy,
  });

  const totalValue = records.reduce((s, r) => s + r.totalValue, 0);
  const billedValue = records.reduce((s, r) => s + r.billedValue, 0);
  const remainingValue = records.reduce((s, r) => s + r.remainingValue, 0);
  const expiringSoon = records.filter((r) => r.renewalStatus === 'expired' || r.renewalStatus === 'critical').length;
  const highRisk = records.filter((r) => r.contract.riskClassification === 'high').length;
  const allObligations = records.flatMap((r) => r.obligations);
  const overdueObligations = allObligations.filter((o) => o.status === 'overdue').length;

  const cover = reportCover({
    meta,
    kicker: 'Relatório Executivo · Contratos',
    title: 'Carteira de Contratos',
    context: `<b>${fmtInt(records.length)}</b> contratos<span class="sep">·</span>valor total <b>${esc(compactBRL(totalValue))}</b>`,
  });

  const kpiCards: KpiCardSpec[] = [
    { label: 'Contratos', value: fmtInt(records.length), color: C.primary },
    { label: 'Valor total', value: compactBRL(totalValue), color: C.info },
    { label: 'Faturado', value: compactBRL(billedValue), color: C.success, helper: totalValue ? `${((billedValue / totalValue) * 100).toFixed(0)}% do total` : '—' },
    { label: 'A faturar', value: compactBRL(remainingValue), color: C.cost },
    { label: 'Vencendo / vencidos', value: fmtInt(expiringSoon), color: expiringSoon ? C.critical : C.success, chip: expiringSoon ? { label: 'atenção', cls: 'crit' } : undefined },
    { label: 'Alto risco', value: fmtInt(highRisk), color: highRisk ? C.warning : C.success, helper: `${fmtInt(overdueObligations)} obrigações atrasadas` },
  ];
  const kpis = `${sectionTitle('Indicadores da Carteira')}${kpiGrid(kpiCards)}`;

  // ── Renewal status donut + value by company ──
  const renewalCounts: Record<string, { value: number; color: string }> = {};
  (['expired', 'critical', 'attention', 'planned', 'stable'] as const).forEach((k) => {
    const v = records.filter((r) => r.renewalStatus === k).length;
    if (v) renewalCounts[RENEWAL_LABEL[k]] = { value: v, color: RENEWAL_COLOR[k] };
  });
  const statusBlock = chartBlock({
    title: 'Contratos por Status de Renovação',
    svg: svgDonut(
      Object.entries(renewalCounts).map(([label, v]) => ({ label, value: v.value, color: v.color })),
      { width: 360, centerLabel: fmtInt(records.length), fmtValue: fmtInt },
    ),
  });

  const byCompany: Record<string, number> = {};
  records.forEach((r) => { byCompany[r.companyName] = (byCompany[r.companyName] || 0) + r.totalValue; });
  const companyRows = Object.entries(byCompany).map(([name, value]) => ({ label: name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  const companyBlock = chartBlock({
    title: 'Valor por Empresa / Fornecedor',
    sub: 'top 8 por valor contratado',
    svg: svgHorizontalBar(companyRows, { width: 520, fmtValue: compactBRL }),
  });
  const chartsSection = `${sectionTitle('Distribuição da Carteira')}<div class="two-col">${statusBlock}${companyBlock}</div>`;

  // ── Risk distribution donut + obligations by status ──
  const riskColor = { low: C.success, medium: C.warning, high: C.critical } as const;
  const riskLabel = { low: 'Baixo', medium: 'Médio', high: 'Alto' } as const;
  const riskCounts = (['high', 'medium', 'low'] as const)
    .map((k) => ({ label: riskLabel[k], value: records.filter((r) => r.contract.riskClassification === k).length, color: riskColor[k] }))
    .filter((s) => s.value > 0);
  const riskBlock = chartBlock({
    title: 'Distribuição de Risco dos Contratos',
    svg: svgDonut(riskCounts, { width: 360, centerLabel: fmtInt(records.length), fmtValue: fmtInt }),
  });
  const oblByStatus = (['overdue', 'due_soon', 'open', 'done'] as const)
    .map((k) => ({ label: OBLIGATION_LABEL[k], value: allObligations.filter((o) => o.status === k).length }))
    .filter((s) => s.value > 0);
  const oblBlock = chartBlock({
    title: 'Obrigações por Situação',
    sub: `${fmtInt(allObligations.length)} obrigações mapeadas`,
    svg: svgHorizontalBar(oblByStatus, { width: 520, fmtValue: fmtInt, labelW: 130 }),
  });
  const riskSection = `${sectionTitle('Risco & Obrigações')}<div class="two-col">${riskBlock}${oblBlock}</div>`;

  // ── Appendix: contract list ──
  const contractTable = dataTable(
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
    [...records]
      .sort((a, b) => b.totalValue - a.totalValue)
      .slice(0, 60)
      .map((r) => ({
        code: r.code,
        company: r.companyName,
        project: r.project ? `${r.project.codigo}` : '—',
        type: r.contractType,
        total: { html: `<span class="mono">${esc(BRL(r.totalValue))}</span>` },
        billed: { html: `<span class="mono">${esc(BRL(r.billedValue))}</span>` },
        expira: r.daysUntilExpiration == null ? '—' : `${fmtInt(r.daysUntilExpiration)}d`,
        renewal: { html: `<span class="pill ${r.renewalStatus === 'expired' || r.renewalStatus === 'critical' ? 'crit' : r.renewalStatus === 'attention' ? 'warn' : 'ok'}">${esc(RENEWAL_LABEL[r.renewalStatus])}</span>` },
        risk: fmtInt(r.riskScore),
      })),
  );
  const listSection = `${sectionTitle('Apêndice — Contratos', `${fmtInt(records.length)} contratos · top 60 por valor`)}${records.length ? contractTable : '<p class="empty">Nenhum contrato no escopo atual.</p>'}`;

  // ── Appendix: obligations + clauses ──
  const oblTable = dataTable(
    [
      { key: 'titulo', label: 'Obrigação' },
      { key: 'contrato', label: 'Contrato' },
      { key: 'owner', label: 'Responsável' },
      { key: 'due', label: 'Prazo' },
      { key: 'status', label: 'Situação' },
    ],
    records.flatMap((r) => r.obligations.map((o) => ({ rec: r, o })))
      .sort((a, b) => a.o.dueDate.getTime() - b.o.dueDate.getTime())
      .slice(0, 40)
      .map(({ rec, o }) => ({
        titulo: o.title,
        contrato: rec.code,
        owner: o.owner,
        due: { html: `<span class="mono" style="${o.status === 'overdue' ? `color:${C.critical};font-weight:700` : ''}">${esc(fmtDate(o.dueDate))}</span>` },
        status: { html: `<span class="pill ${o.status === 'overdue' ? 'crit' : o.status === 'due_soon' ? 'warn' : o.status === 'done' ? 'ok' : ''}">${esc(OBLIGATION_LABEL[o.status])}</span>` },
      })),
  );
  const clauseTable = dataTable(
    [
      { key: 'titulo', label: 'Cláusula / penalidade' },
      { key: 'contrato', label: 'Contrato' },
      { key: 'cat', label: 'Categoria' },
      { key: 'risk', label: 'Risco' },
      { key: 'status', label: 'Status' },
    ],
    records.flatMap((r) => r.clauses.filter((c) => c.category === 'SLA' || c.risk === 'high').map((c) => ({ rec: r, c })))
      .slice(0, 30)
      .map(({ rec, c }) => ({
        titulo: c.title,
        contrato: rec.code,
        cat: c.category,
        risk: { html: `<span class="pill ${c.risk === 'high' ? 'crit' : c.risk === 'medium' ? 'warn' : 'ok'}">${esc(c.risk)}</span>` },
        status: c.status,
      })),
  );
  const appendix2 = `${sectionTitle('Apêndice — Obrigações')}${allObligations.length ? oblTable : '<p class="empty">Sem obrigações mapeadas.</p>'}${sectionTitle('Apêndice — Cláusulas / Penalidades (SLA e alto risco)')}${clauseTable}`;

  // ── Data quality ──
  const issues: string[] = [];
  if (!records.length) issues.push('Nenhum contrato no recorte selecionado.');
  const noExpiration = records.filter((r) => r.daysUntilExpiration == null).length;
  if (noExpiration) issues.push(`${fmtInt(noExpiration)} contrato(s) sem data de expiração cadastrada.`);
  const missingDocs = records.filter((r) => r.missingDocuments.length > 0).length;
  if (missingDocs) issues.push(`${fmtInt(missingDocs)} contrato(s) com documentos pendentes.`);
  const dqSection = `${sectionTitle('Qualidade dos Dados')}${dataQualityBox(issues)}`;

  const page1 = `<section class="section">${cover}</section><section class="section">${kpis}</section>`;
  const page2 = `<section class="section">${chartsSection}</section><section class="section">${riskSection}</section>`;
  const page3 = `<section class="section">${listSection}</section>`;
  const page4 = `<section class="section">${appendix2}</section><section class="section">${dqSection}</section>`;

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: 'Carteira de Contratos',
    pages: [page1, page2, page3, page4],
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
