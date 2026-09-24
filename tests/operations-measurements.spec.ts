/**
 * E2E — Operações: Medições & Evidências (fila do portfólio).
 *
 * Só leitura: a fila é um RECORTE da medição canônica — nenhuma escrita parte
 * desta tela. Toda requisição não-GET a /api é abortada e registrada, e o
 * último teste prova que nenhuma saiu.
 *
 *   QA_APP_URL=http://localhost:9103 npx playwright test -c playwright.e2e-qa.config.ts tests/operations-measurements.spec.ts
 */
import { e2eCredentials } from './support/e2e-credentials';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';

const qa = e2eCredentials();
test.describe.configure({ mode: 'serial' });
test.setTimeout(150_000);

let ctx: BrowserContext;
let page: Page;
const writes: string[] = [];

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext();
  page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  await ctx.route('**/api/**', (route) => {
    if (route.request().method() === 'GET') return route.fallback();
    writes.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.abort();
  });
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(qa.email);
  const password = page.locator('input[type="password"]');
  await password.fill(qa.password);
  await password.press('Enter');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 });
});

test.afterAll(async () => { await ctx?.close(); });

test('1 · o caminho da medição: raias com dono, fila por próximo passo', async () => {
  await page.goto('/operacoes/medicoes');
  await expect(page.getByRole('heading', { name: 'Da evidência ao faturamento' })).toBeVisible({ timeout: 60_000 });
  const flow = page.getByRole('navigation', { name: 'Raias da medição' });
  for (const lane of ['Preparar evidência', 'Devolvida para correção', 'Em análise interna', 'Aprovada — enviar ao cliente',
    'Aguardando aceite do cliente', 'Aceita — elegível a faturamento']) {
    await expect(flow.getByText(lane, { exact: true })).toBeVisible();
  }
  const list = page.getByTestId('measurements-list');
  const rows = list.getByTestId('measurement-row');
  if (await rows.count() === 0) {
    await expect(list.getByText(/Nenhuma medição/)).toBeVisible();
    return;
  }
  // Cada linha diz o próximo passo e de quem ele é; a ação leva à bancada do projeto.
  await expect(rows.first().getByText(/próximo passo:/)).toBeVisible();
  await expect(rows.first().getByRole('link').first()).toHaveAttribute('href', /\/projetos\/.+tab=measurements/);
});

test('2 · a raia vira recorte na URL, e "enviar ao cliente" não se confunde com aceite', async () => {
  const flow = page.getByRole('navigation', { name: 'Raias da medição' });
  await flow.getByRole('button', { name: /Aprovada — enviar ao cliente/ }).click();
  await expect(page).toHaveURL(/lane=SEND_TO_CUSTOMER/);
  const rows = page.getByTestId('measurements-list').getByTestId('measurement-row');
  for (const row of await rows.all()) await expect(row).toContainText('ainda não é aceite');
  await page.getByRole('group', { name: 'Filtrar fila' }).getByRole('button', { name: /^Todas/ }).click();
  await expect(page).not.toHaveURL(/lane=/);
});

test('3 · celular: sem rolagem horizontal', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/operacoes/medicoes');
  await expect(page.getByRole('heading', { name: 'Da evidência ao faturamento' })).toBeVisible({ timeout: 60_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('4 · nenhuma escrita partiu da fila', async () => {
  expect(writes).toEqual([]);
});
