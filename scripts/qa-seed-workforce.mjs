/**
 * QA seed — cria/garante um usuário autenticável para o E2E do módulo
 * Pessoas & Custos (Playwright) e limpa os dados transacionais do QA
 * para o run ser idempotente.
 *
 *   node scripts/qa-seed-workforce.mjs
 *
 * Saída: tests/.qa-env.json { email, password, projectId, personId }
 */
import { readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DB_URL = process.env.SUPABASE_DB_URL;
if (!SUPABASE_URL || !SERVICE_KEY || !DB_URL) {
  console.error('Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_DB_URL');
  process.exit(1);
}

const QA_EMAIL = 'qa.workforce@insightapex.dev';
const QA_PASSWORD = 'QaWorkforce!2026#e2e';
const QA_NAME = 'QA Workforce Bot';
const QA_CPF = '39053344705';

const admin = async (path, init = {}) => {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
};

const client = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  // 1) usuário auth (cria ou reutiliza) com senha conhecida
  let userId = null;
  const created = await admin('/users', {
    method: 'POST',
    body: JSON.stringify({ email: QA_EMAIL, password: QA_PASSWORD, email_confirm: true }),
  });
  if (created.ok) {
    userId = created.body.id;
    console.log('Usuário QA criado:', userId);
  } else {
    const { rows } = await client.query('select id from auth.users where email = $1', [QA_EMAIL]);
    if (rows.length === 0) throw new Error(`createUser falhou: ${JSON.stringify(created.body)}`);
    userId = rows[0].id;
    const upd = await admin(`/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ password: QA_PASSWORD, email_confirm: true }),
    });
    console.log('Usuário QA reutilizado:', userId, upd.ok ? '(senha resetada)' : `(reset falhou ${upd.status})`);
  }

  // 2) organização alvo = primeira org existente
  const org = (await client.query('select id from organizations order by created_at limit 1')).rows[0];
  if (!org) throw new Error('Nenhuma organização no banco');

  // 3) profile ativo na org
  const profile = (
    await client.query(
      `insert into profiles (user_id, organization_id, full_name, status)
       values ($1, $2, $3, 'active')
       on conflict (user_id) do update
         set organization_id = excluded.organization_id,
             full_name = excluded.full_name,
             status = 'active'
       returning id`,
      [userId, org.id, QA_NAME],
    )
  ).rows[0];

  // 4) papel owner_admin (system role)
  await client.query(
    `insert into user_roles (user_id, role_id, organization_id)
     select $1, r.id, $2 from roles r
      where r.key = 'owner_admin' and r.organization_id is null
     on conflict do nothing`,
    [userId, org.id],
  );

  // 5) pessoa canônica vinculada ao profile (com CPF p/ REP-P)
  let person = (
    await client.query('select id from people where profile_id = $1', [profile.id])
  ).rows[0];
  if (!person) {
    person = (
      await client.query(
        `insert into people (organization_id, profile_id, full_name, cpf, weekly_hours, status, source)
         values ($1, $2, $3, $4, 40, 'active', 'manual') returning id`,
        [org.id, profile.id, QA_NAME, QA_CPF],
      )
    ).rows[0];
  } else {
    await client.query(
      `update people set full_name = $2, cpf = $3, status = 'active' where id = $1`,
      [person.id, QA_NAME, QA_CPF],
    );
  }

  // 6) limpeza transacional do QA (idempotência do run)
  await client.query('delete from time_entries where person_id = $1', [person.id]);
  await client.query('delete from project_work_sessions where person_id = $1', [person.id]);
  await client.query('delete from attendance_punches where person_id = $1', [person.id]);
  await client.query('delete from project_allocations where person_id = $1', [person.id]);
  await client.query(`delete from project_geofences where name = 'QA Cerca'`);
  await client.query(
    `delete from governance_exceptions where person_id = $1 or fingerprint like 'payroll_without_allocation:' || $1 || '%'`,
    [person.id],
  );

  // 7) projeto alvo
  const project = (await client.query('select id from projects limit 1')).rows[0];
  if (!project) throw new Error('Nenhum projeto no banco — crie um projeto antes do E2E');

  const out = {
    email: QA_EMAIL,
    password: QA_PASSWORD,
    projectId: project.id,
    personId: person.id,
    personName: QA_NAME,
    orgId: org.id,
  };
  writeFileSync('tests/.qa-env.json', JSON.stringify(out, null, 2));
  console.log('Seed OK →', JSON.stringify({ ...out, password: '***' }));
} finally {
  await client.end();
}
