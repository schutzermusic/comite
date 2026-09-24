import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TRANSIT_DAYS, computeSignals, needDate, severityForNeed, simulateTransfer, type IntelligenceFacts, type RequirementFacts,
} from '@/lib/supply/intelligence';
import { summarizeCoverage } from '@/lib/supply/coverage';

const today = '2026-09-24';
const req = (over: Partial<RequirementFacts> & { cov?: Parameters<typeof summarizeCoverage>[0] }): RequirementFacts => ({
  id: 'r1', projectId: 'p1', project: 'Obra 1', itemId: 'i1', itemCode: 'CAB-35', itemDescription: 'Cabo', unit: 'm', title: 'Cabo da SE',
  requiredBy: '2026-09-30', activityStart: null, activity: null, coverage: summarizeCoverage(over.cov ?? { required: 1000 }), ...over,
});
const facts = (over: Partial<IntelligenceFacts>): IntelligenceFacts => ({
  today, requirements: [], stock: [], projectSites: {}, inbound: [], orders: [], requisitions: [], supplierPerformance: {}, transit: [],
  inspections: [], ...over,
});

describe('Apex · necessidade e severidade', () => {
  it('a necessidade é a data do requisito ou o início da atividade, o que vier antes', () => {
    expect(needDate({ requiredBy: '2026-10-10', activityStart: '2026-10-05' })).toBe('2026-10-05');
    expect(needDate({ requiredBy: null, activityStart: null })).toBeNull();
  });
  it('severidade pela distância da necessidade', () => {
    expect([severityForNeed(-2), severityForNeed(7), severityForNeed(14), severityForNeed(30), severityForNeed(60), severityForNeed(null)])
      .toEqual(['critical', 'critical', 'high', 'medium', 'low', 'medium']);
  });
});

describe('Apex · simulação de transferência', () => {
  it('usa o histórico do par de locais; sem ele, o do destino; sem nada, a estimativa padrão declarada', () => {
    const transit = [{ fromId: 'A', toId: 'S', days: 3 }, { fromId: 'A', toId: 'S', days: 5 }, { fromId: 'B', toId: 'S', days: 1 }];
    expect(simulateTransfer({ fromId: 'A', toId: 'S', today, need: '2026-09-30', transit })).toMatchObject({ days: 4, beforeNeed: true, samples: 2 });
    expect(simulateTransfer({ fromId: 'C', toId: 'S', today, need: null, transit }).basis).toMatch(/para este destino/);
    const none = simulateTransfer({ fromId: 'A', toId: 'X', today, need: '2026-09-25', transit });
    expect(none.days).toBe(DEFAULT_TRANSIT_DAYS);
    expect(none.basis).toMatch(/estimativa padrão/);
    expect(none.beforeNeed).toBe(false);
  });
});

describe('Apex · falta: primeiro o estoque da empresa, depois a compra', () => {
  it('estoque no canteiro do projeto → reservar; resto → comprar', () => {
    const s = computeSignals(facts({
      requirements: [req({})],
      projectSites: { p1: [{ id: 'S', name: 'Canteiro' }] },
      stock: [{ itemId: 'i1', locationId: 'S', locationName: 'Canteiro', locationKind: 'PROJECT_SITE', available: 400 }],
    }));
    expect(s.map((x) => [x.kind, x.recommended_action.kind, x.recommended_action.payload.quantity])).toEqual([
      ['ALTERNATE_STOCK', 'RESERVE', 400], ['SHORTAGE', 'REQUISITION', 600]]);
    expect(s[0].severity).toBe('critical');
    expect(s[0].evidence.some((e) => e.source?.includes('em mão − reservado'))).toBe(true);
  });
  it('estoque em outro local → transferir para o canteiro, com chegada e base da estimativa', () => {
    const [alt] = computeSignals(facts({
      requirements: [req({ cov: { required: 100 } })],
      projectSites: { p1: [{ id: 'S', name: 'Canteiro' }] },
      stock: [{ itemId: 'i1', locationId: 'W', locationName: 'Almox B', locationKind: 'WAREHOUSE', available: 250 }],
    }));
    expect(alt.recommended_action).toMatchObject({ kind: 'TRANSFER', payload: { from_location_id: 'W', to_location_id: 'S', quantity: 100 } });
    expect(alt.rationale).toMatch(/Custo de frete não cadastrado: não estimado/);
  });
  it('o mesmo saldo não é oferecido a dois requisitos', () => {
    const s = computeSignals(facts({
      requirements: [req({ id: 'r1', cov: { required: 300 } }), req({ id: 'r2', cov: { required: 300 } })],
      stock: [{ itemId: 'i1', locationId: 'W', locationName: 'Almox', locationKind: 'WAREHOUSE', available: 400 }],
    }));
    const offered = s.filter((x) => x.kind === 'ALTERNATE_STOCK').reduce((a, x) => a + Number(x.recommended_action.payload.quantity), 0);
    expect(offered).toBe(400);
    expect(s.find((x) => x.kind === 'SHORTAGE')?.recommended_action.payload.quantity).toBe(200);
  });
  it('quarentena não é alternativa; o já requisitado não vira nova compra', () => {
    const s = computeSignals(facts({
      requirements: [req({ cov: { required: 100, requested: 100 } })],
      stock: [{ itemId: 'i1', locationId: 'Q', locationName: 'Quarentena', locationKind: 'QUARANTINE', available: 100 }],
    }));
    expect(s.filter((x) => x.kind === 'SHORTAGE' || x.kind === 'ALTERNATE_STOCK')).toEqual([]);
  });
});

describe('Apex · entradas, fornecedores e decisões', () => {
  it('chega depois da necessidade (inclusive o início da atividade) → acompanhar a antecipação', () => {
    const [eta] = computeSignals(facts({
      requirements: [req({ cov: { required: 100, onOrder: 100 }, requiredBy: '2026-10-10', activityStart: '2026-09-30', activity: 'Lançamento de cabos' })],
      inbound: [{ requirementId: 'r1', kind: 'PO', refId: 'po1', refNumber: 'OC-1', supplierId: 's1', supplier: 'Cabos SA', quantity: 100, eta: '2026-10-04' }],
    }));
    expect(eta).toMatchObject({ kind: 'ETA_RISK', purchase_order_id: 'po1', recommended_action: { kind: 'FOLLOW_UP' } });
    expect(eta.rationale).toMatch(/Lançamento de cabos/);
    expect(eta.title).toMatch(/4 dia\(s\) depois/);
  });
  it('pedido atrasado vira cobrança; fornecedor pouco pontual só quando não está atrasado', () => {
    const s = computeSignals(facts({
      orders: [
        { id: 'po1', number: 'OC-1', supplierId: 's1', supplier: 'A', status: 'ISSUED', eta: '2026-09-20', open: 10, needDate: '2026-09-28', projectId: 'p1', submittedAt: null, lateDays: 4 },
        { id: 'po2', number: 'OC-2', supplierId: 's1', supplier: 'A', status: 'ISSUED', eta: '2026-10-01', open: 10, needDate: '2026-10-02', projectId: 'p1', submittedAt: null, lateDays: 0 },
      ],
      supplierPerformance: { s1: { promised: 5, onTime: 2 } },
    }));
    expect(s.map((x) => [x.kind, x.purchase_order_id])).toEqual([['LATE_INBOUND', 'po1'], ['SUPPLIER_RELIABILITY', 'po2']]);
    expect(s[1].title).toMatch(/2 de 5/);
  });
  it('pontualidade sem histórico suficiente não gera alerta (nunca estimada)', () => {
    const s = computeSignals(facts({
      orders: [{ id: 'po', number: 'OC', supplierId: 's1', supplier: 'A', status: 'ISSUED', eta: '2026-10-01', open: 1, needDate: null, projectId: null, submittedAt: null, lateDays: 0 }],
      supplierPerformance: { s1: { promised: 2, onTime: 0 } },
    }));
    expect(s).toEqual([]);
  });
  it('decisão parada perto da necessidade e inspeção esquecida levam à tela certa', () => {
    const s = computeSignals(facts({
      requisitions: [{ id: 'q1', number: 'RC-1', status: 'SUBMITTED', requestedAt: '2026-09-20T10:00:00Z', requirementIds: ['r1'], needDate: '2026-10-01', projectId: 'p1', inRfq: false }],
      orders: [{ id: 'po', number: 'OC-9', supplierId: 's', supplier: 'X', status: 'APPROVAL_REQUIRED', eta: null, open: 5, needDate: '2026-10-05', projectId: 'p1', submittedAt: '2026-09-21T10:00:00Z', lateDays: 0 }],
      inspections: [{ receiptId: 'g1', number: 'REC-1', receivedAt: '2026-09-18T10:00:00Z', orderNumber: 'OC-5', purchaseOrderId: 'po5', location: 'Quarentena' }],
    }));
    expect(s.map((x) => [x.kind, x.recommended_action.kind, x.recommended_action.payload.href])).toEqual(expect.arrayContaining([
      ['DECISION_PENDING', 'OPEN', '/supply/compras'], ['DECISION_PENDING', 'OPEN', '/supply/compras'], ['INSPECTION_AGING', 'OPEN', '/supply/recebimentos']]));
    expect(s.find((x) => x.kind === 'INSPECTION_AGING')?.severity).toBe('high');
  });
  it('sinais saem do mais grave ao menos grave, com chave estável por condição', () => {
    const a = computeSignals(facts({ requirements: [req({ requiredBy: '2026-12-30' }), req({ id: 'r2', requiredBy: '2026-09-26' })] }));
    expect(a.map((x) => x.severity)).toEqual(['critical', 'low']);
    const b = computeSignals(facts({ requirements: [req({ requiredBy: '2026-12-30' }), req({ id: 'r2', requiredBy: '2026-09-26' })] }));
    expect(b.map((x) => x.signal_key)).toEqual(a.map((x) => x.signal_key));
  });
});
