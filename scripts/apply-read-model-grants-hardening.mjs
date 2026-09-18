/**
 * Ensaia ou aplica e registra atomicamente a migration 174 (só GRANT/REVOKE).
 *
 * ─── ORDEM DE PRODUÇÃO (cadeia estrita tip → tip) ──────────────────────────
 *
 *   174 → 175 → 176 → 177 → 178
 *
 * Pré-requisito: tip do registry = 173 antes de aplicar a 174.
 * Cada script abaixo recusa avançar se o tip não for o predecessor:
 *
 *   node scripts/apply-read-model-grants-hardening.mjs --apply   # 174
 *   node scripts/apply-project-contract-projection.mjs --apply   # 175
 *   node scripts/apply-project-canonical-location.mjs --apply    # 176
 *   node scripts/apply-globe-marker-rename.mjs --apply           # 177
 *   node scripts/apply-canonical-location-privilege-tidy.mjs --apply  # 178
 *
 * Sem `--apply` o script ensaiá e faz ROLLBACK. Não pular números.
 */
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

const VIEWS = [
  'contract_milestone_workbench',
  'contract_to_cash_read_model',
  'project_measurement_read_model',
  'contract_measurement_rule_timeline_governed',
  'contract_to_cash_health',
];

/** Privilégios de navegador + definição da visão, para comparar antes/depois. */
const surface = async () => (await db.query(`
  SELECT c.relname view_name,
         has_table_privilege('authenticated','public.'||quote_ident(c.relname),'SELECT') a_sel,
         has_table_privilege('authenticated','public.'||quote_ident(c.relname),'INSERT') a_ins,
         has_table_privilege('authenticated','public.'||quote_ident(c.relname),'UPDATE') a_upd,
         has_table_privilege('authenticated','public.'||quote_ident(c.relname),'DELETE') a_del,
         has_table_privilege('anon','public.'||quote_ident(c.relname),'SELECT') anon_sel,
         has_table_privilege('anon','public.'||quote_ident(c.relname),'INSERT') anon_ins,
         has_table_privilege('service_role','public.'||quote_ident(c.relname),'SELECT') sr_sel,
         has_table_privilege('service_role','public.'||quote_ident(c.relname),'INSERT') sr_ins,
         c.reloptions::text reloptions,
         md5(pg_get_viewdef(c.oid, true)) viewdef_md5
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = ANY($1) ORDER BY 1`, [VIEWS])).rows;

/* O que a migration promete NÃO tocar: RLS das bases e o dado de negócio. */
const untouched = async () => (await db.query(`SELECT
  (SELECT count(*)::int FROM pg_policies WHERE schemaname='public') policies,
  (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity) rls_tables,
  (SELECT count(*)::int FROM public.contract_milestones) milestones,
  (SELECT count(*)::int FROM public.contract_billing_events) billing_events,
  (SELECT count(*)::int FROM public.contract_billing_entitlement_rules) rules,
  (SELECT count(*)::int FROM public.contract_measurement_requirements) requirements,
  (SELECT count(*)::int FROM public.contract_measurement_rule_timeline_mappings) mappings,
  (SELECT count(*)::int FROM public.project_measurements) measurements,
  (SELECT count(*)::int FROM public.contracts) contracts,
  (SELECT count(*)::int FROM public.projects) projects`)).rows[0];

try {
  await db.connect();
  await db.query('SET SESSION default_transaction_read_only = off');
  const tip = (await db.query(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1',
  )).rows[0]?.version;
  if (tip !== '173') throw new Error(`Expected registry tip 173, received ${tip}.`);
  const files = readdirSync('supabase/migrations').filter((f) => f.startsWith('174_'));
  if (files.length !== 1) throw new Error(`Expected one migration 174, found ${files.length}.`);

  const beforeSurface = await surface();
  const beforeData = await untouched();
  /* A contagem de linhas de cada visão: SELECT tem de continuar entregando o mesmo. */
  const readBefore = {};
  for (const v of VIEWS) {
    readBefore[v] = (await db.query(`SELECT count(*)::int n FROM public.${v}`)).rows[0].n;
  }

  await db.query('BEGIN');
  await db.query(strip(readFileSync(`supabase/migrations/${files[0]}`, 'utf8')));
  await recordMigrationApplied(db, '174', 'read_model_grants_hardening');

  const afterSurface = await surface();
  const afterData = await untouched();
  const failures = [];

  for (const row of afterSurface) {
    const was = beforeSurface.find((b) => b.view_name === row.view_name);
    if (row.a_sel !== true) failures.push(`${row.view_name}: authenticated perdeu SELECT`);
    if (row.a_ins !== false) failures.push(`${row.view_name}: authenticated ainda tem INSERT`);
    if (row.a_upd !== false) failures.push(`${row.view_name}: authenticated ainda tem UPDATE`);
    if (row.a_del !== false) failures.push(`${row.view_name}: authenticated ainda tem DELETE`);
    if (row.anon_sel !== false) failures.push(`${row.view_name}: anon COM SELECT`);
    if (row.anon_ins !== false) failures.push(`${row.view_name}: anon COM INSERT`);
    /* service_role é o worker de jobs: a migration não deveria tê-lo tocado. */
    if (row.sr_sel !== was.sr_sel || row.sr_ins !== was.sr_ins) {
      failures.push(`${row.view_name}: privilégio de service_role mudou`);
    }
    /* Nenhuma visão pode ter sido redefinida: só GRANT/REVOKE. */
    if (row.viewdef_md5 !== was.viewdef_md5) failures.push(`${row.view_name}: DEFINIÇÃO alterada`);
    if (row.reloptions !== was.reloptions) failures.push(`${row.view_name}: reloptions alterada`);
  }

  /*
    A prova que importa na visão governada: ela é AUTO-ATUALIZÁVEL, então o
    privilégio era a única declaração de intenção. Confirma-se que segue
    auto-atualizável (a definição não mudou) e que o grant agora recusa.
  */
  const governed = (await db.query(`SELECT is_insertable_into, is_updatable
    FROM information_schema.views WHERE table_schema='public'
      AND table_name='contract_measurement_rule_timeline_governed'`)).rows[0];

  for (const [k, v] of Object.entries(afterData)) {
    if (v !== beforeData[k]) failures.push(`${k}: ${beforeData[k]} → ${v} (deveria ser só GRANT)`);
  }
  for (const v of VIEWS) {
    const n = (await db.query(`SELECT count(*)::int n FROM public.${v}`)).rows[0].n;
    if (n !== readBefore[v]) failures.push(`${v}: leitura ${readBefore[v]} → ${n}`);
  }

  const registryTip = (await db.query(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1',
  )).rows[0]?.version;
  if (registryTip !== '174') failures.push(`registry tip ${registryTip} ≠ 174`);

  if (failures.length) throw new Error(`Prova falhou:\n  - ${failures.join('\n  - ')}`);

  console.log('ANTES:');
  console.table(beforeSurface.map(({ viewdef_md5, reloptions, ...r }) => r));
  console.log('DEPOIS:');
  console.table(afterSurface.map(({ viewdef_md5, reloptions, ...r }) => r));
  console.log('Visão governada continua auto-atualizável:', JSON.stringify(governed));
  console.log('Intocado:', JSON.stringify(afterData));
  console.log('Leitura por visão:', JSON.stringify(readBefore));

  if (apply) { await db.query('COMMIT'); console.log('\nAPLICADO.'); }
  else { await db.query('ROLLBACK'); console.log('\nENSAIO — desfeito. Use --apply para gravar.'); }
} catch (error) {
  try { await db.query('ROLLBACK'); } catch { /* conexão já caída */ }
  console.error('\nFALHOU:', error.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
