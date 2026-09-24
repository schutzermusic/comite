/** Escritas governadas do Supply (232+). */
if (typeof window !== 'undefined') {
  throw new Error('supply/service.ts não pode ser importado no navegador');
}

import { platformServiceClient } from '@/lib/platform/server-client';

export async function supplyRpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await platformServiceClient().rpc(name, params);
  if (error) throw new Error(error.message);
  return data as T;
}

export function upsertItem(organizationId: string, actorId: string, payload: Record<string, unknown>) {
  return supplyRpc<{ item_id: string; created: boolean }>('supply_item_upsert', {
    p_organization_id: organizationId, p_actor: actorId, p_payload: payload });
}
