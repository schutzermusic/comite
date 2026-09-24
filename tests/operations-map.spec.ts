/**
 * E2E — "Mapa de Operações" é o mapa 3D que já existia (/projetos/operations-3d):
 * o item do menu e o atalho da Visão Geral de Operações levam a ele, e o item
 * fica marcado como a página atual. Só leitura.
 */
import { e2eCredentials } from './support/e2e-credentials';
import { test, expect } from '@playwright/test';

const qa = e2eCredentials();
test.setTimeout(150_000);

test('menu e Visão Geral de Operações levam ao mapa 3D anterior', async ({ page }) => {
  page.setDefaultTimeout(30_000);
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(qa.email);
  const pw = page.locator('input[type="password"]'); await pw.fill(qa.password); await pw.press('Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });

  await page.goto('/operacoes');
  await expect(page.getByRole('link', { name: 'Abrir mapa' })).toHaveAttribute('href', '/projetos/operations-3d', { timeout: 60_000 });
  const item = page.locator('.hud-nav-submenu').getByRole('link', { name: 'Mapa de Operações', exact: true });
  await expect(item).toHaveAttribute('href', '/projetos/operations-3d');
  await item.click();
  await page.waitForURL('**/projetos/operations-3d', { timeout: 60_000 });
  await expect(page.getByText('Mapa de Operações').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.hud-nav-submenu').getByRole('link', { name: 'Mapa de Operações', exact: true }))
    .toHaveAttribute('aria-current', 'page');
});
