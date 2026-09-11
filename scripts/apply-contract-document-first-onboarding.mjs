/** Rehearses or applies and atomically registers forward-only migration 166. */
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
  if (tip !== '165') throw new Error(`Expected registry tip 165, received ${tip}.`);
  const files = readdirSync('supabase/migrations').filter((file) => file.startsWith('166_'));
  if (files.length !== 1) throw new Error(`Expected one migration 166, found ${files.length}.`);

  await db.query('BEGIN');
  await db.query(strip(readFileSync('supabase/migrations/166_contract_document_first_onboarding.sql', 'utf8')));
  await recordMigrationApplied(db, '166', 'contract_document_first_onboarding');
  const proof = (await db.query(`SELECT
    has_function_privilege('authenticated','public.contract_onboarding_enqueue(uuid,uuid)','EXECUTE') browser_enqueue,
    has_function_privilege('service_role','public.contract_onboarding_enqueue(uuid,uuid)','EXECUTE') service_enqueue,
    has_function_privilege('authenticated','public.contract_onboarding_finalize(uuid,uuid,uuid,jsonb)','EXECUTE') browser_finalize,
    has_function_privilege('service_role','public.contract_onboarding_finalize(uuid,uuid,uuid,jsonb)','EXECUTE') service_finalize,
    has_table_privilege('authenticated','public.contract_onboarding_intakes','INSERT') browser_insert,
    (SELECT relrowsecurity FROM pg_class WHERE oid='public.contract_onboarding_intakes'::regclass) rls,
    (SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1) registry_tip`)).rows[0];
  if (proof.browser_enqueue || !proof.service_enqueue || proof.browser_finalize || !proof.service_finalize
      || proof.browser_insert || !proof.rls || proof.registry_tip !== '166') {
    throw new Error(`Migration 166 security/registry proof failed: ${JSON.stringify(proof)}`);
  }
  if (apply) {
    await db.query('COMMIT');
    console.log('Migration 166 + registry committed.');
  } else {
    await db.query('ROLLBACK');
    console.log('Migration 166 rehearsal passed and rolled back.');
  }
} catch (error) {
  try { await db.query('ROLLBACK'); } catch { /* no active transaction */ }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await db.end();
}
