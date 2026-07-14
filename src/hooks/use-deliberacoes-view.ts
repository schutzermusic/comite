'use client';

import { useCallback, useMemo } from 'react';
import { useDeliberations } from '@/hooks/use-deliberations';
import {
  requestOpinion as requestOpinionService,
  attachEvidence as attachEvidenceService,
  upsertExecutionItem as upsertExecutionItemService,
  generateMinutes as generateMinutesService,
  createDeliberationTask as createDeliberationTaskService,
  deleteDeliberation as deleteDeliberationService,
  type RequestOpinionInput,
  type AttachEvidenceInput,
  type ExecutionItemInput,
  type GenerateMinutesInput,
  type CreateDeliberationTaskInput,
  type CastVoteInput,
  type CreateDeliberationInput,
} from '@/lib/services/deliberations';
import { resolveTemplate } from '@/lib/deliberations-policy';
import { mapLiveToDeliberacao, VOTE_CHOICE_MAP, type UiVoteChoice } from '@/lib/deliberacoes/live-adapter';
import { DELIBERACOES_MOCK } from '@/components/deliberacoes/mock-data';
import type { Deliberacao } from '@/components/deliberacoes/types';
import type { NewDeliberationPayload } from '@/components/deliberacoes/NewDeliberationModal';

// Identidade de exibição da submissão. O serviço sobrescreve created_by /
// organization_id com o usuário autenticado real (RLS); estes rótulos são
// apenas cosméticos e espelham o fluxo já validado em /pautas.
const CURRENT_USER_ID = 'user-current';
const CURRENT_USER_NAME = 'Membro Corporativo';

/** Mapeia o payload do formulário para o input do serviço de criação. */
function buildCreateInput(payload: NewDeliberationPayload): CreateDeliberationInput {
  const template = resolveTemplate(payload.templateId);
  const linkedEntities = [
    payload.linkedProjectLabel
      ? { id: `proj-${Date.now()}`, label: payload.linkedProjectLabel, type: 'project' as const }
      : null,
    payload.linkedContractLabel
      ? { id: `ctr-${Date.now()}`, label: payload.linkedContractLabel, type: 'contract' as const }
      : null,
  ].filter((entity): entity is NonNullable<typeof entity> => entity !== null);
  const ownerStage = payload.stages.find((stage) => stage.stageType === 'owner_review') ?? payload.stages[0];

  // Roteamento inteligente → estados iniciais. Votação direta abre a janela
  // imediatamente; revisão entra como submetida; rascunho fica editável.
  const now = new Date();
  const windowHours = ownerStage?.votingRule.votingWindowHours ?? payload.votingWindowHours;
  const deliberationStatus =
    payload.route === 'voting' ? 'in_voting' : payload.route === 'draft' ? 'draft' : 'submitted';
  const backlogStatus = payload.route === 'draft' ? 'draft' : 'under_review';
  const votingStartedAt = payload.route === 'voting' ? now : undefined;
  const votingClosedAt =
    payload.route === 'voting' ? new Date(now.getTime() + windowHours * 60 * 60 * 1000) : undefined;

  return {
    title: payload.title,
    description: payload.description,
    status: backlogStatus,
    type: payload.businessArea,
    priority: payload.priority,
    createdBy: CURRENT_USER_ID,
    createdByName: CURRENT_USER_NAME,
    ownerName: CURRENT_USER_NAME,
    submittedAt: now,
    dueDate: payload.deadline ? new Date(payload.deadline) : undefined,
    deliberationStatus,
    // Persistidos em metadata: permitem ao dossiê mostrar "Em revisão" no
    // fluxo histórico mesmo sem parecer emitido (revisão formal ≠ parecer).
    creationRoute: payload.route,
    enteredReviewAt: payload.route === 'review' ? now : undefined,
    votingStartedAt,
    votingClosedAt,
    ownerCommitteeId: payload.ownerCommitteeId,
    ownerCommitteeName: payload.ownerCommitteeName,
    dependentCommitteeIds: payload.dependentCommitteeIds,
    dependentCommitteeNames: payload.dependentCommitteeNames,
    templateId: payload.templateId,
    templateName: template?.name || payload.templateId,
    requestedDecision: payload.description,
    strategicFlag: payload.strategicFlag,
    financialImpact: payload.financialImpact,
    riskLevel: payload.riskLevel,
    marginPercent: payload.marginPercent,
    evidenceComplete: false,
    stages: payload.stages,
    currentStageId: ownerStage?.id,
    quorumRequired: Math.max(1, Math.ceil((ownerStage?.votingRule.quorumPercent ?? payload.quorumPercent) * 5 / 100)),
    executionItems: [],
    linkedEntities,
  };
}

/** Supabase is considered configured when both public env vars are present. */
const SUPABASE_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

const DEMO_ERROR =
  'Ação indisponível em modo demonstração. Conecte o Supabase para registrar operações reais.';

/**
 * View-model for the Decision Control Room. Live-first: when Supabase is
 * configured it reads the shared backbone (deliberations + votes) and maps it
 * to the `Deliberacao` shape the refactored UI renders. When Supabase is NOT
 * configured (local/dev), it falls back to DELIBERACOES_MOCK and flags
 * `isDemo` so the UI can label the data and disable real mutations — mock is
 * never presented as official data in Supabase/production mode.
 */
export function useDeliberacoesView() {
  const {
    deliberations: liveItems,
    loading,
    error,
    refresh,
    castVote: castVoteLive,
    createDeliberation: createDeliberationLive,
  } = useDeliberations();

  const isDemo = !SUPABASE_CONFIGURED;

  const items: Deliberacao[] = useMemo(() => {
    if (isDemo) return DELIBERACOES_MOCK;
    // `now` defaults inside the adapter (plain lib fn) so SLA derivation stays
    // out of the hook's render body.
    return liveItems.map((it) => mapLiveToDeliberacao(it));
  }, [isDemo, liveItems]);

  const guardDemo = useCallback(() => {
    if (isDemo) throw new Error(DEMO_ERROR);
  }, [isDemo]);

  const castVote = useCallback(
    async (id: string, choice: UiVoteChoice, justification?: string) => {
      guardDemo();
      const input: CastVoteInput = { vote: VOTE_CHOICE_MAP[choice], justification };
      await castVoteLive(id, input);
    },
    [guardDemo, castVoteLive],
  );

  const requestOpinion = useCallback(
    async (id: string, input: RequestOpinionInput) => {
      guardDemo();
      await requestOpinionService(id, input);
      await refresh();
    },
    [guardDemo, refresh],
  );

  const attachEvidence = useCallback(
    async (id: string, input: AttachEvidenceInput) => {
      guardDemo();
      await attachEvidenceService(id, input);
      await refresh();
    },
    [guardDemo, refresh],
  );

  const upsertExecution = useCallback(
    async (id: string, input: ExecutionItemInput) => {
      guardDemo();
      await upsertExecutionItemService(id, input);
      await refresh();
    },
    [guardDemo, refresh],
  );

  const generateMinutes = useCallback(
    async (id: string, input: GenerateMinutesInput = {}) => {
      guardDemo();
      await generateMinutesService(id, input);
      await refresh();
    },
    [guardDemo, refresh],
  );

  const createTask = useCallback(
    async (id: string, input: CreateDeliberationTaskInput) => {
      guardDemo();
      await createDeliberationTaskService(id, input);
      await refresh();
    },
    [guardDemo, refresh],
  );

  // Exclui uma deliberação (restrito a admin na UI; RLS reforça no backend).
  const deleteDeliberation = useCallback(
    async (id: string) => {
      guardDemo();
      await deleteDeliberationService(id);
      await refresh();
    },
    [guardDemo, refresh],
  );

  // Cria e persiste uma nova deliberação a partir do payload do formulário.
  // `createDeliberationLive` já dá refresh na lista após inserir.
  const createDeliberation = useCallback(
    async (payload: NewDeliberationPayload) => {
      guardDemo();
      return createDeliberationLive(buildCreateInput(payload));
    },
    [guardDemo, createDeliberationLive],
  );

  return {
    items,
    loading: isDemo ? false : loading,
    error: isDemo ? null : error,
    isDemo,
    refresh,
    castVote,
    requestOpinion,
    attachEvidence,
    upsertExecution,
    generateMinutes,
    createTask,
    createDeliberation,
    deleteDeliberation,
  };
}
