/**
 * Recebimento com volume acima do limite da URL. Regressão: com ~250 itens em aberto a busca `.in('id', …)` passava de
 * 8 KB e a API devolvia 414 (medido no QA: 200 ids passam, 260 dão 414). O erro era ignorado, as linhas perdiam código
 * e unidade ("Chegou bom ()") e o caminho dourado não achava `Recebido <código>`. Aqui o cliente falso recusa, como a
 * API, qualquer `.in` com mais de 200 ids, e a leitura tem centenas de ids em cada lista.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/commercial/owner-directory', () => ({ resolveOwnerNames: async () => ({}) }));

import { receivingWorkspace } from '@/lib/supply/receiving-read';
import { SELECT_IN_CHUNK } from '@/lib/supabase/select-in';

type R = Record<string, unknown>;
type Spec = { rows: R[]; failOn?: string; extra?: R[] };
type Call = { table: string; ops: Array<[string, unknown[]]> };
const URL_LIMIT_IDS = 200;

/** Cliente falso: `eq`/`in` filtram, `order`/`limit` valem; `.in` acima do limite volta 414 como a API. */
function fakeClient(tables: Record<string, Spec>, calls: Call[] = []) {
  return {
    from: (table: string) => {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const chain: R = {};
      for (const m of ['select', 'eq', 'in', 'or', 'order', 'limit']) chain[m] = (...args: unknown[]) => { call.ops.push([m, args]); return chain; };
      chain.then = (resolve: (v: unknown) => unknown) => {
        const spec = tables[table] ?? { rows: [] };
        let rows = spec.rows;
        for (const [m, args] of call.ops) {
          const [col, val] = args as [string, unknown];
          if (m === 'in') {
            const ids = val as unknown[];
            if (ids.length > URL_LIMIT_IDS) return resolve({ data: null, error: { message: 'URI Too Long' } });
            if (spec.failOn && ids.includes(spec.failOn)) return resolve({ data: null, error: { message: 'statement timeout' } });
            rows = rows.filter((r) => ids.includes(r[col]));
          }
          if (m === 'eq') rows = rows.filter((r) => r[col] === val);
          if (m === 'order') {
            const asc = (args[1] as { ascending?: boolean } | undefined)?.ascending !== false;
            rows = [...rows].sort((a, b) => (asc ? 1 : -1) * String(a[col] ?? '').localeCompare(String(b[col] ?? '')));
          }
          if (m === 'limit') rows = rows.slice(0, args[0] as number);
        }
        return resolve({ data: [...rows, ...(spec.extra ?? [])], error: null });
      };
      return chain;
    },
  };
}

const O = 'o';
const TODAY = '2026-09-26';
const N_PO = 300; const N_TR = 280; const N_RC = 280;
const pad = (i: number) => String(i).padStart(4, '0');

/** 300 pedidos (um item cada), 280 transferências (outro item cada) e 280 recebimentos: 580 itens, 300 pedidos, 280 recebimentos. */
function tables(over: Record<string, Partial<Spec>> = {}): Record<string, Spec> {
  const base: Record<string, Spec> = {
    purchase_orders: { rows: Array.from({ length: N_PO }, (_, i) => ({ organization_id: O, id: `po-${pad(i)}`, order_number: `OC-${pad(i)}`,
      supplier_id: `sup-${i % 250}`, project_id: `prj-${i}`, status: 'ISSUED', expected_delivery: '2026-10-04', delivery_location_id: 'loc-1' })) },
    purchase_order_lines: { rows: Array.from({ length: N_PO }, (_, i) => ({ organization_id: O, id: `pl-${pad(i)}`, purchase_order_id: `po-${pad(i)}`,
      item_id: `it-po-${pad(i)}`, quantity: '60', received_quantity: '0', expected_date: '2026-10-04' })) },
    inventory_transfers: { rows: Array.from({ length: N_TR }, (_, i) => ({ organization_id: O, id: `tr-${pad(i)}`, transfer_number: `TR-${pad(i)}`,
      from_location_id: 'loc-1', to_location_id: 'loc-2', project_id: `prj-tr-${i}`, status: 'IN_TRANSIT', expected_arrival: '2026-10-01' })) },
    inventory_transfer_lines: { rows: Array.from({ length: N_TR }, (_, i) => ({ organization_id: O, id: `tl-${pad(i)}`, transfer_id: `tr-${pad(i)}`,
      item_id: `it-tr-${pad(i)}`, quantity: '5', dispatched_quantity: '5', received_quantity: '0' })) },
    goods_receipts: { rows: Array.from({ length: N_RC }, (_, i) => ({ organization_id: O, id: `rc-${pad(i)}`, receipt_number: `RC-${pad(i)}`,
      purchase_order_id: `po-${pad(i)}`, location_id: 'loc-1', received_at: `2026-09-2${i % 5}T10:00:00Z`, received_by: null, inspection_status: 'NONE' })) },
    goods_receipt_lines: { rows: Array.from({ length: N_RC }, (_, i) => ({ organization_id: O, id: `rl-${pad(i)}`, receipt_id: `rc-${pad(i)}`,
      po_line_id: `pl-${pad(i)}`, item_id: `it-po-${pad(i)}`, accepted_quantity: '1', rejected_quantity: '0' })) },
    goods_receipt_evidence: { rows: [] },
    // Embarques de dois pedidos que caem em lotes diferentes (po-0000 no 1º, po-0250 no 3º), criados fora de ordem.
    inbound_shipments: { rows: [
      { organization_id: O, id: 'sh-a', shipment_number: 'EMB-A', purchase_order_id: 'po-0000', status: 'EXPECTED', created_at: '2026-09-20T10:00:00Z' },
      { organization_id: O, id: 'sh-b', shipment_number: 'EMB-B', purchase_order_id: 'po-0250', status: 'IN_TRANSIT', created_at: '2026-09-25T10:00:00Z' },
      { organization_id: O, id: 'sh-c', shipment_number: 'EMB-C', purchase_order_id: 'po-0000', status: 'IN_TRANSIT', created_at: '2026-09-24T10:00:00Z' },
      { organization_id: O, id: 'sh-d', shipment_number: 'EMB-D', purchase_order_id: 'po-0250', status: 'EXPECTED', created_at: '2026-09-21T10:00:00Z' },
    ] },
    inventory_locations: { rows: [{ organization_id: O, id: 'loc-1', name: 'Almoxarifado Central', kind: 'WAREHOUSE', active: true },
      { organization_id: O, id: 'loc-2', name: 'Canteiro', kind: 'SITE', active: true }] },
    supplier_profiles: { rows: Array.from({ length: 250 }, (_, i) => ({ organization_id: O, id: `sup-${i}`, party_id: `pty-${i}` })) },
    parties: { rows: Array.from({ length: 250 }, (_, i) => ({ organization_id: O, id: `pty-${i}`, legal_name: `Fornecedor ${i}`, trade_name: null })) },
    projects: { rows: [...Array.from({ length: N_PO }, (_, i) => ({ organization_id: O, id: `prj-${i}`, project: { nome: `Obra ${i}` }, project_v2: null })),
      ...Array.from({ length: N_TR }, (_, i) => ({ organization_id: O, id: `prj-tr-${i}`, project: { nome: `Obra TR ${i}` }, project_v2: null }))] },
    supply_items: { rows: [...Array.from({ length: N_PO }, (_, i) => ({ organization_id: O, id: `it-po-${pad(i)}`, code: `CABO-${pad(i)}`, description: 'Cabo', unit: 'm', tracking: 'NONE' })),
      ...Array.from({ length: N_TR }, (_, i) => ({ organization_id: O, id: `it-tr-${pad(i)}`, code: `TR-IT-${pad(i)}`, description: 'Conector', unit: 'un', tracking: 'NONE' }))] },
    supplier_delivery_performance: { rows: [] },
  };
  for (const [t, o] of Object.entries(over)) base[t] = { ...base[t], ...o } as Spec;
  return base;
}

const inCalls = (calls: Call[]) => calls.flatMap((c) => c.ops.filter(([m]) => m === 'in').map(([, a]) => ({ table: c.table, col: a[0] as string, n: (a[1] as unknown[]).length })));

describe('Recebimento — leitura acima do limite da URL (> 260 ids)', () => {
  it('todos os itens chegam com código e unidade; nenhum `.in` passa do lote', async () => {
    const calls: Call[] = [];
    const m = await receivingWorkspace({ supabase: fakeClient(tables(), calls) as never, organizationId: O }, TODAY);

    expect(m.inbound).toHaveLength(N_PO);
    const poLines = m.inbound.flatMap((p) => p.lines);
    expect(poLines).toHaveLength(N_PO);
    expect(poLines.every((l) => /^CABO-\d{4}$/.test(l.itemCode) && l.unit === 'm')).toBe(true);
    expect(m.inbound.find((p) => p.id === 'po-0299')!.lines[0]).toMatchObject({ itemCode: 'CABO-0299', unit: 'm', open: 60 });
    const trLines = m.inboundTransfers.flatMap((t) => t.lines);
    expect(trLines).toHaveLength(N_TR);
    expect(trLines.every((l) => /^TR-IT-\d{4}$/.test(l.itemCode) && l.unit === 'un')).toBe(true);
    expect(m.receipts).toHaveLength(N_RC);
    expect(m.receipts.every((r) => r.lines.length === 1 && r.lines[0].itemCode !== '—' && r.orderNumber !== '—' && r.supplier !== 'Fornecedor')).toBe(true);
    expect(m.inbound.every((p) => p.counterpart.startsWith('Fornecedor ') && p.project === `Obra ${Number(p.id.slice(3))}`)).toBe(true);

    // Cada lista grande foi em lotes: 580 itens → 6 consultas; nenhuma acima do lote seguro.
    const ins = inCalls(calls).filter((c) => c.col !== 'status');
    expect(Math.max(...ins.map((c) => c.n))).toBeLessThanOrEqual(SELECT_IN_CHUNK);
    expect(ins.filter((c) => c.table === 'supply_items')).toHaveLength(Math.ceil((N_PO + N_TR) / SELECT_IN_CHUNK));
    expect(ins.filter((c) => c.table === 'supply_items').reduce((a, c) => a + c.n, 0)).toBe(N_PO + N_TR);
    for (const t of ['purchase_order_lines', 'inbound_shipments', 'goods_receipt_lines', 'goods_receipt_evidence', 'inventory_transfer_lines', 'projects', 'parties']) {
      expect(ins.filter((c) => c.table === t).length, t).toBeGreaterThan(1);
    }
    // A organização vai em toda consulta.
    for (const c of calls) expect(c.ops.some(([op, a]) => op === 'eq' && a[0] === 'organization_id' && a[1] === O), c.table).toBe(true);
  });

  it('embarques de lotes diferentes: a ordem (mais recente primeiro) vale para cada pedido', async () => {
    const m = await receivingWorkspace({ supabase: fakeClient(tables()) as never, organizationId: O }, TODAY);
    expect(m.inbound.find((p) => p.id === 'po-0000')!.shipments.map((s) => s.number)).toEqual(['EMB-C', 'EMB-A']);
    expect(m.inbound.find((p) => p.id === 'po-0250')!.shipments.map((s) => s.number)).toEqual(['EMB-B', 'EMB-D']);
  });

  it('linha repetida entre lotes sai (pelo id): nada dobra', async () => {
    const dupLine = { organization_id: O, id: 'pl-0007', purchase_order_id: 'po-0007', item_id: 'it-po-0007', quantity: '60', received_quantity: '0' };
    const dupItem = { organization_id: O, id: 'it-po-0007', code: 'CABO-0007', description: 'Cabo', unit: 'm', tracking: 'NONE' };
    const m = await receivingWorkspace({ supabase: fakeClient(tables({ purchase_order_lines: { extra: [dupLine] }, supply_items: { extra: [dupItem] } })) as never,
      organizationId: O }, TODAY);
    expect(m.inbound.find((p) => p.id === 'po-0007')!.lines).toHaveLength(1);
    expect(m.inbound.flatMap((p) => p.lines)).toHaveLength(N_PO);
  });

  it('um lote que falha SOBE com o nome do que faltou — não vira item sem código', async () => {
    const read = (over: Record<string, Partial<Spec>>) => receivingWorkspace({ supabase: fakeClient(tables(over)) as never, organizationId: O }, TODAY);
    await expect(read({ supply_items: { failOn: 'it-tr-0200' } as Partial<Spec> })).rejects.toThrow('Não foi possível ler o recebimento (os itens).');
    await expect(read({ purchase_order_lines: { failOn: 'po-0299' } as Partial<Spec> })).rejects.toThrow('(as linhas dos pedidos)');
    await expect(read({ parties: { failOn: 'pty-249' } as Partial<Spec> })).rejects.toThrow('(os fornecedores)');
    const failed = await read({ inventory_transfer_lines: { failOn: 'tr-0001' } as Partial<Spec> }).then(() => null, (e: Error) => e);
    expect((failed?.cause as Error | undefined)?.message).toBe('statement timeout');
  });
});
