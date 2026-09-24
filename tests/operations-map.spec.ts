/**
 * E2E — "Mapa de Operações" é o mapa 3D que já existia (/projetos/operations-3d):
 * o item do menu e o atalho da Visão Geral de Operações levam a ele, e o item
 * fica marcado como a página atual. Só leitura.
 */
import { e2eCredentials } from './support/e2e-credentials';
import { test, expect } from '@playwright/test';

const qa = e2eCredentials();
test.setTimeout(150_000);

async function signIn(page: import('@playwright/test').Page) {
  page.setDefaultTimeout(30_000);
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(qa.email);
  const pw = page.locator('input[type="password"]'); await pw.fill(qa.password); await pw.press('Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
}

test('menu e Visão Geral de Operações levam ao mapa 3D anterior', async ({ page }) => {
  await signIn(page);
  await page.goto('/operacoes');
  await expect(page.getByRole('link', { name: 'Mapa de operações' }).first()).toHaveAttribute('href', '/projetos/operations-3d', { timeout: 60_000 });
  const item = page.locator('.hud-nav-submenu').getByRole('link', { name: 'Mapa de Operações', exact: true });
  await expect(item).toHaveAttribute('href', '/projetos/operations-3d');
  await item.click();
  await page.waitForURL('**/projetos/operations-3d', { timeout: 60_000 });
  await expect(page.getByText('Mapa de Operações').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.hud-nav-submenu').getByRole('link', { name: 'Mapa de Operações', exact: true }))
    .toHaveAttribute('aria-current', 'page');
});

test('o globo continua 3D e o painel é operacional: prioridade, e o projeto por ?project=', async ({ page }) => {
  await signIn(page);
  await page.goto('/projetos/operations-3d');
  const panel = page.getByTestId('map-panel');
  await expect(panel.getByRole('heading', { name: 'Carteira por prioridade' })).toBeVisible({ timeout: 60_000 });
  // O globo é o Cesium (canvas WebGL) — nunca um mapa 2D no lugar.
  await expect(page.locator('.cesium-widget canvas').first()).toBeVisible({ timeout: 60_000 });
  const first = panel.locator('.ax-maplist button').first();
  if (await first.count() === 0) return;
  const name = (await first.locator('strong').textContent())?.trim() ?? '';
  await first.click();
  await expect(page).toHaveURL(/project=/);
  await expect(panel.getByRole('heading', { name })).toBeVisible({ timeout: 60_000 });
  for (const fact of ['Saúde', 'Avanço físico', 'Próximo marco', 'Autorização']) await expect(panel.getByText(fact, { exact: true })).toBeVisible();
  await expect(panel.getByRole('link', { name: /Abrir projeto/ })).toHaveAttribute('href', /\/projetos\//);
  await panel.getByRole('button', { name: /Brasil/ }).click();
  await expect(page).not.toHaveURL(/project=/);
});
