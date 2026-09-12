/**
 * Operacionalização de contrato — server-only.
 *
 * ─── O que este módulo é ───────────────────────────────────────────────────
 *
 * O cliente mandou o contrato. Ele já está assinado, já vale, e o Apex não
 * escreveu uma linha dele. O que falta é a tradução: o que aquele documento
 * EXIGE, de quem, quando, sob que condição, com que evidência, e o que trava
 * faturamento se não acontecer.
 *
 * A extração de cláusulas (`contract-clause-extractor.ts`) responde "o que o
 * contrato DIZ". Este módulo responde "o que o contrato FAZ a gente ter de
 * fazer". São perguntas diferentes e produzem tabelas diferentes: cláusula é
 * acervo; obrigação, condição de faturamento, garantia, seguro e exigência
 * documental são OPERAÇÃO.
 *
 * ─── Três regras que governam o arquivo ────────────────────────────────────
 *
 * 1. **Evidência ou nada.** Toda linha carrega página e trecho literal. O que
 *    vier sem é descartado antes do banco — que também recusa, pelo CHECK de
 *    proveniência da migration 114. Duas barreiras para a mesma regra porque é
 *    A regra.
 *
 * 2. **Data desconhecida continua desconhecida.** "5 dias úteis antes da
 *    medição" NÃO vira uma data no ato da leitura: vira uma REGRA ancorada
 *    (`schedule_anchor = measurement`, `offset = 5`), e a instância nasce
 *    `AWAITING_SCHEDULE_ANCHOR`. Quando Projetos agendar, a 155 calcula. Um
 *    prazo inventado a partir do início do contrato seria errado com cara de
 *    certo — e é errado exatamente nos casos em que alguém confiaria nele.
 *
 * 3. **Nada aqui é decisão.** O módulo estrutura; ele não aceita medição, não
 *    libera faturamento, não aprova nada e não carimba revisor humano. A fila
 *    de atenção humana sai da política de exceção da migration 154, não da
 *    vontade do modelo.
 */

if (typeof window !== 'undefined') {
  throw new Error('contract-operationalization.ts não pode ser importado no browser');
}

import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { getApexAIGateway, getApexAITaskPolicy, type ApexAIResponse } from '@/lib/ai/gateway';

export const OPERATIONALIZATION_VERSION = 'contract-operationalization/1.0.0';
export const OPERATIONAL_TRUST_POLICY_VERSION = 'contract-operational-trust/1.0.0';
export const MIN_OPERATIONAL_CONFIDENCE = 0.75;
export const MATERIAL_OPERATIONAL_AMOUNT_BRL = 100_000;

const CONTRACT_FILES_BUCKET = 'contract-files';
const MAX_PDF_BYTES = 30 * 1024 * 1024;

// ═══════════════════════════════════════════════════════════════════════════
// Vocabulários — espelham os CHECK das migrations 114/115/155
// ═══════════════════════════════════════════════════════════════════════════

export const RESPONSIBLE_SIDES = [
  'contracting_organization', 'counterparty', 'supplier', 'third_party', 'shared', 'unknown',
] as const;
export type ResponsibleSide = (typeof RESPONSIBLE_SIDES)[number];

export const ACTIVATION_KINDS = [
  'contract_start', 'days_after_contract_start', 'days_before_contract_end',
  'fixed_date', 'manual', 'external_event', 'schedule_anchor', 'unspecified',
] as const;
export const DUE_KINDS = [
  'fixed_date', 'days_after_activation', 'days_before_contract_end',
  'same_day_as_activation', 'recurring',
  'days_before_schedule_anchor', 'days_after_schedule_anchor', 'unspecified',
] as const;
export const CALENDAR_BASES = ['calendar_days', 'business_days', 'unspecified'] as const;
export const RECURRENCE_KINDS = [
  'one_time', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'fixed_interval', 'custom',
] as const;
export const SCHEDULE_ANCHORS = [
  'measurement', 'measurement_acceptance', 'project_milestone', 'project_start', 'project_end',
] as const;
export const BILLING_CONDITION_TYPES = [
  'milestone_reached', 'measurement_accepted', 'service_report_required', 'evidence_required',
  'technical_acceptance_required', 'customer_approval_required', 'specific_document_required',
  'elapsed_contractual_period', 'contractual_event',
] as const;

export interface OperationalObligation {
  title: string;
  requirement_text: string;
  category: string | null;
  responsible_side: ResponsibleSide;
  activation_kind: (typeof ACTIVATION_KINDS)[number];
  activation_offset_days: number | null;
  activation_fixed_date: string | null;
  activation_event_text: string | null;
  due_kind: (typeof DUE_KINDS)[number];
  due_offset_days: number | null;
  due_fixed_date: string | null;
  calendar_basis: (typeof CALENDAR_BASES)[number];
  schedule_anchor: (typeof SCHEDULE_ANCHORS)[number] | null;
  schedule_anchor_offset_days: number | null;
  schedule_anchor_text: string | null;
  recurrence_kind: (typeof RECURRENCE_KINDS)[number];
  recurrence_interval: number | null;
  /** `null` = o contrato não disse. NUNCA `false` por omissão. */
  blocks_billing: boolean | null;
  source_page: number;
  source_excerpt: string;
  confidence: number;
}

export interface OperationalBillingCondition {
  title: string;
  condition_type: (typeof BILLING_CONDITION_TYPES)[number];
  requirement_text: string;
  required_document_type: string | null;
  elapsed_period_days: number | null;
  source_page: number;
  source_excerpt: string;
  confidence: number;
}

export interface OperationalGuarantee {
  title: string;
  guarantee_type: string | null;
  /** Valor fixo OU percentual — nunca os dois. Ver `normalizeGuarantee`. */
  required_amount: number | null;
  required_percentage: number | null;
  /** DE QUE o percentual é percentual. Sem isto, o número não significa nada. */
  percentage_basis: string | null;
  renewal_required: boolean | null;
  source_page: number;
  source_excerpt: string;
  confidence: number;
}

export interface OperationalInsurance {
  title: string;
  insurance_type: string | null;
  required_coverage: number | null;
  policy_required: boolean | null;
  validity_requirement: string | null;
  source_page: number;
  source_excerpt: string;
  confidence: number;
}

export interface OperationalIndexation {
  title: string;
  indexer: string | null;
  periodicity_months: number | null;
  anniversary_rule: string | null;
  lag_months: number | null;
  source_page: number;
  source_excerpt: string;
  confidence: number;
}

export interface OperationalReading {
  obligations: OperationalObligation[];
  billing_conditions: OperationalBillingCondition[];
  guarantees: OperationalGuarantee[];
  insurance_requirements: OperationalInsurance[];
  indexation_rules: OperationalIndexation[];
}

export type OperationalFamily = keyof OperationalReading;
export type OperationalTrustReason = 'low_confidence' | 'material_financial_exposure';

export interface OperationalTrustDecision {
  /** Only this state may be copied into authority-bearing operational tables. */
  state: 'automatic' | 'requires_attention';
  reasons: OperationalTrustReason[];
  policyVersion: string;
}

/**
 * Deterministic gate between an AI interpretation and operational authority.
 *
 * Every reading is retained in `contract_operational_interpretations`; only a
 * reading that passes this policy is copied into obligation/billing/etc. fact
 * tables. Confidence is about the reading, not importance. A material amount
 * is therefore a separate exception even when confidence is high.
 */
export function evaluateOperationalTrust(
  family: OperationalFamily,
  item: { confidence: number } & Record<string, unknown>,
): OperationalTrustDecision {
  const reasons: OperationalTrustReason[] = [];
  if (item.confidence < MIN_OPERATIONAL_CONFIDENCE) reasons.push('low_confidence');

  const materialAmount = family === 'guarantees'
    ? (typeof item.required_amount === 'number' ? item.required_amount : null)
    : family === 'insurance_requirements'
      ? (typeof item.required_coverage === 'number' ? item.required_coverage : null)
      : null;
  if (materialAmount !== null && Math.abs(materialAmount) >= MATERIAL_OPERATIONAL_AMOUNT_BRL) {
    reasons.push('material_financial_exposure');
  }
  return {
    state: reasons.length === 0 ? 'automatic' : 'requires_attention',
    reasons,
    policyVersion: OPERATIONAL_TRUST_POLICY_VERSION,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Schema de saída
// ═══════════════════════════════════════════════════════════════════════════

/*
 * PROVIDER TRANSPORT (compact) — CONTRACT_OPERATIONALIZATION
 *
 * Defeito corrigido aqui
 * ----------------------
 * O schema anterior era EXPANDIDO POR CAMPO: cinco objetos de item, um por
 * família, cada um repetindo os três campos de evidência e os seus próprios
 * campos anuláveis. Medição do schema removido:
 *
 *   26 parâmetros union-typed  (limite documentado da Anthropic: 16)
 *    0 parâmetros opcionais
 *    6 object schemas
 *    5994 bytes serializados
 *
 * É o MESMO defeito que derrubou CONTRACT_EXTRACTION em produção (request
 * req_011CexwaB6XrwPFHY8ybZdYD, HTTP 400 "The compiled grammar is too large"),
 * agravado: aquele schema passava nos limites explícitos e ainda assim foi
 * recusado pelo limite INTERNO de tamanho da gramática compilada. Este aqui
 * estoura também o limite explícito de uniões, então falharia de forma ainda
 * mais certa — na primeira operacionalização real, depois que um humano
 * finalizasse o contrato. Por isso é corrigido ANTES.
 *
 * O que muda e o que não muda
 * ---------------------------
 * Muda APENAS a forma de transporte com o provedor. O modelo de domínio
 * canônico (OperationalObligation, OperationalBillingCondition,
 * OperationalGuarantee, OperationalInsurance, OperationalIndexation,
 * OperationalReading), o gate de evidência, a política de confiança, a
 * fronteira Contrato/Projeto e a persistência seguem exatamente iguais.
 * Uma chamada Sonnet, um PDF, toda a evidência documental.
 *
 *   ANTES: 5 objetos de item específicos por família + 26 uniões.
 *   AGORA: UM item genérico com `kind` fechado e uma lista plana de atributos
 *          nome/valor — todo valor é `string`, sem nenhuma união.
 *
 * Ausência viaja em sentinelas que não podem ser confundidas com evidência:
 * página 0, excerpt "", e atributo simplesmente NÃO enviado (ou value "").
 * `normalizeCompactContractOperationalization()` valida e reconstrói o modelo
 * canônico antes de qualquer gate de confiança ou escrita.
 */

/** Famílias canônicas, como o provedor as nomeia. Nada fora desta lista existe. */
export const OPERATIONAL_ITEM_KINDS = [
  'obligation', 'billing_condition', 'guarantee', 'insurance_requirement', 'indexation_rule',
] as const;
export type OperationalItemKind = (typeof OPERATIONAL_ITEM_KINDS)[number];

/** kind do transporte → família canônica de OperationalReading. */
const KIND_TO_FAMILY: Record<OperationalItemKind, OperationalFamily> = {
  obligation: 'obligations',
  billing_condition: 'billing_conditions',
  guarantee: 'guarantees',
  insurance_requirement: 'insurance_requirements',
  indexation_rule: 'indexation_rules',
};

/** kind do transporte → rótulo de família usado nas rejeições e fingerprints. */
const KIND_TO_REJECTION_FAMILY: Record<OperationalItemKind, string> = {
  obligation: 'obligation',
  billing_condition: 'billing_condition',
  guarantee: 'guarantee',
  insurance_requirement: 'insurance',
  indexation_rule: 'indexation',
};

/**
 * Como cada atributo é lido de volta para o tipo canônico.
 *
 * `enum` referencia o vocabulário existente — um membro fora dele é transporte
 * inválido, não um valor a ser "corrigido" em silêncio.
 */
type AttributeParser =
  | { kind: 'text' }
  | { kind: 'integer' }
  | { kind: 'decimal' }
  | { kind: 'boolean' }
  | { kind: 'date' }
  | { kind: 'enum'; values: readonly string[] };

const ATTRIBUTE_SPEC = {
  requirement_text: { kind: 'text' },
  category: { kind: 'text' },
  responsible_side: { kind: 'enum', values: RESPONSIBLE_SIDES },
  activation_kind: { kind: 'enum', values: ACTIVATION_KINDS },
  activation_offset_days: { kind: 'integer' },
  activation_fixed_date: { kind: 'date' },
  activation_event_text: { kind: 'text' },
  due_kind: { kind: 'enum', values: DUE_KINDS },
  due_offset_days: { kind: 'integer' },
  due_fixed_date: { kind: 'date' },
  calendar_basis: { kind: 'enum', values: CALENDAR_BASES },
  schedule_anchor: { kind: 'enum', values: SCHEDULE_ANCHORS },
  schedule_anchor_offset_days: { kind: 'integer' },
  schedule_anchor_text: { kind: 'text' },
  recurrence_kind: { kind: 'enum', values: RECURRENCE_KINDS },
  recurrence_interval: { kind: 'integer' },
  blocks_billing: { kind: 'boolean' },
  condition_type: { kind: 'enum', values: BILLING_CONDITION_TYPES },
  required_document_type: { kind: 'text' },
  elapsed_period_days: { kind: 'integer' },
  guarantee_type: { kind: 'text' },
  required_amount: { kind: 'decimal' },
  required_percentage: { kind: 'decimal' },
  percentage_basis: { kind: 'text' },
  renewal_required: { kind: 'boolean' },
  insurance_type: { kind: 'text' },
  required_coverage: { kind: 'decimal' },
  policy_required: { kind: 'boolean' },
  validity_requirement: { kind: 'text' },
  indexer: { kind: 'text' },
  periodicity_months: { kind: 'integer' },
  anniversary_rule: { kind: 'text' },
  lag_months: { kind: 'integer' },
} as const satisfies Record<string, AttributeParser>;

export type OperationalAttributeName = keyof typeof ATTRIBUTE_SPEC;

export const OPERATIONAL_ATTRIBUTE_NAMES = Object.keys(ATTRIBUTE_SPEC) as OperationalAttributeName[];

/**
 * Que atributo pertence a que família.
 *
 * Um atributo enviado na família errada é transporte corrompido — por exemplo
 * `blocks_billing` numa garantia, que sugeriria um efeito de faturamento que a
 * tabela de garantias não tem. O item é recusado, não limpo.
 */
export const ATTRIBUTES_BY_KIND: Record<OperationalItemKind, readonly OperationalAttributeName[]> = {
  obligation: [
    'requirement_text', 'category', 'responsible_side',
    'activation_kind', 'activation_offset_days', 'activation_fixed_date', 'activation_event_text',
    'due_kind', 'due_offset_days', 'due_fixed_date', 'calendar_basis',
    'schedule_anchor', 'schedule_anchor_offset_days', 'schedule_anchor_text',
    'recurrence_kind', 'recurrence_interval', 'blocks_billing',
  ],
  billing_condition: ['condition_type', 'requirement_text', 'required_document_type', 'elapsed_period_days'],
  guarantee: ['guarantee_type', 'required_amount', 'required_percentage', 'percentage_basis', 'renewal_required'],
  insurance_requirement: ['insurance_type', 'required_coverage', 'policy_required', 'validity_requirement'],
  indexation_rule: ['indexer', 'periodicity_months', 'anniversary_rule', 'lag_months'],
};

/**
 * O ÚNICO objeto de atributo do schema — nome fechado, valor sempre string.
 * Nenhum `minimum`/`maximum`: o dialeto da Anthropic os recusa, e a validação
 * determinística em tempo de execução é mais estrita do que eles seriam.
 */
const providerAttributeItem = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'value'],
  properties: {
    name: { type: 'string', enum: [...OPERATIONAL_ATTRIBUTE_NAMES] },
    value: { type: 'string' },
  },
} as const;

/** O ÚNICO objeto de item do schema. É este reuso que mantém a gramática pequena. */
const providerOperationalItem = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'title', 'attributes', 'page', 'excerpt', 'confidence', 'ambiguous', 'conflicting'],
  properties: {
    kind: { type: 'string', enum: [...OPERATIONAL_ITEM_KINDS] },
    title: { type: 'string' },
    attributes: { type: 'array', items: providerAttributeItem },
    page: { type: 'integer' },
    excerpt: { type: 'string' },
    confidence: { type: 'number' },
    ambiguous: { type: 'boolean' },
    conflicting: { type: 'boolean' },
  },
} as const;

export const OPERATIONALIZATION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: { type: 'array', items: providerOperationalItem },
  },
};

export interface OperationalProviderAttribute {
  name: OperationalAttributeName;
  value: string;
}

export interface OperationalProviderItem {
  kind: OperationalItemKind;
  title: string;
  attributes: OperationalProviderAttribute[];
  page: number;
  excerpt: string;
  confidence: number;
  ambiguous: boolean;
  conflicting: boolean;
}

/** Forma bruta devolvida pelo provedor — ver OPERATIONALIZATION_SCHEMA. */
export interface OperationalProviderTransport {
  items: OperationalProviderItem[];
}

/**
 * Corrupção estrutural da resposta inteira (raiz sem `items`, `items` que não é
 * lista). Não é um item ruim: é uma resposta que não honra o contrato de
 * transporte, e a análise falha em vez de ser reparada.
 */
export class OperationalTransportError extends Error {
  readonly code = 'CONTRACT_OPERATIONALIZATION_TRANSPORT_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'OperationalTransportError';
  }
}

const STRICT_INTEGER = /^-?(?:0|[1-9]\d*)$/;
/** Decimal canônico, sem separador de milhar e sem símbolo de moeda. */
const CANONICAL_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;

/**
 * Data ISO canônica com verificação de calendário real: "2026-02-30" e
 * "2026-99-99" são transporte inválido, nunca reinterpretados.
 */
export function isCanonicalOperationalDate(raw: string): boolean {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const [year, month, day] = raw.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Um valor de atributo → o tipo canônico correspondente.
 *
 * `null` de retorno significa AUSÊNCIA legítima (o sentinela ""), e o atributo
 * simplesmente não entra no registro reconstruído — o normalizador canônico
 * então aplica a mesma semântica de omissão que sempre aplicou. `{ ok: false }`
 * significa transporte malformado, e o ITEM inteiro é recusado.
 */
function parseAttributeValue(
  name: OperationalAttributeName,
  raw: string,
): { ok: true; value: string | number | boolean | null } | { ok: false; reason: string } {
  if (typeof raw !== 'string') return { ok: false, reason: `atributo "${name}" com valor não textual` };
  const spec: AttributeParser = ATTRIBUTE_SPEC[name];
  const value = raw.trim();
  if (value === '') return { ok: true, value: null };

  switch (spec.kind) {
    case 'text':
      return { ok: true, value };
    case 'integer':
      return STRICT_INTEGER.test(value)
        ? { ok: true, value: Number(value) }
        : { ok: false, reason: `atributo "${name}" não é um inteiro canônico: "${raw}"` };
    case 'decimal': {
      if (!CANONICAL_DECIMAL.test(value)) {
        return { ok: false, reason: `atributo "${name}" não é um decimal canônico: "${raw}"` };
      }
      const parsed = Number(value);
      // Inalcançável para uma string que casa com o padrão, mas um número não
      // finito nunca chega ao domínio pela força de uma regex só.
      if (!Number.isFinite(parsed)) {
        return { ok: false, reason: `atributo "${name}" não é um número finito: "${raw}"` };
      }
      return { ok: true, value: parsed };
    }
    case 'boolean':
      if (value === 'true') return { ok: true, value: true };
      if (value === 'false') return { ok: true, value: false };
      return { ok: false, reason: `atributo "${name}" não é "true" nem "false": "${raw}"` };
    case 'date':
      return isCanonicalOperationalDate(value)
        ? { ok: true, value }
        : { ok: false, reason: `atributo "${name}" não é uma data ISO válida: "${raw}"` };
    case 'enum':
      return spec.values.includes(value)
        ? { ok: true, value }
        : { ok: false, reason: `atributo "${name}" fora do vocabulário: "${raw}"` };
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Um item de transporte → o registro bruto que os normalizadores canônicos já
 * consomem. Recusa (sem reparar) item malformado, kind desconhecido, atributo
 * duplicado, atributo de outra família e valor impossível.
 */
function reconstructItem(
  raw: unknown,
  index: number,
): { ok: true; kind: OperationalItemKind; record: Record<string, unknown> } | { ok: false; family: string; reason: string } {
  if (!isPlainRecord(raw)) return { ok: false, family: 'transport', reason: `item #${index} não é um objeto` };

  const kind = raw.kind;
  if (typeof kind !== 'string' || !(OPERATIONAL_ITEM_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, family: 'transport', reason: `item #${index} com categoria desconhecida: ${JSON.stringify(kind)}` };
  }
  const itemKind = kind as OperationalItemKind;
  const family = KIND_TO_REJECTION_FAMILY[itemKind];

  if (typeof raw.title !== 'string') return { ok: false, family, reason: 'título ausente ou não textual' };
  if (typeof raw.page !== 'number' || !Number.isInteger(raw.page)) {
    return { ok: false, family, reason: 'página não inteira' };
  }
  if (typeof raw.excerpt !== 'string') return { ok: false, family, reason: 'trecho não textual' };
  // Evidência forte é sempre limitada em runtime, nunca pelo schema do provedor.
  if (typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence)
      || raw.confidence < 0 || raw.confidence > 1) {
    return { ok: false, family, reason: 'confiança fora de 0..1' };
  }
  if (typeof raw.ambiguous !== 'boolean' || typeof raw.conflicting !== 'boolean') {
    return { ok: false, family, reason: 'marcadores de ambiguidade não booleanos' };
  }
  if (!Array.isArray(raw.attributes)) return { ok: false, family, reason: 'lista de atributos ausente' };

  const allowed = new Set<string>(ATTRIBUTES_BY_KIND[itemKind]);
  const seen = new Set<string>();
  const record: Record<string, unknown> = {
    title: raw.title,
    source_page: raw.page,
    source_excerpt: raw.excerpt,
    /*
      Leitura declarada ambígua ou conflitante NUNCA pode virar autoridade. Ela
      não é descartada — continua registrada como interpretação para revisão
      humana —, mas entra com confiança 0, abaixo de MIN_OPERATIONAL_CONFIDENCE,
      então a política de confiança a classifica como requires_attention e ela
      não é copiada para nenhuma tabela de fato operacional.
    */
    confidence: raw.ambiguous || raw.conflicting ? 0 : raw.confidence,
  };

  for (const attribute of raw.attributes) {
    if (!isPlainRecord(attribute)) return { ok: false, family, reason: 'atributo que não é objeto' };
    const name = attribute.name;
    if (typeof name !== 'string' || !(name in ATTRIBUTE_SPEC)) {
      return { ok: false, family, reason: `atributo desconhecido: ${JSON.stringify(name)}` };
    }
    if (!allowed.has(name)) {
      return { ok: false, family, reason: `atributo "${name}" não pertence a ${itemKind}` };
    }
    if (seen.has(name)) return { ok: false, family, reason: `atributo duplicado: "${name}"` };
    seen.add(name);
    if (typeof attribute.value !== 'string') {
      return { ok: false, family, reason: `atributo "${name}" com valor não textual` };
    }
    const parsed = parseAttributeValue(name as OperationalAttributeName, attribute.value);
    if (!parsed.ok) return { ok: false, family, reason: parsed.reason };
    // Ausência ("" ou atributo não enviado) deixa a chave FORA do registro: a
    // omissão tem a mesma semântica que sempre teve nos normalizadores.
    if (parsed.value !== null) record[name] = parsed.value;
  }

  return { ok: true, kind: itemKind, record };
}

/**
 * FRONTEIRA DETERMINÍSTICA: transporte compacto → leitura operacional canônica.
 *
 * Valida a estrutura, reconstrói cada item na forma que os normalizadores
 * canônicos já conhecem e devolve exatamente o mesmo `{ accepted, rejected }`
 * que o resto do pipeline sempre consumiu. Nada a jusante enxerga sentinela de
 * transporte; tudo a jusante enxerga `OperationalReading`.
 *
 * Puro e exportado: é testável sem rede, sem provedor e sem banco.
 */
export function normalizeCompactContractOperationalization(
  output: unknown,
  pageCount: number | null,
): { accepted: OperationalReading; rejected: OperationalRejection[] } {
  if (!isPlainRecord(output)) {
    throw new OperationalTransportError('A operacionalização não devolveu um objeto estruturado.');
  }
  if (!Array.isArray(output.items)) {
    throw new OperationalTransportError('A operacionalização não devolveu a lista de itens.');
  }

  const transportRejections: OperationalRejection[] = [];
  const buckets: Record<OperationalFamily, Record<string, unknown>[]> = {
    obligations: [], billing_conditions: [], guarantees: [],
    insurance_requirements: [], indexation_rules: [],
  };

  output.items.forEach((raw, index) => {
    const result = reconstructItem(raw, index);
    if (!result.ok) {
      transportRejections.push({ item: raw, family: result.family, reason: result.reason });
      return;
    }
    buckets[KIND_TO_FAMILY[result.kind]].push(result.record);
  });

  const { accepted, rejected } = assertOperationalEvidence(buckets, pageCount);
  return { accepted, rejected: [...transportRejections, ...rejected] };
}

const SYSTEM_PROMPT = `Você OPERACIONALIZA contratos brasileiros para um sistema de governança corporativa.

O CONTEXTO
O contrato foi escrito e assinado pela contraparte. Ele já vale. Você não redige, não propõe e não corrige cláusula nenhuma: você LÊ o documento e traduz o que ele exige em regras operacionais que um sistema vai monitorar.

O QUE VOCÊ PRODUZ
Uma lista única "items". Cada item é UMA exigência, com "kind" dizendo de que tipo ela é:
- obligation: algo que alguma parte tem de fazer.
- billing_condition: condição contratual que precisa estar cumprida para faturar.
- guarantee: garantia exigida (caução, fiança, seguro-garantia).
- insurance_requirement: seguro exigido.
- indexation_rule: regra de reajuste.
Não invente outro kind. Se uma família não existe no documento, simplesmente não devolva itens dela. Lista vazia é resposta correta e valiosa; item inventado é defeito grave.

FORMA DE CADA ITEM
"title" curto, "page", "excerpt", "confidence", "ambiguous", "conflicting", e "attributes": uma lista plana de pares {name, value}. TODO value é string. Não repita um mesmo "name" no mesmo item. Não envie um atributo que não pertença ao kind do item. Atributo que você não conseguiu determinar: NÃO envie, ou envie value "". Ausência é resposta; chute não é.

ATRIBUTOS POR KIND
obligation: requirement_text, category, responsible_side, activation_kind, activation_offset_days, activation_fixed_date, activation_event_text, due_kind, due_offset_days, due_fixed_date, calendar_basis, schedule_anchor, schedule_anchor_offset_days, schedule_anchor_text, recurrence_kind, recurrence_interval, blocks_billing.
billing_condition: condition_type, requirement_text, required_document_type, elapsed_period_days.
guarantee: guarantee_type, required_amount, required_percentage, percentage_basis, renewal_required.
insurance_requirement: insurance_type, required_coverage, policy_required, validity_requirement.
indexation_rule: indexer, periodicity_months, anniversary_rule, lag_months.

FORMATO DOS VALORES (o transporte é string; o formato não é opcional)
- números inteiros (qualquer *_days, *_months, recurrence_interval): só dígitos, ex. "5". Nunca "cinco", nunca "5 dias".
- valores monetários e percentuais (required_amount, required_coverage, required_percentage): decimal canônico com "." e sem separador de milhar nem símbolo — "100000" ou "100000.50", nunca "R$ 100.000,00". Percentual em pontos, ex. "5" para 5%.
- datas (activation_fixed_date, due_fixed_date): "YYYY-MM-DD" apenas.
- booleanos (blocks_billing, renewal_required, policy_required): "true" ou "false". Não envie o atributo quando o contrato não disse.
- vocabulários fechados, use exatamente um destes membros:
  responsible_side: contracting_organization, counterparty, supplier, third_party, shared, unknown.
  activation_kind: contract_start, days_after_contract_start, days_before_contract_end, fixed_date, manual, external_event, schedule_anchor, unspecified.
  due_kind: fixed_date, days_after_activation, days_before_contract_end, same_day_as_activation, recurring, days_before_schedule_anchor, days_after_schedule_anchor, unspecified.
  calendar_basis: calendar_days, business_days, unspecified.
  recurrence_kind: one_time, daily, weekly, monthly, quarterly, yearly, fixed_interval, custom.
  schedule_anchor: measurement, measurement_acceptance, project_milestone, project_start, project_end.
  condition_type: milestone_reached, measurement_accepted, service_report_required, evidence_required, technical_acceptance_required, customer_approval_required, specific_document_required, elapsed_contractual_period, contractual_event.

REGRA ABSOLUTA — EVIDÊNCIA
Todo item precisa de "page" real (página do PDF, maior que zero) e de um "excerpt" LITERAL, copiado do contrato sem paráfrase. Sem os dois, NÃO produza o item. Nunca fabrique página nem trecho para um item parecer sustentado.

REGRA ABSOLUTA — DATA QUE NÃO EXISTE
Nunca converta uma regra relativa numa data.
- "entregar até 15/10/2026" → due_kind="fixed_date", due_fixed_date="2026-10-15".
- "5 dias úteis ANTES da medição" → due_kind="days_before_schedule_anchor", schedule_anchor="measurement", schedule_anchor_offset_days="5", calendar_basis="business_days". NÃO envie due_fixed_date.
- "30 dias após o início do contrato" → activation_kind="days_after_contract_start", activation_offset_days="30".
- "mensalmente" → recurrence_kind="monthly".
- Se o contrato não diz quando, use "unspecified". Nunca chute.
A agenda real (quando a medição acontece, quando o projeto começa) NÃO está neste documento e não é sua: você identifica a âncora, o sistema espera a data.

RESPONSABILIDADE
"responsible_side" diz QUEM o contrato obriga:
- contracting_organization: a empresa que usa este sistema (a contratada/prestadora).
- counterparty: o cliente que enviou o contrato.
- supplier / third_party: terceiros nomeados (seguradora, banco garantidor, subcontratada).
- shared: obrigação expressamente conjunta.
- unknown: o contrato exige, e não deu para determinar de quem. Use isto em vez de adivinhar, e nunca atribua à contratada por padrão.

BLOQUEIO DE FATURAMENTO
"blocks_billing" só é "true" quando o contrato condiciona o pagamento/faturamento ao cumprimento. Só é "false" quando o contrato diz expressamente que não condiciona. Nos demais casos NÃO envie o atributo — a omissão significa "o contrato não disse", e zero ou false afirmariam algo que ninguém leu.

O QUE NUNCA ACONTECEU
Você lê um contrato, não a execução dele. Nunca afirme que houve medição, aceite técnico, aprovação do cliente, emissão de nota, recebimento, conciliação ou pagamento. Nunca registre revisor, aprovador ou confirmação humana. Condição de faturamento é a EXIGÊNCIA, não o cumprimento dela.

VALORES
Preencha valor, percentual e prazo APENAS quando o número está escrito no trecho. Omita o atributo, nunca envie zero: zero significaria garantia de R$ 0,00 ou prazo de 0 dias.

GARANTIA: VALOR OU PERCENTUAL, NUNCA OS DOIS
Uma garantia é um valor fixo OU um percentual — não ambos. Se o contrato diz "5% do valor total", envie required_percentage="5" e percentage_basis="valor total do contrato", sem required_amount. Se diz "R$ 100.000,00", envie required_amount="100000" e nada dos outros dois. Percentual sem dizer sobre o que incide não significa nada: nesse caso não produza o item.

CONFIANÇA E DÚVIDA
"confidence" é um número entre 0 e 1 e mede o quanto o trecho SUSTENTA a estruturação, não o quanto o item é importante. Trecho ambíguo ou cortado baixa a confiança mesmo quando a exigência parece óbvia. Marque "ambiguous" quando o texto permite mais de uma leitura e "conflicting" quando o documento traz evidências incompatíveis — item marcado assim vai para revisão humana em vez de virar regra automática, e isso é o comportamento desejado.`;

// ═══════════════════════════════════════════════════════════════════════════
// Gate de evidência
// ═══════════════════════════════════════════════════════════════════════════

export type OperationalRejection = { item: unknown; family: string; reason: string };

function evidenceOk(
  raw: Record<string, unknown>,
  family: string,
  pageCount: number | null,
  rejected: OperationalRejection[],
): boolean {
  const excerpt = typeof raw.source_excerpt === 'string' ? raw.source_excerpt.trim() : '';
  const page = raw.source_page;
  const confidence = raw.confidence;

  if (!excerpt) { rejected.push({ item: raw, family, reason: 'sem trecho de origem' }); return false; }
  if (excerpt.length < 20) {
    rejected.push({ item: raw, family, reason: 'trecho curto demais para conferência' }); return false;
  }
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1) {
    rejected.push({ item: raw, family, reason: 'sem página de origem' }); return false;
  }
  // Página fora do documento é sinal de leitura fabricada.
  if (pageCount !== null && page > pageCount) {
    rejected.push({ item: raw, family, reason: `página ${page} além do documento (${pageCount} páginas)` });
    return false;
  }
  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
    rejected.push({ item: raw, family, reason: 'confiança fora de 0..1' }); return false;
  }
  if (typeof raw.title !== 'string' || !raw.title.trim()) {
    rejected.push({ item: raw, family, reason: 'sem título' }); return false;
  }
  return true;
}

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  (typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value : fallback) as T;
const intOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) ? v : null;
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const boolOrNull = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
/*
  Os CHECK das tabelas estruturadas (migration 109) recusam valor negativo,
  período não positivo e percentual fora de 0..100. Normalizar AQUI é o que
  permite gravar as linhas boas e reportar as ruins — deixar o banco recusar
  derrubaria o INSERT em lote inteiro e perderia junto tudo que estava certo.

  Um número fora de faixa vira AUSENTE, não corrigido: "5000%" não é 100%, e
  arredondá-lo produziria um número que ninguém escreveu no contrato.
*/
const positiveIntOrNull = (v: unknown): number | null => {
  const n = intOrNull(v);
  return n !== null && n > 0 ? n : null;
};
const nonNegativeIntOrNull = (v: unknown): number | null => {
  const n = intOrNull(v);
  return n !== null && n >= 0 ? n : null;
};
const nonNegativeNumOrNull = (v: unknown): number | null => {
  const n = numOrNull(v);
  return n !== null && n >= 0 ? n : null;
};
const percentageOrNull = (v: unknown): number | null => {
  const n = numOrNull(v);
  return n !== null && n >= 0 && n <= 100 ? n : null;
};

/**
 * Garantia: valor fixo OU percentual.
 *
 * O CHECK `contract_guarantees_check` recusa os dois preenchidos, e com razão:
 * uma garantia de "R$ 100.000 e 5%" não é uma garantia — é uma leitura
 * ambígua. Escolher um dos dois em silêncio inventaria a intenção do contrato,
 * então a linha é recusada com o motivo dito.
 *
 * E percentual sem base é um número sem significado: 5% de quê? O CHECK
 * `contract_guarantees_check1` exige a base, e nós não a inventamos.
 */
export function normalizeGuarantee(
  raw: Record<string, unknown>,
): { ok: true; value: OperationalGuarantee } | { ok: false; reason: string } {
  const amount = nonNegativeNumOrNull(raw.required_amount);
  const percentage = percentageOrNull(raw.required_percentage);
  const basis = strOrNull(raw.percentage_basis);

  if (amount !== null && percentage !== null) {
    return { ok: false, reason: 'garantia com valor e percentual ao mesmo tempo: leitura ambígua' };
  }
  if (percentage !== null && basis === null) {
    return { ok: false, reason: 'percentual de garantia sem dizer sobre o que incide' };
  }

  return {
    ok: true,
    value: {
      title: String(raw.title).trim(),
      guarantee_type: strOrNull(raw.guarantee_type),
      required_amount: amount,
      required_percentage: percentage,
      percentage_basis: percentage === null ? null : basis,
      renewal_required: boolOrNull(raw.renewal_required),
      source_page: raw.source_page as number,
      source_excerpt: String(raw.source_excerpt).trim(),
      confidence: raw.confidence as number,
    },
  };
}
const strOrNull = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;
const isoDateOrNull = (v: unknown): string | null =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null;

/**
 * Coerência entre a regra e seus parâmetros.
 *
 * Os CHECK das migrations 114/155 recusariam a linha incoerente — mas recusar
 * no INSERT em lote derrubaria as obrigações boas junto. Normalizar aqui é o
 * que permite gravar o que é gravável e REPORTAR o que não foi.
 */
export function normalizeObligation(raw: Record<string, unknown>): OperationalObligation | null {
  const activationKind = oneOf(raw.activation_kind, ACTIVATION_KINDS, 'unspecified');
  const dueKind = oneOf(raw.due_kind, DUE_KINDS, 'unspecified');
  const anchored = dueKind === 'days_before_schedule_anchor' || dueKind === 'days_after_schedule_anchor'
    || activationKind === 'schedule_anchor';
  const anchor = oneOf(raw.schedule_anchor, SCHEDULE_ANCHORS, 'measurement');
  const recurrenceKind = oneOf(raw.recurrence_kind, RECURRENCE_KINDS, 'one_time');
  const recurrenceInterval = intOrNull(raw.recurrence_interval);

  const activationOffset = intOrNull(raw.activation_offset_days);
  const dueOffset = intOrNull(raw.due_offset_days);
  const anchorOffset = intOrNull(raw.schedule_anchor_offset_days);

  // Regra ancorada sem deslocamento não é regra: é a metade dela.
  if (
    (dueKind === 'days_before_schedule_anchor' || dueKind === 'days_after_schedule_anchor')
    && anchorOffset === null
  ) return null;
  // Deslocamento exigido pela regra tem de vir junto.
  if (
    (activationKind === 'days_after_contract_start' || activationKind === 'days_before_contract_end')
    && activationOffset === null
  ) return null;
  if (
    (dueKind === 'days_after_activation' || dueKind === 'days_before_contract_end')
    && dueOffset === null
  ) return null;
  const activationFixed = isoDateOrNull(raw.activation_fixed_date);
  if (activationKind === 'fixed_date' && activationFixed === null) return null;
  const dueFixed = isoDateOrNull(raw.due_fixed_date);
  if (dueKind === 'fixed_date' && dueFixed === null) return null;
  // `cod_recurring_due`: série recorrente não tem data fixa única.
  if (recurrenceKind !== 'one_time' && dueKind === 'fixed_date') return null;
  // `fixed_interval` is the only recurrence whose interval is authoritative.
  // Missing/zero/negative values are rejected here so one malformed sibling
  // never reaches (and aborts) the batch INSERT. Other kinds must not smuggle
  // an interval that their semantics ignore.
  if (recurrenceKind === 'fixed_interval' && (recurrenceInterval === null || recurrenceInterval <= 0)) {
    return null;
  }
  if (recurrenceKind !== 'fixed_interval' && recurrenceInterval !== null) return null;

  return {
    title: String(raw.title).trim(),
    requirement_text: typeof raw.requirement_text === 'string' ? raw.requirement_text.trim() : '',
    category: strOrNull(raw.category),
    responsible_side: oneOf(raw.responsible_side, RESPONSIBLE_SIDES, 'unknown'),
    activation_kind: activationKind,
    activation_offset_days:
      activationKind === 'days_after_contract_start' || activationKind === 'days_before_contract_end'
        ? activationOffset : null,
    activation_fixed_date: activationKind === 'fixed_date' ? activationFixed : null,
    activation_event_text: activationKind === 'external_event'
      ? (strOrNull(raw.activation_event_text) ?? 'evento contratual não descrito') : null,
    due_kind: dueKind,
    due_offset_days:
      dueKind === 'days_after_activation' || dueKind === 'days_before_contract_end' ? dueOffset : null,
    due_fixed_date: dueKind === 'fixed_date' ? dueFixed : null,
    calendar_basis: oneOf(raw.calendar_basis, CALENDAR_BASES, 'unspecified'),
    schedule_anchor: anchored ? anchor : null,
    schedule_anchor_offset_days:
      dueKind === 'days_before_schedule_anchor' || dueKind === 'days_after_schedule_anchor'
        ? anchorOffset : null,
    schedule_anchor_text: anchored ? strOrNull(raw.schedule_anchor_text) : null,
    recurrence_kind: recurrenceKind,
    recurrence_interval: recurrenceKind === 'fixed_interval' ? recurrenceInterval : null,
    blocks_billing: boolOrNull(raw.blocks_billing),
    source_page: raw.source_page as number,
    source_excerpt: String(raw.source_excerpt).trim(),
    confidence: raw.confidence as number,
  };
}

/**
 * Separa o que tem evidência e coerência do que não tem.
 *
 * Puro e exportado para teste: é a barreira que implementa "nunca inventar
 * exigência sem evidência documental" e "nunca inventar data", e ela precisa
 * ser verificável sem rede e sem banco.
 */
export function assertOperationalEvidence(
  parsed: Partial<Record<keyof OperationalReading, unknown[]>>,
  pageCount: number | null,
): { accepted: OperationalReading; rejected: OperationalRejection[] } {
  const rejected: OperationalRejection[] = [];
  const accepted: OperationalReading = {
    obligations: [], billing_conditions: [], guarantees: [],
    insurance_requirements: [], indexation_rules: [],
  };

  for (const raw of parsed.obligations ?? []) {
    const item = raw as Record<string, unknown>;
    if (!evidenceOk(item, 'obligation', pageCount, rejected)) continue;
    const normalized = normalizeObligation(item);
    if (!normalized) {
      rejected.push({ item: raw, family: 'obligation', reason: 'regra de prazo incoerente com seus parâmetros' });
      continue;
    }
    if (!normalized.requirement_text) {
      rejected.push({ item: raw, family: 'obligation', reason: 'sem descrição da exigência' });
      continue;
    }
    accepted.obligations.push(normalized);
  }

  for (const raw of parsed.billing_conditions ?? []) {
    const item = raw as Record<string, unknown>;
    if (!evidenceOk(item, 'billing_condition', pageCount, rejected)) continue;
    accepted.billing_conditions.push({
      title: String(item.title).trim(),
      condition_type: oneOf(item.condition_type, BILLING_CONDITION_TYPES, 'contractual_event'),
      requirement_text: typeof item.requirement_text === 'string' ? item.requirement_text.trim() : '',
      required_document_type: strOrNull(item.required_document_type),
      elapsed_period_days: positiveIntOrNull(item.elapsed_period_days),
      source_page: item.source_page as number,
      source_excerpt: String(item.source_excerpt).trim(),
      confidence: item.confidence as number,
    });
  }

  for (const raw of parsed.guarantees ?? []) {
    const item = raw as Record<string, unknown>;
    if (!evidenceOk(item, 'guarantee', pageCount, rejected)) continue;
    const normalized = normalizeGuarantee(item);
    if (!normalized.ok) {
      rejected.push({ item: raw, family: 'guarantee', reason: normalized.reason });
      continue;
    }
    accepted.guarantees.push(normalized.value);
  }

  for (const raw of parsed.insurance_requirements ?? []) {
    const item = raw as Record<string, unknown>;
    if (!evidenceOk(item, 'insurance', pageCount, rejected)) continue;
    accepted.insurance_requirements.push({
      title: String(item.title).trim(),
      insurance_type: strOrNull(item.insurance_type),
      required_coverage: nonNegativeNumOrNull(item.required_coverage),
      policy_required: boolOrNull(item.policy_required),
      validity_requirement: strOrNull(item.validity_requirement),
      source_page: item.source_page as number,
      source_excerpt: String(item.source_excerpt).trim(),
      confidence: item.confidence as number,
    });
  }

  for (const raw of parsed.indexation_rules ?? []) {
    const item = raw as Record<string, unknown>;
    if (!evidenceOk(item, 'indexation', pageCount, rejected)) continue;
    accepted.indexation_rules.push({
      title: String(item.title).trim(),
      indexer: strOrNull(item.indexer),
      periodicity_months: positiveIntOrNull(item.periodicity_months),
      anniversary_rule: strOrNull(item.anniversary_rule),
      lag_months: nonNegativeIntOrNull(item.lag_months),
      source_page: item.source_page as number,
      source_excerpt: String(item.source_excerpt).trim(),
      confidence: item.confidence as number,
    });
  }

  return { accepted, rejected };
}

/**
 * Impressão digital de uma exigência: mesma família, mesma página, mesmo
 * trecho = mesma leitura. É o que torna a reanálise segura — clicar duas vezes
 * não pode produzir duas obrigações idênticas com prazos separados.
 */
export function operationalFingerprint(family: string, page: number, excerpt: string): string {
  return createHash('sha256')
    .update(`${family}\u0000${page}\u0000${excerpt.trim()}`, 'utf8')
    .digest('hex');
}

// ═══════════════════════════════════════════════════════════════════════════
// Execução
// ═══════════════════════════════════════════════════════════════════════════

function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Credenciais de serviço do Supabase ausentes.');
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

export interface OperationalizationResult {
  analysisId: string;
  documentId: string;
  counts: Record<keyof OperationalReading, number>;
  duplicates: Record<keyof OperationalReading, number>;
  rejectedCount: number;
  rejections: OperationalRejection[];
  /** Ocorrências criadas pela materialização das obrigações estruturadas. */
  materializedInstances: number;
  /** Exigências que dependem de agenda que Projetos ainda não publicou. */
  awaitingScheduleAnchor: number;
  /** AI readings retained for exception governance, without authoritative effect. */
  requiresAttention: number;
  provider: string;
  model: string;
  version: string;
}

const EMPTY_COUNTS = (): Record<keyof OperationalReading, number> => ({
  obligations: 0, billing_conditions: 0, guarantees: 0,
  insurance_requirements: 0, indexation_rules: 0,
});

/**
 * Lê o contrato e grava o que ele EXIGE.
 *
 * A análise é registrada como `running` ANTES da chamada, pelo mesmo motivo do
 * extrator de cláusulas: uma falha de rede não pode deixar o documento com
 * aparência de "nunca analisado".
 */
export async function operationalizeContractDocument(
  contractId: string,
  documentId: string,
  actorUserId: string | null,
): Promise<OperationalizationResult> {
  const supabase = getServiceClient();

  const { data: document, error: docError } = await supabase
    .from('contract_documents')
    .select('id, contract_id, organization_id, title, file_path')
    .eq('id', documentId)
    .eq('contract_id', contractId)
    .maybeSingle<{ id: string; contract_id: string; organization_id: string; title: string; file_path: string }>();
  if (docError) throw new Error(`Erro ao carregar documento: ${docError.message}`);
  if (!document) throw new Error('Documento não encontrado para este contrato.');
  if (!document.file_path.toLowerCase().endsWith('.pdf')) {
    throw new Error('A operacionalização só lê PDF. Este documento tem outro formato.');
  }

  const { data: blob, error: dlError } = await supabase.storage
    .from(CONTRACT_FILES_BUCKET).download(document.file_path);
  if (dlError || !blob) throw new Error(`Erro ao baixar o documento: ${dlError?.message ?? 'arquivo ausente'}`);

  const bytes = Buffer.from(await blob.arrayBuffer());
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new Error(
      `O documento tem ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB e excede o limite de ${MAX_PDF_BYTES / 1024 / 1024} MB da análise.`,
    );
  }

  const { countPdfPages } = await import('@/lib/ai/contract-clause-extractor');
  const pageCount = countPdfPages(bytes);
  const startedAt = new Date().toISOString();
  const taskPolicy = getApexAITaskPolicy('CONTRACT_OPERATIONALIZATION');

  const { data: analysis, error: analysisError } = await supabase
    .from('contract_ai_analyses')
    .insert({
      organization_id: document.organization_id,
      contract_id: contractId,
      document_id: documentId,
      status: 'running',
      started_at: startedAt,
      provider: taskPolicy.provider,
      model: taskPolicy.model,
      extractor_version: OPERATIONALIZATION_VERSION,
      summary: `Operacionalizando "${document.title}".`,
      extracted_data: { kind: 'contract_operationalization', document_id: documentId },
      findings: [],
      created_by: actorUserId,
    })
    .select('id').single<{ id: string }>();
  if (analysisError) throw new Error(`Erro ao registrar a análise: ${analysisError.message}`);

  const persisted = EMPTY_COUNTS();
  let materializedInstances = 0;
  let awaitingScheduleAnchor = 0;
  const failAnalysis = async (message: string): Promise<Error> => {
    const { error } = await supabase.from('contract_ai_analyses')
      .update({
        status: 'failed',
        error_message: message,
        completed_at: new Date().toISOString(),
        extracted_data: {
          kind: 'contract_operationalization',
          version: OPERATIONALIZATION_VERSION,
          document_id: documentId,
          partial_failure: {
            retryable: true,
            persisted,
            materialized_instances: materializedInstances,
            awaiting_schedule_anchor: awaitingScheduleAnchor,
            error: message,
          },
        },
      })
      .eq('id', analysis.id);
    return new Error(error
      ? `${message} (e a análise não pôde ser marcada como failed: ${error.message})`
      : message);
  };

  let response: ApexAIResponse<OperationalProviderTransport>;
  try {
    response = await getApexAIGateway().generate({
      organizationId: document.organization_id,
      task: 'CONTRACT_OPERATIONALIZATION',
      systemPrompt: SYSTEM_PROMPT,
      userPrompt:
        'Leia este contrato e devolva, em "items", o que ele EXIGE em operação: obrigações de cada parte, condições de faturamento, garantias, seguros e regras de reajuste. Se alguma família não existir no documento, simplesmente não devolva itens dela.',
      document: { mediaType: 'application/pdf', base64: bytes.toString('base64') },
      structuredOutput: { name: 'contract_operationalization', schema: OPERATIONALIZATION_SCHEMA },
    });
  } catch (err) {
    throw await failAnalysis(
      `A operacionalização falhou: ${err instanceof Error ? err.message : 'erro inesperado'}`);
  }

  let accepted: OperationalReading;
  let rejected: OperationalRejection[];
  try {
    // Fronteira determinística: o transporte compacto (uma lista genérica de
    // itens com atributos nome/valor em string) é validado e reconstruído na
    // leitura canônica AQUI, antes do gate de confiança, da materialização e de
    // qualquer escrita. Nada a jusante enxerga sentinela de transporte.
    ({ accepted, rejected } = normalizeCompactContractOperationalization(response.output, pageCount));
  } catch (error) {
    throw await failAnalysis(`Resposta operacional inválida: ${error instanceof Error ? error.message : 'erro inesperado'}`);
  }

  // ── idempotência ─────────────────────────────────────────────────────────
  const existingKeys = new Set<string>();
  const loadExisting = async (table: string) => {
    const { data, error } = await supabase.from(table)
      .select('ai_fingerprint')
      .eq('contract_id', contractId).eq('source_document_id', documentId);
    if (error) {
      throw await failAnalysis(`Erro ao carregar fingerprints existentes de ${table}: ${error.message}`);
    }
    for (const row of data ?? []) {
      const fingerprint = row.ai_fingerprint as string | null;
      if (fingerprint) existingKeys.add(fingerprint);
    }
  };
  await Promise.all([
    loadExisting('contract_obligation_definitions'),
    loadExisting('contract_billing_conditions'),
    loadExisting('contract_guarantees'),
    loadExisting('contract_insurance_requirements'),
    loadExisting('contract_indexation_rules'),
  ]);

  const counts = EMPTY_COUNTS();
  const duplicates = EMPTY_COUNTS();
  const base = { organization_id: document.organization_id, contract_id: contractId };

  const families: { [K in OperationalFamily]: OperationalReading[K] } = {
    obligations: accepted.obligations,
    billing_conditions: accepted.billing_conditions,
    guarantees: accepted.guarantees,
    insurance_requirements: accepted.insurance_requirements,
    indexation_rules: accepted.indexation_rules,
  };
  const trust = new Map<object, OperationalTrustDecision>();
  const interpretationRows: Record<string, unknown>[] = [];
  const interpretationKeys = new Set<string>();
  for (const [family, items] of Object.entries(families) as [OperationalFamily, OperationalReading[OperationalFamily]][]) {
    for (const item of items) {
      const decision = evaluateOperationalTrust(
        family,
        item as unknown as { confidence: number } & Record<string, unknown>,
      );
      trust.set(item, decision);
      const fingerprint = operationalFingerprint(family, item.source_page, item.source_excerpt);
      const interpretationKey = `${family}:${fingerprint}`;
      if (interpretationKeys.has(interpretationKey)) continue;
      interpretationKeys.add(interpretationKey);
      interpretationRows.push({
        ...base,
        analysis_id: analysis.id,
        source_document_id: documentId,
        family,
        fingerprint,
        normalized_payload: item,
        source_page: item.source_page,
        source_excerpt: item.source_excerpt,
        confidence: item.confidence,
        provider: response.provenance.provider,
        model: response.provenance.model,
        pipeline_version: OPERATIONALIZATION_VERSION,
        requesting_user_id: actorUserId,
        trust_state: decision.state,
        trust_reasons: decision.reasons,
        trust_policy_version: decision.policyVersion,
      });
    }
  }
  if (interpretationRows.length > 0) {
    const { error } = await supabase.from('contract_operational_interpretations').insert(interpretationRows);
    if (error) throw await failAnalysis(`Erro ao registrar interpretações operacionais: ${error.message}`);
  }
  const requiresAttention = interpretationRows
    .filter((row) => row.trust_state === 'requires_attention').length;
  const authoritative = <T extends object>(items: T[]): T[] =>
    items.filter((item) => trust.get(item)?.state === 'automatic');

  const fresh = <T extends { source_page: number; source_excerpt: string }>(
    items: T[], family: string, key: keyof OperationalReading,
  ): T[] => {
    const kept = items.filter((item) => {
      const fingerprint = operationalFingerprint(family, item.source_page, item.source_excerpt);
      if (existingKeys.has(fingerprint)) return false;
      existingKeys.add(fingerprint);
      return true;
    });
    duplicates[key] = items.length - kept.length;
    counts[key] = kept.length;
    return kept;
  };

  const freshObligations = fresh(authoritative(accepted.obligations), 'obligation', 'obligations');
  const freshBilling = fresh(authoritative(accepted.billing_conditions), 'billing_condition', 'billing_conditions');
  const freshGuarantees = fresh(authoritative(accepted.guarantees), 'guarantee', 'guarantees');
  const freshInsurance = fresh(authoritative(accepted.insurance_requirements), 'insurance', 'insurance_requirements');
  const freshIndexation = fresh(authoritative(accepted.indexation_rules), 'indexation', 'indexation_rules');

  const aiProvenance = (
    family: string,
    item: { source_page: number; source_excerpt: string; confidence: number },
  ) => ({
    ai_origin: 'apex_ai',
    ai_analysis_id: analysis.id,
    ai_provider: response.provenance.provider,
    ai_model: response.provenance.model,
    ai_confidence: item.confidence,
    ai_pipeline_version: OPERATIONALIZATION_VERSION,
    ai_requesting_user_id: actorUserId,
    ai_evidence: { documentId, page: item.source_page, excerpt: item.source_excerpt },
    ai_fingerprint: operationalFingerprint(family, item.source_page, item.source_excerpt),
  });

  if (freshObligations.length > 0) {
    const { data: inserted, error } = await supabase
      .from('contract_obligation_definitions')
      .insert(freshObligations.map((o) => ({
        ...base,
        ...aiProvenance('obligation', o),
        title: o.title,
        requirement_text: o.requirement_text,
        category: o.category,
        responsible_side: o.responsible_side,
        source_document_id: documentId,
        source_page: o.source_page,
        source_excerpt: o.source_excerpt,
        activation_kind: o.activation_kind,
        activation_offset_days: o.activation_offset_days,
        activation_fixed_date: o.activation_fixed_date,
        activation_event_text: o.activation_event_text,
        due_kind: o.due_kind,
        due_offset_days: o.due_offset_days,
        due_fixed_date: o.due_fixed_date,
        calendar_basis: o.calendar_basis,
        schedule_anchor: o.schedule_anchor,
        schedule_anchor_offset_days: o.schedule_anchor_offset_days,
        schedule_anchor_text: o.schedule_anchor_text,
        recurrence_kind: o.recurrence_kind,
        recurrence_interval: o.recurrence_interval,
        blocks_billing: o.blocks_billing,
        created_by: actorUserId,
        recorded_note: `Estruturada pelo Apex a partir de "${document.title}" (${OPERATIONALIZATION_VERSION}).`,
      })))
      .select('id');
    if (error) throw await failAnalysis(`Erro ao registrar as obrigações: ${error.message}`);
    persisted.obligations = inserted?.length ?? 0;

    /*
      Materializar aqui, e não num job depois, é o que faz o contrato ENTRAR EM
      OPERAÇÃO no ato da leitura. O horizonte é o fim do contrato; a função é
      idempotente, então rodar de novo não duplica ocorrência.
    */
    const horizon = new Date();
    horizon.setUTCFullYear(horizon.getUTCFullYear() + 2);
    for (const row of inserted ?? []) {
      const { data: created, error: materializeError } = await supabase.rpc('contract_obligations_materialize', {
        p_definition_id: row.id,
        p_through: horizon.toISOString().slice(0, 10),
        p_organization_id: document.organization_id,
      });
      if (materializeError) {
        throw await failAnalysis(`Erro ao materializar obrigação ${row.id}: ${materializeError.message}`);
      }
      materializedInstances += Number(created ?? 0);
    }
    const { count, error: countError } = await supabase
      .from('contract_obligation_instances')
      .select('id', { count: 'exact', head: true })
      .eq('contract_id', contractId)
      .eq('date_state', 'AWAITING_SCHEDULE_ANCHOR');
    if (countError) throw await failAnalysis(`Erro ao contar âncoras pendentes: ${countError.message}`);
    awaitingScheduleAnchor = count ?? 0;
  }

  const factBase = (
    family: string,
    item: { title: string; source_page: number; source_excerpt: string; confidence: number },
  ) => ({
    ...base,
    ...aiProvenance(family, item),
    title: item.title,
    source_document_id: documentId,
    source_page: item.source_page,
    source_reference: item.source_excerpt,
    created_by: actorUserId,
  });

  if (freshBilling.length > 0) {
    const { error } = await supabase.from('contract_billing_conditions').insert(
      freshBilling.map((b) => ({
        ...factBase('billing_condition', b),
        condition_type: b.condition_type,
        requirement_text: b.requirement_text,
        required_document_type: b.required_document_type,
        elapsed_period_days: b.elapsed_period_days,
      })));
    if (error) throw await failAnalysis(`Erro ao registrar condições de faturamento: ${error.message}`);
    persisted.billing_conditions = freshBilling.length;
  }
  if (freshGuarantees.length > 0) {
    const { error } = await supabase.from('contract_guarantees').insert(
      freshGuarantees.map((g) => ({
        ...factBase('guarantee', g),
        guarantee_type: g.guarantee_type,
        required_amount: g.required_amount,
        required_percentage: g.required_percentage,
        percentage_basis: g.percentage_basis,
        renewal_required: g.renewal_required,
      })));
    if (error) throw await failAnalysis(`Erro ao registrar garantias: ${error.message}`);
    persisted.guarantees = freshGuarantees.length;
  }
  if (freshInsurance.length > 0) {
    const { error } = await supabase.from('contract_insurance_requirements').insert(
      freshInsurance.map((i) => ({
        ...factBase('insurance', i),
        insurance_type: i.insurance_type,
        required_coverage: i.required_coverage,
        policy_required: i.policy_required,
        validity_requirement: i.validity_requirement,
      })));
    if (error) throw await failAnalysis(`Erro ao registrar exigências de seguro: ${error.message}`);
    persisted.insurance_requirements = freshInsurance.length;
  }
  if (freshIndexation.length > 0) {
    const { error } = await supabase.from('contract_indexation_rules').insert(
      freshIndexation.map((r) => ({
        ...factBase('indexation', r),
        indexer: r.indexer,
        periodicity_months: r.periodicity_months,
        anniversary_rule: r.anniversary_rule,
        lag_months: r.lag_months,
      })));
    if (error) throw await failAnalysis(`Erro ao registrar regras de reajuste: ${error.message}`);
    persisted.indexation_rules = freshIndexation.length;
  }

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const { error: completionError } = await supabase.from('contract_ai_analyses').update({
    status: 'completed',
    provider: response.provenance.provider,
    model: response.provenance.model,
    input_tokens: response.provenance.usage.inputTokens,
    output_tokens: response.provenance.usage.outputTokens,
    completed_at: new Date().toISOString(),
    summary: total === 0
      ? `Nenhuma exigência operacional com evidência suficiente foi encontrada em "${document.title}".`
      : `${total} exigência(s) operacionais estruturadas a partir de "${document.title}".`,
    risk_summary: awaitingScheduleAnchor > 0
      ? `${awaitingScheduleAnchor} exigência(s) aguardam a agenda de Projetos para ter prazo.`
      : null,
    extracted_data: {
      kind: 'contract_operationalization',
      version: OPERATIONALIZATION_VERSION,
      provider: response.provenance.provider,
      model: response.provenance.model,
      document_id: documentId,
      document_title: document.title,
      started_at: startedAt,
      page_count: pageCount,
      counts,
      duplicates_skipped: duplicates,
      rejected_without_evidence: rejected.length,
      requires_attention: requiresAttention,
      trust_policy_version: OPERATIONAL_TRUST_POLICY_VERSION,
      materialized_instances: materializedInstances,
      awaiting_schedule_anchor: awaitingScheduleAnchor,
      usage: {
        input_tokens: response.provenance.usage.inputTokens,
        output_tokens: response.provenance.usage.outputTokens,
      },
    },
    findings: [
      ...rejected.map((r) => ({ family: r.family, reason: r.reason })),
      ...interpretationRows
        .filter((row) => row.trust_state === 'requires_attention')
        .map((row) => ({
          family: row.family,
          reason: 'requires_attention',
          trust_reasons: row.trust_reasons,
          fingerprint: row.fingerprint,
        })),
    ],
  }).eq('id', analysis.id);
  if (completionError) {
    throw await failAnalysis(`Erro ao finalizar a análise: ${completionError.message}`);
  }

  return {
    analysisId: analysis.id,
    documentId,
    counts,
    duplicates,
    rejectedCount: rejected.length,
    rejections: rejected,
    materializedInstances,
    awaitingScheduleAnchor,
    requiresAttention,
    provider: response.provenance.provider,
    model: response.provenance.model,
    version: OPERATIONALIZATION_VERSION,
  };
}
