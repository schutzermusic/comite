import { NextResponse } from 'next/server';
import { authorizePlatformCron } from '@/lib/platform/cron-auth';
import { drainOnce, DEFAULT_LIMITS } from '@/lib/platform/jobs/worker';
import { isDrainPaused } from '@/lib/platform/jobs/hold';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/*
  O orçamento do trabalhador (50s) fica bem abaixo disto de propósito: a parada
  tem de ser nossa, com o trabalho restante durável, e não uma queda da
  hospedagem no meio de um handler. Era 120s, curto demais para a etapa longa de
  operacionalização (450s de provedor + persistência) que este trabalhador pode
  reivindicar.

  600s é o teto que ESTA aplicação configura, não um máximo da plataforma: o
  projeto está no Pro (verificado na API da Vercel), roda `nodejs24.x` com Fluid
  Compute, e ali o máximo configurável é 800s. Paramos em 600 de propósito — 50s
  de reivindicação + 450s de provedor + 45s de persistência são 545s, o que
  deixa 55s de folga de hospedagem e 200s entre nós e o limite do plano.

  O valor é literal porque o Next exige que `maxDuration` seja estaticamente
  analisável. Ele é cruzado em teste com APEX_CONFIGURED_HOST_CEILING
  (src/lib/platform/jobs/budget.ts).
*/
export const maxDuration = 600;

/**
 * Uma passagem LIMITADA da fila do Apex.
 *
 * ─── Quem pode chamar ──────────────────────────────────────────────────────
 *
 * Duas CLASSES de chamador, cada uma com o seu segredo, ambas por
 * `Authorization: Bearer`: o agendador nativo da hospedagem (`vercel_cron`) e o
 * agendador/operador do Apex (`apex_jobs`). Nunca query param, nunca sessão de
 * navegador — um usuário autenticado, por mais permissões que tenha, não drena
 * a fila: RBAC responde "o que este humano pode fazer no produto", e isto não é
 * uma ação de produto.
 *
 * ─── Cadência, e o bloqueio que ela tem hoje ───────────────────────────────
 *
 * A concessão de um trabalho dura 5 minutos. Um trabalho morto por queda da
 * hospedagem só volta a ser visível quando alguém CEIFA — e a ceifa acontece
 * nesta rota. Com o cron diário que o projeto tem hoje, um trabalho que morre
 * às 06h05 fica invisível por quase 24 horas.
 *
 * O plano de produção verificado é HOBBY, e no Hobby o agendador nativo da
 * No Hobby, a Vercel só aceitava cadência DIÁRIA, e era isso que prendia
 * `vercel.json` em `0 6 * * *`: declarar ali uma cadência de dez em dez minutos
 * que o plano não suportava faria o deploy falhar, ou o cron silenciosamente
 * não rodar — trocar um bloqueio visível por um invisível.
 *
 * INFRA_BLOCKER: SUB_DAILY_SCHEDULER_REQUIRED — a CAUSA caiu, a decisão não foi
 * tomada. O projeto está agora no Pro (verificado na API da Vercel), e o Pro
 * aceita cadência sub-diária: o que impedia declará-la aqui deixou de existir.
 * Mudá-la continua sendo uma decisão de operação, com custo de execução próprio,
 * e não um efeito colateral de o plano ter mudado — por isso `vercel.json`
 * continua com `0 6 * * *` até que alguém decida o contrário por escrito. Um
 * serviço de cron terceiro continua resolvendo o sintoma criando uma credencial
 * a mais para vazar e mais uma dependência fora do inventário. Nada é
 * configurado nem comprado por este código.
 *
 * A resposta é contador, jamais payload. Quem lê esta rota está diagnosticando
 * infraestrutura, e infraestrutura não precisa ver o conteúdo do trabalho.
 */
async function handle(req: Request) {
  const auth = authorizePlatformCron(req, 'api/platform/jobs/drain');
  if (!auth.ok) return auth.response;

  /*
    `triggeredBy` é o que a requisição AFIRMA, e vale como rótulo de
    diagnóstico. `caller` é o que ela PROVOU, apresentando uma credencial. Os
    dois aparecem porque são coisas diferentes, e confundi-los faria um
    cabeçalho forjável parecer autenticação.
  */
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
    return NextResponse.json({ ok: true, paused: false, triggeredBy, caller: auth.caller, counters });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro inesperado.';
    console.error('[api/platform/jobs/drain] failed', { message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// Actions e operadores usam POST; um cron da hospedagem dispararia GET.
export const GET = handle;
export const POST = handle;
