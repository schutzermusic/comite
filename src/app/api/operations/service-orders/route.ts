import { NextResponse } from 'next/server';
import { requireOperationsSession, isSessionError, hasOptionalPermission } from '@/lib/operations/session';
import { listServiceOrders } from '@/lib/operations/service-orders/read-model';
import { serviceOrderNextAction } from '@/lib/operations/service-orders/next-action';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A fila de OS de Operações: cada linha com a próxima ação DERIVADA. */
export async function GET() {
  const session = await requireOperationsSession(['operations.view']);
  if (isSessionError(session)) return session.error;
  try {
    const [rows, manage, ingest] = await Promise.all([
      listServiceOrders(session),
      hasOptionalPermission(session, 'commercial.service_orders.manage'),
      hasOptionalPermission(session, 'commercial.documents.ingest'),
    ]);
    return NextResponse.json({ ok: true, capabilities: { manage, ingest },
      serviceOrders: rows.map((row) => ({
        ...row, nextAction: serviceOrderNextAction(row.status, row.projectId, row.counts),
      })) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
