/**
 * Vocabulário de fatos da plataforma.
 *
 * ─── A regra de nome ───────────────────────────────────────────────────────
 *
 *   <domínio>.<entidade>.<fato_no_passado>
 *
 * `contracts.obligation.instance_activated` é um fato. `run_ai`,
 * `button_clicked` e `screen_opened` não são: o primeiro é comando, os outros
 * dois são telemetria de interface. Nenhum dos três pertence a esta tabela.
 *
 * A VERSÃO não entra no nome. `..._v2` obrigaria todo consumidor a fazer
 * parsing de string para descobrir o que leu; `schema_version` é coluna.
 *
 * ─── Por que a lista é curta ───────────────────────────────────────────────
 *
 * Só entra o fato cuja mutação de origem é autoritativa HOJE, cuja emissão é
 * transacional HOJE e cuja semântica está acordada HOJE. `projects.measurement.accepted`
 * e `finance.payment.received` não estão aqui porque as Fases 6 e 7 não
 * existem — declarar o tipo antes do produtor seria prometer um fato que
 * ninguém pode produzir.
 */
import { z } from 'zod';

export const EVENT_TYPES = [
  'contracts.obligation.instance_activated',
  'contracts.obligation.instance_satisfied',
  'contracts.obligation.instance_waived',
  'contracts.obligation.evidence_recorded',
  'contracts.amendment.created',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}

const uuid = z.string().uuid();
const nullableDate = z.string().nullable().optional();

const obligationTransitionPayload = z.object({
  contract_id: uuid,
  definition_id: uuid,
  occurrence_key: z.string(),
  previous_state: z.string(),
  next_state: z.string(),
  activated_at: nullableDate,
  due_date: nullableDate,
  due_confidence: z.string().optional(),
});

const evidencePayload = z.object({
  evidence_id: uuid,
  contract_id: uuid,
  definition_id: uuid.nullable().optional(),
  requirement_id: uuid.nullable().optional(),
  document_id: uuid.nullable().optional(),
  acceptance_state: z.string(),
});

const amendmentPayload = z.object({
  contract_id: uuid,
  amendment_number: z.string().nullable().optional(),
  effective_date: nullableDate,
  status: z.string().nullable().optional(),
});

/**
 * (tipo, versão) -> schema. Uma versão desconhecida NÃO é interpretada como a
 * conhecida mais próxima: ela é recusada, e o roteamento a marca como conflito
 * de versão em vez de finalizá-la como "sem consumidor".
 */
export const EVENT_SCHEMAS = {
  'contracts.obligation.instance_activated': { 1: obligationTransitionPayload },
  'contracts.obligation.instance_satisfied': { 1: obligationTransitionPayload },
  'contracts.obligation.instance_waived': { 1: obligationTransitionPayload },
  'contracts.obligation.evidence_recorded': { 1: evidencePayload },
  'contracts.amendment.created': { 1: amendmentPayload },
} as const satisfies Record<EventType, Record<number, z.ZodType>>;

export type EventPayloadByType = {
  [K in EventType]: z.infer<(typeof EVENT_SCHEMAS)[K][1]>;
};

export class UnknownEventVersionError extends Error {
  constructor(readonly eventType: string, readonly schemaVersion: number) {
    super(`Fato ${eventType} versão ${schemaVersion} não tem schema declarado.`);
    this.name = 'UnknownEventVersionError';
  }
}

/** Valida o payload persistido. Lança quando o tipo/versão é desconhecido. */
export function parseEventPayload(
  eventType: string, schemaVersion: number, payload: unknown,
): Record<string, unknown> {
  if (!isEventType(eventType)) throw new UnknownEventVersionError(eventType, schemaVersion);
  const byVersion = EVENT_SCHEMAS[eventType] as Record<number, z.ZodType>;
  const schema = byVersion[schemaVersion];
  if (!schema) throw new UnknownEventVersionError(eventType, schemaVersion);
  return schema.parse(payload) as Record<string, unknown>;
}
