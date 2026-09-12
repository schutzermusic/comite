/**
 * Pure contract-intake trust policy.
 *
 * The document reader proposes evidence. This module, not the provider, decides
 * what may prefill the registration. Unknown, ambiguous and conflicting values
 * never become contractual truth by accident.
 */

export const CONTRACT_ONBOARDING_PIPELINE_VERSION = 'contract-onboarding/1.0.0';
export const CONTRACT_ONBOARDING_TRUST_VERSION = 'contract-onboarding-trust/1.0.0';
export const MIN_ONBOARDING_CONFIDENCE = 0.85;

export type PendingReason =
  | 'NOT_FOUND_IN_DOCUMENT'
  | 'AMBIGUOUS'
  | 'LOW_CONFIDENCE'
  | 'INTERNAL_DECISION_REQUIRED'
  | 'CONFLICTING_EVIDENCE'
  | 'PROJECT_MAPPING_REQUIRED'
  | 'GOVERNED_CONFIRMATION_REQUIRED';

export type IntakeFieldState = 'identified' | 'attention' | 'unknown';

export interface DocumentaryFact<T = string | number | boolean | null> {
  value: T;
  page: number | null;
  excerpt: string | null;
  confidence: number;
  ambiguous: boolean;
  conflicting: boolean;
}

export interface EffectiveDateFact extends DocumentaryFact<string | null> {
  derivation: 'explicit' | 'from_signature' | 'unknown';
}

export interface RiskRecommendation extends DocumentaryFact<'low' | 'medium' | 'high' | null> {
  factors: string[];
}

export interface ContractOnboardingExtraction {
  contract_number: DocumentaryFact<string | null>;
  title: DocumentaryFact<string | null>;
  counterparty: DocumentaryFact<string | null>;
  contract_type: DocumentaryFact<string | null>;
  object: DocumentaryFact<string | null>;
  documentary_state: DocumentaryFact<'draft' | 'signed' | 'active' | 'cancelled' | 'expired' | 'unknown'>;
  signature_date: DocumentaryFact<string | null>;
  start_date: DocumentaryFact<string | null>;
  effective_date: EffectiveDateFact;
  end_date: DocumentaryFact<string | null>;
  renewal_date: DocumentaryFact<string | null>;
  total_value: DocumentaryFact<number | null>;
  monthly_value: DocumentaryFact<number | null>;
  currency: DocumentaryFact<string | null>;
  payment_terms: DocumentaryFact<string | null>;
  indexation: DocumentaryFact<string | null>;
  retention: DocumentaryFact<string | null>;
  risk: RiskRecommendation;
}

export type OnboardingFieldKey = keyof ContractOnboardingExtraction | 'responsible_internal' | 'project';

export interface ClassifiedIntakeField {
  key: OnboardingFieldKey;
  label: string;
  value: string | number | null;
  state: IntakeFieldState;
  reason: PendingReason | null;
  explanation: string;
  page: number | null;
  excerpt: string | null;
}

export interface ContractOnboardingResult {
  fields: ClassifiedIntakeField[];
  prefill: Record<string, string | number | null>;
  identifiedCount: number;
  attentionCount: number;
  unknownCount: number;
  riskFactors: string[];
}

const LABELS: Record<keyof ContractOnboardingExtraction, string> = {
  contract_number: 'Nº do contrato', title: 'Nome do contrato', counterparty: 'Contraparte',
  contract_type: 'Tipo de contrato', object: 'Objeto do contrato', documentary_state: 'Situação do contrato',
  signature_date: 'Data de assinatura', start_date: 'Início da vigência',
  effective_date: 'Data de eficácia', end_date: 'Fim da vigência', renewal_date: 'Data de renovação',
  total_value: 'Valor contratual', monthly_value: 'Valor mensal', currency: 'Moeda',
  payment_terms: 'Condições de pagamento', indexation: 'Reajuste', retention: 'Retenção',
  risk: 'Classificação de risco',
};

const PREFILL_KEYS: Partial<Record<keyof ContractOnboardingExtraction, string>> = {
  contract_number: 'contractNumber', title: 'title', counterparty: 'counterparty',
  contract_type: 'type', object: 'scopeSummary', documentary_state: 'status',
  signature_date: 'signedDate', start_date: 'startDate', end_date: 'endDate',
  renewal_date: 'renewalDate', total_value: 'totalValue', monthly_value: 'monthlyValue',
  currency: 'currency', payment_terms: 'paymentTerms',
};

const STATUS_MAP: Record<string, string> = {
  draft: 'negotiation', signed: 'signed', active: 'active', cancelled: 'cancelled', expired: 'expired',
};

/**
 * Deterministic trust gate for documentary evidence.
 *
 * Removing JSON Schema `minimum`/`maximum` from the provider schema does NOT
 * weaken trust — those keywords shifted the constraint to this runtime check,
 * which is stricter: it rejects non-finite values the JSON Schema range would
 * never even see.
 *
 * Out-of-range model values (< 0, > 1, NaN, Infinity) are invalid evidence and
 * must never become identified/trusted facts. Do NOT clamp — transform to zero
 * or one hides a model misbehaviour that should trigger human attention instead.
 */
export function hasStrongEvidence(fact: DocumentaryFact<unknown>): boolean {
  return Number.isInteger(fact.page) && Number(fact.page) > 0
    && typeof fact.excerpt === 'string' && fact.excerpt.trim().length >= 8
    && Number.isFinite(fact.confidence)
    && fact.confidence >= 0
    && fact.confidence <= 1
    && fact.confidence >= MIN_ONBOARDING_CONFIDENCE
    && !fact.ambiguous && !fact.conflicting;
}

function classify(key: keyof ContractOnboardingExtraction, fact: DocumentaryFact): ClassifiedIntakeField {
  const base = { key, label: LABELS[key], value: fact.value as string | number | null,
    page: fact.page, excerpt: fact.excerpt };
  if (fact.value === null || fact.value === '' || fact.value === 'unknown') {
    return { ...base, value: null, state: 'unknown', reason: 'NOT_FOUND_IN_DOCUMENT',
      explanation: 'Não identificada de forma inequívoca no documento.' };
  }
  if (fact.conflicting) return { ...base, state: 'attention', reason: 'CONFLICTING_EVIDENCE',
    explanation: 'O documento apresenta informações conflitantes.' };
  if (fact.ambiguous) return { ...base, state: 'attention', reason: 'AMBIGUOUS',
    explanation: 'O documento permite mais de uma interpretação.' };
  if (!hasStrongEvidence(fact)) return { ...base, state: 'attention', reason: 'LOW_CONFIDENCE',
    explanation: 'A evidência documental não é suficiente para preencher com segurança.' };
  if (key === 'risk') return { ...base, state: 'attention', reason: 'GOVERNED_CONFIRMATION_REQUIRED',
    explanation: 'O Apex recomenda esta classificação; a decisão interna precisa ser confirmada.' };
  return { ...base, state: 'identified', reason: null, explanation: 'Confirmado pelo documento.' };
}

/** Effective-from-signature is safe only when both pieces of evidence are strong. */
export function resolveEffectiveDate(extraction: ContractOnboardingExtraction): EffectiveDateFact {
  const effective = extraction.effective_date;
  if (effective.derivation === 'explicit') {
    return hasStrongEvidence(effective) ? effective : { ...effective, value: null };
  }
  if (effective.derivation === 'from_signature'
      && hasStrongEvidence(effective) && hasStrongEvidence(extraction.signature_date)
      && extraction.signature_date.value) {
    return { ...effective, value: extraction.signature_date.value };
  }
  return { ...effective, value: null, ambiguous: effective.derivation !== 'unknown' || effective.ambiguous };
}

export function buildContractOnboardingResult(raw: ContractOnboardingExtraction): ContractOnboardingResult {
  const extraction = { ...raw, effective_date: resolveEffectiveDate(raw) };
  const fields = (Object.keys(LABELS) as Array<keyof ContractOnboardingExtraction>)
    .map((key) => classify(key, extraction[key] as DocumentaryFact));

  // These are organizational decisions. They are never part of the document schema.
  fields.push({ key: 'responsible_internal', label: 'Responsável interno', value: null,
    state: 'attention', reason: 'INTERNAL_DECISION_REQUIRED', page: null, excerpt: null,
    explanation: 'O documento não determina quem será o responsável interno por este contrato.' });
  fields.push({ key: 'project', label: 'Projeto relacionado', value: null,
    state: 'attention', reason: 'PROJECT_MAPPING_REQUIRED', page: null, excerpt: null,
    explanation: 'Nenhum vínculo determinístico foi encontrado com um projeto existente.' });

  const prefill: Record<string, string | number | null> = {};
  for (const field of fields) {
    if (field.state !== 'identified') continue;
    const target = PREFILL_KEYS[field.key as keyof ContractOnboardingExtraction];
    if (target) prefill[target] = field.key === 'documentary_state'
      ? STATUS_MAP[String(field.value)] ?? null : field.value;
  }
  // The effective date is the best supported execution-start fact when no explicit start exists.
  const effectiveField = fields.find((field) => field.key === 'effective_date');
  if (!prefill.startDate && effectiveField?.state === 'identified') prefill.startDate = effectiveField.value;

  return {
    fields, prefill,
    identifiedCount: fields.filter((f) => f.state === 'identified').length,
    attentionCount: fields.filter((f) => f.state === 'attention').length,
    unknownCount: fields.filter((f) => f.state === 'unknown').length,
    riskFactors: raw.risk.factors,
  };
}


/* ------------------------------------------------------------------------ *
 * PROVIDER TRANSPORT (compact)                                              *
 * ------------------------------------------------------------------------ */

/**
 * Provider-facing structured-output schema (Anthropic dialect) — COMPACT form.
 *
 * Production failure (request req_011CexwaB6XrwPFHY8ybZdYD):
 *   HTTP 400 invalid_request_error
 *   "The compiled grammar is too large, which would cause performance issues."
 *
 * That is a THIRD, independent defect. It is not the `minimum`/`maximum`
 * keyword defect, not the documented 16-union cap and not the 24-optional cap:
 * the deployed schema already measured 2 unions and 0 optionals and was still
 * rejected. Anthropic additionally enforces an INTERNAL limit on the size of
 * the compiled grammar, and the previous schema expanded eighteen separate
 * documentary-evidence objects, each repeating six properties — a large nested
 * grammar even though every explicit limit passed.
 *
 * The fix changes the PROVIDER TRANSPORT SHAPE only. The canonical Apex domain
 * model (ContractOnboardingExtraction, DocumentaryFact, EffectiveDateFact,
 * RiskRecommendation) is untouched, as is the trust gate. One Sonnet call, one
 * PDF, all documentary evidence, all trust semantics.
 *
 *   OLD: 18 field-specific evidence object schemas, one per documentary field.
 *   NEW: ONE generic fact-item schema inside a single `facts` array, plus two
 *        small scalar/array siblings.
 *
 * Transport is deliberately narrow so the compiled grammar stays minimal:
 *   - `value` is ONE type (`string`). No number|string|null unions anywhere.
 *   - absence uses domain-safe sentinels that cannot be confused with evidence:
 *       page 0, excerpt "", value "" (or the explicit enum member "unknown").
 *   - monetary values travel as canonical decimal strings ("1500000.50").
 *   - dates travel as strict ISO ("2026-09-12").
 *
 * The array cannot guarantee one item per key, so the required-key set is
 * validated DETERMINISTICALLY after the response by
 * normalizeCompactContractOnboardingExtraction() — missing, duplicate and
 * unknown keys all fail safe rather than being silently repaired.
 */

/** The 18 canonical documentary fields the provider must report, in canonical order. */
export const CONTRACT_ONBOARDING_FACT_KEYS = [
  'contract_number', 'title', 'counterparty', 'contract_type', 'object', 'documentary_state',
  'signature_date', 'start_date', 'effective_date', 'end_date', 'renewal_date',
  'total_value', 'monthly_value', 'currency', 'payment_terms', 'indexation', 'retention', 'risk',
] as const;

export type ContractOnboardingFactKey = (typeof CONTRACT_ONBOARDING_FACT_KEYS)[number];

export const CONTRACT_TYPE_VALUES = [
  'Prestação de serviços', 'Fornecimento', 'Ordem de serviço', 'Manutenção', 'Aditivo contratual', 'unknown',
] as const;
export const DOCUMENTARY_STATE_VALUES = ['draft', 'signed', 'active', 'cancelled', 'expired', 'unknown'] as const;
export const RISK_VALUES = ['low', 'medium', 'high', 'unknown'] as const;
export const EFFECTIVE_DATE_DERIVATIONS = ['explicit', 'from_signature', 'unknown'] as const;

/**
 * The single generic fact-item schema. There is exactly one of these in the
 * whole provider schema — that is the entire point of this refactor.
 *
 * `minimum`/`maximum` are NOT used: the Anthropic structured-output dialect
 * rejects them, and hasStrongEvidence() enforces the 0..1 confidence invariant
 * more strictly at runtime anyway (it also rejects NaN/Infinity).
 */
const providerFactItem = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'value', 'page', 'excerpt', 'confidence', 'ambiguous', 'conflicting'],
  properties: {
    key: { type: 'string', enum: [...CONTRACT_ONBOARDING_FACT_KEYS] },
    value: { type: 'string' },
    page: { type: 'integer' },
    excerpt: { type: 'string' },
    confidence: { type: 'number' },
    ambiguous: { type: 'boolean' },
    conflicting: { type: 'boolean' },
  },
} as const;

export const CONTRACT_ONBOARDING_EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['facts', 'effective_date_derivation', 'risk_factors'],
  properties: {
    facts: { type: 'array', items: providerFactItem },
    // One compact top-level derivation field instead of a derivation property
    // repeated on every fact. Consumed only when reconstructing effective_date.
    effective_date_derivation: { type: 'string', enum: [...EFFECTIVE_DATE_DERIVATIONS] },
    // Risk itself is just the generic fact with key "risk"; only its factor list
    // needs a separate home, so it stays a flat array of strings at the root.
    risk_factors: { type: 'array', items: { type: 'string' } },
  },
};

export interface ContractOnboardingProviderFact {
  key: ContractOnboardingFactKey;
  value: string;
  page: number;
  excerpt: string;
  confidence: number;
  ambiguous: boolean;
  conflicting: boolean;
}

/** Raw shape returned by Anthropic for CONTRACT_EXTRACTION — see CONTRACT_ONBOARDING_EXTRACTION_SCHEMA. */
export interface ContractOnboardingProviderExtraction {
  facts: ContractOnboardingProviderFact[];
  effective_date_derivation: (typeof EFFECTIVE_DATE_DERIVATIONS)[number];
  risk_factors: string[];
}

/**
 * Deterministic rejection of a provider payload that does not honour the
 * transport contract at all (wrong root shape, wrong item shape, or a fact key
 * set that is not exactly the 18 expected keys).
 *
 * This is a FAIL-SAFE, not a repair: a missing key is NOT read as "not found in
 * the document", a duplicate key is NOT resolved by picking first or last, and
 * an unknown key is never ignored. The intake fails and a human retries.
 */
export class ContractOnboardingTransportError extends Error {
  readonly code = 'CONTRACT_ONBOARDING_TRANSPORT_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'ContractOnboardingTransportError';
  }
}

/**
 * Canonical decimal monetary transport parser.
 *
 * Accepts ONLY the canonical decimal string the system prompt mandates:
 * optional integer part with no grouping separators, "." as the decimal
 * separator. "" is the documented absence sentinel and yields null.
 *
 * Everything else — "R$ 1.500,00", "1,500.00", "one million", "NaN",
 * "Infinity", "-10", "1e6" — is rejected. Locale coercion is deliberately NOT
 * attempted: guessing whether "1.500" means one-and-a-half or fifteen hundred
 * would put a fabricated number into contractual truth.
 */
export function parseMonetaryTransportValue(raw: string): { ok: true; value: number | null } | { ok: false } {
  if (typeof raw !== 'string') return { ok: false };
  if (raw === '') return { ok: true, value: null };
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(raw)) return { ok: false };
  const value = Number(raw);
  // Unreachable for a string matching the pattern, but never let a non-finite
  // number reach canonical truth on the strength of a regex alone.
  if (!Number.isFinite(value)) return { ok: false };
  return { ok: true, value };
}

/**
 * Strict canonical ISO date transport validation (YYYY-MM-DD), including a real
 * calendar check so "2026-99-99" and "2026-02-30" are rejected. No reformatting:
 * "12/09/2026" is invalid transport, never silently reinterpreted.
 */
export function isCanonicalIsoDate(raw: string): boolean {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const [year, month, day] = raw.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertProviderFactShape(item: unknown, index: number): ContractOnboardingProviderFact {
  if (!isPlainObject(item)) {
    throw new ContractOnboardingTransportError(`Contract fact #${index} is not an object.`);
  }
  const { key, value, page, excerpt, confidence, ambiguous, conflicting } = item;
  if (typeof key !== 'string') throw new ContractOnboardingTransportError(`Contract fact #${index} has no key.`);
  if (typeof value !== 'string') throw new ContractOnboardingTransportError(`Contract fact "${key}" has a non-string value.`);
  if (typeof page !== 'number' || !Number.isInteger(page)) {
    throw new ContractOnboardingTransportError(`Contract fact "${key}" has a non-integer page.`);
  }
  if (typeof excerpt !== 'string') throw new ContractOnboardingTransportError(`Contract fact "${key}" has a non-string excerpt.`);
  if (typeof confidence !== 'number') throw new ContractOnboardingTransportError(`Contract fact "${key}" has a non-numeric confidence.`);
  if (typeof ambiguous !== 'boolean' || typeof conflicting !== 'boolean') {
    throw new ContractOnboardingTransportError(`Contract fact "${key}" has non-boolean ambiguity flags.`);
  }
  return { key: key as ContractOnboardingFactKey, value, page, excerpt, confidence, ambiguous, conflicting };
}

/**
 * Required-key set validation. An array schema cannot express "exactly one item
 * per enum member", so the invariant is enforced here, deterministically.
 */
function indexProviderFacts(facts: unknown): Map<ContractOnboardingFactKey, ContractOnboardingProviderFact> {
  if (!Array.isArray(facts)) throw new ContractOnboardingTransportError('Contract extraction returned no fact list.');
  const expected = new Set<string>(CONTRACT_ONBOARDING_FACT_KEYS);
  const index = new Map<ContractOnboardingFactKey, ContractOnboardingProviderFact>();
  facts.forEach((item, position) => {
    const fact = assertProviderFactShape(item, position);
    if (!expected.has(fact.key)) {
      throw new ContractOnboardingTransportError(`Contract extraction returned an unknown fact key "${fact.key}".`);
    }
    if (index.has(fact.key)) {
      throw new ContractOnboardingTransportError(`Contract extraction returned a duplicate fact key "${fact.key}".`);
    }
    index.set(fact.key, fact);
  });
  const missing = CONTRACT_ONBOARDING_FACT_KEYS.filter((key) => !index.has(key));
  if (missing.length > 0) {
    throw new ContractOnboardingTransportError(`Contract extraction omitted required fact keys: ${missing.join(', ')}.`);
  }
  return index;
}

function normalizePage(page: number): number | null {
  return Number.isInteger(page) && page > 0 ? page : null;
}

function normalizeExcerpt(excerpt: string): string | null {
  return typeof excerpt === 'string' && excerpt.trim().length > 0 ? excerpt : null;
}

function evidenceOf(fact: ContractOnboardingProviderFact) {
  return {
    page: normalizePage(fact.page),
    excerpt: normalizeExcerpt(fact.excerpt),
    confidence: fact.confidence,
    ambiguous: fact.ambiguous,
    conflicting: fact.conflicting,
  };
}

/**
 * Value-level fail-safe.
 *
 * A payload that honours the transport contract but carries a value the domain
 * cannot accept (a malformed monetary string, a non-ISO date, an out-of-domain
 * enum member) does NOT reject the whole intake — the remaining 17 facts are
 * still legitimate documentary evidence. Instead that single fact collapses to
 * canonical absence: value null, evidence stripped, confidence 0, so the
 * existing classifier reports it as unknown and it can never be prefilled or
 * persisted as truth. Invalid transport never becomes authoritative.
 */
function canonicalAbsence(fact: ContractOnboardingProviderFact): DocumentaryFact<null> {
  return { value: null, page: null, excerpt: null, confidence: 0, ambiguous: fact.ambiguous, conflicting: fact.conflicting };
}

/** String-domain fact: "" is the absence sentinel. */
function stringFact(fact: ContractOnboardingProviderFact): DocumentaryFact<string | null> {
  if (fact.value === '') return canonicalAbsence(fact);
  return { value: fact.value, ...evidenceOf(fact) };
}

/** Date-domain fact: "" is absence; a non-empty value must be strict ISO or it collapses to absence. */
function dateFact(fact: ContractOnboardingProviderFact): DocumentaryFact<string | null> {
  if (fact.value === '' || !isCanonicalIsoDate(fact.value)) return canonicalAbsence(fact);
  return { value: fact.value, ...evidenceOf(fact) };
}

/** Monetary fact: canonical decimal string in, canonical `number | null` out. */
function monetaryFact(fact: ContractOnboardingProviderFact): DocumentaryFact<number | null> {
  const parsed = parseMonetaryTransportValue(fact.value);
  if (!parsed.ok || parsed.value === null) return canonicalAbsence(fact);
  return { value: parsed.value, ...evidenceOf(fact) };
}

/** Closed-enum fact whose "unknown" member is the absence sentinel (contract_type, risk). */
function enumFact(fact: ContractOnboardingProviderFact, allowed: readonly string[]): DocumentaryFact<string | null> {
  if (!allowed.includes(fact.value) || fact.value === 'unknown') return canonicalAbsence(fact);
  return { value: fact.value, ...evidenceOf(fact) };
}

/**
 * documentary_state's "unknown" is a legitimate canonical state of the contract
 * itself, not a transport absence sentinel — it must NOT become null. An
 * out-of-domain value still fails safe, to "unknown" with its evidence stripped.
 */
function documentaryStateFact(
  fact: ContractOnboardingProviderFact,
): DocumentaryFact<ContractOnboardingExtraction['documentary_state']['value']> {
  type State = ContractOnboardingExtraction['documentary_state']['value'];
  if (!DOCUMENTARY_STATE_VALUES.includes(fact.value as State)) {
    return { ...canonicalAbsence(fact), value: 'unknown' };
  }
  return { value: fact.value as State, ...evidenceOf(fact) };
}

/**
 * Normalization boundary between the compact provider transport and canonical
 * Apex documentary truth.
 *
 * This is the ONLY place transport sentinels (page 0, empty excerpt/value,
 * "unknown" enum members, decimal monetary strings) are interpreted. Everything
 * downstream — hasStrongEvidence, buildContractOnboardingResult, persistence,
 * prefill — sees only the canonical null-based ContractOnboardingExtraction,
 * unchanged by this refactor.
 *
 * Does NOT clamp confidence, does NOT invent evidence, does NOT alter
 * ambiguous/conflicting on a valid fact — those pass through for the
 * deterministic trust gate to evaluate.
 *
 * @throws ContractOnboardingTransportError when the required key set is not
 * exactly the 18 expected keys, or an item does not honour the transport shape.
 */
export function normalizeCompactContractOnboardingExtraction(
  raw: ContractOnboardingProviderExtraction | Record<string, unknown>,
): ContractOnboardingExtraction {
  if (!isPlainObject(raw)) throw new ContractOnboardingTransportError('Contract extraction returned no object.');
  const facts = indexProviderFacts((raw as Record<string, unknown>).facts);
  const at = (key: ContractOnboardingFactKey) => facts.get(key)!;

  const rawDerivation = (raw as Record<string, unknown>).effective_date_derivation;
  const derivation: EffectiveDateFact['derivation'] =
    typeof rawDerivation === 'string' && (EFFECTIVE_DATE_DERIVATIONS as readonly string[]).includes(rawDerivation)
      ? (rawDerivation as EffectiveDateFact['derivation'])
      : 'unknown';

  const rawFactors = (raw as Record<string, unknown>).risk_factors;
  const riskFactors = Array.isArray(rawFactors) ? rawFactors.filter((f): f is string => typeof f === 'string') : [];
  const risk = enumFact(at('risk'), RISK_VALUES);

  return {
    contract_number: stringFact(at('contract_number')),
    title: stringFact(at('title')),
    counterparty: stringFact(at('counterparty')),
    contract_type: enumFact(at('contract_type'), CONTRACT_TYPE_VALUES),
    object: stringFact(at('object')),
    documentary_state: documentaryStateFact(at('documentary_state')),
    signature_date: dateFact(at('signature_date')),
    start_date: dateFact(at('start_date')),
    effective_date: { ...dateFact(at('effective_date')), derivation },
    end_date: dateFact(at('end_date')),
    renewal_date: dateFact(at('renewal_date')),
    total_value: monetaryFact(at('total_value')),
    monthly_value: monetaryFact(at('monthly_value')),
    currency: stringFact(at('currency')),
    payment_terms: stringFact(at('payment_terms')),
    indexation: stringFact(at('indexation')),
    retention: stringFact(at('retention')),
    risk: { ...risk, value: risk.value as RiskRecommendation['value'], factors: riskFactors },
  };
}

/** @deprecated Transitional alias; the provider transport is now the compact shape. */
export const normalizeContractOnboardingExtraction = normalizeCompactContractOnboardingExtraction;
