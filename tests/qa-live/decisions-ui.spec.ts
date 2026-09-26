/**
 * DECISÕES NO NAVEGADOR, COM ESCRITA REAL (QA isolado, 1440 px).
 *
 *   compras     submete o pedido de compra na tela de Compras (fonte)
 *   financeiro  vê o contador subir, abre Decisões, lê POR QUE a decisão é
 *               dele, a comparação de fornecedores e o impacto, e APROVA
 *               com confirmação — a mesma aprovação canônica de Compras
 *   compras     vê o pedido aprovado na própria tela; a decisão sai de
 *               "Minhas" e entra em "Concluídas"
 *
 *   duas sessões abrem a mesma decisão; a primeira aprova; a segunda, com a
 *   tela velha, tenta solicitar ajuste → resposta de tela velha, nada muda.
 *
 * Capturas (claro/escuro) em test-results/decisions-shots — revisão visual,
 * nunca versionadas.
 *
 *   npx playwright test -c playwright.qa.config.ts --project=desktop tests/qa-live/decisions-ui.spec.ts
 */
import fs from 'node:fs';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type pg from 'pg';
import { authFile, one, qaDb, qaLive, tag, type QaRole } from './support';
import { countFor, decisionPurchaseOrder, keyForAuthority, type DecisionPo } from './decisions-support';

test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

const T = tag();
const SHOTS = 'test-results/decisions-shots';
let db: pg.Client;
let P: DecisionPo;
let key: string;
const opened: BrowserContext[] = [];

async function as(browser: Browser, role: QaRole, theme: 'light' | 'dark' = 'light'): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(role), viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce',
    colorScheme: theme });
  await ctx.addInitScript((t) => { try { localStorage.setItem('insight-theme-preference', t); } catch { /* sem armazenamento */ } }, theme);
  opened.push(ctx);
  const page = await ctx.newPage();
  page.setDefaultTimeout(45_000);
  page.on('pageerror', (e) => { throw new Error(`[${role}] erro de runtime: ${e.message}`); });
  return page;
}
const shot = async (page: Page, name: string) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
};
const po = (id: string) => one<{ status: string; approved_by: string | null; approval_authority_id: string | null }>(db,
  `SELECT status, approved_by, approval_authority_id FROM public.purchase_orders WHERE id = $1`, [id]);
/**
 * O número EXATO do selo, pelo nome acessível ("Decisões: 104 pendentes"): a pílula pinta no máximo "99+"
 * (`badgeText`) — com mais de 99 pendentes no QA acumulado, o texto visível deixava de medir a subida.
 */
const badge = async (page: Page) => {
  const label = await page.getByTestId('header-decisions').getAttribute('aria-label').catch(() => null);
  const n = Number((label ?? '').replace(/\D/g, ''));
  return Number.isFinite(n) ? n : 0;
};

test.beforeAll(async () => {
  db = await qaDb();
  await db.query(`UPDATE public.approval_policy_versions SET status = 'INACTIVE'
    WHERE organization_id = $1 AND subject_type = 'purchase_order' AND status = 'ACTIVE'`, [qaLive().organization.id]);
  P = await decisionPurchaseOrder(db, `U${T}`);
  key = keyForAuthority(P.poId);
});
test.afterAll(async () => { for (const c of opened) await c.close().catch(() => undefined); await db?.end(); });

test('1 · compras submete na tela de Compras; o contador do financeiro sobe', async ({ browser }) => {
  const fin = await as(browser, 'financeiro');
  // O painel é onde se chega: a pergunta "o que precisa de mim agora?" nasce aqui (sem erro de runtime — o shell hidrata limpo).
  await fin.goto('/dashboard');
  await expect(fin.getByRole('link', { name: /Decisões/ }).first()).toBeVisible();
  // Linha de base pela MESMA fonte do selo; e o selo mostra esse número antes da submissão.
  const before = await countFor('financeiro');
  await expect.poll(() => badge(fin), { timeout: 30_000 }).toBe(before);

  const compras = await as(browser, 'compras');
  await compras.goto(`/supply/compras?stage=pedidos&po=${P.poId}`);
  const drawer = compras.getByTestId('po-drawer');
  await drawer.getByRole('button', { name: 'Submeter à aprovação' }).click();
  const act = compras.getByTestId('po-act-form');
  await act.getByLabel(/Observação/).fill('Cabo do lançamento — frente de montagem em 6 dias');
  await act.getByRole('button', { name: 'Submeter à aprovação' }).click();
  await expect.poll(async () => (await po(P.poId)).status, { timeout: 30_000 }).toBe('APPROVAL_REQUIRED');

  // O contador reage à volta à janela (foco) — sem esperar o ciclo de 60 s.
  await fin.bringToFront();
  await fin.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => badge(fin), { timeout: 30_000 }).toBe(before + 1);
});

test('2 · financeiro decide em Decisões: contexto, por quê, comparação, impacto — e aprova', async ({ browser }) => {
  const fin = await as(browser, 'financeiro');
  await fin.goto('/decisoes');
  await expect(fin.getByTestId('decisions-workspace')).toBeVisible();
  const row = fin.locator(`[data-testid="decision-row"][data-key="${key}"]`);
  await expect(row).toBeVisible();
  await expect(row).toContainText('R$ 182.400');
  await expect(row).toContainText(P.projectName);
  await expect(row).toContainText('Elétrica Rápida Norte');
  await shot(fin, '1440-light-minhas');

  // Teclado: abrir pelo botão e fechar com Esc devolve o foco ao MESMO botão (não ao topo da página).
  await row.getByTestId('decision-open').focus();
  await fin.keyboard.press('Enter');
  await expect(fin.getByTestId('decision-detail')).toBeVisible();
  await fin.keyboard.press('Escape');
  await expect(fin.getByTestId('decision-detail')).toHaveCount(0);
  await expect(row.getByTestId('decision-open')).toBeFocused();

  await row.getByTestId('decision-open').click();
  const detail = fin.getByTestId('decision-detail');
  await expect(detail).toBeVisible();
  await expect(detail.getByTestId('decision-amount')).toContainText('182.400');
  await expect(detail.getByTestId('decision-why')).toContainText('ATA-QA-001');
  await expect(detail.getByTestId('decision-comparison')).toContainText('Cabos Amazônia');
  await expect(detail.getByTestId('decision-comparison')).toContainText('Atende o cronograma');
  await expect(detail.getByTestId('decision-impact')).toContainText('a mais, mas atende o cronograma');
  await expect(detail.getByTestId('decision-source')).toHaveAttribute('href', new RegExp(`po=${P.poId}`));
  // Só os atos que a alçada de compra executa.
  await expect(fin.getByTestId('decision-act-approve')).toBeVisible();
  await expect(fin.getByTestId('decision-act-request_adjustment')).toBeVisible();
  await expect(fin.getByTestId('decision-act-reject')).toHaveCount(0);
  await shot(fin, '1440-light-detail');

  await fin.getByTestId('decision-act-approve').click();
  const confirm = fin.getByTestId('decision-confirm');
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('182.400');
  await confirm.getByTestId('decision-reason').fill('Atende a frente de montagem; dentro da alçada.');
  await shot(fin, '1440-light-confirm');
  await confirm.getByTestId('decision-confirm-submit').click();

  await expect.poll(async () => (await po(P.poId)).status, { timeout: 30_000 }).toBe('APPROVED');
  const after = await po(P.poId);
  expect(after.approved_by).toBe(qaLive().users.financeiro.id);
  expect(after.approval_authority_id).toBeTruthy();
  await expect(fin.getByTestId('decision-outcome')).toBeVisible({ timeout: 30_000 });
  await expect(fin.getByTestId('decision-act-approve')).toHaveCount(0);

  // Sai de "Minhas", entra em "Concluídas".
  await fin.goto('/decisoes');
  await expect(fin.locator(`[data-testid="decision-row"][data-key="${key}"]`)).toHaveCount(0);
  await fin.goto('/decisoes?tab=concluidas');
  const done = fin.locator(`[data-testid="decision-completed-row"][data-key="${key}"]`);
  await expect(done).toBeVisible();
  await expect(done).toContainText('Aprovada');
  await shot(fin, '1440-light-concluidas');

  // A fonte reflete o MESMO ato: Compras vê o pedido aprovado.
  const compras = await as(browser, 'compras');
  await compras.goto(`/supply/compras?stage=pedidos&po=${P.poId}`);
  await expect(compras.getByTestId('po-drawer')).toContainText('Aprovado');
});

test('3 · duas sessões, a mesma decisão: a tela velha não reescreve a história', async ({ browser }) => {
  const S = await decisionPurchaseOrder(db, `V${T}`, { qty: 50, priceA: 90, priceB: 100 });
  const res = await (await import('./support')).apiAs('compras');
  expect((await res.post(`/api/supply/procurement/purchase-orders/${S.poId}`, { data: { action: 'submit' } })).status()).toBe(200);
  const k = keyForAuthority(S.poId);
  const a = await as(browser, 'financeiro');
  const b = await as(browser, 'financeiro');
  for (const p of [a, b]) {
    await p.goto(`/decisoes?d=${encodeURIComponent(k)}`);
    await expect(p.getByTestId('decision-act-approve')).toBeVisible();
  }
  // Sessão A aprova.
  await a.getByTestId('decision-act-approve').click();
  await a.getByTestId('decision-confirm').getByTestId('decision-confirm-submit').click();
  await expect.poll(async () => (await po(S.poId)).status, { timeout: 30_000 }).toBe('APPROVED');
  // Sessão B, com a tela velha, tenta solicitar ajuste.
  await b.getByTestId('decision-act-request_adjustment').click();
  const confirm = b.getByTestId('decision-confirm');
  await confirm.getByTestId('decision-reason').fill('Rever o frete — tela velha');
  await confirm.getByTestId('decision-confirm-submit').click();
  await expect(b.getByTestId('decision-notice')).toContainText(/já foi aprovada/, { timeout: 30_000 });
  await expect(b.getByTestId('decision-act-request_adjustment')).toHaveCount(0);
  // O detalhe se refaz pelo servidor: o desfecho verdadeiro aparece, imutável.
  await expect(b.getByTestId('decision-outcome')).toBeVisible({ timeout: 30_000 });
  await expect(b.getByTestId('decision-outcome')).toContainText('Aprovada');
  await shot(b, '1440-light-stale');
  const n = await one<{ n: number }>(db, `SELECT count(*)::int n FROM public.purchase_order_history
    WHERE purchase_order_id = $1 AND transition IN ('approved','rejected')`, [S.poId]);
  expect(n.n).toBe(1);
  expect((await po(S.poId)).status).toBe('APPROVED');
});

test('4 · escuro: a caixa, o detalhe e a equipe (revisão visual)', async ({ browser }) => {
  const D = await decisionPurchaseOrder(db, `K${T}`, { qty: 400, priceA: 427.5, priceB: 456 });
  const res = await (await import('./support')).apiAs('compras');
  expect((await res.post(`/api/supply/procurement/purchase-orders/${D.poId}`, { data: { action: 'submit' } })).status()).toBe(200);
  const fin = await as(browser, 'financeiro', 'dark');
  await fin.goto('/decisoes');
  await expect(fin.getByTestId('decisions-workspace')).toBeVisible();
  await shot(fin, '1440-dark-minhas');
  await fin.goto(`/decisoes?d=${encodeURIComponent(keyForAuthority(D.poId))}`);
  await expect(fin.getByTestId('decision-detail')).toBeVisible();
  await expect(fin.getByTestId('decision-comparison')).toBeVisible();
  await shot(fin, '1440-dark-detail');
  const owner = await as(browser, 'owner', 'dark');
  await owner.goto('/decisoes?tab=equipe');
  await expect(owner.getByTestId('decisions-tab-equipe')).toBeVisible();
  await expect(owner.getByTestId('decisions-bottlenecks')).toBeVisible();
  await shot(owner, '1440-dark-equipe');
  const ownerLight = await as(browser, 'owner', 'light');
  await ownerLight.goto('/decisoes?tab=equipe');
  await expect(ownerLight.getByTestId('decisions-bottlenecks')).toBeVisible();
  await shot(ownerLight, '1440-light-equipe');
  // Quem não tem decisão vê o estado vazio verdadeiro — nunca exemplo inventado.
  const rh = await as(browser, 'rh');
  await rh.goto('/decisoes');
  await expect(rh.getByTestId('decisions-zero')).toBeVisible();
  await expect(rh.getByRole('heading', { name: 'Nenhuma decisão pendente' })).toBeVisible();
  await expect(rh.getByText('Tudo que depende da sua autoridade está resolvido.')).toBeVisible();
  await shot(rh, '1440-light-empty');
});
