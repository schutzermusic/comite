/**
 * Carrega requisitos de aprovação governados para a carteira.
 *
 * Somente leitura. Não instancia fluxo, não grava pedido.
 */
'use client';

import { createClient } from '@/utils/supabase/client';
import type {
  ContractBillingConditionRow,
  ContractMeasurementRequirementRow,
} from '../structured-contract-types';
import { APPROVAL_CONDITION_TYPES } from '../trust/approval-requirements';
import type { ApprovalRequestView } from '@/lib/platform/approvals/types';

export async function listPortfolioBillingApprovalConditions(
  contractIds: readonly string[],
): Promise<ContractBillingConditionRow[]> {
  if (contractIds.length === 0) return [];
  const { data, error } = await createClient()
    .from('contract_billing_conditions')
    .select('*')
    .in('contract_id', contractIds as string[])
    .in('condition_type', [...APPROVAL_CONDITION_TYPES]);
  if (error) throw new Error(`Erro ao ler condições de aprovação: ${error.message}`);
  return (data ?? []) as ContractBillingConditionRow[];
}

export async function listPortfolioMeasurementAcceptanceRequirements(
  contractIds: readonly string[],
): Promise<ContractMeasurementRequirementRow[]> {
  if (contractIds.length === 0) return [];
  const { data, error } = await createClient()
    .from('contract_measurement_requirements')
    .select('*')
    .in('contract_id', contractIds as string[])
    .eq('customer_acceptance_required', true);
  if (error) throw new Error(`Erro ao ler exigências de aceite: ${error.message}`);
  return (data ?? []) as ContractMeasurementRequirementRow[];
}

/** Pedidos do motor compartilhado para vários contratos (sujeito = contract). */
export async function listSharedApprovalRequestsForContracts(
  contractIds: readonly string[],
): Promise<Map<string, ApprovalRequestView[]>> {
  const map = new Map<string, ApprovalRequestView[]>();
  if (contractIds.length === 0) return map;
  const { data, error } = await createClient()
    .from('approval_request_read_model')
    .select('*')
    .eq('subject_type', 'contract')
    .in('subject_id', contractIds as string[]);
  if (error) {
    // Ambiente sem cut-over: a visão pode não existir. Não inventar pedidos.
    if (error.message.includes('does not exist')) return map;
    throw new Error(`Erro ao ler pedidos de aprovação: ${error.message}`);
  }
  for (const row of (data ?? []) as ApprovalRequestView[]) {
    const list = map.get(row.subject_id) ?? [];
    list.push(row);
    map.set(row.subject_id, list);
  }
  return map;
}
