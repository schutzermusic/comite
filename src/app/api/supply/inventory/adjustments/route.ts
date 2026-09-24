import { runInventoryAct } from '@/lib/supply/inventory-route';
import { inventoryAct } from '@/lib/supply/service';
import { adjustmentSchema, snakePayload } from '@/lib/supply/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Ajuste de estoque (saldo inicial, avaria, achado) — sempre com motivo; nunca come reserva alheia. */
export async function POST(request: Request) {
  return runInventoryAct(request, {
    anyOf: ['inventory.manage'],
    schema: adjustmentSchema,
    act: (s, input) => inventoryAct('inventory_adjust', s.organizationId, s.user.id, { p_payload: snakePayload(input) }),
    audit: (input, out) => ({ action: 'supply.inventory.adjusted', entityType: 'inventory_movement',
      entityId: String(out.movement_id), metadata: { item_id: input.itemId, location_id: input.locationId, quantity: input.quantity } }),
  });
}
