/**
 * Escrita e leitura do acompanhamento do Apex — server-only.
 *
 * `apex_followups` não concede escrita ao navegador (migration 156): quem
 * grava é este módulo, pelo service role, depois que a rota já decidiu a
 * permissão. Isso mantém a autoridade num lugar só e deixa o gatilho do banco
 * como última barreira em vez de única.
 *
 * ─── O que este módulo NÃO faz ─────────────────────────────────────────────
 *
 * Ele não carimba autoridade humana pelo service role. Designação de
 * responsável e confirmação humana precisam de sessão autenticada — a conexão
 * de serviço não tem `auth.uid()`, e o gatilho recusa. Por isso essas duas
 * operações usam o cliente da SESSÃO do usuário, não o de serviço: é a mesma
 * doutrina da revisão de cláusula (migration 153).
 */
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  ApexFollowupRow, ApexFollowupEventRow, FollowupSourceKind, FollowupState,
  VerificationMode,
} from '../types';
import { isValidTransition } from '../state';

if (typeof window !== 'undefined') {
  throw new Error('platform/followups/server/store.ts não pode ser importado no navegador.');
}

let client: SupabaseClient | null = null;

export class FollowupSchemaMissingError extends Error {
  constructor() {
    super('A fundação de acompanhamento não está aplicada neste ambiente. Aplique a migration 156.');
    this.name = 'FollowupSchemaMissingError';
  }
}

function check(error: { code?: string; message?: string } | null, context: string): void {
  if (!error) return;
  if (['42P01', 'PGRST205'].includes(error.code ?? '')) throw new FollowupSchemaMissingError();
  throw new Error(`${context}: ${error.message ?? 'erro desconhecido'}`);
}

export function followupServiceClient(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase não configurado no servidor.');
  client = createServiceClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export interface FollowupActor {
  readonly userId: string;
  readonly organizationId: string;
}

export interface CreateFollowupInput {
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

/**
 * Cria o acompanhamento.
 *
 * O Apex pode identificar e abrir; DESIGNAR é ato humano, e por isso o carimbo
 * `assigned_by` só é gravado pelo caminho de sessão (`assignResponsible`). Um
 * `responsibleUserId` informado aqui é intenção registrada, não designação
 * governada — a diferença aparece no histórico e é ela que impede o produto de
 * dizer que alguém assumiu algo que nunca assumiu.
 */
export async function createFollowup(
  actor: FollowupActor,
  input: CreateFollowupInput,
): Promise<ApexFollowupRow> {
  const supabase = followupServiceClient();
  const { data, error } = await supabase
    .from('apex_followups')
    .insert({
      organization_id: actor.organizationId,
      source_kind: input.sourceKind,
      source_id: input.sourceId,
      contract_id: input.contractId ?? null,
      goal: input.goal,
      expected_evidence: input.expectedEvidence ?? null,
      responsible_user_id: input.responsibleUserId ?? null,
      responsible_party_id: input.responsiblePartyId ?? null,
      responsible_text: input.responsibleText ?? null,
      due_date: input.dueDate ?? null,
      cadence_days: input.cadenceDays ?? null,
      escalate_after_days: input.escalateAfterDays ?? null,
      escalation_target_user_id: input.escalationTargetUserId ?? null,
      verification_mode: input.verificationMode ?? 'human_confirmation',
      verification_rule: input.verificationRule ?? null,
      state: 'ACTIVE',
      created_by: actor.userId,
    })
    .select('*')
    .single();
  check(error, 'Falha ao abrir acompanhamento');
  return data as ApexFollowupRow;
}

export async function listFollowups(
  actor: FollowupActor,
  filter: { contractId?: string; sourceKind?: FollowupSourceKind; sourceId?: string; openOnly?: boolean } = {},
): Promise<ApexFollowupRow[]> {
  const supabase = followupServiceClient();
  let query = supabase
    .from('apex_followups')
    .select('*')
    .eq('organization_id', actor.organizationId)
    .order('due_date', { ascending: true, nullsFirst: false });

  if (filter.contractId) query = query.eq('contract_id', filter.contractId);
  if (filter.sourceKind) query = query.eq('source_kind', filter.sourceKind);
  if (filter.sourceId) query = query.eq('source_id', filter.sourceId);
  if (filter.openOnly) query = query.in('state', ['ACTIVE', 'WAITING_EXTERNAL_PARTY', 'BLOCKED', 'ESCALATED']);

  const { data, error } = await query;
  check(error, 'Falha ao listar acompanhamentos');
  return (data ?? []) as ApexFollowupRow[];
}

export async function listFollowupEvents(
  actor: FollowupActor,
  followupId: string,
): Promise<ApexFollowupEventRow[]> {
  const supabase = followupServiceClient();
  const { data, error } = await supabase
    .from('apex_followup_events')
    .select('*')
    .eq('organization_id', actor.organizationId)
    .eq('followup_id', followupId)
    .order('occurred_at', { ascending: false });
  check(error, 'Falha ao carregar histórico do acompanhamento');
  return (data ?? []) as ApexFollowupEventRow[];
}

async function loadOwned(actor: FollowupActor, followupId: string): Promise<ApexFollowupRow> {
  const supabase = followupServiceClient();
  const { data, error } = await supabase
    .from('apex_followups')
    .select('*')
    .eq('id', followupId)
    // O inquilino entra no WHERE, e não numa checagem depois: o service role
    // ignora RLS, então o escopo tem de ser explícito em toda consulta.
    .eq('organization_id', actor.organizationId)
    .maybeSingle();
  check(error, 'Falha ao carregar acompanhamento');
  if (!data) throw new Error('Acompanhamento não encontrado.');
  return data as ApexFollowupRow;
}

export interface TransitionInput {
  next: FollowupState;
  note?: string | null;
  /** Obrigatório ao entrar em WAITING_EXTERNAL_PARTY — é o que cala a cobrança. */
  nextExpectedEvent?: string | null;
  nextExpectedEventAt?: string | null;
}

export async function transitionFollowup(
  actor: FollowupActor,
  followupId: string,
  input: TransitionInput,
): Promise<ApexFollowupRow> {
  const current = await loadOwned(actor, followupId);
  if (!isValidTransition(current.state, input.next)) {
    throw new Error(`Transição de acompanhamento inválida: ${current.state} -> ${input.next}.`);
  }
  if (input.next === 'WAITING_EXTERNAL_PARTY' && !input.nextExpectedEventAt) {
    throw new Error('Aguardar a contraparte exige a data do próximo evento esperado.');
  }
  // Fechamento não passa por aqui: ele exige base de fechamento e, quando é
  // confirmação humana, sessão autenticada. Ver `completeFollowup`.
  if (input.next === 'COMPLETED') {
    throw new Error('Concluir um acompanhamento exige verificação — use o caminho de conclusão.');
  }

  const supabase = followupServiceClient();
  const { data, error } = await supabase
    .from('apex_followups')
    .update({
      state: input.next,
      state_note: input.note ?? null,
      next_expected_event: input.nextExpectedEvent ?? null,
      next_expected_event_at: input.nextExpectedEventAt ?? null,
      closed_at: input.next === 'CANCELLED' ? new Date().toISOString() : null,
      escalated_at: input.next === 'ESCALATED' ? new Date().toISOString() : current.escalated_at,
    })
    .eq('id', followupId)
    .eq('organization_id', actor.organizationId)
    .select('*')
    .single();
  check(error, 'Falha ao mudar o estado do acompanhamento');
  return data as ApexFollowupRow;
}

/** O Apex cobrou. Registrado para que a cadência seja verificável, não sentida. */
export async function recordNudge(actor: FollowupActor, followupId: string): Promise<ApexFollowupRow> {
  const current = await loadOwned(actor, followupId);
  const supabase = followupServiceClient();
  const { data, error } = await supabase
    .from('apex_followups')
    .update({ last_nudge_at: new Date().toISOString(), nudge_count: current.nudge_count + 1 })
    .eq('id', followupId)
    .eq('organization_id', actor.organizationId)
    .select('*')
    .single();
  check(error, 'Falha ao registrar cobrança');
  return data as ApexFollowupRow;
}

/**
 * Conclusão por EVIDÊNCIA verificada — o caminho que o Apex pode percorrer
 * sozinho, e só quando a regra de verificação é determinística. O gatilho da
 * 156 recusa qualquer outra combinação.
 */
export async function completeByVerifiedEvidence(
  actor: FollowupActor,
  followupId: string,
  evidenceId: string,
  basis: string,
): Promise<ApexFollowupRow> {
  const current = await loadOwned(actor, followupId);
  if (current.verification_mode !== 'deterministic_evidence') {
    throw new Error(
      'Este acompanhamento não tem regra determinística de verificação: a conclusão exige confirmação humana.',
    );
  }
  const supabase = followupServiceClient();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('apex_followups')
    .update({
      state: 'COMPLETED',
      closure_basis: 'verified_evidence',
      closed_at: now,
      verified_at: now,
      verification_evidence_id: evidenceId,
      state_note: basis,
    })
    .eq('id', followupId)
    .eq('organization_id', actor.organizationId)
    .select('*')
    .single();
  check(error, 'Falha ao concluir por evidência verificada');
  return data as ApexFollowupRow;
}
