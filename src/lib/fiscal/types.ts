export type FiscalEnvironment = 'homologation' | 'production';

export type FiscalDocumentStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'queued'
  | 'processing'
  | 'authorized'
  | 'rejected'
  | 'error'
  | 'cancellation_requested'
  | 'cancelled'
  | 'replaced'
  | 'archived';

export type FiscalTaxCode = 'ISS' | 'PIS' | 'COFINS' | 'INSS' | 'IRRF' | 'CSLL' | 'IBS' | 'CBS' | 'OTHER';
export type FiscalTaxResponsibility = 'issuer' | 'recipient' | 'informational';

export interface FiscalEstablishment {
  id: string;
  organization_id: string;
  legal_name: string;
  trade_name: string | null;
  cnpj: string;
  municipal_registration: string;
  state_registration: string | null;
  tax_regime: 'mei' | 'simples_nacional' | 'lucro_presumido' | 'lucro_real' | 'other';
  special_tax_regime: string | null;
  municipality_ibge: string;
  municipality_name: string;
  uf: string;
  postal_code: string;
  street: string;
  street_number: string;
  complement: string | null;
  district: string;
  environment: FiscalEnvironment;
  nfse_series: string;
  next_dps_number: number;
  production_enabled: boolean;
  active: boolean;
}

/**
 * Tomador: a Party CANÔNICA da plataforma (D1). Identidade jurídica mora aqui,
 * uma vez só, e o Fiscal a lê — não a copia.
 */
export interface FiscalRecipientParty {
  id: string;
  organization_id: string;
  legal_name: string;
  trade_name: string | null;
  document_type: 'cnpj' | 'cpf' | 'foreign' | null;
  document_normalized: string | null;
  active: boolean;
}

/**
 * O que o layout da NFS-e exige do tomador e a Party canônica legitimamente
 * não guarda. Opcional: uma Party sem inscrição municipal continua podendo
 * ser tomadora.
 */
export interface FiscalPartyProfile {
  id: string;
  organization_id: string;
  party_id: string;
  municipal_registration: string | null;
  state_registration: string | null;
  email: string | null;
  phone: string | null;
  municipality_ibge: string | null;
  municipality_name: string | null;
  uf: string | null;
  country_code: string;
  postal_code: string | null;
  street: string | null;
  street_number: string | null;
  complement: string | null;
  district: string | null;
  active: boolean;
}

/** Tomador resolvido: identidade canônica + extensão fiscal, quando existe. */
export interface FiscalRecipient extends FiscalRecipientParty {
  profile: FiscalPartyProfile | null;
}

export interface FiscalServiceCatalogEntry {
  id: string;
  organization_id: string;
  establishment_id: string;
  code: string;
  description: string;
  lc116_code: string;
  nbs_code: string | null;
  municipal_service_code: string;
  cnae_code: string | null;
  iss_rate: number;
  pis_rate: number;
  cofins_rate: number;
  inss_rate: number;
  ir_rate: number;
  csll_rate: number;
  ibs_rate: number;
  cbs_rate: number;
  iss_withheld_default: boolean;
  tax_rules: Record<string, unknown>;
  effective_from: string;
  effective_to: string | null;
  version: number;
  active: boolean;
  approved_by_accountant: boolean;
}

export interface FiscalTaxLine {
  tax_code: FiscalTaxCode;
  tax_base_cents: number;
  rate: number;
  amount_cents: number;
  responsibility: FiscalTaxResponsibility;
  withheld: boolean;
  metadata?: Record<string, unknown>;
}

export interface FiscalDocument {
  id: string;
  organization_id: string;
  establishment_id: string;
  party_id: string;
  party_profile_id: string | null;
  project_id: string | null;
  contract_id: string | null;
  business_unit_id: string | null;
  cost_center_id: string | null;
  status: FiscalDocumentStatus;
  environment: FiscalEnvironment;
  dps_number: number | null;
  competence_date: string;
  issue_date: string | null;
  due_date: string | null;
  series: string;
  provider_key: string | null;
  provider_document_id: string | null;
  document_number: string | null;
  access_key: string | null;
  verification_code: string | null;
  service_amount_cents: number;
  deductions_cents: number;
  unconditional_discount_cents: number;
  conditional_discount_cents: number;
  withheld_total_cents: number;
  issuer_tax_total_cents: number;
  net_amount_cents: number;
  service_location_ibge: string;
  description: string;
  issuer_snapshot: Record<string, unknown>;
  recipient_snapshot: Record<string, unknown>;
  service_snapshot: Record<string, unknown>;
  tax_snapshot: Record<string, unknown>;
  rejection_code: string | null;
  rejection_message: string | null;
  authorized_at: string | null;
  cancelled_at: string | null;
  replaced_document_id?: string | null;
  replacement_document_id?: string | null;
  /**
   * Fase 7. Nada no Fiscal escreve no Financeiro hoje; o campo declara a
   * ausência de contabilização em vez de deixá-la implícita.
   */
  finance_status: 'not_posted' | 'pending_configuration' | 'posted' | 'reversed' | 'review_required' | 'error';
  xml_storage_path: string | null;
  xml_sha256: string | null;
  danfse_storage_path: string | null;
  danfse_sha256: string | null;
  cancellation_reason: string | null;
  idempotency_key: string;
  created_by?: string | null;
  submitted_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FiscalDashboardSummary {
  authorizedCount: number;
  pendingCount: number;
  rejectedCount: number;
  grossAmountCents: number;
  withheldAmountCents: number;
  issuerTaxAmountCents: number;
  integrationAlerts: number;
}

export interface FiscalDocumentListResponse {
  documents: FiscalDocument[];
  summary: FiscalDashboardSummary;
}

export interface CreateFiscalDocumentInput {
  establishmentId: string;
  partyId: string;
  serviceCatalogId: string;
  competenceDate: string;
  dueDate?: string;
  serviceLocationIbge: string;
  description: string;
  amountCents: number;
  quantity?: number;
  deductionsCents?: number;
  unconditionalDiscountCents?: number;
  conditionalDiscountCents?: number;
  issWithheld?: boolean;
  projectId?: string;
  contractId?: string;
  businessUnitId?: string;
  costCenterId?: string;
  additionalInformation?: string;
  idempotencyKey: string;
}

export interface FiscalEvent {
  id: string;
  organization_id: string;
  document_id: string;
  event_type: string;
  previous_status: FiscalDocumentStatus | null;
  next_status: FiscalDocumentStatus | null;
  message: string | null;
  payload_sanitized: Record<string, unknown>;
  actor_user_id: string | null;
  created_at: string;
}
