/**
 * REGRESSÃO — a aba Timeline não pode entrar em laço de fetch/render.
 *
 * Bug real (25/08/2026): `usePermissions()` devolve um `hasPermission` novo a
 * cada render; ele estava na lista de dependências de `reloadExecution`, então
 * o efeito que o chama disparava a cada render e cada disparo fazia setState.
 * Medido em produção: 1510 requisições em 10 s de tela parada. Depois da
 * correção: 0.
 *
 * O sintoma aparecia quando o painel de exceções surgia, porque é aí que a
 * segunda fase de carga completa e a cascata vira contínua.
 */

import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' }); dotenv.config({ path: '.env.local' });
const qa = JSON.parse(readFileSync('tests/.qa-env.json','utf8')) as {email:string;password:string};

test('a aba Timeline estabiliza: sem laço de fetch', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  const page: Page = await ctx.newPage();

  let supabaseCalls = 0;
  page.on('request', (r) => { if (/supabase|rest\/v1/.test(r.url())) supabaseCalls += 1; });

  await page.goto('/login');
  await page.locator('input[type="email"]').fill(qa.email);
  await page.locator('input[type="password"]').fill(qa.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });

  await page.goto('/projetos/proj-001?tab=timeline');
  await expect(page.getByRole('grid', { name: 'Cronograma do projeto' })).toBeVisible({ timeout: 45_000 });
  // Espera o painel de exceções — o momento em que o bug aparecia.
  await expect(page.getByText(/requerem sua decisão|Nenhuma exceção/)).toBeVisible({ timeout: 60_000 });

  await page.waitForTimeout(6000);
  const afterSettle = supabaseCalls;
  await page.waitForTimeout(10000);
  const delta = supabaseCalls - afterSettle;

  console.log(`LOOPCHECK total=${supabaseCalls} delta10s=${delta}`);
  // Em repouso, a tela não deve continuar disparando requisições.
  expect(delta, `requisicoes continuam apos estabilizar (delta=${delta})`).toBeLessThan(10);
  await ctx.close();
});
