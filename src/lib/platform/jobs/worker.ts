/**
 * O trabalhador: uma passagem LIMITADA da fila.
 *
 * ─── Ordem, e por que ela é essa ───────────────────────────────────────────
 *
 *   1. ceifar concessões vencidas   trabalho abandonado volta a ser visível
 *   2. rodar produtores agendados   o que nasce do tempo entra na fila
 *   3. rotear eventos não roteados  o que nasce de fato vira trabalho
 *   4. reivindicar e executar       o que está na fila acontece
 *
 * Ceifar primeiro porque um trabalho preso em PROCESSING não aparece como
 * pendente: sem devolvê-lo antes da reivindicação, ele esperaria a próxima
 * volta inteira. Rotear antes de reivindicar porque o trabalho recém-criado
 * pelo roteamento pode ser executado nesta mesma passagem.
 *
 * ─── Limites, e por que existem ────────────────────────────────────────────
 *
 * A hospedagem derruba a função em algum momento. Um trabalhador que tenta
 * esvaziar a fila inteira é derrubado no meio da última tentativa, e o que
 * sobra é uma concessão órfã por passagem. Parar de propósito, com trabalho
 * ainda na fila, é a decisão correta: o que sobra é DURÁVEL, e a próxima
 * batida do agendador continua.
 *
 * ─── Concorrência ──────────────────────────────────────────────────────────
 *
 * Duas batidas simultâneas (Actions + after() + operador) são seguras por
 * construção: a reivindicação usa SKIP LOCKED e devolve conjuntos disjuntos, e
 * a idempotência de trabalho impede que dois roteamentos criem dois trabalhos.
 *
 * O que a segurança sob concorrência NÃO dá é execução única. A entrega é
 * at-least-once: entre o efeito colateral de um handler e a gravação do
 * COMPLETED cabe um processo derrubado, e o trabalho volta. A garantia de "uma
 * vez só" mora no EFEITO de cada handler, nunca nesta função.
 */
import { randomUUID } from 'node:crypto';
import { platformServiceClient } from '../server-client';
import { JOB_HANDLERS } from './handlers';
import { classifyJobError, TerminalJobError } from './errors';
import { isJobType, parseJobPayload, UnknownJobError } from './registry';
import { SCHEDULED_PRODUCERS } from './producers';
import type { ClaimedJob, HandlerContext } from './types';

export interface DrainLimits {
  readonly maxRouteBatch: number;
  readonly maxJobs: number;
  readonly leaseSeconds: number;
  /** Orçamento total da passagem. Abaixo do limite da hospedagem, de propósito. */
  readonly timeBudgetMs: number;
  readonly reapBatch: number;
}

export const DEFAULT_LIMITS: DrainLimits = {
  maxRouteBatch: 200,
  maxJobs: 25,
  // A concessão (300s) é MAIOR que o orçamento da passagem (50s) de propósito:
  // uma concessão mais curta que a execução seria ceifada debaixo de um
  // trabalhador que ainda está trabalhando, e dois trabalhadores rodariam o
  // mesmo handler ao mesmo tempo. O orçamento fica bem abaixo do maxDuration
  // da rota para que a parada seja NOSSA, e não da hospedagem.
  leaseSeconds: 300,
  timeBudgetMs: 50_000,
  reapBatch: 100,
};

export interface DrainCounters {
  reaped_released: number;
  reaped_dead_lettered: number;
  producers_enqueued: number;
  events_routed: number;
  events_routing_failed: number;
  jobs_created: number;
  claimed: number;
  completed: number;
  retried: number;
  dead_letter: number;
  stale_completions: number;
  duration_ms: number;
  stopped_early: boolean;
}

export async function drainOnce(
  limits: DrainLimits = DEFAULT_LIMITS,
  workerId = `apex-worker-${randomUUID().slice(0, 8)}`,
): Promise<DrainCounters> {
  const startedAt = Date.now();
  const remainingMs = () => limits.timeBudgetMs - (Date.now() - startedAt);
  const supabase = platformServiceClient();
  const counters: DrainCounters = {
    reaped_released: 0, reaped_dead_lettered: 0, producers_enqueued: 0,
    events_routed: 0, events_routing_failed: 0, jobs_created: 0,
    claimed: 0, completed: 0, retried: 0, dead_letter: 0, stale_completions: 0,
    duration_ms: 0, stopped_early: false,
  };

  // ---- 1 · ceifar ----
  const reap = await supabase.rpc('apex_jobs_reap', { p_limit: limits.reapBatch });
  if (reap.error) throw new Error(`Ceifa falhou: ${reap.error.message}`);
  const reapRow = firstRow(reap.data) as { released?: number; dead_lettered?: number } | null;
  counters.reaped_released = Number(reapRow?.released ?? 0);
  counters.reaped_dead_lettered = Number(reapRow?.dead_lettered ?? 0);

  // ---- 2 · produtores agendados ----
  for (const producer of SCHEDULED_PRODUCERS) {
    try {
      counters.producers_enqueued += await producer.produce(supabase, new Date());
    } catch (error) {
      /*
        Um produtor que falha NÃO derruba a passagem: o resto da fila continua
        sendo trabalho legítimo. Mas ele também não some — vai para o log
        estruturado, com o nome, e sem payload.
      */
      console.error('[apex-worker] produtor falhou', {
        producer: producer.name, error: classifyJobError(error).safe,
      });
    }
  }

  // ---- 3 · rotear ----
  const route = await supabase.rpc('apex_route_pending_events', { p_limit: limits.maxRouteBatch });
  if (route.error) throw new Error(`Roteamento falhou: ${route.error.message}`);
  const routeRow = firstRow(route.data) as
    { events_routed?: number; jobs_created?: number; events_failed?: number } | null;
  counters.events_routed = Number(routeRow?.events_routed ?? 0);
  counters.jobs_created = Number(routeRow?.jobs_created ?? 0);
  counters.events_routing_failed = Number(routeRow?.events_failed ?? 0);

  // ---- 4 · reivindicar e executar ----
  let executed = 0;
  while (executed < limits.maxJobs) {
    if (remainingMs() < 5_000) { counters.stopped_early = true; break; }

    const batchSize = Math.min(5, limits.maxJobs - executed);
    const claim = await supabase.rpc('apex_jobs_claim', {
      p_worker: workerId, p_limit: batchSize, p_lease_seconds: limits.leaseSeconds,
    });
    if (claim.error) throw new Error(`Reivindicação falhou: ${claim.error.message}`);
    const jobs = (claim.data ?? []) as ClaimedJob[];
    if (jobs.length === 0) break;
    counters.claimed += jobs.length;

    for (const job of jobs) {
      executed += 1;
      const outcome = await executeJob(job, supabase, remainingMs, workerId);
      if (outcome === 'completed') counters.completed += 1;
      else if (outcome === 'retried') counters.retried += 1;
      else if (outcome === 'dead_letter') counters.dead_letter += 1;
      else counters.stale_completions += 1;
    }
  }

  counters.duration_ms = Date.now() - startedAt;
  return counters;
}

type Outcome = 'completed' | 'retried' | 'dead_letter' | 'stale';

async function executeJob(
  job: ClaimedJob,
  supabase: ReturnType<typeof platformServiceClient>,
  remainingMs: () => number,
  workerId: string,
): Promise<Outcome> {
  const startedAt = Date.now();
  const log = (result: string, extra: Record<string, unknown> = {}) => {
    /*
      Identificadores, nunca payload. O payload é o lugar onde nome de arquivo,
      trecho de contrato e id de documento aparecem juntos; despejá-lo no log a
      cada execução é vazamento por hábito.
    */
    console.info('[apex-worker]', {
      worker: workerId, organization_id: job.organization_id, job_id: job.id,
      job_type: job.job_type, event_id: job.event_id, correlation_id: job.correlation_id,
      attempt: job.attempt_count, result, duration_ms: Date.now() - startedAt, ...extra,
    });
  };

  try {
    if (!isJobType(job.job_type)) {
      throw new TerminalJobError('unknown_job_type',
        `Tipo de trabalho desconhecido: ${job.job_type}.`);
    }
    const handler = JOB_HANDLERS[job.job_type];
    if (handler.payloadVersion !== job.payload_version) {
      throw new TerminalJobError('unsupported_payload_version',
        `Versão de payload ${job.payload_version} não é entendida por ${job.job_type}.`);
    }
    const payload = parseJobPayload(job.job_type, job.payload_version, job.payload);

    /*
      O despacho é por chave neste objeto e mais nada — nunca por nome montado a
      partir do payload. O elenco existe porque `handler` e `payload` foram
      estreitados para o MESMO `job.job_type` em duas expressões separadas, e o
      compilador não consegue casá-los; a segurança real veio de
      `isJobType` + `parseJobPayload` logo acima.
    */
    await (handler.run as (p: unknown, c: HandlerContext) => Promise<Record<string, unknown>>)(
      payload, { job, supabase, remainingMs });

    const done = await supabase.rpc('apex_jobs_complete', {
      p_job_id: job.id, p_lock_token: job.lock_token,
    });
    if (done.error) throw new Error(`Conclusão falhou: ${done.error.message}`);
    if (done.data !== true) {
      // A concessão foi perdida enquanto o handler rodava. O efeito
      // idempotente já aconteceu; quem tem a posse agora decide o desfecho.
      log('stale_lease');
      return 'stale';
    }
    log('completed');
    return 'completed';
  } catch (error) {
    const classified = error instanceof UnknownJobError
      ? { retryable: false, code: 'unknown_job_type', safe: error.message }
      : classifyJobError(error);
    const failed = await supabase.rpc('apex_jobs_fail', {
      p_job_id: job.id, p_lock_token: job.lock_token,
      p_error_code: classified.code, p_error_safe: classified.safe,
      p_retryable: classified.retryable,
    });
    if (failed.error) throw new Error(`Registro de falha falhou: ${failed.error.message}`);
    const status = String(failed.data ?? 'STALE');
    log(status.toLowerCase(), { error_code: classified.code, error_safe: classified.safe });
    if (status === 'PENDING') return 'retried';
    if (status === 'DEAD_LETTER') return 'dead_letter';
    return 'stale';
  }
}

function firstRow(data: unknown): unknown {
  if (Array.isArray(data)) return data[0] ?? null;
  return data ?? null;
}
