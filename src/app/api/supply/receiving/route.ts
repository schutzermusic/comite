import { NextResponse } from 'next/server';
import { requireAnyOperationsPermission, isSessionError, hasOptionalPermission } from '@/lib/operations/session';
import { receivingWorkspace } from '@/lib/supply/receiving-read';
import { todayInSaoPaulo } from '@/lib/operations/projects/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Recebimentos & Logística: o que está entrando, recebimentos, inspeções e desempenho de entrega. */
export async function GET() {
  const session = await requireAnyOperationsPermission(['receiving.view', 'supply.view', 'procurement.view']);
  if (isSessionError(session)) return session.error;
  try {
    const [model, receive, manage, logistics] = await Promise.all([
      receivingWorkspace(session, todayInSaoPaulo()),
      hasOptionalPermission(session, 'receiving.receive'),
      hasOptionalPermission(session, 'inventory.manage'),
      hasOptionalPermission(session, 'procurement.orders.issue'),
    ]);
    return NextResponse.json({ ok: true, ...model, capabilities: { receive, inspect: receive && manage, logistics: receive || logistics } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
