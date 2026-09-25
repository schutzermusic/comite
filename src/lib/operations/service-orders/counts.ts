/**
 * Contagens da OS — regra PURA (sem banco), a mesma do portão de emissão:
 * divergência BLOCKING aberta da OS ou do engajamento dela (quando a
 * divergência não é de nenhuma OS), menos as nomeadas numa exceção desta OS.
 *
 * A leitura (`countsFor`, em `read-model.ts`) busca as linhas em lotes e
 * entrega aqui; nada aqui consulta nada.
 */
import type { ServiceOrderCounts } from './types';

export interface CountsItemRow { service_order_id: string; confirmation_state: string | null }
export interface CountsDivergenceRow {
  id: string; service_order_id: string | null; engagement_id: string | null; severity: string; state?: string;
}
export interface CountsExceptionRow { service_order_id: string; divergence_ids: string[] | null }

/**
 * Junta listas de linhas pelo `id` — a divergência pode vir das duas consultas
 * (pela OS e pelo engajamento) e conta uma vez só.
 */
export function mergeById<T extends { id: string }>(...lists: ReadonlyArray<readonly T[]>): T[] {
  const byId = new Map<string, T>();
  for (const list of lists) for (const row of list) if (!byId.has(row.id)) byId.set(row.id, row);
  return Array.from(byId.values());
}

export function tallyServiceOrderCounts(
  orders: ReadonlyArray<{ id: string; engagement_id: string }>,
  items: readonly CountsItemRow[],
  divergences: readonly CountsDivergenceRow[],
  exceptions: readonly CountsExceptionRow[],
): Map<string, ServiceOrderCounts> {
  const counts = new Map<string, ServiceOrderCounts>();
  for (const o of orders) counts.set(o.id, { items: 0, unreviewedItems: 0, openDivergences: 0, blockingOpen: 0 });

  for (const row of items) {
    const c = counts.get(row.service_order_id);
    if (!c) continue;
    c.items += 1;
    if (row.confirmation_state === 'UNCONFIRMED') c.unreviewedItems += 1;
  }
  const waived = new Map<string, Set<string>>();
  for (const e of exceptions) {
    const set = waived.get(e.service_order_id) ?? new Set<string>();
    for (const id of e.divergence_ids ?? []) set.add(id);
    waived.set(e.service_order_id, set);
  }
  for (const o of orders) {
    const c = counts.get(o.id)!;
    for (const d of divergences) {
      const mine = d.service_order_id === o.id || (d.service_order_id === null && d.engagement_id === o.engagement_id);
      if (!mine) continue;
      c.openDivergences += 1;
      if (d.severity === 'BLOCKING' && !waived.get(o.id)?.has(d.id)) c.blockingOpen += 1;
    }
  }
  return counts;
}
