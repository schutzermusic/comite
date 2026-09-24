import { NextResponse } from 'next/server';
import { requireOperationsSession, isSessionError } from '@/lib/operations/session';
import { projectOverview } from '@/lib/operations/projects/read-model';
import { projectAccess, todayInSaoPaulo } from '@/lib/operations/projects/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Visão geral do projeto: saúde explicada, próximos marcos, bloqueios, medição, equipe, OS. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireOperationsSession(['projects.view']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  try {
    const access = await projectAccess(session);
    const overview = await projectOverview(session, id, access, todayInSaoPaulo());
    if (!overview) return NextResponse.json({ ok: false, error: 'Projeto não encontrado.' }, { status: 404 });
    return NextResponse.json({ ok: true, access, ...overview });
  } catch {
    return NextResponse.json({ ok: false, error: 'Não foi possível montar a visão geral do projeto.' }, { status: 500 });
  }
}
