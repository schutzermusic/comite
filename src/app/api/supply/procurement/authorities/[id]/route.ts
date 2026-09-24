import { z } from 'zod';
import { runInventoryAct } from '@/lib/supply/inventory-route';
import { inventoryAct } from '@/lib/supply/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Revogar alçada (motivo obrigatório). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return runInventoryAct(request, {
    anyOf: ['procurement.authorities.manage'],
    schema: z.object({ action: z.literal('revoke'), reason: z.string().trim().min(3).max(500) }),
    act: (s, input) => inventoryAct('procurement_authority_revoke', s.organizationId, s.user.id, { p_authority_id: id, p_reason: input.reason }),
    audit: () => ({ action: 'supply.procurement_authority.revoked', entityType: 'procurement_authority', entityId: id }),
  });
}
