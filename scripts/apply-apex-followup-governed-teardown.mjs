/** Applies and atomically registers forward-only migration 162. */
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';
import { recordMigrationApplied } from './lib/migration-registry.mjs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });
const apply = process.argv.includes('--apply');
const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('SUPABASE_DB_URL ausente.'); process.exit(2); }
const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
const strip = (sql) => sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gmi, '');
try {
  await db.connect();
  await db.query('SET SESSION default_transaction_read_only = off');
  const tip = (await db.query(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1',
  )).rows[0]?.version;
  if (tip !== '161') throw new Error(`Expected registry tip 161, received ${tip}.`);
  const files = readdirSync('supabase/migrations').filter((file) => file.startsWith('162_'));
  if (files.length !== 1) throw new Error(`Expected one migration 162, found ${files.length}.`);
  await db.query('BEGIN');
  await db.query(strip(readFileSync(
    'supabase/migrations/162_apex_followup_governed_teardown_boundary.sql', 'utf8')));
  await recordMigrationApplied(db, '162', 'apex_followup_governed_teardown_boundary');
  const guards = (await db.query(`SELECT p.proname,p.prosecdef,p.proconfig
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN
      ('apex_followups_reject_history_rewrite','apex_followups_reject_verification_rewrite',
       'apex_followups_guard_teardown','apex_followup_delete_governed')`)).rows;
  if (guards.length !== 4 || guards.some((row) =>
    !row.proconfig?.some((value) => value.replaceAll(' ', '') === 'search_path=public,pg_temp'))) {
    throw new Error('Migration 162 guard proof failed.');
  }
  if (apply) {
    await db.query('COMMIT');
    console.log('Migration 162 + registry committed.');
  } else {
    await db.query('ROLLBACK');
    console.log('Migration 162 rehearsal passed and rolled back.');
  }
} catch (error) {
  try { await db.query('ROLLBACK'); } catch { /* no active transaction */ }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally { await db.end(); }
