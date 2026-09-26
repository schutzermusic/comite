/**
 * Leituras do Supply usadas pelo Dashboard:
 *  • `listSupplySignals` sem opções é a leitura de sempre (abertas + recentes, 500);
 *    com `openOnly` lê só OPEN, filtra gravidade/tipo e devolve `openCount` exato;
 *  • os nomes de projeto são lidos em lotes (sem 414 → sem UUID no lugar do nome);
 *  • `supplyFlow` confere cada leitura (erro SOBE, nunca vira 0) e expõe
 *    `requisitionsAwaitingSourcing`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

type Call = { table: string; ops: Array<[string, unknown[]]> };
type Spec = { rows?: Record<string, unknown>[]; error?: string; count?: number };

function fakeClient(tables: Record<string, Spec>, calls: Call[]) {
  return {
    from: (table: string) => {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'is', 'not', 'or', 'order', 'limit', 'gte', 'range']) {
        chain[m] = (...args: unknown[]) => { call.ops.push([m, args]); return chain; };
      }
      chain.maybeSingle = () => { call.ops.push(['maybeSingle', []]); return chain; };
      chain.then = (resolve: (v: unknown) => unknown) => {
        const spec = tables[table] ?? {};
        if (spec.error) return resolve({ data: null, error: { message: spec.error }, count: null });
        const head = call.ops.some(([m, a]) => m === 'select' && (a[1] as { head?: boolean } | undefined)?.head);
        if (head) return resolve({ data: null, error: null, count: spec.count ?? 0 });
        let rows = spec.rows ?? [];
        for (const [m, a] of call.ops) if (m === 'in' && a[0] === 'id') rows = rows.filter((r) => (a[1] as unknown[]).includes(r.id));
        for (const [m, a] of call.ops) if (m === 'range') rows = rows.slice(a[0] as number, (a[1] as number) + 1);
        const single = call.ops.some(([m]) => m === 'maybeSingle');
        return resolve({ data: single ? rows[0] ?? null : rows, error: null });
      };
      return chain;
    },
  };
}

const signal = (i: number, over: Record<string, unknown> = {}) => ({
  id: `s${i}`, kind: 'SHORTAGE', severity: 'critical', status: 'OPEN', project_id: `p${i}`, requirement_id: `r${i}`,
  purchase_order_id: null, supplier_id: null, title: `Falta ${i}`, rationale: 'sem cobertura', evidence: [],
  recommended_action: { kind: 'REQUISITION', label: 'Requisitar', payload: {} }, first_seen_at: '2026-09-01', last_seen_at: '2026-09-20',
  resolved_at: null, decided_by: null, decided_at: null, decision_note: null, execution_result: null, followup_id: null,
  engine_version: 'apex-1', ...over });

describe('listSupplySignals', () => {
  afterEach(() => { vi.doUnmock('@/lib/platform/server-client'); vi.doUnmock('@/lib/commercial/owner-directory'); vi.resetModules(); });

  async function load() {
    vi.doMock('@/lib/platform/server-client', () => ({ platformServiceClient: () => { throw new Error('service role não é usado aqui'); } }));
    vi.doMock('@/lib/commercial/owner-directory', () => ({ resolveOwnerNames: async () => ({}) }));
    vi.resetModules();
    return import('@/lib/supply/intelligence-read');
  }

  it('sem opções: a leitura de sempre (abertas + recentes, 500), sem openCount', async () => {
    const { listSupplySignals } = await load();
    const calls: Call[] = [];
    const sb = fakeClient({ supply_signals: { rows: [signal(1)] }, projects: { rows: [{ id: 'p1', project: { nome: 'UG-05' }, project_v2: null }] },
      supply_intelligence_runs: { rows: [{ ran_at: '2026-09-25T10:00:00Z', engine_version: 'apex-1' }] } }, calls);
    const model = await listSupplySignals({ supabase: sb as never, organizationId: 'org-1' });
    const list = calls.find((c) => c.table === 'supply_signals')!;
    expect(list.ops.find(([m]) => m === 'or')?.[1][0]).toMatch(/^status\.eq\.OPEN,decided_at\.gte\./);
    expect(list.ops).toContainEqual(['limit', [500]]);
    expect(calls.filter((c) => c.table === 'supply_signals')).toHaveLength(1);
    expect('openCount' in model).toBe(false);
    expect(model.signals[0]).toMatchObject({ project: 'UG-05', engineVersion: 'apex-1' });
    expect(model.lastRun).toEqual({ ranAt: '2026-09-25T10:00:00Z', engineVersion: 'apex-1' });
  });

  it('openOnly: só OPEN, gravidades e tipos filtrados, teto próprio e contagem exata sem corte', async () => {
    const { listSupplySignals } = await load();
    const calls: Call[] = [];
    const sb = fakeClient({ supply_signals: { rows: [signal(1)], count: 42 }, projects: { rows: [] }, supply_intelligence_runs: { rows: [] } }, calls);
    const model = await listSupplySignals({ supabase: sb as never, organizationId: 'org-1' },
      { openOnly: true, severities: ['critical', 'high'], excludeKinds: ['SHORTAGE', 'x),or(1'], limit: 20 });
    const [list, count] = calls.filter((c) => c.table === 'supply_signals');
    expect(list.ops).toContainEqual(['eq', ['status', 'OPEN']]);
    expect(list.ops.some(([m]) => m === 'or')).toBe(false);
    expect(list.ops).toContainEqual(['in', ['severity', ['critical', 'high']]]);
    // Só identificadores simples entram no filtro: nada de sintaxe injetada.
    expect(list.ops).toContainEqual(['not', ['kind', 'in', '(SHORTAGE)']]);
    expect(list.ops).toContainEqual(['limit', [20]]);
    expect(count.ops).toContainEqual(['select', ['id', { count: 'exact', head: true }]]);
    expect(count.ops).toContainEqual(['eq', ['status', 'OPEN']]);
    expect(count.ops).toContainEqual(['in', ['severity', ['critical', 'high']]]);
    expect(count.ops.some(([m]) => m === 'limit')).toBe(false);
    expect(model.openCount).toBe(42);
    expect(model.lastRun).toBeNull();
  });

  it('nomes de 250 projetos em lotes de até 100', async () => {
    const { listSupplySignals } = await load();
    const calls: Call[] = [];
    const projects = Array.from({ length: 250 }, (_, i) => ({ id: `p${i}`, project: { nome: `Projeto ${i}` }, project_v2: null }));
    const sb = fakeClient({ supply_signals: { rows: Array.from({ length: 250 }, (_, i) => signal(i)) }, projects: { rows: projects },
      supply_intelligence_runs: { rows: [] } }, calls);
    const model = await listSupplySignals({ supabase: sb as never, organizationId: 'org-1' });
    const projectCalls = calls.filter((c) => c.table === 'projects');
    expect(projectCalls).toHaveLength(3);
    for (const c of projectCalls) expect((c.ops.find(([m]) => m === 'in')![1][1] as unknown[]).length).toBeLessThanOrEqual(100);
    expect(model.signals.every((s) => s.project === `Projeto ${s.id.slice(1)}`)).toBe(true);
  });

  it('erro nos projetos SOBE (não vira UUID no lugar do nome)', async () => {
    const { listSupplySignals } = await load();
    const sb = fakeClient({ supply_signals: { rows: [signal(1)] }, projects: { error: 'URI too long' }, supply_intelligence_runs: { rows: [] } }, []);
    await expect(listSupplySignals({ supabase: sb as never, organizationId: 'org-1' }))
      .rejects.toThrow('Não foi possível ler os projetos das recomendações da Apex.');
  });
});

describe('supplyFlow', () => {
  afterEach(() => { vi.resetModules(); });

  it('expõe requisitionsAwaitingSourcing (a mesma contagem de decisionsPending)', async () => {
    const { supplyFlow } = await import('@/lib/supply/read-model');
    const sb = fakeClient({
      purchase_orders: { rows: [{ id: 'po1', status: 'APPROVAL_REQUIRED', expected_delivery: null }] },
      purchase_requisitions: { count: 4 },
      goods_receipts: { rows: [] },
    }, []);
    const flow = await supplyFlow({ supabase: sb as never, organizationId: 'org-1' }, '2026-09-25');
    expect(flow.requisitionsAwaitingSourcing).toBe(4);
    expect(flow.decisionsPending).toBe(5);
    expect(flow).toHaveProperty('openPoValue');
    expect(flow).toHaveProperty('lateInbound', 0);
    expect(flow).toHaveProperty('receivingIssues', 0);
  });

  it.each([
    ['purchase_orders', 'Não foi possível ler os pedidos de compra.'],
    ['purchase_requisitions', 'Não foi possível contar as requisições de compra.'],
    ['goods_receipts', 'Não foi possível ler os recebimentos.'],
  ])('erro em %s SOBE — nunca vira 0', async (table, message) => {
    const { supplyFlow } = await import('@/lib/supply/read-model');
    const sb = fakeClient({ purchase_requisitions: { count: 0 }, [table]: { error: 'timeout' } }, []);
    await expect(supplyFlow({ supabase: sb as never, organizationId: 'org-1' }, '2026-09-25')).rejects.toThrow(message);
  });

  it('erro nas linhas de pedido (2º estágio) SOBE em português', async () => {
    const { supplyFlow } = await import('@/lib/supply/read-model');
    const sb = fakeClient({
      purchase_orders: { rows: [{ id: 'po1', status: 'ISSUED', expected_delivery: null }] },
      purchase_requisitions: { count: 0 }, goods_receipts: { rows: [] },
      purchase_order_lines: { error: 'URI too long' },
    }, []);
    await expect(supplyFlow({ supabase: sb as never, organizationId: 'org-1' }, '2026-09-25'))
      .rejects.toThrow('Não foi possível ler as linhas de pedido, embarques e recebimentos.');
  });
});
