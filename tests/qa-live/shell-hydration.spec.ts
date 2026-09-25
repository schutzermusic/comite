/**
 * O SHELL HIDRATA SEM DESCOMPASSO (QA isolado, build de produção).
 *
 * Antes: o `SidebarShell` renderizava a sidebar ABERTA no servidor e, depois
 * de montar, trocava para a preferência do localStorage (ou "recolhida" no
 * /dashboard). A `AppSidebar` hidrata depois, dentro de um Suspense — e
 * hidratava com o estado já trocado contra o HTML antigo: React #418 em todo
 * /dashboard. Agora a preferência mora num cookie que o layout do servidor
 * lê: HTML e hidratação saem no mesmo estado, sem troca depois de montar.
 *
 *   npx playwright test -c playwright.qa.config.ts --project=desktop tests/qa-live/shell-hydration.spec.ts
 */
import { expect, test, type Page } from '@playwright/test';
import { APP_URL, authFile } from './support';

test.use({ storageState: authFile('owner') });

const COOKIE = 'ig-sidebar-open';
const hydrationErrors = (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => { if (/hydrat|#418|#423|#425/i.test(e.message)) errors.push(e.message.slice(0, 300)); });
  return errors;
};
const sidebarState = (page: Page) => page.locator('[data-collapsible][data-state]').first();
const settle = (page: Page) => page.waitForLoadState('networkidle').then(() => page.waitForTimeout(1500));

for (const [path, pref, expected] of [
  ['/dashboard', null, 'collapsed'],
  ['/dashboard', 'true', 'expanded'],
  ['/supply', null, 'expanded'],
  ['/supply', 'false', 'collapsed'],
] as const) {
  test(`${path} com preferência ${pref ?? 'nenhuma'}: HTML e hidratação no mesmo estado (${expected})`, async ({ page, context }) => {
    await context.clearCookies({ name: COOKIE });
    if (pref) await context.addCookies([{ name: COOKIE, value: pref, url: APP_URL }]);
    const errors = hydrationErrors(page);
    // O HTML do servidor já sai no estado final.
    const html = await (await page.request.get(path)).text();
    expect(html).toMatch(new RegExp(`data-state="${expected}"[^>]*data-collapsible`));
    await page.goto(path);
    await settle(page);
    await expect(sidebarState(page)).toHaveAttribute('data-state', expected);
    expect(errors).toEqual([]);
  });
}

test('recolher persiste no cookie e a próxima carga sai recolhida, sem descompasso', async ({ page, context }) => {
  await context.clearCookies({ name: COOKIE });
  const errors = hydrationErrors(page);
  await page.goto('/supply');
  await settle(page);
  await expect(sidebarState(page)).toHaveAttribute('data-state', 'expanded');
  await page.getByRole('button', { name: 'Recolher menu' }).click();
  await expect(sidebarState(page)).toHaveAttribute('data-state', 'collapsed');
  expect((await context.cookies()).find((c) => c.name === COOKIE)?.value).toBe('false');
  await page.reload();
  await settle(page);
  await expect(sidebarState(page)).toHaveAttribute('data-state', 'collapsed');
  expect(errors).toEqual([]);
});

test('preferência antiga do localStorage migra para o cookie sem trocar o estado depois de montar', async ({ page, context }) => {
  await context.clearCookies({ name: COOKIE });
  await page.addInitScript(() => { try { localStorage.setItem('ig-sidebar-open', 'false'); } catch { /* sem armazenamento */ } });
  const errors = hydrationErrors(page);
  await page.goto('/supply');
  await settle(page);
  // Nesta carga, o estado do HTML (padrão da rota) — a troca viria depois de montar.
  await expect(sidebarState(page)).toHaveAttribute('data-state', 'expanded');
  expect((await context.cookies()).find((c) => c.name === COOKIE)?.value).toBe('false');
  await page.reload();
  await settle(page);
  await expect(sidebarState(page)).toHaveAttribute('data-state', 'collapsed');
  expect(errors).toEqual([]);
});

test.describe('390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('/dashboard no celular: sem descompasso de hidratação', async ({ page }) => {
    const errors = hydrationErrors(page);
    await page.goto('/dashboard');
    await settle(page);
    expect(errors).toEqual([]);
  });
});
