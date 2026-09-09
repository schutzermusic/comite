import { readFileSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';
import { recordMigrationApplied } from './lib/migration-registry.mjs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error('SUPABASE_DB_URL ausente. Migração 152 não executada.');
  process.exit(2);
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
const stripTransaction = (sql) => sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gmi, '');
let ok = true;
const must = (label, condition, detail = '') => {
  console.log(`   ${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) ok = false;
};

try {
  await client.connect();
  await client.query('SET SESSION default_transaction_read_only = off');
  const tip = (await client.query(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1',
  )).rows[0]?.version;
  must('ponta do registro é 151', tip === '151', String(tip));
  if (tip !== '151') throw new Error('ponta de migration inesperada');

  await client.query('BEGIN');
  await client.query(stripTransaction(readFileSync(
    'supabase/migrations/152_apex_ai_gateway_provenance.sql',
    'utf8',
  )));
  await recordMigrationApplied(client, '152', 'apex_ai_gateway_provenance');

  const columns = (await client.query(`
    SELECT table_name, column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND column_name IN ('ai_provider','provider','ai_input_tokens','input_tokens')
       AND table_name IN ('risks','contract_ai_analyses','contract_clauses',
                          'payroll_generated_reports','aso_documents','project_schedule_imports')
  `)).rows;
  const key = new Set(columns.map((row) => `${row.table_name}.${row.column_name}`));
  for (const expected of [
    'risks.ai_provider', 'contract_ai_analyses.provider', 'contract_clauses.ai_provider',
    'payroll_generated_reports.ai_provider', 'aso_documents.ai_provider',
    'project_schedule_imports.ai_provider',
  ]) must(expected, key.has(expected));

  const constraintCount = Number((await client.query(`
    SELECT count(*)::int AS n FROM pg_constraint
     WHERE conname IN (
       'risks_ai_provenance_check','contract_ai_analyses_provenance_check',
       'contract_clauses_ai_provenance_check','payroll_generated_reports_ai_provenance_check',
       'aso_documents_ai_provenance_check','project_schedule_imports_ai_provenance_check'
     )
  `)).rows[0].n);
  must('seis gates de proveniência ativos', constraintCount === 6, String(constraintCount));
  if (!ok) throw new Error('bateria da migration reprovada');

  if (apply) {
    await client.query('COMMIT');
    console.log('=== MIGRATION 152 COMETIDA ===');
  } else {
    await client.query('ROLLBACK');
    console.log('=== ENSAIO APROVADO; DESFEITO ===');
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error(`✗ FALHOU: ${error instanceof Error ? error.message : String(error)}`);
  ok = false;
} finally {
  await client.end().catch(() => undefined);
}

process.exit(ok ? 0 : 1);
