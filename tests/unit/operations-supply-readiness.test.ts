/**
 * Prontidão de Operações + Supply (237 + camada de aplicação):
 *  • a sessão aplica as sobreposições "deny" ao CONJUNTO de permissões — a
 *    checagem "qualquer uma de" e as seções opcionais não passam por cima;
 *  • recusa de autorização do banco (42501) responde 403; regra de negócio, 422;
 *  • só se repete o que é seguro repetir (impasse, serialização, corrida de
 *    idempotência) — e a repetição é limitada;
 *  • evidência: o tipo vem do conteúdo, não do navegador;
 *  • a leitura da Apex é tudo-ou-nada: consulta que falha aborta ANTES do sync;
 *  • o relógio da plataforma agenda a leitura e a reconciliação, e liga as
 *    rotas de compras só a partir de um trabalhador capaz.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Sessão: sobreposições entram no conjunto ───────────────────────────────
describe('sessão de Operações/Supply e sobreposições de permissão', () => {
  afterEach(() => { vi.resetModules(); vi.doUnmock('@/utils/supabase/server'); vi.doUnmock('@/lib/auth/active-organization'); });

  async function sessionWith(opts: { roleKeys: string[]; overrides: Array<{ key: string; effect: 'grant' | 'deny' }> }) {
    const resolver = (key: string) => {
      const o = opts.overrides.find((x) => x.key === key);
      if (o) return o.effect === 'grant';
      return opts.roleKeys.includes(key);
    };
    const supabase = {
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
      from: (table: string) => {
        const rows = table === 'user_roles'
          ? [{ roles: { role_permissions: opts.roleKeys.map((key) => ({ permissions: { key } })) } }]
          : opts.overrides.map((o) => ({ effect: o.effect, permissions: { key: o.key } }));
        const chain = { select: () => chain, eq: () => chain, then: (r: (v: unknown) => unknown) => r({ data: rows, error: null }) };
        return chain;
      },
      rpc: async (_fn: string, args: { permission_key: string }) => ({ data: resolver(args.permission_key), error: null }),
    };
    vi.doMock('@/utils/supabase/server', () => ({ createClient: async () => supabase }));
    vi.doMock('@/lib/auth/active-organization', () => ({ requireActiveOrganizationId: async () => 'org-1' }));
    vi.resetModules();
    return import('@/lib/operations/session');
  }

  it('deny vence o papel também nas checagens "qualquer uma de"', async () => {
    const mod = await sessionWith({ roleKeys: ['inventory.manage', 'supply.view'], overrides: [{ key: 'inventory.manage', effect: 'deny' }] });
    const res = await mod.requireAnyOperationsPermission(['inventory.manage']);
    expect('error' in res && res.error.status).toBe(403);
  });
  it('deny sai do conjunto, então a seção opcional também é negada', async () => {
    const mod = await sessionWith({ roleKeys: ['supply.view', 'procurement.approve'], overrides: [{ key: 'procurement.approve', effect: 'deny' }] });
    const s = await mod.requireOperationsSession([]);
    if ('error' in s) throw new Error('sessão');
    expect(s.permissions.has('procurement.approve')).toBe(false);
    expect(await mod.hasOptionalPermission(s, 'procurement.approve')).toBe(false);
    expect(await mod.hasOptionalPermission(s, 'supply.view')).toBe(true);
  });
  it('grant entra no conjunto sem papel', async () => {
    const mod = await sessionWith({ roleKeys: [], overrides: [{ key: 'receiving.receive', effect: 'grant' }] });
    const res = await mod.requireAnyOperationsPermission(['receiving.receive']);
    expect('error' in res).toBe(false);
  });
});

// ── Recusa do banco → status HTTP ─────────────────────────────────────────
describe('governedFailure', () => {
  beforeEach(() => { vi.resetModules(); });
  it('42501 é 403 e diz a alçada que falta', async () => {
    const { governedFailure } = await import('@/lib/operations/session');
    const { GovernedRpcError } = await import('@/lib/platform/governed-rpc');
    const res = governedFailure(new GovernedRpcError('Actor lacks permission (procurement.approve or supply.plan).', '42501'));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Seu perfil não tem alçada para esta ação (procurement.approve ou supply.plan).');
  });
  it('42501 com tradução do domínio mantém o texto do domínio', async () => {
    const { governedFailure } = await import('@/lib/operations/session');
    const { GovernedRpcError } = await import('@/lib/platform/governed-rpc');
    const res = governedFailure(new GovernedRpcError('Purchase approval requires segregation of duties', '42501'),
      () => 'Quem criou ou submeteu o pedido não o aprova.');
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Quem criou ou submeteu o pedido não o aprova.');
  });
  it('regra de negócio é 422', async () => {
    const { governedFailure } = await import('@/lib/operations/session');
    const { GovernedRpcError } = await import('@/lib/platform/governed-rpc');
    expect(governedFailure(new GovernedRpcError('Inventory in quarantine only moves through goods receipt inspection.', '23514')).status).toBe(422);
  });
});

// ── Repetição segura ──────────────────────────────────────────────────────
describe('governedRpc: repetir só o que é seguro', () => {
  afterEach(() => { vi.resetModules(); vi.doUnmock('@/lib/platform/server-client'); });

  async function withRpc(results: Array<{ data?: unknown; error?: { code: string; message: string; details?: string } }>) {
    const rpc = vi.fn(async () => {
      const next = results.shift() ?? { data: null };
      return { data: next.data ?? null, error: next.error ?? null };
    });
    vi.doMock('@/lib/platform/server-client', () => ({ platformServiceClient: () => ({ rpc }) }));
    vi.resetModules();
    return { rpc, mod: await import('@/lib/platform/governed-rpc') };
  }

  it('impasse (40P01) é repetido e a segunda tentativa vale', async () => {
    const { rpc, mod } = await withRpc([{ error: { code: '40P01', message: 'deadlock detected' } }, { data: { ok: 1 } }]);
    await expect(mod.governedRpc('inventory_reserve', {})).resolves.toEqual({ ok: 1 });
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it('corrida na chave de idempotência vira replay', async () => {
    const { rpc, mod } = await withRpc([
      { error: { code: '23505', message: 'duplicate key value violates unique constraint "grc_idempotency"' } },
      { data: { receipt_id: 'r1', replayed: true } }]);
    await expect(mod.governedRpc('goods_receipt_post', {})).resolves.toEqual({ receipt_id: 'r1', replayed: true });
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it('outra chave única, permissão e regra de negócio NÃO são repetidas', async () => {
    for (const error of [{ code: '23505', message: 'duplicate key value violates unique constraint "sitem_code_unique"' },
      { code: '42501', message: 'Actor lacks permission (inventory.manage).' },
      { code: '23514', message: 'Reservation exceeds available stock.' }]) {
      const { rpc, mod } = await withRpc([{ error }]);
      await expect(mod.governedRpc('x', {})).rejects.toMatchObject({ code: error.code });
      expect(rpc).toHaveBeenCalledTimes(1);
    }
  });
  it('a repetição é limitada a 3 tentativas', async () => {
    const e = { code: '40001', message: 'could not serialize access' };
    const { rpc, mod } = await withRpc([{ error: e }, { error: e }, { error: e }, { data: 1 }]);
    await expect(mod.governedRpc('x', {})).rejects.toMatchObject({ code: '40001' });
    expect(rpc).toHaveBeenCalledTimes(3);
  });
});

// ── Evidência ─────────────────────────────────────────────────────────────
describe('evidência: o tipo vem do conteúdo', () => {
  it('reconhece JPEG, PNG e PDF pela assinatura e recusa o resto', async () => {
    const { sniffEvidenceMime, EVIDENCE_MIME } = await import('@/lib/supply/evidence');
    expect(sniffEvidenceMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffEvidenceMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniffEvidenceMime(new TextEncoder().encode('%PDF-1.7'))).toBe('application/pdf');
    expect(sniffEvidenceMime(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull();
    expect(sniffEvidenceMime(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBeNull(); // WEBP/RIFF: converte no aparelho
    expect([...EVIDENCE_MIME]).toEqual(['image/jpeg', 'image/png', 'application/pdf']);
  });
});

// ── Leitura da Apex: tudo-ou-nada ─────────────────────────────────────────
describe('leitura da Apex é tudo-ou-nada', () => {
  /** Construtor de consulta falso: cada tabela devolve linhas ou erro. */
  function fakeClient(tables: Record<string, { rows?: unknown[]; error?: string }>, rpc = vi.fn()) {
    return {
      rpc,
      from: (table: string) => {
        const spec = tables[table] ?? { rows: [] };
        let from = 0; let to = Number.MAX_SAFE_INTEGER;
        const chain: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'in', 'not', 'gt', 'gte', 'order', 'or', 'limit']) chain[m] = () => chain;
        chain.range = (f: number, t: number) => { from = f; to = t; return chain; };
        chain.then = (resolve: (v: unknown) => unknown) => resolve(spec.error
          ? { data: null, error: { message: spec.error } }
          : { data: (spec.rows ?? []).slice(from, to + 1), error: null });
        return chain;
      },
    };
  }

  it('uma consulta de 2º estágio que falha aborta a leitura', async () => {
    const { gatherIntelligenceFacts, IncompleteIntelligenceRead } = await import('@/lib/supply/intelligence-read');
    const client = fakeClient({
      supply_requirement_coverage: { rows: [{ requirement_id: 'r1', item_id: 'i1', project_id: 'p1', organization_id: 'o',
        required_qty: 10, reserved_qty: 0, consumed_qty: 0, in_transit_qty: 0, transfer_requested_qty: 0, on_order_qty: 0,
        requested_qty: 0, inspection_qty: 0, shortage_qty: 10, required_by: '2026-10-01', unit: 'm' }] },
      purchase_order_line_requirements: { error: 'URI too long' },
    });
    await expect(gatherIntelligenceFacts('o', '2026-09-24', client as never)).rejects.toBeInstanceOf(IncompleteIntelligenceRead);
  });
  it('pagina além do teto de 1000 linhas em vez de cortar', async () => {
    const { gatherIntelligenceFacts } = await import('@/lib/supply/intelligence-read');
    const locations = Array.from({ length: 2300 }, (_, i) => ({ id: `l${i}`, name: `L${i}`, kind: 'WAREHOUSE', project_id: null, active: true }));
    const facts = await gatherIntelligenceFacts('o', '2026-09-24', fakeClient({ inventory_locations: { rows: locations } }) as never);
    expect(facts.requirements).toEqual([]);
  });
  it('leitura incompleta não chama o sync (nenhuma recomendação resolvida por engano)', async () => {
    const rpc = vi.fn();
    vi.doMock('@/lib/platform/server-client', () => ({
      platformServiceClient: () => fakeClient({ purchase_orders: { error: 'timeout' } }, rpc),
    }));
    vi.resetModules();
    const { runSupplyIntelligence, IncompleteIntelligenceRead } = await import('@/lib/supply/intelligence-read');
    await expect(runSupplyIntelligence('o', '2026-09-24')).rejects.toBeInstanceOf(IncompleteIntelligenceRead);
    expect(rpc).not.toHaveBeenCalled();
    vi.doUnmock('@/lib/platform/server-client');
    vi.resetModules();
  });
});

// ── Relógio da plataforma ─────────────────────────────────────────────────
describe('agendamento e rotas por capacidade', () => {
  afterEach(() => { vi.resetModules(); vi.doUnmock('@/lib/platform/server-client'); vi.restoreAllMocks(); });

  it('a reconciliação de aprovações é um tipo de trabalho com schema e handler', async () => {
    const { JOB_TYPES, JOB_SCHEMAS } = await import('@/lib/platform/jobs/registry');
    const { JOB_HANDLERS } = await import('@/lib/platform/jobs/handlers');
    expect(JOB_TYPES).toContain('procurement.purchase_order.reconcile_approvals');
    expect(JOB_SCHEMAS['procurement.purchase_order.reconcile_approvals'][1].safeParse({ reason: 'scheduled' }).success).toBe(true);
    for (const t of JOB_TYPES) expect(JOB_HANDLERS[t], t).toBeDefined();
  });
  it('produtores enfileiram a leitura da Apex e a reconciliação pelo relógio', async () => {
    const { SCHEDULED_PRODUCERS } = await import('@/lib/platform/jobs/producers');
    const names = SCHEDULED_PRODUCERS.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['supply.intelligence.sweep', 'procurement.purchase_order.reconcile_approvals']));
    const rpc = vi.fn(async () => ({ data: 2, error: null }));
    const at = new Date('2026-09-24T13:47:00Z');
    for (const p of SCHEDULED_PRODUCERS.filter((x) => x.ownerDomain === 'supply')) {
      expect(await p.produce({ rpc } as never, at)).toBe(2);
    }
    expect(rpc).toHaveBeenCalledWith('supply_intelligence_enqueue_sweep', { p_as_of: at.toISOString() });
    expect(rpc).toHaveBeenCalledWith('purchase_order_enqueue_approval_reconcile', { p_as_of: at.toISOString() });
  });
  it('a passagem liga rotas por capacidade ANTES de rotear, com o vocabulário deste código', async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const client = {
      rpc: vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
        calls.push({ fn, args });
        if (fn === 'apex_jobs_reap') return { data: [{ released: 0, dead_lettered: 0 }], error: null };
        if (fn === 'apex_route_pending_events') return { data: [{ events_routed: 0, jobs_created: 0, events_failed: 0 }], error: null };
        if (fn === 'apex_event_routes_activate_for') return { data: 5, error: null };
        if (fn === 'apex_jobs_claim') return { data: [], error: null };
        return { data: 0, error: null };
      }),
      from: vi.fn(() => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) })),
    };
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.doMock('@/lib/platform/server-client', () => ({ platformServiceClient: () => client, __resetPlatformServiceClient: () => undefined }));
    vi.resetModules();
    const { drainOnce, DEFAULT_LIMITS } = await import('@/lib/platform/jobs/worker');
    const { JOB_TYPES } = await import('@/lib/platform/jobs/registry');
    const counters = await drainOnce(DEFAULT_LIMITS, 'test-worker');
    const order = calls.map((c) => c.fn);
    expect(order.indexOf('apex_event_routes_activate_for')).toBeGreaterThan(-1);
    expect(order.indexOf('apex_event_routes_activate_for')).toBeLessThan(order.indexOf('apex_route_pending_events'));
    expect(calls.find((c) => c.fn === 'apex_event_routes_activate_for')?.args).toEqual({ p_job_types: [...JOB_TYPES] });
    expect(counters.routes_activated).toBe(5);
  });
  it('falha ao ligar rotas não derruba a passagem', async () => {
    const client = {
      rpc: vi.fn(async (fn: string) => {
        if (fn === 'apex_event_routes_activate_for') return { data: null, error: { message: 'function does not exist' } };
        if (fn === 'apex_jobs_reap') return { data: [{ released: 0, dead_lettered: 0 }], error: null };
        if (fn === 'apex_route_pending_events') return { data: [{ events_routed: 0, jobs_created: 0, events_failed: 0 }], error: null };
        if (fn === 'apex_jobs_claim') return { data: [], error: null };
        return { data: 0, error: null };
      }),
      from: vi.fn(() => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) })),
    };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.doMock('@/lib/platform/server-client', () => ({ platformServiceClient: () => client, __resetPlatformServiceClient: () => undefined }));
    vi.resetModules();
    const { drainOnce, DEFAULT_LIMITS } = await import('@/lib/platform/jobs/worker');
    const counters = await drainOnce(DEFAULT_LIMITS, 'test-worker');
    expect(counters.routes_activated).toBe(0);
    expect(client.rpc).toHaveBeenCalledWith('apex_route_pending_events', expect.anything());
  });
});
