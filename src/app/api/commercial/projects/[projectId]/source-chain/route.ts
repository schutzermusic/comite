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
  /*
    O ATO que abriu a execução, quando houve um: base comercial e, sobretudo,
    se a documentação está pendente. A RLS de `commercial_execution_starts`
    libera a leitura a quem vê projeto — esconder a exceção de quem opera o
    projeto é exatamente o que não pode acontecer.
  */
  const engagementIds = ((data ?? []) as Array<{ engagement_id: string }>).map((c) => c.engagement_id);
  const { data: starts } = engagementIds.length
    ? await session.supabase.from('commercial_execution_starts')
        .select('engagement_id,mode,authorization_type,authorization_date,authorization_reference,'
          + 'documentation_state,exception_reason,regularization_due_date,regularized_at')
        .eq('organization_id', session.organizationId).in('engagement_id', engagementIds)
    : { data: [] };
  return NextResponse.json({ ok: true, chains: data ?? [], executionStarts: starts ?? [] });
}
