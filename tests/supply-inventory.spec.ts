/**
 * E2E — Estoque (wave G): tela real (vazia ou não) e, com leitura simulada,
 * os atos governados — local, ajuste, reserva a partir da falta, recebimento
 * parcial de transferência e contagem. Toda escrita é interceptada: o teste
 * prova o CONTRATO que o navegador envia; nada chega ao banco.
 */
import { e2eCredentials } from './support/e2e-credentials';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const qa = e2eCredentials();
const OUT = 'test-results/operations';
test.describe.configure({ mode: 'serial' });
test.setTimeout(150_000);

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ITEM = ID(1); const WH = ID(2); const SITE = ID(3); const REQ = ID(4); const TR = ID(5); const LINE = ID(6); const CNT = ID(7); const CL = ID(8);

const fixture = {
  ok: true, today: '2026-09-24', capabilities: { manage: true, reserve: true, receive: true },
  locations: [
    { id: WH, code: 'ALM-SP', name: 'Almoxarifado SP', kind: 'WAREHOUSE', parentId: null, projectId: null, project: null,
      addressLabel: null, latitude: -23.5, longitude: -46.6, active: true },
    { id: SITE, code: 'OBRA-1', name: 'Canteiro Obra 1', kind: 'PROJECT_SITE', parentId: null, projectId: 'p1', project: 'Obra 1',
      addressLabel: null, latitude: null, longitude: null, active: true },
  ],
  position: [{ itemId: ITEM, itemCode: 'CAB-35', itemDescription: 'Cabo 35 mm²', unit: 'm', tracking: 'NONE', locationId: WH,
    locationCode: 'ALM-SP', locationName: 'Almoxarifado SP', locationKind: 'WAREHOUSE', onHand: 1000, reserved: 600, available: 400,
    inspection: 0, inboundTransit: 0, lastMovementAt: '2026-09-20T12:00:00Z' }],
  reservations: [], movements: [],
  transfers: [{ id: TR, number: 'TR-260924-ABCDE', status: 'IN_TRANSIT', fromLocationId: WH, fromLocation: 'Almoxarifado SP',
    toLocationId: SITE, toLocation: 'Canteiro Obra 1', projectId: 'p1', project: 'Obra 1', expectedArrival: '2026-09-26',
    carrier: 'Frota', trackingRef: null, note: null, requestedBy: 'QA', requestedAt: '2026-09-22T10:00:00Z',
    dispatchedAt: '2026-09-23T10:00:00Z', receivedAt: null, closedAt: null, closeReason: null,
    lines: [{ id: LINE, itemId: ITEM, itemCode: 'CAB-35', itemDescription: 'Cabo 35 mm²', unit: 'm', tracking: 'NONE', lotCode: null,
      quantity: 250, dispatched: 250, received: 0, requirementId: REQ, requirementTitle: 'Cabo da subestação', fromReservation: false }] }],
  counts: [{ id: CNT, locationId: WH, locationName: 'Almoxarifado SP', status: 'OPEN', note: null, openedAt: '2026-09-24T09:00:00Z',
    postedAt: null, closeReason: null, lines: [{ id: CL, itemId: ITEM, itemCode: 'CAB-35', itemDescription: 'Cabo 35 mm²', unit: 'm',
      tracking: 'NONE', lotCode: null, expected: 1000, counted: null }] }],
  exceptions: [], items: [{ id: ITEM, code: 'CAB-35', description: 'Cabo 35 mm²', unit: 'm', tracking: 'NONE' }],
  projects: [{ id: 'p1', name: 'Obra 1' }],
};

const demand = {
  ok: true, today: '2026-09-24', capabilities: { plan: true, reserve: true, requestPurchase: true },
  demand: [{ requirementId: REQ, projectId: 'p1', project: 'Obra 1', client: 'Cliente', activityId: null, activity: null,
    itemId: ITEM, itemCode: 'CAB-35', itemDescription: 'Cabo 35 mm²', title: 'Cabo da subestação', priority: 'high', unit: 'm',
    requirementType: 'MATERIAL', requiredBy: '2026-09-28', daysToNeed: 4,
    coverage: { required: 1000, reserved: 250, consumed: 0, inTransit: 300, onOrder: 0, requested: 0, inspection: 0, covered: 250, inbound: 300,
      shortage: 450, coveredRatio: 0.25, status: 'PARTIAL' }, risk: 'critical',
    stock: [{ locationId: WH, locationName: 'Almoxarifado SP', available: 400, isDestination: true }], sites: [] }],
};

let ctx: BrowserContext; let page: Page;
const blocked: string[] = []; const sent: Array<{ path: string; body: Record<string, unknown> }> = [];
let mockReads = false;

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext(); page = await ctx.newPage(); page.setDefaultTimeout(30_000);
  await ctx.route('**/api/**', (route) => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    if (req.method() === 'GET') {
      if (mockReads && path === '/api/supply/inventory') return route.fulfill({ json: fixture });
      if (mockReads && path === '/api/supply/material-planning') return route.fulfill({ json: demand });
      return route.fallback();
    }
    if (path.startsWith('/api/supply/inventory')) {
      sent.push({ path, body: JSON.parse(req.postData() ?? '{}') });
      return route.fulfill({ json: { ok: true, result: { transfer_number: 'TR-X' } } });
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

test('1 · Estoque real: menu, cabeçalho, cinco abas e locais', async () => {
  await page.goto('/supply/estoque');
  await expect(page.locator('.hud-nav-submenu').getByRole('link', { name: 'Estoque', exact: true })).toBeVisible({ timeout: 60_000 });
  const ws = page.getByTestId('inventory-workspace');
  await expect(ws.getByRole('heading', { name: 'Estoque', exact: true })).toBeVisible({ timeout: 60_000 });
  for (const t of ['Posição', 'Reservas', 'Movimentações', 'Transferências', 'Inventário', 'Locais']) {
    await expect(ws.getByRole('tab', { name: new RegExp(`^${t}`) })).toBeVisible();
  }
  await expect(page.getByText(/Esta ação exige:/)).toHaveCount(0);
  mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: `${OUT}/inventory-real.png`, fullPage: true });
});

test('2 · posição distingue em mão, reservado e disponível; ajuste envia motivo e sinal', async () => {
  mockReads = true;
  await page.goto('/supply/estoque');
  const ws = page.getByTestId('inventory-workspace');
  const row = ws.getByTestId('position-row').first();
  await expect(row).toContainText('1.000'); await expect(row).toContainText('600'); await expect(row).toContainText('400');
  await ws.getByRole('button', { name: 'Ajustar estoque' }).click();
  const form = page.getByTestId('adjust-form');
  await form.getByLabel('Item').selectOption(ITEM);
  await form.getByLabel('Sentido').selectOption('out');
  await form.getByLabel(/Quantidade/).fill('5');
  await form.getByLabel('Motivo').fill('Avaria no manuseio');
  await page.getByRole('button', { name: 'Registrar ajuste' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ path: '/api/supply/inventory/adjustments',
    body: { itemId: ITEM, locationId: WH, quantity: -5, reason: 'Avaria no manuseio' } });
  expect(String(sent[0].body.idempotencyKey)).toMatch(/^[0-9a-f-]{36}$/);
});

test('3 · falta do material: estratégia explicável e reserva governada', async () => {
  await page.goto('/supply/planejamento-materiais');
  const mp = page.getByTestId('material-planning');
  await mp.getByTestId('demand-row').first().click();
  const drawer = page.getByTestId('demand-drawer');
  const reserve = drawer.getByTestId('strategy-option').first();
  await expect(reserve).toContainText('Reservar do estoque em Almoxarifado SP');
  await expect(reserve.getByLabel(/Quantidade/)).toHaveValue('400');
  await expect(drawer.getByTestId('strategy-option').nth(1)).toContainText('Comprar 50 m');
  await reserve.getByRole('button', { name: 'Reservar' }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toMatchObject({ path: '/api/supply/inventory/reservations', body: { requirementId: REQ, locationId: WH, quantity: 400 } });
  await page.screenshot({ path: `${OUT}/inventory-strategy.png`, fullPage: true });
});

test('4 · transferência em trânsito: recebimento parcial envia a linha e a quantidade', async () => {
  await page.goto('/supply/estoque');
  const ws = page.getByTestId('inventory-workspace');
  await ws.getByRole('tab', { name: /^Transferências/ }).click();
  await ws.getByTestId('transfer-row').first().getByRole('button', { name: 'Abrir' }).click();
  const drawer = page.getByTestId('transfer-drawer');
  await drawer.getByRole('button', { name: 'Registrar recebimento' }).click();
  const form = page.getByTestId('transfer-act-form');
  await form.getByLabel(/CAB-35/).fill('100');
  await page.getByRole('button', { name: 'Registrar recebimento' }).last().click();
  await expect.poll(() => sent.length).toBe(3);
  expect(sent[2]).toMatchObject({ path: `/api/supply/inventory/transfers/${TR}`,
    body: { action: 'receive', lines: [{ lineId: LINE, quantity: 100 }] } });
});

test('5 · contagem: registra o contado e posta', async () => {
  await page.goto('/supply/estoque');
  const ws = page.getByTestId('inventory-workspace');
  await ws.getByRole('tab', { name: /^Inventário/ }).click();
  await ws.getByTestId('count-row').first().getByRole('button', { name: 'Abrir' }).click();
  const drawer = page.getByTestId('count-drawer');
  await drawer.getByLabel('Contado CAB-35').fill('990');
  await drawer.getByRole('button', { name: 'Salvar contado' }).click();
  await expect.poll(() => sent.length).toBe(4);
  expect(sent[3]).toMatchObject({ path: `/api/supply/inventory/counts/${CNT}`,
    body: { action: 'record', lines: [{ lineId: CL, countedQuantity: 990 }] } });
});

test('6 · 390 px sem rolagem horizontal; nenhuma outra escrita saiu', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/supply/estoque');
  await expect(page.getByTestId('inventory-workspace')).toBeVisible({ timeout: 60_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(blocked).toEqual([]);
});
