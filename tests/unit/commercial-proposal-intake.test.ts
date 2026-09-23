import { describe, expect, it } from 'vitest';
import {
  buildIntakeFields, intakePayloads, intakeSummary, numberFromFileName, proposalNumberFor, slotFromFileName,
  type IntakeDocument, type IntakeFact,
} from '@/lib/commercial/proposal-intake';

const fact = (factDomain: string, over: Partial<IntakeFact> = {}): IntakeFact => ({
  factDomain, label: factDomain, valueText: null, valueNumeric: null, valueDate: null, currency: null,
  sourcePage: 2, provenanceState: 'ANCHORED', ...over,
});
const doc = (slot: IntakeDocument['slot'], fileName: string, facts: IntakeFact[], role?: string, rev?: number): IntakeDocument => ({
  slot, fileName, facts,
  classification: role ? { role, revisionLabel: rev ? `Rev. ${rev}` : null, revisionNumber: rev ?? null, title: 'Retrofit SE-04', page: 1 } : null,
});
const opp = { id: 'o1', title: 'Retrofit', counterparty_name: 'Acme', party_id: 'p1', currency: 'BRL' };
const byKey = (fields: ReturnType<typeof buildIntakeFields>, key: string) => fields.find((f) => f.key === key)!;

describe('proposal intake', () => {
  it('reads number and slot from the file name, never from the model', () => {
    expect(numberFromFileName('PC-2024-118 R02.pdf')).toBe('PC-2024-118');
    expect(numberFromFileName('PT_0457_rev3.pdf')).toBe('PT-0457');
    expect(numberFromFileName('proposta final.pdf')).toBeNull();
    expect(slotFromFileName('PT-0457.pdf')).toBe('PT');
    expect(slotFromFileName('Proposta Comercial.pdf')).toBe('PC');
    expect(slotFromFileName('arquivo.pdf')).toBeNull();
  });

  it('confirms customer and opportunity only from the canonical record', () => {
    const withOpp = buildIntakeFields([doc('PC', 'PC-1.pdf', [], 'COMMERCIAL_PROPOSAL', 1)], opp);
    expect(byKey(withOpp, 'counterparty_name')).toMatchObject({ state: 'confirmed', value: 'Acme' });
    const without = buildIntakeFields([doc('PC', 'PC-1.pdf', [], 'COMMERCIAL_PROPOSAL', 1)], null);
    expect(byKey(without, 'counterparty_name').state).toBe('missing');
    expect(byKey(without, 'opportunity_id').note).toMatch(/iniciar execução/);
  });

  it('marks two different values, a PT/PC revision mismatch and a role mismatch as conflicting', () => {
    const fields = buildIntakeFields([
      doc('PT', 'PT-9.pdf', [], 'COMMERCIAL_PROPOSAL', 2),
      doc('PC', 'PC-9.pdf', [fact('VALUE', { valueNumeric: 100, currency: 'BRL' }), fact('VALUE', { valueNumeric: 120, currency: 'BRL' })], 'COMMERCIAL_PROPOSAL', 3),
    ], opp);
    expect(byKey(fields, 'total_value').state).toBe('conflicting');
    expect(byKey(fields, 'total_value').options).toHaveLength(2);
    expect(byKey(fields, 'revision').state).toBe('conflicting');
    expect(byKey(fields, 'kind').state).toBe('conflicting');
    expect(intakeSummary(fields).blocking.map((f) => f.key)).toEqual(expect.arrayContaining(['total_value', 'kind']));
  });

  it('flags a document currency that differs from the opportunity', () => {
    const fields = buildIntakeFields([doc('PC', 'PC-1.pdf', [fact('VALUE', { valueNumeric: 10, currency: 'USD' })], 'COMMERCIAL_PROPOSAL')], opp);
    expect(byKey(fields, 'currency').state).toBe('conflicting');
  });

  it('keeps Apex readings as suggestions with their page', () => {
    const fields = buildIntakeFields([doc('PC', 'PC-1.pdf', [
      fact('VALUE', { valueNumeric: 5000, currency: 'BRL', sourcePage: 4 }),
      fact('VALIDITY', { valueDate: '2026-12-31' }),
      fact('PAYMENT_TERM', { valueText: '30/60/90 DDL' }),
    ], 'COMMERCIAL_PROPOSAL', 1)], opp);
    expect(byKey(fields, 'total_value')).toMatchObject({ state: 'suggested', value: '5000', source: 'Apex · p. 4' });
    expect(byKey(fields, 'validity_until')).toMatchObject({ state: 'suggested', value: '2026-12-31' });
    expect(byKey(fields, 'payment_terms').value).toBe('30/60/90 DDL');
    expect(byKey(fields, 'currency').state).toBe('confirmed');
  });

  it('creates PT without value and gives each sibling its own number', () => {
    const docs = [doc('PT', 'PT-0457.pdf', []), doc('PC', 'PC-0458.pdf', [])];
    const fields = buildIntakeFields(docs, opp).map((f) =>
      f.key === 'total_value' ? { ...f, value: '900' } : f.key === 'title' ? { ...f, value: 'T' } : f);
    const [pt, pc] = intakePayloads(fields, docs, { party_id: 'p1' });
    expect(pt.payload).toMatchObject({ kind: 'TECHNICAL', total_value: null, proposal_number: 'PT-0457', party_id: 'p1' });
    expect(pc.payload).toMatchObject({ kind: 'COMMERCIAL', total_value: '900', proposal_number: 'PC-0458' });
    const same = [doc('PT', 'arquivo.pdf', []), doc('PC', 'outro.pdf', [])];
    expect(proposalNumberFor(same[0], same, '118')).toBe('PT-118');
    expect(proposalNumberFor(same[1], same, '118')).toBe('PC-118');
  });
});
