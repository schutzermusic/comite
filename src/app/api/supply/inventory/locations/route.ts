import { runInventoryAct } from '@/lib/supply/inventory-route';
import { inventoryAct } from '@/lib/supply/service';
import { locationSchema, snakePayload } from '@/lib/supply/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Novo local de estoque (almoxarifado, canteiro, veículo, quarentena, zona, posição). */
export async function POST(request: Request) {
  return runInventoryAct(request, {
    anyOf: ['inventory.manage'],
    schema: locationSchema.refine((l) => l.code && l.name && l.kind, 'Local novo exige código, nome e tipo.'),
    act: (s, input) => inventoryAct('inventory_location_upsert', s.organizationId, s.user.id, { p_payload: snakePayload(input) }),
    audit: (input, out) => ({ action: 'supply.inventory.location_created', entityType: 'inventory_location',
      entityId: String(out.location_id), metadata: { code: input.code, kind: input.kind } }),
  });
}
