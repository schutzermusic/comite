import { describe, it, expect } from 'vitest';
import {
  inventoryErrorMessage, inventoryExceptions, pendingTransferLines, pendingTransferRefs, pendingTransferRefsByRequirement, promisedByOrigin,
  stockForRequirement, transferActions, type PositionRow,
} from '@/lib/supply/inventory';
import { strategyOptions } from '@/lib/supply/coverage';
import {
  adjustmentSchema, countActionSchema, reservationActionSchema, snakePayload, transferRequestSchema,
} from '@/lib/supply/validation';

const pos = (over: Partial<PositionRow>): PositionRow => ({
  itemId: 'i1', itemCode: 'CAB', itemDescription: 'Cabo', unit: 'm', tracking: 'NONE', locationId: 'l1', locationCode: 'A',
  locationName: 'Almox A', locationKind: 'WAREHOUSE', onHand: 0, reserved: 0, available: 0, inspection: 0, inboundTransit: 0,
  lastMovementAt: null, ...over,
});
const U = '00000000-0000-4000-8000-000000000001';
const V = '00000000-0000-4000-8000-000000000002';

describe('Estoque — próximo ato da transferência', () => {
  const all = { manage: true, receive: true };
  it('segue o fluxo solicitada → aprovada → trânsito → recebida', () => {
    expect(transferActions('REQUESTED', all)).toEqual(['approve', 'cancel']);
    expect(transferActions('APPROVED', all)).toEqual(['dispatch', 'cancel']);
    expect(transferActions('IN_TRANSIT', all)).toEqual(['receive', 'close']);
    expect(transferActions('RECEIVED', all)).toEqual(['close']);
    expect(transferActions('CLOSED', all)).toEqual([]);
  });
  it('quem só recebe, só recebe', () => {
    expect(transferActions('IN_TRANSIT', { manage: false, receive: true })).toEqual(['receive']);
    expect(transferActions('REQUESTED', { manage: false, receive: true })).toEqual([]);
  });
});

describe('Estoque — onde há saldo livre para a falta', () => {
  const position = [
    pos({ locationId: 'wh', locationName: 'Almox B', available: 200 }),
    pos({ locationId: 'site', locationName: 'Canteiro', locationKind: 'PROJECT_SITE', available: 50 }),
    pos({ locationId: 'q', locationName: 'Quarentena', locationKind: 'QUARANTINE', onHand: 30, inspection: 30 }),
    pos({ locationId: 'zero', available: 0, onHand: 10, reserved: 10 }),
    pos({ itemId: 'other', locationId: 'wh', available: 999 }),
  ];
  it('destino (canteiro do projeto) primeiro; quarentena e saldo reservado ficam fora', () => {
    const s = stockForRequirement(position, 'i1', ['site']);
    expect(s.map((x) => [x.locationId, x.isDestination])).toEqual([['site', true], ['wh', false]]);
  });
  it('projeto sem canteiro: reservar no almoxarifado já é o caminho', () => {
    expect(stockForRequirement(position, 'i1', []).every((x) => x.isDestination)).toBe(true);
  });
  it('estratégia explicável: reservar no destino, transferir o resto, comprar o que faltar', () => {
    const opts = strategyOptions('MATERIAL', 450, stockForRequirement(position, 'i1', ['site']));
    expect(opts.map((o) => [o.strategy, o.quantity])).toEqual([['RESERVE_FROM_STOCK', 50], ['TRANSFER', 200], ['BUY', 200]]);
  });
  it('246: o saldo prometido a transferências pedidas sai do livre (e o local sem sobra, da lista)', () => {
    const promised = new Map([['i1:wh', 120], ['i1:site', 50]]);
    const s = stockForRequirement(position, 'i1', ['site'], promised);
    expect(s).toEqual([{ locationId: 'wh', locationName: 'Almox B', available: 80, isDestination: false, promised: 120 }]);
  });
});

describe('Estoque — transferência PEDIDA (regra 246)', () => {
  const transfers = [
    { id: 't1', transfer_number: 'TR-1', status: 'REQUESTED', from_location_id: 'D' },
    { id: 't2', transfer_number: 'TR-2', status: 'APPROVED', from_location_id: 'D' },
    { id: 't3', transfer_number: 'TR-3', status: 'IN_TRANSIT', from_location_id: 'N' },
    { id: 't4', transfer_number: 'TR-4', status: 'CANCELLED', from_location_id: 'D' },
  ];
  const lines = [
    { transfer_id: 't1', item_id: 'i1', requirement_id: 'r1', quantity: '100', source_reservation_id: null },
    { transfer_id: 't1', item_id: 'i1', requirement_id: 'r1', quantity: '50', source_reservation_id: null },
    // move reserva na origem: já está em "reservado", não é pendente
    { transfer_id: 't2', item_id: 'i1', requirement_id: 'r1', quantity: '40', source_reservation_id: 'res-1' },
    { transfer_id: 't2', item_id: 'i1', requirement_id: 'r2', quantity: '30', source_reservation_id: null },
    { transfer_id: 't3', item_id: 'i1', requirement_id: 'r1', quantity: '70', source_reservation_id: null },
    { transfer_id: 't4', item_id: 'i1', requirement_id: 'r1', quantity: '999', source_reservation_id: null },
  ];
  it('o predicado do `pending_transfer_qty`: pedida/aprovada, com quantidade, sem reserva na origem', () => {
    expect(pendingTransferLines(lines, transfers).map((x) => [x.transfer.transfer_number, x.qty])).toEqual([['TR-1', 100], ['TR-1', 50], ['TR-2', 30]]);
  });
  it('por requisito, somada por transferência, com o estado em português e o link para resolvê-la no Estoque', () => {
    const by = pendingTransferRefsByRequirement(lines, transfers);
    expect(by.get('r1')).toEqual([{ transferId: 't1', number: 'TR-1', status: 'REQUESTED', statusLabel: 'Solicitada', qty: 150,
      href: '/supply/estoque?view=transferencias&transfer=t1' }]);
    expect(by.get('r2')).toEqual([expect.objectContaining({ number: 'TR-2', statusLabel: 'Aprovada', qty: 30 })]);
    expect(pendingTransferRefs(lines, transfers, 'r9')).toEqual([]);
  });
  it('o prometido por item × origem', () => {
    expect(promisedByOrigin(lines, transfers)).toEqual(new Map([['i1:D', 180]]));
  });
});

describe('Estoque — exceções que pedem uma pessoa', () => {
  it('reserva acima do físico, reserva sem demanda, acima da necessidade, trânsito atrasado, contagem esquecida', () => {
    const ex = inventoryExceptions({
      today: '2026-09-24',
      position: [pos({ onHand: 40, reserved: 50, available: -10 })],
      reservations: [
        { id: 'r1', status: 'ACTIVE', open: 10, requirementId: 'q1', requirementStatus: 'CANCELLED', requirementQuantity: 10,
          committedToRequirement: 10, project: 'P', itemCode: 'CAB' },
        { id: 'r2', status: 'ACTIVE', open: 10, requirementId: 'q2', requirementStatus: 'CONFIRMED', requirementQuantity: 5,
          committedToRequirement: 10, project: 'P', itemCode: 'CAB' },
        { id: 'r3', status: 'RELEASED', open: 0, requirementId: 'q3', requirementStatus: 'CANCELLED', requirementQuantity: 1,
          committedToRequirement: 0, project: 'P', itemCode: 'CAB' },
      ],
      transfers: [{ id: 't1', number: 'TR-1', status: 'IN_TRANSIT', expectedArrival: '2026-09-20' },
        { id: 't2', number: 'TR-2', status: 'CLOSED', expectedArrival: '2026-09-01' }],
      counts: [{ id: 'c1', status: 'OPEN', openedAt: '2026-09-01T10:00:00Z', locationName: 'Almox A' }],
    });
    expect(ex.map((e) => e.kind)).toEqual(['RESERVED_ABOVE_ON_HAND', 'RESERVATION_WITHOUT_DEMAND', 'RESERVATION_ABOVE_NEED',
      'TRANSFER_OVERDUE', 'COUNT_OPEN_LONG']);
  });
});

describe('Estoque — recusas do banco em português', () => {
  it('traduz as recusas conhecidas e deixa passar o resto', () => {
    expect(inventoryErrorMessage('Not enough available stock at ALM-A: 400 available, 600 requested.'))
      .toBe('Disponível insuficiente em ALM-A: 400 livre(s), 600 pedido(s).');
    expect(inventoryErrorMessage('Stock moved after the count began for: CAB-1. Recount these lines.')).toMatch(/CAB-1 se moveu/);
    // 246: a trava conta também as solicitações de compra abertas
    expect(inventoryErrorMessage('Reservation would over-cover the requirement: 600 required, 600 already committed.'))
      .toBe('O requisito já está coberto por estoque, transferências ou solicitações de compra — para trocar uma compra por estoque, '
        + 'cancele antes a solicitação em Compras.');
    expect(inventoryErrorMessage('Actor lacks permission (inventory.reserve).')).toMatch(/alçada/);
    expect(inventoryErrorMessage('something else')).toBeNull();
  });
});

describe('Estoque — contrato das rotas', () => {
  it('ajuste exige motivo e quantidade não nula', () => {
    expect(adjustmentSchema.safeParse({ itemId: U, locationId: V, quantity: 0, reason: 'Saldo inicial' }).success).toBe(false);
    expect(adjustmentSchema.safeParse({ itemId: U, locationId: V, quantity: -5, reason: '' }).success).toBe(false);
    expect(adjustmentSchema.safeParse({ itemId: U, locationId: V, quantity: -5, reason: 'Avaria' }).success).toBe(true);
  });
  it('liberar e devolver exigem motivo; entregar não', () => {
    expect(reservationActionSchema.safeParse({ action: 'release', reason: '' }).success).toBe(false);
    expect(reservationActionSchema.safeParse({ action: 'issue', quantity: 3 }).success).toBe(true);
    expect(reservationActionSchema.safeParse({ action: 'return', quantity: 3 }).success).toBe(false);
  });
  it('transferência: origem ≠ destino e ao menos uma linha', () => {
    expect(transferRequestSchema.safeParse({ fromLocationId: U, toLocationId: U, lines: [{ itemId: U, quantity: 1 }] }).success).toBe(false);
    expect(transferRequestSchema.safeParse({ fromLocationId: U, toLocationId: V, lines: [] }).success).toBe(false);
    expect(transferRequestSchema.safeParse({ fromLocationId: U, toLocationId: V, lines: [{ itemId: U, quantity: 1 }] }).success).toBe(true);
  });
  it('contagem não aceita contado negativo', () => {
    expect(countActionSchema.safeParse({ action: 'record', lines: [{ lineId: U, countedQuantity: -1 }] }).success).toBe(false);
  });
  it('camelCase da rota vira snake_case do banco, inclusive nas linhas', () => {
    expect(snakePayload({ fromLocationId: 'a', lines: [{ itemId: 'x', sourceReservationId: null }], skip: undefined }))
      .toEqual({ from_location_id: 'a', lines: [{ item_id: 'x', source_reservation_id: null }] });
  });
});
