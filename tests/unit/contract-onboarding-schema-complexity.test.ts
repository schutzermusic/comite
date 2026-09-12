/**
 * Regression tests for the THIRD Anthropic structured-output defect on
 * CONTRACT_EXTRACTION: compiled GRAMMAR SIZE.
 *
 * Confirmed production failure (request req_011CexwaB6XrwPFHY8ybZdYD):
 *   HTTP 400 invalid_request_error
 *   "The compiled grammar is too large, which would cause performance issues.
 *    Simplify your tool schemas or reduce the number of strict tools."
 *
 * This is independent of the earlier defects: the deployed schema already had
 * union count = 2 and optional count = 0 — both well inside the documented
 * explicit limits — and was still rejected, because Anthropic additionally
 * enforces an INTERNAL grammar-size limit. The previous schema expanded 18
 * field-specific documentary-evidence objects, each repeating six properties.
 *
 * The fix is a PROVIDER TRANSPORT change only: one generic fact-item schema in
 * a single `facts` array. This file proves the structural simplification, the
 * deterministic required-key-set validation, monetary and date transport
 * validation, and that no transport sentinel or malformed value can reach
 * canonical documentary truth, prefill or the trust gate.
 *
 * NO live Anthropic calls are made in this file.
 */
import { describe, expect, it } from 'vitest';
import {
  CONTRACT_ONBOARDING_EXTRACTION_SCHEMA,
  CONTRACT_ONBOARDING_FACT_KEYS,
  CONTRACT_TYPE_VALUES,
  DOCUMENTARY_STATE_VALUES,
  RISK_VALUES,
  ContractOnboardingTransportError,
  normalizeCompactContractOnboardingExtraction,
  parseMonetaryTransportValue,
  isCanonicalIsoDate,
  buildContractOnboardingResult,
  hasStrongEvidence,
  resolveEffectiveDate,
  MIN_ONBOARDING_CONFIDENCE,
  type ContractOnboardingProviderExtraction,
  type ContractOnboardingProviderFact,
  type ContractOnboardingFactKey,
} from '@/lib/contracts/onboarding/document-first';
import {
  findSchemaUnions,
  findOptionalParameters,
  countSchemaUnions,
  countOptionalParameters,
  countObjectSchemas,
  findObjectSchemas,
  maxObjectNestingDepth,
  schemaByteLength,
  ANTHROPIC_STRUCTURED_OUTPUT_LIMITS,
} from '@/lib/ai/gateway/schema-complexity';
import { ApexAIGateway } from '@/lib/ai/gateway/apex-ai-gateway';
import type { ApexAIAdapterRequest, ApexAIAdapterResponse, ApexAIProviderAdapter } from '@/lib/ai/gateway/types';
import { getApexAITaskPolicy } from '@/lib/ai/gateway/task-registry';
import { ApexAIError } from '@/lib/ai/gateway/errors';

/**
 * Byte length of the field-expanded schema that Anthropic rejected, recorded as
 * a frozen literal so the regression metric survives the deleted code.
 */
const SCHEMA_BYTES_BEFORE = 6619;

const EXPECTED_KEYS: ContractOnboardingFactKey[] = [
  'contract_number', 'title', 'counterparty', 'contract_type', 'object', 'documentary_state',
  'signature_date', 'start_date', 'effective_date', 'end_date', 'renewal_date',
  'total_value', 'monthly_value', 'currency', 'payment_terms', 'indexation', 'retention', 'risk',
];

const EXCERPT = 'Contrato nº JA10182283 celebrado entre as partes.';

function fact(
  key: ContractOnboardingFactKey,
  value: string,
  overrides: Partial<ContractOnboardingProviderFact> = {},
): ContractOnboardingProviderFact {
  return { key, value, page: 3, excerpt: EXCERPT, confidence: 0.96, ambiguous: false, conflicting: false, ...overrides };
}

/** The documented transport convention for a fact the document does not contain. */
function missing(key: ContractOnboardingFactKey): ContractOnboardingProviderFact {
  const sentinel = key === 'contract_type' || key === 'risk' || key === 'documentary_state' ? 'unknown' : '';
  return { key, value: sentinel, page: 0, excerpt: '', confidence: 0, ambiguous: false, conflicting: false };
}

const BASE_VALUES: Record<ContractOnboardingFactKey, string> = {
  contract_number: 'JA10182283',
  title: 'Contrato de Prestação de Serviços',
  counterparty: 'EMPRESA TESTE LTDA',
  contract_type: 'Prestação de serviços',
  object: 'Manutenção preventiva e corretiva de equipamentos.',
  documentary_state: 'active',
  signature_date: '2026-01-15',
  start_date: '2026-02-01',
  effective_date: '2026-02-01',
  end_date: '2027-01-31',
  renewal_date: '',
  total_value: '500000',
  monthly_value: '',
  currency: 'BRL',
  payment_terms: '30 dias após faturamento',
  indexation: '',
  retention: '',
  risk: 'medium',
};

function providerBase(): ContractOnboardingProviderExtraction {
  return {
    facts: EXPECTED_KEYS.map((key) => (BASE_VALUES[key] === '' ? missing(key) : fact(key, BASE_VALUES[key]))),
    effective_date_derivation: 'explicit',
    risk_factors: ['prazo de pagamento estendido'],
  };
}

/** Replace one fact in an otherwise valid payload. */
function withFact(
  payload: ContractOnboardingProviderExtraction,
  key: ContractOnboardingFactKey,
  overrides: Partial<ContractOnboardingProviderFact>,
): ContractOnboardingProviderExtraction {
  return {
    ...payload,
    facts: payload.facts.map((f) => (f.key === key ? { ...f, ...overrides } : f)),
  };
}

class StubAdapter implements ApexAIProviderAdapter {
  readonly provider = 'anthropic' as const;
  readonly capabilities = { structuredOutput: true, documentPdf: true, reasoningEffort: true, promptCache: true, streaming: true } as const;
  readonly calls: ApexAIAdapterRequest[] = [];
  isConfigured() { return true; }
  async generate(req: ApexAIAdapterRequest): Promise<ApexAIAdapterResponse> {
    this.calls.push(req);
    return { text: '{"ok":true}', stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 5 } };
  }
  normalizeError(e: unknown): ApexAIError {
    return e instanceof ApexAIError ? e : new ApexAIError('PROVIDER_ERROR', String(e), false);
  }
}

describe('Compact grammar: structural simplification of the provider schema', () => {
  it('declares exactly ONE generic fact-item object schema (plus the root object)', () => {
    const paths = findObjectSchemas(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA).map((f) => f.path).sort();
    expect(paths).toEqual(['$', '$.properties.facts.items']);
    expect(countObjectSchemas(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA)).toBe(2);
  });

  it('declares ZERO field-specific documentary evidence objects', () => {
    const perFieldObjects = findObjectSchemas(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA)
      .filter((f) => EXPECTED_KEYS.some((key) => f.path.includes(`.properties.${key}`)));
    expect(perFieldObjects).toEqual([]);
  });

  it('no longer repeats an evidence object per documentary field', () => {
    const serialized = JSON.stringify(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA);
    // The 18 keys appear exactly once each, inside the single `key` enum.
    // ("object" is skipped: it is also the JSON Schema `type` literal.)
    for (const key of EXPECTED_KEYS.filter((k) => k !== 'object')) {
      expect(serialized.split(`"${key}"`).length - 1, key).toBe(1);
    }
    expect(serialized.split('"excerpt"').length - 1).toBe(2); // one `required` entry + one property
  });

  it('union count is 0', () => {
    expect(countSchemaUnions(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA)).toBe(0);
    expect(findSchemaUnions(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA)).toEqual([]);
    expect(countSchemaUnions(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA))
      .toBeLessThanOrEqual(ANTHROPIC_STRUCTURED_OUTPUT_LIMITS.maxUnionTypedParameters);
  });

  it('optional parameter count is 0', () => {
    expect(countOptionalParameters(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA)).toBe(0);
    expect(findOptionalParameters(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA)).toEqual([]);
    expect(countOptionalParameters(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA))
      .toBeLessThanOrEqual(ANTHROPIC_STRUCTURED_OUTPUT_LIMITS.maxOptionalParameters);
  });

  it('object nesting stays shallow: root object -> facts array -> fact object', () => {
    expect(maxObjectNestingDepth(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA)).toBe(2);
  });

  it('serialized schema shrank substantially versus the rejected schema (regression metric only)', () => {
    // Byte length is NOT an Anthropic guarantee and proves nothing about the
    // compiled grammar directly. It is tracked purely to detect a regression
    // back toward a field-expanded schema.
    const after = schemaByteLength(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA);
    expect(after).toBeLessThan(SCHEMA_BYTES_BEFORE);
    expect(after / SCHEMA_BYTES_BEFORE).toBeLessThan(0.3);
    expect(after).toBeLessThan(1500);
  });

  it('carries no unsupported numeric or string constraints', () => {
    const FORBIDDEN = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'maxItems', 'minItems'];
    const s = JSON.stringify(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA);
    for (const kw of FORBIDDEN) expect(s, kw).not.toContain(`"${kw}"`);
  });

  it('the transport value is ONE type (string) everywhere — no number|string|null union', () => {
    const item = (CONTRACT_ONBOARDING_EXTRACTION_SCHEMA as never as {
      properties: { facts: { items: { properties: Record<string, { type: unknown }> } } };
    }).properties.facts.items.properties;
    expect(item.value.type).toBe('string');
    expect(item.page.type).toBe('integer');
    expect(item.excerpt.type).toBe('string');
    expect(item.confidence.type).toBe('number');
    expect(item.ambiguous.type).toBe('boolean');
    expect(item.conflicting.type).toBe('boolean');
  });

  it('no enum includes literal null', () => {
    const walk = (node: unknown): boolean => {
      if (Array.isArray(node)) return node.some(walk);
      if (typeof node !== 'object' || node === null) return false;
      const obj = node as Record<string, unknown>;
      if (Array.isArray(obj.enum) && obj.enum.includes(null)) return true;
      return Object.values(obj).some(walk);
    };
    expect(walk(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA)).toBe(false);
  });
});

describe('Compact grammar: fact key enum', () => {
  it('contains exactly the 18 canonical documentary keys', () => {
    const enumValues = (CONTRACT_ONBOARDING_EXTRACTION_SCHEMA as never as {
      properties: { facts: { items: { properties: { key: { enum: string[] } } } } };
    }).properties.facts.items.properties.key.enum;
    expect(enumValues).toEqual(EXPECTED_KEYS);
    expect(enumValues).toHaveLength(18);
    expect(CONTRACT_ONBOARDING_FACT_KEYS).toEqual(EXPECTED_KEYS);
  });

  it('never exposes internal organizational fields to the provider', () => {
    const s = JSON.stringify(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA);
    expect(s).not.toContain('responsible_internal');
    expect(s).not.toContain('owner_user_id');
    expect(s).not.toContain('project_id');
    expect(s).not.toContain('"project"');
  });

  it('keeps one compact top-level derivation field and one flat risk factor array', () => {
    const props = (CONTRACT_ONBOARDING_EXTRACTION_SCHEMA as never as {
      properties: Record<string, Record<string, unknown>>;
      required: string[];
    });
    expect(props.required).toEqual(['facts', 'effective_date_derivation', 'risk_factors']);
    expect(props.properties.effective_date_derivation.enum).toEqual(['explicit', 'from_signature', 'unknown']);
    expect(props.properties.risk_factors).toEqual({ type: 'array', items: { type: 'string' } });
    // Derivation is NOT repeated on every fact.
    expect(JSON.stringify(props.properties.facts)).not.toContain('derivation');
  });
});

describe('Required key set: validated deterministically after the provider response', () => {
  it('exactly 18 unique expected keys -> PASS', () => {
    const n = normalizeCompactContractOnboardingExtraction(providerBase());
    expect(Object.keys(n)).toHaveLength(18);
    expect(n.contract_number.value).toBe('JA10182283');
  });

  it('missing key -> FAIL SAFE (never read as "not found in the document")', () => {
    const payload = providerBase();
    payload.facts = payload.facts.filter((f) => f.key !== 'total_value');
    expect(() => normalizeCompactContractOnboardingExtraction(payload))
      .toThrow(ContractOnboardingTransportError);
    expect(() => normalizeCompactContractOnboardingExtraction(payload)).toThrow(/total_value/);
  });

  it('duplicate key -> FAIL SAFE (never resolved by picking first or last)', () => {
    const payload = providerBase();
    payload.facts = [...payload.facts, fact('contract_number', 'OUTRO-999')];
    expect(() => normalizeCompactContractOnboardingExtraction(payload))
      .toThrow(ContractOnboardingTransportError);
    expect(() => normalizeCompactContractOnboardingExtraction(payload)).toThrow(/duplicate/i);
  });

  it('unknown key -> FAIL SAFE (never silently ignored)', () => {
    const payload = providerBase();
    payload.facts = [...payload.facts, { ...fact('contract_number', 'x'), key: 'responsible_internal' as ContractOnboardingFactKey }];
    expect(() => normalizeCompactContractOnboardingExtraction(payload))
      .toThrow(ContractOnboardingTransportError);
    expect(() => normalizeCompactContractOnboardingExtraction(payload)).toThrow(/unknown fact key/i);
  });

  it('empty fact list -> FAIL SAFE', () => {
    expect(() => normalizeCompactContractOnboardingExtraction({ ...providerBase(), facts: [] }))
      .toThrow(ContractOnboardingTransportError);
  });

  it('non-array facts -> FAIL SAFE', () => {
    expect(() => normalizeCompactContractOnboardingExtraction({ facts: null, effective_date_derivation: 'unknown', risk_factors: [] }))
      .toThrow(ContractOnboardingTransportError);
  });

  it('malformed fact item shape -> FAIL SAFE', () => {
    const bad = (overrides: Record<string, unknown>) => {
      const payload = providerBase();
      payload.facts = payload.facts.map((f) => (f.key === 'title' ? { ...f, ...overrides } as ContractOnboardingProviderFact : f));
      return () => normalizeCompactContractOnboardingExtraction(payload);
    };
    expect(bad({ value: 42 })).toThrow(ContractOnboardingTransportError);
    expect(bad({ page: 1.5 })).toThrow(ContractOnboardingTransportError);
    expect(bad({ excerpt: null })).toThrow(ContractOnboardingTransportError);
    expect(bad({ confidence: 'high' })).toThrow(ContractOnboardingTransportError);
    expect(bad({ ambiguous: 'no' })).toThrow(ContractOnboardingTransportError);
  });
});

describe('Canonical reconstruction: compact transport -> existing ContractOnboardingExtraction', () => {
  it('reconstructs all 18 canonical properties with the canonical shape', () => {
    const n = normalizeCompactContractOnboardingExtraction(providerBase());
    for (const key of EXPECTED_KEYS) {
      expect(n, key).toHaveProperty(key);
      const canonical = n[key] as { page: unknown; excerpt: unknown; confidence: unknown; ambiguous: unknown; conflicting: unknown };
      expect(Object.keys(canonical)).toEqual(
        expect.arrayContaining(['value', 'page', 'excerpt', 'confidence', 'ambiguous', 'conflicting']),
      );
    }
    expect(n.effective_date.derivation).toBe('explicit');
    expect(n.risk.factors).toEqual(['prazo de pagamento estendido']);
  });

  it('contract_number, title, counterparty, object, currency, payment_terms reconstruct verbatim', () => {
    const n = normalizeCompactContractOnboardingExtraction(providerBase());
    expect(n.contract_number).toMatchObject({ value: 'JA10182283', page: 3, excerpt: EXCERPT, confidence: 0.96, ambiguous: false, conflicting: false });
    expect(n.title.value).toBe('Contrato de Prestação de Serviços');
    expect(n.counterparty.value).toBe('EMPRESA TESTE LTDA');
    expect(n.object.value).toBe('Manutenção preventiva e corretiva de equipamentos.');
    expect(n.currency.value).toBe('BRL');
    expect(n.payment_terms.value).toBe('30 dias após faturamento');
  });

  it('contract_type reconstructs as a canonical enum member, "unknown" -> null', () => {
    expect(normalizeCompactContractOnboardingExtraction(providerBase()).contract_type.value).toBe('Prestação de serviços');
    const unknown = withFact(providerBase(), 'contract_type', { value: 'unknown', page: 0, excerpt: '', confidence: 0 });
    expect(normalizeCompactContractOnboardingExtraction(unknown).contract_type.value).toBeNull();
  });

  it('documentary_state "unknown" is preserved as a legitimate canonical state, NOT null', () => {
    const payload = withFact(providerBase(), 'documentary_state', { value: 'unknown', page: 0, excerpt: '', confidence: 0 });
    expect(normalizeCompactContractOnboardingExtraction(payload).documentary_state.value).toBe('unknown');
  });

  it('effective_date carries the top-level derivation, not a per-fact one', () => {
    const payload = { ...providerBase(), effective_date_derivation: 'from_signature' as const };
    expect(normalizeCompactContractOnboardingExtraction(payload).effective_date.derivation).toBe('from_signature');
  });

  it('total_value and monthly_value reconstruct as canonical number | null', () => {
    const n = normalizeCompactContractOnboardingExtraction(providerBase());
    expect(n.total_value.value).toBe(500_000);
    expect(typeof n.total_value.value).toBe('number');
    expect(n.monthly_value.value).toBeNull();
  });

  it('risk reconstructs as an enum value plus the top-level factor list', () => {
    const n = normalizeCompactContractOnboardingExtraction(providerBase());
    expect(n.risk.value).toBe('medium');
    expect(n.risk.factors).toEqual(['prazo de pagamento estendido']);
  });

  it('transport sentinels never leak into canonical truth', () => {
    const n = normalizeCompactContractOnboardingExtraction(providerBase());
    expect(n.renewal_date).toMatchObject({ value: null, page: null, excerpt: null, confidence: 0 });
    expect(n.indexation.value).toBeNull();
    expect(n.retention.value).toBeNull();
    const serialized = JSON.stringify(n);
    expect(serialized).not.toContain('"page":0');
    expect(serialized).not.toContain('"excerpt":""');
  });

  it('does not mutate confidence, ambiguous or conflicting on a valid fact', () => {
    const payload = withFact(providerBase(), 'title', { confidence: 0.5, ambiguous: true, conflicting: true });
    const n = normalizeCompactContractOnboardingExtraction(payload);
    expect(n.title).toMatchObject({ confidence: 0.5, ambiguous: true, conflicting: true });
  });

  it('invalid top-level derivation falls back to "unknown" instead of inventing a rule', () => {
    const payload = { ...providerBase(), effective_date_derivation: 'guessed' as never };
    expect(normalizeCompactContractOnboardingExtraction(payload).effective_date.derivation).toBe('unknown');
  });

  it('non-string risk factors are dropped, never coerced', () => {
    const payload = { ...providerBase(), risk_factors: ['multa relevante', 42, null] as never };
    expect(normalizeCompactContractOnboardingExtraction(payload).risk.factors).toEqual(['multa relevante']);
  });
});

describe('Monetary transport parsing', () => {
  it('accepts canonical decimal strings', () => {
    expect(parseMonetaryTransportValue('1500000')).toEqual({ ok: true, value: 1_500_000 });
    expect(parseMonetaryTransportValue('1500000.50')).toEqual({ ok: true, value: 1_500_000.5 });
    expect(parseMonetaryTransportValue('0')).toEqual({ ok: true, value: 0 });
  });

  it('treats "" as canonical absence', () => {
    expect(parseMonetaryTransportValue('')).toEqual({ ok: true, value: null });
  });

  it('rejects locale-formatted, textual and non-finite values without guessing', () => {
    for (const bad of ['R$ 1.500,00', '1.500,00', '1,500.00', 'one million', 'NaN', 'Infinity', '-10', '1e6', '01', '1.', '.5', ' 100 ']) {
      expect(parseMonetaryTransportValue(bad), bad).toEqual({ ok: false });
    }
  });

  it('a malformed monetary value can never become a trusted monetary fact', () => {
    for (const bad of ['R$ 1.500,00', '1,500.00', 'NaN', 'Infinity', 'um milhão']) {
      const payload = withFact(providerBase(), 'total_value', { value: bad });
      const n = normalizeCompactContractOnboardingExtraction(payload);
      expect(n.total_value.value, bad).toBeNull();
      expect(hasStrongEvidence(n.total_value), bad).toBe(false);
      const res = buildContractOnboardingResult(n);
      expect(res.prefill, bad).not.toHaveProperty('totalValue');
      expect(res.fields.find((f) => f.key === 'total_value')!.state, bad).toBe('unknown');
    }
  });

  it('NaN and Infinity are structurally impossible from a valid transport string', () => {
    const n = normalizeCompactContractOnboardingExtraction(providerBase());
    expect(Number.isNaN(n.total_value.value as number)).toBe(false);
    expect(Number.isFinite(n.total_value.value as number)).toBe(true);
  });

  it('a real zero monetary value is absence in transport, not a fabricated zero', () => {
    // "" is the only absence sentinel; a document stating zero must state "0".
    const zero = withFact(providerBase(), 'total_value', { value: '0', excerpt: 'Contrato de comodato, sem contraprestação financeira.' });
    expect(normalizeCompactContractOnboardingExtraction(zero).total_value.value).toBe(0);
  });
});

describe('Date transport validation', () => {
  it('accepts strict canonical ISO dates', () => {
    for (const good of ['2026-09-12', '2026-02-28', '2024-02-29']) expect(isCanonicalIsoDate(good), good).toBe(true);
  });

  it('rejects non-ISO, impossible and partial dates', () => {
    for (const bad of ['12/09/2026', '2026-99-99', 'September 12 2026', '12-09-2026', '2026-9-12', '2026-02-30', '2026', '']) {
      expect(isCanonicalIsoDate(bad), bad).toBe(false);
    }
  });

  it('an invalid date never becomes a canonical trusted date', () => {
    for (const bad of ['12/09/2026', '2026-99-99', 'September 12 2026']) {
      const payload = withFact(providerBase(), 'end_date', { value: bad });
      const n = normalizeCompactContractOnboardingExtraction(payload);
      expect(n.end_date.value, bad).toBeNull();
      expect(hasStrongEvidence(n.end_date), bad).toBe(false);
      expect(buildContractOnboardingResult(n).prefill, bad).not.toHaveProperty('endDate');
    }
  });

  it('a valid ISO date is prefilled normally', () => {
    const res = buildContractOnboardingResult(normalizeCompactContractOnboardingExtraction(providerBase()));
    expect(res.prefill.endDate).toBe('2027-01-31');
    expect(res.prefill.signedDate).toBe('2026-01-15');
  });
});

describe('Enum transport validation', () => {
  it('accepts only the documented contract_type members', () => {
    for (const value of CONTRACT_TYPE_VALUES) {
      const n = normalizeCompactContractOnboardingExtraction(withFact(providerBase(), 'contract_type', { value }));
      expect(n.contract_type.value, value).toBe(value === 'unknown' ? null : value);
    }
  });

  it('an arbitrary contract_type string never enters canonical truth', () => {
    const payload = withFact(providerBase(), 'contract_type', { value: 'Contrato mágico' });
    const n = normalizeCompactContractOnboardingExtraction(payload);
    expect(n.contract_type.value).toBeNull();
    expect(buildContractOnboardingResult(n).prefill).not.toHaveProperty('type');
  });

  it('an arbitrary documentary_state fails safe to "unknown" and is not prefilled', () => {
    const payload = withFact(providerBase(), 'documentary_state', { value: 'em análise' });
    const n = normalizeCompactContractOnboardingExtraction(payload);
    expect(n.documentary_state.value).toBe('unknown');
    expect(DOCUMENTARY_STATE_VALUES).toContain(n.documentary_state.value);
    expect(buildContractOnboardingResult(n).prefill).not.toHaveProperty('status');
  });

  it('an arbitrary risk string never enters canonical truth', () => {
    const payload = withFact(providerBase(), 'risk', { value: 'catastrófico' });
    const n = normalizeCompactContractOnboardingExtraction(payload);
    expect(n.risk.value).toBeNull();
    expect(RISK_VALUES).not.toContain('catastrófico' as never);
  });

  it('accepts every documented documentary_state and risk member', () => {
    for (const value of DOCUMENTARY_STATE_VALUES) {
      expect(normalizeCompactContractOnboardingExtraction(withFact(providerBase(), 'documentary_state', { value })).documentary_state.value).toBe(value);
    }
    for (const value of RISK_VALUES) {
      expect(normalizeCompactContractOnboardingExtraction(withFact(providerBase(), 'risk', { value })).risk.value)
        .toBe(value === 'unknown' ? null : value);
    }
  });
});

describe('Documentary evidence trust is unchanged by the transport refactor', () => {
  const strong = () => ({ value: 'x', page: 3, excerpt: 'Trecho documental literal suficiente.', confidence: 0.96, ambiguous: false, conflicting: false });
  it('valid page + literal excerpt + confidence at threshold qualifies', () => {
    expect(hasStrongEvidence({ ...strong(), confidence: MIN_ONBOARDING_CONFIDENCE })).toBe(true);
  });
  it('page 0 is not strong', () => { expect(hasStrongEvidence({ ...strong(), page: 0 })).toBe(false); });
  it('empty excerpt is not strong', () => { expect(hasStrongEvidence({ ...strong(), excerpt: '' })).toBe(false); });
  it('confidence > 1 is not strong', () => { expect(hasStrongEvidence({ ...strong(), confidence: 1.5 })).toBe(false); });
  it('confidence < 0 is not strong', () => { expect(hasStrongEvidence({ ...strong(), confidence: -0.1 })).toBe(false); });
  it('confidence below threshold is not strong', () => { expect(hasStrongEvidence({ ...strong(), confidence: MIN_ONBOARDING_CONFIDENCE - 0.01 })).toBe(false); });
  it('ambiguous is not strong', () => { expect(hasStrongEvidence({ ...strong(), ambiguous: true })).toBe(false); });
  it('conflicting is not strong', () => { expect(hasStrongEvidence({ ...strong(), conflicting: true })).toBe(false); });

  it('a fully sentineled transport fact never qualifies', () => {
    const n = normalizeCompactContractOnboardingExtraction(providerBase());
    expect(hasStrongEvidence(n.renewal_date)).toBe(false);
  });

  it('an out-of-range confidence from the compact transport still reaches attention, never prefill', () => {
    const payload = withFact(providerBase(), 'contract_number', { confidence: 1.5 });
    const res = buildContractOnboardingResult(normalizeCompactContractOnboardingExtraction(payload));
    expect(res.fields.find((f) => f.key === 'contract_number')).toMatchObject({ state: 'attention', reason: 'LOW_CONFIDENCE' });
    expect(res.prefill).not.toHaveProperty('contractNumber');
  });

  it('ambiguous and conflicting transport facts route to attention', () => {
    const res = buildContractOnboardingResult(normalizeCompactContractOnboardingExtraction(
      withFact(withFact(providerBase(), 'start_date', { ambiguous: true }), 'total_value', { conflicting: true }),
    ));
    expect(res.fields.find((f) => f.key === 'start_date')).toMatchObject({ state: 'attention', reason: 'AMBIGUOUS' });
    expect(res.fields.find((f) => f.key === 'total_value')).toMatchObject({ state: 'attention', reason: 'CONFLICTING_EVIDENCE' });
    expect(res.prefill).not.toHaveProperty('totalValue');
  });
});

describe('Effective date trust is unchanged', () => {
  it('explicit + strong evidence keeps the documentary value', () => {
    const n = normalizeCompactContractOnboardingExtraction(providerBase());
    expect(resolveEffectiveDate(n).value).toBe('2026-02-01');
  });

  it('from_signature borrows the signature date only when both sides are strong', () => {
    const payload = {
      ...withFact(providerBase(), 'effective_date', { value: '2026-01-15' }),
      effective_date_derivation: 'from_signature' as const,
    };
    const n = normalizeCompactContractOnboardingExtraction(payload);
    expect(resolveEffectiveDate(n).value).toBe('2026-01-15');
  });

  it('from_signature with a sentineled effective fact does not borrow blindly', () => {
    const payload = {
      ...withFact(providerBase(), 'effective_date', { value: '', page: 0, excerpt: '', confidence: 0 }),
      effective_date_derivation: 'from_signature' as const,
    };
    const n = normalizeCompactContractOnboardingExtraction(payload);
    expect(resolveEffectiveDate(n).value).toBeNull();
  });

  it('unknown derivation with a sentineled fact resolves to canonical absence', () => {
    const payload = {
      ...withFact(providerBase(), 'effective_date', { value: '', page: 0, excerpt: '', confidence: 0 }),
      effective_date_derivation: 'unknown' as const,
    };
    const n = normalizeCompactContractOnboardingExtraction(payload);
    expect(resolveEffectiveDate(n).value).toBeNull();
  });
});

describe('Risk governance is unchanged', () => {
  it('a strong-evidence risk value still requires human confirmation', () => {
    const res = buildContractOnboardingResult(normalizeCompactContractOnboardingExtraction(providerBase()));
    const risk = res.fields.find((f) => f.key === 'risk')!;
    expect(risk).toMatchObject({ value: 'medium', state: 'attention', reason: 'GOVERNED_CONFIRMATION_REQUIRED' });
    expect(res.prefill).not.toHaveProperty('riskLevel');
    expect(res.riskFactors).toEqual(['prazo de pagamento estendido']);
  });

  it('"unknown" risk sentinel is NOT_FOUND_IN_DOCUMENT', () => {
    const payload = { ...withFact(providerBase(), 'risk', { value: 'unknown', page: 0, excerpt: '', confidence: 0 }), risk_factors: [] };
    const res = buildContractOnboardingResult(normalizeCompactContractOnboardingExtraction(payload));
    expect(res.fields.find((f) => f.key === 'risk')).toMatchObject({ value: null, state: 'unknown' });
  });
});

describe('Internal responsibility and project are never fabricated', () => {
  it('stay attention-only decisions after the compact reconstruction', () => {
    const res = buildContractOnboardingResult(normalizeCompactContractOnboardingExtraction(providerBase()));
    expect(res.fields.find((f) => f.key === 'responsible_internal')).toMatchObject({ state: 'attention', reason: 'INTERNAL_DECISION_REQUIRED', value: null });
    expect(res.fields.find((f) => f.key === 'project')).toMatchObject({ state: 'attention', reason: 'PROJECT_MAPPING_REQUIRED', value: null });
    expect(res.prefill).not.toHaveProperty('ownerUserId');
    expect(res.prefill).not.toHaveProperty('projectId');
  });
});

describe('Gateway / adapter: the compact schema travels unchanged, on one Sonnet call', () => {
  it('CONTRACT_EXTRACTION routes to claude-sonnet-5, no Opus, no fallback', () => {
    const p = getApexAITaskPolicy('CONTRACT_EXTRACTION');
    expect(p.provider).toBe('anthropic');
    expect(p.model).toBe('claude-sonnet-5');
    expect(p.fallbacks).toEqual([]);
    expect(p.model.toLowerCase()).not.toContain('opus');
  });

  it('the exact compact schema reaches the Anthropic adapter in a single call', async () => {
    const stub = new StubAdapter();
    await new ApexAIGateway([stub]).generate({
      organizationId: 'org-compact-grammar-check', task: 'CONTRACT_EXTRACTION', userPrompt: 'x',
      structuredOutput: { name: 'contract_onboarding_extraction', schema: CONTRACT_ONBOARDING_EXTRACTION_SCHEMA },
    });
    expect(stub.calls).toHaveLength(1);
    const schema = stub.calls[0].structuredOutput!.schema;
    expect(JSON.stringify(schema)).toBe(JSON.stringify(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA));
    expect(countSchemaUnions(schema)).toBe(0);
    expect(countOptionalParameters(schema)).toBe(0);
    expect(countObjectSchemas(schema)).toBe(2);
    expect(stub.calls[0].policy.model).toBe('claude-sonnet-5');
    expect(stub.calls[0].policy.model.toLowerCase()).not.toContain('opus');
    expect(stub.calls[0].policy.provider).toBe('anthropic');
  });
});

/**
 * Known-defect ledger.
 *
 * CONTRACT_OPERATIONALIZATION is a SEPARATE provider task with the same class of
 * defect, and is deliberately NOT fixed in this branch (which is scoped to
 * CONTRACT_EXTRACTION). These assertions record the measured defect so it cannot
 * be silently forgotten: if someone fixes OPERATIONALIZATION_SCHEMA, this block
 * fails and must be updated to the compact expectations.
 */
describe('KNOWN DEFECT (not fixed here): CONTRACT_OPERATIONALIZATION schema complexity', () => {
  it('OPERATIONALIZATION_SCHEMA still exceeds the documented union limit', async () => {
    const { OPERATIONALIZATION_SCHEMA } = await import('@/lib/ai/contract-operationalization');
    expect(countSchemaUnions(OPERATIONALIZATION_SCHEMA)).toBe(26);
    expect(countSchemaUnions(OPERATIONALIZATION_SCHEMA))
      .toBeGreaterThan(ANTHROPIC_STRUCTURED_OUTPUT_LIMITS.maxUnionTypedParameters);
  });

  it('must be migrated to the compact transport BEFORE a real contract is finalized', () => {
    // Recorded as the next required fix. Finalizing a contract triggers full
    // operationalization, which will fail in production the same way
    // CONTRACT_EXTRACTION did (req_011CexwaB6XrwPFHY8ybZdYD) until it is fixed.
    expect(true).toBe(true);
  });
});
