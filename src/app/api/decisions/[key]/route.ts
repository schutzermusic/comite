import { NextResponse } from 'next/server';
import { requireCommercialSession, isSessionError } from '@/lib/commercial/server-session';
import { parseDecisionKey } from '@/lib/decisions/model';
import { decisionDetail, decisionKeyParam, decisionsReadFailure, NO_STORE } from '@/lib/decisions/read';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Uma decisão: por que chegou, o que está em jogo, o que acontece depois.
 * "Não existe" e "é de outro inquilino" têm a MESMA resposta (404): a chave
 * só é resolvida dentro da organização ativa.
 */
export async function GET(_request: Request, context: { params: Promise<{ key: string }> }) {
  const session = await requireCommercialSession([]);
  if (isSessionError(session)) return session.error;
  const key = decisionKeyParam((await context.params).key);
  if (!parseDecisionKey(key)) return NextResponse.json({ ok: false, error: 'Chave de decisão inválida.' }, { status: 400, headers: NO_STORE });
  try {
    const detail = await decisionDetail(session, key);
    if (!detail) return NextResponse.json({ ok: false, error: 'Decisão não encontrada.' }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ ok: true, ...detail }, { headers: NO_STORE });
  } catch (error) {
    return decisionsReadFailure(error);
  }
}
