import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  AMENDMENT_TRUST_POLICY_VERSION,
  deriveAmendmentEffectiveness,
  deriveEffectiveDate,
  evaluateAmendmentEffectTrust,
  validateAmendmentExtraction,
  type AmendmentExtraction,
  type ExtractedAmendmentEffect,
} from '@/lib/contracts/amendments/ai-types';
import { getApexAITaskPolicy, DEFAULT_PRODUCTION_MODEL } from '@/lib/ai/gateway/task-registry';

const source = (path: string) => readFileSync(path, 'utf8');
const evidence = { page: 2, excerpt: 'produzirá efeitos a partir da assinatura', confidence: 0.96 };
const effect = (patch: Partial<ExtractedAmendmentEffect> = {}): ExtractedAmendmentEffect => ({
  category: 'scope', operation: 'MODIFIED', title: 'Escopo',
  description: 'Modifica a manutenção preventiva.', source_clause_reference: 'Cláusula 4',
  source_clause_id: null,
  replacement_clause_reference: null, payload: {}, conflict: false, uncertainty_reasons: [],
  ...evidence, ...patch,
});

const extraction = (): AmendmentExtraction => ({
  amendment_identifier: { value: '1º Termo Aditivo', ...evidence },
  documentary_title: { value: 'Primeiro Termo Aditivo', ...evidence },
  apex_summary: 'Prorroga o prazo.',
  signature_date: { value: '2026-09-01', ...evidence },
  effective_date: { value: '2026-09-01', derivation: 'from_signature', ...evidence },
  documentary_state: { value: 'signed', ...evidence },
  value_effect: { ...effect({ category: 'value', operation: 'UNCHANGED' }), kind: 'none', amount: null, currency: null },
  term_effect: { ...effect({ category: 'term', operation: 'EXTENDED' }), kind: 'extension', new_end_date: null, duration_days: 180 },
  effects: [effect()], precedence_conflicts: [],
});

describe('AI-first amendment onboarding', () => {
  it('uses a dedicated Apex gateway task on Sonnet without automatic Opus fallback', () => {
    const policy = getApexAITaskPolicy('CONTRACT_AMENDMENT_EXTRACTION');
    expect(policy.model).toBe(DEFAULT_PRODUCTION_MODEL);
    expect(policy.fallbacks).toEqual([]);
    expect(policy.highRisk).toBe(true);
  });

  it('derives effective-from-signature only from evidenced signature truth', () => {
    const item = extraction();
    expect(deriveEffectiveDate(item.signature_date, item.effective_date)).toBe('2026-09-01');
    item.signature_date.page = null;
    expect(deriveEffectiveDate(item.signature_date, item.effective_date)).toBeNull();
  });

  it('keeps an unsupported effective date UNKNOWN', () => {
    const item = extraction();
    item.effective_date = { value: null, derivation: 'unknown', page: null, excerpt: null, confidence: 0 };
    expect(deriveEffectiveDate(item.signature_date, item.effective_date)).toBeNull();
  });

  it('does not activate a signed future amendment early', () => {
    expect(deriveAmendmentEffectiveness({ documentaryState: 'signed', effectiveDate: '2026-10-01', asOf: '2026-09-15' }))
      .toBe('not_yet_effective');
    expect(deriveAmendmentEffectiveness({ documentaryState: 'signed', effectiveDate: '2026-10-01', asOf: '2026-10-01' }))
      .toBe('effective');
  });

  it('separates documentary state from effectiveness', () => {
    expect(deriveAmendmentEffectiveness({ documentaryState: 'draft', effectiveDate: '2026-01-01', asOf: '2026-09-01' }))
      .toBe('indeterminate');
    expect(deriveAmendmentEffectiveness({ documentaryState: 'signed', effectiveDate: null, asOf: '2026-09-01' }))
      .toBe('indeterminate');
  });

  it('allows high-confidence evidenced policy-permitted effects', () => {
    expect(evaluateAmendmentEffectTrust(effect(), { effectiveDate: '2026-09-01', sequencingRequiresEffectiveDate: true }))
      .toEqual({ state: 'automatic', reasons: [], policyVersion: AMENDMENT_TRUST_POLICY_VERSION });
  });

  it.each([
    ['low confidence', effect({ confidence: 0.4 })],
    ['conflict', effect({ conflict: true })],
    ['missing evidence', effect({ page: null, excerpt: null })],
    ['uncertain relationship', effect({ uncertainty_reasons: ['unclear_replacement_relationship'] })],
  ])('routes %s to attention instead of authority', (_name, candidate) => {
    expect(evaluateAmendmentEffectTrust(candidate, { effectiveDate: '2026-09-01' }).state)
      .toBe('requires_attention');
  });

  it('requires attention when sequencing needs an unknown effective date', () => {
    const decision = evaluateAmendmentEffectTrust(effect(), {
      sequencingRequiresEffectiveDate: true, effectiveDate: null,
    });
    expect(decision.reasons).toContain('effective_date_unknown');
  });

  it('preserves DELTA independently from ABSOLUTE', () => {
    const item = extraction();
    item.value_effect = { ...effect({ category: 'value', payload: { amount: 2_000_000 } }),
      kind: 'delta', amount: 2_000_000, currency: 'BRL' };
    expect(validateAmendmentExtraction(item).value_effect.kind).toBe('delta');
  });

  it('preserves ABSOLUTE independently from DELTA', () => {
    const item = extraction();
    item.value_effect = { ...effect({ category: 'value', operation: 'REPLACED', payload: { amount: 22_000_000 } }),
      kind: 'absolute', amount: 22_000_000, currency: 'BRL' };
    expect(validateAmendmentExtraction(item).value_effect.kind).toBe('absolute');
  });

  it('rejects an amount attached to a none/unknown value effect', () => {
    const item = extraction();
    item.value_effect.amount = 12;
    expect(() => validateAmendmentExtraction(item)).toThrow(/cannot coexist/);
  });

  it('supports term extension and absolute end date without coexisting forms', () => {
    expect(validateAmendmentExtraction(extraction()).term_effect.duration_days).toBe(180);
    const item = extraction();
    item.term_effect = { ...effect({ category: 'term', operation: 'REPLACED' }),
      kind: 'new_end_date', new_end_date: '2027-06-30', duration_days: null };
    expect(validateAmendmentExtraction(item).term_effect.new_end_date).toBe('2027-06-30');
  });

  it('makes PDF the primary UI and manual transcription a secondary fallback', () => {
    const ui = source('src/components/contracts/useContractAmendmentModals.tsx');
    expect(ui).toContain('Solte o PDF do aditivo aqui');
    expect(ui).toContain('Registrar manualmente');
    expect(ui).toContain("useState<AmendmentMode>('ai')");
    expect(ui).toContain("amendmentMode === 'manual'");
  });

  it('registers document, request and final effects with stable idempotency boundaries', () => {
    const sql = source('supabase/migrations/165_contract_amendment_ai_onboarding.sql');
    expect(sql).toContain('contract_documents_amendment_content_once');
    expect(sql).toContain('cair_document_unique');
    expect(sql).toContain('cae_fingerprint_unique');
    expect(sql).toContain('contract_amendment_apply_ai_extraction');
  });

  it('keeps system provenance and provides no fabricated human reviewer', () => {
    const sql = source('supabase/migrations/165_contract_amendment_ai_onboarding.sql');
    expect(sql).toContain('ai_provider');
    expect(sql).toContain('ai_model');
    expect(sql).not.toMatch(/reviewed_by\s*=/);
  });

  it('does not write Finance, Fiscal, Projects execution, measurement or acceptance', () => {
    const extractor = source('src/lib/ai/contract-amendment-extractor.ts');
    const handler = source('src/lib/platform/jobs/handlers.ts');
    const amendmentSection = handler.slice(handler.indexOf('const amendmentExtraction'), handler.indexOf('const approvalExpiration'));
    expect(extractor).not.toMatch(/\.from\(['"](?:finance|fiscal|project_measurements)/);
    expect(amendmentSection).not.toMatch(/finance|fiscal|measurement|acceptance/i);
  });
});
