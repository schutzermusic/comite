'use client';

import type { Contract } from '@/lib/types';
import { logAuditEvent } from '@/lib/audit/log-audit-event';
import { createProject } from '@/lib/services/projects';
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

export type ContractDetail = {
  contract: ContractRow;
  clauses: ContractClauseRow[];
  penalties: ContractPenaltyRow[];
  milestones: ContractMilestoneRow[];
  billingEvents: ContractBillingEventRow[];
  risks: ContractRiskRow[];
  files: ContractFileRow[];
  aiAnalyses: ContractAiAnalysisRow[];
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

  const [clauses, penalties, milestones, billingEvents, risks, files, aiAnalyses] = await Promise.all([
    listContractClauses(contractId),
    listContractPenalties(contractId),
    listContractMilestones(contractId),
    listContractBillingEvents(contractId),
    listContractRisks(contractId),
    listContractFiles(contractId),
    listContractAiAnalyses(contractId),
  ]);

  return { contract, clauses, penalties, milestones, billingEvents, risks, files, aiAnalyses };
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
