/**
 * Applies migration 161 and records it atomically.
 *
 * Default: full 160 -> 161 rehearsal followed by ROLLBACK.
 * --apply: commit migration and canonical registry row together.
 */
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';
import { recordMigrationApplied } from './lib/migration-registry.mjs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const VERSION = '161';
const NAME = 'contracts_operationalization_release_blockers';
const apply = process.argv.includes('--apply');
const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error('SUPABASE_DB_URL ausente. Migration 161 não executada.');
  process.exit(2);
}

const stripTransaction = (sql) => sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gmi, '');
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];
let ok = true;
const must = (label, condition, detail = '') => {
  console.log(`   ${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) ok = false;
};

try {
  await client.connect();
  await client.query('SET SESSION default_transaction_read_only = off');
  const tip = (await one(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1',
  ))?.version;
  must('upgrade starts at registry tip 160', tip === '160', String(tip));
  if (tip !== '160') throw new Error(`Unexpected migration tip: ${tip}`);

  const files161 = readdirSync('supabase/migrations').filter((file) => file.startsWith('161_'));
  must('exactly one migration has version 161', files161.length === 1, files161.join(','));
  if (files161.length !== 1) throw new Error('Duplicate or missing migration 161.');

  await client.query('BEGIN');
  const sql = readFileSync(`supabase/migrations/${VERSION}_${NAME}.sql`, 'utf8');
  await client.query(stripTransaction(sql));
  await recordMigrationApplied(client, VERSION, NAME);

  const registered = await one(
    `SELECT count(*)::int n FROM supabase_migrations.schema_migrations WHERE version='161' AND name=$1`,
    [NAME],
  );
  must('migration and registry row are in the same transaction', registered.n === 1);

  const functions = await client.query(`
    SELECT p.proname, p.prosecdef, p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname = ANY($1::text[])
  `, [[
    'project_measurements_emit_schedule_anchor_event',
    'contract_obligations_apply_schedule_anchor',
    'apex_followups_enqueue_execution', 'apex_followups_execute_due',
    'apex_followup_register_evidence_candidate',
    'contracts_guard_ai_operational_authority',
  ]]);
  must('all six production functions exist', functions.rows.length === 6, String(functions.rows.length));
  must('all production functions pin search_path', functions.rows.every((row) =>
    row.proconfig?.some((value) => value.replaceAll(' ', '') === 'search_path=public,pg_temp')));

  const routes = await one(`SELECT count(*)::int n FROM public.apex_event_routes
    WHERE schema_version=1 AND job_type='contracts.obligation.schedule_anchor.apply'
      AND event_type IN ('projects.measurement.schedule_changed','projects.measurement.accepted')`);
  must('schedule and acceptance events route to the anchor job', routes.n === 2, String(routes.n));

  const tables = await one(`SELECT count(*)::int n FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN
      ('contract_operational_interpretations','apex_followup_evidence_candidates',
       'apex_followup_verification_attempts')`);
  must('trust and verification audit tables exist', tables.n === 3, String(tables.n));

  const historyFunctions = await client.query(`SELECT p.proname,p.prosecdef
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN
      ('apex_followups_reject_history_rewrite','apex_followups_reject_verification_rewrite')`);
  must('history guards are invoker functions so governed cascades see the caller',
    historyFunctions.rows.length === 2 && historyFunctions.rows.every((row) => !row.prosecdef));

  if (!ok) throw new Error('Migration 161 structural proof failed.');
  if (apply) {
    await client.query('COMMIT');
    console.log('\nMigration 161 + registry committed.');
  } else {
    await client.query('ROLLBACK');
    console.log('\nRehearsal passed and was rolled back. Use --apply to commit.');
  }
} catch (error) {
  try { await client.query('ROLLBACK'); } catch { /* no active transaction */ }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.end();
}
