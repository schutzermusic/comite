import { runInventoryAct } from '@/lib/supply/inventory-route';
import { inventoryAct } from '@/lib/supply/service';
import { locationSchema, snakePayload } from '@/lib/supply/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Editar ou desativar local. Local com estoque não desativa; com histórico não muda de tipo. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return runInventoryAct(request, {
    anyOf: ['inventory.manage'],
    schema: locationSchema,
    act: (s, input) => inventoryAct('inventory_location_upsert', s.organizationId, s.user.id, { p_payload: { ...snakePayload(input), id } }),
    audit: (input) => ({ action: 'supply.inventory.location_edited', entityType: 'inventory_location', entityId: id,
      metadata: { fields: Object.keys(input) } }),
  });
}
