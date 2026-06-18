/**
 * One-off: applies migration 034 (contracts control room schema) against
 * SUPABASE_DB_URL. The migration is idempotent.
 *
 *   node scripts/apply-contracts-migrations.mjs
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
  'supabase/migrations/034_contracts_control_room.sql',
];

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  for (const file of files) {
    const sql = readFileSync(resolve(file), 'utf8');
    process.stdout.write(`Aplicando ${file} … `);
    await client.query(sql);
    console.log('OK');
  }
  const { rows } = await client.query(
    `select table_name from information_schema.tables
     where table_schema='public' and table_name in ('contract_obligations', 'contract_approvals', 'contract_project_links', 'contract_risks_links', 'contract_documents')
     order by table_name`,
  );
  console.log('Novas tabelas de contratos presentes:', rows.map((r) => r.table_name).join(', '));
  await client.query(`NOTIFY pgrst, 'reload schema'`);
  console.log('Schema cache do PostgREST recarregado.');
} catch (err) {
  console.error('Erro ao aplicar migrações de contratos:', err);
  process.exit(1);
} finally {
  await client.end();
}
