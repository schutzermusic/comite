import { NextResponse } from 'next/server';
import { requireCommercialSession, isSessionError } from '@/lib/commercial/server-session';
import { resolveOwnerNames } from '@/lib/commercial/owner-directory';
import { isOpenStage } from '@/lib/commercial/stage-policy';
import type { OpportunityStage } from '@/lib/commercial/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Janela padrão do movimento. Trocável pela query, limitada a um trimestre. */
const DEFAULT_MOVEMENT_DAYS = 30;
const MAX_MOVEMENT_DAYS = 90;

/**
 * Forecast — DERIVADO da visão `commercial_forecast_read_model`.
 *
 * Nada é persistido, e a visão devolve `probability_source` justamente para a
 * tela distinguir o que alguém JULGOU do que o sistema assumiu pela faixa do
 * estágio. Apresentar as duas coisas com o mesmo peso seria transformar um
 * padrão em opinião de alguém.
 *
 * Este número não é receita, não é backlog e não entra em contabilidade: é
 * pipeline ponderado, e a resposta carrega `disclaimer` para que a tela não
 * precise lembrar disso por conta própria.
 *
 * ─── O MOVIMENTO, e por que ele não é um snapshot ────────────────────────
 *
 * "O que entrou e o que saiu do forecast" costuma ser resolvido com uma tabela
 * de fotografias diárias do pipeline — e essa tabela envelhece sozinha, ocupa
 * espaço proporcional ao tempo e mente no dia em que o job não roda.
 *
 * Aqui o movimento sai do HISTÓRICO DE ETAPA (migration 212), que é
 * append-only e existe porque a etapa passou a ser um ato. Entrou no forecast
 * quem passou a estar em etapa aberta na janela; saiu quem foi para ganha,
 * perdida ou abandonada. É o mesmo fato, lido do lugar onde ele já estava
 * registrado — e por isso é reconstruível para qualquer janela, inclusive
 * retroativamente.
 */
export async function GET(request: Request) {
  const session = await requireCommercialSession(['commercial.view']);
  if (isSessionError(session)) return session.error;

  const requested = Number(new URL(request.url).searchParams.get('movementDays'));
  const movementDays = Number.isFinite(requested) && requested > 0
    ? Math.min(Math.trunc(requested), MAX_MOVEMENT_DAYS)
    : DEFAULT_MOVEMENT_DAYS;
  const since = new Date(Date.now() - movementDays * 86_400_000).toISOString();

  const [forecast, events] = await Promise.all([
    session.supabase
      .from('commercial_forecast_read_model')
      .select('*')
      .eq('organization_id', session.organizationId)
      .order('expected_decision_date', { ascending: true, nullsFirst: false })
      .limit(500),
    session.supabase
      .from('commercial_opportunity_stage_events')
      .select('id,opportunity_id,from_stage,to_stage,reason,actor_user_id,occurred_at')
      .eq('organization_id', session.organizationId)
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .limit(500),
  ]);

  if (forecast.error) {
    return NextResponse.json({ ok: false,
      error: 'Não foi possível calcular o forecast.' }, { status: 500 });
  }

  const rows = forecast.data ?? [];
  const eventRows = (events.data ?? []) as Array<{
    opportunity_id: string; from_stage: string | null; to_stage: string;
    reason: string | null; actor_user_id: string | null; occurred_at: string;
  }>;

  /*
    O TÍTULO de cada oportunidade que se moveu. Quem saiu do forecast saiu
    também da visão (ela filtra as encerradas), e sem este complemento a lista
    de saídas seria uma lista de uuids.
  */
  const movedIds = Array.from(new Set(eventRows.map((event) => event.opportunity_id)));
  const { data: moved } = movedIds.length
    ? await session.supabase.from('commercial_opportunities')
        .select('id,title,counterparty_name,stage,estimated_value,currency,'
          + 'probability,expected_decision_date,owner_user_id,lost_reason')
        .eq('organization_id', session.organizationId).in('id', movedIds)
    : { data: [] };
  const byId = new Map(
    ((moved ?? []) as unknown as Array<{ id: string }>).map((row) => [row.id, row]));

  const entered: unknown[] = [];
  const left: unknown[] = [];
  for (const event of eventRows) {
    const opportunity = byId.get(event.opportunity_id);
    if (!opportunity) continue;
    const to = event.to_stage as OpportunityStage;
    const from = event.from_stage as OpportunityStage | null;
    const item = { ...event, opportunity };
    if (isOpenStage(to) && (from === null || !isOpenStage(from))) entered.push(item);
    else if (!isOpenStage(to) && (from === null || isOpenStage(from))) left.push(item);
  }

  const owners = await resolveOwnerNames(session.organizationId, [
    ...rows.map((row) => (row as { owner_user_id?: string | null }).owner_user_id),
    ...eventRows.map((event) => event.actor_user_id),
  ]);

  return NextResponse.json({ ok: true, rows,
    movement: { days: movementDays, since, entered, left, events: eventRows },
    owners,
    disclaimer: 'Pipeline ponderado. Não é receita contratada, backlog nem previsão contábil.' });
}
