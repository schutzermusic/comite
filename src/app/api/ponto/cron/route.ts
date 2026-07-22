import { NextResponse } from 'next/server';
import { runPontoCron } from '@/lib/ponto/access-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Job agendado do Ponto: auto-provisionamento por alocação + lembretes de
 * convite + detecção de ativações. Protegido por CRON_SECRET (Bearer) —
 * compatível com Vercel Cron (que envia Authorization: Bearer $CRON_SECRET)
 * e com qualquer agente/cron externo. NÃO usa sessão de usuário.
 */
function authorize(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET não configurado no servidor.' }, { status: 503 });
  }
  const header = req.headers.get('authorization') || '';
  const bearer = header.replace(/^Bearer\s+/i, '');
  const alt = req.headers.get('x-cron-secret') || '';
  if (bearer !== secret && alt !== secret) {
    return NextResponse.json({ ok: false, error: 'Não autorizado.' }, { status: 401 });
  }
  return null;
}

async function wantsDryRun(req: Request): Promise<boolean> {
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

async function handle(req: Request) {
  const denied = authorize(req);
  if (denied) return denied;
  try {
    const origin = new URL(req.url).origin;
    const dryRun = await wantsDryRun(req);
    const result = await runPontoCron(origin, dryRun);
    return NextResponse.json({ ok: true, dryRun, summary: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/ponto/cron] failed', { message });
    return NextResponse.json({ ok: false, error: `Erro no cron: ${message}` }, { status: 500 });
  }
}

// Vercel Cron dispara GET; agentes externos podem usar POST.
export const GET = handle;
export const POST = handle;
