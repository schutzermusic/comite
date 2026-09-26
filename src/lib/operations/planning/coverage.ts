/**
 * O ponto em que o Planejamento lê a cobertura do Supply: a visão derivada
 * `supply_requirement_coverage` (232+), lida pelo cliente autenticado — a RLS
 * dos requisitos vale para ela (`security_invoker`).
 */
if (typeof window !== 'undefined') {
  throw new Error('operations/planning/coverage.ts não pode ser importado no navegador');
}

import { selectIn } from '@/lib/supabase/select-in';
import { fromViewRow, type CoverageViewRow } from '@/lib/supply/coverage';
import type { CoverageLoader } from './read-model';

/**
 * Em lotes (`selectIn`): o Planejamento da carteira pede a cobertura de TODOS os requisitos vivos (até 3 000). Com
 * a lista inteira na URL, ~900 requisitos no QA davam 414 e a tela inteira caía em "Não foi possível ler a cobertura".
 */
export const supplyCoverageLoader: CoverageLoader = async (session, requirementIds) => {
  const out = new Map<string, { covered: number; inbound: number }>();
  if (!requirementIds.length) return out;
  let rows: CoverageViewRow[];
  try {
    rows = await selectIn<CoverageViewRow>(requirementIds, (c) => session.supabase.from('supply_requirement_coverage').select('*')
      .eq('organization_id', session.organizationId).in('requirement_id', c));
  } catch (cause) {
    throw new Error('Não foi possível ler a cobertura de material.', { cause });
  }
  for (const row of rows) {
    const s = fromViewRow(row);
    out.set(row.requirement_id, { covered: s.covered, inbound: s.inbound });
  }
  return out;
};
