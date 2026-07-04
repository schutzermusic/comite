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
};

export type ContractClauseRow = {
  id: string;
  organization_id: string;
  contract_id: string;
  clause_type: string | null;
  title: string;
  content: string | null;
  risk_level: RiskLevel;
  ai_flagged: boolean;
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
  trigger_condition: string | null;
  deadline_date: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

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
  status: string;
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

export type ContractAiAnalysisRow = {
  id: string;
  organization_id: string;
  contract_id: string;
  status: string;
  summary: string | null;
  risk_summary: string | null;
  extracted_data: Record<string, unknown>;
  findings: unknown[];
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
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
};

export type UpdateContractInput = Partial<Omit<CreateContractInput, 'file' | 'aiPlaceholderRequested'>>;

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

export async function updateContract(contractId: string, input: UpdateContractInput): Promise<ContractRow> {
  const { supabase, user, organizationId } = await getCurrentIdentity();
  const { data, error } = await supabase
    .from('contracts')
    .update({
      project_id: input.projectId,
      title: input.title,
      contract_number: input.contractNumber,
      counterparty_name: input.counterpartyName,
      contract_type: input.contractType,
      status: input.status,
      lifecycle_stage: input.lifecycleStage,
      start_date: input.startDate,
      end_date: input.endDate,
      signed_date: input.signedDate,
      renewal_date: input.renewalDate,
      currency: input.currency,
      total_value: input.totalValue,
      monthly_value: input.monthlyValue,
      payment_terms: input.paymentTerms,
      scope_summary: input.scopeSummary,
      risk_level: input.riskLevel,
      health_score: input.healthScore,
      owner_user_id: input.ownerUserId,
      updated_by: user.id,
    })
    .eq('id', contractId)
    .select('*')
    .single<ContractRow>();

  if (error) throw new Error(`Erro ao atualizar contrato: ${error.message}`);

  await logAuditEvent({
    organizationId,
    action: 'contract.updated',
    entityType: 'contract',
    entityId: contractId,
    metadata: { fields: Object.keys(input) },
  });

  return data;
}

export async function softDeleteContract(contractId: string): Promise<void> {
  const { supabase, organizationId } = await getCurrentIdentity();
  const { error } = await supabase
    .from('contracts')
    .delete()
    .eq('id', contractId);

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
 * (migration 031). Best-effort — returns [] if the column/table is unavailable
 * so the drawer never breaks when agenda linking is not present.
 */
export async function listContractRelatedTasks(contractId: string): Promise<ContractRelatedTask[]> {
  const supabase = createClient();
  try {
    const { data, error } = await supabase
      .from('tasks')
      .select('id,title,due_at,status,priority')
      .eq('related_contract_id', contractId)
      .order('due_at', { ascending: true });
    if (error) return [];
    return (data ?? []) as ContractRelatedTask[];
  } catch {
    return [];
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
  };
};

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
    riskDetails: new Map(),
    sectionsWithData: {
      obligations: false,
      billing: false,
      documents: false,
      approvals: false,
      projectLinks: false,
      risks: false,
      ai: false,
    },
  };
}

export async function fetchContractRelationsBatch(contractIds: string[]): Promise<ContractRelationsBatch> {
  const ids = Array.from(new Set(contractIds)).filter(Boolean);
  if (ids.length === 0) return emptyRelationsBatch();

  const supabase = createClient();
  // Each query returns [] on error/absent table so one failure never blanks the page.
  const safe = async <T>(builder: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> => {
    try {
      const { data, error } = await builder;
      if (error) return [];
      return (data ?? []) as T[];
    } catch {
      return [];
    }
  };

  const [obligations, billingEvents, documents, approvals, projectLinks, riskLinks, aiAnalyses] = await Promise.all([
    safe<ContractObligationRow>(supabase.from('contract_obligations').select('*').in('contract_id', ids)),
    safe<ContractBillingEventRow>(supabase.from('contract_billing_events').select('*').in('contract_id', ids)),
    safe<ContractDocumentRow>(supabase.from('contract_documents').select('*').in('contract_id', ids)),
    safe<ContractApprovalRow>(supabase.from('contract_approvals').select('*').in('contract_id', ids)),
    safe<ContractProjectLinkRow>(supabase.from('contract_project_links').select('*').in('contract_id', ids)),
    safe<ContractRiskLinkRow>(supabase.from('contract_risks_links').select('*').in('contract_id', ids)),
    safe<ContractAiAnalysisRow>(supabase.from('contract_ai_analyses').select('*').in('contract_id', ids)),
  ]);

  const riskIds = Array.from(new Set(riskLinks.map((link) => link.risk_id))).filter(Boolean);
  const riskRows = riskIds.length
    ? await safe<{ id: string; title: string | null; category: string | null; severity: string | null; status: string | null; level: number | string | null; mitigation_plan: string | null }>(
        supabase.from('risks').select('id,title,category,severity,status,level,mitigation_plan').in('id', riskIds),
      )
    : [];

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
    obligations: groupByContract(obligations),
    billingEvents: groupByContract(billingEvents),
    documents: groupByContract(documents),
    approvals: groupByContract(approvals),
    projectLinks: groupByContract(projectLinks),
    riskLinks: groupByContract(riskLinks),
    aiAnalyses: groupByContract(aiAnalyses),
    riskDetails,
    sectionsWithData: {
      obligations: obligations.length > 0,
      billing: billingEvents.length > 0,
      documents: documents.length > 0,
      approvals: approvals.length > 0,
      projectLinks: projectLinks.length > 0,
      risks: riskLinks.length > 0,
      ai: aiAnalyses.length > 0,
    },
  };
}
