import { runInventoryAct } from '@/lib/supply/inventory-route';
import { inventoryAct } from '@/lib/supply/service';
import { rfqActionSchema, snakePayload } from '@/lib/supply/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Registrar proposta (nova versão) ou decidir a compra (gera o pedido em rascunho). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return runInventoryAct(request, {
    anyOf: ['procurement.source'],
    schema: rfqActionSchema,
    act: (s, input) => {
      const { action, ...rest } = input;
      return inventoryAct(action === 'quote' ? 'procurement_quote_record' : 'procurement_decide', s.organizationId, s.user.id,
        { p_payload: { ...snakePayload(rest), rfq_id: id } });
    },
    audit: (input, out) => ({ action: input.action === 'quote' ? 'supply.quote.recorded' : 'supply.sourcing.decided',
      entityType: input.action === 'quote' ? 'supplier_quote' : 'sourcing_decision',
      entityId: String(input.action === 'quote' ? out.quote_id : out.decision_id),
      metadata: input.action === 'decide' ? { purchase_order_id: out.purchase_order_id, follows_recommendation:
        !input.recommendedQuoteId || input.recommendedQuoteId === input.quoteId } : { version: out.version } }),
  });
}
