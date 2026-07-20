/**
 * Seed do E2E de Diárias de Campo. Requer tests/.qa-env.json
 * (rode antes: node scripts/qa-seed-workforce.mjs).
 *
 * Garante, para o QA:
 *   - alocação viva do QA no projeto, cobrindo a próxima semana;
 *   - política de diária ATIVA para o projeto (R$ 45, derived);
 *   - limpeza idempotente da semana-alvo (simulação) e da política QA.
 *
 *   node scripts/qa-seed-diarias.mjs
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error('SUPABASE_DB_URL ausente');
  process.exit(1);
}
const qa = JSON.parse(readFileSync('tests/.qa-env.json', 'utf8'));

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// próxima segunda-feira (igual a nextWeekBounds do app)
const today = new Date();
const dow = today.getDay();
const untilMon = ((8 - dow) % 7) || 7;
const weekStart = new Date(today);
weekStart.setDate(today.getDate() + untilMon);
const weekEnd = new Date(weekStart);
weekEnd.setDate(weekStart.getDate() + 6);
const WEEK_START = iso(weekStart);
const WEEK_END = iso(weekEnd);
const TODAY = iso(today);

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  // limpeza idempotente da semana-alvo (apenas simulação) + política QA
  await client.query(
    `delete from allowance_weeks
      where organization_id = $1 and week_start = $2 and week_end = $3 and simulation_mode = true`,
    [qa.orgId, WEEK_START, WEEK_END],
  );
  await client.query(
    `delete from allowance_policies where organization_id = $1 and name = 'QA Diária'`,
    [qa.orgId],
  );
  await client.query('delete from project_allocations where person_id = $1', [qa.personId]);

  // alocação viva cobrindo a semana
  await client.query(
    `insert into project_allocations
       (organization_id, person_id, project_id, role_title, allocation_type,
        start_date, end_date, planned_percentage, status, source)
     values ($1,$2,$3,'QA Campo','billable',$4,null,100,'active','manual')`,
    [qa.orgId, qa.personId, qa.projectId, TODAY],
  );

  // política ativa para o projeto
  const pol = await client.query(
    `insert into allowance_policies
       (organization_id, name, allowance_type, project_id, amount_cents, currency,
        effective_from, schedule_mode, status)
     values ($1,'QA Diária','meal',$2,4500,'BRL',$3,'derived','active')
     returning id`,
    [qa.orgId, qa.projectId, TODAY],
  );

  await client.query(`NOTIFY pgrst, 'reload schema'`);
  console.log(
    'Seed Diárias OK →',
    JSON.stringify({ week: `${WEEK_START}..${WEEK_END}`, policyId: pol.rows[0].id, projectId: qa.projectId }),
  );
} finally {
  await client.end();
}
