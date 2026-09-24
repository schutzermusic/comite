import { runInventoryAct } from '@/lib/supply/inventory-route';
import { inventoryAct } from '@/lib/supply/service';
import { countActionSchema, snakePayload } from '@/lib/supply/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Registrar contado, postar (correção pela diferença; recusa se o estoque se moveu) ou cancelar. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return runInventoryAct(request, {
    anyOf: ['inventory.manage'],
    schema: countActionSchema,
    act: (s, input) => {
      if (input.action === 'record') {
        return inventoryAct('inventory_count_record', s.organizationId, s.user.id,
          { p_count_id: id, p_lines: input.lines.map((l) => snakePayload(l)) });
      }
      return inventoryAct(input.action === 'post' ? 'inventory_count_post' : 'inventory_count_cancel', s.organizationId, s.user.id,
        { p_count_id: id, p_reason: input.reason ?? null });
    },
    audit: (input, out) => ({ action: `supply.inventory.count_${input.action}`, entityType: 'inventory_count', entityId: id,
      metadata: { corrections: out.corrections ?? null } }),
  });
}
