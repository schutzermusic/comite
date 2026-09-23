/**
 * Aplica e registra a 214 (privilégio ocioso em tabelas comerciais novas).
 * Sem `--apply` é ensaio: aplica, prova e desfaz.
 */
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';
import { recordMigrationApplied } from './lib/migration-registry.mjs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const strip = (sql) => sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gmi, '');
const TABLES = ['commercial_opportunity_stage_events', 'commercial_site_surveys',
  'commercial_site_survey_events', 'commercial_execution_starts'];

try {
  await db.connect();
  await db.query('SET SESSION default_transaction_read_only = off');
  const tip = (await db.query(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1')).rows[0]?.version;
  if (tip !== '213') throw new Error(`Esperava ponta 213, encontrei ${tip}.`);
  await db.query('BEGIN');
  const [file] = readdirSync('supabase/migrations').filter((f) => f.startsWith('214_'));
  await db.query(strip(readFileSync(`supabase/migrations/${file}`, 'utf8')));
  await recordMigrationApplied(db, '214', file.slice(4).replace(/\.sql$/, ''));

  const left = await db.query(`
    SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
     WHERE table_schema='public' AND table_name = ANY($1)
       AND (grantee = 'anon' OR (grantee = 'authenticated' AND privilege_type <> 'SELECT'))`, [TABLES]);
  const read = await db.query(`
    SELECT count(*)::int n FROM information_schema.role_table_grants
     WHERE table_schema='public' AND table_name = ANY($1) AND grantee='authenticated' AND privilege_type='SELECT'`, [TABLES]);
  if (left.rowCount > 0 || read.rows[0].n !== TABLES.length) {
    console.error('PROVAS FALHARAM:', JSON.stringify(left.rows), read.rows[0].n);
    await db.query('ROLLBACK');
    process.exit(1);
  }
  console.log('anon sem privilégio; authenticated só lê — provado.');
  if (apply) { await db.query('COMMIT'); console.log('COMMIT — 214 aplicada e registrada.'); }
  else { await db.query('ROLLBACK'); console.log('ENSAIO ok. Use --apply para cometer.'); }
} catch (error) {
  console.error('FALHOU:', error.message);
  try { await db.query('ROLLBACK'); } catch {}
  process.exitCode = 1;
} finally { await db.end(); }
