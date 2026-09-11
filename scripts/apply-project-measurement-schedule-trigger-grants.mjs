/** Applies and atomically registers forward-only migration 164. */
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
  if (tip !== '163') throw new Error(`Expected registry tip 163, received ${tip}.`);
  const files = readdirSync('supabase/migrations').filter((file) => file.startsWith('164_'));
  if (files.length !== 1) throw new Error(`Expected one migration 164, found ${files.length}.`);
  await db.query('BEGIN');
  await db.query(strip(readFileSync(
    'supabase/migrations/164_project_measurement_schedule_trigger_grants.sql', 'utf8')));
  await recordMigrationApplied(db, '164', 'project_measurement_schedule_trigger_grants');
  const privilege = (await db.query(`SELECT
    has_function_privilege('anon','public.project_measurements_emit_schedule_anchor_event()','EXECUTE') anon,
    has_function_privilege('authenticated','public.project_measurements_emit_schedule_anchor_event()','EXECUTE') authenticated`)).rows[0];
  if (privilege?.anon || privilege?.authenticated) {
    throw new Error('Migration 164 browser grant proof failed.');
  }
  if (apply) {
    await db.query('COMMIT');
    console.log('Migration 164 + registry committed.');
  } else {
    await db.query('ROLLBACK');
    console.log('Migration 164 rehearsal passed and rolled back.');
  }
} catch (error) {
  try { await db.query('ROLLBACK'); } catch { /* no active transaction */ }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally { await db.end(); }
