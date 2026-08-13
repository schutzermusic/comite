/**
 * Runner das migrations do conector eSocial e de Pessoas & Custos (080–086).
 *
 * Todas são ADITIVAS e IDEMPOTENTES (CREATE TABLE IF NOT EXISTS, CREATE INDEX
 * IF NOT EXISTS, DROP POLICY IF EXISTS antes de CREATE POLICY, ON CONFLICT nos
 * buckets, CREATE OR REPLACE nas funções), então reexecutar é seguro e é o
 * modo normal de uso: o script não mantém registro de "já aplicada", ele
 * simplesmente reaplica tudo.
 *
 * Uso: node scripts/apply-esocial-migration.mjs
 *      node scripts/apply-esocial-migration.mjs --dry   (só lista o que faria)
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
  '084_esocial_sst.sql',
  '085_aso_documents.sql',
  '086_esocial_audit_counts.sql',
];

const dryRun = process.argv.includes('--dry');
const client = new pg.Client(config);

try {
  await client.connect();
  console.log(`Conectado a ${config.host}:${config.port}/${config.database}\n`);

  if (dryRun) {
    console.log('--dry: nada será gravado. Arquivos que seriam aplicados, em ordem:');
    for (const file of FILES) console.log(`  · ${file}`);
  } else {
    for (const file of FILES) {
      const sql = readFileSync(join(root, 'supabase/migrations', file), 'utf8');
      process.stdout.write(`→ Aplicando ${file} … `);
      await client.query(sql);
      console.log('OK');
    }
  }

  const { rows } = await client.query(
    `SELECT
       to_regclass('public.esocial_config')               AS cfg,
       to_regclass('public.esocial_sync_runs')            AS runs,
       to_regclass('public.esocial_events')               AS events,
       to_regclass('public.esocial_competence_metrics')   AS comp,
       to_regclass('public.esocial_area_metrics')         AS areas,
       to_regclass('public.esocial_employments')          AS empl,
       to_regclass('public.workforce_manual_headcount')   AS manual_hc,
       to_regclass('public.esocial_sst_events')           AS sst,
       to_regclass('public.aso_documents')                AS aso_docs,
       (SELECT count(*) FROM pg_proc WHERE proname = 'esocial_audit_counts')      AS audit_fn,
       (SELECT count(*) FROM storage.buckets WHERE id = 'esocial-certificates')   AS cert_bucket,
       (SELECT count(*) FROM storage.buckets WHERE id = 'aso-documents')          AS aso_bucket`,
  );
  console.log('\nVerificação:', rows[0]);

  // Falha alto: uma migration "OK" que não criou o objeto é pior que um erro,
  // porque o app degrada em silêncio e ninguém procura a causa.
  const missing = Object.entries(rows[0]).filter(([, v]) => v === null || v === 0 || v === '0');
  if (!dryRun && missing.length > 0) {
    throw new Error(`objetos ausentes após aplicar: ${missing.map(([k]) => k).join(', ')}`);
  }

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
