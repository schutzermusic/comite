import { runInventoryAct } from '@/lib/supply/inventory-route';
import { inventoryAct, supplyRpc } from '@/lib/supply/service';
import { purchaseOrderActionSchema, snakePayload } from '@/lib/supply/validation';
import { platformServiceClient } from '@/lib/platform/server-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PERMISSION: Record<string, string[]> = {
  update: ['procurement.source'], submit: ['procurement.source', 'procurement.orders.issue'],
  approve: ['procurement.approve'], reject: ['procurement.approve'],
  // `sync` aplica um desfecho do motor: muda o estado do pedido, então exige quem atua em compras.
  sync: ['procurement.source', 'procurement.orders.issue', 'procurement.approve'],
  issue: ['procurement.orders.issue'], cancel: ['procurement.orders.issue'], close: ['procurement.orders.issue'],
};

/**
 * Atos do pedido. `sync` aplica o desfecho do motor de aprovação (idempotente,
 * confere a impressão digital) enquanto a rota durável do evento não é ligada.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.clone().json().catch(() => null) as { action?: string } | null;
  return runInventoryAct(request, {
    anyOf: PERMISSION[body?.action ?? ''] ?? ['procurement.orders.issue'],
    schema: purchaseOrderActionSchema,
    act: async (s, input) => {
      const base = { p_po_id: id };
      switch (input.action) {
        case 'update': {
          const { action: _a, ...rest } = input;
          return inventoryAct('purchase_order_update_draft', s.organizationId, s.user.id, { ...base, p_payload: snakePayload(rest) });
        }
        case 'submit': return inventoryAct('purchase_order_submit', s.organizationId, s.user.id, { ...base, p_note: input.note ?? null });
        case 'approve':
        case 'reject':
          return inventoryAct('purchase_order_decide', s.organizationId, s.user.id,
            { ...base, p_decision: input.action === 'approve' ? 'APPROVE' : 'REJECT', p_note: input.note ?? null });
        case 'sync': {
          const { data } = await platformServiceClient().from('purchase_orders').select('approval_request_id')
            .eq('organization_id', s.organizationId).eq('id', id).maybeSingle<{ approval_request_id: string | null }>();
          if (!data?.approval_request_id) return { applied: false, reason: 'NO_POLICY_REQUEST' };
          return supplyRpc<Record<string, unknown>>('purchase_order_apply_approval', { p_approval_request_id: data.approval_request_id });
        }
        case 'issue': return inventoryAct('purchase_order_issue', s.organizationId, s.user.id, base);
        case 'cancel': return inventoryAct('purchase_order_cancel', s.organizationId, s.user.id, { ...base, p_reason: input.reason });
        case 'close': return inventoryAct('purchase_order_close', s.organizationId, s.user.id, { ...base, p_reason: input.reason ?? null });
      }
    },
    audit: (input, out) => ({ action: `supply.purchase_order.${input.action}`, entityType: 'purchase_order', entityId: id,
      metadata: { status: out.status ?? null, governance: out.governance ?? null } }),
  });
}
