/**
 * Read model do Dashboard V2 (src/lib/dashboard/overview.ts) e a rota
 * GET /api/dashboard/overview — com as leituras compostas e o cliente
 * Supabase simulados (hermético):
 *  1. perfil sem nenhuma permissão → payload inteiro, seções e etapas
 *     `restricted`, nenhum número;
 *  2. RPC financeiro falso → nenhum valor em dinheiro (nem lido);
 *  3. uma seção que cai → só ela vira `error`;
 *  4. DECISION_PENDING de pedido sai SÓ quando o pedido está na caixa;
 *  5. src/lib/dashboard/* não importa o service role.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  operationsOverview: vi.fn(),
  listSupplySignals: vi.fn(),
  supplyFlow: vi.fn(),
  viewerInbox: vi.fn(),
  enrichInbox: vi.fn(),
  decisionSetup: vi.fn(),
}));

vi.mock('@/lib/platform/server-client', () => ({
  platformServiceClient: () => { throw new Error('service role não é usado pelo Dashboard'); },
}));
vi.mock('@/lib/commercial/server-session', () => ({
  hasOptionalPermission: async (session: { permissions: Set<string> }, key: string) => session.permissions.has(key),
  requireCommercialSession: vi.fn(),
  isSessionError: (r: object) => 'error' in r,
}));
vi.mock('@/lib/operations/overview', () => ({ operationsOverview: mocks.operationsOverview }));
vi.mock('@/lib/supply/intelligence-read', () => ({ listSupplySignals: mocks.listSupplySignals }));
vi.mock('@/lib/supply/read-model', () => ({ supplyFlow: mocks.supplyFlow }));
vi.mock('@/lib/decisions/read', () => ({
  viewerInbox: mocks.viewerInbox, enrichInbox: mocks.enrichInbox, decisionSetup: mocks.decisionSetup,
}));

import { buildDashboardOverview } from '@/lib/dashboard/overview';
import { SCHEDULE_PARTIAL_REASON } from '@/lib/dashboard/rules';
import type { DashboardOverview } from '@/lib/dashboard/types';

const TODAY = '2026-09-25';
const UG05 = 'Enel Cachoeira Dourada UG-05';

/* ── Cliente Supabase simulado ──────────────────────────────────────────── */

type Spec = { rows?: Record<string, unknown>[]; count?: number; error?: string };
type Call = { table: string; ops: Array<[string, unknown[]]> };

function fakeClient(tables: Record<string, Spec | ((call: Call) => Spec)>, rpcs: Record<string, unknown>, calls: Call[] = []) {
  return {
    rpc: async (name: string) => ({ data: rpcs[name] ?? null, error: null }),
    from: (table: string) => {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'neq', 'gt', 'gte', 'lte', 'in', 'is', 'not', 'or', 'order', 'limit', 'range']) {
        chain[m] = (...args: unknown[]) => { call.ops.push([m, args]); return chain; };
      }
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        try {
          const raw = tables[table];
          const spec = (typeof raw === 'function' ? raw(call) : raw) ?? {};
          if (spec.error) return resolve({ data: null, error: { message: spec.error }, count: null });
          const sel = call.ops.find(([m]) => m === 'select');
          const opts = (sel?.[1][1] ?? {}) as { head?: boolean; count?: string };
          let rows = spec.rows ?? [];
          // Filtros simples aplicados só às colunas que a linha tem (organization_id etc. passam).
          const col = (r: Record<string, unknown>, c: unknown) => typeof c === 'string' && c in r;
          for (const [m, a] of call.ops) {
            if (m === 'in') rows = rows.filter((r) => !col(r, a[0]) || (a[1] as unknown[]).includes(r[a[0] as string]));
            if (m === 'eq' || m === 'is') rows = rows.filter((r) => !col(r, a[0]) || r[a[0] as string] === a[1]);
          }
          const range = call.ops.find(([m]) => m === 'range');
          if (range) rows = rows.slice(range[1][0] as number, (range[1][1] as number) + 1);
          if (opts.head) return resolve({ data: null, error: null, count: spec.count ?? rows.length });
          return resolve({ data: rows, error: null, count: opts.count ? spec.count ?? rows.length : null });
        } catch (e) { return reject(e); }
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

/* ── Fixtures ───────────────────────────────────────────────────────────── */

const zeroCounts = { total: 0, danger: 0, warning: 0 };
function opsModel(over: Record<string, unknown> = {}) {
  return {
    today: TODAY,
    kpis: { activeProjects: 3, serviceOrdersAwaitingIssue: 2, serviceOrdersBlocked: 1, criticalActivities: 4, projectsAtRisk: 1,
      measurementPending: 1, materialUncovered: 1 },
    measurementLanes: { PREPARE_EVIDENCE: 1, INTERNAL_REVIEW: 1, CORRECTION: 0, SEND_TO_CUSTOMER: 0, AWAITING_CUSTOMER: 2, BILLING_ELIGIBLE: 0, CLOSED: 0 },
    attention: [{ id: 'os:o1', kind: 'service_order', object: 'OS-0042', issue: 'Decidir 1 divergência bloqueante', impact: 'Enel · Retrofit',
      due: '2026-10-01', owner: 'Carla', tone: 'danger', href: '/operacoes/ordens-servico/o1', actionLabel: 'Abrir OS', projectId: 'p-ug05', refId: 'o1' }],
    horizon: { 7: [{ id: 'm1', title: 'Comissionamento', project: UG05, projectId: 'p-ug05', date: '2026-10-01', milestone: true, critical: false }], 14: [], 30: [] },
    projectHealth: [{ projectId: 'p-ug05', project: UG05, client: 'Enel', tone: 'danger', reasons: ['Atividade bloqueada'], nextMilestone: '2026-10-01',
      level: 'critical', nextMilestoneId: 'm1', nextMilestoneTitle: 'Comissionamento' }],
    osFlow: { draft: 1, review: 1, issued: 0, linked: 5, blocked: 1 },
    serviceOrdersAccess: true,
    attentionCounts: { service_order: { total: 1, danger: 1, warning: 0 }, activity: { total: 2, danger: 1, warning: 1 }, measurement: zeroCounts,
      risk: zeroCounts, material: zeroCounts, dependency: zeroCounts },
    overdueByProject: [{ projectId: 'p-ug05', project: UG05, client: 'Enel', count: 2, blocked: 1, critical: 0, oldestDue: '2026-09-10', ownerNames: ['Ana'] }],
    overdueActivities: 2,
    inProgressActivities: 7,
    healthCounts: { critical: 1, attention: 1, healthy: 1, unknown: 0 },
    projectsWithoutOpenActivity: 1,
    serviceOrdersTruncated: false,
    truncated: { activities: false, measurements: false, risks: false, coverage: false },
    ...over,
  };
}

const flow = { openPoValue: 999, lateInbound: 2, receivingIssues: 1, decisionsPending: 3, requisitionsAwaitingSourcing: 1 };

const sig = (over: Record<string, unknown>) => ({
  id: 's1', kind: 'SHORTAGE', severity: 'critical', status: 'OPEN', projectId: 'p-ug05', project: UG05, requirementId: 'req-1',
  purchaseOrderId: null, supplierId: null, title: 'Comprar 120 m de CB-35', rationale: 'sem cobertura', evidence: [],
  action: { kind: 'OPEN', label: 'Abrir', payload: {} }, firstSeenAt: '2026-09-01', lastSeenAt: '2026-09-24T10:00:00Z',
  resolvedAt: null, decidedBy: null, decidedAt: null, decisionNote: null, followupId: null, engineVersion: 'supply-signals.v1', ...over,
});

const ALL = ['projects.view', 'projects.measurements.view', 'risks.view', 'operations.view', 'supply.view', 'contracts.view',
  'contracts.view_values', 'finance.view', 'commercial.view'];

const billingRow = (id: string, over: Record<string, unknown> = {}) => ({
  billing_event_id: id, contract_id: 'c1', title: `Medição ${id}`, currency: 'BRL', release_state: 'ELIGIBLE', eligibility_state: 'ELIGIBLE',
  fiscal_document_id: null, superseded_by_id: null, legacy_row: false, cancelled_at: null, eligible_amount: 125000,
  due_date: '2026-09-01', receivable_status: 'OVERDUE', open_amount_cents: 12500000, ...over,
});

function fullTables(): Parameters<typeof fakeClient>[0] {
  return {
    supply_requirement_coverage: { rows: [{ requirement_id: 'req-1', project_id: 'p-ug05', activity_id: 'a1', item_id: 'i1', requirement_type: 'MATERIAL',
      required_by: '2026-10-05', unit: 'm', required_qty: 120, reserved_qty: 0, consumed_qty: 0, in_transit_qty: 0, on_order_qty: 0,
      requested_qty: 50, inspection_qty: 0 }] },
    project_timeline_items: { rows: [{ id: 'a1', title: 'Montagem do estator', planned_start: '2026-09-30' }] },
    project_requirements: { rows: [{ id: 'req-1', title: 'Cabo 35 mm' }] },
    projects: { rows: [{ id: 'p-ug05', project: { nome: UG05 }, project_v2: null }] },
    contract_to_cash_read_model: { rows: [billingRow('e1'), billingRow('e2', { release_state: 'RELEASED' })] },
    contracts: { rows: [{ id: 'c1', contract_number: 'CT-0042', title: 'Retrofit UG-05' }] },
    commercial_opportunities: { count: 20 },
    commercial_engagements: { rows: [{ id: 'g1' }, { id: 'g2' }] },
    internal_service_orders: { rows: [{ engagement_id: 'g1' }] },
    inbound_shipments: { rows: [] },
    project_measurements: { rows: [] },
  };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.operationsOverview.mockResolvedValue(opsModel());
  mocks.supplyFlow.mockResolvedValue(flow);
  mocks.listSupplySignals.mockResolvedValue({ lastRun: { ranAt: '2026-09-25T06:00:00Z', engineVersion: 'supply-signals.v1' }, openCount: 1, signals: [sig({})] });
  mocks.viewerInbox.mockResolvedValue([]);
  mocks.enrichInbox.mockResolvedValue([]);
  mocks.decisionSetup.mockResolvedValue({ policies: 0, authorities: 0 });
});
afterEach(() => { vi.clearAllMocks(); });

const stage = (o: DashboardOverview, id: string) => o.stages.find((s) => s.id === id)!;

describe('buildDashboardOverview', () => {
  it('1. perfil sem permissão: 200-shaped, tudo restrito, nenhum número', async () => {
    const o = await buildDashboardOverview(session([]), TODAY);
    expect(o.ok).toBe(true);
    expect(o.today).toBe(TODAY);
    expect(o.feed).toEqual({ state: 'restricted' });
    expect(o.projects).toEqual({ state: 'restricted' });
    expect(o.calendar).toEqual({ state: 'restricted' });
    expect(o.apex).toBeNull();
    expect(o.readable).toEqual([]);
    expect(o.notReadable).toEqual(['Comercial', 'Operação', 'Supply', 'Medição', 'Faturamento', 'Recebíveis']);
    // Nada lido → não se sabe se há operação (nunca "Ainda não há operação").
    expect(o.hasOperation).toBeNull();
    expect(o.stages).toHaveLength(11);
    for (const s of o.stages) {
      expect(s.stuck).toBeNull();
      expect(s.context).toBeNull();
      expect(s.state).toBe(s.id === 'caixa' ? 'unavailable' : 'restricted');
    }
    // Decisões é da pessoa: responde, com o contexto do vazio.
    expect(o.decisions).toEqual({ state: 'ok', data: { count: 0, overdue: 0, escalated: 0, alsoEligible: 0, top: [], setup: { policies: 0, authorities: 0 } } });
    expect(mocks.operationsOverview).not.toHaveBeenCalled();
    expect(mocks.listSupplySignals).not.toHaveBeenCalled();
    expect(mocks.supplyFlow).not.toHaveBeenCalled();
  });

  it('2. RPC financeiro falso: nenhum valor em dinheiro — nem lido', async () => {
    const calls: Call[] = [];
    const o = await buildDashboardOverview(session(ALL, fullTables(), { current_user_can_view_project_financials: false }, calls), TODAY);
    const json = JSON.stringify(o);
    expect(json).not.toMatch(/R\$/);
    expect(stage(o, 'faturamento').context).toBe('1 NF a emitir');
    const selected = calls.filter((c) => c.table === 'contract_to_cash_read_model')
      .map((c) => String(c.ops.find(([m]) => m === 'select')?.[1][0])).join(' ');
    expect(selected).not.toMatch(/eligible_amount|open_amount_cents|\*/);
    // sanidade: com o RPC verdadeiro o valor aparece
    const shown = await buildDashboardOverview(session(ALL, fullTables(), { current_user_can_view_project_financials: true }), TODAY);
    expect(stage(shown, 'faturamento').context).toMatch(/1 NF a emitir · R\$\s125\.000,00/);
    expect(JSON.stringify(shown.feed)).toMatch(/R\$/);
  });

  it('3. uma seção que cai vira `error`; as outras seguem', async () => {
    mocks.supplyFlow.mockRejectedValue(new Error('boom'));
    const o = await buildDashboardOverview(session(ALL, fullTables()), TODAY);
    expect(stage(o, 'supply').state).toBe('error');
    expect(stage(o, 'supply').stuck).toBeNull();
    for (const id of ['comercial', 'os', 'projeto', 'planejamento', 'necessidades', 'execucao', 'medicao', 'faturamento', 'recebivel']) {
      expect(stage(o, id).state).toBe('ok');
    }
    expect(o.feed.state).toBe('ok');
    expect(o.projects.state).toBe('ok');
    expect(o.decisions.state).toBe('ok');

    // Operações cai: só o que vem dela vira erro.
    mocks.supplyFlow.mockResolvedValue(flow);
    mocks.operationsOverview.mockRejectedValue(new Error('boom'));
    const o2 = await buildDashboardOverview(session(ALL, fullTables()), TODAY);
    for (const id of ['os', 'projeto', 'planejamento', 'execucao', 'medicao']) expect(stage(o2, id).state).toBe('error');
    expect(stage(o2, 'supply').state).toBe('ok');
    expect(stage(o2, 'necessidades').state).toBe('ok');
    expect(o2.projects.state).toBe('error');
    expect(o2.feed.state).toBe('ok');
    if (o2.feed.state === 'ok') {
      expect(o2.feed.truncated).toBe(true);
      // a fila diz O QUE não carregou — nunca "0 exceções" calado
      expect(o2.feed.data.failed).toEqual([{ domain: 'operacao', label: 'Operação' }, { domain: 'medicao', label: 'Medição' }]);
      expect(o2.feed.data.partial).toBe(false);
    }
    // a raia de Operação fica na lista como `unavailable`
    if (o2.calendar.state === 'ok') expect(o2.calendar.data.lanes.find((l) => l.id === 'operacao')!.state).toBe('unavailable');
    // Operações falhou: projetos e OS não foram lidos → não se sabe (as outras leituras mostram operação aqui, então true)
    expect(o2.hasOperation).toBe(true);

    // Decisões cai (ex.: NOT_PROVISIONED) → `error`, nunca 0.
    mocks.operationsOverview.mockResolvedValue(opsModel());
    mocks.viewerInbox.mockRejectedValue(new Error('NOT_PROVISIONED'));
    const o3 = await buildDashboardOverview(session(ALL, fullTables()), TODAY);
    expect(o3.decisions.state).toBe('error');
    expect(o3.feed.state).toBe('ok');
  });

  it('números e linhas do payload completo', async () => {
    const o = await buildDashboardOverview(session(ALL, fullTables(), { current_user_can_view_project_financials: false }), TODAY);
    expect(stage(o, 'comercial').stuck).toEqual({ value: 1, noun: 'autorizada sem OS' });
    expect(stage(o, 'comercial').context).toBe('20 oportunidades abertas');
    expect(stage(o, 'os').stuck).toEqual({ value: 2, noun: 'a emitir' });
    expect(stage(o, 'necessidades').stuck).toEqual({ value: 1, noun: 'sem cobertura' });
    expect(stage(o, 'necessidades').context).toBe('1 crítica (≤ 7 dias)');
    expect(stage(o, 'supply').stuck).toEqual({ value: 2, noun: 'entregas atrasadas' });
    expect(stage(o, 'recebivel').stuck?.noun).toBe('vencidos');
    expect(o.feed.state).toBe('ok');
    if (o.feed.state !== 'ok') return;
    const keys = o.feed.data.rows.map((r) => r.key);
    // material + sinal do mesmo requisito → UMA linha, com a Apex como evidência e o texto ao vivo
    const mat = o.feed.data.rows.find((r) => r.key === 'req:req-1')!;
    expect(keys.filter((k) => k === 'req:req-1')).toHaveLength(1);
    expect(mat.apex?.signalId).toBe('s1');
    expect(mat.problem).toBe('Falta 120 m — requisitado, sem pedido emitido');
    expect(mat.consequence).toBe('Atividade Montagem do estator começa em 30/09');
    expect(mat.location.label).toBe(UG05);
    expect(keys).toContain('proj-act:p-ug05');
    expect(keys).toContain('os:o1');
    expect(o.feed.data.rows.find((r) => r.key === 'os:o1')!.nextAction.label).toBe('Resolver bloqueios na OS');
    expect(o.feed.data.rows.find((r) => r.key === 'os:o1')!.location.label).toBe(UG05);
    expect(JSON.stringify(o.feed)).not.toMatch(/Decidir/);
    expect(o.projects.state === 'ok' && o.projects.data.rows[0].topIssue?.severity).toBe('critical');
    expect(o.apex).toEqual({ lastRun: { ranAt: '2026-09-25T06:00:00Z', engineVersion: 'supply-signals.v1' } });
    expect(o.hasOperation).toBe(true);
    expect(o.readable).toEqual(['comercial', 'operacao', 'supply', 'medicao', 'faturamento', 'recebivel']);
    expect(o.calendar.state).toBe('ok');
    if (o.calendar.state === 'ok') {
      expect(o.calendar.data.items.map((i) => i.id)).toEqual(expect.arrayContaining(['act:m1', 'need:req-1']));
    }
    expect(o.feed.data.failed).toEqual([]);
    expect(o.feed.data.partial).toBe(false);
    // a leitura de sinais é a estreita (abertos, críticos/altos), inteira até o teto do PostgREST
    expect(mocks.listSupplySignals).toHaveBeenCalledWith(expect.anything(), { openOnly: true, severities: ['critical', 'high'], limit: 1000 });
    expect(mocks.operationsOverview).toHaveBeenCalledWith(expect.anything(),
      { projects: true, measurements: true, risks: true, serviceOrders: true }, TODAY);
  });

  it('4. DECISION_PENDING de pedido sai SÓ quando o pedido está na caixa', async () => {
    const po = sig({ id: 'd1', kind: 'DECISION_PENDING', severity: 'high', requirementId: null, purchaseOrderId: 'po-7',
      title: 'Pedido OC-0007 aguarda aprovação há 9 dia(s)' });
    mocks.listSupplySignals.mockResolvedValue({ lastRun: null, openCount: 1, signals: [po] });
    const perms = ['supply.view'];

    const kept = await buildDashboardOverview(session(perms, fullTables()), TODAY);
    expect(kept.feed.state).toBe('ok');
    if (kept.feed.state === 'ok') {
      const r = kept.feed.data.rows.find((x) => x.key === 'po:po-7')!;
      expect(r.problem).toBe('Aprovação de compra parada');
      expect(r.kindLabel).toBe('Compra');
    }
    // nunca contado como decisão
    expect(kept.decisions.state === 'ok' && kept.decisions.data.count).toBe(0);

    const inboxRow = { decision_key: 'purchase_order:po-7:s1', subject_type: 'purchase_order', subject_id: 'po-7', assignment: 'PRIMARY' };
    mocks.viewerInbox.mockResolvedValue([inboxRow]);
    mocks.enrichInbox.mockResolvedValue([{ key: 'purchase_order:po-7:s1', assignment: 'PRIMARY', kindLabel: 'Compra', title: 'Pedido OC-0007',
      amount: null, currency: 'BRL', projectName: UG05, overdue: false, dueAt: null, decideBy: '2026-09-30', requestedAt: '2026-09-16',
      priority: { code: 'DEADLINE', label: 'Decidir em 5 dias', tone: 'warning' } }]);
    const dropped = await buildDashboardOverview(session(perms, fullTables()), TODAY);
    if (dropped.feed.state === 'ok') expect(dropped.feed.data.rows.some((x) => x.key === 'po:po-7')).toBe(false);
    expect(dropped.decisions.state).toBe('ok');
    if (dropped.decisions.state === 'ok') {
      expect(dropped.decisions.data.count).toBe(1);
      expect(dropped.decisions.data.setup).toBeNull();
      expect(dropped.decisions.data.top[0]).toMatchObject({ href: '/decisoes?d=purchase_order%3Apo-7%3As1', due: '2026-09-30',
        priority: { label: 'Decidir em 5 dias', tone: 'warning' }, amountText: null, amountRestricted: false });
    }
  });

  it('portões espelham a RLS: OS sem operations.view é Restrito; recebíveis pelo predicado financeiro', async () => {
    const o = await buildDashboardOverview(session(['projects.view', 'contracts.view', 'contracts.view_values'], fullTables(),
      { has_finance_role_or_perm: false }), TODAY);
    expect(mocks.operationsOverview).toHaveBeenCalledWith(expect.anything(),
      { projects: true, measurements: true, risks: false, serviceOrders: false }, TODAY);
    expect(stage(o, 'os').state).toBe('restricted');
    expect(stage(o, 'projeto').state).toBe('ok');
    expect(stage(o, 'faturamento').state).toBe('ok');
    expect(stage(o, 'recebivel').state).toBe('restricted');
    expect(o.notReadable).toContain('Recebíveis');
    const withAnalyst = await buildDashboardOverview(session(['contracts.view', 'contracts.view_values'], fullTables(),
      { has_finance_role_or_perm: true }), TODAY);
    expect(stage(withAnalyst, 'recebivel').state).toBe('ok');
  });

  it('RLS efetiva da view: finance.view sem contracts.view (ou só finance_analyst) é Restrito — nunca "0 vencidos"', async () => {
    const calls: Call[] = [];
    const finOnly = await buildDashboardOverview(session(['finance.view'], fullTables(), { has_finance_role_or_perm: true }, calls), TODAY);
    for (const id of ['faturamento', 'recebivel']) {
      expect(stage(finOnly, id).state).toBe('restricted');
      expect(stage(finOnly, id).stuck).toBeNull();
    }
    expect(finOnly.notReadable).toEqual(expect.arrayContaining(['Faturamento', 'Recebíveis']));
    // nem lido: o portão fecha antes da leitura
    expect(calls.some((c) => c.table === 'contract_to_cash_read_model')).toBe(false);
    const analystOnly = await buildDashboardOverview(session([], fullTables(), { has_finance_role_or_perm: true }), TODAY);
    expect(stage(analystOnly, 'recebivel').state).toBe('restricted');
    // `contracts.edit`: a política FOR ALL também lê → faturamento legível
    const editor = await buildDashboardOverview(session(['contracts.edit'], fullTables()), TODAY);
    expect(stage(editor, 'faturamento').state).toBe('ok');
    expect(stage(editor, 'recebivel').state).toBe('restricted');
  });

  it('#7 total SEM corte: todos os sinais abertos críticos/altos entram (não só 60)', async () => {
    const many = Array.from({ length: 213 }, (_, i) => sig({ id: `d${String(i).padStart(3, '0')}`, kind: 'DECISION_PENDING', severity: 'critical',
      requirementId: null, purchaseOrderId: `po-${i}`, title: `Pedido OC-${i} aguarda aprovação` }));
    mocks.listSupplySignals.mockResolvedValue({ lastRun: null, openCount: 213, signals: many });
    const o = await buildDashboardOverview(session(['supply.view'], fullTables()), TODAY);
    expect(o.feed.state).toBe('ok');
    if (o.feed.state !== 'ok') return;
    expect(o.feed.data.total).toBe(213);
    expect(o.feed.data.critical).toBe(213);
    expect(o.feed.data.byDomain.supply).toEqual({ total: 213, critical: 213 });
    expect(o.feed.data.rows).toHaveLength(40);
    expect(o.feed.data.partial).toBe(false);
    // Passou do teto da leitura: o total vira piso (`partial`), nunca some calado.
    mocks.listSupplySignals.mockResolvedValue({ lastRun: null, openCount: 1500, signals: many });
    const capped = await buildDashboardOverview(session(['supply.view'], fullTables()), TODAY);
    if (capped.feed.state === 'ok') expect(capped.feed.data.partial).toBe(true);
  });

  it('#0 fonte da fila que falha: `failed` diz qual; restante segue', async () => {
    mocks.listSupplySignals.mockRejectedValue(new Error('timeout'));
    const o = await buildDashboardOverview(session(ALL, fullTables()), TODAY);
    expect(o.feed.state).toBe('ok');
    if (o.feed.state === 'ok') expect(o.feed.data.failed).toEqual([{ domain: 'supply', label: 'Achados da Apex' }]);
    expect(o.apex).toBeNull();
    // todas as fontes legíveis falharam → `error`
    const onlySignals = await buildDashboardOverview(session(['supply.view'], fullTables()), TODAY);
    expect(onlySignals.feed.state).toBe('error');
  });

  it('#8 hasOperation: false só com todas as leituras de operação vazias; null quando alguma é restrita ou falha', async () => {
    const emptyOps = opsModel({ kpis: { ...opsModel().kpis, activeProjects: 0 }, osFlow: { draft: 0, review: 0, issued: 0, linked: 0, blocked: 0 } });
    const tables = { ...fullTables(), commercial_opportunities: { count: 0 }, commercial_engagements: { rows: [] } };
    mocks.operationsOverview.mockResolvedValue(emptyOps);
    expect((await buildDashboardOverview(session(ALL, tables), TODAY)).hasOperation).toBe(false);
    // ponto_field_worker / rh: sem ler OS nem comercial → não se afirma "não há operação"
    expect((await buildDashboardOverview(session(['projects.view'], tables), TODAY)).hasOperation).toBeNull();
    // Operações cai e o resto é vazio → não se sabe
    mocks.operationsOverview.mockRejectedValue(new Error('timeout'));
    expect((await buildDashboardOverview(session(ALL, tables), TODAY)).hasOperation).toBeNull();
  });

  it('#12/#13 leitura cortada do cronograma: etapas com piso; "sem cronograma" sem número; raia Operação parcial', async () => {
    const o = await buildDashboardOverview(session(ALL, fullTables()), TODAY);
    // #13: Planejamento = projetos ativos sem atividade aberta (1), não `health.unknown` (0)
    expect(stage(o, 'planejamento').stuck).toEqual({ value: 1, noun: 'sem atividade aberta' });
    expect(stage(o, 'execucao').partial).toBe(false);

    mocks.operationsOverview.mockResolvedValue(opsModel({ truncated: { activities: true, measurements: false, risks: false, coverage: false } }));
    const cut = await buildDashboardOverview(session(ALL, fullTables()), TODAY);
    expect(stage(cut, 'execucao').partial).toBe(true);
    expect(stage(cut, 'execucao').stuck).toEqual({ value: 2, noun: 'atividades vencidas' });
    expect(stage(cut, 'projeto').partial).toBe(true);
    expect(stage(cut, 'planejamento').state).toBe('ok');
    expect(stage(cut, 'planejamento').stuck).toBeNull();
    expect(stage(cut, 'planejamento').reason).toBe(SCHEDULE_PARTIAL_REASON);
    expect(stage(cut, 'medicao').partial).toBe(false);
    if (cut.feed.state === 'ok') expect(cut.feed.data.partial).toBe(true);
    if (cut.calendar.state === 'ok') expect(cut.calendar.data.lanes.find((l) => l.id === 'operacao')).toMatchObject({ state: 'ok', partial: true });

    // lista de OS no teto → OS é piso
    mocks.operationsOverview.mockResolvedValue(opsModel({ serviceOrdersTruncated: true }));
    const osCut = await buildDashboardOverview(session(ALL, fullTables()), TODAY);
    expect(stage(osCut, 'os').partial).toBe(true);
  });

  it('#2 raia de Supply: uma das duas leituras falhou → `partial`; nunca some', async () => {
    const tables = { ...fullTables(), inbound_shipments: { error: 'timeout' } };
    const o = await buildDashboardOverview(session(ALL, tables), TODAY);
    expect(o.calendar.state).toBe('ok');
    if (o.calendar.state === 'ok') {
      expect(o.calendar.data.lanes.find((l) => l.id === 'supply')).toEqual({ id: 'supply', label: 'Supply', state: 'ok', partial: true });
      expect(o.calendar.data.items.some((i) => i.id === 'need:req-1')).toBe(true);
    }
  });

  it('#1 Comercial: autorizadas que falham → etapa ok sem número, com o motivo', async () => {
    const tables = { ...fullTables(), commercial_engagements: { error: 'timeout' } };
    const o = await buildDashboardOverview(session(ALL, tables), TODAY);
    expect(stage(o, 'comercial').state).toBe('ok');
    expect(stage(o, 'comercial').stuck).toBeNull();
    expect(stage(o, 'comercial').reason).toBe('Autorizadas sem OS: não carregou');
    expect(stage(o, 'comercial').context).toBe('20 oportunidades abertas');
  });
});

describe('fronteira do service role', () => {
  it('5. src/lib/dashboard/* não importa platformServiceClient', () => {
    const dir = join(process.cwd(), 'src/lib/dashboard');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const text = readFileSync(join(dir, f), 'utf8');
      expect(text, f).not.toMatch(/platformServiceClient|platform\/server-client/);
    }
  });
});

describe('GET /api/dashboard/overview', () => {
  afterEach(() => { vi.doUnmock('@/lib/dashboard/overview'); vi.doUnmock('@/lib/operations/projects/access'); vi.resetModules(); });

  async function loadRoute(build: (...a: unknown[]) => Promise<unknown>, sessionResult: unknown) {
    vi.resetModules();
    vi.doMock('@/lib/dashboard/overview', () => ({ buildDashboardOverview: build }));
    vi.doMock('@/lib/operations/projects/access', () => ({ todayInSaoPaulo: () => TODAY }));
    const ss = await import('@/lib/commercial/server-session');
    (ss.requireCommercialSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(sessionResult);
    return import('@/app/api/dashboard/overview/route');
  }

  it('200 com no-store e Server-Timing; 500 só quando a montagem inteira falha', async () => {
    const route = await loadRoute(async (_s: unknown, today: unknown, timings: unknown) => {
      (timings as Record<string, number>).ops = 12;
      return { ok: true, today };
    }, session([]));
    expect(route.dynamic).toBe('force-dynamic');
    expect(route.runtime).toBe('nodejs');
    const res = await route.GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Server-Timing')).toMatch(/ops;dur=12, total;dur=\d+/);
    expect(await res.json()).toEqual({ ok: true, today: TODAY });

    const failing = await loadRoute(async () => { throw new Error('x'); }, session([]));
    const bad = await failing.GET();
    expect(bad.status).toBe(500);
    expect(bad.headers.get('Cache-Control')).toBe('no-store');
  });

  it('401/403 vêm da sessão', async () => {
    const { NextResponse } = await import('next/server');
    const route = await loadRoute(async () => ({ ok: true }), { error: NextResponse.json({ ok: false }, { status: 401 }) });
    expect((await route.GET()).status).toBe(401);
  });
});
