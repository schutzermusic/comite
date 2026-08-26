/**
 * Dossiê de contrato único → PDF no engine compartilhado de relatórios.
 *
 * Distinto de `contract-report.ts` (carteira): renderiza UM contrato como
 * dossiê de governança, com capa e seções A–E espelhando o drawer e a página de
 * detalhe.
 *
 * ─── P0.4: fonte de dados ──────────────────────────────────────────────────
 *
 * Consome `TrustedContract` — linhas reais de `contracts` e das relações da
 * migration 034 — e não mais `ContractGovernanceRecord`.
 *
 * O que saiu do documento, e por quê:
 *
 *   · `riskScore` "NN/100"      → vinha de `hash(id+nome)`, apresentado como
 *                                 avaliação de risco num PDF de diretoria
 *   · `margem estimada NN%`     → `20 + (seed % 25)`
 *   · `confiança IA NN%`        → `58 + (seed % 27)`
 *   · adimplência / reconhecimento de receita → `seed % 4` e `seed % 3`
 *   · parecer jurídico/financeiro → agora saem de `contract_approvals`
 *   · SLA com fallback "~26h"   → sem aprovação registrada não há SLA
 *   · documentos faltantes      → agora só os que existem em
 *                                 `contract_documents` com status bloqueante
 *
 * No lugar do score inventado, o dossiê traz os DRIVERS de saúde apurados e a
 * cobertura da avaliação. Ver `contractHealth` em trust/signals.ts.
 */

import { BRL, esc, fmtDate, fmtInt } from '@/lib/reports/report-formatters';
import { C, REPORT_BRAND_NAME } from '@/lib/reports/report-theme';
import {
  reportCover, sectionTitle, kpiGrid, dataTable, warningBox, summaryBox,
  type KpiCardSpec,
} from '@/lib/reports/report-blocks';
import { renderReportDocument } from '@/lib/reports/report-shell';
import { openReport, buildReportMeta, buildReportFileName } from '@/lib/reports/report-export';
import type { ReportExportResult } from '@/lib/reports/report-types';
import type { TrustedContract } from '@/lib/contracts/trust/read-model';
import type { ContractAuditEventRow, ContractAmendmentRow } from '@/lib/contracts/contract-service';
import {
  effectiveContractState, SKIP_REASON_LABEL,
} from '@/lib/contracts/trust/amendments';
import {
  officialCurrencyCompact, officialCurrencyFull, officialPercent, officialProvenance,
} from '@/lib/contracts/trust/format';
import {
  live, missing, hasOfficialValue, isError, ratioTrusted, renderOfficial,
  type Official,
} from '@/lib/contracts/trust/trusted';
import {
  contractHealth, renewalState, approvalRoute, approvalStepOutcome,
  missingDocuments, obligationBreakdown,
  RENEWAL_LABEL, APPROVAL_OUTCOME_LABEL,
  type ApprovalSlaSummary,
} from '@/lib/contracts/trust/signals';

export interface ContractDossierPayload {
  /** Contrato confiável — a única fonte de dado do documento. */
  contract: TrustedContract;
  brandName?: string;
  source?: string;
  generatedBy?: string;
  /** SLA real de aprovação, quando apurado. */
  sla?: Official<ApprovalSlaSummary>;
  /** Histórico real de `audit_logs`, quando lido. */
  auditEvents?: readonly ContractAuditEventRow[];
  /** Erro de leitura da auditoria, para distinguir falha de ausência. */
  auditError?: string | null;
  /**
   * Aditivos do contrato (098).
   *
   * Omitir o campo NÃO significa "não há aditivo" — significa que não foram
   * lidos, e o documento diz isso em vez de afirmar que o contrato é o
   * original. Um dossiê que omite um aditivo de R$ 2 milhões porque a consulta
   * não foi feita é pior que um dossiê que admite não ter olhado.
   */
  amendments?: Official<readonly ContractAmendmentRow[]>;
}

const DOC_STATUS_PT: Record<string, string> = {
  uploaded: 'Enviado',
  missing: 'Faltante',
  expired: 'Vencido',
  expiring_soon: 'A vencer',
  pending_approval: 'Em aprovação',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  negotiation: 'Em negociação',
  legal_review: 'Revisão jurídica',
  commercial_review: 'Revisão comercial',
  signed: 'Assinado',
  active: 'Ativo',
  expiring_soon: 'Expirando',
  expired: 'Expirado',
  closed: 'Encerrado',
  cancelled: 'Cancelado',
  archived: 'Arquivado',
};

const RISK_LABELS = { high: 'Alto', medium: 'Médio', low: 'Baixo' } as const;
const OBLIGATION_LABELS: Record<string, string> = {
  open: 'Em aberto', due_soon: 'Vence em breve', overdue: 'Atrasada', done: 'Concluída',
};

function kv(k: string, v: string): Record<string, { html: string } | string> {
  return { k, v: { html: `<b>${esc(v)}</b>` } };
}

/** Texto de um indicador confiável de data. */
function dateText(t: Official<Date>): string {
  return renderOfficial(t, {
    onValue: (d) => fmtDate(d),
    onMissing: () => 'Não informado',
    onError: () => 'Dados indisponíveis',
  });
}

/** Texto de um indicador confiável de string. */
function textOf(t: Official<string>, whenMissing = 'Não informado'): string {
  return renderOfficial(t, {
    onValue: (v) => v,
    onMissing: () => whenMissing,
    onError: () => 'Dados indisponíveis',
  });
}

export function buildContractDossierHtml(payload: ContractDossierPayload): string {
  const c = payload.contract;
  const brand = payload.brandName ?? REPORT_BRAND_NAME;
  const fileName = buildReportFileName({ module: `contrato-${c.code}` });

  const counterparty = textOf(c.counterparty, 'Contraparte não informada');
  const meta = buildReportMeta({
    brand,
    filtersLabel: `${c.code} · ${counterparty}`,
    source: payload.source,
    generatedBy: payload.generatedBy,
  });

  const execution = ratioTrusted(c.billedValue, c.totalValue, 'faturado sobre valor total', ['contracts', 'contract_billing_events']);
  const statusLabel = STATUS_LABELS[c.status] ?? c.status;
  const health = contractHealth(c);
  const renewal = renewalState(c);
  const route = approvalRoute(c);
  const legal = approvalStepOutcome(c, 'juridico');
  const finance = approvalStepOutcome(c, 'financeiro');
  const docsMissing = missingDocuments(c);
  const obligations = obligationBreakdown(c);

  /**
   * Um dossiê de contrato que NÃO é operacional precisa dizer isso na cara.
   *
   * Sem esta faixa, imprimir o dossiê de um fixture produz um documento com a
   * mesma aparência de um oficial — e um PDF, uma vez fora da tela, perde todo
   * o contexto que a interface dava.
   */
  const originBanner = c.dataClass === 'live' ? '' : warningBox(
    c.dataClass === 'demo'
      ? 'Contrato de demonstração — não é carteira da empresa'
      : 'Contrato sem origem validada — não é carteira da empresa',
    c.dataClass === 'demo'
      ? [
          'Este contrato é um fixture de desenvolvimento e demonstração.',
          'Os valores abaixo não compõem exposição, saúde ou faturamento oficiais.',
        ]
      : [
          'A origem deste contrato ainda não foi validada como operacional.',
          'Os valores abaixo não compõem métrica oficial de carteira até que essa classificação seja decidida.',
        ],
    'crit',
  );

  const cover = reportCover({
    meta,
    kicker: c.dataClass === 'live'
      ? 'Dossiê de Contrato · Governança'
      : 'Dossiê de Contrato · DEMONSTRAÇÃO',
    title: c.title,
    context: `<b>${esc(c.code)}</b><span class="sep">·</span>${esc(counterparty)}<span class="sep">·</span>valor <b>${esc(officialCurrencyCompact(c.totalValue))}</b>`,
  });

  /* ── Indicadores ──
     Sem risk score e sem margem: nenhum dos dois é apurável hoje. */
  const kpiCards: KpiCardSpec[] = [
    { label: 'Valor total', value: officialCurrencyCompact(c.totalValue), color: C.info },
    {
      label: 'Faturado',
      value: officialCurrencyCompact(c.billedValue),
      color: hasOfficialValue(c.billedValue) ? C.success : C.info,
      helper: hasOfficialValue(execution) ? `${officialPercent(execution)} executado` : officialProvenance(c.billedValue),
    },
    {
      label: 'Saldo a faturar',
      value: officialCurrencyCompact(c.remainingValue),
      color: hasOfficialValue(c.remainingValue) ? C.cost : C.info,
    },
    {
      label: 'Risco cadastral',
      value: RISK_LABELS[c.riskLevel],
      color: c.riskLevel === 'high' ? C.critical : c.riskLevel === 'medium' ? C.warning : C.success,
      helper: 'coluna risk_level',
    },
    {
      label: 'Renovação',
      value: hasOfficialValue(renewal) ? RENEWAL_LABEL[renewal.value] : 'Não apurada',
      color: hasOfficialValue(renewal) && (renewal.value === 'expired' || renewal.value === 'critical') ? C.critical : C.primary,
      helper: hasOfficialValue(c.daysUntilExpiration) ? `${fmtInt(c.daysUntilExpiration.value)} dias` : officialProvenance(c.daysUntilExpiration),
    },
  ];
  const kpis = `${sectionTitle('Indicadores do Contrato')}${kpiGrid(kpiCards)}`;

  /* ── A. Identidade ── */
  const identity = dataTable(
    [{ key: 'k', label: 'Campo' }, { key: 'v', label: 'Valor' }],
    [
      kv('Código', c.code),
      kv('Título', c.title),
      kv('Tipo', textOf(c.contractType)),
      kv('Status', statusLabel),
      kv('Contraparte', counterparty),
      kv('Início de vigência', dateText(c.startDate)),
      kv('Fim de vigência', dateText(c.endDate)),
    ],
  );
  const sectionA = `${sectionTitle('A — Identidade do Contrato')}${identity}`;

  /* ── B. Vínculos ──
     Contagens de relação real. Tarefas de agenda e deliberações de comitê
     saíram: `linkedTasks` era fabricado e `linkedDeliberations` não tem
     vínculo nenhum no banco — a tabela `deliberations` não referencia
     contrato. Afirmar "1 deliberação" seria inventar governança. */
  const relCount = (t: Official<readonly unknown[]>): string =>
    renderOfficial(t, {
      onValue: (rows) => String(rows.length),
      onMissing: () => 'Não apurado',
      onError: () => 'Dados indisponíveis',
    });

  const links = dataTable(
    [{ key: 'k', label: 'Entidade' }, { key: 'v', label: 'Vínculo' }],
    [
      kv('Projeto', renderOfficial(c.project, {
        onValue: (p) => `${p.codigo} · ${p.nome}`,
        onMissing: () => 'Sem projeto vinculado',
        onError: () => 'Dados indisponíveis',
      })),
      kv('Riscos vinculados', relCount(c.riskLinks)),
      kv('Eventos de faturamento', relCount(c.billingEvents)),
      kv('Documentos registrados', relCount(c.documents)),
      kv('Obrigações mapeadas', renderOfficial(obligations, {
        onValue: (b) => String(b.total),
        onMissing: () => 'Não apurado',
        onError: () => 'Dados indisponíveis',
      })),
      kv('Documentos pendentes', renderOfficial(docsMissing, {
        onValue: (list) => (list.length ? `${list.length} pendente(s)` : 'Completos'),
        onMissing: () => 'Não apurado',
        onError: () => 'Dados indisponíveis',
      })),
    ],
  );
  const sectionB = `${sectionTitle('B — Vínculos & Relacionamentos')}${links}`;

  /* ── C. Exposição financeira ── */
  const billingRows = hasOfficialValue(c.billingEvents) ? c.billingEvents.value : [];
  const billingTable = dataTable(
    [
      { key: 'titulo', label: 'Evento' },
      { key: 'valor', label: 'Valor', num: true },
      { key: 'venc', label: 'Vencimento' },
      { key: 'status', label: 'Situação' },
    ],
    billingRows.map((event) => {
      const paid = Boolean(event.paid_at) || ['pago', 'paid', 'billed', 'realizado', 'realized', 'faturado'].includes((event.status ?? '').toLowerCase());
      const overdue = !paid && event.due_date != null && new Date(event.due_date).getTime() < Date.now();
      return {
        titulo: event.title,
        valor: { html: `<span class="mono">${esc(BRL(Number(event.amount ?? 0)))}</span>` },
        venc: event.due_date ? fmtDate(new Date(event.due_date)) : '—',
        status: { html: `<span class="pill ${paid ? 'ok' : overdue ? 'crit' : 'warn'}">${paid ? 'Pago' : overdue ? 'Vencido' : 'Pendente'}</span>` },
      };
    }),
  );
  const financeBody = isError(c.billingEvents)
    ? `<p class="empty">Falha ao ler os eventos de faturamento — não é possível apresentar a exposição.</p>`
    : billingRows.length
      ? billingTable
      : '<p class="empty">Nenhum evento de faturamento registrado. A exposição faturada não pode ser apurada.</p>';
  const sectionC = `${sectionTitle('C — Exposição Financeira', hasOfficialValue(execution) ? `${officialPercent(execution)} executado` : officialProvenance(c.billedValue))}${financeBody}`;

  /* ── D. Governança & Workflow ── */
  const slaText = payload.sla
    ? renderOfficial(payload.sla, {
        onValue: (s) => s.avgHours != null
          ? `${s.avgHours}h${s.overdueSteps ? ` · ${s.overdueSteps} etapa(s) em atraso` : ''}${s.rejectedSteps ? ` · ${s.rejectedSteps} rejeitada(s)` : ''}`
          : 'Sem duração apurada',
        onMissing: () => 'Não apurado',
        onError: () => 'Dados indisponíveis',
      })
    : 'Não apurado';

  const governance = dataTable(
    [{ key: 'k', label: 'Alçada' }, { key: 'v', label: 'Status' }],
    [
      kv('Rota de aprovação', textOf(route, 'Nenhuma etapa registrada')),
      {
        k: 'Parecer jurídico',
        v: { html: `<span class="pill ${hasOfficialValue(legal) && legal.value === 'approved' ? 'ok' : hasOfficialValue(legal) && legal.value === 'rejected' ? 'crit' : 'warn'}">${esc(hasOfficialValue(legal) ? APPROVAL_OUTCOME_LABEL[legal.value] : 'Não apurado')}</span>` },
      },
      {
        k: 'Parecer financeiro',
        v: { html: `<span class="pill ${hasOfficialValue(finance) && finance.value === 'approved' ? 'ok' : hasOfficialValue(finance) && finance.value === 'rejected' ? 'crit' : 'warn'}">${esc(hasOfficialValue(finance) ? APPROVAL_OUTCOME_LABEL[finance.value] : 'Não apurado')}</span>` },
      },
      kv('SLA médio de aprovação', slaText),
    ],
  );
  const sectionD = `${sectionTitle('D — Governança & Workflow')}${governance}`;

  /* ── Documentos ── */
  const docRows = hasOfficialValue(c.documents) ? c.documents.value : [];
  const docsTable = dataTable(
    [
      { key: 'titulo', label: 'Documento' },
      { key: 'tipo', label: 'Tipo' },
      { key: 'status', label: 'Situação' },
    ],
    docRows.map((doc) => {
      const st = doc.status;
      const pillClass = st === 'approved' ? 'ok' : st === 'rejected' || st === 'expired' ? 'crit' : st === 'pending_approval' || st === 'expiring_soon' ? 'warn' : '';
      const statusText = `${DOC_STATUS_PT[st] ?? st}${st === 'rejected' && doc.rejection_reason ? ` — ${doc.rejection_reason}` : ''}`;
      return {
        titulo: doc.title,
        tipo: doc.document_type,
        status: { html: `<span class="pill ${pillClass}">${esc(statusText)}</span>` },
      };
    }),
  );
  const documentsSection = isError(c.documents)
    ? `${sectionTitle('Documentos')}<p class="empty">Falha ao ler os documentos do contrato.</p>`
    : docRows.length
      ? `${sectionTitle('Documentos', `${docRows.length} documento(s) registrados`)}${docsTable}`
      : `${sectionTitle('Documentos')}<p class="empty">Nenhum documento registrado.</p>`;

  /* ── Obrigações ── */
  const obligationRows = hasOfficialValue(c.obligations) ? c.obligations.value : [];
  const obligationsTable = dataTable(
    [
      { key: 'titulo', label: 'Obrigação' },
      { key: 'prazo', label: 'Prazo' },
      { key: 'status', label: 'Situação' },
      { key: 'evidencia', label: 'Evidência' },
    ],
    [...obligationRows]
      .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))
      .map((o) => ({
        titulo: o.title,
        prazo: { html: `<span class="mono" style="${o.status === 'overdue' ? `color:${C.critical};font-weight:700` : ''}">${o.due_date ? esc(fmtDate(new Date(o.due_date))) : '—'}</span>` },
        status: { html: `<span class="pill ${o.status === 'overdue' ? 'crit' : o.status === 'due_soon' ? 'warn' : o.status === 'done' ? 'ok' : ''}">${esc(OBLIGATION_LABELS[o.status] ?? o.status)}</span>` },
        evidencia: o.evidence ?? '—',
      })),
  );
  const obligationsSection = isError(c.obligations)
    ? `${sectionTitle('Obrigações Contratuais')}<p class="empty">Falha ao ler as obrigações do contrato.</p>`
    : obligationRows.length
      ? `${sectionTitle('Obrigações Contratuais')}${obligationsTable}`
      : `${sectionTitle('Obrigações Contratuais')}<p class="empty">Nenhuma obrigação mapeada.</p>`;

  /* ── E. Saúde do contrato ──
     Drivers apurados no lugar do score inventado. */
  const healthRows = health.drivers.map((d) => ({
    dim: d.label,
    sit: { html: `<span class="pill ${d.adverse ? 'warn' : 'ok'}">${d.adverse ? 'Atenção' : 'Regular'}</span>` },
    detalhe: d.detail,
  }));
  const healthTable = healthRows.length
    ? dataTable(
        [{ key: 'dim', label: 'Dimensão' }, { key: 'sit', label: 'Situação' }, { key: 'detalhe', label: 'Detalhe' }],
        healthRows,
      )
    : '<p class="empty">Nenhuma dimensão pôde ser avaliada com os dados disponíveis.</p>';

  const healthNote = warningBox(
    'Pontuação de saúde não emitida',
    [
      `Cobertura da avaliação: ${health.coverage.assessed} de ${health.coverage.total} dimensões apuradas.`,
      'Não há modelo de pontuação aprovado para contratos. Um índice de 0 a 100 exige pesos definidos pela área de negócio; emitir um número arbitrário aqui produziria uma medição que ninguém mediu.',
      'As dimensões acima são fatos apurados e podem embasar decisão sem depender de um score.',
    ],
    'warn',
  );
  const sectionE = `${sectionTitle('E — Saúde do Contrato', 'drivers apurados por dimensão')}${healthNote}${healthTable}`;

  /* ── F. Histórico ── */
  const auditRows = payload.auditEvents ?? [];
  const auditTable = dataTable(
    [{ key: 'quando', label: 'Quando' }, { key: 'acao', label: 'Ação' }],
    auditRows.slice(0, 20).map((event) => ({
      quando: { html: `<span class="mono">${esc(fmtDate(new Date(event.created_at)))}</span>` },
      acao: event.action,
    })),
  );
  const auditSection = payload.auditError
    ? `${sectionTitle('F — Histórico')}<p class="empty">Falha ao ler o histórico de auditoria.</p>`
    : auditRows.length
      ? `${sectionTitle('F — Histórico', `${auditRows.length} evento(s) em audit_logs`)}${auditTable}`
      : `${sectionTitle('F — Histórico')}<p class="empty">Nenhum evento de auditoria registrado para este contrato.</p>`;

  /* ── Resumo ── */
  const summary = `${sectionTitle('Resumo Executivo')}${summaryBox([
    `Contrato <b>${esc(c.code)}</b> com <b>${esc(counterparty)}</b>, valor de <b>${esc(officialCurrencyFull(c.totalValue))}</b>${hasOfficialValue(execution) ? ` e ${officialPercent(execution)} executado` : ' — execução financeira não apurada'}.`,
    `Status <b>${esc(statusLabel)}</b> · risco cadastral <b>${esc(RISK_LABELS[c.riskLevel])}</b> · rota de aprovação: ${esc(textOf(route, 'nenhuma etapa registrada'))}.`,
    `Saúde: ${health.coverage.assessed}/${health.coverage.total} dimensões apuradas, ${health.drivers.filter((d) => d.adverse).length} em atenção.`,
  ])}`;

  /* ── Instrumentos contratuais ── */
  const amendmentState = effectiveContractState(
    c.totalValue,
    c.endDate,
    payload.amendments ?? missing<readonly ContractAmendmentRow[]>('no-rows', 'aditivos não consultados'),
  );

  const instrumentRows = amendmentState.timeline.map((step: (typeof amendmentState.timeline)[number]) => {
    const a = step.amendment;
    const effects: string[] = [];
    if (a.value_absolute !== null) effects.push(`valor passa a ${officialCurrencyFull(live(Number(a.value_absolute), 'contracts'))}`);
    else if (a.value_delta !== null) effects.push(`${Number(a.value_delta) >= 0 ? '+' : ''}${officialCurrencyFull(live(Number(a.value_delta), 'contracts'))}`);
    if (a.new_end_date) effects.push(`vigência até ${a.new_end_date}`);
    else if (a.term_extension_days) effects.push(`+${a.term_extension_days} dias`);
    if (a.scope_change) effects.push('altera escopo');

    return {
      instrumento: a.amendment_number,
      titulo: a.title ?? '—',
      efeito: a.effective_date ?? 'sem data',
      alteracao: effects.length ? effects.join(' · ') : 'nenhuma alteração declarada',
      situacao: {
        html: step.applied
          ? '<span class="pill ok">aplicado</span>'
          : `<span class="pill warn">${esc(step.skipReason ? SKIP_REASON_LABEL[step.skipReason] : 'não aplicado')}</span>`,
      },
    };
  });

  const instrumentsTable = dataTable(
    [
      { key: 'instrumento', label: 'Instrumento' },
      { key: 'titulo', label: 'Título' },
      { key: 'efeito', label: 'Efeito em' },
      { key: 'alteracao', label: 'Alteração declarada' },
      { key: 'situacao', label: 'Situação' },
    ],
    instrumentRows,
  );

  /*
    Original e vigente aparecem LADO A LADO, sempre. Imprimir só o vigente
    apagaria a trilha; imprimir só o original mentiria sobre o presente. E
    quando o vigente não pôde ser derivado, o documento diz "não apurado" em
    vez de repetir o original como se nada tivesse mudado.
  */
  const effectiveBox = summaryBox([
    `Valor original <b>${esc(officialCurrencyFull(amendmentState.originalValue))}</b> · valor vigente <b>${esc(officialCurrencyFull(amendmentState.currentValue))}</b>.`,
    `Vigência original <b>${esc(dateText(amendmentState.originalEndDate))}</b> · vigência vigente <b>${esc(dateText(amendmentState.currentEndDate))}</b>.`,
    ...(amendmentState.unapplied.some((x) => x.skipReason === 'undated')
      ? ['Há aditivo em vigor sem data de efeito registrada: o valor ou o prazo vigente permanece não apurado, porque aplicá-lo em ordem arbitrária produziria um número que aparenta confiabilidade sem tê-la.']
      : []),
  ]);

  const instrumentsSection = !payload.amendments
    ? `${sectionTitle('Instrumentos Contratuais')}<p class="empty">Aditivos não consultados para este documento. A ausência de leitura não afirma que o contrato não tenha aditivos.</p>`
    : isError(payload.amendments)
      ? `${sectionTitle('Instrumentos Contratuais')}<p class="empty">Falha ao ler os aditivos do contrato.</p>`
      : instrumentRows.length
        ? `${sectionTitle('Instrumentos Contratuais', `contrato mestre + ${instrumentRows.length} aditivo(s)`)}${effectiveBox}${instrumentsTable}`
        : `${sectionTitle('Instrumentos Contratuais')}${effectiveBox}<p class="empty">Nenhum aditivo registrado para este contrato.</p>`;

  const page1 = `<section class="section">${cover}</section><section class="section">${originBanner}${summary}${kpis}</section>`;
  const page2 = `<section class="section">${sectionA}${sectionB}</section>`;
  const page3 = `<section class="section">${sectionC}${sectionD}</section>`;
  const page4 = `<section class="section">${obligationsSection}${documentsSection}</section>`;
  const pageInstruments = `<section class="section">${instrumentsSection}</section>`;
  const page5 = `<section class="section">${sectionE}${auditSection}</section>`;

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: c.dataClass === 'live' ? `Dossiê — ${c.code}` : `DEMONSTRAÇÃO — ${c.code} — não é carteira da empresa`,
    pages: [page1, page2, page3, page4, pageInstruments, page5],
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
