/**
 * Contagens da OS (regra do portão) e leitura em lotes:
 *  • a divergência do engajamento sem OS conta para toda OS dele; a de outra OS não;
 *  • a exceção desta OS tira o bloqueio só desta OS;
 *  • o `.or(service_order_id.in.(…),engagement_id.in.(…))` virou duas consultas
 *    em lotes, juntadas pelo id (a mesma divergência nunca conta duas vezes);
 *  • uma leitura que falha SOBE — nunca vira "0 bloqueios".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mergeById, tallyServiceOrderCounts } from '@/lib/operations/service-orders/counts';

describe('tallyServiceOrderCounts', () => {
  const orders = [{ id: 'os1', engagement_id: 'e1' }, { id: 'os2', engagement_id: 'e1' }, { id: 'os3', engagement_id: 'e2' }];

  it('linhas, não revisadas, divergências da OS e do engajamento sem OS', () => {
    const counts = tallyServiceOrderCounts(orders,
      [{ service_order_id: 'os1', confirmation_state: 'UNCONFIRMED' }, { service_order_id: 'os1', confirmation_state: 'CONFIRMED' },
        { service_order_id: 'fora', confirmation_state: 'UNCONFIRMED' }],
      [
        { id: 'd1', service_order_id: 'os1', engagement_id: 'e1', severity: 'BLOCKING' },
        { id: 'd2', service_order_id: null, engagement_id: 'e1', severity: 'BLOCKING' },
        { id: 'd3', service_order_id: null, engagement_id: 'e2', severity: 'WARNING' },
      ],
      [{ service_order_id: 'os2', divergence_ids: ['d2'] }]);
    expect(counts.get('os1')).toEqual({ items: 2, unreviewedItems: 1, openDivergences: 2, blockingOpen: 2 });
    // d1 é de outra OS; d2 é do engajamento, mas está na exceção da os2.
    expect(counts.get('os2')).toEqual({ items: 0, unreviewedItems: 0, openDivergences: 1, blockingOpen: 0 });
    expect(counts.get('os3')).toEqual({ items: 0, unreviewedItems: 0, openDivergences: 1, blockingOpen: 0 });
  });

  it('mergeById junta as duas consultas sem contar a mesma divergência duas vezes', () => {
    const d = { id: 'd1', service_order_id: null, engagement_id: 'e1', severity: 'BLOCKING' };
    const merged = mergeById([d], [d, { ...d, id: 'd2' }]);
    expect(merged.map((x) => x.id)).toEqual(['d1', 'd2']);
    const counts = tallyServiceOrderCounts([{ id: 'os1', engagement_id: 'e1' }], [], merged, []);
    expect(counts.get('os1')?.blockingOpen).toBe(2);
  });
});

// ── Leitura: lotes e erro ──────────────────────────────────────────────────
type Call = { table: string; ops: Array<[string, unknown[]]> };

function fakeService(tables: Record<string, { rows?: Record<string, unknown>[]; error?: string }>, calls: Call[]) {
  return {
    from: (table: string) => {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'is', 'not', 'or', 'order', 'limit']) {
        chain[m] = (...args: unknown[]) => { call.ops.push([m, args]); return chain; };
      }
      chain.then = (resolve: (v: unknown) => unknown) => {
        const spec = tables[table] ?? {};
        if (spec.error) return resolve({ data: null, error: { message: spec.error } });
        // Filtra pelos `.in()` e `.is(null)` recebidos, como o banco faria.
        let rows = spec.rows ?? [];
        for (const [m, args] of call.ops) {
          if (m === 'in') rows = rows.filter((r) => (args[1] as unknown[]).includes(r[args[0] as string]));
          if (m === 'is') rows = rows.filter((r) => r[args[0] as string] === null);
        }
        return resolve({ data: rows, error: null });
      };
      return chain;
    },
  };
}

describe('countsFor — em lotes, com erro conferido', () => {
  afterEach(() => { vi.doUnmock('@/lib/platform/server-client'); vi.doUnmock('@/lib/commercial/owner-directory'); vi.resetModules(); });

  async function load(tables: Parameters<typeof fakeService>[0], calls: Call[]) {
    vi.doMock('@/lib/platform/server-client', () => ({ platformServiceClient: () => fakeService(tables, calls) }));
    vi.doMock('@/lib/commercial/owner-directory', () => ({ resolveOwnerNames: async () => ({}) }));
    vi.resetModules();
    return import('@/lib/operations/service-orders/read-model');
  }

  it('250 OS: nenhum `.in()` passa de 100 ids, e não há mais `.or()` com as listas', async () => {
    const calls: Call[] = [];
    const orders = Array.from({ length: 250 }, (_, i) => ({ id: `os${i}`, engagement_id: `e${i % 120}` }));
    const { countsFor } = await load({
      commercial_divergences: { rows: [
        { id: 'dx', service_order_id: 'os7', engagement_id: 'e7', severity: 'BLOCKING', state: 'OPEN' },
        { id: 'dy', service_order_id: null, engagement_id: 'e7', severity: 'BLOCKING', state: 'OPEN' },
      ] },
    }, calls);
    const counts = await countsFor('org-1', orders);

    for (const c of calls) {
      for (const [m, args] of c.ops) if (m === 'in') expect((args[1] as unknown[]).length).toBeLessThanOrEqual(100);
      expect(c.ops.some(([m]) => m === 'or')).toBe(false);
      expect(c.ops).toContainEqual(['eq', ['organization_id', 'org-1']]);
    }
    const divergenceCalls = calls.filter((c) => c.table === 'commercial_divergences');
    expect(divergenceCalls.filter((c) => c.ops.some(([m, a]) => m === 'in' && a[0] === 'service_order_id'))).toHaveLength(3);
    expect(divergenceCalls.filter((c) => c.ops.some(([m, a]) => m === 'in' && a[0] === 'engagement_id'))).toHaveLength(2);

    // os7 tem a sua e a do engajamento; os127 (mesmo engajamento e7) só a do engajamento.
    expect(counts.get('os7')).toMatchObject({ openDivergences: 2, blockingOpen: 2 });
    expect(counts.get('os127')).toMatchObject({ openDivergences: 1, blockingOpen: 1 });
    expect(counts.get('os8')).toMatchObject({ openDivergences: 0, blockingOpen: 0 });
  });

  it('divergências que falham SOBEM em português — nunca "0 bloqueios"', async () => {
    const { countsFor } = await load({ commercial_divergences: { error: 'URI too long' } }, []);
    await expect(countsFor('org-1', [{ id: 'os1', engagement_id: 'e1' }])).rejects.toThrow('Não foi possível consultar as divergências');
  });
});
