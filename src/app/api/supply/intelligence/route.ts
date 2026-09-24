import { NextResponse } from 'next/server';
import { requireAnyOperationsPermission, isSessionError, hasOptionalPermission } from '@/lib/operations/session';
import { listSupplySignals } from '@/lib/supply/intelligence-read';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Recomendações da Apex (abertas + decididas/resolvidas nos últimos 30 dias). `?project=` recorta um projeto. */
export async function GET(request: Request) {
  const session = await requireAnyOperationsPermission(['supply.view', 'procurement.view', 'inventory.view', 'receiving.view',
    'operations.planning.view', 'projects.view']);
  if (isSessionError(session)) return session.error;
  const projectId = new URL(request.url).searchParams.get('project') ?? undefined;
  try {
    const keys = ['inventory.reserve', 'inventory.manage', 'procurement.request', 'supply.plan', 'procurement.source',
      'procurement.orders.issue', 'receiving.receive'] as const;
    const [model, ...flags] = await Promise.all([listSupplySignals(session, { projectId }), ...keys.map((k) => hasOptionalPermission(session, k))]);
    const [reserve, manage, request_, plan, source, issue, receive] = flags;
    return NextResponse.json({ ok: true, ...model, capabilities: {
      RESERVE: reserve, TRANSFER: manage || reserve, REQUISITION: request_,
      FOLLOW_UP: plan || source || issue || manage || receive,
      dismiss: plan || reserve || manage || request_ || source || receive,
    } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
