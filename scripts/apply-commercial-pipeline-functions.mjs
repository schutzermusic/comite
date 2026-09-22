/** Aplica e registra a migration 202 (funções governadas do funil comercial). */
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';
import { recordMigrationApplied } from './lib/migration-registry.mjs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const strip = (sql) => sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gmi, '');
const FUNCTIONS = [
  'commercial_contact_upsert', 'commercial_opportunity_upsert', 'commercial_proposal_create',
  'commercial_proposal_revise', 'commercial_proposal_revision_transition',
  'commercial_fact_record', 'commercial_fact_confirm', 'commercial_blueprint_create',
];

try {
  await db.connect();
  await db.query('SET SESSION default_transaction_read_only = off');
  const tip = (await db.query(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1')).rows[0]?.version;
  if (tip !== '201') throw new Error(`Esperava ponta 201, encontrei ${tip}.`);

  await db.query('BEGIN');
  const [file] = readdirSync('supabase/migrations').filter((f) => f.startsWith('202_'));
  await db.query(strip(readFileSync(`supabase/migrations/${file}`, 'utf8')));
  await recordMigrationApplied(db, '202', file.slice(4).replace(/\.sql$/, ''));

  const proof = await db.query(`
    SELECT p.proname,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') browser,
           has_function_privilege('service_role', p.oid, 'EXECUTE') server
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = ANY($1)`, [FUNCTIONS]);
  const failures = [];
  if (proof.rowCount !== FUNCTIONS.length) {
    failures.push(`esperava ${FUNCTIONS.length} funções, encontrei ${proof.rowCount}`);
  }
  for (const row of proof.rows) {
    if (row.browser) failures.push(`${row.proname} executável pelo navegador`);
    if (!row.server) failures.push(`${row.proname} inacessível ao servidor`);
  }
  if (failures.length) {
    console.error('PROVAS FALHARAM:\n- ' + failures.join('\n- '));
    await db.query('ROLLBACK');
    process.exit(1);
  }
  console.log(`${proof.rowCount} funções governadas, nenhuma alcançável pelo navegador.`);

  if (apply) { await db.query('COMMIT'); console.log('COMMIT — 202 aplicada e registrada.'); }
  else { await db.query('ROLLBACK'); console.log('ENSAIO ok. Use --apply para cometer.'); }
} catch (error) {
  console.error('FALHOU:', error.message);
  try { await db.query('ROLLBACK'); } catch {}
  process.exitCode = 1;
} finally { await db.end(); }
