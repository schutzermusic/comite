import type {
  DivergenceScope, DivergenceSeverity, DivergenceState, ServiceOrderOrigin, ServiceOrderStatus,
} from '@/lib/commercial/types';

export type ServiceOrderItemKind =
  | 'SCOPE' | 'ACTIVITY' | 'DELIVERABLE' | 'TECHNICAL_REQUIREMENT' | 'MATERIAL'
  | 'EQUIPMENT' | 'WORKFORCE' | 'RESOURCE' | 'CUSTOMER_DEPENDENCY' | 'ASSUMPTION'
  | 'EXCLUSION' | 'TEST' | 'MEASUREMENT_CONDITION' | 'COMMERCIAL_REFERENCE'
  | 'DOCUMENT' | 'MILESTONE' | 'RISK';

export type ServiceOrderItemOrigin = 'proposal_package' | 'document_extraction' | 'manual';
export type ItemConfirmation = 'UNCONFIRMED' | 'CONFIRMED' | 'REJECTED';

export interface ServiceOrderItem {
  id: string;
  kind: ServiceOrderItemKind;
  position: number;
  title: string;
  detail: string | null;
  quantity: string | null;
  unit: string | null;
  planned_date: string | null;
  origin: ServiceOrderItemOrigin;
  source_document_kind: 'TECHNICAL_PROPOSAL' | 'COMMERCIAL_PROPOSAL' | 'INTERNAL_SERVICE_ORDER' | null;
  source_revision_id: string | null;
  source_fact_id: string | null;
  source_document_id: string | null;
  source_page: number | null;
  source_quote: string | null;
  ai_provider: string | null;
  ai_model: string | null;
  confidence: string | null;
  confirmation_state: ItemConfirmation;
  confirmed_by: string | null;
  confirmed_at: string | null;
}

export interface ServiceOrderDivergence {
  id: string;
  scope: DivergenceScope;
  field_path: string | null;
  left_source_kind: string;
  left_value: string | null;
  right_source_kind: string;
  right_value: string | null;
  severity: DivergenceSeverity;
  summary: string;
  detected_by: 'ai' | 'rule' | 'human';
  ai_model: string | null;
  confidence: string | null;
  state: DivergenceState;
  resolved_source_kind: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
  created_at: string;
  service_order_id: string | null;
}

/** Contagens que decidem a próxima ação — derivadas, nunca gravadas. */
export interface ServiceOrderCounts {
  items: number;
  unreviewedItems: number;
  openDivergences: number;
  blockingOpen: number;
}

export interface PackageRevisionRef {
  revisionId: string;
  proposalId: string;
  proposalNumber: string;
  revision: number;
  status: string;
  kind: 'TECHNICAL' | 'COMMERCIAL' | 'COMBINED';
}

export interface ServiceOrderPackage {
  acceptanceId: string | null;
  acceptedAt: string | null;
  acceptanceSource: string | null;
  acceptanceExternalRef: string | null;
  technical: PackageRevisionRef | null;
  commercial: PackageRevisionRef | null;
  combined: PackageRevisionRef | null;
}

export interface ServiceOrderListRow {
  id: string;
  engagementId: string;
  osNumber: string;
  title: string;
  origin: ServiceOrderOrigin;
  status: ServiceOrderStatus;
  authorizedValue: string | null;
  currency: string | null;
  plannedStart: string | null;
  plannedFinish: string | null;
  customer: string | null;
  engagementTitle: string | null;
  packageLabel: string | null;
  projectId: string | null;
  projectName: string | null;
  ownerName: string | null;
  issuedAt: string | null;
  createdAt: string;
  counts: ServiceOrderCounts;
}

export interface EligiblePackage {
  acceptanceId: string;
  contextId: string;
  acceptedAt: string;
  customer: string | null;
  title: string | null;
  technical: PackageRevisionRef | null;
  commercial: PackageRevisionRef | null;
  combined: PackageRevisionRef | null;
  totalValue: string | null;
  currency: string | null;
  engagementId: string | null;
  engagementTitle: string | null;
  engagementStatus: string | null;
  serviceOrderId: string | null;
  serviceOrderNumber: string | null;
  /** Por que ainda não dá para gerar — nunca um botão que falha no clique. */
  blocker: 'NO_ENGAGEMENT' | 'STALE' | null;
}
