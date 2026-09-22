import { NextResponse } from 'next/server';
import { requireCommercialSession, isSessionError, safeGovernedError } from '@/lib/commercial/server-session';
import { compareServiceOrder } from '@/lib/commercial/engagement-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Reconfronta a OS com a fonte regente.
 *
 * Idempotente no que importa: a função só abre divergência que ainda não
 * existe para o mesmo par de fatos, e nunca RESOLVE nada. Reexecutar depois
 * de trocar a fonte regente é o uso previsto.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireCommercialSession(['commercial.service_orders.manage']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  try {
    return NextResponse.json({ ok: true,
      ...(await compareServiceOrder(session.organizationId, id)) });
  } catch (error) {
    return NextResponse.json({ ok: false,
      error: safeGovernedError((error as Error).message) }, { status: 422 });
  }
}
