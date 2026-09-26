/**
 * Regra 246 na requisição da FALTA — POST /api/supply/procurement/requisitions
 * (hermético: o banco, a sessão e a auditoria simulados):
 *  1. `coverageOverride: { reason }` (20+ caracteres, aparado) vai ao banco
 *     como `p_payload.coverage_override`; sem ele, nada é enviado — o banco
 *     requisita o comprável;
 *  2. a alçada da ROTA segue `procurement.request`: a da exceção
 *     (`procurement.coverage_override`) é reconferida no banco, num lugar só;
 *  3. a auditoria registra a quantidade requisitada, se foi por exceção e o
 *     pendente em transferência (retorno sem os números: `null`, nunca 0);
 *  4. as recusas novas em português pela MESMA cadeia da rota (recebimento →
 *     estoque → compras) — "requires a reason" da exceção não vira a frase
 *     genérica do estoque; 42501 → 403.
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
vi.mock('@/lib/supply/service', () => ({ inventoryAct: mocks.inventoryAct }));
vi.mock('@/lib/audit/log-audit-event-server', () => ({ logAuditEventServer: mocks.logAuditEventServer }));
vi.mock('@/lib/operations/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/operations/session')>()),
  requireAnyOperationsPermission: mocks.requireAnyOperationsPermission,
}));

import { GovernedRpcError } from '@/lib/platform/governed-rpc';
import { inventoryErrorMessage } from '@/lib/supply/inventory';
import { procurementErrorMessage, requisitionAuditFigures } from '@/lib/supply/procurement';
import { receivingErrorMessage } from '@/lib/supply/receiving';
import { requisitionSchema, snakePayload } from '@/lib/supply/validation';

const REQ = '11111111-1111-4111-8111-111111111111';
const REASON = 'A TR-260925-B71B7 depende de caminhão que só sai em outubro';

const post = (body: unknown) => new Request('http://x/api/supply/procurement/requisitions', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
async function route() {
  return (await import('@/app/api/supply/procurement/requisitions/route')).POST;
}

describe('POST /api/supply/procurement/requisitions — exceção de cobertura (246)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAnyOperationsPermission.mockResolvedValue({
      organizationId: 'org-1', user: { id: 'u-1' }, supabase: {}, permissions: new Set(['procurement.request']),
    });
    mocks.logAuditEventServer.mockResolvedValue({ ok: true });
  });

  it('com o motivo: vai ao banco como coverage_override (aparado); a auditoria leva requisitado, exceção e pendente', async () => {
    mocks.inventoryAct.mockResolvedValue({
      requisition_id: 'rq-1', requisition_number: 'RC-260925-00001', replayed: false, requisitioned_qty: 400, override: true,
      requirements: [{ requirement_id: REQ, requisitioned_qty: 400, purchasable_qty: 250, pending_transfer_qty: 150,
        pending_transfers: [{ transfer_id: 't1', transfer_number: 'TR-260925-B71B7', status: 'REQUESTED', quantity: 150 }] }],
    });
    const res = await (await route())(post({ source: 'SHORTAGE', requirementIds: [REQ], coverageOverride: { reason: `  ${REASON}  ` } }));
    expect(res.status).toBe(200);
    // a alçada da rota é a de requisitar; a da exceção, o banco reconfere
    expect(mocks.requireAnyOperationsPermission).toHaveBeenCalledWith(['procurement.request']);
    expect(mocks.inventoryAct).toHaveBeenCalledWith('purchase_requisition_from_shortage', 'org-1', 'u-1', {
      p_payload: { requirement_ids: [REQ], coverage_override: { reason: REASON } } });
    expect(mocks.logAuditEventServer).toHaveBeenCalledWith(expect.objectContaining({
      action: 'supply.requisition.submitted', entityId: 'rq-1',
      metadata: { source: 'SHORTAGE', number: 'RC-260925-00001', replayed: false, requisitionedQty: 400, override: true, pendingTransferQty: 150 },
    }), expect.anything());
  });

  it('sem exceção: o corpo não leva coverage_override (o banco requisita o comprável)', async () => {
    mocks.inventoryAct.mockResolvedValue({ requisition_id: 'rq-2', requisition_number: 'RC-2', replayed: false, requisitioned_qty: 250,
      override: false, requirements: [{ requirement_id: REQ, requisitioned_qty: 250, purchasable_qty: 250, pending_transfer_qty: 150 }] });
    const res = await (await route())(post({ source: 'SHORTAGE', requirementIds: [REQ] }));
    expect(res.status).toBe(200);
    expect(mocks.inventoryAct.mock.calls[0][3]).toEqual({ p_payload: { requirement_ids: [REQ] } });
    expect(mocks.logAuditEventServer.mock.calls[0][0].metadata).toMatchObject({ requisitionedQty: 250, override: false, pendingTransferQty: 150 });
  });

  it('motivo curto: 400 em português, sem tocar no banco', async () => {
    const res = await (await route())(post({ source: 'SHORTAGE', requirementIds: [REQ], coverageOverride: { reason: 'curto demais' } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'A exceção de cobertura exige um motivo com pelo menos 20 caracteres.' });
    expect(mocks.inventoryAct).not.toHaveBeenCalled();
  });

  it('recusas do banco: coberta por transferência pendente → 422; sem a alçada da exceção → 403; motivo → 422 (em português)', async () => {
    const POST = await route();
    mocks.inventoryAct.mockRejectedValueOnce(new GovernedRpcError('Cabo 35 mm² is covered by pending internal transfer(s) TR-260925-B71B7, '
      + 'TR-260925-C0FFE: dispatch or cancel the transfer, or request a coverage exception.', '23514'));
    let res = await POST(post({ source: 'SHORTAGE', requirementIds: [REQ] }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('Essa falta está coberta por transferência pendente (TR-260925-B71B7, TR-260925-C0FFE): '
      + 'despache ou cancele a transferência, ou registre uma exceção de cobertura.');

    mocks.inventoryAct.mockRejectedValueOnce(new GovernedRpcError('Coverage exception requires procurement.coverage_override.', '42501'));
    res = await POST(post({ source: 'SHORTAGE', requirementIds: [REQ], coverageOverride: { reason: REASON } }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'FORBIDDEN',
      error: 'A exceção de cobertura exige a alçada procurement.coverage_override (comprar também o que a transferência pendente vai trazer).' });

    mocks.inventoryAct.mockRejectedValueOnce(new GovernedRpcError('Coverage exception requires a reason of at least 20 characters.', '23514'));
    res = await POST(post({ source: 'SHORTAGE', requirementIds: [REQ], coverageOverride: { reason: REASON } }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('A exceção de cobertura exige um motivo com pelo menos 20 caracteres — fica no registro da exceção.');
    expect(mocks.logAuditEventServer).not.toHaveBeenCalled();
  });
});

describe('recusas da regra 246 — a cadeia da rota (recebimento → estoque → compras)', () => {
  const chain = (m: string) => receivingErrorMessage(m) ?? inventoryErrorMessage(m) ?? procurementErrorMessage(m);

  it('as mensagens de compras não são capturadas pelas do estoque', () => {
    expect(inventoryErrorMessage('Coverage exception requires a reason of at least 20 characters.')).toBeNull();
    expect(inventoryErrorMessage('Material X is covered by pending internal transfer(s) TR-1: dispatch or cancel the transfer, or request a coverage exception.'))
      .toBeNull();
    expect(chain('Coverage exception requires a reason of at least 20 characters.')).toMatch(/^A exceção de cobertura exige um motivo/);
    expect(chain('Material X is covered by pending internal transfer(s) TR-1: dispatch or cancel the transfer, or request a coverage exception.'))
      .toBe('Essa falta está coberta por transferência pendente (TR-1): despache ou cancele a transferência, ou registre uma exceção de cobertura.');
    // a de sempre continua a de sempre
    expect(chain('Requirement Y has no uncovered shortage left to requisition (250.0000 already requested).')).toBe('Essa falta já está requisitada (250).');
    // o estoque ainda traduz o seu "requires a reason"
    expect(chain('Transfer cancellation requires a reason.')).toBe('Informe o motivo — este ato fica no histórico.');
  });

  it('a trava simétrica (reservar/transferir) fala das solicitações de compra', () => {
    expect(chain('Transfer would over-cover the requirement (claimed 1200 incl. open requisitions + 250 > 1200).'))
      .toBe('O requisito já está coberto por estoque, transferências ou solicitações de compra — para trocar uma compra por estoque, '
        + 'cancele antes a solicitação em Compras.');
  });
});

describe('contrato da requisição da falta (246)', () => {
  it('coverageOverride é opcional; o motivo é aparado, 20..1000 caracteres; vai ao banco em snake_case', () => {
    const ok = requisitionSchema.parse({ source: 'SHORTAGE', requirementIds: [REQ], coverageOverride: { reason: `  ${REASON} ` } });
    expect(ok).toMatchObject({ coverageOverride: { reason: REASON } });
    const { source: _source, ...rest } = ok;
    expect(snakePayload(rest)).toEqual({ requirement_ids: [REQ], coverage_override: { reason: REASON } });
    expect(requisitionSchema.safeParse({ source: 'SHORTAGE', requirementIds: [REQ], coverageOverride: { reason: ' '.repeat(25) } }).success)
      .toBe(false);
    expect(requisitionSchema.safeParse({ source: 'SHORTAGE', requirementIds: [REQ], coverageOverride: { reason: 'x'.repeat(1001) } }).success)
      .toBe(false);
    expect(requisitionSchema.safeParse({ source: 'SHORTAGE', requirementIds: [REQ], coverageOverride: {} }).success).toBe(false);
  });

  it('auditoria: números do retorno do banco; retorno sem eles (réplica antiga, banco sem a 246) → null, nunca 0', () => {
    expect(requisitionAuditFigures({ requisitioned_qty: '400.0000', override: true,
      requirements: [{ pending_transfer_qty: '100' }, { pending_transfer_qty: 50 }] }))
      .toEqual({ requisitionedQty: 400, override: true, pendingTransferQty: 150 });
    expect(requisitionAuditFigures({ requisition_id: 'rq', requisition_number: 'RC', replayed: true }))
      .toEqual({ requisitionedQty: null, override: false, pendingTransferQty: null });
  });
});
