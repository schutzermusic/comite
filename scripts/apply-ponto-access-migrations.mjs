/**
 * Applies the Ponto access/selfie migrations against SUPABASE_DB_URL.
 * All files are idempotent — re-running is a no-op.
 *
 *   node scripts/apply-ponto-access-migrations.mjs
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
  'supabase/migrations/065_attendance_selfies_storage.sql',
  'supabase/migrations/066_ponto_access.sql',
  'supabase/migrations/067_ponto_access_auth_rpc.sql',
  'supabase/migrations/068_attendance_review.sql',
  'supabase/migrations/069_attendance_selfie_retention.sql',
  'supabase/migrations/070_ponto_access_visibility.sql',
  'supabase/migrations/071_allocation_requires_ponto.sql',
  'supabase/migrations/072_ponto_job_runs.sql',
  'supabase/migrations/073_ponto_field_worker_timesheet.sql',
];

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  for (const file of files) {
    let sql;
    try {
      sql = readFileSync(resolve(file), 'utf8');
    } catch {
      console.log(`(pulando ${file} — não encontrado)`);
      continue;
    }
    process.stdout.write(`Aplicando ${file} … `);
    await client.query(sql);
    console.log('OK');
  }

  // ── validation: bucket + policies ──
  const { rows: buckets } = await client.query(
    `select id, public, file_size_limit from storage.buckets where id = 'attendance-selfies'`,
  );
  console.log('Bucket attendance-selfies:', buckets[0] ?? 'AUSENTE');

  const { rows: policies } = await client.query(
    `select policyname, cmd from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname like 'attendance_selfies_%'
     order by policyname`,
  );
  console.log('Políticas de storage:', policies.map((p) => `${p.policyname}(${p.cmd})`).join(', ') || 'NENHUMA');

  // ── validation: people access columns (066) ──
  const { rows: cols } = await client.query(
    `select column_name from information_schema.columns
     where table_schema='public' and table_name='people'
       and column_name in ('access_invited_at','access_blocked','access_blocked_at','access_blocked_by','access_invite_count')
     order by column_name`,
  );
  console.log('Colunas people.access_*:', cols.map((c) => c.column_name).join(', ') || 'NENHUMA');

  const { rows: role = [] } = await client.query(
    `select key, name from roles where key = 'ponto_field_worker' and organization_id is null`,
  );
  console.log('Role ponto_field_worker:', role[0] ?? 'AUSENTE');

  const { rows: reviewCols } = await client.query(
    `select column_name from information_schema.columns
     where table_schema='public' and table_name='attendance_punches'
       and column_name in ('reviewed_by','reviewed_at','review_note') order by column_name`,
  );
  console.log('Colunas attendance_punches review:', reviewCols.map((c) => c.column_name).join(', ') || 'NENHUMA');

  const { rows: purgeFn } = await client.query(
    `select proname from pg_proc where proname = 'purge_attendance_selfies'`,
  );
  console.log('Função purge_attendance_selfies:', purgeFn[0]?.proname ?? 'AUSENTE');

  await client.query(`NOTIFY pgrst, 'reload schema'`);
  console.log('Schema cache do PostgREST recarregado.');
} finally {
  await client.end();
}
