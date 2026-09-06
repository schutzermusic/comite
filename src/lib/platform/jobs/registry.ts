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
] as const;

export type JobType = (typeof JOB_TYPES)[number];

export function isJobType(value: string): value is JobType {
  return (JOB_TYPES as readonly string[]).includes(value);
}

const uuid = z.string().uuid();

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
