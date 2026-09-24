/**
 * E2E — Supply (wave F): menu, torre de controle, planejamento de materiais,
 * catálogo (criação interceptada) e aba Materiais & Supply do projeto.
 * Escritas nunca chegam ao banco.
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

let ctx: BrowserContext; let page: Page; let projectId = '';
const blocked: string[] = []; const intercepted: unknown[] = [];

test.beforeAll(async ({ browser }) => {
  const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect(); await db.query('SET SESSION default_transaction_read_only = on');
  projectId = (await db.query(`SELECT id FROM public.projects WHERE organization_id = $1 ORDER BY id LIMIT 1`, [qa.orgId])).rows[0].id;
  await db.end();
  ctx = await browser.newContext(); page = await ctx.newPage(); page.setDefaultTimeout(30_000);
  await ctx.route('**/api/supply/items', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    intercepted.push(JSON.parse(route.request().postData() ?? '{}'));
    return route.fulfill({ json: { ok: true, itemId: '00000000-0000-4000-8000-00000000f232' } });
  });
  await ctx.route('**/api/**', (route) => {
    if (route.request().method() === 'GET') return route.fallback();
    if (new URL(route.request().url()).pathname === '/api/supply/items') return route.fallback();
    blocked.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.abort();
  });
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(qa.email);
  const pw = page.locator('input[type="password"]'); await pw.fill(qa.password); await pw.press('Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
});
test.afterAll(async () => { await ctx?.close(); });

test('1 · menu Supply Chain e torre de controle com números de fonte', async () => {
  await page.goto('/supply');
  const action = page.locator('[data-sidebar="menu-action"][aria-label$="submenu de Supply Chain"]').first();
  await expect(action).toHaveAttribute('aria-expanded', 'true', { timeout: 60_000 });
  await expect(page.locator('.hud-nav-submenu').getByRole('link', { name: 'Planejamento de Materiais', exact: true })).toBeVisible();
  const overview = page.getByTestId('supply-overview');
  await expect(overview.getByRole('heading', { name: 'O que a execução precisa e ainda não tem' })).toBeVisible();
  for (const k of ['Demanda sem cobertura', 'Faltas críticas', 'Projetos expostos', 'Totalmente cobertos']) {
    await expect(overview.getByText(k, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText(/Esta ação exige:/)).toHaveCount(0);
  mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: `${OUT}/supply-overview.png`, fullPage: true });
});

test('2 · planejamento de materiais: vazio explica o fluxo; catálogo cadastra item (intercepted)', async () => {
  await page.goto('/supply/planejamento-materiais');
  const mp = page.getByTestId('material-planning');
  await expect(mp).toBeVisible({ timeout: 60_000 });
  await expect(mp.getByText(/Nenhuma demanda de material confirmada|Com falta/).first()).toBeVisible();
  await mp.getByRole('tab', { name: 'Catálogo de itens' }).click();
  await mp.getByRole('button', { name: 'Novo item' }).click();
  const form = page.getByTestId('item-form');
  await form.getByLabel('Código').fill('cab-35');
  await form.getByLabel('Unidade').fill('m');
  await form.getByLabel('Descrição').fill('Cabo de cobre 35 mm²');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect.poll(() => intercepted.length).toBe(1);
  expect(intercepted[0]).toMatchObject({ code: 'CAB-35', unit: 'm', description: 'Cabo de cobre 35 mm²', tracking: 'NONE' });
  await page.screenshot({ path: `${OUT}/material-planning.png`, fullPage: true });
});

test('3 · projeto: aba Materiais & Supply lê a MESMA demanda', async () => {
  await page.goto(`/projetos/${encodeURIComponent(projectId)}?tab=supply`);
  const tab = page.getByTestId('project-supply');
  await expect(tab).toBeVisible({ timeout: 60_000 });
  for (const k of ['Materiais requeridos', 'Cobertos', 'Entrando', 'Com falta', 'Risco crítico']) {
    await expect(tab.getByText(k, { exact: true }).first()).toBeVisible();
  }
});

test('4 · nenhuma outra escrita saiu do navegador', async () => { expect(blocked).toEqual([]); });
