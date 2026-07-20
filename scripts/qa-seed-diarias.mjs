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
  await client.query(`delete from people where organization_id = $1 and full_name in ('QA Diárias Mesma Cidade','QA Diárias Sem Município')`, [qa.orgId]);
  await client.query('delete from person_residence_municipalities where person_id = $1', [qa.personId]);
  await client.query(`delete from project_geofences where organization_id = $1 and name = 'QA Diárias Local Operacional'`, [qa.orgId]);

  const geofence = (await client.query(
    `insert into project_geofences
       (organization_id, project_id, name, center_lat, center_lng, radius_meters,
        active, municipality_code, municipality_name, state_code, municipality_source,
        municipality_verified_at)
     values ($1,$2,'QA Diárias Local Operacional',-22.9068,-43.1729,300,true,
             '3304557','Rio de Janeiro','RJ','manual',now()) returning id`,
    [qa.orgId, qa.projectId],
  )).rows[0];

  const sameCity = (await client.query(
    `insert into people (organization_id, full_name, weekly_hours, status, source)
     values ($1,'QA Diárias Mesma Cidade',40,'active','manual') returning id`, [qa.orgId],
  )).rows[0];
  const missingCity = (await client.query(
    `insert into people (organization_id, full_name, weekly_hours, status, source)
     values ($1,'QA Diárias Sem Município',40,'active','manual') returning id`, [qa.orgId],
  )).rows[0];
  const validatorUserId = (await client.query(
    `select pr.user_id from people p join profiles pr on pr.id = p.profile_id where p.id = $1`,
    [qa.personId],
  )).rows[0]?.user_id;
  if (!validatorUserId) throw new Error('Usuário validador QA não encontrado');

  await client.query(
    `insert into person_residence_municipalities
       (organization_id, person_id, municipality_code, municipality_name, state_code,
        valid_from, source, status, verified_by, verified_at)
     values
       ($1,$2,'4113700','Londrina','PR',$5,'hr_registration','validated',$4,now()),
       ($1,$3,'3304557','Rio de Janeiro','RJ',$5,'hr_registration','validated',$4,now())`,
    [qa.orgId, qa.personId, sameCity.id, validatorUserId, TODAY],
  );

  // alocação viva cobrindo a semana
  await client.query(
    `insert into project_allocations
       (organization_id, person_id, project_id, role_title, allocation_type,
        start_date, end_date, planned_percentage, status, source)
     values ($1,$2,$3,'QA Campo','billable',$4,null,100,'active','manual')`,
    [qa.orgId, qa.personId, qa.projectId, TODAY],
  );
  await client.query(
    `insert into project_allocations
       (organization_id, person_id, project_id, role_title, allocation_type,
        start_date, end_date, planned_percentage, status, source)
     values
       ($1,$2,$4,'QA Campo','billable',$5,null,100,'active','manual'),
       ($1,$3,$4,'QA Campo','billable',$5,null,100,'active','manual')`,
    [qa.orgId, sameCity.id, missingCity.id, qa.projectId, TODAY],
  );

  // política ativa para o projeto
  const pol = await client.query(
    `insert into allowance_policies
       (organization_id, name, allowance_type, project_id, geofence_id, amount_cents, currency,
        effective_from, schedule_mode, status, travel_eligibility_mode,
        residence_municipality_required, service_municipality_required)
     values ($1,'QA Diária','meal',$2,$4,4500,'BRL',$3,'derived','active',
             'different_municipality',true,true)
     returning id`,
    [qa.orgId, qa.projectId, TODAY, geofence.id],
  );

  await client.query(`NOTIFY pgrst, 'reload schema'`);
  console.log(
    'Seed Diárias OK →',
    JSON.stringify({ week: `${WEEK_START}..${WEEK_END}`, policyId: pol.rows[0].id, projectId: qa.projectId,
      sameCityPersonId: sameCity.id, missingCityPersonId: missingCity.id, geofenceId: geofence.id }),
  );
} finally {
  await client.end();
}
