import { runInventoryAct } from '@/lib/supply/inventory-route';
import { inventoryAct } from '@/lib/supply/service';
import { reservationActionSchema, snakePayload } from '@/lib/supply/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PERMISSION = { release: 'inventory.reserve', issue: 'inventory.manage', return: 'inventory.manage' } as const;

/** Liberar (motivo), entregar à obra (consome) ou devolver da obra (volta livre). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.clone().json().catch(() => null) as { action?: keyof typeof PERMISSION } | null;
  const permission = body?.action && PERMISSION[body.action] ? PERMISSION[body.action] : 'inventory.manage';
  return runInventoryAct(request, {
    anyOf: [permission],
    schema: reservationActionSchema,
    act: (s, input) => {
      if (input.action === 'release') {
        return inventoryAct('inventory_release', s.organizationId, s.user.id,
          { p_reservation_id: id, p_quantity: input.quantity ?? null, p_reason: input.reason });
      }
      const { action, ...rest } = input;
      return inventoryAct(action === 'issue' ? 'inventory_issue_to_project' : 'inventory_return_from_project',
        s.organizationId, s.user.id, { p_payload: { ...snakePayload(rest), reservation_id: id } });
    },
    audit: (input) => ({ action: `supply.inventory.reservation_${input.action}`, entityType: 'inventory_reservation', entityId: id,
      metadata: { quantity: 'quantity' in input ? input.quantity : null } }),
  });
}
