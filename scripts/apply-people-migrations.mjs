/**
 * One-off: applies migrations 038–042 (people, allocations, leaves,
 * timesheet) against SUPABASE_DB_URL. All files are idempotent —
 * re-running is a no-op.
 *
 *   node scripts/apply-people-migrations.mjs
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
  'supabase/migrations/038_people_allocations.sql',
  'supabase/migrations/039_people_allocations_perm_seeds.sql',
  'supabase/migrations/040_leave_periods.sql',
  'supabase/migrations/041_timesheet.sql',
  'supabase/migrations/042_timesheet_perm_seeds.sql',
  'supabase/migrations/043_labor_cost.sql',
  'supabase/migrations/044_labor_cost_perm_seeds.sql',
  'supabase/migrations/045_attendance.sql',
  'supabase/migrations/046_attendance_perm_seeds.sql',
  'supabase/migrations/047_governance.sql',
  'supabase/migrations/048_governance_perm_seeds.sql',
  'supabase/migrations/049_workforce_ai_perm_seeds.sql',
  'supabase/migrations/050_mobile_foundation.sql',
  'supabase/migrations/051_mobile_perm_seeds.sql',
  'supabase/migrations/052_rep_compliance.sql',
  'supabase/migrations/053_rep_perm_seeds.sql',
  'supabase/migrations/054_labor_cost_rls_hardening.sql',
  'supabase/migrations/055_webauthn_biometrics.sql',
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
       and table_name in ('people','project_allocations','leave_periods',
                          'project_work_sessions','time_entries')
     order by table_name`,
  );
  console.log('Tabelas presentes:', rows.map((r) => r.table_name).join(', '));

  const { rows: counts } = await client.query(
    `select
       (select count(*)::int from people) as people,
       (select count(*)::int from people where payroll_name_key is not null) as people_from_payroll,
       (select count(*)::int from people where profile_id is not null) as people_linked_to_login,
       (select count(*)::int from payroll_employee_lines where person_id is not null) as payroll_lines_linked`,
  );
  console.log('Backfill:', counts[0]);

  const { rows: perms } = await client.query(
    `select count(*)::int as n from permissions
     where key in ('people.manage','people.allocations_view','people.allocations_manage',
                   'people.cost_view','people.timesheet_use','people.timesheet_view',
                   'people.timesheet_approve')`,
  );
  console.log(`Permissões people.* novas seedadas: ${perms[0].n}/7`);

  await client.query(`NOTIFY pgrst, 'reload schema'`);
  console.log('Schema cache do PostgREST recarregado.');
} finally {
  await client.end();
}
