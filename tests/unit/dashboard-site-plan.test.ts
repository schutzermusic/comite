/**
 * Planejar — `buildSitePlan` / `buildPlanData` (src/lib/dashboard/site-plan.ts)
 * e a rota GET /api/dashboard/site/[projectId]/plan (hermético):
 *  1. o Gantt na ordem da árvore, com nível, ciclo sem travar, setas só entre
 *     atividades do conjunto e lag em dias;
 *  2. `critical` = prioridade; `overdue`/`blocked` = os predicados da fila;
 *  3. necessidades pela cobertura VIVA (falta → `short`, em mãos → `covered`,
 *     só entrada → `partial`); não-material pelo ato "atendido";
 *  4. `needBy` = menor `required_by` confirmado e não atendido; `atRisk` = falta;
 *  5. janela [início − 3 d, término + 7 d] com hoje por perto; foco risco → vencida → crítica → próxima;
 *  6. necessidades que falham → `error` por atividade + plano `truncated` (nunca "sem necessidade");
 *     dependências que falham → o plano inteiro não carrega.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireCommercialSession: vi.fn() }));

vi.mock('@/lib/platform/server-client', () => ({
  platformServiceClient: () => { throw new Error('service role não é usado pelo Planejar'); },
}));
vi.mock('@/lib/commercial/server-session', () => ({
  hasOptionalPermission: async (session: { permissions: Set<string> }, key: string) => session.permissions.has(key),
  requireCommercialSession: mocks.requireCommercialSession,
  isSessionError: (r: object) => 'error' in r,
}));
vi.mock('@/lib/commercial/owner-directory', () => ({ resolveOwnerNames: async () => ({}) }));
vi.mock('@/lib/supply/intelligence-read', () => ({ listSupplySignals: vi.fn() }));
vi.mock('@/lib/supply/read-model', () => ({ supplyFlow: vi.fn() }));
vi.mock('@/lib/decisions/read', () => ({ viewerInbox: vi.fn(), enrichInbox: vi.fn(), decisionSetup: vi.fn() }));
vi.mock('@/lib/operations/service-orders/read-model', () => ({ countsFor: vi.fn(), listServiceOrders: vi.fn() }));
vi.mock('@/lib/operations/overview', () => ({ operationsOverview: vi.fn() }));
vi.mock('@/lib/operations/projects/access', () => ({ todayInSaoPaulo: () => '2026-09-25' }));

import {
  activityNeed, buildPlanData, buildSitePlan, compareWbs, ganttLinks, ganttOrder, planFocus, planWindow, PLAN_MAX_SPAN_DAYS,
  type PlanRequirement,
} from '@/lib/dashboard/site-plan';
import { openSite } from '@/lib/dashboard/site-common';
import type { SiteActivity } from '@/lib/dashboard/site';
import type { CoverageViewRow } from '@/lib/supply/coverage';
import type { GanttActivity, SitePlanData, SitePlanResponse } from '@/lib/dashboard/types';

const TODAY = '2026-09-25';
const PID = 'qa-scn-tucurui';

const a = (over: Partial<SiteActivity>): SiteActivity => ({
  id: 'x', parent_id: null, wbs_code: null, row_order: null, type: 'task', title: 'Atividade', status: 'not_started', priority: 'medium',
  delay_status: 'on_track', is_milestone: false, is_summary: false, planned_start: null, planned_finish: null, actual_start: null,
  actual_finish: null, duration_minutes: null, percent_complete: null, responsible_user_id: null, ...over,
});

const req = (over: Partial<PlanRequirement>): PlanRequirement => ({
  id: 'r', activity_id: null, requirement_type: 'MATERIAL', title: 'Cabo', quantity: 10, unit: 'm', required_by: null, satisfied_at: null, ...over,
});

const cov = (id: string, over: Partial<CoverageViewRow>): CoverageViewRow => ({
  requirement_id: id, project_id: PID, activity_id: null, item_id: null, requirement_type: 'MATERIAL', required_by: null, unit: 'm',
  required_qty: 10, reserved_qty: 0, consumed_qty: 0, in_transit_qty: 0, on_order_qty: 0, requested_qty: 0, inspection_qty: 0, ...over,
});

describe('regras puras do Planejar', () => {
  it('WBS numérica: 1.9 < 1.10 < 2; sem WBS por último', () => {
    expect(['2', '1.10', '1.9', null, '1'].sort(compareWbs)).toEqual(['1', '1.9', '1.10', '2', null]);
  });

  it('ordem da árvore com nível; pai fora do conjunto = raiz; ciclo não trava', () => {
    const rows = ganttOrder([
      a({ id: 'c2', parent_id: 's', row_order: 3 }), a({ id: 's', is_summary: true, row_order: 1 }), a({ id: 'c1', parent_id: 's', row_order: 2 }),
      a({ id: 'g', parent_id: 'c1', row_order: 4 }), a({ id: 'o', parent_id: 'sumiu', row_order: 0 }),
      a({ id: 'x1', parent_id: 'x2', row_order: 9 }), a({ id: 'x2', parent_id: 'x1', row_order: 8 }),
    ]);
    expect(rows.map((r) => `${r.a.id}:${r.level}`)).toEqual(['o:0', 's:0', 'c1:1', 'g:2', 'c2:1', 'x2:0', 'x1:1']);
    expect(rows.find((r) => r.a.id === 'o')?.parentId).toBeNull();
    expect(rows.find((r) => r.a.id === 'g')?.parentId).toBe('c1');
  });

  it('setas: só entre atividades do conjunto; tipo desconhecido = FS; lag em dias; duplicata sai', () => {
    const ids = new Set(['a', 'b', 'c']);
    expect(ganttLinks([
      { predecessor_id: 'a', successor_id: 'b', type: 'FS', lag_minutes: 1440 },
      { predecessor_id: 'a', successor_id: 'b', type: 'FS', lag_minutes: 1440 },
      { predecessor_id: 'b', successor_id: 'c', type: 'XX', lag_minutes: null },
      { predecessor_id: 'b', successor_id: 'z', type: 'SS', lag_minutes: 0 },
      { predecessor_id: 'c', successor_id: 'c', type: 'FS', lag_minutes: 0 },
    ], ids)).toEqual([{ from: 'a', to: 'b', type: 'FS', lagDays: 1 }, { from: 'b', to: 'c', type: 'FS', lagDays: 0 }]);
  });

  it('necessidade: cobertura viva para material; ato "atendido" para o resto', () => {
    expect(activityNeed(req({ id: 'm1', quantity: 1200 }), cov('m1', { required_qty: 1200, reserved_qty: 300, on_order_qty: 400 }), PID, TODAY))
      .toMatchObject({ status: 'short', statusLabel: 'Falta 500 m', coverage: { required: 1200, covered: 300, shortage: 500 },
        href: '/supply/planejamento-materiais?req=m1', typeLabel: 'Material' });
    expect(activityNeed(req({ id: 'm2' }), cov('m2', { reserved_qty: 10 }), PID, TODAY)).toMatchObject({ status: 'covered', statusLabel: 'Coberto' });
    expect(activityNeed(req({ id: 'm3' }), cov('m3', { in_transit_qty: 10 }), PID, TODAY)).toMatchObject({ status: 'partial', statusLabel: 'Coberto com entrada' });
    expect(activityNeed(req({ id: 'm4' }), undefined, PID, TODAY)).toMatchObject({ status: 'unknown', coverage: null });
    expect(activityNeed(req({ id: 'd1', requirement_type: 'DOCUMENT', required_by: '2026-09-01' }), undefined, PID, TODAY))
      .toMatchObject({ status: 'unknown', statusLabel: 'Vencido', typeLabel: 'Documento', href: `/projetos/${PID}?tab=timeline` });
    expect(activityNeed(req({ id: 'd2', requirement_type: 'EQUIPMENT', required_by: '2026-10-11' }), undefined, PID, TODAY))
      .toMatchObject({ status: 'unknown', statusLabel: 'Pendente' });
    expect(activityNeed(req({ id: 'w', requirement_type: 'WORKFORCE', satisfied_at: '2026-09-24' }), undefined, PID, TODAY))
      .toMatchObject({ status: 'covered', statusLabel: 'Atendido' });
  });

  it('janela: [início − 3, término + 7] com hoje por perto; plano antigo não estica; longo corta; curto alarga', () => {
    expect(planWindow(['2026-09-12', '2026-10-22', null, 'lixo'], TODAY)).toEqual({ start: '2026-09-09', end: '2026-10-29' });
    expect(planWindow(['2026-10-01', '2026-10-20'], TODAY)).toEqual({ start: '2026-09-22', end: '2026-10-27' });
    expect(planWindow(['2019-01-01', '2019-02-01'], TODAY)).toEqual({ start: '2018-12-29', end: '2019-02-08' });
    const long = planWindow(['2024-01-01', '2029-12-31'], TODAY);
    expect(long.start).toBe('2026-06-27');
    expect(Math.round((Date.parse(long.end) - Date.parse(long.start)) / 86_400_000)).toBe(PLAN_MAX_SPAN_DAYS);
    expect(planWindow([], TODAY)).toEqual({ start: '2026-09-22', end: '2026-10-13' });
  });

  it('foco: em risco → vencida → crítica → próxima → em andamento', () => {
    const g = (over: Partial<GanttActivity>): GanttActivity => ({ id: 'x', parentId: null, wbs: null, title: 'X', level: 0, start: null, finish: null,
      percent: null, status: 'not_started', statusLabel: 'Não iniciada', isSummary: false, isMilestone: false, critical: false, overdue: false,
      blocked: false, needBy: null, atRisk: false, href: '/x', ...over });
    const rows = [g({ id: 'next', start: '2026-10-01' }), g({ id: 'crit', critical: true, start: '2026-10-10' }),
      g({ id: 'late', overdue: true, finish: '2026-09-20' }), g({ id: 'risk', atRisk: true, needBy: '2026-09-30' }),
      g({ id: 'sum', isSummary: true, atRisk: true, needBy: '2026-09-01' }), g({ id: 'done', status: 'completed', atRisk: true })];
    expect(planFocus(rows, TODAY)).toBe('risk');
    expect(planFocus(rows.filter((r) => r.id !== 'risk'), TODAY)).toBe('late');
    expect(planFocus(rows.filter((r) => !['risk', 'late'].includes(r.id)), TODAY)).toBe('crit');
    expect(planFocus(rows.filter((r) => ['next', 'sum'].includes(r.id)), TODAY)).toBe('next');
    expect(planFocus([g({ id: 'run', status: 'in_progress', start: '2026-09-01', finish: '2026-10-01' })], TODAY)).toBe('run');
    expect(planFocus([], TODAY)).toBeNull();
  });
});

/* ── O plano inteiro (dados do Tucuruí do QA) ───────────────────────────── */

const TUCURUI: SiteActivity[] = [
  a({ id: 'mob', wbs_code: '1.1', row_order: 1, title: 'Mobilização do canteiro', status: 'completed', percent_complete: 100,
    planned_start: '2026-08-25', planned_finish: '2026-08-31' }),
  a({ id: 'insp', wbs_code: '1.2', row_order: 2, title: 'Inspeção das fundações dos bays', status: 'in_progress', priority: 'high',
    delay_status: 'delayed', percent_complete: 70, planned_start: '2026-09-12', planned_finish: '2026-09-21' }),
  a({ id: 'mont', wbs_code: '2.1', row_order: 3, title: 'Montagem das estruturas metálicas', status: 'in_progress', priority: 'high',
    percent_complete: 35, planned_start: '2026-09-16', planned_finish: '2026-10-06' }),
  a({ id: 'cabo', wbs_code: '2.2', row_order: 4, title: 'Lançamento de cabos de potência', priority: 'critical', percent_complete: 0,
    planned_start: '2026-09-30', planned_finish: '2026-10-14' }),
  a({ id: 'disj', wbs_code: '2.3', row_order: 5, title: 'Instalação dos disjuntores 145 kV', priority: 'critical', delay_status: 'blocked',
    percent_complete: 0, planned_start: '2026-10-12', planned_finish: '2026-10-20' }),
  a({ id: 'ener', wbs_code: '3', row_order: 6, title: 'Energização dos novos bays', type: 'milestone', is_milestone: true, priority: 'critical',
    percent_complete: 0, planned_start: '2026-10-22', planned_finish: '2026-10-22' }),
];

const REQS: PlanRequirement[] = [
  req({ id: 'r-cabo', activity_id: 'cabo', title: 'Cabo 35 mm²', quantity: 1200, required_by: '2026-09-30' }),
  req({ id: 'r-eq', activity_id: 'cabo', requirement_type: 'WORKFORCE', title: 'Equipe de lançamento', quantity: 8, unit: 'pessoas',
    required_by: '2026-09-29', satisfied_at: '2026-09-24T18:45:17Z' }),
  req({ id: 'r-disj', activity_id: 'disj', title: 'Disjuntores 145 kV', quantity: 3, unit: 'un', required_by: '2026-10-14' }),
  req({ id: 'r-doc', activity_id: 'disj', requirement_type: 'DOCUMENT', title: 'Plano de içamento', quantity: null, unit: null, required_by: '2026-10-08' }),
  req({ id: 'r-dep', activity_id: 'mont', requirement_type: 'CUSTOMER_DEPENDENCY', title: 'Concessionária libera o pátio', quantity: null, unit: null,
    required_by: '2026-09-22' }),
  req({ id: 'r-solta', activity_id: 'sumiu', title: 'De atividade apagada', required_by: '2026-09-01' }),
];

const COVERAGE = new Map<string, CoverageViewRow>([
  ['r-cabo', cov('r-cabo', { required_qty: 1200, reserved_qty: 300, on_order_qty: 400, requested_qty: 500 })],
  ['r-disj', cov('r-disj', { unit: 'un', required_qty: 3, on_order_qty: 3 })],
]);

function plan(needs: Parameters<typeof buildPlanData>[0]['needs'] = { state: 'ok', data: { requirements: REQS, coverage: COVERAGE, truncated: false } }): SitePlanData {
  return buildPlanData({
    projectId: PID, today: TODAY, activities: TUCURUI, activitiesTruncated: false,
    dependencies: [{ predecessor_id: 'cabo', successor_id: 'disj', type: 'FS', lag_minutes: 0 }], dependenciesTruncated: false, needs,
  });
}

describe('buildPlanData', () => {
  it('Tucuruí: linhas, predicados da fila, necessidade, risco, foco e janela', () => {
    const p = plan();
    expect(p.activities.map((g) => g.id)).toEqual(['mob', 'insp', 'mont', 'cabo', 'disj', 'ener']);
    const by = Object.fromEntries(p.activities.map((g) => [g.id, g]));
    expect(by.mob).toMatchObject({ percent: 100, statusLabel: 'Concluída', overdue: false, level: 0, parentId: null });
    expect(by.insp).toMatchObject({ overdue: true, critical: false, blocked: false, statusLabel: 'Em andamento' });
    expect(by.cabo).toMatchObject({ critical: true, atRisk: true, needBy: '2026-09-30' });
    // atendida (equipe) não conta para "Necessário até"; documento pendente conta
    expect(by.disj).toMatchObject({ critical: true, blocked: true, atRisk: false, needBy: '2026-10-08' });
    expect(by.mont).toMatchObject({ needBy: '2026-09-22', atRisk: false });
    expect(by.ener).toMatchObject({ isMilestone: true, needBy: null, href: `/projetos/${PID}?tab=timeline` });
    expect(p.focus).toBe('cabo');
    expect(p.links).toEqual([{ from: 'cabo', to: 'disj', type: 'FS', lagDays: 0 }]);
    expect(p.window).toEqual({ start: '2026-08-22', end: '2026-10-29' });
    expect(p.truncated).toBe(false);

    // necessidades por atividade: toda atividade tem a chave; falta primeiro; requisito de atividade fora do plano não aparece
    expect(Object.keys(p.needsByActivity).sort()).toEqual(['cabo', 'disj', 'ener', 'insp', 'mob', 'mont']);
    expect(p.needsByActivity.mob).toEqual({ state: 'ok', data: [] });
    const cabo = p.needsByActivity.cabo;
    expect(cabo.state === 'ok' && cabo.data.map((n) => `${n.id}:${n.status}`)).toEqual(['r-cabo:short', 'r-eq:covered']);
    const disj = p.needsByActivity.disj;
    expect(disj.state === 'ok' && disj.data.map((n) => `${n.id}:${n.status}:${n.statusLabel}`))
      .toEqual(['r-disj:partial:Coberto com entrada', 'r-doc:unknown:Pendente']);
    expect(JSON.stringify(p)).not.toContain('r-solta');
  });

  it('necessidades que falharam: cada atividade diz `error`, nenhum risco inventado, e o plano sai `truncated`', () => {
    const p = plan({ state: 'error', message: 'Não foi possível ler as necessidades das atividades.' });
    expect(p.truncated).toBe(true);
    for (const id of ['mob', 'cabo', 'disj']) expect(p.needsByActivity[id]).toEqual({ state: 'error', message: 'Não foi possível ler as necessidades das atividades.' });
    expect(p.activities.every((g) => !g.atRisk && g.needBy === null)).toBe(true);
    // sem risco, o foco cai na vencida
    expect(p.focus).toBe('insp');
  });
});

/* ── Montagem com o cliente simulado ─────────────────────────────────────── */

type Spec = { rows?: Record<string, unknown>[]; error?: string };
type Call = { table: string; ops: Array<[string, unknown[]]> };

function fakeClient(tables: Record<string, Spec>, calls: Call[]) {
  return {
    rpc: async (name: string) => ({ data: name === 'current_user_can_view_project_financials' ? true : false, error: null }),
    from: (table: string) => {
      const call: Call = { table, ops: [] };
      calls.push(call);
      let single = false;
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'neq', 'gt', 'gte', 'lte', 'in', 'is', 'not', 'or', 'order', 'limit', 'range']) {
        chain[m] = (...args: unknown[]) => { call.ops.push([m, args]); return chain; };
      }
      chain.maybeSingle = () => { single = true; return chain; };
      chain.then = (resolve: (v: unknown) => unknown) => {
        const spec = tables[table] ?? {};
        if (spec.error) return resolve({ data: null, error: { message: spec.error } });
        let rows = spec.rows ?? [];
        const has = (r: Record<string, unknown>, c: unknown) => typeof c === 'string' && c in r;
        for (const [m, x] of call.ops) {
          if (m === 'in') rows = rows.filter((r) => !has(r, x[0]) || (x[1] as unknown[]).includes(r[x[0] as string]));
          if (m === 'eq' || m === 'is') rows = rows.filter((r) => !has(r, x[0]) || r[x[0] as string] === x[1]);
        }
        const range = call.ops.find(([m]) => m === 'range');
        if (range) rows = rows.slice(range[1][0] as number, (range[1][1] as number) + 1);
        const limit = call.ops.find(([m]) => m === 'limit');
        if (limit) rows = rows.slice(0, limit[1][0] as number);
        return resolve(single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null });
      };
      return chain;
    },
  };
}

const row = (x: SiteActivity) => ({ organization_id: 'org-1', project_id: PID, is_active: true, deleted_at: null, ...x });

function tables(): Record<string, Spec> {
  return {
    projects: { rows: [{ id: PID, organization_id: 'org-1', project: { nome: 'SE Tucuruí 138 kV — Ampliação do pátio', status: 'em_andamento' }, project_v2: null }] },
    project_timeline_items: { rows: TUCURUI.map(row) },
    project_timeline_dependencies: { rows: [{ organization_id: 'org-1', project_id: PID, id: 'd1', predecessor_id: 'cabo', successor_id: 'disj', type: 'FS', lag_minutes: 2880 }] },
    project_requirements: { rows: REQS.map((r) => ({ organization_id: 'org-1', project_id: PID, status: 'CONFIRMED', ...r })) },
    supply_requirement_coverage: { rows: Array.from(COVERAGE.values()).map((c) => ({ organization_id: 'org-1', ...c })) },
  };
}

function session(permissions: string[], t: Record<string, Spec>, calls: Call[] = [], org = 'org-1') {
  return { supabase: fakeClient(t, calls) as never, user: { id: 'u' } as never, organizationId: org, permissions: new Set(permissions) };
}

async function build(t = tables(), calls: Call[] = []) {
  const opened = await openSite(session(['projects.view'], t, calls), PID, TODAY);
  if (!opened.ok) throw new Error(opened.reason);
  return buildSitePlan(opened.site);
}

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.clearAllMocks(); });

describe('buildSitePlan', () => {
  it('lê pela organização e pelo projeto; a cobertura por requisito; responde o plano', async () => {
    const calls: Call[] = [];
    const r = await build(tables(), calls);
    expect(r).toMatchObject({ ok: true, today: TODAY, project: { id: PID, name: 'SE Tucuruí 138 kV — Ampliação do pátio' } });
    expect(r.plan.state).toBe('ok');
    if (r.plan.state !== 'ok') return;
    expect(r.plan.data.focus).toBe('cabo');
    expect(r.plan.data.links).toEqual([{ from: 'cabo', to: 'disj', type: 'FS', lagDays: 2 }]);
    for (const c of calls) expect(c.ops, c.table).toContainEqual(['eq', ['organization_id', 'org-1']]);
    for (const c of calls.filter((x) => x.table !== 'projects' && x.table !== 'supply_requirement_coverage')) {
      expect(c.ops, c.table).toContainEqual(['eq', ['project_id', PID]]);
    }
    const coverageCalls = calls.filter((c) => c.table === 'supply_requirement_coverage');
    expect(coverageCalls.map((c) => c.ops.find(([m, x]) => m === 'eq' && x[0] === 'requirement_id')?.[1][1]).sort())
      .toEqual(['r-cabo', 'r-disj', 'r-solta']);
  });

  it('dependências que falham: o plano não carrega (a sequência mentiria); necessidades que falham: plano parcial', async () => {
    let r = await build({ ...tables(), project_timeline_dependencies: { error: 'boom' } });
    expect(r.plan).toEqual({ state: 'error', message: 'Não foi possível ler as dependências do cronograma.' });
    r = await build({ ...tables(), project_timeline_items: { error: 'boom' } });
    expect(r.plan).toMatchObject({ state: 'error' });
    r = await build({ ...tables(), supply_requirement_coverage: { error: 'boom' } });
    expect(r.plan.state).toBe('ok');
    if (r.plan.state === 'ok') {
      expect(r.plan.truncated).toBe(true);
      expect(r.plan.data.needsByActivity.cabo).toMatchObject({ state: 'error' });
    }
  });

  it('a rota: id inválido sem leitura; outro inquilino → não encontrado; sucesso 200 no-store', async () => {
    const route = await import('@/app/api/dashboard/site/[projectId]/plan/route');
    const inv = await route.GET(new Request('http://x'), { params: Promise.resolve({ projectId: 'a b' }) });
    expect(await inv.json()).toMatchObject({ ok: false, reason: 'invalid' });
    expect(mocks.requireCommercialSession).not.toHaveBeenCalled();

    mocks.requireCommercialSession.mockResolvedValue(session(['projects.view'], tables(), [], 'org-2'));
    const nf = await route.GET(new Request('http://x'), { params: Promise.resolve({ projectId: PID }) });
    expect(nf.status).toBe(200);
    expect(await nf.json()).toMatchObject({ ok: false, reason: 'not_found' });

    mocks.requireCommercialSession.mockResolvedValue(session(['projects.view'], tables()));
    const ok = await route.GET(new Request('http://x'), { params: Promise.resolve({ projectId: PID }) });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Cache-Control')).toBe('no-store');
    expect(ok.headers.get('Server-Timing')).toMatch(/activities;dur=\d+.*total;dur=\d+/);
    const body = await ok.json() as SitePlanResponse;
    expect(body.ok).toBe(true);
  });
});
