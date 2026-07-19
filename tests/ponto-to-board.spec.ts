/**
 * E2E de integração ponta a ponta — do Face ID no Portal de Ponto até os
 * dados no Insight Apex Board:
 *   1. Colaborador (portal /ponto): Face ID → bate ponto → inicia/encerra
 *      atividade numa etapa do cronograma.
 *   2. Board (mesmo usuário, é gestor/admin):
 *      a) Projeto → aba Apontamentos: consolida/envia → apontamento aprovado
 *         aparece, ligado à etapa (project_work_sessions → time_entries).
 *      b) Pessoas & Custos → Jornada: a marcação do ponto aparece.
 *   3. Confere no banco: NSR + evidência biométrica enhanced; apontamento
 *      aprovado com timeline_item_id; sessão consolidada.
 *
 * Pré: scripts/qa-seed-workforce.mjs + servidor em :9002.
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
  personName: string;
  orgId: string;
};

const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
let timelineItemId: string;

test.beforeAll(async () => {
  await db.connect();
  await db.query(
    `insert into project_allocations (organization_id, person_id, project_id, role_title, allocation_type, start_date, planned_percentage, status, source)
     values ($1,$2,$3,'Integração E2E','billable', current_date - 1, 50, 'active','manual') on conflict do nothing`,
    [qa.orgId, qa.personId, qa.projectId],
  );
  const r = await db.query(
    `insert into project_timeline_items (organization_id, project_id, wbs_code, title, type, status, percent_complete, row_order)
     values ($1,$2,'2.3','E2E — Comissionamento de subestação','task','in_progress',30,1) returning id`,
    [qa.orgId, qa.projectId],
  );
  timelineItemId = r.rows[0].id;
});

test.afterAll(async () => {
  await db.query('delete from time_entries where person_id=$1', [qa.personId]);
  await db.query('delete from project_work_sessions where person_id=$1', [qa.personId]);
  await db.query('delete from project_timeline_items where id=$1', [timelineItemId]);
  await db.query('delete from project_allocations where person_id=$1', [qa.personId]);
  await db.query('delete from webauthn_credentials where person_id=$1', [qa.personId]);
  await db.end();
});

test.setTimeout(180_000);

test('portal (Face ID) → apontamento no board → Jornada em Pessoas & Custos', async ({ page, context }) => {
  // ── autenticador virtual de plataforma (Face ID/Touch ID) ──
  const client = await context.newCDPSession(page);
  await client.send('WebAuthn.enable');
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });

  await test.step('portal: entrada com Face ID + projeto/etapa', async () => {
    await page.goto('/ponto/login');
    await page.getByPlaceholder('E-mail').fill(qa.email);
    await page.getByPlaceholder('Senha').fill(qa.password);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL('**/ponto', { timeout: 30_000 });

    // entrada abre a folha; escolhe etapa; 1ª confirmação pede cadastro de biometria
    await page.getByRole('button', { name: /escolher projeto/ }).click();
    await expect(page.getByText('Onde você vai trabalhar?')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /Comissionamento de subestação/ }).click();
    await page.getByRole('button', { name: /Registrar entrada · Integração E2E/ }).click();
    await page.getByRole('button', { name: /Cadastrar Face ID/ }).click();
    await expect(page.getByText(/Biometria cadastrada/)).toBeVisible({ timeout: 15_000 });

    // reabre e confirma: entrada + apontamento na etapa iniciam juntos
    await page.getByRole('button', { name: /escolher projeto/ }).click();
    await page.getByRole('button', { name: /Comissionamento de subestação/ }).click();
    await page.getByRole('button', { name: /Registrar entrada · Integração E2E/ }).click();
    await expect(page.getByText(/registrad/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Atividade em andamento')).toBeVisible({ timeout: 15_000 });
  });

  await test.step('portal: encerrar atividade (gera sessão consolidável)', async () => {
    await page.waitForTimeout(3000);
    await page.getByRole('button', { name: /Encerrar atividade/ }).click();
    await expect(page.getByText('Atividade em andamento')).toHaveCount(0, { timeout: 15_000 });
  });

  await test.step('board: Projeto → Apontamentos → consolidar e enviar', async () => {
    await page.goto(`/projetos/${qa.projectId}?tab=timesheet`);
    await expect(page.getByText('Meu apontamento')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Consolidar e enviar' }).click();
    await expect(page.getByText(/Apontamentos enviados/)).toBeVisible({ timeout: 25_000 });
    // apontamento aprovado aparece nos registros do mês
    await expect(page.getByText(/Aprovado/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(qa.personName).first()).toBeVisible();
  });

  await test.step('board: Pessoas & Custos → Jornada mostra a marcação', async () => {
    await page.goto('/workforce-cost/jornada');
    await expect(page.getByText('Jornadas diárias')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(qa.personName).first()).toBeVisible({ timeout: 20_000 });
  });

  await test.step('banco: marcação biométrica + apontamento aprovado com etapa', async () => {
    const punch = await db.query(
      `select ap.nsr, ae.method, ae.assurance_level
         from attendance_punches ap join authentication_evidence ae on ae.id=ap.authentication_evidence_id
        where ap.person_id=$1 order by ap.nsr desc limit 1`,
      [qa.personId],
    );
    expect(Number(punch.rows[0]?.nsr)).toBeGreaterThan(0);
    expect(punch.rows[0]?.method).toBe('device_biometric');
    expect(punch.rows[0]?.assurance_level).toBe('enhanced');

    const entry = await db.query(
      `select status, timeline_item_id, project_id, auto_approved from time_entries where person_id=$1 order by created_at desc limit 1`,
      [qa.personId],
    );
    expect(entry.rows[0]?.project_id).toBe(qa.projectId);
    expect(entry.rows[0]?.timeline_item_id).toBe(timelineItemId);
    expect(['approved', 'submitted']).toContain(entry.rows[0]?.status);

    const sess = await db.query(
      `select status from project_work_sessions where person_id=$1 order by created_at desc limit 1`,
      [qa.personId],
    );
    expect(sess.rows[0]?.status).toBe('consolidated');
  });
});
