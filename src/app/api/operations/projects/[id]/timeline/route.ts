import { NextResponse } from 'next/server';
import { requireOperationsSession, isSessionError } from '@/lib/operations/session';
import { projectTimeline } from '@/lib/operations/projects/read-model';
import { projectAccess } from '@/lib/operations/projects/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Timeline do projeto: um fluxo cronológico montado das histórias canônicas de cada domínio. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireOperationsSession(['projects.view']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  try {
    const access = await projectAccess(session);
    const events = await projectTimeline(session, id, access);
    if (!events) return NextResponse.json({ ok: false, error: 'Projeto não encontrado.' }, { status: 404 });
    return NextResponse.json({ ok: true, access, events });
  } catch {
    return NextResponse.json({ ok: false, error: 'Não foi possível montar a timeline do projeto.' }, { status: 500 });
  }
}
