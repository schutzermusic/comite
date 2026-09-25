/**
 * DECISÕES COM ZERO DECISÕES — estado próprio, não erro (QA isolado, build).
 *
 * Três estados distintos: carregando, sucesso com zero, falha real. O zero
 * mostra a Central de Decisões em repouso (abas presentes, contagem, mapa dos
 * domínios); só uma falha de verdade (5xx do /api/decisions) mostra
 * "Não foi possível carregar". 1440 e 390 px, claro e escuro.
 *
 *   npx playwright test -c playwright.qa.config.ts --project=desktop tests/qa-live/decisions-zero.spec.ts
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { authFile, type QaRole } from './support';

const SHOTS = 'test-results/decisions-zero-shots';

async function open(browser: Browser, role: QaRole, viewport: { width: number; height: number }, theme: 'light' | 'dark') {
  const ctx = await browser.newContext({ storageState: authFile(role), viewport, colorScheme: theme, reducedMotion: 'no-preference' });
  await ctx.addInitScript((v) => { try { localStorage.setItem('insight-theme-preference', v); } catch { /* sem armazenamento */ } }, theme);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  return { ctx, page, errors };
}
const noOverflow = (page: Page) => page.evaluate(() => (document.scrollingElement ?? document.documentElement).scrollWidth <= window.innerWidth + 1);

for (const [label, viewport] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${label} px · ${theme}: zero decisões é a Central em repouso, não erro`, async ({ browser }) => {
      const { ctx, page, errors } = await open(browser, 'rh', viewport, theme);
      const api = page.waitForResponse((r) => r.url().includes('/api/decisions?tab=minhas'));
      await page.goto('/decisoes');
      const res = await api;
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.mine).toEqual([]);

      const zero = page.getByTestId('decisions-zero');
      await expect(zero).toBeVisible();
      await expect(zero.getByRole('heading', { name: 'Nenhuma decisão pendente' })).toBeVisible();
      await expect(zero.getByText('Tudo que depende da sua autoridade está resolvido.')).toBeVisible();
      await expect(page.getByText('Não foi possível carregar')).toHaveCount(0);
      await expect(page.getByTestId('decisions-zero-stats')).toHaveText('pendentes0críticas0vencidas0');
      await expect(page.getByTestId('decisions-flow')).toBeVisible();
      // As abas continuam no zero. "Equipe" segue a permissão de visão de equipe (rh não tem), não a contagem.
      for (const tab of ['Minhas', 'Concluídas']) await expect(page.getByRole('tab', { name: new RegExp(tab) })).toBeVisible();
      await expect(page.getByRole('tab', { name: /Equipe/ })).toHaveCount(0);
      expect(await noOverflow(page), 'sem rolagem lateral').toBe(true);
      const svg = await page.getByTestId('decisions-flow').innerHTML();
      expect(svg).not.toMatch(/NaN|Infinity/);
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${SHOTS}/${label}-${theme}.png`, fullPage: true });
      expect(errors).toEqual([]);
      await ctx.close();
    });
  }
}

test('organização sem política nem alçada: o vazio explica a configuração — sem virar falha', async ({ browser }) => {
  const { ctx, page, errors } = await open(browser, 'outsider', { width: 1440, height: 900 }, 'light');
  await page.goto('/decisoes');
  await expect(page.getByTestId('decisions-zero')).toBeVisible();
  await expect(page.getByTestId('decisions-zero-setup')).toContainText('É configuração, não falha');
  // Com visão de equipe, as três abas ficam disponíveis mesmo no zero — e cada uma abre sem erro.
  for (const tab of ['Minhas', 'Equipe', 'Concluídas']) await expect(page.getByRole('tab', { name: new RegExp(tab) })).toBeVisible();
  await page.getByRole('tab', { name: /Equipe/ }).click();
  await expect(page.getByTestId('decisions-tab-equipe')).toBeVisible();
  await page.getByRole('tab', { name: /Concluídas/ }).click();
  await expect(page.getByTestId('decisions-completed')).toBeVisible();
  await expect(page.getByText('Não foi possível carregar')).toHaveCount(0);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('falha REAL da leitura ainda mostra o erro (e não uma caixa vazia)', async ({ browser }) => {
  const { ctx, page } = await open(browser, 'rh', { width: 1440, height: 900 }, 'light');
  await page.route('**/api/decisions?tab=*', (route) => route.fulfill({ status: 500, contentType: 'application/json',
    body: JSON.stringify({ ok: false, error: 'Não foi possível ler a sua caixa de decisões.', code: 'READ_FAILED' }) }));
  await page.goto('/decisoes');
  await expect(page.getByText('Não foi possível carregar')).toBeVisible();
  await expect(page.getByText('Não foi possível ler a sua caixa de decisões.')).toBeVisible();
  await expect(page.getByTestId('decisions-zero')).toHaveCount(0);
  // Decisões não instalada no ambiente: erro honesto, com o motivo.
  await page.unroute('**/api/decisions?tab=*');
  await page.route('**/api/decisions?tab=*', (route) => route.fulfill({ status: 503, contentType: 'application/json',
    body: JSON.stringify({ ok: false, code: 'NOT_PROVISIONED', error: 'Decisões ainda não está instalada neste ambiente (migrations 240+ pendentes). Fale com quem administra a plataforma.' }) }));
  await page.reload();
  await expect(page.getByText('Não foi possível carregar')).toBeVisible();
  await expect(page.getByText(/ainda não está instalada neste ambiente/)).toBeVisible();
  await expect(page.getByTestId('decisions-zero')).toHaveCount(0);
  await ctx.close();
});
