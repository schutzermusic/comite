/**
 * O trabalhador, com o banco simulado.
 *
 * O que se prova aqui é a DISCIPLINA da passagem: ela para dentro do
 * orçamento, respeita o lote, despacha por tipo, trata tipo/versão/payload
 * desconhecidos como terminais, não deixa uma falha contaminar o trabalho
 * seguinte e não despeja payload no log.
 *
 * O comportamento do BANCO (SKIP LOCKED, concessão, ceifa) não se simula: está
 * em scripts/assert-contracts-v2-phase4.sql e em
 * tests/integration/platform-event-graph-live.test.ts, contra Postgres real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drainOnce, DEFAULT_LIMITS } from '@/lib/platform/jobs/worker';
import { __resetPlatformServiceClient } from '@/lib/platform/server-client';

/** O que o cliente do Supabase devolve, no mínimo que o trabalhador usa. */
type RpcResult = { data: unknown; error: { message: string } | null };

interface FakeJob {
  id: string; organization_id: string; event_id: string | null; job_type: string;
  payload_version: number; idempotency_key: string; payload: Record<string, unknown>;
  attempt_count: number; max_attempts: number; lock_token: string; correlation_id: string | null;
}

const ORG = '00000000-0000-4000-8000-000000000001';

function job(over: Partial<FakeJob> = {}): FakeJob {
  return {
    id: crypto.randomUUID(), organization_id: ORG, event_id: null,
    job_type: 'contracts.obligations.materialize', payload_version: 1,
    idempotency_key: 'k', payload: { as_of: '2026-03-10', horizon_days: 30 },
    attempt_count: 1, max_attempts: 5, lock_token: crypto.randomUUID(),
    correlation_id: null, ...over,
  };
}

/** Fila simulada: devolve lotes na ordem em que foram programados. */
function fakeSupabase(batches: FakeJob[][], overrides: Record<string, unknown> = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  let batchIndex = 0;
  const client = {
    calls,
    rpc: vi.fn(async (fn: string, args: Record<string, unknown> = {}): Promise<RpcResult> => {
      calls.push({ fn, args });
      if (fn in overrides) return { data: overrides[fn], error: null };
      switch (fn) {
        case 'apex_jobs_reap': return { data: [{ released: 0, dead_lettered: 0 }], error: null };
        case 'apex_route_pending_events':
          return { data: [{ events_routed: 0, jobs_created: 0, events_failed: 0 }], error: null };
        case 'contracts_enqueue_obligation_materialization': return { data: 0, error: null };
        case 'apex_jobs_claim': return { data: batches[batchIndex++] ?? [], error: null };
        case 'apex_jobs_complete': return { data: true, error: null };
        case 'apex_jobs_fail': return { data: 'PENDING', error: null };
        case 'contracts_run_obligation_materialization':
          return { data: { definitions: 1, occurrences_created: 0 }, error: null };
        default: return { data: null, error: null };
      }
    }),
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      update: () => ({ eq: async () => ({ data: null, error: null }) }),
    })),
  };
  return client;
}

let logs: unknown[][] = [];

beforeEach(() => {
  __resetPlatformServiceClient();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://exemplo.supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-de-servico-secreta';
  logs = [];
  vi.spyOn(console, 'info').mockImplementation((...args) => { logs.push(args); });
  vi.spyOn(console, 'error').mockImplementation((...args) => { logs.push(args); });
  vi.spyOn(console, 'warn').mockImplementation((...args) => { logs.push(args); });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('@/lib/platform/server-client');
  __resetPlatformServiceClient();
});

async function runWith(client: unknown, limits = DEFAULT_LIMITS) {
  vi.doMock('@/lib/platform/server-client', () => ({
    platformServiceClient: () => client,
    __resetPlatformServiceClient: () => undefined,
  }));
  vi.resetModules();
  const mod = await import('@/lib/platform/jobs/worker');
  return mod.drainOnce(limits, 'test-worker');
}

describe('a ordem da passagem', () => {
  it('ceifa antes de reivindicar, e roteia antes de executar', async () => {
    const client = fakeSupabase([[]]);
    await runWith(client);
    const order = client.calls.map((c) => c.fn);
    /*
      Ceifar primeiro porque trabalho preso em PROCESSING não aparece como
      pendente: sem devolvê-lo antes, ele esperaria a próxima volta inteira.
      Rotear antes de reivindicar porque o trabalho recém-criado pode ser
      executado NESTA passagem.
    */
    expect(order.indexOf('apex_jobs_reap')).toBeLessThan(order.indexOf('apex_route_pending_events'));
    expect(order.indexOf('apex_route_pending_events')).toBeLessThan(order.indexOf('apex_jobs_claim'));
  });

  it('roda os produtores agendados a cada passagem', async () => {
    const client = fakeSupabase([[]]);
    await runWith(client);
    expect(client.calls.some((c) => c.fn === 'contracts_enqueue_obligation_materialization')).toBe(true);
  });

  it('um produtor que falha não derruba a passagem', async () => {
    const client = fakeSupabase([[job()], []]);
    client.rpc.mockImplementation(async (fn: string, args: Record<string, unknown> = {}): Promise<RpcResult> => {
      client.calls.push({ fn, args });
      if (fn === 'contracts_enqueue_obligation_materialization') {
        return { data: null, error: { message: 'produtor quebrou' } };
      }
      if (fn === 'apex_jobs_reap') return { data: [{ released: 0, dead_lettered: 0 }], error: null };
      if (fn === 'apex_route_pending_events') {
        return { data: [{ events_routed: 0, jobs_created: 0, events_failed: 0 }], error: null };
      }
      if (fn === 'apex_jobs_claim') {
        return { data: client.calls.filter((c) => c.fn === 'apex_jobs_claim').length === 1 ? [job()] : [], error: null };
      }
      if (fn === 'apex_jobs_complete') return { data: true, error: null };
      return { data: { occurrences_created: 0 }, error: null };
    });
    const counters = await runWith(client);
    // O resto da fila continua sendo trabalho legítimo.
    expect(counters.completed).toBe(1);
  });
});

describe('limites', () => {
  it('o lote máximo é respeitado', async () => {
    const many = Array.from({ length: 5 }, () => job());
    const client = fakeSupabase([many, many, many, many, many, many]);
    const counters = await runWith(client, { ...DEFAULT_LIMITS, maxJobs: 10 });
    expect(counters.claimed).toBe(10);
    expect(counters.completed).toBe(10);
  });

  it('para dentro do orçamento e deixa o resto DURÁVEL', async () => {
    const client = fakeSupabase(Array.from({ length: 20 }, () => [job()]));
    const counters = await runWith(client, { ...DEFAULT_LIMITS, maxJobs: 100, timeBudgetMs: 1 });
    /*
      Parar de propósito, com trabalho ainda na fila, é a decisão correta: o
      que sobra é durável e a próxima batida continua. Um trabalhador que tenta
      esvaziar a fila é derrubado pela hospedagem no meio da última tentativa,
      e o que sobra é uma concessão órfã por passagem.
    */
    expect(counters.stopped_early).toBe(true);
    expect(counters.claimed).toBeLessThan(100);
  });

  it('a concessão é maior que o orçamento da passagem', () => {
    // Concessão mais curta que a execução seria ceifada debaixo de um
    // trabalhador que ainda está trabalhando.
    expect(DEFAULT_LIMITS.leaseSeconds * 1000).toBeGreaterThan(DEFAULT_LIMITS.timeBudgetMs);
  });
});

describe('despacho tipado', () => {
  it('tipo de trabalho desconhecido é TERMINAL', async () => {
    const client = fakeSupabase([[job({ job_type: 'inventado.qualquer.coisa' })], []],
      { apex_jobs_fail: 'DEAD_LETTER' });
    const counters = await runWith(client);
    expect(counters.dead_letter).toBe(1);
    const fail = client.calls.find((c) => c.fn === 'apex_jobs_fail');
    expect(fail?.args.p_retryable).toBe(false);
    expect(fail?.args.p_error_code).toBe('unknown_job_type');
  });

  it('versão de payload não entendida é TERMINAL', async () => {
    const client = fakeSupabase([[job({ payload_version: 99 })], []],
      { apex_jobs_fail: 'DEAD_LETTER' });
    const counters = await runWith(client);
    expect(counters.dead_letter).toBe(1);
    expect(client.calls.find((c) => c.fn === 'apex_jobs_fail')?.args.p_error_code)
      .toBe('unsupported_payload_version');
  });

  it('payload malformado é TERMINAL, não um trabalhador em laço', async () => {
    const client = fakeSupabase([[job({ payload: { as_of: 'sem horizonte' } })], []],
      { apex_jobs_fail: 'DEAD_LETTER' });
    const counters = await runWith(client);
    expect(counters.dead_letter).toBe(1);
    expect(client.calls.find((c) => c.fn === 'apex_jobs_fail')?.args.p_retryable).toBe(false);
  });

  it('a perda da concessão durante a execução não é conclusão', async () => {
    const client = fakeSupabase([[job()], []], { apex_jobs_complete: false });
    const counters = await runWith(client);
    expect(counters.completed).toBe(0);
    expect(counters.stale_completions).toBe(1);
  });
});

describe('isolamento entre trabalhos', () => {
  it('um trabalho quebrado não impede o seguinte', async () => {
    const bom = job();
    const ruim = job({ job_type: 'inventado.qualquer.coisa' });
    const client = fakeSupabase([[ruim, bom], []], { apex_jobs_fail: 'DEAD_LETTER' });
    const counters = await runWith(client);
    expect(counters.dead_letter).toBe(1);
    expect(counters.completed).toBe(1);
  });
});

describe('o log', () => {
  it('carrega identificadores e NÃO carrega payload nem segredo', async () => {
    const j = job({ payload: { as_of: '2026-03-10', horizon_days: 30 } });
    const client = fakeSupabase([[j], []]);
    await runWith(client);

    const line = logs.find((l) => String(l[0]).includes('[apex-worker]'));
    expect(line).toBeDefined();
    const rendered = JSON.stringify(line);
    // Os identificadores que tornam uma falha rastreável.
    expect(rendered).toContain(j.id);
    expect(rendered).toContain(j.organization_id);
    expect(rendered).toContain('contracts.obligations.materialize');
    expect(rendered).toContain('"attempt"');
    // O payload é onde nome de arquivo e trecho de contrato aparecem juntos.
    expect(rendered).not.toContain('horizon_days');
    expect(rendered).not.toContain('chave-de-servico-secreta');
    // O token de posse não vira log: quem lê o log não deveria poder concluir
    // o trabalho de outro.
    expect(rendered).not.toContain(j.lock_token);
  });
});
