/**
 * FIX-249 — POST /api/supply/procurement/rfqs/[id] (hermético: o banco, a
 * sessão e a auditoria simulados). Decidir (248) devolve as linhas cotadas
 * que NÃO entraram no pedido (`not_ordered`: requisição cancelada, encerrada
 * ou pedida, ou linha sem saldo aberto):
 *  1. o retorno vai como veio em `result` (a tela monta o aviso dele);
 *  2. a auditoria registra `not_ordered` (a requisição, o estado dela e o
 *     aberto cru, sem arredondar), `replayed`, o pedido e se seguiu a
 *     recomendação; réplica ou banco sem a 248: `null`, nunca `[]`;
 *  3. registrar proposta segue auditando só a versão.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  inventoryAct: vi.fn(),
  logAuditEventServer: vi.fn(),
  requireAnyOperationsPermission: vi.fn(),
}));

vi.mock('@/lib/platform/server-client', () => ({
  platformServiceClient: () => { throw new Error('o banco é simulado por inventoryAct'); },
}));
vi.mock('@/lib/supply/service', () => ({ inventoryAct: mocks.inventoryAct, supplyRpc: vi.fn() }));
vi.mock('@/lib/audit/log-audit-event-server', () => ({ logAuditEventServer: mocks.logAuditEventServer }));
vi.mock('@/lib/operations/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/operations/session')>()),
  requireAnyOperationsPermission: mocks.requireAnyOperationsPermission,
}));

import { decideAuditMetadata } from '@/lib/supply/procurement';

const RFQ = '55555555-5555-4555-8555-555555555555';
const QUOTE = '66666666-6666-4666-8666-666666666666';
const OTHER = '77777777-7777-4777-8777-777777777777';
const SUP = '88888888-8888-4888-8888-888888888888';
const LINE = '99999999-9999-4999-8999-999999999999';

const post = (body: unknown) => new Request(`http://x/api/supply/procurement/rfqs/${RFQ}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const ctx = { params: Promise.resolve({ id: RFQ }) };
async function route() {
  return (await import('@/app/api/supply/procurement/rfqs/[id]/route')).POST;
}

/** O retorno de `procurement_decide` (248), caso B2: a RC-B foi cancelada; a linha dela não virou pedido. */
const DECIDED = {
  decision_id: 'dec-1', purchase_order_id: 'po-1', order_number: 'OC-260926-AAAAA', replayed: false,
  not_ordered: [{ quote_line_id: 'ql-y', requisition_line_id: 'rql-y', requisition_id: 'rq-b', requisition_number: 'RC-260926-BBBBB',
    requisition_status: 'CANCELLED', open_qty: '50.0000' }],
};

describe('POST /api/supply/procurement/rfqs/[id] — decidir (248: o que não vira pedido)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAnyOperationsPermission.mockResolvedValue({
      organizationId: 'org-1', user: { id: 'u-1' }, supabase: {}, permissions: new Set(['procurement.source']),
    });
    mocks.logAuditEventServer.mockResolvedValue({ ok: true });
  });

  it('o retorno vai como veio em `result`; a auditoria registra `not_ordered` (aberto cru), o pedido e a recomendação', async () => {
    mocks.inventoryAct.mockResolvedValue(DECIDED);
    const res = await (await route())(post({ action: 'decide', quoteId: QUOTE, recommendedQuoteId: OTHER,
      rationale: 'Prazo melhor para a obra, mesmo mais caro' }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result: DECIDED });
    expect(mocks.inventoryAct).toHaveBeenCalledWith('procurement_decide', 'org-1', 'u-1', { p_payload: expect.objectContaining({
      quote_id: QUOTE, recommended_quote_id: OTHER, rfq_id: RFQ }) });
    expect(mocks.logAuditEventServer).toHaveBeenCalledWith(expect.objectContaining({
      action: 'supply.sourcing.decided', entityType: 'sourcing_decision', entityId: 'dec-1',
      metadata: {
        purchase_order_id: 'po-1', follows_recommendation: false, replayed: false,
        not_ordered: [{ quote_line_id: 'ql-y', requisition_line_id: 'rql-y', requisition_id: 'rq-b', requisition_number: 'RC-260926-BBBBB',
          requisition_status: 'CANCELLED', open_qty: 50 }],
      },
    }), expect.anything());
  });

  it('tudo virou pedido: `not_ordered` []; réplica ou banco sem a 248 (sem a lista): `null`, nunca []', async () => {
    const POST = await route();
    mocks.inventoryAct.mockResolvedValueOnce({ ...DECIDED, not_ordered: [] });
    await POST(post({ action: 'decide', quoteId: QUOTE, recommendedQuoteId: QUOTE, rationale: 'Menor custo e no prazo' }), ctx);
    expect(mocks.logAuditEventServer.mock.calls[0][0].metadata).toEqual({ purchase_order_id: 'po-1', follows_recommendation: true,
      replayed: false, not_ordered: [] });

    mocks.inventoryAct.mockResolvedValueOnce({ decision_id: 'dec-1', purchase_order_id: 'po-1', order_number: 'OC-260926-AAAAA', replayed: true });
    await POST(post({ action: 'decide', quoteId: QUOTE, rationale: 'Menor custo e no prazo' }), ctx);
    expect(mocks.logAuditEventServer.mock.calls[1][0].metadata).toEqual({ purchase_order_id: 'po-1', follows_recommendation: true,
      replayed: true, not_ordered: null });
  });

  it('registrar proposta: a auditoria segue com a versão (nada de `not_ordered`)', async () => {
    mocks.inventoryAct.mockResolvedValue({ quote_id: 'q-9', version: 2 });
    await (await route())(post({ action: 'quote', supplierId: SUP, lines: [{ rfqLineId: LINE, unitPrice: '10' }] }), ctx);
    expect(mocks.logAuditEventServer.mock.calls[0][0]).toMatchObject({ action: 'supply.quote.recorded', entityType: 'supplier_quote',
      entityId: 'q-9', metadata: { version: 2 } });
  });

  it('a regra pura: quantidade crua (sem arredondar); linha estranha não inventa números', () => {
    expect(decideAuditMetadata({ quoteId: 'a', recommendedQuoteId: null }, {
      purchase_order_id: 'po', not_ordered: [{ requisition_number: 'RC-1', requisition_status: 'CLOSED', open_qty: '0.00003' }, { open_qty: 'x' }] }))
      .toEqual({ purchase_order_id: 'po', follows_recommendation: true, replayed: false, not_ordered: [
        { quote_line_id: null, requisition_line_id: null, requisition_id: null, requisition_number: 'RC-1', requisition_status: 'CLOSED',
          open_qty: 0.00003 },
        { quote_line_id: null, requisition_line_id: null, requisition_id: null, requisition_number: null, requisition_status: null, open_qty: null },
      ] });
  });
});
