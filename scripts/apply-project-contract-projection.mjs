/** Ensaia ou aplica e registra atomicamente a migration 175 (só visões). */
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

const NEW_VIEWS = [
  'project_contract_link_governed',
  'project_contract_financial_read_model',
  'project_contract_milestone_read_model',
];

/* O contrato e o projeto vivos da validação. */
const CONTRACT = 'JA10182283/2025';
const PROJECT_CODE = '2774.08/2025';

const counts = async () => (await db.query(`SELECT
  (SELECT count(*)::int FROM public.contracts) contracts,
  (SELECT count(*)::int FROM public.projects) projects,
  (SELECT count(*)::int FROM public.contract_milestones) milestones,
  (SELECT count(*)::int FROM public.contract_billing_events) billing_events,
  (SELECT count(*)::int FROM public.contract_billing_entitlement_rules) rules,
  (SELECT count(*)::int FROM public.contract_measurement_rule_timeline_mappings) mappings,
  (SELECT count(*)::int FROM public.project_measurements) measurements,
  (SELECT count(*)::int FROM public.contract_project_links) links,
  (SELECT count(*)::int FROM pg_policies WHERE schemaname='public') policies`)).rows[0];

try {
  await db.connect();
  await db.query('SET SESSION default_transaction_read_only = off');
  const tip = (await db.query(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1',
  )).rows[0]?.version;
  if (tip !== '174') throw new Error(`Expected registry tip 174, received ${tip}.`);
  const files = readdirSync('supabase/migrations').filter((f) => f.startsWith('175_'));
  if (files.length !== 1) throw new Error(`Expected one migration 175, found ${files.length}.`);

  const before = await counts();

  await db.query('BEGIN');
  await db.query(strip(readFileSync(`supabase/migrations/${files[0]}`, 'utf8')));
  await recordMigrationApplied(db, '175', 'project_contract_projection');

  const failures = [];
  const after = await counts();
  for (const [k, v] of Object.entries(after)) {
    if (v !== before[k]) failures.push(`${k}: ${before[k]} → ${v} (a migration deveria ser só visões)`);
  }

  /* Somente leitura e security_invoker nas três. */
  for (const v of NEW_VIEWS) {
    const p = (await db.query(`SELECT
      has_table_privilege('authenticated','public.${v}','SELECT') a_sel,
      has_table_privilege('authenticated','public.${v}','INSERT') a_ins,
      has_table_privilege('authenticated','public.${v}','UPDATE') a_upd,
      has_table_privilege('authenticated','public.${v}','DELETE') a_del,
      has_table_privilege('anon','public.${v}','SELECT') anon_sel,
      (SELECT reloptions::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname='${v}') opts`)).rows[0];
    if (!p.a_sel) failures.push(`${v}: authenticated sem SELECT`);
    if (p.a_ins || p.a_upd || p.a_del) failures.push(`${v}: authenticated com escrita`);
    if (p.anon_sel) failures.push(`${v}: anon com SELECT`);
    if (!String(p.opts).includes('security_invoker=true')) failures.push(`${v}: sem security_invoker`);
  }

  /* ── As provas contra o dado vivo de JA10182283/2025 ─────────────────── */
  const fin = (await db.query(`
    SELECT f.* FROM public.project_contract_financial_read_model f
     WHERE f.contract_number = $1`, [CONTRACT])).rows;

  if (fin.length !== 1) {
    failures.push(`financial read model: ${fin.length} linhas para ${CONTRACT}, esperado 1`);
  } else {
    const r = fin[0];
    const code = (await db.query(
      `SELECT project->>'codigo' c FROM public.projects WHERE id=$1`, [r.project_id])).rows[0]?.c;
    if (code !== PROJECT_CODE) failures.push(`projeto vinculado ${code} ≠ ${PROJECT_CODE}`);
    if (Number(r.contract_value) !== 8032339.76) failures.push(`valor ${r.contract_value} ≠ 8032339.76`);
    if (Number(r.entitlement_total) !== 8032339.77) {
      failures.push(`direito ${r.entitlement_total} ≠ 8032339.77`);
    }
    /* A divergência de UM CENTAVO tem de sobreviver inteira. */
    if (Number(r.reconciliation_delta) !== 0.01) {
      failures.push(`divergência ${r.reconciliation_delta} ≠ 0.01 — o centavo documental foi apagado`);
    }
    if (r.milestone_count !== 6) failures.push(`marcos ${r.milestone_count} ≠ 6`);
    /* Nada de execução nem de caixa pode ter sido inventado. */
    if (r.measured_total !== null) failures.push(`measured_total ${r.measured_total} — deveria ser NULL`);
    if (r.accepted_total !== null) failures.push(`accepted_total ${r.accepted_total} — deveria ser NULL`);
    if (r.billed_event_count !== 0) failures.push(`billed_event_count ${r.billed_event_count} ≠ 0`);
    if (r.governed_mapped_milestone_count !== 0) {
      failures.push(`mapeados ${r.governed_mapped_milestone_count} ≠ 0`);
    }
    console.log('Financeiro:', JSON.stringify(r, null, 1));
  }

  const ms = (await db.query(`
    SELECT m.title, m.entitlement_amount, m.entitlement_share_percent, m.entitlement_source_page,
           m.customer_acceptance_required, m.required_document_type, m.trigger_assessment,
           m.billing_event_id, m.measurement_id, m.timeline_item_id
      FROM public.project_contract_milestone_read_model m
      JOIN public.contracts c ON c.id = m.contract_id
     WHERE c.contract_number = $1 ORDER BY m.title`, [CONTRACT])).rows;

  if (ms.length !== 6) failures.push(`marcos na visão do projeto: ${ms.length} ≠ 6`);
  for (const m of ms) {
    if (m.trigger_assessment !== 'NOT_ASSESSED') {
      failures.push(`${m.title}: trigger_assessment ${m.trigger_assessment} ≠ NOT_ASSESSED`);
    }
    if (m.customer_acceptance_required !== true) {
      failures.push(`${m.title}: aceite exigido perdido`);
    }
    if (m.entitlement_source_page === null) failures.push(`${m.title}: proveniência perdida`);
    if (m.billing_event_id !== null) failures.push(`${m.title}: evento de faturamento FABRICADO`);
    if (m.measurement_id !== null) failures.push(`${m.title}: medição FABRICADA`);
    if (m.timeline_item_id !== null) failures.push(`${m.title}: cronograma FABRICADO`);
  }
  const shareSum = ms.reduce((s, m) => s + Number(m.entitlement_share_percent ?? 0), 0);
  if (Math.abs(shareSum - 100) > 0.0001) failures.push(`soma dos percentuais ${shareSum} ≠ 100`);

  console.log('\nMarcos no projeto:');
  console.table(ms.map((m) => ({
    title: m.title.slice(0, 46),
    direito: m.entitlement_amount,
    pct: m.entitlement_share_percent,
    'p.': m.entitlement_source_page,
    aceite: m.customer_acceptance_required,
    doc: m.required_document_type,
    gatilho: m.trigger_assessment,
  })));

  const registryTip = (await db.query(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1',
  )).rows[0]?.version;
  if (registryTip !== '175') failures.push(`registry tip ${registryTip} ≠ 175`);

  if (failures.length) throw new Error(`Prova falhou:\n  - ${failures.join('\n  - ')}`);
  console.log('\nIntocado:', JSON.stringify(after));

  if (apply) { await db.query('COMMIT'); console.log('\nAPLICADO.'); }
  else { await db.query('ROLLBACK'); console.log('\nENSAIO — desfeito. Use --apply para gravar.'); }
} catch (error) {
  try { await db.query('ROLLBACK'); } catch { /* conexão já caída */ }
  console.error('\nFALHOU:', error.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
