/**
 * Aplica e registra a migration 213 (levantamento técnico, fechamento
 * governado, início excepcional).
 *
 * Sem `--apply` é ENSAIO: aplica, prova e desfaz. As provas de cenário moram
 * em `scripts/commercial/discovery-execution-proof.mjs` (sempre ROLLBACK); as
 * daqui são estruturais — o que a migration promete e seria fácil quebrar
 * calado: função governada alcançável pelo navegador, tabela sem RLS, o
 * resolvedor de faturamento sem a guarda de inquilino.
 */
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

const SERVER_ONLY = [
  'commercial_site_survey_create', 'commercial_site_survey_transition', 'commercial_site_survey_record',
  'commercial_site_survey_register_attachment', 'commercial_site_survey_record_apex_candidate',
  'commercial_close_and_start_execution', 'commercial_execution_start_regularize',
  'contract_billing_eligibility_resolve_core',
];
const TABLES = ['commercial_site_surveys', 'commercial_site_survey_events', 'commercial_execution_starts'];

try {
  await db.connect();
  await db.query('SET SESSION default_transaction_read_only = off');
  const tip = (await db.query(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1')).rows[0]?.version;
  if (tip !== '212') throw new Error(`Esperava ponta 212, encontrei ${tip}.`);

  await db.query('BEGIN');
  const [file] = readdirSync('supabase/migrations').filter((f) => f.startsWith('213_'));
  await db.query(strip(readFileSync(`supabase/migrations/${file}`, 'utf8')));
  await recordMigrationApplied(db, '213', file.slice(4).replace(/\.sql$/, ''));

  const failures = [];
  const fns = await db.query(`
    SELECT p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') browser,
           has_function_privilege('service_role', p.oid, 'EXECUTE') server, p.prosecdef definer
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = ANY($1)`, [[...SERVER_ONLY, 'contract_billing_eligibility_resolve']]);
  for (const name of SERVER_ONLY) {
    const row = fns.rows.find((r) => r.proname === name);
    if (!row) failures.push(`${name} não existe`);
    else if (row.browser) failures.push(`${name} executável pelo navegador`);
    else if (!row.server) failures.push(`${name} inacessível ao servidor`);
  }
  const resolver = fns.rows.find((r) => r.proname === 'contract_billing_eligibility_resolve');
  if (!resolver?.definer || !resolver.browser) failures.push('resolvedor de elegibilidade perdeu DEFINER ou a leitura da sessão');
  const src = (await db.query(`SELECT prosrc FROM pg_proc WHERE proname='contract_billing_eligibility_resolve'`)).rows[0]?.prosrc ?? '';
  if (!src.includes('apex_browser_organization')) failures.push('invólucro do resolvedor sem guarda de inquilino');
  if (!src.includes('COMMERCIAL_DOCUMENTATION_PENDING')) failures.push('invólucro do resolvedor sem o bloqueio documental');

  const tables = await db.query(`
    SELECT c.relname, c.relrowsecurity, (SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid)::int policies,
           has_table_privilege('authenticated', c.oid, 'INSERT') ins
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname = ANY($1)`, [TABLES]);
  for (const name of TABLES) {
    const row = tables.rows.find((r) => r.relname === name);
    if (!row) failures.push(`${name} não existe`);
    else if (!row.relrowsecurity || row.policies === 0) failures.push(`${name} sem RLS/política`);
    else if (row.ins) failures.push(`${name} gravável pelo navegador`);
  }

  const triggers = await db.query(`
    SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname = ANY($1)`,
    [['csse_no_rewrite', 'csse_no_erasure', 'cose_no_rewrite', 'cose_no_erasure']]);
  if (triggers.rowCount !== 4) failures.push('gatilhos de história ausentes');

  const grants = await db.query(`
    SELECT r.key role, p.key perm FROM public.role_permissions rp
      JOIN public.roles r ON r.id = rp.role_id JOIN public.permissions p ON p.id = rp.permission_id
     WHERE r.organization_id IS NULL AND p.key LIKE ANY (ARRAY['commercial.surveys.%','commercial.execution.%'])`);
  const has = (role, perm) => grants.rows.some((g) => g.role === role && g.perm === perm);
  if (!has('owner_admin', 'commercial.execution.start_exceptional')) failures.push('owner_admin sem início excepcional');
  if (has('juridico_contratos', 'commercial.execution.start_exceptional')) failures.push('jurídico não deveria dispensar a base');
  if (has('engenharia_pcp', 'commercial.execution.start')) failures.push('engenharia não fecha negócio');
  if (!has('engenharia_pcp', 'commercial.surveys.manage')) failures.push('engenharia sem levantamento');

  if (failures.length) {
    console.error('PROVAS FALHARAM:\n- ' + failures.join('\n- '));
    await db.query('ROLLBACK');
    process.exit(1);
  }
  console.log('Funções governadas, RLS, gatilhos de história, invólucro de faturamento e alçadas — provado.');

  if (apply) { await db.query('COMMIT'); console.log('COMMIT — 213 aplicada e registrada.'); }
  else { await db.query('ROLLBACK'); console.log('ENSAIO ok. Use --apply para cometer.'); }
} catch (error) {
  console.error('FALHOU:', error.message);
  try { await db.query('ROLLBACK'); } catch {}
  process.exitCode = 1;
} finally { await db.end(); }
