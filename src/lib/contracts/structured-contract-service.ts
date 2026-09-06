'use client';

import { createClient } from '@/utils/supabase/client';
import type { ContractRow } from './contract-service';
import {
  assertContractDate, resolveContractAsOf,
  type ContractAsOfInput, type ContractInstrumentLineageRow,
} from './resolve-contract-as-of';

const SOURCES = {
  amendments: 'contract_amendments', clauses: 'contract_clauses',
  guarantees: 'contract_guarantees', insuranceRequirements: 'contract_insurance_requirements',
  indexationRules: 'contract_indexation_rules', billingConditions: 'contract_billing_conditions',
  measurementRequirements: 'contract_measurement_requirements',
} as const;

/** All reads are tenant filtered and paginated. A failed/partial read never becomes an empty family. */
export async function loadContractAsOf(contractId: string, date: string) {
  assertContractDate(date);
  const client = createClient();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) throw new Error('Sessão autenticada necessária para consultar o contrato.');
  const { data: profile, error: profileError } = await client.from('profiles')
    .select('organization_id').eq('user_id', user.id).single();
  if (profileError || !profile?.organization_id) throw new Error('Organização do contrato não determinada.');
  const organizationId: string = profile.organization_id;

  const rows = async <T>(table: string, column: string, ids: string[]): Promise<T[]> => {
    if (!ids.length) return [];
    const result: T[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await client.from(table).select('*').eq('organization_id', organizationId)
        .in(column, ids).order('id').range(offset, offset + 499);
      if (error) throw new Error(`Falha ao consultar ${table}: ${error.message}`);
      if (data === null) throw new Error(`Leitura incompleta de ${table}.`);
      result.push(...data as T[]);
      if (data.length < 500) break;
    }
    return result;
  };
  const contracts: ContractRow[] = [];
  const lineage: ContractInstrumentLineageRow[] = [];
  const visited = new Set<string>();
  let next: string | null = contractId;
  while (next) {
    if (visited.has(next)) throw new Error('Ciclo na linhagem contratual.');
    visited.add(next);
    const [instruments, links]: [ContractRow[], ContractInstrumentLineageRow[]] = await Promise.all([
      rows<ContractRow>('contracts', 'id', [next]),
      rows<ContractInstrumentLineageRow>('contract_instrument_lineage', 'contract_id', [next]),
    ]);
    if (instruments.length !== 1) throw new Error('Instrumento da linhagem ausente ou sem permissão de leitura.');
    contracts.push(instruments[0]); lineage.push(...links);
    const parents = links.filter(link => link.amendment_id === null);
    if (parents.length > 1) throw new Error('Instrumento com parentesco ambíguo.');
    next = parents[0]?.parent_contract_id ?? null;
  }
  const ids = contracts.map(c => c.id);
  const entries = await Promise.all(Object.entries(SOURCES).map(async ([key, table]) => [key, await rows(table, 'contract_id', ids)] as const));
  const families = Object.fromEntries(entries) as unknown as Pick<ContractAsOfInput, keyof typeof SOURCES>;
  const clauseLinks = await rows<ContractAsOfInput['clauseLinks'][number]>(
    'contract_amendment_clauses', 'amendment_id', families.amendments.map(a => a.id),
  );
  return resolveContractAsOf({ contractId, organizationId, contracts, lineage, clauseLinks, ...families }, date);
}

/** Recorded revisions are audit history; legal asOf dates belong to the instrument itself. */
export async function listContractAmendmentHistory(amendmentId: string) {
  const client = createClient();
  const { data, error } = await client.from('contract_amendment_revisions').select('*')
    .eq('amendment_id', amendmentId).order('revision').order('id');
  if (error || data === null) throw new Error(`Falha ao consultar histórico do aditivo: ${error?.message ?? 'leitura incompleta'}`);
  return data;
}

/** Append a sourced version. Corrections point to predecessor_id; saved rows are never patched. */
export async function appendContractFact<T extends keyof import('./structured-contract-types').ContractStructuredTableRows>(
  table: T,
  input: Omit<import('./structured-contract-types').ContractStructuredTableRows[T], 'id' | 'organization_id' | 'created_at' | 'created_by'>,
): Promise<import('./structured-contract-types').ContractStructuredTableRows[T]> {
  if (!(Object.values(SOURCES) as string[]).filter(t => !['contract_amendments', 'contract_clauses'].includes(t)).includes(table)) {
    throw new Error('Fonte contratual inválida.');
  }
  const client = createClient();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) throw new Error('Sessão autenticada necessária.');
  const { data: profile, error: profileError } = await client.from('profiles').select('organization_id')
    .eq('user_id', user.id).single();
  if (profileError || !profile?.organization_id) throw new Error('Organização não determinada.');
  const { data, error } = await client.from(table).insert({ ...input, organization_id: profile.organization_id, created_by: user.id })
    .select('*').single();
  if (error || !data) throw new Error(`Falha ao registrar requisito contratual: ${error?.message ?? 'registro não retornado'}`);
  return data as import('./structured-contract-types').ContractStructuredTableRows[T];
}
