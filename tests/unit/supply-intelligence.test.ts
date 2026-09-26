import { afterEach, describe, it, expect } from 'vitest';
import {
  DEFAULT_TRANSIT_DAYS, computeSignals, needDate, severityForNeed, simulateTransfer, type IntelligenceFacts, type RequirementFacts,
} from '@/lib/supply/intelligence';
import { summarizeCoverage } from '@/lib/supply/coverage';
import { resetRequisition248Fallback } from '@/lib/supply/procurement';

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
    // a carga da requisição é o COMPRÁVEL do banco (o que `purchase_requisition_from_shortage` pede ao executar);
    // o título diz o que sobra para comprar se o estoque recomendado for usado antes
    expect(s.map((x) => [x.kind, x.recommended_action.kind, x.recommended_action.payload.quantity])).toEqual([
      ['ALTERNATE_STOCK', 'RESERVE', 400], ['SHORTAGE', 'REQUISITION', 1000]]);
    expect(s[1].title).toBe('Comprar 600 m de CAB-35 para Obra 1');
    expect(s[1].recommended_action.label).toBe('Requisitar compra de 1.000 m');
    expect(s[1].rationale).toMatch(/A solicitação pede o comprável no momento em que for aberta \(hoje 1\.000 m\): use antes o estoque recomendado\.$/);
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
    const buy = s.find((x) => x.kind === 'SHORTAGE');
    expect(buy?.title).toBe('Comprar 200 m de CAB-35 para Obra 1');
    // a carga é o comprável do requisito (o banco pede isso ao executar)
    expect(buy?.recommended_action.payload.quantity).toBe(300);
  });

  it('246: a transferência PEDIDA não é comprada, nem o saldo prometido da origem é oferecido de novo', () => {
    // qa-flx: 500 m requeridos, 100 reservados, 150 pedidos de FLX-D (sem despacho) → comprável 250
    const s = computeSignals(facts({
      requirements: [req({ cov: { required: 500, reserved: 100, pendingTransfer: 150 } })],
      projectSites: { p1: [{ id: 'S', name: 'Canteiro' }] },
      stock: [{ itemId: 'i1', locationId: 'D', locationName: 'FLX-D', locationKind: 'WAREHOUSE', available: 150 }],
      pendingTransfers: [{ transferId: 't1', number: 'TR-260925-B71B7', status: 'REQUESTED', requirementId: 'r1', itemId: 'i1',
        fromLocationId: 'D', quantity: 150 }],
    }));
    expect(s.filter((x) => x.kind === 'ALTERNATE_STOCK')).toEqual([]);
    const [buy] = s.filter((x) => x.kind === 'SHORTAGE');
    expect(buy.recommended_action.payload.quantity).toBe(250);
    expect(buy.title).toBe('Comprar 250 m de CAB-35 para Obra 1');
    expect(buy.rationale).toContain('150 m já pedidos em transferência (TR-260925-B71B7) ainda não saíram da origem');
    expect(buy.evidence).toEqual(expect.arrayContaining([
      { label: 'Falta', value: '400 m', source: 'cobertura derivada' },
      { label: 'Transferência pedida', value: '150 m', source: 'TR-260925-B71B7 — sem despacho, ainda não cobre' },
      { label: 'Comprável', value: '250 m', source: 'falta − requisitado − transferência pedida' }]));
  });

  it('246: saldo em parte prometido — oferece só o livre de fato; pedida que cobre tudo → nada a comprar nem a mover', () => {
    const s = computeSignals(facts({
      requirements: [req({ id: 'r2', cov: { required: 300 } })],
      projectSites: { p1: [{ id: 'S', name: 'Canteiro' }] },
      stock: [{ itemId: 'i1', locationId: 'W', locationName: 'Almox', locationKind: 'WAREHOUSE', available: 400 }],
      // outro requisito já pediu 250 de W
      pendingTransfers: [{ transferId: 't9', number: 'TR-9', status: 'APPROVED', requirementId: 'r1', itemId: 'i1', fromLocationId: 'W', quantity: 250 }],
    }));
    const [alt] = s.filter((x) => x.kind === 'ALTERNATE_STOCK');
    expect(alt.recommended_action.payload.quantity).toBe(150);
    expect(alt.evidence.find((e) => e.label === 'Livre na origem')).toEqual({ label: 'Livre na origem', value: '150 m',
      source: 'Almox (em mão − reservado − já pedido em transferência)' });
    const covered = computeSignals(facts({ requirements: [req({ cov: { required: 100, pendingTransfer: 100 } })],
      stock: [{ itemId: 'i1', locationId: 'W', locationName: 'Almox', locationKind: 'WAREHOUSE', available: 500 }] }));
    expect(covered.filter((x) => x.kind === 'SHORTAGE' || x.kind === 'ALTERNATE_STOCK')).toEqual([]);
  });
  it('246: transferência pedida SEM requisito (reposição) ou de requisito fora da leitura também promete a origem', () => {
    // W tem 400 livres: 70 prometidos a uma reposição sem requisito e 330 a um requisito que não está na cobertura lida
    const s = computeSignals(facts({
      requirements: [req({ cov: { required: 300 } })],
      projectSites: { p1: [{ id: 'S', name: 'Canteiro' }] },
      stock: [{ itemId: 'i1', locationId: 'W', locationName: 'Almox', locationKind: 'WAREHOUSE', available: 400 }],
      pendingTransfers: [
        { transferId: 't1', number: 'TR-260925-DF0DF', status: 'APPROVED', requirementId: null, itemId: 'i1', fromLocationId: 'W', quantity: 70 },
        { transferId: 't2', number: 'TR-OUTRO', status: 'REQUESTED', requirementId: 'r-fora', itemId: 'i1', fromLocationId: 'W', quantity: 330 }],
    }));
    // nada livre de fato: a Apex não pede transferência do que já está prometido — compra
    expect(s.filter((x) => x.kind === 'ALTERNATE_STOCK')).toEqual([]);
    const [buy] = s.filter((x) => x.kind === 'SHORTAGE');
    expect(buy.recommended_action.payload.quantity).toBe(300);
    // o texto do requisito só cita as transferências DELE (nenhuma aqui)
    expect(buy.rationale).not.toMatch(/TR-260925-DF0DF|TR-OUTRO/);
    expect(buy.evidence.some((e) => e.label === 'Transferência pedida')).toBe(false);
    // em parte prometido: oferece só o livre de fato
    const [alt] = computeSignals(facts({
      requirements: [req({ cov: { required: 300 } })],
      projectSites: { p1: [{ id: 'S', name: 'Canteiro' }] },
      stock: [{ itemId: 'i1', locationId: 'W', locationName: 'Almox', locationKind: 'WAREHOUSE', available: 400 }],
      pendingTransfers: [{ transferId: 't1', number: 'TR-260925-DF0DF', status: 'APPROVED', requirementId: null, itemId: 'i1', fromLocationId: 'W',
        quantity: 70 }],
    }));
    expect(alt).toMatchObject({ kind: 'ALTERNATE_STOCK', recommended_action: { kind: 'TRANSFER', payload: { quantity: 300 } } });
    expect(alt.evidence.find((e) => e.label === 'Livre na origem')?.value).toBe('330 m');
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

describe('Apex · a base do prometido é a da organização (246)', () => {
  type Call = { table: string; ops: Array<[string, unknown[]]> };
  type Spec = { rows?: Array<Record<string, unknown>>; error?: string };
  /** Cliente falso: `eq`/`in` filtram as colunas presentes na linha; `range` pagina; cada consulta fica registrada. */
  function fakeClient(tables: Record<string, Spec | ((call: Call) => Spec)>, calls: Call[]) {
    return {
      rpc: async () => ({ data: null, error: null }),
      from: (table: string) => {
        const call: Call = { table, ops: [] };
        calls.push(call);
        let from = 0; let to = Number.MAX_SAFE_INTEGER;
        const chain: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'in', 'not', 'gt', 'gte', 'order', 'or', 'limit']) {
          chain[m] = (...args: unknown[]) => { call.ops.push([m, args]); return chain; };
        }
        chain.range = (f: number, t: number) => { from = f; to = t; return chain; };
        chain.then = (resolve: (v: unknown) => unknown) => {
          const raw = tables[table];
          const spec = (typeof raw === 'function' ? raw(call) : raw) ?? { rows: [] };
          if (spec.error) return resolve({ data: null, error: { message: spec.error } });
          let rows = spec.rows ?? [];
          for (const [m, a] of call.ops) {
            const [col, val] = a as [string, unknown];
            if (m === 'eq') rows = rows.filter((r) => !(col in r) || r[col] === val);
            if (m === 'in') rows = rows.filter((r) => !(col in r) || (val as unknown[]).includes(r[col]));
          }
          return resolve({ data: rows.slice(from, to + 1), error: null });
        };
        return chain;
      },
    };
  }
  const cov = { requirement_id: 'r1', item_id: 'i1', project_id: 'p1', organization_id: 'o', requirement_type: 'MATERIAL', activity_id: null,
    required_qty: '300', reserved_qty: '0', consumed_qty: '0', in_transit_qty: '0', on_order_qty: '0', requested_qty: '0', inspection_qty: '0',
    shortage_qty: '300', pending_transfer_qty: '0', purchasable_qty: '300', required_by: '2026-10-01', unit: 'm' };
  const tables = (): Record<string, Spec | ((call: Call) => Spec)> => ({
    supply_requirement_coverage: { rows: [cov] },
    inventory_position: { rows: [{ organization_id: 'o', item_id: 'i1', location_id: 'W', location_kind: 'WAREHOUSE', available_qty: 400 }] },
    inventory_locations: { rows: [{ organization_id: 'o', id: 'W', name: 'Almox', kind: 'WAREHOUSE', project_id: null, active: true },
      { organization_id: 'o', id: 'S', name: 'Canteiro', kind: 'PROJECT_SITE', project_id: 'p1', active: true }] },
    inventory_transfers: { rows: [
      // reposição SEM requisito (o caso do QA: TR-260925-DF0DF) e a de um requisito fora da cobertura lida
      { organization_id: 'o', id: 't1', transfer_number: 'TR-260925-DF0DF', status: 'APPROVED', from_location_id: 'W', expected_arrival: null },
      { organization_id: 'o', id: 't2', transfer_number: 'TR-OUTRO', status: 'REQUESTED', from_location_id: 'W', expected_arrival: null },
      { organization_id: 'o', id: 't3', transfer_number: 'TR-VIAGEM', status: 'IN_TRANSIT', from_location_id: 'N', expected_arrival: '2026-09-30' }] },
    inventory_transfer_lines: { rows: [
      { organization_id: 'o', id: 'l1', transfer_id: 't1', requirement_id: null, item_id: 'i1', quantity: '70', dispatched_quantity: '0',
        received_quantity: '0', source_reservation_id: null },
      { organization_id: 'o', id: 'l2', transfer_id: 't2', requirement_id: 'r-fora', item_id: 'i1', quantity: '330', dispatched_quantity: '0',
        received_quantity: '0', source_reservation_id: null },
      // move reserva: já está em "reservado" — não é pendente
      { organization_id: 'o', id: 'l3', transfer_id: 't2', requirement_id: 'r-fora', item_id: 'i1', quantity: '50', dispatched_quantity: '0',
        received_quantity: '0', source_reservation_id: 'res-1' },
      { organization_id: 'o', id: 'l4', transfer_id: 't3', requirement_id: 'r1', item_id: 'i1', quantity: '20', dispatched_quantity: '20',
        received_quantity: '0', source_reservation_id: null }] },
  });
  const pendingHeadRead = (c: Call) => c.table === 'inventory_transfers'
    && c.ops.some(([m, a]) => m === 'in' && a[0] === 'status' && (a[1] as string[]).includes('REQUESTED'));
  const pendingLineRead = (c: Call) => c.table === 'inventory_transfer_lines' && c.ops.some(([m, a]) => m === 'in' && a[0] === 'transfer_id');

  it('lê as pedidas/aprovadas da organização e as suas linhas com qualquer requisito (ou nenhum) — o saldo de W some da Apex', async () => {
    const { gatherIntelligenceFacts } = await import('@/lib/supply/intelligence-read');
    const calls: Call[] = [];
    const f = await gatherIntelligenceFacts('o', today, fakeClient(tables(), calls) as never);
    expect(f.pendingTransfers).toEqual([
      { transferId: 't1', number: 'TR-260925-DF0DF', status: 'APPROVED', requirementId: null, itemId: 'i1', fromLocationId: 'W', quantity: 70 },
      { transferId: 't2', number: 'TR-OUTRO', status: 'REQUESTED', requirementId: 'r-fora', itemId: 'i1', fromLocationId: 'W', quantity: 330 }]);
    // a despachada segue como entrada do requisito, pela leitura dos requisitos
    expect(f.inbound).toEqual([expect.objectContaining({ requirementId: 'r1', kind: 'TRANSFER', refNumber: 'TR-VIAGEM', quantity: 20 })]);
    // as pedidas: por estado, na organização; as linhas: pelas transferências (nunca só pelos requisitos da cobertura)
    expect(calls.find(pendingHeadRead)?.ops).toEqual(expect.arrayContaining([['eq', ['organization_id', 'o']],
      ['in', ['status', ['REQUESTED', 'APPROVED']]]]));
    expect(calls.find(pendingLineRead)?.ops).toEqual(expect.arrayContaining([['eq', ['organization_id', 'o']], ['in', ['transfer_id', ['t1', 't2']]]]));
    // W inteiro prometido: a Apex não recomenda transferir dali — compra
    const s = computeSignals(f);
    expect(s.filter((x) => x.kind === 'ALTERNATE_STOCK')).toEqual([]);
    expect(s.find((x) => x.kind === 'SHORTAGE')?.recommended_action.payload.quantity).toBe(300);
  });

  it('tudo-ou-nada: a leitura das pedidas (ou das suas linhas) que falha aborta a Apex — nunca "nada prometido"', async () => {
    const { gatherIntelligenceFacts, IncompleteIntelligenceRead } = await import('@/lib/supply/intelligence-read');
    const failing = (pick: (c: Call) => boolean, table: string) => {
      const t = tables();
      const base = t[table] as Spec;
      t[table] = (c: Call) => (pick(c) ? { error: 'timeout' } : base);
      return fakeClient(t, []) as never;
    };
    await expect(gatherIntelligenceFacts('o', today, failing(pendingHeadRead, 'inventory_transfers')))
      .rejects.toBeInstanceOf(IncompleteIntelligenceRead);
    await expect(gatherIntelligenceFacts('o', today, failing(pendingLineRead, 'inventory_transfer_lines')))
      .rejects.toBeInstanceOf(IncompleteIntelligenceRead);
  });
});

describe('Apex · requisição parada: só o que está EM ABERTO (248)', () => {
  type Spec = { rows?: Array<Record<string, unknown>>; error?: string };
  /** Cliente falso: `eq`/`in` filtram as colunas presentes na linha; `range` pagina. */
  function fakeClient(tables: Record<string, Spec>, calls: string[] = []) {
    return {
      rpc: async () => ({ data: null, error: null }),
      from: (table: string) => {
        calls.push(table);
        const ops: Array<[string, unknown[]]> = [];
        let from = 0; let to = Number.MAX_SAFE_INTEGER;
        const chain: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'in', 'not', 'gt', 'gte', 'order', 'or', 'limit']) {
          chain[m] = (...args: unknown[]) => { ops.push([m, args]); return chain; };
        }
        chain.range = (f: number, t: number) => { from = f; to = t; return chain; };
        chain.then = (resolve: (v: unknown) => unknown) => {
          const spec = tables[table] ?? { rows: [] };
          if (spec.error) return resolve({ data: null, error: { message: spec.error } });
          let rows = spec.rows ?? [];
          for (const [m, a] of ops) {
            const [col, val] = a as [string, unknown];
            if (m === 'eq') rows = rows.filter((r) => !(col in r) || r[col] === val);
            if (m === 'in') rows = rows.filter((r) => !(col in r) || (val as unknown[]).includes(r[col]));
          }
          return resolve({ data: rows.slice(from, to + 1), error: null });
        };
        return chain;
      },
    };
  }
  const open = (id: string, line: string, requirement: string, allocated: number, released: number) => ({ organization_id: 'o',
    allocation_id: id, requisition_line_id: line, requirement_id: requirement, allocated_qty: String(allocated), released_qty: String(released),
    open_qty: String(allocated - released) });
  const tables = (over: Record<string, Spec> = {}): Record<string, Spec> => ({
    purchase_requisitions: { rows: [
      // o cabeçalho guarda a data do R2, que foi liberado: não é mais a necessidade
      { organization_id: 'o', id: 'rq-1', requisition_number: 'RC-1', status: 'SOURCING', requested_at: '2026-09-20T10:00:00Z', project_id: 'p1',
        required_by: '2026-09-26' },
      { organization_id: 'o', id: 'rq-2', requisition_number: 'RC-2', status: 'SUBMITTED', requested_at: '2026-09-21T10:00:00Z', project_id: 'p1',
        required_by: '2026-09-27' },
      { organization_id: 'o', id: 'rq-3', requisition_number: 'RC-3', status: 'SUBMITTED', requested_at: '2026-09-22T10:00:00Z', project_id: 'p1',
        required_by: '2026-10-03' },
    ] },
    purchase_requisition_lines: { rows: [
      { organization_id: 'o', id: 'l1', requisition_id: 'rq-1', quantity: '150', required_by: '2026-09-26' },
      { organization_id: 'o', id: 'l2', requisition_id: 'rq-2', quantity: '30', required_by: '2026-09-27' },
      // manual: sem alocação, o aberto é a própria linha
      { organization_id: 'o', id: 'l3', requisition_id: 'rq-3', quantity: '5', required_by: '2026-10-03' },
    ] },
    purchase_requisition_open_allocations: { rows: [
      open('a1', 'l1', 'r1', 100, 40), open('a2', 'l1', 'r2', 50, 50), open('a3', 'l2', 'r1', 30, 30)] },
    purchase_requisition_line_requirements: { rows: [
      { organization_id: 'o', id: 'a1', line_id: 'l1', requirement_id: 'r1', quantity: '100' },
      { organization_id: 'o', id: 'a2', line_id: 'l1', requirement_id: 'r2', quantity: '50' },
      { organization_id: 'o', id: 'a3', line_id: 'l2', requirement_id: 'r1', quantity: '30' }] },
    project_requirements: { rows: [
      { organization_id: 'o', id: 'r1', required_by: '2026-10-01' }, { organization_id: 'o', id: 'r2', required_by: '2026-09-26' }] },
    // a cotação da RC-1 foi cancelada com o pedido; a da RC-3 está aberta
    procurement_rfq_lines: { rows: [
      { organization_id: 'o', id: 'x1', requisition_line_id: 'l1', rfq_id: 'rfq-old' },
      { organization_id: 'o', id: 'x3', requisition_line_id: 'l3', rfq_id: 'rfq-open' }] },
    procurement_rfqs: { rows: [{ organization_id: 'o', id: 'rfq-old', status: 'CANCELLED' }, { organization_id: 'o', id: 'rfq-open', status: 'OPEN' }] },
    ...over,
  });
  afterEach(() => resetRequisition248Fallback());

  it('requisitos e necessidade das alocações abertas; a toda liberada não é "parada"; cotação cancelada não é "em cotação"', async () => {
    const { gatherIntelligenceFacts } = await import('@/lib/supply/intelligence-read');
    const f = await gatherIntelligenceFacts('o', today, fakeClient(tables()) as never);
    expect(f.requisitions).toEqual([
      { id: 'rq-1', number: 'RC-1', status: 'SOURCING', requestedAt: '2026-09-20T10:00:00Z', requirementIds: ['r1'], needDate: '2026-10-01',
        projectId: 'p1', inRfq: false },
      { id: 'rq-3', number: 'RC-3', status: 'SUBMITTED', requestedAt: '2026-09-22T10:00:00Z', requirementIds: [], needDate: '2026-10-03',
        projectId: 'p1', inRfq: true },
    ]);
    const s = computeSignals(f).filter((x) => x.signal_key.startsWith('decision:req:'));
    expect(s.map((x) => [x.title, x.requirement_id])).toEqual([
      ['Requisição RC-1 sem cotação há 4 dia(s)', 'r1'], ['Requisição RC-3 em cotação há 2 dia(s)', null]]);
    expect(s[0].rationale).toMatch(/^A necessidade é 01\/10\/2026 .* Abra a cotação/);
  });

  it('"em cotação" é a regra do banco: DECIDIDA só se o pedido (não cancelado) da decisão pediu a linha — f3 e pedido cancelado: "sem cotação"', async () => {
    const { gatherIntelligenceFacts } = await import('@/lib/supply/intelligence-read');
    const rq = (n: number) => ({ organization_id: 'o', id: `rq-${n}`, requisition_number: `RC-${n}`, status: 'SOURCING',
      requested_at: '2026-09-20T10:00:00Z', project_id: 'p1', required_by: '2026-10-10' });
    const f = await gatherIntelligenceFacts('o', today, fakeClient(tables({
      purchase_requisitions: { rows: [rq(4), rq(5), rq(6)] },
      // manuais: sem alocação, o aberto é a própria linha
      purchase_requisition_lines: { rows: [4, 5, 6].map((n) => ({ organization_id: 'o', id: `l${n}`, requisition_id: `rq-${n}`, quantity: '10',
        required_by: '2026-10-10' })) },
      procurement_rfq_lines: { rows: [
        // RC-4: a proposta vencedora da COT-F não cotou l4 — o OC-F nasceu só com a linha de outra requisição (f3)
        { organization_id: 'o', id: 'x4', requisition_line_id: 'l4', rfq_id: 'rfq-f' },
        // RC-5: o OC-D (ainda em rascunho) pediu l5
        { organization_id: 'o', id: 'x5', requisition_line_id: 'l5', rfq_id: 'rfq-d' },
        // RC-6: o pedido da COT-K foi cancelado
        { organization_id: 'o', id: 'x6', requisition_line_id: 'l6', rfq_id: 'rfq-k' }] },
      procurement_rfqs: { rows: ['f', 'd', 'k'].map((k) => ({ organization_id: 'o', id: `rfq-${k}`, status: 'DECIDED' })) },
      sourcing_decisions: { rows: ['f', 'd', 'k'].map((k) => ({ organization_id: 'o', id: `dec-${k}`, rfq_id: `rfq-${k}` })) },
      purchase_orders: { rows: [
        { organization_id: 'o', id: 'po-f', order_number: 'OC-F', supplier_id: 's1', project_id: 'p1', status: 'DRAFT', sourcing_decision_id: 'dec-f' },
        { organization_id: 'o', id: 'po-d', order_number: 'OC-D', supplier_id: 's1', project_id: 'p1', status: 'DRAFT', sourcing_decision_id: 'dec-d' },
        { organization_id: 'o', id: 'po-k', order_number: 'OC-K', supplier_id: 's1', project_id: 'p1', status: 'CANCELLED', sourcing_decision_id: 'dec-k' }] },
      purchase_order_lines: { rows: [
        { organization_id: 'o', id: 'pl-f', purchase_order_id: 'po-f', requisition_line_id: 'l-outra', quantity: '5', received_quantity: '0' },
        { organization_id: 'o', id: 'pl-d', purchase_order_id: 'po-d', requisition_line_id: 'l5', quantity: '10', received_quantity: '0' },
        { organization_id: 'o', id: 'pl-k', purchase_order_id: 'po-k', requisition_line_id: 'l6', quantity: '10', received_quantity: '0' }] },
      purchase_requisition_open_allocations: { rows: [] },
    })) as never);
    expect(f.requisitions.map((q) => [q.number, q.inRfq])).toEqual([['RC-4', false], ['RC-5', true], ['RC-6', false]]);
    const s = computeSignals(f).filter((x) => x.signal_key.startsWith('decision:req:'));
    expect(s.find((x) => x.title.startsWith('Requisição RC-4'))?.rationale).toMatch(/Abra a cotação/);
  });

  it('f3 na MESMA requisição: a linha já pedida não põe a requisição "em cotação" — a não cotada pede cotação, com a data e o requisito dela', async () => {
    const { gatherIntelligenceFacts } = await import('@/lib/supply/intelligence-read');
    const rq = (n: number) => ({ organization_id: 'o', id: `rq-${n}`, requisition_number: `RC-${n}`, status: 'SOURCING',
      requested_at: '2026-09-20T10:00:00Z', project_id: 'p1', required_by: '2026-10-01' });
    const line = (id: string, rqn: number) => ({ organization_id: 'o', id, requisition_id: `rq-${rqn}`, quantity: '1', required_by: '2026-10-01' });
    const f = await gatherIntelligenceFacts('o', today, fakeClient(tables({
      purchase_requisitions: { rows: [rq(7), rq(8)] },
      // RC-7: cabo (lx, r1) pedido no OC-X; conector (ly, r2) não cotado pela proposta vencedora da mesma COT-X (f3)
      // RC-8: cabo (lz, r1) numa cotação ABERTA; conector (lw, r2) nunca cotado
      purchase_requisition_lines: { rows: [line('lx', 7), line('ly', 7), line('lz', 8), line('lw', 8)] },
      purchase_requisition_open_allocations: { rows: [
        open('ax', 'lx', 'r1', 100, 0), open('ay', 'ly', 'r2', 50, 0), open('az', 'lz', 'r1', 100, 0), open('aw', 'lw', 'r2', 50, 0)] },
      purchase_requisition_line_requirements: { rows: [] },
      project_requirements: { rows: [
        { organization_id: 'o', id: 'r1', required_by: '2026-10-01' }, { organization_id: 'o', id: 'r2', required_by: '2026-10-08' }] },
      procurement_rfq_lines: { rows: [
        { organization_id: 'o', id: 'xx', requisition_line_id: 'lx', rfq_id: 'rfq-x' },
        { organization_id: 'o', id: 'xy', requisition_line_id: 'ly', rfq_id: 'rfq-x' },
        { organization_id: 'o', id: 'xz', requisition_line_id: 'lz', rfq_id: 'rfq-o' }] },
      procurement_rfqs: { rows: [{ organization_id: 'o', id: 'rfq-x', status: 'DECIDED' }, { organization_id: 'o', id: 'rfq-o', status: 'OPEN' }] },
      sourcing_decisions: { rows: [{ organization_id: 'o', id: 'dec-x', rfq_id: 'rfq-x' }] },
      purchase_orders: { rows: [
        { organization_id: 'o', id: 'po-x', order_number: 'OC-X', supplier_id: 's1', project_id: 'p1', status: 'ISSUED', sourcing_decision_id: 'dec-x' }] },
      purchase_order_lines: { rows: [
        { organization_id: 'o', id: 'pl-x', purchase_order_id: 'po-x', requisition_line_id: 'lx', quantity: '100', received_quantity: '0' }] },
    })) as never);
    expect(f.requisitions.map((q) => [q.number, q.inRfq, q.requirementIds, q.needDate])).toEqual([
      ['RC-7', false, ['r2'], '2026-10-08'], ['RC-8', false, ['r1', 'r2'], '2026-10-01']]);
    const s = computeSignals(f).filter((x) => x.signal_key.startsWith('decision:req:'));
    const rc7 = s.find((x) => x.title.startsWith('Requisição RC-7'));
    expect(rc7?.title).toMatch(/sem cotação/);
    expect(rc7?.requirement_id).toBe('r2');
    expect(rc7?.rationale).toMatch(/^A necessidade é 08\/10\/2026 .* Abra a cotação/);
    expect(s.find((x) => x.title.startsWith('Requisição RC-8'))?.title).toMatch(/sem cotação/);
  });

  it('banco sem a 248: a tabela de alocações (nada liberado ainda); outro erro na visão aborta a Apex', async () => {
    const { gatherIntelligenceFacts, IncompleteIntelligenceRead } = await import('@/lib/supply/intelligence-read');
    const calls: string[] = [];
    const missing = "Could not find the table 'public.purchase_requisition_open_allocations' in the schema cache";
    const f = await gatherIntelligenceFacts('o', today, fakeClient(tables({ purchase_requisition_open_allocations: { error: missing } }), calls) as never);
    expect(f.requisitions.map((q) => [q.number, q.requirementIds, q.needDate])).toEqual([
      ['RC-1', ['r1', 'r2'], '2026-09-26'], ['RC-2', ['r1'], '2026-10-01'], ['RC-3', [], '2026-10-03']]);
    expect(calls).toContain('purchase_requisition_line_requirements');
    resetRequisition248Fallback();
    await expect(gatherIntelligenceFacts('o', today, fakeClient(tables({ purchase_requisition_open_allocations: { error: 'timeout' } })) as never))
      .rejects.toBeInstanceOf(IncompleteIntelligenceRead);
  });
});
