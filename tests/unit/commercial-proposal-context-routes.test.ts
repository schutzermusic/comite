/**
 * Contexto PT + PC nas rotas e nos sinais:
 *  • aprovação interna do PACOTE exige a alçada de aprovar; o resto, manage;
 *  • banco sem a 217 → o mesmo ato, documento a documento, pelo contexto derivado;
 *  • criar oportunidade a partir da proposta e vincular o contexto numa chamada;
 *  • validade do pacote vira UM sinal, não um por documento;
 *  • a comparação resume o material primeiro.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { svc, audit, perms, tables } = vi.hoisted(() => ({
  svc: {
    transitionProposalContext: vi.fn(), transitionProposalRevision: vi.fn(),
    linkProposalContextToOpportunity: vi.fn(), linkProposalToOpportunity: vi.fn(), upsertOpportunity: vi.fn(),
    recordProposalContextOutcome: vi.fn(), recordProposalOutcome: vi.fn(),
  },
  audit: vi.fn().mockResolvedValue(undefined),
  perms: new Set<string>(['commercial.proposals.manage', 'commercial.manage']),
  tables: {} as Record<string, unknown[]>,
}));

/** Cliente mínimo encadeável: filtra por eq/in sobre as tabelas em memória. */
function query(table: string) {
  let rows = [...(tables[table] ?? [])] as Array<Record<string, unknown>>;
  const chain = {
    select: () => chain,
    eq: (k: string, v: unknown) => { rows = rows.filter((r) => k === 'organization_id' || r[k] === v); return chain; },
    in: (k: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[k])); return chain; },
    limit: () => chain,
    order: () => chain,
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: rows, error: null }),
  };
  return chain;
}

vi.mock('@/lib/commercial/server-session', () => ({
  requireCommercialSession: async () => ({
    organizationId: 'org-1', user: { id: 'user-1' }, permissions: perms,
    supabase: { from: (t: string) => query(t) },
  }),
  isSessionError: () => false,
  safeGovernedError: (m: string) => m,
}));
vi.mock('@/lib/commercial/engagement-service', () => svc);
vi.mock('@/lib/audit/log-audit-event-server', () => ({ logAuditEventServer: audit }));

import { POST as contextPOST } from '@/app/api/commercial/proposals/[id]/context/route';
import { POST as opportunityPOST } from '@/app/api/commercial/proposals/[id]/opportunity/route';
import { POST as outcomePOST } from '@/app/api/commercial/proposals/[id]/outcome/route';
import { buildPipelineSignals } from '@/lib/commercial/pipeline-signals';
import { compareRevisions, materialHighlights } from '@/lib/commercial/proposal-compare';

const PT = '11111111-1111-4111-8111-111111111111';
const PC = '22222222-2222-4222-8222-222222222222';
const OPP = '33333333-3333-4333-8333-333333333333';
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) => new Request('http://x', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const missing = new Error('Could not find the function public.commercial_proposal_context_transition in the schema cache');

beforeEach(() => {
  Object.values(svc).forEach((f) => f.mockReset());
  audit.mockClear();
  perms.clear();
  perms.add('commercial.proposals.manage').add('commercial.manage');
  tables.commercial_proposals = [
    { id: PT, proposal_number: 'PT-2899.02/2026', kind: 'TECHNICAL', title: 'Bobinas', counterparty_name: 'Flessak', opportunity_id: null },
    { id: PC, proposal_number: 'PC-2899.02/2026', kind: 'COMMERCIAL', title: 'Bobinas', counterparty_name: 'Flessak', opportunity_id: null },
  ];
  tables.commercial_proposal_revisions = [
    { id: 'rpt', proposal_id: PT, revision: 1, status: 'INTERNAL_REVIEW' },
    { id: 'rpc', proposal_id: PC, revision: 1, status: 'INTERNAL_REVIEW' },
  ];
});

describe('aprovação interna do pacote', () => {
  it('aprovar exige commercial.proposals.approve_internal', async () => {
    const response = await contextPOST(post({ to: 'INTERNALLY_APPROVED' }), params(PC));
    expect(response.status).toBe(403);
    expect(svc.transitionProposalContext).not.toHaveBeenCalled();
  });

  it('com alçada, o pacote anda pela função governada e fica auditado', async () => {
    perms.add('commercial.proposals.approve_internal');
    svc.transitionProposalContext.mockResolvedValue({ context_id: PT, status: 'INTERNALLY_APPROVED',
      moved: [{ proposal_id: PT, revision_id: 'rpt', revision: 1 }, { proposal_id: PC, revision_id: 'rpc', revision: 1 }] });
    const response = await contextPOST(post({ to: 'INTERNALLY_APPROVED' }), params(PC));
    expect(response.status).toBe(200);
    expect(svc.transitionProposalContext).toHaveBeenCalledWith('org-1', 'user-1', PC, 'INTERNALLY_APPROVED');
    expect(audit.mock.calls[0][0]).toMatchObject({ action: 'commercial.proposal_context.internally_approved' });
  });

  it('sem a 217 no banco, move cada documento do contexto derivado pelo ato de sempre', async () => {
    perms.add('commercial.proposals.approve_internal');
    svc.transitionProposalContext.mockRejectedValue(missing);
    svc.transitionProposalRevision.mockResolvedValue({});
    const response = await contextPOST(post({ to: 'INTERNALLY_APPROVED' }), params(PC));
    expect(response.status).toBe(200);
    expect(svc.transitionProposalRevision.mock.calls.map((c) => c[2]).sort()).toEqual(['rpc', 'rpt']);
  });

  it('recusa transição que não é do fluxo interno', async () => {
    const response = await contextPOST(post({ to: 'ACCEPTED' }), params(PC));
    expect(response.status).toBe(400);
  });
});

describe('oportunidade a partir da proposta', () => {
  it('cria a oportunidade e vincula o CONTEXTO na mesma chamada', async () => {
    svc.upsertOpportunity.mockResolvedValue(OPP);
    svc.linkProposalContextToOpportunity.mockResolvedValue({ linked: true, documents_linked: 2, party_inherited: false });
    const response = await opportunityPOST(post({ create: {
      title: 'Bobinas 13,8kV', counterparty_name: 'Flessak', estimated_value: '803179', currency: 'BRL',
    } }), params(PC));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, opportunity_id: OPP, created: true, documents_linked: 2 });
    expect(svc.upsertOpportunity.mock.calls[0][2]).toMatchObject({ stage: 'PROPOSAL', counterparty_name: 'Flessak', estimated_value: '803179' });
    expect(svc.linkProposalContextToOpportunity).toHaveBeenCalledWith('org-1', 'user-1', PC, OPP, 'Oportunidade criada a partir da proposta');
  });

  it('exige oportunidade existente OU criação — nunca as duas', async () => {
    const response = await opportunityPOST(post({ opportunityId: OPP, create: { title: 'x', counterparty_name: 'y' } }), params(PC));
    expect(response.status).toBe(400);
  });

  it('vínculo recusado depois de criar devolve a oportunidade criada', async () => {
    svc.upsertOpportunity.mockResolvedValue(OPP);
    svc.linkProposalContextToOpportunity.mockRejectedValue(new Error('A proposta e a oportunidade pertencem a contas diferentes do cadastro único.'));
    const response = await opportunityPOST(post({ create: { title: 'x', counterparty_name: 'Flessak' } }), params(PC));
    expect(response.status).toBe(422);
    expect((await response.json()).opportunity_id).toBe(OPP);
  });

  it('sem a 217, vincula PT e PC uma a uma', async () => {
    svc.linkProposalContextToOpportunity.mockRejectedValue(
      new Error('Could not find the function public.commercial_proposal_context_link_opportunity'));
    svc.linkProposalToOpportunity.mockResolvedValue({ linked: true, party_inherited: false });
    const response = await opportunityPOST(post({ opportunityId: OPP }), params(PC));
    expect(response.status).toBe(200);
    expect((await response.json()).documents_linked).toBe(2);
    expect(svc.linkProposalToOpportunity).toHaveBeenCalledTimes(2);
  });
});

describe('sinais e comparação por contexto', () => {
  it('PT e PC vencendo juntas geram UM sinal de validade', () => {
    const now = new Date('2026-09-22T12:00:00Z');
    const signals = buildPipelineSignals({
      now,
      opportunities: [{ id: 'o', title: 'Bobinas', counterparty_name: 'Flessak', stage: 'NEGOTIATION', probability: 0.7,
        expected_decision_date: '2026-10-30', stage_entered_at: '2026-09-20', engagement_id: null, closed_at: null }],
      followups: [{ id: 'f', source_kind: 'commercial_opportunity', source_id: 'o', goal: 'Cobrar', state: 'ACTIVE', due_date: '2026-09-25',
        next_expected_event: null, next_expected_event_at: null }],
      proposals: [
        { id: 'pt', proposal_number: 'PT-9', opportunity_id: 'o', title: 'x', kind: 'TECHNICAL', counterparty_name: 'Flessak' },
        { id: 'pc', proposal_number: 'PC-9', opportunity_id: 'o', title: 'x', kind: 'COMMERCIAL', counterparty_name: 'Flessak' },
      ],
      revisions: [
        { id: 'a', proposal_id: 'pt', revision: 1, status: 'SENT', validity_until: '2026-09-25' },
        { id: 'b', proposal_id: 'pc', revision: 1, status: 'SENT', validity_until: '2026-09-26' },
      ],
    }).filter((s) => s.kind === 'PROPOSAL_EXPIRING');
    expect(signals).toHaveLength(1);
    expect(signals[0].title).toContain('PT-9 / PC-9');
  });

  it('material primeiro: valor, prazo de pagamento, validade, escopo e medição', () => {
    const base = { acceptance_conditions: null, currency: 'BRL', status: 'SENT' };
    const changes = compareRevisions(
      { ...base, id: 'r1', revision: 1, total_value: 920000, validity_until: '2026-10-01', payment_terms: '30 dias', scope_summary: 'A' },
      { ...base, id: 'r2', revision: 2, total_value: 850000, validity_until: '2026-10-16', payment_terms: '45 dias', scope_summary: 'B' },
      [{ id: 'f', subject_id: 'r2', fact_domain: 'MEASUREMENT_RULE', label: 'Medição', value_text: 'Por marco', value_numeric: null,
        value_date: null, unit: null, currency: null, corrected_value: null, confirmation_state: 'UNCONFIRMED',
        provenance_state: 'ANCHORED', source_page: 3 }],
    );
    const h = materialHighlights(changes);
    expect(h.map((x) => x.key)).toEqual(['value', 'payment', 'validity', 'scope', 'measurement']);
    expect(h[0].detail).toMatch(/^−R\$\s?70\.000/);
    expect(h[1].detail).toBe('30 → 45 dias');
    expect(h[2].detail).toBe('+15 dias');
  });
});

describe('resposta do cliente ao pacote', () => {
  it('aceite vai ao PACOTE pela função governada e audita o pacote exato', async () => {
    tables.commercial_proposal_revisions = [
      { id: 'rpt', proposal_id: PT, revision: 1, status: 'SENT' },
      { id: 'rpc', proposal_id: PC, revision: 1, status: 'SENT' },
    ];
    svc.recordProposalContextOutcome.mockResolvedValue({ context_id: PT, status: 'ACCEPTED',
      moved: [{ revision_id: 'rpt' }, { revision_id: 'rpc' }],
      acceptance: { id: 'acc-1', technical_revision_id: 'rpt', commercial_revision_id: 'rpc', complete: true } });
    const response = await outcomePOST(post({ outcome: 'ACCEPTED', acceptanceSource: 'purchase_order', acceptanceExternalRef: 'PO-9' }), params('rpc'));
    expect(response.status).toBe(200);
    expect(svc.recordProposalContextOutcome).toHaveBeenCalledWith('org-1', 'user-1', PC, 'ACCEPTED',
      expect.objectContaining({ acceptance_source: 'purchase_order', acceptance_external_ref: 'PO-9' }));
    expect(svc.recordProposalOutcome).not.toHaveBeenCalled();
    expect(audit.mock.calls[0][0]).toMatchObject({ action: 'commercial.proposal_context.accepted',
      metadata: { revisions: ['rpt', 'rpc'], acceptanceId: 'acc-1' } });
  });

  it('sem a 217: aceitar exige o pacote inteiro com o cliente — PT em rascunho bloqueia', async () => {
    tables.commercial_proposal_revisions = [
      { id: 'rpt', proposal_id: PT, revision: 1, status: 'DRAFT' },
      { id: 'rpc', proposal_id: PC, revision: 1, status: 'SENT' },
    ];
    svc.recordProposalContextOutcome.mockRejectedValue(new Error('Could not find the function public.commercial_proposal_context_record_outcome'));
    const response = await outcomePOST(post({ outcome: 'ACCEPTED', acceptanceSource: 'customer_email' }), params('rpc'));
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/^Pacote: PT-2899\.02\/2026 R01 está em DRAFT/);
    expect(svc.recordProposalOutcome).not.toHaveBeenCalled();
  });

  it('aceite sem evidência é recusado antes de chegar ao banco', async () => {
    const response = await outcomePOST(post({ outcome: 'ACCEPTED' }), params('rpc'));
    expect(response.status).toBe(400);
    expect(svc.recordProposalContextOutcome).not.toHaveBeenCalled();
  });
});
