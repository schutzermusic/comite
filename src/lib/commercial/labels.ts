/**
 * Rótulos de TELA — provisórios por desenho.
 *
 * O escopo diz que o nome de UI do pai neutro "deve ser fácil de renomear
 * depois". Trocar `ENGAGEMENT_LABEL` aqui muda a aplicação inteira; o nome de
 * banco (`commercial_engagement`) não se mexe, e nenhuma migration é
 * necessária para uma decisão de vocabulário.
 */
import type {
  AuthorizationSourceKind, DivergenceScope, DivergenceSeverity,
  DocumentContext, EngagementStatus, OpportunityStage,
  ProposalRevisionStatus, ServiceOrderStatus,
} from './types';

export const ENGAGEMENT_LABEL = 'Trabalho autorizado';
export const ENGAGEMENT_LABEL_PLURAL = 'Trabalhos autorizados';

export const engagementStatusLabels: Record<EngagementStatus, string> = {
  UNDER_ANALYSIS: 'Em análise',
  AUTHORIZED: 'Autorizado',
  SUSPENDED: 'Suspenso',
  CLOSED: 'Encerrado',
  CANCELLED: 'Cancelado',
};

export const authorizationSourceLabels: Record<AuthorizationSourceKind, string> = {
  formal_contract: 'Contrato formal',
  accepted_proposal: 'Proposta aceita',
  customer_po: 'Pedido de compra do cliente',
  customer_authorization: 'Autorização do cliente',
};

export const proposalStatusLabels: Record<ProposalRevisionStatus, string> = {
  DRAFT: 'Rascunho',
  INTERNAL_REVIEW: 'Em revisão interna',
  INTERNALLY_APPROVED: 'Aprovada internamente',
  SENT: 'Enviada ao cliente',
  NEGOTIATION: 'Em negociação',
  ACCEPTED: 'Aceita pelo cliente',
  REJECTED: 'Recusada',
  EXPIRED: 'Expirada',
  WITHDRAWN: 'Retirada',
  SUPERSEDED: 'Substituída',
};

export const opportunityStageLabels: Record<OpportunityStage, string> = {
  QUALIFICATION: 'Qualificação',
  DISCOVERY: 'Descoberta',
  PROPOSAL: 'Proposta',
  NEGOTIATION: 'Negociação',
  WON: 'Ganha',
  LOST: 'Perdida',
  ABANDONED: 'Abandonada',
};

export const serviceOrderStatusLabels: Record<ServiceOrderStatus, string> = {
  DRAFT: 'Rascunho',
  PENDING_CONFIRMATION: 'Aguardando confirmação',
  ISSUED: 'Emitida',
  IN_EXECUTION: 'Em execução',
  SUSPENDED: 'Suspensa',
  CLOSED: 'Encerrada',
  CANCELLED: 'Cancelada',
};

export const documentContextLabels: Record<DocumentContext, string> = {
  FORMAL_CONTRACT: 'Contrato formal',
  TECHNICAL_PROPOSAL: 'Proposta técnica',
  COMMERCIAL_PROPOSAL: 'Proposta comercial',
  CUSTOMER_PO: 'Pedido de compra do cliente',
  CUSTOMER_AUTHORIZATION: 'Autorização do cliente',
  INTERNAL_SERVICE_ORDER: 'Ordem de Serviço interna',
  AMENDMENT: 'Aditivo',
};

export const divergenceScopeLabels: Record<DivergenceScope, string> = {
  VALUE: 'Valor',
  SCOPE: 'Escopo',
  DATES: 'Datas',
  MEASUREMENT_RULE: 'Regra de medição',
  BILLING_CONDITION: 'Condição de faturamento',
  PAYMENT_TERMS: 'Condição de pagamento',
  DELIVERABLE: 'Entregável',
  EVIDENCE_REQUIREMENT: 'Exigência de evidência',
  OTHER: 'Outro',
};

export const divergenceSeverityLabels: Record<DivergenceSeverity, string> = {
  INFO: 'Informativa',
  WARNING: 'Atenção',
  BLOCKING: 'Bloqueante',
};
