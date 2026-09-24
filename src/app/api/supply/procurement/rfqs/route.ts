import { runInventoryAct } from '@/lib/supply/inventory-route';
import { inventoryAct } from '@/lib/supply/service';
import { rfqSchema, snakePayload } from '@/lib/supply/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Abrir cotação para linhas de requisição, convidando fornecedores não restritos. */
export async function POST(request: Request) {
  return runInventoryAct(request, {
    anyOf: ['procurement.source'],
    schema: rfqSchema,
    act: (s, input) => inventoryAct('procurement_rfq_create', s.organizationId, s.user.id, { p_payload: snakePayload(input) }),
    audit: (input, out) => ({ action: 'supply.rfq.created', entityType: 'procurement_rfq', entityId: String(out.rfq_id),
      metadata: { number: out.rfq_number, lines: input.requisitionLineIds.length, suppliers: input.supplierIds.length } }),
  });
}
