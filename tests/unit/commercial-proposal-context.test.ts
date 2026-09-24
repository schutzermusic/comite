import { describe, expect, it } from 'vitest';
import {
  baseProposalNumber, contextKeys, contextMetrics, contextNextAction, groupProposalContexts,
  type ContextProposal, type ContextRevision,
} from '@/lib/commercial/proposal-context';
import { chunkText, paymentSummary, structurePaymentTerms } from '@/lib/commercial/payment-terms';

const p = (id: string, number: string, kind: ContextProposal['kind'], over: Partial<ContextProposal> = {}): ContextProposal => ({
  id, proposal_number: number, kind, title: 'Fabricação de bobinas 13,8kV', counterparty_name: 'Flessak',
  currency: 'BRL', opportunity_id: null, party_id: null, created_at: '2026-09-01', ...over,
});
const r = (id: string, proposal: string, revision: number, status: ContextRevision['status'], over: Partial<ContextRevision> = {}): ContextRevision => ({
  id, proposal_id: proposal, revision, status, total_value: null, currency: 'BRL', validity_until: null,
  document_id: 'doc', ...over,
});

describe('proposal context — PT + PC is ONE proposal', () => {
  it('strips only a PT/PC prefix followed by a separator or digit', () => {
    expect(baseProposalNumber('PT-2899.02/2026')).toBe('2899.02/2026');
    expect(baseProposalNumber('pc 2899.02/2026')).toBe('2899.02/2026');
    expect(baseProposalNumber('PC2899')).toBe('2899');
    expect(baseProposalNumber('PCH-12')).toBe('PCH-12');
  });

  it('pairs PT and PC of the same customer and base number into one context', () => {
    const contexts = groupProposalContexts(
      [p('pt', 'PT-2899.02/2026', 'TECHNICAL'), p('pc', 'PC-2899.02/2026', 'COMMERCIAL')],
      [r('rpt', 'pt', 1, 'DRAFT'), r('rpc', 'pc', 1, 'DRAFT', { total_value: '803179' })],
    );
    expect(contexts).toHaveLength(1);
    expect(contexts[0].technical?.proposal.id).toBe('pt');
    expect(contexts[0].commercial?.proposal.id).toBe('pc');
    expect(contexts[0].primaryId).toBe('pc');
    expect(contexts[0].value).toBe(803179);
    expect(contextMetrics(contexts).total).toBe(1);
  });

  it('never pairs across customers, conflicting opportunities, or with a combined proposal', () => {
    const keys = contextKeys([
      p('a', 'PT-1', 'TECHNICAL'), p('b', 'PC-1', 'COMMERCIAL', { counterparty_name: 'Outra' }),
      p('c', 'PT-2', 'TECHNICAL', { opportunity_id: 'o1' }), p('d', 'PC-2', 'COMMERCIAL', { opportunity_id: 'o2' }),
      p('e', 'PT-3', 'TECHNICAL'), p('f', '3', 'COMBINED'),
    ]);
    expect(new Set(keys.values()).size).toBe(6);
  });

  it('an explicit context (217) wins over derivation', () => {
    const keys = contextKeys([
      p('pt', 'PT-A', 'TECHNICAL', { context_id: 'pt' }), p('pc', 'PC-B', 'COMMERCIAL', { context_id: 'pt' }),
    ]);
    expect(keys.get('pt')).toBe(keys.get('pc'));
  });

  it('keeps independent revision histories and derives package stages without double counting', () => {
    const proposals = [p('pt', 'PT-9', 'TECHNICAL'), p('pc', 'PC-9', 'COMMERCIAL')];
    const sent = groupProposalContexts(proposals, [
      r('pt1', 'pt', 1, 'SENT'), r('pc1', 'pc', 1, 'SUPERSEDED'), r('pc2', 'pc', 2, 'SENT', { total_value: 10 }),
    ])[0];
    expect(sent.technical?.governing?.revision).toBe(1);
    expect(sent.commercial?.governing?.revision).toBe(2);
    expect(sent.stage).toBe('WITH_CUSTOMER');
    expect(sent.internalApproval).toBe('APPROVED');

    // Cliente pediu mudança: PC R03 nasce rascunho → reaprovação.
    const revised = groupProposalContexts(proposals, [
      r('pt1', 'pt', 1, 'SENT'), r('pc2', 'pc', 2, 'SUPERSEDED'), r('pc3', 'pc', 3, 'DRAFT', { total_value: 9 }),
    ])[0];
    expect(revised.internalApproval).toBe('REAPPROVAL');
    expect(revised.customerState).toBe('WITH_CUSTOMER');
    expect(contextNextAction(revised)).toMatch(/parte pendente do pacote/);

    const accepted = groupProposalContexts(proposals, [
      r('pt1', 'pt', 1, 'ACCEPTED'), r('pc2', 'pc', 2, 'ACCEPTED', { total_value: 10 }),
    ]);
    expect(contextMetrics(accepted).accepted).toBe(1);
  });

  it('the package is with the customer only when every document is', () => {
    const [ctx] = groupProposalContexts(
      [p('pt', 'PT-9', 'TECHNICAL'), p('pc', 'PC-9', 'COMMERCIAL')],
      [r('pt1', 'pt', 1, 'INTERNAL_REVIEW'), r('pc1', 'pc', 1, 'INTERNALLY_APPROVED', { total_value: 1 })],
    );
    expect(ctx.stage).toBe('INTERNAL_APPROVAL');
    expect(ctx.internalApproval).toBe('PENDING');
  });
});

describe('payment terms — structured, not a paragraph', () => {
  const text = '10% (dez por cento) na mobilização; 20% no Marco 1 – entrega do projeto executivo; '
    + '20% no Marco 2; 30% na entrega das bobinas; 20% após comissionamento, com pagamento em até 45 dias após emissão da fatura pro-forma';

  it('splits installments with percent, amount, trigger and condition', () => {
    const s = structurePaymentTerms(text, 803179);
    expect(s.installments).toHaveLength(5);
    expect(s.installments[0]).toMatchObject({ percent: 10, amount: 80317.9, amountDerived: true });
    expect(s.installments[0].trigger.toLowerCase()).toContain('mobiliza');
    expect(s.installments[1].trigger).toMatch(/Marco 1/);
    expect(s.installments[4].condition).toMatch(/45 dias/);
    expect(s.complete).toBe(true);
    expect(paymentSummary(s)).toMatch(/5 parcelas/);
    expect(s.original).toBe(text);
  });

  it('prefers the amount written in the document and keeps unknown clauses', () => {
    const s = structurePaymentTerms('10% R$ 80.317,90 Mobilização\nPagamento via boleto bancário', 1);
    expect(s.installments[0]).toMatchObject({ amount: 80317.9, amountDerived: false });
    expect(s.general).toEqual(['Pagamento via boleto bancário']);
    expect(s.complete).toBe(false);
  });

  it('chunks long scope text into items', () => {
    expect(chunkText('Fabricação de 3 bobinas; ensaios de rotina\n• transporte').items).toEqual([
      'Fabricação de 3 bobinas', 'ensaios de rotina', 'transporte',
    ]);
  });
});

import { packageAcceptance, type AcceptanceRecord } from '@/lib/commercial/proposal-context';

describe('customer acceptance is of the EXACT package', () => {
  const proposals = [p('pt', 'PT-9', 'TECHNICAL'), p('pc', 'PC-9', 'COMMERCIAL')];
  const row = (over: Partial<AcceptanceRecord> = {}): AcceptanceRecord => ({
    id: 'acc', technical_revision_id: 'pt1', technical_status: 'ACCEPTED', commercial_revision_id: 'pc2',
    commercial_status: 'ACCEPTED', combined_revision_id: null, combined_status: null, complete: true,
    acceptance_source: 'purchase_order', acceptance_external_ref: 'PO-1', recorded_by: 'u1',
    accepted_at: '2026-09-20T12:00:00Z', origin: 'package', ...over,
  });

  it('one accepted document does not make the package accepted', () => {
    const [ctx] = groupProposalContexts(proposals, [
      r('pt1', 'pt', 1, 'SENT'), r('pc2', 'pc', 2, 'ACCEPTED', { total_value: 10 }),
    ]);
    expect(ctx.accepted).toBe(false);
    expect(ctx.partiallyAccepted).toBe(true);
    expect(ctx.customerState).toBe('PARTIALLY_ACCEPTED');
    expect(ctx.stage).toBe('WITH_CUSTOMER');
    expect(contextMetrics([ctx]).accepted).toBe(0);
    expect(packageAcceptance(ctx, [row({ technical_status: 'SENT', complete: false })]).state).toBe('PARTIAL');
  });

  it('answers deterministically which PT + PC revisions were accepted, with evidence', () => {
    const [ctx] = groupProposalContexts(proposals, [
      r('pt1', 'pt', 1, 'ACCEPTED'), r('pc1', 'pc', 1, 'SUPERSEDED'), r('pc2', 'pc', 2, 'ACCEPTED', { total_value: 10 }),
    ]);
    const acc = packageAcceptance(ctx, [row()]);
    expect(acc.state).toBe('ACCEPTED');
    expect(acc.accepted.map((x) => `${x.kind}:${x.revision}`)).toEqual(['TECHNICAL:1', 'COMMERCIAL:2']);
    expect(acc.record).toMatchObject({ acceptance_source: 'purchase_order', recorded_by: 'u1', origin: 'package' });
  });

  it('a later revision never inherits the acceptance', () => {
    // PC aceita; PT ganha R02 depois → pacote volta a exigir aprovação e evidência.
    const [ctx] = groupProposalContexts(proposals, [
      r('pt1', 'pt', 1, 'SUPERSEDED'), r('pt2', 'pt', 2, 'DRAFT'), r('pc2', 'pc', 2, 'ACCEPTED', { total_value: 10 }),
    ]);
    expect(ctx.accepted).toBe(false);
    expect(ctx.internalApproval).toBe('REAPPROVAL');
    const acc = packageAcceptance(ctx, [row()]);
    expect(acc.state).toBe('CHANGED');
    expect(acc.differences.join(' ')).toMatch(/PT hoje é regida pela R02; o aceite foi da R01/);
  });

  it('a document that joins after the acceptance invalidates the accepted package', () => {
    const [ctx] = groupProposalContexts(proposals, [
      r('pt1', 'pt', 1, 'DRAFT'), r('pc2', 'pc', 2, 'ACCEPTED', { total_value: 10 }),
    ]);
    const acc = packageAcceptance(ctx, [row({ technical_revision_id: null, technical_status: null })]);
    expect(acc.state).toBe('CHANGED');
    expect(acc.differences).toContain('PT entrou no pacote depois do aceite');
  });

  it('without the ledger (pre-217) falls back to the same deterministic rule', () => {
    const [ctx] = groupProposalContexts(proposals, [r('pt1', 'pt', 1, 'ACCEPTED'), r('pc2', 'pc', 2, 'ACCEPTED', { total_value: 1 })]);
    expect(packageAcceptance(ctx, null).state).toBe('ACCEPTED');
  });
});
