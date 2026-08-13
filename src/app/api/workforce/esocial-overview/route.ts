import { NextResponse } from 'next/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import {
  countActiveEmployments,
  getConfig,
  listRecentRuns,
  readAreaMetrics,
  readCompetenceMetrics,
} from '@/lib/esocial/connector/store';
import type { EsocialLinkState } from '@/lib/workforce/compliance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Recorte do eSocial para o cockpit de Pessoas & Custos.
 *
 * Devolve apenas agregados já normalizados (nunca XML, nunca CPF), por isso
 * basta `people.view` — diferente das rotas de administração da integração,
 * restritas a `admin.manage_integrations`.
 *
 * Quando não há nada sincronizado, responde `connected: false` com listas
 * vazias: a Visão Geral segue funcionando com os dados da folha importada.
 */
export async function GET(req: Request) {
  const r = await resolvePayrollActor('people.view');
  if (!r.ok) return r.response;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from') ?? undefined;

  const config = await getConfig(r.actor.organizationId);

  // Com ingestão por importação, o que define "ligado" é haver evento
  // ingerido — não haver certificado, que no desenho somente-leitura é opcional.
  const metrics = config ? await readCompetenceMetrics(r.actor.organizationId, from) : [];

  if (metrics.length === 0) {
    const link: EsocialLinkState = {
      connected: false,
      environment: config?.environment === 'restricted' ? 'homologation' : 'production',
      certificateStatus: 'not_configured',
      importedEventsCount: 0,
      failedEventsCount: 0,
      automationEnabled: false,
      safeMessage: config
        ? 'Nenhum evento importado ainda — importe o pacote do eSocial Download.'
        : 'Integração eSocial ainda não configurada.',
    };
    return NextResponse.json({
      ok: true,
      link,
      competences: [],
      areas: [],
      activeHeadcount: 0,
      recentRuns: [],
    });
  }

  const competences = metrics;
  const [areas, activeHeadcount, runs] = await Promise.all([
    readAreaMetrics(r.actor.organizationId, from),
    countActiveEmployments(r.actor.organizationId),
    listRecentRuns(r.actor.organizationId, 5),
  ]);

  const expiresAt = config?.cert_expires_at ? new Date(config.cert_expires_at) : null;
  const now = Date.now();
  const certificateStatus: EsocialLinkState['certificateStatus'] = !expiresAt
    ? 'not_configured'
    : expiresAt.getTime() < now
      ? 'expired'
      : expiresAt.getTime() - now < 30 * 86_400_000
        ? 'expiring'
        : 'valid';

  const totalEvents = competences.reduce((s, c) => s + c.source_event_count, 0);
  const failedRuns = runs.filter((run) => (run as { status: string }).status === 'failed').length;

  const link: EsocialLinkState = {
    // "Ligado" = há competência apurada alimentando os indicadores.
    connected: true,
    environment: config?.environment === 'restricted' ? 'homologation' : 'production',
    certificateStatus,
    certificateExpiresAt: config?.cert_expires_at ?? undefined,
    lastSyncAt: config?.last_sync_at ?? undefined,
    nextScheduledSyncAt: config?.next_sync_at ?? undefined,
    importedEventsCount: totalEvents,
    failedEventsCount: failedRuns,
    automationEnabled: false,
    safeMessage:
      config?.last_sync_status === 'failed'
        ? 'A última importação falhou — verifique o histórico na tela de integrações.'
        : `${competences.length} competência(s) apurada(s) a partir do eSocial.`,
  };

  return NextResponse.json({
    ok: true,
    link,
    competences,
    areas,
    activeHeadcount,
    recentRuns: runs,
  });
}
