'use client';

import type { Contract } from '@/lib/types';
import { logAuditEvent } from '@/lib/audit/log-audit-event';
import { createProject, getProjectsAsync } from '@/lib/services/projects';
import { createClient } from '@/utils/supabase/client';

const CONTRACT_FILES_BUCKET = 'contract-files';

export type RiskLevel = 'low' | 'medium' | 'high';
export type ContractStatus = 'draft' | 'active' | 'expiring_soon' | 'expired' | 'archived' | string;

export type ContractRow = {
  id: string;
  organization_id: string;
  project_id: string | null;
  client_id: string | null;
  supplier_id: string | null;
  title: string;
  contract_number: string | null;
  counterparty_name: string | null;
  contract_type: string | null;
  status: ContractStatus;
  lifecycle_stage: string | null;
  start_date: string | null;
  end_date: string | null;
  signed_date: string | null;
  renewal_date: string | null;
  currency: string;
  total_value: number | string | null;
  monthly_value: number | string | null;
  payment_terms: string | null;
  scope_summary: string | null;
  risk_level: RiskLevel;
  health_score: number | string | null;
  owner_user_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /**
   * Origem da linha (migration 091): `live` | `demo` | `unclassified`.
   * Só `live` é elegível a métrica de carteira. Nunca inferir de nome/valor.
   */
  data_class?: 'live' | 'demo' | 'unclassified';
};

/** Estado de revisão humana da cláusula — CHECK na migration 092. */
export type ClauseReviewStatus = 'draft' | 'in_review' | 'validated' | 'rejected' | 'superseded';

export const CLAUSE_REVIEW_LABEL: Record<ClauseReviewStatus, string> = {
  draft: 'Registrada',
  in_review: 'Em revisão',
  validated: 'Validada',
  rejected: 'Rejeitada',
  superseded: 'Substituída',
};

/** Uma cláusula ainda pendente de decisão humana. */
export const PENDING_REVIEW: readonly ClauseReviewStatus[] = ['draft', 'in_review'];

export type ContractClauseRow = {
  id: string;
  organization_id: string;
  contract_id: string;
  clause_type: string | null;
  title: string;
  content: string | null;
  risk_level: RiskLevel;
  /**
   * Marca que a cláusula veio de extração automática. Continua `false` em todo
   * registro manual — é o campo que, quando a extração por IA existir,
   * separará o que a máquina propôs do que uma pessoa registrou.
   */
  ai_flagged: boolean;
  // 092: proveniência documental, efeito contratual e revisão humana.
  source_document_id: string | null;
  source_page: number | null;
  source_excerpt: string | null;
  amount: number | string | null;
  percentage: number | string | null;
  term_days: number | null;
  review_status: ClauseReviewStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  // 093: proveniência da proposta de IA. Todos nulos em registro manual.
  ai_confidence: number | string | null;
  ai_model: string | null;
  ai_analysis_id: string | null;
  ai_proposed_at: string | null;
  /** Título/texto ORIGINAIS propostos, congelados para comparação. */
  ai_proposed_title: string | null;
  ai_proposed_content: string | null;
  superseded_by_clause_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ContractPenaltyRow = {
  id: string;
  organization_id: string;
  contract_id: string;
  title: string;
  description: string | null;
  penalty_type: string | null;
  amount: number | string | null;
  percentage: number | string | null;
  trigger_condition: string | null;
  deadline_date: string | null;
  /** Cláusula que origina a penalidade, quando registrada. */
  clause_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

/** Vocabulário de status do marco — travado por CHECK na migration 092. */
export type ContractMilestoneStatus =
  | 'pending' | 'in_progress' | 'measured' | 'approved' | 'cancelled';

export const MILESTONE_STATUS_LABEL: Record<ContractMilestoneStatus, string> = {
  pending: 'Previsto',
  in_progress: 'Em execução',
  measured: 'Medido',
  approved: 'Aprovado',
  cancelled: 'Cancelado',
};

/** Um marco só conta como medido quando a própria linha o afirma. */
export const MEASURED_STATUSES: readonly ContractMilestoneStatus[] = ['measured', 'approved'];

export type ContractMilestoneRow = {
  id: string;
  organization_id: string;
  contract_id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  milestone_type: string | null;
  due_date: string | null;
  completed_at: string | null;
  billing_amount: number | string | null;
  status: ContractMilestoneStatus;
  // 092: instrumentação operacional.
  owner_user_id: string | null;
  evidence: string | null;
  evidence_document_id: string | null;
  measured_amount: number | string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ContractBillingEventRow = {
  id: string;
  organization_id: string;
  contract_id: string;
  milestone_id: string | null;
  title: string;
  amount: number | string;
  due_date: string | null;
  paid_at: string | null;
  status: string;
  // 036: realized provenance (nullable until the event is realized).
  realized_amount: number | string | null;
  invoice_reference: string | null;
  realized_note: string | null;
  realized_by: string | null;
  realized_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ContractRiskRow = {
  id: string;
  organization_id: string;
  contract_id: string;
  title: string;
  description: string | null;
  category: string | null;
  probability: number | null;
  impact: number | null;
  risk_score: number | null;
  status: string;
  mitigation_plan: string | null;
  owner_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ContractFileRow = {
  id: string;
  organization_id: string;
  contract_id: string;
  file_name: string;
  file_path: string;
  file_type: string | null;
  file_size: number | null;
  uploaded_by: string | null;
  created_at: string;
};

/**
 * Ciclo de vida da análise documental — CHECK na migration 094.
 *
 * `pending` cobre as linhas de placeholder de P0 e a análise enfileirada;
 * `superseded` é a análise que uma reanálise substituiu.
 */
export type AiAnalysisStatus = 'pending' | 'running' | 'completed' | 'failed' | 'superseded';

export const AI_ANALYSIS_STATUS_LABEL: Record<AiAnalysisStatus, string> = {
  pending: 'Aguardando',
  running: 'Analisando',
  completed: 'Concluída',
  failed: 'Falhou',
  superseded: 'Substituída',
};

export type ContractAiAnalysisRow = {
  id: string;
  organization_id: string;
  contract_id: string;
  status: AiAnalysisStatus;
  summary: string | null;
  risk_summary: string | null;
  extracted_data: Record<string, unknown>;
  findings: unknown[];
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
  // 094: ciclo de vida e linhagem.
  document_id: string | null;
  started_at: string | null;
  error_message: string | null;
  model: string | null;
  extractor_version: string | null;
  superseded_by_analysis_id: string | null;
};

export type ContractObligationRow = {
  id: string;
  organization_id: string;
  contract_id: string;
  title: string;
  description: string | null;
  owner_user_id: string | null;
  status: 'open' | 'due_soon' | 'overdue' | 'done';
  due_date: string | null;
  evidence: string | null;
  // 036: completion provenance.
  completion_note: string | null;
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ContractApprovalRow = {
  id: string;
  organization_id: string;
  contract_id: string;
  step_name: 'juridico' | 'financeiro' | 'comite' | 'diretoria';
  status: 'pending' | 'under_review' | 'approved' | 'rejected';
  reviewer_user_id: string | null;
  deadline_date: string | null;
  comments: string | null;
  approval_timestamp: string | null;
  rejection_reason: string | null;
  // 036: step SLA timestamps + request-changes note.
  started_at: string | null;
  completed_at: string | null;
  requested_changes_note: string | null;
  created_at: string;
  updated_at: string;
};

export type ContractProjectLinkRow = {
  id: string;
  organization_id: string;
  contract_id: string;
  project_id: string;
  created_at: string;
};

export type ContractRiskLinkRow = {
  id: string;
  organization_id: string;
  contract_id: string;
  /** Cláusula que originou o risco, quando o vínculo nasceu de uma. */
  clause_id?: string | null;
  risk_id: string;
  created_at: string;
};

export type ContractDocumentStatus = 'uploaded' | 'missing' | 'expired' | 'expiring_soon' | 'pending_approval' | 'approved' | 'rejected';

export type ContractDocumentRow = {
  id: string;
  organization_id: string;
  contract_id: string;
  title: string;
  file_path: string;
  document_type: 'contract' | 'amendment' | 'invoice' | 'guarantee' | 'insurance' | 'annex' | 'purchase_order' | 'certificate' | 'approval' | 'minutes';
  status: ContractDocumentStatus;
  uploaded_by: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejection_reason: string | null;
  // 094: linhagem de versão. `superseded_by_document_id` nulo = documento vigente.
  version: number;
  supersedes_document_id: string | null;
  superseded_by_document_id: string | null;
  superseded_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ContractDetail = {
  contract: ContractRow;
  clauses: ContractClauseRow[];
  penalties: ContractPenaltyRow[];
  milestones: ContractMilestoneRow[];
  billingEvents: ContractBillingEventRow[];
  risks: ContractRiskRow[];
  files: ContractFileRow[];
  aiAnalyses: ContractAiAnalysisRow[];
  obligations: ContractObligationRow[];
  approvals: ContractApprovalRow[];
  projectLinks: ContractProjectLinkRow[];
  riskLinks: ContractRiskLinkRow[];
  documents: ContractDocumentRow[];
};

export type CreateContractInput = {
  title: string;
  counterpartyName?: string | null;
  contractNumber?: string | null;
  contractType?: string | null;
  projectId?: string | null;
  status?: string;
  lifecycleStage?: string | null;
  signedDate?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  renewalDate?: string | null;
  currency?: string;
  totalValue?: number | null;
  monthlyValue?: number | null;
  paymentTerms?: string | null;
  scopeSummary?: string | null;
  riskLevel?: RiskLevel;
  healthScore?: number | null;
  ownerUserId?: string | null;
  file?: File | null;
  aiPlaceholderRequested?: boolean;
  /**
   * Origem do contrato (migration 091). OBRIGATÓRIA e sem valor padrão neste
   * tipo, de propósito: quem cria um contrato precisa declarar se ele é
   * operacional ou de demonstração, e o compilador cobra essa declaração em
   * cada caminho de criação.
   *
   *   'live'          criação normal pela interface operacional
   *   'demo'          seeds, fixtures e caminhos de demonstração
   *   'unclassified'  importações sem classificação explícita
   */
  dataClass: 'live' | 'demo' | 'unclassified';
};

/**
 * `dataClass` está fora do update genérico DE PROPÓSITO.
 *
 * Reclassificar a origem de um contrato muda o que a empresa considera sua
 * carteira oficial — é ato de governança, não efeito colateral de "salvar o
 * formulário". Um `updateContract` distraído nunca deve poder promover um
 * fixture a operacional. Use `reclassifyContract`, que exige justificativa e
 * registra a mudança na auditoria.
 */
export type UpdateContractInput = Partial<Omit<CreateContractInput, 'file' | 'aiPlaceholderRequested' | 'dataClass'>>;

function toNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDate(value: string | null | undefined) {
  return value ? new Date(`${value}T00:00:00`) : undefined;
}

function normalizeLegacyStatus(status: string): Contract['status'] {
  return status || 'active';
}

function sanitizeFileName(fileName: string): string {
  return fileName
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'contrato';
}

async function getCurrentIdentity() {
  const supabase = createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) throw new Error(`Erro ao carregar usuario autenticado: ${userError.message}`);
  if (!user) throw new Error('Usuario autenticado requerido para contratos.');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('user_id', user.id)
    .maybeSingle<{ organization_id: string | null }>();

  if (profileError) throw new Error(`Erro ao carregar organizacao do usuario: ${profileError.message}`);
  if (!profile?.organization_id) throw new Error('Usuario sem organizacao ativa.');

  return { supabase, user, organizationId: profile.organization_id };
}

type SupabaseClientLike = ReturnType<typeof createClient>;

/**
 * Best-effort in-app notification via the shared `create_notification` RPC
 * (same one used by the agenda module). Never throws — a notification failure
 * must never block or roll back the underlying mutation.
 */
async function notifyContractRecipient(
  supabase: SupabaseClientLike,
  recipientUserId: string | null | undefined,
  type: string,
  title: string,
  body: string,
  contractId: string,
): Promise<void> {
  if (!recipientUserId) return;
  try {
    await supabase.rpc('create_notification', {
      p_recipient: recipientUserId,
      p_type: type,
      p_title: title,
      p_body: body,
      p_link: `/contratos/${contractId}`,
    });
  } catch {
    /* best-effort */
  }
}

async function getContractOwnerId(supabase: SupabaseClientLike, contractId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('contracts')
      .select('owner_user_id')
      .eq('id', contractId)
      .maybeSingle<{ owner_user_id: string | null }>();
    return data?.owner_user_id ?? null;
  } catch {
    return null;
  }
}

function normalizeProjectKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function contractRowToLegacyContract(row: ContractRow, files: ContractFileRow[] = []): Contract {
  const primaryFile = files[0];
  return {
    id: row.id,
    name: row.title,
    vendorOrParty: row.counterparty_name || 'Contraparte nao informada',
    value: toNumber(row.total_value),
    currency: row.currency || 'BRL',
    signingDate: toDate(row.signed_date),
    expirationDate: toDate(row.end_date),
    renewalDate: toDate(row.renewal_date),
    fileUrl: primaryFile?.file_path || '',
    fileName: primaryFile?.file_name,
    riskClassification: row.risk_level || 'medium',
    status: normalizeLegacyStatus(row.status),
    uploadedAt: new Date(row.created_at),
    responsibleId: row.owner_user_id || row.updated_by || row.created_by || undefined,
    responsibleName: row.owner_user_id ? 'Responsavel vinculado' : undefined,
    notes: row.scope_summary || undefined,
    autoExtracted: false,
  };
}

export async function listContracts(): Promise<ContractRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('contracts')
    .select('*')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });

  if (error) throw new Error(`Erro ao carregar contratos: ${error.message}`);
  return (data ?? []) as ContractRow[];
}

export async function getContractById(contractId: string): Promise<ContractDetail | null> {
  const supabase = createClient();
  const { data: contract, error } = await supabase
    .from('contracts')
    .select('*')
    .eq('id', contractId)
    .is('deleted_at', null)
    .maybeSingle<ContractRow>();

  if (error) throw new Error(`Erro ao carregar contrato: ${error.message}`);
  if (!contract) return null;

  const [
    clauses,
    penalties,
    milestones,
    billingEvents,
    risks,
    files,
    aiAnalyses,
    obligations,
    approvals,
    projectLinks,
    riskLinks,
    documents
  ] = await Promise.all([
    listContractClauses(contractId),
    listContractPenalties(contractId),
    listContractMilestones(contractId),
    listContractBillingEvents(contractId),
    listContractRisks(contractId),
    listContractFiles(contractId),
    listContractAiAnalyses(contractId),
    listContractObligations(contractId),
    listContractApprovals(contractId),
    listContractProjectLinks(contractId),
    listContractRisksLinks(contractId),
    listContractDocuments(contractId),
  ]);

  return {
    contract,
    clauses,
    penalties,
    milestones,
    billingEvents,
    risks,
    files,
    aiAnalyses,
    obligations,
    approvals,
    projectLinks,
    riskLinks,
    documents
  };
}

export async function createContract(input: CreateContractInput): Promise<ContractRow> {
  const { supabase, user, organizationId } = await getCurrentIdentity();
  const { data, error } = await supabase
    .from('contracts')
    .insert({
      organization_id: organizationId,
      project_id: input.projectId || null,
      title: input.title,
      contract_number: input.contractNumber || null,
      counterparty_name: input.counterpartyName || null,
      contract_type: input.contractType || null,
      status: input.status || 'active',
      lifecycle_stage: input.lifecycleStage || 'created',
      start_date: input.startDate || null,
      end_date: input.endDate || null,
      signed_date: input.signedDate || null,
      renewal_date: input.renewalDate || null,
      currency: input.currency || 'BRL',
      total_value: input.totalValue ?? null,
      monthly_value: input.monthlyValue ?? null,
      payment_terms: input.paymentTerms || null,
      scope_summary: input.scopeSummary || null,
      risk_level: input.riskLevel || 'medium',
      health_score: input.healthScore ?? null,
      data_class: input.dataClass,
      owner_user_id: input.ownerUserId || user.id,
      created_by: user.id,
      updated_by: user.id,
    })
    .select('*')
    .single<ContractRow>();

  if (error) throw new Error(`Erro ao criar contrato: ${error.message}`);

  if (input.file) {
    await uploadContractFile(data.id, input.file);
  }

  if (input.aiPlaceholderRequested) {
    await requestContractAiAnalysisPlaceholder(data.id);
  }

  await logAuditEvent({
    organizationId,
    action: 'contract.created',
    entityType: 'contract',
    entityId: data.id,
    metadata: { title: data.title, project_id: data.project_id },
  });

  return data;
}

/**
 * Mapa campo-do-input → coluna do banco, usado para montar um PATCH parcial.
 *
 * Existe para que `updateContract` grave APENAS o que o chamador realmente
 * passou. Antes, o objeto era montado com as 19 colunas sempre presentes e a
 * correção dependia de um detalhe implícito três camadas abaixo:
 * `postgrest-js` serializa o body com `JSON.stringify`, que descarta chaves
 * `undefined`. Funcionava — por acidente, não por desenho, sem teste que o
 * garantisse. Um dia em que o transporte deixe de usar JSON.stringify (ou passe
 * um replacer) transformaria `sendToLegal` — que envia só 2 dos 19 campos — em
 * um apagador de contrato: `title`, `currency` e `risk_level` são NOT NULL, e o
 * resto viraria NULL silenciosamente.
 *
 * Agora a omissão é explícita e coberta por teste.
 */
const CONTRACT_UPDATE_COLUMNS = {
  projectId: 'project_id',
  title: 'title',
  contractNumber: 'contract_number',
  counterpartyName: 'counterparty_name',
  contractType: 'contract_type',
  status: 'status',
  lifecycleStage: 'lifecycle_stage',
  startDate: 'start_date',
  endDate: 'end_date',
  signedDate: 'signed_date',
  renewalDate: 'renewal_date',
  currency: 'currency',
  totalValue: 'total_value',
  monthlyValue: 'monthly_value',
  paymentTerms: 'payment_terms',
  scopeSummary: 'scope_summary',
  riskLevel: 'risk_level',
  healthScore: 'health_score',
  ownerUserId: 'owner_user_id',
} as const satisfies Record<keyof UpdateContractInput, string>;

/**
 * Monta o PATCH de `contracts` a partir de um input parcial.
 *
 * Regra: uma chave só entra no payload se o chamador a forneceu com valor
 * diferente de `undefined`. `null` É um valor legítimo — é como se limpa uma
 * coluna nullable (desvincular projeto, remover data de renovação) — e portanto
 * passa. `updated_by` é sempre gravado.
 *
 * Função pura, sem I/O: é o ponto testável da correção.
 */
export function buildContractUpdatePayload(
  input: UpdateContractInput,
  updatedBy: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { updated_by: updatedBy };

  for (const [inputKey, column] of Object.entries(CONTRACT_UPDATE_COLUMNS)) {
    const value = (input as Record<string, unknown>)[inputKey];
    if (value !== undefined) payload[column] = value;
  }

  return payload;
}

/** Campos efetivamente enviados, para a metadata de auditoria. */
export function providedContractUpdateFields(input: UpdateContractInput): string[] {
  return Object.keys(CONTRACT_UPDATE_COLUMNS).filter(
    (key) => (input as Record<string, unknown>)[key] !== undefined,
  );
}

export async function updateContract(contractId: string, input: UpdateContractInput): Promise<ContractRow> {
  const { supabase, user, organizationId } = await getCurrentIdentity();
  const { data, error } = await supabase
    .from('contracts')
    .update(buildContractUpdatePayload(input, user.id))
    .eq('id', contractId)
    .select('*')
    .single<ContractRow>();

  if (error) throw new Error(`Erro ao atualizar contrato: ${error.message}`);

  await logAuditEvent({
    organizationId,
    action: 'contract.updated',
    entityType: 'contract',
    entityId: contractId,
    metadata: { fields: providedContractUpdateFields(input) },
  });

  return data;
}

/**
 * Patch de exclusão lógica. Puro, para ser testável.
 */
export function buildContractSoftDeletePatch(
  userId: string,
  now: Date = new Date(),
): { deleted_at: string; updated_by: string } {
  return { deleted_at: now.toISOString(), updated_by: userId };
}

/**
 * Marca o contrato como excluído gravando `deleted_at` — não apaga a linha.
 *
 * Até 18/08/2026 esta função chamava `.delete()`: um DELETE FÍSICO que levava em
 * CASCADE obrigações, faturamento, documentos, aprovações, vínculos de projeto e
 * risco, arquivos e análises — irrecuperável — apesar do nome da função e da
 * coluna `deleted_at`, que existe desde a migration 006 e nunca era escrita.
 *
 * A troca é invisível para quem lê: `listContracts` e `getContractById` já
 * filtram `deleted_at IS NULL`.
 *
 * RLS: passa por `contracts_update_permissioned` (007:470), cujo USING aceita
 * `contracts.edit` OR `contracts.delete` — logo quem podia excluir continua
 * podendo — e cujo WITH CHECK não reimpõe `deleted_at IS NULL`, então gravar o
 * timestamp é permitido. Nenhuma migration é necessária.
 *
 * O `.is('deleted_at', null)` mantém a idempotência: reexcluir afeta 0 linhas e
 * não erra, mesmo comportamento observável do DELETE anterior.
 */
/**
 * Reclassifica a origem de um contrato, com justificativa obrigatória.
 *
 * Separada de `updateContract` porque a consequência é diferente em espécie:
 * promover um contrato a `live` o faz entrar na exposição, na saúde e no PDF
 * oficiais da empresa. Isso precisa de intenção explícita e de rastro.
 */
export async function reclassifyContract(
  contractId: string,
  dataClass: 'live' | 'demo' | 'unclassified',
  reason: string,
): Promise<void> {
  if (!reason.trim()) {
    throw new Error('Justificativa é obrigatória para reclassificar a origem de um contrato.');
  }

  const { supabase, user, organizationId } = await getCurrentIdentity();
  const { data: before } = await supabase
    .from('contracts')
    .select('data_class')
    .eq('id', contractId)
    .maybeSingle<{ data_class: string | null }>();

  const { error } = await supabase
    .from('contracts')
    .update({ data_class: dataClass, updated_by: user.id })
    .eq('id', contractId);

  if (error) throw new Error(`Erro ao reclassificar contrato: ${error.message}`);

  await logAuditEvent({
    organizationId,
    action: 'contract.reclassified',
    entityType: 'contract',
    entityId: contractId,
    metadata: { from: before?.data_class ?? null, to: dataClass, reason },
  });
}

export async function softDeleteContract(contractId: string): Promise<void> {
  const { supabase, user, organizationId } = await getCurrentIdentity();
  const { error } = await supabase
    .from('contracts')
    .update(buildContractSoftDeletePatch(user.id))
    .eq('id', contractId)
    .is('deleted_at', null);

  if (error) throw new Error(`Erro ao excluir contrato: ${error.message}`);

  await logAuditEvent({
    organizationId,
    action: 'contract.deleted',
    entityType: 'contract',
    entityId: contractId,
  });
}

export async function listContractFiles(contractId: string): Promise<ContractFileRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('contract_files').select('*').eq('contract_id', contractId).order('created_at', { ascending: false });
  if (error) throw new Error(`Erro ao carregar arquivos do contrato: ${error.message}`);
  return (data ?? []) as ContractFileRow[];
}

export async function uploadContractFile(contractId: string, file: File): Promise<ContractFileRow> {
  const { supabase, user, organizationId } = await getCurrentIdentity();
  const safeName = sanitizeFileName(file.name);
  const filePath = `${organizationId}/${contractId}/${crypto.randomUUID()}-${safeName}`;
  const { error: uploadError } = await supabase.storage.from(CONTRACT_FILES_BUCKET).upload(filePath, file, { upsert: false });
  if (uploadError) throw new Error(`Erro ao enviar arquivo do contrato: ${uploadError.message}`);

  const { data, error } = await supabase
    .from('contract_files')
    .insert({
      organization_id: organizationId,
      contract_id: contractId,
      file_name: file.name,
      file_path: filePath,
      file_type: file.type || null,
      file_size: file.size,
      uploaded_by: user.id,
    })
    .select('*')
    .single<ContractFileRow>();

  if (error) throw new Error(`Erro ao registrar arquivo do contrato: ${error.message}`);

  await logAuditEvent({
    organizationId,
    action: 'contract.file_uploaded',
    entityType: 'contract',
    entityId: contractId,
    metadata: { file_name: file.name, file_size: file.size },
  });

  return data;
}

export async function listContractClauses(contractId: string): Promise<ContractClauseRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('contract_clauses').select('*').eq('contract_id', contractId).order('created_at');
  if (error) throw new Error(`Erro ao carregar clausulas: ${error.message}`);
  return (data ?? []) as ContractClauseRow[];
}

export async function listContractPenalties(contractId: string): Promise<ContractPenaltyRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('contract_penalties').select('*').eq('contract_id', contractId).order('created_at');
  if (error) throw new Error(`Erro ao carregar penalidades: ${error.message}`);
  return (data ?? []) as ContractPenaltyRow[];
}

export async function listContractMilestones(contractId: string): Promise<ContractMilestoneRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('contract_milestones').select('*').eq('contract_id', contractId).order('due_date');
  if (error) throw new Error(`Erro ao carregar marcos: ${error.message}`);
  return (data ?? []) as ContractMilestoneRow[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Marcos / Medição — instrumentação P2B
//
// `contract_milestones` existia desde a migration 006 e nunca recebeu uma
// linha: era lida em três pontos do produto e escrita em nenhum. As funções
// abaixo abrem o caminho de escrita, sempre passando por RLS (que exige
// `contracts.edit`) e sempre registrando em `audit_logs`.
//
// Não há domínio novo: `contract_billing_events.milestone_id` já existia e
// continua sendo a ponte para faturamento.
// ═══════════════════════════════════════════════════════════════════════════

export type OrganizationMember = { userId: string; name: string };

/**
 * Membros da organização, para os seletores de responsável.
 *
 * Lê `profiles` — a mesma fonte que Agenda, Deliberações e Projetos já
 * consultam para o mesmo fim. Contratos não mantém cópia de gente: referencia
 * `user_id` e pede o nome a quem o guarda.
 *
 * Best-effort: falha devolve lista vazia, e o seletor cai em "não atribuído" —
 * que é honesto, porque a alternativa seria bloquear o registro do marco por
 * causa do picker.
 */
export async function listOrganizationMembers(): Promise<OrganizationMember[]> {
  try {
    const { supabase, organizationId } = await getCurrentIdentity();
    const { data, error } = await supabase
      .from('profiles')
      .select('user_id, full_name')
      .eq('organization_id', organizationId)
      .order('full_name');
    if (error) return [];
    return (data ?? [])
      .filter((row): row is { user_id: string; full_name: string | null } => Boolean(row.user_id))
      .map((row) => ({ userId: row.user_id, name: row.full_name ?? 'Sem nome' }));
  } catch {
    return [];
  }
}

export type CreateContractMilestoneInput = {
  contractId: string;
  title: string;
  description?: string | null;
  milestoneType?: string | null;
  dueDate?: string | null;
  billingAmount?: number | null;
  ownerUserId?: string | null;
  evidence?: string | null;
  evidenceDocumentId?: string | null;
  projectId?: string | null;
};

/**
 * Monta o payload de criação de marco.
 *
 * Pura e exportada para teste: é aqui que se garante que um marco nasce
 * `pending` e SEM valor medido. `measured_amount` nulo é a afirmação de que
 * ninguém mediu ainda — zero diria que a medição aconteceu e deu zero.
 */
export function buildMilestoneCreatePayload(
  input: CreateContractMilestoneInput,
  organizationId: string,
  userId: string,
): Record<string, unknown> {
  return {
    organization_id: organizationId,
    contract_id: input.contractId,
    project_id: input.projectId ?? null,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    milestone_type: input.milestoneType?.trim() || null,
    due_date: input.dueDate || null,
    billing_amount: input.billingAmount ?? null,
    owner_user_id: input.ownerUserId || null,
    evidence: input.evidence?.trim() || null,
    evidence_document_id: input.evidenceDocumentId || null,
    status: 'pending' as ContractMilestoneStatus,
    measured_amount: null,
    completed_at: null,
    created_by: userId,
    updated_by: userId,
  };
}

export async function createContractMilestone(
  input: CreateContractMilestoneInput,
): Promise<ContractMilestoneRow> {
  const { supabase, user, organizationId } = await getCurrentIdentity();
  const { data, error } = await supabase
    .from('contract_milestones')
    .insert(buildMilestoneCreatePayload(input, organizationId, user.id))
    .select('*')
    .single<ContractMilestoneRow>();
  if (error) throw new Error(`Erro ao criar marco: ${error.message}`);

  await logAuditEvent({
    organizationId,
    action: 'contract.milestone_created',
    entityType: 'contract',
    entityId: input.contractId,
    metadata: {
      milestone_id: data.id,
      title: data.title,
      due_date: data.due_date,
      billing_amount: data.billing_amount,
    },
  });

  await notifyContractRecipient(
    supabase,
    input.ownerUserId ?? null,
    'contract_milestone_assigned',
    'Novo marco contratual',
    `Você é responsável pelo marco "${input.title}".`,
    input.contractId,
  );

  return data;
}

export type UpdateContractMilestoneInput = {
  title?: string;
  description?: string | null;
  milestoneType?: string | null;
  dueDate?: string | null;
  billingAmount?: number | null;
  ownerUserId?: string | null;
  evidence?: string | null;
  evidenceDocumentId?: string | null;
  status?: ContractMilestoneStatus;
  measuredAmount?: number | null;
};

/**
 * Patch parcial de marco — só as chaves informadas.
 *
 * Mesma decisão de `buildContractUpdatePayload` (P0.2): a omissão é explícita
 * e testada, em vez de depender do `JSON.stringify` do postgrest descartar
 * `undefined` três camadas abaixo.
 *
 * A regra de negócio embutida: ao entrar em `measured`/`approved` o marco
 * carimba `completed_at`; ao sair, o carimbo é limpo. Sem isso um marco
 * revertido continuaria "medido em" uma data que já não vale.
 */
export function buildMilestoneUpdatePayload(
  input: UpdateContractMilestoneInput,
  userId: string,
  now: Date = new Date(),
): Record<string, unknown> {
  const payload: Record<string, unknown> = { updated_by: userId };
  if (input.title !== undefined) payload.title = input.title.trim();
  if (input.description !== undefined) payload.description = input.description?.trim() || null;
  if (input.milestoneType !== undefined) payload.milestone_type = input.milestoneType?.trim() || null;
  if (input.dueDate !== undefined) payload.due_date = input.dueDate || null;
  if (input.billingAmount !== undefined) payload.billing_amount = input.billingAmount;
  if (input.ownerUserId !== undefined) payload.owner_user_id = input.ownerUserId || null;
  if (input.evidence !== undefined) payload.evidence = input.evidence?.trim() || null;
  if (input.evidenceDocumentId !== undefined) payload.evidence_document_id = input.evidenceDocumentId || null;
  if (input.measuredAmount !== undefined) payload.measured_amount = input.measuredAmount;
  if (input.status !== undefined) {
    payload.status = input.status;
    payload.completed_at = MEASURED_STATUSES.includes(input.status) ? now.toISOString() : null;
  }
  return payload;
}

export async function updateContractMilestone(
  milestoneId: string,
  input: UpdateContractMilestoneInput,
): Promise<ContractMilestoneRow> {
  const { supabase, user, organizationId } = await getCurrentIdentity();
  const { data, error } = await supabase
    .from('contract_milestones')
    .update(buildMilestoneUpdatePayload(input, user.id))
    .eq('id', milestoneId)
    .select('*')
    .single<ContractMilestoneRow>();
  if (error) throw new Error(`Erro ao atualizar marco: ${error.message}`);

  await logAuditEvent({
    organizationId,
    action: 'contract.milestone_updated',
    entityType: 'contract',
    entityId: data.contract_id,
    metadata: {
      milestone_id: milestoneId,
      changed: Object.keys(input),
      status: data.status,
      measured_amount: data.measured_amount,
    },
  });

  return data;
}

/**
 * Gera o evento de faturamento a partir de um marco medido.
 *
 * É a ponte marco → faturamento, e ela é explícita por escolha: medir não
 * fatura. O evento nasce pendente, com `milestone_id` preenchido, e o
 * faturamento continua sendo realizado pelo fluxo que já existia.
 */
export async function createBillingEventFromMilestone(
  milestone: ContractMilestoneRow,
): Promise<ContractBillingEventRow> {
  const { supabase, organizationId } = await getCurrentIdentity();

  const amount = milestone.measured_amount ?? milestone.billing_amount;
  if (amount === null || amount === undefined) {
    throw new Error('O marco não tem valor medido nem previsto: não há o que faturar.');
  }

  const { data, error } = await supabase
    .from('contract_billing_events')
    .insert({
      organization_id: organizationId,
      contract_id: milestone.contract_id,
      milestone_id: milestone.id,
      title: milestone.title,
      amount,
      due_date: milestone.due_date,
      status: 'pendente',
    })
    .select('*')
    .single<ContractBillingEventRow>();
  if (error) throw new Error(`Erro ao gerar faturamento do marco: ${error.message}`);

  await logAuditEvent({
    organizationId,
    action: 'contract.billing_created_from_milestone',
    entityType: 'contract',
    entityId: milestone.contract_id,
    metadata: { milestone_id: milestone.id, billing_event_id: data.id, amount },
  });

  return data;
}

export async function deleteContractMilestone(milestoneId: string, contractId: string): Promise<void> {
  const { supabase, organizationId } = await getCurrentIdentity();
  const { error } = await supabase.from('contract_milestones').delete().eq('id', milestoneId);
  if (error) throw new Error(`Erro ao remover marco: ${error.message}`);
  await logAuditEvent({
    organizationId,
    action: 'contract.milestone_deleted',
    entityType: 'contract',
    entityId: contractId,
    metadata: { milestone_id: milestoneId },
  });
}

export async function listContractBillingEvents(contractId: string): Promise<ContractBillingEventRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('contract_billing_events').select('*').eq('contract_id', contractId).order('due_date');
  if (error) throw new Error(`Erro ao carregar faturamento: ${error.message}`);
  return (data ?? []) as ContractBillingEventRow[];
}

export type CreateContractBillingEventInput = {
  contractId: string;
  title: string;
  amount: number;
  dueDate?: string | null;
  status?: string;
  milestoneId?: string | null;
};

export async function createContractBillingEvent(input: CreateContractBillingEventInput): Promise<ContractBillingEventRow> {
  const { supabase, organizationId } = await getCurrentIdentity();
  const { data, error } = await supabase
    .from('contract_billing_events')
    .insert({
      organization_id: organizationId,
      contract_id: input.contractId,
      milestone_id: input.milestoneId ?? null,
      title: input.title,
      amount: input.amount,
      due_date: input.dueDate ?? null,
      status: input.status ?? 'pendente',
      paid_at: input.status === 'pago' ? new Date().toISOString() : null,
    })
    .select('*')
    .single<ContractBillingEventRow>();
  if (error) throw new Error(`Erro ao criar evento de faturamento: ${error.message}`);

  await logAuditEvent({
    organizationId,
    action: 'contract.billing_event_created',
    entityType: 'contract',
    entityId: input.contractId,
    metadata: { title: input.title, amount: input.amount, status: data.status },
  });

  return data;
}

export async function updateContractBillingEvent(
  id: string,
  patch: Partial<Pick<ContractBillingEventRow, 'title' | 'amount' | 'due_date' | 'paid_at' | 'status' | 'milestone_id'>>,
): Promise<ContractBillingEventRow> {
  const { supabase, organizationId } = await getCurrentIdentity();
  const { data, error } = await supabase
    .from('contract_billing_events')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single<ContractBillingEventRow>();
  if (error) throw new Error(`Erro ao atualizar evento de faturamento: ${error.message}`);

  await logAuditEvent({
    organizationId,
    action: 'contract.billing_event_updated',
    entityType: 'contract',
    entityId: data.contract_id,
    metadata: { billing_event_id: id, status: data.status },
  });

  return data;
}

export async function markBillingEventRealized(
  id: string,
  opts?: { paidAt?: string | null; status?: string; reference?: string | null; note?: string | null; realizedAmount?: number | null },
): Promise<ContractBillingEventRow> {
  const { supabase, user, organizationId } = await getCurrentIdentity();
  const realizedAt = opts?.paidAt ?? new Date().toISOString();
  const patch: Record<string, unknown> = {
    paid_at: realizedAt,
    status: opts?.status ?? 'pago',
    realized_at: realizedAt,
    realized_by: user.id,
    invoice_reference: opts?.reference ?? null,
    realized_note: opts?.note ?? null,
    updated_at: new Date().toISOString(),
  };
  if (opts?.realizedAmount != null) patch.realized_amount = opts.realizedAmount;
  const { data, error } = await supabase
    .from('contract_billing_events')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single<ContractBillingEventRow>();
  if (error) throw new Error(`Erro ao marcar faturamento como realizado: ${error.message}`);

  await logAuditEvent({
    organizationId,
    action: 'contract.billing_event_realized',
    entityType: 'contract',
    entityId: data.contract_id,
    metadata: { billing_event_id: id, amount: data.amount, status: data.status, reference: opts?.reference ?? null, note: opts?.note ?? null },
  });

  await notifyContractRecipient(
    supabase,
    await getContractOwnerId(supabase, data.contract_id),
    'contract_billing_event_realized',
    'Faturamento realizado',
    `Evento "${data.title}" marcado como faturado.`,
    data.contract_id,
  );

  return data;
}

// ═══════════════════════════════════════════════════════════════════════════
// Cláusulas e penalidades — instrumentação P2B
//
// Mesma história de `contract_milestones`: tabelas de 006, RLS correta, zero
// linhas, zero caminhos de escrita. As funções abaixo permitem REGISTRO
// MANUAL ESTRUTURADO.
//
// `ai_flagged` continua `false` em todo registro manual. É deliberado: no dia
// em que houver extração automática, o campo já separa o que a máquina propôs
// do que uma pessoa afirmou, e `review_status` já separa registrado de
// validado. Nada aqui fabrica cláusula extraída.
// ═══════════════════════════════════════════════════════════════════════════

export type CreateContractClauseInput = {
  contractId: string;
  title: string;
  clauseType?: string | null;
  content?: string | null;
  riskLevel?: RiskLevel;
  sourceDocumentId?: string | null;
  sourcePage?: number | null;
  sourceExcerpt?: string | null;
  amount?: number | null;
  percentage?: number | null;
  termDays?: number | null;
};

/**
 * Payload de criação de cláusula. Puro e exportado para teste.
 *
 * Duas garantias travadas aqui: registro manual nasce `ai_flagged: false` e
 * `review_status: 'draft'`. Registrar não é validar — quem registra afirma que
 * transcreveu, não que conferiu.
 */
export function buildClauseCreatePayload(
  input: CreateContractClauseInput,
  organizationId: string,
  userId: string,
): Record<string, unknown> {
  return {
    organization_id: organizationId,
    contract_id: input.contractId,
    title: input.title.trim(),
    clause_type: input.clauseType?.trim() || null,
    content: input.content?.trim() || null,
    risk_level: input.riskLevel ?? 'medium',
    source_document_id: input.sourceDocumentId || null,
    source_page: input.sourcePage ?? null,
    source_excerpt: input.sourceExcerpt?.trim() || null,
    amount: input.amount ?? null,
    percentage: input.percentage ?? null,
    term_days: input.termDays ?? null,
    ai_flagged: false,
    review_status: 'draft' as ClauseReviewStatus,
    created_by: userId,
    updated_by: userId,
  };
}

export async function createContractClause(
  input: CreateContractClauseInput,
): Promise<ContractClauseRow> {
  const { supabase, user, organizationId } = await getCurrentIdentity();
  const { data, error } = await supabase
    .from('contract_clauses')
    .insert(buildClauseCreatePayload(input, organizationId, user.id))
    .select('*')
    .single<ContractClauseRow>();
  if (error) throw new Error(`Erro ao registrar cláusula: ${error.message}`);

  await logAuditEvent({
    organizationId,
    action: 'contract.clause_created',
    entityType: 'contract',
    entityId: input.contractId,
    metadata: {
      clause_id: data.id,
      title: data.title,
      clause_type: data.clause_type,
      risk_level: data.risk_level,
      source_page: data.source_page,
    },
  });

  return data;
}

export type UpdateContractClauseInput = {
  title?: string;
  clauseType?: string | null;
  content?: string | null;
  riskLevel?: RiskLevel;
  sourceDocumentId?: string | null;
  sourcePage?: number | null;
  sourceExcerpt?: string | null;
  amount?: number | null;
  percentage?: number | null;
  termDays?: number | null;
};

export function buildClauseUpdatePayload(
  input: UpdateContractClauseInput,
  userId: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { updated_by: userId };
  if (input.title !== undefined) payload.title = input.title.trim();
  if (input.clauseType !== undefined) payload.clause_type = input.clauseType?.trim() || null;
  if (input.content !== undefined) payload.content = input.content?.trim() || null;
  if (input.riskLevel !== undefined) payload.risk_level = input.riskLevel;
  if (input.sourceDocumentId !== undefined) payload.source_document_id = input.sourceDocumentId || null;
  if (input.sourcePage !== undefined) payload.source_page = input.sourcePage;
  if (input.sourceExcerpt !== undefined) payload.source_excerpt = input.sourceExcerpt?.trim() || null;
  if (input.amount !== undefined) payload.amount = input.amount;
  if (input.percentage !== undefined) payload.percentage = input.percentage;
  if (input.termDays !== undefined) payload.term_days = input.termDays;
  return payload;
}

export async function updateContractClause(
  clauseId: string,
  input: UpdateContractClauseInput,
): Promise<ContractClauseRow> {
  const { supabase, user, organizationId } = await getCurrentIdentity();
  const { data, error } = await supabase
    .from('contract_clauses')
    .update(buildClauseUpdatePayload(input, user.id))
    .eq('id', clauseId)
    .select('*')
    .single<ContractClauseRow>();
  if (error) throw new Error(`Erro ao atualizar cláusula: ${error.message}`);

  await logAuditEvent({
    organizationId,
    action: 'contract.clause_updated',
    entityType: 'contract',
    entityId: data.contract_id,
    metadata: { clause_id: clauseId, changed: Object.keys(input) },
  });

  return data;
}

/**
 * Revisão humana da cláusula.
 *
 * Sai do update genérico de propósito, como `reclassifyContract`: mudar o
 * estado de revisão é uma AFIRMAÇÃO de alguém sobre a cláusula, e carimba
 * quem e quando. Rejeitar exige motivo.
 */
export async function reviewContractClause(
  clauseId: string,
  reviewStatus: ClauseReviewStatus,
  note?: string | null,
): Promise<ContractClauseRow> {
  const { supabase, user, organizationId } = await getCurrentIdentity();
  if (reviewStatus === 'rejected' && !note?.trim()) {
    throw new Error('Rejeitar uma cláusula exige justificativa.');
  }

  const decided = reviewStatus === 'validated' || reviewStatus === 'rejected';
  const { data, error } = await supabase
    .from('contract_clauses')
    .update({
      review_status: reviewStatus,
      reviewed_by: decided ? user.id : null,
      reviewed_at: decided ? new Date().toISOString() : null,
      updated_by: user.id,
    })
    .eq('id', clauseId)
    .select('*')
    .single<ContractClauseRow>();
  if (error) throw new Error(`Erro ao revisar cláusula: ${error.message}`);

  await logAuditEvent({
    organizationId,
    action: 'contract.clause_reviewed',
    entityType: 'contract',
    entityId: data.contract_id,
    metadata: { clause_id: clauseId, review_status: reviewStatus, note: note?.trim() || null },
  });

  return data;
}

export async function deleteContractClause(clauseId: string, contractId: string): Promise<void> {
  const { supabase, organizationId } = await getCurrentIdentity();
  const { error } = await supabase.from('contract_clauses').delete().eq('id', clauseId);
  if (error) throw new Error(`Erro ao remover cláusula: ${error.message}`);
  await logAuditEvent({
    organizationId,
    action: 'contract.clause_deleted',
    entityType: 'contract',
    entityId: contractId,
    metadata: { clause_id: clauseId },
  });
}

/**
 * Substitui uma proposta por uma cláusula corrigida.
 *
 * A proposta original NÃO é apagada: vira `superseded` e aponta para a
 * sucessora. É o que mantém a trilha completa proposta-de-IA → decisão-humana
 * auditável — apagar a proposta destruiria a evidência de que a máquina leu
 * diferente do que a pessoa concluiu.
 */
export async function supersedeContractClause(
  clauseId: string,
  replacement: CreateContractClauseInput,
): Promise<ContractClauseRow> {
  const { supabase, user, organizationId } = await getCurrentIdentity();

  const created = await createContractClause(replacement);

  const { error } = await supabase
    .from('contract_clauses')
    .update({
      review_status: 'superseded' as ClauseReviewStatus,
      superseded_by_clause_id: created.id,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq('id', clauseId);
  if (error) throw new Error(`Erro ao substituir cláusula: ${error.message}`);

  await logAuditEvent({
    organizationId,
    action: 'contract.clause_superseded',
    entityType: 'contract',
    entityId: replacement.contractId,
    metadata: { superseded_clause_id: clauseId, replacement_clause_id: created.id },
  });

  return created;
}

/**
 * Marca um documento como substituído por outro.
 *
 * O efeito colateral que importa: as propostas PENDENTES originadas do
 * documento antigo deixam de valer, porque foram lidas de um papel que não é
 * mais o vigente. Cláusulas já VALIDADAS não são tocadas — elas são afirmação
 * humana sobre o que o contrato dizia, e continuam sendo verdade histórica.
 */
export async function supersedeContractDocument(
  oldDocumentId: string,
  newDocumentId: string,
  contractId: string,
): Promise<{ supersededProposals: number }> {
  const { supabase, user, organizationId } = await getCurrentIdentity();
  const now = new Date().toISOString();

  const { error: oldError } = await supabase
    .from('contract_documents')
    .update({ superseded_by_document_id: newDocumentId, superseded_at: now })
    .eq('id', oldDocumentId);
  if (oldError) throw new Error(`Erro ao substituir documento: ${oldError.message}`);

  const { data: previous } = await supabase
    .from('contract_documents').select('version').eq('id', oldDocumentId).maybeSingle<{ version: number }>();

  const { error: newError } = await supabase
    .from('contract_documents')
    .update({ supersedes_document_id: oldDocumentId, version: (previous?.version ?? 1) + 1 })
    .eq('id', newDocumentId);
  if (newError) throw new Error(`Erro ao versionar documento: ${newError.message}`);

  // Propostas pendentes do documento antigo saem da fila: não podem seguir
  // "vigentes" apontando para um papel superado.
  const { data: staled, error: staleError } = await supabase
    .from('contract_clauses')
    .update({ review_status: 'superseded' as ClauseReviewStatus, updated_by: user.id })
    .eq('source_document_id', oldDocumentId)
    .eq('ai_flagged', true)
    .in('review_status', ['draft', 'in_review'])
    .select('id');
  if (staleError) throw new Error(`Erro ao encerrar propostas do documento anterior: ${staleError.message}`);

  await logAuditEvent({
    organizationId,
    action: 'contract.document_superseded',
    entityType: 'contract',
    entityId: contractId,
    metadata: {
      superseded_document_id: oldDocumentId,
      replacement_document_id: newDocumentId,
      stale_proposals: staled?.length ?? 0,
    },
  });

  return { supersededProposals: staled?.length ?? 0 };
}

export type ClauseExtractionResult = {
  ok: boolean;
  analysisId?: string;
  proposedCount?: number;
  rejectedCount?: number;
  /** Leituras idênticas às já registradas — puladas pela reanálise. */
  duplicateCount?: number;
  supersededAnalysisId?: string | null;
  error?: string;
};

/**
 * Dispara a extração assistida a partir de um documento do contrato.
 *
 * A análise roda no servidor (a chave da Anthropic nunca chega ao browser) e
 * grava as propostas já marcadas como proposta.
 */
export async function requestClauseExtraction(
  contractId: string,
  documentId: string,
): Promise<ClauseExtractionResult> {
  const response = await fetch(`/api/ai/clause-extraction/${contractId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId }),
  });
  const payload = (await response.json()) as ClauseExtractionResult;
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error ?? 'Falha na análise documental.');
  }
  return payload;
}

export type CreateContractPenaltyInput = {
  contractId: string;
  title: string;
  description?: string | null;
  penaltyType?: string | null;
  amount?: number | null;
  percentage?: number | null;
  triggerCondition?: string | null;
  deadlineDate?: string | null;
  /** Cláusula que origina a penalidade. */
  clauseId?: string | null;
};

export async function createContractPenalty(
  input: CreateContractPenaltyInput,
): Promise<ContractPenaltyRow> {
  const { supabase, user, organizationId } = await getCurrentIdentity();
  const { data, error } = await supabase
    .from('contract_penalties')
    .insert({
      organization_id: organizationId,
      contract_id: input.contractId,
      clause_id: input.clauseId || null,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      penalty_type: input.penaltyType?.trim() || null,
      amount: input.amount ?? null,
      percentage: input.percentage ?? null,
      trigger_condition: input.triggerCondition?.trim() || null,
      deadline_date: input.deadlineDate || null,
      status: 'active',
      created_by: user.id,
      updated_by: user.id,
    })
    .select('*')
    .single<ContractPenaltyRow>();
  if (error) throw new Error(`Erro ao registrar penalidade: ${error.message}`);

  await logAuditEvent({
    organizationId,
    action: 'contract.penalty_created',
    entityType: 'contract',
    entityId: input.contractId,
    metadata: {
      penalty_id: data.id,
      title: data.title,
      clause_id: data.clause_id,
      amount: data.amount,
      percentage: data.percentage,
    },
  });

  return data;
}

/**
 * Vincula um risco EXISTENTE à cláusula que o origina.
 *
 * O risco continua vivendo no módulo de Riscos — aqui só se registra que
 * aquela cláusula é a origem contratual dele.
 */
export async function linkClauseToRisk(
  contractId: string,
  clauseId: string,
  riskId: string,
): Promise<ContractRiskLinkRow> {
  const { supabase, organizationId } = await getCurrentIdentity();
  const { data, error } = await supabase
    .from('contract_risks_links')
    .upsert(
      { organization_id: organizationId, contract_id: contractId, risk_id: riskId, clause_id: clauseId },
      { onConflict: 'contract_id,risk_id' },
    )
    .select('*')
    .single<ContractRiskLinkRow>();
  if (error) throw new Error(`Erro ao vincular cláusula ao risco: ${error.message}`);

  await logAuditEvent({
    organizationId,
    action: 'contract.clause_linked_risk',
    entityType: 'contract',
    entityId: contractId,
    metadata: { clause_id: clauseId, risk_id: riskId },
  });

  return data;
}

export async function listContractRisks(contractId: string): Promise<ContractRiskRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('contract_risks').select('*').eq('contract_id', contractId).order('created_at', { ascending: false });
  if (error) throw new Error(`Erro ao carregar riscos: ${error.message}`);
  return (data ?? []) as ContractRiskRow[];
}

export async function listContractAiAnalyses(contractId: string): Promise<ContractAiAnalysisRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('contract_ai_analyses').select('*').eq('contract_id', contractId).order('created_at', { ascending: false });
  if (error) throw new Error(`Erro ao carregar analises IA: ${error.message}`);
  return (data ?? []) as ContractAiAnalysisRow[];
}

export async function requestContractAiAnalysisPlaceholder(contractId: string): Promise<ContractAiAnalysisRow> {
  const { supabase, user, organizationId } = await getCurrentIdentity();
  const { data, error } = await supabase
    .from('contract_ai_analyses')
    .insert({
      organization_id: organizationId,
      contract_id: contractId,
      status: 'pending',
      summary: 'Placeholder seguro: nenhuma analise documental real foi executada.',
      risk_summary: 'Aguardando motor de IA e documento fonte.',
      extracted_data: { foundation: true, source: 'manual_request' },
      findings: [],
      created_by: user.id,
    })
    .select('*')
    .single<ContractAiAnalysisRow>();

  if (error) throw new Error(`Erro ao solicitar analise IA: ${error.message}`);

  await logAuditEvent({
    organizationId,
    action: 'contract.ai_analysis_requested',
    entityType: 'contract',
    entityId: contractId,
    metadata: { status: 'pending_placeholder' },
  });

  return data;
}

export async function createProjectFromContract(contractId: string) {
  const detail = await getContractById(contractId);
  if (!detail) throw new Error('Contrato nao encontrado.');

  const { contract } = detail;
  if (contract.project_id) throw new Error('Contrato ja possui projeto vinculado.');
  if (!['signed', 'active'].includes(contract.status)) {
    throw new Error('Projeto deve ser criado apenas depois do contrato assinado ou ativo.');
  }

  // Duplicate guard: block if a project link already exists, or a project with
  // the same code / normalized title already exists. Prefer linking the existing
  // project over creating a near-duplicate.
  const existingLinks = detail.projectLinks ?? [];
  if (existingLinks.length > 0) {
    throw new Error('Contrato já possui vínculo de projeto (contract_project_links). Vincule o projeto existente.');
  }
  const projectCandidateCode = normalizeProjectKey(contract.contract_number || `CTR-${contract.id.slice(0, 8)}`);
  const projectCandidateTitle = normalizeProjectKey(contract.title || '');
  const existingProjects = await getProjectsAsync().catch(() => []);
  const duplicate = existingProjects.find((project) => {
    const codeMatch = project.codigo ? normalizeProjectKey(project.codigo) === projectCandidateCode : false;
    const titleMatch = project.nome ? normalizeProjectKey(project.nome) === projectCandidateTitle : false;
    return codeMatch || (titleMatch && projectCandidateTitle.length > 0);
  });
  if (duplicate) {
    throw new Error(`Já existe um projeto semelhante (${duplicate.codigo ?? duplicate.nome}). Vincule o projeto existente em vez de criar um novo.`);
  }

  const { user, organizationId } = await getCurrentIdentity();
  const projectCode = contract.contract_number || `CTR-${contract.id.slice(0, 8).toUpperCase()}`;
  const createdProject = await createProject({
    nome: contract.title,
    codigo: projectCode,
    cliente: contract.counterparty_name || undefined,
    descricao: contract.scope_summary || `Projeto criado a partir do contrato ${contract.title}.`,
    status: 'planejamento',
    comite_status: 'ativo',
    responsavel: {
      id: user.id,
      nome: user.user_metadata?.full_name || user.email || 'Usuario autenticado',
      email: user.email || '',
      avatarUrl: user.user_metadata?.avatar_url || '',
      papelPrincipal: 'gerenteProjeto',
      full_name: user.user_metadata?.full_name,
    },
    impacto_financeiro:
      toNumber(contract.total_value) >= 5_000_000 ? 'critico'
        : toNumber(contract.total_value) >= 800_000 ? 'alto'
          : toNumber(contract.total_value) > 0 ? 'medio'
            : 'baixo',
    valor_total: toNumber(contract.total_value),
    valor_executado: 0,
    progresso_percentual: 0,
    data_inicio: contract.start_date || contract.signed_date || undefined,
    data_fim: contract.end_date || undefined,
    tipo: contract.contract_type || 'Contrato',
    risco_geral: contract.risk_level === 'high' ? 'alto' : contract.risk_level === 'low' ? 'baixo' : 'medio',
    codigoInterno: projectCode,
    comiteResponsavel: '',
  });

  await updateContract(contractId, {
    projectId: createdProject.id,
    lifecycleStage: 'project_created',
    status: contract.status === 'signed' ? 'active' : contract.status,
  });

  await logAuditEvent({
    organizationId,
    action: 'contract.project_created',
    entityType: 'contract',
    entityId: contractId,
    metadata: { project_id: createdProject.id },
  });

  return createdProject;
}

export async function listContractObligations(contractId: string): Promise<ContractObligationRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('contract_obligations').select('*').eq('contract_id', contractId).order('due_date');
  if (error) throw new Error(`Erro ao carregar obrigações: ${error.message}`);
  return (data ?? []) as ContractObligationRow[];
}

export async function createContractObligation(input: Omit<ContractObligationRow, 'id' | 'organization_id' | 'created_at' | 'updated_at' | 'completion_note' | 'completed_by' | 'completed_at'>): Promise<ContractObligationRow> {
  const { supabase, organizationId } = await getCurrentIdentity();
  const { data, error } = await supabase
    .from('contract_obligations')
    .insert({ ...input, organization_id: organizationId })
    .select('*')
    .single<ContractObligationRow>();
  if (error) throw new Error(`Erro ao criar obrigação: ${error.message}`);

  await logAuditEvent({
    organizationId,
    action: 'contract.obligation_created',
    entityType: 'contract',
    entityId: input.contract_id,
    metadata: { title: input.title, status: data.status, due_date: input.due_date },
  });

  await notifyContractRecipient(
    supabase,
    input.owner_user_id,
    'contract_obligation_assigned',
    'Nova obrigação contratual',
    `Você é responsável pela obrigação "${input.title}".`,
    input.contract_id,
  );

  return data;
}

export async function updateContractObligation(id: string, input: Partial<ContractObligationRow>): Promise<ContractObligationRow> {
  const { supabase, organizationId } = await getCurrentIdentity();
  const { data, error } = await supabase
    .from('contract_obligations')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single<ContractObligationRow>();
  if (error) throw new Error(`Erro ao atualizar obrigação: ${error.message}`);

  await logAuditEvent({
    organizationId,
    action: 'contract.obligation_updated',
    entityType: 'contract',
    entityId: data.contract_id,
    metadata: { obligation_id: id, status: data.status },
  });

  return data;
}

export async function completeContractObligation(id: string, note?: string | null): Promise<ContractObligationRow> {
  const { supabase, user, organizationId } = await getCurrentIdentity();
  const { data, error } = await supabase
    .from('contract_obligations')
    .update({
      status: 'done',
      completion_note: note ?? null,
      completed_by: user.id,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single<ContractObligationRow>();
  if (error) throw new Error(`Erro ao concluir obrigação: ${error.message}`);

  await logAuditEvent({
    organizationId,
    action: 'contract.obligation_completed',
    entityType: 'contract',
    entityId: data.contract_id,
    metadata: { obligation_id: id, title: data.title, note: note ?? null },
  });

  await notifyContractRecipient(
    supabase,
    await getContractOwnerId(supabase, data.contract_id),
    'contract_obligation_completed',
    'Obrigação concluída',
    `A obrigação "${data.title}" foi marcada como concluída.`,
    data.contract_id,
  );

  return data;
}

export async function createTaskFromObligation(contractId: string, obligationTitle: string, dueAt: string, assigneeUserId: string | null) {
  // Reuses the audited agenda helper. Tasks link to the contract; there is no
  // obligation FK on the tasks table (migration 031), so the obligation is
  // referenced in the task title/description for traceability.
  return createAgendaTaskForContract(
    contractId,
    `Obrigação: ${obligationTitle}`,
    `Tarefa gerada a partir da obrigação contratual "${obligationTitle}".`,
    dueAt,
    assigneeUserId,
  );
}

export type ContractRelatedTask = {
  id: string;
  title: string;
  due_at: string | null;
  status: string;
  priority: string;
};

/**
 * Agenda read-side: tasks linked to this contract via tasks.related_contract_id
 * (migration 031).
 *
 * Devolve `error` em vez de engolir a falha num `[]`: "nenhuma tarefa" e "não
 * consegui ler as tarefas" são afirmações diferentes, e a segunda não pode se
 * apresentar como a primeira na linha de operações conectadas. Mesma correção
 * aplicada a `fetchContractRelationsBatch` em P0.2.
 */
export async function listContractRelatedTasks(
  contractId: string,
): Promise<{ rows: ContractRelatedTask[]; error: string | null }> {
  const supabase = createClient();
  try {
    const { data, error } = await supabase
      .from('tasks')
      .select('id,title,due_at,status,priority')
      .eq('related_contract_id', contractId)
      .order('due_at', { ascending: true });
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []) as ContractRelatedTask[], error: null };
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : 'Falha ao ler as tarefas vinculadas.' };
  }
}

export async function listContractApprovals(contractId: string): Promise<ContractApprovalRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('contract_approvals').select('*').eq('contract_id', contractId).order('created_at');
  if (error) throw new Error(`Erro ao carregar aprovações: ${error.message}`);
  return (data ?? []) as ContractApprovalRow[];
}

export async function submitContractApproval(
  contractId: string,
  stepName: string,
  status: string,
  comments?: string | null,
  rejectionReason?: string | null,
  requestedChangesNote?: string | null,
): Promise<ContractApprovalRow> {
  const { supabase, user, organizationId } = await getCurrentIdentity();
  const now = new Date().toISOString();
  // Preserve the original started_at across upserts so step SLA is measured from
  // the first action, not the latest.
  const { data: existing } = await supabase
    .from('contract_approvals')
    .select('started_at')
    .eq('contract_id', contractId)
    .eq('step_name', stepName)
    .maybeSingle<{ started_at: string | null }>();
  const isTerminal = status === 'approved' || status === 'rejected';
  const { data, error } = await supabase
    .from('contract_approvals')
    .upsert({
      organization_id: organizationId,
      contract_id: contractId,
      step_name: stepName,
      status,
      reviewer_user_id: user.id,
      comments,
      rejection_reason: rejectionReason,
      requested_changes_note: requestedChangesNote ?? null,
      approval_timestamp: status === 'approved' ? now : null,
      started_at: existing?.started_at ?? now,
      completed_at: isTerminal ? now : null,
      updated_at: now,
    }, { onConflict: 'contract_id,step_name' })
    .select('*')
    .single<ContractApprovalRow>();
  if (error) throw new Error(`Erro ao salvar aprovação: ${error.message}`);

  await logAuditEvent({
    organizationId,
    action: `contract.approval.${stepName}.${status}`,
    entityType: 'contract',
    entityId: contractId,
    metadata: { reviewer: user.email, comments },
  });

  await notifyContractRecipient(
    supabase,
    await getContractOwnerId(supabase, contractId),
    'contract_approval_decision',
    'Decisão de aprovação',
    `Etapa ${stepName}: ${status}${rejectionReason ? ` — ${rejectionReason}` : ''}.`,
    contractId,
  );

  return data;
}

/** Request changes on an approval step: keeps the step under review + records the note. */
export async function requestContractApprovalChanges(contractId: string, stepName: string, note: string): Promise<ContractApprovalRow> {
  const row = await submitContractApproval(contractId, stepName, 'under_review', note, null, note);
  const { organizationId } = await getCurrentIdentity();
  await logAuditEvent({
    organizationId,
    action: 'contract.changes_requested',
    entityType: 'contract',
    entityId: contractId,
    metadata: { step: stepName, note },
  });
  return row;
}

export type ApprovalStep = 'juridico' | 'financeiro' | 'comite' | 'diretoria';

export type ApprovalSlaResult = {
  avgHours: number | null;
  byStep: Partial<Record<ApprovalStep, number | null>>;
  openStepHours: number | null;
  openStepName: ApprovalStep | null;
  overdueSteps: number;
  rejectedSteps: number;
  blocked: boolean;
  quality: 'live' | 'estimated';
};

/**
 * Step-level approval SLA from contract_approvals. Prefers completed_at, falls
 * back to approval_timestamp (approved) for the end, and started_at→created_at
 * for the start. `quality` is 'live' only when at least one terminal step has a
 * real completed_at/approval_timestamp; otherwise it is 'estimated'.
 */
export function computeApprovalSla(approvals: ContractApprovalRow[], now: Date = new Date()): ApprovalSlaResult {
  const hoursBetween = (start: string | null, end: string | null): number | null => {
    if (!start || !end) return null;
    const ms = new Date(end).getTime() - new Date(start).getTime();
    return Number.isFinite(ms) && ms >= 0 ? ms / 3_600_000 : null;
  };

  const byStep: Partial<Record<ApprovalStep, number | null>> = {};
  const durations: number[] = [];
  let hasRealEnd = false;
  let openStepHours: number | null = null;
  let openStepName: ApprovalStep | null = null;
  let overdueSteps = 0;
  let rejectedSteps = 0;

  for (const a of approvals) {
    const start = a.started_at ?? a.created_at;
    const isTerminal = a.status === 'approved' || a.status === 'rejected';
    const end = a.completed_at ?? (a.status === 'approved' ? a.approval_timestamp : null);
    if (isTerminal) {
      const d = hoursBetween(start, end ?? a.updated_at);
      byStep[a.step_name] = d;
      if (d != null) durations.push(d);
      if (a.completed_at || (a.status === 'approved' && a.approval_timestamp)) hasRealEnd = true;
      if (a.status === 'rejected') rejectedSteps += 1;
    } else {
      byStep[a.step_name] = null;
      const d = hoursBetween(start, now.toISOString());
      if (d != null && (openStepHours == null || d > openStepHours)) {
        openStepHours = d;
        openStepName = a.step_name;
      }
    }
    if (a.deadline_date && a.status !== 'approved') {
      const overdue = new Date(a.deadline_date).getTime() < now.getTime();
      if (overdue) overdueSteps += 1;
    }
  }

  const avgHours = durations.length ? Math.round(durations.reduce((s, h) => s + h, 0) / durations.length) : null;
  return {
    avgHours,
    byStep,
    openStepHours: openStepHours != null ? Math.round(openStepHours) : null,
    openStepName,
    overdueSteps,
    rejectedSteps,
    blocked: rejectedSteps > 0 || overdueSteps > 0,
    quality: hasRealEnd ? 'live' : 'estimated',
  };
}

export async function listContractProjectLinks(contractId: string): Promise<ContractProjectLinkRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('contract_project_links').select('*').eq('contract_id', contractId);
  if (error) throw new Error(`Erro ao carregar vínculos de projeto: ${error.message}`);
  return (data ?? []) as ContractProjectLinkRow[];
}

export async function linkContractToProject(contractId: string, projectId: string): Promise<ContractProjectLinkRow> {
  const { supabase, organizationId } = await getCurrentIdentity();
  const { data, error } = await supabase
    .from('contract_project_links')
    .insert({
      organization_id: organizationId,
      contract_id: contractId,
      project_id: projectId
    })
    .select('*')
    .single<ContractProjectLinkRow>();
  if (error) throw new Error(`Erro ao vincular projeto: ${error.message}`);

  await logAuditEvent({
    organizationId,
    action: 'contract.linked_project',
    entityType: 'contract',
    entityId: contractId,
    metadata: { project_id: projectId },
  });

  await notifyContractRecipient(
    supabase,
    await getContractOwnerId(supabase, contractId),
    'contract_project_linked',
    'Projeto vinculado',
    'Um projeto foi vinculado ao contrato.',
    contractId,
  );

  return data;
}

export async function unlinkContractFromProject(contractId: string, projectId: string): Promise<void> {
  const { supabase, organizationId } = await getCurrentIdentity();
  const { error } = await supabase
    .from('contract_project_links')
    .delete()
    .eq('contract_id', contractId)
    .eq('project_id', projectId);
  if (error) throw new Error(`Erro ao desvincular projeto: ${error.message}`);

  await logAuditEvent({
    organizationId,
    action: 'contract.unlinked_project',
    entityType: 'contract',
    entityId: contractId,
    metadata: { project_id: projectId },
  });
}

export async function listContractRisksLinks(contractId: string): Promise<ContractRiskLinkRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('contract_risks_links').select('*').eq('contract_id', contractId);
  if (error) throw new Error(`Erro ao carregar vínculos de risco: ${error.message}`);
  return (data ?? []) as ContractRiskLinkRow[];
}

export async function linkContractToRisk(contractId: string, riskId: string): Promise<ContractRiskLinkRow> {
  const { supabase, organizationId } = await getCurrentIdentity();
  const { data, error } = await supabase
    .from('contract_risks_links')
    .insert({
      organization_id: organizationId,
      contract_id: contractId,
      risk_id: riskId
    })
    .select('*')
    .single<ContractRiskLinkRow>();
  if (error) throw new Error(`Erro ao vincular risco: ${error.message}`);

  await logAuditEvent({
    organizationId,
    action: 'contract.linked_risk',
    entityType: 'contract',
    entityId: contractId,
    metadata: { risk_id: riskId },
  });

  await notifyContractRecipient(
    supabase,
    await getContractOwnerId(supabase, contractId),
    'contract_risk_linked',
    'Risco vinculado',
    'Um risco existente foi vinculado ao contrato.',
    contractId,
  );

  return data;
}

export async function unlinkContractFromRisk(contractId: string, riskId: string): Promise<void> {
  const { supabase, organizationId } = await getCurrentIdentity();
  const { error } = await supabase
    .from('contract_risks_links')
    .delete()
    .eq('contract_id', contractId)
    .eq('risk_id', riskId);
  if (error) throw new Error(`Erro ao desvincular risco: ${error.message}`);

  await logAuditEvent({
    organizationId,
    action: 'contract.unlinked_risk',
    entityType: 'contract',
    entityId: contractId,
    metadata: { risk_id: riskId },
  });
}

export async function listContractDocuments(contractId: string): Promise<ContractDocumentRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('contract_documents').select('*').eq('contract_id', contractId).order('created_at', { ascending: false });
  if (error) throw new Error(`Erro ao carregar documentos: ${error.message}`);
  return (data ?? []) as ContractDocumentRow[];
}

export async function uploadContractDocument(contractId: string, title: string, file: File, documentType: string): Promise<ContractDocumentRow> {
  const { supabase, user, organizationId } = await getCurrentIdentity();
  const safeName = sanitizeFileName(file.name);
  const filePath = `${organizationId}/${contractId}/docs/${crypto.randomUUID()}-${safeName}`;
  const { error: uploadError } = await supabase.storage.from(CONTRACT_FILES_BUCKET).upload(filePath, file, { upsert: false });
  if (uploadError) throw new Error(`Erro ao enviar documento: ${uploadError.message}`);

  const { data, error } = await supabase
    .from('contract_documents')
    .insert({
      organization_id: organizationId,
      contract_id: contractId,
      title,
      file_path: filePath,
      document_type: documentType,
      status: 'uploaded',
      uploaded_by: user.id
    })
    .select('*')
    .single<ContractDocumentRow>();

  if (error) throw new Error(`Erro ao registrar documento: ${error.message}`);

  await logAuditEvent({
    organizationId,
    action: 'contract.document_uploaded',
    entityType: 'contract',
    entityId: contractId,
    metadata: { title, file_name: file.name, document_type: documentType },
  });

  await notifyContractRecipient(
    supabase,
    await getContractOwnerId(supabase, contractId),
    'contract_document_uploaded',
    'Documento anexado',
    `Documento "${title}" (${documentType}) anexado ao contrato.`,
    contractId,
  );

  return data;
}

export async function updateContractDocumentStatus(
  id: string,
  status: ContractDocumentStatus,
  reason?: string | null,
): Promise<ContractDocumentRow> {
  const { supabase, user, organizationId } = await getCurrentIdentity();
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === 'approved') {
    patch.approved_at = new Date().toISOString();
    patch.approved_by = user.id;
    patch.rejection_reason = null;
  }
  if (status === 'rejected') {
    patch.rejection_reason = reason ?? null;
    patch.approved_at = null;
    patch.approved_by = null;
  }
  const { data, error } = await supabase
    .from('contract_documents')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single<ContractDocumentRow>();
  if (error) throw new Error(`Erro ao atualizar status do documento: ${error.message}`);

  await logAuditEvent({
    organizationId,
    action: status === 'approved' ? 'contract.document_approved' : status === 'rejected' ? 'contract.document_rejected' : 'contract.document_status_changed',
    entityType: 'contract',
    entityId: data.contract_id,
    metadata: { document_id: id, new_status: status, reason: reason ?? null },
  });

  await notifyContractRecipient(
    supabase,
    await getContractOwnerId(supabase, data.contract_id),
    status === 'approved' ? 'contract_document_approved' : status === 'rejected' ? 'contract_document_rejected' : 'contract_document_pending_approval',
    status === 'approved' ? 'Documento aprovado' : status === 'rejected' ? 'Documento rejeitado' : 'Documento em aprovação',
    `Documento "${data.title}" — ${status}${reason ? `: ${reason}` : ''}.`,
    data.contract_id,
  );

  return data;
}

export async function createAgendaTaskForContract(contractId: string, title: string, description: string, dueAt: string, assigneeUserId: string | null): Promise<any> {
  const { organizationId } = await getCurrentIdentity();
  
  // Call the createTask function from agenda service
  const { createTask } = await import('@/lib/services/agenda');
  
  const createdTask = await createTask({
    title,
    description,
    dueAt,
    priority: 'medium',
    assigneeUserId,
    relatedContractId: contractId,
    dueAllDay: false
  });

  await logAuditEvent({
    organizationId,
    action: 'contract.agenda_task_created',
    entityType: 'contract',
    entityId: contractId,
    metadata: { task_id: createdTask.id, title },
  });

  return createdTask;
}

export async function createRiskFromContract(contractId: string, title: string, category: string, probability: number, impact: number, mitigationPlan?: string): Promise<any> {
  const { supabase, user, organizationId } = await getCurrentIdentity();
  
  const severity = probability * impact >= 16 ? 'critical' : probability * impact >= 12 ? 'high' : probability * impact >= 6 ? 'medium' : 'low';
  
  const { data, error } = await supabase
    .from('risks')
    .insert({
      organization_id: organizationId,
      title,
      category,
      probability,
      impact,
      severity,
      origin: 'contract',
      reference_id: contractId,
      reference_name: 'Vínculo contratual',
      status: 'open',
      mitigation_plan: mitigationPlan || null,
      created_by: user.id
    })
    .select('*')
    .single();

  if (error) throw new Error(`Erro ao criar risco a partir do contrato: ${error.message}`);

  // Also create a link in the contract_risks_links table
  await linkContractToRisk(contractId, data.id);

  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — batched relation reads for the Contract Control Room list view.
// All per-contract read helpers above are 1:1 with a single contract; the list
// page needs the same data for N contracts at once. These helpers issue one
// `.in('contract_id', ids)` query per relation (no N+1) and group the rows by
// contract_id. Every query is resilient: a failure/absent table yields an empty
// map for that section instead of throwing, so one missing relation never blanks
// the page. RLS still scopes rows to the caller's organization.
// ─────────────────────────────────────────────────────────────────────────────

export type ContractRiskDetail = {
  id: string;
  title: string;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: string;
  level: number;
  mitigationPlan: string | null;
};

export type ContractRelationsBatch = {
  obligations: Map<string, ContractObligationRow[]>;
  billingEvents: Map<string, ContractBillingEventRow[]>;
  documents: Map<string, ContractDocumentRow[]>;
  approvals: Map<string, ContractApprovalRow[]>;
  projectLinks: Map<string, ContractProjectLinkRow[]>;
  riskLinks: Map<string, ContractRiskLinkRow[]>;
  aiAnalyses: Map<string, ContractAiAnalysisRow[]>;
  // P2B: os dois domínios que passaram a ter caminho de escrita.
  milestones: Map<string, ContractMilestoneRow[]>;
  clauses: Map<string, ContractClauseRow[]>;
  penalties: Map<string, ContractPenaltyRow[]>;
  riskDetails: Map<string, ContractRiskDetail>;
  /** True when at least one live row was returned for that relation across all contracts. */
  sectionsWithData: {
    obligations: boolean;
    billing: boolean;
    documents: boolean;
    approvals: boolean;
    projectLinks: boolean;
    risks: boolean;
    ai: boolean;
    milestones: boolean;
    clauses: boolean;
    penalties: boolean;
  };
  /**
   * Mensagem de erro por seção, ou `null` quando a consulta teve sucesso.
   *
   * Existe porque `sectionsWithData: false` é ambíguo: significa tanto "a
   * consulta rodou e o contrato não tem linhas" quanto "a consulta falhou".
   * `applyLiveGovernanceData` trata os dois como `'estimated'` e substitui por
   * dado sintético — ou seja, uma negativa de RLS ou uma queda de rede fazia a
   * tela e o PDF apresentarem números fabricados como se fossem apurados.
   *
   * Uma seção com erro NÃO é uma seção vazia. Quem consome deve distinguir.
   */
  sectionErrors: ContractRelationErrors;
};

export type ContractRelationSectionKey =
  | 'obligations'
  | 'billing'
  | 'documents'
  | 'approvals'
  | 'projectLinks'
  | 'risks'
  | 'ai'
  | 'milestones'
  | 'clauses'
  | 'penalties';

export type ContractRelationErrors = Record<ContractRelationSectionKey, string | null>;

/** Rótulos em pt-BR das seções, para as mensagens de erro. */
const RELATION_SECTION_LABELS: Record<ContractRelationSectionKey, string> = {
  obligations: 'obrigações',
  billing: 'faturamento',
  documents: 'documentos',
  approvals: 'aprovações',
  projectLinks: 'vínculos de projeto',
  risks: 'riscos',
  ai: 'análises de IA',
  milestones: 'marcos',
  clauses: 'cláusulas',
  penalties: 'penalidades',
};

function noRelationErrors(): ContractRelationErrors {
  return {
    obligations: null,
    billing: null,
    documents: null,
    approvals: null,
    projectLinks: null,
    risks: null,
    ai: null,
    milestones: null,
    clauses: null,
    penalties: null,
  };
}

/**
 * Nomes das seções cuja consulta falhou. Função pura — ponto testável.
 */
export function failedRelationSections(errors: ContractRelationErrors): ContractRelationSectionKey[] {
  return (Object.keys(RELATION_SECTION_LABELS) as ContractRelationSectionKey[]).filter(
    (key) => errors[key] !== null,
  );
}

/**
 * Mensagem única descrevendo as falhas de leitura, ou `null` se tudo leu bem.
 *
 * O indicador de fonte da página já sabe renderizar `governance.error` como
 * "Dados estimados"; até agora esse estado era inalcançável em falha parcial,
 * porque cada consulta engolia o próprio erro e devolvia `[]`.
 */
export function describeRelationErrors(batch: ContractRelationsBatch): string | null {
  const failed = failedRelationSections(batch.sectionErrors);
  if (failed.length === 0) return null;

  const labels = failed.map((key) => RELATION_SECTION_LABELS[key]).join(', ');
  return failed.length === 1
    ? `Falha ao ler ${labels} no Supabase — a seção não pode ser considerada apurada.`
    : `Falha ao ler ${failed.length} seções no Supabase (${labels}) — não podem ser consideradas apuradas.`;
}

function groupByContract<T extends { contract_id: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = map.get(row.contract_id);
    if (bucket) bucket.push(row);
    else map.set(row.contract_id, [row]);
  }
  return map;
}

function emptyRelationsBatch(): ContractRelationsBatch {
  return {
    obligations: new Map(),
    billingEvents: new Map(),
    documents: new Map(),
    approvals: new Map(),
    projectLinks: new Map(),
    riskLinks: new Map(),
    aiAnalyses: new Map(),
    milestones: new Map(),
    clauses: new Map(),
    penalties: new Map(),
    riskDetails: new Map(),
    sectionsWithData: {
      obligations: false,
      billing: false,
      documents: false,
      approvals: false,
      projectLinks: false,
      risks: false,
      ai: false,
      milestones: false,
      clauses: false,
      penalties: false,
    },
    sectionErrors: noRelationErrors(),
  };
}

export type ContractAuditEventRow = {
  id: string;
  action: string;
  actor_user_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

/**
 * Histórico real do contrato, lido de `audit_logs`.
 *
 * `logAuditEvent` grava ali desde a Fase 3 — 23 ações distintas de contrato —
 * e até agora NINGUÉM lia: a aba "Auditoria" e o dossiê mostravam três eventos
 * fabricados pelo enricher, incluindo um ator chamado "INSIGHT AI" que nunca
 * existiu.
 *
 * Devolve `null` em falha para que o chamador distinga erro de ausência, em vez
 * de um `[]` ambíguo.
 */
export async function listContractAuditEvents(
  contractId: string,
  limit = 50,
): Promise<{ rows: ContractAuditEventRow[]; error: string | null }> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('audit_logs')
    .select('id,action,actor_user_id,metadata,created_at')
    .eq('entity_type', 'contract')
    .eq('entity_id', contractId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as ContractAuditEventRow[], error: null };
}

/**
 * Contagens cross-módulo da carteira, para o Command Center.
 *
 * Consulta os módulos DONOS de cada domínio — `tasks` e `audit_logs` — em vez
 * de manter cópia dentro de Contratos. Devolve `null` em falha para que o
 * painel distinga "não foi possível ler" de "não há".
 */
export async function fetchPortfolioLinkCounts(
  contractIds: string[],
): Promise<{ linkedTasks: number | null; auditEvents: number | null }> {
  const ids = Array.from(new Set(contractIds)).filter(Boolean);
  if (ids.length === 0) return { linkedTasks: 0, auditEvents: 0 };

  const supabase = createClient();

  const [tasks, audit] = await Promise.all([
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .in('related_contract_id', ids)
      .then((r) => (r.error ? null : r.count ?? 0), () => null),
    supabase
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('entity_type', 'contract')
      .in('entity_id', ids)
      .then((r) => (r.error ? null : r.count ?? 0), () => null),
  ]);

  return { linkedTasks: tasks, auditEvents: audit };
}

export async function fetchContractRelationsBatch(contractIds: string[]): Promise<ContractRelationsBatch> {
  const ids = Array.from(new Set(contractIds)).filter(Boolean);
  if (ids.length === 0) return emptyRelationsBatch();

  const supabase = createClient();
  // Uma falha isolada nunca deixa a página em branco — mas TAMBÉM não pode se
  // disfarçar de "sem dado". `safe` devolve as linhas e o erro separadamente;
  // quem chama decide o que fazer com cada caso.
  const safe = async <T>(
    builder: PromiseLike<{ data: unknown; error: unknown }>,
  ): Promise<{ rows: T[]; error: string | null }> => {
    try {
      const { data, error } = await builder;
      if (error) {
        const message =
          typeof error === 'object' && error !== null && 'message' in error
            ? String((error as { message: unknown }).message)
            : 'erro desconhecido';
        return { rows: [], error: message };
      }
      return { rows: (data ?? []) as T[], error: null };
    } catch (err) {
      return { rows: [], error: err instanceof Error ? err.message : 'erro desconhecido' };
    }
  };

  const [obligations, billingEvents, documents, approvals, projectLinks, riskLinks, aiAnalyses, milestones, clauses, penalties] = await Promise.all([
    safe<ContractObligationRow>(supabase.from('contract_obligations').select('*').in('contract_id', ids)),
    safe<ContractBillingEventRow>(supabase.from('contract_billing_events').select('*').in('contract_id', ids)),
    safe<ContractDocumentRow>(supabase.from('contract_documents').select('*').in('contract_id', ids)),
    safe<ContractApprovalRow>(supabase.from('contract_approvals').select('*').in('contract_id', ids)),
    safe<ContractProjectLinkRow>(supabase.from('contract_project_links').select('*').in('contract_id', ids)),
    safe<ContractRiskLinkRow>(supabase.from('contract_risks_links').select('*').in('contract_id', ids)),
    safe<ContractAiAnalysisRow>(supabase.from('contract_ai_analyses').select('*').in('contract_id', ids)),
    // P2B: marcos e cláusulas entram no batch porque agora têm caminho de
    // escrita — antes, buscá-los era custo de rede para confirmar um vazio.
    safe<ContractMilestoneRow>(supabase.from('contract_milestones').select('*').in('contract_id', ids)),
    safe<ContractClauseRow>(supabase.from('contract_clauses').select('*').in('contract_id', ids)),
    // Penalidades: a RLS de 006 exige `contracts.view_penalties` para LER.
    // Sem a permissão o retorno é vazio e sem erro — indistinguível de "não
    // há penalidade". Quem consome precisa dizer isso ao usuário.
    safe<ContractPenaltyRow>(supabase.from('contract_penalties').select('*').in('contract_id', ids)),
  ]);

  const riskIds = Array.from(new Set(riskLinks.rows.map((link) => link.risk_id))).filter(Boolean);
  const riskDetailFetch = riskIds.length
    ? await safe<{ id: string; title: string | null; category: string | null; severity: string | null; status: string | null; level: number | string | null; mitigation_plan: string | null }>(
        supabase.from('risks').select('id,title,category,severity,status,level,mitigation_plan').in('id', riskIds),
      )
    : { rows: [], error: null };
  const riskRows = riskDetailFetch.rows;

  const riskDetails = new Map<string, ContractRiskDetail>();
  for (const row of riskRows) {
    const severity = (['low', 'medium', 'high', 'critical'] as const).includes(row.severity as never)
      ? (row.severity as ContractRiskDetail['severity'])
      : 'medium';
    riskDetails.set(row.id, {
      id: row.id,
      title: row.title ?? 'Risco vinculado',
      category: row.category ?? 'Geral',
      severity,
      status: row.status ?? 'open',
      level: toNumber(row.level),
      mitigationPlan: row.mitigation_plan ?? null,
    });
  }

  return {
    obligations: groupByContract(obligations.rows),
    billingEvents: groupByContract(billingEvents.rows),
    documents: groupByContract(documents.rows),
    approvals: groupByContract(approvals.rows),
    projectLinks: groupByContract(projectLinks.rows),
    riskLinks: groupByContract(riskLinks.rows),
    aiAnalyses: groupByContract(aiAnalyses.rows),
    milestones: groupByContract(milestones.rows),
    clauses: groupByContract(clauses.rows),
    penalties: groupByContract(penalties.rows),
    riskDetails,
    sectionsWithData: {
      obligations: obligations.rows.length > 0,
      billing: billingEvents.rows.length > 0,
      documents: documents.rows.length > 0,
      approvals: approvals.rows.length > 0,
      projectLinks: projectLinks.rows.length > 0,
      risks: riskLinks.rows.length > 0,
      ai: aiAnalyses.rows.length > 0,
      milestones: milestones.rows.length > 0,
      clauses: clauses.rows.length > 0,
      penalties: penalties.rows.length > 0,
    },
    sectionErrors: {
      obligations: obligations.error,
      billing: billingEvents.error,
      documents: documents.error,
      approvals: approvals.error,
      projectLinks: projectLinks.error,
      // A seção de riscos depende de duas consultas: os vínculos e o detalhe em
      // `risks`. Falha em qualquer uma torna a seção não apurada.
      risks: riskLinks.error ?? riskDetailFetch.error,
      ai: aiAnalyses.error,
      milestones: milestones.error,
      clauses: clauses.error,
      penalties: penalties.error,
    },
  };
}
