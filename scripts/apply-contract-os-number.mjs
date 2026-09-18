/** Rehearses or applies and atomically registers forward-only migration 169. */
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
  if (tip !== '168') throw new Error(`Expected registry tip 168, received ${tip}.`);
  const files = readdirSync('supabase/migrations').filter((file) => file.startsWith('169_'));
  if (files.length !== 1) throw new Error(`Expected one migration 169, found ${files.length}.`);

  /*
    A migration se declara ESTRITAMENTE ADITIVA. O que se mede antes, para
    comparar depois, é justamente o que ela promete não tocar: a superfície de
    RLS de `contracts` e a contagem de linhas da tabela.
  */
  const before = (await db.query(`SELECT
    (SELECT count(*)::int FROM pg_policies WHERE schemaname='public' AND tablename='contracts') policies,
    (SELECT count(*)::int FROM public.contracts) contracts,
    (SELECT relrowsecurity FROM pg_class WHERE oid='public.contracts'::regclass) rls`)).rows[0];

  await db.query('BEGIN');
  await db.query(strip(readFileSync('supabase/migrations/169_contract_os_number.sql', 'utf8')));
  await recordMigrationApplied(db, '169', 'contract_os_number');

  const proof = (await db.query(`SELECT
    (SELECT data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='contracts' AND column_name='os_number') data_type,
    (SELECT is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='contracts' AND column_name='os_number') is_nullable,
    (SELECT column_default FROM information_schema.columns
      WHERE table_schema='public' AND table_name='contracts' AND column_name='os_number') column_default,
    (SELECT count(*)::int FROM pg_constraint
      WHERE conrelid='public.contracts'::regclass
        AND 'os_number' = ANY (SELECT a.attname FROM pg_attribute a
          WHERE a.attrelid=conrelid AND a.attnum = ANY (conkey))) os_constraints,
    col_description('public.contracts'::regclass,
      (SELECT attnum FROM pg_attribute
        WHERE attrelid='public.contracts'::regclass AND attname='os_number')) comment,
    (SELECT count(*)::int FROM pg_policies WHERE schemaname='public' AND tablename='contracts') policies,
    (SELECT count(*)::int FROM public.contracts) contracts,
    (SELECT relrowsecurity FROM pg_class WHERE oid='public.contracts'::regclass) rls,
    (SELECT version FROM supabase_migrations.schema_migrations
      ORDER BY version::int DESC LIMIT 1) registry_tip`)).rows[0];

  if (proof.data_type !== 'text'
      || proof.is_nullable !== 'YES'
      || proof.column_default !== null
      || Number(proof.os_constraints) !== 0
      || !proof.comment
      || proof.policies !== before.policies
      || proof.contracts !== before.contracts
      || proof.rls !== before.rls
      || proof.registry_tip !== '169') {
    throw new Error(`Migration 169 additive/registry proof failed: ${JSON.stringify({ before, proof })}`);
  }

  if (apply) {
    await db.query('COMMIT');
    console.log('Migration 169 + registry committed.');
  } else {
    await db.query('ROLLBACK');
    console.log('Migration 169 rehearsal passed and rolled back.');
  }
} catch (error) {
  try { await db.query('ROLLBACK'); } catch { /* no active transaction */ }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await db.end();
}
