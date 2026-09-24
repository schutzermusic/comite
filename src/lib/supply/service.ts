/** Escritas governadas do Supply (232+). */
if (typeof window !== 'undefined') {
  throw new Error('supply/service.ts não pode ser importado no navegador');
}

import { governedRpc } from '@/lib/platform/governed-rpc';

export { GovernedRpcError, isRetryableRpcError } from '@/lib/platform/governed-rpc';
export const supplyRpc = governedRpc;

export function upsertItem(organizationId: string, actorId: string, payload: Record<string, unknown>) {
  return supplyRpc<{ item_id: string; created: boolean }>('supply_item_upsert', {
    p_organization_id: organizationId, p_actor: actorId, p_payload: payload });
}

/** Ato de estoque: toda escrita passa por uma função governada do banco (233). */
export function inventoryAct<T = Record<string, unknown>>(
  name: string, organizationId: string, actorId: string, args: Record<string, unknown> = {},
): Promise<T> {
  return supplyRpc<T>(name, { p_organization_id: organizationId, p_actor: actorId, ...args });
}
