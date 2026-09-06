import { describe, it, expect } from 'vitest';
import { resolveContractAsOf, type ContractAsOfInput, type ContractFact } from '@/lib/contracts/resolve-contract-as-of';
import type { ContractAmendmentRow, ContractClauseRow, ContractAmendmentClauseRow } from '@/lib/contracts/contract-service';
import { hasOfficialValue, type Official } from '@/lib/contracts/trust/trusted';
const read = <T>(v: Official<T>): T => { if (!hasOfficialValue(v)) throw new Error('Expected official value'); return v.value; };
const amendment = (id: string, date: string | null, extra = {}): ContractAmendmentRow => ({ id, organization_id: 'o', contract_id: 'c', amendment_number: id, status: 'active', effective_date: date, created_at: '2026-01-01', deleted_at: null, value_delta: null, value_absolute: null, term_extension_days: null, new_end_date: null, ...extra } as ContractAmendmentRow);
const clause = (id: string) => ({ id, organization_id: 'o', contract_id: 'c', content: id, review_status: 'validated' } as ContractClauseRow);
const link = (id: string, aid: string, from: string | null, to: string | null, effect: 'altered'|'added'|'removed' = 'altered') => ({ id, organization_id: 'o', amendment_id: aid, clause_id: from, replacement_clause_id: to, effect, created_at: '2026-01-01' } as ContractAmendmentClauseRow);
const fact = (id: string, extra: Partial<ContractFact> = {}): ContractFact => ({ id, organization_id: 'o', contract_id: 'c', title: id, source_page: null, source_amendment_id: null, source_clause_id: null, source_document_id: null, source_reference: 'section 1', effective_from: '2026-01-01', effective_until: null, predecessor_id: null, effect: 'added', created_at: '2026-01-01', created_by: null, ...extra });
const input = (extra: Partial<ContractAsOfInput> = {}): ContractAsOfInput => ({ contractId: 'c', organizationId: 'o', contracts: [{ id: 'c', organization_id: 'o', start_date: '2026-01-01', end_date: '2026-12-31', total_value: 100 } as never], amendments: [], clauses: [clause('original')], clauseLinks: [], lineage: [], guarantees: [], insuranceRequirements: [], indexationRules: [], billingConditions: [], measurementRequirements: [], ...extra });

describe('Contracts legal-time projection', () => {
  it('uses existing value and term arithmetic before, on, and after multiple amendments', () => {
    const data = input({ amendments: [amendment('a2', '2026-03-01', { value_absolute: 500, new_end_date: '2028-01-01' }), amendment('a1', '2026-02-01', { value_delta: 20, term_extension_days: 10 })] });
    expect(read(resolveContractAsOf(data, '2026-01-31').termValue.currentValue)).toBe(100);
    expect(read(resolveContractAsOf(data, '2026-02-01').termValue.currentValue)).toBe(120);
    const final = resolveContractAsOf(data, '2026-03-01');
    expect(read(final.termValue.currentValue)).toBe(500);
    expect(read(final.termValue.currentEndDate).getFullYear()).toBe(2028);
    expect(data.contracts[0].total_value).toBe(100);
  });
  it('chains replacement targets and removes only effective projection, preserving every historical text', () => {
    const data = input({ amendments: [amendment('a1', '2026-02-01'), amendment('a2', '2026-03-01'), amendment('a3', '2026-04-01')], clauses: [clause('original'), clause('v2'), clause('v3')], clauseLinks: [link('l3', 'a3', 'v3', null, 'removed'), link('l1', 'a1', 'original', 'v2'), link('l2', 'a2', 'v2', 'v3')] });
    const original = JSON.stringify(data);
    expect(read(resolveContractAsOf(data, '2026-01-31').clauses.effective).map(v => v.fact.id)).toEqual(['original']);
    expect(read(resolveContractAsOf(data, '2026-02-01').clauses.effective).map(v => v.fact.id)).toEqual(['v2']);
    expect(read(resolveContractAsOf(data, '2026-03-01').clauses.effective).map(v => v.fact.id)).toEqual(['v3']);
    const state = resolveContractAsOf(data, '2026-04-01');
    expect(read(state.clauses.effective)).toEqual([]);
    expect(state.clauses.history.map(c => c.content)).toEqual(['original','v2','v3']);
    expect(state.clauses.lineage[0].links).toHaveLength(3);
    expect(JSON.stringify(data)).toBe(original);
  });
  it('adds clauses only at effective date and keeps draft changes out', () => {
    const data = input({ amendments: [amendment('a', '2026-03-01')], clauses: [clause('original'),clause('added')], clauseLinks: [link('l', 'a', null, 'added', 'added')] });
    expect(read(resolveContractAsOf(data, '2026-02-01').clauses.effective)).toHaveLength(1);
    expect(read(resolveContractAsOf(data, '2026-03-01').clauses.effective)).toHaveLength(2);
    data.amendments = [amendment('a', '2026-03-01', { status: 'draft' })];
    expect(read(resolveContractAsOf(data, '2026-04-01').clauses.effective)).toHaveLength(1);
  });
  it('unknown dates contaminate affected dimensions without inventing a date', () => {
    const state = resolveContractAsOf(input({ amendments: [amendment('a', null, { value_delta: 50 })], clauseLinks: [link('l','a','original',null,'removed')], guarantees: [fact('g',{ effective_from: null })] }), '2026-05-01');
    expect(state.termValue.currentValue.trust).toBe('missing');
    expect(state.clauses.effective.trust).toBe('missing');
    expect(state.guarantees.effective.trust).toBe('missing');
    expect(hasOfficialValue(state.termValue.currentEndDate)).toBe(true);
  });
  it.each(['guarantees','insuranceRequirements','indexationRules','billingConditions','measurementRequirements'] as const)('projects immutable %s facts with overrides, removal and half-open periods', family => {
    const original = fact('f');
    const override = fact('v2',{ predecessor_id:'f', effect:'altered', effective_from:'2026-02-01', effective_until:'2026-04-01' });
    const data = input({ [family]: [override, original] });
    expect(read(resolveContractAsOf(data,'2026-01-31')[family].effective)[0].fact.id).toBe('f');
    expect(read(resolveContractAsOf(data,'2026-02-01')[family].effective)[0].fact.id).toBe('v2');
    expect(read(resolveContractAsOf(data,'2026-04-01')[family].effective)).toEqual([]);
    expect(resolveContractAsOf(data,'2026-04-01')[family].history).toHaveLength(2);
  });
  it('inherits the parent instrument without copying facts, and rejects ambiguous/cyclic parentage', () => {
    const base = input();
    const edge = { id:'e',organization_id:'o',contract_id:'child',amendment_id:null,root_contract_id:'c',parent_contract_id:'c',parent_amendment_id:null,lineage_type:'renewal' as const,effective_date:'2026-05-01',source_document_id:null,source_reference:null };
    const data = input({ contractId:'child', contracts:[...base.contracts,{ ...base.contracts[0],id:'child',total_value:null,end_date:null,start_date:'2026-05-01' }], lineage:[edge], guarantees:[fact('f')] });
    const state = resolveContractAsOf(data,'2026-05-01');
    expect(state.rootContractId).toBe('c');
    expect(read(state.termValue.currentValue)).toBe(100);
    expect(read(state.guarantees.effective)[0].reason).toBe('inherited');
    expect(resolveContractAsOf(data,'2026-04-01').guarantees.effective.trust).toBe('missing');
    expect(() => resolveContractAsOf({...data,lineage:[edge, {...edge,id:'e2'}]},'2026-05-01')).toThrow('Ambiguous');
    expect(() => resolveContractAsOf({...data,lineage:[edge,{...edge,id:'e2',contract_id:'c',parent_contract_id:'child'}]},'2026-05-01')).toThrow('cycle');
  });
  it('same-day arithmetic is independent of query ordering and rejects cross-org rows or invalid dates', () => {
    const a = amendment('a','2026-02-01',{ amendment_number:'same',value_absolute:200 });
    const b = amendment('b','2026-02-01',{ amendment_number:'same',value_delta:25 });
    expect(read(resolveContractAsOf(input({amendments:[b,a]}),'2026-02-01').termValue.currentValue)).toBe(225);
    expect(() => resolveContractAsOf(input({guarantees:[fact('f',{organization_id:'other'})]}),'2026-02-01')).toThrow('Cross-tenant');
    expect(() => resolveContractAsOf(input(),'2026-02-31')).toThrow('Invalid');
  });
  it('keeps missing requirements and draft clauses unknown, and rejects branched or cyclic fact histories', () => {
    const empty = resolveContractAsOf(input({ clauses: [{ ...clause('draft'), review_status: 'draft' }] }), '2026-02-01');
    expect(empty.guarantees.effective.trust).toBe('missing');
    expect(empty.clauses.effective.trust).toBe('missing');
    const parent = fact('f');
    const v2 = fact('v2', { predecessor_id:'f',effect:'altered' });
    expect(() => resolveContractAsOf(input({guarantees:[parent,v2,fact('v3',{ predecessor_id:'f',effect:'altered' })]}),'2026-02-01')).toThrow('Ambiguous');
    expect(() => resolveContractAsOf(input({guarantees:[fact('self',{ predecessor_id:'self',effect:'altered' })]}),'2026-02-01')).toThrow('cycle');
  });
  it('an amendment-backed requirement waits for both explicit fact and instrument dates', () => {
    const data = input({amendments:[amendment('a','2026-03-01')],guarantees:[fact('f',{source_amendment_id:'a'})]});
    expect(read(resolveContractAsOf(data,'2026-02-01').guarantees.effective)).toEqual([]);
    expect(read(resolveContractAsOf(data,'2026-03-01').guarantees.effective)[0].sourceAmendmentId).toBe('a');
  });

  it.each(['guarantees','insuranceRequirements','indexationRules','billingConditions','measurementRequirements'] as const)('%s follows two amendments, retains removals, and rejects unknown dates', family => {
    const facts = [fact('f'),fact('v2',{ predecessor_id:'f',effect:'altered',source_amendment_id:'a1',effective_from:'2026-02-01' }),fact('v3',{ predecessor_id:'v2',effect:'removed',source_amendment_id:'a2',effective_from:'2026-03-01' })];
    const data = input({ amendments:[amendment('a2','2026-03-01'),amendment('a1','2026-02-01')], [family]:facts });
    expect(read(resolveContractAsOf(data,'2026-01-31')[family].effective)[0].fact.id).toBe('f');
    expect(read(resolveContractAsOf(data,'2026-02-01')[family].effective)[0].fact.id).toBe('v2');
    const state = resolveContractAsOf(data,'2026-03-01')[family];
    expect(read(state.effective)).toEqual([]);
    expect(state.history).toHaveLength(3);
    data[family] = [fact('undated',{ effective_from:null })];
    expect(resolveContractAsOf(data,'2026-03-01')[family].effective.trust).toBe('missing');
  });
  it('child fact overrides an inherited fact only after the renewal is effective; undated renewal remains unknown', () => {
    const base = input();
    const edge = { id:'e',organization_id:'o',contract_id:'child',amendment_id:null,root_contract_id:'c',parent_contract_id:'c',parent_amendment_id:null,lineage_type:'renewal' as const,effective_date:'2026-05-01',source_document_id:null,source_reference:null };
    const data = input({ contractId:'child',contracts:[...base.contracts,{ ...base.contracts[0],id:'child',start_date:'2026-05-01',total_value:null,end_date:null }],lineage:[edge],guarantees:[fact('f'),fact('child-f',{contract_id:'child',predecessor_id:'f',effect:'altered',effective_from:'2026-05-01'})] });
    expect(read(resolveContractAsOf(data,'2026-05-01').guarantees.effective).map(v => v.fact.id)).toEqual(['child-f']);
    expect(resolveContractAsOf({...data,lineage:[{...edge,effective_date:null}]},'2026-05-01').guarantees.effective.trust).toBe('missing');
  });

});
