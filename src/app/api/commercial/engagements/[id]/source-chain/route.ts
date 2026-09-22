import { NextResponse } from 'next/server';
import { requireCommercialSession, isSessionError } from '@/lib/commercial/server-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A cadeia comercial do trabalho autorizado — OS interna, propostas, contrato
 * quando existe, pedido quando existe.
 *
 * Lê a visão `project_commercial_source_chain`, que é `security_invoker`: a
 * RLS de cada tabela decide o que aparece, e esta rota não contorna nada. Os
 * ids devolvidos são os CANÔNICOS — é por eles que a tela abre o documento
 * original, sem cópia.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireCommercialSession(['contracts.view']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;

  const { data, error } = await session.supabase
    .from('project_commercial_source_chain')
    .select('*')
    .eq('organization_id', session.organizationId)
    .eq('engagement_id', id)
    .limit(1);
  if (error) {
    return NextResponse.json({ ok: false,
      error: 'Não foi possível ler a cadeia comercial.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, chain: data?.[0] ?? null });
}
