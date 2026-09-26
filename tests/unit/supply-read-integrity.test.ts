/**
 * Revisão final do Supply — leituras em volume e SEM falha calada.
 *
 * O cliente falso recusa, como a API (medido no QA: 200 ids passam, 260 dão 414), qualquer `.in` com mais de 200 ids,
 * e derruba o lote que citar `failOn`. Regressões:
 *   - Planejamento da carteira: ~900 requisitos em ~760 obras davam 414 na cobertura e a tela caía inteira
 *     ("Não foi possível ler a cobertura de material."); os nomes das obras sumiam calados (viravam ids).
 *   - Caixa de Decisões: os cartões de compra de centenas de pedidos (linhas, requisitos, sinais críticos) em lotes, e
 *     tudo ou nada — um sinal crítico que não carregou não vira "nada crítico".
 *   - Detalhe da decisão de compra: pedido de 250 linhas com 300 requisitos carrega; local e pontualidade que falham
 *     sobem com o nome do que faltou.
 *   - Leituras do Supply que engoliam o erro: alçadas, pedidos e pontualidade dos fornecedores, histórico do fornecedor,
 *     locais/fornecedores/pontualidade do recebimento, catálogo do estoque, locais da torre de controle.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

type R = Record<string, unknown>;
type Spec = { rows: R[]; failOn?: string; error?: string };
type Call = { table: string; ins: number[] };
const URL_LIMIT_IDS = 200;
/** O `max_rows` do PostgREST: nenhuma resposta passa disso, seja qual for o `.limit()` (medido no QA: 0-999/1139). */
const MAX_ROWS = 1000;

const mocks = vi.hoisted(() => ({ client: { current: null as unknown } }));
vi.mock('@/lib/platform/server-client', () => ({ platformServiceClient: () => mocks.client.current }));
vi.mock('@/lib/commercial/owner-directory', () => ({ resolveOwnerNames: async () => ({}) }));

import { supplyCoverageLoader } from '@/lib/operations/planning/coverage';
import { portfolioPlanning } from '@/lib/operations/planning/read-model';
import { enrichInbox } from '@/lib/decisions/read';
import { purchaseOrderDetail } from '@/lib/decisions/detail-procurement';
import { listAuthorities, listSuppliers, supplierDetail } from '@/lib/supply/procurement-read';
import { receivingWorkspace } from '@/lib/supply/receiving-read';
import { inventoryWorkspace, listLocations } from '@/lib/supply/inventory-read';
import { listItems, materialDemand } from '@/lib/supply/read-model';
import { supplyControlTower } from '@/lib/supply/control-tower';
import { SELECT_IN_CHUNK } from '@/lib/supabase/select-in';
import type { DecisionInboxRow } from '@/lib/decisions/types';

/** Cliente falso: eq/in/is filtram; limit/range cortam; `.in` acima do limite volta 414; `failOn` derruba o lote. */
function fakeClient(tables: Record<string, Spec>, calls: Call[] = []) {
  return {
    from: (table: string) => {
      const call: Call = { table, ins: [] };
      calls.push(call);
      const ops: Array<[string, unknown[]]> = [];
      let single = false;
      const chain: R = {};
      for (const m of ['select', 'eq', 'in', 'or', 'order', 'limit', 'not', 'is', 'range', 'neq', 'gte', 'lte', 'lt', 'gt']) {
        chain[m] = (...args: unknown[]) => { ops.push([m, args]); return chain; };
      }
      chain.maybeSingle = () => { single = true; return chain; };
      chain.single = () => { single = true; return chain; };
      chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        try {
          const spec = tables[table] ?? { rows: [] };
          if (spec.error) return resolve({ data: null, error: { message: spec.error } });
          let rows = spec.rows;
          for (const [m, args] of ops) {
            const [col, val] = args as [string, unknown];
            if (m === 'in') {
              const ids = val as unknown[];
              call.ins.push(ids.length);
              if (ids.length > URL_LIMIT_IDS) return resolve({ data: null, error: { message: 'URI Too Long' } });
              if (spec.failOn && ids.includes(spec.failOn)) return resolve({ data: null, error: { message: 'statement timeout' } });
              rows = rows.filter((r) => !(col in r) || ids.includes(r[col]));
            }
            if (m === 'eq') rows = rows.filter((r) => !(col in r) || r[col] === val);
            if (m === 'is') rows = rows.filter((r) => !(col in r) || r[col] === val);
            if (m === 'limit') rows = rows.slice(0, args[0] as number);
            if (m === 'range') rows = rows.slice(args[0] as number, (args[1] as number) + 1);
          }
          return resolve({ data: single ? rows[0] ?? null : rows.slice(0, MAX_ROWS), error: null, count: rows.length });
        } catch (e) { return reject ? reject(e) : Promise.reject(e); }
      };
      return chain;
    },
    rpc: async () => ({ data: null, error: null }),
  };
}
const inCalls = (calls: Call[]) => calls.flatMap((c) => c.ins);
const O = 'org-1';
const pad = (i: number) => String(i).padStart(4, '0');
afterEach(() => { mocks.client.current = null; vi.restoreAllMocks(); });

// ─────────────────────────────────────────────────────────────────────────────
describe('Planejamento da carteira — ~900 requisitos em ~760 obras (antes: 414 e a tela inteira caía)', () => {
  const N_REQ = 900; const N_PROJ = 763;
  const tables = (over: Record<string, Partial<Spec>> = {}): Record<string, Spec> => {
    const base: Record<string, Spec> = {
      project_requirements: { rows: Array.from({ length: N_REQ }, (_, i) => ({ organization_id: O, id: `rq-${pad(i)}`, project_id: `pj-${i % N_PROJ}`,
        activity_id: null, requirement_type: 'MATERIAL', title: `Cabo ${i}`, quantity: 10, unit: 'm', required_by: '2026-10-20', status: 'CONFIRMED',
        item_id: `it-${i}`, priority: 'medium' })) },
      project_timeline_items: { rows: [] },
      projects: { rows: Array.from({ length: N_PROJ }, (_, i) => ({ organization_id: O, id: `pj-${i}`, project: { nome: `Obra ${i}` }, project_v2: null })) },
      supply_requirement_coverage: { rows: Array.from({ length: N_REQ }, (_, i) => ({ organization_id: O, requirement_id: `rq-${pad(i)}`,
        required_qty: 10, reserved_qty: i % 2 ? 10 : 0, consumed_qty: 0, in_transit_qty: 0, on_order_qty: 0, requested_qty: 0, inspection_qty: 0,
        pending_transfer_qty: 0, purchasable_qty: i % 2 ? 0 : 10 })) },
    };
    for (const [t, o] of Object.entries(over)) base[t] = { ...base[t], ...o } as Spec;
    return base;
  };
  const session = (t: Record<string, Spec>, calls?: Call[]) => ({ supabase: fakeClient(t, calls) as never, organizationId: O });

  it('a carteira carrega: cobertura de todos os requisitos e o NOME de todas as obras; nenhum `.in` passa do lote', async () => {
    const calls: Call[] = [];
    const m = await portfolioPlanning(session(tables(), calls), '2026-09-26', supplyCoverageLoader);
    expect(m.requirements).toHaveLength(N_REQ);
    expect(m.requirements.every((r) => r.coverage !== null)).toBe(true);
    expect(m.requirements.find((r) => r.id === 'rq-0001')!.coverage).toMatchObject({ covered: 10 });
    expect(m.requirements.every((r) => /^Obra \d+$/.test(String(r.project)))).toBe(true);
    expect(Math.max(...inCalls(calls))).toBeLessThanOrEqual(SELECT_IN_CHUNK);
  });

  it('um lote da cobertura que falha derruba a leitura com a mensagem de sempre (não vira "sem cobertura")', async () => {
    await expect(portfolioPlanning(session(tables({ supply_requirement_coverage: { failOn: 'rq-0450' } })), '2026-09-26', supplyCoverageLoader))
      .rejects.toThrow('Não foi possível ler a cobertura de material.');
  });

  it('um lote das obras que falha sobe (antes: o nome virava o id, calado)', async () => {
    await expect(portfolioPlanning(session(tables({ projects: { failOn: 'pj-700' } })), '2026-09-26', supplyCoverageLoader))
      .rejects.toThrow('Não foi possível consultar as obras.');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Caixa de Decisões — cartões de compra de centenas de pedidos', () => {
  const N_PO = 300;
  const row = (i: number): DecisionInboxRow => ({ decision_key: `k-${i}`, source_kind: 'PROCUREMENT_AUTHORITY', category: 'purchase',
    subject_type: 'purchase_order', subject_id: `po-${pad(i)}`, action_type: 'APPROVE', request_id: null, step_id: null, stage_no: null,
    submission: 1, title: `OC ${i}`, amount: 100, currency: 'BRL', project_id: null, requested_by: null, requested_at: '2026-09-25T10:00:00Z',
    due_at: null, need_by: null, decide_by: null, overdue: false, assignment: 'PRIMARY', state: 'PENDENTE', actions: ['APPROVE'],
    reason_required: [], fingerprint: null, authority: {} });
  const tables = (over: Record<string, Partial<Spec>> = {}): Record<string, Spec> => {
    const base: Record<string, Spec> = {
      purchase_orders: { rows: Array.from({ length: N_PO }, (_, i) => ({ organization_id: O, id: `po-${pad(i)}`, supplier_id: `sp-${i}`, sourcing_decision_id: null })) },
      purchase_order_lines: { rows: Array.from({ length: N_PO }, (_, i) => ({ organization_id: O, id: `pl-${pad(i)}`, purchase_order_id: `po-${pad(i)}`,
        item_id: `it-${i}`, quantity: 5, unit_price: 20 })) },
      supply_signals: { rows: [{ organization_id: O, purchase_order_id: 'po-0299', requirement_id: null, title: 'Falta crítica', severity: 'critical', status: 'OPEN' }] },
      supply_items: { rows: Array.from({ length: N_PO }, (_, i) => ({ organization_id: O, id: `it-${i}`, code: `CABO-${i}`, description: 'Cabo', unit: 'm' })) },
      purchase_order_line_requirements: { rows: Array.from({ length: N_PO }, (_, i) => ({ organization_id: O, line_id: `pl-${pad(i)}`, requirement_id: `rq-${i}` })) },
      project_requirements: { rows: Array.from({ length: N_PO }, (_, i) => ({ organization_id: O, id: `rq-${i}`, title: `Req ${i}`, priority: 'medium',
        status: 'CONFIRMED', project_id: `pj-${i}` })) },
      projects: { rows: Array.from({ length: N_PO }, (_, i) => ({ organization_id: O, id: `pj-${i}`, project: { nome: `Obra ${i}` }, project_v2: null })) },
      supplier_profiles: { rows: Array.from({ length: N_PO }, (_, i) => ({ organization_id: O, id: `sp-${i}`, party_id: `pt-${i}` })) },
      parties: { rows: Array.from({ length: N_PO }, (_, i) => ({ organization_id: O, id: `pt-${i}`, legal_name: `Fornecedor ${i}`, trade_name: null })) },
    };
    for (const [t, o] of Object.entries(over)) base[t] = { ...base[t], ...o } as Spec;
    return base;
  };
  const session = { supabase: {} as never, organizationId: O, userId: 'u-1' } as never;

  it('300 pedidos: todo cartão com contexto, o crítico só onde há sinal; nenhum `.in` passa do lote', async () => {
    const calls: Call[] = [];
    mocks.client.current = fakeClient(tables(), calls);
    const items = await enrichInbox(session, Array.from({ length: N_PO }, (_, i) => row(i)), '2026-09-26');
    expect(items).toHaveLength(N_PO);
    expect(items.every((it) => it.context.length > 0)).toBe(true);
    expect(items.filter((it) => it.critical)).toHaveLength(1);
    expect(Math.max(...inCalls(calls))).toBeLessThanOrEqual(SELECT_IN_CHUNK);
  });

  it('o lote dos sinais críticos falha → nenhum cartão pela metade: o contexto de compra some inteiro (e vai ao log)', async () => {
    mocks.client.current = fakeClient(tables({ supply_signals: { failOn: 'po-0150' } }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const items = await enrichInbox(session, Array.from({ length: N_PO }, (_, i) => row(i)), '2026-09-26');
    expect(items.every((it) => it.context.length === 0 && it.critical === false)).toBe(true);
    expect(log).toHaveBeenCalledWith('[decisions] contexto de compra indisponível', expect.anything());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Detalhe da decisão de compra — pedido grande e leituras que falham', () => {
  const N_LINES = 250; const N_REQS = 300;
  const tables = (over: Record<string, Partial<Spec>> = {}): Record<string, Spec> => {
    const base: Record<string, Spec> = {
      purchase_orders: { rows: [{ organization_id: O, id: 'po-1', order_number: 'OC-1', supplier_id: 'sp-1', sourcing_decision_id: null, project_id: null,
        status: 'APPROVAL_REQUIRED', currency: 'BRL', freight_amount: 0, tax_amount: 0, payment_terms: null, delivery_location_id: 'loc-1',
        expected_delivery: null, approval_governance: 'AUTHORITY', submitted_by: null, submitted_at: null }] },
      purchase_order_lines: { rows: Array.from({ length: N_LINES }, (_, i) => ({ organization_id: O, id: `pl-${pad(i)}`, purchase_order_id: 'po-1',
        item_id: `it-${i}`, quantity: 2, unit_price: 10, expected_date: null })) },
      purchase_order_history: { rows: [] },
      inventory_locations: { rows: [{ organization_id: O, id: 'loc-1', name: 'Almoxarifado Central' }] },
      supply_items: { rows: Array.from({ length: N_LINES }, (_, i) => ({ organization_id: O, id: `it-${i}`, code: `CABO-${i}`, description: 'Cabo', unit: 'm' })) },
      purchase_order_line_requirements: { rows: Array.from({ length: N_REQS }, (_, i) => ({ organization_id: O, line_id: `pl-${pad(i % N_LINES)}`,
        requirement_id: `rq-${i}`, quantity: 1 })) },
      project_requirements: { rows: Array.from({ length: N_REQS }, (_, i) => ({ organization_id: O, id: `rq-${i}`, title: `Req ${i}`, project_id: 'pj-1',
        activity_id: null, required_by: '2026-10-10', status: 'CONFIRMED', priority: 'medium' })) },
      supplier_profiles: { rows: [{ organization_id: O, id: 'sp-1', status: 'HOMOLOGATED', party_id: 'pt-1' }] },
      supplier_delivery_performance: { rows: [{ organization_id: O, supplier_id: 'sp-1', promised_lines: 10, on_time_lines: 9 }] },
      parties: { rows: [{ organization_id: O, id: 'pt-1', legal_name: 'Fornecedor 1', trade_name: null }] },
      projects: { rows: [{ organization_id: O, id: 'pj-1', project: { nome: 'Obra 1' }, project_v2: null }] },
    };
    for (const [t, o] of Object.entries(over)) base[t] = { ...base[t], ...o } as Spec;
    return base;
  };

  it('250 linhas e 300 requisitos: carrega, sem `.in` acima do lote', async () => {
    const calls: Call[] = [];
    mocks.client.current = fakeClient(tables(), calls);
    const d = await purchaseOrderDetail(O, 'po-1', { today: '2026-09-26', submission: null });
    expect(d).not.toBeNull();
    expect(Math.max(...inCalls(calls))).toBeLessThanOrEqual(SELECT_IN_CHUNK);
  });

  it('a pontualidade que falha sobe (antes: sumia do detalhe, calada)', async () => {
    mocks.client.current = fakeClient(tables({ supplier_delivery_performance: { error: 'permission denied' } }));
    await expect(purchaseOrderDetail(O, 'po-1', { today: '2026-09-26', submission: null }))
      .rejects.toThrow('Não foi possível ler a pontualidade dos fornecedores.');
  });

  it('o local de entrega que falha sobe (antes: o fato "Local de entrega" sumia, calado)', async () => {
    mocks.client.current = fakeClient(tables({ inventory_locations: { error: 'statement timeout' } }));
    await expect(purchaseOrderDetail(O, 'po-1', { today: '2026-09-26', submission: null }))
      .rejects.toThrow('Não foi possível ler o local de entrega.');
  });

  it('um lote dos requisitos que falha sobe com o nome do que faltou', async () => {
    mocks.client.current = fakeClient(tables({ project_requirements: { failOn: 'rq-250' } }));
    await expect(purchaseOrderDetail(O, 'po-1', { today: '2026-09-26', submission: null })).rejects.toThrow('Não foi possível ler os requisitos.');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Leituras do Supply que engoliam o erro — agora sobem', () => {
  const s = (t: Record<string, Spec>) => ({ supabase: fakeClient(t) as never, organizationId: O });

  it('alçadas de compra: a falha não vira "nenhuma alçada declarada"', async () => {
    await expect(listAuthorities(s({ procurement_approval_authorities: { rows: [], error: 'statement timeout' } })))
      .rejects.toThrow('Não foi possível ler as alçadas de compra.');
    await expect(listAuthorities(s({ procurement_approval_authorities: { rows: [{ organization_id: O, id: 'a1', grantee_kind: 'ROLE', grantee_role_id: 'r1',
      max_amount: 10, currency: 'BRL', source_kind: 'X', source_reference: 'Y', justification: 'Z', effective_from: '2026-01-01', active: true }] },
    roles: { rows: [], error: 'statement timeout' } }))).rejects.toThrow('Não foi possível ler os papéis das alçadas de compra.');
  });

  it('fornecedores: sem os pedidos ou a pontualidade, "0 pedidos" seria mentira', async () => {
    const base = { supplier_profiles: { rows: [{ organization_id: O, id: 'sp-1', party_id: 'pt-1', status: 'HOMOLOGATED' }] } };
    await expect(listSuppliers(s({ ...base, purchase_orders: { rows: [], error: 'timeout' } })))
      .rejects.toThrow('Não foi possível ler os pedidos e a pontualidade dos fornecedores.');
    await expect(listSuppliers(s({ ...base, supplier_delivery_performance: { rows: [], error: 'timeout' } })))
      .rejects.toThrow('Não foi possível ler os pedidos e a pontualidade dos fornecedores.');
  });

  it('fornecedor 360: histórico, recebimentos e obras sobem o erro', async () => {
    const base: Record<string, Spec> = {
      purchase_orders: { rows: [{ organization_id: O, id: 'po-1', supplier_id: 'sp-1', project_id: 'pj-1', order_number: 'OC-1', status: 'ISSUED' }] },
      supplier_quotes: { rows: [] },
      goods_receipts: { rows: [{ organization_id: O, id: 'rc-1', purchase_order_id: 'po-1', receipt_number: 'REC-1' }] },
    };
    await expect(supplierDetail(s({ ...base, purchase_order_lines: { rows: [], error: 'timeout' } }), 'sp-1', '2026-09-26'))
      .rejects.toThrow('Não foi possível ler o histórico do fornecedor.');
    await expect(supplierDetail(s({ ...base, goods_receipt_lines: { rows: [], error: 'timeout' } }), 'sp-1', '2026-09-26'))
      .rejects.toThrow('Não foi possível ler os recebimentos do fornecedor.');
    await expect(supplierDetail(s({ ...base, projects: { rows: [], error: 'timeout' } }), 'sp-1', '2026-09-26'))
      .rejects.toThrow('Não foi possível ler as obras do fornecedor.');
  });

  it('estoque: o catálogo e as obras dos formulários sobem o erro (antes: "nenhum item" para escolher)', async () => {
    for (const t of ['supply_items', 'projects']) {
      await expect(inventoryWorkspace(s({ [t]: { rows: [], error: 'timeout' } }), '2026-09-26'), t)
        .rejects.toThrow('Não foi possível ler o catálogo de itens e as obras.');
    }
  });

  it('torre de controle: os locais sobem o erro (antes: o destino ficava sem nome, calado)', async () => {
    await expect(supplyControlTower(s({ inventory_locations: { rows: [], error: 'timeout' } }), '2026-09-26'))
      .rejects.toThrow('Não foi possível ler a torre de controle do supply.');
  });

  it('recebimento: locais, fornecedores e pontualidade sobem (antes: "Local", "Fornecedor" e pontualidade vazia)', async () => {
    for (const t of ['inventory_locations', 'supplier_profiles', 'supplier_delivery_performance']) {
      await expect(receivingWorkspace(s({ [t]: { rows: [], error: 'timeout' } }), '2026-09-26'), t).rejects.toThrow('Não foi possível ler o recebimento.');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Listas do inquilino acima do teto de 1 000 linhas do PostgREST — inteiras, não cortadas', () => {
  const s = (t: Record<string, Spec>) => ({ supabase: fakeClient(t) as never, organizationId: O });
  const locs = (n: number) => Array.from({ length: n }, (_, i) => ({ organization_id: O, id: `loc-${pad(i)}`, code: `L-${pad(i)}`, name: `Local ${i}`,
    kind: 'PROJECT_SITE', project_id: null, active: true }));

  it('recebimento: 1 139 locais — o mais novo aparece no "Liberar para" (antes: 1 000, e o novo sumia)', async () => {
    const m = await receivingWorkspace(s({ inventory_locations: { rows: locs(1139) } }), '2026-09-26');
    expect(m.locations).toHaveLength(1139);
    expect(m.locations.some((l) => l.id === 'loc-1138')).toBe(true);
  });

  it('estoque: 1 139 locais e 1 015 itens no catálogo dos formulários', async () => {
    const items = Array.from({ length: 1015 }, (_, i) => ({ organization_id: O, id: `it-${pad(i)}`, code: `I-${pad(i)}`, description: 'Item', unit: 'm',
      tracking: 'NONE', active: true }));
    expect(await listLocations(s({ inventory_locations: { rows: locs(1139) } }))).toHaveLength(1139);
    const w = await inventoryWorkspace(s({ inventory_locations: { rows: locs(1139) }, supply_items: { rows: items } }), '2026-09-26');
    expect(w.items).toHaveLength(1015);
    expect(await listItems(s({ supply_items: { rows: items } }), false)).toHaveLength(1015);
  });

  it('Planejamento de Materiais: 1 200 requisitos na demanda (antes: os 200 mais tardios sumiam)', async () => {
    const cov = Array.from({ length: 1200 }, (_, i) => ({ organization_id: O, requirement_id: `rq-${pad(i)}`, project_id: 'pj-1', item_id: 'it-1',
      required_by: '2026-10-20', required_qty: 1, reserved_qty: 0, consumed_qty: 0, in_transit_qty: 0, on_order_qty: 0, requested_qty: 0,
      inspection_qty: 0, pending_transfer_qty: 0, purchasable_qty: 1 }));
    const d = await materialDemand(s({ supply_requirement_coverage: { rows: cov } }), '2026-09-26');
    expect(d).toHaveLength(1200);
  });

  it('carteira do Planejamento: 1 200 requisitos vivos (antes: cortados em 1 000)', async () => {
    const reqs = Array.from({ length: 1200 }, (_, i) => ({ organization_id: O, id: `rq-${pad(i)}`, project_id: 'pj-1', activity_id: null,
      requirement_type: 'MATERIAL', title: `R ${i}`, quantity: 1, unit: 'm', required_by: '2026-10-20', status: 'CONFIRMED', item_id: 'it-1', priority: 'medium' }));
    const m = await portfolioPlanning(s({ project_requirements: { rows: reqs }, projects: { rows: [{ organization_id: O, id: 'pj-1', project: { nome: 'Obra 1' },
      project_v2: null }] } }), '2026-09-26', supplyCoverageLoader);
    expect(m.requirements).toHaveLength(1200);
  });
});

