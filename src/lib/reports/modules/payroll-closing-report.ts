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
import { C, REPORT_BRAND_NAME } from '@/lib/reports/report-theme';
import { svgHorizontalBar, svgStackedBar } from '@/lib/reports/report-charts';
import {
  reportCover, sectionTitle, kpiGrid, chartBlock, dataTable, warningBox, dataQualityBox, summaryBox,
  type KpiCardSpec,
} from '@/lib/reports/report-blocks';
import {
  composePages, block, mmForChart, mmForColumns, mmForCover, mmForKpiGrid,
  mmForSectionTitle, mmForSummary, mmForTable, mmForWarningBox, type ReportBlock,
} from '@/lib/reports/report-compose';
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
  const brand = payload.brandName ?? REPORT_BRAND_NAME;
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

  const blocks: ReportBlock[] = [];
  blocks.push(block(reportCover({
    meta,
    kicker: 'Relatório de Fechamento · Pessoas & Custos',
    title: 'Fechamento da Folha',
    context: `Competência <b>${esc(periodLabel(batch.competence_month))}</b><span class="sep">·</span>total <b>${esc(compactBRL(cents(total)))}</b>`,
    statusChip: { label: STATUS_LABEL[batch.status] ?? batch.status, color: batch.status === 'posted' || batch.status === 'sent_to_finance' ? C.success : batch.status === 'cancelled' ? C.critical : C.info },
    coverKpis: [
      { label: 'Folha total', value: compactBRL(cents(total)) },
      { label: 'Variação', value: `${variationPct >= 0 ? '+' : ''}${variationPct.toFixed(1)}%` },
      ...(parse?.headcount != null ? [{ label: 'Headcount', value: fmtInt(parse.headcount) }] : []),
      { label: 'Status', value: STATUS_LABEL[batch.status] ?? batch.status },
    ],
  }), mmForCover(true)));

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
  const boardParas = boardText ? boardText.split(/\n\n+/).slice(0, 4) : [];
  blocks.push(block(sectionTitle('Sumário para a Diretoria', narrative?.generated_by_ai ? 'gerado por IA' : 'resumo determinístico', 1), mmForSectionTitle(true), { keepWithNext: true }));
  blocks.push(block(boardParas.length ? summaryBox(boardParas) : '<p class="empty">Narrativa ainda não gerada.</p>', boardParas.length ? mmForSummary(boardParas) : 8));
  if (narrative?.attention_points?.length) {
    blocks.push(block(warningBox('Pontos de atenção', narrative.attention_points, 'warn'), mmForWarningBox(narrative.attention_points.length)));
  }
  blocks.push(block(sensitiveBox, mmForWarningBox(3)));

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
  blocks.push(block(sectionTitle('Indicadores do Fechamento', undefined, 2), mmForSectionTitle(), { breakBefore: true, keepWithNext: true }));
  blocks.push(block(kpiGrid(kpiCards, 4), mmForKpiGrid(kpiCards.length, 4)));

  // Composition stacked bar (bruto × encargos × benefícios) when parsed.
  if (parse?.gross_amount_cents != null && parse?.charges_amount_cents != null) {
    blocks.push(block(chartBlock({
      title: 'Composição da Folha',
      svg: svgStackedBar(
        [
          { label: 'Bruto', value: cents(parse.gross_amount_cents), color: C.cost },
          { label: 'Encargos', value: cents(parse.charges_amount_cents), color: C.warning },
          ...(parse.benefits_amount_cents != null ? [{ label: 'Benefícios', value: cents(parse.benefits_amount_cents), color: C.success }] : []),
        ],
        { width: 1000, fmtValue: compactBRL },
      ),
    }), mmForChart(64, { svgWidthPx: 1000, title: true })));
  }

  // ── Cost centers ──
  const ccSection = (() => {
    const ccs = parse?.cost_centers ?? [];
    if (!ccs.length) return '';
    const chart = chartBlock({
      title: 'Folha por centro de custo',
      svg: svgHorizontalBar(
        [...ccs].sort((a, b) => b.amount_cents - a.amount_cents).slice(0, 8).map((c) => ({ label: c.cost_center_label, value: cents(c.amount_cents) })),
        { width: 490, fmtValue: compactBRL },
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
    return { html: `<div class="two-col">${chart}<div>${table}</div></div>`, chartRows: Math.min(ccs.length, 8), tableRows: ccs.length };
  })();
  if (ccSection) {
    blocks.push(block(sectionTitle('Concentração por Centro de Custo'), mmForSectionTitle(), { keepWithNext: true }));
    blocks.push(block(
      ccSection.html,
      mmForColumns(
        mmForChart(ccSection.chartRows * 26 + 8, { svgWidthPx: 490, cols: 2, title: true }),
        mmForTable(ccSection.tableRows, { rowMm: 5 }),
      ),
    ));
  }

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
  blocks.push(block(sectionTitle('Resumo de Anexos', `${fmtInt(attachments.length)} arquivos no pacote — conteúdo não embarcado neste PDF`, 3), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));
  blocks.push(block(attachments.length ? attachTable : '<p class="empty">Nenhum anexo no pacote.</p>', attachments.length ? mmForTable(byType.size, { rowMm: 5.6 }) : 8));

  // ── Finance hand-off + dispatch ──
  const handoffItems = [
    financeBatchId ? `Folha enviada ao Financeiro (lote ${financeBatchId}).` : 'Ainda NÃO enviada ao Financeiro.',
    `Status atual do fechamento: ${STATUS_LABEL[batch.status] ?? batch.status}.`,
    batch.payment_deadline ? `Prazo de pagamento: ${fmtDate(batch.payment_deadline)}.` : 'Prazo de pagamento não informado.',
    dispatches.length ? `${fmtInt(dispatches.length)} envio(s) de e-mail registrados.` : 'Nenhum e-mail de fechamento enviado ainda.',
  ];
  blocks.push(block(sectionTitle('Handoff Financeiro & Distribuição'), mmForSectionTitle(), { keepWithNext: true }));
  blocks.push(block(warningBox('Status do handoff', handoffItems, financeBatchId ? 'ok' : 'warn'), mmForWarningBox(handoffItems.length)));

  // ── Data quality ──
  const issues: string[] = [];
  if (parse && parse.reconciled === false) issues.push('Total geral NÃO reconcilia com a soma das partes — revisar a planilha de origem.');
  (parse?.flags ?? []).filter((f) => f.severity !== 'info').slice(0, 6).forEach((f) => issues.push(`${f.code}: ${f.message}`));
  if (!narrative) issues.push('Narrativa executiva ainda não gerada.');
  blocks.push(block(sectionTitle('Qualidade dos Dados'), mmForSectionTitle(), { keepWithNext: true }));
  blocks.push(block(dataQualityBox(issues), mmForWarningBox(Math.max(1, issues.length))));

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: `Fechamento da Folha · ${periodLabel(batch.competence_month)}`,
    pages: composePages(blocks, { orientation: 'landscape' }),
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
