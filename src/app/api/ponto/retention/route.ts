import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { purgeSelfies, retentionDaysDefault } from '@/lib/ponto/retention-server';
import { isAutomationEnabled } from '@/lib/ponto/access-server';
import { authorizeCron, wantsDryRun } from '@/lib/ponto/cron-auth';
import { recordJobRun } from '@/lib/ponto/job-runs-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Retenção LGPD das selfies (job agendado). Auth SOMENTE via
 * `Authorization: Bearer <CRON_SECRET>` (nunca query param). Execução
 * limitada (batchSize + duração máx + continuationCursor). KILL SWITCH:
 * automação desligada FORÇA dry-run (não apaga nada).
 *
 * Query/body: dryRun, retentionDays, organizationId, batchSize, cursor.
 */
async function options(req: Request) {
  const url = new URL(req.url);
  let body: Record<string, unknown> = {};
  if (req.method === 'POST') { try { body = (await req.clone().json()) as Record<string, unknown>; } catch { /* sem corpo */ } }
  const num = (q: string, b: unknown) => {
    const raw = url.searchParams.get(q) ?? (typeof b === 'number' ? String(b) : '');
    return Number(raw) > 0 ? Number(raw) : undefined;
  };
  return {
    retentionDays: num('retentionDays', body.retentionDays) ?? retentionDaysDefault(),
    organizationId: url.searchParams.get('organizationId') || (typeof body.organizationId === 'string' ? body.organizationId : null),
    batchSize: num('batchSize', body.batchSize),
    continuationCursor: url.searchParams.get('cursor') || (typeof body.cursor === 'string' ? body.cursor : null),
  };
}

async function handle(req: Request) {
  const denied = authorizeCron(req, 'api/ponto/retention');
  if (denied) return denied;
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const automationEnabled = isAutomationEnabled();
  const requestedDryRun = await wantsDryRun(req);
  const dryRun = requestedDryRun || !automationEnabled; // kill switch força dry-run
  const triggeredBy = req.headers.get('x-vercel-cron') ? 'cron' : 'manual';
  try {
    const opts = await options(req);
    const summary = await purgeSelfies({ ...opts, dryRun });
    void recordJobRun({
      runId, jobType: 'retention',
      organizationId: opts.organizationId,
      status: summary.errors.length ? 'partial' : summary.continuationCursor ? 'partial' : 'success',
      dryRun, automationEnabled, triggeredBy, startedAt,
      scanned: summary.scanned, succeeded: summary.filesDeleted, skipped: Math.max(0, summary.matched - summary.filesDeleted), failed: summary.errors.length,
      errorSummary: summary.errors.length ? summary.errors.join('; ') : null,
      continuationCursor: summary.continuationCursor,
      metadata: { retentionDays: summary.retentionDays, pointersAnonymized: summary.pointersAnonymized, byOrg: summary.byOrg },
    });
    return NextResponse.json({ ok: true, runId, automationEnabled, effectiveMode: dryRun ? 'dry_run' : 'live', requestedDryRun, summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/ponto/retention] failed', { message });
    void recordJobRun({ runId, jobType: 'retention', status: 'failed', dryRun, automationEnabled, triggeredBy, startedAt, errorSummary: message });
    return NextResponse.json({ ok: false, error: `Erro na retenção: ${message}` }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
