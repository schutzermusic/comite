/**
 * AUTONOMIA APEX no comercial — o que o sistema percebe e PROPÕE.
 *
 * ─── A linha que não se cruza ────────────────────────────────────────────
 *
 * A IA pode classificar, extrair, comparar, explicar, pré-preencher e
 * recomendar. A IA NÃO pode aceitar proposta pelo cliente, aceitar medição,
 * criar aceite do cliente, conceder elegibilidade de faturamento nem
 * sobrescrever a fonte regente.
 *
 * Por isso TODO sinal produzido aqui é um `AutonomySignal` com uma AÇÃO
 * SUGERIDA e um destino — nunca um efeito. Nada neste arquivo escreve. As
 * escritas moram nas funções governadas do banco, que exigem ator humano
 * nomeado e recusam `authenticated` e `anon`.
 *
 * O portão real, porém, não é este arquivo: é o banco. Mesmo que alguém
 * chamasse uma função daqui com má intenção, `commercial_engagement_authorize`
 * exigiria ator, `project_measurement_accept` recusaria aceite interno sem
 * pessoa autenticada, e `internal_service_order_issue` bateria no gatilho de
 * divergência. Disciplina de código é a primeira camada; nunca a única.
 */
import type {
  CommercialDivergence, EngagementStatus, ExtractedFact,
  InternalServiceOrder, ProposalRevisionStatus,
} from './types';
import { isFactPromotable } from './types';

export type AutonomySignalKind =
  | 'PROPOSAL_ACCEPTED_WITHOUT_SERVICE_ORDER'
  | 'SERVICE_ORDER_WITHOUT_PROJECT'
  | 'SERVICE_ORDER_BLOCKED_BY_DIVERGENCE'
  | 'ENGAGEMENT_STUCK_UNDER_ANALYSIS'
  | 'EXTRACTED_FACTS_AWAITING_CONFIRMATION'
  | 'DOCUMENT_SILENT_ON_BILLING_RULE';

export interface AutonomySignal {
  kind: AutonomySignalKind;
  severity: 'info' | 'attention' | 'blocking';
  title: string;
  detail: string;
  /** O que a pessoa faz a seguir. O sistema prepara; ela decide. */
  suggestedAction: string;
  href: string;
  subjectId: string;
}

export interface AutonomyInput {
  engagement: {
    id: string;
    title: string;
    status: EngagementStatus;
    createdAt: string;
    hasGoverningAuthorization: boolean;
  };
  acceptedProposalRevisions: Array<{ id: string; proposalNumber: string; status: ProposalRevisionStatus }>;
  serviceOrders: InternalServiceOrder[];
  divergences: CommercialDivergence[];
  facts: ExtractedFact[];
  now?: Date;
}

const STALE_ANALYSIS_DAYS = 7;

export function buildAutonomySignals(input: AutonomyInput): AutonomySignal[] {
  const { engagement, acceptedProposalRevisions, serviceOrders, divergences, facts } = input;
  const now = input.now ?? new Date();
  const signals: AutonomySignal[] = [];
  const base = `/contratos/engajamento/${engagement.id}`;

  // 1. Proposta aceita e nenhuma OS: o trabalho está vendido e não começou.
  const accepted = acceptedProposalRevisions.filter((r) => r.status === 'ACCEPTED');
  const ordersFromProposal = new Set(
    serviceOrders.map((order) => order.sourceProposalRevisionId).filter(Boolean) as string[],
  );
  for (const revision of accepted) {
    if (ordersFromProposal.has(revision.id)) continue;
    signals.push({
      kind: 'PROPOSAL_ACCEPTED_WITHOUT_SERVICE_ORDER',
      severity: 'attention',
      title: `Proposta ${revision.proposalNumber} aceita, sem Ordem de Serviço interna`,
      detail: 'O cliente autorizou o trabalho e nenhuma OS interna o liberou para execução.',
      // Preparar o rascunho é trabalho mecânico; emitir é decisão.
      suggestedAction: 'Preparar rascunho de OS a partir da proposta aceita',
      href: `${base}?acao=nova-os&revisao=${revision.id}`,
      subjectId: revision.id,
    });
  }

  // 2. OS emitida e nenhum projeto: ninguém tem onde executar.
  for (const order of serviceOrders) {
    if (order.projectId) continue;
    if (order.status !== 'ISSUED') continue;
    signals.push({
      kind: 'SERVICE_ORDER_WITHOUT_PROJECT',
      severity: 'attention',
      title: `OS ${order.osNumber} emitida sem Projeto`,
      detail: 'A OS autoriza a execução, mas não há projeto para medir, evidenciar ou faturar.',
      suggestedAction: 'Criar ou vincular Projeto',
      href: `${base}?acao=vincular-projeto&os=${order.id}`,
      subjectId: order.id,
    });
  }

  // 3. OS travada por divergência: o sistema NÃO escolhe por ninguém.
  const blocking = divergences.filter((d) => d.state === 'OPEN' && d.severity === 'BLOCKING');
  for (const order of serviceOrders) {
    const relevant = blocking.filter((d) => d.serviceOrderId === order.id || d.serviceOrderId === null);
    if (relevant.length === 0 || order.status === 'ISSUED' || order.status === 'IN_EXECUTION') continue;
    signals.push({
      kind: 'SERVICE_ORDER_BLOCKED_BY_DIVERGENCE',
      severity: 'blocking',
      title: `OS ${order.osNumber} aguarda decisão sobre ${relevant.length} divergência(s)`,
      detail: relevant.map((d) => d.summary).join(' · '),
      suggestedAction: 'Decidir qual fonte prevalece',
      href: `${base}?acao=divergencias&os=${order.id}`,
      subjectId: order.id,
    });
  }

  // 4. Entrada parada em análise: KPI correto, trabalho esquecido.
  if (engagement.status === 'UNDER_ANALYSIS') {
    const ageDays = Math.floor((now.getTime() - new Date(engagement.createdAt).getTime()) / 86_400_000);
    if (ageDays >= STALE_ANALYSIS_DAYS) {
      signals.push({
        kind: 'ENGAGEMENT_STUCK_UNDER_ANALYSIS',
        severity: engagement.hasGoverningAuthorization ? 'attention' : 'info',
        title: `${engagement.title} em análise há ${ageDays} dias`,
        detail: engagement.hasGoverningAuthorization
          ? 'Já existe fonte de autorização regente: falta a revisão humana que autoriza o trabalho.'
          : 'Nenhuma fonte de autorização foi anexada ainda — contrato, proposta aceita, pedido ou autorização.',
        suggestedAction: engagement.hasGoverningAuthorization
          ? 'Revisar e autorizar' : 'Anexar a fonte de autorização',
        href: base,
        subjectId: engagement.id,
      });
    }
  }

  // 5. Fatos lidos e não confirmados: leitura pronta, decisão pendente.
  const pending = facts.filter((f) => f.provenanceState === 'ANCHORED'
    && f.confirmationState === 'UNCONFIRMED');
  if (pending.length > 0) {
    signals.push({
      kind: 'EXTRACTED_FACTS_AWAITING_CONFIRMATION',
      severity: 'attention',
      title: `${pending.length} fato(s) lidos do documento aguardam confirmação`,
      detail: 'Cada um traz documento, página e trecho literal. Enquanto não confirmados, '
        + 'nenhum deles pode virar regra de medição ou condição de faturamento.',
      suggestedAction: 'Conferir e confirmar os fatos extraídos',
      href: `${base}?acao=fatos`,
      subjectId: engagement.id,
    });
  }

  // 6. O documento é SILENCIOSO sobre a regra de faturamento.
  //
  // O sinal certo aqui é a AUSÊNCIA, e dizê-la é o oposto de inventá-la:
  // sem esse aviso, a tela mostraria uma seção vazia que parece completa.
  const hasBillingRule = facts.some((f) =>
    (f.factDomain === 'BILLING_MILESTONE' || f.factDomain === 'MEASUREMENT_RULE'
      || f.factDomain === 'BILLING_PREREQUISITE') && isFactPromotable(f));
  if (engagement.status === 'AUTHORIZED' && facts.length > 0 && !hasBillingRule) {
    signals.push({
      kind: 'DOCUMENT_SILENT_ON_BILLING_RULE',
      severity: 'attention',
      title: 'Nenhuma regra de medição ou faturamento confirmada',
      detail: 'Os documentos lidos não trouxeram regra de medição, marco de faturamento ou '
        + 'pré-requisito com página e trecho confirmados. A regra não será suposta.',
      suggestedAction: 'Registrar a regra a partir do documento, ou anexar o documento que a contém',
      href: `${base}?acao=regras`,
      subjectId: engagement.id,
    });
  }

  return signals;
}

/** Bloqueante primeiro: a fila mostra o que impede antes do que atrasa. */
export function sortAutonomySignals(signals: AutonomySignal[]): AutonomySignal[] {
  const weight = { blocking: 0, attention: 1, info: 2 } as const;
  return [...signals].sort((a, b) => weight[a.severity] - weight[b.severity]);
}
