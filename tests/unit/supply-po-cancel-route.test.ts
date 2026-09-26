/**
 * 248 — POST /api/supply/procurement/purchase-orders/[id] (hermético: o banco,
 * a sessão e a auditoria simulados):
 *  1. cancelar: o retorno de `purchase_order_cancel` vai como veio em
 *     `result`; a auditoria registra estado, o desfecho no motor de aprovação,
 *     cada requisito (item e unidade — nunca somas entre itens) e cada
 *     requisição (de → para); a réplica é marcada `replayed` (cancelamento
 *     anterior à 248: listas vazias; banco sem a 248: `null`, nunca `[]`);
 *  2. emitir: a auditoria registra o que a emissão parcial liberou;
 *  3. as recusas em português pela MESMA cadeia da rota (recebimento →
 *     estoque → compras, `inventoryFailure`): "has receipts" chega a compras
 *     (antes virava a frase da transferência despachada); cada recusa nova da
 *     248 tem a sua frase e nenhuma é engolida pelas regras do estoque.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  inventoryAct: vi.fn(),
  logAuditEventServer: vi.fn(),
  requireAnyOperationsPermission: vi.fn(),
  scheduleSubjectNotify: vi.fn(),
}));

vi.mock('@/lib/platform/server-client', () => ({
  platformServiceClient: () => { throw new Error('o banco é simulado por inventoryAct'); },
}));
vi.mock('@/lib/supply/service', () => ({ inventoryAct: mocks.inventoryAct, supplyRpc: vi.fn() }));
vi.mock('@/lib/decisions/notify', () => ({ scheduleSubjectNotify: mocks.scheduleSubjectNotify }));
vi.mock('@/lib/audit/log-audit-event-server', () => ({ logAuditEventServer: mocks.logAuditEventServer }));
vi.mock('@/lib/operations/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/operations/session')>()),
  requireAnyOperationsPermission: mocks.requireAnyOperationsPermission,
}));

import { GovernedRpcError } from '@/lib/platform/governed-rpc';
import { inventoryFailure } from '@/lib/supply/inventory-route';
import { inventoryErrorMessage } from '@/lib/supply/inventory';
import { receivingErrorMessage } from '@/lib/supply/receiving';
import { domainEventTitle } from '@/lib/operations/projects/timeline';

const PO = '44444444-4444-4444-8444-444444444444';
const REQ = '11111111-1111-4111-8111-111111111111';

const post = (body: unknown) => new Request(`http://x/api/supply/procurement/purchase-orders/${PO}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const ctx = { params: Promise.resolve({ id: PO }) };
async function route() {
  return (await import('@/app/api/supply/procurement/purchase-orders/[id]/route')).POST;
}

/** O retorno de `purchase_order_cancel` (248): caso a do contrato — 100 requeridos, OC de 60, RC-B com 40. */
const CANCELLED = {
  purchase_order_id: PO, status: 'CANCELLED', replayed: false, approval_request_status: null,
  requirements: [{ requirement_id: REQ, item_id: 'item-cabo', unit: 'm', reopened_qty: '60.0000', released_qty: '0', cause: null }],
  requisitions: [{ requisition_id: 'rq-a', requisition_number: 'RC-260926-AAAAA', status_from: 'ORDERED', status_to: 'SUBMITTED' }],
};

describe('POST /api/supply/procurement/purchase-orders/[id] — cancelar e emitir (248)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAnyOperationsPermission.mockResolvedValue({
      organizationId: 'org-1', user: { id: 'u-1' }, supabase: {}, permissions: new Set(['procurement.orders.issue']),
    });
    mocks.logAuditEventServer.mockResolvedValue({ ok: true });
  });

  it('cancelar: o desfecho vai como veio em `result`; a auditoria leva motor, requisitos (item e unidade) e requisições', async () => {
    mocks.inventoryAct.mockResolvedValue(CANCELLED);
    const res = await (await route())(post({ action: 'cancel', reason: '  Cliente adiou a obra  ' }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result: CANCELLED });
    expect(mocks.requireAnyOperationsPermission).toHaveBeenCalledWith(['procurement.orders.issue']);
    expect(mocks.inventoryAct).toHaveBeenCalledWith('purchase_order_cancel', 'org-1', 'u-1', { p_po_id: PO, p_reason: 'Cliente adiou a obra' });
    expect(mocks.logAuditEventServer).toHaveBeenCalledWith(expect.objectContaining({
      action: 'supply.purchase_order.cancel', entityType: 'purchase_order', entityId: PO,
      metadata: {
        status: 'CANCELLED', governance: null, replayed: false, approvalRequestStatus: null,
        requirements: [{ requirementId: REQ, itemId: 'item-cabo', unit: 'm', reopenedQty: 60, releasedQty: 0, cause: null }],
        requisitions: [{ requisitionId: 'rq-a', number: 'RC-260926-AAAAA', from: 'ORDERED', to: 'SUBMITTED' }],
      },
    }), expect.anything());
  });

  it('cancelar com liberação: quantidade crua (sem arredondar), causa e o motor de aprovação cancelado', async () => {
    mocks.inventoryAct.mockResolvedValue({ ...CANCELLED, approval_request_status: 'CANCELLED',
      requirements: [
        { requirement_id: REQ, item_id: 'item-cabo', unit: 'm', reopened_qty: '33.33333', released_qty: '0.00003', cause: 'COVERED' },
        { requirement_id: 'r2', item_id: 'item-disj', unit: 'un', reopened_qty: 0, released_qty: 50, cause: 'REQUIREMENT_INACTIVE' },
      ],
      requisitions: [{ requisition_id: 'rq-a', requisition_number: 'RC-A', status_from: 'SOURCING', status_to: 'CLOSED' }] });
    await (await route())(post({ action: 'cancel', reason: 'Requisito cancelado' }), ctx);
    expect(mocks.logAuditEventServer.mock.calls[0][0].metadata).toMatchObject({ approvalRequestStatus: 'CANCELLED',
      requirements: [
        { requirementId: REQ, itemId: 'item-cabo', unit: 'm', reopenedQty: 33.33333, releasedQty: 0.00003, cause: 'COVERED' },
        { requirementId: 'r2', itemId: 'item-disj', unit: 'un', reopenedQty: 0, releasedQty: 50, cause: 'REQUIREMENT_INACTIVE' },
      ],
      requisitions: [{ requisitionId: 'rq-a', number: 'RC-A', from: 'SOURCING', to: 'CLOSED' }] });
    // nenhum total entre itens/unidades
    expect(Object.keys(mocks.logAuditEventServer.mock.calls[0][0].metadata)).toEqual(
      ['status', 'governance', 'replayed', 'approvalRequestStatus', 'requirements', 'requisitions']);
  });

  it('réplica (duplo clique): marcada `replayed`, com o desfecho GUARDADO; anterior à 248: listas vazias; banco sem a 248: null', async () => {
    const POST = await route();
    mocks.inventoryAct.mockResolvedValueOnce({ ...CANCELLED, replayed: true });
    await POST(post({ action: 'cancel', reason: 'Cliente adiou a obra' }), ctx);
    expect(mocks.logAuditEventServer.mock.calls[0][0].metadata).toMatchObject({ replayed: true,
      requisitions: [{ requisitionId: 'rq-a', number: 'RC-260926-AAAAA', from: 'ORDERED', to: 'SUBMITTED' }] });

    mocks.inventoryAct.mockResolvedValueOnce({ purchase_order_id: PO, status: 'CANCELLED', replayed: true, approval_request_status: null,
      requirements: [], requisitions: [] });
    await POST(post({ action: 'cancel', reason: 'Cliente adiou a obra' }), ctx);
    expect(mocks.logAuditEventServer.mock.calls[1][0].metadata).toEqual({ status: 'CANCELLED', governance: null, replayed: true,
      approvalRequestStatus: null, requirements: [], requisitions: [] });

    mocks.inventoryAct.mockResolvedValueOnce({ purchase_order_id: PO, status: 'CANCELLED' });
    await POST(post({ action: 'cancel', reason: 'Cliente adiou a obra' }), ctx);
    expect(mocks.logAuditEventServer.mock.calls[2][0].metadata).toEqual({ status: 'CANCELLED', governance: null, replayed: false,
      approvalRequestStatus: null, requirements: null, requisitions: null });
  });

  it('emitir: a auditoria registra o que a emissão parcial liberou (por requisito, com unidade)', async () => {
    mocks.inventoryAct.mockResolvedValue({ purchase_order_id: PO, status: 'ISSUED', replayed: false,
      released: [{ requirement_id: REQ, item_id: 'item-cabo', unit: 'm', released_qty: '40.0000' }] });
    const res = await (await route())(post({ action: 'issue' }), ctx);
    expect(res.status).toBe(200);
    expect(mocks.inventoryAct).toHaveBeenCalledWith('purchase_order_issue', 'org-1', 'u-1', { p_po_id: PO });
    expect(mocks.logAuditEventServer.mock.calls[0][0]).toMatchObject({ action: 'supply.purchase_order.issue',
      metadata: { status: 'ISSUED', governance: null, replayed: false,
        released: [{ requirementId: REQ, itemId: 'item-cabo', unit: 'm', releasedQty: 40 }] } });
    // os outros atos seguem com estado e governança (e a marca de réplica)
    mocks.inventoryAct.mockResolvedValue({ purchase_order_id: PO, status: 'APPROVAL_REQUIRED', governance: 'POLICY' });
    await (await route())(post({ action: 'submit' }), ctx);
    expect(mocks.logAuditEventServer.mock.calls[1][0].metadata).toEqual({ status: 'APPROVAL_REQUIRED', governance: 'POLICY', replayed: false });
  });

  it('recusas do cancelamento: "has receipts" em compras (422); sem alçada → 403; nada é auditado', async () => {
    const POST = await route();
    mocks.inventoryAct.mockRejectedValueOnce(new GovernedRpcError('Purchase order has receipts: it is closed, not cancelled.', '23514'));
    let res = await POST(post({ action: 'cancel', reason: 'Cliente adiou a obra' }), ctx);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('Pedido com recebimento não se cancela — encerra-se.');

    mocks.inventoryAct.mockRejectedValueOnce(new GovernedRpcError('Requisition RC-260926-AD447 is CANCELLED: this order can no longer be issued.',
      '23514'));
    res = await POST(post({ action: 'issue' }), ctx);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('A requisição RC-260926-AD447 foi cancelada: este pedido não pode mais ser emitido.');

    mocks.inventoryAct.mockRejectedValueOnce(new GovernedRpcError('Actor lacks permission (procurement.orders.issue).', '42501'));
    res = await POST(post({ action: 'cancel', reason: 'Cliente adiou a obra' }), ctx);
    expect(res.status).toBe(403);
    expect(mocks.logAuditEventServer).not.toHaveBeenCalled();
  });
});

describe('recusas da 248 — a cadeia da rota (recebimento → estoque → compras)', () => {
  /** A MESMA função que as rotas de Compras usam (`runInventoryAct` → `inventoryFailure`). */
  const viaRoute = async (message: string, code = '23514') => {
    const res = inventoryFailure(new GovernedRpcError(message, code));
    return { status: res.status, error: (await res.json()).error as string };
  };
  const CASES: Array<[string, string]> = [
    // PO cancel: antes caía em `/not cancelled/` do estoque e dizia "a transferência…"
    ['Purchase order has receipts: it is closed, not cancelled.', 'Pedido com recebimento não se cancela — encerra-se.'],
    // procurement_rfq_create
    ['Requisition is CLOSED: it is not sourced.', 'A requisição foi encerrada: não vai para cotação.'],
    ['Requisition is CANCELLED: it is not sourced.', 'A requisição foi cancelada: não vai para cotação.'],
    ['Requisition is ORDERED: it is not sourced.', 'A requisição já tem pedido emitido: não vai para cotação.'],
    ['Requisition line is fully released: nothing left to source.', 'Esta linha da requisição foi liberada por inteiro: não há saldo a cotar.'],
    // procurement_decide
    ['No line of this quotation can become an order: its requisitions were cancelled or closed.',
      'Nenhuma linha desta proposta vira pedido: as requisições dela foram canceladas ou encerradas.'],
    // purchase_order_issue
    ['Requisition RC-260926-AD447 is CLOSED: this order can no longer be issued.',
      'A requisição RC-260926-AD447 foi encerrada: este pedido não pode mais ser emitido.'],
    ['Requisition RC-260926-AD447 is ORDERED: this order can no longer be issued.',
      'A requisição RC-260926-AD447 já tem pedido emitido: este pedido não pode mais ser emitido.'],
    // purchase_requisition_cancel
    ['Requisition is CLOSED: nothing to cancel.', 'A requisição já foi encerrada: não há o que cancelar.'],
  ];

  it.each(CASES)('%s → português de compras (422)', async (message, text) => {
    // nenhuma regra de recebimento ou de estoque a engole
    expect(receivingErrorMessage(message)).toBeNull();
    expect(inventoryErrorMessage(message)).toBeNull();
    expect(await viaRoute(message)).toEqual({ status: 422, error: text });
  });

  it('as do estoque continuam as do estoque (a transferência despachada, o motivo, a trava de cobertura)', async () => {
    expect((await viaRoute('Transfer is IN_TRANSIT: after dispatch it is received or closed, not cancelled.')).error)
      .toBe('Depois do despacho a transferência é recebida ou encerrada, não cancelada.');
    expect((await viaRoute('Cancellation requires a reason.', '22023')).error).toBe('Informe o motivo — este ato fica no histórico.');
    expect((await viaRoute('Reservation would over-cover the requirement: 100 required, 140 already committed or requisitioned.')).error)
      .toMatch(/^O requisito já está coberto/);
  });

  it('a linha do tempo do projeto tem título para o evento novo', () => {
    expect(domainEventTitle('supply.requisition.released')).toEqual({ title: 'Saldo de requisição de compra liberado', kind: 'supply',
      tone: 'warning' });
  });
});
