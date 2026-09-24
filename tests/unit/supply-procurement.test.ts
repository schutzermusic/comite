import { describe, it, expect } from 'vitest';
import {
  evaluateQuotes, procurementErrorMessage, purchaseOrderActions, recommendQuote, type ComparableQuote,
} from '@/lib/supply/procurement';
import { parseDecimal } from '@/components/supply/procurement/shared';
import { authoritySchema, purchaseOrderActionSchema, requisitionSchema, rfqActionSchema } from '@/lib/supply/validation';

const U = '00000000-0000-4000-8000-000000000001';
const quote = (over: Partial<ComparableQuote>): ComparableQuote => ({
  id: 'q', supplierId: 's', supplier: 'Fornecedor', supplierStatus: 'HOMOLOGATED', version: 1, status: 'RECEIVED', currency: 'BRL',
  freight: 0, tax: 0, leadTimeDays: 10, validityDate: '2099-01-01', deviations: null, paymentTerms: null,
  lines: [{ rfqLineId: 'l1', unitPrice: 10, quantity: 100, leadTimeDays: null, compliant: true }], ...over,
});
const rfqLines = [{ id: 'l1', quantity: 100, requiredBy: '2026-10-10' }];
const today = '2026-09-24';

describe('Compras — comparação além do preço', () => {
  it('custo total posto soma itens, frete e impostos; chegada = hoje + prazo', () => {
    const [e] = evaluateQuotes(rfqLines, [quote({ freight: 50, tax: 20, leadTimeDays: 5 })], today);
    expect(e.landed).toBe(1070);
    expect(e.eta).toBe('2026-09-29');
    expect(e.lateDays).toBe(0);
  });
  it('proposta substituída não entra; incompleta, vencida e fornecedor bloqueado não são elegíveis', () => {
    const evals = evaluateQuotes(rfqLines, [
      quote({ id: 'old', status: 'SUPERSEDED' }),
      quote({ id: 'partial', lines: [{ rfqLineId: 'l1', unitPrice: 9, quantity: 50, leadTimeDays: null, compliant: true }] }),
      quote({ id: 'expired', validityDate: '2026-09-01' }),
      quote({ id: 'blocked', supplierStatus: 'BLOCKED' }),
    ], today);
    expect(evals.map((e) => [e.quoteId, e.eligible])).toEqual([['partial', false], ['expired', false], ['blocked', false]]);
  });
  it('recomenda a mais barata ENTRE AS QUE CHEGAM A TEMPO e explica o que se perde com a mais barata', () => {
    const evals = evaluateQuotes(rfqLines, [
      quote({ id: 'cheap-late', supplier: 'Barato', leadTimeDays: 30, lines: [{ rfqLineId: 'l1', unitPrice: 8, quantity: 100, leadTimeDays: null, compliant: true }] }),
      quote({ id: 'on-time', supplier: 'Pontual', leadTimeDays: 10, lines: [{ rfqLineId: 'l1', unitPrice: 9, quantity: 100, leadTimeDays: null, compliant: true }] }),
    ], today);
    const rec = recommendQuote(evals)!;
    expect(rec.quoteId).toBe('on-time');
    expect(rec.rationale).toMatch(/entre as que chegam a tempo/);
    expect(rec.rationale).toMatch(/Barato.*atrasa 14 dia/);
  });
  it('sem nenhuma a tempo, recomenda o menor atraso; sem elegível, não recomenda', () => {
    const late = evaluateQuotes(rfqLines, [quote({ id: 'a', leadTimeDays: 40 }), quote({ id: 'b', leadTimeDays: 25 })], today);
    expect(recommendQuote(late)!.quoteId).toBe('b');
    expect(recommendQuote(evaluateQuotes(rfqLines, [quote({ id: 'x', supplierStatus: 'SUSPENDED' })], today))).toBeNull();
  });
  it('conforme ganha de não conforme mesmo mais cara', () => {
    const evals = evaluateQuotes(rfqLines, [
      quote({ id: 'dev', deviations: 'Bitola alternativa', lines: [{ rfqLineId: 'l1', unitPrice: 7, quantity: 100, leadTimeDays: null, compliant: true }] }),
      quote({ id: 'ok' }),
    ], today);
    expect(recommendQuote(evals)!.quoteId).toBe('ok');
  });
});

describe('Compras — atos oferecidos pelo estado e pela alçada', () => {
  const caps = { source: true, approve: true, issue: true };
  it('quem criou ou submeteu não vê aprovar (segregação de funções)', () => {
    const po = { status: 'APPROVAL_REQUIRED' as const, governance: 'AUTHORITY' as const, createdBy: 'u1', submittedBy: 'u2' };
    expect(purchaseOrderActions(po, caps, 'u1')).not.toContain('approve');
    expect(purchaseOrderActions(po, caps, 'u2')).not.toContain('approve');
    expect(purchaseOrderActions(po, caps, 'u3')).toEqual(['approve', 'reject', 'cancel']);
  });
  it('governado por política: decisão no motor, pedido só sincroniza o desfecho', () => {
    const po = { status: 'APPROVAL_REQUIRED' as const, governance: 'POLICY' as const, createdBy: 'u1', submittedBy: 'u1' };
    expect(purchaseOrderActions(po, caps, 'u3')).toEqual(['sync', 'cancel']);
  });
  it('só aprovado é emitido; recebido não se cancela', () => {
    expect(purchaseOrderActions({ status: 'APPROVED', governance: 'AUTHORITY', createdBy: 'u1', submittedBy: 'u1' }, caps, 'u1'))
      .toEqual(['issue', 'cancel']);
    expect(purchaseOrderActions({ status: 'PARTIALLY_RECEIVED', governance: 'AUTHORITY', createdBy: 'u1', submittedBy: 'u1' }, caps, 'u1'))
      .toEqual([]);
  });
});

describe('Compras — contrato das rotas e recusas', () => {
  it('requisição manual exige justificativa; da falta exige requisitos', () => {
    expect(requisitionSchema.safeParse({ source: 'MANUAL', justification: 'curta', lines: [{ itemId: U, quantity: 1 }] }).success).toBe(false);
    expect(requisitionSchema.safeParse({ source: 'SHORTAGE', requirementIds: [] }).success).toBe(false);
    expect(requisitionSchema.safeParse({ source: 'SHORTAGE', requirementIds: [U] }).success).toBe(true);
  });
  it('decisão exige justificativa real; alçada exige papel ou pessoa; cancelar exige motivo', () => {
    expect(rfqActionSchema.safeParse({ action: 'decide', quoteId: U, rationale: 'ok' }).success).toBe(false);
    expect(authoritySchema.safeParse({ granteeKind: 'ROLE', sourceKind: 'BYLAWS', sourceReference: 'Estatuto', justification: 'x y z' }).success).toBe(false);
    expect(purchaseOrderActionSchema.safeParse({ action: 'cancel', reason: '' }).success).toBe(false);
  });
  it('recusas do banco em português', () => {
    expect(procurementErrorMessage('Purchase approval requires segregation of duties: the creator or submitter does not decide.')).toMatch(/Segregação/);
    expect(procurementErrorMessage('Purchase approval authority not configured for this actor, amount (19300 BRL) and scope')).toMatch(/alçada/);
    expect(procurementErrorMessage('Requirement X has no uncovered shortage left to requisition (600.0000 already requested).')).toMatch(/600/);
    expect(procurementErrorMessage('outra coisa')).toBeNull();
  });
  it('número digitado: vírgula é decimal com ponto de milhar; sem vírgula, ponto é decimal', () => {
    expect(parseDecimal('1.234,5')).toBe(1234.5);
    expect(parseDecimal('19.50')).toBe(19.5);
    expect(parseDecimal('19,5')).toBe(19.5);
    expect(Number.isNaN(parseDecimal(''))).toBe(true);
  });
});
