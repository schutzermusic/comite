import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { isAutomationEnabled, runPontoCron } from '@/lib/ponto/access-server';
import { authorizeCron, wantsDryRun } from '@/lib/ponto/cron-auth';
import { recordJobRun } from '@/lib/ponto/job-runs-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Job agendado do Ponto: auto-provisionamento por alocação + lembretes +
 * detecção de ativações. Autenticação SOMENTE via `Authorization: Bearer
 * <CRON_SECRET>` (nunca query param), comparação de tempo constante.
 * Compatível com Vercel Cron. Sem sessão de usuário.
 *
 * KILL SWITCH: se PONTO_AUTOMATION_ENABLED != true, roda em dry-run (não
 * envia/muta), reportando automationEnabled=false e effectiveMode=dry_run.
 */
async function handle(req: Request) {
  const denied = authorizeCron(req, 'api/ponto/cron');
  if (denied) return denied;
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const automationEnabled = isAutomationEnabled();
  const requestedDryRun = await wantsDryRun(req);
  const effectiveDryRun = requestedDryRun || !automationEnabled; // kill switch força dry-run
  const triggeredBy = req.headers.get('x-vercel-cron') ? 'cron' : 'manual';
  try {
    const origin = new URL(req.url).origin;
    const summary = await runPontoCron(origin, effectiveDryRun);

    // observabilidade (best-effort, sem segredos)
    if ('dryRun' in summary && summary.dryRun) {
      const t = summary.totals;
      void recordJobRun({
        runId, jobType: 'cron', status: 'success', dryRun: true, automationEnabled, triggeredBy, startedAt,
        scanned: t.total, succeeded: t.wouldInvite + t.wouldRemind, skipped: t.wouldSkip, failed: t.wouldFail,
        metadata: { totals: t },
      });
    } else {
      const s = summary as Extract<typeof summary, { dryRun: false }>;
      const failed = s.provisionFailed + s.remindersFailed;
      const succeeded = s.provisioned + s.remindersSent;
      void recordJobRun({
        runId, jobType: 'cron', status: failed > 0 || s.errors.length ? 'partial' : 'success',
        dryRun: false, automationEnabled, triggeredBy, startedAt,
        scanned: succeeded + failed + s.noEmail, succeeded, skipped: s.noEmail, failed,
        errorSummary: s.errors.length ? s.errors.map((e) => e.error).join('; ') : null,
        metadata: { activated: s.activated, provisioned: s.provisioned, noEmail: s.noEmail, remindersSent: s.remindersSent, remindersFailed: s.remindersFailed, orgs: s.orgs },
      });
    }

    return NextResponse.json({ ok: true, runId, automationEnabled, effectiveMode: effectiveDryRun ? 'dry_run' : 'live', dryRun: effectiveDryRun, requestedDryRun, summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/ponto/cron] failed', { message });
    void recordJobRun({ runId, jobType: 'cron', status: 'failed', dryRun: effectiveDryRun, automationEnabled, triggeredBy, startedAt, errorSummary: message });
    return NextResponse.json({ ok: false, error: `Erro no cron: ${message}` }, { status: 500 });
  }
}

// Vercel Cron dispara GET; agentes externos podem usar POST. Demais métodos → 405.
export const GET = handle;
export const POST = handle;
