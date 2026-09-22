/** Aplica e registra a migration 203 (retirada de privilégio de `anon`). */
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';
import { recordMigrationApplied } from './lib/migration-registry.mjs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
const TABLES = [
  'commercial_engagements', 'commercial_engagement_authorizations', 'engagement_project_links',
  'commercial_divergences', 'commercial_contacts', 'commercial_opportunities',
  'commercial_proposals', 'commercial_proposal_revisions', 'commercial_extracted_facts',
  'commercial_execution_blueprints', 'commercial_execution_blueprint_items',
  'internal_service_orders', 'commercial_engagement_history',
];
const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const strip = (sql) => sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gmi, '');

try {
  await db.connect();
  await db.query('SET SESSION default_transaction_read_only = off');
  await db.query('BEGIN');
  const [file] = readdirSync('supabase/migrations').filter((f) => f.startsWith('203_'));
  await db.query(strip(readFileSync(`supabase/migrations/${file}`, 'utf8')));
  await recordMigrationApplied(db, '203', file.slice(4).replace(/\.sql$/, ''));

  const anon = await db.query(`
    SELECT DISTINCT table_name FROM information_schema.role_table_grants
     WHERE grantee='anon' AND table_schema='public' AND table_name = ANY($1)`, [TABLES]);
  const reads = await db.query(`
    SELECT count(*)::int n FROM information_schema.role_table_grants
     WHERE grantee='authenticated' AND privilege_type='SELECT'
       AND table_schema='public' AND table_name = ANY($1)`, [TABLES]);
  const writes = await db.query(`
    SELECT count(*)::int n FROM information_schema.role_table_grants
     WHERE grantee='authenticated' AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
       AND table_schema='public' AND table_name = ANY($1)`, [TABLES]);

  const failures = [];
  if (anon.rowCount !== 0) failures.push(`anon ainda alcança: ${anon.rows.map((r) => r.table_name)}`);
  if (reads.rows[0].n !== TABLES.length) {
    failures.push(`leitura de authenticated: ${reads.rows[0].n}/${TABLES.length}`);
  }
  if (writes.rows[0].n !== 0) failures.push(`authenticated ainda escreve em ${writes.rows[0].n} tabela(s)`);

  if (failures.length) {
    console.error('PROVAS FALHARAM:\n- ' + failures.join('\n- '));
    await db.query('ROLLBACK');
    process.exit(1);
  }
  console.log(`anon: 0 privilégios · authenticated: ${reads.rows[0].n} leituras, 0 escritas.`);

  if (apply) { await db.query('COMMIT'); console.log('COMMIT — 203 aplicada e registrada.'); }
  else { await db.query('ROLLBACK'); console.log('ENSAIO ok. Use --apply para cometer.'); }
} catch (error) {
  console.error('FALHOU:', error.message);
  try { await db.query('ROLLBACK'); } catch {}
  process.exitCode = 1;
} finally { await db.end(); }
