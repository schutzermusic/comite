/**
 * E2E — Portal de Ponto Web (fluxo SELFIE) + isolamento de dados (RLS).
 *
 * Provisiona um COLABORADOR DEDICADO (confirmado, só a role ponto_field_worker
 * = attendance_use) para que os testes sejam determinísticos e a checagem de
 * isolamento seja válida (o usuário qa do seed é privilegiado). Cobre:
 *   - login do colaborador;
 *   - seleção de projeto + etapa do cronograma (WBS);
 *   - captura de selfie (câmera fake do Chromium) e registro do ponto;
 *   - evidência facial vinculada e sob o path do tenant/pessoa;
 *   - ISOLAMENTO: o colaborador (não-privilegiado) NÃO lê marcações de outro
 *     colaborador (requisito de segurança).
 *
 * Pré: seed (scripts/qa-seed-workforce.mjs → tests/.qa-env.json) + o Playwright
 * sobe o webServer automaticamente. A câmera é simulada por flags do Chromium
 * (getUserMedia devolve vídeo sintético → canvas.toDataURL gera JPEG real).
 */
import { test, expect, request as pwRequest } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
});

const QA_PATH = 'tests/.qa-env.json';
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ready = existsSync(QA_PATH) && !!SUPA_URL && !!SERVICE && !!ANON && !!process.env.SUPABASE_DB_URL;
const qa = existsSync(QA_PATH) ? (JSON.parse(readFileSync(QA_PATH, 'utf8')) as { email: string; password: string; projectId: string; personId: string; orgId: string }) : null;

test.skip(!ready, 'requer .qa-env.json + chaves Supabase + SUPABASE_DB_URL');
test.setTimeout(120_000);

const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const worker = { email: '', password: 'Ponto!Test1234', userId: '', profileId: '', personId: '', allocationId: '', timelineItemId: '' };

async function adminCreateUser(email: string, password: string): Promise<string> {
  const res = await fetch(`${SUPA_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE!, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`admin createUser: ${res.status} ${await res.text()}`);
  return (await res.json()).id as string;
}

test.beforeAll(async () => {
  if (!ready || !qa) return;
  await db.connect();
  const tag = randomUUID().slice(0, 8);
  worker.email = `qa.worker.${tag}@example.test`;
  worker.userId = await adminCreateUser(worker.email, worker.password);

  const prof = await db.query(
    `insert into profiles (user_id, organization_id, full_name, status) values ($1,$2,'QA Worker','active') returning id`,
    [worker.userId, qa.orgId],
  );
  worker.profileId = prof.rows[0].id;
  const per = await db.query(
    `insert into people (organization_id, full_name, email, status, source, profile_id) values ($1,'QA Worker',$2,'active','manual',$3) returning id`,
    [qa.orgId, worker.email, worker.profileId],
  );
  worker.personId = per.rows[0].id;
  // role de campo (só attendance_use)
  await db.query(
    `insert into user_roles (user_id, role_id, organization_id)
     select $1, r.id, $2 from roles r where r.key='ponto_field_worker' and r.organization_id is null
     on conflict do nothing`,
    [worker.userId, qa.orgId],
  );
  // alocação viva (requer ponto) + etapa de cronograma no projeto qa
  const al = await db.query(
    `insert into project_allocations (organization_id, person_id, project_id, role_title, allocation_type, start_date, planned_percentage, status, source, requires_ponto)
     values ($1,$2,$3,'QA Selfie','billable', current_date - 1, 50, 'active','manual', true) returning id`,
    [qa.orgId, worker.personId, qa.projectId],
  );
  worker.allocationId = al.rows[0].id;
  const ti = await db.query(
    `insert into project_timeline_items (organization_id, project_id, wbs_code, title, type, status, percent_complete, row_order)
     values ($1,$2,'1.1','QA — Montagem eletromecânica','task','in_progress',40,1) returning id`,
    [qa.orgId, qa.projectId],
  );
  worker.timelineItemId = ti.rows[0].id;
});

test.afterAll(async () => {
  if (!ready) return;
  const safe = async (sql: string, p: unknown[]) => { try { await db.query(sql, p); } catch { /* ignora triggers de imutabilidade */ } };
  if (worker.personId) {
    await safe('delete from project_work_sessions where person_id=$1', [worker.personId]);
    await safe('delete from attendance_punches where person_id=$1', [worker.personId]);
  }
  await safe('delete from project_timeline_items where id=$1', [worker.timelineItemId]);
  await safe('delete from project_allocations where id=$1', [worker.allocationId]);
  await safe('delete from people where id=$1', [worker.personId]);
  await safe('delete from profiles where id=$1', [worker.profileId]);
  if (worker.userId) {
    try {
      await fetch(`${SUPA_URL}/auth/v1/admin/users/${worker.userId}`, { method: 'DELETE', headers: { apikey: SERVICE!, Authorization: `Bearer ${SERVICE}` } });
    } catch { /* ignora */ }
  }
  await db.end();
});

test('Selfie + etapa do cronograma registra o ponto com evidência facial', async ({ page, context }) => {
  await context.grantPermissions(['geolocation', 'camera'], { origin: 'http://localhost:9002' });
  await context.setGeolocation({ latitude: -19.9, longitude: -43.9 });

  await page.goto('/ponto/login');
  await page.getByPlaceholder('E-mail').fill(worker.email);
  await page.getByPlaceholder('Senha').fill(worker.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/ponto', { timeout: 30_000 });
  await expect(page.getByText(/Olá,/)).toBeVisible();

  // entrada → folha de projeto/etapa (worker tem 1 alocação → determinístico)
  await page.getByRole('button', { name: /escolher projeto/ }).click();
  const sheet = page.locator('div.rounded-t-3xl', { hasText: 'Onde você vai trabalhar?' });
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  await sheet.getByRole('button', { name: /Montagem eletromecânica/ }).click();
  await sheet.getByRole('button', { name: /Registrar entrada/ }).click();

  // modal da selfie → tirar foto → registrar
  await expect(page.getByText(/Selfie para a entrada/)).toBeVisible({ timeout: 15_000 });
  // aguarda a câmera fake produzir frames com dimensões (senão takeShot sai cedo)
  await page.waitForFunction(() => {
    const v = document.querySelector('video');
    return !!v && v.videoWidth > 0 && v.readyState >= 2;
  }, { timeout: 20_000 });
  await page.getByRole('button', { name: /Tirar foto/ }).click();
  await expect(page.getByRole('button', { name: /Usar esta foto e registrar/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /Usar esta foto e registrar/ }).click();
  await expect(page.getByText(/registrad/i)).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText('Atividade em andamento')).toBeVisible({ timeout: 15_000 });

  // evidência facial vinculada + selfie sob o path do tenant/pessoa
  const ev = await db.query(
    `select ae.method, ae.provider_reference
       from attendance_punches ap
       join authentication_evidence ae on ae.id = ap.authentication_evidence_id
      where ap.person_id=$1 order by ap.occurred_at desc limit 1`,
    [worker.personId],
  );
  expect(ev.rows[0]?.method).toBe('facial_verification');
  expect(String(ev.rows[0]?.provider_reference || '')).toContain(`${qa!.orgId}/${worker.personId}/`);

  // sessão de trabalho carrega a etapa (WBS)
  const sess = await db.query(
    `select timeline_item_id from project_work_sessions where person_id=$1 and status='running' limit 1`,
    [worker.personId],
  );
  expect(sess.rows[0]?.timeline_item_id).toBe(worker.timelineItemId);
});

test('Isolamento: colaborador comum não lê marcações de outro colaborador (RLS)', async () => {
  const ctx = await pwRequest.newContext();
  // token real do worker (não-privilegiado) via password-grant
  const auth = await ctx.post(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON!, 'Content-Type': 'application/json' },
    data: { email: worker.email, password: worker.password },
  });
  expect(auth.ok(), 'login do worker deve funcionar').toBeTruthy();
  const token = (await auth.json()).access_token as string;
  expect(token).toBeTruthy();

  // tenta ler marcações do usuário qa (OUTRA pessoa) → RLS deve retornar vazio
  const res = await ctx.get(`${SUPA_URL}/rest/v1/attendance_punches?person_id=eq.${qa!.personId}&select=id`, {
    headers: { apikey: ANON!, Authorization: `Bearer ${token}` },
  });
  const rows = res.ok() ? await res.json() : [];
  expect(Array.isArray(rows) ? rows.length : 0, 'RLS deve impedir ler marcações de outra pessoa').toBe(0);

  // menor privilégio (074): a role ponto_field_worker tem ponto_session_use,
  // NÃO timesheet_use → não pode criar lançamento manual de horas (time_entries).
  const te = await ctx.post(`${SUPA_URL}/rest/v1/time_entries`, {
    headers: { apikey: ANON!, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    data: { organization_id: qa!.orgId, person_id: worker.personId, project_id: qa!.projectId, work_date: '2026-07-22', minutes: 60 },
  });
  expect(te.status(), 'colaborador de campo NÃO pode criar time_entries (RLS)').not.toBe(201);
  await ctx.dispose();
});
