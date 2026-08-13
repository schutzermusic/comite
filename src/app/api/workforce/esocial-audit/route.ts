import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import {
  EsocialSchemaMissingError,
  findExistingReceipts,
  getConfig,
  listRecentRuns,
  readAreaMetrics,
  readAuditCounts,
  readCompetenceMetrics,
  readEventIndex,
} from '@/lib/esocial/connector/store';
import {
  buildClosures,
  buildCompetenceCoverage,
  buildDivergences,
  buildExclusions,
  buildOrigins,
  buildRubricGaps,
  buildUnmappedLotacoes,
  countEventsByType,
  eventTypeCountsFromAggregate,
  originsFromAggregate,
  type CostCenterLike,
  type PayrollCompetenceFacts,
} from '@/lib/workforce/esocial-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Controle eSocial — o estado do acervo, não o estado do negócio.
 *
 * Alimenta a aba "Controle eSocial" dentro de Fechamento da Folha. Vive
 * separado do cockpit porque responde a outra pergunta ("o que eu tenho e o
 * que falta"), e separado de Governança porque log de transmissão não é
 * exceção operacional classificada para análise.
 *
 * `people.view`, como a rota de visão geral: só agregados e contagens, nunca
 * XML e nunca CPF.
 */
export async function GET() {
  const r = await resolvePayrollActor('people.view');
  if (!r.ok) return r.response;

  const organizationId = r.actor.organizationId;

  let config;
  let metrics;
  let areas;
  let counts;
  let controlEvents;
  let runs;
  try {
    config = await getConfig(organizationId);
    [metrics, areas, counts, controlEvents, runs] = await Promise.all([
      readCompetenceMetrics(organizationId),
      readAreaMetrics(organizationId),
      // Contagens no banco (migration 086). `null` = migration pendente.
      readAuditCounts(organizationId),
      // Só os eventos que o painel lista um a um. S-1299 e S-3000 são dezenas
      // por ano; o resto do acervo nunca precisa entrar em memória.
      readEventIndex(organizationId, ['S-1299', 'S-3000']),
      listRecentRuns(organizationId, 20),
    ]);
  } catch (err) {
    if (err instanceof EsocialSchemaMissingError) {
      return NextResponse.json({
        ok: true,
        available: false,
        message: 'A ingestão do eSocial ainda não foi provisionada nesta base.',
      });
    }
    throw err;
  }

  if (metrics.length === 0 && controlEvents.length === 0) {
    return NextResponse.json({
      ok: true,
      available: true,
      connected: false,
      message: config
        ? 'Nenhum evento importado ainda — importe o pacote do eSocial Download.'
        : 'Integração eSocial ainda não configurada.',
    });
  }

  // Centros de custo e apelidos: lidos com a sessão do usuário (RLS), porque
  // são dados do módulo financeiro e não do conector.
  const supabase = await createClient();
  const [{ data: costCenterRows }, { data: aliasRows }, { data: batchRows }] = await Promise.all([
    supabase.from('finance_cost_centers').select('id, code, name').eq('organization_id', organizationId),
    supabase
      .from('payroll_cost_center_mappings')
      .select('normalized_name')
      .eq('organization_id', organizationId),
    supabase
      .from('payroll_closing_batches')
      .select('competence_month, headcount, gross_amount_cents, total_amount_cents')
      .eq('organization_id', organizationId)
      .in('status', ['approved', 'sent_to_finance']),
  ]);

  const costCenters: CostCenterLike[] = (costCenterRows ?? []).map((c) => ({
    id: String(c.id),
    code: String(c.code ?? ''),
    name: String(c.name ?? ''),
  }));
  const aliasKeys = new Set(
    (aliasRows ?? [])
      .map((a) => String(a.normalized_name ?? '').trim().toLowerCase())
      .filter(Boolean),
  );

  const payrollFacts: PayrollCompetenceFacts[] = (batchRows ?? []).map((b) => ({
    competence: String(b.competence_month),
    headcount: b.headcount != null ? Number(b.headcount) : null,
    // A folha bruta é a referência comparável ao que o eSocial declara; o total
    // do lote inclui encargos e benefícios e compararia coisas diferentes.
    grossCents: b.gross_amount_cents != null ? Number(b.gross_amount_cents) : null,
  }));

  const esocialGrossByCompetence = new Map<string, number>();
  for (const area of areas) {
    esocialGrossByCompetence.set(
      area.competence,
      (esocialGrossByCompetence.get(area.competence) ?? 0) + area.gross_cents,
    );
  }

  // Só os recibos que os S-3000 citam — em vez do acervo inteiro em memória
  // só para saber se o alvo da exclusão ainda existe.
  const targetReceipts = controlEvents
    .filter((e) => e.event_type === 'S-3000')
    .map((e) => (e.metadata?.exclusion as { targetReceipt?: string } | undefined)?.targetReceipt)
    .filter((r): r is string => Boolean(r));
  const existingReceipts = await findExistingReceipts(organizationId, targetReceipts);

  // Contagens: do banco quando a 086 está aplicada; da leitura em memória
  // quando não está. O painel não desaparece por causa de migration pendente.
  const fallbackEvents = counts ? [] : await readEventIndex(organizationId);
  const eventsByType = counts
    ? eventTypeCountsFromAggregate(counts.byType)
    : countEventsByType(fallbackEvents);
  const origins = counts ? originsFromAggregate(counts.byOrigin) : buildOrigins(fallbackEvents);

  const eventCountByCompetence = new Map<string, number>();
  if (counts) {
    for (const row of counts.byCompetence) {
      eventCountByCompetence.set(row.competence, Number(row.total));
    }
  } else {
    for (const ev of fallbackEvents) {
      if (!ev.competence || ev.event_type === 'RETORNO-LOTE') continue;
      eventCountByCompetence.set(ev.competence, (eventCountByCompetence.get(ev.competence) ?? 0) + 1);
    }
  }

  const closedCompetences = new Set(
    controlEvents
      .filter((e) => e.event_type === 'S-1299' && e.competence)
      .map((e) => e.competence as string),
  );

  const coverage = buildCompetenceCoverage(metrics, { eventCountByCompetence, closedCompetences });

  return NextResponse.json({
    ok: true,
    available: true,
    connected: true,
    lastSyncAt: config?.last_sync_at ?? null,
    lastSyncStatus: config?.last_sync_status ?? null,
    // Diz de onde vieram as contagens: sem a 086 elas são exatas do mesmo
    // jeito, só caras — e isso precisa ser observável, não silencioso.
    countsSource: counts ? 'sql' : 'memory',
    competences: coverage.rows,
    missingCompetences: coverage.missing,
    eventsByType,
    exclusions: buildExclusions(controlEvents, existingReceipts),
    closures: buildClosures(controlEvents),
    origins,
    rubricGaps: buildRubricGaps(metrics),
    unmappedLotacoes: buildUnmappedLotacoes(areas, costCenters, aliasKeys),
    divergences: buildDivergences(metrics, payrollFacts, esocialGrossByCompetence),
    runs,
  });
}
