/**
 * FOLHA · ENVIO NA TELA (QA isolado, build de produção): no modo real não há
 * campo de endereço livre — só a lista que o servidor dá (membros ativos e
 * contatos autorizados), cada um como Para/Cc. Autorizar contato é só de quem
 * administra a folha. 1440 e 390 px, claro e escuro, sem erro de runtime.
 *
 *   npx playwright test -c playwright.qa.config.ts --project=desktop tests/qa-live/payroll-email-ui.spec.ts
 */
import { expect, test, type Browser } from '@playwright/test';
import { apiAs, authFile, qaLive, tag, type QaRole } from './support';

const T = tag();
let contactId: string;

async function open(browser: Browser, role: QaRole, viewport: { width: number; height: number }, theme: 'light' | 'dark') {
  const ctx = await browser.newContext({ storageState: authFile(role), viewport, colorScheme: theme });
  await ctx.addInitScript((v) => { try { localStorage.setItem('insight-theme-preference', v); } catch { /* sem armazenamento */ } }, theme);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto('/workforce-cost/fechamento-folha');
  await page.getByRole('button', { name: /Envio/ }).first().click();
  return { ctx, page, errors };
}

test.beforeAll(async () => {
  const res = await (await apiAs('owner')).post('/api/payroll/email/contacts', { data: { email: `ui.${T.toLowerCase()}@example.test`, display_name: `Contabilidade UI ${T}` } });
  expect(res.status(), await res.text()).toBe(201);
  contactId = (await res.json()).contact.id;
});
test.afterAll(async () => { await (await apiAs('owner')).delete(`/api/payroll/email/contacts?id=${contactId}`); });

for (const [label, viewport] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${label} px · ${theme}: escolha governada, sem endereço livre, sem erro`, async ({ browser }) => {
      const { ctx, page, errors } = await open(browser, 'rh', viewport, theme);
      const picker = page.getByTestId('payroll-recipient-picker');
      await expect(picker).toBeVisible({ timeout: 30_000 });
      await expect(page.getByPlaceholder('diretoria@empresa.com, financeiro@empresa.com')).toHaveCount(0);
      const contact = picker.locator(`[data-testid="payroll-recipient"][data-key="contact:${contactId}"]`);
      await expect(contact).toBeVisible();
      await expect(picker.locator(`[data-key="member:${qaLive().users.financeiro.id}"]`)).toBeVisible();
      await expect(picker.locator(`[data-key="member:${qaLive().users.outsider.id}"]`)).toHaveCount(0);
      await contact.getByRole('radio', { name: 'Para' }).click();
      await expect(contact.getByRole('radio', { name: 'Para' })).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByTestId('payroll-contact-form'), 'rh envia, não autoriza contato').toHaveCount(0);
      const overflow = await page.evaluate(() => (document.scrollingElement ?? document.documentElement).scrollWidth > window.innerWidth + 1);
      expect(overflow, 'sem rolagem lateral').toBe(false);
      await page.screenshot({ path: `test-results/payroll-email-shots/${label}-${theme}.png` });
      expect(errors).toEqual([]);
      await ctx.close();
    });
  }
}

test('quem administra a folha autoriza contato na própria tela', async ({ browser }) => {
  const { ctx, page, errors } = await open(browser, 'owner', { width: 1440, height: 900 }, 'light');
  await expect(page.getByTestId('payroll-contact-form')).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
  await ctx.close();
});
