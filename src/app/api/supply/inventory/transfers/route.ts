import { runInventoryAct } from '@/lib/supply/inventory-route';
import { inventoryAct } from '@/lib/supply/service';
import { snakePayload, transferRequestSchema } from '@/lib/supply/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Pedir transferência entre locais (quem gere estoque ou reserva para o próprio plano). */
export async function POST(request: Request) {
  return runInventoryAct(request, {
    anyOf: ['inventory.manage', 'inventory.reserve'],
    schema: transferRequestSchema,
    act: (s, input) => inventoryAct('inventory_transfer_request', s.organizationId, s.user.id, { p_payload: snakePayload(input) }),
    audit: (input, out) => ({ action: 'supply.transfer.requested', entityType: 'inventory_transfer', entityId: String(out.transfer_id),
      metadata: { number: out.transfer_number, lines: input.lines.length } }),
  });
}
