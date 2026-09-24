import { NextResponse } from 'next/server';
import { requireAnyOperationsPermission, isSessionError, hasOptionalPermission } from '@/lib/operations/session';
import { operationsMap } from '@/lib/operations/map';
import { todayInSaoPaulo } from '@/lib/operations/projects/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Mapa de Operações. Projetos e obras com `projects.view` (ou `operations.view`);
 * posição de equipe SÓ com `people.attendance_view` — a mesma alçada que vê o
 * fix de GPS na Revisão de Ponto.
 */
export async function GET() {
  const session = await requireAnyOperationsPermission(['projects.view', 'operations.view']);
  if (isSessionError(session)) return session.error;
  const [team, risks] = await Promise.all([
    hasOptionalPermission(session, 'people.attendance_view'),
    hasOptionalPermission(session, 'risks.view'),
  ]);
  try {
    return NextResponse.json({ ok: true, ...(await operationsMap(session, { team, risks }, todayInSaoPaulo())) });
  } catch {
    return NextResponse.json({ ok: false, error: 'Não foi possível montar o mapa de operações.' }, { status: 500 });
  }
}
