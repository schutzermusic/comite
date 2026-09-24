import { NextResponse } from 'next/server';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireOperationsSession, isSessionError, governedFailure } from '@/lib/operations/session';
import { compareWithGoverning, seedFromPackage } from '@/lib/operations/service-orders/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Trazer o conteúdo do pacote para uma OS aberta sem linhas (ex.: a nascida no fechamento). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireOperationsSession(['commercial.service_orders.manage']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  try {
    const out = await seedFromPackage(session.organizationId, session.user.id, id);
    const comparison = await compareWithGoverning(session.organizationId, id);
    await logAuditEventServer({ organizationId: session.organizationId, action: 'operations.service_order.seeded',
      entityType: 'internal_service_order', entityId: id, metadata: { itemsAdded: out.items_added } }, request.headers);
    return NextResponse.json({ ok: true, itemsAdded: out.items_added, divergencesOpened: comparison.divergences_opened ?? 0 });
  } catch (error) {
    return governedFailure(error);
  }
}
