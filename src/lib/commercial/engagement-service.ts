/**
 * Serviço servidor do trabalho autorizado.
 *
 * TODA escrita passa por uma função governada (`SECURITY DEFINER`, negada a
 * `authenticated`) chamada pelo service role, DEPOIS que a rota já decidiu a
 * autorização. Este arquivo não tem uma única escrita direta em tabela — nem
 * um `insert`, nem um `update`. Se tivesse, existiria um segundo caminho ao
 * redor das regras de estado, e o portão do banco viraria decoração.
 */
if (typeof window !== 'undefined') {
  throw new Error('engagement-service.ts não pode ser importado no navegador');
}

import { platformServiceClient } from '@/lib/platform/server-client';
import type { AuthorizationSourceKind, DocumentContext } from './types';

export interface CreateEngagementInput {
  title: string;
  counterpartyName: string;
  counterpartyPartyId?: string | null;
  currency?: string;
  origin: 'formal_contract' | 'accepted_proposal' | 'customer_po' | 'customer_authorization' | 'manual';
  engagementNumber?: string | null;
  notes?: string | null;
}

export interface AttachAuthorizationInput {
  sourceKind: AuthorizationSourceKind;
  contractId?: string | null;
  proposalRevisionId?: string | null;
  documentId?: string | null;
  externalReference?: string | null;
  authorizedValue?: number | null;
  currency?: string | null;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  note?: string | null;
}

export interface CreateServiceOrderInput {
  origin: 'from_accepted_proposal' | 'manual' | 'uploaded_document';
  osNumber: string;
  title: string;
  sourceProposalRevisionId?: string | null;
  documentId?: string | null;
  intakeId?: string | null;
  authorizedValue?: number | null;
  currency?: string | null;
  scopeSummary?: string | null;
  plannedStart?: string | null;
  plannedFinish?: string | null;
  responsibleUserId?: string | null;
  notes?: string | null;
}

const snake = (input: object): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    out[key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = value;
  }
  return out;
};

async function rpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await platformServiceClient().rpc(name, params);
  if (error) throw new Error(error.message);
  return data as T;
}

export function createEngagement(
  organizationId: string, actorId: string, input: CreateEngagementInput,
): Promise<string> {
  return rpc<string>('commercial_engagement_create', {
    p_organization_id: organizationId, p_actor: actorId, p_payload: snake(input),
  });
}

export function attachAuthorization(
  organizationId: string, actorId: string, engagementId: string, input: AttachAuthorizationInput,
): Promise<{ authorization_id: string; governing: boolean; divergences_opened: number }> {
  return rpc('commercial_engagement_attach_authorization', {
    p_organization_id: organizationId, p_actor: actorId,
    p_engagement_id: engagementId, p_payload: snake(input),
  });
}

/** Promover a fonte regente exige motivo escrito — o banco também exige. */
export function setGoverningSource(
  organizationId: string, actorId: string, authorizationId: string, note: string,
): Promise<{ engagement_id: string; previous_authorization_id: string | null }> {
  return rpc('commercial_engagement_set_governing', {
    p_organization_id: organizationId, p_actor: actorId,
    p_authorization_id: authorizationId, p_note: note,
  });
}

export function authorizeEngagement(
  organizationId: string, actorId: string, engagementId: string, note?: string | null,
): Promise<{ engagement_id: string; status: string; governing_source_kind?: string }> {
  return rpc('commercial_engagement_authorize', {
    p_organization_id: organizationId, p_actor: actorId,
    p_engagement_id: engagementId, p_note: note ?? null,
  });
}

/**
 * Registra a manifestação do CLIENTE sobre uma revisão.
 *
 * `actorId` é o humano da Insight que responde pelo registro — nunca "o
 * sistema". O banco recusa ator nulo, e é por isso que não existe caminho de
 * integração que aceite proposta sozinho.
 */
export function recordProposalOutcome(
  organizationId: string, actorId: string, revisionId: string,
  outcome: 'ACCEPTED' | 'REJECTED' | 'EXPIRED',
  payload: Record<string, unknown>,
): Promise<{ revision_id: string; status: string }> {
  return rpc('commercial_proposal_revision_record_outcome', {
    p_organization_id: organizationId, p_actor: actorId,
    p_revision_id: revisionId, p_outcome: outcome, p_payload: payload,
  });
}

export function createServiceOrder(
  organizationId: string, actorId: string, engagementId: string, input: CreateServiceOrderInput,
): Promise<{ service_order_id: string; status: string }> {
  return rpc('internal_service_order_create', {
    p_organization_id: organizationId, p_actor: actorId,
    p_engagement_id: engagementId, p_payload: snake(input),
  });
}

export function compareServiceOrder(
  organizationId: string, serviceOrderId: string,
): Promise<{ compared: boolean; divergences_opened?: number; reason?: string }> {
  return rpc('internal_service_order_compare_with_governing', {
    p_organization_id: organizationId, p_service_order_id: serviceOrderId,
  });
}

export function issueServiceOrder(
  organizationId: string, actorId: string, serviceOrderId: string,
): Promise<{ service_order_id: string; status: string }> {
  return rpc('internal_service_order_issue', {
    p_organization_id: organizationId, p_actor: actorId, p_service_order_id: serviceOrderId,
  });
}

export function bindProject(
  organizationId: string, actorId: string, serviceOrderId: string,
  projectId: string, projectPayload: Record<string, unknown> | null,
): Promise<{ project_id: string; created: boolean; contract_linked: boolean }> {
  return rpc('internal_service_order_bind_project', {
    p_organization_id: organizationId, p_actor: actorId,
    p_service_order_id: serviceOrderId, p_project_id: projectId,
    p_project_payload: projectPayload,
  });
}

export function resolveDivergence(
  organizationId: string, actorId: string, divergenceId: string,
  prevailingSource: string, note: string,
): Promise<{ divergence_id: string; state: string }> {
  return rpc('commercial_divergence_resolve', {
    p_organization_id: organizationId, p_actor: actorId, p_divergence_id: divergenceId,
    p_resolved_source_kind: prevailingSource, p_note: note,
  });
}

/**
 * Pré-requisitos de faturamento do trabalho SEM contrato — só os fatos
 * ancorados no documento E confirmados por gente. Leitura, nunca escrita.
 */
export function engagementBillingPrerequisites(
  organizationId: string, engagementId: string,
): Promise<unknown[]> {
  return rpc('commercial_engagement_billing_prerequisites', {
    p_organization_id: organizationId, p_engagement_id: engagementId,
  });
}

/** Contextos que a Carteira aceita no "+ Adicionar". */
export const INTAKE_CONTEXT_BY_OPTION: Record<string, DocumentContext> = {
  contract: 'FORMAL_CONTRACT',
  proposal: 'COMMERCIAL_PROPOSAL',
  purchase_order: 'CUSTOMER_PO',
};

// ===========================================================================
// FUNIL COMERCIAL (202) — mesma regra: nenhuma escrita direta em tabela.
// ===========================================================================

export function upsertContact(
  organizationId: string, actorId: string, payload: Record<string, unknown>,
): Promise<string> {
  return rpc('commercial_contact_upsert', {
    p_organization_id: organizationId, p_actor: actorId, p_payload: payload });
}

export function upsertOpportunity(
  organizationId: string, actorId: string, payload: Record<string, unknown>,
): Promise<string> {
  return rpc('commercial_opportunity_upsert', {
    p_organization_id: organizationId, p_actor: actorId, p_payload: payload });
}

/**
 * Mudar a ETAPA é um ato, não a edição de um campo.
 *
 * O upsert acima deixou de mexer em `stage` (migration 212): avançar, recuar,
 * ganhar, perder e abandonar passam por aqui, deixam evento no histórico e
 * carimbam `stage_entered_at`. Perder e abandonar exigem motivo — o banco
 * recusa sem ele, e a rota recusa antes, com uma mensagem legível.
 */
export function transitionOpportunityStage(
  organizationId: string, actorId: string, opportunityId: string,
  toStage: string, reason: string | null,
): Promise<{ opportunity_id: string; from_stage: string; to_stage: string; closed: boolean }> {
  return rpc('commercial_opportunity_transition_stage', {
    p_organization_id: organizationId, p_actor: actorId,
    p_opportunity_id: opportunityId, p_to_stage: toStage, p_reason: reason });
}

export function createProposal(
  organizationId: string, actorId: string, payload: Record<string, unknown>,
): Promise<{ proposal_id: string; revision_id: string; revision: number }> {
  return rpc('commercial_proposal_create', {
    p_organization_id: organizationId, p_actor: actorId, p_payload: payload });
}

/** Revisar NUNCA edita a revisão anterior: cria a próxima e sucede a atual. */
export function reviseProposal(
  organizationId: string, actorId: string, revisionId: string, payload: Record<string, unknown>,
): Promise<{ revision_id: string; revision: number; supersedes_id: string }> {
  return rpc('commercial_proposal_revise', {
    p_organization_id: organizationId, p_actor: actorId,
    p_revision_id: revisionId, p_payload: payload });
}

export function transitionProposalRevision(
  organizationId: string, actorId: string, revisionId: string, to: string,
): Promise<{ revision_id: string; status: string }> {
  return rpc('commercial_proposal_revision_transition', {
    p_organization_id: organizationId, p_actor: actorId,
    p_revision_id: revisionId, p_to: to });
}

export function recordExtractedFact(
  organizationId: string, payload: Record<string, unknown>,
): Promise<string> {
  return rpc('commercial_fact_record', {
    p_organization_id: organizationId, p_payload: payload });
}

/** Confirmar é ato HUMANO: é ele que torna o fato promovível a regra. */
export function confirmExtractedFact(
  organizationId: string, actorId: string, factId: string,
  state: 'CONFIRMED' | 'CORRECTED' | 'REJECTED', correctedValue?: string | null,
): Promise<{ fact_id: string; confirmation_state: string; promotable: boolean }> {
  return rpc('commercial_fact_confirm', {
    p_organization_id: organizationId, p_actor: actorId, p_fact_id: factId,
    p_state: state, p_corrected_value: correctedValue ?? null });
}

export function createExecutionBlueprint(
  organizationId: string, actorId: string, revisionId: string, payload: Record<string, unknown>,
): Promise<string> {
  return rpc('commercial_blueprint_create', {
    p_organization_id: organizationId, p_actor: actorId,
    p_revision_id: revisionId, p_payload: payload });
}
