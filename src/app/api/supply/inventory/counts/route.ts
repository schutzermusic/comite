import { runInventoryAct } from '@/lib/supply/inventory-route';
import { inventoryAct } from '@/lib/supply/service';
import { countOpenSchema, snakePayload } from '@/lib/supply/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Abrir contagem num local — fotografa o esperado pelo livro. */
export async function POST(request: Request) {
  return runInventoryAct(request, {
    anyOf: ['inventory.manage'],
    schema: countOpenSchema,
    act: (s, input) => inventoryAct('inventory_count_open', s.organizationId, s.user.id, { p_payload: snakePayload(input) }),
    audit: (input, out) => ({ action: 'supply.inventory.count_opened', entityType: 'inventory_count', entityId: String(out.count_id),
      metadata: { location_id: input.locationId, lines: out.lines } }),
  });
}
