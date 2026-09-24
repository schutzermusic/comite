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

/*
  Expiração de aprovação — o segundo produtor da plataforma, e o primeiro que
  não pertence a Contratos. Está aqui, e não num agendador próprio do motor de
  aprovação, porque a §29 é explícita: não se cria uma fila específica de
  aprovação quando `apex_jobs` já existe.
*/
const approvalExpiration: ScheduledProducer = {
  name: 'platform.approvals.expire',
  ownerDomain: 'platform',
  idempotencyBasis:
    'A chave do trabalho é (organização, HORA): approval-expire:<org>:<YYYY-MM-DDTHH>. '
    + 'O relógio como chave criaria 144 trabalhos por dia e por inquilino, quase todos '
    + 'sem nada a fazer; o DIA deixaria a projeção parada por 24 horas. A exatidão do '
    + 'prazo não depende desta cadência — quem recusa decisão vencida é a própria RPC.',
  async produce(supabase, asOf) {
    const { data, error } = await supabase.rpc('approval_enqueue_expiration', {
      p_as_of: asOf.toISOString(),
    });
    if (error) throw new Error(`Produtor de expiração de aprovação falhou: ${error.message}`);
    return Number(data ?? 0);
  },
};

/** Bounded state-aware Follow-up pass on the existing Apex Jobs clock. */
const followupExecution: ScheduledProducer = {
  name: 'platform.followups.execute',
  ownerDomain: 'platform',
  idempotencyBasis:
    'A chave do trabalho é (organização, dia). Dentro do trabalho, nudge e '
    + 'escalonamento usam last_nudge_at/escalated_at sob bloqueio de linha.',
  async produce(supabase, asOf) {
    const { data, error } = await supabase.rpc('apex_followups_enqueue_execution', {
      p_as_of: isoDate(asOf),
      p_limit: 200,
    });
    if (error) throw new Error(`Produtor de Follow-up falhou: ${error.message}`);
    return Number(data ?? 0);
  },
};

/*
  Leitura da Apex no Supply (237) — o agendamento que faltava. Antes, a leitura
  só acontecia quando alguém abria a tela. Por inquilino e por HORA: a drenagem
  acorda a cada 10 minutos, e reler a cada batida só reescreveria "última
  leitura" sem fato novo.
*/
const supplyIntelligence: ScheduledProducer = {
  name: 'supply.intelligence.sweep',
  ownerDomain: 'supply',
  idempotencyBasis:
    'A chave do trabalho é (organização, HORA): supply-intelligence-sweep:<org>:<YYYY-MM-DDTHH>. '
    + 'Entram inquilinos com demanda de material confirmada, pedido vivo ou sinal aberto.',
  async produce(supabase, asOf) {
    const { data, error } = await supabase.rpc('supply_intelligence_enqueue_sweep', { p_as_of: asOf.toISOString() });
    if (error) throw new Error(`Produtor da leitura da Apex falhou: ${error.message}`);
    return Number(data ?? 0);
  },
};

/** Reconciliação de aprovações de compra (237), a cada 10 minutos por inquilino com desfecho pendente de aplicação. */
const purchaseOrderApprovalReconcile: ScheduledProducer = {
  name: 'procurement.purchase_order.reconcile_approvals',
  ownerDomain: 'supply',
  idempotencyBasis:
    'A chave do trabalho é (organização, janela de 10 minutos). Só entra inquilino com pedido de compra '
    + 'aguardando um desfecho que o motor já decidiu.',
  async produce(supabase, asOf) {
    const { data, error } = await supabase.rpc('purchase_order_enqueue_approval_reconcile', { p_as_of: asOf.toISOString() });
    if (error) throw new Error(`Produtor da reconciliação de compras falhou: ${error.message}`);
    return Number(data ?? 0);
  },
};

export const SCHEDULED_PRODUCERS: readonly ScheduledProducer[] = [
  obligationMaterialization,
  approvalExpiration,
  followupExecution,
  supplyIntelligence,
  purchaseOrderApprovalReconcile,
];

/** Data em UTC. O dia do produtor tem de ser o mesmo em toda máquina que acordar. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
