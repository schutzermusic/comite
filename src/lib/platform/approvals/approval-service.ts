'use client';

/**
 * Motor de Aprovação da Plataforma — acesso do lado do cliente.
 *
 * ─── O que este módulo pode e o que não pode ───────────────────────────────
 *
 * Pode LER (as visões canônicas) e pode CHAMAR as RPCs. Não pode escrever
 * pedido, etapa nem decisão: `authenticated` só tem SELECT nessas tabelas
 * (migration 126), e isso é deliberado. Se houvesse um caminho de escrita
 * direto, as validações de elegibilidade, SoD, alçada, ordem e impressão
 * digital passariam a ser opcionais — bastaria não usar a RPC.
 *
 * ─── O ator ────────────────────────────────────────────────────────────────
 *
 * Nenhuma função abaixo envia "quem decidiu". A RPC lê `auth.uid()` por conta
 * própria. Se um dia alguém acrescentar esse parâmetro aqui, ele não existirá
 * do outro lado — e é assim que se quer.
 */

import { createClient } from '@/utils/supabase/client';
import type {
  ApprovalRequestView, LegacyApprovalRow, ViewerEligibility,
  Decision, ApprovalEngineMode,
} from './types';

/** Erro do motor com o CÓDIGO preservado, para a tela poder explicar o bloqueio. */
export class ApprovalError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ApprovalError';
  }
}

/*
  O banco levanta `CODE: mensagem`. Preservar o código é o que permite à tela
  dizer "você não pode decidir o que você mesmo pediu" em vez de despejar o
  texto cru do Postgres — e é o que a §42 pede quando fala em mostrar o
  BLOQUEIO, não só a impossibilidade.
*/
const KNOWN_CODES = new Set([
  'SOD_REQUESTER', 'SOD_SUBJECT_CREATOR', 'SOD_INCOMPATIBLE_STEP',
  'NOT_ACTIVE_MEMBER', 'NOT_NAMED_APPROVER', 'MISSING_ROLE', 'MISSING_PERMISSION',
  'PERMISSION_DENIED_OVERRIDE', 'AUTHORITY_AMOUNT_UNKNOWN',
  'AUTHORITY_CURRENCY_MISMATCH', 'AUTHORITY_LIMIT_EXCEEDED',
  'DELEGATION_NOT_ALLOWED', 'DELEGATION_INVALID', 'DELEGATION_REVOKED',
  'DELEGATION_EXPIRED', 'DELEGATION_OUT_OF_SCOPE', 'DELEGATION_CURRENCY_MISMATCH',
  'SUBJECT_CHANGED', 'NO_ELIGIBLE_APPROVER', 'NOT_CUT_OVER',
]);

function toApprovalError(message: string): ApprovalError {
  // `[\s\S]` em vez da flag `s`: o alvo de compilação do projeto é anterior a
  // es2018, e a flag não existe lá. A mensagem pode ter várias linhas.
  const m = /^([A-Z_]+):\s*([\s\S]*)$/.exec(message.replace(/^ERROR:\s*/, ''));
  if (m && KNOWN_CODES.has(m[1])) return new ApprovalError(m[1], m[2].trim());
  return new ApprovalError('UNKNOWN', message);
}

export const ELIGIBILITY_MESSAGE: Record<string, string> = {
  SOD_REQUESTER: 'Você solicitou esta aprovação e por isso não pode decidi-la.',
  SOD_SUBJECT_CREATOR: 'Você cadastrou o objeto e esta etapa não admite o autor.',
  SOD_INCOMPATIBLE_STEP: 'Você já decidiu outra etapa incompatível neste mesmo pedido.',
  NOT_ACTIVE_MEMBER: 'Sua conta não está ativa nesta organização.',
  NOT_NAMED_APPROVER: 'Esta etapa tem aprovador nomeado, e não é você.',
  MISSING_ROLE: 'Você não tem o papel que esta etapa exige.',
  MISSING_PERMISSION: 'Você não tem a permissão que esta etapa exige.',
  PERMISSION_DENIED_OVERRIDE: 'A permissão desta etapa está negada para você.',
  AUTHORITY_AMOUNT_UNKNOWN: 'O valor do objeto é desconhecido e esta etapa exige alçada.',
  AUTHORITY_CURRENCY_MISMATCH: 'A alçada está em outra moeda. Não há conversão automática.',
  AUTHORITY_LIMIT_EXCEEDED: 'O valor excede a alçada desta etapa.',
  DELEGATION_NOT_ALLOWED: 'Esta etapa não admite delegação.',
  DELEGATION_INVALID: 'Delegação inválida.',
  DELEGATION_REVOKED: 'Esta delegação foi revogada.',
  DELEGATION_EXPIRED: 'Esta delegação está fora do prazo.',
  DELEGATION_OUT_OF_SCOPE: 'Esta delegação não cobre este tipo de decisão.',
  DELEGATION_CURRENCY_MISMATCH: 'A delegação está em outra moeda. Não há conversão automática.',
  SUBJECT_CHANGED: 'O objeto mudou depois que o pedido foi aberto. Abra um pedido novo.',
  NO_ELIGIBLE_APPROVER: 'Nenhuma pessoa elegível para uma das etapas exigidas.',
  NOT_CUT_OVER: 'Esta ação ainda é governada pelo fluxo anterior de aprovação.',
};

// ------------------------------------------------------------
// Leitura
// ------------------------------------------------------------

/** Pedidos do motor compartilhado para um sujeito. */
export async function listApprovalRequestsForSubject(
  subjectType: string, subjectId: string,
): Promise<ApprovalRequestView[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('approval_request_read_model')
    .select('*')
    .eq('subject_type', subjectType)
    .eq('subject_id', subjectId)
    .order('requested_at', { ascending: false });
  if (error) throw new Error(`Erro ao carregar aprovações: ${error.message}`);
  return (data ?? []) as ApprovalRequestView[];
}

/** Pedidos ABERTOS da organização — a fila de "o que precisa de decisão". */
export async function listOpenApprovalRequests(): Promise<ApprovalRequestView[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('approval_request_read_model')
    .select('*')
    .eq('status', 'PENDING')
    .order('requested_at', { ascending: true });
  if (error) throw new Error(`Erro ao carregar aprovações: ${error.message}`);
  return (data ?? []) as ApprovalRequestView[];
}

/**
 * História LEGADA de aprovação de contrato.
 *
 * Devolvida separada, e não misturada com a do motor novo, de propósito: as
 * duas não têm os mesmos campos, e concatená-las obrigaria a inventar
 * política, versão e base de autoridade para as linhas antigas — que é
 * exatamente o que a §33 proíbe.
 */
export async function listLegacyContractApprovals(
  contractId?: string,
): Promise<LegacyApprovalRow[]> {
  const supabase = createClient();
  let q = supabase.from('contract_approvals_legacy_history').select('*');
  if (contractId) q = q.eq('contract_id', contractId);
  const { data, error } = await q.order('step_order', { nullsFirst: false });
  if (error) throw new Error(`Erro ao carregar histórico legado: ${error.message}`);
  return (data ?? []) as LegacyApprovalRow[];
}

/**
 * Qual motor governa a aprovação de contrato nesta organização.
 *
 * A ausência de linha em `approval_engine_cutover` é uma resposta, não uma
 * falha: significa LEGACY_ONLY. É essa distinção que impede a tela de exibir
 * "nenhuma aprovação pendente" para uma organização que simplesmente ainda não
 * migrou.
 */
export async function getContractApprovalEngineMode(): Promise<ApprovalEngineMode> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('approval_engine_cutover')
    .select('id')
    .eq('subject_type', 'contract')
    .eq('action_type', 'approve')
    .maybeSingle();
  if (error) throw new Error(`Erro ao consultar a fronteira de corte: ${error.message}`);
  return data ? 'SHARED_ENGINE' : 'LEGACY_ONLY';
}

/**
 * A elegibilidade do PRÓPRIO espectador para uma etapa.
 *
 * Chama a função sem parâmetro de ator — a única que o navegador alcança. A
 * versão com ator existe para a RPC avaliar o DELEGANTE, e expô-la à tela
 * seria um oráculo de permissão sobre colegas.
 *
 * O resultado é conveniência de interface, nunca autorização: o servidor
 * revalida tudo dentro de `approval_decide`. Um botão habilitado por engano
 * ainda encontra a recusa do banco.
 */
export async function getViewerEligibility(
  stepId: string, delegationId?: string | null,
): Promise<ViewerEligibility> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('approval_step_eligibility_for_viewer', {
    p_step_id: stepId,
    p_delegation_id: delegationId ?? null,
  });
  if (error) throw new Error(`Erro ao avaliar elegibilidade: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return row as ViewerEligibility;
}

// ------------------------------------------------------------
// Escrita — sempre por RPC
// ------------------------------------------------------------

export type DecideResult = {
  status: 'RECORDED' | 'IDEMPOTENT_REPLAY';
  decision_id: string;
  decision: Decision;
  request_id: string;
  request_status: string;
  current_stage_no: number | null;
  authority_source: string | null;
  delegated: boolean;
};

/**
 * Decide uma etapa.
 *
 * `idempotencyKey` é OBRIGATÓRIA e deve ser estável para a mesma intenção do
 * usuário — não um UUID novo a cada clique. É ela que faz a retentativa de uma
 * requisição perdida devolver a MESMA decisão em vez de gravar uma segunda.
 * Gerar a chave dentro desta função derrotaria o propósito: a segunda tentativa
 * geraria outra chave e deixaria de ser retentativa.
 */
export async function decideApprovalStep(input: {
  stepId: string;
  decision: Decision;
  idempotencyKey: string;
  reason?: string | null;
  delegationId?: string | null;
  /** Trava opcional: o que a TELA acreditava estar decidindo (§26). */
  expectedFingerprint?: string | null;
}): Promise<DecideResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('approval_decide', {
    p_request_step_id: input.stepId,
    p_decision: input.decision,
    p_idempotency_key: input.idempotencyKey,
    p_reason: input.reason ?? null,
    p_delegation_id: input.delegationId ?? null,
    p_expected_fingerprint: input.expectedFingerprint ?? null,
  });
  if (error) throw toApprovalError(error.message);
  return data as DecideResult;
}

export type CreateRequestResult =
  | { status: 'CREATED'; request_id: string; policy_key: string; policy_version_no: number;
      policy_version_id: string; subject_fingerprint: string; correlation_id: string; event_id: string }
  | { status: 'EXISTING'; request_id: string; request_status: string; policy_version_id: string }
  | { status: 'NO_POLICY'; subject_type: string; action_type: string; decision_purpose: string }
  | { status: 'SUBJECT_TYPE_UNSUPPORTED'; subject_type: string }
  | { status: 'SUBJECT_NOT_FOUND' };

/**
 * Abre um pedido de aprovação.
 *
 * `NO_POLICY` volta como RESULTADO, não como erro, e a diferença importa: a
 * ausência de política é uma resposta verdadeira sobre governança — "esta ação
 * não está governada aqui" — e cabe ao domínio decidir o que fazer com ela.
 * Transformá-la em exceção convidaria a tratá-la como falha técnica e, no
 * limite, a seguir em frente como se estivesse aprovado.
 */
export async function createApprovalRequest(input: {
  organizationId: string;
  subjectType: string;
  subjectId: string;
  actionType: string;
  decisionPurpose: string;
  reason?: string | null;
  context?: Record<string, unknown>;
  idempotencyKey?: string | null;
  supersedesRequestId?: string | null;
}): Promise<CreateRequestResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('approval_request_create', {
    p_organization_id: input.organizationId,
    p_subject_type: input.subjectType,
    p_subject_id: input.subjectId,
    p_action_type: input.actionType,
    p_decision_purpose: input.decisionPurpose,
    p_reason: input.reason ?? null,
    p_context: input.context ?? {},
    p_idempotency_key: input.idempotencyKey ?? null,
    p_supersedes_request_id: input.supersedesRequestId ?? null,
  });
  if (error) throw toApprovalError(error.message);
  return data as CreateRequestResult;
}

/** Cancela um pedido em aberto. Exige motivo; não apaga nada. */
export async function cancelApprovalRequest(
  requestId: string, reason: string,
): Promise<{ status: 'CANCELLED'; request_id: string }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('approval_request_cancel', {
    p_request_id: requestId,
    p_reason: reason,
  });
  if (error) throw toApprovalError(error.message);
  return data as { status: 'CANCELLED'; request_id: string };
}
