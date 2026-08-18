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
  // 089 reordena o ASO em torno do DOCUMENTO ORIGINAL. Diferente das
  // anteriores, ela RENOMEIA colunas (status → review_status, valid_until →
  // validity_date, match_status → esocial_match_status); os renames são
  // guardados por checks de information_schema, então reexecutar continua
  // sendo seguro, mas ela precisa rodar DEPOIS da 085 e antes de o app subir.
  '089_aso_document_first.sql',
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
       (SELECT count(*) FROM storage.buckets WHERE id = 'aso-documents')          AS aso_bucket,
       -- 089: sem estas colunas o módulo de ASO sobe contra o esquema antigo e
       -- falha na primeira consulta, que é o pior modo de descobrir. A conta
       -- cobre TODO o conjunto que a rota de upload escreve — uma coluna a
       -- menos aqui vira erro só no primeiro PDF enviado.
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'aso_documents'
           AND column_name IN ('validity_date', 'document_status', 'review_status',
                               'extracted_fields_json', 'reviewed_fields_json',
                               'review_history', 'original_file_url', 'divergence_summary',
                               'esocial_match_status', 'occupational_risks',
                               'clinic_name', 'company_cnpj', 'worker_registration'))
                                                                                  AS aso_089_cols,
       -- E nenhum nome antigo pode ter sobrado ao lado do novo.
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'aso_documents'
           AND column_name IN ('status', 'valid_until', 'match_status'))           AS aso_legacy_cols`,
  );
  console.log('\nVerificação:', rows[0]);

  // Falha alto: uma migration "OK" que não criou o objeto é pior que um erro,
  // porque o app degrada em silêncio e ninguém procura a causa.
  //
  // `aso_legacy_cols` é invertida — ali o valor BOM é zero — e por isso sai da
  // varredura genérica antes dela rodar.
  const { aso_legacy_cols: legacy, aso_089_cols: cols089, ...presence } = rows[0];
  const missing = Object.entries(presence).filter(([, v]) => v === null || v === 0 || v === '0');
  if (!dryRun && missing.length > 0) {
    throw new Error(`objetos ausentes após aplicar: ${missing.map(([k]) => k).join(', ')}`);
  }
  if (!dryRun && Number(cols089) !== 13) {
    throw new Error(`089 incompleta: ${cols089}/13 colunas do modelo de ASO presentes`);
  }
  if (!dryRun && Number(legacy) > 0) {
    throw new Error(`089 incompleta: ${legacy} coluna(s) com nome antigo ainda em aso_documents`);
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
