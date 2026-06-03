/**
 * One-off runner: applies the payroll-closing migrations (017–025) to the
 * Supabase database in SUPABASE_DB_URL. All migrations are idempotent
 * (IF NOT EXISTS / ON CONFLICT / DROP POLICY IF EXISTS), so re-running is safe.
 *
 * Usage: node scripts/apply-payroll-migrations.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function readEnvLocal(key) {
  const txt = readFileSync(join(root, '.env.local'), 'utf8');
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && m[1] === key) return m[2].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

const dbUrl = process.env.SUPABASE_DB_URL || readEnvLocal('SUPABASE_DB_URL');
if (!dbUrl) {
  console.error('SUPABASE_DB_URL não encontrado em .env.local nem no ambiente.');
  process.exit(1);
}

// Parse with WHATWG URL (splits userinfo at the last '@', handling the '@' in
// the password) and pass explicit fields so pg never misparses it.
const u = new URL(dbUrl);
const config = {
  host: u.hostname,
  port: Number(u.port || 5432),
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.replace(/^\//, '') || 'postgres',
  ssl: { rejectUnauthorized: false },
};

const FILES = [
  '017_payroll_closing.sql',
  '018_payroll_closing_rls.sql',
  '019_payroll_storage.sql',
  '020_payroll_perm_seeds.sql',
  '021_payroll_cost_center_mappings.sql',
  '022_finance_cost_centers.sql',
  '023_payroll_closing_lifecycle.sql',
  '024_finance_category_hierarchy.sql',
  '025_finance_category_aliases.sql',
];

const client = new pg.Client(config);

try {
  await client.connect();
  console.log(`Conectado a ${config.host}:${config.port}/${config.database} como ${config.user}\n`);

  for (const file of FILES) {
    const sql = readFileSync(join(root, 'supabase/migrations', file), 'utf8');
    process.stdout.write(`→ Aplicando ${file} … `);
    try {
      await client.query(sql);
      console.log('OK');
    } catch (err) {
      console.log('FALHOU');
      console.error(`   ${err.message}`);
      throw err;
    }
  }

  // Verify the core tables and columns are now present.
  const { rows } = await client.query(
    `SELECT
       to_regclass('public.payroll_closing_batches')       AS tbl_batches,
       to_regclass('public.payroll_cost_center_mappings')  AS tbl_pccm,
       to_regclass('public.finance_cost_centers')          AS tbl_fcc,
       to_regclass('public.finance_category_aliases')      AS tbl_fca,
       (SELECT count(*) FROM storage.buckets WHERE id LIKE 'payroll-%') AS buckets,
       EXISTS(SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='management_category'
                AND column_name='organization_id')                     AS mc_has_org_id,
       EXISTS(SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='management_category'
                AND column_name='requires_contract')                   AS mc_has_req_contract,
       EXISTS(SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='management_category'
                AND column_name='requires_cost_center')                AS mc_has_req_cc,
       (SELECT count(*) FROM management_category WHERE level = 3)      AS subcategory_count`,
  );
  const r = rows[0];
  console.log(`\nVerificação:`);
  console.log(`  payroll_closing_batches       = ${r.tbl_batches}`);
  console.log(`  payroll_cost_center_mappings  = ${r.tbl_pccm}`);
  console.log(`  finance_cost_centers          = ${r.tbl_fcc}`);
  console.log(`  finance_category_aliases      = ${r.tbl_fca}`);
  console.log(`  buckets_payroll               = ${r.buckets}`);
  console.log(`  management_category.org_id    = ${r.mc_has_org_id}`);
  console.log(`  management_category.req_contr = ${r.mc_has_req_contract}`);
  console.log(`  management_category.req_cc    = ${r.mc_has_req_cc}`);
  console.log(`  subcategorias (L3)            = ${r.subcategory_count}`);
  console.log('\n✅ Migrations 017–025 aplicadas com sucesso.');
} catch (err) {
  console.error('\n❌ Erro ao aplicar migrations:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
