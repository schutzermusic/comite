import { NextResponse } from 'next/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import { getConfig, listRecentRuns, readCompetenceMetrics } from '@/lib/esocial/connector/store';
import { hasCertKey } from '@/lib/esocial/connector/secrets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Saúde do conector: o que está configurado, quando rodou pela última vez e
 * quantas competências já foram apuradas. Não expõe segredo nem certificado.
 */
export async function GET() {
  const r = await resolvePayrollActor('admin.manage_integrations');
  if (!r.ok) return r.response;

  const config = await getConfig(r.actor.organizationId);
  if (!config) {
    return NextResponse.json({
      ok: true,
      configured: false,
      automationEnabled: false,
      certKeyConfigured: hasCertKey(),
    });
  }

  const [runs, metrics] = await Promise.all([
    listRecentRuns(r.actor.organizationId, 1),
    readCompetenceMetrics(r.actor.organizationId),
  ]);

  const certExpiresAt = config.cert_expires_at ? new Date(config.cert_expires_at) : null;
  const daysToExpiry = certExpiresAt
    ? Math.round((certExpiresAt.getTime() - Date.now()) / 86_400_000)
    : null;

  return NextResponse.json({
    ok: true,
    configured: Boolean(config.cert_storage_path),
    automationEnabled: false,
    certKeyConfigured: hasCertKey(),
    environment: config.environment,
    autoSyncEnabled: config.auto_sync_enabled,
    syncFrequency: config.sync_frequency,
    lastSyncAt: config.last_sync_at,
    lastSyncStatus: config.last_sync_status,
    nextSyncAt: config.next_sync_at,
    certificate: config.cert_storage_path
      ? { subject: config.cert_subject, expiresAt: config.cert_expires_at, daysToExpiry }
      : null,
    competencesAvailable: metrics.length,
    lastCompetence: metrics[metrics.length - 1]?.competence ?? null,
    lastRun: runs[0] ?? null,
  });
}
