/**
 * A TRAVA OPERACIONAL da fila do Apex.
 *
 * ─── O que ela precisa garantir ────────────────────────────────────────────
 *
 * Que a passagem não COMEÇA. Não que ela comece e desista no meio: a ceifa, os
 * produtores, o roteamento e a execução escrevem, cada um à sua maneira, e uma
 * trava que só impedisse a última já teria devolvido trabalho à fila e
 * consumido tentativa antes de parar.
 *
 * O teste, portanto, não pergunta "quantos trabalhos rodaram". Ele conta
 * CHAMADAS AO BANCO: sob trava, o número tem de ser zero — nem sequer a
 * ceifa, que é a primeira coisa que a passagem faz.
 *
 * ─── Por que a guarda mora no trabalhador ──────────────────────────────────
 *
 * Seis rotas de produto acordam a fila por `after()`, mais o cron, mais o
 * operador. Seis guardas independentes seriam seis lugares para esquecer um, e
 * o sétimo caminho nasceria desprotegido. `drainOnce` é por onde todos passam.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isDrainPaused, DRAIN_PAUSE_ENV } from '@/lib/platform/jobs/hold';

/** O cliente do banco, com TODA chamada registrada. */
function recordingClient(jobs: Record<string, unknown>[] = []) {
  const calls: string[] = [];
  let claimed = false;
  return {
    calls,
    rpc: vi.fn(async (fn: string) => {
      calls.push(fn);
      if (fn === 'apex_jobs_reap') return { data: [{ released: 1, dead_lettered: 0 }], error: null };
      if (fn === 'apex_route_pending_events') {
        return { data: [{ events_routed: 0, jobs_created: 0, events_failed: 0 }], error: null };
      }
      if (fn === 'apex_jobs_claim') {
        if (claimed) return { data: [], error: null };
        claimed = true;
        return { data: jobs, error: null };
      }
      if (fn === 'apex_jobs_complete') return { data: true, error: null };
      return { data: null, error: null };
    }),
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      update: () => ({ eq: async () => ({ data: null, error: null }) }),
    })),
  };
}

async function drainWith(client: unknown) {
  vi.doMock('@/lib/platform/server-client', () => ({
    platformServiceClient: () => client,
    __resetPlatformServiceClient: () => undefined,
  }));
  vi.resetModules();
  const { drainOnce, DEFAULT_LIMITS } = await import('@/lib/platform/jobs/worker');
  return drainOnce(DEFAULT_LIMITS, 'test-worker');
}

/** Um trabalho reivindicável — o que a trava tem de impedir de ser tocado. */
const materializeJob = {
  id: 'job-1', organization_id: '00000000-0000-4000-8000-000000000001', event_id: null,
  job_type: 'contracts.obligations.materialize', payload_version: 1, idempotency_key: 'k',
  payload: { as_of: '2026-09-13', horizon_days: 30 }, attempt_count: 2, max_attempts: 3,
  lock_token: 'tok', correlation_id: null,
};

beforeEach(() => {
  delete process.env[DRAIN_PAUSE_ENV];
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://exemplo.supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-de-servico';
  vi.resetModules();
});
afterEach(() => {
  delete process.env[DRAIN_PAUSE_ENV];
  vi.doUnmock('@/lib/platform/server-client');
  vi.restoreAllMocks();
});

describe('a leitura da trava', () => {
  it('só a string exata "true" pausa', () => {
    process.env[DRAIN_PAUSE_ENV] = 'true';
    expect(isDrainPaused()).toBe(true);
    process.env[DRAIN_PAUSE_ENV] = ' true ';
    expect(isDrainPaused()).toBe(true);
  });

  it('ausente, vazia ou qualquer outro valor NÃO pausa', () => {
    /*
      Uma trava que ligasse com '1' ou com qualquer coisa não-vazia acabaria
      ligada por um valor colado sem querer — e fila parada em silêncio é um
      incidente que ninguém vê.
    */
    expect(isDrainPaused()).toBe(false);
    for (const value of ['', 'false', '1', 'yes', 'TRUE', 'True', 'on', 'sim']) {
      process.env[DRAIN_PAUSE_ENV] = value;
      expect(isDrainPaused()).toBe(false);
    }
  });
});

describe('sob trava, a passagem NÃO começa', () => {
  it('zero chamadas ao banco — nem a ceifa, que é a primeira coisa', async () => {
    process.env[DRAIN_PAUSE_ENV] = 'true';
    const client = recordingClient([materializeJob]);
    const counters = await drainWith(client);

    expect(counters.paused).toBe(true);
    // A prova inteira: nenhuma ida ao banco, de nenhum tipo.
    expect(client.calls).toEqual([]);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('não ceifa: nenhuma concessão vencida é devolvida à fila', async () => {
    process.env[DRAIN_PAUSE_ENV] = 'true';
    const client = recordingClient();
    const counters = await drainWith(client);
    expect(client.calls).not.toContain('apex_jobs_reap');
    expect(counters.reaped_released).toBe(0);
    expect(counters.reaped_dead_lettered).toBe(0);
  });

  it('não reivindica: nenhum trabalho ganha dono, concessão ou tentativa', async () => {
    process.env[DRAIN_PAUSE_ENV] = 'true';
    const client = recordingClient([materializeJob]);
    const counters = await drainWith(client);
    expect(client.calls).not.toContain('apex_jobs_claim');
    expect(counters.claimed).toBe(0);
  });

  it('não executa handler, e portanto não alcança provedor nenhum', async () => {
    process.env[DRAIN_PAUSE_ENV] = 'true';
    const client = recordingClient([materializeJob]);
    const counters = await drainWith(client);
    // O handler deste tipo chamaria `contracts_run_obligation_materialization`.
    expect(client.calls).not.toContain('contracts_run_obligation_materialization');
    expect(counters.completed).toBe(0);
    expect(counters.retried).toBe(0);
    expect(counters.dead_letter).toBe(0);
  });

  it('não conclui nem falha nada: status e attempt_count ficam intactos', async () => {
    process.env[DRAIN_PAUSE_ENV] = 'true';
    const client = recordingClient([materializeJob]);
    await drainWith(client);
    for (const mutation of ['apex_jobs_complete', 'apex_jobs_fail', 'apex_jobs_enqueue']) {
      expect(client.calls).not.toContain(mutation);
    }
  });

  it('não roteia eventos: nenhum trabalho novo nasce durante a trava', async () => {
    process.env[DRAIN_PAUSE_ENV] = 'true';
    const client = recordingClient();
    const counters = await drainWith(client);
    expect(client.calls).not.toContain('apex_route_pending_events');
    expect(counters.jobs_created).toBe(0);
  });

  it('registra UMA linha por passagem, e não uma por trabalho na fila', async () => {
    process.env[DRAIN_PAUSE_ENV] = 'true';
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const client = recordingClient(Array.from({ length: 25 }, () => materializeJob));
    await drainWith(client);
    const held = info.mock.calls.filter(([first]) =>
      String(first).includes('drain paused by operational hold'));
    expect(held).toHaveLength(1);
    // E a linha não carrega o valor da variável, só o nome dela.
    expect(JSON.stringify(info.mock.calls)).not.toContain('"true"');
  });
});

describe('o caminho rápido', () => {
  it('é um no-op sob trava: nem agenda a batida', async () => {
    process.env[DRAIN_PAUSE_ENV] = 'true';
    const after = vi.fn();
    vi.doMock('next/server', () => ({ after }));
    vi.resetModules();
    const { scheduleFastDrain } = await import('@/lib/platform/jobs/fast-path');
    scheduleFastDrain('teste');
    expect(after).not.toHaveBeenCalled();
    vi.doUnmock('next/server');
  });

  it('sem trava, continua agendando normalmente', async () => {
    const after = vi.fn();
    vi.doMock('next/server', () => ({ after }));
    vi.resetModules();
    const { scheduleFastDrain } = await import('@/lib/platform/jobs/fast-path');
    scheduleFastDrain('teste');
    expect(after).toHaveBeenCalledTimes(1);
    vi.doUnmock('next/server');
  });
});

describe('sem a trava, o comportamento é EXATAMENTE o de hoje', () => {
  it('o padrão — variável ausente — drena como sempre', async () => {
    const client = recordingClient([materializeJob]);
    const counters = await drainWith(client);

    expect(counters.paused).toBe(false);
    expect(client.calls).toContain('apex_jobs_reap');
    expect(client.calls).toContain('apex_route_pending_events');
    expect(client.calls).toContain('apex_jobs_claim');
    expect(counters.claimed).toBe(1);
    expect(counters.completed).toBe(1);
  });

  it('com a variável em "false", idem', async () => {
    process.env[DRAIN_PAUSE_ENV] = 'false';
    const client = recordingClient([materializeJob]);
    const counters = await drainWith(client);
    expect(counters.paused).toBe(false);
    expect(counters.claimed).toBe(1);
  });
});

describe('a rota de drenagem', () => {
  const call = async (paused: boolean) => {
    if (paused) process.env[DRAIN_PAUSE_ENV] = 'true';
    process.env.APEX_JOBS_SECRET = 'segredo-de-teste';
    const drainOnce = vi.fn(async () => ({
      reaped_released: 0, reaped_dead_lettered: 0, producers_enqueued: 0, events_routed: 0,
      events_routing_failed: 0, jobs_created: 0, claimed: 0, completed: 0, retried: 0,
      dead_letter: 0, stale_completions: 0, duration_ms: 1, stopped_early: false, paused: false,
    }));
    vi.doMock('@/lib/platform/jobs/worker', () => ({ drainOnce, DEFAULT_LIMITS: {} }));
    vi.resetModules();
    const { POST } = await import('@/app/api/platform/jobs/drain/route');
    const res = await POST(new Request('https://exemplo.test/api/platform/jobs/drain', {
      method: 'POST', headers: { authorization: 'Bearer segredo-de-teste' },
    }));
    vi.doUnmock('@/lib/platform/jobs/worker');
    return { res, body: await res.json() as Record<string, unknown>, drainOnce };
  };

  afterEach(() => { delete process.env.APEX_JOBS_SECRET; });

  it('sob trava devolve 200 com paused:true, e NÃO drena', async () => {
    const { res, body, drainOnce } = await call(true);
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.paused).toBe(true);
    // E não relata trabalho processado: contadores zerados sem `paused` seriam
    // indistinguíveis de uma fila vazia, que é a leitura errada.
    expect(body.counters).toBeUndefined();
    expect(drainOnce).not.toHaveBeenCalled();
  });

  it('200 e não 5xx: a trava não pode parecer um cron quebrado', async () => {
    /*
      Um erro faria o agendador da hospedagem registrar o cron como defeituoso,
      alertar e eventualmente desabilitá-lo — e a trava, que é temporária,
      viraria um problema de infraestrutura para consertar depois.
    */
    const { res } = await call(true);
    expect(res.status).toBe(200);
    expect(res.status).toBeLessThan(300);
  });

  it('sem trava, drena e responde com os contadores', async () => {
    const { body, drainOnce } = await call(false);
    expect(body.paused).toBe(false);
    expect(body.counters).toBeDefined();
    expect(drainOnce).toHaveBeenCalledTimes(1);
  });

  it('a autenticação continua intacta: sem Bearer não passa, pausado ou não', async () => {
    process.env[DRAIN_PAUSE_ENV] = 'true';
    process.env.APEX_JOBS_SECRET = 'segredo-de-teste';
    vi.resetModules();
    const { POST } = await import('@/app/api/platform/jobs/drain/route');
    const res = await POST(new Request('https://exemplo.test/api/platform/jobs/drain',
      { method: 'POST' }));
    // A trava é lida DEPOIS do portão: quem não pode drenar também não precisa
    // saber se a drenagem está pausada.
    expect(res.status).toBe(401);
    expect(await res.json()).not.toMatchObject({ paused: true });
  });
});

describe('o que a trava NÃO faz', () => {
  it('não toca em nenhuma linha da fila — o módulo não tem escrita nenhuma', async () => {
    const { readFileSync } = await import('node:fs');
    const hold = readFileSync('src/lib/platform/jobs/hold.ts', 'utf8');
    /*
      Segurar a fila mexendo nos trabalhos trocaria um estado verdadeiro
      ("vencido, esperando") por um forjado ("agendado para o ano que vem"), e
      exigiria lembrar de desfazer a mentira depois.
    */
    for (const forbidden of ['update', 'insert', 'delete', 'rpc', 'supabase', 'run_after']) {
      expect(hold.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('não exige migration: é variável de ambiente, e o banco não sabe dela', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    /*
      A trava nasceu como hotfix contra a ponta 167 e continua sem exigir nada
      do banco depois de a linha de recuperação trazer a 168. Fixar a ponta
      global aqui só diria "sou a migration mais nova", que não é o que este
      teste afirma: ele afirma que a TRAVA não depende de esquema.
    */
    expect(readdirSync('supabase/migrations')
      .some((f) => /^\d{3}_.*\.sql$/.test(f))).toBe(true);
    for (const file of ['src/lib/platform/jobs/hold.ts',
      'src/app/api/platform/jobs/drain/route.ts']) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toContain('execution_job_id');
      expect(text).not.toContain('168');
    }
  });
});
