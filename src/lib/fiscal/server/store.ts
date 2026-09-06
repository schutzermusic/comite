import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js';
import { calculateTaxPreview } from '../tax-preview';
import { assertFiscalTransition } from '../state-machine';
import type {
  CreateFiscalDocumentInput,
  FiscalDashboardSummary,
  FiscalDocument,
  FiscalDocumentListResponse,
  FiscalDocumentStatus,
  FiscalEstablishment,
  FiscalEvent,
  FiscalPartyProfile,
  FiscalRecipient,
  FiscalRecipientParty,
  FiscalServiceCatalogEntry,
  FiscalTaxLine,
} from '../types';
import type { FiscalActor } from './actor';

if (typeof window !== 'undefined') throw new Error('fiscal/server/store.ts não pode ser importado no navegador.');

export const FISCAL_DOCUMENT_BUCKET = 'fiscal-documents';

let serviceClient: SupabaseClient | null = null;

export class FiscalSchemaMissingError extends Error {
  constructor(table?: string) {
    super(
      `A fundação fiscal não está aplicada neste ambiente${table ? ` (${table})` : ''}. ` +
        'Aplique 112_fiscal_nfse_foundation.sql e 113_fiscal_perm_seeds.sql.',
    );
    this.name = 'FiscalSchemaMissingError';
  }
}

function missingSchema(error: { code?: string; message?: string }): boolean {
  return ['42P01', 'PGRST205'].includes(error.code ?? '') || /does not exist|could not find the table/i.test(error.message ?? '');
}

function checkError(error: { code?: string; message?: string } | null, context: string): void {
  if (!error) return;
  if (missingSchema(error)) throw new FiscalSchemaMissingError();
  throw new Error(`${context}: ${error.message ?? 'erro desconhecido'}`);
}

export function getFiscalServiceClient(): SupabaseClient {
  if (serviceClient) return serviceClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase fiscal não configurado no servidor.');
  serviceClient = createServiceClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return serviceClient;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function normalizeService(row: Record<string, unknown>): FiscalServiceCatalogEntry {
  return {
    ...(row as unknown as FiscalServiceCatalogEntry),
    iss_rate: asNumber(row.iss_rate),
    pis_rate: asNumber(row.pis_rate),
    cofins_rate: asNumber(row.cofins_rate),
    inss_rate: asNumber(row.inss_rate),
    ir_rate: asNumber(row.ir_rate),
    csll_rate: asNumber(row.csll_rate),
    ibs_rate: asNumber(row.ibs_rate),
    cbs_rate: asNumber(row.cbs_rate),
  };
}

export async function listFiscalDocuments(
  organizationId: string,
  options: { status?: string; limit?: number; from?: string; to?: string } = {},
): Promise<FiscalDocumentListResponse> {
  let query = getFiscalServiceClient()
    .from('fiscal_documents')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(options.limit ?? 100, 250));
  if (options.status) query = query.eq('status', options.status);
  if (options.from) query = query.gte('competence_date', options.from);
  if (options.to) query = query.lte('competence_date', options.to);
  const { data, error } = await query;
  checkError(error, 'Falha ao listar documentos fiscais');
  const documents = (data ?? []) as FiscalDocument[];

  const summary: FiscalDashboardSummary = documents.reduce((acc, document) => {
    if (document.status === 'authorized') {
      acc.authorizedCount += 1;
      acc.grossAmountCents += asNumber(document.service_amount_cents);
      acc.withheldAmountCents += asNumber(document.withheld_total_cents);
      acc.issuerTaxAmountCents += asNumber(document.issuer_tax_total_cents);
    } else if (['rejected', 'error'].includes(document.status)) acc.rejectedCount += 1;
    else if (!['cancelled', 'replaced', 'archived'].includes(document.status)) acc.pendingCount += 1;
    if (document.finance_status === 'error' || document.finance_status === 'review_required') acc.integrationAlerts += 1;
    return acc;
  }, {
    authorizedCount: 0,
    pendingCount: 0,
    rejectedCount: 0,
    grossAmountCents: 0,
    withheldAmountCents: 0,
    issuerTaxAmountCents: 0,
    integrationAlerts: 0,
  } as FiscalDashboardSummary);

  return { documents, summary };
}

export async function getFiscalDocument(
  organizationId: string,
  id: string,
): Promise<{ document: FiscalDocument; taxes: FiscalTaxLine[]; events: FiscalEvent[] } | null> {
  const client = getFiscalServiceClient();
  const { data: document, error } = await client
    .from('fiscal_documents')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('id', id)
    .maybeSingle();
  checkError(error, 'Falha ao ler documento fiscal');
  if (!document) return null;
  const [{ data: taxes, error: taxError }, { data: events, error: eventError }] = await Promise.all([
    client.from('fiscal_tax_lines').select('*').eq('organization_id', organizationId).eq('document_id', id).order('tax_code'),
    client.from('fiscal_events').select('*').eq('organization_id', organizationId).eq('document_id', id).order('created_at'),
  ]);
  checkError(taxError, 'Falha ao ler tributos fiscais');
  checkError(eventError, 'Falha ao ler eventos fiscais');
  return { document: document as FiscalDocument, taxes: (taxes ?? []) as FiscalTaxLine[], events: (events ?? []) as FiscalEvent[] };
}

/**
 * Resolve o tomador: Party canônica + extensão fiscal, se houver.
 *
 * Duas leituras de propósito. A identidade vem de `parties` — a única fonte —
 * e o perfil fiscal é opcional. Juntá-las num join só esconderia qual das duas
 * faltou quando faltar.
 */
export async function resolveFiscalRecipient(
  organizationId: string,
  partyId: string,
): Promise<FiscalRecipient> {
  const client = getFiscalServiceClient();
  const [partyResult, profileResult] = await Promise.all([
    client.from('parties')
      .select('id,organization_id,legal_name,trade_name,document_type,document_normalized,active')
      .eq('organization_id', organizationId).eq('id', partyId).maybeSingle(),
    client.from('fiscal_party_profiles').select('*')
      .eq('organization_id', organizationId).eq('party_id', partyId).maybeSingle(),
  ]);
  checkError(partyResult.error, 'Falha ao ler contraparte canônica');
  checkError(profileResult.error, 'Falha ao ler perfil fiscal da contraparte');
  if (!partyResult.data) throw new Error('Contraparte canônica não encontrada nesta organização.');
  return {
    ...(partyResult.data as FiscalRecipientParty),
    profile: (profileResult.data as FiscalPartyProfile | null) ?? null,
  };
}

export async function listFiscalMasterData(organizationId: string) {
  const client = getFiscalServiceClient();
  const [establishments, parties, profiles, services, configs] = await Promise.all([
    client.from('fiscal_establishments').select('*').eq('organization_id', organizationId).eq('active', true).order('legal_name'),
    // Tomador é Party canônica. O Fiscal lê o cadastro da plataforma; não mantém o seu.
    client.from('parties')
      .select('id,organization_id,legal_name,trade_name,document_type,document_normalized,active')
      .eq('organization_id', organizationId).eq('active', true).order('legal_name'),
    client.from('fiscal_party_profiles').select('*').eq('organization_id', organizationId).eq('active', true),
    client.from('fiscal_service_catalog').select('*').eq('organization_id', organizationId).eq('active', true).order('description'),
    // Nenhuma coluna `*_cipher` na projeção: segredo não trafega para a tela.
    client.from('fiscal_provider_configs')
      .select('id,establishment_id,provider_key,environment,enabled,base_url,certificate_subject,certificate_expires_at,certificate_fingerprint,last_health_at,last_health_status,last_health_message')
      .eq('organization_id', organizationId),
  ]);
  for (const [result, label] of [[establishments, 'estabelecimentos'], [parties, 'contrapartes'],
    [profiles, 'perfis fiscais'], [services, 'serviços'], [configs, 'integrações']] as const) {
    checkError(result.error, `Falha ao listar ${label}`);
  }
  const profileByParty = new Map(
    ((profiles.data ?? []) as FiscalPartyProfile[]).map((profile) => [profile.party_id, profile]),
  );
  return {
    establishments: (establishments.data ?? []) as FiscalEstablishment[],
    recipients: ((parties.data ?? []) as FiscalRecipientParty[]).map((party): FiscalRecipient => ({
      ...party,
      profile: profileByParty.get(party.id) ?? null,
    })),
    services: (services.data ?? []).map((row) => normalizeService(row as Record<string, unknown>)),
    providerConfigs: configs.data ?? [],
  };
}

async function ownedRow<T>(table: string, organizationId: string, id: string): Promise<T> {
  const { data, error } = await getFiscalServiceClient().from(table).select('*').eq('organization_id', organizationId).eq('id', id).maybeSingle();
  checkError(error, `Falha ao consultar ${table}`);
  if (!data) throw new Error(`Registro fiscal não encontrado em ${table}.`);
  return data as T;
}

export async function createFiscalDocument(actor: FiscalActor, input: CreateFiscalDocumentInput): Promise<FiscalDocument> {
  const [establishment, recipient, serviceRaw] = await Promise.all([
    ownedRow<FiscalEstablishment>('fiscal_establishments', actor.organizationId, input.establishmentId),
    resolveFiscalRecipient(actor.organizationId, input.partyId),
    ownedRow<FiscalServiceCatalogEntry>('fiscal_service_catalog', actor.organizationId, input.serviceCatalogId),
  ]);
  const service = normalizeService(serviceRaw as unknown as Record<string, unknown>);
  if (service.establishment_id !== establishment.id) throw new Error('O serviço não pertence ao estabelecimento selecionado.');
  if (!service.active) throw new Error('Serviço fiscal inativo.');
  if (input.competenceDate < service.effective_from || (service.effective_to && input.competenceDate > service.effective_to)) {
    throw new Error('Serviço fiscal fora da vigência para a competência informada.');
  }
  if (!recipient.active) throw new Error('Contraparte inativa não pode ser tomadora.');
  // Sem documento não há tomador identificável, e o layout nacional exige um.
  // Preferimos recusar aqui a descobrir na rejeição do fisco.
  if (!recipient.document_normalized || !recipient.document_type) {
    throw new Error('A contraparte não tem CNPJ/CPF canônico registrado — complete o cadastro antes de emitir.');
  }

  const preview = calculateTaxPreview({
    amountCents: input.amountCents,
    deductionsCents: input.deductionsCents,
    unconditionalDiscountCents: input.unconditionalDiscountCents,
    issWithheld: input.issWithheld,
    service,
  });
  const client = getFiscalServiceClient();
  const documentId = crypto.randomUUID();
  const row = {
    id: documentId,
    organization_id: actor.organizationId,
    establishment_id: establishment.id,
    party_id: recipient.id,
    party_profile_id: recipient.profile?.id ?? null,
    project_id: input.projectId ?? null,
    contract_id: input.contractId ?? null,
    business_unit_id: input.businessUnitId ?? null,
    cost_center_id: input.costCenterId ?? null,
    status: 'draft',
    // O ambiente do documento é o do estabelecimento no momento em que ele
    // nasce. Congelar aqui impede que um rascunho de homologação vire
    // transmissão de produção porque o cadastro mudou no meio do caminho.
    environment: establishment.environment,
    competence_date: input.competenceDate,
    due_date: input.dueDate ?? null,
    series: establishment.nfse_series,
    service_amount_cents: input.amountCents,
    deductions_cents: input.deductionsCents ?? 0,
    unconditional_discount_cents: input.unconditionalDiscountCents ?? 0,
    conditional_discount_cents: input.conditionalDiscountCents ?? 0,
    withheld_total_cents: preview.withheldTotalCents,
    issuer_tax_total_cents: preview.issuerTaxTotalCents,
    net_amount_cents: preview.netAmountCents,
    service_location_ibge: input.serviceLocationIbge,
    description: input.description,
    additional_information: input.additionalInformation ?? null,
    issuer_snapshot: establishment,
    recipient_snapshot: recipient,
    service_snapshot: service,
    tax_snapshot: { preview, calculatedAt: new Date().toISOString(), authoritative: false },
    idempotency_key: input.idempotencyKey,
    created_by: actor.userId,
    updated_by: actor.userId,
  };
  const { data: inserted, error } = await client.from('fiscal_documents').insert(row).select('*').single();
  if (error?.code === '23505') {
    const existing = await client.from('fiscal_documents').select('*').eq('organization_id', actor.organizationId).eq('idempotency_key', input.idempotencyKey).single();
    checkError(existing.error, 'Falha ao recuperar rascunho idempotente');
    return existing.data as FiscalDocument;
  }
  checkError(error, 'Falha ao criar rascunho fiscal');

  const itemResult = await client.from('fiscal_document_items').insert({
    organization_id: actor.organizationId,
    document_id: documentId,
    service_catalog_id: service.id,
    sequence: 1,
    description: input.description,
    quantity: input.quantity ?? 1,
    unit_amount_cents: Math.round(input.amountCents / (input.quantity ?? 1)),
    total_amount_cents: input.amountCents,
    service_snapshot: service,
  });
  checkError(itemResult.error, 'Falha ao criar item fiscal');
  if (preview.lines.length) {
    const taxResult = await client.from('fiscal_tax_lines').insert(preview.lines.map((line) => ({
      organization_id: actor.organizationId,
      document_id: documentId,
      ...line,
    })));
    checkError(taxResult.error, 'Falha ao criar linhas tributárias');
  }
  await appendFiscalEvent(actor.organizationId, documentId, 'draft_created', null, 'draft', 'Rascunho fiscal criado.', actor.userId);
  return inserted as FiscalDocument;
}

/**
 * Reserva o próximo número de DPS do estabelecimento.
 *
 * Numeração fiscal não pode repetir nem sofrer corrida entre duas transmissões
 * simultâneas, então a reserva é um UPDATE ... RETURNING atômico no próprio
 * estabelecimento, não um `SELECT max()+1` lido antes e gravado depois.
 */
export async function reserveDpsNumber(organizationId: string, establishmentId: string): Promise<number> {
  const { data, error } = await getFiscalServiceClient()
    .rpc('fiscal_reserve_dps_number', { p_organization_id: organizationId, p_establishment_id: establishmentId });
  checkError(error, 'Falha ao reservar número de DPS');
  const reserved = Number(data);
  if (!Number.isInteger(reserved) || reserved <= 0) throw new Error('Numeração de DPS indisponível para o estabelecimento.');
  return reserved;
}

export async function cloneFiscalDocumentForReplacement(
  actor: FiscalActor,
  originalId: string,
  idempotencyKey: string,
): Promise<FiscalDocument> {
  const client = getFiscalServiceClient();
  const { data: original, error } = await client
    .from('fiscal_documents')
    .select('*')
    .eq('organization_id', actor.organizationId)
    .eq('id', originalId)
    .eq('status', 'authorized')
    .maybeSingle();
  checkError(error, 'Falha ao consultar NFS-e original');
  if (!original) throw new Error('Somente uma NFS-e autorizada pode ser substituída.');

  const existing = await client.from('fiscal_documents').select('*').eq('organization_id', actor.organizationId).eq('idempotency_key', idempotencyKey).maybeSingle();
  if (existing.data) return existing.data as FiscalDocument;

  const replacementId = crypto.randomUUID();
  const resetFields = new Set([
    'id','status','issue_date','dps_number','provider_key','provider_document_id','access_key',
    'document_number','verification_code','provider_payload_sanitized','rejection_code',
    'rejection_message','authorized_at','cancelled_at','replacement_document_id','xml_storage_path',
    'xml_sha256','danfse_storage_path','danfse_sha256','finance_status','cancellation_reason',
    'idempotency_key','submitted_by','approved_by','approved_at','created_by',
    'updated_by','created_at','updated_at',
  ]);
  const cloned = Object.fromEntries(Object.entries(original).filter(([key]) => !resetFields.has(key)));
  const { data: inserted, error: insertError } = await client.from('fiscal_documents').insert({
    ...cloned,
    id: replacementId,
    status: 'draft',
    replaced_document_id: originalId,
    finance_status: 'not_posted',
    idempotency_key: idempotencyKey,
    created_by: actor.userId,
    updated_by: actor.userId,
  }).select('*').single();
  checkError(insertError, 'Falha ao criar rascunho substituto');

  const [{ data: items, error: itemReadError }, { data: taxes, error: taxReadError }] = await Promise.all([
    client.from('fiscal_document_items').select('*').eq('organization_id', actor.organizationId).eq('document_id', originalId),
    client.from('fiscal_tax_lines').select('*').eq('organization_id', actor.organizationId).eq('document_id', originalId),
  ]);
  checkError(itemReadError, 'Falha ao copiar itens da substituição');
  checkError(taxReadError, 'Falha ao copiar tributos da substituição');
  if (items?.length) {
    const result = await client.from('fiscal_document_items').insert(items.map(({ id: _id, created_at: _createdAt, ...item }) => ({ ...item, document_id: replacementId })));
    checkError(result.error, 'Falha ao gravar itens da substituição');
  }
  if (taxes?.length) {
    const result = await client.from('fiscal_tax_lines').insert(taxes.map(({ id: _id, created_at: _createdAt, ...tax }) => ({ ...tax, document_id: replacementId })));
    checkError(result.error, 'Falha ao gravar tributos da substituição');
  }
  await appendFiscalEvent(actor.organizationId, originalId, 'replacement_draft_created', 'authorized', 'authorized', 'Rascunho de substituição criado.', actor.userId, { replacementDocumentId: replacementId });
  await appendFiscalEvent(actor.organizationId, replacementId, 'replacement_draft_created', null, 'draft', 'Rascunho criado a partir da NFS-e original.', actor.userId, { originalDocumentId: originalId });
  return inserted as FiscalDocument;
}

export async function appendFiscalEvent(
  organizationId: string,
  documentId: string,
  eventType: string,
  previousStatus: FiscalDocumentStatus | null,
  nextStatus: FiscalDocumentStatus | null,
  message: string,
  actorUserId?: string | null,
  safePayload: Record<string, unknown> = {},
  providerEventId?: string,
): Promise<void> {
  const { error } = await getFiscalServiceClient().from('fiscal_events').insert({
    organization_id: organizationId,
    document_id: documentId,
    event_type: eventType,
    previous_status: previousStatus,
    next_status: nextStatus,
    message,
    actor_user_id: actorUserId ?? null,
    payload_sanitized: safePayload,
    provider_event_id: providerEventId ?? null,
  });
  if (error?.code !== '23505') checkError(error, 'Falha ao registrar evento fiscal');
}

export async function transitionFiscalDocument(
  actor: FiscalActor,
  documentId: string,
  expected: FiscalDocumentStatus,
  next: FiscalDocumentStatus,
  eventType: string,
  message: string,
  patch: Record<string, unknown> = {},
): Promise<FiscalDocument> {
  assertFiscalTransition(expected, next);
  const { data, error } = await getFiscalServiceClient()
    .from('fiscal_documents')
    .update({ ...patch, status: next, updated_by: actor.userId })
    .eq('organization_id', actor.organizationId)
    .eq('id', documentId)
    .eq('status', expected)
    .select('*')
    .maybeSingle();
  checkError(error, 'Falha ao atualizar documento fiscal');
  if (!data) throw new Error('Documento alterado por outro usuário ou em estado incompatível. Atualize a tela.');
  await appendFiscalEvent(actor.organizationId, documentId, eventType, expected, next, message, actor.userId);
  return data as FiscalDocument;
}

export async function enqueueFiscalJob(
  actor: FiscalActor,
  documentId: string,
  operation: 'issue' | 'consult' | 'cancel' | 'replace' | 'artifact',
  idempotencyKey: string,
  payload: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await getFiscalServiceClient().from('fiscal_jobs').insert({
    organization_id: actor.organizationId,
    document_id: documentId,
    operation,
    idempotency_key: idempotencyKey,
    payload,
  }).select('id').single();
  if (error?.code === '23505') {
    const existing = await getFiscalServiceClient().from('fiscal_jobs').select('id').eq('organization_id', actor.organizationId).eq('idempotency_key', idempotencyKey).single();
    checkError(existing.error, 'Falha ao recuperar tarefa idempotente');
    if (!existing.data) throw new Error('Tarefa fiscal idempotente não encontrada.');
    return String(existing.data.id);
  }
  checkError(error, 'Falha ao enfileirar operação fiscal');
  if (!data) throw new Error('Tarefa fiscal não foi criada.');
  return String(data.id);
}

export async function createEstablishment(actor: FiscalActor, input: Record<string, unknown>) {
  const mapping: Record<string, unknown> = {
    organization_id: actor.organizationId,
    legal_name: input.legalName,
    trade_name: input.tradeName ?? null,
    cnpj: input.cnpj,
    municipal_registration: input.municipalRegistration,
    state_registration: input.stateRegistration ?? null,
    tax_regime: input.taxRegime,
    special_tax_regime: input.specialTaxRegime ?? null,
    municipality_ibge: input.municipalityIbge,
    municipality_name: input.municipalityName,
    uf: input.uf,
    postal_code: input.postalCode,
    street: input.street,
    street_number: input.streetNumber,
    complement: input.complement ?? null,
    district: input.district,
    environment: input.environment,
    nfse_series: input.nfseSeries,
    created_by: actor.userId,
    updated_by: actor.userId,
  };
  const { data, error } = await getFiscalServiceClient().from('fiscal_establishments').insert(mapping).select('*').single();
  checkError(error, 'Falha ao cadastrar estabelecimento');
  return data;
}

/**
 * Cria ou atualiza a EXTENSÃO fiscal de uma Party canônica.
 *
 * Repare no que não está aqui: razão social, CNPJ, CPF. Criar contraparte é ato
 * do cadastro canônico (`/api/parties`), não do Fiscal — se o Fiscal pudesse
 * criar identidade jurídica, o Apex teria dois cadastros de contraparte e
 * nenhuma forma de dizer qual está certo.
 */
export async function upsertFiscalPartyProfile(actor: FiscalActor, input: Record<string, unknown>) {
  const partyId = String(input.partyId);
  // Falha cedo e com mensagem clara se a Party não é desta organização.
  await resolveFiscalRecipient(actor.organizationId, partyId);
  const row = Object.fromEntries(Object.entries({
    organization_id: actor.organizationId,
    party_id: partyId,
    municipal_registration: input.municipalRegistration ?? null,
    state_registration: input.stateRegistration ?? null,
    email: input.email || null,
    phone: input.phone ?? null,
    municipality_ibge: input.municipalityIbge ?? null,
    municipality_name: input.municipalityName ?? null,
    uf: input.uf ?? null,
    country_code: input.countryCode ?? 'BR',
    postal_code: input.postalCode ?? null,
    street: input.street ?? null,
    street_number: input.streetNumber ?? null,
    complement: input.complement ?? null,
    district: input.district ?? null,
    updated_by: actor.userId,
  }).filter(([, value]) => value !== undefined));
  const { data, error } = await getFiscalServiceClient()
    .from('fiscal_party_profiles')
    .upsert({ ...row, created_by: actor.userId }, { onConflict: 'organization_id,party_id' })
    .select('*').single();
  checkError(error, 'Falha ao gravar perfil fiscal da contraparte');
  return data;
}

export async function createService(actor: FiscalActor, input: Record<string, unknown>) {
  await ownedRow('fiscal_establishments', actor.organizationId, String(input.establishmentId));
  const { data, error } = await getFiscalServiceClient().from('fiscal_service_catalog').insert({
    organization_id: actor.organizationId,
    establishment_id: input.establishmentId,
    code: input.code,
    description: input.description,
    lc116_code: input.lc116Code,
    nbs_code: input.nbsCode ?? null,
    municipal_service_code: input.municipalServiceCode,
    cnae_code: input.cnaeCode ?? null,
    iss_rate: input.issRate,
    pis_rate: input.pisRate,
    cofins_rate: input.cofinsRate,
    inss_rate: input.inssRate,
    ir_rate: input.irRate,
    csll_rate: input.csllRate,
    ibs_rate: input.ibsRate,
    cbs_rate: input.cbsRate,
    iss_withheld_default: input.issWithheldDefault,
    effective_from: input.effectiveFrom,
    effective_to: input.effectiveTo ?? null,
    version: input.version,
    approved_by_accountant: input.approvedByAccountant,
    created_by: actor.userId,
    updated_by: actor.userId,
  }).select('*').single();
  checkError(error, 'Falha ao cadastrar serviço fiscal');
  return data;
}
