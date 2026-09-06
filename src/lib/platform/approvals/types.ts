/**
 * Motor de Aprovação da Plataforma — vocabulário do lado do cliente.
 *
 * Este arquivo é ESPELHO do banco, não uma segunda definição dele. Cada união
 * abaixo corresponde a um CHECK das migrations 125–128; mudar um lado sem o
 * outro quebra a compilação, que é exatamente o que se quer.
 *
 * O que NÃO mora aqui: regra de decisão. Nenhuma função deste módulo decide se
 * alguém pode aprovar — quem responde isso é `approval_step_eligibility`, no
 * banco, e é a MESMA função que a RPC de decisão consulta. Uma segunda
 * implementação da elegibilidade no navegador divergiria da primeira, e a
 * divergência apareceria como botão habilitado que devolve erro.
 */

/** §3 — propósitos NÃO são intercambiáveis. Revisão não é aprovação. */
export type DecisionPurpose =
  | 'APPROVAL' | 'AUTHORIZATION' | 'RELEASE'
  | 'ACCEPTANCE' | 'VALIDATION' | 'REVIEW' | 'ACKNOWLEDGEMENT';

export const DECISION_PURPOSE_LABEL: Record<DecisionPurpose, string> = {
  APPROVAL: 'Aprovação',
  AUTHORIZATION: 'Autorização',
  RELEASE: 'Liberação',
  ACCEPTANCE: 'Aceite',
  VALIDATION: 'Validação',
  REVIEW: 'Revisão',
  ACKNOWLEDGEMENT: 'Ciência',
};

export type RequestStatus =
  | 'PENDING' | 'APPROVED' | 'REJECTED' | 'RETURNED_FOR_CORRECTION'
  | 'CANCELLED' | 'EXPIRED' | 'SUPERSEDED';

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  PENDING: 'Em análise',
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
  // Devolver NÃO é rejeitar, e o rótulo tem de dizer isso sozinho.
  RETURNED_FOR_CORRECTION: 'Devolvido para correção',
  CANCELLED: 'Cancelado',
  // Expirado NÃO é rejeitado: é a ausência de parecer dentro do prazo.
  EXPIRED: 'Prazo esgotado',
  SUPERSEDED: 'Substituído',
};

export type StepStatus =
  | 'WAITING' | 'OPEN' | 'APPROVED' | 'REJECTED'
  | 'RETURNED' | 'SKIPPED' | 'CANCELLED' | 'EXPIRED';

export const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  WAITING: 'Aguardando estágio anterior',
  OPEN: 'Em aberto',
  APPROVED: 'Aprovada',
  REJECTED: 'Rejeitada',
  RETURNED: 'Devolvida',
  // Dispensada porque o QUÓRUM do estágio já foi atingido — nunca porque
  // faltou aprovador, que é caso de erro e não de progressão (§15).
  SKIPPED: 'Dispensada pelo quórum',
  CANCELLED: 'Cancelada',
  EXPIRED: 'Prazo esgotado',
};

export type Decision = 'APPROVED' | 'REJECTED' | 'RETURNED_FOR_CORRECTION';
export type EligibilityMode = 'PERMISSION' | 'ROLE' | 'NAMED';
export type AuthoritySource = 'PERMISSION' | 'ROLE' | 'NAMED' | 'DELEGATED';
export type ReasonRequirement = 'OPTIONAL' | 'REQUIRED_ON_NEGATIVE' | 'REQUIRED_ALWAYS';

export type ApprovalStage = {
  readonly stage_no: number;
  readonly name: string;
  readonly status: string;
  readonly quorum_required: number;
  readonly approved_count: number;
  readonly opened_at: string | null;
  readonly closed_at: string | null;
};

export type ApprovalStep = {
  readonly step_id: string;
  readonly step_key: string;
  readonly name: string;
  readonly stage_no: number;
  readonly status: StepStatus;
  readonly decision_purpose: DecisionPurpose;
  readonly eligibility_mode: EligibilityMode;
  readonly permission_key: string | null;
  readonly role_key: string | null;
  readonly named_user_id: string | null;
  readonly authority_required: boolean;
  readonly authority_max_amount: string | null;
  readonly authority_currency: string | null;
  readonly sod_group: string | null;
  readonly delegation_allowed: boolean;
  readonly reason_requirement: ReasonRequirement;
  readonly opened_at: string | null;
  readonly expires_at: string | null;
  readonly decided_at: string | null;
  readonly decided_by: string | null;
};

export type ApprovalDecisionRecord = {
  readonly decision_id: string;
  readonly step_key: string;
  readonly stage_no: number;
  readonly decision: Decision;
  readonly decision_purpose: DecisionPurpose;
  readonly reason: string | null;
  readonly actor_user_id: string;
  /** Quem DELEGOU, quando a decisão foi tomada por delegação. */
  readonly on_behalf_of_user_id: string | null;
  readonly delegation_id: string | null;
  readonly authority_source: AuthoritySource;
  readonly authority_basis: string | null;
  readonly authority_limit_amount: string | null;
  readonly authority_currency: string | null;
  readonly decided_at: string;
};

/** Uma linha de `approval_request_read_model`. */
export type ApprovalRequestView = {
  readonly request_id: string;
  readonly organization_id: string;
  readonly policy_key: string;
  readonly policy_version_no: number;
  readonly policy_version_id: string;
  readonly subject_type: string;
  readonly subject_id: string;
  readonly subject_label: string | null;
  readonly subject_amount: string | null;
  readonly subject_currency: string | null;
  readonly subject_fingerprint: string;
  readonly action_type: string;
  readonly decision_purpose: DecisionPurpose;
  readonly requested_by: string | null;
  readonly requested_at: string;
  readonly request_reason: string | null;
  readonly status: RequestStatus;
  readonly current_stage_no: number | null;
  readonly expires_at: string | null;
  readonly finalized_at: string | null;
  readonly outcome_reason: string | null;
  readonly supersedes_request_id: string | null;
  readonly correlation_id: string;
  readonly source_event_id: string | null;
  readonly provenance: 'SHARED_ENGINE';
  readonly open_hours: number | null;
  readonly stages: readonly ApprovalStage[] | null;
  readonly steps: readonly ApprovalStep[] | null;
  readonly decisions: readonly ApprovalDecisionRecord[] | null;
};

/**
 * Uma linha de `contract_approvals_legacy_history`.
 *
 * Os campos do motor novo vêm `null` porque NUNCA foram registrados — não
 * porque a consulta os perdeu. Preenchê-los com valor sintético mostraria
 * governança que ninguém exerceu.
 */
export type LegacyApprovalRow = {
  readonly legacy_id: string;
  readonly organization_id: string;
  readonly contract_id: string;
  readonly step_key: string;
  readonly step_order: number | null;
  readonly legacy_status: 'pending' | 'under_review' | 'approved' | 'rejected';
  readonly reviewer_user_id: string | null;
  readonly comments: string | null;
  readonly rejection_reason: string | null;
  readonly requested_changes_note: string | null;
  readonly deadline_date: string | null;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly approval_timestamp: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly provenance: 'LEGACY_CONTRACT_APPROVALS';
  readonly policy_version_id: null;
  readonly policy_key: null;
  readonly policy_version_no: null;
  readonly requested_by: null;
  readonly authority_source: null;
  readonly authority_basis: null;
  readonly subject_fingerprint: null;
  readonly delegation_id: null;
};

/** O que a tela pode fazer com uma etapa, e por que não pode quando não pode. */
export type ViewerEligibility = {
  readonly eligible: boolean;
  readonly code: string;
  readonly detail: string | null;
  readonly authority_source: AuthoritySource | null;
  readonly authority_basis: string | null;
  readonly authority_limit: string | null;
  readonly authority_currency: string | null;
  readonly on_behalf_of: string | null;
};

/**
 * Qual motor governa a aprovação de contrato NESTA organização.
 *
 * Três estados, e o terceiro é o que impede a tela de mentir: enquanto o corte
 * não aconteceu, o motor compartilhado não tem pedido nenhum — e "nenhum
 * pedido" precisa aparecer como NÃO MIGRADO, jamais como "nada pendente".
 */
export type ApprovalEngineMode = 'SHARED_ENGINE' | 'LEGACY_ONLY';
