import { NextResponse } from 'next/server';
import { purgeSelfies, retentionDaysDefault } from '@/lib/ponto/retention-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Retenção LGPD das selfies (job agendado). Protegido por CRON_SECRET.
 * `?dryRun=1` (ou body.dryRun) só conta; `?retentionDays=N` sobrepõe o
 * default (PONTO_SELFIE_RETENTION_DAYS, ou 90); `?organizationId=` restringe.
 */
function authorize(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: 'CRON_SECRET não configurado.' }, { status: 503 });
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const alt = req.headers.get('x-cron-secret') || '';
  if (bearer !== secret && alt !== secret) return NextResponse.json({ ok: false, error: 'Não autorizado.' }, { status: 401 });
  return null;
}

async function params(req: Request): Promise<{ dryRun: boolean; retentionDays: number; organizationId: string | null }> {
  const url = new URL(req.url);
  let body: { dryRun?: unknown; retentionDays?: unknown; organizationId?: unknown } = {};
  if (req.method === 'POST') {
    try { body = (await req.clone().json()) as typeof body; } catch { /* sem corpo */ }
  }
  const dryRun = /^(1|true|yes)$/i.test(url.searchParams.get('dryRun') || '') || body.dryRun === true;
  const rdRaw = url.searchParams.get('retentionDays') ?? (typeof body.retentionDays === 'number' ? String(body.retentionDays) : '');
  const retentionDays = Number(rdRaw) > 0 ? Number(rdRaw) : retentionDaysDefault();
  const organizationId = url.searchParams.get('organizationId') || (typeof body.organizationId === 'string' ? body.organizationId : null);
  return { dryRun, retentionDays, organizationId };
}

async function handle(req: Request) {
  const denied = authorize(req);
  if (denied) return denied;
  try {
    const { dryRun, retentionDays, organizationId } = await params(req);
    const summary = await purgeSelfies({ dryRun, retentionDays, organizationId });
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/ponto/retention] failed', { message });
    return NextResponse.json({ ok: false, error: `Erro na retenção: ${message}` }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
