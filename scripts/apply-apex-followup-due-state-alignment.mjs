/** Applies and atomically registers forward-only migration 163. */
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
  if (tip !== '162') throw new Error(`Expected registry tip 162, received ${tip}.`);
  const files = readdirSync('supabase/migrations').filter((file) => file.startsWith('163_'));
  if (files.length !== 1) throw new Error(`Expected one migration 163, found ${files.length}.`);
  await db.query('BEGIN');
  await db.query(strip(readFileSync(
    'supabase/migrations/163_apex_followup_due_state_alignment.sql', 'utf8')));
  await recordMigrationApplied(db, '163', 'apex_followup_due_state_alignment');
  const functions = (await db.query(`SELECT p.proname,p.prosecdef,p.proconfig
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN
      ('apex_followup_due_nudges','apex_followup_should_escalate')`)).rows;
  if (functions.length !== 2 || functions.some((row) => !row.prosecdef ||
    !row.proconfig?.some((value) => value.replaceAll(' ', '') === 'search_path=public,pg_temp'))) {
    throw new Error('Migration 163 function proof failed.');
  }
  if (apply) {
    await db.query('COMMIT');
    console.log('Migration 163 + registry committed.');
  } else {
    await db.query('ROLLBACK');
    console.log('Migration 163 rehearsal passed and rolled back.');
  }
} catch (error) {
  try { await db.query('ROLLBACK'); } catch { /* no active transaction */ }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally { await db.end(); }
