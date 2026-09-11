/** Rehearses or applies and atomically registers forward-only migration 165. */
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
  if (tip !== '164') throw new Error(`Expected registry tip 164, received ${tip}.`);
  const files = readdirSync('supabase/migrations').filter((file) => file.startsWith('165_'));
  if (files.length !== 1) throw new Error(`Expected one migration 165, found ${files.length}.`);

  await db.query('BEGIN');
  await db.query(strip(readFileSync('supabase/migrations/165_contract_amendment_ai_onboarding.sql', 'utf8')));
  await recordMigrationApplied(db, '165', 'contract_amendment_ai_onboarding');
  const proof = (await db.query(`SELECT
    has_function_privilege('authenticated',
      'public.contract_amendment_ingestion_request(uuid,uuid,uuid,uuid)','EXECUTE') browser_request,
    has_function_privilege('service_role',
      'public.contract_amendment_ingestion_request(uuid,uuid,uuid,uuid)','EXECUTE') service_request,
    has_table_privilege('authenticated','public.contract_amendment_effects','INSERT') browser_effect_write,
    (SELECT version FROM supabase_migrations.schema_migrations
      ORDER BY version::int DESC LIMIT 1) registry_tip`)).rows[0];
  if (proof.browser_request || !proof.service_request || proof.browser_effect_write || proof.registry_tip !== '165') {
    throw new Error(`Migration 165 security/registry proof failed: ${JSON.stringify(proof)}`);
  }
  if (apply) {
    await db.query('COMMIT');
    console.log('Migration 165 + registry committed.');
  } else {
    await db.query('ROLLBACK');
    console.log('Migration 165 rehearsal passed and rolled back.');
  }
} catch (error) {
  try { await db.query('ROLLBACK'); } catch { /* no active transaction */ }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await db.end();
}
