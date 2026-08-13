/**
 * Runner da migration do conector eSocial (080). Aditiva e idempotente
 * (CREATE TABLE IF NOT EXISTS / DROP POLICY IF EXISTS / ON CONFLICT), então
 * reexecutar é seguro.
 *
 * Uso: node scripts/apply-esocial-migration.mjs
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
  '080_esocial_ingestion.sql',
  '081_esocial_rubricas_e_bases.sql',
  '082_esocial_beneficios_por_natureza.sql',
  '083_workforce_ajustes_manuais.sql',
];

const client = new pg.Client(config);

try {
  await client.connect();
  console.log(`Conectado a ${config.host}:${config.port}/${config.database}\n`);

  for (const file of FILES) {
    const sql = readFileSync(join(root, 'supabase/migrations', file), 'utf8');
    process.stdout.write(`→ Aplicando ${file} … `);
    await client.query(sql);
    console.log('OK');
  }

  const { rows } = await client.query(
    `SELECT
       to_regclass('public.esocial_config')               AS cfg,
       to_regclass('public.esocial_sync_runs')            AS runs,
       to_regclass('public.esocial_events')               AS events,
       to_regclass('public.esocial_competence_metrics')   AS comp,
       to_regclass('public.esocial_area_metrics')         AS areas,
       to_regclass('public.esocial_employments')          AS empl,
       to_regclass('public.workforce_manual_headcount')  AS manual_hc,
       (SELECT count(*) FROM storage.buckets WHERE id = 'esocial-certificates') AS bucket`,
  );
  console.log('\nVerificação:', rows[0]);

  // O PostgREST serve a partir de um cache de schema; sem recarregar, a API
  // continua respondendo "table not found" mesmo com a tabela já criada.
  await client.query("NOTIFY pgrst, 'reload schema'");
  console.log("Cache de schema do PostgREST recarregado.");
} catch (err) {
  console.error('\nFALHOU:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
