/**
 * Canonical vocabulary for AI-first amendment onboarding.
 *
 * This module is deliberately pure. The model can propose an interpretation;
 * these deterministic functions decide whether an effect is safe to become
 * operational truth. Unknown stays unknown and human authority is never
 * inferred from model output.
 */

export const AMENDMENT_AI_VERSION = 'contract-amendment-extraction/1.0.0';
export const AMENDMENT_TRUST_POLICY_VERSION = 'contract-amendment-trust/1.0.0';
export const MIN_AMENDMENT_CONFIDENCE = 0.85;
export const MATERIAL_AMENDMENT_AMOUNT_BRL = 100_000;

export const AMENDMENT_EFFECT_CATEGORIES = [
  'value', 'term', 'scope', 'clause', 'obligation', 'responsible_party',
  'measurement', 'billing', 'acceptance', 'guarantee', 'insurance',
  'indexation', 'retention', 'glosa', 'penalty', 'required_document',
  'renewal_notice', 'termination', 'sla', 'approval',
  'technical_requirement', 'evidence_requirement', 'other',
] as const;
export type AmendmentEffectCategory = (typeof AMENDMENT_EFFECT_CATEGORIES)[number];

export const AMENDMENT_EFFECT_OPERATIONS = [
  'ADDED', 'MODIFIED', 'REPLACED', 'REMOVED', 'EXTENDED', 'SUPERSEDED',
  'UNCHANGED', 'EXPANDED', 'REDUCED', 'CLARIFIED', 'UNKNOWN',
] as const;
export type AmendmentEffectOperation = (typeof AMENDMENT_EFFECT_OPERATIONS)[number];

export type DocumentaryState = 'draft' | 'signed' | 'unknown';
export type EffectivenessState =
  | 'not_yet_effective' | 'effective' | 'superseded' | 'cancelled' | 'indeterminate';
export type AmendmentTrustState = 'automatic' | 'requires_attention';

export interface AmendmentEvidence {
  page: number | null;
  excerpt: string | null;
  confidence: number;
}

export interface ExtractedFact<T> extends AmendmentEvidence {
  value: T;
}

export interface ExtractedAmendmentEffect extends AmendmentEvidence {
  category: AmendmentEffectCategory;
  operation: AmendmentEffectOperation;
  title: string;
  description: string;
  source_clause_reference: string | null;
  /** Canonical id copied only from the supplied master-clause context. */
  source_clause_id: string | null;
  replacement_clause_reference: string | null;
  payload: Record<string, unknown>;
  conflict: boolean;
  uncertainty_reasons: string[];
}

export interface AmendmentExtraction {
  amendment_identifier: ExtractedFact<string>;
  documentary_title: ExtractedFact<string>;
  apex_summary: string | null;
  signature_date: ExtractedFact<string | null>;
  effective_date: ExtractedFact<string | null> & {
    derivation: 'explicit' | 'from_signature' | 'unknown';
  };
  documentary_state: ExtractedFact<DocumentaryState>;
  value_effect: ExtractedAmendmentEffect & {
    kind: 'none' | 'delta' | 'absolute' | 'unknown';
    amount: number | null;
    currency: 'BRL' | null;
  };
  term_effect: ExtractedAmendmentEffect & {
    kind: 'none' | 'new_end_date' | 'extension' | 'reduction' | 'other' | 'unknown';
    new_end_date: string | null;
    duration_days: number | null;
  };
  effects: ExtractedAmendmentEffect[];
  precedence_conflicts: Array<{
    description: string;
    page: number | null;
    excerpt: string | null;
  }>;
}

export interface TrustDecision {
  state: AmendmentTrustState;
  reasons: string[];
  policyVersion: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isSupportedEvidence(evidence: AmendmentEvidence): boolean {
  return Number.isInteger(evidence.page) && Number(evidence.page) > 0
    && typeof evidence.excerpt === 'string' && evidence.excerpt.trim().length >= 8
    && Number.isFinite(evidence.confidence)
    && evidence.confidence >= 0 && evidence.confidence <= 1;
}

/** Effective-from-signature is deterministic only if the signature date itself is supported. */
export function deriveEffectiveDate(
  signature: ExtractedFact<string | null>,
  effective: AmendmentExtraction['effective_date'],
): string | null {
  if (effective.derivation === 'explicit') {
    return effective.value && ISO_DATE.test(effective.value) && isSupportedEvidence(effective)
      ? effective.value : null;
  }
  if (effective.derivation === 'from_signature') {
    return signature.value && ISO_DATE.test(signature.value)
      && isSupportedEvidence(signature) && isSupportedEvidence(effective)
      ? signature.value : null;
  }
  return null;
}

/** Time-sensitive effectiveness is derived, never frozen at extraction time. */
export function deriveAmendmentEffectiveness(input: {
  documentaryState: DocumentaryState;
  effectiveDate: string | null;
  cancelled?: boolean;
  superseded?: boolean;
  asOf?: string;
}): EffectivenessState {
  if (input.cancelled) return 'cancelled';
  if (input.superseded) return 'superseded';
  if (input.documentaryState !== 'signed' || !input.effectiveDate || !ISO_DATE.test(input.effectiveDate)) {
    return 'indeterminate';
  }
  const asOf = input.asOf ?? new Date().toISOString().slice(0, 10);
  if (!ISO_DATE.test(asOf)) throw new Error('Invalid amendment asOf date');
  return input.effectiveDate > asOf ? 'not_yet_effective' : 'effective';
}

export function evaluateAmendmentEffectTrust(
  effect: ExtractedAmendmentEffect,
  options: { sequencingRequiresEffectiveDate?: boolean; effectiveDate?: string | null } = {},
): TrustDecision {
  const reasons = [...effect.uncertainty_reasons];
  if (!isSupportedEvidence(effect)) reasons.push('missing_or_weak_source_evidence');
  if (effect.confidence < MIN_AMENDMENT_CONFIDENCE) reasons.push('low_confidence');
  if (effect.conflict) reasons.push('documentary_conflict');
  if (effect.operation === 'UNKNOWN') reasons.push('unknown_effect');
  if (options.sequencingRequiresEffectiveDate && !options.effectiveDate) {
    reasons.push('effective_date_unknown');
  }
  const amount = Number(effect.payload.amount);
  if (Number.isFinite(amount) && Math.abs(amount) >= MATERIAL_AMENDMENT_AMOUNT_BRL) {
    reasons.push('material_financial_exposure');
  }
  return {
    state: reasons.length === 0 ? 'automatic' : 'requires_attention',
    reasons: [...new Set(reasons)],
    policyVersion: AMENDMENT_TRUST_POLICY_VERSION,
  };
}

/** Rejects internally contradictory value/term claims before persistence. */
export function validateAmendmentExtraction(value: AmendmentExtraction): AmendmentExtraction {
  if (value.value_effect.kind === 'delta' && value.value_effect.amount === null) {
    throw new Error('Delta value effect requires an amount.');
  }
  if (value.value_effect.kind === 'absolute' && value.value_effect.amount === null) {
    throw new Error('Absolute value effect requires an amount.');
  }
  if (!['delta', 'absolute'].includes(value.value_effect.kind) && value.value_effect.amount !== null) {
    throw new Error('Value amount cannot coexist with a non-monetary value effect.');
  }
  if (value.term_effect.kind === 'new_end_date' && !value.term_effect.new_end_date) {
    throw new Error('Absolute term effect requires a new end date.');
  }
  if (value.term_effect.kind === 'extension' && !value.term_effect.duration_days) {
    throw new Error('Term extension requires a duration.');
  }
  if (value.effective_date.derivation === 'from_signature'
      && deriveEffectiveDate(value.signature_date, value.effective_date) === null) {
    value.effective_date.value = null;
    value.effective_date.derivation = 'unknown';
  }
  return value;
}

const evidenceSchema = {
  type: 'object',
  required: ['value', 'page', 'excerpt', 'confidence'],
  properties: {
    value: {}, page: { type: ['integer', 'null'] }, excerpt: { type: ['string', 'null'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const;

const effectSchema = {
  type: 'object',
  required: ['category', 'operation', 'title', 'description', 'source_clause_reference', 'source_clause_id',
    'replacement_clause_reference', 'payload', 'page', 'excerpt', 'confidence', 'conflict',
    'uncertainty_reasons'],
  properties: {
    category: { type: 'string', enum: [...AMENDMENT_EFFECT_CATEGORIES] },
    operation: { type: 'string', enum: [...AMENDMENT_EFFECT_OPERATIONS] },
    title: { type: 'string' }, description: { type: 'string' },
    source_clause_reference: { type: ['string', 'null'] },
    source_clause_id: { type: ['string', 'null'] },
    replacement_clause_reference: { type: ['string', 'null'] },
    payload: { type: 'object' }, page: { type: ['integer', 'null'] },
    excerpt: { type: ['string', 'null'] }, confidence: { type: 'number', minimum: 0, maximum: 1 },
    conflict: { type: 'boolean' }, uncertainty_reasons: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const AMENDMENT_EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false,
  required: ['amendment_identifier', 'documentary_title', 'apex_summary', 'signature_date',
    'effective_date', 'documentary_state', 'value_effect', 'term_effect', 'effects',
    'precedence_conflicts'],
  properties: {
    amendment_identifier: evidenceSchema,
    documentary_title: evidenceSchema,
    apex_summary: { type: ['string', 'null'] },
    signature_date: evidenceSchema,
    effective_date: {
      ...evidenceSchema,
      required: [...evidenceSchema.required, 'derivation'],
      properties: { ...evidenceSchema.properties,
        derivation: { type: 'string', enum: ['explicit', 'from_signature', 'unknown'] } },
    },
    documentary_state: evidenceSchema,
    value_effect: {
      ...effectSchema,
      required: [...effectSchema.required, 'kind', 'amount', 'currency'],
      properties: { ...effectSchema.properties,
        kind: { type: 'string', enum: ['none', 'delta', 'absolute', 'unknown'] },
        amount: { type: ['number', 'null'] }, currency: { type: ['string', 'null'], enum: ['BRL', null] } },
    },
    term_effect: {
      ...effectSchema,
      required: [...effectSchema.required, 'kind', 'new_end_date', 'duration_days'],
      properties: { ...effectSchema.properties,
        kind: { type: 'string', enum: ['none', 'new_end_date', 'extension', 'reduction', 'other', 'unknown'] },
        new_end_date: { type: ['string', 'null'] }, duration_days: { type: ['integer', 'null'] } },
    },
    effects: { type: 'array', items: effectSchema },
    precedence_conflicts: { type: 'array', items: { type: 'object',
      required: ['description', 'page', 'excerpt'], properties: {
        description: { type: 'string' }, page: { type: ['integer', 'null'] },
        excerpt: { type: ['string', 'null'] },
      } } },
  },
};
