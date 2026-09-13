/**
 * O PLANO DE RECUPERAÇÃO das execuções de IA de contratos.
 *
 * ─── O que estava quebrado ─────────────────────────────────────────────────
 *
 * Quando a hospedagem mata a função, três linhas ficam mentindo:
 *
 *   apex_jobs                           PROCESSING, concessão vencida
 *   contract_ai_analyses                running, para sempre
 *   contract_clause_extraction_requests RUNNING, para sempre
 *
 * A ceifa consertava a primeira. As outras duas — as que a tela do produto lê —
 * ficavam como estavam.
 *
 * E havia um caso pior: o trabalho COMBINADO legado, anterior à divisão das
 * fases, cuja extração já concluiu e persistiu cláusulas reais. Uma retentativa
 * normal dele roda o extrator de novo, gastando uma chamada longa de provedor
 * para reproduzir o que já está no banco.
 *
 * ─── O que se prova aqui ───────────────────────────────────────────────────
 *
 * Que a reconciliação é DETERMINÍSTICA (por proveniência de execução, nunca por
 * horário ou "análise mais recente"), que ela é idempotente e segura sob
 * concorrência, que um trabalhador com concessão viva nunca é ceifado, e que
 * nenhum caminho de recuperação roda a extração duas vezes.
 *
 * Nenhuma chamada viva ao provedor. Nenhuma linha de produção é tocada: o que
 * se lê do banco aqui é o TEXTO das migrations, e o que se executa são dublês.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APEX_CONFIGURED_HOST_CEILING,
  DEPLOY_BEFORE_MIGRATION_SAFE,
  OPERATIONALIZATION_JOB_MAX_ATTEMPTS,
  RELEASE_ORDER,
} from '@/lib/platform/jobs/budget';
import { getApexAITaskPolicy } from '@/lib/ai/gateway/task-registry';

const source = (relative: string) => readFileSync(resolve(process.cwd(), relative), 'utf8');

const MIGRATION = source('supabase/migrations/168_apex_execution_provenance_and_recovery.sql');
const HANDLERS = source('src/lib/platform/jobs/handlers.ts');

const ORG = '00000000-0000-4000-8000-000000000001';
const REQUEST = '00000000-0000-4000-8000-000000000101';
const CONTRACT = '00000000-0000-4000-8000-000000000102';
const DOCUMENT = '00000000-0000-4000-8000-000000000103';
const JOB = '00000000-0000-4000-8000-000000000105';
const OPS_VERSION = 'contract-operationalization/1.0.0';

/*
  Supabase mínimo, com uma tabela de análises consultável. `analyses` é o que a
  guarda de extração lê; devolver [] significa "não há prova".
*/
function fakeSupabase(opts: {
  analyses?: Record<string, unknown>[];
  request?: Record<string, unknown> | null;
} = {}) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const updates: { table: string; value: Record<string, unknown> }[] = [];
  const selects: { table: string; filters: Record<string, unknown> }[] = [];
  const client = {
    rpcCalls, updates, selects,
    rpc: vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ fn, args });
      if (fn === 'apex_jobs_enqueue') return { data: 'job-ops-1', error: null };
      return { data: null, error: null };
    }),
    from: vi.fn((table: string) => {
      const filters: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {};
      Object.assign(builder, {
        select: () => builder,
        update: (value: Record<string, unknown>) => { updates.push({ table, value }); return builder; },
        eq: (column: string, value: unknown) => { filters[column] = value; return builder; },
        order: () => builder,
        limit: async () => {
          selects.push({ table, filters });
          if (table === 'contract_ai_analyses') {
            const rows = (opts.analyses ?? []).filter((row) =>
              Object.entries(filters).every(([k, v]) => row[k] === v));
            return { data: rows, error: null };
          }
          return { data: [], error: null };
        },
        maybeSingle: async () => {
          selects.push({ table, filters });
          if (table === 'contract_clause_extraction_requests') {
            return { data: opts.request === undefined ? requestRow : opts.request, error: null };
          }
          return { data: null, error: null };
        },
        then: (r: (v: { data: null; error: null }) => unknown) => r({ data: null, error: null }),
      });
      return builder;
    }),
  };
  return client;
}

const requestRow = {
  id: REQUEST, organization_id: ORG, contract_id: CONTRACT,
  document_id: DOCUMENT, status: 'QUEUED', requested_by: null,
};

const claimedJob = (over: Record<string, unknown> = {}) => ({
  id: JOB, organization_id: ORG, event_id: null,
  job_type: 'contracts.clause_extraction.execute', payload_version: 1,
  idempotency_key: 'k', payload: {}, attempt_count: 1, max_attempts: 3,
  lock_token: 'tok', correlation_id: null, ...over,
});

/** A análise de extração CONCLUÍDA desta execução: a prova durável. */
const completedExtraction = {
  id: 'analysis-extraction-1',
  organization_id: ORG, contract_id: CONTRACT, document_id: DOCUMENT,
  execution_job_id: JOB, status: 'completed',
  extracted_data: { kind: 'clause_extraction', structured: 7, rejected_without_evidence: 2 },
};

async function loadHandlers() {
  return (await import('@/lib/platform/jobs/handlers')).JOB_HANDLERS;
}

function mockAi(extract: ReturnType<typeof vi.fn>, operationalize = vi.fn()) {
  vi.doMock('@/lib/ai/contract-clause-extractor', () => ({ extractClausesFromDocument: extract }));
  vi.doMock('@/lib/ai/contract-operationalization', () => ({
    operationalizeContractDocument: operationalize,
    OPERATIONALIZATION_VERSION: OPS_VERSION,
  }));
  return { extract, operationalize };
}

beforeEach(() => { vi.resetModules(); });
afterEach(() => {
  vi.doUnmock('@/lib/platform/server-client');
  vi.doUnmock('@/lib/ai/contract-clause-extractor');
  vi.doUnmock('@/lib/ai/contract-operationalization');
  vi.restoreAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════
describe('zero extração duplicada', () => {
  it('a retentativa do MESMO trabalho não relê o documento', async () => {
    const { extract } = mockAi(vi.fn());
    const handlers = await loadHandlers();
    const supabase = fakeSupabase({ analyses: [completedExtraction] });

    const result = await handlers['contracts.clause_extraction.execute'].run(
      { request_id: REQUEST, contract_id: CONTRACT, document_id: DOCUMENT },
      { job: claimedJob({ attempt_count: 2 }), supabase: supabase as never,
        remainingMs: () => 50_000 },
    );

    // A leitura já está persistida; relê-la seria uma chamada longa e cara ao
    // provedor para reproduzir, palavra por palavra, o que já existe.
    expect(extract).not.toHaveBeenCalled();
    expect(result.reused_persisted_extraction).toBe(true);
    expect(result.analysis_id).toBe('analysis-extraction-1');
    expect(result.structured_interpretations).toBe(7);
  });

  it('e ainda assim enfileira a operacionalização: a recuperação AVANÇA', async () => {
    mockAi(vi.fn());
    const handlers = await loadHandlers();
    const supabase = fakeSupabase({ analyses: [completedExtraction] });
    await handlers['contracts.clause_extraction.execute'].run(
      { request_id: REQUEST, contract_id: CONTRACT, document_id: DOCUMENT },
      { job: claimedJob({ attempt_count: 2 }), supabase: supabase as never,
        remainingMs: () => 50_000 },
    );
    const enqueues = supabase.rpcCalls.filter((c) => c.fn === 'apex_jobs_enqueue');
    expect(enqueues).toHaveLength(1);
    expect(enqueues[0].args.p_job_type).toBe('contracts.contract_operationalization.execute');
  });

  it('a prova é da EXECUÇÃO, não do documento: outra execução não conta', async () => {
    const { extract } = mockAi(vi.fn(async () => ({
      analysisId: 'nova', proposedCount: 1, rejectedCount: 0,
    })));
    const handlers = await loadHandlers();
    /*
      Reanalisar um documento depois de uma revisão é legítimo. Tratar a leitura
      antiga como prova faria a reanálise devolver, em silêncio, o resultado
      velho — e ninguém veria que a nova leitura nunca aconteceu.
    */
    const supabase = fakeSupabase({
      analyses: [{ ...completedExtraction, execution_job_id: 'outra-execucao' }],
    });
    await handlers['contracts.clause_extraction.execute'].run(
      { request_id: REQUEST, contract_id: CONTRACT, document_id: DOCUMENT },
      { job: claimedJob(), supabase: supabase as never, remainingMs: () => 50_000 },
    );
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it('análise `running` da mesma execução não é prova: ela não terminou', async () => {
    const { extract } = mockAi(vi.fn(async () => ({
      analysisId: 'nova', proposedCount: 1, rejectedCount: 0,
    })));
    const handlers = await loadHandlers();
    const supabase = fakeSupabase({
      analyses: [{ ...completedExtraction, status: 'running' }],
    });
    await handlers['contracts.clause_extraction.execute'].run(
      { request_id: REQUEST, contract_id: CONTRACT, document_id: DOCUMENT },
      { job: claimedJob(), supabase: supabase as never, remainingMs: () => 50_000 },
    );
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it('a extração recebe a proveniência da execução que a iniciou', async () => {
    const { extract } = mockAi(vi.fn(async () => ({
      analysisId: 'nova', proposedCount: 1, rejectedCount: 0,
    })));
    const handlers = await loadHandlers();
    await handlers['contracts.clause_extraction.execute'].run(
      { request_id: REQUEST, contract_id: CONTRACT, document_id: DOCUMENT },
      { job: claimedJob(), supabase: fakeSupabase() as never, remainingMs: () => 50_000 },
    );
    // Sem isto, a reconciliação teria de adivinhar qual análise era desta morte.
    expect(extract).toHaveBeenCalledWith(CONTRACT, DOCUMENT, null, JOB);
  });

  it('a operacionalização dedicada também carrega a proveniência, e nunca extrai', async () => {
    const operationalize = vi.fn(async () => ({
      analysisId: 'ops', counts: {}, materializedInstances: 0,
      awaitingScheduleAnchor: 0, requiresAttention: 0,
    }));
    const { extract } = mockAi(vi.fn(), operationalize);
    const handlers = await loadHandlers();
    const supabase = fakeSupabase({ request: requestRow });
    await handlers['contracts.contract_operationalization.execute'].run(
      { request_id: REQUEST, contract_id: CONTRACT, document_id: DOCUMENT,
        requested_by: null, operationalization_version: OPS_VERSION },
      { job: claimedJob({ job_type: 'contracts.contract_operationalization.execute' }),
        supabase: supabase as never, remainingMs: () => 250_000 },
    );
    expect(operationalize).toHaveBeenCalledWith(CONTRACT, DOCUMENT, null, JOB);
    expect(extract).not.toHaveBeenCalled();
    // Nem mesmo a leitura de prova de extração: este handler não a consulta.
    expect(supabase.selects.some((s) => s.table === 'contract_ai_analyses')).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('guarda de custo', () => {
  it('o trabalho de operacionalização nasce com UMA tentativa', async () => {
    mockAi(vi.fn(async () => ({ analysisId: 'a', proposedCount: 1, rejectedCount: 0 })));
    const handlers = await loadHandlers();
    const supabase = fakeSupabase();
    await handlers['contracts.clause_extraction.execute'].run(
      { request_id: REQUEST, contract_id: CONTRACT, document_id: DOCUMENT },
      { job: claimedJob(), supabase: supabase as never, remainingMs: () => 50_000 },
    );
    const enqueue = supabase.rpcCalls.find((c) => c.fn === 'apex_jobs_enqueue');
    expect(enqueue?.args.p_max_attempts).toBe(1);
    expect(OPERATIONALIZATION_JOB_MAX_ATTEMPTS).toBe(1);
  });

  it('o provedor continua intocado: Sonnet, 180s, streaming, sem fallback', () => {
    // A guarda é de RETENTATIVA DE TRABALHO. Mexer no transporte para economizar
    // seria trocar um problema de custo por uma leitura pior.
    const policy = getApexAITaskPolicy('CONTRACT_OPERATIONALIZATION');
    expect(policy.maxAttempts).toBe(1);
    expect(policy.timeoutMs).toBe(180_000);
    expect(policy.stream).toBe(true);
    expect(policy.model).toBe('claude-sonnet-5');
    expect(policy.fallbacks).toEqual([]);
    expect(policy.maxTokens).toBe(32_000);
  });

  it('uma falha vira estado terminal visível, e não uma segunda chamada longa', async () => {
    mockAi(vi.fn(), vi.fn(async () => {
      throw Object.assign(new Error('falha'), { status: 422 });
    }));
    const handlers = await loadHandlers();
    const error = await handlers['contracts.contract_operationalization.execute'].run(
      { request_id: REQUEST, contract_id: CONTRACT, document_id: DOCUMENT,
        requested_by: null, operationalization_version: OPS_VERSION },
      { job: claimedJob({ job_type: 'contracts.contract_operationalization.execute' }),
        supabase: fakeSupabase({ request: requestRow }) as never, remainingMs: () => 250_000 },
    ).catch((e: Error) => e);
    expect(error.name).toBe('TerminalJobError');
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('reconciliação de execuções órfãs', () => {
  /** Uma passagem do trabalhador com o cliente de serviço substituído. */
  async function drainWith(reconcile: { data: unknown; error: { message: string } | null }) {
    const calls: string[] = [];
    const client = {
      rpc: vi.fn(async (fn: string) => {
        calls.push(fn);
        if (fn === 'apex_jobs_reap') return { data: [{ released: 1, dead_lettered: 0 }], error: null };
        if (fn === 'contracts_reconcile_orphaned_executions') return reconcile;
        if (fn === 'apex_route_pending_events') {
          return { data: [{ events_routed: 0, jobs_created: 0, events_failed: 0 }], error: null };
        }
        if (fn === 'apex_jobs_claim') return { data: [], error: null };
        return { data: null, error: null };
      }),
      from: vi.fn(() => ({
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      })),
    };
    vi.doMock('@/lib/platform/server-client', () => ({
      platformServiceClient: () => client,
      __resetPlatformServiceClient: () => undefined,
    }));
    vi.resetModules();
    const { drainOnce, DEFAULT_LIMITS } = await import('@/lib/platform/jobs/worker');
    const counters = await drainOnce(DEFAULT_LIMITS, 'test-worker');
    return { calls, counters };
  }

  it('a passagem reconcilia logo depois de ceifar, e conta o que fechou', async () => {
    const { calls, counters } = await drainWith({
      data: [{ analyses_reconciled: 2, requests_reconciled: 1 }], error: null });
    // Consertar só `apex_jobs` conserta a tabela que ninguém olha.
    expect(calls.indexOf('contracts_reconcile_orphaned_executions'))
      .toBeGreaterThan(calls.indexOf('apex_jobs_reap'));
    expect(calls.indexOf('contracts_reconcile_orphaned_executions'))
      .toBeLessThan(calls.indexOf('apex_jobs_claim'));
    expect(counters.analyses_reconciled).toBe(2);
    expect(counters.requests_reconciled).toBe(1);
  });

  it('a reconciliação que falha não derruba a passagem', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Reconciliar é conserto do passado; a fila do presente segue legítima.
    const { counters } = await drainWith({ data: null, error: { message: 'boom' } });
    expect(counters.analyses_reconciled).toBe(0);
    expect(counters.requests_reconciled).toBe(0);
    expect(counters.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('a proveniência é EXATA: a reconciliação junta por execution_job_id', () => {
    expect(MIGRATION).toContain('ADD COLUMN IF NOT EXISTS execution_job_id uuid');
    expect(MIGRATION).toContain('ON j.id = a.execution_job_id AND j.organization_id = a.organization_id');
    // Nunca por horário, contrato solto ou "análise mais recente".
    const reconciler = MIGRATION.slice(
      MIGRATION.indexOf('FUNCTION public.contracts_reconcile_orphaned_executions'),
      MIGRATION.indexOf('FUNCTION public.contracts_recover_legacy_extraction_job'));
    expect(reconciler).not.toMatch(/ORDER BY a\.completed_at DESC[\s\S]{0,80}LIMIT 1/);
    expect(reconciler).not.toContain('interval');
  });

  it('um trabalhador com concessão VIVA nunca é reconciliado', () => {
    const reconciler = MIGRATION.slice(
      MIGRATION.indexOf('FUNCTION public.contracts_reconcile_orphaned_executions'),
      MIGRATION.indexOf('FUNCTION public.contracts_recover_legacy_extraction_job'));
    // Posse legítima: uma execução longa e saudável fica exatamente assim.
    expect(reconciler).toContain(
      "j.status <> 'PROCESSING' OR j.lease_expires_at IS NULL OR j.lease_expires_at < now()");
  });

  it('dois reconciliadores não fecham a mesma linha duas vezes', () => {
    const reconciler = MIGRATION.slice(
      MIGRATION.indexOf('FUNCTION public.contracts_reconcile_orphaned_executions'),
      MIGRATION.indexOf('FUNCTION public.contracts_recover_legacy_extraction_job'));
    // SKIP LOCKED dá conjuntos DISJUNTOS a passagens concorrentes; o predicado
    // `status = 'running'` faz a segunda passagem não encontrar mais nada.
    expect(reconciler.match(/FOR UPDATE OF a SKIP LOCKED/g)).toHaveLength(1);
    expect(reconciler.match(/FOR UPDATE OF r SKIP LOCKED/g)).toHaveLength(1);
    expect(reconciler).toContain("WHERE a.status = 'running'");
    expect(reconciler).toContain("WHERE r.status = 'RUNNING'");
  });

  it('o motivo é de MÁQUINA, e não uma falha de provedor inventada', () => {
    expect(MIGRATION).toContain("error_message = 'WORKER_EXECUTION_TERMINATED'");
    // Nenhuma revisão humana é fabricada.
    expect(MIGRATION).toContain("'human_action', false");
    expect(MIGRATION).not.toMatch(/error_message = '.*provider_failed/i);
  });

  it('não afirma que a resposta do provedor NÃO chegou — isso é incognoscível', () => {
    /*
      Depois de o processo ser morto, ninguém sabe se a resposta chegou. Ela pode
      ter chegado inteira, ter sido consumida pelo stream e ter morrido antes da
      escrita — e nesse caso o custo do provedor JÁ FOI PAGO. Escrever "nenhuma
      resposta foi recebida" esconderia gasto real.

      O único fato determinístico é o da aplicação: ela não persistiu resultado.
    */
    expect(MIGRATION).toContain("'provider_response_state', 'unknown'");
    expect(MIGRATION).toContain("'provider_response_persisted', false");
    expect(MIGRATION).not.toContain('provider_response_received');
    expect(MIGRATION).not.toContain('nenhuma resposta do provedor foi recebida');
    // E a mensagem segura fala de PERSISTÊNCIA, não de recebimento.
    expect(MIGRATION).toContain(
      "error_safe = 'A execução foi encerrada antes de concluir e persistir o resultado.'");
    // Nenhum uso/token é fabricado em lugar nenhum da reconciliação.
    expect(MIGRATION).not.toMatch(/reconciliation[\s\S]{0,600}(input_tokens|output_tokens|'usage')/);
  });

  it('o destino do pedido segue o do TRABALHO, não o da análise', () => {
    // Fechar como FAILED um pedido cujo trabalho ainda vai rodar faria a tela
    // dizer "falhou" enquanto a fila ainda trabalha.
    expect(MIGRATION).toContain("CASE WHEN o.job_status = 'PENDING' THEN 'QUEUED' ELSE 'FAILED' END");
    // `ccer_terminal_coherent`: completed_at existe exatamente nos terminais.
    expect(MIGRATION).toContain("CASE WHEN o.job_status = 'PENDING' THEN NULL ELSE now() END");
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('recuperação do trabalho combinado legado', () => {
  const recovery = MIGRATION.slice(
    MIGRATION.indexOf('FUNCTION public.contracts_recover_legacy_extraction_job'));

  it('a prova exigida é uma ANÁLISE DE EXTRAÇÃO CONCLUÍDA', () => {
    expect(recovery).toContain("AND a.status = 'completed'");
    expect(recovery).toContain("AND a.extracted_data->>'kind' = 'clause_extraction'");
    // NÃO "existem cláusulas": cláusulas podem vir de importação, de digitação
    // humana ou de uma análise anterior, e nenhuma delas prova esta leitura.
    expect(recovery).not.toContain('contract_clauses c');
    expect(recovery).not.toMatch(/FROM public\.contract_clauses[\s\S]{0,120}count/i);
  });

  it('sem prova, não há recuperação — o caminho normal da fila vale', () => {
    expect(recovery).toContain("'reason', 'extraction_not_proven'");
  });

  it('a ponte legada tem os DOIS lados, e ambos são âncoras duráveis', () => {
    expect(recovery).toContain('a.execution_job_id = j.id');
    expect(recovery).toContain('a.execution_job_id IS NULL');
    /*
      Piso `j.created_at` e não `j.locked_at`: a ceifa ZERA `locked_at`, e um
      órfão passa a maior parte da vida já ceifado — a âncora volátil deixaria
      a ponte sem resolver para sempre. `created_at` nenhuma ceifa apaga.
    */
    expect(recovery).toContain('a.created_at >= j.created_at');
    expect(recovery).not.toContain('a.created_at >= j.locked_at');
    // Teto: a extração necessariamente terminou antes de a operacionalização começar.
    expect(recovery).toContain('a.completed_at <= v_upper_bound');
    expect(recovery).toContain(
      'v_upper_bound := COALESCE(v_orphan_ops.started_at, v_orphan_ops.created_at)');
  });

  it('sem teto determinístico, RECUSA em vez de inventar um', () => {
    expect(recovery).toContain("'reason', 'upper_boundary_unavailable'");
    expect(recovery).toContain('IF v_upper_bound IS NULL THEN');
  });

  it('CONTA candidatas, e só um conjunto de tamanho um é prova', () => {
    // Escolher "a melhor" seria a heurística de "análise mais recente" entrando
    // pela porta dos fundos. Conta-se, e fora de exatamente 1 não se escreve.
    expect(recovery).toContain('SELECT count(*)::integer INTO v_candidates');
    expect(recovery).toContain('IF v_candidates = 0 THEN');
    expect(recovery).toContain('IF v_candidates > 1 THEN');
    expect(recovery).toContain("'reason', 'extraction_ambiguous'");
    // E em nenhum ramo de prova sobrou um ORDER BY ... LIMIT 1 escolhendo.
    expect(recovery).not.toMatch(/kind' = 'clause_extraction'[\s\S]{0,400}ORDER BY a\.completed_at DESC/);
  });

  it('já recuperado devolve a VERDADE, e não uma recusa enganosa', () => {
    /*
      A própria recuperação fecha a operacionalização órfã, e sem ela a janela
      perde o teto. Sem esta saída, a segunda chamada cairia em
      `upper_boundary_unavailable` — seguro, mas mentindo sobre o motivo.
    */
    expect(recovery).toContain("'reason', 'job_already_recovered'");
    expect(recovery).toContain(
      "IF j.status = 'CANCELLED' AND j.last_error_code = 'recovered_without_extraction_rerun' THEN");
  });

  it('concessão viva é recusada: há um trabalhador executando agora', () => {
    expect(recovery).toContain("'reason', 'lease_still_live'");
    expect(recovery).toContain("j.status = 'PROCESSING' AND j.lease_expires_at IS NOT NULL AND j.lease_expires_at > now()");
  });

  it('um trabalho terminal CONCLUÍDO não é ressuscitado', () => {
    expect(recovery).toContain("'reason', 'job_already_completed'");
  });

  it('não corre com a ceifa: segura a linha com FOR UPDATE sem SKIP LOCKED', () => {
    // A ceifa usa SKIP LOCKED; enquanto esta transação segura a linha, nenhum
    // ceifador a devolve para PENDING debaixo da recuperação.
    expect(recovery).toContain('FROM public.apex_jobs WHERE id = p_job_id FOR UPDATE;');
    expect(recovery).not.toContain('WHERE id = p_job_id FOR UPDATE SKIP LOCKED');
  });

  it('o trabalho legado é CANCELADO, para nunca reexecutar a extração', () => {
    expect(recovery).toContain("SET status = 'CANCELLED'");
    expect(recovery).toContain("'recovered_without_extraction_rerun'");
    // A função de recuperação não chama o extrator, e não tem como.
    expect(recovery).not.toContain('extractClausesFromDocument');
    expect(recovery).not.toContain("'contracts.clause_extraction.execute',\n    v_idempotency");
  });

  it('enfileira EXATAMENTE uma operacionalização, com a chave determinística', () => {
    expect(recovery).toContain("v_idempotency := 'contract-operationalization:' || v_contract::text || ':'");
    expect(recovery).toContain("|| v_document::text || ':' || v_request.id::text || ':'");
    expect(recovery).toContain('|| p_operationalization_version;');
    expect(recovery).toContain("'contracts.contract_operationalization.execute',\n    v_idempotency,");
  });

  it('a chave do banco e a do handler são a MESMA construção', () => {
    // Chaves diferentes fariam a recuperação criar um SEGUNDO trabalho para o
    // mesmo documento, em vez de convergir para o que já existe.
    const handlerKey = HANDLERS.slice(HANDLERS.indexOf('const idempotencyKey ='),
      HANDLERS.indexOf('const { data, error } = await supabase.rpc(\'apex_jobs_enqueue\''));
    for (const part of ['contract-operationalization:', 'contract_id', 'document_id',
      'OPERATIONALIZATION_VERSION']) {
      expect(handlerKey).toContain(part);
    }
    expect(handlerKey).toContain('request.id');
    // Nada de relógio nem aleatório dos dois lados.
    expect(handlerKey).not.toContain('Date.now');
    expect(recovery).not.toMatch(/v_idempotency :=[\s\S]{0,200}now\(\)/);
  });

  it('dry-run é o PADRÃO, dos dois lados da fronteira', () => {
    expect(recovery).toContain('p_dry_run                     boolean DEFAULT true');
    const recoveryModule = source('src/lib/platform/jobs/legacy-recovery.ts');
    expect(recoveryModule).toContain('p_dry_run: options.execute !== true');
  });

  it('o plano lista o que PRESERVA, e não só o que muda', () => {
    expect(recovery).toContain("'table', 'contract_clauses', 'action', 'PRESERVE'");
    expect(recovery).toContain("'action', 'PRESERVE'");
  });

  it('o módulo de recuperação usa a MESMA guarda de custo do handler', async () => {
    const recoveryModule = source('src/lib/platform/jobs/legacy-recovery.ts');
    expect(recoveryModule).toContain('p_job_max_attempts: OPERATIONALIZATION_JOB_MAX_ATTEMPTS');
  });

  it('planeja sem escrever, e devolve o plano do banco intacto', async () => {
    vi.doMock('@/lib/ai/contract-operationalization', () => ({
      OPERATIONALIZATION_VERSION: OPS_VERSION,
    }));
    const { recoverLegacyExtractionJob } = await import('@/lib/platform/jobs/legacy-recovery');
    const plan = { recoverable: true, dry_run: true, executed: false, mutations: [] };
    const rpc = vi.fn(async () => ({ data: plan, error: null }));
    const result = await recoverLegacyExtractionJob({ rpc } as never, JOB);
    expect(result).toEqual(plan);
    const [, args] = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(args.p_dry_run).toBe(true);
    expect(args.p_job_max_attempts).toBe(1);
    expect(args.p_operationalization_version).toBe(OPS_VERSION);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('cadência de recuperação e teto configurado', () => {
  const vercelConfig = JSON.parse(source('vercel.json')) as {
    crons: { path: string; schedule: string }[];
  };

  it('a ordem de release é MIGRATION ANTES DO CÓDIGO, e está no código', () => {
    /*
      O código novo escreve `execution_job_id`. Publicá-lo contra um banco sem a
      168 faz toda leitura de contrato falhar na PRIMEIRA escrita — a análise nem
      chega a nascer. Uma afirmação anterior de que dava para publicar antes
      estava errada, e errado num runbook custa um incidente.
    */
    expect(DEPLOY_BEFORE_MIGRATION_SAFE).toBe(false);
    expect(RELEASE_ORDER).toEqual([
      'apply migration 168', 'deploy application code', 'run legacy recovery']);

    // A ordem inversa só é segura porque a 168 é ADITIVA: nada exige a coluna.
    const column = MIGRATION.slice(MIGRATION.indexOf('ADD COLUMN IF NOT EXISTS execution_job_id'));
    expect(column.slice(0, 120)).toContain('execution_job_id uuid');
    expect(column.slice(0, 120)).not.toContain('NOT NULL');
    expect(column.slice(0, 120)).not.toContain('DEFAULT');
    expect(MIGRATION).toContain('ORDEM DE RELEASE');

    // E os dois escritores da coluna existem de fato — é o que torna a ordem obrigatória.
    for (const file of ['src/lib/ai/contract-clause-extractor.ts',
      'src/lib/ai/contract-operationalization.ts']) {
      expect(source(file)).toContain('execution_job_id: executionJobId');
    }
  });

  it('o teto é a nossa CONFIGURAÇÃO, e não um máximo da plataforma', () => {
    expect(APEX_CONFIGURED_HOST_CEILING).toBe(300);
    const budget = source('src/lib/platform/jobs/budget.ts');
    // A afirmação antiga era falsa para Pro e Enterprise.
    expect(budget).not.toMatch(/300s é o máximo suportado em todos os planos/);
    expect(budget).toContain('Pro e Enterprise podem configurar limites MAIORES');
  });

  it('nenhuma cadência que o plano verificado (Hobby) não suporta', () => {
    /*
      Declarar aqui uma cadência de dez em dez minutos, que o Hobby não aceita,
      faria o deploy falhar, ou o cron silenciosamente não rodar — trocar um bloqueio VISÍVEL
      por um invisível. O bloqueio fica registrado como bloqueio.
    */
    for (const cron of vercelConfig.crons) {
      const [minute, hour] = cron.schedule.split(' ');
      expect(minute).not.toContain('/');
      expect(hour).not.toContain('/');
      expect(hour).not.toBe('*');
    }
  });

  it('o bloqueio de infraestrutura está escrito onde quem opera vai ler', () => {
    const drain = source('src/app/api/platform/jobs/drain/route.ts');
    expect(drain).toContain('INFRA_BLOCKER: SUB_DAILY_SCHEDULER_REQUIRED');
    // A concessão dura 5 minutos; um cron diário deixa o órfão invisível por ~24h.
    expect(drain).toContain('Pro');
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('nenhuma chamada viva, nenhuma mutação de produção', () => {
  it('a migration não escreve em nenhuma linha de negócio', () => {
    /*
      Ela cria coluna, índices e funções. Todo UPDATE que o arquivo contém está
      DENTRO de um corpo de função — código que só roda quando alguém o chama —
      e nenhum no nível superior da migration.
    */
    const topLevel = MIGRATION.split('$$').filter((_, i) => i % 2 === 0).join('\n');
    expect(topLevel).not.toMatch(/^\s*UPDATE\s+public\./mi);
    expect(topLevel).not.toMatch(/^\s*INSERT\s+INTO\s+public\./mi);
    expect(topLevel).not.toMatch(/^\s*DELETE\s+FROM/mi);
  });

  it('nenhum identificador do incidente atual está embutido no código', () => {
    // Recuperação é um MECANISMO, não um script para um contrato específico.
    const incident = [
      '6f081cbb-4c06-4643-be10-2e92a30e7146',
      '7fde857b-fcf5-4187-8592-665fa41a4add',
      '52fdcdcd-52ae-468f-9f66-c90ca271ab3a',
      '0a795a7b-ad6f-4569-b1d5-df9ed204c0c6',
    ];
    for (const file of [
      'supabase/migrations/168_apex_execution_provenance_and_recovery.sql',
      'src/lib/platform/jobs/legacy-recovery.ts',
      'src/lib/platform/jobs/handlers.ts',
      'src/lib/platform/jobs/worker.ts',
    ]) {
      for (const id of incident) expect(source(file)).not.toContain(id);
    }
  });

  it('nenhum caminho de recuperação alcança o provedor', () => {
    const recoveryModule = source('src/lib/platform/jobs/legacy-recovery.ts');
    expect(recoveryModule).not.toContain('@anthropic-ai/sdk');
    expect(recoveryModule).not.toContain('getApexAIGateway');
    // A única coisa que ele importa do módulo de IA é a VERSÃO, sob demanda.
    expect(recoveryModule).toContain("await import('@/lib/ai/contract-operationalization')");
  });
});
