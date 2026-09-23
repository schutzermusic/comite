import { NextResponse } from 'next/server';
import { requireCommercialSession, isSessionError } from '@/lib/commercial/server-session';
import { buildExecutionReview } from '@/lib/commercial/execution-review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** O painel de revisão do fechamento. Leitura pura. */
export async function GET(request: Request) {
  const session = await requireCommercialSession(['commercial.view']);
  if (isSessionError(session)) return session.error;
  const url = new URL(request.url);
  const opportunityId = url.searchParams.get('opportunityId');
  const proposalId = url.searchParams.get('proposalId');
  if (!opportunityId && !proposalId) {
    return NextResponse.json({ ok: false, error: 'Informe a oportunidade ou a proposta.' }, { status: 400 });
  }
  const review = await buildExecutionReview(session, { opportunityId, proposalId });
  if (!review) return NextResponse.json({ ok: false, error: 'Oportunidade ou proposta não encontrada.' }, { status: 404 });
  return NextResponse.json({ ok: true, ...review });
}
