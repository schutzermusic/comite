/** Aplica e registra a migration 210, provando as duas metades da regra. */
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

try {
  await db.connect();
  await db.query('SET SESSION default_transaction_read_only = off');
  await db.query('BEGIN');
  const [file] = readdirSync('supabase/migrations').filter((f) => f.startsWith('210_'));
  await db.query(strip(readFileSync(`supabase/migrations/${file}`, 'utf8')));
  await recordMigrationApplied(db, '210', file.slice(4).replace(/\.sql$/, ''));

  const failures = [];
  const org = (await db.query('SELECT id FROM public.organizations LIMIT 1')).rows[0].id;

  await db.query('SAVEPOINT proof');
  const eng = (await db.query(
    `INSERT INTO public.commercial_engagements
       (organization_id, title, counterparty_name, status, origin)
     VALUES ($1,'[PROVA 210]','X','UNDER_ANALYSIS','manual') RETURNING id`, [org])).rows[0];
  const hist = (await db.query(
    `INSERT INTO public.commercial_engagement_history
       (organization_id, engagement_id, transition, to_state)
     VALUES ($1,$2,'created','UNDER_ANALYSIS') RETURNING id`, [org, eng.id])).rows[0];

  // 1. Reescrever é recusado até para o papel privilegiado.
  await db.query('SAVEPOINT rewrite');
  let rewriteBlocked = false;
  try { await db.query(`UPDATE public.commercial_engagement_history SET note='x' WHERE id=$1`, [hist.id]); }
  catch (e) { rewriteBlocked = /não se reescreve/.test(e.message); }
  await db.query('ROLLBACK TO SAVEPOINT rewrite');
  if (!rewriteBlocked) failures.push('UPDATE na história não foi recusado');

  // 2. O apagamento GOVERNADO passa.
  await db.query('DELETE FROM public.commercial_engagement_history WHERE id=$1', [hist.id]);
  const left = (await db.query(
    'SELECT count(*)::int n FROM public.commercial_engagement_history WHERE id=$1', [hist.id])).rows[0].n;
  if (left !== 0) failures.push('apagamento governado não removeu a linha');

  // 3. O apagamento pela APLICAÇÃO é recusado.
  const hist2 = (await db.query(
    `INSERT INTO public.commercial_engagement_history
       (organization_id, engagement_id, transition, to_state)
     VALUES ($1,$2,'created','UNDER_ANALYSIS') RETURNING id`, [org, eng.id])).rows[0];
  await db.query('SAVEPOINT asapp');
  let appBlocked = false;
  try {
    await db.query('SET LOCAL ROLE authenticated');
    await db.query('DELETE FROM public.commercial_engagement_history WHERE id=$1', [hist2.id]);
  } catch (e) { appBlocked = /cannot be erased|permission denied|denied/i.test(e.message); }
  await db.query('ROLLBACK TO SAVEPOINT asapp');
  if (!appBlocked) failures.push('apagamento pela aplicação NÃO foi recusado');

  await db.query('ROLLBACK TO SAVEPOINT proof');
  await db.query('RELEASE SAVEPOINT proof');

  if (failures.length) {
    console.error('PROVAS FALHARAM:\n- ' + failures.join('\n- '));
    await db.query('ROLLBACK');
    process.exit(1);
  }
  console.log('História: reescrita recusada a todos; apagamento governado passa, o da aplicação não.');
  if (apply) { await db.query('COMMIT'); console.log('COMMIT — 210 aplicada e registrada.'); }
  else { await db.query('ROLLBACK'); console.log('ENSAIO ok.'); }
} catch (error) {
  console.error('FALHOU:', error.message);
  try { await db.query('ROLLBACK'); } catch {}
  process.exitCode = 1;
} finally { await db.end(); }
