/**
 * A FRONTEIRA de execução entre extração de cláusulas e operacionalização.
 *
 * ─── O defeito que estes testes cercam ─────────────────────────────────────
 *
 * Um único trabalho `contracts.clause_extraction.execute` executava DUAS etapas
 * longas de provedor em sequência, dentro da mesma invocação da hospedagem. Uma
 * execução real gastou ~232s na primeira e começou a segunda com ~66s de vida
 * restante; a segunda pedia até 180s. O host matou o processo. Nenhum `catch`
 * rodou, nenhum estado terminal foi escrito — porque quem escreveria o
 * diagnóstico era o processo que deixou de existir.
 *
 * O que se prova aqui é estrutural, e não estatístico: não que a etapa longa
 * "costuma caber", mas que ela é a ÚNICA da sua invocação, que o pior caso
 * declarado cabe no tempo de vida declarado, e que repetir a operacionalização
 * nunca repete a extração.
 *
 * Nenhum teste aqui chama a Anthropic. O provedor é simulado; o que se lê do
 * código real é a POLÍTICA da tarefa e a forma dos handlers.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APEX_CONFIGURED_HOST_CEILING,
  HOST_MAX_DURATION_SECONDS,
  JOB_LEASE_SECONDS,
  LATEST_SAFE_CLAIM_MS,
  LONG_JOB_WORST_CASE_MS,
  LONG_PROVIDER_MAX_ATTEMPTS,
  LONG_PROVIDER_TIMEOUT_MS,
  PERSISTENCE_MARGIN_MS,
  drainBudgetFitsHost,
} from '@/lib/platform/jobs/budget';
import { JOB_TYPES, parseJobPayload } from '@/lib/platform/jobs/registry';
import { getApexAITaskPolicy } from '@/lib/ai/gateway/task-registry';

const source = (relative: string) =>
  readFileSync(resolve(process.cwd(), relative), 'utf8');

const ORG = '00000000-0000-4000-8000-000000000001';
const REQUEST = '00000000-0000-4000-8000-000000000101';
const CONTRACT = '00000000-0000-4000-8000-000000000102';
const DOCUMENT = '00000000-0000-4000-8000-000000000103';
const ACTOR = '00000000-0000-4000-8000-000000000104';
const OPS_VERSION = 'contract-operationalization/1.0.0';

/**
 * O mínimo de Supabase que os dois handlers usam: `rpc` registrado e `from`
 * devolvendo a linha do pedido durável. O provedor NUNCA é alcançado — os
 * módulos de IA são substituídos por `vi.doMock` em cada teste.
 */
function fakeSupabase(requestRow: Record<string, unknown> | null, enqueuedId = 'job-ops-1') {
  const rpc: { fn: string; args: Record<string, unknown> }[] = [];
  const updates: { table: string; value: Record<string, unknown> }[] = [];
  const client = {
    rpc,
    updates,
    enqueueCalls: () => rpc.filter((c) => c.fn === 'apex_jobs_enqueue'),
  } as unknown as Record<string, unknown>;
  Object.assign(client, {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
      rpc.push({ fn, args });
      if (fn === 'apex_jobs_enqueue') return { data: enqueuedId, error: null };
      return { data: null, error: null };
    }),
    from: vi.fn((table: string) => {
      const builder: Record<string, unknown> = {};
      Object.assign(builder, {
        select: () => builder,
        update: (value: Record<string, unknown>) => { updates.push({ table, value }); return builder; },
        eq: () => builder,
        order: () => builder,
        /*
          A guarda de extração pergunta "esta execução já concluiu a leitura?".
          Aqui a resposta é sempre NÃO: estes testes são sobre a fronteira entre
          as duas etapas, e a reutilização de leitura persistida tem a sua
          própria suíte (contracts-job-recovery-plane.test.ts).
        */
        limit: async () => ({ data: [], error: null }),
        maybeSingle: async () => ({ data: requestRow, error: null }),
        then: (r: (v: { data: null; error: null }) => unknown) => r({ data: null, error: null }),
      });
      return builder;
    }),
  });
  return client as unknown as {
    rpc: ReturnType<typeof vi.fn>;
    from: ReturnType<typeof vi.fn>;
  } & { updates: { table: string; value: Record<string, unknown> }[] } & Record<string, unknown>;
}

const claimedJob = (jobType: string) => ({
  id: 'job-1', organization_id: ORG, event_id: null, job_type: jobType,
  payload_version: 1, idempotency_key: 'k', payload: {},
  attempt_count: 1, max_attempts: 3, lock_token: 'tok', correlation_id: null,
});

const requestRow = {
  id: REQUEST, organization_id: ORG, contract_id: CONTRACT,
  document_id: DOCUMENT, status: 'QUEUED', requested_by: ACTOR,
};

async function loadHandlers() {
  return (await import('@/lib/platform/jobs/handlers')).JOB_HANDLERS;
}

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.doUnmock('@/lib/ai/contract-clause-extractor');
  vi.doUnmock('@/lib/ai/contract-operationalization'); vi.restoreAllMocks(); });

describe('uma etapa longa de provedor por execução', () => {
  it('a extração de cláusulas NÃO chama a operacionalização em linha', async () => {
    const extract = vi.fn(async () => ({ analysisId: 'a1', proposedCount: 2, rejectedCount: 0 }));
    const operationalize = vi.fn(async () => { throw new Error('não deveria ser chamada'); });
    vi.doMock('@/lib/ai/contract-clause-extractor', () => ({ extractClausesFromDocument: extract }));
    vi.doMock('@/lib/ai/contract-operationalization', () => ({
      operationalizeContractDocument: operationalize,
      OPERATIONALIZATION_VERSION: OPS_VERSION,
    }));

    const handlers = await loadHandlers();
    const supabase = fakeSupabase(requestRow);
    await handlers['contracts.clause_extraction.execute'].run(
      { request_id: REQUEST, contract_id: CONTRACT, document_id: DOCUMENT },
      { job: claimedJob('contracts.clause_extraction.execute'), supabase: supabase as never,
        remainingMs: () => 50_000 },
    );

    expect(extract).toHaveBeenCalledTimes(1);
    // O ponto inteiro desta mudança: a segunda etapa longa não acontece aqui.
    expect(operationalize).not.toHaveBeenCalled();
  });

  it('o texto do handler de extração não alcança a operacionalização', () => {
    const handlers = source('src/lib/platform/jobs/handlers.ts');
    const extraction = handlers.slice(
      handlers.indexOf("const clauseExtraction: JobHandler"),
      handlers.indexOf("interface ClauseExtractionRequestRow"),
    );
    // A única menção à operacionalização dentro da extração é o ENFILEIRAMENTO.
    expect(extraction).not.toContain('operationalizeContractDocument');
    expect(extraction).toContain('enqueueContractOperationalization');
  });

  it('a extração bem-sucedida enfileira UM trabalho de operacionalização', async () => {
    vi.doMock('@/lib/ai/contract-clause-extractor', () => ({
      extractClausesFromDocument: vi.fn(async () => ({
        analysisId: 'a1', proposedCount: 3, rejectedCount: 1,
      })),
    }));
    vi.doMock('@/lib/ai/contract-operationalization', () => ({
      operationalizeContractDocument: vi.fn(),
      OPERATIONALIZATION_VERSION: OPS_VERSION,
    }));

    const handlers = await loadHandlers();
    const supabase = fakeSupabase(requestRow);
    const result = await handlers['contracts.clause_extraction.execute'].run(
      { request_id: REQUEST, contract_id: CONTRACT, document_id: DOCUMENT },
      { job: claimedJob('contracts.clause_extraction.execute'), supabase: supabase as never,
        remainingMs: () => 50_000 },
    );

    const enqueues = (supabase.rpc as ReturnType<typeof vi.fn>).mock.calls
      .filter(([fn]) => fn === 'apex_jobs_enqueue');
    expect(enqueues).toHaveLength(1);
    const [, args] = enqueues[0] as [string, Record<string, unknown>];
    expect(args.p_job_type).toBe('contracts.contract_operationalization.execute');
    expect(args.p_organization_id).toBe(ORG);
    expect(args.p_payload).toMatchObject({
      request_id: REQUEST, contract_id: CONTRACT,
      document_id: DOCUMENT, requested_by: ACTOR,
      operationalization_version: OPS_VERSION,
    });
    expect(result.operationalization_job_id).toBe('job-ops-1');

    // Enfileirar DEPOIS de fechar o pedido: na outra ordem, o trabalho a jusante
    // apontaria para um pedido que ainda diz RUNNING.
    expect(supabase.updates.map((u) => u.value.status)).toContain('COMPLETED');
  });

  it('o payload enfileirado carrega identidade, e nada de conteúdo', async () => {
    vi.doMock('@/lib/ai/contract-clause-extractor', () => ({
      extractClausesFromDocument: vi.fn(async () => ({
        analysisId: 'a1', proposedCount: 1, rejectedCount: 0,
      })),
    }));
    vi.doMock('@/lib/ai/contract-operationalization', () => ({
      operationalizeContractDocument: vi.fn(), OPERATIONALIZATION_VERSION: OPS_VERSION,
    }));
    const handlers = await loadHandlers();
    const supabase = fakeSupabase(requestRow);
    await handlers['contracts.clause_extraction.execute'].run(
      { request_id: REQUEST, contract_id: CONTRACT, document_id: DOCUMENT },
      { job: claimedJob('contracts.clause_extraction.execute'), supabase: supabase as never,
        remainingMs: () => 50_000 },
    );
    const [, args] = ((supabase.rpc as ReturnType<typeof vi.fn>).mock.calls
      .find(([fn]) => fn === 'apex_jobs_enqueue')) as [string, Record<string, unknown>];

    // O schema declarado é o contrato do payload, e ele é respeitado.
    const parsed = parseJobPayload(
      'contracts.contract_operationalization.execute', 1, args.p_payload);
    expect(Object.keys(parsed).sort()).toEqual([
      'contract_id', 'document_id', 'operationalization_version', 'request_id', 'requested_by',
    ]);
  });
});

describe('idempotência do enfileiramento', () => {
  async function keyFor(row: Record<string, unknown>) {
    vi.resetModules();
    vi.doMock('@/lib/ai/contract-clause-extractor', () => ({
      extractClausesFromDocument: vi.fn(async () => ({
        analysisId: 'a1', proposedCount: 1, rejectedCount: 0,
      })),
    }));
    vi.doMock('@/lib/ai/contract-operationalization', () => ({
      operationalizeContractDocument: vi.fn(), OPERATIONALIZATION_VERSION: OPS_VERSION,
    }));
    const handlers = await loadHandlers();
    const supabase = fakeSupabase(row);
    await handlers['contracts.clause_extraction.execute'].run(
      { request_id: row.id as string, contract_id: row.contract_id as string,
        document_id: row.document_id as string },
      { job: claimedJob('contracts.clause_extraction.execute'), supabase: supabase as never,
        remainingMs: () => 50_000 },
    );
    const [, args] = ((supabase.rpc as ReturnType<typeof vi.fn>).mock.calls
      .find(([fn]) => fn === 'apex_jobs_enqueue')) as [string, Record<string, unknown>];
    return args.p_idempotency_key as string;
  }

  it('a chave é DETERMINÍSTICA: duas execuções da extração produzem a mesma', async () => {
    const first = await keyFor(requestRow);
    await new Promise((r) => setTimeout(r, 5));
    const second = await keyFor(requestRow);
    expect(second).toBe(first);
    // Uma chave com relógio dentro faria cada tentativa criar mais uma
    // operacionalização cara do MESMO PDF.
    expect(first).not.toMatch(/\d{13}/);
    expect(first).toContain(CONTRACT);
    expect(first).toContain(DOCUMENT);
    expect(first).toContain(REQUEST);
    expect(first).toContain(OPS_VERSION);
  });

  it('documento diferente é trabalho diferente', async () => {
    const a = await keyFor(requestRow);
    const b = await keyFor({ ...requestRow, document_id: '00000000-0000-4000-8000-0000000001aa' });
    expect(a).not.toBe(b);
  });

  it('a unicidade real é do banco, e o conflito devolve o trabalho existente', () => {
    const migration = source('supabase/migrations/120_platform_apex_jobs.sql');
    expect(migration).toContain('CONSTRAINT aj_idempotent UNIQUE (organization_id, job_type, idempotency_key)');
    expect(migration).toContain('ON CONFLICT (organization_id, job_type, idempotency_key) DO NOTHING');
  });
});

describe('a repetição da operacionalização não repete a extração', () => {
  it('o handler dedicado roda a operacionalização e nada mais', async () => {
    const extract = vi.fn(async () => { throw new Error('não deveria ser chamada'); });
    const operationalize = vi.fn(async () => ({
      analysisId: 'ops-1', counts: {}, materializedInstances: 0,
      awaitingScheduleAnchor: 0, requiresAttention: 0,
    }));
    vi.doMock('@/lib/ai/contract-clause-extractor', () => ({ extractClausesFromDocument: extract }));
    vi.doMock('@/lib/ai/contract-operationalization', () => ({
      operationalizeContractDocument: operationalize, OPERATIONALIZATION_VERSION: OPS_VERSION,
    }));

    const handlers = await loadHandlers();
    const payload = {
      request_id: REQUEST, contract_id: CONTRACT, document_id: DOCUMENT,
      requested_by: ACTOR, operationalization_version: OPS_VERSION,
    };
    const supabase = fakeSupabase(requestRow);
    const job = { ...claimedJob('contracts.contract_operationalization.execute'), attempt_count: 2 };

    // Duas tentativas — uma reentrega, como a entrega at-least-once permite.
    await handlers['contracts.contract_operationalization.execute'].run(
      payload, { job, supabase: supabase as never, remainingMs: () => 250_000 });
    await handlers['contracts.contract_operationalization.execute'].run(
      payload, { job, supabase: supabase as never, remainingMs: () => 250_000 });

    expect(operationalize).toHaveBeenCalledTimes(2);
    expect(extract).not.toHaveBeenCalled();
    // E a repetição não enfileira mais nada: nenhuma cascata de trabalho.
    expect((supabase.rpc as ReturnType<typeof vi.fn>).mock.calls
      .filter(([fn]) => fn === 'apex_jobs_enqueue')).toHaveLength(0);
  });

  it('o texto do handler dedicado não conhece o extrator de cláusulas', () => {
    const handlers = source('src/lib/platform/jobs/handlers.ts');
    const body = handlers.slice(
      handlers.indexOf("const contractOperationalization: JobHandler"),
      handlers.indexOf("/**\n * Amendment onboarding"),
    );
    expect(body).not.toContain('contract-clause-extractor');
    expect(body).not.toContain('extractClausesFromDocument');
    expect(body).toContain('operationalizeContractDocument');
  });

  it('inquilino cruzado é TERMINAL, e antes de qualquer chamada ao provedor', async () => {
    const operationalize = vi.fn();
    vi.doMock('@/lib/ai/contract-operationalization', () => ({
      operationalizeContractDocument: operationalize, OPERATIONALIZATION_VERSION: OPS_VERSION,
    }));
    const handlers = await loadHandlers();
    await expect(handlers['contracts.contract_operationalization.execute'].run(
      { request_id: REQUEST, contract_id: CONTRACT, document_id: DOCUMENT,
        requested_by: null, operationalization_version: OPS_VERSION },
      { job: claimedJob('contracts.contract_operationalization.execute'),
        supabase: fakeSupabase(null) as never, remainingMs: () => 250_000 },
    )).rejects.toThrow(/não pertence à organização/);
    expect(operationalize).not.toHaveBeenCalled();
  });

  it('a falha do provedor alcança o caminho normal de catch e é classificada', async () => {
    vi.doMock('@/lib/ai/contract-operationalization', () => ({
      operationalizeContractDocument: vi.fn(async () => {
        throw Object.assign(new Error('Falha operacional injetada.'), { status: 422 });
      }),
      OPERATIONALIZATION_VERSION: OPS_VERSION,
    }));
    const handlers = await loadHandlers();
    const error = await handlers['contracts.contract_operationalization.execute'].run(
      { request_id: REQUEST, contract_id: CONTRACT, document_id: DOCUMENT,
        requested_by: null, operationalization_version: OPS_VERSION },
      { job: claimedJob('contracts.contract_operationalization.execute'),
        supabase: fakeSupabase(requestRow) as never, remainingMs: () => 250_000 },
    ).catch((e: Error & { code?: string }) => e);
    // Determinístico: morre aqui, com nome, em vez de repetir o mesmo 422.
    expect(error.name).toBe('TerminalJobError');
    expect(error.code).toBe('http_422');
  });

  it('tempo esgotado do provedor é RETENTÁVEL — e é falha da aplicação, não do host', async () => {
    vi.doMock('@/lib/ai/contract-operationalization', () => ({
      operationalizeContractDocument: vi.fn(async () => {
        throw new Error('Request timed out after 180000ms');
      }),
      OPERATIONALIZATION_VERSION: OPS_VERSION,
    }));
    const handlers = await loadHandlers();
    const error = await handlers['contracts.contract_operationalization.execute'].run(
      { request_id: REQUEST, contract_id: CONTRACT, document_id: DOCUMENT,
        requested_by: null, operationalization_version: OPS_VERSION },
      { job: claimedJob('contracts.contract_operationalization.execute'),
        supabase: fakeSupabase(requestRow) as never, remainingMs: () => 250_000 },
    ).catch((e: Error) => e);
    expect(error.name).toBe('RetryableJobError');
  });
});

describe('política da tarefa CONTRACT_OPERATIONALIZATION', () => {
  const policy = getApexAITaskPolicy('CONTRACT_OPERATIONALIZATION');

  it('continua em Sonnet, sem escalada automática para Opus', () => {
    expect(policy.model).toBe('claude-sonnet-5');
    expect(policy.model).not.toContain('opus');
  });

  it('continua em streaming', () => {
    // 32k de saída não cabe numa requisição não-stream do SDK.
    expect(policy.stream).toBe(true);
  });

  it('continua sem fallback: trabalho de alto risco não rebaixa em silêncio', () => {
    expect(policy.fallbacks).toEqual([]);
    expect(policy.highRisk).toBe(true);
  });

  it('mantém a saída longa: o orçamento não foi equilibrado truncando leitura', () => {
    // Encurtar maxTokens esconderia um problema de infraestrutura atrás de uma
    // leitura parcial — que tem exatamente a aparência de uma completa.
    expect(policy.maxTokens).toBe(32_000);
  });

  it('UMA tentativa de provedor por invocação, fixa e não configurável', () => {
    expect(policy.maxAttempts).toBe(LONG_PROVIDER_MAX_ATTEMPTS);
    expect(policy.maxAttempts).toBe(1);
    const registry = source('src/lib/ai/gateway/task-registry.ts');
    const line = registry.slice(registry.indexOf('CONTRACT_OPERATIONALIZATION: highRisk('));
    // Literal, e não `positiveInt('APEX_AI_MAX_ATTEMPTS', ...)`: uma variável de
    // ambiente não pode reintroduzir 2 × 180s dentro de uma função de 300s.
    expect(line.slice(0, 200)).toContain('maxAttempts: 1');
  });

  it('o tempo limite declarado é o mesmo que o orçamento assume', () => {
    expect(policy.timeoutMs).toBe(LONG_PROVIDER_TIMEOUT_MS);
  });
});

describe('o orçamento cabe no tempo de vida da hospedagem', () => {
  it('pior caso do provedor + retentativas + persistência < teto do host', () => {
    const worstCase = LONG_PROVIDER_TIMEOUT_MS * LONG_PROVIDER_MAX_ATTEMPTS + PERSISTENCE_MARGIN_MS;
    expect(worstCase).toBe(LONG_JOB_WORST_CASE_MS);
    expect(worstCase).toBeLessThan(HOST_MAX_DURATION_SECONDS * 1000);
  });

  it('duas tentativas de 180s NÃO cabem — e é por isso que só existe uma', () => {
    expect(LONG_PROVIDER_TIMEOUT_MS * 2).toBeGreaterThan(HOST_MAX_DURATION_SECONDS * 1000);
  });

  it('o trabalho reivindicado no limite do orçamento ainda termina a tempo', async () => {
    const { DEFAULT_LIMITS } = await import('@/lib/platform/jobs/worker');
    const { FAST_PATH_LIMITS } = await import('@/lib/platform/jobs/fast-path');
    for (const limits of [DEFAULT_LIMITS, FAST_PATH_LIMITS]) {
      expect(drainBudgetFitsHost(limits.timeBudgetMs)).toBe(true);
      expect(limits.timeBudgetMs).toBeLessThan(LATEST_SAFE_CLAIM_MS);
    }
  });

  it('a concessão cobre provedor + persistência + limpeza, e excede o orçamento da passagem', async () => {
    const { DEFAULT_LIMITS } = await import('@/lib/platform/jobs/worker');
    expect(JOB_LEASE_SECONDS * 1000).toBeGreaterThanOrEqual(LONG_JOB_WORST_CASE_MS);
    expect(DEFAULT_LIMITS.leaseSeconds).toBe(JOB_LEASE_SECONDS);
    expect(DEFAULT_LIMITS.leaseSeconds * 1000).toBeGreaterThan(DEFAULT_LIMITS.timeBudgetMs);
    // A concessão NÃO é substituta do maxDuration: ela protege a fila, não a
    // execução. Por isso não excede o tempo de vida da função.
    expect(JOB_LEASE_SECONDS).toBeLessThanOrEqual(HOST_MAX_DURATION_SECONDS);
  });

  it('toda rota que aciona o trabalhador declara o seu tempo de vida', () => {
    const routes = [
      'src/app/api/platform/jobs/drain/route.ts',
      'src/app/api/ai/clause-extraction/[contractId]/route.ts',
      'src/app/api/contracts/onboarding/route.ts',
      'src/app/api/contracts/onboarding/[id]/route.ts',
      'src/app/api/contracts/[id]/amendments/onboarding/route.ts',
    ];
    for (const route of routes) {
      const text = source(route);
      // Nada aqui pode depender de um padrão não documentado da hospedagem.
      expect(text).toContain(`export const maxDuration = ${HOST_MAX_DURATION_SECONDS};`);
      expect(text).toContain("export const runtime = 'nodejs';");
    }
  });

  it('600s é o teto que ESTA aplicação configura, não um máximo da plataforma', () => {
    /*
      A semântica da Vercel: 300s é o PADRÃO em todos os planos e o TETO do
      Hobby; no Pro e no Enterprise o máximo configurável é 800s. Chamar o
      nosso número de "máximo da plataforma" — como uma versão anterior deste
      teste fazia — é falso, e um número errado com cara de fato de plataforma
      faz alguém parar de procurar a folga que existe.

      O plano foi verificado na API da Vercel (equipe no Pro, projeto `comite`
      em `nodejs24.x` com Fluid Compute) ANTES de este número mudar. Ficamos em
      600 por decisão, com 200s de distância do limite do plano, e o teste
      guarda a decisão — não o limite.
    */
    expect(APEX_CONFIGURED_HOST_CEILING).toBe(600);
    expect(HOST_MAX_DURATION_SECONDS).toBe(APEX_CONFIGURED_HOST_CEILING);
    // A folga que separa a nossa escolha do máximo do plano (800s no Pro).
    expect(APEX_CONFIGURED_HOST_CEILING).toBeLessThan(800);
  });

  it('sobra margem de hospedagem DEPOIS do pior caso inteiro, e não só antes', async () => {
    /*
      O invariante que importa não é "o provedor cabe", é: reivindicar no último
      instante do orçamento, gastar o provedor inteiro e AINDA ter tempo de
      escrever o estado terminal. O que este teste mede é o que sobra depois
      disso — a folga que pertence à hospedagem, e a ninguém mais.

      Sem ela, o componente que mata o processo passa a ser o host, e um
      processo morto pelo host não escreve estado terminal nenhum: a análise
      fica `running` para sempre.
    */
    const { DEFAULT_LIMITS } = await import('@/lib/platform/jobs/worker');
    const ceilingMs = HOST_MAX_DURATION_SECONDS * 1000;
    const worstCaseEndMs = DEFAULT_LIMITS.timeBudgetMs + LONG_JOB_WORST_CASE_MS;

    // 50s de reivindicação + 450s de provedor + 45s de persistência = 545s.
    expect(worstCaseEndMs).toBe(545_000);
    // ... dentro de 600s, deixando 55s que a aplicação nunca planeja gastar.
    expect(ceilingMs - worstCaseEndMs).toBeGreaterThanOrEqual(50_000);
  });

  it('a APLICAÇÃO expira antes da hospedagem — nunca o contrário', () => {
    /*
      Quem interrompe tem de ser o nosso tempo limite, porque só o nosso deixa
      um caminho de erro vivo para gravar o desfecho. Uma diferença estreita
      demais aqui entrega a decisão ao host por acidente de latência.
    */
    expect(LONG_PROVIDER_TIMEOUT_MS).toBeLessThan(HOST_MAX_DURATION_SECONDS * 1000);
    expect(HOST_MAX_DURATION_SECONDS * 1000 - LONG_PROVIDER_TIMEOUT_MS)
      .toBeGreaterThanOrEqual(PERSISTENCE_MARGIN_MS);
  });
});

describe('o tipo de trabalho existe, com schema declarado', () => {
  it('está no vocabulário e respeita o formato exigido pelo banco', () => {
    expect(JOB_TYPES).toContain('contracts.contract_operationalization.execute');
    expect('contracts.contract_operationalization.execute')
      .toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
  });

  it('payload malformado é recusado na fronteira', () => {
    expect(() => parseJobPayload('contracts.contract_operationalization.execute', 1, {
      request_id: 'não-é-uuid', contract_id: CONTRACT, document_id: DOCUMENT,
      requested_by: null, operationalization_version: OPS_VERSION,
    })).toThrow();
  });

  it('não exigiu migração: o tipo de trabalho é texto validado por regex', () => {
    const migration = source('supabase/migrations/120_platform_apex_jobs.sql');
    expect(migration).toContain("CHECK (job_type ~ '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$')");
  });
});

describe('nenhuma chamada viva ao provedor', () => {
  it('o provedor real é inalcançável: o gateway não aparece nos handlers', () => {
    const handlers = source('src/lib/platform/jobs/handlers.ts');
    // Toda chamada ao modelo passa pelo gateway, e o gateway mora nos módulos de
    // IA — que esta suíte substitui por dublês em cada teste. Nenhum caminho
    // daqui constrói um cliente de provedor.
    expect(handlers).not.toContain('getApexAIGateway');
    expect(handlers).not.toContain('process.env.ANTHROPIC');
  });

  it('os handlers só alcançam o provedor por importação sob demanda', () => {
    const handlers = source('src/lib/platform/jobs/handlers.ts');
    // Importação estática de IA no topo faria todo caminho que apenas MENCIONA
    // o registro de handlers arrastar o provedor junto.
    expect(handlers).not.toMatch(/^import .*@\/lib\/ai\//m);
    expect(handlers).not.toContain('@anthropic-ai/sdk');
  });
});
