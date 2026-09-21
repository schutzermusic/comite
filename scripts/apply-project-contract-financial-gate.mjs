/**
 * Aplica a migration 184 — portão financeiro no read model contratual do
 * projeto. Só retira visibilidade; nenhuma permissão é criada ou concedida.
 *
 * Uso: node scripts/apply-project-contract-financial-gate.mjs [--apply]
 */
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'node:fs';
dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('SUPABASE_DB_URL ausente.'); process.exit(2); }

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('BEGIN');
  const sql = fs.readFileSync('supabase/migrations/184_project_contract_financial_gate.sql', 'utf8')
    .replace(/^BEGIN;$/m, '--').replace(/^COMMIT;$/m, '--');
  await client.query(sql);
  console.log('✓ 184_project_contract_financial_gate.sql');
  const r = await client.query(`
    SELECT project_id, contract_number, can_view_values, contract_value, milestone_count
      FROM public.project_contract_financial_read_model LIMIT 3`);
  console.table(r.rows);
  if (apply) { await client.query('COMMIT'); console.log('APLICADA.'); }
  else { await client.query('ROLLBACK'); console.log('ENSAIO — desfeito.'); }
} catch (e) {
  await client.query('ROLLBACK');
  console.error('FALHOU:', e.message);
  process.exitCode = 1;
} finally { await client.end(); }
