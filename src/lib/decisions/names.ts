/**
 * NOMES para Decisões — server-only.
 *
 * O mesmo princípio de `resolveOwnerNames` (commercial/owner-directory): o
 * servidor resolve pelo service role SÓ os ids que já apareceram numa leitura
 * autorizada (a caixa, o detalhe liberado por decision_access_for_viewer, a
 * fila de avisos), e SÓ dentro da organização da decisão. Nada além do nome
 * atravessa — nem e-mail, nem telefone.
 */
if (typeof window !== 'undefined') {
  throw new Error('decisions/names.ts não pode ser importado no navegador');
}

import { resolveOwnerNames } from '@/lib/commercial/owner-directory';
import { projectIdentity } from '@/lib/operations/project-identity';
import { platformServiceClient } from '@/lib/platform/server-client';
import { selectIn } from '@/lib/supabase/select-in';
import type { PersonRef } from './types';

type Row = Record<string, unknown>;
const uniq = (ids: Array<string | null | undefined>) => Array.from(new Set(ids.filter((x): x is string => !!x)));

export interface NameBook {
  person: (id: string | null) => PersonRef | null;
  role: (id: string | null) => string | null;
  project: (id: string | null) => string | null;
  supplier: (id: string | null) => string | null;
}

/**
 * Resolve de uma vez os nomes que a leitura precisa. Falha de diretório vira "sem nome", nunca erro de tela — mas vai
 * para o log (não some calada). Em lotes (`selectIn`): a caixa inteira pode citar centenas de obras e fornecedores, e
 * com a lista toda na URL o 414 apagaria TODOS os nomes, para sempre, sem erro nenhum.
 */
export async function nameBook(organizationId: string, ids: {
  people?: Array<string | null | undefined>;
  roles?: Array<string | null | undefined>;
  projects?: Array<string | null | undefined>;
  suppliers?: Array<string | null | undefined>;
}): Promise<NameBook> {
  const sb = platformServiceClient();
  const people = uniq(ids.people ?? []);
  const roles = uniq(ids.roles ?? []);
  const projects = uniq(ids.projects ?? []);
  const suppliers = uniq(ids.suppliers ?? []);
  const soft = (what: string) => (e: unknown): Row[] => { console.error(`[decisions] nomes indisponíveis (${what})`, e); return []; };
  const [peopleMap, roleRows, projectRows, supplierRows] = await Promise.all([
    people.length ? resolveOwnerNames(organizationId, people) : Promise.resolve({} as Record<string, string>),
    selectIn<Row>(roles, (c) => sb.from('roles').select('id,key,name').in('id', c)).catch(soft('papéis')),
    selectIn<Row>(projects, (c) => sb.from('projects').select('id,project,project_v2').eq('organization_id', organizationId).in('id', c))
      .catch(soft('obras')),
    selectIn<Row>(suppliers, (c) => sb.from('supplier_profiles').select('id,party_id').eq('organization_id', organizationId).in('id', c))
      .then(async (rows) => {
        const parties = await selectIn<Row>(uniq(rows.map((x) => x.party_id as string)), (c) => sb.from('parties')
          .select('id,legal_name,trade_name').eq('organization_id', organizationId).in('id', c));
        const pm = new Map(parties.map((p) => [String(p.id), String(p.trade_name ?? p.legal_name ?? '')]));
        return rows.map((x) => ({ id: x.id, name: pm.get(String(x.party_id)) || null }) as Row);
      }).catch(soft('fornecedores')),
  ]);
  const roleMap = new Map(roleRows.map((r) => [String(r.id), String(r.name ?? r.key ?? '')]));
  const projectMap = new Map(projectRows.map((p) => [String(p.id),
    projectIdentity(String(p.id), (p.project ?? {}) as Record<string, unknown>, (p.project_v2 ?? undefined) as Record<string, unknown> | undefined).name]));
  const supplierMap = new Map(supplierRows.map((s) => [String(s.id), (s.name as string | null) ?? null]));
  return {
    person: (id) => (id ? { id, name: peopleMap[id] ?? null } : null),
    role: (id) => (id ? roleMap.get(id) ?? null : null),
    project: (id) => (id ? projectMap.get(id) ?? null : null),
    supplier: (id) => (id ? supplierMap.get(id) ?? null : null),
  };
}
