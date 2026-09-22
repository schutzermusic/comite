/** Aplica e registra a migration 209, provando a inserção de contrato ao vivo. */
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
  const [file] = readdirSync('supabase/migrations').filter((f) => f.startsWith('209_'));
  await db.query(strip(readFileSync(`supabase/migrations/${file}`, 'utf8')));
  await recordMigrationApplied(db, '209', file.slice(4).replace(/\.sql$/, ''));

  const failures = [];
  const org = (await db.query('SELECT id FROM public.organizations LIMIT 1')).rows[0].id;

  await db.query('SAVEPOINT proof');
  // 1. Contrato solto entra — era isto que a 208 quebrava.
  const first = (await db.query(
    `INSERT INTO public.contracts
       (organization_id, title, counterparty_name, status, currency, total_value,
        risk_level, data_class)
     VALUES ($1,'[PROVA 209] primeiro','X','signed','BRL',100,'low','live')
     RETURNING id, engagement_id`, [org])).rows[0];
  if (!first.engagement_id) failures.push('contrato não recebeu engajamento');

  // 2. Segundo contrato no MESMO trabalho, com valor diferente: não rege e abre divergência.
  const second = (await db.query(
    `INSERT INTO public.contracts
       (organization_id, title, counterparty_name, status, currency, total_value,
        risk_level, data_class, engagement_id)
     VALUES ($1,'[PROVA 209] segundo','X','signed','BRL',250,'low','live',$2)
     RETURNING id`, [org, first.engagement_id])).rows[0];
  const auth = (await db.query(
    `SELECT id, governing FROM public.commercial_engagement_authorizations WHERE contract_id=$1`,
    [second.id])).rows[0];
  if (!auth) failures.push('segundo contrato não registrou autorização');
  if (auth?.governing) failures.push('segundo contrato virou regente sozinho');
  const divergence = (await db.query(
    `SELECT count(*)::int n FROM public.commercial_divergences
      WHERE right_source_id=$1 AND scope='VALUE' AND severity='BLOCKING' AND state='OPEN'`,
    [auth?.id])).rows[0].n;
  if (divergence !== 1) failures.push(`esperava 1 divergência de valor, encontrei ${divergence}`);
  await db.query('ROLLBACK TO SAVEPOINT proof');
  await db.query('RELEASE SAVEPOINT proof');

  if (failures.length) {
    console.error('PROVAS FALHARAM:\n- ' + failures.join('\n- '));
    await db.query('ROLLBACK');
    process.exit(1);
  }
  console.log('Contrato entra; segundo contrato no mesmo trabalho não rege e abre divergência.');
  if (apply) { await db.query('COMMIT'); console.log('COMMIT — 209 aplicada e registrada.'); }
  else { await db.query('ROLLBACK'); console.log('ENSAIO ok.'); }
} catch (error) {
  console.error('FALHOU:', error.message);
  try { await db.query('ROLLBACK'); } catch {}
  process.exitCode = 1;
} finally { await db.end(); }
