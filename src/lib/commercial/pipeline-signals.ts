/**
 * SINAIS DETERMINÍSTICOS do funil comercial.
 *
 * ─── A diferença entre isto e "uma IA recomendando" ──────────────────────
 *
 * Cada sinal daqui é uma REGRA que você pode conferir com um relógio e uma
 * consulta: a oportunidade não tem acompanhamento aberto; o prazo que a
 * contraparte tinha passou; a validade da proposta vence em N dias; a etapa
 * não muda há mais dias do que a política declara. Nenhum deles depende de
 * modelo, de treino ou de opinião — e por isso nenhum deles pode "errar" sem
 * que o dado por trás esteja errado, o que é conferível.
 *
 * O módulo é a irmã do `autonomy.ts`: lá, os sinais do TRABALHO AUTORIZADO
 * (pós-aceite); aqui, os do FUNIL (pré-aceite). Ambos carregam ação sugerida e
 * destino, e nenhum dos dois escreve. A linha do §12 continua onde estava: a
 * Apex percebe e propõe; a decisão é de gente.
 *
 * Tudo aqui é função pura sobre linhas já lidas — é o que permite testar cada
 * limiar sem banco, e é o que impede o cálculo de divergir entre a lista, o
 * dossiê e a visão geral, que consomem a mesma saída.
 */
import type { OpportunityStage, ProposalRevisionStatus } from './types';
import { OPEN_OPPORTUNITY_STAGES } from './types';
import {
  STAGE_PROBABILITY_BAND, STAGE_STALL_DAYS, daysBetween, isOpenStage,
} from './stage-policy';

export type PipelineSignalKind =
  | 'NO_NEXT_ACTION'
  | 'CUSTOMER_RESPONSE_OVERDUE'
  | 'PROPOSAL_EXPIRING'
  | 'PROPOSAL_VALIDITY_LAPSED'
  | 'OPPORTUNITY_STALLED'
  | 'MISSING_EXPECTED_CLOSE'
  | 'STAGE_PROBABILITY_INCONSISTENT'
  | 'WON_WITHOUT_AUTHORIZED_WORK'
  // Fluxo de execução (213) — ver `execution-signals.ts`.
  | 'SURVEY_PENDING'
  | 'PROPOSAL_NOT_READY'
  | 'ACCEPTED_WITHOUT_AUTHORIZATION'
  | 'ACCEPTED_WITHOUT_SERVICE_ORDER'
  | 'SERVICE_ORDER_WITHOUT_PROJECT'
  | 'DOCUMENTATION_PENDING'
  | 'SOURCE_CHAIN_INCOMPLETE';

export type PipelineSignalSeverity = 'info' | 'attention' | 'blocking';

export interface PipelineSignal {
  kind: PipelineSignalKind;
  severity: PipelineSignalSeverity;
  /** A oportunidade a que o sinal pertence. Nulo em sinal de proposta solta. */
  opportunityId: string | null;
  proposalId?: string | null;
  title: string;
  detail: string;
  /** O que a pessoa faz a seguir. O sistema prepara; ela decide. */
  suggestedAction: string;
}

/** O necessário para julgar uma oportunidade — nada além do que a lista já traz. */
export interface SignalOpportunity {
  id: string;
  title: string;
  counterparty_name: string;
  stage: OpportunityStage;
  probability: string | number | null;
  expected_decision_date: string | null;
  stage_entered_at: string | null;
  engagement_id: string | null;
  closed_at: string | null;
}

export interface SignalFollowup {
  id: string;
  source_kind: string;
  source_id: string;
  state: string;
  due_date: string | null;
  next_expected_event: string | null;
  next_expected_event_at: string | null;
  goal: string;
}

export interface SignalProposal {
  id: string;
  proposal_number: string;
  opportunity_id: string | null;
  title: string;
}

export interface SignalRevision {
  id: string;
  proposal_id: string;
  revision: number;
  status: ProposalRevisionStatus;
  validity_until: string | null;
}

export interface PipelineSignalInput {
  opportunities: SignalOpportunity[];
  followups: SignalFollowup[];
  proposals: SignalProposal[];
  revisions: SignalRevision[];
  now?: Date;
}

const OPEN_FOLLOWUP_STATES = ['ACTIVE', 'WAITING_EXTERNAL_PARTY', 'BLOCKED', 'ESCALATED'];

/** Quantos dias antes do fim da validade a proposta entra na fila. */
export const PROPOSAL_EXPIRY_WARNING_DAYS = 7;

const SEVERITY_WEIGHT: Record<PipelineSignalSeverity, number> = {
  blocking: 0, attention: 1, info: 2,
};

export function isOpenFollowup(followup: { state: string }): boolean {
  return OPEN_FOLLOWUP_STATES.includes(followup.state);
}

/**
 * A REVISÃO REGENTE de uma proposta.
 *
 * A aceita continua regendo mesmo quando existe um rascunho mais novo — é a
 * regra do §1, e a tela de propostas já a aplicava por conta própria. Trazê-la
 * para cá é o que faz lista, dossiê e sinais concordarem sobre qual revisão
 * está valendo.
 */
export function governingRevision<T extends { proposal_id: string; revision: number; status: string }>(
  revisions: T[],
): Map<string, T> {
  const map = new Map<string, T>();
  for (const revision of revisions) {
    const current = map.get(revision.proposal_id);
    if (revision.status === 'ACCEPTED') {
      map.set(revision.proposal_id, revision);
      continue;
    }
    if (current?.status === 'ACCEPTED') continue;
    if (!current || revision.revision > current.revision) map.set(revision.proposal_id, revision);
  }
  return map;
}

export function buildPipelineSignals(input: PipelineSignalInput): PipelineSignal[] {
  const now = input.now ?? new Date();
  const signals: PipelineSignal[] = [];

  const openFollowupsBySource = new Map<string, SignalFollowup[]>();
  for (const followup of input.followups) {
    if (!isOpenFollowup(followup)) continue;
    const key = `${followup.source_kind}:${followup.source_id}`;
    const list = openFollowupsBySource.get(key);
    if (list) list.push(followup);
    else openFollowupsBySource.set(key, [followup]);
  }

  const proposalsByOpportunity = new Map<string, SignalProposal[]>();
  for (const proposal of input.proposals) {
    if (!proposal.opportunity_id) continue;
    const list = proposalsByOpportunity.get(proposal.opportunity_id);
    if (list) list.push(proposal);
    else proposalsByOpportunity.set(proposal.opportunity_id, [proposal]);
  }
  const governing = governingRevision(input.revisions);

  for (const opportunity of input.opportunities) {
    const open = isOpenStage(opportunity.stage);

    // 1. Ganhou e ninguém autorizou a execução.
    //
    // Ganhar registra o RESULTADO COMERCIAL; autorizar o trabalho é outro ato,
    // com outra permissão. Sem este sinal, o intervalo entre os dois é invisível
    // — e é justamente nele que alguém começa a executar sem cobertura.
    if (opportunity.stage === 'WON' && !opportunity.engagement_id) {
      signals.push({
        kind: 'WON_WITHOUT_AUTHORIZED_WORK',
        severity: 'attention',
        opportunityId: opportunity.id,
        title: `${opportunity.title} foi ganha sem trabalho autorizado`,
        detail: 'O resultado comercial está registrado e nenhuma autorização abriu a execução.',
        suggestedAction: 'Abrir o trabalho autorizado a partir da fonte de autorização',
      });
    }

    if (!open) continue;

    // 2. Nenhum próximo passo combinado.
    //
    // A pergunta é do motor canônico de acompanhamento: existe `apex_followup`
    // aberto apontando para esta oportunidade? Não inventamos um segundo campo
    // de "próxima ação" na oportunidade — ele divergiria da fila no primeiro dia.
    const openFollowups = openFollowupsBySource.get(`commercial_opportunity:${opportunity.id}`) ?? [];
    const proposalFollowups = (proposalsByOpportunity.get(opportunity.id) ?? [])
      .flatMap((proposal) => openFollowupsBySource.get(`commercial_proposal:${proposal.id}`) ?? []);
    const allOpen = [...openFollowups, ...proposalFollowups];
    if (allOpen.length === 0) {
      signals.push({
        kind: 'NO_NEXT_ACTION',
        severity: 'attention',
        opportunityId: opportunity.id,
        title: `${opportunity.title} está sem próxima ação`,
        detail: `Nenhum acompanhamento aberto para ${opportunity.counterparty_name}. `
          + 'Uma oportunidade sem próximo passo combinado avança por acaso.',
        suggestedAction: 'Agendar o follow-up com objetivo, responsável e prazo',
      });
    }

    // 3. A contraparte passou do prazo que ela mesma tinha.
    //
    // `next_expected_event_at` é o que cala a cobrança enquanto a bola está com
    // o outro lado (migration 156). Passada a data, o silêncio deixa de ser
    // espera e vira atraso — e é exatamente aí que o sinal aparece.
    const overdue = allOpen.filter((followup) =>
      followup.state === 'WAITING_EXTERNAL_PARTY'
      && followup.next_expected_event_at !== null
      && (daysBetween(followup.next_expected_event_at, now) ?? -1) > 0);
    if (overdue.length > 0) {
      const worst = Math.max(...overdue.map((f) => daysBetween(f.next_expected_event_at, now) ?? 0));
      signals.push({
        kind: 'CUSTOMER_RESPONSE_OVERDUE',
        severity: 'blocking',
        opportunityId: opportunity.id,
        title: `${opportunity.counterparty_name} está ${worst} dia(s) além do retorno esperado`,
        detail: overdue.map((f) => f.next_expected_event ?? f.goal).join(' · '),
        suggestedAction: 'Retomar o contato e registrar a nova data esperada',
      });
    }

    // 4. Parada na etapa além do limiar declarado.
    const ageInStage = daysBetween(opportunity.stage_entered_at, now);
    const limit = STAGE_STALL_DAYS[opportunity.stage];
    if (ageInStage !== null && limit !== undefined && ageInStage > limit) {
      signals.push({
        kind: 'OPPORTUNITY_STALLED',
        severity: 'attention',
        opportunityId: opportunity.id,
        title: `${opportunity.title} está há ${ageInStage} dias na mesma etapa`,
        detail: `O limiar declarado para esta etapa é de ${limit} dias. `
          + 'O número é uma política do time, não uma previsão do sistema.',
        suggestedAction: 'Avançar, recuar com motivo, ou encerrar a oportunidade',
      });
    }

    // 5. Sem previsão de decisão: fora do forecast, e ninguém percebeu.
    if (!opportunity.expected_decision_date) {
      signals.push({
        kind: 'MISSING_EXPECTED_CLOSE',
        severity: 'info',
        opportunityId: opportunity.id,
        title: `${opportunity.title} não tem previsão de decisão`,
        detail: 'Sem a data, a oportunidade não entra em nenhum mês do forecast — '
          + 'ela some da leitura executiva sem sair do funil.',
        suggestedAction: 'Informar a data prevista de decisão',
      });
    }

    // 6. Probabilidade informada incompatível com a etapa.
    //
    // Não é o sistema discordando do juízo de quem vende: é a etapa e o número
    // contando histórias diferentes. Uma das duas está desatualizada, e o
    // forecast está usando a que for pior.
    const band = STAGE_PROBABILITY_BAND[opportunity.stage];
    const probability = opportunity.probability === null || opportunity.probability === undefined
      ? null : Number(opportunity.probability);
    if (band && probability !== null && Number.isFinite(probability)
        && (probability < band.min || probability > band.max)) {
      signals.push({
        kind: 'STAGE_PROBABILITY_INCONSISTENT',
        severity: 'attention',
        opportunityId: opportunity.id,
        title: `${Math.round(probability * 100)}% é incompatível com a etapa atual`,
        detail: `A faixa declarada para esta etapa vai de ${Math.round(band.min * 100)}% a `
          + `${Math.round(band.max * 100)}%. O forecast pondera pelo número informado.`,
        suggestedAction: 'Ajustar a etapa ou a probabilidade — a que estiver desatualizada',
      });
    }

    // 7. A proposta que está com o cliente vence (ou venceu).
    for (const proposal of proposalsByOpportunity.get(opportunity.id) ?? []) {
      const revision = governing.get(proposal.id);
      if (!revision || !revision.validity_until) continue;
      if (revision.status !== 'SENT' && revision.status !== 'NEGOTIATION') continue;
      const elapsed = daysBetween(revision.validity_until, now);
      if (elapsed === null) continue;
      if (elapsed > 0) {
        signals.push({
          kind: 'PROPOSAL_VALIDITY_LAPSED',
          severity: 'blocking',
          opportunityId: opportunity.id,
          proposalId: proposal.id,
          title: `Proposta ${proposal.proposal_number} passou da validade há ${elapsed} dia(s)`,
          detail: 'Uma revisão fora da validade não pode ser aceita como está. '
            + 'Expirar ou revisar são atos distintos, e nenhum deles acontece sozinho.',
          suggestedAction: 'Registrar a expiração ou emitir uma nova revisão',
        });
      } else if (-elapsed <= PROPOSAL_EXPIRY_WARNING_DAYS) {
        signals.push({
          kind: 'PROPOSAL_EXPIRING',
          severity: 'attention',
          opportunityId: opportunity.id,
          proposalId: proposal.id,
          title: `Proposta ${proposal.proposal_number} vence em ${-elapsed} dia(s)`,
          detail: `Validade até ${revision.validity_until}. Depois disso, o aceite exige uma revisão nova.`,
          suggestedAction: 'Cobrar a decisão do cliente antes do fim da validade',
        });
      }
    }
  }

  return sortPipelineSignals(signals);
}

/** Bloqueante primeiro: a fila mostra o que impede antes do que atrasa. */
export function sortPipelineSignals(signals: PipelineSignal[]): PipelineSignal[] {
  return [...signals].sort((a, b) => SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity]);
}

export const PIPELINE_SIGNAL_LABEL: Record<PipelineSignalKind, string> = {
  NO_NEXT_ACTION: 'Sem próxima ação',
  CUSTOMER_RESPONSE_OVERDUE: 'Retorno do cliente atrasado',
  PROPOSAL_EXPIRING: 'Proposta a vencer',
  PROPOSAL_VALIDITY_LAPSED: 'Validade vencida',
  OPPORTUNITY_STALLED: 'Oportunidade parada',
  MISSING_EXPECTED_CLOSE: 'Sem previsão de decisão',
  STAGE_PROBABILITY_INCONSISTENT: 'Etapa e probabilidade discordam',
  WON_WITHOUT_AUTHORIZED_WORK: 'Ganha sem trabalho autorizado',
  SURVEY_PENDING: 'Levantamento pendente',
  PROPOSAL_NOT_READY: 'Proposta não pronta',
  ACCEPTED_WITHOUT_AUTHORIZATION: 'Aceita sem autorização',
  ACCEPTED_WITHOUT_SERVICE_ORDER: 'Aceita sem OS',
  SERVICE_ORDER_WITHOUT_PROJECT: 'OS sem projeto',
  DOCUMENTATION_PENDING: 'Documentação pendente',
  SOURCE_CHAIN_INCOMPLETE: 'Cadeia de origem incompleta',
};

/** Índice por oportunidade — o que a linha da lista e o card do pipeline usam. */
export function signalsByOpportunity(signals: PipelineSignal[]): Map<string, PipelineSignal[]> {
  const map = new Map<string, PipelineSignal[]>();
  for (const signal of signals) {
    if (!signal.opportunityId) continue;
    const list = map.get(signal.opportunityId);
    if (list) list.push(signal);
    else map.set(signal.opportunityId, [signal]);
  }
  return map;
}

/** As etapas abertas, na ordem do funil — reexportado para a tela não reimportar. */
export const PIPELINE_STAGES = OPEN_OPPORTUNITY_STAGES;
