/**
 * ENTENDER — `GET /api/dashboard/explain?ref=<kind>:<id>`.
 *
 * Toda pessoa autenticada com organização ativa chega ao Dashboard, e o
 * Dashboard não pode produzir erro no console: por isso a rota responde 200
 * para ref inválida, objeto não encontrado ou restrito (`ok: false` com o
 * motivo no corpo). O `error` repete a mensagem para o leitor genérico da tela
 * (`useResource` mostra `payload.error`).
 *
 * Uma LEITURA que falhou não vira "não encontrado" nem "sem vínculo": ela
 * também responde 200 (sem erro de console), mas com `reason: 'error'` — um
 * motivo que não está no contrato de sucesso e que a tela mostra como falha.
 */
import { NextResponse } from 'next/server';
import { isSessionError, requireCommercialSession } from '@/lib/commercial/server-session';
import { explainRef } from '@/lib/dashboard/explain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

function todayInSaoPaulo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

export async function GET(request: Request) {
  const session = await requireCommercialSession([]);
  if (isSessionError(session)) return session.error;

  const ref = new URL(request.url).searchParams.get('ref') ?? '';
  try {
    const result = await explainRef(session, ref, todayInSaoPaulo());
    const body = result.ok ? result : { ...result, error: result.message };
    return NextResponse.json(body, { status: 200, headers: NO_STORE });
  } catch {
    const message = 'Não foi possível montar a explicação agora. Tente de novo em instantes.';
    return NextResponse.json({ ok: false, reason: 'error', message, error: message }, { status: 200, headers: NO_STORE });
  }
}
