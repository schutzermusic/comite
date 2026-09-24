/**
 * O ponto em que o Planejamento lê a cobertura do Supply: a visão derivada
 * `supply_requirement_coverage` (232+), lida pelo cliente autenticado — a RLS
 * dos requisitos vale para ela (`security_invoker`).
 */
if (typeof window !== 'undefined') {
  throw new Error('operations/planning/coverage.ts não pode ser importado no navegador');
}

import { fromViewRow, type CoverageViewRow } from '@/lib/supply/coverage';
import type { CoverageLoader } from './read-model';

export const supplyCoverageLoader: CoverageLoader = async (session, requirementIds) => {
  const out = new Map<string, { covered: number; inbound: number }>();
  if (!requirementIds.length) return out;
  const { data, error } = await session.supabase.from('supply_requirement_coverage').select('*')
    .eq('organization_id', session.organizationId).in('requirement_id', requirementIds);
  if (error) throw new Error('Não foi possível ler a cobertura de material.');
  for (const row of (data ?? []) as CoverageViewRow[]) {
    const s = fromViewRow(row);
    out.set(row.requirement_id, { covered: s.covered, inbound: s.inbound });
  }
  return out;
};
