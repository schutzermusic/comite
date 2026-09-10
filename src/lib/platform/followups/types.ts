/**
 * Acompanhamento governado do Apex — vocabulário e tipos.
 *
 * Transversal por desenho. Um acompanhamento é sobre uma obrigação, um risco,
 * uma condição de faturamento — e amanhã sobre objetos de outros módulos.
 * Colocá-lo dentro de Contratos criaria a terceira lista de tarefas do produto
 * e obrigaria o próximo módulo a duplicá-la.
 *
 * Espelha `apex_followups` (migration 156).
 */

export type FollowupState =
  | 'ACTIVE'
  | 'WAITING_EXTERNAL_PARTY'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'ESCALATED'
  | 'CANCELLED';

export type FollowupSourceKind =
  | 'contract'
  | 'contract_clause'
  | 'contract_obligation_instance'
  | 'contract_billing_condition'
  | 'contract_risk'
  | 'contract_guarantee'
  | 'contract_insurance_requirement';

export type VerificationMode = 'deterministic_evidence' | 'human_confirmation';

export type ClosureBasis =
  | 'verified_evidence'
  | 'human_confirmation'
  | 'no_longer_applicable'
  | 'superseded';

export type FollowupEventType =
  | 'created' | 'assigned' | 'nudged' | 'state_changed'
  | 'evidence_received' | 'verified' | 'escalated'
  | 'closed' | 'cancelled' | 'note';

/**
 * Rótulos operacionais. Nenhum deles descreve trabalho manual do usuário: o
 * Apex é quem acompanha, e a tela conta o que ELE está fazendo.
 */
export const FOLLOWUP_STATE_LABEL: Record<FollowupState, string> = {
  ACTIVE: 'Acompanhamento ativo',
  WAITING_EXTERNAL_PARTY: 'Aguardando a contraparte',
  BLOCKED: 'Bloqueado',
  COMPLETED: 'Concluído e verificado',
  ESCALATED: 'Escalado',
  CANCELLED: 'Cancelado',
};

export const FOLLOWUP_STATE_TONE: Record<FollowupState, 'active' | 'waiting' | 'critical' | 'success' | 'neutral'> = {
  ACTIVE: 'active',
  WAITING_EXTERNAL_PARTY: 'waiting',
  BLOCKED: 'critical',
  COMPLETED: 'success',
  ESCALATED: 'critical',
  CANCELLED: 'neutral',
};

export const CLOSURE_BASIS_LABEL: Record<ClosureBasis, string> = {
  verified_evidence: 'Evidência verificada pelo Apex',
  human_confirmation: 'Confirmado por uma pessoa',
  no_longer_applicable: 'Deixou de ser aplicável',
  superseded: 'Substituído',
};

export interface ApexFollowupRow {
  id: string;
  organization_id: string;
  idempotency_key?: string | null;
  source_kind: FollowupSourceKind;
  source_id: string;
  contract_id: string | null;
  goal: string;
  expected_evidence: string | null;
  responsible_user_id: string | null;
  responsible_party_id: string | null;
  responsible_text: string | null;
  assigned_by: string | null;
  assigned_at: string | null;
  due_date: string | null;
  next_expected_event: string | null;
  next_expected_event_at: string | null;
  cadence_days: number | null;
  last_nudge_at: string | null;
  nudge_count: number;
  escalate_after_days: number | null;
  escalation_target_user_id: string | null;
  escalated_at: string | null;
  verification_mode: VerificationMode;
  verification_rule: Record<string, unknown> | null;
  verified_at: string | null;
  verified_by: string | null;
  verification_evidence_id: string | null;
  state: FollowupState;
  state_note: string | null;
  closure_basis: ClosureBasis | null;
  closed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApexFollowupEventRow {
  id: string;
  organization_id: string;
  followup_id: string;
  event_type: FollowupEventType;
  previous_state: FollowupState | null;
  next_state: FollowupState | null;
  actor_kind: 'human' | 'apex';
  actor_user_id: string | null;
  note: string | null;
  payload: Record<string, unknown>;
  occurred_at: string;
}

export const OPEN_FOLLOWUP_STATES: readonly FollowupState[] = [
  'ACTIVE', 'WAITING_EXTERNAL_PARTY', 'BLOCKED', 'ESCALATED',
];

export function isOpenFollowup(state: FollowupState): boolean {
  return OPEN_FOLLOWUP_STATES.includes(state);
}
