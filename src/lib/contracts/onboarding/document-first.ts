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

/**
 * Provider-facing structured-output schema (Anthropic dialect).
 *
 * Anthropic's structured-output mode also caps schema *complexity*,
 * independent of any single unsupported keyword: at most 16 parameters may
 * carry a union `type` (e.g. ["string","null"]). The previous schema put a
 * nullable union on every `value`, `page` and `excerpt` property across all
 * 18 documentary facts — 53 unions, more than 3x the limit — a distinct,
 * independently-fatal defect from the removed `minimum`/`maximum` keywords.
 *
 * The provider representation is intentionally NOT the canonical Apex
 * representation. Instead of `null`, the provider uses domain-safe
 * "not found" sentinels that can never be confused with real evidence:
 *   - page: 0 (a real documentary page is always a positive integer)
 *   - excerpt: "" (a real excerpt is always a non-empty literal quote)
 *   - string-domain value: "" (a real value is never an empty string)
 *   - enum-domain value: "unknown" (an explicit member of the enum)
 * `total_value`/`monthly_value` keep a real `number | null` union because
 * zero is a legitimate contract value and no numeric sentinel is safe —
 * that leaves exactly 2 union-typed parameters, well under the limit.
 *
 * normalizeContractOnboardingExtraction() below converts these transport
 * sentinels back into the canonical, null-based ContractOnboardingExtraction
 * BEFORE the trust gate, persistence or prefill ever see them. Sentinels
 * never become canonical documentary truth.
 */
const providerStringEvidence = (value: Record<string, unknown>) => ({
  type: 'object', additionalProperties: false,
  required: ['value', 'page', 'excerpt', 'confidence', 'ambiguous', 'conflicting'],
  properties: {
    value, page: { type: 'integer' }, excerpt: { type: 'string' },
    // `minimum`/`maximum` are NOT used here: Anthropic's structured-output dialect
    // rejects those keywords for 'number' type with HTTP 400. The 0..1 invariant
    // is enforced deterministically by hasStrongEvidence() at runtime instead.
    confidence: { type: 'number' },
    ambiguous: { type: 'boolean' }, conflicting: { type: 'boolean' },
  },
});

const providerNumericEvidence = () => ({
  type: 'object', additionalProperties: false,
  required: ['value', 'page', 'excerpt', 'confidence', 'ambiguous', 'conflicting'],
  properties: {
    // Kept nullable: zero is a legitimate contract value, so no sentinel is safe here.
    value: { type: ['number', 'null'] }, page: { type: 'integer' }, excerpt: { type: 'string' },
    confidence: { type: 'number' },
    ambiguous: { type: 'boolean' }, conflicting: { type: 'boolean' },
  },
});

export const CONTRACT_ONBOARDING_EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false,
  required: [...Object.keys(LABELS)],
  properties: {
    contract_number: providerStringEvidence({ type: 'string' }), title: providerStringEvidence({ type: 'string' }),
    counterparty: providerStringEvidence({ type: 'string' }),
    contract_type: providerStringEvidence({ type: 'string', enum: [
      'Prestação de serviços', 'Fornecimento', 'Ordem de serviço', 'Manutenção', 'Aditivo contratual', 'unknown',
    ] }),
    object: providerStringEvidence({ type: 'string' }),
    documentary_state: providerStringEvidence({ type: 'string', enum: ['draft', 'signed', 'active', 'cancelled', 'expired', 'unknown'] }),
    signature_date: providerStringEvidence({ type: 'string' }), start_date: providerStringEvidence({ type: 'string' }),
    effective_date: { ...providerStringEvidence({ type: 'string' }),
      required: [...(providerStringEvidence({ type: 'string' }).required as string[]), 'derivation'],
      properties: { ...(providerStringEvidence({ type: 'string' }).properties as object),
        derivation: { type: 'string', enum: ['explicit', 'from_signature', 'unknown'] } } },
    end_date: providerStringEvidence({ type: 'string' }), renewal_date: providerStringEvidence({ type: 'string' }),
    total_value: providerNumericEvidence(), monthly_value: providerNumericEvidence(),
    currency: providerStringEvidence({ type: 'string' }), payment_terms: providerStringEvidence({ type: 'string' }),
    indexation: providerStringEvidence({ type: 'string' }), retention: providerStringEvidence({ type: 'string' }),
    risk: { ...providerStringEvidence({ type: 'string', enum: ['low', 'medium', 'high', 'unknown'] }),
      required: [...(providerStringEvidence({ type: 'string' }).required as string[]), 'factors'],
      properties: { ...(providerStringEvidence({ type: 'string', enum: ['low', 'medium', 'high', 'unknown'] }).properties as object),
        factors: { type: 'array', items: { type: 'string' } } } },
  },
};

interface ProviderFact<V extends string | number | null> {
  value: V;
  page: number;
  excerpt: string;
  confidence: number;
  ambiguous: boolean;
  conflicting: boolean;
}

/** Raw shape returned by Anthropic for CONTRACT_EXTRACTION — see CONTRACT_ONBOARDING_EXTRACTION_SCHEMA. */
export interface ContractOnboardingProviderExtraction {
  contract_number: ProviderFact<string>;
  title: ProviderFact<string>;
  counterparty: ProviderFact<string>;
  contract_type: ProviderFact<string>;
  object: ProviderFact<string>;
  documentary_state: ProviderFact<string>;
  signature_date: ProviderFact<string>;
  start_date: ProviderFact<string>;
  effective_date: ProviderFact<string> & { derivation: 'explicit' | 'from_signature' | 'unknown' };
  end_date: ProviderFact<string>;
  renewal_date: ProviderFact<string>;
  total_value: ProviderFact<number | null>;
  monthly_value: ProviderFact<number | null>;
  currency: ProviderFact<string>;
  payment_terms: ProviderFact<string>;
  indexation: ProviderFact<string>;
  retention: ProviderFact<string>;
  risk: ProviderFact<string> & { factors: string[] };
}

function normalizePage(page: number): number | null {
  return Number.isFinite(page) && page > 0 ? page : null;
}

function normalizeExcerpt(excerpt: string): string | null {
  return typeof excerpt === 'string' && excerpt.trim().length > 0 ? excerpt : null;
}

/** String-domain fact: the provider's "not found" sentinel is "". Never touches confidence/ambiguous/conflicting. */
function normalizeStringFact(fact: ProviderFact<string>): DocumentaryFact<string | null> {
  return {
    value: fact.value === '' ? null : fact.value,
    page: normalizePage(fact.page), excerpt: normalizeExcerpt(fact.excerpt),
    confidence: fact.confidence, ambiguous: fact.ambiguous, conflicting: fact.conflicting,
  };
}

/** Enum-domain fact over a closed value set whose "not found" sentinel is the explicit member "unknown". */
function normalizeEnumFact(fact: ProviderFact<string>): DocumentaryFact<string | null> {
  return {
    value: fact.value === 'unknown' ? null : fact.value,
    page: normalizePage(fact.page), excerpt: normalizeExcerpt(fact.excerpt),
    confidence: fact.confidence, ambiguous: fact.ambiguous, conflicting: fact.conflicting,
  };
}

/**
 * documentary_state's "unknown" is a legitimate canonical state of the contract itself
 * (see ContractOnboardingExtraction['documentary_state']), not a transport absence
 * sentinel — it must NOT be normalized to null. Only page/excerpt sentinels apply.
 */
function normalizeDocumentaryStateFact(
  fact: ProviderFact<string>,
): DocumentaryFact<ContractOnboardingExtraction['documentary_state']['value']> {
  return {
    value: fact.value as ContractOnboardingExtraction['documentary_state']['value'],
    page: normalizePage(fact.page), excerpt: normalizeExcerpt(fact.excerpt),
    confidence: fact.confidence, ambiguous: fact.ambiguous, conflicting: fact.conflicting,
  };
}

function normalizeNumericFact(fact: ProviderFact<number | null>): DocumentaryFact<number | null> {
  return {
    value: fact.value, page: normalizePage(fact.page), excerpt: normalizeExcerpt(fact.excerpt),
    confidence: fact.confidence, ambiguous: fact.ambiguous, conflicting: fact.conflicting,
  };
}

function normalizeRiskFact(fact: ContractOnboardingProviderExtraction['risk']): RiskRecommendation {
  const base = normalizeEnumFact(fact);
  return { ...base, value: base.value as RiskRecommendation['value'], factors: Array.isArray(fact.factors) ? fact.factors : [] };
}

/**
 * Normalization boundary between the provider transport shape and canonical
 * Apex documentary truth. This is the ONLY place provider sentinels (page 0,
 * empty excerpt/value, "unknown" enum members) are interpreted — everything
 * downstream (hasStrongEvidence, buildContractOnboardingResult, persistence,
 * prefill) sees only the canonical null-based representation.
 *
 * Does NOT clamp confidence, does NOT invent evidence, does NOT alter
 * ambiguous/conflicting — those pass through unchanged for the deterministic
 * trust gate to evaluate.
 */
export function normalizeContractOnboardingExtraction(
  raw: ContractOnboardingProviderExtraction,
): ContractOnboardingExtraction {
  return {
    contract_number: normalizeStringFact(raw.contract_number),
    title: normalizeStringFact(raw.title),
    counterparty: normalizeStringFact(raw.counterparty),
    contract_type: normalizeEnumFact(raw.contract_type),
    object: normalizeStringFact(raw.object),
    documentary_state: normalizeDocumentaryStateFact(raw.documentary_state),
    signature_date: normalizeStringFact(raw.signature_date),
    start_date: normalizeStringFact(raw.start_date),
    effective_date: { ...normalizeStringFact(raw.effective_date), derivation: raw.effective_date.derivation },
    end_date: normalizeStringFact(raw.end_date),
    renewal_date: normalizeStringFact(raw.renewal_date),
    total_value: normalizeNumericFact(raw.total_value),
    monthly_value: normalizeNumericFact(raw.monthly_value),
    currency: normalizeStringFact(raw.currency),
    payment_terms: normalizeStringFact(raw.payment_terms),
    indexation: normalizeStringFact(raw.indexation),
    retention: normalizeStringFact(raw.retention),
    risk: normalizeRiskFact(raw.risk),
  };
}
