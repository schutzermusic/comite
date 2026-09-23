/**
 * Levantamento técnico, prontidão, comparação de propostas, fechamento e
 * sinais de fluxo — as regras puras da migration 213 e as cópias delas.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SURVEY_CHECKLIST, SURVEY_TRANSITIONS, digestSurvey, type SiteSurveyStatus,
} from '@/lib/commercial/site-survey';
import { evaluateProposalReadiness, type ReadinessInput } from '@/lib/commercial/proposal-readiness';
import {
  compareRevisions, crossCheckTechnicalCommercial, type FactLike, type RevisionLike,
} from '@/lib/commercial/proposal-compare';
import {
  buildExecutionStartPayload, validateExecutionStart, type ExecutionStartForm,
} from '@/lib/commercial/execution-start';
import { buildExecutionSignals } from '@/lib/commercial/execution-signals';
import { blueprintItemsFromFacts } from '@/lib/commercial/blueprint';

const SQL = readFileSync('supabase/migrations/213_commercial_discovery_and_execution_start.sql', 'utf8');

describe('site survey lifecycle', () => {
  it('mirrors the SQL transition table exactly', () => {
    const block = SQL.slice(SQL.indexOf("v_ok := CASE v_row.status"), SQL.indexOf('ELSE false END;'));
    const sql: Record<string, string[]> = {};
    for (const match of block.matchAll(/WHEN '(\w+)'\s+THEN p_to_status IN \(([^)]+)\)/g)) {
      sql[match[1]] = match[2].split(',').map((s) => s.trim().replace(/'/g, '')).sort();
    }
    for (const [from, to] of Object.entries(SURVEY_TRANSITIONS)) {
      expect(sql[from] ?? [], from).toEqual([...to].sort());
    }
  });

  it('terminal states accept no transition', () => {
    expect(SURVEY_TRANSITIONS.COMPLETED).toEqual([]);
    expect(SURVEY_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it('digests checklist, questions and site deterministically', () => {
    const digest = digestSurvey({
      findings: { equipment: [{ id: 'e', tag: 'DJ', description: 'x' }], estimated_activities: [{ id: 'a', text: 'Ensaio' }] },
      checklist: DEFAULT_SURVEY_CHECKLIST.map((item, i) => ({ ...item, done: i === 0 })),
      open_questions: [{ id: 'q', text: 'Janela?', resolved: false }, { id: 'r', text: 'Acesso?', resolved: true }],
      site_name: 'SE Norte',
    });
    expect(digest.checklistDone).toBe(1);
    expect(digest.requiredPending.map((i) => i.key)).not.toContain('site_access');
    expect(digest.openQuestions).toHaveLength(1);
    expect(digest.equipmentCount).toBe(1);
    expect(digest.activityCount).toBe(1);
    expect(digest.hasSite).toBe(true);
  });
});

describe('proposal readiness', () => {
  const base: ReadinessInput = {
    opportunity: { party_id: 'p', primary_contact_id: 'c', estimated_value: '100', expected_decision_date: '2026-12-01' },
    contacts: [{ id: 'c', is_primary: true }],
    surveys: [],
  };
  const survey = (status: SiteSurveyStatus, extra: Partial<ReadinessInput['surveys'][number]> = {}) => ({
    id: 's', code: 'LT-2026-001', status, site_name: 'SE', site_address: null,
    findings: { estimated_activities: [{ id: 'a', text: 'x' }] },
    checklist: [{ key: 'k', label: 'Placa', done: true, required: true }], open_questions: [], ...extra,
  });

  it('is READY only when nothing blocks and nothing asks for review', () => {
    const result = evaluateProposalReadiness({ ...base, surveys: [survey('COMPLETED')] });
    expect(result.state).toBe('READY_TO_PROPOSE');
    expect(result.missing).toEqual([]);
  });

  it('asks for REVIEW when there is no survey at all — never fabricates a requirement', () => {
    const result = evaluateProposalReadiness(base);
    expect(result.state).toBe('REVIEW_REQUIRED');
    expect(result.checks.find((c) => c.key === 'survey')?.state).toBe('warning');
  });

  it('is NOT_READY with an unfinished survey or unresolved technical questions, and says which', () => {
    expect(evaluateProposalReadiness({ ...base, surveys: [survey('IN_FIELD')] }).state).toBe('NOT_READY');
    const result = evaluateProposalReadiness({ ...base, surveys: [survey('COMPLETED', {
      open_questions: [{ id: 'q1', text: 'Janela de desligamento?', resolved: false }] })] });
    expect(result.state).toBe('NOT_READY');
    expect(result.missing.join(' ')).toContain('Janela de desligamento?');
  });

  it('blocks on an account outside the canonical registry', () => {
    const result = evaluateProposalReadiness({ ...base, opportunity: { ...base.opportunity, party_id: null } });
    expect(result.checks.find((c) => c.key === 'customer')?.state).toBe('blocking');
  });

  it('ignores cancelled surveys', () => {
    expect(evaluateProposalReadiness({ ...base, surveys: [survey('CANCELLED')] })
      .checks.find((c) => c.key === 'survey')?.state).toBe('warning');
  });
});

describe('proposal comparison', () => {
  const rev = (id: string, n: number, over: Partial<RevisionLike> = {}): RevisionLike => ({
    id, revision: n, status: 'SENT', total_value: '920000', currency: 'BRL', validity_until: '2026-10-01',
    payment_terms: '30 dias', scope_summary: 'Comissionamento', acceptance_conditions: null, ...over,
  });
  const fact = (id: string, subject: string, over: Partial<FactLike>): FactLike => ({
    id, subject_id: subject, fact_domain: 'MEASUREMENT_RULE', fact_key: null, label: 'Medição',
    value_text: 'Mensal', value_numeric: null, value_date: null, unit: null, currency: null,
    corrected_value: null, confirmation_state: 'CONFIRMED', provenance_state: 'ANCHORED', source_page: 3, ...over,
  });

  it('reports value, payment and validity deltas, material first', () => {
    const changes = compareRevisions(rev('a', 2), rev('b', 3, {
      total_value: '850000', payment_terms: '45 dias', validity_until: '2026-10-16' }), []);
    const value = changes.find((c) => c.key === 'total_value')!;
    expect(value.kind).toBe('modified');
    expect(value.material).toBe(true);
    expect(value.delta).toContain('−');
    expect(value.delta).toContain('-7.6%');
    expect(changes.find((c) => c.key === 'validity_until')?.delta).toBe('+15 dias');
    expect(changes.find((c) => c.key === 'scope_summary')?.kind).toBe('unchanged');
    expect(changes[0].kind).toBe('modified');
  });

  it('pairs facts by domain and key, marks added/removed and unconfirmed readings', () => {
    const facts = [
      fact('f1', 'a', { value_text: 'Mensal' }),
      fact('f2', 'b', { value_text: 'Por marco', confirmation_state: 'UNCONFIRMED' }),
      fact('f3', 'b', { fact_domain: 'EXCLUSION', label: 'Andaimes' }),
      fact('f4', 'a', { fact_domain: 'DELIVERABLE', label: 'Relatório', confirmation_state: 'REJECTED' }),
    ];
    const changes = compareRevisions(rev('a', 1), rev('b', 2), facts);
    const rule = changes.find((c) => c.domain === 'MEASUREMENT_RULE')!;
    expect(rule.kind).toBe('modified');
    expect(rule.unconfirmed).toBe(true);
    expect(changes.find((c) => c.domain === 'EXCLUSION')?.kind).toBe('added');
    // Fato rejeitado não entra na comparação.
    expect(changes.find((c) => c.domain === 'DELIVERABLE')).toBeUndefined();
  });

  it('cross-checks PT × PC only on verifiable facts', () => {
    const findings = crossCheckTechnicalCommercial({
      technical: rev('t', 1, { total_value: '900000', scope_summary: null }),
      commercial: rev('c', 1, { total_value: '920000' }),
      facts: [fact('m', 'c', {})],
    });
    const keys = findings.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(['value', 'measurement', 'scope']));
    expect(crossCheckTechnicalCommercial({ technical: null, commercial: rev('c', 1), facts: [] })).toEqual([]);
  });
});

describe('execution start validation mirrors the governed function', () => {
  const form = (over: Partial<ExecutionStartForm> = {}): ExecutionStartForm => ({
    mode: 'STANDARD', opportunityId: 'o', technicalRevisionId: 't', commercialRevisionId: 'c',
    technicalStatus: 'ACCEPTED', commercialStatus: 'ACCEPTED', basis: 'accepted_proposal',
    authorizationDate: '2026-09-20', reference: '', context: '', acceptanceSource: null,
    customerAuthorizerName: '', documentId: null,
    exception: { reason: '', internalAuthorizerUserId: null, regularizationOwnerUserId: null, regularizationDueDate: '' },
    serviceOrder: { mode: 'generate' }, project: { mode: 'create', name: 'P', client: 'C' }, ...over,
  });
  const now = new Date('2026-09-22T12:00:00Z');

  it('accepts an accepted proposal with no extra evidence', () => {
    expect(validateExecutionStart(form(), now)).toEqual([]);
  });

  it('refuses declared basis outside the exceptional path', () => {
    expect(validateExecutionStart(form({ basis: 'declared' }), now).map((i) => i.field)).toContain('basis');
  });

  it('demands evidence for PO / e-mail / customer OS', () => {
    for (const basis of ['customer_po', 'customer_email', 'customer_os'] as const) {
      expect(validateExecutionStart(form({ basis }), now).map((i) => i.field)).toContain('reference');
      expect(validateExecutionStart(form({ basis, reference: 'PO 1' }), now)).toEqual([]);
    }
  });

  it('refuses a draft revision on the standard path and points to the exception', () => {
    const issues = validateExecutionStart(form({ commercialStatus: 'DRAFT' }), now);
    expect(issues.map((i) => i.message).join(' ')).toContain('início excepcional');
  });

  it('asks how the customer accepted only when the basis does not imply it', () => {
    expect(validateExecutionStart(form({ commercialStatus: 'SENT', basis: 'customer_email', reference: 'x' }), now)).toEqual([]);
    expect(validateExecutionStart(form({ commercialStatus: 'SENT', basis: 'customer_os', reference: 'x' }), now)
      .map((i) => i.field)).toContain('acceptanceSource');
  });

  it('exceptional start requires reason, authorizer, owner, future due date and evidence', () => {
    const fields = validateExecutionStart(form({ mode: 'EXCEPTIONAL', basis: 'declared' }), now).map((i) => i.field);
    expect(fields).toEqual(expect.arrayContaining(['exception.reason', 'exception.internalAuthorizerUserId',
      'exception.regularizationOwnerUserId', 'exception.regularizationDueDate', 'reference']));
    const ok = form({ mode: 'EXCEPTIONAL', basis: 'declared', reference: 'ligação', commercialStatus: 'DRAFT',
      exception: { reason: 'Parada', internalAuthorizerUserId: 'u', regularizationOwnerUserId: 'v', regularizationDueDate: '2026-10-01' } });
    expect(validateExecutionStart(ok, now)).toEqual([]);
    const past = { ...ok, exception: { ...ok.exception, regularizationDueDate: '2026-09-01' } };
    expect(validateExecutionStart(past, now).map((i) => i.field)).toContain('exception.regularizationDueDate');
  });

  it('refuses a future authorization date', () => {
    expect(validateExecutionStart(form({ authorizationDate: '2026-12-01' }), now).map((i) => i.field))
      .toContain('authorizationDate');
  });

  it('builds the snake_case payload the SQL function reads', () => {
    const payload = buildExecutionStartPayload(form({ basis: 'customer_po', reference: ' PO 45 ' }), 'proj-1');
    expect(payload.authorization).toMatchObject({ type: 'customer_po', reference: 'PO 45', date: '2026-09-20' });
    expect(payload.exception).toBeUndefined();
    expect(payload.project).toMatchObject({ mode: 'create', project_id: 'proj-1', payload: { nome: 'P', cliente: 'C' } });
    for (const key of ['mode', 'opportunity_id', 'technical_revision_id', 'commercial_revision_id',
      'authorization', 'service_order', 'project']) {
      expect(SQL).toContain(key);
    }
  });
});

describe('workflow signals', () => {
  const base = {
    opportunity: { id: 'o', title: 'Retrofit', stage: 'NEGOTIATION' as const, engagement_id: null },
    surveys: [], readiness: null, proposalCount: 1, acceptedRevisions: [], engagement: null,
    serviceOrders: [], executionStart: null, now: new Date('2026-09-22T12:00:00Z'),
  };

  it('flags accepted proposals without authorized work as blocking', () => {
    const signals = buildExecutionSignals({ ...base, acceptedRevisions: [{ id: 'r', label: 'PC-1 R02' }] });
    expect(signals[0]).toMatchObject({ kind: 'ACCEPTED_WITHOUT_AUTHORIZATION', severity: 'blocking' });
  });

  it('flags OS issued without project and an overdue pending documentation', () => {
    const signals = buildExecutionSignals({ ...base,
      engagement: { id: 'e', status: 'AUTHORIZED' },
      serviceOrders: [{ id: 's', os_number: 'OS-2026-0001', status: 'ISSUED', project_id: null }],
      executionStart: { id: 'x', documentation_state: 'PENDING', regularization_due_date: '2026-09-10' } });
    expect(signals.map((s) => s.kind)).toEqual(expect.arrayContaining(['SERVICE_ORDER_WITHOUT_PROJECT', 'DOCUMENTATION_PENDING']));
    expect(signals.find((s) => s.kind === 'DOCUMENTATION_PENDING')?.title).toContain('vencida');
  });

  it('flags a visit that should have started', () => {
    const signals = buildExecutionSignals({ ...base,
      surveys: [{ id: 's', code: 'LT-2026-001', status: 'SCHEDULED', planned_visit_date: '2026-09-15' }] });
    expect(signals[0]).toMatchObject({ kind: 'SURVEY_PENDING', severity: 'blocking' });
  });

  it('stays silent when everything is in place', () => {
    expect(buildExecutionSignals({ ...base,
      engagement: { id: 'e', status: 'AUTHORIZED' },
      serviceOrders: [{ id: 's', os_number: 'OS-1', status: 'IN_EXECUTION', project_id: 'p' }],
      executionStart: { id: 'x', documentation_state: 'COMPLETE', regularization_due_date: null } })).toEqual([]);
  });
});

describe('blueprint from facts', () => {
  it('maps domains to fixed categories, keeps provenance and drops rejected facts', () => {
    const items = blueprintItemsFromFacts([
      { id: 'a', fact_domain: 'MEASUREMENT_RULE', label: 'Medição', value_text: 'Mensal', value_numeric: null,
        value_date: null, unit: null, currency: null, corrected_value: null, confidence: '0.9', confirmation_state: 'CONFIRMED' },
      { id: 'b', fact_domain: 'VALUE', label: 'Total', value_text: null, value_numeric: '850000',
        value_date: null, unit: null, currency: 'BRL', corrected_value: null, confidence: null, confirmation_state: 'UNCONFIRMED' },
      { id: 'c', fact_domain: 'SCOPE', label: 'Escopo', value_text: 'x', value_numeric: null,
        value_date: null, unit: null, currency: null, corrected_value: null, confidence: null, confirmation_state: 'REJECTED' },
    ]);
    expect(items.map((i) => [i.category, i.source_fact_id])).toEqual([['MEASUREMENT_RULE', 'a'], ['BILLING_CONDITION', 'b']]);
    expect(items[1].detail).toBe('850000 BRL');
  });
});
