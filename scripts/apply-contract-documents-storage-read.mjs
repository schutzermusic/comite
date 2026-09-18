/** Rehearses or applies and atomically registers forward-only migration 170. */
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
  if (tip !== '169') throw new Error(`Expected registry tip 169, received ${tip}.`);
  const files = readdirSync('supabase/migrations').filter((file) => file.startsWith('170_'));
  if (files.length !== 1) throw new Error(`Expected one migration 170, found ${files.length}.`);

  await db.query('BEGIN');
  await db.query(strip(readFileSync('supabase/migrations/170_contract_documents_storage_read.sql', 'utf8')));
  await recordMigrationApplied(db, '170', 'contract_documents_storage_read');

  /*
    A prova é sobre AUTORIZAÇÃO, não sobre texto de política: o braço legado
    tem de continuar de pé, o braço novo tem de existir, e a fronteira de
    tenant tem de permanecer escrita no predicado.
  */
  const proof = (await db.query(`SELECT
    (SELECT qual FROM pg_policies
      WHERE schemaname='storage' AND tablename='objects'
        AND policyname='contract_files_storage_read') qual,
    (SELECT cmd FROM pg_policies
      WHERE schemaname='storage' AND tablename='objects'
        AND policyname='contract_files_storage_read') cmd,
    (SELECT count(*) FROM pg_policies
      WHERE schemaname='storage' AND tablename='objects'
        AND policyname IN ('contract_files_storage_insert','contract_files_storage_delete')) write_policies,
    to_regclass('public.idx_contract_documents_org_file_path') IS NOT NULL file_path_index,
    (SELECT version FROM supabase_migrations.schema_migrations
      ORDER BY version::int DESC LIMIT 1) registry_tip`)).rows[0];

  const qual = proof.qual ?? '';
  if (proof.cmd !== 'SELECT'
      || !qual.includes('contract_documents')
      || !qual.includes('contract_files')
      || !qual.includes('current_user_organization_id')
      || !qual.includes('current_user_can_read_contract')
      || Number(proof.write_policies) !== 2
      || !proof.file_path_index
      || proof.registry_tip !== '170') {
    throw new Error(`Migration 170 policy/registry proof failed: ${JSON.stringify(proof)}`);
  }

  if (apply) {
    await db.query('COMMIT');
    console.log('Migration 170 + registry committed.');
  } else {
    await db.query('ROLLBACK');
    console.log('Migration 170 rehearsal passed and rolled back.');
  }
} catch (error) {
  try { await db.query('ROLLBACK'); } catch { /* no active transaction */ }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await db.end();
}
