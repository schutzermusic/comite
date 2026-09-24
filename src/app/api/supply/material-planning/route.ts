import { NextResponse } from 'next/server';
import { requireAnyOperationsPermission, isSessionError, hasOptionalPermission } from '@/lib/operations/session';
import { materialDemand } from '@/lib/supply/read-model';
import { todayInSaoPaulo } from '@/lib/operations/projects/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Demanda de material × cobertura, por requisito. `?project=` recorta um projeto (aba Materiais & Supply). */
export async function GET(request: Request) {
  const session = await requireAnyOperationsPermission(['supply.view', 'projects.view']);
  if (isSessionError(session)) return session.error;
  const projectId = new URL(request.url).searchParams.get('project') ?? undefined;
  try {
    const [rows, plan, reserve, manage, requestPurchase, inventory] = await Promise.all([
      materialDemand(session, todayInSaoPaulo(), projectId),
      hasOptionalPermission(session, 'supply.plan'),
      hasOptionalPermission(session, 'inventory.reserve'),
      hasOptionalPermission(session, 'inventory.manage'),
      hasOptionalPermission(session, 'procurement.request'),
      hasOptionalPermission(session, 'inventory.view'),
    ]);
    // `inventory`: sem leitura de estoque, "0 em mão" seria mentira — a tela diz que não enxerga.
    return NextResponse.json({ ok: true, today: todayInSaoPaulo(),
      capabilities: { plan, reserve, transfer: manage || reserve, requestPurchase, inventory }, demand: rows });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
