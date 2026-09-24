/**
 * E2E — Mapa de Operações (wave E). Somente leitura; fotos em test-results/operations.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

const qa = JSON.parse(readFileSync('tests/.qa-env.json', 'utf8')) as { email: string; password: string };
test.setTimeout(150_000);

async function signIn(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(qa.email);
  const password = page.locator('input[type="password"]');
  await password.fill(qa.password);
  await password.press('Enter');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 });
}

test('mapa com painel sincronizado: selecionar projeto mostra status, alertas e o caminho ao workspace', async ({ page }) => {
  const writes: string[] = [];
  const consoleErrors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 300)}`));
  await page.route('**/api/**', (route) => {
    if (route.request().method() === 'GET') return route.continue();
    writes.push(route.request().url());
    return route.abort();
  });
  await signIn(page);
  await page.goto('/operacoes/mapa');
  const map = page.getByTestId('operations-map');
  await expect(map.getByRole('heading', { name: 'Onde a operação está, e o que trava cada frente' })).toBeVisible({ timeout: 60_000 });
  await expect(map.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await expect(map.getByLabel('Legenda')).toContainText('Crítico');
  const list = map.getByRole('list', { name: 'Projetos' });
  await map.getByRole('group', { name: 'Recorte' }).getByRole('button', { name: 'Todos' }).click();
  const first = list.getByRole('button').first();
  await expect(first).toBeVisible();
  await first.click();
  const selected = map.getByTestId('map-selected');
  await expect(selected).toBeVisible();
  await expect(selected.getByRole('link')).toHaveAttribute('href', /\/projetos\//);
  await expect(page.getByText(/Esta ação exige:|Não foi possível montar/)).toHaveCount(0);
  mkdirSync('test-results/operations', { recursive: true });
  await page.waitForTimeout(2500); // tiles do basemap
  await page.screenshot({ path: 'test-results/operations/operations-map.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(map.locator('canvas').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: 'test-results/operations/operations-map-390.png', fullPage: true });
  expect(writes).toEqual([]);
  // Nenhum erro de runtime da página (o deck.gl intercalado não abre um segundo contexto WebGL).
  expect(consoleErrors.filter((e) => e.startsWith('pageerror'))).toEqual([]);
});
