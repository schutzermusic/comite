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

const evidence = (value: Record<string, unknown> = {}) => ({
  type: 'object', additionalProperties: false,
  required: ['value', 'page', 'excerpt', 'confidence', 'ambiguous', 'conflicting'],
  properties: {
    value, page: { type: ['integer', 'null'] }, excerpt: { type: ['string', 'null'] },
    // `minimum`/`maximum` are NOT used here: Anthropic's structured-output dialect
    // rejects those keywords for 'number' type with HTTP 400. The 0..1 invariant
    // is enforced deterministically by hasStrongEvidence() at runtime instead.
    confidence: { type: 'number' },
    ambiguous: { type: 'boolean' }, conflicting: { type: 'boolean' },
  },
});

export const CONTRACT_ONBOARDING_EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false,
  required: [...Object.keys(LABELS)],
  properties: {
    contract_number: evidence({ type: ['string', 'null'] }), title: evidence({ type: ['string', 'null'] }),
    counterparty: evidence({ type: ['string', 'null'] }),
    contract_type: evidence({ type: ['string', 'null'], enum: [
      'Prestação de serviços', 'Fornecimento', 'Ordem de serviço', 'Manutenção', 'Aditivo contratual', null,
    ] }),
    object: evidence({ type: ['string', 'null'] }),
    documentary_state: evidence({ type: 'string', enum: ['draft', 'signed', 'active', 'cancelled', 'expired', 'unknown'] }),
    signature_date: evidence({ type: ['string', 'null'] }), start_date: evidence({ type: ['string', 'null'] }),
    effective_date: { ...evidence({ type: ['string', 'null'] }),
      required: [...(evidence().required as string[]), 'derivation'],
      properties: { ...(evidence().properties as object), value: { type: ['string', 'null'] },
        derivation: { type: 'string', enum: ['explicit', 'from_signature', 'unknown'] } } },
    end_date: evidence({ type: ['string', 'null'] }), renewal_date: evidence({ type: ['string', 'null'] }),
    total_value: evidence({ type: ['number', 'null'] }), monthly_value: evidence({ type: ['number', 'null'] }),
    currency: evidence({ type: ['string', 'null'] }), payment_terms: evidence({ type: ['string', 'null'] }),
    indexation: evidence({ type: ['string', 'null'] }), retention: evidence({ type: ['string', 'null'] }),
    risk: { ...evidence({ type: ['string', 'null'], enum: ['low', 'medium', 'high', null] }),
      required: [...(evidence().required as string[]), 'factors'],
      properties: { ...(evidence().properties as object),
        value: { type: ['string', 'null'], enum: ['low', 'medium', 'high', null] },
        factors: { type: 'array', items: { type: 'string' } } } },
  },
};
