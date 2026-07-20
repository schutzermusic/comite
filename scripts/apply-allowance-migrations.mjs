/**
 * Aplica as migrations de Diárias de Campo (056–061) contra
 * SUPABASE_DB_URL. Todos os arquivos são idempotentes — reexecutar é
 * no-op. (Migrations 059/060 chegam nas Fases 3/4.)
 *
 *   node scripts/apply-allowance-migrations.mjs
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
  'supabase/migrations/056_allowance_policies.sql',
  'supabase/migrations/057_work_schedule_days.sql',
  'supabase/migrations/058_allowance_weeks_and_daily.sql',
  'supabase/migrations/060_allowance_adjustments.sql',
  'supabase/migrations/061_allowance_perm_seeds.sql',
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
     where table_schema='public'
       and table_name in ('allowance_policies','work_schedule_days',
                          'allowance_weeks','daily_allowances')
     order by table_name`,
  );
  console.log('Tabelas presentes:', rows.map((r) => r.table_name).join(', '));

  const { rows: idx } = await client.query(
    `select indexname from pg_indexes
     where schemaname='public'
       and indexname in ('daily_allowances_no_duplicate_idx','daily_allowances_idempotency_idx')
     order by indexname`,
  );
  console.log('Índices anti-duplicidade:', idx.map((r) => r.indexname).join(', '));

  const { rows: perms } = await client.query(
    `select count(*)::int as n from permissions where key like 'allowances.%'`,
  );
  console.log(`Permissões allowances.* seedadas: ${perms[0].n}/7`);

  await client.query(`NOTIFY pgrst, 'reload schema'`);
  console.log('Schema cache do PostgREST recarregado.');
} finally {
  await client.end();
}
