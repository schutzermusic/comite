import { afterEach, describe, it, expect, vi } from 'vitest';

// Os nomes de quem requisitou vêm do service role: fora do escopo desta leitura.
vi.mock('@/lib/commercial/owner-directory', () => ({ resolveOwnerNames: async () => ({}) }));

import {
  ALLOCATIONS_BEFORE_248, evaluateOrderableQuotes, evaluateQuotes, isMissing248Relation, lineInLiveRfq, lineOpenQuantity, lineReleases,
  lineRequiredBy, OPEN_ALLOCATIONS_248, procurementErrorMessage, purchaseOrderActions, readOpenAllocations, readRequisitionReleases,
  recommendQuote, releaseNote, REQUISITION_248_RETRY_MS, resetRequisition248Fallback, rfqLineOrderable, rfqOrderedLines,
  type AllocationSource, type ComparableQuote,
} from '@/lib/supply/procurement';
import { procurementWorkspace } from '@/lib/supply/procurement-read';
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

describe('Compras — a comparação sobre o que vira pedido (248)', () => {
  // X segue viva; Y é de uma requisição cancelada (a cotação ficou aberta porque X está viva)
  const lines = [{ id: 'x', quantity: 100, requiredBy: '2026-10-10', orderable: true },
    { id: 'y', quantity: 50, requiredBy: '2026-09-25', orderable: false }];
  const both = quote({ id: 'both', supplier: 'Cota tudo', leadTimeDays: 10, lines: [
    { rfqLineId: 'x', unitPrice: 10, quantity: 100, leadTimeDays: null, compliant: true },
    { rfqLineId: 'y', unitPrice: 10, quantity: 50, leadTimeDays: null, compliant: false }] });
  const onlyLive = quote({ id: 'live', supplier: 'Só a viva', leadTimeDays: 10, lines: [
    { rfqLineId: 'x', unitPrice: 11, quantity: 100, leadTimeDays: null, compliant: true }] });

  it('cotação ABERTA: quem cota só as linhas vivas é completo e elegível; o custo posto e a necessidade não contam a linha morta', () => {
    const evals = evaluateOrderableQuotes('OPEN', lines, [both, onlyLive], today);
    const by = Object.fromEntries(evals.map((e) => [e.quoteId, e]));
    expect(by.live).toMatchObject({ complete: true, eligible: true, goods: 1100, landed: 1100, lateDays: 0 });
    // a linha morta não entra no custo (1.000, não 1.500), nem a desconformidade dela, nem a necessidade dela (25/09)
    expect(by.both).toMatchObject({ complete: true, eligible: true, compliant: true, goods: 1000, landed: 1000, lateDays: 0 });
    expect(recommendQuote(evals)!.quoteId).toBe('both');
    // pela régua antiga (todas as linhas): "só a viva" seria incompleta e "cota tudo" chegaria 9 dias depois da necessidade
    const old = Object.fromEntries(evaluateQuotes(lines, [both, onlyLive], today).map((e) => [e.quoteId, e]));
    expect([old.live.eligible, old.both.lateDays, old.both.landed]).toEqual([false, 9, 1500]);
  });
  it('sem nenhuma linha que vire pedido: nenhuma proposta é elegível (o banco recusa a decisão) — sem recomendação', () => {
    const evals = evaluateOrderableQuotes('OPEN', lines.map((l) => ({ ...l, orderable: false })), [both, onlyLive], today);
    expect(evals.map((e) => [e.quoteId, e.eligible, e.flags.includes('nenhuma linha desta cotação pode virar pedido')]))
      .toEqual([['both', false, true], ['live', false, true]]);
    expect(recommendQuote(evals)).toBeNull();
  });
  it('cotação decidida (ou cancelada): a comparação é o registro — todas as linhas contam', () => {
    for (const status of ['DECIDED', 'CANCELLED']) {
      expect(evaluateOrderableQuotes(status, lines, [both, onlyLive], today)).toEqual(evaluateQuotes(lines, [both, onlyLive], today));
    }
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
  it('só aprovado é emitido; recebido não se cancela — encerra-se', () => {
    expect(purchaseOrderActions({ status: 'APPROVED', governance: 'AUTHORITY', createdBy: 'u1', submittedBy: 'u1' }, caps, 'u1'))
      .toEqual(['issue', 'cancel']);
    expect(purchaseOrderActions({ status: 'PARTIALLY_RECEIVED', governance: 'AUTHORITY', createdBy: 'u1', submittedBy: 'u1' }, caps, 'u1'))
      .toEqual(['close']);
    expect(purchaseOrderActions({ status: 'ISSUED', governance: 'AUTHORITY', createdBy: 'u1', submittedBy: 'u1' }, caps, 'u1'))
      .toEqual(['cancel', 'close']);
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

/* ── 248: saldo aberto da requisição e o livro de liberações ─────────────── */

describe('Compras — saldo aberto da linha (248)', () => {
  const a = (requirementId: string, openQty: number) => ({ requirementId, openQty });
  it('linha com alocação: Σ aberto (liberada inteira → 0); sem alocação (manual): a quantidade da linha — sem arredondar', () => {
    expect(lineOpenQuantity(100, [a('r1', 60), a('r2', 0)])).toBe(60);
    expect(lineOpenQuantity(50, [a('r2', 0)])).toBe(0);
    expect(lineOpenQuantity(7, [])).toBe(7);
    expect(lineOpenQuantity(1, [a('r1', 33.33333), a('r2', 0.00003)])).toBeCloseTo(33.33336, 10);
  });
  it('necessidade da linha: a mais cedo dos requisitos EM ABERTO (a do liberado não conta); manual, a da linha', () => {
    const need = (id: string) => ({ r1: '2026-11-20', r2: '2026-11-10', r3: null }[id]);
    expect(lineRequiredBy({ requiredBy: '2026-11-10' }, [a('r1', 60), a('r2', 0)], need)).toBe('2026-11-20');
    expect(lineRequiredBy({ requiredBy: '2026-11-10' }, [a('r1', 60), a('r2', 5)], need)).toBe('2026-11-10');
    expect(lineRequiredBy({ requiredBy: '2026-11-10' }, [a('r3', 5)], need)).toBeNull();
    expect(lineRequiredBy({ requiredBy: '2026-12-01' }, [], need)).toBe('2026-12-01');
  });
  it('em cotação = a regra do banco: ABERTA, ou DECIDIDA cujo pedido não cancelado pediu a linha', () => {
    expect([lineInLiveRfq('OPEN', false), lineInLiveRfq('OPEN', true), lineInLiveRfq('DECIDED', true), lineInLiveRfq('DECIDED', false),
      lineInLiveRfq('CANCELLED', true), lineInLiveRfq(undefined, true)]).toEqual([true, true, true, false, false, false]);
  });
  it('a linha pedida pela decisão: decisão → pedido NÃO cancelado → linha do pedido para a linha da requisição', () => {
    const ordersLine = rfqOrderedLines(
      [{ id: 'd1', rfq_id: 'rfq-1' }, { id: 'd2', rfq_id: 'rfq-2' }, { id: 'd3', rfq_id: 'rfq-3' }],
      [{ id: 'po-1', sourcing_decision_id: 'd1', status: 'ISSUED' }, { id: 'po-2', sourcing_decision_id: 'd2', status: 'CANCELLED' },
        { id: 'po-3', sourcing_decision_id: 'd3', status: 'DRAFT' }, { id: 'po-manual', sourcing_decision_id: null, status: 'ISSUED' }],
      [{ purchase_order_id: 'po-1', requisition_line_id: 'X' }, { purchase_order_id: 'po-2', requisition_line_id: 'Y' },
        { purchase_order_id: 'po-3', requisition_line_id: 'Z' }, { purchase_order_id: 'po-manual', requisition_line_id: 'Y' },
        { purchase_order_id: 'po-1', requisition_line_id: null }],
    );
    // f3: o pedido da decisão da rfq-1 pediu X, não Y — Y volta a poder ser cotada
    expect([ordersLine('rfq-1', 'X'), ordersLine('rfq-1', 'Y')]).toEqual([true, false]);
    // pedido cancelado não prende; pedido ainda em rascunho (não cancelado) prende; pedido sem decisão não é de cotação
    expect([ordersLine('rfq-2', 'Y'), ordersLine('rfq-3', 'Z'), ordersLine('rfq-9', 'Y')]).toEqual([false, true, false]);
  });
  it('a linha da cotação vira pedido: requisição SUBMITTED/SOURCING e saldo aberto > 0 (a régua da decisão no banco)', () => {
    expect([rfqLineOrderable('SUBMITTED', 1), rfqLineOrderable('SOURCING', 0.00003), rfqLineOrderable('SOURCING', 0),
      rfqLineOrderable('CANCELLED', 50), rfqLineOrderable('CLOSED', 50), rfqLineOrderable('ORDERED', 50), rfqLineOrderable(undefined, 50),
      rfqLineOrderable('SUBMITTED', null)]).toEqual([true, true, false, false, false, false, false, false]);
  });
  it('liberações da linha: uma por (etapa, causa, pedido), na ordem do livro; estranha ou zerada fica fora', () => {
    const order = (id: string) => ({ 'po-a': 'OC-A', 'po-b': 'OC-B' }[id]);
    expect(lineReleases([
      { stage: 'PO_CANCELLED', cause: 'COVERED', purchase_order_id: 'po-b', quantity: '50', created_at: '2026-09-25T10:00:00Z' },
      { stage: 'PO_ISSUED', cause: 'NOT_ORDERED', purchase_order_id: 'po-a', quantity: '40.0000', created_at: '2026-09-20T10:00:00Z' },
      { stage: 'PO_CANCELLED', cause: 'COVERED', purchase_order_id: 'po-b', quantity: '0.00003', created_at: '2026-09-25T10:00:00Z' },
      { stage: 'PO_CANCELLED', cause: 'REQUIREMENT_INACTIVE', purchase_order_id: 'po-x', quantity: '5', created_at: '2026-09-25T11:00:00Z' },
      { stage: 'OUTRA', cause: 'COVERED', purchase_order_id: 'po-b', quantity: '9', created_at: '2026-09-25T10:00:00Z' },
      { stage: 'PO_ISSUED', cause: 'NOT_ORDERED', purchase_order_id: 'po-a', quantity: '0', created_at: '2026-09-25T10:00:00Z' },
    ], order)).toEqual([
      { stage: 'PO_ISSUED', cause: 'NOT_ORDERED', quantity: 40, orderNumber: 'OC-A' },
      { stage: 'PO_CANCELLED', cause: 'COVERED', quantity: 50.00003, orderNumber: 'OC-B' },
      { stage: 'PO_CANCELLED', cause: 'REQUIREMENT_INACTIVE', quantity: 5, orderNumber: null },
    ]);
  });
  it('a nota do liberado: "não pedidos no OC-…" / "liberados no cancelamento do OC-…", sem arredondar; nada liberado → null', () => {
    expect(releaseNote([{ stage: 'PO_ISSUED', quantity: 40, orderNumber: 'OC-260926-5A811' }], 'm')).toBe('40 m não pedidos no OC-260926-5A811');
    expect(releaseNote([{ stage: 'PO_CANCELLED', quantity: 40, orderNumber: 'OC-1' }, { stage: 'PO_CANCELLED', quantity: 0.00003, orderNumber: 'OC-1' },
      { stage: 'PO_ISSUED', quantity: 1200, orderNumber: 'OC-0' }], 'm'))
      .toBe('40,00003 m liberados no cancelamento do OC-1; 1.200 m não pedidos no OC-0');
    expect(releaseNote([{ stage: 'PO_CANCELLED', quantity: 3, orderNumber: null }], null)).toBe('3 liberados no cancelamento do pedido');
    expect(releaseNote([], 'm')).toBeNull();
    expect(releaseNote([{ stage: 'PO_ISSUED', quantity: 0, orderNumber: 'OC-1' }], 'm')).toBeNull();
  });
});

describe('Compras — banco ainda sem a 248 (a visão e o livro)', () => {
  afterEach(() => resetRequisition248Fallback());
  const VIEW = 'purchase_requisition_open_allocations';
  it('só "a relação não existe" (PGRST205 / 42P01), e só do objeto nomeado; coluna, permissão e outros erros não', () => {
    expect(isMissing248Relation({ code: 'PGRST205', message: `Could not find the table 'public.${VIEW}' in the schema cache` }, VIEW)).toBe(true);
    expect(isMissing248Relation({ code: '42P01', message: `relation "${VIEW}" does not exist` }, VIEW)).toBe(true);
    // a mensagem embrulhada por `selectIn`/`byIds` (sem o código) ainda é reconhecida
    expect(isMissing248Relation(new Error(`alocações: Could not find the table 'public.${VIEW}' in the schema cache`), VIEW)).toBe(true);
    expect(isMissing248Relation({ code: 'PGRST205', message: "Could not find the table 'public.outra' in the schema cache" }, VIEW)).toBe(false);
    expect(isMissing248Relation({ code: '42703', message: `column ${VIEW}.open_qty does not exist` }, VIEW)).toBe(false);
    expect(isMissing248Relation(new Error(`column ${VIEW}.open_qty does not exist`), VIEW)).toBe(false);
    expect(isMissing248Relation({ code: '42501', message: `permission denied for view ${VIEW}` }, VIEW)).toBe(false);
    expect(isMissing248Relation({ code: '42501', message: `relation "${VIEW}" does not exist` }, VIEW)).toBe(false);
    expect(isMissing248Relation(null, VIEW)).toBe(false);
  });
  it('a visão: números crus; sem ela, a tabela com aberto = alocado — lembrado por um minuto; outro erro SOBE', async () => {
    const view = { allocation_id: 'a1', requisition_id: 'rq', requisition_line_id: 'l1', requirement_id: 'r1', allocated_qty: '100.0000',
      released_qty: '40.0000', open_qty: '60.0000' };
    const base = { id: 'a1', line_id: 'l1', requirement_id: 'r1', quantity: '100.0000' };
    const sources: string[] = [];
    let t = 1_000;
    const read = (missing: boolean) => async (src: AllocationSource) => {
      sources.push(src.table);
      if (!src.before248 && missing) throw new Error(`rastro: Could not find the table 'public.${VIEW}' in the schema cache`);
      return [src.before248 ? base : view];
    };
    expect(await readOpenAllocations(read(false), () => t)).toEqual([
      { allocationId: 'a1', requisitionLineId: 'l1', requirementId: 'r1', allocatedQty: 100, releasedQty: 40, openQty: 60 }]);
    expect(await readOpenAllocations(read(true), () => t)).toEqual([
      { allocationId: 'a1', requisitionLineId: 'l1', requirementId: 'r1', allocatedQty: 100, releasedQty: 0, openQty: 100 }]);
    // lembrado: direto à tabela; e o livro nem é perguntado
    sources.length = 0;
    await readOpenAllocations(read(true), () => t + REQUISITION_248_RETRY_MS - 1);
    expect(sources).toEqual([ALLOCATIONS_BEFORE_248.table]);
    expect(await readRequisitionReleases(async () => { throw new Error('não deveria ler'); }, () => t)).toEqual([]);
    // passado o minuto, a visão é tentada de novo
    sources.length = 0; t += REQUISITION_248_RETRY_MS;
    await readOpenAllocations(read(false), () => t);
    expect(sources).toEqual([OPEN_ALLOCATIONS_248.table]);
    await expect(readOpenAllocations(async () => { throw new Error('timeout'); }, () => t)).rejects.toThrow('timeout');
  });
  it('o livro: sem ele, nenhuma liberação; outro erro SOBE', async () => {
    const missing = { code: 'PGRST205', message: "Could not find the table 'public.procurement_requisition_releases' in the schema cache" };
    expect(await readRequisitionReleases(async () => { throw missing; })).toEqual([]);
    resetRequisition248Fallback();
    await expect(readRequisitionReleases(async () => { throw new Error('permission denied for table procurement_requisition_releases'); }))
      .rejects.toThrow('permission denied');
  });
});

describe('Compras — a leitura das solicitações (248)', () => {
  afterEach(() => resetRequisition248Fallback());
  type Spec = { rows?: Array<Record<string, unknown>>; error?: string; window?: (r: Record<string, unknown>) => boolean };
  type Call = { table: string; ops: Array<[string, unknown[]]> };
  /** Cliente falso: `eq`/`in` filtram as colunas presentes; `or` é a janela de 90 dias da tabela. */
  function fakeClient(tables: Record<string, Spec>, calls: Call[] = []) {
    return {
      from: (table: string) => {
        const call: Call = { table, ops: [] };
        calls.push(call);
        const chain: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'in', 'or', 'order', 'limit', 'range']) chain[m] = (...args: unknown[]) => { call.ops.push([m, args]); return chain; };
        chain.then = (resolve: (v: unknown) => unknown) => {
          const spec = tables[table] ?? { rows: [] };
          if (spec.error) return resolve({ data: null, error: { message: spec.error } });
          let rows = spec.rows ?? [];
          for (const [m, args] of call.ops) {
            const [col, val] = args as [string, unknown];
            if (m === 'eq') rows = rows.filter((r) => !(col in r) || r[col] === val);
            if (m === 'in') rows = rows.filter((r) => !(col in r) || (val as unknown[]).includes(r[col]));
            if (m === 'or' && spec.window) rows = rows.filter(spec.window);
            if (m === 'range') rows = rows.slice(args[0] as number, (args[1] as number) + 1);
          }
          return resolve({ data: rows, error: null });
        };
        return chain;
      },
    };
  }
  const TODAY = '2026-09-25';
  const recent = (r: Record<string, unknown>) => String(r.created_at) >= '2026-06-27';
  const alloc = (id: string, line: string, requirement: string, allocated: number, released: number) => ({ organization_id: 'o',
    allocation_id: id, requisition_id: 'rq-1', requisition_line_id: line, requirement_id: requirement, allocated_qty: String(allocated),
    released_qty: String(released), open_qty: String(allocated - released) });
  const tables = (over: Record<string, Spec> = {}): Record<string, Spec> => ({
    // requisição antiga (fora dos 90 dias) ainda em cotação: lida pelo estado
    purchase_requisitions: { rows: [{ organization_id: 'o', id: 'rq-1', requisition_number: 'RC-1', project_id: null, source: 'SHORTAGE',
      status: 'SOURCING', priority: 'medium', required_by: '2026-09-28', requested_at: '2026-05-01T10:00:00Z', close_reason: null }] },
    purchase_requisition_lines: { rows: [
      { organization_id: 'o', id: 'l1', requisition_id: 'rq-1', item_id: 'i1', quantity: '100', required_by: '2026-10-01' },
      { organization_id: 'o', id: 'l2', requisition_id: 'rq-1', item_id: 'i1', quantity: '60', required_by: '2026-09-28' },
      { organization_id: 'o', id: 'l3', requisition_id: 'rq-1', item_id: 'i2', quantity: '7', required_by: '2026-10-02' },
      { organization_id: 'o', id: 'l4', requisition_id: 'rq-1', item_id: 'i1', quantity: '20', required_by: '2026-10-03' },
    ] },
    purchase_requisition_open_allocations: { rows: [
      alloc('a1', 'l1', 'r1', 100, 40), alloc('a2', 'l2', 'r2', 50, 50), alloc('a2b', 'l2', 'r3', 10, 10), alloc('a4', 'l4', 'r1', 20, 0)] },
    purchase_requisition_line_requirements: { rows: [
      { organization_id: 'o', id: 'a1', line_id: 'l1', requirement_id: 'r1', quantity: '100' },
      { organization_id: 'o', id: 'a2', line_id: 'l2', requirement_id: 'r2', quantity: '50' },
      { organization_id: 'o', id: 'a2b', line_id: 'l2', requirement_id: 'r3', quantity: '10' },
      { organization_id: 'o', id: 'a4', line_id: 'l4', requirement_id: 'r1', quantity: '20' }] },
    procurement_requisition_releases: { rows: [
      { organization_id: 'o', id: 'rl-1', requisition_line_id: 'l1', allocation_id: 'a1', requirement_id: 'r1', purchase_order_id: 'po-old',
        stage: 'PO_ISSUED', cause: 'NOT_ORDERED', quantity: '40', created_at: '2026-05-10T10:00:00Z' },
      { organization_id: 'o', id: 'rl-2', requisition_line_id: 'l2', allocation_id: 'a2', requirement_id: 'r2', purchase_order_id: 'po-9',
        stage: 'PO_CANCELLED', cause: 'COVERED', quantity: '50', created_at: '2026-09-20T10:00:00Z' },
      { organization_id: 'o', id: 'rl-3', requisition_line_id: 'l2', allocation_id: 'a2b', requirement_id: 'r3', purchase_order_id: 'po-9',
        stage: 'PO_CANCELLED', cause: 'COVERED', quantity: '10', created_at: '2026-09-20T10:00:00Z' },
    ] },
    procurement_rfqs: { window: (r) => r.status === 'OPEN' || recent(r), rows: [
      { organization_id: 'o', id: 'rfq-c', rfq_number: 'COT-C', status: 'CANCELLED', created_at: '2026-09-15T10:00:00Z' },
      // mais velhas que 90 dias: fora da janela, mas o estado delas decide "em cotação"
      { organization_id: 'o', id: 'rfq-old', rfq_number: 'COT-OLD', status: 'DECIDED', created_at: '2026-05-02T10:00:00Z' },
      { organization_id: 'o', id: 'rfq-old-x', rfq_number: 'COT-OLD-X', status: 'CANCELLED', created_at: '2026-05-02T10:00:00Z' },
    ] },
    procurement_rfq_lines: { rows: [
      { organization_id: 'o', id: 'x1', rfq_id: 'rfq-old', requisition_line_id: 'l1', item_id: 'i1', quantity: '100' },
      { organization_id: 'o', id: 'x2', rfq_id: 'rfq-c', requisition_line_id: 'l2', item_id: 'i1', quantity: '60' },
      { organization_id: 'o', id: 'x4', rfq_id: 'rfq-old-x', requisition_line_id: 'l4', item_id: 'i1', quantity: '20' },
    ] },
    purchase_orders: { window: (r) => ['DRAFT', 'APPROVAL_REQUIRED', 'APPROVED', 'ISSUED', 'PARTIALLY_RECEIVED'].includes(String(r.status)) || recent(r),
      rows: [
        { organization_id: 'o', id: 'po-9', order_number: 'OC-9', supplier_id: 's1', status: 'CANCELLED', created_at: '2026-09-15T10:00:00Z' },
        { organization_id: 'o', id: 'po-old', order_number: 'OC-OLD', supplier_id: 's1', status: 'RECEIVED', created_at: '2026-05-10T10:00:00Z',
          sourcing_decision_id: 'd-old' },
      ] },
    // a decisão da cotação velha e o pedido dela, que pediu a linha l1 (fora das janelas: lidos pela linha e pela cotação)
    sourcing_decisions: { rows: [{ organization_id: 'o', id: 'd-old', rfq_id: 'rfq-old', quote_id: 'q-old', rationale: 'r',
      follows_recommendation: true, decided_at: '2026-05-05T10:00:00Z' }] },
    purchase_order_lines: { rows: [{ organization_id: 'o', id: 'pl-old', purchase_order_id: 'po-old', requisition_line_id: 'l1', item_id: 'i1',
      quantity: '60', unit_price: '10', expected_date: null, received_quantity: '60' }] },
    project_requirements: { rows: ['r1', 'r2', 'r3'].map((id) => ({ organization_id: 'o', id, title: `Requisito ${id}`, project_id: 'p1',
      required_by: '2026-10-01' })) },
    supply_items: { rows: [{ organization_id: 'o', id: 'i1', code: 'CABO', description: 'Cabo', unit: 'm' },
      { organization_id: 'o', id: 'i2', code: 'PARAF', description: 'Parafuso', unit: 'un' }] },
    ...over,
  });

  it('cada linha: o requisitado, o EM ABERTO, as liberações com o nº do pedido (mesmo antigo) e "em cotação" pelo estado da cotação de qualquer idade', async () => {
    const calls: Call[] = [];
    const m = await procurementWorkspace({ supabase: fakeClient(tables(), calls) as never, organizationId: 'o' }, TODAY);
    const lines = m.requisitions[0].lines;
    expect(lines.map((l) => [l.id, l.quantity, l.openQuantity, l.inRfq])).toEqual([
      ['l1', 100, 60, true], // cotação DECIDIDA de 5 meses atrás cujo pedido (não cancelado) pediu a linha: segue em cotação
      ['l2', 60, 0, false], // tudo liberado no cancelamento; a cotação foi cancelada
      ['l3', 7, 7, false], // manual: o aberto é a linha
      ['l4', 20, 20, false], // cotação velha CANCELADA: não prende a linha
    ]);
    expect(lines[0].releases).toEqual([{ stage: 'PO_ISSUED', cause: 'NOT_ORDERED', quantity: 40, orderNumber: 'OC-OLD' }]);
    expect(lines[1].releases).toEqual([{ stage: 'PO_CANCELLED', cause: 'COVERED', quantity: 60, orderNumber: 'OC-9' }]);
    expect(lines[2].releases).toEqual([]);
    expect(lines[0].requirements).toEqual([{ requirementId: 'r1', title: 'Requisito r1', quantity: 100, openQuantity: 60 }]);
    expect(lines[1].requirements.map((q) => [q.requirementId, q.quantity, q.openQuantity])).toEqual([['r2', 50, 0], ['r3', 10, 0]]);
    // o que ficou fora das janelas é lido pelo id — só o que faltava, sempre no inquilino
    const byId = (table: string) => calls.filter((c) => c.table === table && c.ops.some(([op, a]) => op === 'in' && a[0] === 'id'))
      .flatMap((c) => c.ops.filter(([op, a]) => op === 'in' && a[0] === 'id').flatMap(([, a]) => a[1] as string[]));
    expect(byId('procurement_rfqs').sort()).toEqual(['rfq-old', 'rfq-old-x']);
    expect(byId('purchase_orders')).toEqual(['po-old']);
    for (const c of calls) expect(c.ops.some(([op, a]) => op === 'eq' && a[0] === 'organization_id' && a[1] === 'o'), c.table).toBe(true);
  });

  /*
    A regra da cotação viva, a data e o que vira pedido (FIX-249). RC-2 (em cotação) tem:
      lx — R1 100 em aberto + R2 30 liberado; a data da linha é a do R2 (20/09, a mais cedo quando nasceu);
      ly — R3 50: a cotação COT-D foi DECIDIDA, mas a proposta vencedora não cotou ly — o OC-D nasceu só com lx (f3);
      lz — R1 20: a cotação COT-K foi DECIDIDA e o pedido dela, cancelado;
      lw — R3 10: numa cotação ABERTA (COT-O) com a linha ld da RC-DEAD, cancelada há meses (fora da janela).
  */
  const liveTables = () => {
    const alloc2 = (id: string, line: string, requirement: string, allocated: number, released: number) => ({
      ...alloc(id, line, requirement, allocated, released), requisition_id: line === 'ld' ? 'rq-dead' : 'rq-2' });
    const line = (id: string, requisition: string, item: string, quantity: number, requiredBy: string) => ({ organization_id: 'o', id,
      requisition_id: requisition, item_id: item, quantity: String(quantity), required_by: requiredBy });
    const rfqLine = (id: string, rfq: string, requisitionLine: string, quantity: number, requiredBy: string) => ({ organization_id: 'o', id,
      rfq_id: rfq, requisition_line_id: requisitionLine, item_id: 'i1', quantity: String(quantity), required_by: requiredBy });
    const quoteRow = (id: string, supplier: string) => ({ organization_id: 'o', id, rfq_id: 'rfq-o', supplier_id: supplier, version: 1,
      status: 'RECEIVED', currency: 'BRL', freight_amount: '0', tax_amount: '0', payment_terms: null, validity_date: '2099-01-01',
      lead_time_days: 5, deviations: null, recorded_at: '2026-09-24T10:00:00Z' });
    const quoteLine = (quote: string, rfqLineId: string, unitPrice: number, quantity: number) => ({ organization_id: 'o', quote_id: quote,
      rfq_line_id: rfqLineId, unit_price: String(unitPrice), quantity: String(quantity), lead_time_days: null, compliant: true, note: null });
    return tables({
      purchase_requisitions: { window: (r) => ['SUBMITTED', 'SOURCING'].includes(String(r.status)) || String(r.requested_at) >= '2026-06-27',
        rows: [
          { organization_id: 'o', id: 'rq-2', requisition_number: 'RC-2', project_id: null, source: 'SHORTAGE', status: 'SOURCING', priority: 'medium',
            required_by: '2026-09-20', requested_at: '2026-09-20T10:00:00Z', close_reason: null },
          { organization_id: 'o', id: 'rq-dead', requisition_number: 'RC-DEAD', project_id: null, source: 'SHORTAGE', status: 'CANCELLED',
            priority: 'medium', required_by: '2026-09-26', requested_at: '2026-04-01T10:00:00Z', close_reason: null },
        ] },
      purchase_requisition_lines: { rows: [
        line('lx', 'rq-2', 'i1', 130, '2026-09-20'), line('ly', 'rq-2', 'i2', 50, '2026-10-05'), line('lz', 'rq-2', 'i1', 20, '2026-10-01'),
        line('lw', 'rq-2', 'i1', 10, '2026-10-05'), line('ld', 'rq-dead', 'i1', 50, '2026-09-26')] },
      purchase_requisition_open_allocations: { rows: [
        alloc2('ax2', 'lx', 'r2', 30, 30), alloc2('ax', 'lx', 'r1', 100, 0), alloc2('ay', 'ly', 'r3', 50, 0), alloc2('az', 'lz', 'r1', 20, 0),
        alloc2('aw', 'lw', 'r3', 10, 0), alloc2('ad', 'ld', 'r4', 50, 0)] },
      procurement_requisition_releases: { rows: [] },
      procurement_rfqs: { window: (r) => r.status === 'OPEN' || recent(r), rows: [
        { organization_id: 'o', id: 'rfq-d', rfq_number: 'COT-D', status: 'DECIDED', created_at: '2026-09-21T10:00:00Z' },
        { organization_id: 'o', id: 'rfq-k', rfq_number: 'COT-K', status: 'DECIDED', created_at: '2026-09-22T10:00:00Z' },
        { organization_id: 'o', id: 'rfq-o', rfq_number: 'COT-O', status: 'OPEN', created_at: '2026-09-23T10:00:00Z' },
      ] },
      procurement_rfq_lines: { rows: [
        rfqLine('dx', 'rfq-d', 'lx', 100, '2026-10-01'), rfqLine('dy', 'rfq-d', 'ly', 50, '2026-10-05'), rfqLine('kz', 'rfq-k', 'lz', 20, '2026-10-01'),
        rfqLine('ow', 'rfq-o', 'lw', 10, '2026-10-05'), rfqLine('od', 'rfq-o', 'ld', 50, '2026-09-26')] },
      sourcing_decisions: { rows: [
        { organization_id: 'o', id: 'dec-d', rfq_id: 'rfq-d', quote_id: 'q-d', rationale: 'r', follows_recommendation: true, decided_at: '2026-09-21T12:00:00Z' },
        { organization_id: 'o', id: 'dec-k', rfq_id: 'rfq-k', quote_id: 'q-k', rationale: 'r', follows_recommendation: true, decided_at: '2026-09-22T12:00:00Z' },
      ] },
      purchase_orders: { window: (r) => ['DRAFT', 'APPROVAL_REQUIRED', 'APPROVED', 'ISSUED', 'PARTIALLY_RECEIVED'].includes(String(r.status)) || recent(r),
        rows: [
          { organization_id: 'o', id: 'po-d', order_number: 'OC-D', supplier_id: 's1', status: 'ISSUED', sourcing_decision_id: 'dec-d',
            created_at: '2026-09-21T12:00:00Z' },
          { organization_id: 'o', id: 'po-k', order_number: 'OC-K', supplier_id: 's1', status: 'CANCELLED', sourcing_decision_id: 'dec-k',
            created_at: '2026-09-22T12:00:00Z' },
        ] },
      purchase_order_lines: { rows: [
        { organization_id: 'o', id: 'pl-d', purchase_order_id: 'po-d', requisition_line_id: 'lx', item_id: 'i1', quantity: '100', unit_price: '10',
          expected_date: null, received_quantity: '0' },
        { organization_id: 'o', id: 'pl-k', purchase_order_id: 'po-k', requisition_line_id: 'lz', item_id: 'i1', quantity: '20', unit_price: '10',
          expected_date: null, received_quantity: '0' },
      ] },
      supplier_quotes: { rows: [quoteRow('q-both', 's1'), quoteRow('q-live', 's2')] },
      supplier_quote_lines: { rows: [quoteLine('q-both', 'ow', 10, 10), quoteLine('q-both', 'od', 10, 50), quoteLine('q-live', 'ow', 11, 10)] },
      project_requirements: { rows: [['r1', '2026-10-01'], ['r2', '2026-09-20'], ['r3', '2026-10-05'], ['r4', '2026-09-26']].map(([id, date]) => ({
        organization_id: 'o', id, title: `Requisito ${id}`, project_id: 'p1', required_by: date })) },
    });
  };

  it('em cotação = a regra do banco: DECIDIDA sem pedir a linha (f3) ou com o pedido cancelado não prende; decidida que pediu, sim', async () => {
    const m = await procurementWorkspace({ supabase: fakeClient(liveTables()) as never, organizationId: 'o' }, TODAY);
    expect(m.requisitions.map((r) => r.number)).toEqual(['RC-2']);
    expect(m.requisitions[0].lines.map((l) => [l.id, l.openQuantity, l.inRfq])).toEqual([
      ['lx', 100, true], // COT-D decidida e o OC-D (emitido) pediu lx
      ['ly', 50, false], // f3: COT-D decidida, mas o OC-D nasceu sem ly — volta a poder ser cotada ("sem cotação", marcável)
      ['lz', 20, false], // COT-K decidida, mas o pedido dela foi cancelado
      ['lw', 10, true], // COT-O aberta
    ]);
  });

  it('a necessidade da linha é a dos requisitos EM ABERTO; o liberado fica na lista só como histórico (aberto 0), depois dos vivos', async () => {
    const m = await procurementWorkspace({ supabase: fakeClient(liveTables()) as never, organizationId: 'o' }, TODAY);
    const [lx, ly] = m.requisitions[0].lines;
    // a linha guarda 20/09 (a data do R2, liberado); a necessidade viva é a do R1
    expect(lx.requiredBy).toBe('2026-10-01');
    expect(ly.requiredBy).toBe('2026-10-05');
    expect(lx.requirements.map((q) => [q.requirementId, q.quantity, q.openQuantity])).toEqual([['r1', 100, 100], ['r2', 30, 0]]);
  });

  it('cotação ABERTA: a linha de requisição morta fica fora do pedido — quem cota só as vivas é completo e elegível; o custo posto não conta a morta', async () => {
    const calls: Call[] = [];
    const m = await procurementWorkspace({ supabase: fakeClient(liveTables(), calls) as never, organizationId: 'o' }, TODAY);
    const open = m.rfqs.find((q) => q.number === 'COT-O');
    if (!open) throw new Error('COT-O');
    expect(open.lines.map((l) => [l.id, l.requisitionLineId, l.orderable])).toEqual([['ow', 'lw', true], ['od', 'ld', false]]);
    const by = Object.fromEntries(open.evaluations.map((e) => [e.quoteId, e]));
    expect(by['q-live']).toMatchObject({ complete: true, eligible: true, goods: 110, landed: 110, lateDays: 0 });
    // o preço da linha morta (50 × 10) não entra; a necessidade dela (26/09) também não
    expect(by['q-both']).toMatchObject({ complete: true, eligible: true, goods: 100, landed: 100, lateDays: 0 });
    expect(open.recommendation?.quoteId).toBe('q-both');
    // a requisição da linha morta (fora da janela) foi lida pelo id, no inquilino — só o que faltava
    const byId = (table: string) => calls.filter((c) => c.table === table).flatMap((c) => c.ops
      .filter(([op, a]) => op === 'in' && a[0] === 'id').flatMap(([, a]) => a[1] as string[]));
    expect(byId('purchase_requisition_lines')).toEqual(['ld']);
    expect(byId('purchase_requisitions')).toEqual(['rq-dead']);
    for (const c of calls) expect(c.ops.some(([op, a]) => op === 'eq' && a[0] === 'organization_id' && a[1] === 'o'), c.table).toBe(true);
  });

  it('banco sem a 248: aberto = requisitado pelas alocações, nenhuma liberação; lembrado; outro erro continua erro', async () => {
    const calls: Call[] = [];
    const m = await procurementWorkspace({ supabase: fakeClient(tables({
      purchase_requisition_open_allocations: { error: "Could not find the table 'public.purchase_requisition_open_allocations' in the schema cache" },
      procurement_requisition_releases: { error: "Could not find the table 'public.procurement_requisition_releases' in the schema cache" },
    }), calls) as never, organizationId: 'o' }, TODAY);
    expect(m.requisitions[0].lines.map((l) => [l.id, l.openQuantity, l.releases])).toEqual([
      ['l1', 100, []], ['l2', 60, []], ['l3', 7, []], ['l4', 20, []]]);
    // lembrado: a próxima leitura vai direto à tabela, e o livro nem é perguntado
    const again: Call[] = [];
    await procurementWorkspace({ supabase: fakeClient(tables(), again) as never, organizationId: 'o' }, TODAY);
    expect(again.map((c) => c.table)).not.toContain('purchase_requisition_open_allocations');
    expect(again.map((c) => c.table)).not.toContain('procurement_requisition_releases');
    // outro erro na visão nunca cai para a tabela: a leitura de Compras falha (a tela diz que não leu)
    resetRequisition248Fallback();
    await expect(procurementWorkspace({ supabase: fakeClient(tables({ purchase_requisition_open_allocations: { error: 'timeout' } })) as never,
      organizationId: 'o' }, TODAY)).rejects.toThrow();
  });
});
