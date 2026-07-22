/**
 * Autenticação dos endpoints de job agendado do Ponto. SOMENTE via
 * `Authorization: Bearer <CRON_SECRET>` (nunca query param), com comparação
 * de tempo constante. Nunca loga o segredo nem o header completo.
 */
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

function bearerMatches(req: Request, secret: string): boolean {
  const header = req.headers.get('authorization') || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const provided = Buffer.from(m[1]);
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(provided, expected);
  } catch {
    return false;
  }
}

/** Retorna uma resposta de erro (401/503) se não autorizado, ou null se OK. */
export function authorizeCron(req: Request, tag: string): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: 'CRON_SECRET não configurado.' }, { status: 503 });
  if (!bearerMatches(req, secret)) {
    console.warn(`[${tag}] unauthorized request rejected`);
    return NextResponse.json({ ok: false, error: 'Não autorizado.' }, { status: 401 });
  }
  return null;
}

/** dryRun explícito por query/body — NUNCA o segredo por esses canais. */
export async function wantsDryRun(req: Request): Promise<boolean> {
  const url = new URL(req.url);
  if (/^(1|true|yes)$/i.test(url.searchParams.get('dryRun') || '')) return true;
  if (req.method === 'POST') {
    try {
      const body = (await req.clone().json()) as { dryRun?: unknown };
      return body?.dryRun === true;
    } catch {
      return false;
    }
  }
  return false;
}
