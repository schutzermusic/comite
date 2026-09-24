import { describe, it, expect } from 'vitest';
import { daysLate, inboundQueue, inboundRisk, onTimeRate, receivingErrorMessage, type InboundFacts } from '@/lib/supply/receiving';
import { summarizeCoverage } from '@/lib/supply/coverage';
import { inspectionSchema, receiptSchema, shipmentSchema } from '@/lib/supply/validation';

const U = '00000000-0000-4000-8000-000000000001';
const today = '2026-09-24';
const facts = (over: Partial<InboundFacts>): InboundFacts => ({
  kind: 'PO', status: 'ISSUED', expectedDate: '2026-09-30', inTransit: false, hasReceipt: false, openQuantity: 10, discrepancy: false, ...over,
});

describe('Recebimento — filas de entrada', () => {
  it('precedência: concluído, divergência, atrasado, trânsito, parcial, hoje, próximos', () => {
    expect(inboundQueue(facts({ openQuantity: 0 }), today)).toBe('done');
    expect(inboundQueue(facts({ openQuantity: 0, discrepancy: true }), today)).toBe('discrepancy');
    expect(inboundQueue(facts({ discrepancy: true, expectedDate: '2026-09-01' }), today)).toBe('discrepancy');
    expect(inboundQueue(facts({ expectedDate: '2026-09-20', inTransit: true }), today)).toBe('late');
    expect(inboundQueue(facts({ inTransit: true }), today)).toBe('in_transit');
    expect(inboundQueue(facts({ hasReceipt: true }), today)).toBe('partial');
    expect(inboundQueue(facts({ expectedDate: today }), today)).toBe('today');
    expect(inboundQueue(facts({}), today)).toBe('upcoming');
    expect(inboundQueue(facts({ status: 'CLOSED' }), today)).toBe('done');
  });
  it('atraso em dias só depois da data', () => {
    expect(daysLate('2026-09-20', today)).toBe(4);
    expect(daysLate(today, today)).toBe(0);
    expect(daysLate(null, today)).toBe(0);
  });
  it('pontualidade vem do histórico; sem histórico é desconhecida (nunca estimada)', () => {
    expect(onTimeRate({ promised_lines: 4, on_time_lines: 3 })).toBe(0.75);
    expect(onTimeRate({ promised_lines: 0, on_time_lines: 0 })).toBeNull();
    expect(onTimeRate(null)).toBeNull();
  });
});

describe('Cobertura — em inspeção já chegou: conta como entrando, não como falta', () => {
  it('entrando = trânsito + pedido + inspeção; falta desconta a inspeção', () => {
    const s = summarizeCoverage({ required: 10, reserved: 3, onOrder: 2, inspection: 5 });
    expect(s).toMatchObject({ covered: 3, inbound: 7, shortage: 0, status: 'INBOUND' });
  });
});

describe('Recebimento — contrato das rotas e recusas', () => {
  it('linha precisa de recebido ou rejeitado; rejeitado exige motivo', () => {
    expect(receiptSchema.safeParse({ purchaseOrderId: U, lines: [{ poLineId: U }] }).success).toBe(false);
    expect(receiptSchema.safeParse({ purchaseOrderId: U, lines: [{ poLineId: U, rejectedQuantity: 2 }] }).success).toBe(false);
    expect(receiptSchema.safeParse({ purchaseOrderId: U, lines: [{ poLineId: U, acceptedQuantity: 8, rejectedQuantity: 2,
      rejectionReason: 'Avaria no transporte' }] }).success).toBe(true);
  });
  it('inspeção exige ao menos uma linha; cancelar embarque exige motivo', () => {
    expect(inspectionSchema.safeParse({ lines: [] }).success).toBe(false);
    expect(shipmentSchema.safeParse({ id: U, status: 'CANCELLED' }).success).toBe(false);
    expect(shipmentSchema.safeParse({ purchaseOrderId: U, status: 'IN_TRANSIT', eta: '2026-10-01' }).success).toBe(true);
  });
  it('recusas do banco em português', () => {
    expect(receivingErrorMessage('Receipt exceeds the open quantity of the order line (200.0000 open).')).toMatch(/200 em aberto/);
    expect(receivingErrorMessage('Purchase order is DRAFT: only an issued order is received.')).toMatch(/Só pedido emitido/);
    expect(receivingErrorMessage('Closing with 150 still open requires a reason (the balance stops being expected).')).toMatch(/150/);
    expect(receivingErrorMessage('outra coisa')).toBeNull();
  });
});

describe('Torre de controle — risco de uma entrada para a necessidade que ela cobre', () => {
  it('chega depois da necessidade: crítico perto (≤ 7 dias), alto longe', () => {
    expect(inboundRisk('2026-10-10', '2026-09-30', today)).toEqual({ risk: 'critical', slackDays: -10, late: false });
    expect(inboundRisk('2026-10-30', '2026-10-20', today)).toMatchObject({ risk: 'high', slackDays: -10 });
  });
  it('atrasada chega no melhor caso hoje: necessidade já passada é crítica; a tempo, alta perto e média longe', () => {
    expect(inboundRisk('2026-09-20', '2026-09-22', today)).toMatchObject({ risk: 'critical', late: true, slackDays: -2 });
    expect(inboundRisk('2026-09-20', '2026-09-28', today)).toMatchObject({ risk: 'high', late: true, slackDays: 4 });
    expect(inboundRisk('2026-09-20', '2026-11-30', today)).toMatchObject({ risk: 'medium', late: true });
    expect(inboundRisk('2026-09-20', null, today)).toMatchObject({ risk: 'medium', late: true, slackDays: null });
  });
  it('folga curta (≤ 3 dias) é média; folga confortável não é risco', () => {
    expect(inboundRisk('2026-10-01', '2026-10-03', today)).toMatchObject({ risk: 'medium', slackDays: 2 });
    expect(inboundRisk('2026-10-01', '2026-10-20', today)).toMatchObject({ risk: null, slackDays: 19 });
    expect(inboundRisk('2026-10-01', null, today)).toMatchObject({ risk: null });
  });
  it('sem data prometida: médio só quando a necessidade está a 14 dias ou menos — nunca inventa uma data', () => {
    expect(inboundRisk(null, '2026-10-05', today)).toEqual({ risk: 'medium', slackDays: null, late: false });
    expect(inboundRisk(null, '2026-11-30', today)).toEqual({ risk: null, slackDays: null, late: false });
  });
});
