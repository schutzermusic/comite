/**
 * E2E — Convite → ativação → login do colaborador.
 *
 * Usa a arquitetura NATIVA do Supabase Auth: o "envio" do convite é o
 * generateLink(type:'invite') (o mesmo que o produto chama); o "recebimento"
 * (test email capture) captura o email_otp e o troca por uma sessão via
 * /auth/v1/verify, entregue no hash de /ponto/ativar — evitando depender da
 * allowlist de redirect. Nenhum token/senha é logado.
 *
 * Cobre: link de ativação abre → cria+confirma senha → conta ativa (e-mail
 * confirmado) → colaborador entra no portal de Ponto.
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
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ready = existsSync(QA_PATH) && !!SUPA_URL && !!SERVICE && !!ANON && !!process.env.SUPABASE_DB_URL;
const qa = existsSync(QA_PATH) ? (JSON.parse(readFileSync(QA_PATH, 'utf8')) as { orgId: string; projectId: string }) : null;

test.skip(!ready, 'requer .qa-env.json + chaves Supabase + SUPABASE_DB_URL');
test.setTimeout(120_000);

const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const svc = createClient(SUPA_URL || '', SERVICE || '', { auth: { persistSession: false } });
const emp = { email: '', newPassword: 'Ativa!Ponto2026', userId: '', profileId: '', personId: '', otp: '' };

test.beforeAll(async () => {
  if (!ready || !qa) return;
  await db.connect();
  const tag = randomUUID().slice(0, 8);
  emp.email = `qa.invite.${tag}@example.test`;

  // "admin envia convite" — generateLink (mesma API que o produto usa)
  const redirectTo = 'http://localhost:9002/ponto/ativar';
  const { data, error } = await svc.auth.admin.generateLink({ type: 'invite', email: emp.email, options: { redirectTo, data: { full_name: 'QA Convidado', workspace_name: 'Insight Ponto' } } });
  if (error || !data?.user) throw new Error(`generateLink: ${error?.message}`);
  emp.userId = data.user.id;
  emp.otp = (data.properties?.email_otp as string) || '';
  expect(emp.otp, 'convite deve gerar OTP (email capture)').toBeTruthy();

  // linkagem que o produto (sendActivation) faz: profile ↔ person ↔ role
  const prof = await db.query(
    `insert into profiles (user_id, organization_id, full_name, status) values ($1,$2,'QA Convidado','active')
     on conflict (user_id) do update set organization_id=excluded.organization_id returning id`,
    [emp.userId, qa.orgId],
  );
  emp.profileId = prof.rows[0].id;
  const per = await db.query(
    `insert into people (organization_id, full_name, email, status, source, profile_id, access_invited_at)
     values ($1,'QA Convidado',$2,'active','manual',$3, now()) returning id`,
    [qa.orgId, emp.email, emp.profileId],
  );
  emp.personId = per.rows[0].id;
  await db.query(
    `insert into user_roles (user_id, role_id, organization_id) select $1, r.id, $2 from roles r where r.key='ponto_field_worker' and r.organization_id is null on conflict do nothing`,
    [emp.userId, qa.orgId],
  );
  await db.query(
    `insert into project_allocations (organization_id, person_id, project_id, role_title, allocation_type, start_date, planned_percentage, status, source, requires_ponto)
     values ($1,$2,$3,'QA Convidado','billable', current_date - 1, 50, 'active','manual', true)`,
    [qa.orgId, emp.personId, qa.projectId],
  );
});

test.afterAll(async () => {
  if (!ready) return;
  const safe = async (sql: string, p: unknown[]) => { try { await db.query(sql, p); } catch { /* ignora */ } };
  await safe('delete from project_allocations where person_id=$1', [emp.personId]);
  await safe('delete from people where id=$1', [emp.personId]);
  await safe('delete from profiles where id=$1', [emp.profileId]);
  try { await fetch(`${SUPA_URL}/auth/v1/admin/users/${emp.userId}`, { method: 'DELETE', headers: { apikey: SERVICE!, Authorization: `Bearer ${SERVICE}` } }); } catch { /* ignora */ }
  await db.end();
});

test('Convite → ativação (senha) → conta ativa → login no Ponto', async ({ page, context }) => {
  // "email capture": troca o OTP do convite por uma sessão (sem redirect ext.)
  const verify = await fetch(`${SUPA_URL}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: ANON!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'invite', token: emp.otp, email: emp.email }),
  });
  expect(verify.ok, 'verify do convite deve funcionar').toBeTruthy();
  const vj = await verify.json();
  expect(vj.access_token && vj.refresh_token, 'convite deve render sessão').toBeTruthy();

  // entrega os tokens no hash da página de ativação (fluxo suportado por /ponto/ativar)
  await page.goto(`/ponto/ativar#access_token=${vj.access_token}&refresh_token=${vj.refresh_token}&type=invite`);

  // confirma dados + cria senha + aceita termos + ativa
  await expect(page.getByText('Ativar seu acesso')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(emp.email)).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Criar senha').fill(emp.newPassword);
  await page.getByLabel('Confirmar senha').fill(emp.newPassword);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /Ativar e entrar no Ponto/ }).click();

  // entra direto no portal de Ponto
  await page.waitForURL('**/ponto', { timeout: 30_000 });
  await expect(page.getByText(/Olá,/)).toBeVisible({ timeout: 15_000 });

  // conta ativa: e-mail confirmado no auth
  const { data: got } = await svc.auth.admin.getUserById(emp.userId);
  expect(got.user?.email_confirmed_at, 'conta deve estar ativa (e-mail confirmado)').toBeTruthy();

  // login independente com a nova senha (logout + relogin)
  await context.clearCookies();
  await page.goto('/ponto/login');
  await page.getByPlaceholder('E-mail').fill(emp.email);
  await page.getByPlaceholder('Senha').fill(emp.newPassword);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/ponto', { timeout: 30_000 });
  await expect(page.getByText(/Olá,/)).toBeVisible();
});
