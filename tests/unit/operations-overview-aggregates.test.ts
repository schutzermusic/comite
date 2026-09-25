/**
 * Números SEM corte da Visão Geral de Operações (aditivos para o Dashboard):
 *  • contagem por tipo sobre TODOS os candidatos (a fila corta em 25/15/15/40);
 *  • atividades vencidas agrupadas por projeto, com a ordem bloqueadas → críticas → mais antiga;
 *  • saúde contada sobre todos os projetos ativos; leitura cortada sinalizada;
 *  • sem leitura de OS, as OS nem são lidas; leitura central que falha SOBE.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  countHealthLevels, groupOverdueByProject, materialShortageTone, overdueActivityTone, readWasTruncated, tallyAttention,
} from '@/lib/operations/overview-aggregates';
import { isInProgressActivity, type ActivityLike } from '@/lib/operations/overview-rules';

const TODAY = '2026-09-25';

describe('regras puras', () => {
  it('tallyAttention conta total/perigo/aviso por tipo e inicia todos os tipos em 0', () => {
    const c = tallyAttention([
      { kind: 'activity', tone: 'danger' }, { kind: 'activity', tone: 'warning' }, { kind: 'activity', tone: 'warning' },
      { kind: 'service_order', tone: 'accent' },
    ]);
    expect(c.activity).toEqual({ total: 3, danger: 1, warning: 2 });
    expect(c.service_order).toEqual({ total: 1, danger: 0, warning: 0 });
    expect(c.dependency).toEqual({ total: 0, danger: 0, warning: 0 });
  });

  it('tons: atividade crítica ou bloqueada = perigo; material até a data-limite = perigo', () => {
    expect(overdueActivityTone({ priority: 'critical', delay_status: 'none' })).toBe('danger');
    expect(overdueActivityTone({ priority: 'medium', delay_status: 'blocked' })).toBe('danger');
    expect(overdueActivityTone({ priority: 'medium', delay_status: 'delayed' })).toBe('warning');
    expect(materialShortageTone('2026-10-02', '2026-10-02')).toBe('danger');
    expect(materialShortageTone('2026-10-03', '2026-10-02')).toBe('warning');
    expect(materialShortageTone(null, '2026-10-02')).toBe('warning');
  });

  it('groupOverdueByProject: bloqueadas ↓, críticas ↓, vencimento mais antigo ↑; donos distintos', () => {
    const act = (project_id: string, planned_finish: string, over: Partial<{ priority: string; delay_status: string; status: string; responsible_user_id: string | null }> = {}) =>
      ({ project_id, planned_finish, priority: 'medium', delay_status: 'none', status: 'in_progress', responsible_user_id: null, ...over });
    const rows = groupOverdueByProject([
      act('pA', '2026-09-10', { responsible_user_id: 'u1' }),
      act('pA', '2026-09-01', { responsible_user_id: 'u1' }),
      act('pA', '2026-09-05', { responsible_user_id: 'u2' }),
      act('pB', '2026-09-20', { status: 'blocked' }),
      act('pC', '2026-08-01', { priority: 'critical' }),
      act('pD', '2026-07-01'),
      act('pX', '2026-09-01'),
    ], (id) => (id === 'pX' ? undefined : { name: `Projeto ${id}`, client: id === 'pA' ? 'Enel' : null }), { u1: 'Ana', u2: 'Bruno' });

    expect(rows.map((r) => r.projectId)).toEqual(['pB', 'pC', 'pD', 'pA', 'pX']);
    expect(rows.find((r) => r.projectId === 'pA')).toEqual({ projectId: 'pA', project: 'Projeto pA', client: 'Enel',
      count: 3, blocked: 0, critical: 0, oldestDue: '2026-09-01', ownerNames: ['Ana', 'Bruno'] });
    expect(rows[0]).toMatchObject({ blocked: 1, count: 1 });
    // Projeto fora do mapa (sem leitura do cadastro) não some: aparece pelo id.
    expect(rows.at(-1)).toMatchObject({ project: 'pX', client: null });
  });

  it('countHealthLevels e readWasTruncated', () => {
    expect(countHealthLevels(['critical', 'critical', 'unknown', 'healthy'])).toEqual({ critical: 2, attention: 0, healthy: 1, unknown: 1 });
    expect(readWasTruncated(999, 5000)).toBe(false);
    expect(readWasTruncated(1000, 5000)).toBe(true); // teto do PostgREST
    expect(readWasTruncated(20, 20)).toBe(true); // bateu no .limit()
    expect(readWasTruncated(1000)).toBe(true);
  });

  it('isInProgressActivity: folha aberta com status in_progress ou início real', () => {
    const base: ActivityLike & { actual_start: string | null } = { status: 'not_started', priority: 'medium', delay_status: 'none',
      is_milestone: false, is_summary: false, planned_start: null, planned_finish: null, actual_finish: null, actual_start: null };
    expect(isInProgressActivity(base)).toBe(false);
    expect(isInProgressActivity({ ...base, status: 'in_progress' })).toBe(true);
    expect(isInProgressActivity({ ...base, actual_start: '2026-09-01' })).toBe(true);
    expect(isInProgressActivity({ ...base, status: 'in_progress', is_summary: true })).toBe(false);
    expect(isInProgressActivity({ ...base, actual_start: '2026-09-01', actual_finish: '2026-09-02' })).toBe(false);
  });
});

// ── operationsOverview com cliente falso ───────────────────────────────────
type Spec = { rows?: Record<string, unknown>[]; error?: string };

function fakeClient(tables: Record<string, Spec>) {
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const ins: Array<[string, unknown[]]> = [];
      for (const m of ['select', 'eq', 'is', 'not', 'or', 'order', 'limit']) chain[m] = () => chain;
      chain.in = (col: string, vals: unknown[]) => { ins.push([col, vals]); return chain; };
      chain.then = (resolve: (v: unknown) => unknown) => {
        const spec = tables[table] ?? {};
        if (spec.error) return resolve({ data: null, error: { message: spec.error } });
        let rows = spec.rows ?? [];
        for (const [col, vals] of ins) if (col === 'id') rows = rows.filter((r) => vals.includes(r[col]));
        return resolve({ data: rows, error: null });
      };
      return chain;
    },
  };
}

const project = (id: string, status = 'active') => ({ id, project: { name: `Projeto ${id}`, status }, project_v2: null });
const activity = (id: string, project_id: string, over: Record<string, unknown> = {}) => ({
  id, project_id, title: `Atividade ${id}`, type: 'task', status: 'in_progress', priority: 'medium', delay_status: 'none',
  is_milestone: false, is_summary: false, planned_start: '2026-08-01', planned_finish: '2026-09-01', actual_start: null,
  actual_finish: null, responsible_user_id: null, percent_complete: 10, wbs_code: null, ...over });

describe('operationsOverview — aditivos', () => {
  const listServiceOrders = vi.fn(async () => []);
  afterEach(() => {
    vi.doUnmock('@/lib/operations/service-orders/read-model'); vi.doUnmock('@/lib/commercial/owner-directory');
    vi.resetModules(); listServiceOrders.mockClear();
  });

  async function load() {
    vi.doMock('@/lib/operations/service-orders/read-model', () => ({ listServiceOrders }));
    vi.doMock('@/lib/commercial/owner-directory', () => ({ resolveOwnerNames: async () => ({ u1: 'Ana' }) }));
    vi.resetModules();
    return import('@/lib/operations/overview');
  }

  it('contagens sem corte: 30 vencidas → a fila leva 25, a contagem diz 30', async () => {
    const { operationsOverview } = await load();
    const acts = [
      ...Array.from({ length: 28 }, (_, i) => activity(`a${i}`, 'p1', { responsible_user_id: i === 0 ? 'u1' : null })),
      activity('b1', 'p2', { delay_status: 'blocked' }),
      activity('b2', 'p2', { priority: 'critical' }),
      activity('m1', 'p1', { is_milestone: true, planned_finish: '2026-10-10', title: 'Energização' }),
      activity('s1', 'p1', { status: 'not_started', planned_start: '2026-10-01', planned_finish: '2026-10-20' }),
    ];
    const sb = fakeClient({
      projects: { rows: [project('p1'), project('p2')] },
      project_timeline_items: { rows: acts },
    });
    const o = await operationsOverview({ supabase: sb as never, organizationId: 'org-1' },
      { projects: true, measurements: true, risks: true, serviceOrders: false }, TODAY);

    expect(listServiceOrders).not.toHaveBeenCalled();
    expect(o.serviceOrdersAccess).toBe(false);
    expect(o.kpis.serviceOrdersAwaitingIssue).toBe(0);

    expect(o.attention.filter((a) => a.kind === 'activity')).toHaveLength(25);
    expect(o.attentionCounts.activity).toEqual({ total: 30, danger: 2, warning: 28 });
    expect(o.overdueActivities).toBe(30);
    expect(o.inProgressActivities).toBe(31); // 28 + b1 + b2 + marco (em andamento); s1 ainda não começou
    for (const a of o.attention) expect(a.refId).toBe(a.id.split(':')[1]);
    expect(o.attention.every((a) => a.projectId === 'p1' || a.projectId === 'p2')).toBe(true);

    expect(o.overdueByProject.map((r) => [r.projectId, r.count, r.blocked, r.critical])).toEqual([['p2', 2, 1, 1], ['p1', 28, 0, 0]]);
    expect(o.overdueByProject[1].ownerNames).toEqual(['Ana']);

    const p1 = o.projectHealth?.find((p) => p.projectId === 'p1');
    expect(p1).toMatchObject({ level: 'critical', tone: 'danger', nextMilestone: '2026-10-10', nextMilestoneId: 'm1', nextMilestoneTitle: 'Energização' });
    expect(o.healthCounts).toEqual({ critical: 2, attention: 0, healthy: 0, unknown: 0 });
    expect(o.truncated).toEqual({ activities: false, measurements: false, risks: false, coverage: false });
  });

  it('sem leitura de projetos: números nulos, lista vazia; OS lidas por padrão', async () => {
    const { operationsOverview } = await load();
    const o = await operationsOverview({ supabase: fakeClient({}) as never, organizationId: 'org-1' },
      { projects: false, measurements: false, risks: false }, TODAY);
    expect(listServiceOrders).toHaveBeenCalledTimes(1);
    expect(o.serviceOrdersAccess).toBe(true);
    expect(o.overdueActivities).toBeNull();
    expect(o.inProgressActivities).toBeNull();
    expect(o.healthCounts).toBeNull();
    expect(o.overdueByProject).toEqual([]);
  });

  it('leitura central que falha SOBE — nunca vira fila vazia', async () => {
    const { operationsOverview } = await load();
    const sb = fakeClient({ projects: { rows: [project('p1')] }, risks: { error: 'timeout' } });
    await expect(operationsOverview({ supabase: sb as never, organizationId: 'org-1' },
      { projects: true, measurements: true, risks: true }, TODAY)).rejects.toThrow('Não foi possível ler os riscos');
  });

  it('projetos ativos sem atividade aberta: conta também o que já tem outra razão (≠ health.unknown)', async () => {
    const { operationsOverview } = await load();
    const sb = fakeClient({
      projects: { rows: [project('p1'), project('p2'), project('p3'), project('p4', 'completed')] },
      // p1 tem cronograma; p2 não tem nada; p3 não tem cronograma mas tem risco crítico (→ crítico, não "unknown").
      project_timeline_items: { rows: [activity('a1', 'p1', { planned_finish: '2026-12-01' })] },
      risks: { rows: [{ id: 'r1', title: 'Falha no transformador', severity: 'critical', status: 'open', responsible_id: 'u1',
        reference_id: 'p3', origin: 'manual', due_date: null }] },
    });
    const o = await operationsOverview({ supabase: sb as never, organizationId: 'org-1' },
      { projects: true, measurements: true, risks: true, serviceOrders: false }, TODAY);
    expect(o.healthCounts).toEqual({ critical: 1, attention: 0, healthy: 1, unknown: 1 });
    expect(o.projectsWithoutOpenActivity).toBe(2);
    expect(o.serviceOrdersTruncated).toBe(false);

    const none = await operationsOverview({ supabase: fakeClient({}) as never, organizationId: 'org-1' },
      { projects: false, measurements: false, risks: false, serviceOrders: false }, TODAY);
    expect(none.projectsWithoutOpenActivity).toBeNull();
  });

  it('lista de OS no teto (300) é sinalizada', async () => {
    const { operationsOverview } = await load();
    const counts = { unreviewedItems: 0, blockingOpen: 0, openDivergences: 0 };
    listServiceOrders.mockResolvedValueOnce(Array.from({ length: 300 }, (_, i) => ({ id: `o${i}`, status: 'CLOSED', projectId: null, counts })) as never);
    const o = await operationsOverview({ supabase: fakeClient({}) as never, organizationId: 'org-1' },
      { projects: false, measurements: false, risks: false }, TODAY);
    expect(o.serviceOrdersTruncated).toBe(true);
  });

  it('leitura no teto do PostgREST é sinalizada', async () => {
    const { operationsOverview } = await load();
    const sb = fakeClient({
      projects: { rows: [project('p1')] },
      project_timeline_items: { rows: Array.from({ length: 1000 }, (_, i) => activity(`a${i}`, 'p1', { planned_finish: '2026-12-01' })) },
    });
    const o = await operationsOverview({ supabase: sb as never, organizationId: 'org-1' },
      { projects: true, measurements: true, risks: true }, TODAY);
    expect(o.truncated.activities).toBe(true);
    expect(o.truncated.coverage).toBe(false);
  });
});
