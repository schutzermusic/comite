/**
 * Produtores agendados.
 *
 * Nem todo trabalho nasce de um fato. A materialização de obrigações nasce da
 * PASSAGEM DO TEMPO, e o tempo não é um evento de negócio: emitir
 * "ficou vencida" todo dia às 3h produziria uma enxurrada de fatos que não
 * descrevem decisão nenhuma. A Fase 3 já deriva urgência de
 * (estado, prazo, data da pergunta); o que falta é criar as OCORRÊNCIAS, e isso
 * é trabalho.
 *
 * O núcleo do trabalhador não conhece Contratos. Ele conhece esta lista, e cada
 * item sabe se apresentar por conta própria.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ScheduledProducer {
  readonly name: string;
  readonly ownerDomain: string;
  /** Por que rodar duas vezes no mesmo dia não cria dois trabalhos. */
  readonly idempotencyBasis: string;
  /** Devolve quantos trabalhos foram (ou já estavam) enfileirados. */
  produce(supabase: SupabaseClient, asOf: Date): Promise<number>;
}

/** Horizonte rolante da materialização automática, em dias. */
export const MATERIALIZATION_HORIZON_DAYS = 180;

const obligationMaterialization: ScheduledProducer = {
  name: 'contracts.obligations.materialize',
  ownerDomain: 'contracts',
  idempotencyBasis:
    'A chave do trabalho é (organização, dia): contracts-obligation-materialize:<org>:<YYYY-MM-DD>. '
    + 'O relógio atual como chave criaria 144 trabalhos por dia e por inquilino.',
  async produce(supabase, asOf) {
    const { data, error } = await supabase.rpc('contracts_enqueue_obligation_materialization', {
      p_as_of: isoDate(asOf),
      p_horizon_days: MATERIALIZATION_HORIZON_DAYS,
    });
    if (error) throw new Error(`Produtor de materialização falhou: ${error.message}`);
    return Number(data ?? 0);
  },
};

export const SCHEDULED_PRODUCERS: readonly ScheduledProducer[] = [obligationMaterialization];

/** Data em UTC. O dia do produtor tem de ser o mesmo em toda máquina que acordar. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
