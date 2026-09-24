import { NextResponse } from 'next/server';
import { requireOperationsSession, isSessionError } from '@/lib/operations/session';
import { measurementsQueue } from '@/lib/operations/measurements-queue';
import { todayInSaoPaulo } from '@/lib/operations/projects/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Fila de portfólio das medições — recorte da medição canônica por quem tem o próximo passo. */
export async function GET() {
  const session = await requireOperationsSession(['operations.view']);
  if (isSessionError(session)) return session.error;
  try {
    const { data: financials } = await session.supabase.rpc('current_user_can_view_project_financials');
    const rows = await measurementsQueue(session, financials === true, todayInSaoPaulo());
    return NextResponse.json({ ok: true, today: todayInSaoPaulo(), canSeeValues: financials === true, measurements: rows });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
