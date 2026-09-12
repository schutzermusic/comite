/**
 * Regression proof for the CONTRACT_OPERATIONALIZATION compiled-grammar defect.
 *
 * The deployed operationalization schema was field-expanded per family and
 * measured:
 *
 *     26 union-typed parameters   (Anthropic's documented limit: 16)
 *      0 optional parameters
 *      6 object schemas
 *      5994 serialized bytes
 *
 * It is the same class of defect that failed in production for
 * CONTRACT_EXTRACTION (request req_011CexwaB6XrwPFHY8ybZdYD, HTTP 400 "The
 * compiled grammar is too large"), and worse: this one also exceeded the
 * EXPLICIT union cap, so the first real operationalization — triggered the
 * moment a human finalizes a contract — would have failed. It is fixed before
 * that happens.
 *
 * The fix is a PROVIDER TRANSPORT change only. This file proves the structural
 * simplification, the deterministic reconstruction into the unchanged canonical
 * domain model, and that no transport sentinel, malformed value or ambiguous
 * reading can acquire operational authority.
 *
 * NO live Anthropic calls are made in this file.
 */
import { describe, expect, it } from 'vitest';
import {
  OPERATIONALIZATION_SCHEMA,
  OPERATIONAL_ITEM_KINDS,
  OPERATIONAL_ATTRIBUTE_NAMES,
  ATTRIBUTES_BY_KIND,
  OperationalTransportError,
  normalizeCompactContractOperationalization,
  isCanonicalOperationalDate,
  evaluateOperationalTrust,
  MIN_OPERATIONAL_CONFIDENCE,
  RESPONSIBLE_SIDES,
  type OperationalItemKind,
  type OperationalAttributeName,
  type OperationalProviderItem,
} from '@/lib/ai/contract-operationalization';
import {
  countSchemaUnions,
  countOptionalParameters,
  countObjectSchemas,
  findObjectSchemas,
  maxObjectNestingDepth,
  schemaByteLength,
  ANTHROPIC_STRUCTURED_OUTPUT_LIMITS,
} from '@/lib/ai/gateway/schema-complexity';
import { CONTRACT_ONBOARDING_EXTRACTION_SCHEMA } from '@/lib/contracts/onboarding/document-first';
import { ApexAIGateway } from '@/lib/ai/gateway/apex-ai-gateway';
import { getApexAITaskPolicy } from '@/lib/ai/gateway/task-registry';
import { ApexAIError } from '@/lib/ai/gateway/errors';
import type { ApexAIAdapterRequest, ApexAIAdapterResponse, ApexAIProviderAdapter } from '@/lib/ai/gateway/types';
import { readFileSync } from 'node:fs';

/** Measured size of the field-expanded schema Anthropic would reject, frozen as a literal. */
const SCHEMA_BYTES_BEFORE = 5994;
const UNIONS_BEFORE = 26;

const EXCERPT = 'A CONTRATADA deverá apresentar o relatório mensal de medição.';

function item(
  kind: OperationalItemKind,
  attributes: Array<[OperationalAttributeName | string, string]>,
  overrides: Partial<OperationalProviderItem> = {},
): Record<string, unknown> {
  return {
    kind,
    title: 'Exigência contratual',
    attributes: attributes.map(([name, value]) => ({ name, value })),
    page: 7,
    excerpt: EXCERPT,
    confidence: 0.93,
    ambiguous: false,
    conflicting: false,
    ...overrides,
  };
}

const obligation = (
  attributes: Array<[OperationalAttributeName | string, string]> = [],
  overrides: Partial<OperationalProviderItem> = {},
) => item('obligation', [
  ['requirement_text', 'Apresentar o relatório mensal de medição.'],
  ['responsible_side', 'contracting_organization'],
  ...attributes,
], overrides);

const normalize = (items: unknown[], pageCount: number | null = 50) =>
  normalizeCompactContractOperationalization({ items }, pageCount);

// ═══════════════════════════════════════════════════════════════════════════
// 1 · The compiled grammar is small
// ═══════════════════════════════════════════════════════════════════════════

describe('1 · compact provider grammar', () => {
  it('carries no union-typed parameter at all (was 26, limit 16)', () => {
    expect(UNIONS_BEFORE).toBeGreaterThan(ANTHROPIC_STRUCTURED_OUTPUT_LIMITS.maxUnionTypedParameters);
    expect(countSchemaUnions(OPERATIONALIZATION_SCHEMA)).toBe(0);
    expect(countSchemaUnions(OPERATIONALIZATION_SCHEMA))
      .toBeLessThanOrEqual(ANTHROPIC_STRUCTURED_OUTPUT_LIMITS.maxUnionTypedParameters);
  });

  it('carries no optional parameter (limit 24)', () => {
    expect(countOptionalParameters(OPERATIONALIZATION_SCHEMA)).toBe(0);
    expect(countOptionalParameters(OPERATIONALIZATION_SCHEMA))
      .toBeLessThanOrEqual(ANTHROPIC_STRUCTURED_OUTPUT_LIMITS.maxOptionalParameters);
  });

  it('reuses ONE generic item schema instead of one object per family', () => {
    // root + generic item + generic attribute. No per-family object schema.
    expect(countObjectSchemas(OPERATIONALIZATION_SCHEMA)).toBe(3);
    const paths = findObjectSchemas(OPERATIONALIZATION_SCHEMA).map((f) => f.path);
    expect(paths).toEqual([
      '$',
      '$.properties.items.items',
      '$.properties.items.items.properties.attributes.items',
    ]);
    for (const family of ['obligations', 'billing_conditions', 'guarantees', 'insurance_requirements', 'indexation_rules']) {
      expect(paths.some((path) => path.includes(family))).toBe(false);
    }
  });

  it('is materially smaller than the schema that would be rejected', () => {
    const after = schemaByteLength(OPERATIONALIZATION_SCHEMA);
    expect(after).toBeLessThan(SCHEMA_BYTES_BEFORE / 2);
    expect(maxObjectNestingDepth(OPERATIONALIZATION_SCHEMA)).toBeLessThanOrEqual(3);
  });

  it('uses no minimum/maximum keyword — bounds are runtime, not provider-side', () => {
    const serialized = JSON.stringify(OPERATIONALIZATION_SCHEMA);
    expect(serialized).not.toContain('"minimum"');
    expect(serialized).not.toContain('"maximum"');
    expect(serialized).not.toContain('"anyOf"');
    expect(serialized).not.toContain('"oneOf"');
  });

  it('closes both vocabularies: kinds and attribute names', () => {
    const items = (OPERATIONALIZATION_SCHEMA.properties as Record<string, { items: Record<string, unknown> }>).items.items;
    const properties = items.properties as Record<string, Record<string, unknown>>;
    expect(properties.kind.enum).toEqual([...OPERATIONAL_ITEM_KINDS]);
    const attribute = (properties.attributes as { items: { properties: Record<string, Record<string, unknown>> } }).items;
    expect(attribute.properties.name.enum).toEqual([...OPERATIONAL_ATTRIBUTE_NAMES]);
    // Every transported value is a single type: this is what removes the unions.
    expect(attribute.properties.value).toEqual({ type: 'string' });
  });

  it('invents no category outside the existing canonical families', () => {
    expect([...OPERATIONAL_ITEM_KINDS]).toEqual([
      'obligation', 'billing_condition', 'guarantee', 'insurance_requirement', 'indexation_rule',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · Deterministic reconstruction into the unchanged canonical model
// ═══════════════════════════════════════════════════════════════════════════

describe('2 · canonical reconstruction', () => {
  it('rebuilds an obligation with every canonical field', () => {
    const { accepted, rejected } = normalize([obligation([
      ['category', 'medição'],
      ['activation_kind', 'days_after_contract_start'],
      ['activation_offset_days', '30'],
      ['due_kind', 'days_after_activation'],
      ['due_offset_days', '10'],
      ['calendar_basis', 'business_days'],
      ['recurrence_kind', 'monthly'],
      ['blocks_billing', 'true'],
    ])]);
    expect(rejected).toEqual([]);
    expect(accepted.obligations).toHaveLength(1);
    expect(accepted.obligations[0]).toMatchObject({
      title: 'Exigência contratual',
      requirement_text: 'Apresentar o relatório mensal de medição.',
      category: 'medição',
      responsible_side: 'contracting_organization',
      activation_kind: 'days_after_contract_start',
      activation_offset_days: 30,
      due_kind: 'days_after_activation',
      due_offset_days: 10,
      calendar_basis: 'business_days',
      recurrence_kind: 'monthly',
      blocks_billing: true,
      source_page: 7,
      source_excerpt: EXCERPT,
      confidence: 0.93,
    });
  });

  it('rebuilds a billing condition', () => {
    const { accepted } = normalize([item('billing_condition', [
      ['condition_type', 'measurement_accepted'],
      ['requirement_text', 'Faturamento condicionado ao aceite da medição.'],
      ['required_document_type', 'boletim de medição'],
      ['elapsed_period_days', '30'],
    ])]);
    expect(accepted.billing_conditions[0]).toMatchObject({
      condition_type: 'measurement_accepted',
      requirement_text: 'Faturamento condicionado ao aceite da medição.',
      required_document_type: 'boletim de medição',
      elapsed_period_days: 30,
      source_page: 7,
    });
  });

  it('rebuilds a guarantee, keeping percentage and its basis together', () => {
    const { accepted } = normalize([item('guarantee', [
      ['guarantee_type', 'seguro-garantia'],
      ['required_percentage', '5'],
      ['percentage_basis', 'valor total do contrato'],
      ['renewal_required', 'true'],
    ])]);
    expect(accepted.guarantees[0]).toMatchObject({
      guarantee_type: 'seguro-garantia',
      required_amount: null,
      required_percentage: 5,
      percentage_basis: 'valor total do contrato',
      renewal_required: true,
    });
  });

  it('rebuilds a fixed-amount guarantee and still refuses an ambiguous both-filled reading', () => {
    const { accepted } = normalize([item('guarantee', [['required_amount', '100000.50']])]);
    expect(accepted.guarantees[0]).toMatchObject({ required_amount: 100000.5, required_percentage: null });

    const both = normalize([item('guarantee', [
      ['required_amount', '100000'], ['required_percentage', '5'], ['percentage_basis', 'valor total'],
    ])]);
    expect(both.accepted.guarantees).toHaveLength(0);
    expect(both.rejected[0].reason).toMatch(/valor e percentual/);
  });

  it('rebuilds an insurance requirement', () => {
    const { accepted } = normalize([item('insurance_requirement', [
      ['insurance_type', 'responsabilidade civil'],
      ['required_coverage', '250000'],
      ['policy_required', 'true'],
      ['validity_requirement', 'vigente durante todo o contrato'],
    ])]);
    expect(accepted.insurance_requirements[0]).toMatchObject({
      insurance_type: 'responsabilidade civil',
      required_coverage: 250000,
      policy_required: true,
      validity_requirement: 'vigente durante todo o contrato',
    });
  });

  it('rebuilds an indexation rule', () => {
    const { accepted } = normalize([item('indexation_rule', [
      ['indexer', 'IPCA'], ['periodicity_months', '12'],
      ['anniversary_rule', 'aniversário do contrato'], ['lag_months', '2'],
    ])]);
    expect(accepted.indexation_rules[0]).toMatchObject({
      indexer: 'IPCA', periodicity_months: 12, anniversary_rule: 'aniversário do contrato', lag_months: 2,
    });
  });

  it('an empty item list is a legitimate reading, not a failure', () => {
    const { accepted, rejected } = normalize([]);
    expect(rejected).toEqual([]);
    expect(accepted).toEqual({
      obligations: [], billing_conditions: [], guarantees: [],
      insurance_requirements: [], indexation_rules: [],
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · Party responsibility never collapses onto the contracting organization
// ═══════════════════════════════════════════════════════════════════════════

describe('3 · bilateral and multilateral obligations', () => {
  it('preserves every responsible side the domain knows', () => {
    for (const side of RESPONSIBLE_SIDES) {
      const { accepted } = normalize([item('obligation', [
        ['requirement_text', 'Cumprir a exigência contratual descrita.'],
        ['responsible_side', side],
      ])]);
      expect(accepted.obligations[0].responsible_side).toBe(side);
    }
  });

  it('an obligation of the client stays the client’s', () => {
    const { accepted } = normalize([item('obligation', [
      ['requirement_text', 'A CONTRATANTE deverá aprovar a medição em 10 dias.'],
      ['responsible_side', 'counterparty'],
    ])]);
    expect(accepted.obligations[0].responsible_side).toBe('counterparty');
  });

  it('an undeclared responsibility becomes unknown, never the contracting organization', () => {
    const { accepted } = normalize([item('obligation', [
      ['requirement_text', 'Manter o seguro vigente durante o contrato.'],
    ])]);
    expect(accepted.obligations[0].responsible_side).toBe('unknown');
    expect(accepted.obligations[0].responsible_side).not.toBe('contracting_organization');
  });

  it('an out-of-domain responsible side is refused, not defaulted', () => {
    const { accepted, rejected } = normalize([item('obligation', [
      ['requirement_text', 'Cumprir a exigência contratual descrita.'],
      ['responsible_side', 'insight'],
    ])]);
    expect(accepted.obligations).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/responsible_side.*vocabulário/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · UNKNOWN stays UNKNOWN
// ═══════════════════════════════════════════════════════════════════════════

describe('4 · unknown semantics survive the transport', () => {
  it('an omitted blocks_billing is null, never false', () => {
    const { accepted } = normalize([obligation()]);
    expect(accepted.obligations[0].blocks_billing).toBeNull();
  });

  it('an empty-string sentinel is absence, not a value', () => {
    const { accepted } = normalize([obligation([['category', ''], ['blocks_billing', '']])]);
    expect(accepted.obligations[0].category).toBeNull();
    expect(accepted.obligations[0].blocks_billing).toBeNull();
  });

  it('an explicit "false" is preserved as an explicit contractual statement', () => {
    const { accepted } = normalize([obligation([['blocks_billing', 'false']])]);
    expect(accepted.obligations[0].blocks_billing).toBe(false);
  });

  it('a billing condition states the REQUIREMENT and never that it was met', () => {
    const { accepted } = normalize([item('billing_condition', [
      ['condition_type', 'measurement_accepted'],
      ['requirement_text', 'Faturamento condicionado ao aceite da medição.'],
    ])]);
    const condition = accepted.billing_conditions[0] as unknown as Record<string, unknown>;
    expect(condition.elapsed_period_days).toBeNull();
    expect(condition.required_document_type).toBeNull();
    for (const fabricated of [
      'measured', 'measured_at', 'accepted_at', 'invoice_issued', 'invoice_number',
      'receivable_id', 'paid_at', 'reconciled_at', 'settled',
    ]) {
      expect(condition).not.toHaveProperty(fabricated);
    }
  });

  it('the transport has no vocabulary for real-world execution having happened', () => {
    for (const forbidden of [
      'measured_at', 'accepted_at', 'invoice_issued', 'invoice_number', 'receivable',
      'paid_at', 'payment_received', 'reconciled', 'settlement',
    ]) {
      expect(OPERATIONAL_ATTRIBUTE_NAMES as string[]).not.toContain(forbidden);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · Evidence and provenance
// ═══════════════════════════════════════════════════════════════════════════

describe('5 · documentary evidence is preserved and never fabricated', () => {
  it('page, excerpt and confidence travel through to the canonical item', () => {
    const { accepted } = normalize([obligation([], { page: 12, excerpt: EXCERPT, confidence: 0.81 })]);
    expect(accepted.obligations[0]).toMatchObject({ source_page: 12, source_excerpt: EXCERPT, confidence: 0.81 });
  });

  it('the page-0 / empty-excerpt absence sentinel can never become an accepted fact', () => {
    const { accepted, rejected } = normalize([obligation([], { page: 0, excerpt: '', confidence: 0.9 })]);
    expect(accepted.obligations).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatch(/sem trecho de origem/);
  });

  it('a page beyond the document is a fabricated reading', () => {
    const { accepted, rejected } = normalize([obligation([], { page: 999 })], 50);
    expect(accepted.obligations).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/além do documento/);
  });

  it('an excerpt too short to check is refused', () => {
    const { accepted } = normalize([obligation([], { excerpt: 'relatório' })]);
    expect(accepted.obligations).toHaveLength(0);
  });

  it('confidence must be a finite number inside 0..1 — checked in runtime, not by the schema', () => {
    for (const confidence of [1.5, -0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { accepted, rejected } = normalize([obligation([], { confidence })]);
      expect(accepted.obligations).toHaveLength(0);
      expect(rejected[0].reason).toMatch(/confiança fora de 0\.\.1/);
    }
    const ok = normalize([obligation([], { confidence: 1 })]);
    expect(ok.accepted.obligations).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · Trust: ambiguity can never become authority
// ═══════════════════════════════════════════════════════════════════════════

describe('6 · trust gate', () => {
  it('an ambiguous reading is retained but cannot be authoritative', () => {
    const { accepted } = normalize([obligation([], { ambiguous: true, confidence: 0.99 })]);
    const item = accepted.obligations[0];
    expect(item.confidence).toBe(0);
    const decision = evaluateOperationalTrust('obligations', item as unknown as { confidence: number });
    expect(decision.state).toBe('requires_attention');
    expect(decision.reasons).toContain('low_confidence');
  });

  it('a conflicting reading is treated the same way', () => {
    const { accepted } = normalize([obligation([], { conflicting: true, confidence: 0.99 })]);
    expect(accepted.obligations[0].confidence).toBe(0);
    expect(evaluateOperationalTrust('obligations', accepted.obligations[0] as unknown as { confidence: number }).state)
      .toBe('requires_attention');
  });

  it('the existing task confidence threshold is unchanged', () => {
    expect(MIN_OPERATIONAL_CONFIDENCE).toBe(0.75);
    const below = normalize([obligation([], { confidence: 0.5 })]);
    expect(evaluateOperationalTrust('obligations', below.accepted.obligations[0] as unknown as { confidence: number }).state)
      .toBe('requires_attention');
    const above = normalize([obligation([], { confidence: 0.9 })]);
    expect(evaluateOperationalTrust('obligations', above.accepted.obligations[0] as unknown as { confidence: number }).state)
      .toBe('automatic');
  });

  it('a material financial exposure still requires attention after reconstruction', () => {
    const { accepted } = normalize([item('guarantee', [['required_amount', '100000']])]);
    expect(evaluateOperationalTrust('guarantees', accepted.guarantees[0] as unknown as { confidence: number } & Record<string, unknown>).reasons)
      .toContain('material_financial_exposure');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7 · Malformed transport fails safe
// ═══════════════════════════════════════════════════════════════════════════

describe('7 · structural validation', () => {
  it('a response that is not the transport contract fails outright', () => {
    expect(() => normalizeCompactContractOperationalization(null, 10)).toThrow(OperationalTransportError);
    expect(() => normalizeCompactContractOperationalization('items', 10)).toThrow(OperationalTransportError);
    expect(() => normalizeCompactContractOperationalization({}, 10)).toThrow(OperationalTransportError);
    expect(() => normalizeCompactContractOperationalization({ items: 'none' }, 10)).toThrow(OperationalTransportError);
  });

  it('an unknown kind is refused, never bucketed by guesswork', () => {
    const { accepted, rejected } = normalize([item('risk' as OperationalItemKind, [])]);
    expect(Object.values(accepted).every((list) => list.length === 0)).toBe(true);
    expect(rejected[0]).toMatchObject({ family: 'transport' });
    expect(rejected[0].reason).toMatch(/categoria desconhecida/);
  });

  it('a malformed item is refused without taking its valid siblings down', () => {
    const { accepted, rejected } = normalize([
      obligation(),
      { kind: 'obligation', title: 'incompleto' },
      obligation([['category', 'seguro']]),
    ]);
    expect(accepted.obligations).toHaveLength(2);
    expect(rejected).toHaveLength(1);
  });

  it('an attribute from another family is corruption, not something to clean up', () => {
    const { accepted, rejected } = normalize([item('guarantee', [
      ['required_amount', '1000'], ['blocks_billing', 'true'],
    ])]);
    expect(accepted.guarantees).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/não pertence a guarantee/);
  });

  it('a duplicate attribute is refused instead of resolved by position', () => {
    const { accepted, rejected } = normalize([item('obligation', [
      ['requirement_text', 'Entregar o relatório mensal exigido.'],
      ['requirement_text', 'Entregar o relatório trimestral exigido.'],
    ])]);
    expect(accepted.obligations).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/atributo duplicado/);
  });

  it('an unknown attribute name is refused', () => {
    const { rejected } = normalize([obligation([['reviewed_by', 'Maria']])]);
    expect(rejected[0].reason).toMatch(/atributo desconhecido/);
  });

  it('a malformed monetary value never becomes a number', () => {
    for (const malformed of ['R$ 100.000,00', '100,000.00', '1e6', 'cem mil', '-100', 'NaN', 'Infinity']) {
      const { accepted, rejected } = normalize([item('guarantee', [['required_amount', malformed]])]);
      expect(accepted.guarantees, malformed).toHaveLength(0);
      expect(rejected[0].reason, malformed).toMatch(/required_amount/);
    }
    expect(normalize([item('guarantee', [['required_amount', '1500000.50']])]).accepted.guarantees[0].required_amount)
      .toBe(1500000.5);
  });

  it('a malformed date is never reinterpreted', () => {
    for (const malformed of ['15/10/2026', '2026-02-30', '2026-99-99', 'outubro de 2026', '2026-10']) {
      expect(isCanonicalOperationalDate(malformed), malformed).toBe(false);
      const { accepted, rejected } = normalize([obligation([
        ['due_kind', 'fixed_date'], ['due_fixed_date', malformed],
      ])]);
      expect(accepted.obligations, malformed).toHaveLength(0);
      expect(rejected[0].reason, malformed).toMatch(/due_fixed_date/);
    }
    expect(isCanonicalOperationalDate('2026-10-15')).toBe(true);
    expect(normalize([obligation([['due_kind', 'fixed_date'], ['due_fixed_date', '2026-10-15']])])
      .accepted.obligations[0].due_fixed_date).toBe('2026-10-15');
  });

  it('a non-canonical integer or boolean is refused', () => {
    expect(normalize([obligation([['due_kind', 'days_after_activation'], ['due_offset_days', '10 dias']])])
      .rejected[0].reason).toMatch(/inteiro canônico/);
    expect(normalize([obligation([['blocks_billing', 'sim']])]).rejected[0].reason).toMatch(/"true" nem "false"/);
  });

  it('an out-of-domain enum member is refused for every closed vocabulary', () => {
    const cases: Array<[OperationalItemKind, OperationalAttributeName]> = [
      ['obligation', 'activation_kind'], ['obligation', 'due_kind'], ['obligation', 'calendar_basis'],
      ['obligation', 'recurrence_kind'], ['obligation', 'schedule_anchor'], ['billing_condition', 'condition_type'],
    ];
    for (const [kind, name] of cases) {
      const { rejected } = normalize([item(kind, [
        ['requirement_text', 'Cumprir a exigência contratual descrita.'], [name, 'inventado'],
      ])]);
      expect(rejected[0].reason, name).toMatch(/fora do vocabulário/);
    }
  });

  it('every attribute belongs to exactly the families the canonical model has', () => {
    const declared = new Set(Object.values(ATTRIBUTES_BY_KIND).flat());
    expect([...declared].sort()).toEqual([...OPERATIONAL_ATTRIBUTE_NAMES].sort());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8 · Contract / Project boundary
// ═══════════════════════════════════════════════════════════════════════════

describe('8 · the schedule anchor stays a rule, never a date', () => {
  it('"5 dias úteis antes da medição" is transported as an anchored rule', () => {
    const { accepted } = normalize([obligation([
      ['due_kind', 'days_before_schedule_anchor'],
      ['schedule_anchor', 'measurement'],
      ['schedule_anchor_offset_days', '5'],
      ['calendar_basis', 'business_days'],
    ])]);
    expect(accepted.obligations[0]).toMatchObject({
      due_kind: 'days_before_schedule_anchor',
      schedule_anchor: 'measurement',
      schedule_anchor_offset_days: 5,
      calendar_basis: 'business_days',
      due_fixed_date: null,
      activation_fixed_date: null,
    });
  });

  it('an anchored rule without its offset is half a rule, and is refused', () => {
    const { accepted } = normalize([obligation([
      ['due_kind', 'days_before_schedule_anchor'], ['schedule_anchor', 'measurement'],
    ])]);
    expect(accepted.obligations).toHaveLength(0);
  });

  it('the transport cannot express a project event date at all', () => {
    for (const forbidden of [
      'measurement_date', 'project_start_date', 'project_end_date', 'milestone_date',
      'schedule_date', 'event_date',
    ]) {
      expect(OPERATIONAL_ATTRIBUTE_NAMES as string[]).not.toContain(forbidden);
    }
    // Only two date attributes exist, and both are contractual fixed dates.
    const dateAttributes = (OPERATIONAL_ATTRIBUTE_NAMES as string[]).filter((name) => name.endsWith('_date'));
    expect(dateAttributes).toEqual(['activation_fixed_date', 'due_fixed_date']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9 · Authority is never fabricated
// ═══════════════════════════════════════════════════════════════════════════

describe('9 · no human authority can be produced by the model', () => {
  it('the transport has no field for a human decision', () => {
    for (const forbidden of [
      'reviewed_by', 'approved_by', 'verified_by', 'assigned_by', 'confirmed_by',
      'responsible_user_id', 'reviewed_at', 'approved_at', 'verification_mode',
      'interpretation_state', 'trust_state',
    ]) {
      expect(OPERATIONAL_ATTRIBUTE_NAMES as string[]).not.toContain(forbidden);
      expect(JSON.stringify(OPERATIONALIZATION_SCHEMA)).not.toContain(forbidden);
    }
  });

  it('a reconstructed item carries only documentary facts', () => {
    const { accepted } = normalize([obligation()]);
    expect(Object.keys(accepted.obligations[0]).filter((key) => /_by$|_user_id$|reviewed|approved|verified/.test(key)))
      .toEqual([]);
  });

  it('the module still stamps AI provenance, not human provenance', () => {
    const source = readFileSync('src/lib/ai/contract-operationalization.ts', 'utf8');
    expect(source).toContain("ai_origin: 'apex_ai'");
    expect(source).not.toMatch(/reviewed_by:\s*[^n]/);
    expect(source).not.toMatch(/approved_by:/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10 · One call, one model, no fallback
// ═══════════════════════════════════════════════════════════════════════════

class StubAdapter implements ApexAIProviderAdapter {
  readonly provider = 'anthropic' as const;
  readonly capabilities = { structuredOutput: true, documentPdf: true, reasoningEffort: true, promptCache: true, streaming: true } as const;
  readonly calls: ApexAIAdapterRequest[] = [];
  isConfigured() { return true; }
  async generate(req: ApexAIAdapterRequest): Promise<ApexAIAdapterResponse> {
    this.calls.push(req);
    return { text: '{"items":[]}', stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 5 } };
  }
  normalizeError(e: unknown): ApexAIError {
    return e instanceof ApexAIError ? e : new ApexAIError('PROVIDER_ERROR', String(e), false);
  }
}

describe('10 · gateway routing is unchanged', () => {
  it('CONTRACT_OPERATIONALIZATION stays on claude-sonnet-5, no Opus, no fallback', () => {
    const policy = getApexAITaskPolicy('CONTRACT_OPERATIONALIZATION');
    expect(policy.provider).toBe('anthropic');
    expect(policy.model).toBe('claude-sonnet-5');
    expect(policy.fallbacks).toEqual([]);
    expect(policy.model.toLowerCase()).not.toContain('opus');
  });

  it('the compact schema reaches the adapter unchanged, in a SINGLE call', async () => {
    const stub = new StubAdapter();
    await new ApexAIGateway([stub]).generate({
      organizationId: 'org-operationalization-grammar-check',
      task: 'CONTRACT_OPERATIONALIZATION',
      userPrompt: 'x',
      structuredOutput: { name: 'contract_operationalization', schema: OPERATIONALIZATION_SCHEMA },
    });
    expect(stub.calls).toHaveLength(1);
    const schema = stub.calls[0].structuredOutput!.schema;
    expect(JSON.stringify(schema)).toBe(JSON.stringify(OPERATIONALIZATION_SCHEMA));
    expect(countSchemaUnions(schema)).toBe(0);
    expect(countOptionalParameters(schema)).toBe(0);
    expect(countObjectSchemas(schema)).toBe(3);
    expect(stub.calls[0].policy.model).toBe('claude-sonnet-5');
    expect(stub.calls[0].policy.provider).toBe('anthropic');
  });

  it('operationalization is still ONE gateway call, not one per family', () => {
    const source = readFileSync('src/lib/ai/contract-operationalization.ts', 'utf8');
    expect(source.match(/getApexAIGateway\(\)\.generate\(/g)).toHaveLength(1);
    expect(source.match(/task: 'CONTRACT_OPERATIONALIZATION'/g)).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11 · The CONTRACT_EXTRACTION fix is not regressed
// ═══════════════════════════════════════════════════════════════════════════

describe('11 · the onboarding compact schema stays fixed', () => {
  it('CONTRACT_EXTRACTION keeps 0 unions, 1 generic fact schema and its small size', () => {
    expect(countSchemaUnions(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA)).toBe(0);
    expect(countOptionalParameters(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA)).toBe(0);
    expect(countObjectSchemas(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA)).toBe(2);
    expect(schemaByteLength(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA)).toBeLessThan(1200);
  });

  it('CONTRACT_EXTRACTION routing is untouched', () => {
    const policy = getApexAITaskPolicy('CONTRACT_EXTRACTION');
    expect(policy.provider).toBe('anthropic');
    expect(policy.model).toBe('claude-sonnet-5');
    expect(policy.fallbacks).toEqual([]);
  });
});
