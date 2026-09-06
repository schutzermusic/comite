import { NextResponse } from 'next/server';
import { authorizePlatformCron } from '@/lib/platform/cron-auth';
import { drainOnce, DEFAULT_LIMITS } from '@/lib/platform/jobs/worker';

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

  try {
    const counters = await drainOnce(DEFAULT_LIMITS);
    return NextResponse.json({ ok: true, triggeredBy, counters });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro inesperado.';
    console.error('[api/platform/jobs/drain] failed', { message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// Actions e operadores usam POST; um cron da hospedagem dispararia GET.
export const GET = handle;
export const POST = handle;
