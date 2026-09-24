import { NextResponse } from 'next/server';
import { requireAnyOperationsPermission, isSessionError, hasOptionalPermission } from '@/lib/operations/session';
import { procurementWorkspace } from '@/lib/supply/procurement-read';
import { todayInSaoPaulo } from '@/lib/operations/projects/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Compras: solicitações, cotações (com comparação), aprovações e pedidos. */
export async function GET() {
  const session = await requireAnyOperationsPermission(['procurement.view', 'supply.view']);
  if (isSessionError(session)) return session.error;
  try {
    const keys = ['procurement.request', 'procurement.source', 'procurement.approve', 'procurement.orders.issue',
      'procurement.authorities.manage', 'suppliers.manage'] as const;
    const [model, ...flags] = await Promise.all([procurementWorkspace(session, todayInSaoPaulo()),
      ...keys.map((k) => hasOptionalPermission(session, k))]);
    const [request, source, approve, issue, authorities, suppliers] = flags;
    return NextResponse.json({ ok: true, ...model, viewerId: session.user.id,
      capabilities: { request, source, approve, issue, authorities, suppliers } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
