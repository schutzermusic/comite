/**
 * Vocabulário de TRABALHO da plataforma.
 *
 * Fato e trabalho não moram na mesma lista de propósito. `domain_events` diz o
 * que aconteceu, no passado; `apex_jobs` diz o que ainda precisa acontecer, no
 * imperativo. Misturá-los transformaria o registro histórico em backlog
 * mutável — e um fato que pode voltar para "pendente" deixa de ser fato.
 */
import { z } from 'zod';

export const JOB_TYPES = [
  'contracts.obligations.materialize',
  'contracts.obligation.external_activation.apply',
  'contracts.clause_extraction.execute',
  'platform.approvals.expire',
  // ---- Fase 6 ----
  'projects.measurements.reconcile_candidates',
  'projects.measurements.recompute_readiness',
  // ---- Fase 7 — cadeia contrato-a-caixa ----
  'contracts.billing.candidate_from_measurement',
  'contracts.billing.apply_approval',
  'contracts.billing.request_fiscal_document',
  'finance.receivable.create_from_fiscal',
  'finance.receivable.apply_fiscal_cancellation',
] as const;

export type JobType = (typeof JOB_TYPES)[number];

export function isJobType(value: string): value is JobType {
  return (JOB_TYPES as readonly string[]).includes(value);
}

const uuid = z.string().uuid();

/**
 * Payload das rotas estáticas do Apex: `apex_route_pending_events` enfileira
 * sempre `{event_id, event_type, schema_version}`. Declarar o formato uma vez
 * evita que cada tipo novo o redigite com uma diferença silenciosa.
 */
const EVENT_REF = z.object({
  event_id: uuid,
  event_type: z.string(),
  schema_version: z.number().int().positive(),
});

export const JOB_SCHEMAS = {
  'contracts.obligations.materialize': {
    1: z.object({
      as_of: z.string(),
      // Horizonte ROLANTE e limitado. Materializar dez anos à frente encheria
      // a base de ocorrências de contratos que podem nem existir mais.
      horizon_days: z.number().int().positive().max(730),
    }),
  },
  'contracts.obligation.external_activation.apply': {
    1: z.object({
      event_id: uuid,
      event_type: z.string(),
      schema_version: z.number().int().positive(),
    }),
  },
  'contracts.clause_extraction.execute': {
    1: z.object({ request_id: uuid, contract_id: uuid, document_id: uuid }),
  },
  // A expiração não carrega o pedido a expirar: carrega o INSTANTE. Listar os
  // pedidos no payload congelaria, no momento de enfileirar, uma lista que
  // pode mudar antes de o trabalho rodar — e o que expira é quem venceu, não
  // quem alguém achou que ia vencer.
  'platform.approvals.expire': {
    1: z.object({ as_of: z.string() }),
  },
  /*
    Materialização de candidatos de medição. Horizonte ROLANTE, pela mesma
    razão da materialização de obrigações: criar ocorrências para dez anos à
    frente encheria a base de medições de contratos que podem nem existir.
  */
  'projects.measurements.reconcile_candidates': {
    1: z.object({
      as_of: z.string(),
      horizon_days: z.number().int().positive().max(730),
    }),
  },
  /*
    Recomputo INCREMENTAL de prontidão. `changed_since` é o que impede a
    varredura da carteira inteira a cada tique — sem ele, o trabalho cresceria
    com o tamanho do inquilino em vez de com o que mudou nele.
  */
  'projects.measurements.recompute_readiness': {
    1: z.object({
      changed_since: z.string().nullable().optional(),
      limit: z.number().int().positive().max(2000),
    }),
  },
  /*
    Os cinco da Fase 7 carregam a mesma coisa: a IDENTIDADE DO FATO, e nada
    mais. Copiar valor, moeda ou vencimento para o payload congelaria, no
    instante de rotear, números que a transação a jusante precisa reler — e um
    trabalho que age sobre a foto antiga cria título com o valor errado.

    O handler relê a linha autoritativa. O payload só diz de qual fato falar.
  */
  'contracts.billing.candidate_from_measurement': { 1: EVENT_REF },
  'contracts.billing.apply_approval':             { 1: EVENT_REF },
  'contracts.billing.request_fiscal_document':    { 1: EVENT_REF },
  'finance.receivable.create_from_fiscal':        { 1: EVENT_REF },
  'finance.receivable.apply_fiscal_cancellation': { 1: EVENT_REF },
} as const satisfies Record<JobType, Record<number, z.ZodType>>;

export type JobPayloadByType = {
  [K in JobType]: z.infer<(typeof JOB_SCHEMAS)[K][1]>;
};

export class UnknownJobError extends Error {
  constructor(readonly jobType: string, readonly payloadVersion: number) {
    super(`Tipo de trabalho ${jobType} versão ${payloadVersion} não tem schema declarado.`);
    this.name = 'UnknownJobError';
  }
}

/**
 * Valida o payload persistido contra o schema da versão declarada.
 *
 * Payload malformado é falha TERMINAL, nunca um crash em laço: um trabalho que
 * derruba o trabalhador a cada tentativa impede todo o resto da fila de rodar,
 * e o defeito fica invisível justamente por ser fatal demais.
 */
export function parseJobPayload<K extends JobType>(
  jobType: K, payloadVersion: number, payload: unknown,
): JobPayloadByType[K] {
  const byVersion = JOB_SCHEMAS[jobType] as Record<number, z.ZodType>;
  const schema = byVersion?.[payloadVersion];
  if (!schema) throw new UnknownJobError(jobType, payloadVersion);
  return schema.parse(payload) as JobPayloadByType[K];
}
