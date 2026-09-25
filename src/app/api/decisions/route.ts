import { NextResponse } from 'next/server';
import { requireCommercialSession, isSessionError } from '@/lib/commercial/server-session';
import { decisionsReadFailure, decisionsWorkspace, isDecisionsTab, NO_STORE } from '@/lib/decisions/read';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Decisões: "o que precisa de mim agora". Toda pessoa autenticada com
 * organização ativa tem a própria caixa — quem decide o quê é a projeção do
 * banco (240), não uma permissão de rota. Minhas vem sempre; Equipe e
 * Concluídas, pela aba.
 */
export async function GET(request: Request) {
  const session = await requireCommercialSession([]);
  if (isSessionError(session)) return session.error;
  const tab = new URL(request.url).searchParams.get('tab') ?? 'minhas';
  if (!isDecisionsTab(tab)) {
    return NextResponse.json({ ok: false, error: 'Aba inválida: use minhas, equipe ou concluidas.' }, { status: 400, headers: NO_STORE });
  }
  try {
    const workspace = await decisionsWorkspace(session, tab);
    return NextResponse.json({ ok: true, ...workspace }, { headers: NO_STORE });
  } catch (error) {
    return decisionsReadFailure(error);
  }
}
