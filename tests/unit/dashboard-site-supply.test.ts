/**
 * Supply Chain do local — src/lib/dashboard/site-supply.ts e a rota
 * GET /api/dashboard/site/[projectId]/supply, com o cliente Supabase e as
 * leituras compostas simulados (hermético):
 *  1. regras puras: balanço pela cobertura VIVA, risco pela necessidade
 *     efetiva, foco, nós de estoque, pedidos (ETA, atraso, valor mascarado),
 *     achados da Apex (`stale`), decisões da caixa e a posição do local;
 *  2. portões: sem `projects.view` → restrito; estoque só com a RLS de
 *     `inventory_movements`; valor do pedido só com procurement/supply;
 *  3. falha nunca é calma: cobertura que cai → seção `error`; caixa que cai →
 *     `decisions: error` (nunca lista vazia); uma parte que cai não derruba as outras;
 *  4. inquilino em toda leitura; a rota responde 200 com o motivo e 500 só
 *     quando a montagem inteira falha.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listSupplySignals: vi.fn(),
  viewerInbox: vi.fn(),
  enrichInbox: vi.fn(),
  requireCommercialSession: vi.fn(),
}));

vi.mock('@/lib/platform/server-client', () => ({
  platformServiceClient: () => { throw new Error('service role não é usado pelo Dashboard'); },
}));
vi.mock('@/lib/commercial/server-session', () => ({
  hasOptionalPermission: async (session: { permissions: Set<string> }, key: string) => session.permissions.has(key),
  requireCommercialSession: mocks.requireCommercialSession,
  isSessionError: (r: object) => 'error' in r,
}));
vi.mock('@/lib/operations/overview', () => ({ operationsOverview: vi.fn() }));
vi.mock('@/lib/supply/read-model', () => ({ supplyFlow: vi.fn() }));
vi.mock('@/lib/supply/intelligence-read', () => ({ listSupplySignals: mocks.listSupplySignals }));
vi.mock('@/lib/decisions/read', () => ({
  viewerInbox: mocks.viewerInbox, enrichInbox: mocks.enrichInbox, decisionSetup: vi.fn(),
}));

import {
  buildSiteSupply, focusApexNotes, inboundOrders, inMaterialScope, isSiteProjectId, materialBalance, mapLimit, pickFocus, compareMaterials,
  siteCoordinate, siteDecisionRows, stockNodes, supplyDecision, type CoverageMeta, type LocationRow, type PoAllocationRow, type PoLineRow,
  type PoRow,
} from '@/lib/dashboard/site-supply';
import type { SignalLike } from '@/lib/dashboard/rules';
import type { CoverageViewRow } from '@/lib/supply/coverage';
import type { DecisionInboxRow } from '@/lib/decisions/types';
import type { SiteSupplyResponse } from '@/lib/dashboard/types';

const TODAY = '2026-09-25';
const TUC = 'qa-scn-tucurui';
const REQ_CABO = '11111111-1111-4111-8111-111111111111';
const REQ_DISJ = '22222222-2222-4222-8222-222222222222';
const REQ_FAR = '33333333-3333-4333-8333-333333333333';
const ITEM_CABO = 'item-cabo';
const ITEM_DISJ = 'item-disj';

/* ── Cliente Supabase simulado ──────────────────────────────────────────── */

type Spec = { rows?: object[]; count?: number; error?: string };
type Call = { table: string; ops: Array<[string, unknown[]]> };

function fakeClient(tables: Record<string, Spec | ((call: Call) => Spec)>, rpcs: Record<string, unknown>, calls: Call[] = []) {
  return {
    rpc: async (name: string) => ({ data: rpcs[name] ?? null, error: null }),
    from: (table: string) => {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const chain: Record<string, unknown> = {};
      const resolveRows = () => {
        const raw = tables[table];
        const spec = (typeof raw === 'function' ? raw(call) : raw) ?? {};
        if (spec.error) return { data: null, error: { message: spec.error }, count: null };
        const sel = call.ops.find(([m]) => m === 'select');
        const opts = (sel?.[1][1] ?? {}) as { head?: boolean; count?: string };
        let rows = (spec.rows ?? []) as Record<string, unknown>[];
        const col = (r: Record<string, unknown>, c: unknown) => typeof c === 'string' && c in r;
        for (const [m, a] of call.ops) {
          if (m === 'in') rows = rows.filter((r) => !col(r, a[0]) || (a[1] as unknown[]).includes(r[a[0] as string]));
          if (m === 'eq' || m === 'is') rows = rows.filter((r) => !col(r, a[0]) || r[a[0] as string] === a[1]);
        }
        if (opts.head) return { data: null, error: null, count: spec.count ?? rows.length };
        return { data: rows, error: null, count: opts.count ? spec.count ?? rows.length : null };
      };
      for (const m of ['select', 'eq', 'neq', 'gt', 'gte', 'lte', 'in', 'is', 'not', 'or', 'order', 'limit', 'range']) {
        chain[m] = (...args: unknown[]) => { call.ops.push([m, args]); return chain; };
      }
      chain.maybeSingle = () => {
        call.ops.push(['maybeSingle', []]);
        const r = resolveRows();
        return Promise.resolve({ ...r, data: r.error ? null : (r.data as unknown[] | null)?.[0] ?? null });
      };
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        try { return resolve(resolveRows()); } catch (e) { return reject(e); }
      };
      return chain;
    },
  };
}

function session(permissions: string[], tables: Parameters<typeof fakeClient>[0] = {}, rpcs: Record<string, unknown> = {}, calls: Call[] = []) {
  return {
    supabase: fakeClient(tables, rpcs, calls) as never,
    user: { id: 'u-1' } as never,
    organizationId: 'org-1',
    permissions: new Set(permissions),
  };
}

/* ── Fixtures (os fatos de SE Tucuruí no QA) ────────────────────────────── */

const cov = (over: Partial<CoverageViewRow> & { requirement_id: string }): CoverageViewRow & { organization_id: string } => ({
  organization_id: 'org-1', project_id: TUC, activity_id: null, item_id: null, requirement_type: 'MATERIAL', required_by: null, unit: 'un',
  required_qty: 0, reserved_qty: 0, consumed_qty: 0, in_transit_qty: 0, on_order_qty: 0, requested_qty: 0, inspection_qty: 0, ...over,
});

const COVERAGE = [
  cov({ requirement_id: REQ_CABO, activity_id: 'act-cabos', item_id: ITEM_CABO, required_by: '2026-09-30', unit: 'm',
    required_qty: '1200', reserved_qty: '300', in_transit_qty: '400', requested_qty: '500' }),
  cov({ requirement_id: REQ_DISJ, activity_id: 'act-disj', item_id: ITEM_DISJ, required_by: '2026-10-14', required_qty: '3', on_order_qty: '3' }),
  // coberto e longe: fica fora do balanço (mas conta para o `stale`)
  cov({ requirement_id: REQ_FAR, item_id: 'item-far', required_by: '2027-03-01', required_qty: '10', reserved_qty: '10' }),
];

const META: CoverageMeta = {
  titles: new Map([[REQ_CABO, 'Cabo 35 mm² para o lançamento dos bays'], [REQ_DISJ, 'Disjuntores 145 kV dos novos bays']]),
  activities: new Map([
    ['act-cabos', { id: 'act-cabos', title: 'Lançamento de cabos de potência', plannedStart: '2026-09-30' }],
    ['act-disj', { id: 'act-disj', title: 'Instalação dos disjuntores 145 kV', plannedStart: '2026-10-12' }],
  ]),
  items: new Map([
    [ITEM_CABO, { id: ITEM_CABO, code: 'CABO-35-XLPE', description: 'Cabo de potência 35 mm² XLPE 15 kV', unit: 'm' }],
    [ITEM_DISJ, { id: ITEM_DISJ, code: 'DISJ-145KV', description: 'Disjuntor tripolar 145 kV 2000 A', unit: 'un' }],
  ]),
};

const loc = (id: string, over: Partial<LocationRow> = {}): LocationRow & { organization_id: string } => ({
  organization_id: 'org-1', id, code: id.toUpperCase(), name: `Local ${id}`, kind: 'WAREHOUSE', project_id: null,
  latitude: null, longitude: null, active: true, ...over,
});

const signal = (over: Partial<SignalLike> & { id: string; kind: string }): SignalLike => ({
  severity: 'high', projectId: TUC, project: 'SE Tucuruí', requirementId: null, purchaseOrderId: null, title: 'achado', rationale: 'porque',
  evidence: [{ label: 'Necessidade', value: '30/09/2026' }], lastSeenAt: '2026-09-25T12:30:46Z', engineVersion: 'supply-signals.v1', ...over,
});

const inboxRow = (over: Partial<DecisionInboxRow> & { decision_key: string; subject_id: string }): DecisionInboxRow => ({
  source_kind: 'PROCUREMENT_AUTHORITY', category: 'compras', subject_type: 'purchase_order', action_type: 'approve', request_id: null,
  step_id: null, stage_no: null, submission: 1, title: 'Pedido de compra', amount: 1000, currency: 'BRL', project_id: TUC, requested_by: null,
  requested_at: '2026-09-24T10:00:00Z', due_at: null, need_by: null, decide_by: '2026-09-28', overdue: false, assignment: 'PRIMARY',
  state: 'PENDENTE', actions: ['APPROVE', 'REJECT'], reason_required: ['REJECT'], fingerprint: null, authority: {}, ...over,
});

/* ── 1. Regras puras ────────────────────────────────────────────────────── */

describe('balanço de material (cobertura AO VIVO)', () => {
  const all = COVERAGE.map((r) => materialBalance(r, META, TODAY));

  it('números da cobertura, necessidade efetiva = min(required_by, início da atividade), risco supplyRisk', () => {
    const [cabo, disj] = all;
    expect(cabo).toMatchObject({
      requirementId: REQ_CABO, title: 'Cabo 35 mm² para o lançamento dos bays', needBy: '2026-09-30',
      item: { id: ITEM_CABO, code: 'CABO-35-XLPE', unit: 'm' }, activity: { id: 'act-cabos', start: '2026-09-30' },
      required: 1200, reserved: 300, consumed: 0, inTransit: 400, onOrder: 0, requested: 500, covered: 300, inbound: 400, shortage: 500,
      risk: 'critical', href: `/supply/planejamento-materiais?req=${REQ_CABO}`,
    });
    // required_by 14/10, atividade começa 12/10 → a necessidade é 12/10; sem falta → 'ok' (nunca 'low' na tela)
    expect(disj).toMatchObject({ needBy: '2026-10-12', shortage: 0, inbound: 3, risk: 'ok' });
  });

  it('escopo: falta, ou necessidade de 14 dias atrás a 30 à frente; ordem risco → necessidade', () => {
    const scoped = all.filter((m) => inMaterialScope(m, TODAY)).sort(compareMaterials);
    expect(scoped.map((m) => m.requirementId)).toEqual([REQ_CABO, REQ_DISJ]);
    expect(inMaterialScope({ shortage: 1, needBy: null }, TODAY)).toBe(true);
    expect(inMaterialScope({ shortage: 0, needBy: '2026-09-11' }, TODAY)).toBe(true);
    expect(inMaterialScope({ shortage: 0, needBy: '2026-09-10' }, TODAY)).toBe(false);
    expect(inMaterialScope({ shortage: 0, needBy: '2026-10-25' }, TODAY)).toBe(true);
    expect(inMaterialScope({ shortage: 0, needBy: '2026-10-26' }, TODAY)).toBe(false);
  });

  it('foco: a falta mais grave; `?req=` dentro do balanço vale; fora dele, o padrão', () => {
    const scoped = all.filter((m) => inMaterialScope(m, TODAY)).sort(compareMaterials);
    expect(pickFocus(scoped)?.requirementId).toBe(REQ_CABO);
    expect(pickFocus(scoped, REQ_DISJ)?.requirementId).toBe(REQ_DISJ);
    expect(pickFocus(scoped, REQ_FAR)?.requirementId).toBe(REQ_CABO);
    expect(pickFocus([])).toBeNull();
  });

  it('requisito sem título, item nem atividade: nunca vazio nem id cru no título', () => {
    const m = materialBalance(cov({ requirement_id: 'r-x', item_id: 'i-x', unit: 'kg', required_qty: 5 }), {
      titles: new Map(), activities: new Map(), items: new Map() }, TODAY);
    expect(m.title).toBe('Material do requisito');
    expect(m.item).toEqual({ id: 'i-x', code: null, description: null, unit: 'kg' });
    expect(m).toMatchObject({ activity: null, needBy: null, shortage: 5, risk: 'medium' });
  });
});

describe('estoque na rede', () => {
  const locations = new Map<string, LocationRow>([
    ['site', loc('site', { kind: 'PROJECT_SITE', project_id: TUC, latitude: -3.7662, longitude: -49.6725, name: 'Canteiro SE Tucuruí' })],
    ['mar', loc('mar', { kind: 'PROJECT_SITE', project_id: 'qa-scn-maraba', latitude: '-5.3686', longitude: '-49.1178', name: 'Canteiro LT Marabá' })],
    ['bel', loc('bel', { latitude: -1.4558, longitude: -48.4902, name: 'Almoxarifado Central — Belém' })],
    ['norte', loc('norte', { latitude: -3.7662, longitude: -49.6725 })],
    ['quar', loc('quar', { kind: 'QUARANTINE', latitude: 'x', longitude: 200 })],
  ]);

  it('canteiro primeiro (mesmo zerado), depois o maior disponível; local vazio sai; coordenada inválida vira null', () => {
    const nodes = stockNodes([
      { location_id: 'bel', on_hand_qty: '300', reserved_qty: '300', available_qty: '0' },
      { location_id: 'norte', on_hand_qty: 0, reserved_qty: 0, available_qty: 0 },
      { location_id: 'mar', on_hand_qty: '250', reserved_qty: '0', available_qty: '250' },
      { location_id: 'site', on_hand_qty: 0, reserved_qty: 0, available_qty: 0 },
      { location_id: 'quar', on_hand_qty: 40, reserved_qty: 0, available_qty: 0 },
      { location_id: 'sumiu', on_hand_qty: 9, reserved_qty: 0, available_qty: 9 },
    ], locations, TUC);
    expect(nodes.map((n) => [n.locationId, n.available, n.isSite])).toEqual([
      ['site', 0, true], ['mar', 250, false], ['bel', 0, false], ['quar', 0, false],
    ]);
    expect(nodes[1]).toMatchObject({ lat: -5.3686, lng: -49.1178, kindLabel: 'Canteiro de obra' });
    expect(nodes[3]).toMatchObject({ lat: null, lng: null, kindLabel: 'Quarentena / inspeção', onHand: 40 });
  });
});

describe('pedidos do material em foco', () => {
  const po = (over: Partial<PoRow> & { id: string }): PoRow => ({
    order_number: `OC-${over.id}`, supplier_id: 'sup-1', project_id: TUC, status: 'ISSUED', currency: 'BRL', freight_amount: 4800,
    tax_amount: 0, expected_delivery: '2026-10-19', ...over,
  });
  const line = (over: Partial<PoLineRow> & { id: string; purchase_order_id: string }): PoLineRow => ({
    item_id: ITEM_DISJ, quantity: 3, unit_price: 148500, expected_date: null, received_quantity: 0, ...over,
  });
  const base = {
    pos: [po({ id: 'po-1' }), po({ id: 'po-2', status: 'APPROVAL_REQUIRED', supplier_id: 'sup-2', expected_delivery: '2026-10-05' }),
      po({ id: 'po-3', supplier_id: null })],
    lines: [line({ id: 'l1', purchase_order_id: 'po-1', expected_date: '2026-11-01' }),
      line({ id: 'l2', purchase_order_id: 'po-2', quantity: 5, unit_price: 100 }),
      line({ id: 'l3', purchase_order_id: 'po-3', item_id: 'outro' })],
    allocations: [{ line_id: 'l1', requirement_id: REQ_DISJ, quantity: 3, received_quantity: 1 }] as PoAllocationRow[],
    shipEta: new Map<string, string>(),
    supplierName: (id: string) => (id === 'sup-1' ? '[QA] Siemens Energy Brasil Ltda' : 'Fornecedor'),
    focus: { requirementId: REQ_DISJ, itemId: ITEM_DISJ, needBy: '2026-10-12' },
    amountVisible: true,
  };

  it('quantidade pela alocação; ETA da linha; atrasado com dias; valor do pedido; pedido sem o item fica fora', () => {
    const out = inboundOrders(base);
    expect(out.map((o) => o.poId)).toEqual(['po-1', 'po-2']);
    expect(out[0]).toMatchObject({
      number: 'OC-po-1', supplier: { id: 'sup-1', name: '[QA] Siemens Energy Brasil Ltda' }, status: 'ISSUED', statusLabel: 'Emitido',
      expected: '2026-11-01', late: true, lateDays: 20, qty: 2, href: '/supply/compras?stage=pedidos&po=po-1',
    });
    expect(out[0].amountText).toMatch(/^R\$\s450\.300$/);
    // sem alocação: o aberto da linha do item; ETA do pedido; antes da necessidade → não atrasa
    expect(out[1]).toMatchObject({ statusLabel: 'Em aprovação', expected: '2026-10-05', late: false, lateDays: null, qty: 5,
      href: '/supply/compras?stage=aprovacao&po=po-2' });
  });

  it('o embarque vivo manda na chegada (a regra da Apex)', () => {
    const out = inboundOrders({ ...base, shipEta: new Map([['po-1', '2026-10-10']]) });
    expect(out.find((o) => o.poId === 'po-1')).toMatchObject({ expected: '2026-10-10', late: false, lateDays: null });
  });

  it('sem procurement/supply: valor null; sem cadastro de fornecedor: "Restrito", nunca vazio', () => {
    const out = inboundOrders({ ...base, amountVisible: false, supplierName: () => null });
    expect(out.every((o) => o.amountText === null)).toBe(true);
    expect(out[0].supplier).toEqual({ id: 'sup-1', name: 'Restrito' });
  });
});

describe('achados da Apex do material em foco', () => {
  const signals = [
    signal({ id: 's-short', kind: 'SHORTAGE', severity: 'critical', requirementId: REQ_CABO }),
    signal({ id: 's-eta', kind: 'ETA_RISK', severity: 'critical', requirementId: REQ_CABO, purchaseOrderId: 'po-9' }),
    signal({ id: 's-dec', kind: 'DECISION_PENDING', severity: 'high', purchaseOrderId: 'po-1' }),
    signal({ id: 's-outro', kind: 'SHORTAGE', severity: 'critical', requirementId: REQ_DISJ }),
  ];

  it('só o requisito em foco e os seus pedidos; falta zerada ao vivo → SHORTAGE `stale` (ETA_RISK nunca)', () => {
    const notes = focusApexNotes(signals, REQ_CABO, new Set(['po-1']), () => 0);
    expect(notes.map((n) => [n.signalId, n.stale])).toEqual([['s-eta', false], ['s-dec', false], ['s-short', true]]);
    expect(notes[0]).toMatchObject({ lead: 'Apex identificou uma entrega que chega depois da necessidade', engineVersion: 'supply-signals.v1' });
  });

  it('cobertura não lida inteira (`null`) → nunca `stale` por suposição', () => {
    const notes = focusApexNotes(signals, REQ_CABO, new Set(), () => null);
    expect(notes.find((n) => n.signalId === 's-short')?.stale).toBe(false);
  });
});

describe('decisões da caixa neste local', () => {
  const rows = [
    inboxRow({ decision_key: 'purchase_order:a:s1', subject_id: 'po-1' }),
    inboxRow({ decision_key: 'purchase_order:b:s1', subject_id: 'po-multi', project_id: null }),
    inboxRow({ decision_key: 'purchase_order:c:s1', subject_id: 'po-outro', project_id: 'qa-scn-maraba' }),
    inboxRow({ decision_key: 'purchase_order:d:s1', subject_id: 'po-eleg', assignment: 'ELIGIBLE' }),
    inboxRow({ decision_key: 'approval_request:e:e1', subject_type: 'contract_billing_event', subject_id: 'bill-1' }),
  ];

  it('pedido do projeto ou pedido do material em foco; só PRIMARY/ESCALATED; faturamento não', () => {
    expect(siteDecisionRows(rows, TUC, new Set(['po-multi'])).map((r) => r.decision_key))
      .toEqual(['purchase_order:a:s1', 'purchase_order:b:s1']);
    expect(siteDecisionRows(rows, TUC, new Set()).map((r) => r.decision_key)).toEqual(['purchase_order:a:s1']);
  });

  it('item → decisão: link de Decisões, valor no formato da caixa, prazo efetivo, pedido', () => {
    const d = supplyDecision({ key: 'purchase_order:a:s1', kindLabel: 'Compra', title: 'Pedido de compra OC-1', amount: 478500, currency: 'BRL',
      dueAt: '2026-09-27T12:00:00Z', decideBy: '2026-09-28', overdue: false, subjectType: 'purchase_order', subjectId: 'po-1' });
    expect(d).toMatchObject({ key: 'purchase_order:a:s1', href: '/decisoes?d=purchase_order%3Aa%3As1', due: '2026-09-27', poId: 'po-1',
      amountRestricted: false, overdue: false });
    expect(d.amountText).toMatch(/^R\$\s478\.500$/);
    expect(supplyDecision({ key: 'k', kindLabel: 'Compra', title: 't', amount: null, currency: null, dueAt: null, decideBy: null,
      overdue: true, subjectType: 'purchase_order', subjectId: 'po-2' }).amountText).toBeNull();
  });
});

describe('posição do local (GLOBE.md §1)', () => {
  it('oficial primeiro; senão o ÚNICO canteiro com coordenada; dois = ambíguo; inválida não conta', () => {
    expect(siteCoordinate([{ latitude: -18.49, longitude: -49.49 }], [{ latitude: -3, longitude: -49 }])).toEqual({ lat: -18.49, lng: -49.49 });
    expect(siteCoordinate([], [{ latitude: '-3.7662', longitude: '-49.6725', active: true, kind: 'PROJECT_SITE' }]))
      .toEqual({ lat: -3.7662, lng: -49.6725 });
    expect(siteCoordinate([], [{ latitude: -3, longitude: -49 }, { latitude: -4, longitude: -50 }])).toBeNull();
    expect(siteCoordinate([{ latitude: 91, longitude: 0 }], [{ latitude: null, longitude: -49 }, { latitude: -4, longitude: -50, active: false }]))
      .toBeNull();
  });

  it('id de projeto: só texto simples entra num filtro', () => {
    expect(isSiteProjectId('qa-scn-tucurui')).toBe(true);
    expect(isSiteProjectId('proj-3f1c.v2_x')).toBe(true);
    for (const bad of ['', 'a b', 'x;drop', 'a,b', 'a'.repeat(129), '../x', null]) expect(isSiteProjectId(bad)).toBe(false);
  });

  it('mapLimit: preserva a ordem e respeita o limite', async () => {
    let live = 0; let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      live += 1; peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 1));
      live -= 1;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBe(2);
  });
});

/* ── 2–4. Composição ────────────────────────────────────────────────────── */

const ALL = ['projects.view', 'supply.view', 'procurement.view', 'inventory.view', 'receiving.view', 'suppliers.view', 'operations.planning.view'];

function tables(over: Parameters<typeof fakeClient>[0] = {}): Parameters<typeof fakeClient>[0] {
  return {
    projects: { rows: [{ id: TUC, organization_id: 'org-1', project: { nome: 'SE Tucuruí 138 kV — Ampliação do pátio' }, project_v2: null }] },
    project_requirements: { rows: [
      { id: REQ_CABO, organization_id: 'org-1', project_id: TUC, status: 'CONFIRMED', title: 'Cabo 35 mm² para o lançamento dos bays' },
      { id: REQ_DISJ, organization_id: 'org-1', project_id: TUC, status: 'CONFIRMED', title: 'Disjuntores 145 kV dos novos bays' },
    ] },
    supply_requirement_coverage: { rows: COVERAGE.slice(0, 2) },
    project_timeline_items: { rows: [
      { id: 'act-cabos', organization_id: 'org-1', title: 'Lançamento de cabos de potência', planned_start: '2026-09-30' },
      { id: 'act-disj', organization_id: 'org-1', title: 'Instalação dos disjuntores 145 kV', planned_start: '2026-10-12' },
    ] },
    supply_items: { rows: [{ id: ITEM_CABO, organization_id: 'org-1', code: 'CABO-35-XLPE', description: 'Cabo 35', unit: 'm' },
      { id: ITEM_DISJ, organization_id: 'org-1', code: 'DISJ-145KV', description: 'Disjuntor', unit: 'un' }] },
    inventory_position: { rows: [
      { organization_id: 'org-1', item_id: ITEM_CABO, location_id: 'mar', on_hand_qty: 250, reserved_qty: 0, available_qty: 250 },
      { organization_id: 'org-1', item_id: ITEM_CABO, location_id: 'site', on_hand_qty: 0, reserved_qty: 0, available_qty: 0 },
    ] },
    inventory_locations: { rows: [
      loc('mar', { kind: 'PROJECT_SITE', project_id: 'qa-scn-maraba', latitude: -5.3686, longitude: -49.1178 }),
      loc('site', { kind: 'PROJECT_SITE', project_id: TUC, latitude: -3.7662, longitude: -49.6725 }),
    ] },
    project_globe_marker: { rows: [] },
    purchase_order_line_requirements: { rows: [
      { organization_id: 'org-1', line_id: 'l1', requirement_id: REQ_CABO, quantity: 500, received_quantity: 0 },
    ] },
    purchase_order_lines: { rows: [
      { organization_id: 'org-1', id: 'l1', purchase_order_id: 'po-1', item_id: ITEM_CABO, quantity: 500, unit_price: 20, expected_date: '2026-10-03', received_quantity: 0 },
    ] },
    purchase_orders: { rows: [
      { organization_id: 'org-1', id: 'po-1', order_number: 'OC-1', supplier_id: 'sup-1', project_id: TUC, status: 'APPROVAL_REQUIRED',
        currency: 'BRL', freight_amount: 0, tax_amount: 0, expected_delivery: null },
    ] },
    inbound_shipments: { rows: [] },
    supplier_profiles: { rows: [{ organization_id: 'org-1', id: 'sup-1', party_id: 'party-1' }] },
    parties: { rows: [{ organization_id: 'org-1', id: 'party-1', legal_name: 'Cabos Amazônia Ltda', trade_name: null }] },
    ...over,
  };
}

describe('buildSiteSupply', () => {
  beforeEach(() => {
    mocks.listSupplySignals.mockResolvedValue({
      lastRun: { ranAt: '2026-09-25T12:30:46Z', engineVersion: 'supply-signals.v1' }, openCount: 1,
      signals: [signal({ id: 's-dec', kind: 'DECISION_PENDING', severity: 'critical', requirementId: REQ_CABO })],
    });
    mocks.viewerInbox.mockResolvedValue([inboxRow({ decision_key: 'purchase_order:po-1:s1', subject_id: 'po-1' })]);
    mocks.enrichInbox.mockImplementation(async (_s: unknown, rows: DecisionInboxRow[]) => rows.map((r) => ({
      key: r.decision_key, kindLabel: 'Compra', title: 'Pedido de compra OC-1', amount: 10000, currency: 'BRL', dueAt: null,
      decideBy: r.decide_by, overdue: false, subjectType: r.subject_type, subjectId: r.subject_id, requestedAt: r.requested_at,
      priority: { code: 'NORMAL', label: 'Normal', tone: 'neutral' },
    })));
  });
  afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

  const ok = (r: SiteSupplyResponse) => {
    if (!r.ok || r.supply.state !== 'ok') throw new Error(`esperava supply ok: ${JSON.stringify(r)}`);
    return r.supply.data;
  };

  it('id inválido → invalid, sem tocar no banco; sem projects.view → restricted; outro inquilino → not_found', async () => {
    const calls: Call[] = [];
    expect(await buildSiteSupply(session(ALL, tables(), {}, calls), 'x;drop', TODAY)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(calls).toHaveLength(0);
    expect(await buildSiteSupply(session(['supply.view'], tables()), TUC, TODAY)).toMatchObject({ ok: false, reason: 'restricted' });
    expect(await buildSiteSupply(session(ALL, tables({ projects: { rows: [] } })), TUC, TODAY))
      .toMatchObject({ ok: false, reason: 'not_found', error: 'Projeto não encontrado nesta organização.' });
    expect(await buildSiteSupply(session(ALL, tables({ projects: { error: 'boom' } })), TUC, TODAY))
      .toMatchObject({ ok: false, reason: 'error' });
  });

  it('perfil completo: balanço, foco, estoque, pedido, Apex, decisão e posição; inquilino em toda leitura', async () => {
    const calls: Call[] = [];
    const r = await buildSiteSupply(session(ALL, tables(), {}, calls), TUC, TODAY);
    expect(r).toMatchObject({ ok: true, today: TODAY, project: { id: TUC, name: 'SE Tucuruí 138 kV — Ampliação do pátio' } });
    const d = ok(r);
    expect(d.focus?.requirementId).toBe(REQ_CABO);
    expect(d.materials.map((m) => m.requirementId)).toEqual([REQ_CABO, REQ_DISJ]);
    expect(d.stock).toEqual({ state: 'ok', data: [
      expect.objectContaining({ locationId: 'site', isSite: true }), expect.objectContaining({ locationId: 'mar', available: 250 })] });
    expect(d.orders.state === 'ok' && d.orders.data).toEqual([expect.objectContaining({
      poId: 'po-1', supplier: { id: 'sup-1', name: 'Cabos Amazônia Ltda' }, expected: '2026-10-03', late: true, lateDays: 3, qty: 500 })]);
    expect(d.orders.state === 'ok' && d.orders.data[0].amountText).toMatch(/^R\$\s10\.000$/);
    expect(d.apex).toMatchObject({ state: 'ok', data: [{ signalId: 's-dec', stale: false }], asOf: '2026-09-25T12:30:46Z' });
    expect(d.decisions).toEqual({ state: 'ok', data: [expect.objectContaining({ key: 'purchase_order:po-1:s1', poId: 'po-1',
      href: '/decisoes?d=purchase_order%3Apo-1%3As1' })] });
    expect(d.site).toEqual({ lat: -3.7662, lng: -49.6725 });
    expect(d.truncated).toBe(false);
    // a caixa foi enriquecida SÓ com as linhas deste local
    expect(mocks.enrichInbox.mock.calls[0][1]).toHaveLength(1);
    expect(mocks.listSupplySignals).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ projectId: TUC, openOnly: true }));
    for (const c of calls) {
      expect(c.ops.some(([m, a]) => m === 'eq' && a[0] === 'organization_id' && a[1] === 'org-1'), `${c.table} sem inquilino`).toBe(true);
      const sel = c.ops.find(([m]) => m === 'select');
      expect(String(sel?.[1][0]), `${c.table} com *`).not.toContain('*');
    }
  });

  it('sem leitura do saldo em mão: estoque Restrito; sem procurement/supply: valor null e fornecedor Restrito', async () => {
    const r = await buildSiteSupply(session(['projects.view'], tables()), TUC, TODAY);
    const d = ok(r);
    expect(d.stock).toEqual({ state: 'restricted' });
    expect(d.orders.state).toBe('ok');
    if (d.orders.state !== 'ok') return;
    expect(d.orders.data[0]).toMatchObject({ amountText: null, supplier: { id: 'sup-1', name: 'Restrito' } });
  });

  it('cobertura que cai → a seção inteira `error` (nunca "sem falta")', async () => {
    const r = await buildSiteSupply(session(ALL, tables({ supply_requirement_coverage: { error: 'timeout' } })), TUC, TODAY);
    expect(r).toMatchObject({ ok: true, supply: { state: 'error', message: 'Não foi possível ler a cobertura de material.' } });
  });

  it('uma parte que cai vira `error` só nela; a caixa que cai → decisions `error`, nunca []', async () => {
    mocks.viewerInbox.mockRejectedValue(new Error('READ_FAILED'));
    const r = await buildSiteSupply(session(ALL, tables({ inventory_position: { error: 'boom' } })), TUC, TODAY);
    const d = ok(r);
    expect(d.stock).toEqual({ state: 'error', message: 'Não foi possível ler o estoque do item.' });
    expect(d.decisions).toEqual({ state: 'error', message: 'Não foi possível ler a sua caixa de decisões.' });
    expect(d.orders.state).toBe('ok');
    expect(d.apex.state).toBe('ok');
  });

  it('achados lidos com corte → `truncated`; sem leitura de sinais → Restrito', async () => {
    mocks.listSupplySignals.mockResolvedValue({ lastRun: null, openCount: 900, signals: [] });
    const d = ok(await buildSiteSupply(session(ALL, tables()), TUC, TODAY));
    expect(d.apex).toMatchObject({ state: 'ok', data: [], truncated: true });
    const d2 = ok(await buildSiteSupply(session(['projects.view'], tables()), TUC, TODAY));
    // projects.view está nas chaves de `supply_signals`: lê
    expect(d2.apex.state).toBe('ok');
  });

  it('projeto sem requisito: balanço vazio, foco null, partes vazias (lidas) — não "restrito"', async () => {
    const d = ok(await buildSiteSupply(session(ALL, tables({ project_requirements: { rows: [] }, supply_requirement_coverage: { rows: [] } })),
      TUC, TODAY));
    expect(d).toMatchObject({ focus: null, materials: [], stock: { state: 'ok', data: [] }, orders: { state: 'ok', data: [] },
      apex: { state: 'ok', data: [] } });
  });
});

describe('GET /api/dashboard/site/[projectId]/supply', () => {
  afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });
  const ctx = (projectId: string) => ({ params: Promise.resolve({ projectId }) });

  it('200 com o motivo no corpo (sem erro de console), no-store e Server-Timing', async () => {
    mocks.requireCommercialSession.mockResolvedValue(session(ALL, tables({ projects: { rows: [] } })));
    const { GET } = await import('@/app/api/dashboard/site/[projectId]/supply/route');
    const res = await GET(new Request('http://x/api/dashboard/site/qa-x/supply'), ctx('qa-x'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('server-timing')).toContain('total;dur=');
    expect(await res.json()).toMatchObject({ ok: false, reason: 'not_found', error: 'Projeto não encontrado nesta organização.' });
  });

  it('500 só quando a montagem inteira falha; 401 vem da sessão', async () => {
    const broken = session(ALL, tables());
    (broken.supabase as unknown as { rpc: () => never }).rpc = () => { throw new Error('rede'); };
    mocks.requireCommercialSession.mockResolvedValue(broken);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { GET } = await import('@/app/api/dashboard/site/[projectId]/supply/route');
    const res = await GET(new Request(`http://x/api/dashboard/site/${TUC}/supply`), ctx(TUC));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, reason: 'error' });
    const { NextResponse } = await import('next/server');
    mocks.requireCommercialSession.mockResolvedValue({ error: NextResponse.json({ ok: false }, { status: 401 }) });
    expect((await GET(new Request(`http://x/api/dashboard/site/${TUC}/supply`), ctx(TUC))).status).toBe(401);
  });
});
