/**
 * Observabilidade dos jobs do Ponto (server-only). Registra cada execução
 * dos jobs agendados em ponto_job_runs — sem tokens, senhas, headers ou
 * conteúdo de selfie. Escrita via service role (bypassa RLS); leitura pela
 * sessão do usuário (RLS: gestor/admin).
 */
if (typeof window !== 'undefined') {
  throw new Error('src/lib/ponto/job-runs-server.ts must not be imported in the browser');
}

import { getServiceClient } from '@/lib/ai/server-clients';

export interface JobRunRecord {
  runId: string;
  jobType: 'cron' | 'provisioning' | 'reminders' | 'retention';
  organizationId?: string | null;
  status: 'success' | 'partial' | 'failed';
  dryRun: boolean;
  automationEnabled: boolean;
  scanned?: number;
  succeeded?: number;
  skipped?: number;
  failed?: number;
  errorSummary?: string | null;
  continuationCursor?: string | null;
  triggeredBy?: string | null;
  metadata?: Record<string, unknown>;
  startedAt?: string;
}

/** Grava um registro de execução. Nunca lança (observabilidade best-effort). */
export async function recordJobRun(rec: JobRunRecord): Promise<void> {
  try {
    const service = getServiceClient();
    await service.from('ponto_job_runs').insert({
      run_id: rec.runId,
      job_type: rec.jobType,
      organization_id: rec.organizationId ?? null,
      started_at: rec.startedAt ?? new Date().toISOString(),
      completed_at: new Date().toISOString(),
      status: rec.status,
      dry_run: rec.dryRun,
      automation_enabled: rec.automationEnabled,
      scanned: rec.scanned ?? 0,
      succeeded: rec.succeeded ?? 0,
      skipped: rec.skipped ?? 0,
      failed: rec.failed ?? 0,
      error_summary: rec.errorSummary ? rec.errorSummary.slice(0, 1000) : null,
      continuation_cursor: rec.continuationCursor ?? null,
      triggered_by: rec.triggeredBy ?? null,
      metadata: rec.metadata ?? {},
    });
  } catch (e) {
    console.error('[ponto/job-runs] failed to record', { message: e instanceof Error ? e.message : String(e) });
  }
}
