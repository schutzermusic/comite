/**
 * Aplica a persistência e as políticas do Pack do Investidor no Supabase
 * configurado em SUPABASE_DB_URL. A migration é idempotente.
 *
 * Uso:
 *   node scripts/apply-investor-pack-migration.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config({ path: path.join(process.cwd(), '.env') });

if (!process.env.SUPABASE_DB_URL) {
  console.error('SUPABASE_DB_URL não encontrado em .env.local nem no ambiente.');
  process.exit(1);
}

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/079_investor_report_packs.sql',
);
const sql = await fs.readFile(migrationPath, 'utf8');
const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query(sql);
  const { rows } = await client.query(`
    select
      to_regclass('public.investor_report_packs') is not null as packs_exists,
      to_regclass('public.investor_report_pack_months') is not null as months_exists
  `);
  if (!rows[0]?.packs_exists || !rows[0]?.months_exists) {
    throw new Error('As tabelas não foram encontradas após a migration.');
  }
  console.log('Migration 079 aplicada: Pack do Investidor disponível.');
} finally {
  await client.end();
}
