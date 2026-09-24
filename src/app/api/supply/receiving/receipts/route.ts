import { runInventoryAct } from '@/lib/supply/inventory-route';
import { inventoryAct } from '@/lib/supply/service';
import { receiptSchema, snakePayload } from '@/lib/supply/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Postar recebimento contra pedido emitido (parcial, rejeitado com motivo, lote/série). */
export async function POST(request: Request) {
  return runInventoryAct(request, {
    anyOf: ['receiving.receive'],
    schema: receiptSchema,
    act: (s, input) => inventoryAct('goods_receipt_post', s.organizationId, s.user.id, { p_payload: snakePayload(input) }),
    audit: (input, out) => ({ action: 'supply.goods_receipt.posted', entityType: 'goods_receipt', entityId: String(out.receipt_id),
      metadata: { purchase_order_id: input.purchaseOrderId, accepted: out.accepted ?? null, rejected: out.rejected ?? null,
        inspection_status: out.inspection_status ?? null, replayed: out.replayed ?? null } }),
  });
}
