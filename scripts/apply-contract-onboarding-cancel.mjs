/** Rehearses or applies and atomically registers forward-only migration 173. */
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
  if (tip !== '172') throw new Error(`Expected registry tip 172, received ${tip}.`);
  const files = readdirSync('supabase/migrations').filter((file) => file.startsWith('173_'));
  if (files.length !== 1) throw new Error(`Expected one migration 173, found ${files.length}.`);

  const before = (await db.query(`SELECT
    (SELECT count(*)::int FROM public.contract_onboarding_intakes) intakes,
    (SELECT count(*)::int FROM pg_policies WHERE schemaname='public'
      AND tablename='contract_onboarding_intakes') policies,
    (SELECT relrowsecurity FROM pg_class WHERE oid='public.contract_onboarding_intakes'::regclass) rls`
  )).rows[0];

  await db.query('BEGIN');
  await db.query(strip(readFileSync(`supabase/migrations/${files[0]}`, 'utf8')));
  await recordMigrationApplied(db, '173', 'contract_onboarding_cancel');

  const proof = (await db.query(`SELECT
    has_function_privilege('authenticated','public.contract_onboarding_cancel(uuid,uuid,uuid)','EXECUTE') browser_cancel,
    has_function_privilege('service_role','public.contract_onboarding_cancel(uuid,uuid,uuid)','EXECUTE') service_cancel,
    (SELECT prosrc FROM pg_proc WHERE proname='contract_onboarding_cancel' LIMIT 1) body,
    (SELECT count(*)::int FROM public.contract_onboarding_intakes) intakes,
    (SELECT count(*)::int FROM pg_policies WHERE schemaname='public'
      AND tablename='contract_onboarding_intakes') policies,
    (SELECT relrowsecurity FROM pg_class WHERE oid='public.contract_onboarding_intakes'::regclass) rls,
    (SELECT version FROM supabase_migrations.schema_migrations
      ORDER BY version::int DESC LIMIT 1) registry_tip`
  )).rows[0];

  const failures = [];
  if (proof.browser_cancel) failures.push('authenticated has EXECUTE on cancel');
  if (!proof.service_cancel) failures.push('service_role missing EXECUTE on cancel');
  if (!String(proof.body || '').includes('DELETE FROM public.contract_onboarding_intakes')) {
    failures.push('cancel function does not hard-delete the intake');
  }
  if (proof.intakes !== before.intakes) failures.push(`intakes mutated: ${before.intakes} → ${proof.intakes}`);
  if (proof.policies !== before.policies) failures.push(`policies mutated: ${before.policies} → ${proof.policies}`);
  if (proof.rls !== before.rls) failures.push(`rls mutated: ${before.rls} → ${proof.rls}`);
  if (proof.registry_tip !== '173') failures.push(`registry tip ${proof.registry_tip} ≠ 173`);
  if (failures.length) throw new Error(`Migration 173 proof failed: ${failures.join('; ')}`);

  if (apply) {
    await db.query('COMMIT');
    console.log('Migration 173 + registry committed.');
  } else {
    await db.query('ROLLBACK');
    console.log('Migration 173 rehearsal passed and rolled back.');
  }
} catch (error) {
  try { await db.query('ROLLBACK'); } catch { /* no active transaction */ }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await db.end();
}
