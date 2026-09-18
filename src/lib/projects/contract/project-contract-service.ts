/**
 * Lê a projeção contrato→projeto das visões da migration 175.
 *
 * Não copia valor para o JSONB do projeto. Quem precisa de dinheiro contratual
 * consulta aqui; a tela não inventa uma segunda verdade editável.
 *
 * Fallback: se a visão financeira não devolver linha (RLS/cache), lê
 * `contracts.total_value` pelo vínculo — ainda é a verdade do contrato, não
 * uma cópia no projeto.
 */

import { createClient } from '@/utils/supabase/client';
import {
  toProjectContractFinancial,
  toProjectContractMilestone,
  type ProjectContractFinancial,
  type ProjectContractMilestone,
} from './project-contract-types';

export class ProjectContractProjectionError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'ProjectContractProjectionError';
  }
}

export interface ProjectContractProjection {
  readonly financial: ProjectContractFinancial | null;
  readonly milestones: readonly ProjectContractMilestone[];
}

/** Projeção de um projeto: cabeçalho financeiro + marcos, ou vazio se sem vínculo. */
export async function getProjectContractProjection(
  projectId: string,
): Promise<ProjectContractProjection> {
  const supabase = createClient();

  const [finRes, msRes] = await Promise.all([
    supabase
      .from('project_contract_financial_read_model')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle(),
    supabase
      .from('project_contract_milestone_read_model')
      .select('*')
      .eq('project_id', projectId)
      .order('title', { ascending: true }),
  ]);

  if (finRes.error && finRes.error.code !== 'PGRST116') {
    const fallback = await loadFinancialFromContractLink(supabase, projectId);
    if (fallback) return { financial: fallback, milestones: [] };
    throw new ProjectContractProjectionError(finRes.error.message, finRes.error);
  }
  if (msRes.error && msRes.error.code !== 'PGRST116') {
    if (finRes.data) {
      return { financial: toProjectContractFinancial(finRes.data), milestones: [] };
    }
    const fallback = await loadFinancialFromContractLink(supabase, projectId);
    if (fallback) return { financial: fallback, milestones: [] };
    throw new ProjectContractProjectionError(msRes.error.message, msRes.error);
  }

  if (finRes.data) {
    return {
      financial: toProjectContractFinancial(finRes.data),
      milestones: (msRes.data ?? []).map(toProjectContractMilestone),
    };
  }

  const fallback = await loadFinancialFromContractLink(supabase, projectId);
  return {
    financial: fallback,
    milestones: (msRes.data ?? []).map(toProjectContractMilestone),
  };
}

/**
 * Valor do cabeçalho do contrato vinculado — mesma fonte que o Trust Layer.
 * Não inventa direito, marco nem faturamento.
 */
async function loadFinancialFromContractLink(
  supabase: ReturnType<typeof createClient>,
  projectId: string,
): Promise<ProjectContractFinancial | null> {
  const { data: byColumn } = await supabase
    .from('contracts')
    .select('id, organization_id, contract_number, title, status, counterparty_name, currency, start_date, end_date, signed_date, total_value, project_id, created_at')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let row = byColumn;
  if (!row) {
    const { data: link } = await supabase
      .from('contract_project_links')
      .select('contract_id, organization_id, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!link) return null;
    const { data: linked } = await supabase
      .from('contracts')
      .select('id, organization_id, contract_number, title, status, counterparty_name, currency, start_date, end_date, signed_date, total_value, project_id, created_at')
      .eq('id', link.contract_id)
      .is('deleted_at', null)
      .maybeSingle();
    row = linked;
  }
  if (!row) return null;

  return toProjectContractFinancial({
    organization_id: row.organization_id,
    project_id: projectId,
    contract_id: row.id,
    link_source: row.project_id === projectId ? 'contracts.project_id' : 'contract_project_links',
    linked_at: row.created_at ?? null,
    contract_number: row.contract_number,
    contract_title: row.title,
    contract_status: row.status,
    counterparty_name: row.counterparty_name,
    currency: row.currency,
    start_date: row.start_date,
    end_date: row.end_date,
    signed_date: row.signed_date,
    contract_value: row.total_value,
    entitlement_total: null,
    entitlement_rule_count: 0,
    milestone_count: 0,
    reconciliation_delta: null,
    measured_total: null,
    accepted_total: null,
    billed_event_count: 0,
    governed_mapped_milestone_count: 0,
  });
}

/**
 * Valor a EXIBIR para um projeto: JSONB do projeto se > 0; senão o cabeçalho
 * do contrato vinculado. Não grava nada — só resolve leitura.
 */
export function resolveProjectContractValue(
  projectId: string,
  storedValorTotal: number | null | undefined,
  contractValues: ReadonlyMap<string, number>,
): number {
  const stored = Math.max(0, storedValorTotal || 0);
  if (stored > 0) return stored;
  return Math.max(0, contractValues.get(projectId) ?? 0);
}

/**
 * Valor contratual por projeto, para o globo/agregados/carteira.
 *
 * Preferência: visão 175. Lacunas preenchidas por `contracts.total_value`
 * (coluna project_id e, se preciso, contract_project_links).
 */
export async function listProjectContractValues(): Promise<
  ReadonlyMap<string, { contractValue: number; currency: string | null }>
> {
  const supabase = createClient();
  const out = new Map<string, { contractValue: number; currency: string | null }>();

  const { data: fromView } = await supabase
    .from('project_contract_financial_read_model')
    .select('project_id, contract_value, currency');

  for (const row of fromView ?? []) {
    const value = Number(row.contract_value);
    if (!Number.isFinite(value) || !row.project_id) continue;
    out.set(String(row.project_id), {
      contractValue: value,
      currency: (row.currency as string) ?? null,
    });
  }

  // Preenche lacunas pela verdade do contrato — sem sobrescrever a visão.
  const { data: byColumn } = await supabase
    .from('contracts')
    .select('project_id, total_value, currency')
    .not('project_id', 'is', null)
    .is('deleted_at', null);

  for (const row of byColumn ?? []) {
    if (!row.project_id || out.has(String(row.project_id))) continue;
    const value = Number(row.total_value);
    if (!Number.isFinite(value)) continue;
    out.set(String(row.project_id), {
      contractValue: value,
      currency: (row.currency as string) ?? null,
    });
  }

  const { data: links } = await supabase
    .from('contract_project_links')
    .select('project_id, contract_id');

  const missingProjectIds = (links ?? [])
    .map((l) => String(l.project_id))
    .filter((id) => id && !out.has(id));

  if (missingProjectIds.length > 0) {
    const contractIds = [...new Set(
      (links ?? [])
        .filter((l) => missingProjectIds.includes(String(l.project_id)))
        .map((l) => l.contract_id),
    )];
    const { data: linkedContracts } = await supabase
      .from('contracts')
      .select('id, total_value, currency')
      .in('id', contractIds)
      .is('deleted_at', null);
    const byId = new Map((linkedContracts ?? []).map((c) => [c.id, c]));
    for (const link of links ?? []) {
      const pid = String(link.project_id);
      if (out.has(pid)) continue;
      const c = byId.get(link.contract_id);
      if (!c) continue;
      const value = Number(c.total_value);
      if (!Number.isFinite(value)) continue;
      out.set(pid, {
        contractValue: value,
        currency: (c.currency as string) ?? null,
      });
    }
  }

  return out;
}
