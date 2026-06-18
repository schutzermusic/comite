/**
 * Single-contract dossier → board-ready PDF on the shared report engine.
 *
 * Distinct from contract-report.ts (the portfolio report): this renders ONE
 * contract as a governance dossier with cover + sections A–F, mirroring the
 * on-screen drawer/detail layout. Consumes the same enriched
 * ContractGovernanceRecord — no data duplication.
 */

import type { ContractGovernanceRecord } from '@/components/contracts/contract-governance-data';
import { BRL, compactBRL, esc, fmtDate, fmtInt } from '@/lib/reports/report-formatters';
import { C } from '@/lib/reports/report-theme';
import {
  reportCover, sectionTitle, kpiGrid, dataTable, warningBox, summaryBox,
  type KpiCardSpec,
} from '@/lib/reports/report-blocks';
import { renderReportDocument } from '@/lib/reports/report-shell';
import { openReport, buildReportMeta, buildReportFileName } from '@/lib/reports/report-export';
import type { ReportExportResult } from '@/lib/reports/report-types';

export interface ContractDossierPayload {
  record: ContractGovernanceRecord;
  brandName?: string;
  source?: string;
  generatedBy?: string;
}

const STATUS_LABELS: Record<string, string> = {
  negotiation: 'Em negociação',
  legal_review: 'Revisão jurídica',
  commercial_review: 'Revisão comercial',
  signed: 'Assinado',
  active: 'Ativo',
  expiring_soon: 'Expirando',
  expired: 'Expirado',
  closed: 'Encerrado',
  cancelled: 'Cancelado',
};
const RISK_LABELS = { high: 'Alto', medium: 'Médio', low: 'Baixo' } as const;
const OBLIGATION_LABELS = { open: 'Em aberto', due_soon: 'Vence em breve', overdue: 'Atrasada', done: 'Concluída' } as const;

function kv(k: string, v: string): Record<string, { html: string } | string> {
  return { k, v: { html: `<b>${esc(v)}</b>` } };
}

export function buildContractDossierHtml(payload: ContractDossierPayload): string {
  const r = payload.record;
  const brand = payload.brandName ?? 'INSIGHT — Governança Corporativa';
  const fileName = buildReportFileName({ module: `contrato-${r.code}` });
  const meta = buildReportMeta({
    brand,
    filtersLabel: `${r.code} · ${r.companyName}`,
    source: payload.source,
    generatedBy: payload.generatedBy,
  });

  const billedPct = r.totalValue ? Math.round((r.billedValue / r.totalValue) * 100) : 0;
  const statusLabel = STATUS_LABELS[r.contract.status] ?? r.contract.status;
  const legalLabel = r.legalStatus === 'approved' ? 'Aprovado' : r.legalStatus === 'review' ? 'Em revisão' : 'Pendente';
  const financeLabel = r.financialStatus === 'ok' ? 'Liberado' : r.financialStatus === 'attention' ? 'Atenção' : 'Bloqueado';

  const cover = reportCover({
    meta,
    kicker: 'Dossiê de Contrato · Governança',
    title: r.contract.name,
    context: `<b>${esc(r.code)}</b><span class="sep">·</span>${esc(r.companyName)}<span class="sep">·</span>valor <b>${esc(compactBRL(r.totalValue))}</b>`,
  });

  // ── KPIs ──
  const kpiCards: KpiCardSpec[] = [
    { label: 'Valor total', value: compactBRL(r.totalValue), color: C.info },
    { label: 'Faturado', value: compactBRL(r.billedValue), color: C.success, helper: `${billedPct}% executado` },
    { label: 'Saldo a faturar', value: compactBRL(r.remainingValue), color: C.cost },
    { label: 'Risk score', value: `${fmtInt(r.riskScore)}/100`, color: r.riskScore >= 70 ? C.critical : r.riskScore >= 50 ? C.warning : C.success },
    { label: 'Margem est.', value: `${fmtInt(r.margin)}%`, color: C.primary },
  ];
  const kpis = `${sectionTitle('Indicadores do Contrato')}${kpiGrid(kpiCards)}`;

  // ── A. Identidade ──
  const identity = dataTable(
    [{ key: 'k', label: 'Campo' }, { key: 'v', label: 'Valor' }],
    [
      kv('Código', r.code),
      kv('Título', r.contract.name),
      kv('Tipo', r.contractType),
      kv('Status', statusLabel),
      kv('Contraparte', r.companyName),
      kv('Responsável', r.owner),
      kv('Início de vigência', r.contract.signingDate ? fmtDate(r.contract.signingDate) : '—'),
      kv('Fim de vigência', r.contract.expirationDate ? fmtDate(r.contract.expirationDate) : '—'),
      kv('Moeda', r.contract.currency),
    ],
  );
  const sectionA = `${sectionTitle('A — Identidade do Contrato')}${identity}`;

  // ── B. Vínculos ──
  const links = dataTable(
    [{ key: 'k', label: 'Entidade' }, { key: 'v', label: 'Vínculo' }],
    [
      kv('Projeto', r.project ? r.projectReference : 'Sem projeto vinculado'),
      kv('Riscos vinculados', `${fmtInt(r.linkedRisks.length)}`),
      kv('Tarefas de agenda', `${fmtInt(r.linkedTasks.length)}`),
      kv('Deliberações de comitê', `${fmtInt(r.linkedDeliberations.length)}`),
      kv('Eventos de faturamento', `${fmtInt(r.billingEvents.length)}`),
      kv('Documentos faltantes', r.missingDocuments.length ? `${fmtInt(r.missingDocuments.length)} pendente(s)` : 'Completos'),
      kv('Reconhecimento de receita', r.revenueRecognitionStatus),
    ],
  );
  const sectionB = `${sectionTitle('B — Vínculos & Relacionamentos')}${links}`;

  // ── C. Exposição financeira (billing schedule) ──
  const billingTable = dataTable(
    [
      { key: 'titulo', label: 'Evento' },
      { key: 'valor', label: 'Valor', num: true },
      { key: 'venc', label: 'Vencimento' },
      { key: 'status', label: 'Situação' },
    ],
    r.billingEvents.map((event) => {
      const paid = event.status === 'pago' || !!event.paid_at;
      return {
        titulo: event.title,
        valor: { html: `<span class="mono">${esc(BRL(event.amount))}</span>` },
        venc: event.due_date ? fmtDate(event.due_date) : '—',
        status: { html: `<span class="pill ${paid ? 'ok' : 'warn'}">${paid ? 'Pago' : 'Pendente'}</span>` },
      };
    }),
  );
  const sectionC = `${sectionTitle('C — Exposição Financeira', `${billedPct}% executado · adimplência: ${r.paymentStatus}`)}${r.billingEvents.length ? billingTable : '<p class="empty">Sem eventos de faturamento.</p>'}`;

  // ── D. Governança / Workflow ──
  const governance = dataTable(
    [{ key: 'k', label: 'Alçada' }, { key: 'v', label: 'Status' }],
    [
      kv('Rota de aprovação', r.approvalRoute),
      { k: 'Parecer jurídico', v: { html: `<span class="pill ${r.legalStatus === 'approved' ? 'ok' : 'warn'}">${esc(legalLabel)}</span>` } },
      { k: 'Parecer financeiro', v: { html: `<span class="pill ${r.financialStatus === 'ok' ? 'ok' : r.financialStatus === 'attention' ? 'warn' : 'crit'}">${esc(financeLabel)}</span>` } },
      kv('SLA médio de aprovação', r.contract.riskClassification === 'high' ? '~26h' : '~18h'),
      kv('Adimplência', r.paymentStatus),
    ],
  );
  const sectionD = `${sectionTitle('D — Governança & Workflow')}${governance}`;

  // ── Obrigações ──
  const obligationsTable = dataTable(
    [
      { key: 'titulo', label: 'Obrigação' },
      { key: 'owner', label: 'Responsável' },
      { key: 'prazo', label: 'Prazo' },
      { key: 'status', label: 'Situação' },
    ],
    [...r.obligations]
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
      .map((o) => ({
        titulo: o.title,
        owner: o.owner,
        prazo: { html: `<span class="mono" style="${o.status === 'overdue' ? `color:${C.critical};font-weight:700` : ''}">${esc(fmtDate(o.dueDate))}</span>` },
        status: { html: `<span class="pill ${o.status === 'overdue' ? 'crit' : o.status === 'due_soon' ? 'warn' : o.status === 'done' ? 'ok' : ''}">${esc(OBLIGATION_LABELS[o.status])}</span>` },
      })),
  );
  const obligationsSection = `${sectionTitle('Obrigações Contratuais')}${r.obligations.length ? obligationsTable : '<p class="empty">Sem obrigações mapeadas.</p>'}`;

  // ── E. Inteligência de IA ──
  const aiKpis = kpiGrid([
    { label: 'Risk score', value: `${fmtInt(r.riskScore)}/100`, color: r.riskScore >= 70 ? C.critical : C.info },
    { label: 'Confiança IA', value: `${fmtInt(r.confidenceScore)}%`, color: C.primary },
    { label: 'Risco cadastral', value: RISK_LABELS[r.contract.riskClassification], color: r.contract.riskClassification === 'high' ? C.critical : r.contract.riskClassification === 'medium' ? C.warning : C.success },
  ], 3);
  const aiWarn = r.aiStatus === 'mock_pending'
    ? warningBox('Análise IA pendente de backend', ['Nenhuma cláusula foi lida por motor de IA. O score acima é heurístico cadastral.'], 'warn')
    : '';
  const missingDocsBox = r.missingDocuments.length
    ? warningBox('Documentos pendentes', r.missingDocuments, 'crit')
    : '';
  const sectionE = `${sectionTitle('E — Inteligência de IA')}${aiWarn}${aiKpis}${missingDocsBox}`;

  const summary = `${sectionTitle('Resumo Executivo')}${summaryBox([
    `Contrato <b>${esc(r.code)}</b> com <b>${esc(r.companyName)}</b>, exposição total de <b>${esc(BRL(r.totalValue))}</b> e ${billedPct}% executado.`,
    `Status atual <b>${esc(statusLabel)}</b> · risco <b>${esc(RISK_LABELS[r.contract.riskClassification])}</b> · rota de aprovação: ${esc(r.approvalRoute)}.`,
  ])}`;

  const page1 = `<section class="section">${cover}</section><section class="section">${summary}${kpis}</section>`;
  const page2 = `<section class="section">${sectionA}${sectionB}</section>`;
  const page3 = `<section class="section">${sectionC}${sectionD}</section>`;
  const page4 = `<section class="section">${obligationsSection}${sectionE}</section>`;

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: `Dossiê — ${r.code}`,
    pages: [page1, page2, page3, page4],
    orientation: 'portrait',
  });
}

export function openContractDossierReport(payload: ContractDossierPayload): ReportExportResult {
  try {
    return openReport(buildContractDossierHtml(payload), { width: 1100, height: 880 });
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : 'Falha ao gerar o dossiê.' };
  }
}
