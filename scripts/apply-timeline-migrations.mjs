/**
 * One-off: applies migrations 032 + 033 (project timeline) against
 * SUPABASE_DB_URL. Both files are idempotent — re-running is a no-op.
 *
 *   node scripts/apply-timeline-migrations.mjs
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
  'supabase/migrations/032_project_timeline.sql',
  'supabase/migrations/033_project_timeline_perm_seeds.sql',
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
     where table_schema='public' and table_name like 'project_timeline%' or table_name='project_schedule_imports' or table_name='project_delay_logs'
     order by table_name`,
  );
  console.log('Tabelas presentes:', rows.map((r) => r.table_name).join(', '));
  const { rows: perms } = await client.query(
    `select count(*)::int as n from permissions where key like 'projects.timeline.%' or key like 'projects.documents.%'`,
  );
  console.log(`Permissões timeline/documents seedadas: ${perms[0].n}`);
  await client.query(`NOTIFY pgrst, 'reload schema'`);
  console.log('Schema cache do PostgREST recarregado.');
} finally {
  await client.end();
}
