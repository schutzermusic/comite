/**
 * Vocabulário do Comercial e do trabalho autorizado.
 *
 * Os nomes de BANCO são estáveis (`commercial_engagement`); os nomes de TELA
 * moram em `labels.ts` e podem mudar sem migration. Esta separação é o que o
 * escopo pede quando diz que o rótulo de UI é provisório.
 */

export type EngagementStatus =
  | 'UNDER_ANALYSIS' | 'AUTHORIZED' | 'SUSPENDED' | 'CLOSED' | 'CANCELLED';

export type EngagementOrigin =
  | 'formal_contract' | 'accepted_proposal' | 'customer_po'
  | 'customer_authorization' | 'manual' | 'migration_backfill';

/** As quatro coisas que podem AUTORIZAR trabalho. Contrato é uma delas. */
export type AuthorizationSourceKind =
  | 'formal_contract' | 'accepted_proposal' | 'customer_po' | 'customer_authorization';

export type AuthorizationState = 'ACTIVE' | 'SUPERSEDED' | 'REVOKED';

export interface CommercialEngagement {
  id: string;
  organizationId: string;
  engagementNumber: string | null;
  title: string;
  counterpartyName: string;
  counterpartyPartyId: string | null;
  currency: string;
  /** Nulo enquanto EM ANÁLISE. Nulo NÃO é zero — KPI que somar zero mente. */
  authorizedValue: number | null;
  status: EngagementStatus;
  origin: EngagementOrigin;
  authorizedAt: string | null;
  ownerUserId: string | null;
  createdAt: string;
}

export interface EngagementAuthorization {
  id: string;
  engagementId: string;
  sourceKind: AuthorizationSourceKind;
  contractId: string | null;
  proposalRevisionId: string | null;
  documentId: string | null;
  externalReference: string | null;
  authorizedValue: number | null;
  currency: string | null;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  governing: boolean;
  state: AuthorizationState;
}

export type ProposalKind = 'TECHNICAL' | 'COMMERCIAL' | 'COMBINED';

export type ProposalRevisionStatus =
  | 'DRAFT' | 'INTERNAL_REVIEW' | 'INTERNALLY_APPROVED' | 'SENT' | 'NEGOTIATION'
  | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'WITHDRAWN' | 'SUPERSEDED';

/** Só ela alimenta execução. Ver o gatilho `cea_proposal_must_be_accepted`. */
export const GOVERNING_PROPOSAL_STATUS: ProposalRevisionStatus = 'ACCEPTED';

export type AcceptanceSource =
  | 'signed_document' | 'customer_email' | 'customer_portal'
  | 'purchase_order' | 'meeting_minutes' | 'integration';

export type OpportunityStage =
  | 'QUALIFICATION' | 'DISCOVERY' | 'PROPOSAL' | 'NEGOTIATION'
  | 'WON' | 'LOST' | 'ABANDONED';

export const OPEN_OPPORTUNITY_STAGES: OpportunityStage[] =
  ['QUALIFICATION', 'DISCOVERY', 'PROPOSAL', 'NEGOTIATION'];

export type ServiceOrderStatus =
  | 'DRAFT' | 'PENDING_CONFIRMATION' | 'ISSUED' | 'IN_EXECUTION'
  | 'SUSPENDED' | 'CLOSED' | 'CANCELLED';

export type ServiceOrderOrigin =
  | 'from_accepted_proposal' | 'manual' | 'uploaded_document';

export interface InternalServiceOrder {
  id: string;
  engagementId: string;
  osNumber: string;
  title: string;
  origin: ServiceOrderOrigin;
  status: ServiceOrderStatus;
  authorizedValue: number | null;
  currency: string | null;
  scopeSummary: string | null;
  plannedStart: string | null;
  plannedFinish: string | null;
  projectId: string | null;
  sourceProposalRevisionId: string | null;
  documentId: string | null;
}

export type DivergenceScope =
  | 'VALUE' | 'SCOPE' | 'DATES' | 'MEASUREMENT_RULE' | 'BILLING_CONDITION'
  | 'PAYMENT_TERMS' | 'DELIVERABLE' | 'EVIDENCE_REQUIREMENT' | 'OTHER';

export type DivergenceSeverity = 'INFO' | 'WARNING' | 'BLOCKING';
export type DivergenceState = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED';

export interface CommercialDivergence {
  id: string;
  engagementId: string;
  serviceOrderId: string | null;
  scope: DivergenceScope;
  fieldPath: string | null;
  leftSourceKind: string;
  leftValue: string | null;
  rightSourceKind: string;
  rightValue: string | null;
  severity: DivergenceSeverity;
  summary: string;
  detectedBy: 'ai' | 'rule' | 'human';
  state: DivergenceState;
  resolvedSourceKind: string | null;
}

/** Os papéis de documento que a inteligência documental compartilhada lê. */
export const DOCUMENT_CONTEXTS = [
  'FORMAL_CONTRACT',
  'TECHNICAL_PROPOSAL',
  'COMMERCIAL_PROPOSAL',
  'CUSTOMER_PO',
  'CUSTOMER_AUTHORIZATION',
  'INTERNAL_SERVICE_ORDER',
  'AMENDMENT',
] as const;
export type DocumentContext = (typeof DOCUMENT_CONTEXTS)[number];

export type FactDomain =
  | 'SCOPE' | 'DELIVERABLE' | 'REQUIREMENT' | 'EXCLUSION' | 'DEPENDENCY' | 'TEST'
  | 'DOCUMENT' | 'DATE' | 'MILESTONE' | 'RESOURCE'
  | 'VALUE' | 'RATE' | 'UNIT_PRICE' | 'PAYMENT_TERM' | 'MEASUREMENT_RULE'
  | 'BILLING_MILESTONE' | 'BILLING_PREREQUISITE' | 'VALIDITY'
  | 'ACCEPTANCE_CONDITION' | 'RISK' | 'OTHER';

export interface ExtractedFact {
  id: string;
  engagementId: string | null;
  documentId: string | null;
  documentContext: DocumentContext;
  factDomain: FactDomain;
  label: string;
  valueText: string | null;
  valueNumeric: number | null;
  valueDate: string | null;
  currency: string | null;
  sourceRevision: string | null;
  sourcePage: number | null;
  sourceSection: string | null;
  sourceQuote: string | null;
  confidence: number | null;
  /** ANCHORED exige página E trecho literal. Sem isso, o fato não vira regra. */
  provenanceState: 'ANCHORED' | 'UNANCHORED';
  confirmationState: 'UNCONFIRMED' | 'CONFIRMED' | 'CORRECTED' | 'REJECTED';
}

/** Espelha `public.commercial_fact_promotable`. Mantenha as duas iguais. */
export function isFactPromotable(fact: Pick<ExtractedFact, 'provenanceState' | 'confirmationState'>): boolean {
  return fact.provenanceState === 'ANCHORED'
    && (fact.confirmationState === 'CONFIRMED' || fact.confirmationState === 'CORRECTED');
}
