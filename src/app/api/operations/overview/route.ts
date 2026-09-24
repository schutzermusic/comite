import { NextResponse } from 'next/server';
import { requireOperationsSession, isSessionError, hasOptionalPermission } from '@/lib/operations/session';
import { operationsOverview } from '@/lib/operations/overview';
import { todayInSaoPaulo } from '@/lib/operations/projects/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireOperationsSession(['operations.view']);
  if (isSessionError(session)) return session.error;
  const [projects, measurements, risks] = await Promise.all([
    hasOptionalPermission(session, 'projects.view'),
    hasOptionalPermission(session, 'projects.measurements.view'),
    hasOptionalPermission(session, 'risks.view'),
  ]);
  try {
    const overview = await operationsOverview(session,
      { projects, measurements: measurements || projects, risks }, todayInSaoPaulo());
    return NextResponse.json({ ok: true, ...overview });
  } catch {
    return NextResponse.json({ ok: false, error: 'Não foi possível montar a visão geral de Operações.' }, { status: 500 });
  }
}
