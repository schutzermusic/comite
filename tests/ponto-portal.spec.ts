/**
 * E2E — Portal de Ponto Web (/ponto): login do colaborador, registrar
 * entrada e ver a marcação na jornada de hoje. Reusa o usuário QA do
 * seed (scripts/qa-seed-workforce.mjs) e o backend /api/mobile/*.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const qa = JSON.parse(readFileSync('tests/.qa-env.json', 'utf8')) as {
  email: string;
  password: string;
};

test.setTimeout(120_000);

test('colaborador bate ponto pelo navegador', async ({ page }) => {
  // login simplificado
  await page.goto('/ponto/login');
  await expect(page.getByText('Registre sua jornada pelo navegador')).toBeVisible();
  await page.getByPlaceholder('E-mail').fill(qa.email);
  await page.getByPlaceholder('Senha').fill(qa.password);
  await page.getByRole('button', { name: 'Entrar' }).click();

  // home do portal
  await page.waitForURL('**/ponto', { timeout: 30_000 });
  await expect(page.getByText(/Olá,/)).toBeVisible();
  await expect(page.getByText('Jornada de hoje')).toBeVisible();

  // registrar entrada (sem geolocalização no headless → aviso, mas registra)
  await page.getByRole('button', { name: 'Registrar entrada' }).click();
  await expect(page.getByText(/Ponto registrado/)).toBeVisible({ timeout: 20_000 });

  // a marcação aparece na jornada e os próximos botões mudam
  await expect(page.getByText('Entrada', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Registrar saída' })).toBeVisible();

  // login autenticado redireciona direto para /ponto
  await page.goto('/ponto/login');
  await page.waitForURL('**/ponto');
});
