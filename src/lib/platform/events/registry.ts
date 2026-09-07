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
 * transacional HOJE e cuja semântica está acordada HOJE. `finance.payment.received`
 * não está aqui porque a Fase 7 não existe — declarar o tipo antes do produtor
 * seria prometer um fato que ninguém pode produzir.
 *
 * O bloco `projects.measurement.*` entrou na FASE 6, junto com quem o produz:
 * as RPCs de transição da migration 133, que emitem dentro da MESMA transação
 * da mutação. `projects.measurement.accepted` é a entrada que a Fase 7 vai
 * consumir para faturamento — e é por ser essa entrada que ela não podia ser
 * declarada antes de existir um produtor que não a perca entre dois commits.
 */
import { z } from 'zod';

export const EVENT_TYPES = [
  'contracts.obligation.instance_activated',
  'contracts.obligation.instance_satisfied',
  'contracts.obligation.instance_waived',
  'contracts.obligation.evidence_recorded',
  'contracts.amendment.created',
  // ---- Fase 6: medição de projeto ----
  'projects.measurement.created',
  'projects.measurement.ready_for_submission',
  'projects.measurement.submitted',
  'projects.measurement.returned_for_correction',
  'projects.measurement.accepted',
  'projects.measurement.rejected',
  'projects.measurement.cancelled',
  'projects.measurement.superseded',
  'projects.measurement.evidence_linked',
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

/**
 * O que TODO fato de medição carrega. A identidade da ocorrência viaja no
 * payload porque é ela que permite ao consumidor da Fase 7 saber QUAL medição
 * do contrato foi aceita sem consultar o banco de Projetos — e `occurrence_state`
 * viaja junto para que "ocorrência não resolvida" não chegue lá disfarçada de
 * ocorrência normal.
 */
const measurementBase = {
  project_id: z.string(),
  contract_id: uuid,
  contract_measurement_rule_id: uuid,
  occurrence_key: z.string(),
  occurrence_state: z.enum(['resolved', 'unresolved']),
  revision: z.number().int().positive(),
  status: z.string(),
};

const measurementPayload = z.object(measurementBase).passthrough();

/**
 * O aceite carrega os fatos CONGELADOS, e só eles. Valor e moeda vêm dos
 * campos `accepted_*`, nunca dos campos correntes: o que a Fase 7 vai
 * consumir é o que foi aceito, não o que a medição diz agora.
 */
const measurementAcceptedPayload = z.object({
  ...measurementBase,
  accepted_at: z.string(),
  acceptance_source: z.string(),
  accepted_quantity: z.union([z.number(), z.string()]).nullable().optional(),
  accepted_value: z.union([z.number(), z.string()]).nullable().optional(),
  accepted_currency: z.string().nullable().optional(),
  measurement_basis: z.string(),
  accumulation_mode: z.string(),
  milestone_id: uuid.nullable().optional(),
  period_start: nullableDate,
  period_end: nullableDate,
}).passthrough();

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
  'projects.measurement.created': { 1: measurementPayload },
  'projects.measurement.ready_for_submission': { 1: measurementPayload },
  'projects.measurement.submitted': { 1: measurementPayload },
  'projects.measurement.returned_for_correction': { 1: measurementPayload },
  'projects.measurement.accepted': { 1: measurementAcceptedPayload },
  'projects.measurement.rejected': { 1: measurementPayload },
  'projects.measurement.cancelled': { 1: measurementPayload },
  'projects.measurement.superseded': { 1: measurementPayload },
  'projects.measurement.evidence_linked': { 1: measurementPayload },
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
