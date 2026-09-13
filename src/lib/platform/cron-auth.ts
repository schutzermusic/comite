/**
 * Autorização dos entrypoints de execução da PLATAFORMA.
 *
 * ─── Dois chamadores, e não um com fallback ────────────────────────────────
 *
 * Este módulo aceitava `APEX_JOBS_SECRET || CRON_SECRET` — UM segredo, escolhido
 * por precedência. O efeito era uma armadilha silenciosa: num ambiente onde
 * ambos existem, o agendador nativo da hospedagem apresenta `CRON_SECRET`, o
 * módulo compara com `APEX_JOBS_SECRET` porque este existe, e a credencial
 * VÁLIDA é recusada com 401. A fila para, e o log diz apenas "não autorizado".
 *
 * O desenho correto não tem precedência: tem duas CLASSES de chamador, cada uma
 * com o seu segredo, e uma requisição autentica se casar com qualquer uma.
 *
 *   A. `vercel_cron`  — agendador nativo da hospedagem, Bearer CRON_SECRET
 *   B. `apex_jobs`    — agendador/operador do Apex, Bearer APEX_JOBS_SECRET
 *
 * Segredos separados porque as superfícies são separadas: quem pode acordar o
 * cron da hospedagem não deveria, por isso, poder drenar a fila do Apex a
 * qualquer instante — e vice-versa. Manter os dois independentes é o que impede
 * um alargamento de privilégio disfarçado de reuso.
 *
 * ─── O que NUNCA é aceito ──────────────────────────────────────────────────
 *
 * Query string. Corpo. Cookie. Sessão de navegador. Um humano autenticado, por
 * mais permissões de produto que tenha, não drena a fila: RBAC responde "o que
 * esta pessoa pode fazer no produto", e drenar fila não é uma ação de produto.
 * O cabeçalho `x-vercel-cron` também não autentica nada — ele é uma DICA de
 * origem, trivialmente forjável, e só aparece em log depois de a credencial já
 * ter sido validada.
 *
 * ─── O que nunca sai daqui ─────────────────────────────────────────────────
 *
 * O valor de nenhum dos dois segredos, nem prefixo, nem comprimento, nem o
 * header recebido — nem em resposta, nem em log. O que sai é a CLASSE que
 * autenticou, que é um nome fixo do código e não um dado do ambiente.
 */
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

/** A classe de chamador que autenticou. Nome fixo, nunca valor de segredo. */
export type CronCallerClass = 'vercel_cron' | 'apex_jobs';

export type CronAuthResult =
  | {
      readonly ok: true;
      readonly caller: CronCallerClass;
      /** Qual variável forneceu a credencial. O NOME, jamais o valor. */
      readonly secretSource: 'APEX_JOBS_SECRET' | 'CRON_SECRET';
    }
  | { readonly ok: false; readonly response: NextResponse };

/**
 * As duas credenciais aceitas, na ordem em que são tentadas.
 *
 * A ordem é irrelevante para o resultado — as duas são tentadas até uma casar —
 * e existe só para tornar o laço determinístico e testável.
 */
const CREDENTIALS: readonly {
  readonly caller: CronCallerClass;
  readonly envName: 'APEX_JOBS_SECRET' | 'CRON_SECRET';
}[] = [
  { caller: 'apex_jobs', envName: 'APEX_JOBS_SECRET' },
  { caller: 'vercel_cron', envName: 'CRON_SECRET' },
];

/** O token apresentado, ou null. SOMENTE `Authorization: Bearer`. */
function bearerToken(req: Request): Buffer | null {
  const header = req.headers.get('authorization') || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? Buffer.from(m[1]) : null;
}

/**
 * Comparação de tempo constante.
 *
 * Comprimentos diferentes não vão ao `timingSafeEqual` — ele lança. A saída
 * antecipada revela o TAMANHO do segredo, que não é o segredo; revelar isso é
 * o preço conhecido e aceito desta primitiva.
 */
function matches(provided: Buffer, secret: string): boolean {
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(provided, expected);
  } catch {
    return false;
  }
}

export function authorizePlatformCron(req: Request, tag: string): CronAuthResult {
  const configured = CREDENTIALS
    .map((c) => ({ ...c, secret: process.env[c.envName] }))
    .filter((c): c is typeof c & { secret: string } => Boolean(c.secret));

  if (configured.length === 0) {
    /*
      Nenhuma das duas configurada. 503 e não 401: a requisição pode estar
      perfeitamente correta, e o que falta é configuração do ambiente. Dizer
      "não autorizado" mandaria quem opera procurar o erro no lugar errado.
    */
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: 'Nenhuma credencial de agendador configurada.' }, { status: 503 }),
    };
  }

  const provided = bearerToken(req);
  if (provided) {
    /*
      TODAS as credenciais configuradas são tentadas, sem precedência. Parar na
      primeira que existe — e não na primeira que CASA — era exatamente o
      defeito: um `CRON_SECRET` válido recusado porque `APEX_JOBS_SECRET`
      também estava definido.

      O laço não sai cedo em caso de acerto: percorrer sempre as duas mantém o
      custo independente de QUAL credencial casou.
    */
    let authenticated: (typeof configured)[number] | null = null;
    for (const candidate of configured) {
      if (matches(provided, candidate.secret)) authenticated = authenticated ?? candidate;
    }
    if (authenticated) {
      return { ok: true, caller: authenticated.caller, secretSource: authenticated.envName };
    }
  }

  // Nunca o header, nunca o segredo, nunca o prefixo. Só que houve recusa.
  console.warn(`[${tag}] unauthorized request rejected`);
  return {
    ok: false,
    response: NextResponse.json({ ok: false, error: 'Não autorizado.' }, { status: 401 }),
  };
}
