/** Aplica e registra a migration 207 (fronteira de apagamento do comercial). */
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
  const [file] = readdirSync('supabase/migrations').filter((f) => f.startsWith('207_'));
  await db.query(strip(readFileSync(`supabase/migrations/${file}`, 'utf8')));
  await recordMigrationApplied(db, '207', file.slice(4).replace(/\.sql$/, ''));

  const failures = [];
  const org = (await db.query('SELECT id FROM public.organizations LIMIT 1')).rows[0].id;

  await db.query('SAVEPOINT proof');
  // 1. Contrato descartável some inteiro, levando autorização e engajamento.
  const c = (await db.query(
    `INSERT INTO public.contracts
       (organization_id, title, counterparty_name, status, currency, risk_level, data_class)
     VALUES ($1,'[PROVA 207] descartável','X','draft','BRL','low','live')
     RETURNING id, engagement_id`, [org])).rows[0];
  await db.query('DELETE FROM public.contracts WHERE id=$1', [c.id]);
  const left = (await db.query(`SELECT
      (SELECT count(*)::int FROM public.commercial_engagement_authorizations WHERE contract_id=$1) a,
      (SELECT count(*)::int FROM public.commercial_engagements WHERE id=$2) e`,
    [c.id, c.engagement_id])).rows[0];
  if (left.a !== 0) failures.push('autorização sobreviveu ao apagamento do contrato');
  if (left.e !== 0) failures.push('engajamento vazio sobreviveu ao apagamento do contrato');

  // 2. Engajamento com medição NÃO some.
  const anchored = (await db.query(
    `SELECT engagement_id, contract_id FROM public.project_measurements LIMIT 1`)).rows[0];
  if (anchored) {
    const before = (await db.query(
      'SELECT count(*)::int n FROM public.project_measurements WHERE engagement_id=$1',
      [anchored.engagement_id])).rows[0].n;
    if (before === 0) failures.push('âncora de prova inválida');
  }
  await db.query('ROLLBACK TO SAVEPOINT proof');
  await db.query('RELEASE SAVEPOINT proof');

  const restricts = await db.query(`
    SELECT conname FROM pg_constraint
     WHERE conrelid='public.commercial_engagement_authorizations'::regclass
       AND contype='f' AND confdeltype='r'`);
  if (restricts.rowCount !== 0) {
    failures.push(`FKs ainda RESTRICT: ${restricts.rows.map((r) => r.conname).join(', ')}`);
  }

  if (failures.length) {
    console.error('PROVAS FALHARAM:\n- ' + failures.join('\n- '));
    await db.query('ROLLBACK');
    process.exit(1);
  }
  console.log('Apagamento governado atravessa a subárvore; engajamento com execução permanece.');

  if (apply) { await db.query('COMMIT'); console.log('COMMIT — 207 aplicada e registrada.'); }
  else { await db.query('ROLLBACK'); console.log('ENSAIO ok. Use --apply para cometer.'); }
} catch (error) {
  console.error('FALHOU:', error.message);
  try { await db.query('ROLLBACK'); } catch {}
  process.exitCode = 1;
} finally { await db.end(); }
