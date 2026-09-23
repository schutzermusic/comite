import { describe, expect, it } from 'vitest';
import {
  CommercialExtractionValidationError, COMMERCIAL_EXTRACTION_SCHEMA,
  normalizeCommercialFacts, validateCommercialExtraction,
} from '@/lib/commercial/document-intelligence';
import { getApexAITaskPolicy } from '@/lib/ai/gateway/task-registry';

const fact = (domain: string, page: number, excerpt: string) => ({
  domain, label: domain, value_text: 'documentary value', value_numeric: '', value_date: '',
  currency: '', page, excerpt, section: '', confidence: 0.8,
});
const valid = () => ({ document: { role: 'COMBINED_PROPOSAL', revision_label: 'R02',
  title: 'Proposal', page: 1, excerpt: 'Proposal R02' },
facts: [fact('SCOPE', 1, 'literal scope'), fact('VALUE', 2, 'literal value')] });

describe('Luna commercial extraction contract', () => {
  it('routes only this task to Luna with a concise non-streaming budget', () => {
    const policy = getApexAITaskPolicy('COMMERCIAL_DOCUMENT_EXTRACTION');
    expect(policy).toMatchObject({ provider: 'openai', model: 'gpt-6-luna',
      reasoningEffort: 'low', promptCache: false, stream: false,
      maxTokens: 8_000, highRisk: true, fallbacks: [] });
    expect(getApexAITaskPolicy('CONTRACT_AMENDMENT_EXTRACTION').provider).toBe('anthropic');
  });

  it('accepts a valid structured payload and preserves both combined domains', () => {
    const payload = valid();
    validateCommercialExtraction(payload);
    const { facts, discarded } = normalizeCommercialFacts('COMBINED_PROPOSAL', payload);
    expect(discarded).toBe(0);
    expect(facts.map((item) => item.documentContext)).toEqual([
      'TECHNICAL_PROPOSAL', 'COMMERCIAL_PROPOSAL',
    ]);
  });

  it('rejects missing required fields with content-safe diagnostics', () => {
    const payload = valid() as Record<string, unknown>;
    delete payload.document;
    expect(() => validateCommercialExtraction(payload)).toThrow(CommercialExtractionValidationError);
    try { validateCommercialExtraction(payload); } catch (error) {
      expect((error as CommercialExtractionValidationError).issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: '/document', expected: 'required' }),
      ]));
      expect(JSON.stringify((error as CommercialExtractionValidationError).issues))
        .not.toContain('documentary value');
    }
  });

  it('rejects malformed facts instead of coercing them', () => {
    const payload = valid();
    payload.facts[0].page = 0;
    expect(() => validateCommercialExtraction(payload)).toThrow(CommercialExtractionValidationError);
    const missing = valid();
    (missing.facts[0] as Record<string, unknown>).confidence = 'high';
    expect(() => validateCommercialExtraction(missing)).toThrow(CommercialExtractionValidationError);
  });

  it('rejects markdown or narrative wrapping and unexpected fields', () => {
    expect(() => validateCommercialExtraction('```json\n{}\n```')).toThrow(CommercialExtractionValidationError);
    expect(() => validateCommercialExtraction({ ...valid(), report: 'unrequested' }))
      .toThrow(CommercialExtractionValidationError);
    expect(COMMERCIAL_EXTRACTION_SCHEMA.additionalProperties).toBe(false);
  });
});
