import { NextResponse } from 'next/server';
import { requireCommercialSession, isSessionError } from '@/lib/commercial/server-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A origem comercial de um PROJETO.
 *
 * Devolve uma linha por trabalho autorizado ligado ao projeto — normalmente
 * uma, e mais de uma quando o mesmo projeto executa trabalho de fontes
 * distintas, que é um caso real e não um erro de cadastro.
 */
export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const session = await requireCommercialSession(['projects.view']);
  if (isSessionError(session)) return session.error;
  const { projectId } = await context.params;

  const { data, error } = await session.supabase
    .from('project_commercial_source_chain')
    .select('*')
    .eq('organization_id', session.organizationId)
    .eq('project_id', projectId);
  if (error) {
    return NextResponse.json({ ok: false,
      error: 'Não foi possível ler a origem comercial.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, chains: data ?? [] });
}
