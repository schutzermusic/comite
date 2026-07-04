/**
 * Fase 8: aplica migrations 035 + 036 (aditivas e idempotentes) contra
 * SUPABASE_DB_URL e roda as verificações da seção 1 do guia
 * docs/qa/phase-8-staging-hardening.md.
 *
 *   node scripts/apply-contracts-migrations-phase8.mjs
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

const files = [
  'supabase/migrations/035_contract_documents_approved.sql',
  'supabase/migrations/036_contract_persistence_fields.sql',
];

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  // Contagem de linhas antes, para provar que nada foi destruído.
  const before = await client.query(
    `select
       (select count(*) from public.contract_documents) as documents,
       (select count(*) from public.contract_obligations) as obligations,
       (select count(*) from public.contract_approvals) as approvals,
       (select count(*) from public.contract_billing_events) as billing`,
  );
  console.log('Linhas antes:', before.rows[0]);

  for (const file of files) {
    const sql = readFileSync(resolve(file), 'utf8');
    process.stdout.write(`Aplicando ${file} … `);
    await client.query(sql);
    console.log('OK');
  }

  // Verificação 035: CHECK inclui 'approved'.
  const check = await client.query(
    `select pg_get_constraintdef(oid) as def from pg_constraint
     where conname = 'contract_documents_status_check'`,
  );
  const def = check.rows[0]?.def ?? '(constraint ausente!)';
  console.log('035 status CHECK:', def);
  if (!def.includes("'approved'")) throw new Error("CHECK não contém 'approved'");

  // Verificação 035 + 036: colunas novas (3 + 11 = 14 linhas esperadas).
  const cols = await client.query(
    `select table_name, column_name from information_schema.columns
     where (table_name = 'contract_documents' and column_name in ('approved_at','approved_by','rejection_reason'))
        or (table_name = 'contract_obligations' and column_name in ('completion_note','completed_by','completed_at'))
        or (table_name = 'contract_approvals' and column_name in ('started_at','completed_at','requested_changes_note'))
        or (table_name = 'contract_billing_events' and column_name in ('realized_amount','invoice_reference','realized_note','realized_by','realized_at'))
     order by table_name, column_name`,
  );
  console.log(`Colunas novas presentes (${cols.rows.length}/14):`);
  for (const row of cols.rows) console.log(`  ${row.table_name}.${row.column_name}`);
  if (cols.rows.length !== 14) throw new Error(`Esperava 14 colunas, encontrei ${cols.rows.length}`);

  // RLS continua habilitado nas 4 tabelas.
  const rls = await client.query(
    `select relname, relrowsecurity from pg_class
     where relname in ('contract_documents','contract_obligations','contract_approvals','contract_billing_events')`,
  );
  console.log('RLS habilitado:', rls.rows.map((r) => `${r.relname}=${r.relrowsecurity}`).join(', '));
  if (rls.rows.some((r) => !r.relrowsecurity)) throw new Error('RLS desabilitado em alguma tabela!');

  // Linhas preservadas.
  const after = await client.query(
    `select
       (select count(*) from public.contract_documents) as documents,
       (select count(*) from public.contract_obligations) as obligations,
       (select count(*) from public.contract_approvals) as approvals,
       (select count(*) from public.contract_billing_events) as billing`,
  );
  console.log('Linhas depois:', after.rows[0]);
  if (JSON.stringify(before.rows[0]) !== JSON.stringify(after.rows[0])) {
    throw new Error('Contagem de linhas mudou — investigar!');
  }

  await client.query(`NOTIFY pgrst, 'reload schema'`);
  console.log('Schema cache do PostgREST recarregado. Fase 8 §1: OK.');
} catch (err) {
  console.error('Erro na Fase 8 §1:', err);
  process.exitCode = 1;
} finally {
  await client.end();
}
