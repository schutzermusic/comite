/**
 * E2E — Revisão de Ponto pelo gestor. Cria marcações 'under_review' com
 * selfie (evidência real no bucket privado), o gestor abre
 * /workforce-cost/ponto-revisao, a signed URL da selfie carrega, aprova uma
 * e rejeita outra com nota; verifica reviewed_by/at/note + auditoria; e o
 * acesso de um colaborador não autorizado é negado.
 *
 * Pré: seed (tests/.qa-env.json = gestor privilegiado) + chaves Supabase +
 * SUPABASE_DB_URL. O Playwright sobe o webServer.
 */
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const QA_PATH = 'tests/.qa-env.json';
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'attendance-selfies';
const ready = existsSync(QA_PATH) && !!SUPA_URL && !!SERVICE && !!process.env.SUPABASE_DB_URL;
const qa = existsSync(QA_PATH) ? (JSON.parse(readFileSync(QA_PATH, 'utf8')) as { email: string; password: string; orgId: string }) : null;

test.skip(!ready, 'requer .qa-env.json + chaves Supabase + SUPABASE_DB_URL');
test.setTimeout(120_000);

// 1x1 JPEG
const JPEG =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==';

const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const svc = createClient(SUPA_URL || '', SERVICE || '', { auth: { persistSession: false } });
const approve = { personId: '', name: '', punchId: '', path: '' };
const reject = { personId: '', name: '', punchId: '', path: '' };

async function makePersonWithUnderReviewPunch(tag: string): Promise<{ personId: string; name: string; punchId: string; path: string }> {
  const name = `QA Review ${tag}`;
  const per = await db.query(
    `insert into people (organization_id, full_name, status, source) values ($1,$2,'active','manual') returning id`,
    [qa!.orgId, name],
  );
  const personId = per.rows[0].id as string;
  // selfie real no bucket sob {org}/{person}/...
  const path = `${qa!.orgId}/${personId}/${Date.now()}-${randomUUID()}.jpg`;
  const up = await svc.storage.from(BUCKET).upload(path, Buffer.from(JPEG, 'base64'), { contentType: 'image/jpeg', upsert: false });
  if (up.error) throw new Error(`upload selfie: ${up.error.message}`);
  const ae = await db.query(
    `insert into authentication_evidence (organization_id, person_id, method, result, assurance_level, provider_reference, metadata)
     values ($1,$2,'facial_verification','success','standard',$3, jsonb_build_object('source','web_selfie','path',$3::text)) returning id`,
    [qa!.orgId, personId, path],
  );
  const le = await db.query(
    `insert into location_evidence (organization_id, person_id, latitude, longitude, captured_at_device, distance_from_geofence_meters, source, integrity_status)
     values ($1,$2,-19.9,-43.9, now(), 250, 'gps','unverified') returning id`,
    [qa!.orgId, personId],
  );
  const pu = await db.query(
    `insert into attendance_punches (organization_id, person_id, type, occurred_at, status, source, authentication_evidence_id, location_evidence_id)
     values ($1,$2,'clock_in', now(), 'under_review','mobile',$3,$4) returning id`,
    [qa!.orgId, personId, ae.rows[0].id, le.rows[0].id],
  );
  return { personId, name, punchId: pu.rows[0].id as string, path };
}

test.beforeAll(async () => {
  if (!ready) return;
  await db.connect();
  const tag = randomUUID().slice(0, 6);
  Object.assign(approve, await makePersonWithUnderReviewPunch(`A${tag}`));
  Object.assign(reject, await makePersonWithUnderReviewPunch(`R${tag}`));
});

test.afterAll(async () => {
  if (!ready) return;
  const safe = async (sql: string, p: unknown[]) => { try { await db.query(sql, p); } catch { /* ignora */ } };
  for (const x of [approve, reject]) {
    await safe('delete from attendance_punches where id=$1', [x.punchId]);
    await safe('delete from authentication_evidence where person_id=$1', [x.personId]);
    await safe('delete from location_evidence where person_id=$1', [x.personId]);
    await safe('delete from audit_logs where entity_id=$1', [x.punchId]);
    await safe('delete from people where id=$1', [x.personId]);
    try { await svc.storage.from(BUCKET).remove([x.path]); } catch { /* ignora */ }
  }
  await db.end();
});

async function loginMain(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(qa!.email);
  await page.locator('input[type="password"]').fill(qa!.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
}

test('Gestor aprova e rejeita marcações em revisão (selfie + auditoria)', async ({ page }) => {
  await loginMain(page);
  await page.goto('/workforce-cost/ponto-revisao');
  await expect(page.getByRole('heading', { name: 'Revisão de Ponto' })).toBeVisible({ timeout: 20_000 });

  await expect(page.getByText(approve.name)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(reject.name)).toBeVisible();
  // card = div que contém o nome E os botões de decisão (evita divs internos)
  const approveCard = page.locator('div').filter({ hasText: approve.name }).filter({ has: page.getByRole('button', { name: /Aprovar/ }) }).last();
  const rejectCard = page.locator('div').filter({ hasText: reject.name }).filter({ has: page.getByRole('button', { name: /Rejeitar/ }) }).last();

  // signed URL da selfie carrega (img com alt do nome)
  const selfie = page.getByAltText(`Selfie de ${approve.name}`);
  await expect(selfie).toBeVisible();
  const src = await selfie.getAttribute('src');
  expect(src, 'selfie deve ter signed URL').toContain('/storage/v1/');

  // rejeita COM nota (na card da pessoa a rejeitar)
  await rejectCard.getByPlaceholder(/Nota da revisão/).fill('Fora do canteiro — sem justificativa');
  await rejectCard.getByRole('button', { name: /Rejeitar/ }).click();
  await expect(page.getByText(/rejeitada/i)).toBeVisible({ timeout: 15_000 });

  // aprova a outra
  await approveCard.getByRole('button', { name: /Aprovar/ }).click();
  await expect(page.getByText(/aprovada/i)).toBeVisible({ timeout: 15_000 });

  // persistência: reviewed_by/at/note + status
  const ap = await db.query('select status, reviewed_by, reviewed_at, review_note from attendance_punches where id=$1', [approve.punchId]);
  expect(ap.rows[0].status).toBe('accepted');
  expect(ap.rows[0].reviewed_by).toBeTruthy();
  expect(ap.rows[0].reviewed_at).toBeTruthy();

  const rj = await db.query('select status, reviewed_by, review_note from attendance_punches where id=$1', [reject.punchId]);
  expect(rj.rows[0].status).toBe('cancelled');
  expect(rj.rows[0].review_note).toContain('Fora do canteiro');

  // auditoria
  const audit = await db.query(
    `select action from audit_logs where entity_id = any($1) and action in ('attendance.punch.review_accepted','attendance.punch.review_rejected')`,
    [[approve.punchId, reject.punchId]],
  );
  const actions = audit.rows.map((r) => r.action);
  expect(actions).toContain('attendance.punch.review_accepted');
  expect(actions).toContain('attendance.punch.review_rejected');
});

test('Colaborador não autorizado é negado na Revisão de Ponto (RBAC)', async ({ page, context }) => {
  // cria um worker de campo (só ponto), loga no portal e tenta abrir a review
  const tag = randomUUID().slice(0, 6);
  const email = `qa.deny.${tag}@example.test`;
  const password = 'Ponto!Deny1234';
  const res = await fetch(`${SUPA_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE!, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const userId = (await res.json()).id as string;
  const prof = await db.query(`insert into profiles (user_id, organization_id, full_name, status) values ($1,$2,'QA Deny','active') returning id`, [userId, qa!.orgId]);
  const per = await db.query(`insert into people (organization_id, full_name, status, source, profile_id) values ($1,'QA Deny','active','manual',$2) returning id`, [qa!.orgId, prof.rows[0].id]);
  await db.query(`insert into user_roles (user_id, role_id, organization_id) select $1, r.id, $2 from roles r where r.key='ponto_field_worker' and r.organization_id is null on conflict do nothing`, [userId, qa!.orgId]);

  try {
    await page.goto('/ponto/login');
    await page.getByPlaceholder('E-mail').fill(email);
    await page.getByPlaceholder('Senha').fill(password);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL('**/ponto', { timeout: 30_000 });

    // tenta a página do gestor → middleware exige people.view → /access-restricted
    await page.goto('/workforce-cost/ponto-revisao');
    await expect(page).toHaveURL(/access-restricted/, { timeout: 20_000 });
  } finally {
    const safe = async (sql: string, p: unknown[]) => { try { await db.query(sql, p); } catch { /* ignora */ } };
    await safe('delete from people where id=$1', [per.rows[0].id]);
    await safe('delete from profiles where id=$1', [prof.rows[0].id]);
    try { await fetch(`${SUPA_URL}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: { apikey: SERVICE!, Authorization: `Bearer ${SERVICE}` } }); } catch { /* ignora */ }
    await context.clearCookies();
  }
});
