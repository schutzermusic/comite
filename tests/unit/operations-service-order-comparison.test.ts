import { describe, expect, it } from 'vitest';
import {
  buildServiceOrderComparison, comparisonCounts, titleSimilarity, type PackageFact,
} from '@/lib/operations/service-orders/comparison';
import type { ServiceOrderDivergence, ServiceOrderItem } from '@/lib/operations/service-orders/types';

const item = (over: Partial<ServiceOrderItem>): ServiceOrderItem => ({
  id: 'i', kind: 'SCOPE', position: 1, title: 'Linha', detail: null, quantity: null, unit: null, planned_date: null,
  origin: 'document_extraction', source_document_kind: 'INTERNAL_SERVICE_ORDER', source_revision_id: null, source_fact_id: null,
  source_document_id: 'doc', source_page: 2, source_quote: '“trecho”', ai_provider: 'openai', ai_model: 'qa-model', confidence: '0.92',
  confirmation_state: 'UNCONFIRMED', confirmed_by: null, confirmed_at: null, ...over,
});
const fact = (over: Partial<PackageFact>): PackageFact => ({
  id: 'f', document_context: 'TECHNICAL_PROPOSAL', fact_domain: 'SCOPE', label: 'Fato', value_text: null, value_numeric: null,
  value_date: null, unit: null, currency: null, source_page: 3, source_quote: '“na proposta”', confidence: '0.9',
  extraction_method: 'ai', ai_model: 'qa-model', confirmation_state: 'CONFIRMED', ...over,
});
const divergence = (over: Partial<ServiceOrderDivergence>): ServiceOrderDivergence => ({
  id: 'd', scope: 'VALUE', field_path: 'authorized_value', left_source_kind: 'accepted_proposal', left_value: '1250000',
  right_source_kind: 'internal_service_order', right_value: '1300000', severity: 'BLOCKING', summary: 'Valor diverge.',
  detected_by: 'rule', ai_model: null, confidence: null, state: 'OPEN', resolved_source_kind: null, resolution_note: null,
  resolved_at: null, created_at: '2026-09-24T12:00:00Z', service_order_id: 'os', ...over,
});

describe('OS × PT × PC — comparação', () => {
  it('semelhança de títulos: termos em comum, sem artigos nem acentos', () => {
    expect(titleSimilarity('Montagem eletromecânica dos bays', 'Montagem eletromecanica dos novos bays')).toBeGreaterThanOrEqual(0.45);
    expect(titleSimilarity('Pintura das estruturas', 'Montagem eletromecânica dos bays')).toBe(0);
  });

  it('classifica cada linha em UMA situação: alinhado, adicional, incerto e faltando', () => {
    const rows = buildServiceOrderComparison({
      items: [
        item({ id: 'a', title: 'Montagem eletromecânica dos bays' }),
        item({ id: 'b', title: 'Pintura anticorrosiva das estruturas' }),
        item({ id: 'c', kind: 'TEST', title: 'Ensaio de resistência de contato', confidence: '0.55' }),
      ],
      facts: [
        fact({ id: 'f1', label: 'Montagem eletromecânica dos novos bays' }),
        fact({ id: 'f2', fact_domain: 'DELIVERABLE', label: 'Databook as built' }),
      ],
      divergences: [], authorizedValue: null, currency: 'BRL',
    });
    const by = Object.fromEntries(rows.map((r) => [r.itemId ?? r.id, r]));
    expect(by.a).toMatchObject({ status: 'aligned', dimension: 'scope' });
    expect(by.a.pt?.ref).toBe('f1');
    expect(by.b).toMatchObject({ status: 'additional', pt: null, pc: null });
    expect(by.c).toMatchObject({ status: 'uncertain', dimension: 'deliverables' });
    expect(by['fact:f2']).toMatchObject({ status: 'missing', os: null });
    expect(comparisonCounts(rows)).toEqual({ conflicting: 0, uncertain: 1, missing: 1, additional: 1, aligned: 1 });
  });

  it('linha do pacote é alinhada pelo vínculo ao fato; retirada vira "faltando"', () => {
    const rows = buildServiceOrderComparison({
      items: [
        item({ id: 'p1', origin: 'proposal_package', source_document_kind: 'TECHNICAL_PROPOSAL', source_fact_id: 'f1', title: 'Outro título' }),
        item({ id: 'p2', kind: 'EXCLUSION', origin: 'proposal_package', source_document_kind: 'TECHNICAL_PROPOSAL', source_fact_id: 'f2',
          confirmation_state: 'REJECTED' }),
      ],
      facts: [fact({ id: 'f1' }), fact({ id: 'f2', fact_domain: 'EXCLUSION', label: 'Obras civis' })],
      divergences: [], authorizedValue: null, currency: 'BRL',
    });
    expect(rows.find((r) => r.itemId === 'p1')).toMatchObject({ status: 'aligned' });
    expect(rows.find((r) => r.itemId === 'p2')).toMatchObject({ status: 'missing', os: null, dimension: 'exclusions' });
    expect(rows.filter((r) => r.id.startsWith('fact:'))).toHaveLength(0); // nada duplicado
  });

  it('valor: igual ao aceito é alinhado; diferente é conflito; com divergência, só a divergência aparece', () => {
    const value = fact({ id: 'v', document_context: 'COMMERCIAL_PROPOSAL', fact_domain: 'VALUE', label: 'Valor global', value_numeric: '1250000', currency: 'BRL' });
    const equal = buildServiceOrderComparison({ items: [], facts: [value], divergences: [], authorizedValue: '1250000', currency: 'BRL' });
    expect(equal).toHaveLength(1);
    expect(equal[0]).toMatchObject({ status: 'aligned', dimension: 'commercial' });
    expect(equal[0].pc?.value).toMatch(/1\.250\.000,00/);
    const differ = buildServiceOrderComparison({ items: [], facts: [value], divergences: [], authorizedValue: '1300000', currency: 'BRL' });
    expect(differ[0]).toMatchObject({ status: 'conflicting' });
    const withDivergence = buildServiceOrderComparison({ items: [], facts: [value], divergences: [divergence({})], authorizedValue: '1300000', currency: 'BRL' });
    expect(withDivergence).toHaveLength(1);
    expect(withDivergence[0]).toMatchObject({ status: 'conflicting', divergenceId: 'd', severity: 'BLOCKING' });
    // Divergência de valor aparece em moeda e diz a diferença — não dois números crus.
    expect(withDivergence[0].os?.label).toMatch(/R\$\s?1\.300\.000,00/);
    expect(withDivergence[0].pc?.label).toMatch(/R\$\s?1\.250\.000,00/);
    expect(withDivergence[0].note).toMatch(/R\$\s?50\.000,00 acima \(\+4%\)/);
  });

  it('valor lido como "número MOEDA" aparece como moeda', () => {
    const rows = buildServiceOrderComparison({ items: [item({ kind: 'COMMERCIAL_REFERENCE', title: 'Valor global', detail: '3420000.0000 BRL',
      origin: 'proposal_package', source_fact_id: 'v' })], facts: [], divergences: [], authorizedValue: null, currency: 'BRL' });
    expect(rows[0].os?.value).toMatch(/R\$\s?3\.420\.000,00/);
  });

  it('divergência técnica compara com a PT; resolvida não entra; sem fatos não quebra', () => {
    const rows = buildServiceOrderComparison({
      items: [], facts: null, authorizedValue: null, currency: null,
      divergences: [
        divergence({ id: 'd1', scope: 'DATES', field_path: 'planned_finish', left_value: '2026-12-20', right_value: '2027-01-15', severity: 'WARNING' }),
        divergence({ id: 'd2', state: 'RESOLVED' }),
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ dimension: 'dates', status: 'conflicting', pc: null });
    expect(rows[0].pt?.label).toBe('2026-12-20');
  });
});
