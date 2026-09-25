/**
 * Local em foco — `buildSiteHud` (src/lib/dashboard/site.ts), a porta comum
 * (src/lib/dashboard/site-common.ts) e a rota GET /api/dashboard/site/[projectId],
 * com o cliente Supabase e as leituras compostas simulados (hermético):
 *  1. a porta: id inválido sem leitura nenhuma; sem projetos → Restrito; outro
 *     inquilino → não encontrado; falha → `error` 200; montagem que cai → 500;
 *  2. a MESMA derivação do Dashboard: saúde e linhas da fila idênticas às da
 *     Visão Geral de Operações real rodando sobre os mesmos fatos;
 *  3. recorte do local: faturamento só de contrato só deste projeto; decisões
 *     do projeto ou de evento de contrato vinculado;
 *  4. Restrito nunca é 0; leitura que falhou nunca parece calma;
 *  5. dinheiro só com o RPC financeiro; `financial_exposure` nunca lido;
 *  6. toda leitura com `organization_id`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listSupplySignals: vi.fn(),
  viewerInbox: vi.fn(),
  enrichInbox: vi.fn(),
  decisionSetup: vi.fn(),
  countsFor: vi.fn(),
  listServiceOrders: vi.fn(),
  resolveOwnerNames: vi.fn(),
  requireCommercialSession: vi.fn(),
}));

vi.mock('@/lib/platform/server-client', () => ({
  platformServiceClient: () => { throw new Error('service role não é usado pelo local'); },
}));
vi.mock('@/lib/commercial/server-session', () => ({
  hasOptionalPermission: async (session: { permissions: Set<string> }, key: string) => session.permissions.has(key),
  requireCommercialSession: mocks.requireCommercialSession,
  isSessionError: (r: object) => 'error' in r,
}));
vi.mock('@/lib/commercial/owner-directory', () => ({ resolveOwnerNames: mocks.resolveOwnerNames }));
vi.mock('@/lib/supply/intelligence-read', () => ({ listSupplySignals: mocks.listSupplySignals }));
vi.mock('@/lib/supply/read-model', () => ({ supplyFlow: vi.fn() }));
vi.mock('@/lib/decisions/read', () => ({
  viewerInbox: mocks.viewerInbox, enrichInbox: mocks.enrichInbox, decisionSetup: mocks.decisionSetup,
}));
vi.mock('@/lib/operations/service-orders/read-model', () => ({ countsFor: mocks.countsFor, listServiceOrders: mocks.listServiceOrders }));
vi.mock('@/lib/operations/projects/access', () => ({ todayInSaoPaulo: () => '2026-09-25' }));

import { buildSiteHud, currentPhase, projectProgress, siteInboxRows, siteNextAction, sitePosition, validLatLng, type SiteActivity } from '@/lib/dashboard/site';
import { handleSiteRequest, isValidProjectId, openSite, readPaged, readProjectCoverage, COVERAGE_PER_REQUIREMENT_MAX } from '@/lib/dashboard/site-common';
import { opsRow } from '@/lib/dashboard/rules';
import { operationsOverview } from '@/lib/operations/overview';
import type { FeedModel, SiteHud } from '@/lib/dashboard/types';
import type { DecisionInboxRow } from '@/lib/decisions/types';

const TODAY = '2026-09-25';
const PID = 'p-ug05';
const UG05 = 'Enel Cachoeira Dourada UG-05';

/* ── Cliente Supabase simulado ──────────────────────────────────────────── */

type Spec = { rows?: Record<string, unknown>[]; error?: string };
type Call = { table: string; ops: Array<[string, unknown[]]> };
type Tables = Record<string, Spec | ((call: Call) => Spec)>;

function fakeClient(tables: Tables, rpcs: Record<string, unknown>, calls: Call[]) {
  return {
    rpc: async (name: string) => ({ data: rpcs[name] ?? null, error: null }),
    from: (table: string) => {
      const call: Call = { table, ops: [] };
      calls.push(call);
      let single = false;
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'neq', 'gt', 'gte', 'lte', 'in', 'is', 'not', 'or', 'order', 'limit', 'range']) {
        chain[m] = (...args: unknown[]) => { call.ops.push([m, args]); return chain; };
      }
      chain.maybeSingle = () => { single = true; return chain; };
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        try {
          const raw = tables[table];
          const spec = (typeof raw === 'function' ? raw(call) : raw) ?? {};
          if (spec.error) return resolve({ data: null, error: { message: spec.error }, count: null });
          let rows = spec.rows ?? [];
          const has = (r: Record<string, unknown>, c: unknown) => typeof c === 'string' && c in r;
          for (const [m, a] of call.ops) {
            if (m === 'in') rows = rows.filter((r) => !has(r, a[0]) || (a[1] as unknown[]).includes(r[a[0] as string]));
            if (m === 'eq' || m === 'is') rows = rows.filter((r) => !has(r, a[0]) || r[a[0] as string] === a[1]);
          }
          const range = call.ops.find(([m]) => m === 'range');
          if (range) rows = rows.slice(range[1][0] as number, (range[1][1] as number) + 1);
          const limit = call.ops.find(([m]) => m === 'limit');
          if (limit) rows = rows.slice(0, limit[1][0] as number);
          if (single) return resolve({ data: rows[0] ?? null, error: null });
          return resolve({ data: rows, error: null, count: null });
        } catch (e) { return reject(e); }
      };
      return chain;
    },
  };
}

function session(permissions: string[], tables: Tables, opts: { financial?: boolean; org?: string; calls?: Call[] } = {}) {
  return {
    supabase: fakeClient(tables, {
      current_user_can_view_project_financials: opts.financial ?? true,
      has_finance_role_or_perm: false,
    }, opts.calls ?? []) as never,
    user: { id: 'u-1' } as never,
    organizationId: opts.org ?? 'org-1',
    permissions: new Set(permissions),
  };
}

const ALL = ['projects.view', 'projects.measurements.view', 'risks.view', 'operations.view', 'supply.view', 'contracts.view',
  'contracts.view_values', 'finance.view', 'commercial.view'];

/* ── Fixtures (um local real em miniatura) ──────────────────────────────── */

const act = (over: Record<string, unknown>) => ({
  organization_id: 'org-1', project_id: PID, parent_id: null, wbs_code: null, row_order: 1, type: 'task', status: 'not_started',
  priority: 'medium', delay_status: 'on_track', is_milestone: false, is_summary: false, planned_start: null, planned_finish: null,
  actual_start: null, actual_finish: null, duration_minutes: null, percent_complete: null, responsible_user_id: null,
  is_active: true, deleted_at: null, ...over,
});

const coverageRow = (over: Record<string, unknown>) => ({
  organization_id: 'org-1', project_id: PID, activity_id: 'a-next', item_id: 'i1', requirement_type: 'MATERIAL', unit: 'm',
  required_qty: 0, reserved_qty: 0, consumed_qty: 0, in_transit_qty: 0, on_order_qty: 0, requested_qty: 0, inspection_qty: 0, ...over,
});

const cash = (id: string, over: Record<string, unknown>) => ({
  organization_id: 'org-1', billing_event_id: id, contract_id: 'c1', title: `Evento ${id}`, currency: 'BRL', release_state: 'ELIGIBLE',
  eligibility_state: 'ELIGIBLE', fiscal_document_id: null, superseded_by_id: null, legacy_row: false, cancelled_at: null,
  eligible_amount: 1000, due_date: null, receivable_status: null, finance_link_state: 'UNLINKED', ...over,
});

function tables(): Tables {
  return {
    projects: { rows: [{ id: PID, organization_id: 'org-1', project: { nome: UG05, status: 'em_andamento', cliente: 'Enel', uf: 'go',
      cidade: 'Cachoeira Dourada', descricao: 'Retrofit da unidade geradora 05' }, project_v2: null }] },
    project_timeline_items: { rows: [
      act({ id: 'a-done', title: 'Mobilização', status: 'completed', row_order: 0, planned_start: '2026-08-20', planned_finish: '2026-08-25',
        actual_finish: '2026-08-25', percent_complete: 100, duration_minutes: 2400 }),
      act({ id: 'a-sum', title: 'Montagem eletromecânica', is_summary: true, status: 'in_progress', row_order: 1,
        planned_start: '2026-09-01', planned_finish: '2026-10-30' }),
      act({ id: 'a-over', parent_id: 'a-sum', title: 'Montagem do estator', status: 'in_progress', priority: 'critical', row_order: 2,
        planned_start: '2026-09-01', planned_finish: '2026-09-10', percent_complete: 60, duration_minutes: 4800, responsible_user_id: 'u-ana' }),
      act({ id: 'a-next', parent_id: 'a-sum', title: 'Comissionamento', row_order: 3, planned_start: '2026-10-05', planned_finish: '2026-10-20',
        percent_complete: 0, duration_minutes: 9600 }),
      act({ id: 'a-ms', title: 'Energização', is_milestone: true, type: 'milestone', row_order: 4, planned_start: '2026-10-22', planned_finish: '2026-10-22' }),
    ] },
    project_measurements: { rows: [
      { organization_id: 'org-1', project_id: PID, id: 'm-corr', status: 'RETURNED_FOR_CORRECTION', expected_at: '2026-09-15', occurrence_key: '2026-08', customer_due_at: null },
      { organization_id: 'org-1', project_id: PID, id: 'm-plan', status: 'PLANNED', expected_at: '2026-09-20', occurrence_key: '2026-09', customer_due_at: null },
      { organization_id: 'org-1', project_id: PID, id: 'm-cust', status: 'AWAITING_CUSTOMER_ACCEPTANCE', expected_at: '2026-09-01', occurrence_key: '2026-07', customer_due_at: '2026-10-05' },
      { organization_id: 'org-1', project_id: PID, id: 'm-prep', status: 'IN_PREPARATION', expected_at: '2026-10-01', occurrence_key: '2026-10', customer_due_at: null },
    ] },
    risks: { rows: [
      { organization_id: 'org-1', reference_id: PID, id: 'r-1', title: 'Disjuntor chega depois da montagem', severity: 'high', status: 'open',
        responsible_id: null, due_date: '2026-10-12T00:00:00Z', origin: 'manual' },
      { organization_id: 'org-1', reference_id: PID, id: 'r-2', title: 'Chuva', severity: 'critical', status: 'mitigating',
        responsible_id: 'u-ana', due_date: null, origin: 'manual' },
    ] },
    project_requirements: { rows: [
      { organization_id: 'org-1', project_id: PID, id: 'req-1', activity_id: 'a-next', requirement_type: 'MATERIAL', status: 'CONFIRMED',
        title: 'Cabo 35 mm', required_by: '2026-09-30', satisfied_at: null },
      { organization_id: 'org-1', project_id: PID, id: 'req-2', activity_id: 'a-next', requirement_type: 'MATERIAL', status: 'CONFIRMED',
        title: 'Disjuntor 145 kV', required_by: '2026-10-14', satisfied_at: null },
      { organization_id: 'org-1', project_id: PID, id: 'dep-1', activity_id: 'a-over', requirement_type: 'CUSTOMER_DEPENDENCY', status: 'CONFIRMED',
        title: 'Liberação do pátio', required_by: '2026-09-20', satisfied_at: null },
    ] },
    supply_requirement_coverage: { rows: [
      coverageRow({ requirement_id: 'req-1', required_by: '2026-09-30', required_qty: 120, requested_qty: 50 }),
      coverageRow({ requirement_id: 'req-2', required_by: '2026-10-14', unit: 'un', required_qty: 3, on_order_qty: 3 }),
    ] },
    internal_service_orders: { rows: [
      { organization_id: 'org-1', project_id: PID, id: 'os-1', engagement_id: 'g1', os_number: 'OS-0042', title: 'Retrofit UG-05', status: 'DRAFT',
        planned_start: '2026-10-01', responsible_user_id: null },
      { organization_id: 'org-1', project_id: PID, id: 'os-2', engagement_id: 'g1', os_number: 'OS-0041', title: 'Cancelada', status: 'CANCELLED',
        planned_start: null, responsible_user_id: null },
    ] },
    project_allocations: { rows: [
      { organization_id: 'org-1', project_id: PID, id: 'al1', person_id: 'pe1', status: 'active' },
      { organization_id: 'org-1', project_id: PID, id: 'al2', person_id: 'pe1', status: 'active' },
      { organization_id: 'org-1', project_id: PID, id: 'al3', person_id: 'pe2', status: 'active' },
    ] },
    project_globe_marker: { rows: [] },
    inventory_locations: { rows: [{ organization_id: 'org-1', project_id: PID, kind: 'PROJECT_SITE', active: true, id: 'l1', code: 'CANT-UG05',
      name: 'Canteiro UG-05', latitude: -18.49, longitude: -49.49, updated_at: '2026-09-01T00:00:00Z' }] },
    project_location_attention: { rows: [{ organization_id: 'org-1', project_id: PID, resolution_state: 'UNRESOLVED', attention_reason: null }] },
    project_contract_link_governed: { rows: [
      { organization_id: 'org-1', contract_id: 'c1', project_id: PID },
      { organization_id: 'org-1', contract_id: 'c2', project_id: PID },
      { organization_id: 'org-1', contract_id: 'c2', project_id: 'p-outro' },
    ] },
    contracts: { rows: [
      { organization_id: 'org-1', id: 'c1', contract_number: 'CT-0042', title: 'Retrofit UG-05' },
      { organization_id: 'org-1', id: 'c2', contract_number: 'CT-0050', title: 'Guarda-chuva' },
    ] },
    contract_to_cash_read_model: { rows: [
      cash('e1', { eligible_amount: 100000 }),
      cash('e2', { release_state: 'RELEASED', eligible_amount: 25000, due_date: '2026-10-10', receivable_status: 'OPEN', finance_link_state: 'LINKED' }),
      cash('e3', { contract_id: 'c2', release_state: 'PENDING_RELEASE', eligible_amount: 5000 }),
      cash('e-x', { contract_id: 'c9', release_state: 'PENDING_RELEASE' }),
    ] },
    purchase_orders: { rows: [{ organization_id: 'org-1', project_id: PID, id: 'po-2', order_number: 'OC-0002', status: 'ISSUED' }] },
    inbound_shipments: { rows: [{ organization_id: 'org-1', id: 's1', purchase_order_id: 'po-2', eta: '2026-10-03', status: 'IN_TRANSIT' }] },
  };
}

const sig = (over: Record<string, unknown>) => ({
  id: 's1', kind: 'SHORTAGE', severity: 'critical', status: 'OPEN', projectId: PID, project: UG05, requirementId: 'req-1',
  purchaseOrderId: null, supplierId: null, title: 'Comprar 120 m de CB-35', rationale: 'sem cobertura', evidence: [],
  action: { kind: 'OPEN', label: 'Abrir', payload: {} }, firstSeenAt: '2026-09-01', lastSeenAt: '2026-09-24T10:00:00Z',
  resolvedAt: null, decidedBy: null, decidedAt: null, decisionNote: null, followupId: null, engineVersion: 'supply-signals.v1', ...over,
});

const inboxRow = (key: string, over: Partial<DecisionInboxRow>): DecisionInboxRow => ({
  decision_key: key, source_kind: 'PROCUREMENT_AUTHORITY', category: 'compras', subject_type: 'purchase_order', subject_id: key,
  action_type: 'APPROVE', request_id: null, step_id: null, stage_no: null, submission: 1, title: `Decisão ${key}`, amount: 1000,
  currency: 'BRL', project_id: null, requested_by: null, requested_at: '2026-09-20T00:00:00Z', due_at: null, need_by: null,
  decide_by: null, overdue: false, assignment: 'PRIMARY', state: 'PENDING', actions: [], reason_required: [], fingerprint: null,
  authority: {}, ...over,
} as DecisionInboxRow);

const INBOX = [
  inboxRow('d-po', { subject_id: 'po-1', project_id: PID, overdue: true }),
  inboxRow('d-bill-e3', { subject_type: 'contract_billing_event', subject_id: 'e3', project_id: null }),
  inboxRow('d-bill-ex', { subject_type: 'contract_billing_event', subject_id: 'e-x', project_id: null }),
  inboxRow('d-other', { subject_id: 'po-9', project_id: 'p-outro' }),
  inboxRow('d-elig', { subject_id: 'po-7', project_id: PID, assignment: 'ELIGIBLE' }),
];

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.listSupplySignals.mockResolvedValue({
    lastRun: { ranAt: '2026-09-25T06:00:00Z', engineVersion: 'supply-signals.v1' }, openCount: 3,
    signals: [
      sig({}),
      sig({ id: 's2', kind: 'DECISION_PENDING', requirementId: null, purchaseOrderId: 'po-1', title: 'Pedido OC-0001 aguardando aprovação' }),
      sig({ id: 's3', kind: 'LATE_INBOUND', severity: 'medium', requirementId: null, purchaseOrderId: 'po-2', title: 'Entrega atrasada' }),
    ],
  });
  mocks.viewerInbox.mockResolvedValue(INBOX);
  mocks.enrichInbox.mockImplementation(async (_s: unknown, rows: DecisionInboxRow[]) => rows.map((r) => ({
    key: r.decision_key, kindLabel: r.subject_type === 'purchase_order' ? 'Compra' : 'Liberação de faturamento', title: r.title,
    projectName: null, projectId: r.project_id, priority: { code: r.overdue ? 'OVERDUE' : 'NORMAL', label: r.overdue ? 'Vencida' : 'Pendente',
      tone: r.overdue ? 'danger' : 'neutral' }, overdue: r.overdue, dueAt: r.due_at, decideBy: r.decide_by,
    amount: r.amount === null ? null : Number(r.amount), currency: r.currency, assignment: r.assignment, requestedAt: r.requested_at,
  })));
  mocks.decisionSetup.mockResolvedValue({ policies: 0, authorities: 0 });
  mocks.countsFor.mockImplementation(async (_org: string, orders: Array<{ id: string }>) =>
    new Map(orders.map((o) => [o.id, { items: 2, unreviewedItems: 0, openDivergences: 1, blockingOpen: 1 }])));
  mocks.listServiceOrders.mockResolvedValue([
    { id: 'os-1', engagementId: 'g1', osNumber: 'OS-0042', title: 'Retrofit UG-05', origin: 'PROPOSAL', status: 'DRAFT', authorizedValue: null,
      currency: null, plannedStart: '2026-10-01', plannedFinish: null, customer: null, engagementTitle: null, packageLabel: null,
      projectId: PID, projectName: UG05, ownerName: null, issuedAt: null, createdAt: '2026-09-01', counts: { items: 2, unreviewedItems: 0, openDivergences: 1, blockingOpen: 1 } },
  ]);
  mocks.resolveOwnerNames.mockResolvedValue({ 'u-ana': 'Ana' });
});
afterEach(() => { vi.clearAllMocks(); });

async function hud(permissions = ALL, t: Tables = tables(), opts: { financial?: boolean; calls?: Call[] } = {}): Promise<SiteHud> {
  const s = session(permissions, t, opts);
  const opened = await openSite(s, PID, TODAY);
  if (!opened.ok) throw new Error(`site não abriu: ${opened.reason}`);
  return buildSiteHud(opened.site);
}

const rowsOf = (a: SiteHud['attention']): FeedModel['rows'] => (a.state === 'ok' ? a.data.rows : []);

/* ══════════════════════════════════════════════════════════════════════════ */

describe('a porta do local (site-common)', () => {
  it('id: só texto simples de até 128', () => {
    expect(isValidProjectId('qa-scn-tucurui')).toBe(true);
    expect(isValidProjectId('proj-4b34cb26-79b0-4292-965e-3b561e35ef87')).toBe(true);
    for (const bad of ['', 'a b', "x');drop", 'a/b', 'é', 'a'.repeat(129), null, 42]) expect(isValidProjectId(bad)).toBe(false);
  });

  it('id inválido → 200 `invalid`, sem sessão nem leitura', async () => {
    const build = vi.fn();
    const res = await handleSiteRequest('bad id!', 'o local', build);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ ok: false, reason: 'invalid', message: 'Identificador de projeto inválido.', error: 'Identificador de projeto inválido.' });
    expect(mocks.requireCommercialSession).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
  });

  it('sem projects.view → `restricted` sem ler o projeto; outro inquilino → `not_found`; falha → `error` (200)', async () => {
    const calls: Call[] = [];
    mocks.requireCommercialSession.mockResolvedValue(session(['risks.view'], tables(), { calls }));
    const build = vi.fn();
    let res = await handleSiteRequest(PID, 'o local', build);
    expect(res.status).toBe(200);
    expect((await res.json()).reason).toBe('restricted');
    expect(calls.some((c) => c.table === 'projects')).toBe(false);

    mocks.requireCommercialSession.mockResolvedValue(session(ALL, tables(), { org: 'org-2' }));
    res = await handleSiteRequest(PID, 'o local', build);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: false, reason: 'not_found' });
    expect(JSON.stringify(body)).not.toContain(UG05);

    mocks.requireCommercialSession.mockResolvedValue(session(ALL, { ...tables(), projects: { error: 'boom' } }));
    res = await handleSiteRequest(PID, 'o local', build);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, reason: 'error' });
    expect(build).not.toHaveBeenCalled();
  });

  it('sucesso: 200, no-store, Server-Timing; montagem que cai → 500; 401 vem da sessão', async () => {
    mocks.requireCommercialSession.mockResolvedValue(session(ALL, tables()));
    const ok = await handleSiteRequest(PID, 'o local', async (site, timings) => { timings.x = 3; return { ok: true, id: site.project.id }; });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Cache-Control')).toBe('no-store');
    expect(ok.headers.get('Server-Timing')).toMatch(/x;dur=3, total;dur=\d+/);
    expect(await ok.json()).toEqual({ ok: true, id: PID });

    const bad = await handleSiteRequest(PID, 'o local', async () => { throw new Error('x'); });
    expect(bad.status).toBe(500);
    expect(await bad.json()).toMatchObject({ ok: false, reason: 'error' });

    const { NextResponse } = await import('next/server');
    mocks.requireCommercialSession.mockResolvedValue({ error: NextResponse.json({ ok: false }, { status: 401 }) });
    expect((await handleSiteRequest(PID, 'o local', async () => ({}))).status).toBe(401);
  });

  it('a rota liga a porta ao builder', async () => {
    mocks.requireCommercialSession.mockResolvedValue(session(ALL, tables()));
    const route = await import('@/app/api/dashboard/site/[projectId]/route');
    expect(route.dynamic).toBe('force-dynamic');
    const res = await route.GET(new Request('http://x'), { params: Promise.resolve({ projectId: PID }) });
    expect(res.status).toBe(200);
    const body = await res.json() as SiteHud;
    expect(body.ok).toBe(true);
    expect(body.project.id).toBe(PID);
    const invalid = await route.GET(new Request('http://x'), { params: Promise.resolve({ projectId: '../x' }) });
    expect((await invalid.json()).reason).toBe('invalid');
  });

  it('readPaged: páginas de 1000 até o teto; erro sobe', async () => {
    const all = Array.from({ length: 2500 }, (_, i) => ({ i }));
    const page = async (from: number, to: number) => ({ data: all.slice(from, to + 1), error: null });
    expect(await readPaged('x', page, 5000)).toEqual({ rows: all, truncated: false });
    const capped = await readPaged('x', page, 2000);
    expect(capped.rows).toHaveLength(2000);
    expect(capped.truncated).toBe(true);
    await expect(readPaged('x', async () => ({ data: null, error: { message: 'boom' } }), 10)).rejects.toThrow('Não foi possível ler x.');
  });

  it('cobertura do projeto: uma consulta por requisito (filtro que desce na visão); muitos → pelo projeto', async () => {
    const calls: Call[] = [];
    const s = session(ALL, tables(), { calls });
    const few = await readProjectCoverage<{ requirement_id: string }>(s.supabase, 'org-1', PID, ['req-1', 'req-2']);
    expect(few.rows.map((r) => r.requirement_id).sort()).toEqual(['req-1', 'req-2']);
    const per = calls.filter((c) => c.table === 'supply_requirement_coverage');
    expect(per).toHaveLength(2);
    for (const c of per) expect(c.ops).toContainEqual(['eq', ['organization_id', 'org-1']]);
    expect(per.map((c) => c.ops.find(([m, a]) => m === 'eq' && a[0] === 'requirement_id')?.[1][1]).sort()).toEqual(['req-1', 'req-2']);

    calls.length = 0;
    const many = Array.from({ length: COVERAGE_PER_REQUIREMENT_MAX + 1 }, (_, i) => `r${i}`);
    await readProjectCoverage(s.supabase, 'org-1', PID, many);
    expect(calls.filter((c) => c.table === 'supply_requirement_coverage')).toHaveLength(1);
    expect(calls[0].ops).toContainEqual(['eq', ['project_id', PID]]);
  });
});

describe('buildSiteHud — a mesma derivação do Dashboard', () => {
  it('saúde e linhas iguais às da Visão Geral de Operações REAL sobre os mesmos fatos', async () => {
    const h = await hud();
    const s = session(ALL, tables());
    const ops = await operationsOverview(s, { projects: true, measurements: true, risks: true, serviceOrders: true }, TODAY);
    const opsProject = ops.projectHealth?.find((p) => p.projectId === PID);
    expect(h.now.state).toBe('ok');
    if (h.now.state !== 'ok') return;
    expect(h.now.data.health).toEqual({ level: opsProject?.level, reasons: opsProject?.reasons });
    expect(h.now.data.health?.level).toBe('critical');
    expect(h.now.data.health?.reasons).toEqual(expect.arrayContaining(['1 OS com bloqueio', '1 dependência do cliente vencida',
      '1 falta de material perto da necessidade', '1 atividade vencida']));

    // OS, medição, risco, dependência: a linha do local é a linha do Dashboard (mesmo texto, chave e explainRef).
    const byKey = new Map(rowsOf(h.attention).map((r) => [r.key, r]));
    const expected = ops.attention.map((i) => opsRow(i)).filter((r): r is NonNullable<typeof r> => !!r)
      .map((r) => (r.location.id === PID && !r.location.label ? { ...r, location: { ...r.location, label: UG05 } } : r));
    expect(expected.map((r) => r.key).sort()).toEqual(['dep:dep-1', 'meas:m-corr', 'os:os-1', 'risk:r-1']);
    for (const r of expected) expect(byKey.get(r.key)).toEqual(r);
  });

  it('o local inteiro: agora, fila, medições, riscos, supply, contrato, faturamento, decisões, calendário', async () => {
    const calls: Call[] = [];
    const h = await hud(ALL, tables(), { calls });
    expect(h.ok).toBe(true);
    expect(h.today).toBe(TODAY);
    expect(h.project).toEqual({ id: PID, name: UG05, code: null, client: 'Enel', status: 'em_andamento',
      scope: 'Retrofit da unidade geradora 05', href: `/projetos/${PID}?tab=overview` });

    // localização: o canteiro do Supply (sem a oficial), com a UF/município do cadastro; sem pendência quando há ponto
    expect(h.location).toEqual({ state: 'ok', data: { position: expect.objectContaining({ lat: -18.49, lng: -49.49, source: 'project_site',
      precision: 'site', label: 'Canteiro CANT-UG05', municipality: 'Cachoeira Dourada', uf: 'GO',
      evidence: { kind: 'supply_site', contractId: null, documentId: null, page: null, at: '2026-09-01T00:00:00Z' } }), pending: null } });

    if (h.now.state !== 'ok') throw new Error('now');
    expect(h.now.data.phase).toEqual({ id: 'a-sum', title: 'Montagem eletromecânica', percent: 20 });
    expect(h.now.data.schedule).toEqual({ open: 3, overdue: 1, critical: 1, inProgress: 1, blocked: 0, partial: false });
    expect(h.now.data.nextMilestone).toEqual({ id: 'a-ms', date: '2026-10-22', title: 'Energização' });
    expect(h.now.data.progress).toEqual({ percent: 31.4 });
    expect(h.now.data.team).toEqual({ state: 'ok', data: { allocated: 2 } });
    expect(h.now.data.serviceOrders).toEqual({ state: 'ok', data: [{ id: 'os-1', number: 'OS-0042', status: 'DRAFT', statusLabel: 'Rascunho',
      href: '/operacoes/ordens-servico/os-1' }] });

    // a fila: material ao vivo com a Apex anexada; faturamento SÓ do contrato só deste projeto; PO na caixa sai
    const keys = rowsOf(h.attention).map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(['os:os-1', 'proj-act:p-ug05', 'req:req-1', 'dep:dep-1', 'risk:r-1', 'meas:m-corr',
      'bill:c1:release', 'bill:c1:invoice']));
    expect(keys.some((k) => k.startsWith('bill:c2'))).toBe(false);
    expect(keys).not.toContain('po:po-1');
    expect(keys).not.toContain('po:po-2');
    const mat = rowsOf(h.attention).find((r) => r.key === 'req:req-1');
    expect(mat).toMatchObject({ severity: 'critical', explainRef: 'mat:req-1', due: '2026-09-30', problem: 'Falta 120 m — requisitado, sem pedido emitido',
      consequence: 'Atividade Comissionamento começa em 05/10', apex: expect.objectContaining({ signalId: 's1', stale: false }) });
    const grp = rowsOf(h.attention).find((r) => r.key === 'proj-act:p-ug05');
    expect(grp).toMatchObject({ severity: 'critical', owner: 'Ana', count: 1, explainRef: 'proj-act:p-ug05' });
    expect(rowsOf(h.attention).find((r) => r.key === 'bill:c1:release')?.problem).toMatch(/^1 evento elegível aguardando liberação · R\$\s100\.000,00$/);
    if (h.attention.state === 'ok') {
      expect(h.attention.data.failed).toEqual([]);
      expect(h.attention.data.partial).toBe(false);
      expect(h.attention.data.total).toBe(8);
    }
    expect(h.nextAction).toEqual(rowsOf(h.attention)[0].nextAction);

    expect(h.measurements).toEqual({ state: 'ok', data: { pending: 3, inCorrection: 1, awaitingCustomer: 1,
      next: { id: 'm-plan', key: '2026-09', expected: '2026-09-20', status: 'PLANNED', statusLabel: 'Planejada' } } });
    expect(h.risks).toEqual({ state: 'ok', data: { open: 2, critical: 1, high: 1, withoutOwner: 1 } });
    expect(h.supply).toEqual({ state: 'ok', data: { shortages: { total: 1, critical: 1, partial: false }, apexOpen: 3 } });
    expect(h.contract).toEqual({ state: 'ok', data: { links: [{ contractId: 'c1', label: 'CT-0042 · Retrofit UG-05' },
      { contractId: 'c2', label: 'CT-0050 · Guarda-chuva' }] } });
    expect(h.billing).toMatchObject({ state: 'ok', data: { events: 3, awaitingRelease: 1, invoicesToIssue: 1 } });
    if (h.billing.state === 'ok') expect(h.billing.data.total).toMatch(/^R\$\s130\.000,00$/);

    // decisões: a do projeto + a liberação de evento de contrato vinculado; nunca a de outro projeto, contrato ou ELIGIBLE
    expect(h.decisions.state).toBe('ok');
    if (h.decisions.state === 'ok') {
      expect(h.decisions.data.count).toBe(2);
      expect(h.decisions.data.overdue).toBe(1);
      expect(h.decisions.data.top.map((d) => d.key)).toEqual(['d-po', 'd-bill-e3']);
      expect(h.decisions.data.top[0]).toMatchObject({ projectId: PID, href: '/decisoes?d=d-po', amountRestricted: false });
    }
    const enriched = mocks.enrichInbox.mock.calls[0][1] as DecisionInboxRow[];
    expect(enriched.map((r) => r.decision_key).sort()).toEqual(['d-bill-e3', 'd-elig', 'd-po']);

    // calendário do local (30 dias)
    if (h.calendar.state !== 'ok') throw new Error('calendar');
    expect(h.calendar.data.lanes.map((l) => `${l.id}:${l.state}`)).toEqual(['operacao:ok', 'supply:ok', 'medicao:ok', 'recebivel:ok']);
    expect(h.calendar.data.items.map((i) => i.id)).toEqual(expect.arrayContaining(['act:a-ms', 'need:req-1', 'ship:s1', 'meas:m-cust', 'rcv:e2']));
    expect(h.calendar.data.items.every((i) => i.project === UG05)).toBe(true);
    expect(h.notReadable).toEqual([]);

    // toda leitura com a organização; riscos com colunas explícitas (nunca `financial_exposure`)
    expect(calls.length).toBeGreaterThan(10);
    for (const c of calls) expect(c.ops, c.table).toContainEqual(['eq', ['organization_id', 'org-1']]);
    const riskSelect = calls.find((c) => c.table === 'risks')?.ops.find(([m]) => m === 'select')?.[1][0];
    expect(String(riskSelect)).not.toMatch(/financial_exposure|\*/);
    expect(JSON.stringify(h)).not.toMatch(/financial_exposure/);
  });

  it('sem o RPC financeiro: nenhum valor — nem lido', async () => {
    const calls: Call[] = [];
    const h = await hud(ALL, tables(), { financial: false, calls });
    expect(h.billing).toEqual({ state: 'ok', data: { events: 3, awaitingRelease: 1, invoicesToIssue: 1, total: null } });
    expect(rowsOf(h.attention).find((r) => r.key === 'bill:c1:release')?.problem).toBe('1 evento elegível aguardando liberação');
    for (const c of calls.filter((x) => x.table === 'contract_to_cash_read_model')) {
      const sel = c.ops.find(([m]) => m === 'select')?.[1][0];
      expect(String(sel)).not.toContain('eligible_amount');
    }
    // (a decisão mostra o valor que a CAIXA entrega a quem decide — como no Dashboard; faturamento e fila, nunca)
    expect(JSON.stringify([h.billing, h.attention])).not.toMatch(/R\$/);
  });

  it('perfil estreito (só projetos): o que não lê é Restrito, nunca 0; a fila segue sem Faturamento', async () => {
    const h = await hud(['projects.view']);
    expect(h.risks).toEqual({ state: 'restricted' });
    expect(h.contract).toEqual({ state: 'restricted' });
    expect(h.billing).toEqual({ state: 'restricted' });
    if (h.now.state !== 'ok') throw new Error('now');
    expect(h.now.data.serviceOrders).toEqual({ state: 'restricted' });
    expect(h.now.data.team).toEqual({ state: 'ok', data: { allocated: 2 } });
    const keys = rowsOf(h.attention).map((r) => r.key);
    expect(keys.some((k) => k.startsWith('bill:') || k.startsWith('risk:') || k.startsWith('os:'))).toBe(false);
    if (h.calendar.state === 'ok') expect(h.calendar.data.lanes.find((l) => l.id === 'recebivel')?.state).toBe('restricted');
    expect(h.notReadable).toEqual(['Comercial', 'Faturamento', 'Recebíveis']);
  });

  it('uma leitura que falha nunca deixa o local calmo', async () => {
    // medição falhou: a saúde não pode ser calculada sem ela; a fila diz o que não carregou; sem próxima ação
    let h = await hud(ALL, { ...tables(), project_measurements: { error: 'timeout' } });
    expect(h.measurements).toMatchObject({ state: 'error' });
    expect(h.now).toMatchObject({ state: 'error', message: expect.stringContaining('medições') });
    expect(h.attention.state).toBe('ok');
    if (h.attention.state === 'ok') {
      expect(h.attention.data.failed).toEqual([{ domain: 'medicao', label: 'Medição' }]);
      expect(h.attention.truncated).toBe(true);
    }
    expect(h.nextAction).toBeNull();

    // cobertura falhou: supply e agora em erro; a fila diz "Cobertura de material"
    h = await hud(ALL, { ...tables(), supply_requirement_coverage: { error: 'timeout' } });
    expect(h.supply).toMatchObject({ state: 'error' });
    expect(h.now.state).toBe('error');
    if (h.attention.state === 'ok') expect(h.attention.data.failed).toContainEqual({ domain: 'supply', label: 'Cobertura de material' });

    // caixa ilegível: decisões em erro, e o pedido parado NÃO some às cegas
    mocks.viewerInbox.mockRejectedValue(new Error('NOT_PROVISIONED'));
    h = await hud();
    expect(h.decisions).toMatchObject({ state: 'error' });
    expect(rowsOf(h.attention).find((r) => r.key === 'po:po-1')?.problem).toBe('Aprovação de compra parada');
    mocks.viewerInbox.mockResolvedValue(INBOX);

    // vínculo com contrato falhou e há liberação na caixa: não se sabe se é daqui → decisões em erro, faturamento em erro
    h = await hud(ALL, { ...tables(), project_contract_link_governed: { error: 'boom' } });
    expect(h.contract).toMatchObject({ state: 'error' });
    expect(h.billing).toMatchObject({ state: 'error' });
    expect(h.decisions).toMatchObject({ state: 'error' });
    if (h.attention.state === 'ok') expect(h.attention.data.failed).toContainEqual({ domain: 'faturamento', label: 'Faturamento' });

    // tudo o que alimenta a fila falhou → a fila é `error`, nunca "nada fora do lugar"
    const broken = Object.fromEntries(Object.keys(tables()).map((k) => [k, k === 'projects' ? tables().projects : { error: 'down' }])) as Tables;
    mocks.listSupplySignals.mockRejectedValue(new Error('down'));
    h = await hud(ALL, broken);
    expect(h.attention).toMatchObject({ state: 'error' });
    expect(h.nextAction).toBeNull();
  });
});

describe('regras puras do local', () => {
  const a = (over: Partial<SiteActivity>): SiteActivity => ({
    id: 'x', parent_id: null, wbs_code: null, row_order: null, type: 'task', title: 'X', status: 'not_started', priority: 'medium',
    delay_status: 'on_track', is_milestone: false, is_summary: false, planned_start: null, planned_finish: null, actual_start: null,
    actual_finish: null, duration_minutes: null, percent_complete: null, responsible_user_id: null, ...over,
  });

  it('fase: resumo com folha em andamento vence; sem resumo, a folha em andamento de maior peso; nada em andamento → null', () => {
    expect(currentPhase([a({ id: 'l1', status: 'in_progress', planned_start: '2026-09-01', planned_finish: '2026-09-05', percent_complete: 10 }),
      a({ id: 'l2', status: 'in_progress', planned_start: '2026-09-01', planned_finish: '2026-09-30', percent_complete: 40 })]))
      .toEqual({ id: 'l2', title: 'X', percent: 40 });
    expect(currentPhase([a({ id: 'l1', status: 'not_started' }), a({ id: 'l2', status: 'completed' })])).toBeNull();
    // resumo parado sem folha em andamento não é "fase atual"
    expect(currentPhase([a({ id: 's', is_summary: true, status: 'not_started' }), a({ id: 'c', parent_id: 's', status: 'not_started' })])).toBeNull();
    // ciclo no parent_id não trava
    expect(currentPhase([a({ id: 'p', parent_id: 'q', is_summary: true }), a({ id: 'q', parent_id: 'p', is_summary: true, status: 'in_progress' })]))
      .toMatchObject({ id: 'q' });
  });

  it('avanço: só com base (percentual registrado ou concluída)', () => {
    expect(projectProgress([a({ id: '1' }), a({ id: '2' })])).toBeNull();
    expect(projectProgress([a({ id: '1', status: 'completed' }), a({ id: '2' })])).toEqual({ percent: 50 });
  });

  it('posição: a oficial vence; um canteiro com coordenada; dois = ambíguo; NaN/fora da faixa não é ponto', () => {
    const canonical = { latitude: -18.5, longitude: -49.5, precision: 'municipality', site_label: 'UG-05 — casa de força', municipality: 'Cachoeira Dourada',
      state_code: 'go', evidence_kind: 'contract_scope', source_contract_id: 'c1', source_document_id: 'd1', source_page: 4, geocoded_at: '2026-09-01' };
    const site = { id: 's', code: 'CANT', name: null, latitude: -3.7, longitude: -49.6, updated_at: null };
    expect(sitePosition(canonical, [site], {})).toMatchObject({ source: 'canonical', precision: 'municipality', uf: 'GO',
      evidence: { kind: 'contract_scope', contractId: 'c1', documentId: 'd1', page: 4, at: '2026-09-01' } });
    expect(sitePosition(null, [site], { uf: 'PA', cidade: 'Tucuruí' })).toMatchObject({ source: 'project_site', label: 'Canteiro CANT',
      uf: 'PA', municipality: 'Tucuruí', precision: 'site' });
    // sem código, o nome (sem repetir "Canteiro"); UF inválida não passa; precisão desconhecida da oficial = município
    expect(sitePosition(null, [{ ...site, code: null, name: 'Canteiro SE Tucuruí' }], { uf: 'XX' })).toMatchObject({ label: 'Canteiro SE Tucuruí', uf: null });
    expect(sitePosition(null, [{ ...site, code: null, name: 'Pátio' }], {}, { location: { uf: 'pa', city: 'Belém' } }))
      .toMatchObject({ label: 'Canteiro Pátio', uf: 'PA', municipality: 'Belém' });
    expect(sitePosition({ ...canonical, precision: null }, [], {})).toMatchObject({ precision: 'municipality' });
    expect(sitePosition(null, [site, { ...site, id: 's2' }], {})).toBeNull();
    expect(sitePosition(null, [{ ...site, latitude: 'x' }], {})).toBeNull();
    expect(sitePosition({ ...canonical, evidence_kind: 'palpite' }, [], {})).toBeNull();
    expect(validLatLng(91, 0)).toBeNull();
    expect(validLatLng(null, 0)).toBeNull();
    expect(validLatLng('-3.5', '-49')).toEqual({ lat: -3.5, lng: -49 });
  });

  it('decisões do local: pelo projeto, ou pela liberação de evento de contrato vinculado', () => {
    const rows = [inboxRow('a', { project_id: PID }), inboxRow('b', { subject_type: 'contract_billing_event', subject_id: 'e1' }),
      inboxRow('c', { subject_type: 'contract_billing_event', subject_id: 'e9' }), inboxRow('d', { project_id: 'outro' })];
    expect(siteInboxRows(rows, PID, new Set(['c1']), new Map([['e1', 'c1'], ['e9', 'c9']])).map((r) => r.decision_key)).toEqual(['a', 'b']);
    expect(siteInboxRows(rows, PID, new Set(), new Map([['e1', 'c1']])).map((r) => r.decision_key)).toEqual(['a']);
  });

  it('próxima ação: só com a fila inteira e não vazia', () => {
    const row = { nextAction: { label: 'Cobrir falta', href: '/x', focused: true } } as FeedModel['rows'][number];
    const model = (over: Partial<FeedModel>): SiteHud['attention'] => ({ state: 'ok', data: { rows: [row], total: 1, critical: 1, byDomain: {},
      failed: [], partial: false, ...over } });
    expect(siteNextAction(model({}))).toEqual(row.nextAction);
    expect(siteNextAction(model({ partial: true }))).toBeNull();
    expect(siteNextAction(model({ failed: [{ domain: 'supply', label: 'Achados da Apex' }] }))).toBeNull();
    expect(siteNextAction(model({ rows: [] }))).toBeNull();
    expect(siteNextAction({ state: 'restricted' })).toBeNull();
  });
});
