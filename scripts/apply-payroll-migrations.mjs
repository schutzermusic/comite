/**
 * One-off runner: applies the payroll-closing migrations (017–020) to the
 * Supabase database in SUPABASE_DB_URL. All four migrations are idempotent
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

  // Verify the core table is now present.
  const { rows } = await client.query(
    `SELECT to_regclass('public.payroll_closing_batches') AS tbl,
            (SELECT count(*) FROM storage.buckets WHERE id LIKE 'payroll-%') AS buckets`,
  );
  console.log(`\nVerificação: tabela=${rows[0].tbl}  buckets_payroll=${rows[0].buckets}`);
  console.log('\n✅ Migrations aplicadas com sucesso.');
} catch (err) {
  console.error('\n❌ Erro ao aplicar migrations:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
