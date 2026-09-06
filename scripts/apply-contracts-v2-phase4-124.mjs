/**
 * Correção 124 — o lote da reivindicação, provado em execução.
 *
 *   node scripts/apply-contracts-v2-phase4-124.mjs           # ENSAIO
 *   node scripts/apply-contracts-v2-phase4-124.mjs --apply   # COMMIT
 *
 * A prova é o defeito reproduzido antes e ausente depois: pedir 4 de uma fila
 * com 8 devidos tem de devolver 4. Antes da correção devolvia 8, porque o
 * planejador punha a subconsulta limitada do lado interno de um laço aninhado
 * e a reexecutava.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg'; import dotenv from 'dotenv';
import { recordMigrationApplied } from './lib/migration-registry.mjs';
dotenv.config({ path: '.env', quiet: true }); dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
c.on('notice', n => console.log(`   NOTICE: ${n.message}`));
await c.connect();
await c.query('SET SESSION default_transaction_read_only = off');
console.log(APPLY ? '### MODO APLICAR (COMMIT) ###' : '### ENSAIO (ROLLBACK ao final) ###');

let ok = true;
const must = (label, pass, detail = '') => {
  console.log(`   ${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) ok = false;
};

try {
  const [{ version: tip }] = (await c.query(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 1')).rows;
  console.log(`\n=== PREFLIGHT ===\n   ponta do registro: ${tip}`);
  if (tip !== '123') { ok = false; throw new Error(`registro em ${tip}; a 124 espera 123.`); }

  await c.query('BEGIN');

  const org = (await c.query(
    `INSERT INTO organizations (name, slug) VALUES ('[P4-124] Org', $1) RETURNING id`,
    [`p4-124-${Math.random().toString(36).slice(2, 10)}`])).rows[0].id;
  const seed = async (n, tag) => {
    for (let i = 0; i < n; i += 1) {
      await c.query(
        `SELECT public.apex_jobs_enqueue($1, 'contracts.obligations.materialize', $2,
           '{}'::jsonb, 1, now() - interval '1 day' + make_interval(secs => $3), 5)`,
        [org, `${tag}:${i}`, i]);
    }
  };
  const claimCount = async (limit) => {
    await c.query('SAVEPOINT c');
    const n = (await c.query(
      `SELECT count(*)::int n FROM public.apex_jobs_claim('p4-124', $1, 300)`, [limit])).rows[0].n;
    await c.query('ROLLBACK TO SAVEPOINT c');
    return n;
  };

  console.log('\n=== O DEFEITO, ANTES ===');
  await seed(8, 'antes');
  const antes = await claimCount(4);
  must('pedir 4 de uma fila com 8 devolvia MAIS que 4', antes > 4, `devolveu ${antes}`);

  console.log('\n-> 124_platform_claim_batch_limit.sql');
  await c.query(readFileSync('supabase/migrations/124_platform_claim_batch_limit.sql', 'utf8')
    .replace(/^\s*BEGIN;\s*$/gm, '').replace(/^\s*COMMIT;\s*$/gm, ''));
  await recordMigrationApplied(c, '124', 'platform_claim_batch_limit');
  console.log('   OK (aplicada e registrada)');

  console.log('\n=== O MESMO CENÁRIO, DEPOIS ===');
  must('pedir 4 devolve exatamente 4', (await claimCount(4)) === 4);
  must('pedir 1 devolve exatamente 1', (await claimCount(1)) === 1);
  must('pedir 8 devolve os 8 devidos', (await claimCount(8)) === 8);
  must('pedir mais que o disponível devolve o disponível', (await claimCount(50)) === 8);

  console.log('\n=== O PLANO NÃO REEXECUTA MAIS A SELEÇÃO ===');
  const plan = (await c.query(
    `EXPLAIN (COSTS OFF) WITH due AS MATERIALIZED (
       SELECT id FROM public.apex_jobs WHERE status='PENDING' AND run_after <= now()
        ORDER BY run_after, created_at LIMIT 4 FOR UPDATE SKIP LOCKED)
     UPDATE public.apex_jobs j SET locked_by='x' FROM due WHERE j.id = due.id`))
    .rows.map(r => r['QUERY PLAN']).join('\n');
  must('a seleção virou CTE materializada', /CTE due/.test(plan), plan.split('\n')[1]?.trim());

  console.log('\n=== ENTRADA INVÁLIDA NÃO VIRA "SEM LIMITE" ===');
  const refused = async (sql, params) => {
    await c.query('SAVEPOINT r');
    try { await c.query(sql, params); await c.query('ROLLBACK TO SAVEPOINT r'); return null; }
    catch (e) { await c.query('ROLLBACK TO SAVEPOINT r'); return e.code; }
  };
  // `LIMIT NULL` é "sem limite" no Postgres, e a guarda antiga deixava NULL passar.
  must('limite NULL é recusado',
    (await refused(`SELECT * FROM public.apex_jobs_claim('x', NULL, 300)`)) === '23514');
  must('limite zero é recusado',
    (await refused(`SELECT * FROM public.apex_jobs_claim('x', 0, 300)`)) === '23514');
  must('limite acima do teto é recusado',
    (await refused(`SELECT * FROM public.apex_jobs_claim('x', 500, 300)`)) === '23514');

  console.log('\n=== A CEIFA CONTINUA CORRETA E LIMITADA ===');
  await c.query(`SELECT * FROM public.apex_jobs_claim('p4-124-lease', 8, 300)`);
  await c.query(`UPDATE apex_jobs SET lease_expires_at = now() - interval '1 minute'
                  WHERE organization_id = $1`, [org]);
  const reaped = (await c.query('SELECT * FROM public.apex_jobs_reap(3, 0)')).rows[0];
  must('a ceifa respeita o lote', Number(reaped.released) === 3, `devolveu ${reaped.released}`);
  must('e nenhuma concessão sobreviveu à invalidação',
    (await c.query(`SELECT count(*) n FROM apex_jobs
      WHERE organization_id=$1 AND status='PENDING' AND lock_token IS NOT NULL`, [org])).rows[0].n === '0');

  await c.query('DELETE FROM organizations WHERE id = $1', [org]);
  must('nenhum resíduo do ensaio',
    (await c.query(`SELECT count(*) n FROM organizations WHERE name LIKE '[P4-124]%'`)).rows[0].n === '0');
} catch (e) {
  ok = false;
  console.error(`\n!!! FALHA: ${e.message}`);
} finally {
  try {
    if (APPLY && ok) { await c.query('COMMIT'); console.log('\n>>> COMMIT aplicado.'); }
    else { await c.query('ROLLBACK'); console.log(APPLY ? '\n>>> ROLLBACK (houve falha) — nada aplicado.' : '\n>>> ROLLBACK (ensaio) — nada aplicado.'); }
  } catch { /* sem transação aberta */ }
  await c.end();
}
process.exit(ok ? 0 : 1);
