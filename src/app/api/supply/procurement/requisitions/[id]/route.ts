import { z } from 'zod';
import { runInventoryAct } from '@/lib/supply/inventory-route';
import { inventoryAct } from '@/lib/supply/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cancelar requisição (motivo obrigatório; recusado se já há pedido vivo). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return runInventoryAct(request, {
    anyOf: ['procurement.request', 'procurement.source'],
    schema: z.object({ action: z.literal('cancel'), reason: z.string().trim().min(3).max(500) }),
    act: (s, input) => inventoryAct('purchase_requisition_cancel', s.organizationId, s.user.id,
      { p_requisition_id: id, p_reason: input.reason }),
    audit: () => ({ action: 'supply.requisition.cancelled', entityType: 'purchase_requisition', entityId: id }),
  });
}
