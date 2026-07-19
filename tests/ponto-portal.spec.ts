/**
 * E2E — Portal de Ponto Web (/ponto) com Face ID (WebAuthn) e etapa do
 * cronograma. Usa um autenticador virtual (CDP) para simular Face ID/
 * Touch ID. Pré: seed (scripts/qa-seed-workforce.mjs) + servidor 9002.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const qa = JSON.parse(readFileSync('tests/.qa-env.json', 'utf8')) as {
  email: string;
  password: string;
  projectId: string;
  personId: string;
  orgId: string;
};

const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
let timelineItemId: string;

test.beforeAll(async () => {
  await db.connect();
  // alocação ativa + 1 etapa de cronograma para exercitar atividade/etapa
  await db.query(
    `insert into project_allocations (organization_id, person_id, project_id, role_title, allocation_type, start_date, planned_percentage, status, source)
     values ($1,$2,$3,'QA Portal','billable', current_date - 1, 50, 'active','manual')
     on conflict do nothing`,
    [qa.orgId, qa.personId, qa.projectId],
  );
  const r = await db.query(
    `insert into project_timeline_items (organization_id, project_id, wbs_code, title, type, status, percent_complete, row_order)
     values ($1,$2,'1.1','QA — Montagem eletromecânica','task','in_progress',40,1)
     returning id`,
    [qa.orgId, qa.projectId],
  );
  timelineItemId = r.rows[0].id;
});

test.afterAll(async () => {
  await db.query('delete from project_work_sessions where person_id=$1', [qa.personId]);
  await db.query('delete from project_timeline_items where id=$1', [timelineItemId]);
  await db.query('delete from project_allocations where person_id=$1', [qa.personId]);
  await db.query('delete from webauthn_credentials where person_id=$1', [qa.personId]);
  await db.end();
});

test.setTimeout(120_000);

test('Face ID + etapa do cronograma no portal', async ({ page, context }) => {
  // autenticador virtual de plataforma (Face ID/Touch ID), UV automática
  const client = await context.newCDPSession(page);
  await client.send('WebAuthn.enable');
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  // login
  await page.goto('/ponto/login');
  await page.getByPlaceholder('E-mail').fill(qa.email);
  await page.getByPlaceholder('Senha').fill(qa.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/ponto', { timeout: 30_000 });
  await expect(page.getByText(/Olá,/)).toBeVisible();

  // 1º toque em Registrar entrada → precisa cadastrar biometria
  await page.getByRole('button', { name: /Registrar entrada/ }).click();
  await expect(page.getByRole('button', { name: /Cadastrar Face ID/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /Cadastrar Face ID/ }).click();
  await expect(page.getByText(/Biometria cadastrada/)).toBeVisible({ timeout: 15_000 });

  // agora bate o ponto (verifica biometria no servidor + registra)
  await page.getByRole('button', { name: /Registrar entrada/ }).click();
  await expect(page.getByText(/Ponto registrado/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Entrada', { exact: true })).toBeVisible();

  // a marcação tem evidência biométrica verificada (enhanced)
  const ev = await db.query(
    `select ae.method, ae.assurance_level
       from attendance_punches ap
       join authentication_evidence ae on ae.id = ap.authentication_evidence_id
      where ap.person_id=$1 order by ap.nsr desc limit 1`,
    [qa.personId],
  );
  expect(ev.rows[0]?.method).toBe('device_biometric');
  expect(ev.rows[0]?.assurance_level).toBe('enhanced');

  // atividade: abrir etapas do projeto e iniciar na etapa do cronograma
  await page.getByRole('button', { name: /QA Portal/ }).click();
  await expect(page.getByText('Etapa do cronograma')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Montagem eletromecânica/)).toBeVisible();
  await page.getByRole('button', { name: /Montagem eletromecânica/ }).click();
  await expect(page.getByText('Em andamento')).toBeVisible({ timeout: 15_000 });

  // a sessão foi criada com a etapa (timeline_item_id)
  const sess = await db.query(
    `select timeline_item_id from project_work_sessions where person_id=$1 and status='running' limit 1`,
    [qa.personId],
  );
  expect(sess.rows[0]?.timeline_item_id).toBe(timelineItemId);
});
