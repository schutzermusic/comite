import { NextResponse } from 'next/server';
import { requireAnyOperationsPermission, isSessionError, hasOptionalPermission } from '@/lib/operations/session';
import { runInventoryAct } from '@/lib/supply/inventory-route';
import { listSuppliers } from '@/lib/supply/procurement-read';
import { inventoryAct } from '@/lib/supply/service';
import { snakePayload, supplierSchema } from '@/lib/supply/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Fornecedores = partes com papel `supplier`. */
export async function GET() {
  const session = await requireAnyOperationsPermission(['suppliers.view', 'procurement.view']);
  if (isSessionError(session)) return session.error;
  try {
    const [suppliers, manage] = await Promise.all([listSuppliers(session), hasOptionalPermission(session, 'suppliers.manage')]);
    return NextResponse.json({ ok: true, suppliers, capabilities: { manage } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}

/** Cadastrar fornecedor: reusa a parte pelo documento; cria o papel e o perfil de compras. */
export async function POST(request: Request) {
  return runInventoryAct(request, {
    anyOf: ['suppliers.manage'],
    schema: supplierSchema,
    act: (s, input) => inventoryAct('supplier_register', s.organizationId, s.user.id,
      { p_payload: snakePayload({ ...input, contactEmail: input.contactEmail || null }) }),
    audit: (_input, out) => ({ action: 'supply.supplier.registered', entityType: 'supplier_profile', entityId: String(out.supplier_id),
      metadata: { party_id: out.party_id, party_created: out.party_created } }),
  });
}
