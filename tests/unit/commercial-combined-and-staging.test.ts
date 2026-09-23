import { describe, expect, it } from 'vitest';
import {
  apexTaskForContext, buildCommercialExtractionPrompt, domainsForMode, extractionModeForProposal,
  factContextFor, normalizeCommercialFacts,
} from '@/lib/commercial/document-intelligence';
import { expiredStagedPaths, STAGED_PDF_MIN_TTL_MS } from '@/lib/commercial/staging-sweep';

const fact = (domain: string, page = 2) => ({
  domain, label: domain, value_text: 'x', value_numeric: domain === 'VALUE' ? '1000' : '', value_date: '',
  currency: domain === 'VALUE' ? 'BRL' : '', page, excerpt: page ? 'literal' : '', section: '', confidence: 0.9,
});

describe('combined PT + PC reading', () => {
  it('reads combined proposals with the union of technical and commercial domains', () => {
    expect(extractionModeForProposal('COMBINED')).toBe('COMBINED_PROPOSAL');
    expect(extractionModeForProposal('TECHNICAL')).toBe('TECHNICAL_PROPOSAL');
    expect(extractionModeForProposal('COMMERCIAL')).toBe('COMMERCIAL_PROPOSAL');
    const domains = domainsForMode('COMBINED_PROPOSAL');
    expect(domains).toEqual(expect.arrayContaining(['SCOPE', 'EXCLUSION', 'VALUE', 'MEASUREMENT_RULE']));
    expect(apexTaskForContext('COMBINED_PROPOSAL')).toBe('COMMERCIAL_DOCUMENT_EXTRACTION');
    const prompt = buildCommercialExtractionPrompt('COMBINED_PROPOSAL', 'P-1.pdf');
    expect(prompt).toContain('SCOPE');
    expect(prompt).toContain('PAYMENT_TERM');
  });

  it('keeps technical facts and records each under the role of its domain, provenance intact', () => {
    const { facts, discarded } = normalizeCommercialFacts('COMBINED_PROPOSAL', { facts: [
      fact('SCOPE', 3), fact('EXCLUSION', 0), fact('VALUE', 7), fact('MEASUREMENT_RULE', 9), fact('RISK', 1),
    ] });
    expect(discarded).toBe(1); // RISK não pertence a proposta
    expect(facts.map((f) => [f.factDomain, f.documentContext, f.provenanceState, f.sourcePage])).toEqual([
      ['SCOPE', 'TECHNICAL_PROPOSAL', 'ANCHORED', 3],
      ['EXCLUSION', 'TECHNICAL_PROPOSAL', 'UNANCHORED', null],
      ['VALUE', 'COMMERCIAL_PROPOSAL', 'ANCHORED', 7],
      ['MEASUREMENT_RULE', 'COMMERCIAL_PROPOSAL', 'ANCHORED', 9],
    ]);
  });

  it('leaves single-role readings exactly as before', () => {
    const { facts, discarded } = normalizeCommercialFacts('COMMERCIAL_PROPOSAL', { facts: [fact('SCOPE'), fact('VALUE')] });
    expect(discarded).toBe(1);
    expect(facts[0].documentContext).toBe('COMMERCIAL_PROPOSAL');
    expect(factContextFor('TECHNICAL_PROPOSAL', 'VALUE')).toBe('TECHNICAL_PROPOSAL');
  });
});

describe('staged proposal PDF expiry', () => {
  const org = '11111111-1111-4111-8111-111111111111';
  const user = '22222222-2222-4222-8222-222222222222';
  const base = `${org}/proposals/_staging/${user}`;
  const now = new Date('2026-09-23T12:00:00Z');
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();

  it('removes only what expired, with its reading, and keeps fresh uploads', () => {
    const removed = expiredStagedPaths([
      { path: `${base}/old.pdf`, createdAt: hoursAgo(30) },
      { path: `${base}/old.pdf.apex.json`, createdAt: hoursAgo(29) },
      { path: `${base}/fresh.pdf`, createdAt: hoursAgo(1) },
      { path: `${base}/fresh.pdf.apex.json`, createdAt: hoursAgo(1) },
    ], { now });
    expect(removed).toEqual([`${base}/old.pdf`, `${base}/old.pdf.apex.json`]);
  });

  it('never removes a path a canonical document references', () => {
    const removed = expiredStagedPaths([
      { path: `${base}/adopted.pdf`, createdAt: hoursAgo(72) },
      { path: `${base}/adopted.pdf.apex.json`, createdAt: hoursAgo(72) },
    ], { now, protectedPaths: [`${base}/adopted.pdf`] });
    expect(removed).toEqual([]);
  });

  it('expires orphan readings, ignores anything outside staging and undated objects', () => {
    const removed = expiredStagedPaths([
      { path: `${base}/gone.pdf.apex.json`, createdAt: hoursAgo(48) },
      { path: `${org}/proposals/33333333-3333-4333-8333-333333333333/x.pdf`, createdAt: hoursAgo(500) },
      { path: `${base}/undated.pdf`, createdAt: null },
    ], { now });
    expect(removed).toEqual([`${base}/gone.pdf.apex.json`]);
  });

  it('cannot be configured below the minimum TTL', () => {
    const removed = expiredStagedPaths([{ path: `${base}/in-review.pdf`, createdAt: hoursAgo(1) }],
      { now, ttlMs: 1000 });
    expect(removed).toEqual([]);
    expect(STAGED_PDF_MIN_TTL_MS).toBeGreaterThanOrEqual(3600_000);
  });
});
