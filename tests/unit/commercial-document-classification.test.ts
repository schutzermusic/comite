/** A classificação do documento AVISA; nunca corrige o que uma pessoa declarou. */
import { describe, expect, it } from 'vitest';
import {
  COMMERCIAL_EXTRACTION_SCHEMA, classificationWarnings, normalizeClassification, normalizeCommercialFacts,
  parseRevisionLabel,
} from '@/lib/commercial/document-intelligence';

describe('proposal document classification', () => {
  it('parses printed revision labels', () => {
    expect(parseRevisionLabel('Rev. 03')).toBe(3);
    expect(parseRevisionLabel('R2')).toBe(2);
    expect(parseRevisionLabel('Revisão 10')).toBe(10);
    expect(parseRevisionLabel('')).toBeNull();
    expect(parseRevisionLabel('Proposta técnica')).toBeNull();
  });

  it('warns when the document says it is something else, or another revision', () => {
    const classification = normalizeClassification({ document: {
      role: 'commercial_proposal', revision_label: 'Rev. 05', title: 'PC', page: 1, excerpt: 'Proposta Comercial Rev. 05' } });
    const warnings = classificationWarnings(classification, { kind: 'TECHNICAL', revision: 2 });
    expect(warnings).toHaveLength(2);
    expect(classificationWarnings(classification, { kind: 'COMMERCIAL', revision: 5 })).toEqual([]);
    // Rev.00 como primeira revisão não é divergência.
    const zero = normalizeClassification({ document: { role: 'TECHNICAL_PROPOSAL', revision_label: 'Rev. 00', title: '', page: 0, excerpt: '' } });
    expect(classificationWarnings(zero, { kind: 'TECHNICAL', revision: 1 })).toEqual([]);
  });

  it('never invents a classification', () => {
    expect(normalizeClassification({ facts: [] })).toBeNull();
    expect(classificationWarnings(null, { kind: 'TECHNICAL', revision: 1 })[0]).toContain('não classificou');
  });

  it('keeps provenance derived, not asserted, and discards out-of-role domains', () => {
    const { facts, discarded } = normalizeCommercialFacts('TECHNICAL_PROPOSAL', { facts: [
      { domain: 'SCOPE', label: 'Escopo', value_text: 'x', value_numeric: '', value_date: '', currency: '', page: 3, excerpt: 'literal', section: '2', confidence: 0.8 },
      { domain: 'SCOPE', label: 'Sem âncora', value_text: 'y', value_numeric: '', value_date: '', currency: '', page: 0, excerpt: '', section: '', confidence: 0.4 },
      { domain: 'BILLING_PREREQUISITE', label: 'Fora do papel', value_text: 'z', value_numeric: '', value_date: '', currency: '', page: 1, excerpt: 'q', section: '', confidence: 1 },
    ] });
    expect(facts.map((f) => f.provenanceState)).toEqual(['ANCHORED', 'UNANCHORED']);
    expect(discarded).toBe(1);
  });

  it('requires the classification block in the structured output', () => {
    expect(COMMERCIAL_EXTRACTION_SCHEMA.required).toEqual(['document', 'facts']);
  });
});
