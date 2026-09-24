import { NextResponse } from 'next/server';
import { requireAnyOperationsPermission, isSessionError } from '@/lib/operations/session';
import { todayInSaoPaulo } from '@/lib/operations/projects/access';
import { runInventoryAct } from '@/lib/supply/inventory-route';
import { listSuppliers, supplierDetail } from '@/lib/supply/procurement-read';
import { inventoryAct } from '@/lib/supply/service';
import { supplierStatusSchema } from '@/lib/supply/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** O fornecedor 360: cadastro, desempenho medido, pedidos, cotações e recebimentos. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAnyOperationsPermission(['suppliers.view', 'procurement.view']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  try {
    const supplier = (await listSuppliers(session)).find((s) => s.id === id);
    if (!supplier) return NextResponse.json({ ok: false, error: 'Fornecedor não encontrado.' }, { status: 404 });
    return NextResponse.json({ ok: true, supplier, ...(await supplierDetail(session, id, todayInSaoPaulo())) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}

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
