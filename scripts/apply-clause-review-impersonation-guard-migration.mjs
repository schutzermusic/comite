import { readFileSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';
import { recordMigrationApplied } from './lib/migration-registry.mjs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error('SUPABASE_DB_URL ausente. Migração 153 não executada.');
  process.exit(2);
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
const stripTransaction = (sql) => sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gmi, '');
let ok = true;
const must = (label, condition, detail = '') => {
  console.log(`   ${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) ok = false;
};

try {
  await client.connect();
  await client.query('SET SESSION default_transaction_read_only = off');

  const tip = (await client.query(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1',
  )).rows[0]?.version;
  must('ponta do registro é 152', tip === '152', String(tip));
  if (tip !== '152') throw new Error(`ponta de migration inesperada: ${tip}`);

  await client.query('BEGIN');
  await client.query(stripTransaction(readFileSync(
    'supabase/migrations/153_clause_review_impersonation_guard.sql',
    'utf8',
  )));
  await recordMigrationApplied(client, '153', 'clause_review_impersonation_guard');

  // Verify trigger exists and is active on contract_clauses
  const triggerRes = await client.query(`
    SELECT tgname, tgenabled
      FROM pg_trigger
     WHERE tgname = 'guard_review_impersonation'
       AND tgrelid = 'public.contract_clauses'::regclass
  `);
  must('gatilho guard_review_impersonation ativo', triggerRes.rows.length === 1 && triggerRes.rows[0].tgenabled === 'O');

  // Verify function exists
  const funcRes = await client.query(`
    SELECT proname, prosecdef
      FROM pg_proc
     WHERE proname = 'contracts_guard_review_impersonation'
  `);
  must('função contracts_guard_review_impersonation presente e security definer',
    funcRes.rows.length === 1 && funcRes.rows[0].prosecdef === true);

  if (!ok) throw new Error('bateria da migration reprovada');

  if (apply) {
    await client.query('COMMIT');
    console.log('=== MIGRATION 153 COMETIDA E REGISTRADA NO REGISTRO CANÔNICO ===');
  } else {
    await client.query('ROLLBACK');
    console.log('=== ENSAIO APROVADO; DESFEITO ===');
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error(`✗ FALHOU: ${error instanceof Error ? error.message : String(error)}`);
  ok = false;
} finally {
  await client.end().catch(() => undefined);
}

process.exit(ok ? 0 : 1);
