import { NextResponse } from 'next/server';
import { requireOperationsSession, isSessionError } from '@/lib/operations/session';
import { supplyOverview } from '@/lib/supply/read-model';
import { todayInSaoPaulo } from '@/lib/operations/projects/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Torre de controle do Supply: só números com fonte — cada um abre registros reais. */
export async function GET() {
  const session = await requireOperationsSession(['supply.view']);
  if (isSessionError(session)) return session.error;
  try {
    return NextResponse.json({ ok: true, ...(await supplyOverview(session, todayInSaoPaulo())) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
