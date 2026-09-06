/**
 * Correção 123 — provada em execução, aplicada como a 119–122.
 *
 *   node scripts/apply-contracts-v2-phase4-123.mjs           # ENSAIO
 *   node scripts/apply-contracts-v2-phase4-123.mjs --apply   # COMMIT
 *
 * A prova é o próprio defeito, reproduzido antes e depois: apagar um trabalho
 * referenciado por um pedido de extração, e apagar um inquilino que tenha os
 * dois. Antes da correção, as duas coisas derrubavam a transação.
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
  if (tip !== '122') { ok = false; throw new Error(`registro em ${tip}; a 123 espera 122.`); }

  await c.query('BEGIN');

  // ---- o defeito, reproduzido ANTES da correção ----
  console.log('\n=== O DEFEITO, ANTES ===');
  const scenario = async () => {
    const org = (await c.query(
      `INSERT INTO organizations (name, slug) VALUES ('[P4-123] Org', $1) RETURNING id`,
      [`p4-123-${Math.random().toString(36).slice(2, 10)}`])).rows[0].id;
    const con = (await c.query(
      `INSERT INTO contracts (organization_id, title) VALUES ($1, '[P4-123] Contrato') RETURNING id`,
      [org])).rows[0].id;
    const doc = (await c.query(
      `INSERT INTO contract_documents (organization_id, contract_id, title, file_path, document_type)
       VALUES ($1, $2, '[P4-123] Doc', 'p4-123/x.pdf', 'contract') RETURNING id`, [org, con])).rows[0].id;
    const req = (await c.query(
      'SELECT public.contract_clause_extraction_request($1,$2,$3,NULL) AS r', [org, con, doc])).rows[0].r;
    return { org, req };
  };
  const attempt = async (fn) => {
    await c.query('SAVEPOINT probe');
    try { await fn(); await c.query('RELEASE SAVEPOINT probe'); return null; }
    catch (e) { await c.query('ROLLBACK TO SAVEPOINT probe'); return e.code ?? 'erro'; }
  };

  const before = await scenario();
  const failedDeleteJob = await attempt(() =>
    c.query('DELETE FROM apex_jobs WHERE id = $1', [before.req.job_id]));
  must('apagar o trabalho referenciado FALHAVA', failedDeleteJob === '23502',
    `código ${failedDeleteJob ?? 'passou'}`);
  const failedDeleteOrg = await attempt(async () => {
    await c.query('DELETE FROM apex_jobs WHERE organization_id = $1', [before.org]);
  });
  must('a cascata do inquilino esbarrava no mesmo NOT NULL', failedDeleteOrg === '23502',
    `código ${failedDeleteOrg ?? 'passou'}`);

  // ---- a correção ----
  console.log('\n-> 123_contracts_extraction_request_set_null_scope.sql');
  await c.query(readFileSync('supabase/migrations/123_contracts_extraction_request_set_null_scope.sql', 'utf8')
    .replace(/^\s*BEGIN;\s*$/gm, '').replace(/^\s*COMMIT;\s*$/gm, ''));
  await recordMigrationApplied(c, '123', 'contracts_extraction_request_set_null_scope');
  console.log('   OK (aplicada e registrada)');

  // ---- o mesmo cenário, DEPOIS ----
  console.log('\n=== O MESMO CENÁRIO, DEPOIS ===');
  const after = await scenario();
  const nowDeleteJob = await attempt(() =>
    c.query('DELETE FROM apex_jobs WHERE id = $1', [after.req.job_id]));
  must('apagar o trabalho referenciado passa', nowDeleteJob === null, String(nowDeleteJob));
  const orphan = (await c.query(
    'SELECT organization_id, job_id FROM contract_clause_extraction_requests WHERE id = $1',
    [after.req.request_id])).rows[0];
  must('só a referência foi anulada', orphan.job_id === null && orphan.organization_id === after.org);

  const third = await scenario();
  const nowDeleteOrg = await attempt(() =>
    c.query('DELETE FROM organizations WHERE id = $1', [third.org]));
  must('o apagamento privilegiado do inquilino passa', nowDeleteOrg === null, String(nowDeleteOrg));
  must('e não deixou linha para trás',
    (await c.query(`SELECT (SELECT count(*) FROM apex_jobs WHERE organization_id=$1)
       + (SELECT count(*) FROM contract_clause_extraction_requests WHERE organization_id=$1) n`,
      [third.org])).rows[0].n === '0');

  // ---- a amarra de inquilino continua inteira ----
  console.log('\n=== A AMARRA DE INQUILINO CONTINUA INTEIRA ===');
  const foreign = await scenario();
  const crossTenant = await attempt(() =>
    c.query('UPDATE contract_clause_extraction_requests SET job_id = $1 WHERE id = $2',
      [after.req.job_id, foreign.req.request_id]));
  must('o pedido não aponta para trabalho de outro inquilino', crossTenant !== null,
    `código ${crossTenant ?? 'PASSOU'}`);
  must('a restrição ficou escopada em job_id',
    (await c.query(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint
       WHERE conname='ccer_job_tenant'`)).rows[0].d.includes('SET NULL (job_id)'));
  must('a restrição ficou escopada em analysis_id',
    (await c.query(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint
       WHERE conname='ccer_analysis_tenant'`)).rows[0].d.includes('SET NULL (analysis_id)'));

  // limpeza do cenário
  for (const org of [before.org, after.org, foreign.org]) {
    await c.query('DELETE FROM organizations WHERE id = $1', [org]);
  }
  must('nenhum resíduo do ensaio',
    (await c.query(`SELECT count(*) n FROM organizations WHERE name LIKE '[P4-123]%'`)).rows[0].n === '0');
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
