/**
 * E2E — Recebimentos & Logística: tela real e, com leitura simulada,
 * o contrato dos atos de campo — receber parcial com rejeição motivada,
 * inspecionar série a série e registrar a logística do embarque. Toda escrita
 * é interceptada; nada chega ao banco.
 */
import { e2eCredentials } from './support/e2e-credentials';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const qa = e2eCredentials();
const OUT = 'test-results/operations';
test.describe.configure({ mode: 'serial' });
test.setTimeout(150_000);

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PO = ID(1); const LINE = ID(2); const SITE = ID(3); const QUAR = ID(4); const RC = ID(5); const RCL = ID(6);
const item = { itemId: ID(9), itemCode: 'CAB-35', itemDescription: 'Cabo 35 mm²', unit: 'm', tracking: 'NONE' };
const receiving = {
  ok: true, today: '2026-09-24', capabilities: { receive: true, inspect: true, logistics: true },
  locations: [{ id: SITE, name: 'Canteiro Obra 1', kind: 'PROJECT_SITE' }, { id: QUAR, name: 'Quarentena', kind: 'QUARANTINE' }],
  inbound: [{ kind: 'PO', id: PO, number: 'OC-260920-AAAAA', status: 'ISSUED', counterpart: 'Cabos Brasil', projectId: 'p1', project: 'Obra 1',
    destinationId: SITE, destination: 'Canteiro Obra 1', expectedDate: '2026-09-20', daysLate: 4, open: 100, queue: 'late',
    lines: [{ id: LINE, ...item, quantity: 100, received: 0, open: 100, expectedDate: '2026-09-20' }], shipments: [], receipts: [] }],
  inboundTransfers: [],
  receipts: [{ id: RC, number: 'REC-260923-BBBBB', purchaseOrderId: ID(20), orderNumber: 'OC-260910-CCCCC', supplier: 'Relés SA',
    locationId: QUAR, location: 'Quarentena', locationKind: 'QUARANTINE', receivedAt: '2026-09-23T14:00:00Z', receivedBy: 'Almoxarife',
    note: null, discrepancyReason: null, inspectionStatus: 'PENDING', inspectionNote: null, hasDiscrepancy: false, evidence: [],
    lines: [{ id: RCL, poLineId: ID(21), itemId: ID(22), itemCode: 'REL-50', itemDescription: 'Relé 50', unit: 'un', tracking: 'SERIAL',
      accepted: 2, rejected: 0, rejectionReason: null, lotCode: null, serials: ['SN-1', 'SN-2'], inspectionApproved: null, inspectionRejected: null }] }],
  performance: [{ supplierId: ID(30), supplier: 'Relés SA', promisedLines: 4, onTimeLines: 3, avgDelayDays: 1.5, linesWithRejection: 1, receivedLines: 4 }],
};

let ctx: BrowserContext; let page: Page;
const consoleErrors: string[] = []; const blocked: string[] = []; const sent: Array<{ path: string; body: Record<string, unknown> }> = [];
let mockReads = false;

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext(); page = await ctx.newPage(); page.setDefaultTimeout(30_000);
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  await ctx.route('**/api/**', (route) => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    if (req.method() === 'GET') {
      if (mockReads && path === '/api/supply/receiving') return route.fulfill({ json: receiving });
      return route.fallback();
    }
    if (path.startsWith('/api/supply/receiving')) {
      sent.push({ path, body: JSON.parse(req.postData() ?? '{}') });
      return route.fulfill({ json: { ok: true, result: { receipt_id: ID(40), receipt_number: 'REC-X', inspection_status: 'NOT_REQUIRED' } } });
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

test('1 · tela real: menu, filas e abas', async () => {
  await page.goto('/supply/recebimentos');
  await expect(page.locator('.hud-nav-submenu').getByRole('link', { name: 'Recebimentos & Logística', exact: true })).toBeVisible({ timeout: 60_000 });
  const ws = page.getByTestId('receiving-workspace');
  await expect(ws.getByRole('heading', { name: 'Recebimentos & logística' })).toBeVisible({ timeout: 60_000 });
  for (const t of ['Entradas', 'Recebimentos', 'Inspeção', 'Desempenho de entrega']) await expect(ws.getByRole('tab', { name: new RegExp(`^${t}`) })).toBeVisible();
  await expect(page.getByText(/Esta ação exige:/)).toHaveCount(0);
  mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: `${OUT}/receiving-real.png`, fullPage: true });
});

test('2 · receber parcial: rejeição sem motivo bloqueia; com motivo envia aceito e rejeitado separados', async () => {
  mockReads = true;
  await page.goto('/supply/recebimentos');
  const ws = page.getByTestId('receiving-workspace');
  const row = ws.getByTestId('inbound-row').first();
  await expect(row).toContainText('Atrasados');
  await expect(row).toContainText('4 dias de atraso');
  await row.getByRole('button', { name: 'Receber' }).click();
  const form = page.getByTestId('receive-form');
  await expect(form.getByLabel('Recebido CAB-35')).toHaveValue('100'); // já vem com o que falta
  await form.getByLabel('Recebido CAB-35').fill('80');
  await form.getByRole('button', { name: 'Registrar avaria' }).click();
  await form.getByLabel('Rejeitado CAB-35').fill('20');
  const confirm = page.getByRole('button', { name: 'Registrar recebimento' });
  await expect(confirm).toBeDisabled();
  await expect(form.getByText(/diga o motivo da rejeição/)).toBeVisible();
  await form.getByLabel('Motivo CAB-35').fill('Bobina amassada no transporte');
  await confirm.click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ path: '/api/supply/receiving/receipts', body: { purchaseOrderId: PO, locationId: SITE,
    lines: [{ poLineId: LINE, acceptedQuantity: 80, rejectedQuantity: 20, rejectionReason: 'Bobina amassada no transporte' }] } });
  await expect(page.getByTestId('receive-done')).toContainText('REC-X');
  await page.screenshot({ path: `${OUT}/receiving-form.png`, fullPage: true });
});

test('3 · inspeção série a série: rejeitar exige motivo e envia as séries decididas', async () => {
  await page.goto('/supply/recebimentos');
  const ws = page.getByTestId('receiving-workspace');
  await ws.getByRole('tab', { name: /^Inspeção/ }).click();
  await ws.getByTestId('inspection-row').first().getByRole('button', { name: 'Inspecionar' }).click();
  const form = page.getByTestId('inspect-form');
  await form.getByLabel('Rejeitar série SN-2').check();
  const confirm = page.getByRole('button', { name: 'Registrar inspeção' });
  await expect(confirm).toBeDisabled();
  await form.getByLabel('Motivo da rejeição').fill('Carcaça trincada');
  await confirm.click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toMatchObject({ path: `/api/supply/receiving/receipts/${RC}`, body: { destinationLocationId: SITE, reason: 'Carcaça trincada',
    lines: [{ lineId: RCL, approvedSerials: ['SN-1'], rejectedSerials: ['SN-2'] }] } });
});

test('4 · logística: embarque em trânsito com transportadora e previsão', async () => {
  await page.goto('/supply/recebimentos');
  const ws = page.getByTestId('receiving-workspace');
  await ws.getByTestId('inbound-row').first().getByRole('button', { name: 'Logística' }).click();
  const form = page.getByTestId('shipment-form');
  await form.getByLabel('Transportadora').fill('Rodo Sul');
  await form.getByLabel('Previsão de chegada').fill('2026-09-26');
  await form.getByLabel('Situação').selectOption('IN_TRANSIT');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect.poll(() => sent.length).toBe(3);
  expect(sent[2]).toMatchObject({ path: '/api/supply/receiving/shipments', body: { purchaseOrderId: PO, status: 'IN_TRANSIT',
    carrier: 'Rodo Sul', eta: '2026-09-26' } });
});

test('5 · desempenho de entrega derivado; 390 px sem rolagem horizontal; nada além das escritas previstas', async () => {
  await page.goto('/supply/recebimentos');
  const ws = page.getByTestId('receiving-workspace');
  await ws.getByRole('tab', { name: /^Desempenho/ }).click();
  await expect(ws.getByTestId('performance-row').first()).toContainText('75%');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/supply/recebimentos');
  await expect(page.getByTestId('receiving-workspace')).toBeVisible({ timeout: 60_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(blocked).toEqual([]);
  expect(consoleErrors.filter((e) => /same key/.test(e))).toEqual([]);
});
