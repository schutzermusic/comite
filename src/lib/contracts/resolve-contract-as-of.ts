/** Contracts legal-time projection. Input rows remain historical records; no writes or date inference. */
import type { ContractRow, ContractClauseRow, ContractAmendmentRow, ContractAmendmentClauseRow } from './contract-service';
import { effectiveContractState, isAmendmentInForce, orderAmendments } from './trust/amendments';
import { live, derived, missing, type Official, type LiveSource } from './trust/trusted';

export type ContractFact = {
  id: string; organization_id: string; contract_id: string;
  title: string; source_page: number | null;
  source_amendment_id: string | null; source_clause_id: string | null;
  source_document_id: string | null; source_reference: string | null;
  effective_from: string | null; effective_until: string | null;
  predecessor_id: string | null; effect: 'added' | 'altered' | 'removed';
  created_at: string; created_by: string | null;
};
type ContractNumeric = number | string | null;
export type ContractGuaranteeRow = ContractFact & {
  guarantee_type: string | null; required_amount: ContractNumeric; required_percentage: ContractNumeric;
  percentage_basis: string | null; currency: string | null; issuer_party_id: string | null;
  beneficiary_party_id: string | null; validity_start: string | null; validity_end: string | null;
  renewal_required: boolean | null; evidence_document_id: string | null;
};
export type ContractInsuranceRequirementRow = ContractFact & {
  insurance_type: string | null; required_coverage: ContractNumeric; currency: string | null;
  insured_party_id: string | null; insurer_party_id: string | null; policy_required: boolean | null;
  validity_requirement: string | null;
};
export type ContractIndexationRuleRow = ContractFact & {
  indexer: string | null; base_date: string | null; periodicity_months: number | null;
  anniversary_rule: string | null; formula: string | null; lag_months: number | null;
  floor_percentage: ContractNumeric; cap_percentage: ContractNumeric;
};
export type ContractBillingConditionRow = ContractFact & {
  condition_type: 'milestone_reached' | 'measurement_accepted' | 'service_report_required' |
    'evidence_required' | 'technical_acceptance_required' | 'customer_approval_required' |
    'specific_document_required' | 'elapsed_contractual_period' | 'contractual_event' | null;
  requirement_text: string | null; milestone_id: string | null; responsible_party_id: string | null;
  required_document_type: string | null; elapsed_period_days: number | null;
};
export type ContractMeasurementRequirementRow = ContractFact & {
  report_required: boolean | null; report_type: string | null; required_document_type: string | null;
  technical_report_required: boolean | null; tests_inspection_required: boolean | null;
  evidence_required: boolean | null; customer_acceptance_required: boolean | null;
  responsible_party_id: string | null; annex_reference: string | null; applicability: string | null;
  billing_condition_id: string | null; milestone_id: string | null;
};
export type ContractInstrumentLineageRow = {
  id: string; organization_id: string; contract_id: string; amendment_id: string | null;
  root_contract_id: string; parent_contract_id: string; parent_amendment_id: string | null;
  lineage_type: 'amendment' | 'renewal' | 'extension'; effective_date: string | null;
  source_document_id: string | null; source_reference: string | null;
};
export type FactReason = 'original' | 'inherited' | 'added' | 'altered' | 'removed';
export type EffectiveFact<T> = {
  fact: T; reason: FactReason; sourceContractId: string; sourceAmendmentId: string | null;
  effectiveDate: string | null;
};
export type FactProjection<T> = { history: readonly T[]; effective: Official<readonly EffectiveFact<T>[]> };
export type ClauseVersion = {
  clause: ContractClauseRow; links: readonly ContractAmendmentClauseRow[];
  effectiveClauseId: string | null; reason: FactReason;
  sourceAmendmentId: string | null; effectiveDate: string | null;
};
export type ContractAsOfInput = {
  contractId: string; organizationId: string;
  contracts: readonly ContractRow[]; amendments: readonly ContractAmendmentRow[];
  clauses: readonly ContractClauseRow[]; clauseLinks: readonly ContractAmendmentClauseRow[];
  lineage: readonly ContractInstrumentLineageRow[];
  guarantees: readonly ContractFact[]; insuranceRequirements: readonly ContractFact[];
  indexationRules: readonly ContractFact[]; billingConditions: readonly ContractFact[];
  measurementRequirements: readonly ContractFact[];
};
export function assertContractDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
    throw new Error('Invalid Contracts asOf date');
  }
}
const localDate = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00`);

export function resolveContractAsOf(input: ContractAsOfInput, asOf: string) {
  assertContractDate(asOf);
  const contractMap = new Map(input.contracts.map(c => [c.id, c]));
  const target = contractMap.get(input.contractId);
  if (!target || target.organization_id !== input.organizationId) throw new Error('Contract ownership is unclear');
  for (const rows of [input.contracts, input.amendments, input.clauses, input.clauseLinks, input.lineage, input.guarantees, input.insuranceRequirements, input.indexationRules, input.billingConditions, input.measurementRequirements]) {
    if (rows.some(row => row.organization_id !== input.organizationId)) throw new Error('Cross-tenant Contracts projection');
  }
  const chain: ContractRow[] = [];
  const relationships: ContractInstrumentLineageRow[] = [];
  const visited = new Set<string>();
  let cursor: ContractRow | undefined = target;
  while (cursor) {
    if (visited.has(cursor.id)) throw new Error('Contract lineage cycle');
    visited.add(cursor.id); chain.unshift(cursor);
    const parents = input.lineage.filter(l => l.contract_id === cursor!.id && l.amendment_id === null);
    if (parents.length > 1) throw new Error('Ambiguous contract parentage');
    const parent = parents[0];
    if (!parent) break;
    if (parent.parent_contract_id === cursor.id) throw new Error('Contract lineage self-reference');
    relationships.unshift(parent);
    cursor = contractMap.get(parent.parent_contract_id);
    if (!cursor) throw new Error('Missing parent contract');
  }
  if (relationships.some(l => l.root_contract_id !== chain[0].id)) throw new Error('Inconsistent contract lineage root');
  const scope = new Set(chain.map(c => c.id));
  const lineageUnknown = relationships.some(l => l.effective_date === null);
  const lineageFuture = relationships.some(l => l.effective_date !== null && l.effective_date > asOf);
  const lineageUnavailable = lineageUnknown || lineageFuture;
  const amendments = orderAmendments(input.amendments.filter(a => scope.has(a.contract_id)));
  const amendmentMap = new Map(amendments.map(a => [a.id, a]));
  const position = new Map(amendments.map((a, i) => [a.id, i]));
  const force = (id: string | null) => id === null || (!!amendmentMap.get(id) && isAmendmentInForce(amendmentMap.get(id)!));
  const effectiveDate = (fact: ContractFact) => {
    const amendment = fact.source_amendment_id ? amendmentMap.get(fact.source_amendment_id) : null;
    // Both the instrument and the fact must be effective. Neither date is inferred.
    if (fact.source_amendment_id && !amendment) throw new Error('Missing source amendment');
    if (amendment && amendment.effective_date === null) return null;
    if (fact.effective_from === null) return null;
    return amendment?.effective_date && amendment.effective_date > fact.effective_from ? amendment.effective_date : fact.effective_from;
  };
  const projectFacts = <T extends ContractFact>(rows: readonly T[], source: LiveSource): FactProjection<T> => {
    const history = rows.filter(r => scope.has(r.contract_id));
    if (!history.length) return { history, effective: missing('no-rows', 'requisitos contratuais não registrados') };
    const byId = new Map(history.map(r => [r.id, r]));
    const successors = new Set<string>();
    for (const row of history) {
      const seen = new Set<string>();
      let ancestor: T | undefined = row;
      while (ancestor?.predecessor_id) {
        if (seen.has(ancestor.id)) throw new Error('Fact lineage cycle');
        seen.add(ancestor.id); ancestor = byId.get(ancestor.predecessor_id);
      }
      if (!row.predecessor_id) continue;
      if (successors.has(row.predecessor_id)) throw new Error('Ambiguous fact successors');
      successors.add(row.predecessor_id);
      const parent = byId.get(row.predecessor_id);
      const parentDate = parent ? effectiveDate(parent) : null;
      const rowDate = effectiveDate(row);
      if (parentDate && rowDate && parentDate > rowDate) throw new Error('Fact predecessor effective after successor');
    }
    for (const row of history) if (row.predecessor_id && !byId.has(row.predecessor_id)) throw new Error('Missing predecessor fact');
    const ordered = [...history].sort((a, b) => {
      const depth = (f: T) => { const seen = new Set<string>(); let n = 0; let p: T | undefined = f; while (p?.predecessor_id) { if (seen.has(p.id)) throw new Error('Fact lineage cycle'); seen.add(p.id); p = byId.get(p.predecessor_id); n++; } return n; };
      return (effectiveDate(a) ?? '9999').localeCompare(effectiveDate(b) ?? '9999') || depth(a) - depth(b) || (position.get(a.source_amendment_id ?? '') ?? -1) - (position.get(b.source_amendment_id ?? '') ?? -1) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
    });
    if (lineageUnavailable || ordered.some(r => force(r.source_amendment_id) && effectiveDate(r) === null && (!r.effective_until || r.effective_until > asOf))) {
      return { history, effective: missing('not-comparable', 'vigência contratual não determinada na data consultada') };
    }
    const effective = new Map<string, EffectiveFact<T>>();
    const roots = new Map<string, string>();
    for (const fact of ordered) {
      const root = fact.predecessor_id ? roots.get(fact.predecessor_id) ?? fact.predecessor_id : fact.id;
      roots.set(fact.id, root);
      const date = effectiveDate(fact);
      if (!force(fact.source_amendment_id) || !date || date > asOf) continue;
      // Periods are [effective_from, effective_until). Expired overrides do not revive predecessors.
      effective.delete(root);
      if (fact.effect === 'removed' || (fact.effective_until !== null && fact.effective_until <= asOf)) continue;
      effective.set(root, { fact, reason: fact.contract_id !== target.id ? 'inherited' : fact.predecessor_id ? fact.effect : fact.source_amendment_id ? 'added' : 'original', sourceContractId: fact.contract_id, sourceAmendmentId: fact.source_amendment_id, effectiveDate: date });
    }
    return { history, effective: derived([...effective.values()], { rule: `fatos contratuais vigentes em ${asOf}; períodos [início, fim)`, from: [source] }) };
  };

  const clauses = input.clauses.filter(c => scope.has(c.contract_id));
  const clauseMap = new Map(clauses.map(c => [c.id, c]));
  const links = input.clauseLinks.filter(l => amendmentMap.has(l.amendment_id)).sort((a,b) => (position.get(a.amendment_id) ?? 0) - (position.get(b.amendment_id) ?? 0) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const introduced = new Set(links.flatMap(l => [l.replacement_clause_id, l.effect === 'added' ? l.clause_id : null].filter((v): v is string => !!v)));
  const versions = new Map<string, ClauseVersion>();
  const roots = new Map<string, string>();
  for (const clause of clauses) if (!introduced.has(clause.id)) {
    roots.set(clause.id, clause.id);
    versions.set(clause.id, { clause, links: [], effectiveClauseId: clause.id, reason: clause.contract_id === target.id ? 'original' : 'inherited', sourceAmendmentId: null, effectiveDate: contractMap.get(clause.contract_id)?.start_date ?? null });
  }
  let clauseUnknown = lineageUnavailable || clauses.length === 0 || [...versions.values()].some(v => v.effectiveDate === null);
  for (const link of links) {
    const a = amendmentMap.get(link.amendment_id)!;
    if (link.effect !== 'added' && link.clause_id && introduced.has(link.clause_id) && !roots.has(link.clause_id)) throw new Error('Clause successor precedes its originating relationship');
    const introducedId = link.replacement_clause_id ?? (link.effect === 'added' ? link.clause_id : null);
    const root = link.effect === 'added' ? introducedId : link.clause_id ? roots.get(link.clause_id) ?? link.clause_id : null;
    if (!root) { if (isAmendmentInForce(a) && (!a.effective_date || a.effective_date <= asOf)) clauseUnknown = true; continue; }
    if (introducedId) roots.set(introducedId, root);
    const prior = versions.get(root);
    const clause = prior?.clause ?? clauseMap.get(root);
    if (!clause) throw new Error('Missing historical clause');
    const next: ClauseVersion = prior ? { ...prior, links: [...prior.links, link] } : { clause, links: [link], effectiveClauseId: null, reason: 'added', sourceAmendmentId: a.id, effectiveDate: a.effective_date };
    if (isAmendmentInForce(a)) {
      if (!a.effective_date) clauseUnknown = true;
      else if (a.effective_date <= asOf) {
        if (introducedId && !clauseMap.has(introducedId)) throw new Error('Missing replacement clause');
        next.effectiveClauseId = link.effect === 'removed' ? null : introducedId ?? next.effectiveClauseId;
        next.reason = link.effect; next.sourceAmendmentId = a.id; next.effectiveDate = a.effective_date;
        if (link.effect === 'altered' && !introducedId) clauseUnknown = true;
      }
    }
    versions.set(root, next);
  }
  const clauseHistory = [...versions.values()];
  if (clauseHistory.some(v => v.effectiveClauseId && v.effectiveDate && v.effectiveDate <= asOf && clauseMap.get(v.effectiveClauseId)?.review_status !== 'validated')) clauseUnknown = true;
  const effectiveClauses: Official<readonly EffectiveFact<ContractClauseRow>[]> = clauseUnknown ? missing('not-comparable', 'vigência ou redação de cláusula não determinada') : derived(clauseHistory.filter(v => v.effectiveClauseId && v.effectiveDate && v.effectiveDate <= asOf).map(v => ({ fact: clauseMap.get(v.effectiveClauseId!)!, reason: v.reason, sourceContractId: clauseMap.get(v.effectiveClauseId!)!.contract_id, sourceAmendmentId: v.sourceAmendmentId, effectiveDate: v.effectiveDate })), { rule: `cláusulas vigentes em ${asOf}`, from: ['contract_clauses', 'contract_amendment_clauses', 'contract_amendments'] });

  // Reuse the existing authoritative amendment arithmetic, once for each inherited instrument.
  let originalValue: Official<number> = missing('no-rows');
  let originalEndDate: Official<Date> = missing('no-rows');
  let termValue = effectiveContractState(originalValue, originalEndDate, live([], 'contracts'), asOf);
  const inheritedTimeline: typeof termValue.timeline[number][] = [];
  for (const contract of chain) {
    const value = contract.total_value === null ? originalValue : live(Number(contract.total_value), 'contracts');
    const end = contract.end_date === null ? originalEndDate : live(localDate(contract.end_date), 'contracts');
    termValue = effectiveContractState(value, end, live(amendments.filter(a => a.contract_id === contract.id), 'contracts'), asOf);
    inheritedTimeline.push(...termValue.timeline);
    originalValue = termValue.currentValue; originalEndDate = termValue.currentEndDate;
  }
  termValue = { ...termValue, timeline: inheritedTimeline, unapplied: inheritedTimeline.filter(s => s.skipReason !== null), hasEffects: inheritedTimeline.some(s => s.applied) };
  const root = chain[0];
  termValue = { ...termValue, originalValue: root.total_value === null ? missing('no-rows') : live(Number(root.total_value), 'contracts'), originalEndDate: root.end_date === null ? missing('no-rows') : live(localDate(root.end_date), 'contracts') };
  if (lineageUnavailable || target.start_date === null || target.start_date > asOf) {
    termValue = { ...termValue, currentValue: missing('not-comparable', 'vigência do instrumento não determinada na data consultada'), currentEndDate: missing('not-comparable', 'vigência do instrumento não determinada na data consultada') };
  }
  return {
    contractId: target.id, rootContractId: chain[0].id, asOf, lineage: relationships,
    termValue, clauses: { history: clauses, lineage: clauseHistory, effective: effectiveClauses },
    guarantees: projectFacts(input.guarantees, 'contract_guarantees'), insuranceRequirements: projectFacts(input.insuranceRequirements, 'contract_insurance_requirements'),
    indexationRules: projectFacts(input.indexationRules, 'contract_indexation_rules'), billingConditions: projectFacts(input.billingConditions, 'contract_billing_conditions'),
    measurementRequirements: projectFacts(input.measurementRequirements, 'contract_measurement_requirements'),
  };
}
export type ContractAsOfState = ReturnType<typeof resolveContractAsOf>;
