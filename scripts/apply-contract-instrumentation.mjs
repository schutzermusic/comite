/**
 * Aplica a migration 092 (instrumentação operacional de marcos, cláusulas e
 * penalidades) e audita o resultado.
 *
 *   node scripts/apply-contract-instrumentation.mjs           # aplica e verifica
 *   node scripts/apply-contract-instrumentation.mjs --check   # só verifica
 *
 * Estritamente aditiva e idempotente. O script imprime a contagem de linhas
 * ANTES e DEPOIS: a migration não deve criar, alterar ou apagar nenhuma linha —
 * só colunas. Se alguma contagem mudar, algo saiu do previsto.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error('SUPABASE_DB_URL ausente no .env/.env.local');
  process.exit(1);
}

const checkOnly = process.argv.includes('--check');
const MIGRATIONS = [
  'supabase/migrations/092_contract_operational_instrumentation.sql',
  'supabase/migrations/093_contract_clause_ai_provenance.sql',
  'supabase/migrations/094_clause_analysis_lifecycle.sql',
];
const TABLES = ['contract_milestones', 'contract_clauses', 'contract_penalties', 'contract_risks_links', 'contract_ai_analyses', 'contract_documents'];

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
const q = async (sql, params = []) => (await client.query(sql, params)).rows;

async function snapshot(label) {
  console.log(`\n── ${label} ──`);
  for (const table of TABLES) {
    const [{ count }] = await q(`SELECT count(*)::int AS count FROM public.${table}`);
    const cols = (await q(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
      [table],
    )).map((r) => r.column_name);
    console.log(`   ${table.padEnd(24)} ${String(count).padStart(4)} linha(s) · ${cols.length} coluna(s)`);
  }
}

try {
  await snapshot('ANTES');

  if (!checkOnly) {
    for (const migration of MIGRATIONS) {
      const sql = readFileSync(resolve(process.cwd(), migration), 'utf8');
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      console.log(`\n✓ ${migration} aplicada`);
    }
  }

  await snapshot('DEPOIS');

  // Verificação explícita das colunas que a instrumentação depende.
  const required = {
    contract_milestones: ['owner_user_id', 'evidence', 'evidence_document_id', 'measured_amount', 'created_by', 'updated_by'],
    contract_clauses: ['source_document_id', 'source_page', 'source_excerpt', 'amount', 'percentage', 'term_days', 'review_status', 'reviewed_by', 'reviewed_at', 'created_by', 'updated_by'],
    contract_penalties: ['clause_id', 'percentage', 'created_by', 'updated_by'],
    contract_risks_links: ['clause_id'],
    // 094 — ciclo de vida da análise e linhagem de documento.
    contract_ai_analyses: ['document_id', 'started_at', 'error_message', 'model', 'extractor_version', 'superseded_by_analysis_id'],
    contract_documents: ['version', 'supersedes_document_id', 'superseded_by_document_id', 'superseded_at'],
    // 093 — proveniência de proposta de IA.
    contract_clauses_ai: [],
  };

  console.log('\n── COLUNAS EXIGIDAS ──');
  let missing = 0;
  for (const [table, columns] of Object.entries(required)) {
    const present = new Set((await q(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [table],
    )).map((r) => r.column_name));
    for (const column of columns) {
      const ok = present.has(column);
      if (!ok) missing += 1;
      console.log(`   ${ok ? '✓' : '✗'} ${table}.${column}`);
    }
  }

  const aiCols = ['ai_confidence', 'ai_model', 'ai_analysis_id', 'ai_proposed_at', 'ai_proposed_title', 'ai_proposed_content', 'superseded_by_clause_id'];
  const presentAi = new Set((await q(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'contract_clauses'`,
  )).map((r) => r.column_name));
  for (const column of aiCols) {
    const ok = presentAi.has(column);
    if (!ok) missing += 1;
    console.log(`   ${ok ? '✓' : '✗'} contract_clauses.${column}`);
  }

  const checks = await q(`
    SELECT conname FROM pg_constraint
     WHERE conname IN ('contract_milestones_status_check', 'contract_clauses_review_status_check',
                       'contract_clauses_ai_needs_evidence_check', 'contract_clauses_ai_confidence_check',
                       'contract_ai_analyses_status_check')`);

  const idx = await q(`SELECT indexname FROM pg_indexes WHERE indexname = 'idx_contract_clauses_ai_fingerprint'`);
  console.log(`── ÍNDICE DE IDEMPOTÊNCIA ── ${idx.length ? '✓ presente' : '✗ AUSENTE'}`);
  console.log(`\n── CHECKS ── ${checks.map((c) => c.conname).join(', ') || 'NENHUM'}`);

  process.exitCode = missing === 0 ? 0 : 1;
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('\n✗ falha:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
