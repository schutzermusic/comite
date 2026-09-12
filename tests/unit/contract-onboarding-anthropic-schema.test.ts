/**
 * Regression tests for the Anthropic structured-output schema compatibility fix.
 *
 * Production failure: CONTRACT_EXTRACTION returning HTTP 400 because
 * confidence: { type: 'number', minimum: 0, maximum: 1 } is not supported
 * by the Anthropic structured-output dialect.
 *
 * NO live Anthropic calls are made in this file.
 */
import { describe, expect, it } from 'vitest';
import {
  CONTRACT_ONBOARDING_EXTRACTION_SCHEMA,
  hasStrongEvidence,
  resolveEffectiveDate,
  buildContractOnboardingResult,
  MIN_ONBOARDING_CONFIDENCE,
  type DocumentaryFact,
  type ContractOnboardingExtraction,
  type EffectiveDateFact,
} from '@/lib/contracts/onboarding/document-first';
import { classifyJobError } from '@/lib/platform/jobs/errors';
import { ApexAIError } from '@/lib/ai/gateway/errors';
import { ApexAIGateway } from '@/lib/ai/gateway/apex-ai-gateway';
import type {
  ApexAIAdapterRequest,
  ApexAIAdapterResponse,
  ApexAIProviderAdapter,
} from '@/lib/ai/gateway/types';
import { getApexAITaskPolicy } from '@/lib/ai/gateway/task-registry';

function collectSchemaKeywords(obj: unknown, found = new Set<string>()): Set<string> {
  if (typeof obj !== 'object' || obj === null) return found;
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    found.add(key);
    collectSchemaKeywords(val, found);
  }
  return found;
}

const FORBIDDEN_KEYWORDS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'];

function fact<T>(value: T, overrides: Partial<DocumentaryFact<T>> = {}): DocumentaryFact<T> {
  return { value, page: 1, excerpt: 'Trecho documental inequivoco suficiente.', confidence: 0.96, ambiguous: false, conflicting: false, ...overrides };
}

function base(): ContractOnboardingExtraction {
  return {
    contract_number: fact('JA10182283'),
    title: fact('Contrato de Prestacao de Servicos'),
    counterparty: fact('EMPRESA TESTE LTDA'),
    contract_type: fact('Prestacao de servicos'),
    object: fact('Manutencao preventiva e corretiva de equipamentos.'),
    documentary_state: fact('active' as const),
    signature_date: fact('2026-01-15'),
    start_date: fact('2026-02-01'),
    effective_date: { ...fact<string | null>('2026-02-01'), derivation: 'explicit' } as EffectiveDateFact,
    end_date: fact('2027-01-31'),
    renewal_date: fact<string | null>(null, { page: null, excerpt: null, confidence: 0 }),
    total_value: fact(500_000),
    monthly_value: fact<number | null>(null, { page: null, excerpt: null, confidence: 0 }),
    currency: fact('BRL'),
    payment_terms: fact('30 dias apos faturamento'),
    indexation: fact<string | null>(null, { page: null, excerpt: null, confidence: 0 }),
    retention: fact<string | null>(null, { page: null, excerpt: null, confidence: 0 }),
    risk: { ...fact('medium' as const), factors: ['prazo de pagamento estendido'] },
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

describe('Provider schema: Anthropic structured-output compatibility', () => {
  it('does NOT contain minimum or maximum at any depth', () => {
    const kw = collectSchemaKeywords(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA);
    for (const f of FORBIDDEN_KEYWORDS) expect(kw, f).not.toContain(f);
  });
  it('schema string has no minimum/maximum', () => {
    const s = JSON.stringify(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA);
    expect(s).not.toContain('"minimum"');
    expect(s).not.toContain('"maximum"');
    expect(s).not.toContain('"exclusiveMinimum"');
    expect(s).not.toContain('"exclusiveMaximum"');
  });
  it('confidence field is still declared as type number', () => {
    const s = JSON.stringify(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA);
    expect(s).toContain('"confidence"');
    expect(s).toContain('"number"');
  });
  it('schema serializes without error', () => {
    expect(() => JSON.stringify(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA)).not.toThrow();
  });
  it('schema preserves required fields, additionalProperties, enums, arrays', () => {
    const s = CONTRACT_ONBOARDING_EXTRACTION_SCHEMA as Record<string, unknown>;
    expect(s.type).toBe('object');
    expect(s.additionalProperties).toBe(false);
    const req = s.required as string[];
    expect(req).toContain('contract_number');
    expect(req).toContain('risk');
    expect(req).toContain('effective_date');
    const str = JSON.stringify(s);
    expect(str).toContain('"enum"');
    expect(str).toContain('"draft"');
    expect(str).toContain('"array"');
    expect(str).toContain('"items"');
  });
  it('maxItems is not present in onboarding schema', () => {
    expect(collectSchemaKeywords(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA)).not.toContain('maxItems');
  });
});

describe('hasStrongEvidence: runtime 0..1 trust boundary', () => {
  const good = () => fact('v', { page: 2, excerpt: 'Trecho documental suficiente aqui.', confidence: MIN_ONBOARDING_CONFIDENCE });
  it('PASS: confidence at threshold', () => { expect(hasStrongEvidence(good())).toBe(true); });
  it('PASS: confidence 0.95', () => { expect(hasStrongEvidence(fact('x', { confidence: 0.95 }))).toBe(true); });
  it('PASS: confidence 1.0', () => { expect(hasStrongEvidence(fact('x', { confidence: 1 }))).toBe(true); });
  it('FAIL: confidence below threshold', () => { expect(hasStrongEvidence(fact('x', { confidence: MIN_ONBOARDING_CONFIDENCE - 0.001 }))).toBe(false); });
  it('FAIL: confidence 0', () => { expect(hasStrongEvidence(fact('x', { confidence: 0 }))).toBe(false); });
  it('FAIL: confidence -0.01', () => { expect(hasStrongEvidence(fact('x', { confidence: -0.01 }))).toBe(false); });
  it('FAIL: confidence 1.01', () => { expect(hasStrongEvidence(fact('x', { confidence: 1.01 }))).toBe(false); });
  it('FAIL: confidence 4.5', () => { expect(hasStrongEvidence(fact('x', { confidence: 4.5 }))).toBe(false); });
  it('FAIL: confidence NaN', () => { expect(hasStrongEvidence(fact('x', { confidence: NaN }))).toBe(false); });
  it('FAIL: confidence Infinity', () => { expect(hasStrongEvidence(fact('x', { confidence: Infinity }))).toBe(false); });
  it('FAIL: confidence -Infinity', () => { expect(hasStrongEvidence(fact('x', { confidence: -Infinity }))).toBe(false); });
  it('FAIL: ambiguous', () => { expect(hasStrongEvidence(fact('x', { confidence: 0.99, ambiguous: true }))).toBe(false); });
  it('FAIL: conflicting', () => { expect(hasStrongEvidence(fact('x', { confidence: 0.99, conflicting: true }))).toBe(false); });
  it('FAIL: page null', () => { expect(hasStrongEvidence(fact('x', { page: null }))).toBe(false); });
  it('FAIL: page 0', () => { expect(hasStrongEvidence(fact('x', { page: 0 }))).toBe(false); });
  it('FAIL: excerpt null', () => { expect(hasStrongEvidence(fact('x', { excerpt: null }))).toBe(false); });
  it('FAIL: excerpt too short', () => { expect(hasStrongEvidence(fact('x', { excerpt: 'tiny' }))).toBe(false); });
});

describe('Prefill trust: out-of-range confidence never reaches prefill', () => {
  it('confidence 4.5 on contract_number: not identified, not prefilled', () => {
    const r = base(); r.contract_number = fact('JA123', { confidence: 4.5 });
    const res = buildContractOnboardingResult(r);
    expect(res.fields.find((f) => f.key === 'contract_number')!.state).not.toBe('identified');
    expect(res.prefill).not.toHaveProperty('contractNumber');
  });
  it('confidence -0.1 on contract_number: not prefilled', () => {
    const r = base(); r.contract_number = fact('JA456', { confidence: -0.1 });
    expect(buildContractOnboardingResult(r).prefill).not.toHaveProperty('contractNumber');
  });
  it('confidence NaN: totalValue not prefilled', () => {
    const r = base(); r.total_value = fact(999_999, { confidence: NaN });
    expect(buildContractOnboardingResult(r).prefill).not.toHaveProperty('totalValue');
  });
  it('confidence Infinity: start_date field is NOT identified (may appear via effective_date fallback)', () => {
    const r = base(); r.start_date = fact('2026-01-01', { confidence: Infinity });
    const res = buildContractOnboardingResult(r);
    // The start_date field itself must not be identified — invalid confidence blocks it.
    const field = res.fields.find((f) => f.key === 'start_date')!;
    expect(field.state).not.toBe('identified');
    // Note: startDate may still appear in prefill via the effective_date fallback (correct behavior).
    // That path is tested separately in effective-date tests.
  });
  it('confidence 1.01: title not prefilled', () => {
    const r = base(); r.title = fact('Titulo', { confidence: 1.01 });
    expect(buildContractOnboardingResult(r).prefill).not.toHaveProperty('title');
  });
  it('confidence 0.40: attention/LOW_CONFIDENCE, not prefilled', () => {
    const r = base(); r.counterparty = fact('Empresa ABC', { confidence: 0.4 });
    const res = buildContractOnboardingResult(r);
    expect(res.fields.find((f) => f.key === 'counterparty')!.state).toBe('attention');
    expect(res.prefill).not.toHaveProperty('counterparty');
  });
  it('confidence 0.95 + valid evidence: contractNumber IS prefilled', () => {
    const r = base(); r.contract_number = fact('JA10182283', { confidence: 0.95 });
    expect(buildContractOnboardingResult(r).prefill.contractNumber).toBe('JA10182283');
  });
});

describe('resolveEffectiveDate trust after schema fix', () => {
  it('strong explicit date resolves', () => {
    const r = base(); r.effective_date = { ...fact<string | null>('2026-02-01'), derivation: 'explicit' } as EffectiveDateFact;
    expect(resolveEffectiveDate(r).value).toBe('2026-02-01');
  });
  it('from_signature with strong both sides resolves', () => {
    const r = base(); r.effective_date = { ...fact<string | null>(null), derivation: 'from_signature' } as EffectiveDateFact;
    r.signature_date = fact('2026-01-15', { confidence: 0.95 });
    expect(resolveEffectiveDate(r).value).toBe('2026-01-15');
  });
  it('confidence > 1 on effective_date: null', () => {
    const r = base(); r.effective_date = { ...fact<string | null>('2026-02-01', { confidence: 1.5 }), derivation: 'explicit' } as EffectiveDateFact;
    expect(resolveEffectiveDate(r).value).toBeNull();
  });
  it('confidence > 1 on signature_date: from_signature null', () => {
    const r = base(); r.effective_date = { ...fact<string | null>(null), derivation: 'from_signature' } as EffectiveDateFact;
    r.signature_date = fact('2026-01-15', { confidence: 2.0 });
    expect(resolveEffectiveDate(r).value).toBeNull();
  });
  it('low confidence on explicit: null', () => {
    const r = base(); r.effective_date = { ...fact<string | null>('2026-02-01', { confidence: 0.5 }), derivation: 'explicit' } as EffectiveDateFact;
    expect(resolveEffectiveDate(r).value).toBeNull();
  });
  it('ambiguous effective_date: null', () => {
    const r = base(); r.effective_date = { ...fact<string | null>('2026-02-01', { ambiguous: true }), derivation: 'explicit' } as EffectiveDateFact;
    expect(resolveEffectiveDate(r).value).toBeNull();
  });
  it('conflicting effective_date: null', () => {
    const r = base(); r.effective_date = { ...fact<string | null>('2026-02-01', { conflicting: true }), derivation: 'explicit' } as EffectiveDateFact;
    expect(resolveEffectiveDate(r).value).toBeNull();
  });
});

describe('Risk governance: always requires human confirmation', () => {
  it('risk is always attention/GOVERNED_CONFIRMATION_REQUIRED', () => {
    const res = buildContractOnboardingResult(base());
    const f = res.fields.find((x) => x.key === 'risk')!;
    expect(f.state).toBe('attention');
    expect(f.reason).toBe('GOVERNED_CONFIRMATION_REQUIRED');
    expect(res.prefill).not.toHaveProperty('riskLevel');
  });
  it('risk with out-of-range confidence also attention', () => {
    const r = base(); r.risk = { ...fact('high' as const, { confidence: 99 }), factors: ['risco'] };
    expect(buildContractOnboardingResult(r).fields.find((f) => f.key === 'risk')!.state).toBe('attention');
  });
});

describe('Gateway / adapter: CONTRACT_EXTRACTION mock routing', () => {
  it('routes to claude-sonnet-5 no Opus no fallback', () => {
    const p = getApexAITaskPolicy('CONTRACT_EXTRACTION');
    expect(p.provider).toBe('anthropic');
    expect(p.model).toBe('claude-sonnet-5');
    expect(p.fallbacks).toEqual([]);
    expect(p.model).not.toContain('opus');
  });
  it('passes structured output + PDF through gateway no live call', async () => {
    const stub = new StubAdapter();
    const result = await new ApexAIGateway([stub]).generate({
      organizationId: 'org-regression', task: 'CONTRACT_EXTRACTION',
      userPrompt: 'extract', document: { mediaType: 'application/pdf', base64: 'ZmFrZQ==' },
      structuredOutput: { name: 'contract_onboarding_extraction', schema: CONTRACT_ONBOARDING_EXTRACTION_SCHEMA },
    });
    expect(stub.calls).toHaveLength(1);
    const req = stub.calls[0];
    expect(req.policy.model).toBe('claude-sonnet-5');
    expect(req.structuredOutput!.name).toBe('contract_onboarding_extraction');
    expect(req.document!.mediaType).toBe('application/pdf');
    expect(result.provenance.task).toBe('CONTRACT_EXTRACTION');
    expect(req.policy.model).not.toContain('opus');
  });
  it('schema sent to adapter has no minimum/maximum', async () => {
    const stub = new StubAdapter();
    await new ApexAIGateway([stub]).generate({
      organizationId: 'org-schema-check', task: 'CONTRACT_EXTRACTION', userPrompt: 'x',
      structuredOutput: { name: 'contract_onboarding_extraction', schema: CONTRACT_ONBOARDING_EXTRACTION_SCHEMA },
    });
    const s = JSON.stringify(stub.calls[0].structuredOutput!.schema);
    expect(s).not.toContain('"minimum"');
    expect(s).not.toContain('"maximum"');
  });
  it('HTTP 400 is non-retryable', () => {
    const e = Object.assign(new Error('bad'), { status: 400 });
    const c = classifyJobError(e);
    expect(c.retryable).toBe(false);
    expect(c.code).toBe('http_400');
  });
});

describe('Error classification: ApexAIError no longer mislabeled as pg_', () => {
  it('PROVIDER_ERROR -> apex_provider_error not pg_PROVIDER_ERROR', () => {
    const e = new ApexAIError('PROVIDER_ERROR', 'Anthropic 400', false, { provider: 'anthropic', status: 400 });
    const c = classifyJobError(e);
    expect(c.code).not.toBe('pg_PROVIDER_ERROR');
    expect(c.code).toBe('apex_provider_error');
    expect(c.retryable).toBe(false);
  });
  it('RATE_LIMIT -> apex_rate_limit retryable', () => {
    const e = new ApexAIError('RATE_LIMIT', '429', true, { provider: 'anthropic', status: 429 });
    const c = classifyJobError(e);
    expect(c.code).toBe('apex_rate_limit');
    expect(c.retryable).toBe(true);
  });
  it('PROVIDER_UNAVAILABLE -> retryable', () => {
    const e = new ApexAIError('PROVIDER_UNAVAILABLE', '503', true, { provider: 'anthropic', status: 503 });
    expect(classifyJobError(e).retryable).toBe(true);
  });
  it('AUTHENTICATION -> non-retryable', () => {
    const e = new ApexAIError('AUTHENTICATION', '401', false, { provider: 'anthropic', status: 401 });
    expect(classifyJobError(e).retryable).toBe(false);
  });
  it('real pg error 42P01 still works', () => {
    const e = Object.assign(new Error('relation does not exist'), { code: '42P01' });
    const c = classifyJobError(e);
    expect(c.code).toBe('pg_42P01');
    expect(c.retryable).toBe(false);
  });
  it('retryable pg deadlock 40P01 still works', () => {
    const e = Object.assign(new Error('deadlock'), { code: '40P01' });
    const c = classifyJobError(e);
    expect(c.code).toBe('pg_40P01');
    expect(c.retryable).toBe(true);
  });
  it('HTTP 400 non-apex still non-retryable via status branch', () => {
    const c = classifyJobError(Object.assign(new Error('bad'), { status: 400 }));
    expect(c.retryable).toBe(false);
    expect(c.code).toBe('http_400');
  });
});

describe('Authority / security: no fabricated human fields', () => {
  it('responsible_internal always INTERNAL_DECISION_REQUIRED', () => {
    const f = buildContractOnboardingResult(base()).fields.find((x) => x.key === 'responsible_internal')!;
    expect(f.state).toBe('attention');
    expect(f.reason).toBe('INTERNAL_DECISION_REQUIRED');
    expect(f.value).toBeNull();
  });
  it('project always PROJECT_MAPPING_REQUIRED', () => {
    const f = buildContractOnboardingResult(base()).fields.find((x) => x.key === 'project')!;
    expect(f.state).toBe('attention');
    expect(f.reason).toBe('PROJECT_MAPPING_REQUIRED');
    expect(f.value).toBeNull();
  });
  it('prefill never contains fabricated human fields', () => {
    const prefill = buildContractOnboardingResult(base()).prefill;
    for (const k of ['ownerUserId', 'projectId', 'approvedBy', 'reviewedBy', 'verifiedBy', 'assignedBy']) {
      expect(prefill).not.toHaveProperty(k);
    }
  });
});

describe('Tenant isolation', () => {
  it('empty orgId rejected before adapter', async () => {
    const stub = new StubAdapter();
    await expect(new ApexAIGateway([stub]).generate({ organizationId: '', task: 'CONTRACT_EXTRACTION', userPrompt: 'x' }))
      .rejects.toMatchObject({ code: 'INVALID_TENANT_CONTEXT' });
    expect(stub.calls).toHaveLength(0);
  });
  it('whitespace orgId rejected before adapter', async () => {
    const stub = new StubAdapter();
    await expect(new ApexAIGateway([stub]).generate({ organizationId: '   ', task: 'CONTRACT_EXTRACTION', userPrompt: 'x' }))
      .rejects.toMatchObject({ code: 'INVALID_TENANT_CONTEXT' });
    expect(stub.calls).toHaveLength(0);
  });
});
