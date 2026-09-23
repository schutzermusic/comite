/**
 * SINAIS DE FLUXO — do levantamento ao projeto.
 *
 * Mesma natureza de `pipeline-signals.ts`: regra conferível sobre datas e
 * estados, com próximo passo e sem escrita. A diferença é o trecho do caminho
 * que eles vigiam — a passagem entre descobrir, propor, fechar e executar,
 * que é onde o trabalho costuma começar sem cobertura.
 */
import type { PipelineSignal } from './pipeline-signals';
import { sortPipelineSignals } from './pipeline-signals';
import type { ReadinessResult } from './proposal-readiness';
import { isSurveyOpen, type SiteSurveyStatus } from './site-survey';
import { daysBetween } from './stage-policy';
import type { OpportunityStage } from './types';

export interface ExecutionSignalInput {
  opportunity: { id: string; title: string; stage: OpportunityStage; engagement_id: string | null };
  surveys: Array<{ id: string; code: string; status: SiteSurveyStatus; planned_visit_date: string | null }>;
  readiness: ReadinessResult | null;
  proposalCount: number;
  acceptedRevisions: Array<{ id: string; label: string }>;
  engagement: { id: string; status: string } | null;
  serviceOrders: Array<{ id: string; os_number: string; status: string; project_id: string | null }>;
  executionStart: {
    id: string; documentation_state: string; regularization_due_date: string | null;
  } | null;
  now?: Date;
}

export function buildExecutionSignals(input: ExecutionSignalInput): PipelineSignal[] {
  const now = input.now ?? new Date();
  const o = input.opportunity;
  const signals: PipelineSignal[] = [];

  for (const survey of input.surveys.filter((s) => isSurveyOpen(s.status))) {
    const late = survey.planned_visit_date !== null
      && ['PLANNED', 'SCHEDULED'].includes(survey.status)
      && (daysBetween(survey.planned_visit_date, now) ?? 0) > 0;
    signals.push({
      kind: 'SURVEY_PENDING',
      severity: late ? 'blocking' : 'attention',
      opportunityId: o.id,
      title: late
        ? `${survey.code}: visita prevista para ${survey.planned_visit_date} não foi iniciada`
        : `${survey.code} ainda não concluído`,
      detail: 'Sem o levantamento concluído, a proposta técnica depende de suposição.',
      suggestedAction: late ? 'Reagendar ou iniciar a visita' : 'Concluir o levantamento em campo',
    });
  }

  if (input.readiness && input.readiness.state === 'NOT_READY'
      && ['DISCOVERY', 'PROPOSAL'].includes(o.stage) && input.proposalCount === 0) {
    signals.push({
      kind: 'PROPOSAL_NOT_READY',
      severity: 'attention',
      opportunityId: o.id,
      title: 'Faltam informações para propor',
      detail: input.readiness.missing.slice(0, 2).join(' · '),
      suggestedAction: 'Resolver as lacunas da prontidão antes de redigir a proposta',
    });
  }

  if (input.acceptedRevisions.length && !input.engagement) {
    signals.push({
      kind: 'ACCEPTED_WITHOUT_AUTHORIZATION',
      severity: 'blocking',
      opportunityId: o.id,
      title: `${input.acceptedRevisions.map((r) => r.label).join(', ')} aceita sem trabalho autorizado`,
      detail: 'O cliente aceitou e nenhuma execução foi autorizada — ou o trabalho começou sem cobertura.',
      suggestedAction: 'Fechar negócio e iniciar execução',
    });
  }

  if (input.engagement && input.engagement.status === 'AUTHORIZED'
      && !input.serviceOrders.some((order) => order.status !== 'CANCELLED')) {
    signals.push({
      kind: 'ACCEPTED_WITHOUT_SERVICE_ORDER',
      severity: 'attention',
      opportunityId: o.id,
      title: 'Trabalho autorizado sem OS interna',
      detail: 'A execução está autorizada e nenhuma OS interna a liberou para a operação.',
      suggestedAction: 'Gerar, enviar ou vincular a OS interna',
    });
  }

  for (const order of input.serviceOrders) {
    if (order.status === 'ISSUED' && !order.project_id) {
      signals.push({
        kind: 'SERVICE_ORDER_WITHOUT_PROJECT',
        severity: 'attention',
        opportunityId: o.id,
        title: `${order.os_number} emitida sem projeto`,
        detail: 'A OS foi emitida e nenhum projeto recebe a execução, a medição e as evidências.',
        suggestedAction: 'Criar ou vincular o projeto a partir da OS',
      });
    }
    if (order.status === 'PENDING_CONFIRMATION') {
      signals.push({
        kind: 'SOURCE_CHAIN_INCOMPLETE',
        severity: 'blocking',
        opportunityId: o.id,
        title: `${order.os_number} diverge da fonte regente`,
        detail: 'A OS não pode ser emitida enquanto a divergência estiver aberta.',
        suggestedAction: 'Resolver a divergência nomeando a fonte que prevalece',
      });
    }
  }

  if (input.executionStart?.documentation_state === 'PENDING') {
    const due = input.executionStart.regularization_due_date;
    const overdue = due !== null && (daysBetween(due, now) ?? 0) > 0;
    signals.push({
      kind: 'DOCUMENTATION_PENDING',
      severity: 'blocking',
      opportunityId: o.id,
      title: overdue
        ? `Documentação comercial vencida desde ${due}`
        : `Execução iniciada com documentação pendente${due ? ` — prazo ${due}` : ''}`,
      detail: 'O projeto roda; o faturamento continua bloqueado até a regularização.',
      suggestedAction: 'Anexar o PO, contrato ou aceite formal e regularizar',
    });
  }

  if (o.stage === 'WON' && o.engagement_id && input.engagement === null) {
    signals.push({
      kind: 'SOURCE_CHAIN_INCOMPLETE',
      severity: 'info',
      opportunityId: o.id,
      title: 'Trabalho autorizado fora do seu alcance de leitura',
      detail: 'A oportunidade aponta para um trabalho autorizado que esta sessão não pode ler.',
      suggestedAction: 'Pedir a quem tem contracts.view para conferir a cadeia',
    });
  }

  return sortPipelineSignals(signals);
}
