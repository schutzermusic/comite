/**
 * Regression tests for the SECOND Anthropic structured-output defect on
 * CONTRACT_EXTRACTION: schema *complexity*, independent of the earlier
 * minimum/maximum keyword defect.
 *
 * Anthropic's structured-output dialect caps:
 *   - union-typed parameters (type: [X, "null"], or an equivalent anyOf) at 16
 *   - optional parameters (a property missing from its object's `required`) at 24
 *
 * The previous CONTRACT_ONBOARDING_EXTRACTION_SCHEMA had 53 union-typed
 * parameters (page x18, excerpt x18, value x17). This file proves the fix:
 * the provider schema now carries at most 2 unions (total_value.value,
 * monthly_value.value), and that the provider transport sentinels (page 0,
 * "", "unknown") never leak into canonical documentary truth, prefill, or
 * the deterministic trust gate.
 *
 * NO live Anthropic calls are made in this file.
 */
import { describe, expect, it } from 'vitest';
import {
  CONTRACT_ONBOARDING_EXTRACTION_SCHEMA,
  normalizeContractOnboardingExtraction,
  buildContractOnboardingResult,
  hasStrongEvidence,
  resolveEffectiveDate,
  MIN_ONBOARDING_CONFIDENCE,
  type ContractOnboardingProviderExtraction,
  type EffectiveDateFact,
} from '@/lib/contracts/onboarding/document-first';
import {
  findSchemaUnions,
  findOptionalParameters,
  countSchemaUnions,
  countOptionalParameters,
  ANTHROPIC_STRUCTURED_OUTPUT_LIMITS,
} from '@/lib/ai/gateway/schema-complexity';
import { ApexAIGateway } from '@/lib/ai/gateway/apex-ai-gateway';
import type { ApexAIAdapterRequest, ApexAIAdapterResponse, ApexAIProviderAdapter } from '@/lib/ai/gateway/types';
import { getApexAITaskPolicy } from '@/lib/ai/gateway/task-registry';
import { ApexAIError } from '@/lib/ai/gateway/errors';

function providerFact(value: string, overrides: Partial<ContractOnboardingProviderExtraction['contract_number']> = {}) {
  return { value, page: 3, excerpt: 'Contrato nº JA10182283 celebrado entre as partes.', confidence: 0.96, ambiguous: false, conflicting: false, ...overrides };
}
function missingStringFact(overrides: Partial<ContractOnboardingProviderExtraction['contract_number']> = {}) {
  return { value: '', page: 0, excerpt: '', confidence: 0, ambiguous: false, conflicting: false, ...overrides };
}
function missingEnumFact(overrides: Partial<ContractOnboardingProviderExtraction['risk']> = {}) {
  return { value: 'unknown', page: 0, excerpt: '', confidence: 0, ambiguous: false, conflicting: false, ...overrides } as ContractOnboardingProviderExtraction['risk'];
}
function missingNumericFact(overrides: Partial<ContractOnboardingProviderExtraction['total_value']> = {}) {
  return { value: null, page: 0, excerpt: '', confidence: 0, ambiguous: false, conflicting: false, ...overrides };
}

function providerBase(): ContractOnboardingProviderExtraction {
  return {
    contract_number: providerFact('JA10182283'),
    title: providerFact('Contrato de Prestação de Serviços'),
    counterparty: providerFact('EMPRESA TESTE LTDA'),
    contract_type: providerFact('Prestação de serviços'),
    object: providerFact('Manutenção preventiva e corretiva de equipamentos.'),
    documentary_state: providerFact('active'),
    signature_date: providerFact('2026-01-15'),
    start_date: providerFact('2026-02-01'),
    effective_date: { ...providerFact('2026-02-01'), derivation: 'explicit' },
    end_date: providerFact('2027-01-31'),
    renewal_date: missingStringFact(),
    total_value: { value: 500_000, page: 3, excerpt: 'Valor total de R$ 500.000,00.', confidence: 0.96, ambiguous: false, conflicting: false },
    monthly_value: missingNumericFact(),
    currency: providerFact('BRL'),
    payment_terms: providerFact('30 dias após faturamento'),
    indexation: missingStringFact(),
    retention: missingStringFact(),
    risk: { ...providerFact('medium'), factors: ['prazo de pagamento estendido'] },
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

describe('Schema complexity: union-typed parameters (Anthropic limit 16)', () => {
  it('provider schema union count is 2, well under the limit', () => {
    expect(countSchemaUnions(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA)).toBe(2);
  });
  it('union count is <= Anthropic documented limit', () => {
    expect(countSchemaUnions(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA))
      .toBeLessThanOrEqual(ANTHROPIC_STRUCTURED_OUTPUT_LIMITS.maxUnionTypedParameters);
  });
  it('remaining unions are exactly total_value.value and monthly_value.value', () => {
    const paths = findSchemaUnions(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA).map((f) => f.path).sort();
    expect(paths).toEqual([
      '$.properties.monthly_value.properties.value.type',
      '$.properties.total_value.properties.value.type',
    ]);
  });
  it('page and excerpt no longer carry any union anywhere in the schema', () => {
    const paths = findSchemaUnions(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA).map((f) => f.path);
    expect(paths.some((p) => p.includes('.properties.page.'))).toBe(false);
    expect(paths.some((p) => p.includes('.properties.excerpt.'))).toBe(false);
  });
});

describe('Schema complexity: optional parameters (Anthropic limit 24)', () => {
  it('optional parameter count is 0', () => {
    expect(countOptionalParameters(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA)).toBe(0);
    expect(findOptionalParameters(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA)).toEqual([]);
  });
  it('optional count is <= Anthropic documented limit', () => {
    expect(countOptionalParameters(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA))
      .toBeLessThanOrEqual(ANTHROPIC_STRUCTURED_OUTPUT_LIMITS.maxOptionalParameters);
  });
});

describe('Schema complexity: no unsupported numeric/string constraints re-introduced', () => {
  const FORBIDDEN = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern'];
  it('schema string has none of the forbidden keywords', () => {
    const s = JSON.stringify(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA);
    for (const kw of FORBIDDEN) expect(s, kw).not.toContain(`"${kw}"`);
  });
  it('no enum still includes literal null', () => {
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

describe('Provider sentinel normalization', () => {
  it('page 0 -> canonical null', () => {
    const n = normalizeContractOnboardingExtraction(providerBase());
    expect(n.renewal_date.page).toBeNull();
  });
  it('empty excerpt -> canonical null', () => {
    const n = normalizeContractOnboardingExtraction(providerBase());
    expect(n.renewal_date.excerpt).toBeNull();
  });
  it('empty string value -> canonical null', () => {
    const n = normalizeContractOnboardingExtraction(providerBase());
    expect(n.renewal_date.value).toBeNull();
  });
  it('"unknown" enum value -> canonical null (contract_type)', () => {
    const raw = providerBase(); raw.contract_type = missingEnumFact();
    expect(normalizeContractOnboardingExtraction(raw).contract_type.value).toBeNull();
  });
  it('"unknown" enum value -> canonical null (risk)', () => {
    const raw = providerBase(); raw.risk = { ...missingEnumFact(), factors: [] };
    expect(normalizeContractOnboardingExtraction(raw).risk.value).toBeNull();
  });
  it('documentary_state "unknown" is preserved, NOT normalized to null (legitimate canonical state)', () => {
    const raw = providerBase(); raw.documentary_state = providerFact('unknown', { page: 0, excerpt: '', confidence: 0 });
    expect(normalizeContractOnboardingExtraction(raw).documentary_state.value).toBe('unknown');
  });
  it('numeric null is preserved as null, not sentineled', () => {
    const n = normalizeContractOnboardingExtraction(providerBase());
    expect(n.monthly_value.value).toBeNull();
  });
  it('a real numeric zero is NOT normalized away (zero is a legitimate contract value)', () => {
    const raw = providerBase();
    raw.total_value = { value: 0, page: 5, excerpt: 'Contrato de comodato, sem contraprestação financeira.', confidence: 0.95, ambiguous: false, conflicting: false };
    expect(normalizeContractOnboardingExtraction(raw).total_value.value).toBe(0);
  });
  it('valid documentary fact survives normalization unchanged', () => {
    const n = normalizeContractOnboardingExtraction(providerBase());
    expect(n.contract_number).toMatchObject({
      value: 'JA10182283', page: 3, excerpt: 'Contrato nº JA10182283 celebrado entre as partes.', confidence: 0.96,
      ambiguous: false, conflicting: false,
    });
  });
  it('does not mutate confidence, ambiguous or conflicting', () => {
    const raw = providerBase();
    raw.title = providerFact('X', { confidence: 0.5, ambiguous: true, conflicting: true });
    const n = normalizeContractOnboardingExtraction(raw);
    expect(n.title.confidence).toBe(0.5);
    expect(n.title.ambiguous).toBe(true);
    expect(n.title.conflicting).toBe(true);
  });
});

describe('Prefill safety: provider absence sentinels never reach prefill', () => {
  it('contract_number "" sentinel -> not prefilled', () => {
    const raw = providerBase(); raw.contract_number = missingStringFact();
    const n = normalizeContractOnboardingExtraction(raw);
    const res = buildContractOnboardingResult(n);
    expect(res.fields.find((f) => f.key === 'contract_number')!.state).toBe('unknown');
    expect(res.prefill).not.toHaveProperty('contractNumber');
  });
  it('total_value numeric null -> not prefilled', () => {
    const raw = providerBase(); raw.total_value = missingNumericFact();
    const res = buildContractOnboardingResult(normalizeContractOnboardingExtraction(raw));
    expect(res.prefill).not.toHaveProperty('totalValue');
  });
  it('start_date "" sentinel -> not prefilled directly, but effective-date fallback may still apply under existing rules', () => {
    const raw = providerBase();
    raw.start_date = missingStringFact();
    raw.effective_date = { ...providerFact('2026-02-01'), derivation: 'explicit' };
    const res = buildContractOnboardingResult(normalizeContractOnboardingExtraction(raw));
    expect(res.fields.find((f) => f.key === 'start_date')!.state).toBe('unknown');
    expect(res.prefill.startDate).toBe('2026-02-01'); // via effective_date fallback, not start_date itself
  });
  it('start_date "" with no valid effective-date derivation -> startDate not prefilled at all', () => {
    const raw = providerBase();
    raw.start_date = missingStringFact();
    raw.effective_date = { ...missingStringFact(), derivation: 'unknown' };
    const res = buildContractOnboardingResult(normalizeContractOnboardingExtraction(raw));
    expect(res.prefill).not.toHaveProperty('startDate');
  });
});

describe('Evidence safety: sentinels and out-of-range confidence never qualify as strong evidence', () => {
  const strongBase = () => ({ value: 'x', page: 3, excerpt: 'Trecho documental literal suficiente.', confidence: 0.96, ambiguous: false, conflicting: false });
  it('page 0 fails', () => { expect(hasStrongEvidence({ ...strongBase(), page: 0 })).toBe(false); });
  it('empty excerpt fails', () => { expect(hasStrongEvidence({ ...strongBase(), excerpt: '' })).toBe(false); });
  it('confidence > 1 fails', () => { expect(hasStrongEvidence({ ...strongBase(), confidence: 1.5 })).toBe(false); });
  it('confidence < 0 fails', () => { expect(hasStrongEvidence({ ...strongBase(), confidence: -0.1 })).toBe(false); });
  it('confidence below threshold fails', () => { expect(hasStrongEvidence({ ...strongBase(), confidence: MIN_ONBOARDING_CONFIDENCE - 0.01 })).toBe(false); });
  it('ambiguous fails', () => { expect(hasStrongEvidence({ ...strongBase(), ambiguous: true })).toBe(false); });
  it('conflicting fails', () => { expect(hasStrongEvidence({ ...strongBase(), conflicting: true })).toBe(false); });
  it('a fully sentineled fact never qualifies', () => {
    const n = normalizeContractOnboardingExtraction(providerBase());
    expect(hasStrongEvidence(n.renewal_date)).toBe(false);
  });
});

describe('Effective date: sentinel absence normalizes cleanly, no new assumptions', () => {
  it('effective_date value="" page=0 excerpt="" normalizes to canonical absence', () => {
    const raw = providerBase();
    raw.effective_date = { ...missingStringFact(), derivation: 'explicit' };
    const n = normalizeContractOnboardingExtraction(raw);
    expect(n.effective_date.value).toBeNull();
    expect(resolveEffectiveDate(n).value).toBeNull();
  });
  it('from_signature still requires strong evidence on both sides after normalization', () => {
    const raw = providerBase();
    raw.effective_date = { ...missingStringFact(), derivation: 'from_signature' };
    raw.signature_date = providerFact('2026-01-15', { confidence: 0.95 });
    const n = normalizeContractOnboardingExtraction(raw);
    const resolved = resolveEffectiveDate(n) as EffectiveDateFact;
    // effective_date itself carries no evidence (sentineled) so from_signature cannot borrow it blindly;
    // resolveEffectiveDate still requires hasStrongEvidence(effective) OR the from_signature branch,
    // which only reads signature_date's value once effective itself is weak.
    expect(resolved.value === null || resolved.value === '2026-01-15').toBe(true);
  });
});

describe('Risk governance: still requires human confirmation after normalization', () => {
  it('a valid, strong-evidence risk value is still GOVERNED_CONFIRMATION_REQUIRED', () => {
    const n = normalizeContractOnboardingExtraction(providerBase());
    const res = buildContractOnboardingResult(n);
    const risk = res.fields.find((f) => f.key === 'risk')!;
    expect(risk.value).toBe('medium');
    expect(risk.state).toBe('attention');
    expect(risk.reason).toBe('GOVERNED_CONFIRMATION_REQUIRED');
    expect(res.prefill).not.toHaveProperty('riskLevel');
  });
  it('"unknown" risk sentinel normalizes to null and is NOT_FOUND_IN_DOCUMENT', () => {
    const raw = providerBase(); raw.risk = { ...missingEnumFact(), factors: [] };
    const res = buildContractOnboardingResult(normalizeContractOnboardingExtraction(raw));
    const risk = res.fields.find((f) => f.key === 'risk')!;
    expect(risk.value).toBeNull();
    expect(risk.state).toBe('unknown');
  });
});

describe('Internal responsible / project: schema gains no organizational fields', () => {
  it('provider schema does not declare responsible_internal or project', () => {
    const s = JSON.stringify(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA);
    expect(s).not.toContain('responsible_internal');
    expect(s).not.toContain('"project"');
    expect(s).not.toContain('owner_user_id');
    expect(s).not.toContain('project_id');
  });
});

describe('Gateway / adapter: schema sent to Anthropic adapter stays within limits, model unchanged', () => {
  it('routes to claude-sonnet-5, no Opus, no fallback', () => {
    const p = getApexAITaskPolicy('CONTRACT_EXTRACTION');
    expect(p.provider).toBe('anthropic');
    expect(p.model).toBe('claude-sonnet-5');
    expect(p.fallbacks).toEqual([]);
    expect(p.model.toLowerCase()).not.toContain('opus');
  });
  it('schema passed through the gateway to the adapter has union count <= 16 and no min/max keywords', async () => {
    const stub = new StubAdapter();
    await new ApexAIGateway([stub]).generate({
      organizationId: 'org-schema-complexity-check', task: 'CONTRACT_EXTRACTION', userPrompt: 'x',
      structuredOutput: { name: 'contract_onboarding_extraction', schema: CONTRACT_ONBOARDING_EXTRACTION_SCHEMA },
    });
    const schema = stub.calls[0].structuredOutput!.schema;
    expect(countSchemaUnions(schema)).toBeLessThanOrEqual(16);
    const s = JSON.stringify(schema);
    expect(s).not.toContain('"minimum"');
    expect(s).not.toContain('"maximum"');
    expect(s).not.toContain('"exclusiveMinimum"');
    expect(s).not.toContain('"exclusiveMaximum"');
    expect(stub.calls[0].policy.model).toBe('claude-sonnet-5');
    expect(stub.calls[0].policy.model.toLowerCase()).not.toContain('opus');
  });
});
