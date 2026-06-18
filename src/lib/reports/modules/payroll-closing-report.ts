/**
 * Pessoas & Custos · Fechamento da Folha → board-ready PDF report.
 *
 * Consumes the on-screen closing state (batch + parse + AI narrative +
 * attachments + dispatches). Produces a board summary, cost-center breakdown,
 * an attachments SUMMARY (never embeds holerites) with an explicit sensitive-data
 * warning, and the finance hand-off status. Monetary inputs are in cents.
 */

import type {
  PayrollClosingBatch, PayrollParseResult, PayrollNarrative, PayrollAttachment, PayrollEmailDispatch,
  PayrollAttachmentFileType, PayrollSecurityLevel,
} from '@/lib/types/payroll-closing';
import { BRL, compactBRL, esc, fmtInt, fmtDate, periodLabel } from '@/lib/reports/report-formatters';
import { C } from '@/lib/reports/report-theme';
import { svgHorizontalBar } from '@/lib/reports/report-charts';
import {
  reportCover, sectionTitle, kpiGrid, chartBlock, dataTable, warningBox, dataQualityBox, summaryBox,
  type KpiCardSpec,
} from '@/lib/reports/report-blocks';
import { renderReportDocument } from '@/lib/reports/report-shell';
import { openReport, buildReportMeta, buildReportFileName } from '@/lib/reports/report-export';
import type { ReportExportResult } from '@/lib/reports/report-types';

export interface PayrollClosingReportPayload {
  batch: PayrollClosingBatch;
  parse?: PayrollParseResult | null;
  narrative?: PayrollNarrative | null;
  attachments: PayrollAttachment[];
  dispatches: PayrollEmailDispatch[];
  financeBatchId?: string | null;
  brandName?: string;
  source?: string;
  generatedBy?: string;
}

const STATUS_LABEL: Record<string, string> = {
  imported: 'Importado', validated: 'Validado', reviewed: 'Revisado', approved: 'Aprovado',
  sent_to_finance: 'Enviado ao Financeiro', posted: 'Contabilizado', cancelled: 'Cancelado',
};
const FILE_TYPE_LABEL: Record<PayrollAttachmentFileType, string> = {
  executive_pdf: 'PDF executivo', dashboard_snapshot: 'Snapshot dashboard', payroll_spreadsheet: 'Planilha de folha',
  bank_payment_spreadsheet: 'Planilha de pagamento', remittance_file: 'Arquivo de remessa', holerite: 'Holerite interno',
  external_holerite: 'Holerite externo', esocial: 'eSocial', tax_guide: 'Guia de tributo',
  supporting_document: 'Documento de apoio', other: 'Outro',
};
const SENSITIVE_LEVELS: PayrollSecurityLevel[] = ['confidential', 'hr_restricted', 'board_confidential', 'finance_restricted'];
const cents = (n?: number) => (n ?? 0) / 100;

export function buildPayrollClosingReportHtml(payload: PayrollClosingReportPayload): string {
  const { batch, parse, narrative, attachments, dispatches } = payload;
  const brand = payload.brandName ?? 'INSIGHT — Governança Corporativa';
  const fileName = buildReportFileName({ module: 'pessoas-custos', context: `fechamento-${batch.competence_month}` });
  const financeBatchId = payload.financeBatchId ?? batch.finance_batch_id;

  const meta = buildReportMeta({
    brand,
    periodLabel: `Competência ${periodLabel(batch.competence_month)}`,
    filtersLabel: `Status: ${STATUS_LABEL[batch.status] ?? batch.status}`,
    source: payload.source ?? 'Supabase',
    generatedBy: payload.generatedBy,
  });

  const total = batch.total_amount_cents;
  const variationPct = batch.variation_percentage;

  const cover = reportCover({
    meta,
    kicker: 'Relatório de Fechamento · Pessoas & Custos',
    title: 'Fechamento da Folha',
    context: `Competência <b>${esc(periodLabel(batch.competence_month))}</b><span class="sep">·</span>total <b>${esc(compactBRL(cents(total)))}</b>`,
    statusChip: { label: STATUS_LABEL[batch.status] ?? batch.status, color: batch.status === 'posted' || batch.status === 'sent_to_finance' ? C.success : batch.status === 'cancelled' ? C.critical : C.info },
  });

  // ── Sensitive-data warning (always shown) ──
  const sensitiveCount = attachments.filter((a) => SENSITIVE_LEVELS.includes(a.security_level)).length;
  const holeriteCount = attachments.filter((a) => a.file_type === 'holerite' || a.file_type === 'external_holerite').length;
  const sensitiveBox = warningBox(
    'Aviso de dados sensíveis',
    [
      'Este relatório apresenta apenas o RESUMO do fechamento (totais, centros de custo e status). Holerites e dados individuais NÃO são incluídos.',
      `${fmtInt(holeriteCount)} holerite(s) anexado(s) e ${fmtInt(sensitiveCount)} anexo(s) classificados como sensíveis permanecem no cofre seguro, com acesso restrito por RBAC.`,
      'Distribua este PDF apenas a destinatários autorizados (diretoria / financeiro).',
    ],
    'crit',
  );

  // ── Board summary ──
  const boardText = narrative?.board_summary || narrative?.executive_summary;
  const summarySection = `${sectionTitle('Sumário para a Diretoria', narrative?.generated_by_ai ? 'gerado por IA' : 'resumo determinístico')}`
    + (boardText ? summaryBox(boardText.split(/\n\n+/).slice(0, 4)) : '<p class="empty">Narrativa ainda não gerada.</p>')
    + (narrative?.attention_points?.length ? warningBox('Pontos de atenção', narrative.attention_points, 'warn') : '')
    + sensitiveBox;

  // ── KPIs ──
  const kpiCards: KpiCardSpec[] = [
    { label: 'Folha total', value: BRL(cents(total)), color: C.cost },
    { label: 'Variação vs mês ant.', value: `${variationPct >= 0 ? '+' : ''}${variationPct.toFixed(1)}%`, color: variationPct > 0 ? C.warning : C.success, helper: BRL(cents(batch.variation_amount_cents)) },
    ...(parse?.headcount != null ? [{ label: 'Headcount', value: fmtInt(parse.headcount), color: C.primary } as KpiCardSpec] : []),
    ...(parse?.clt_count != null || parse?.pj_count != null ? [{ label: 'CLT / PJ', value: `${fmtInt(parse?.clt_count ?? 0)} / ${fmtInt(parse?.pj_count ?? 0)}`, color: C.purple } as KpiCardSpec] : []),
    ...(parse?.gross_amount_cents != null ? [{ label: 'Bruto', value: compactBRL(cents(parse.gross_amount_cents)), color: C.info } as KpiCardSpec] : []),
    ...(parse?.charges_amount_cents != null ? [{ label: 'Encargos', value: compactBRL(cents(parse.charges_amount_cents)), color: C.warning } as KpiCardSpec] : []),
    ...(parse?.benefits_amount_cents != null ? [{ label: 'Benefícios', value: compactBRL(cents(parse.benefits_amount_cents)), color: C.success } as KpiCardSpec] : []),
  ];
  const kpis = `${sectionTitle('Indicadores do Fechamento')}${kpiGrid(kpiCards)}`;

  // ── Cost centers ──
  const ccSection = (() => {
    const ccs = parse?.cost_centers ?? [];
    if (!ccs.length) return '';
    const chart = chartBlock({
      title: 'Folha por centro de custo',
      svg: svgHorizontalBar(
        [...ccs].sort((a, b) => b.amount_cents - a.amount_cents).slice(0, 8).map((c) => ({ label: c.cost_center_label, value: cents(c.amount_cents) })),
        { width: 520, fmtValue: compactBRL },
      ),
    });
    const table = dataTable(
      [
        { key: 'cc', label: 'Centro de Custo' },
        { key: 'amount', label: 'Valor', num: true },
        { key: 'var', label: 'Variação', num: true },
      ],
      [...ccs].sort((a, b) => b.amount_cents - a.amount_cents).map((c) => ({
        cc: c.cost_center_label,
        amount: { html: `<span class="mono">${esc(BRL(cents(c.amount_cents)))}</span>` },
        var: c.variation_percentage != null ? { html: `<span class="mono" style="color:${c.variation_percentage > 0 ? C.critical : C.success}">${c.variation_percentage >= 0 ? '+' : ''}${c.variation_percentage.toFixed(1)}%</span>` } : '—',
      })),
    );
    return `${sectionTitle('Concentração por Centro de Custo')}<div class="two-col">${chart}<div>${table}</div></div>`;
  })();

  // ── Attachments summary ──
  const byType = new Map<PayrollAttachmentFileType, { count: number; size: number }>();
  attachments.forEach((a) => { const e = byType.get(a.file_type) ?? { count: 0, size: 0 }; e.count += 1; e.size += a.file_size; byType.set(a.file_type, e); });
  const attachTable = dataTable(
    [
      { key: 'type', label: 'Tipo de anexo' },
      { key: 'count', label: 'Qtd.', num: true },
      { key: 'sensitive', label: 'Sensível' },
    ],
    Array.from(byType.entries()).map(([type, e]) => ({
      type: FILE_TYPE_LABEL[type] ?? type,
      count: fmtInt(e.count),
      sensitive: { html: (type === 'holerite' || type === 'external_holerite') ? '<span class="pill crit">sim</span>' : '<span class="pill ok">não</span>' },
    })),
  );
  const attachSection = `${sectionTitle('Resumo de Anexos', `${fmtInt(attachments.length)} arquivos no pacote — conteúdo não embarcado neste PDF`)}${attachments.length ? attachTable : '<p class="empty">Nenhum anexo no pacote.</p>'}`;

  // ── Finance hand-off + dispatch ──
  const handoffItems = [
    financeBatchId ? `Folha enviada ao Financeiro (lote ${financeBatchId}).` : 'Ainda NÃO enviada ao Financeiro.',
    `Status atual do fechamento: ${STATUS_LABEL[batch.status] ?? batch.status}.`,
    batch.payment_deadline ? `Prazo de pagamento: ${fmtDate(batch.payment_deadline)}.` : 'Prazo de pagamento não informado.',
    dispatches.length ? `${fmtInt(dispatches.length)} envio(s) de e-mail registrados.` : 'Nenhum e-mail de fechamento enviado ainda.',
  ];
  const handoffSection = `${sectionTitle('Handoff Financeiro & Distribuição')}${warningBox('Status do handoff', handoffItems, financeBatchId ? 'ok' : 'warn')}`;

  // ── Data quality ──
  const issues: string[] = [];
  if (parse && parse.reconciled === false) issues.push('Total geral NÃO reconcilia com a soma das partes — revisar a planilha de origem.');
  (parse?.flags ?? []).filter((f) => f.severity !== 'info').slice(0, 6).forEach((f) => issues.push(`${f.code}: ${f.message}`));
  if (!narrative) issues.push('Narrativa executiva ainda não gerada.');
  const dqSection = `${sectionTitle('Qualidade dos Dados')}${dataQualityBox(issues)}`;

  const page1 = `<section class="section">${cover}</section><section class="section">${summarySection}</section>`;
  const page2 = `<section class="section">${kpis}</section>${ccSection ? `<section class="section">${ccSection}</section>` : ''}`;
  const page3 = `<section class="section">${attachSection}</section><section class="section">${handoffSection}</section><section class="section">${dqSection}</section>`;

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: `Fechamento da Folha · ${periodLabel(batch.competence_month)}`,
    pages: [page1, page2, page3],
    orientation: 'landscape',
  });
}

export function openPayrollClosingReport(payload: PayrollClosingReportPayload): ReportExportResult {
  try {
    return openReport(buildPayrollClosingReportHtml(payload), { width: 1280, height: 860 });
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : 'Falha ao gerar o relatório.' };
  }
}
