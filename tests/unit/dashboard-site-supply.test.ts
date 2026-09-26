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
 *     quando a montagem inteira falha;
 *  5. rodada 2: a origem da necessidade, o PLANO (reservar → transferir →
 *     comprar, cada passo com a rota governada e a alçada), as solicitações e
 *     cotações (A × B pela régua de Compras), os fornecedores candidatos e o
 *     que a pessoa pode fazer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listSupplySignals: vi.fn(),
  viewerInbox: vi.fn(),
  enrichInbox: vi.fn(),
  requireCommercialSession: vi.fn(),
  readRfqDispatches: vi.fn(),
}));

vi.mock('@/lib/platform/server-client', () => ({
  platformServiceClient: () => { throw new Error('service role não é usado pelo Dashboard'); },
}));
// O único acesso ao livro de e-mails (service role, só ids já lidos sob a RLS) — simulado aqui.
vi.mock('@/lib/supply/rfq-send', () => ({ readRfqDispatches: mocks.readRfqDispatches }));
vi.mock('@/lib/supply/supplier-discovery', () => ({
  supplierDiscoveryAvailability: () => ({ available: false, reason: 'Busca externa desligada nesta instalação' }),
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
  buildSiteSupply, distanceKm, focusApexNotes, inboundOrders, inMaterialScope, isSiteProjectId, materialBalance, mapLimit, needOrigin, pickFocus,
  compareMaterials, PENDING_TRANSFER_STEP_STATUS, quoteVerdict, restrictedRecommendationText, rfqView, siteCoordinate, siteDecisionRows,
  stockNodes, supplierBasis, supplierCandidates, supplyCapabilities, supplyDecision, supplyPlan, withDecisionKeys, type CoverageMeta, type LocationRow, type PlanInput, type PoAllocationRow, type PoLineRow,
  type PoRow, type RfqViewInput, type SupplierInfo, type SupplierProfileRow,
} from '@/lib/dashboard/site-supply';
import type { SignalLike } from '@/lib/dashboard/rules';
import { strategyOptions, type CoverageViewRow } from '@/lib/supply/coverage';
import type { DecisionInboxRow } from '@/lib/decisions/types';
import type { MaterialBalance, RequisitionView, SiteSupplyResponse, StockNode } from '@/lib/dashboard/types';

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

/* ── 5. Rodada 2: origem, plano, cotações, fornecedores ─────────────────── */

describe('origem da necessidade', () => {
  const activities: CoverageMeta['activities'] = new Map([
    ['act-cabos', { id: 'act-cabos', title: 'Lançamento de cabos de potência', plannedStart: '2026-09-30T08:00:00Z' }],
    ['act-sem-data', { id: 'act-sem-data', title: null, plannedStart: null }],
  ]);
  const look = {
    activities,
    serviceOrders: new Map([['os-1', 'OS-QA-2026-0301']]),
    osItems: new Map([
      ['osi-pdf', { origin: 'document_extraction', aiModel: 'claude-sonnet-5', aiProvider: 'anthropic' }],
      ['osi-human', { origin: 'document_extraction', aiModel: 'manual', aiProvider: 'human' }],
      ['osi-pkg', { origin: 'proposal_package', aiModel: null, aiProvider: null }],
    ]),
  };
  const f = (over: Partial<Parameters<typeof needOrigin>[0]>) => ({ source: null, serviceOrderId: null, serviceOrderItemId: null,
    activityId: null, ...over });

  it('cronograma: "Do cronograma: {atividade} (início dd/mm)"; sem data, sem o início', () => {
    expect(needOrigin(f({ source: 'ACTIVITY', activityId: 'act-cabos' }), look)).toEqual({
      source: 'ACTIVITY', label: 'Do cronograma: Lançamento de cabos de potência (início 30/09)', serviceOrder: null,
      activity: { id: 'act-cabos', title: 'Lançamento de cabos de potência', start: '2026-09-30' }, readByAi: false,
    });
    expect(needOrigin(f({ source: 'ACTIVITY', activityId: 'act-sem-data' }), look)?.label).toBe('Do cronograma: Atividade do cronograma');
    expect(needOrigin(f({ source: 'ACTIVITY', activityId: 'sumiu' }), look)?.label).toBe('Do cronograma');
  });

  it('OS: "Da OS {nº}" com link; `readByAi` SÓ quando o item veio da leitura do PDF pela Apex', () => {
    expect(needOrigin(f({ source: 'SERVICE_ORDER', serviceOrderId: 'os-1', serviceOrderItemId: 'osi-pdf' }), look)).toEqual({
      source: 'SERVICE_ORDER', label: 'Da OS OS-QA-2026-0301', serviceOrder: { id: 'os-1', number: 'OS-QA-2026-0301',
        href: '/operacoes/ordens-servico/os-1' }, activity: null, readByAi: true,
    });
    expect(needOrigin(f({ source: 'SERVICE_ORDER', serviceOrderId: 'os-1', serviceOrderItemId: 'osi-human' }), look)?.readByAi).toBe(false);
    expect(needOrigin(f({ source: 'SERVICE_ORDER', serviceOrderId: 'os-1', serviceOrderItemId: 'osi-pkg' }), look)?.readByAi).toBe(false);
    // a leitura das OS caiu: a origem de OS não é inventada
    expect(needOrigin(f({ source: 'SERVICE_ORDER', serviceOrderId: 'os-1' }), { ...look, serviceOrders: null, osItems: null })).toBeNull();
  });

  it('manual, proposta da Apex, plano importado — ditos como são', () => {
    expect(needOrigin(f({ source: 'MANUAL' }), look)?.label).toBe('Registro manual, sem atividade');
    expect(needOrigin(f({ source: 'MANUAL', activityId: 'act-cabos' }), look)?.label)
      .toBe('Registro manual — Lançamento de cabos de potência (início 30/09)');
    expect(needOrigin(f({ source: 'AI_PROPOSAL' }), look)).toMatchObject({ source: 'AI_PROPOSAL',
      label: 'Sugerido pela Apex e confirmado no planejamento', readByAi: false });
    expect(needOrigin(f({ source: 'IMPORTED_PLAN' }), look)).toMatchObject({ source: 'OTHER', label: 'Do plano importado' });
  });

  it('o balanço carrega a origem do requisito (sem leitura → `null`)', () => {
    const origin = needOrigin(f({ source: 'ACTIVITY', activityId: 'act-cabos' }), look);
    expect(materialBalance(COVERAGE[0], { ...META, origins: new Map([[REQ_CABO, origin]]) }, TODAY).origin).toEqual(origin);
    expect(materialBalance(COVERAGE[0], META, TODAY).origin).toBeNull();
  });
});

/** O material em foco de SE Tucuruí no QA: 1200 m, 300 reservados, 400 a caminho, 500 requisitados → falta 500. */
const CABO = (): MaterialBalance => materialBalance(COVERAGE[0], META, TODAY);
const node = (over: Partial<StockNode> & { locationId: string }): StockNode => ({
  code: null, name: `Local ${over.locationId}`, kind: 'WAREHOUSE', kindLabel: 'Almoxarifado', lat: null, lng: null, onHand: 0, reserved: 0,
  available: 0, isSite: false, ...over,
});
const SITE_NODE = node({ locationId: 'site', name: 'Canteiro SE Tucuruí', kind: 'PROJECT_SITE', isSite: true, lat: -3.7662, lng: -49.6725 });
const MARABA = node({ locationId: 'mar', name: 'Canteiro LT Marabá', kind: 'PROJECT_SITE', lat: -5.3686, lng: -49.1178, onHand: 250, available: 250 });
const BELEM = node({ locationId: 'bel', name: 'Almoxarifado Central — Belém', lat: -1.4558, lng: -48.4902, onHand: 300, reserved: 300 });

const planInput = (over: Partial<PlanInput> = {}): PlanInput => ({
  focus: CABO(), requirementType: 'MATERIAL', stock: [SITE_NODE, MARABA, BELEM], site: { lat: -3.7662, lng: -49.6725 },
  siteLocations: [{ id: 'site', name: 'Canteiro SE Tucuruí' }],
  transit: [{ fromId: 'mar', toId: 'site', days: 3 }], inTransit: [{ number: 'TRF-0001', qty: 400 }],
  requisitions: [{ number: 'RC-260924-C451E' }], purchaseOrders: [],
  caps: { reserve: false, transfer: false, manage: false, request: false }, projectId: TUC, today: TODAY, ...over,
});

describe('o plano da Apex (reservar → transferir → comprar)', () => {
  it('SE Tucuruí: reserva feita, 400 m a caminho, 250 m do Canteiro LT Marabá; a solicitação de 500 m sobraria 250 m', () => {
    const p = supplyPlan(planInput());
    expect(p.steps.map((s) => [s.kind, s.status, s.qty, s.label])).toEqual([
      ['reserve', 'done', 300, 'Reservar 300 m'],
      ['transfer', 'done', 400, 'Transferir 400 m'],
      ['transfer', 'suggested', 250, 'Transferir 250 m do Canteiro LT Marabá'],
      // a quantidade REAL requisitada (500), não a sobra do plano (250)
      ['buy', 'done', 500, 'Comprar 500 m'],
    ]);
    expect(p.steps[0].reason).toBe('300 m já reservados para este requisito');
    expect(p.steps[1].reason).toBe('400 m a caminho do canteiro — TRF-0001');
    expect(p.steps[2]).toMatchObject({ from: { locationId: 'mar', name: 'Canteiro LT Marabá', lat: -5.3686, lng: -49.1178 }, action: null });
    // chegada pelo histórico real entre os locais (simulateTransfer): 3 dias → 28/09, antes da necessidade 30/09; plural em português
    expect(p.steps[2].reason).toMatch(/^1\d\d km · chega em ~3 dias \(28\/09; média de 1 transferência entre estes locais\) — antes da necessidade\.$/);
    // hoje a solicitação cobre a falta; se a rede cobrir o sugerido, ela sobra — dito com números, nunca "feito" por cima
    expect(p.steps[3].reason).toBe('já requisitado (500 m) — RC-260924-C451E; se fizer o sugerido acima, a compra precisa só de 250 m: '
      + 'revise a solicitação em Compras (senão 250 m a mais).');
    expect(p).toMatchObject({ remainingShortage: 250, basis: 'Cobertura viva + estoque livre em 1 local' });
  });

  it('transferência já PEDIDA (não despachada): não é "feita", sai da falta ANTES das sugestões e a origem prometida não é sugerida de novo', () => {
    expect(PENDING_TRANSFER_STEP_STATUS).not.toBe('done');
    const p = supplyPlan(planInput({ pendingTransfers: [{ number: 'TR-260925-94AD3', qty: 250, fromLocationId: 'mar', status: 'REQUESTED' }] }));
    expect(p.steps.map((s) => [s.kind, s.status, s.qty, s.label])).toEqual([
      ['reserve', 'done', 300, 'Reservar 300 m'],
      ['transfer', 'done', 400, 'Transferir 400 m'],
      ['transfer', PENDING_TRANSFER_STEP_STATUS, 250, 'Transferir 250 m do Canteiro LT Marabá'],
      // SE Tucuruí no QA hoje: 300 + 400 + 250 pedidos + 500 requisitados = 1450 m para 1200 — a sobra é dita
      ['buy', 'blocked', 500, 'Comprar 500 m'],
    ]);
    expect(p.steps[2]).toMatchObject({ reason: 'já pedida — TR-260925-94AD3; aguarda a aprovação no Estoque (ainda não saiu da origem)',
      action: null, from: { locationId: 'mar', lat: -5.3686 } });
    expect(p.steps[3].reason).toBe('Acima do que falta: RC-260924-C451E pede 500 m, mas faltam 250 m (contando a transferência já pedida '
      + 'TR-260925-94AD3) — 250 m a mais. Revise a solicitação em Compras antes de decidir a cotação.');
    expect(p.steps.every((s) => s.action === null)).toBe(true);
    expect(p.remainingShortage).toBe(250);
    // aprovada e parcial: a origem só tem o que sobra livre; a solicitação da falta ainda contaria a pedida — dito
    const partial = supplyPlan(planInput({ requisitions: [], focus: { ...CABO(), requested: 0 },
      pendingTransfers: [{ number: 'TR-2', qty: 100, fromLocationId: 'mar', status: 'APPROVED' }] }));
    expect(partial.steps.filter((s) => s.kind === 'transfer').map((s) => [s.status, s.qty, s.reason?.slice(0, 20)])).toEqual([
      ['done', 400, '400 m a caminho do c'], [PENDING_TRANSFER_STEP_STATUS, 100, 'já pedida — TR-2; ag'],
      ['suggested', 150, expect.stringMatching(/km · chega/)]]);
    expect(partial.steps[2].reason).toBe('já pedida — TR-2; aguarda o despacho no Estoque (ainda não saiu da origem)');
    expect(partial.steps.at(-1)).toMatchObject({ kind: 'buy', status: 'suggested', qty: 250,
      reason: 'A solicitação compra a falta sem cobertura no momento em que for aberta (hoje 500 m, que ainda inclui 100 m já pedidos em '
        + 'transferência — TR-2): faça antes o que está acima e abra depois do despacho.' });
    expect(partial.remainingShortage).toBe(250);
  });

  it('a reserva no canteiro é medida DEPOIS da transferência pedida — nunca sugere o que o banco recusaria (over-cover)', () => {
    // 1200 requeridos, 300 reservados, 400 a caminho, 500 livres no canteiro e 250 já pedidos: o banco aceita só 250
    const site = { ...SITE_NODE, onHand: 500, available: 500 };
    const p = supplyPlan(planInput({ stock: [site, MARABA], requisitions: [], focus: { ...CABO(), requested: 0 },
      caps: { reserve: true, transfer: true, manage: false, request: true },
      pendingTransfers: [{ number: 'TR-260925-94AD3', qty: 250, fromLocationId: 'mar', status: 'REQUESTED' }] }));
    const reserve = p.steps.find((s) => s.kind === 'reserve' && s.status === 'suggested');
    expect(reserve).toMatchObject({ qty: 250, label: 'Reservar 250 m no Canteiro SE Tucuruí',
      action: { body: { requirementId: REQ_CABO, locationId: 'site', quantity: 250 } } });
    // 300 + 400 + 250 pedidos + 250 reservados = 1200: nada mais é sugerido nem comprado
    expect(p.steps.filter((s) => s.status === 'suggested')).toHaveLength(1);
    expect(p.remainingShortage).toBe(0);
  });

  it('solicitação que cobre a falta: a rede segue sugerida (custa menos), e quem pede a rede fica sabendo que a solicitação precisa ser revista', () => {
    const p = supplyPlan(planInput({ caps: { reserve: true, transfer: true, manage: false, request: true } }));
    const transfer = p.steps.find((s) => s.kind === 'transfer' && s.status === 'suggested');
    expect(transfer?.action?.confirm).toMatch(/O pedido segue para aprovação no Estoque\. A solicitação RC-260924-C451E já pede 500 m deste material: revise-a em Compras para não comprar o que a rede cobre\.$/);
    // a rede cobre tudo o que falta: a solicitação sobraria inteira
    const all = supplyPlan(planInput({ stock: [SITE_NODE, { ...MARABA, onHand: 600, available: 600 }] }));
    expect(all.steps.at(-1)).toMatchObject({ kind: 'buy', status: 'done', qty: 500,
      reason: 'já requisitado (500 m) — RC-260924-C451E; se fizer o sugerido acima, a compra não é mais necessária: '
        + 'revise a solicitação em Compras (senão 500 m a mais).' });
    // requisitado exatamente o que falta depois da rede: feito
    const exact = supplyPlan(planInput({ focus: { ...CABO(), requested: 250 } }));
    expect(exact.steps.at(-1)).toMatchObject({ kind: 'buy', status: 'done', qty: 250, reason: 'já requisitado (250 m) — RC-260924-C451E' });
    // a cobertura já zerou a falta e ainda há solicitação aberta: sobra inteira, dita
    const covered = supplyPlan(planInput({ focus: { ...CABO(), shortage: 0, onOrder: 500, requested: 120 }, purchaseOrders: [{ number: 'OC-7' }] }));
    expect(covered.steps.at(-1)).toMatchObject({ kind: 'buy', status: 'blocked', qty: 120,
      reason: 'Acima do que falta: RC-260924-C451E pede 120 m, mas a falta já está coberta — 120 m a mais. '
        + 'Revise a solicitação em Compras antes de decidir a cotação.' });
  });

  it('a mesma divisão de `strategyOptions` com uma origem só (reservar → transferir → comprar)', () => {
    const f = CABO();
    const ref = strategyOptions('MATERIAL', f.shortage, [{ locationId: 'mar', locationName: 'Canteiro LT Marabá', available: 250, isDestination: false }]);
    const mine = supplyPlan(planInput({ requisitions: [], focus: { ...f, requested: 0 } })).steps.filter((s) => s.status === 'suggested');
    expect(mine.map((s) => [s.kind, s.qty])).toEqual(ref.map((o) => [o.strategy === 'TRANSFER' ? 'transfer' : 'buy', o.quantity]));
  });

  it('com alçada: cada passo aponta a rota governada, com o corpo e a frase de confirmação', () => {
    const f = { ...CABO(), requested: 0 };
    const withSite = [{ ...SITE_NODE, onHand: 120, available: 120 }, MARABA, BELEM];
    const p = supplyPlan(planInput({ focus: f, stock: withSite, requisitions: [],
      caps: { reserve: true, transfer: true, manage: false, request: true } }));
    const [reserveDone, reserve, transferDone, transfer, buy] = p.steps;
    expect(reserveDone.status).toBe('done');
    expect(transferDone.status).toBe('done');
    expect(reserve).toMatchObject({ kind: 'reserve', status: 'suggested', qty: 120, label: 'Reservar 120 m no Canteiro SE Tucuruí',
      action: { method: 'POST', href: '/api/supply/inventory/reservations', permission: 'inventory.reserve',
        body: { requirementId: REQ_CABO, locationId: 'site', quantity: 120 } } });
    // sem chave fixa do servidor: a tela gera uma por intenção — um ato cancelado não é "repetido" em silêncio
    for (const s of p.steps) expect(s.action?.body ?? {}).not.toHaveProperty('idempotencyKey');
    expect(reserve.action?.confirm).toBe('Reservar 120 m de Cabo de potência 35 mm² XLPE 15 kV no Canteiro SE Tucuruí para '
      + '“Cabo 35 mm² para o lançamento dos bays”? A reserva segura o saldo para este projeto.');
    expect(transfer).toMatchObject({ kind: 'transfer', qty: 250, action: { href: '/api/supply/inventory/transfers', permission: 'inventory.reserve',
      body: { fromLocationId: 'mar', toLocationId: 'site', projectId: TUC, expectedArrival: '2026-09-28',
        lines: [{ itemId: ITEM_CABO, quantity: 250, requirementId: REQ_CABO }] } } });
    expect(transfer.action?.confirm).toMatch(/^Pedir a transferência de 250 m de .* do Canteiro LT Marabá para Canteiro SE Tucuruí\?/);
    expect(buy).toMatchObject({ kind: 'buy', status: 'suggested', qty: 130, action: { href: '/api/supply/procurement/requisitions',
      permission: 'procurement.request', body: { source: 'SHORTAGE', requirementIds: [REQ_CABO], priority: 'critical', deliveryLocationId: 'site' } } });
    // a requisição do banco compra a falta sem cobertura NO MOMENTO — dito com o número de hoje
    expect(buy.reason).toBe('A solicitação compra a falta sem cobertura no momento em que for aberta (hoje 500 m): faça antes o que está acima.');
    expect(buy.action?.confirm).toContain('(hoje 500 m)');
    expect(p.remainingShortage).toBe(130);
    // quem gere o estoque transfere pela sua chave
    expect(supplyPlan(planInput({ caps: { reserve: false, transfer: true, manage: true, request: false } })).steps[2].action?.permission)
      .toBe('inventory.manage');
  });

  it('origens: a mais perto primeiro; quarentena nunca é origem; sem coordenada por último', () => {
    const far = node({ locationId: 'far', name: 'Depósito Sul', lat: -23.5, lng: -46.6, onHand: 900, available: 900 });
    const blind = node({ locationId: 'blind', name: 'Base sem mapa', onHand: 50, available: 50 });
    const quar = node({ locationId: 'q', kind: 'QUARANTINE', name: 'Quarentena', onHand: 999, available: 999 });
    const p = supplyPlan(planInput({ stock: [SITE_NODE, far, blind, quar, MARABA], requisitions: [], focus: { ...CABO(), requested: 0 } }));
    expect(p.steps.filter((s) => s.kind === 'transfer' && s.status === 'suggested').map((s) => [s.from?.locationId, s.qty]))
      .toEqual([['mar', 250], ['far', 250]]);
    expect(distanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111.2, 0);
    expect(distanceKm({ lat: null, lng: null }, { lat: 0, lng: 1 })).toBeNull();
  });

  it('bloqueios honestos: sem canteiro, sem item, serviço externo; nada livre no canteiro', () => {
    const noSite = supplyPlan(planInput({ siteLocations: [], requisitions: [], focus: { ...CABO(), reserved: 0, requested: 0 } }));
    expect(noSite.steps.map((s) => [s.kind, s.status])).toEqual([['reserve', 'blocked'], ['transfer', 'done'], ['transfer', 'blocked'],
      ['buy', 'suggested']]);
    expect(noSite.steps[0].reason).toBe('O projeto não tem canteiro cadastrado no Supply.');
    // a transferência bloqueada não reduz a falta: tudo segue para a compra
    expect(noSite.remainingShortage).toBe(500);
    const noItem = supplyPlan(planInput({ focus: { ...CABO(), item: null, requested: 0 } }));
    expect(noItem.steps.at(-1)).toMatchObject({ kind: 'buy', status: 'blocked', qty: 500, action: null });
    const service = supplyPlan(planInput({ requirementType: 'EXTERNAL_SERVICE', focus: { ...CABO(), requested: 0 } }));
    expect(service.steps.at(-1)).toMatchObject({ kind: 'buy', status: 'blocked', label: 'Contratar 500 m' });
    const nothing = supplyPlan(planInput({ focus: { ...CABO(), reserved: 0, requested: 0 }, stock: [SITE_NODE] }));
    expect(nothing.steps[0]).toMatchObject({ kind: 'reserve', status: 'blocked', reason: 'Sem saldo livre do item no canteiro deste projeto.' });
    expect(nothing.basis).toBe('Cobertura viva — sem estoque livre do item na rede');
  });

  it('requisitado em parte: diz quanto falta requisitar; coberto: só o que já foi feito', () => {
    const partial = supplyPlan(planInput({ focus: { ...CABO(), requested: 100 }, stock: [SITE_NODE] }));
    expect(partial.steps.at(-1)).toMatchObject({ kind: 'buy', status: 'suggested', qty: 500,
      reason: 'já requisitado (100 m) — RC-260924-C451E; falta requisitar 400 m.' });
    const covered = supplyPlan(planInput({ focus: { ...CABO(), shortage: 0, onOrder: 500, requested: 0 }, purchaseOrders: [{ number: 'OC-7' }] }));
    expect(covered.steps.map((s) => [s.kind, s.status])).toEqual([['reserve', 'done'], ['transfer', 'done'], ['buy', 'done']]);
    expect(covered.steps[2].reason).toBe('500 m em pedido de compra — OC-7');
    expect(covered).toMatchObject({ remainingShortage: 0, basis: 'Cobertura viva: o requisito está coberto' });
    // sem leitura de compras: o motivo sai sem número (nunca inventado)
    expect(supplyPlan(planInput({ requisitions: null })).steps.at(-1)?.reason).toMatch(/^já requisitado \(500 m\); se fizer/);
  });
});

/* A cotação aberta do QA: COT-260924-98CDA, 500 m; A no prazo (mais cara), B mais barata e 7 dias atrasada. */
const supplierInfo = (id: string, over: Partial<SupplierInfo> = {}): SupplierInfo => ({
  id, name: `Fornecedor ${id}`, status: 'HOMOLOGATED', categories: ['Cabos'], contactName: null, hasEmail: true, hasPhone: false,
  defaultLeadDays: null, onTimeRate: null, ...over,
});
const rfqInput = (over: Partial<RfqViewInput> = {}): RfqViewInput => ({
  rfq: { id: 'rfq-1', rfq_number: 'COT-260924-98CDA', status: 'OPEN', response_due: '2026-09-27' },
  lines: [{ id: 'rfl-1', rfq_id: 'rfq-1', requisition_line_id: 'rql-1', item_id: ITEM_CABO, quantity: '500', required_by: '2026-09-30' }],
  focusLineIds: new Set(['rfl-1']), needBy: '2026-09-30',
  invited: [{ id: 'inv-a', supplier_id: 'sup-a' }, { id: 'inv-b', supplier_id: 'sup-b' }],
  quotes: [
    { id: 'q-a', rfq_id: 'rfq-1', supplier_id: 'sup-a', version: 1, status: 'RECEIVED', currency: 'BRL', freight_amount: '1200', tax_amount: 0,
      payment_terms: '28 dias', validity_date: '2026-10-24', lead_time_days: 12, deviations: null },
    { id: 'q-b', rfq_id: 'rfq-1', supplier_id: 'sup-b', version: 1, status: 'RECEIVED', currency: 'BRL', freight_amount: '900', tax_amount: 0,
      payment_terms: '21 dias', validity_date: '2026-10-24', lead_time_days: 5, deviations: null },
  ],
  quoteLines: [
    { quote_id: 'q-a', rfq_line_id: 'rfl-1', unit_price: '38.9', quantity: '500', lead_time_days: null, compliant: true },
    { quote_id: 'q-b', rfq_line_id: 'rfl-1', unit_price: '41.2', quantity: '500', lead_time_days: null, compliant: true },
  ],
  decision: null, po: null,
  suppliers: new Map([['sup-a', supplierInfo('sup-a', { name: 'Cabos Norte', onTimeRate: 0.9 })],
    ['sup-b', supplierInfo('sup-b', { name: 'Fios Pará', hasEmail: false, onTimeRate: 0.5 })]]),
  sentAt: new Map([['inv-a', '2026-09-24T13:00:00Z']]),
  today: TODAY, amountVisible: true, ...over,
});

describe('cotação: a comparação A × B pela régua de Compras', () => {
  it('recomendada = a que chega a tempo com o menor custo total posto; a mais barata atrasa 7 dias', () => {
    const v = rfqView(rfqInput());
    expect(v).toMatchObject({ id: 'rfq-1', number: 'COT-260924-98CDA', status: 'OPEN', statusLabel: 'Aberta', responseDue: '2026-09-27',
      href: '/supply/compras?stage=cotacoes&rfq=rfq-1', decision: null });
    expect(v.invited).toEqual([
      { supplierId: 'sup-a', name: 'Cabos Norte', hasContact: true, sentAt: '2026-09-24T13:00:00Z' },
      { supplierId: 'sup-b', name: 'Fios Pará', hasContact: false, sentAt: null },
    ]);
    const [a, b] = v.quotes;
    // A (recomendada, primeiro): Fios Pará 41,20 × 500 + 900 = 21.500, chega 30/09 (a tempo)
    expect(a).toMatchObject({ quoteId: 'q-b', supplier: { id: 'sup-b', name: 'Fios Pará', homologated: true, onTimeRate: 0.5 },
      leadDays: 5, eta: '2026-09-30', onTime: true, lateDays: 0, recommended: true, cheapest: false, paymentTerms: '21 dias',
      validity: '2026-10-24' });
    expect(a.totalText).toMatch(/^R\$\s21\.500$/);
    expect(a.unitPriceText).toMatch(/^R\$\s41,20$/);
    expect(a.verdict).toBe('Chega a tempo (30/09) · pontualidade histórica de 50%');
    // B: Cabos Norte 38,90 × 500 + 1.200 = 20.650, chega 07/10 — 7 dias depois
    expect(b).toMatchObject({ quoteId: 'q-a', leadDays: 12, eta: '2026-10-07', onTime: false, lateDays: 7, recommended: false, cheapest: true,
      verdict: 'Chega 7 dias depois da necessidade' });
    expect(b.totalText).toMatch(/^R\$\s20\.650$/);
    expect(v.recommendation?.quoteId).toBe('q-b');
    // a frase de Compras, com o plural em português (ela vira a justificativa pré-preenchida da decisão)
    expect(v.recommendation?.text).toMatch(/^Fios Pará: menor custo total posto \(R\$\s21\.500,00\) entre as que chegam a tempo; a mais barata \(Cabos Norte, R\$\s20\.650,00\) atrasa 7 dias\.$/);
  });

  it('só propostas vigentes; a necessidade do material manda nas linhas dele; sem valor visível, sem dinheiro', () => {
    const v = rfqView(rfqInput({
      quotes: [...rfqInput().quotes, { ...rfqInput().quotes[0], id: 'q-a0', version: 0, status: 'SUPERSEDED', lead_time_days: 1 }],
      needBy: '2026-09-28',
      amountVisible: false,
    }));
    expect(v.quotes.map((q) => q.quoteId)).toEqual(['q-b', 'q-a']);
    // necessidade 28/09 (início da atividade) antes do required_by da linha (30/09): ninguém chega → a de menor atraso
    expect(v.quotes[0]).toMatchObject({ quoteId: 'q-b', lateDays: 2, onTime: false, totalText: null, unitPriceText: null });
    expect(v.recommendation?.text).toBe('Fios Pará: nenhuma chega a tempo; é a de menor atraso (2 dias).');
    expect(JSON.stringify(v)).not.toMatch(/R\$/);
  });

  it('"a mais barata" só entre as elegíveis; o preço unitário é o da linha do material (nunca o de outro item)', () => {
    // cotação de 2 linhas: A cota as duas (completa); B só o cabo (incompleta) e fica mais barata no total
    const two = rfqInput({
      lines: [...rfqInput().lines, { id: 'rfl-2', rfq_id: 'rfq-1', requisition_line_id: 'rql-x', item_id: ITEM_DISJ, quantity: '2', required_by: '2026-10-14' }],
      quoteLines: [
        { quote_id: 'q-a', rfq_line_id: 'rfl-1', unit_price: '41.2', quantity: '500', lead_time_days: null, compliant: true },
        { quote_id: 'q-a', rfq_line_id: 'rfl-2', unit_price: '500', quantity: '2', lead_time_days: null, compliant: true },
        { quote_id: 'q-b', rfq_line_id: 'rfl-1', unit_price: '38.9', quantity: '500', lead_time_days: null, compliant: true },
      ],
    });
    const v = rfqView(two);
    const byId = Object.fromEntries(v.quotes.map((q) => [q.quoteId, q]));
    expect(byId['q-b']).toMatchObject({ cheapest: false, recommended: false });
    expect(byId['q-b'].verdict).toContain('não cota tudo o que foi pedido');
    expect(byId['q-a']).toMatchObject({ cheapest: true, recommended: true });
    expect(byId['q-a'].unitPriceText).toMatch(/^R\$\s41,20$/);
    // proposta que não cota a linha do material: sem preço unitário (antes caía no preço do disjuntor)
    const other = rfqView({ ...two, quoteLines: [
      { quote_id: 'q-a', rfq_line_id: 'rfl-2', unit_price: '500', quantity: '2', lead_time_days: null, compliant: true },
      { quote_id: 'q-b', rfq_line_id: 'rfl-1', unit_price: '38.9', quantity: '500', lead_time_days: null, compliant: true },
    ] });
    expect(other.quotes.find((q) => q.quoteId === 'q-a')?.unitPriceText).toBeNull();
  });

  it('o atraso do material em foco é medido contra a necessidade DELE, não a de outro item da cotação', () => {
    // cabo (foco) necessário em 20/10; outro item em 01/10; prazo de 20 dias → chega 15/10
    const v = rfqView(rfqInput({
      needBy: '2026-10-20',
      lines: [{ id: 'rfl-1', rfq_id: 'rfq-1', requisition_line_id: 'rql-1', item_id: ITEM_CABO, quantity: '500', required_by: '2026-10-20' },
        { id: 'rfl-2', rfq_id: 'rfq-1', requisition_line_id: 'rql-x', item_id: ITEM_DISJ, quantity: '2', required_by: '2026-10-01' }],
      quotes: [{ ...rfqInput().quotes[0], lead_time_days: 20 }],
      quoteLines: [
        { quote_id: 'q-a', rfq_line_id: 'rfl-1', unit_price: '38.9', quantity: '500', lead_time_days: null, compliant: true },
        { quote_id: 'q-a', rfq_line_id: 'rfl-2', unit_price: '500', quantity: '2', lead_time_days: null, compliant: true },
      ],
    }));
    expect(v.quotes[0]).toMatchObject({ eta: '2026-10-15', onTime: true, lateDays: 0, verdict: 'Chega a tempo (15/10)' });
  });

  it('moedas diferentes não se comparam: sem "mais barata" e sem recomendação — a tela diz por quê', () => {
    const v = rfqView(rfqInput({ quotes: rfqInput().quotes.map((q) => (q.id === 'q-a' ? { ...q, currency: 'USD', freight_amount: 0 } : q)) }));
    expect(v.quotes.every((q) => !q.cheapest && !q.recommended)).toBe(true);
    expect(v.recommendation).toEqual({ quoteId: null,
      text: 'Propostas elegíveis em moedas diferentes (real e dólar): a Apex não compara custo entre moedas — compare em Compras com o câmbio do dia.' });
    // uma proposta vencida em outra moeda não impede a comparação das elegíveis
    const expired = rfqView(rfqInput({ quotes: rfqInput().quotes.map((q) => (q.id === 'q-a' ? { ...q, currency: 'USD', validity_date: '2026-09-01' } : q)) }));
    expect(expired.recommendation?.quoteId).toBe('q-b');
  });

  it('sem valor visível: a recomendação diz os FATOS da régua (conformidade, prazo), nunca "menor custo" falso', () => {
    const ev = (over: Partial<Parameters<typeof restrictedRecommendationText>[0]>) => ({ quoteId: 'x', supplier: 'X', goods: 0, landed: 0,
      currency: 'BRL', eta: '2026-09-30', lateDays: 0, complete: true, compliant: true, expired: false, supplierOk: true, eligible: true,
      reliability: null, flags: [], ...over });
    const a = ev({ quoteId: 'a', supplier: 'Alfa', landed: 6000 });
    const b = ev({ quoteId: 'b', supplier: 'Beta', landed: 5000, compliant: false });
    expect(restrictedRecommendationText(a, [a, b])).toBe('Alfa: chega a tempo; a mais barata tem desvio ou restrição.');
    expect(restrictedRecommendationText(a, [a])).toBe('Alfa: chega a tempo, com o menor custo total posto.');
    const noLead = ev({ quoteId: 'n', supplier: 'Nulo', eta: null, lateDays: null });
    expect(restrictedRecommendationText(noLead, [noLead])).toBe('Nulo: sem prazo informado, com o menor custo total posto.');
    const late = ev({ quoteId: 'l', supplier: 'Lenta', lateDays: 1, compliant: false });
    expect(restrictedRecommendationText(late, [late])).toBe('Lenta: nenhuma chega a tempo; é a de menor atraso (1 dia); atenção: tem desvio — justifique ao decidir.');
  });

  it('decisão e pedido; a chave de Decisões só com a linha da caixa DESTA pessoa', () => {
    const v = rfqView(rfqInput({
      rfq: { id: 'rfq-1', rfq_number: 'COT-1', status: 'DECIDED', response_due: null },
      decision: { id: 'dec-1', rfq_id: 'rfq-1', quote_id: 'q-b', follows_recommendation: true, decided_at: '2026-09-25T10:00:00Z' },
      po: { id: 'po-9', order_number: 'OC-0009', status: 'APPROVAL_REQUIRED', sourcing_decision_id: 'dec-1' },
    }));
    expect(v.decision).toEqual({ quoteId: 'q-b', followsRecommendation: true, poId: 'po-9', poNumber: 'OC-0009', poStatus: 'APPROVAL_REQUIRED',
      poStatusLabel: 'Em aprovação', decisionKey: null });
    const req: RequisitionView = { id: 'rq-1', number: 'RC-1', status: 'ORDERED', statusLabel: 'Pedido emitido', qty: 500, unit: 'm',
      requiredBy: '2026-09-30', lineId: 'rql-1', href: '', rfqs: [v] };
    const inbox = [inboxRow({ decision_key: 'purchase_order:po-9:s1', subject_id: 'po-9' }),
      inboxRow({ decision_key: 'purchase_order:po-9:elig', subject_id: 'po-9', assignment: 'ELIGIBLE' })];
    expect(withDecisionKeys([req], inbox)[0].rfqs[0].decision?.decisionKey).toBe('purchase_order:po-9:s1');
    expect(withDecisionKeys([req], [inbox[1]])[0].rfqs[0].decision?.decisionKey).toBeNull();
    // caixa ilegível: sem chave (a tela não oferece "Aprovar" às cegas)
    expect(withDecisionKeys([req], null)[0].rfqs[0].decision?.decisionKey).toBeNull();
  });

  it('sem proposta elegível: diz por quê; veredito lista os desvios', () => {
    const v = rfqView(rfqInput({ quotes: rfqInput().quotes.map((q) => ({ ...q, validity_date: '2026-09-01' })) }));
    expect(v.recommendation).toEqual({ quoteId: null,
      text: 'Nenhuma proposta elegível (incompleta, vencida ou de fornecedor restrito) — veja o motivo em cada uma.' });
    expect(quoteVerdict({ quoteId: 'x', supplier: 's', goods: 1, landed: 1, currency: 'BRL', eta: null, lateDays: null, complete: false,
      compliant: false, expired: false, supplierOk: true, eligible: false, reliability: null,
      flags: ['sem prazo informado', 'não cota tudo o que foi pedido', 'com desvio técnico/comercial'] }))
      .toBe('Sem prazo informado · não cota tudo o que foi pedido · com desvio técnico/comercial');
  });
});

describe('fornecedores candidatos do item', () => {
  const profile = (id: string, over: Partial<SupplierProfileRow> = {}): SupplierProfileRow => ({
    id, party_id: `party-${id}`, status: 'HOMOLOGATED', categories: ['Cabos'], default_lead_time_days: null, contact_name: null,
    contact_email: null, contact_phone: null, ...over,
  });

  it('categoria do item (sem acento/caixa) OU histórico com o item; suspenso/bloqueado nunca', () => {
    const basis = supplierBasis({ category: 'cabos', historySupplierIds: new Set(['s-hist', 's-both', 's-susp']), profiles: [
      profile('s-cat', { categories: ['CABOS', 'Fixação'] }), profile('s-hist', { categories: ['Equipamentos'] }), profile('s-both'),
      profile('s-none', { categories: ['Equipamentos'] }), profile('s-susp', { status: 'SUSPENDED' }), profile('s-prospect', { status: 'PROSPECT' }),
    ] });
    expect(Object.fromEntries(basis)).toEqual({ 's-cat': 'category', 's-hist': 'history', 's-both': 'both', 's-prospect': 'category' });
    expect(supplierBasis({ category: null, historySupplierIds: new Set(), profiles: [profile('x')] }).size).toBe(0);
  });

  it('ordem: homologado → base (os dois, histórico, categoria) → pontualidade → nome; prazo da proposta vence o padrão', () => {
    const info = new Map<string, SupplierInfo>([
      ['a', supplierInfo('a', { name: 'Alfa', onTimeRate: 0.7, defaultLeadDays: 20 })],
      ['b', supplierInfo('b', { name: 'Beta', onTimeRate: 0.95 })],
      ['c', supplierInfo('c', { name: 'Gama', status: 'PROSPECT', onTimeRate: 1 })],
      ['d', supplierInfo('d', { name: 'Delta', onTimeRate: null, hasPhone: true, contactName: 'Rita' })],
    ]);
    const list = supplierCandidates({ basis: new Map([['a', 'category'], ['b', 'category'], ['c', 'both'], ['d', 'history']]), info,
      quotedLead: new Map([['a', 12]]) });
    expect(list.map((s) => s.supplierId)).toEqual(['d', 'b', 'a', 'c']);
    expect(list[0]).toEqual({ supplierId: 'd', name: 'Delta', status: 'HOMOLOGATED', categories: ['Cabos'], contactName: 'Rita', hasEmail: true,
      hasPhone: true, onTimeRate: null, leadDays: null, basis: 'history' });
    expect(list.find((s) => s.supplierId === 'a')?.leadDays).toBe(12);
  });
});

describe('o que a pessoa pode fazer', () => {
  it('as chaves exatas das rotas governadas; transferir = inventory.manage OU inventory.reserve', () => {
    const off = { available: false, reason: 'Busca externa desligada nesta instalação' };
    expect(supplyCapabilities({}, off)).toEqual({ request: false, source: false, approve: false, suppliersManage: false, reserve: false,
      transfer: false, aiSearch: off });
    expect(supplyCapabilities({ 'procurement.request': true, 'procurement.source': true, 'suppliers.manage': true, 'inventory.reserve': true }, off))
      .toMatchObject({ request: true, source: true, approve: false, suppliersManage: true, reserve: true, transfer: true });
    expect(supplyCapabilities({ 'inventory.manage': true, 'procurement.approve': true }, { available: true, reason: null }))
      .toMatchObject({ reserve: false, transfer: true, approve: true, aiSearch: { available: true, reason: null } });
  });
});

/* ── 2–4. Composição ────────────────────────────────────────────────────── */

const ALL = ['projects.view', 'supply.view', 'procurement.view', 'inventory.view', 'receiving.view', 'suppliers.view', 'operations.planning.view'];

function tables(over: Parameters<typeof fakeClient>[0] = {}): Parameters<typeof fakeClient>[0] {
  return {
    projects: { rows: [{ id: TUC, organization_id: 'org-1', project: { nome: 'SE Tucuruí 138 kV — Ampliação do pátio' }, project_v2: null }] },
    project_requirements: { rows: [
      { id: REQ_CABO, organization_id: 'org-1', project_id: TUC, status: 'CONFIRMED', title: 'Cabo 35 mm² para o lançamento dos bays',
        source: 'ACTIVITY', activity_id: 'act-cabos', service_order_id: null, service_order_item_id: null },
      { id: REQ_DISJ, organization_id: 'org-1', project_id: TUC, status: 'CONFIRMED', title: 'Disjuntores 145 kV dos novos bays',
        source: 'SERVICE_ORDER', activity_id: null, service_order_id: 'os-1', service_order_item_id: 'osi-1' },
    ] },
    internal_service_orders: { rows: [{ organization_id: 'org-1', id: 'os-1', os_number: 'OS-QA-2026-0301' }] },
    internal_service_order_items: { rows: [
      { organization_id: 'org-1', id: 'osi-1', origin: 'document_extraction', ai_model: 'claude-sonnet-5', ai_provider: 'anthropic' },
    ] },
    supply_requirement_coverage: { rows: COVERAGE.slice(0, 2) },
    project_timeline_items: { rows: [
      { id: 'act-cabos', organization_id: 'org-1', title: 'Lançamento de cabos de potência', planned_start: '2026-09-30' },
      { id: 'act-disj', organization_id: 'org-1', title: 'Instalação dos disjuntores 145 kV', planned_start: '2026-10-12' },
    ] },
    supply_items: { rows: [{ id: ITEM_CABO, organization_id: 'org-1', code: 'CABO-35-XLPE', description: 'Cabo 35', unit: 'm', category: 'Cabos' },
      { id: ITEM_DISJ, organization_id: 'org-1', code: 'DISJ-145KV', description: 'Disjuntor', unit: 'un', category: 'Equipamentos' }] },
    inventory_position: { rows: [
      { organization_id: 'org-1', item_id: ITEM_CABO, location_id: 'mar', on_hand_qty: 250, reserved_qty: 0, available_qty: 250 },
      { organization_id: 'org-1', item_id: ITEM_CABO, location_id: 'site', on_hand_qty: 0, reserved_qty: 0, available_qty: 0 },
    ] },
    inventory_locations: { rows: [
      loc('mar', { kind: 'PROJECT_SITE', project_id: 'qa-scn-maraba', latitude: -5.3686, longitude: -49.1178, name: 'Canteiro LT Marabá' }),
      loc('site', { kind: 'PROJECT_SITE', project_id: TUC, latitude: -3.7662, longitude: -49.6725, name: 'Canteiro SE Tucuruí' }),
    ] },
    inventory_transfer_lines: { rows: [
      { organization_id: 'org-1', transfer_id: 'tr-1', requirement_id: REQ_CABO, quantity: 400, received_quantity: 0 },
    ] },
    inventory_transfers: { rows: [
      { organization_id: 'org-1', id: 'tr-1', transfer_number: 'TRF-0001', status: 'IN_TRANSIT', project_id: TUC, from_location_id: 'norte',
        to_location_id: 'site', dispatched_at: '2026-09-24T10:00:00Z', received_at: null },
      { organization_id: 'org-1', id: 'tr-0', transfer_number: 'TRF-0000', status: 'RECEIVED', project_id: TUC, from_location_id: 'mar',
        to_location_id: 'site', dispatched_at: '2026-09-01T12:00:00Z', received_at: '2026-09-04T12:00:00Z' },
    ] },
    // A cotação aberta do QA: RC-260924-C451E → COT-260924-98CDA, duas propostas.
    purchase_requisition_line_requirements: { rows: [
      { organization_id: 'org-1', line_id: 'rql-1', requirement_id: REQ_CABO, quantity: 500 },
    ] },
    purchase_requisition_lines: { rows: [
      { organization_id: 'org-1', id: 'rql-1', requisition_id: 'rq-1', quantity: 500, required_by: '2026-09-30' },
    ] },
    purchase_requisitions: { rows: [
      { organization_id: 'org-1', id: 'rq-1', requisition_number: 'RC-260924-C451E', status: 'SOURCING', required_by: '2026-09-30',
        requested_at: '2026-09-24T10:00:00Z' },
      { organization_id: 'org-1', id: 'rq-0', requisition_number: 'RC-OLD', status: 'CANCELLED', required_by: null, requested_at: '2026-09-20T10:00:00Z' },
    ] },
    procurement_rfq_lines: { rows: [
      { organization_id: 'org-1', id: 'rfl-1', rfq_id: 'rfq-1', requisition_line_id: 'rql-1', item_id: ITEM_CABO, quantity: 500, required_by: '2026-09-30' },
    ] },
    procurement_rfqs: { rows: [{ organization_id: 'org-1', id: 'rfq-1', rfq_number: 'COT-260924-98CDA', status: 'OPEN', response_due: '2026-09-27' }] },
    procurement_rfq_suppliers: { rows: [
      { organization_id: 'org-1', id: 'inv-a', rfq_id: 'rfq-1', supplier_id: 'sup-a' },
      { organization_id: 'org-1', id: 'inv-b', rfq_id: 'rfq-1', supplier_id: 'sup-b' },
    ] },
    supplier_quotes: { rows: [
      { organization_id: 'org-1', id: 'q-a', rfq_id: 'rfq-1', supplier_id: 'sup-a', version: 1, status: 'RECEIVED', currency: 'BRL', freight_amount: 1200,
        tax_amount: 0, payment_terms: '28 dias', validity_date: '2026-10-24', lead_time_days: 12, deviations: null, recorded_at: '2026-09-24T12:00:00Z' },
      { organization_id: 'org-1', id: 'q-b', rfq_id: 'rfq-1', supplier_id: 'sup-b', version: 1, status: 'RECEIVED', currency: 'BRL', freight_amount: 900,
        tax_amount: 0, payment_terms: '21 dias', validity_date: '2026-10-24', lead_time_days: 5, deviations: null, recorded_at: '2026-09-24T13:00:00Z' },
    ] },
    supplier_quote_lines: { rows: [
      { organization_id: 'org-1', quote_id: 'q-a', rfq_line_id: 'rfl-1', unit_price: 38.9, quantity: 500, lead_time_days: null, compliant: true },
      { organization_id: 'org-1', quote_id: 'q-b', rfq_line_id: 'rfl-1', unit_price: 41.2, quantity: 500, lead_time_days: null, compliant: true },
    ] },
    sourcing_decisions: { rows: [] },
    supplier_delivery_performance: { rows: [
      { organization_id: 'org-1', supplier_id: 'sup-a', promised_lines: 10, on_time_lines: 9 },
      { organization_id: 'org-1', supplier_id: 'sup-b', promised_lines: 4, on_time_lines: 2 },
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
    supplier_profiles: { rows: [
      { organization_id: 'org-1', id: 'sup-1', party_id: 'party-1', status: 'HOMOLOGATED', categories: ['Equipamentos'], default_lead_time_days: 30,
        contact_name: null, contact_email: null, contact_phone: '+55 91 3000-0000' },
      { organization_id: 'org-1', id: 'sup-a', party_id: 'party-a', status: 'HOMOLOGATED', categories: ['Cabos'], default_lead_time_days: 15,
        contact_name: 'Rita', contact_email: 'vendas@a.example', contact_phone: null },
      { organization_id: 'org-1', id: 'sup-b', party_id: 'party-b', status: 'HOMOLOGATED', categories: ['cabos'], default_lead_time_days: null,
        contact_name: null, contact_email: null, contact_phone: null },
      { organization_id: 'org-1', id: 'sup-x', party_id: 'party-x', status: 'BLOCKED', categories: ['Cabos'], default_lead_time_days: null,
        contact_name: null, contact_email: 'x@x.example', contact_phone: null },
    ] },
    parties: { rows: [
      { organization_id: 'org-1', id: 'party-1', legal_name: 'Cabos Amazônia Ltda', trade_name: null },
      { organization_id: 'org-1', id: 'party-a', legal_name: '[QA] Cabos Norte Ltda', trade_name: 'Cabos Norte' },
      { organization_id: 'org-1', id: 'party-b', legal_name: '[QA] Fios Pará Ltda', trade_name: 'Fios Pará' },
    ] },
    ...over,
  };
}

/** Os perfis de QA que a verificação ao vivo usa (aproximação das chaves, só para os portões). */
const COMPRAS = ['projects.view', 'procurement.view', 'procurement.request', 'procurement.source', 'suppliers.view', 'suppliers.manage',
  'inventory.view', 'inventory.reserve'];
const FINANCEIRO = ['projects.view', 'procurement.view', 'procurement.approve', 'finance.view'];

describe('buildSiteSupply', () => {
  beforeEach(() => {
    mocks.readRfqDispatches.mockResolvedValue(new Map([['inv-a', '2026-09-24T13:00:00Z']]));
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
      apex: { state: 'ok', data: [] }, plan: { state: 'ok', data: { steps: [], remainingShortage: 0 } },
      procurement: { state: 'ok', data: { requisitions: [] } }, suppliers: { state: 'ok', data: [] } });
  });

  it('SE Tucuruí no QA: origem, plano, solicitação + cotação A × B, fornecedores e alçadas (leitura só)', async () => {
    const calls: Call[] = [];
    const d = ok(await buildSiteSupply(session(COMPRAS, tables(), {}, calls), TUC, TODAY));
    // origem da necessidade, por material
    expect(d.focus?.origin).toMatchObject({ source: 'ACTIVITY', label: 'Do cronograma: Lançamento de cabos de potência (início 30/09)', readByAi: false });
    expect(d.materials.find((m) => m.requirementId === REQ_DISJ)?.origin).toMatchObject({ source: 'SERVICE_ORDER', label: 'Da OS OS-QA-2026-0301',
      readByAi: true, serviceOrder: { id: 'os-1', number: 'OS-QA-2026-0301' } });

    // o plano: reserva feita · 400 m a caminho · 250 m do Canteiro LT Marabá (com a ação da alçada) · a solicitação de 500 m
    if (d.plan.state !== 'ok') throw new Error('plano');
    expect(d.plan.data.steps.map((s) => [s.kind, s.status, s.qty])).toEqual([
      ['reserve', 'done', 300], ['transfer', 'done', 400], ['transfer', 'suggested', 250], ['buy', 'done', 500]]);
    expect(d.plan.data.steps[1].reason).toBe('400 m a caminho do canteiro — TRF-0001');
    expect(d.plan.data.steps[2]).toMatchObject({ label: 'Transferir 250 m do Canteiro LT Marabá',
      action: { href: '/api/supply/inventory/transfers', permission: 'inventory.reserve', body: { toLocationId: 'site', expectedArrival: '2026-09-28' } } });
    expect(d.plan.data.steps[2].action?.body).not.toHaveProperty('idempotencyKey');
    expect(d.plan.data.steps[3].reason).toMatch(/^já requisitado \(500 m\) — RC-260924-C451E; se fizer o sugerido acima, a compra precisa só de 250 m/);
    expect(d.plan.data.remainingShortage).toBe(250);

    // compras: a solicitação (sem a cancelada) com a cotação aberta; A (no prazo) recomendada; B mais barata e atrasada
    if (d.procurement.state !== 'ok') throw new Error('compras');
    const [rc] = d.procurement.data.requisitions;
    expect(d.procurement.data.requisitions).toHaveLength(1);
    expect(rc).toMatchObject({ id: 'rq-1', number: 'RC-260924-C451E', status: 'SOURCING', statusLabel: 'Em cotação', qty: 500, unit: 'm',
      requiredBy: '2026-09-30', lineId: 'rql-1', href: '/supply/compras?stage=solicitacoes&rq=rq-1' });
    const [rfq] = rc.rfqs;
    expect(rfq).toMatchObject({ number: 'COT-260924-98CDA', status: 'OPEN', responseDue: '2026-09-27', decision: null });
    expect(rfq.invited).toEqual([
      { supplierId: 'sup-a', name: 'Cabos Norte', hasContact: true, sentAt: '2026-09-24T13:00:00Z' },
      { supplierId: 'sup-b', name: 'Fios Pará', hasContact: false, sentAt: null },
    ]);
    expect(rfq.quotes.map((q) => [q.supplier.name, q.recommended, q.cheapest, q.onTime, q.lateDays])).toEqual([
      ['Fios Pará', true, false, true, 0], ['Cabos Norte', false, true, false, 7]]);
    expect(rfq.quotes[0].supplier.onTimeRate).toBe(0.5);
    expect(rfq.recommendation?.quoteId).toBe('q-b');
    // o livro de envios só foi perguntado sobre os convites JÁ lidos sob a RLS
    expect(mocks.readRfqDispatches).toHaveBeenCalledWith('org-1', ['inv-a', 'inv-b']);

    // fornecedores: categoria "Cabos" (sem caixa) ou histórico com o item; bloqueado nunca
    if (d.suppliers.state !== 'ok') throw new Error('fornecedores');
    expect(d.suppliers.data.map((s) => [s.supplierId, s.basis, s.leadDays])).toEqual([
      ['sup-a', 'both', 12], ['sup-b', 'both', 5], ['sup-1', 'history', 30]]);
    expect(d.suppliers.data[0]).toMatchObject({ name: 'Cabos Norte', contactName: 'Rita', hasEmail: true, hasPhone: false, onTimeRate: 0.9 });
    expect(JSON.stringify(d.suppliers)).not.toContain('@');

    // alçadas desta pessoa (compras)
    expect(d.capabilities).toEqual({ request: true, source: true, approve: false, suppliersManage: true, reserve: true, transfer: true,
      aiSearch: { available: false, reason: 'Busca externa desligada nesta instalação' } });

    for (const c of calls) {
      expect(c.ops.some(([m, a]) => m === 'eq' && a[0] === 'organization_id' && a[1] === 'org-1'), `${c.table} sem inquilino`).toBe(true);
      expect(String(c.ops.find(([m]) => m === 'select')?.[1][0]), `${c.table} com *`).not.toContain('*');
    }
  });

  it('portões: só projetos → plano/compras/fornecedores Restritos (nunca vazios); aprovador sem estoque → plano Restrito', async () => {
    const narrow = ok(await buildSiteSupply(session(['projects.view'], tables()), TUC, TODAY));
    expect(narrow.plan).toEqual({ state: 'restricted' });
    expect(narrow.procurement).toEqual({ state: 'restricted' });
    expect(narrow.suppliers).toEqual({ state: 'restricted' });
    expect(narrow.focus?.origin?.label).toBe('Do cronograma: Lançamento de cabos de potência (início 30/09)');
    expect(narrow.capabilities).toMatchObject({ request: false, source: false, approve: false, reserve: false, transfer: false });

    const fin = ok(await buildSiteSupply(session(FINANCEIRO, tables()), TUC, TODAY));
    expect(fin.plan).toEqual({ state: 'restricted' });
    expect(fin.procurement.state).toBe('ok');
    expect(fin.capabilities).toMatchObject({ approve: true, source: false, request: false });
    // sem a alçada, o passo sugerido não traz ação
    const viewer = ok(await buildSiteSupply(session(ALL, tables()), TUC, TODAY));
    if (viewer.plan.state !== 'ok') throw new Error('plano');
    expect(viewer.plan.data.steps.every((s) => s.action === null)).toBe(true);
  });

  it('transferência pedida no QA (não despachada) entra no plano como PEDIDA (não feita) — nada é sugerido duas vezes; a sobra da solicitação é dita', async () => {
    const t = tables();
    const d = ok(await buildSiteSupply(session(COMPRAS, tables({
      inventory_transfer_lines: { rows: [...(t.inventory_transfer_lines as { rows: object[] }).rows,
        { organization_id: 'org-1', transfer_id: 'tr-2', requirement_id: REQ_CABO, quantity: 250, received_quantity: 0, source_reservation_id: null },
        // a linha que MOVE uma reserva já está em "reservado": não é pendência a mais
        { organization_id: 'org-1', transfer_id: 'tr-3', requirement_id: REQ_CABO, quantity: 100, received_quantity: 0, source_reservation_id: 'res-1' }] },
      inventory_transfers: { rows: [...(t.inventory_transfers as { rows: object[] }).rows,
        { organization_id: 'org-1', id: 'tr-2', transfer_number: 'TR-260925-94AD3', status: 'REQUESTED', project_id: TUC, from_location_id: 'mar',
          to_location_id: 'site', dispatched_at: null, received_at: null },
        { organization_id: 'org-1', id: 'tr-3', transfer_number: 'TR-RES', status: 'APPROVED', project_id: TUC, from_location_id: 'bel',
          to_location_id: 'site', dispatched_at: null, received_at: null }] },
    })), TUC, TODAY));
    if (d.plan.state !== 'ok') throw new Error('plano');
    expect(d.plan.data.steps.map((s) => [s.kind, s.status, s.qty])).toEqual([
      ['reserve', 'done', 300], ['transfer', 'done', 400], ['transfer', PENDING_TRANSFER_STEP_STATUS, 250], ['buy', 'blocked', 500]]);
    expect(JSON.stringify(d.plan.data)).not.toContain('TR-RES');
    expect(d.plan.data.steps.every((s) => s.action === null)).toBe(true);
    expect(d.plan.data.remainingShortage).toBe(250);
  });

  it('pedido em aprovação: a chave de Decisões vem da caixa DESTA pessoa', async () => {
    mocks.viewerInbox.mockResolvedValue([inboxRow({ decision_key: 'purchase_order:po-9:s1', subject_id: 'po-9', project_id: TUC })]);
    const t = tables({
      procurement_rfqs: { rows: [{ organization_id: 'org-1', id: 'rfq-1', rfq_number: 'COT-260924-98CDA', status: 'DECIDED', response_due: null }] },
      sourcing_decisions: { rows: [{ organization_id: 'org-1', id: 'dec-1', rfq_id: 'rfq-1', quote_id: 'q-b', follows_recommendation: true,
        decided_at: '2026-09-25T10:00:00Z' }] },
      purchase_orders: { rows: [
        { organization_id: 'org-1', id: 'po-1', order_number: 'OC-1', supplier_id: 'sup-1', project_id: TUC, status: 'APPROVAL_REQUIRED',
          currency: 'BRL', freight_amount: 0, tax_amount: 0, expected_delivery: null, sourcing_decision_id: null },
        { organization_id: 'org-1', id: 'po-9', order_number: 'OC-0009', supplier_id: 'sup-b', project_id: TUC, status: 'APPROVAL_REQUIRED',
          currency: 'BRL', freight_amount: 900, tax_amount: 0, expected_delivery: null, sourcing_decision_id: 'dec-1' },
      ] },
    });
    const d = ok(await buildSiteSupply(session(FINANCEIRO, t), TUC, TODAY));
    if (d.procurement.state !== 'ok') throw new Error('compras');
    expect(d.procurement.data.requisitions[0].rfqs[0].decision).toEqual({ quoteId: 'q-b', followsRecommendation: true, poId: 'po-9',
      poNumber: 'OC-0009', poStatus: 'APPROVAL_REQUIRED', poStatusLabel: 'Em aprovação', decisionKey: 'purchase_order:po-9:s1' });
  });

  it('falhas nunca calmas: cotação que cai → compras `error`; livro de envios que cai → compras `error` (nunca "Não enviada" + reenviar); OS que cai → origem null', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.readRfqDispatches.mockRejectedValue(new Error('service down'));
    let d = ok(await buildSiteSupply(session(COMPRAS, tables({ supplier_quotes: { error: 'boom' } })), TUC, TODAY));
    expect(d.procurement).toEqual({ state: 'error', message: 'Não foi possível ler as solicitações e cotações.' });
    // o histórico de propostas do item também vem de `supplier_quotes`: a lista de candidatos não sai pela metade
    expect(d.suppliers).toEqual({ state: 'error', message: 'Não foi possível ler os fornecedores do item.' });
    // o contrato não tem "envio desconhecido" por convite: sem o livro, a parte inteira diz que não carregou
    d = ok(await buildSiteSupply(session(COMPRAS, tables()), TUC, TODAY));
    expect(d.procurement).toEqual({ state: 'error', message: 'Não foi possível ler as solicitações e cotações.' });
    // cotação sem convidado não depende do livro (nem do service role)
    mocks.readRfqDispatches.mockClear();
    d = ok(await buildSiteSupply(session(COMPRAS, tables({ procurement_rfq_suppliers: { rows: [] } })), TUC, TODAY));
    expect(d.procurement.state).toBe('ok');
    expect(mocks.readRfqDispatches).not.toHaveBeenCalled();
    d = ok(await buildSiteSupply(session(COMPRAS, tables({ internal_service_orders: { error: 'boom' } })), TUC, TODAY));
    expect(d.materials.find((m) => m.requirementId === REQ_DISJ)?.origin).toBeNull();
    expect(d.focus?.origin?.source).toBe('ACTIVITY');
    d = ok(await buildSiteSupply(session(COMPRAS, tables({ inventory_transfers: { error: 'boom' } })), TUC, TODAY));
    expect(d.plan).toEqual({ state: 'error', message: 'Não foi possível montar o plano: o estoque do item não carregou.' });
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
