import { runInventoryAct } from '@/lib/supply/inventory-route';
import { inventoryAct } from '@/lib/supply/service';
import { reserveSchema, snakePayload } from '@/lib/supply/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reservar estoque para um requisito confirmado — checagem atômica de disponibilidade no banco. */
export async function POST(request: Request) {
  return runInventoryAct(request, {
    anyOf: ['inventory.reserve'],
    schema: reserveSchema,
    act: (s, input) => inventoryAct('inventory_reserve', s.organizationId, s.user.id, { p_payload: snakePayload(input) }),
    audit: (input, out) => ({ action: 'supply.inventory.reserved', entityType: 'inventory_reservation',
      entityId: String(out.reservation_id), metadata: { requirement_id: input.requirementId, location_id: input.locationId,
        quantity: input.quantity, replayed: out.replayed } }),
  });
}
