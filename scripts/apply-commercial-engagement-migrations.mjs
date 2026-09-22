/**
 * Aplica e registra, atomicamente, as migrations 197–201 (Comercial →
 * Engajamento → OS interna → Projeto → Medição → Faturamento).
 *
 * Sem `--apply`, ENSAIA: aplica dentro da transação, prova e faz ROLLBACK.
 * Com `--apply`, comete — e a prova roda ANTES do COMMIT, de modo que uma
 * asserção falha desfaz a migration inteira.
 *
 * O registro de migrations estava parado em 178 enquanto o schema já trazia
 * 179–196. Este runner conserta isso primeiro: verifica que TODO objeto criado
 * por aquelas migrations existe de fato no banco e só então grava as linhas
 * ausentes. Registrar sem verificar seria trocar um registro incompleto por um
 * registro mentiroso.
 */
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';
import { recordMigrationApplied } from './lib/migration-registry.mjs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
const VERSIONS = ['197', '198', '199', '200', '201'];
const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('SUPABASE_DB_URL ausente.'); process.exit(2); }

const strip = (sql) => sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gmi, '');
const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

try {
  await db.connect();
  await db.query('SET SESSION default_transaction_read_only = off');

  // ---- inspeção anterior ------------------------------------------------
  const before = (await db.query(`SELECT
    (SELECT count(*)::int FROM public.contracts WHERE deleted_at IS NULL) contracts,
    (SELECT count(*)::int FROM public.project_measurements) measurements,
    (SELECT count(*)::int FROM public.contract_measurement_requirements) rules,
    (SELECT count(*)::int FROM public.contract_billing_events) billing,
    (SELECT count(*)::int FROM public.contract_project_links) links,
    (SELECT md5(string_agg(id::text || ':' || status || ':' ||
        COALESCE(accepted_value::text,'-'), '|' ORDER BY id))
       FROM public.project_measurements) measurement_fingerprint`)).rows[0];
  console.log('antes:', before);

  await db.query('BEGIN');

  // ---- conserto do registro 179–196 -------------------------------------
  const gapFiles = readdirSync('supabase/migrations')
    .filter((f) => { const v = Number(f.slice(0, 3)); return v >= 179 && v <= 196; }).sort();
  const registered = new Set((await db.query(
    'SELECT version FROM supabase_migrations.schema_migrations')).rows.map((r) => r.version));
  let repaired = 0;
  for (const file of gapFiles) {
    const version = file.slice(0, 3);
    if (registered.has(version)) continue;
    const sql = readFileSync(`supabase/migrations/${file}`, 'utf8');
    const fns = [...sql.matchAll(/CREATE (?:OR REPLACE )?FUNCTION\s+(?:public\.)?([a-z_0-9]+)/gi)].map((m) => m[1]);
    const rels = [
      ...sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?([a-z_0-9]+)/gi),
      ...sql.matchAll(/CREATE (?:OR REPLACE )?VIEW\s+(?:public\.)?([a-z_0-9]+)/gi),
    ].map((m) => m[1]);
    for (const fn of new Set(fns)) {
      const { rowCount } = await db.query('SELECT 1 FROM pg_proc WHERE proname=$1', [fn]);
      if (!rowCount) throw new Error(`${file}: função ${fn} ausente — registro NÃO será gravado.`);
    }
    for (const rel of new Set(rels)) {
      const { rowCount } = await db.query(
        `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relname=$1`, [rel]);
      if (!rowCount) throw new Error(`${file}: relação ${rel} ausente — registro NÃO será gravado.`);
    }
    await recordMigrationApplied(db, version, file.slice(4).replace(/\.sql$/, ''));
    repaired += 1;
  }
  console.log(`registro reparado: ${repaired} versão(ões) de 179–196 gravadas após verificação de objeto.`);

  // ---- aplicação --------------------------------------------------------
  for (const version of VERSIONS) {
    const found = readdirSync('supabase/migrations').filter((f) => f.startsWith(`${version}_`));
    if (found.length !== 1) throw new Error(`Esperava um arquivo ${version}_, encontrei ${found.length}.`);
    process.stdout.write(`aplicando ${found[0]} ... `);
    await db.query(strip(readFileSync(`supabase/migrations/${found[0]}`, 'utf8')));
    await recordMigrationApplied(db, version, found[0].slice(4).replace(/\.sql$/, ''));
    console.log('ok');
  }

  // ---- provas, ainda dentro da transação --------------------------------
  const after = (await db.query(`SELECT
    (SELECT count(*)::int FROM public.contracts WHERE deleted_at IS NULL) contracts,
    (SELECT count(*)::int FROM public.project_measurements) measurements,
    (SELECT count(*)::int FROM public.contract_measurement_requirements) rules,
    (SELECT count(*)::int FROM public.contract_billing_events) billing,
    (SELECT count(*)::int FROM public.contract_project_links) links,
    (SELECT md5(string_agg(id::text || ':' || status || ':' ||
        COALESCE(accepted_value::text,'-'), '|' ORDER BY id))
       FROM public.project_measurements) measurement_fingerprint,
    (SELECT count(*)::int FROM public.commercial_engagements) engagements,
    (SELECT count(*)::int FROM public.contracts WHERE deleted_at IS NULL AND engagement_id IS NULL) orphan_contracts,
    (SELECT count(*)::int FROM public.project_measurements WHERE engagement_id IS NULL) orphan_measurements,
    (SELECT count(*)::int FROM public.contract_measurement_requirements WHERE engagement_id IS NULL) orphan_rules,
    (SELECT count(*)::int FROM public.commercial_engagements
      WHERE status='UNDER_ANALYSIS' AND authorized_value IS NOT NULL) kpi_leak,
    (SELECT version FROM supabase_migrations.schema_migrations
      ORDER BY version::int DESC LIMIT 1) registry_tip`)).rows[0];
  console.log('depois:', after);

  check(after.contracts === before.contracts, 'contagem de contratos mudou');
  check(after.measurements === before.measurements, 'contagem de medições mudou');
  check(after.rules === before.rules, 'contagem de regras de medição mudou');
  check(after.billing === before.billing, 'contagem de faturamentos mudou');
  check(after.links === before.links, 'contagem de vínculos contrato↔projeto mudou');
  check(after.measurement_fingerprint === before.measurement_fingerprint,
    'estado/valor aceito de alguma medição mudou — a migration NÃO pode tocar negócio');
  check(after.orphan_contracts === 0, 'contrato vivo sem engajamento');
  check(after.orphan_measurements === 0, 'medição sem engajamento');
  check(after.orphan_rules === 0, 'regra de medição sem engajamento');
  check(after.kpi_leak === 0, 'engajamento em análise com valor autorizado — vazaria para KPI');
  check(after.registry_tip === '201', `ponta do registro é ${after.registry_tip}`);

  const governed = await db.query(`
    SELECT p.proname,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') browser
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname IN (
       'commercial_engagement_create','commercial_engagement_authorize',
       'commercial_engagement_set_governing','commercial_engagement_attach_authorization',
       'commercial_proposal_revision_record_outcome','internal_service_order_create',
       'internal_service_order_issue','internal_service_order_bind_project',
       'commercial_divergence_resolve','internal_service_order_compare_with_governing')`);
  check(governed.rowCount === 10, `esperava 10 funções governadas, encontrei ${governed.rowCount}`);
  for (const row of governed.rows) {
    check(!row.browser, `${row.proname} executável pelo navegador`);
  }

  const rls = await db.query(`
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity
       AND c.relname LIKE 'commercial%' OR (n.nspname='public' AND c.relkind='r'
       AND NOT c.relrowsecurity AND c.relname IN ('engagement_project_links','internal_service_orders'))`);
  check(rls.rowCount === 0, `tabelas novas sem RLS: ${rls.rows.map((r) => r.relname).join(', ')}`);

  if (failures.length) {
    console.error('\nPROVAS FALHARAM:\n- ' + failures.join('\n- '));
    await db.query('ROLLBACK');
    console.error('ROLLBACK aplicado.');
    process.exit(1);
  }

  if (apply) {
    await db.query('COMMIT');
    console.log('\nCOMMIT — migrations 197–201 aplicadas e registradas.');
  } else {
    await db.query('ROLLBACK');
    console.log('\nENSAIO concluído sem erros. ROLLBACK aplicado. Use --apply para cometer.');
  }
} catch (error) {
  console.error('\nFALHOU:', error.message);
  if (error.detail) console.error('detail:', error.detail);
  if (error.where) console.error('where:', error.where);
  try { await db.query('ROLLBACK'); } catch {}
  process.exitCode = 1;
} finally {
  await db.end();
}
