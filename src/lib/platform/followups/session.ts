/**
 * Os atos de AUTORIDADE HUMANA no acompanhamento.
 *
 * Eles não passam pelo service role de propósito. O service role não tem
 * `auth.uid()`, e o gatilho da migration 156 recusa — corretamente — qualquer
 * carimbo humano vindo de conexão sem sessão. O caminho legítimo são as
 * funções `SECURITY DEFINER` da 157, chamadas com o cliente da SESSÃO: elas
 * gravam com privilégio de dono, mas leem de quem é a decisão do próprio JWT.
 *
 * A consequência prática é a que importa: não existe argumento que faça o
 * produto atribuir uma designação ou uma confirmação a outra pessoa.
 */
import { createClient } from '@/utils/supabase/server';
import type { ApexFollowupRow, FollowupSourceKind, FollowupState, VerificationMode } from './types';

export interface CreateSessionFollowupInput {
  sourceKind: FollowupSourceKind;
  sourceId: string;
  contractId?: string | null;
  goal: string;
  expectedEvidence?: string | null;
  responsibleUserId?: string | null;
  responsiblePartyId?: string | null;
  responsibleText?: string | null;
  dueDate?: string | null;
  cadenceDays?: number | null;
  escalateAfterDays?: number | null;
  escalationTargetUserId?: string | null;
  verificationMode?: VerificationMode;
  verificationRule?: Record<string, unknown> | null;
}

export async function createFollowupAsHuman(
  idempotencyKey: string,
  input: CreateSessionFollowupInput,
): Promise<ApexFollowupRow> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('apex_followup_create', {
    p_idempotency_key: idempotencyKey,
    p_source_kind: input.sourceKind,
    p_source_id: input.sourceId,
    p_contract_id: input.contractId ?? null,
    p_goal: input.goal,
    p_expected_evidence: input.expectedEvidence ?? null,
    p_responsible_user_id: input.responsibleUserId ?? null,
    p_responsible_party_id: input.responsiblePartyId ?? null,
    p_responsible_text: input.responsibleText ?? null,
    p_due_date: input.dueDate ?? null,
    p_cadence_days: input.cadenceDays ?? null,
    p_escalate_after_days: input.escalateAfterDays ?? null,
    p_escalation_target_user_id: input.escalationTargetUserId ?? null,
    p_verification_mode: input.verificationMode ?? 'human_confirmation',
    p_verification_rule: input.verificationRule ?? null,
  });
  if (error) throw new Error(`Erro ao abrir acompanhamento: ${error.message}`);
  return data as ApexFollowupRow;
}

export interface TransitionSessionFollowupInput {
  next: FollowupState;
  note?: string | null;
  nextExpectedEvent?: string | null;
  nextExpectedEventAt?: string | null;
}

export async function transitionFollowupAsHuman(
  followupId: string,
  input: TransitionSessionFollowupInput,
): Promise<ApexFollowupRow> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('apex_followup_transition', {
    p_followup_id: followupId,
    p_next: input.next,
    p_note: input.note ?? null,
    p_next_expected_event: input.nextExpectedEvent ?? null,
    p_next_expected_event_at: input.nextExpectedEventAt ?? null,
  });
  if (error) throw new Error(`Erro ao mudar o estado do acompanhamento: ${error.message}`);
  return data as ApexFollowupRow;
}

export interface AssignFollowupInput {
  responsibleUserId?: string | null;
  responsiblePartyId?: string | null;
  responsibleText?: string | null;
  dueDate?: string | null;
  cadenceDays?: number | null;
  expectedEvidence?: string | null;
}

export async function assignFollowupResponsible(
  followupId: string,
  input: AssignFollowupInput,
): Promise<ApexFollowupRow> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('apex_followup_assign', {
    p_followup_id: followupId,
    p_responsible_user_id: input.responsibleUserId ?? null,
    p_responsible_party_id: input.responsiblePartyId ?? null,
    p_responsible_text: input.responsibleText ?? null,
    p_due_date: input.dueDate ?? null,
    p_cadence_days: input.cadenceDays ?? null,
    p_expected_evidence: input.expectedEvidence ?? null,
  });
  if (error) throw new Error(`Erro ao designar responsável: ${error.message}`);
  return data as ApexFollowupRow;
}

export async function confirmFollowupCompletion(
  followupId: string,
  note?: string | null,
): Promise<ApexFollowupRow> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('apex_followup_confirm_completion', {
    p_followup_id: followupId,
    p_note: note ?? null,
  });
  if (error) throw new Error(`Erro ao concluir o acompanhamento: ${error.message}`);
  return data as ApexFollowupRow;
}
