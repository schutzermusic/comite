import { runInventoryAct } from '@/lib/supply/inventory-route';
import { inventoryAct } from '@/lib/supply/service';
import { supplierStatusSchema } from '@/lib/supply/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Homologar, suspender ou bloquear (restrição com motivo). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return runInventoryAct(request, {
    anyOf: ['suppliers.manage'],
    schema: supplierStatusSchema,
    act: (s, input) => inventoryAct('supplier_set_status', s.organizationId, s.user.id,
      { p_supplier_id: id, p_status: input.status, p_reason: input.reason ?? null }),
    audit: (input) => ({ action: 'supply.supplier.status_changed', entityType: 'supplier_profile', entityId: id,
      metadata: { status: input.status } }),
  });
}
