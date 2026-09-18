/** Ensaia ou aplica e registra atomicamente a migration 172 (só GRANT). */
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

try {
  await db.connect();
  await db.query('SET SESSION default_transaction_read_only = off');
  const tip = (await db.query(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1',
  )).rows[0]?.version;
  if (tip !== '171') throw new Error(`Expected registry tip 171, received ${tip}.`);
  const files = readdirSync('supabase/migrations').filter((f) => f.startsWith('172_'));
  if (files.length !== 1) throw new Error(`Expected one migration 172, found ${files.length}.`);

  /*
    A migration se declara SOMENTE LEITURA. O que se mede antes, para comparar
    depois, é exatamente o que ela promete não tocar: as linhas do domínio de
    faturamento e a superfície de RLS das tabelas de origem.
  */
  const before = (await db.query(`SELECT
    (SELECT count(*)::int FROM public.contract_milestones) milestones,
    (SELECT count(*)::int FROM public.contract_billing_events) billing_events,
    (SELECT count(*)::int FROM public.contract_billing_entitlement_rules) rules,
    (SELECT count(*)::int FROM public.contract_measurement_requirements) requirements,
    (SELECT count(*)::int FROM public.contract_measurement_rule_timeline_mappings) mappings,
    (SELECT count(*)::int FROM public.project_measurements) measurements,
    (SELECT count(*)::int FROM pg_policies WHERE schemaname='public'
      AND tablename IN ('contract_milestones','contract_billing_events',
                        'contract_billing_entitlement_rules','contract_measurement_requirements')) policies`)).rows[0];

  await db.query('BEGIN');
  await db.query(strip(readFileSync(`supabase/migrations/${files[0]}`, 'utf8')));
  await recordMigrationApplied(db, '172', 'milestone_workbench_read_only_grant');

  const proof = (await db.query(`SELECT
    has_table_privilege('authenticated','public.contract_milestone_workbench','SELECT') auth_select,
    has_table_privilege('authenticated','public.contract_milestone_workbench','INSERT') auth_insert,
    has_table_privilege('authenticated','public.contract_milestone_workbench','UPDATE') auth_update,
    has_table_privilege('authenticated','public.contract_milestone_workbench','DELETE') auth_delete,
    has_table_privilege('anon','public.contract_milestone_workbench','SELECT') anon_select,
    (SELECT count(*)::int FROM public.contract_milestones) milestones,
    (SELECT count(*)::int FROM public.contract_billing_events) billing_events,
    (SELECT count(*)::int FROM public.contract_billing_entitlement_rules) rules,
    (SELECT count(*)::int FROM public.contract_measurement_requirements) requirements,
    (SELECT count(*)::int FROM public.contract_measurement_rule_timeline_mappings) mappings,
    (SELECT count(*)::int FROM public.project_measurements) measurements,
    (SELECT count(*)::int FROM pg_policies WHERE schemaname='public'
      AND tablename IN ('contract_milestones','contract_billing_events',
                        'contract_billing_entitlement_rules','contract_measurement_requirements')) policies,
    (SELECT version FROM supabase_migrations.schema_migrations
      ORDER BY version::int DESC LIMIT 1) registry_tip`)).rows[0];

  /* UMA linha por marco — a promessa de cardinalidade, verificada em dado real. */
  const cardinality = (await db.query(`SELECT
    (SELECT count(*)::int FROM public.contract_milestone_workbench) rows,
    (SELECT count(DISTINCT id)::int FROM public.contract_milestone_workbench) distinct_ids`)).rows[0];

  const failures = [];
  if (proof.auth_select !== true) failures.push('authenticated perdeu SELECT');
  if (proof.auth_insert !== false) failures.push('authenticated ainda tem INSERT');
  if (proof.auth_update !== false) failures.push('authenticated ainda tem UPDATE');
  if (proof.auth_delete !== false) failures.push('authenticated ainda tem DELETE');
  if (proof.anon_select !== false) failures.push('anon COM SELECT — vazamento');
  if (proof.registry_tip !== '172') failures.push(`registry tip ${proof.registry_tip} ≠ 172`);
  if (cardinality.rows !== cardinality.distinct_ids) {
    failures.push(`cardinalidade: ${cardinality.rows} linhas para ${cardinality.distinct_ids} marcos`);
  }
  for (const key of ['milestones', 'billing_events', 'rules', 'requirements', 'mappings', 'measurements', 'policies']) {
    if (proof[key] !== before[key]) failures.push(`${key}: ${before[key]} → ${proof[key]} (a migration deveria ser somente GRANT)`);
  }
  if (failures.length) throw new Error(`Prova falhou:\n  - ${failures.join('\n  - ')}`);

  console.log('Antes:', JSON.stringify(before));
  console.log('Prova:', JSON.stringify(proof, null, 1));
  console.log('Cardinalidade:', JSON.stringify(cardinality));

  if (apply) { await db.query('COMMIT'); console.log('\nAPLICADO.'); }
  else { await db.query('ROLLBACK'); console.log('\nENSAIO — desfeito. Use --apply para gravar.'); }
} catch (error) {
  try { await db.query('ROLLBACK'); } catch { /* conexão já caída */ }
  console.error('\nFALHOU:', error.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
