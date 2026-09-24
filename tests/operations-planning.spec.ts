/**
 * E2E — Planejamento (wave D): portfólio e requisitos no Cronograma do projeto.
 *
 * Leituras reais. Escritas NUNCA chegam ao banco: a criação de requisito é
 * INTERCEPTADA (respondida aqui, marcada `intercepted`) só para provar que a
 * tela manda o contrato certo; todo o resto de não-GET é abortado.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });
const qa = JSON.parse(readFileSync('tests/.qa-env.json', 'utf8')) as { email: string; password: string; orgId: string };
const OUT = 'test-results/operations';

test.describe.configure({ mode: 'serial' });
test.setTimeout(150_000);

let ctx: BrowserContext;
let page: Page;
let projectId = '';
const blocked: string[] = [];
const intercepted: Array<Record<string, unknown>> = [];

test.beforeAll(async ({ browser }) => {
  const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  await db.query('SET SESSION default_transaction_read_only = on');
  projectId = (await db.query(`SELECT p.id FROM public.projects p WHERE p.organization_id = $1
    ORDER BY (SELECT count(*) FROM public.project_timeline_items t WHERE t.project_id = p.id) DESC, p.id LIMIT 1`, [qa.orgId])).rows[0].id;
  await db.end();

  ctx = await browser.newContext();
  page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  await ctx.route('**/api/operations/requirements', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    intercepted.push(JSON.parse(route.request().postData() ?? '{}'));
    return route.fulfill({ json: { ok: true, requirementId: '00000000-0000-4000-8000-00000000d231' } });
  });
  for (const pattern of ['**/api/operations/**', '**/api/commercial/**', '**/api/projects/**']) {
    await ctx.route(pattern, (route) => {
      if (route.request().method() === 'GET') return route.fallback();
      if (new URL(route.request().url()).pathname === '/api/operations/requirements') return route.fallback();
      blocked.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      return route.abort();
    });
  }
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(qa.email);
  const password = page.locator('input[type="password"]');
  await password.fill(qa.password);
  await password.press('Enter');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 });
});

test.afterAll(async () => { await ctx?.close(); });

test('1 · Planejamento do portfólio: exceções, prontidão e necessidades por data', async () => {
  await page.goto('/operacoes/planejamento');
  await expect(page.getByRole('heading', { name: 'O que a execução precisa, e quando' })).toBeVisible({ timeout: 60_000 });
  for (const t of ['Confirmados', 'A confirmar', 'Material sem cobertura', 'Vencidos']) {
    await expect(page.getByText(t, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText('Exceções de plano').first()).toBeVisible();
  await expect(page.getByText('Prontidão por projeto').first()).toBeVisible();
  await expect(page.locator('.hud-nav-submenu').getByRole('link', { name: 'Planejamento', exact: true })).toBeVisible();
  await expect(page.getByText(/Esta ação exige:/)).toHaveCount(0);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/planning-portfolio.png`, fullPage: true });
});

test('2 · requisitos no Cronograma / Planejamento do projeto; criar manda o contrato certo (intercepted)', async () => {
  await page.goto(`/projetos/${encodeURIComponent(projectId)}?tab=timeline`);
  const panel = page.getByTestId('project-requirements');
  await expect(panel).toBeVisible({ timeout: 60_000 });
  await panel.getByRole('button', { name: 'Novo requisito' }).click();
  const form = page.getByTestId('requirement-form');
  await expect(form).toBeVisible();
  await form.getByLabel('Título').fill('Cabo 35 mm');
  await form.getByLabel('Quantidade').fill('1000');
  await form.getByLabel('Unidade').fill('m');
  await form.getByLabel('Necessário em').fill('2026-11-18');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect.poll(() => intercepted.length).toBe(1);
  expect(intercepted[0]).toMatchObject({ projectId, requirementType: 'MATERIAL', title: 'Cabo 35 mm', quantity: 1000,
    unit: 'm', requiredBy: '2026-11-18', priority: 'medium' });
  await page.screenshot({ path: `${OUT}/project-requirements.png`, fullPage: true });
});

test('3 · nenhuma outra escrita saiu do navegador', async () => {
  expect(blocked).toEqual([]);
});
