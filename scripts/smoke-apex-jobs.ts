/**
 * Smoke da Fase 4 contra a base REAL, do fato ao efeito.
 *
 * O que ele prova, que nenhum teste anterior prova: que o TRABALHADOR de
 * verdade — o TypeScript, com o registro de handlers, a classificação de erro
 * e os limites — fecha o ciclo inteiro contra o Postgres de produção:
 *
 *   fato → roteamento → trabalho → reivindicação → handler → conclusão
 *          → nova mutação autoritativa → novo fato causal
 *
 * Toda linha criada aqui vive numa organização DESCARTÁVEL, criada no início e
 * apagada no fim. Nenhum evento de negócio é fabricado em inquilino real, e
 * nenhum dado de produção é tocado.
 *
 *   npx tsx scripts/smoke-apex-jobs.ts
 */
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

async function main(): Promise<number> {
let failures = 0;
const check = (label: string, pass: boolean, detail = '') => {
  console.log(`   ${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures += 1;
};

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> =>
  (await client.query(sql, params)).rows[0] as T;

await client.connect();
await client.query('SET SESSION default_transaction_read_only = off');

const stamp = Date.now().toString(36);
let orgId = '';

try {
  console.log('=== CENÁRIO DESCARTÁVEL ===');
  orgId = (await one<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ('[SMOKE-P4] Org', $1) RETURNING id`,
    [`smoke-p4-${stamp}`])).id;
  const contractId = (await one<{ id: string }>(
    `INSERT INTO contracts (organization_id, title, start_date, end_date)
     VALUES ($1, '[SMOKE-P4] Contrato', '2026-01-01', '2026-12-31') RETURNING id`, [orgId])).id;
  const documentId = (await one<{ id: string }>(
    `INSERT INTO contract_documents (organization_id, contract_id, title, file_path, document_type)
     VALUES ($1, $2, '[SMOKE-P4] Doc', 'smoke-p4/${stamp}.pdf', 'contract') RETURNING id`,
    [orgId, contractId])).id;
  const definitionId = (await one<{ id: string }>(
    `INSERT INTO contract_obligation_definitions
       (organization_id, contract_id, title, source_document_id, activation_kind,
        activation_event_text, due_kind, due_offset_days, calendar_basis, recurrence_kind)
     VALUES ($1, $2, '[SMOKE-P4] Relatório após aceite', $3, 'external_event',
             'mediante aceite formal', 'days_after_activation', 10, 'calendar_days', 'one_time')
     RETURNING id`, [orgId, contractId, documentId])).id;
  await client.query(
    `INSERT INTO contract_obligation_event_bindings
       (organization_id, contract_id, definition_id, event_type, schema_version, occurrence_strategy)
     VALUES ($1, $2, $3, 'projects.measurement.accepted', 1, 'single')`,
    [orgId, contractId, definitionId]);
  console.log(`   organização descartável: ${orgId}`);

  // ══════════════════════════════════════════════════════════════
  console.log('\n=== 1 · FATO → ROTEAMENTO → TRABALHO → HANDLER → EFEITO ===');
  const eventId = (await one<{ id: string }>(
    `SELECT public.emit_domain_event($1, 'projects.measurement.accepted', 1,
       'project_measurement', gen_random_uuid(), $2, '{}'::jsonb,
       '2026-03-10T12:00:00Z'::timestamptz, 'system') AS id`,
    [orgId, `smoke-p4:${stamp}:aceite`])).id;
  check('o fato foi gravado', Boolean(eventId));

  const { drainOnce } = await import('../src/lib/platform/jobs/worker');
  const counters = await drainOnce({
    maxRouteBatch: 200, maxJobs: 25, leaseSeconds: 120, timeBudgetMs: 60_000, reapBatch: 100,
  }, `smoke-${stamp}`);
  console.log(`   contadores: ${JSON.stringify(counters)}`);

  const ev = await one<{ routing_state: string; route_count: number }>(
    'SELECT routing_state, route_count FROM domain_events WHERE id = $1', [eventId]);
  check('o fato foi roteado', ev.routing_state === 'ROUTED', `estado ${ev.routing_state}`);
  check('o roteamento criou UM trabalho', ev.route_count === 1, `route_count=${ev.route_count}`);

  const job = await one<{ status: string; attempt_count: number; last_error_safe: string | null }>(
    `SELECT status, attempt_count, last_error_safe FROM apex_jobs
      WHERE event_id = $1 AND job_type = 'contracts.obligation.external_activation.apply'`, [eventId]);
  check('o trabalho foi CONCLUÍDO pelo trabalhador real',
    job?.status === 'COMPLETED', `estado ${job?.status} (${job?.last_error_safe ?? 'sem erro'})`);

  const inst = await one<{ state: string; activation_state: string; activated_at: Date; due_date: Date }>(
    `SELECT state, activation_state, activated_at, due_date FROM contract_obligation_instances
      WHERE definition_id = $1 AND occurrence_key = 'single'`, [definitionId]);
  check('a obrigação foi ativada', inst?.state === 'OPEN' && inst?.activation_state === 'activated');
  // O tempo do FATO, e não o do trabalhador: o evento é de 10/03, e é essa a data.
  check('a ativação usou o tempo do NEGÓCIO',
    String(inst?.activated_at?.toISOString?.().slice(0, 10) ?? inst?.activated_at) === '2026-03-10',
    String(inst?.activated_at));
  check('o prazo derivou da ativação real (10 dias corridos)',
    String(inst?.due_date?.toISOString?.().slice(0, 10) ?? inst?.due_date) === '2026-03-20',
    String(inst?.due_date));

  const causal = await one<{ n: string; corr: string }>(
    `SELECT count(*) n, count(DISTINCT correlation_id) corr FROM domain_events
      WHERE causation_event_id = $1 AND event_type = 'contracts.obligation.instance_activated'`,
    [eventId]);
  check('a ativação emitiu UM fato causal', causal.n === '1');

  // ══════════════════════════════════════════════════════════════
  console.log('\n=== 2 · REENTREGA NÃO DUPLICA ===');
  const before = await one<{ n: string }>('SELECT count(*) n FROM domain_events WHERE organization_id = $1', [orgId]);
  await client.query(`UPDATE domain_events SET routing_state='PENDING', routed_at=NULL WHERE id=$1`, [eventId]);
  await drainOnce({ maxRouteBatch: 200, maxJobs: 25, leaseSeconds: 120, timeBudgetMs: 60_000, reapBatch: 100 },
    `smoke-${stamp}-b`);
  const after = await one<{ n: string }>('SELECT count(*) n FROM domain_events WHERE organization_id = $1', [orgId]);
  check('a segunda passagem não criou fato novo', before.n === after.n, `${before.n} -> ${after.n}`);
  const jobs = await one<{ n: string }>('SELECT count(*) n FROM apex_jobs WHERE event_id = $1', [eventId]);
  check('a segunda passagem não criou trabalho novo', jobs.n === '1', `${jobs.n} trabalho(s)`);

  // ══════════════════════════════════════════════════════════════
  console.log('\n=== 3 · MATERIALIZAÇÃO AGENDADA ===');
  const mat = await one<{ n: string }>(
    `SELECT count(*) n FROM apex_jobs WHERE organization_id = $1
       AND job_type = 'contracts.obligations.materialize'`, [orgId]);
  check('o produtor agendado enfileirou o trabalho do dia', Number(mat.n) === 1, `${mat.n} trabalho(s)`);
  const matJob = await one<{ status: string; last_error_safe: string | null }>(
    `SELECT status, last_error_safe FROM apex_jobs WHERE organization_id = $1
       AND job_type = 'contracts.obligations.materialize'`, [orgId]);
  check('a materialização foi executada e concluída',
    matJob?.status === 'COMPLETED', `${matJob?.status} (${matJob?.last_error_safe ?? 'sem erro'})`);

  // ══════════════════════════════════════════════════════════════
  console.log('\n=== 4 · EXTRAÇÃO ENFILEIRADA ===');
  const req = await one<{ r: { request_id: string; status: string; job_id: string; reused: boolean } }>(
    'SELECT public.contract_clause_extraction_request($1,$2,$3,NULL) AS r',
    [orgId, contractId, documentId]);
  check('o pedido nasceu enfileirado e durável', req.r.status === 'QUEUED' && !req.r.reused);
  const again = await one<{ r: { request_id: string; reused: boolean } }>(
    'SELECT public.contract_clause_extraction_request($1,$2,$3,NULL) AS r',
    [orgId, contractId, documentId]);
  check('o pedido repetido REUSA — o provedor não é chamado duas vezes',
    again.r.reused === true && again.r.request_id === req.r.request_id);

  /*
    O documento deste cenário não existe no bucket, de propósito: fabricar um
    PDF de contrato numa organização descartável para "ver a IA rodar" seria
    inventar dado de negócio. O que o smoke prova aqui é o outro lado, que
    também precisa funcionar: a falha determinística fecha o pedido em vez de
    girar cinco vezes, e a mensagem persistida é a SEGURA.
  */
  await drainOnce({ maxRouteBatch: 50, maxJobs: 5, leaseSeconds: 120, timeBudgetMs: 60_000, reapBatch: 50 },
    `smoke-${stamp}-c`);
  const reqRow = await one<{ status: string; error_safe: string | null }>(
    'SELECT status, error_safe FROM contract_clause_extraction_requests WHERE id = $1', [req.r.request_id]);
  check('o pedido chegou a estado terminal', ['FAILED', 'COMPLETED'].includes(reqRow.status), reqRow.status);
  const extJob = await one<{ status: string; attempt_count: number; last_error_safe: string | null }>(
    'SELECT status, attempt_count, last_error_safe FROM apex_jobs WHERE id = $1', [req.r.job_id]);
  check('a falha determinística não girou tentativas',
    extJob.attempt_count === 1, `${extJob.attempt_count} tentativa(s)`);
  const errText = `${extJob.last_error_safe ?? ''} ${reqRow.error_safe ?? ''}`;
  check('a mensagem persistida não carrega segredo nem URL',
    !/sk-|Bearer |eyJ|postgres(ql)?:\/\/|https?:\/\//.test(errText), errText.slice(0, 120));

  // ══════════════════════════════════════════════════════════════
  console.log('\n=== 5 · SAÚDE ===');
  const health = await one<{ h: Record<string, unknown> }>('SELECT public.apex_jobs_health() AS h');
  console.log(`   ${JSON.stringify(health.h)}`);
  check('a saúde responde sem payload',
    !JSON.stringify(health.h).includes('payload') && typeof health.h.due_pending_jobs !== 'undefined');
} catch (error) {
  failures += 1;
  console.error(`\n!!! FALHA: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  console.log('\n=== LIMPEZA ===');
  if (orgId) {
    await client.query('DELETE FROM contract_amendment_revisions WHERE organization_id = $1', [orgId])
      .catch(() => undefined);
    await client.query('DELETE FROM organizations WHERE id = $1', [orgId]).catch(() => undefined);
    const left = (await client.query(
      `SELECT (SELECT count(*) FROM domain_events WHERE organization_id=$1)
            + (SELECT count(*) FROM apex_jobs WHERE organization_id=$1) AS n`, [orgId])).rows[0].n;
    console.log(`   linhas remanescentes na organização descartável: ${left}`);
    if (left !== '0') failures += 1;
  }
  await client.end();
}

console.log(failures === 0 ? '\n>>> SMOKE DA FASE 4: VERDE' : `\n>>> SMOKE DA FASE 4: ${failures} FALHA(S)`);
return failures;
}

main().then((f) => process.exit(f === 0 ? 0 : 1)).catch((e) => {
  console.error(e);
  process.exit(1);
});
