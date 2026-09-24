import { runInventoryAct } from '@/lib/supply/inventory-route';
import { inventoryAct } from '@/lib/supply/service';
import { shipmentSchema, snakePayload } from '@/lib/supply/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Logística de entrada: registrar embarque do pedido, ETA, trânsito, chegada ou cancelamento. */
export async function POST(request: Request) {
  return runInventoryAct(request, {
    anyOf: ['receiving.receive', 'procurement.orders.issue'],
    schema: shipmentSchema,
    act: (s, input) => inventoryAct('inbound_shipment_record', s.organizationId, s.user.id, { p_payload: snakePayload(input) }),
    audit: (input, out) => ({ action: 'supply.shipment.recorded', entityType: 'inbound_shipment', entityId: String(out.shipment_id),
      metadata: { status: out.status, purchase_order_id: input.purchaseOrderId ?? null } }),
  });
}
