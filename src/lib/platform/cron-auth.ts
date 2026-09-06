/**
 * Autorização dos entrypoints de execução da PLATAFORMA.
 *
 * ─── Mesmo desenho do Ponto, deliberadamente ───────────────────────────────
 *
 * `src/lib/ponto/cron-auth.ts` já provou este desenho em produção: segredo
 * SOMENTE em `Authorization: Bearer`, comparação de tempo constante, nada em
 * query string, nada no log. Este módulo é o mesmo desenho aplicado à
 * plataforma.
 *
 * Por que não IMPORTAR aquele: ele lê `CRON_SECRET`, que é o segredo do Ponto.
 * Fazer a Plataforma compartilhar o segredo do Ponto significaria que quem pode
 * acordar o cron do Ponto pode drenar a fila do Apex, e vice-versa — um
 * alargamento de privilégio disfarçado de reuso. Segredos separados mantêm as
 * duas superfícies separadas, e nenhuma linha do Ponto muda por causa desta
 * fase.
 *
 * `APEX_JOBS_SECRET` cai para `CRON_SECRET` só quando o primeiro não está
 * configurado, para que um ambiente que ainda não recebeu o segredo novo não
 * fique com a fila parada e sem explicação. A rota diz qual dos dois validou.
 */
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

export type CronAuthResult =
  | { readonly ok: true; readonly secretSource: 'APEX_JOBS_SECRET' | 'CRON_SECRET' }
  | { readonly ok: false; readonly response: NextResponse };

function bearerMatches(req: Request, secret: string): boolean {
  const header = req.headers.get('authorization') || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const provided = Buffer.from(m[1]);
  const expected = Buffer.from(secret);
  // Comprimentos diferentes não vão ao timingSafeEqual (ele lança); a saída
  // antecipada só revela o TAMANHO, que não é o segredo.
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(provided, expected);
  } catch {
    return false;
  }
}

export function authorizePlatformCron(req: Request, tag: string): CronAuthResult {
  const apex = process.env.APEX_JOBS_SECRET;
  const fallback = process.env.CRON_SECRET;
  const secret = apex || fallback;
  const secretSource = apex ? 'APEX_JOBS_SECRET' : 'CRON_SECRET';

  if (!secret) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: 'APEX_JOBS_SECRET não configurado.' }, { status: 503 }),
    };
  }
  if (!bearerMatches(req, secret)) {
    // Nunca o header, nunca o segredo, nunca o prefixo. Só que houve recusa.
    console.warn(`[${tag}] unauthorized request rejected`);
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: 'Não autorizado.' }, { status: 401 }),
    };
  }
  return { ok: true, secretSource };
}
