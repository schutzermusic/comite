/** Aplica e registra a migration 205 (contrato novo nasce com o pai). */
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
  const [file] = readdirSync('supabase/migrations').filter((f) => f.startsWith('205_'));
  await db.query(strip(readFileSync(`supabase/migrations/${file}`, 'utf8')));
  await recordMigrationApplied(db, '205', file.slice(4).replace(/\.sql$/, ''));

  const failures = [];
  const org = (await db.query('SELECT id FROM public.organizations LIMIT 1')).rows[0].id;

  // Prova ao vivo, num SAVEPOINT que é sempre desfeito.
  await db.query('SAVEPOINT proof');
  const contract = (await db.query(
    `INSERT INTO public.contracts
       (organization_id, title, contract_number, counterparty_name, status, currency,
        total_value, risk_level, data_class)
     VALUES ($1,'[PROVA 205] contrato novo','PROVA-205','Contraparte','active','BRL',
             1000,'medium','live')
     RETURNING id, engagement_id`, [org])).rows[0];
  if (!contract.engagement_id) failures.push('contrato novo nasceu sem engajamento');

  const engagement = (await db.query(
    'SELECT status, authorized_value FROM public.commercial_engagements WHERE id=$1',
    [contract.engagement_id])).rows[0];
  if (engagement?.status !== 'UNDER_ANALYSIS') {
    failures.push(`engajamento nasceu ${engagement?.status}, esperado UNDER_ANALYSIS`);
  }
  if (engagement?.authorized_value !== null) {
    failures.push('engajamento novo já carrega valor autorizado — vazaria para o KPI');
  }

  const auth = (await db.query(
    `SELECT source_kind, governing, authorized_value FROM public.commercial_engagement_authorizations
      WHERE contract_id=$1`, [contract.id])).rows[0];
  if (auth?.source_kind !== 'formal_contract' || !auth?.governing) {
    failures.push('contrato novo não registrou autorização regente');
  }
  if (Number(auth?.authorized_value) !== 1000) failures.push('valor da autorização não veio do contrato');

  // E a regra de medição sobre ele passa a funcionar sem informar o pai.
  const rule = (await db.query(
    `INSERT INTO public.contract_measurement_requirements
       (organization_id, contract_id, title, effect, measurement_basis, accumulation_mode,
        aggregation_mode, cadence, source_reference)
     VALUES ($1,$2,'[PROVA 205] regra','added','UNKNOWN','UNKNOWN','UNKNOWN','UNKNOWN','prova')
     RETURNING engagement_id`, [org, contract.id])).rows[0];
  if (rule.engagement_id !== contract.engagement_id) {
    failures.push('regra não herdou o pai do contrato novo');
  }
  await db.query('ROLLBACK TO SAVEPOINT proof');
  await db.query('RELEASE SAVEPOINT proof');

  const exposed = (await db.query(`
    SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.prosecdef
       AND has_function_privilege('anon', p.oid, 'EXECUTE')`)).rows[0].n;
  if (exposed !== 0) failures.push(`${exposed} SECURITY DEFINER alcançável por anon`);

  if (failures.length) {
    console.error('PROVAS FALHARAM:\n- ' + failures.join('\n- '));
    await db.query('ROLLBACK');
    process.exit(1);
  }
  console.log('Contrato novo nasce EM ANÁLISE, com autorização regente e regra herdando o pai.');

  if (apply) { await db.query('COMMIT'); console.log('COMMIT — 205 aplicada e registrada.'); }
  else { await db.query('ROLLBACK'); console.log('ENSAIO ok. Use --apply para cometer.'); }
} catch (error) {
  console.error('FALHOU:', error.message);
  try { await db.query('ROLLBACK'); } catch {}
  process.exitCode = 1;
} finally { await db.end(); }
