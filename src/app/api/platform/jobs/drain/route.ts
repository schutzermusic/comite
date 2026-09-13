import { NextResponse } from 'next/server';
import { authorizePlatformCron } from '@/lib/platform/cron-auth';
import { drainOnce, DEFAULT_LIMITS } from '@/lib/platform/jobs/worker';
import { isDrainPaused } from '@/lib/platform/jobs/hold';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// O orçamento do trabalhador (50s) fica bem abaixo disto de propósito: a parada
// tem de ser nossa, com o trabalho restante durável, e não uma queda da
// hospedagem no meio de um handler.
export const maxDuration = 120;

/**
 * Uma passagem LIMITADA da fila do Apex.
 *
 * Autorização SOMENTE por `Authorization: Bearer` — nunca query param, nunca
 * sessão de navegador. Um usuário autenticado, por mais permissões que tenha,
 * não drena a fila: RBAC responde "o que este humano pode fazer no produto", e
 * isto não é uma ação de produto.
 *
 * A resposta é contador, jamais payload. Quem lê esta rota está diagnosticando
 * infraestrutura, e infraestrutura não precisa ver o conteúdo do trabalho.
 */
async function handle(req: Request) {
  const auth = authorizePlatformCron(req, 'api/platform/jobs/drain');
  if (!auth.ok) return auth.response;

  const triggeredBy = req.headers.get('x-apex-trigger')
    ?? (req.headers.get('x-vercel-cron') ? 'vercel-cron' : 'manual');

  /*
    Sob trava, a resposta é SUCESSO com `paused: true`.

    Não é erro de propósito: um 5xx faria o agendador da hospedagem registrar o
    cron como quebrado, alertar sobre ele e eventualmente desabilitá-lo — e aí
    a trava, que é temporária e deliberada, viraria um defeito de
    infraestrutura que alguém teria de consertar depois de a trava sair.

    E não relata trabalho processado. Devolver contadores zerados sem dizer
    `paused` seria indistinguível de uma fila vazia, que é exatamente a leitura
    errada: a fila NÃO está vazia, ela está segurada.

    A autorização continua intacta: a trava é lida DEPOIS do portão, porque
    quem não pode drenar também não precisa saber se a drenagem está pausada.
  */
  if (isDrainPaused()) {
    return NextResponse.json({ ok: true, paused: true, triggeredBy });
  }

  try {
    const counters = await drainOnce(DEFAULT_LIMITS);
    return NextResponse.json({ ok: true, paused: false, triggeredBy, counters });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro inesperado.';
    console.error('[api/platform/jobs/drain] failed', { message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// Actions e operadores usam POST; um cron da hospedagem dispararia GET.
export const GET = handle;
export const POST = handle;
