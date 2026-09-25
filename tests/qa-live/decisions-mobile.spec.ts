/**
 * DECISÕES NO CELULAR, COM ESCRITA REAL (QA isolado, 390 px, toque).
 *
 * A diretora abre o Apex no telefone só para decidir: a caixa sem rolagem
 * horizontal, o valor legível, o botão "Analisar" com alvo de toque ≥ 44 px,
 * o detalhe em tela cheia com os atos FIXOS embaixo, a confirmação — e a
 * aprovação canônica gravada. Capturas claro/escuro em
 * test-results/decisions-shots (revisão visual, nunca versionadas).
 *
 *   npx playwright test -c playwright.qa.config.ts --project=mobile tests/qa-live/decisions-mobile.spec.ts
 */
import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type pg from 'pg';
import { apiAs, authFile, one, qaDb, qaLive, tag } from './support';
import { decisionPurchaseOrder, keyForAuthority, type DecisionPo } from './decisions-support';

test.use({ storageState: authFile('financeiro'), viewport: { width: 390, height: 844 } });
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

const T = tag();
const SHOTS = 'test-results/decisions-shots';
let db: pg.Client;
let P: DecisionPo;
let key: string;

const shot = async (page: Page, name: string) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
};
const noHorizontalScroll = (page: Page) => page.evaluate(() => {
  const el = document.scrollingElement ?? document.documentElement;
  return el.scrollWidth <= el.clientWidth + 1;
});
const theme = async (page: Page, t: 'light' | 'dark') => {
  await page.addInitScript((v) => { try { localStorage.setItem('insight-theme-preference', v); } catch { /* sem armazenamento */ } }, t);
};

test.beforeAll(async () => {
  db = await qaDb();
  await db.query(`UPDATE public.approval_policy_versions SET status = 'INACTIVE'
    WHERE organization_id = $1 AND subject_type = 'purchase_order' AND status = 'ACTIVE'`, [qaLive().organization.id]);
  P = await decisionPurchaseOrder(db, `M${T}`);
  const res = await (await apiAs('compras')).post(`/api/supply/procurement/purchase-orders/${P.poId}`, { data: { action: 'submit' } });
  expect(res.status(), await res.text()).toBe(200);
  key = keyForAuthority(P.poId);
});
test.afterAll(async () => { await db?.end(); });

test('1 · a caixa no celular: legível, sem rolagem lateral, alvo de toque de verdade', async ({ page }) => {
  page.on('pageerror', (e) => { throw new Error(`erro de runtime: ${e.message}`); });
  await theme(page, 'light');
  await page.goto('/decisoes');
  await expect(page.getByTestId('decisions-workspace')).toBeVisible();
  const row = page.locator(`[data-testid="decision-row"][data-key="${key}"]`);
  await expect(row).toBeVisible();
  await expect(row).toContainText('R$ 182.400');
  expect(await noHorizontalScroll(page)).toBe(true);
  const open = row.getByTestId('decision-open');
  const box = await open.boundingBox();
  expect(box && box.height >= 44 && box.x + box.width <= 390, JSON.stringify(box)).toBe(true);
  // Valor grande: tipografia de destaque, não texto de rodapé.
  const size = await row.locator('.dec-row-amount').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeGreaterThanOrEqual(20);
  await shot(page, '390-light-minhas');
});

test('2 · o detalhe em tela cheia, atos fixos embaixo — e a aprovação gravada', async ({ page }) => {
  page.on('pageerror', (e) => { throw new Error(`erro de runtime: ${e.message}`); });
  await theme(page, 'light');
  await page.goto(`/decisoes?d=${encodeURIComponent(key)}`);
  const detail = page.getByTestId('decision-detail');
  await expect(detail).toBeVisible();
  await expect(detail.getByTestId('decision-amount')).toContainText('182.400');
  const panel = await detail.boundingBox();
  expect(panel && panel.width >= 388, `painel em tela cheia: ${JSON.stringify(panel)}`).toBe(true);
  const approve = page.getByTestId('decision-act-approve');
  await expect(approve).toBeInViewport();
  const a = await approve.boundingBox();
  expect(a && a.height >= 44 && a.y + a.height <= 844, JSON.stringify(a)).toBe(true);
  expect(await noHorizontalScroll(page)).toBe(true);
  await shot(page, '390-light-detail');
  // Rolar o conteúdo não tira os atos da tela (barra fixa).
  await detail.getByTestId('decision-comparison').scrollIntoViewIfNeeded();
  await expect(approve).toBeInViewport();
  await shot(page, '390-light-detail-scrolled');

  await approve.click();
  const confirm = page.getByTestId('decision-confirm');
  await expect(confirm).toBeVisible();
  const c = await confirm.boundingBox();
  expect(c && c.x >= 0 && c.x + c.width <= 390, JSON.stringify(c)).toBe(true);
  await shot(page, '390-light-confirm');
  await confirm.getByTestId('decision-confirm-submit').click();
  await expect.poll(async () => (await one<{ status: string }>(db, `SELECT status FROM public.purchase_orders WHERE id = $1`, [P.poId])).status,
    { timeout: 30_000 }).toBe('APPROVED');
  await expect(page.getByTestId('decision-outcome')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('decision-act-approve')).toHaveCount(0);
  await shot(page, '390-light-outcome');
  const approvedBy = await one<{ approved_by: string }>(db, `SELECT approved_by FROM public.purchase_orders WHERE id = $1`, [P.poId]);
  expect(approvedBy.approved_by).toBe(qaLive().users.financeiro.id);
});

test('3 · escuro no celular: caixa e detalhe (revisão visual)', async ({ page }) => {
  page.on('pageerror', (e) => { throw new Error(`erro de runtime: ${e.message}`); });
  await theme(page, 'dark');
  const D = await decisionPurchaseOrder(db, `N${T}`, { qty: 120, priceA: 80, priceB: 95 });
  const res = await (await apiAs('compras')).post(`/api/supply/procurement/purchase-orders/${D.poId}`, { data: { action: 'submit' } });
  expect(res.status()).toBe(200);
  await page.goto('/decisoes');
  await expect(page.getByTestId('decisions-workspace')).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  await shot(page, '390-dark-minhas');
  await page.goto(`/decisoes?d=${encodeURIComponent(keyForAuthority(D.poId))}`);
  await expect(page.getByTestId('decision-detail')).toBeVisible();
  await expect(page.getByTestId('decision-act-approve')).toBeInViewport();
  await shot(page, '390-dark-detail');
  await page.getByTestId('decision-act-request_adjustment').click();
  const confirm = page.getByTestId('decision-confirm');
  // Justificativa obrigatória: o botão só libera com texto.
  await expect(confirm.getByTestId('decision-confirm-submit')).toBeDisabled();
  await shot(page, '390-dark-adjust-required');
  await confirm.getByTestId('decision-reason').fill('Confirmar o prazo de entrega com o fornecedor.');
  await expect(confirm.getByTestId('decision-confirm-submit')).toBeEnabled();
});
