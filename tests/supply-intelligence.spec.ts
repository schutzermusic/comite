/**
 * E2E — Inteligência de Supply: a torre de controle real mostra os sinais e os
 * achados da Apex SEM gravar nada ao abrir (a leitura é agendada pela
 * plataforma, não disparada pela tela), e — com leitura simulada — cada achado
 * leva ao ato governado certo: executar com ajuste, descartar com motivo,
 * acompanhar com objetivo e prazo. As escritas são interceptadas (inquilino real).
 */
import { e2eCredentials } from './support/e2e-credentials';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const qa = e2eCredentials();
const OUT = 'test-results/operations';
test.describe.configure({ mode: 'serial' });
test.setTimeout(150_000);

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const RESERVE = ID(1); const BUY = ID(2); const FOLLOW = ID(3);
const sig = (id: string, kind: string, severity: string, title: string, action: Record<string, unknown>) => ({
  id, kind, severity, status: 'OPEN', projectId: 'p1', project: 'Obra 1', requirementId: ID(10), purchaseOrderId: kind === 'LATE_INBOUND' ? ID(20) : null,
  title, rationale: `Justificativa de ${title}.`, evidence: [{ label: 'Livre no local', value: '400 m', source: 'Almox B (em mão − reservado)' }],
  action, firstSeenAt: '2026-09-24T10:00:00Z', lastSeenAt: '2026-09-24T12:00:00Z', resolvedAt: null, decidedBy: null, decidedAt: null,
  decisionNote: null, followupId: null,
});
const intelligence = {
  ok: true, lastRun: { ranAt: new Date().toISOString(), engineVersion: 'supply-signals.v1' },
  capabilities: { RESERVE: true, TRANSFER: true, REQUISITION: true, FOLLOW_UP: true, dismiss: true },
  signals: [
    sig(RESERVE, 'ALTERNATE_STOCK', 'critical', 'Reservar 400 m de CAB-35 para Obra 1',
      { kind: 'RESERVE', label: 'Reservar 400 m', payload: { requirement_id: ID(10), location_id: ID(11), quantity: 400 } }),
    sig(BUY, 'SHORTAGE', 'critical', 'Comprar 600 m de CAB-35 para Obra 1',
      { kind: 'REQUISITION', label: 'Requisitar compra de 600 m', payload: { requirement_ids: [ID(10)], quantity: 600 } }),
    sig(FOLLOW, 'LATE_INBOUND', 'high', 'Pedido OC-1 está 4 dia(s) atrasado',
      { kind: 'FOLLOW_UP', label: 'Acompanhar com o fornecedor', payload: { source_kind: 'purchase_order', source_id: ID(20),
        goal: 'Confirmar nova data do OC-1', due_date: '2026-09-28' } }),
  ],
};

let ctx: BrowserContext; let page: Page;
const blocked: string[] = []; const sent: Array<{ path: string; body: Record<string, unknown> }> = [];
let sweeps = 0; let mockReads = false;

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext(); page = await ctx.newPage(); page.setDefaultTimeout(30_000);
  await ctx.route('**/api/**', (route) => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    if (req.method() === 'GET') {
      if (mockReads && path === '/api/supply/intelligence') return route.fulfill({ json: intelligence });
      return route.fallback();
    }
    if (path === '/api/supply/intelligence/sweep') { sweeps += 1; return route.fulfill({ json: { ok: true, skipped: true } }); }
    if (path.startsWith('/api/supply/intelligence/signals/')) {
      sent.push({ path, body: JSON.parse(req.postData() ?? '{}') });
      return route.fulfill({ json: { ok: true, result: { status: 'EXECUTED' } } });
    }
    blocked.push(`${req.method()} ${path}`);
    return route.abort();
  });
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(qa.email);
  const pw = page.locator('input[type="password"]'); await pw.fill(qa.password); await pw.press('Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
});
test.afterAll(async () => { await ctx?.close(); });

test('1 · torre de controle real: sinais com fonte e achados da Apex — abrir a tela não grava nada', async () => {
  await page.goto('/supply');
  const overview = page.getByTestId('supply-overview');
  await expect(overview.getByRole('heading', { name: 'Torre de controle' })).toBeVisible({ timeout: 60_000 });
  const signals = overview.getByRole('region', { name: 'Sinais do Supply' });
  for (const k of ['Faltas críticas', 'Sem cobertura', 'Entradas em risco', 'Aprovações', 'Em inspeção', 'Em pedido aberto']) {
    await expect(signals.getByText(k, { exact: true })).toBeVisible();
  }
  await expect(page.getByTestId('apex-findings')).toBeVisible();
  await expect(overview.getByRole('region', { name: 'O que precisa de atenção agora' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(sweeps).toBe(0);
  mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: `${OUT}/supply-intelligence-real.png`, fullPage: true });
});

test('2 · executar recomendação: a pessoa ajusta a quantidade e o ato vai com a identidade dela', async () => {
  mockReads = true;
  await page.goto('/supply');
  const recs = page.getByTestId('apex-findings');
  await expect(recs.getByTestId('apex-finding')).toHaveCount(3);
  const first = recs.getByTestId('apex-finding').first();
  await expect(first).toContainText('Apex identificou estoque que evita compra');
  await expect(first).toContainText('Almox B (em mão − reservado)');
  await first.getByRole('button', { name: 'Reservar 400 m' }).click();
  const form = page.getByTestId('signal-execute-form');
  await form.getByLabel('Quantidade').fill('300');
  await form.getByRole('button', { name: 'Confirmar ato' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ path: `/api/supply/intelligence/signals/${RESERVE}`, body: { action: 'execute', quantity: 300 } });
  await page.screenshot({ path: `${OUT}/supply-intelligence-cards.png`, fullPage: true });
});

test('3 · descartar exige motivo; acompanhar abre cobrança com responsável e prazo', async () => {
  await page.goto('/supply');
  const recs = page.getByTestId('apex-findings');
  const buy = recs.getByTestId('apex-finding').nth(1);
  await buy.getByRole('button', { name: 'Descartar' }).click();
  const dismiss = page.getByTestId('signal-dismiss-form');
  const confirm = dismiss.getByRole('button', { name: 'Descartar', exact: true });
  await expect(confirm).toBeDisabled();
  await dismiss.getByLabel('Motivo').fill('Cliente fornece este cabo');
  await confirm.click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toMatchObject({ path: `/api/supply/intelligence/signals/${BUY}`, body: { action: 'dismiss', note: 'Cliente fornece este cabo' } });

  const late = recs.getByTestId('apex-finding').nth(2);
  await late.getByRole('button', { name: 'Acompanhar com o fornecedor' }).click();
  const form = page.getByTestId('signal-follow-form');
  await expect(form.getByLabel('Objetivo')).toHaveValue('Confirmar nova data do OC-1');
  await form.getByLabel('Responsável').fill('Comprador Ana');
  await form.getByRole('button', { name: 'Abrir acompanhamento' }).click();
  await expect.poll(() => sent.length).toBe(3);
  expect(sent[2]).toMatchObject({ path: `/api/supply/intelligence/signals/${FOLLOW}`, body: { action: 'follow_up',
    responsibleText: 'Comprador Ana', dueDate: '2026-09-28', goal: 'Confirmar nova data do OC-1' } });
});

test('4 · 390 px sem rolagem horizontal; nenhuma outra escrita saiu', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/supply');
  await expect(page.getByTestId('apex-findings')).toBeVisible({ timeout: 60_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(blocked).toEqual([]);
});
