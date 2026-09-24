import { runInventoryAct } from '@/lib/supply/inventory-route';
import { inventoryAct } from '@/lib/supply/service';
import { authoritySchema, snakePayload } from '@/lib/supply/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Declarar alçada de compra com evidência (papel ou pessoa, teto, moeda, escopo). */
export async function POST(request: Request) {
  return runInventoryAct(request, {
    anyOf: ['procurement.authorities.manage'],
    schema: authoritySchema,
    act: (s, input) => inventoryAct('procurement_authority_declare', s.organizationId, s.user.id, { p_payload: snakePayload(input) }),
    audit: (input, out) => ({ action: 'supply.procurement_authority.declared', entityType: 'procurement_authority',
      entityId: String(out.authority_id), metadata: { grantee_kind: input.granteeKind, max_amount: input.maxAmount ?? null,
        source_kind: input.sourceKind } }),
  });
}
