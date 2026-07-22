/**
 * E2E (API) — auto-provisionamento: regra requires-ponto, bloqueio, e-mail
 * ausente, DRY-RUN sem mutação e idempotência. Usa SOMENTE dry-run do cron
 * (não envia e-mail nem cria auth users) → seguro para rodar contra o
 * backend real. Cria pessoas descartáveis e limpa no fim.
 *
 * Pré: CRON_SECRET + SUPABASE_DB_URL + tests/.qa-env.json (orgId, projectId)
 * + servidor em 9002.
 */
import { test, expect, request as pwRequest } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const QA_PATH = 'tests/.qa-env.json';
const ready = existsSync(QA_PATH) && !!process.env.CRON_SECRET && !!process.env.SUPABASE_DB_URL;
const qa = existsSync(QA_PATH) ? (JSON.parse(readFileSync(QA_PATH, 'utf8')) as { orgId: string; projectId: string }) : null;

test.skip(!ready, 'requer .qa-env.json + CRON_SECRET + SUPABASE_DB_URL');
test.describe.configure({ mode: 'serial' });

const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const ids = { invite: '', noEmail: '', notRequired: '', blocked: '' };

async function makePerson(orgId: string, name: string, email: string | null, opts: { blocked?: boolean } = {}) {
  const r = await db.query(
    `insert into people (organization_id, full_name, email, status, source, access_blocked)
     values ($1,$2,$3,'active','manual',$4) returning id`,
    [orgId, name, email, opts.blocked ?? false],
  );
  return r.rows[0].id as string;
}
async function allocate(orgId: string, personId: string, projectId: string, requiresPonto: boolean) {
  await db.query(
    `insert into project_allocations (organization_id, person_id, project_id, allocation_type, start_date, planned_percentage, status, source, requires_ponto)
     values ($1,$2,$3,'billable', current_date - 1, 50, 'active','manual',$4)`,
    [orgId, personId, projectId, requiresPonto],
  );
}

test.beforeAll(async () => {
  if (!ready || !qa) return;
  await db.connect();
  const tag = randomUUID().slice(0, 8);
  ids.invite = await makePerson(qa.orgId, `QA Invite ${tag}`, `qa.invite.${tag}@example.test`);
  ids.noEmail = await makePerson(qa.orgId, `QA NoEmail ${tag}`, null);
  ids.notRequired = await makePerson(qa.orgId, `QA NotReq ${tag}`, `qa.notreq.${tag}@example.test`);
  ids.blocked = await makePerson(qa.orgId, `QA Blocked ${tag}`, `qa.blocked.${tag}@example.test`, { blocked: true });
  await allocate(qa.orgId, ids.invite, qa.projectId, true);
  await allocate(qa.orgId, ids.noEmail, qa.projectId, true);
  await allocate(qa.orgId, ids.notRequired, qa.projectId, false); // NÃO exige ponto
  await allocate(qa.orgId, ids.blocked, qa.projectId, true);
});

test.afterAll(async () => {
  if (!ready) return;
  for (const id of Object.values(ids)) {
    if (!id) continue;
    await db.query('delete from project_allocations where person_id=$1', [id]);
    await db.query('delete from people where id=$1', [id]);
  }
  await db.end();
});

async function cronDryRun() {
  const ctx = await pwRequest.newContext({ baseURL: 'http://localhost:9002' });
  const res = await ctx.post('/api/ponto/cron?dryRun=1', {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  expect(res.ok()).toBeTruthy();
  const json = await res.json();
  await ctx.dispose();
  expect(json.dryRun).toBe(true);
  return json.summary as { dryRun: true; items: Array<{ personId: string; proposedAction: string; blockingError: string | null }> };
}

test('requires-ponto + bloqueio + e-mail ausente — dry-run propõe as ações corretas', async () => {
  const summary = await cronDryRun();
  const byId = new Map(summary.items.map((i) => [i.personId, i]));

  expect(byId.get(ids.invite)?.proposedAction, 'no_access com e-mail e requires_ponto → invite').toBe('invite');
  expect(byId.get(ids.noEmail)?.proposedAction, 'sem e-mail → fail').toBe('fail');
  expect(byId.get(ids.noEmail)?.blockingError).toBe('missing_email');
  expect(byId.has(ids.notRequired), 'requires_ponto=false não entra no preview').toBe(false);
  const blocked = byId.get(ids.blocked);
  expect(blocked === undefined || blocked.proposedAction === 'skip', 'bloqueado nunca é convidado').toBeTruthy();
});

test('dry-run é idempotente e não muta o estado', async () => {
  await cronDryRun();
  await cronDryRun(); // duas vezes
  const r = await db.query(
    `select access_invite_count, access_invited_at, profile_id from people where id = any($1)`,
    [[ids.invite, ids.noEmail, ids.blocked]],
  );
  for (const row of r.rows) {
    expect(Number(row.access_invite_count)).toBe(0); // nada incrementado
    expect(row.access_invited_at).toBeNull(); // nenhum timestamp de sucesso
    expect(row.profile_id).toBeNull(); // nenhum auth user vinculado
  }
});
