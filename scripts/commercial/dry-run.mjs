/**
 * Ensaio de migration: aplica dentro de uma transação e SEMPRE faz ROLLBACK.
 * Nenhum estado real é tocado. Uso: node scripts/commercial/dry-run.mjs 197 198 ...
 */
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const versions = process.argv.slice(2).filter((a) => /^\d+$/.test(a));
if (!versions.length) { console.error('Informe ao menos uma versão.'); process.exit(2); }

const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('SUPABASE_DB_URL ausente.'); process.exit(2); }

const strip = (sql) => sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gmi, '');
const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

let failed = false;
try {
  await db.connect();
  await db.query('SET SESSION default_transaction_read_only = off');
  await db.query('BEGIN');
  for (const v of versions) {
    const [file] = readdirSync('supabase/migrations').filter((f) => f.startsWith(`${v}_`));
    if (!file) throw new Error(`Migration ${v} não encontrada.`);
    process.stdout.write(`applying ${file} ... `);
    await db.query(strip(readFileSync(`supabase/migrations/${file}`, 'utf8')));
    console.log('ok');
  }
  // Provas imediatas dentro do mesmo ensaio.
  const proof = await db.query(`SELECT
    (SELECT count(*)::int FROM public.commercial_engagements) engagements,
    (SELECT count(*)::int FROM public.commercial_engagement_authorizations) authorizations,
    (SELECT count(*)::int FROM public.engagement_project_links) project_links,
    (SELECT count(*)::int FROM public.contracts WHERE deleted_at IS NULL AND engagement_id IS NULL) orphan_contracts,
    (SELECT count(*)::int FROM public.commercial_engagements WHERE status='UNDER_ANALYSIS') under_analysis,
    (SELECT count(*)::int FROM public.commercial_engagements WHERE status='UNDER_ANALYSIS' AND authorized_value IS NOT NULL) kpi_leak`);
  console.log(proof.rows[0]);
} catch (error) {
  failed = true;
  console.error('\nFALHOU:', error.message);
  if (error.detail) console.error('detail:', error.detail);
  if (error.where) console.error('where:', error.where);
} finally {
  try { await db.query('ROLLBACK'); console.log('ROLLBACK aplicado — banco intocado.'); } catch {}
  await db.end();
}
process.exit(failed ? 1 : 0);
