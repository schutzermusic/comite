import { runInventoryAct } from '@/lib/supply/inventory-route';
import { inventoryAct } from '@/lib/supply/service';
import { snakePayload, transferActionSchema } from '@/lib/supply/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Aprovar, despachar, receber (parcial), encerrar ou cancelar a transferência. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.clone().json().catch(() => null) as { action?: string } | null;
  const anyOf = body?.action === 'receive' ? ['inventory.manage', 'receiving.receive'] : ['inventory.manage'];
  return runInventoryAct(request, {
    anyOf,
    schema: transferActionSchema,
    act: (s, input) => {
      const base = { p_transfer_id: id };
      switch (input.action) {
        case 'approve': return inventoryAct('inventory_transfer_approve', s.organizationId, s.user.id, base);
        case 'dispatch': {
          const { action: _a, ...rest } = input;
          return inventoryAct('inventory_transfer_dispatch', s.organizationId, s.user.id, { ...base, p_payload: snakePayload(rest) });
        }
        case 'receive': {
          const { action: _a, ...rest } = input;
          return inventoryAct('inventory_transfer_receive', s.organizationId, s.user.id, { ...base, p_payload: snakePayload(rest) });
        }
        case 'close': return inventoryAct('inventory_transfer_close', s.organizationId, s.user.id, { ...base, p_reason: input.reason ?? null });
        case 'cancel': return inventoryAct('inventory_transfer_cancel', s.organizationId, s.user.id, { ...base, p_reason: input.reason });
      }
    },
    audit: (input, out) => ({ action: `supply.transfer.${input.action}`, entityType: 'inventory_transfer', entityId: id,
      metadata: { status: out.status, replayed: out.replayed } }),
  });
}
