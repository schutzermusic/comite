import { runInventoryAct } from '@/lib/supply/inventory-route';
import { inventoryAct } from '@/lib/supply/service';
import { inspectionSchema, snakePayload } from '@/lib/supply/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Decidir a inspeção: aprovado vai ao destino (transferência canônica), rejeitado volta a ser esperado. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return runInventoryAct(request, {
    anyOf: ['receiving.receive'],
    schema: inspectionSchema,
    act: (s, input) => inventoryAct('goods_receipt_inspect', s.organizationId, s.user.id,
      { p_receipt_id: id, p_payload: snakePayload(input) }),
    audit: (_input, out) => ({ action: 'supply.goods_receipt.inspected', entityType: 'goods_receipt', entityId: id,
      metadata: { status: out.inspection_status ?? null, approved: out.approved ?? null, rejected: out.rejected ?? null } }),
  });
}
