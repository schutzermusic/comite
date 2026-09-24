import { runInventoryAct } from '@/lib/supply/inventory-route';
import { inventoryAct } from '@/lib/supply/service';
import { requisitionSchema, snakePayload } from '@/lib/supply/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Requisição: da FALTA (rastro por requisito) ou manual (exceção com justificativa). */
export async function POST(request: Request) {
  return runInventoryAct(request, {
    anyOf: ['procurement.request'],
    schema: requisitionSchema,
    act: (s, input) => {
      const { source, ...rest } = input;
      return inventoryAct(source === 'SHORTAGE' ? 'purchase_requisition_from_shortage' : 'purchase_requisition_create_manual',
        s.organizationId, s.user.id, { p_payload: snakePayload(rest) });
    },
    audit: (input, out) => ({ action: 'supply.requisition.submitted', entityType: 'purchase_requisition',
      entityId: String(out.requisition_id), metadata: { source: input.source, number: out.requisition_number, replayed: out.replayed } }),
  });
}
