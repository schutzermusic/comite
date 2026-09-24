/**
 * RECEBIMENTO EM CAMPO, NO CELULAR, COM ESCRITA REAL (QA isolado).
 *
 * O almoxarife, num Pixel 7, recebe um pedido pela barra fixa "Receber
 * material": escolhe o pedido, ajusta o que chegou bom, registra a avaria com
 * motivo, manda para a quarentena e tira a foto — uma WEBP de verdade, que o
 * aparelho converte para JPEG antes do envio. Depois inspeciona, também no
 * celular. Nenhuma escrita é interceptada: depois de cada passo, o estado
 * PERSISTIDO é conferido no banco (recebimento, linhas, pedido, livro-razão,
 * cobertura do requisito, evidência e objeto no Storage).
 */
import { expect, test } from '@playwright/test';
import type pg from 'pg';
import { issuedPurchaseOrder } from '../../scripts/operations/lib/fixtures.mjs';
import { authFile, governed, one, qaDb, qaLive, tag } from './support';

test.use({ storageState: authFile('almoxarifado') });

let db: pg.Client;
let po: { poId: string; lineOf: Record<string, string> };
let poNumber: string; let item: string; let site: string; let requirement: string; let receiptId: string; let quarantine: string;
const T = tag();

test.beforeAll(async () => {
  db = await qaDb();
  const g = await governed(db);
  item = await g.item(`MOB-${T}`, 'un', 'Fixação');
  const project = await g.project(`MOB${T}`);
  site = await g.location(`MOB-S-${T}`, 'PROJECT_SITE', { project_id: project });
  requirement = await g.material(project, item, 30);
  const ctx = { one: (sql: string, p: unknown[] = []) => one(db, sql, p), all: async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows };
  po = await issuedPurchaseOrder(ctx, { org: g.org, actor: g.actor }, { tag: `MOB${T}`, requirementIds: [requirement], prices: { [item]: 12.5 },
    deliveryLocationId: site });
  poNumber = (await one<{ n: string }>(db, `SELECT order_number n FROM public.purchase_orders WHERE id = $1`, [po.poId])).n;
});
test.afterAll(async () => { await db?.end(); });

const coverage = () => one<{ inspection: number; reserved: number; transit: number; on_order: number; shortage: number }>(db,
  `SELECT inspection_qty::float inspection, reserved_qty::float reserved, in_transit_qty::float transit, on_order_qty::float on_order,
          shortage_qty::float shortage FROM public.supply_requirement_coverage WHERE requirement_id = $1`, [requirement]);

test('recebe parcial com avaria, em quarentena, com foto WEBP convertida — e o banco confirma cada fato', async ({ page }) => {
  const live = qaLive();
  await page.goto('/supply/recebimentos');
  await expect(page.getByTestId('receiving-workspace')).toBeVisible({ timeout: 90_000 });

  // A ação do celular é a barra fixa: escolher o pedido pela busca.
  await page.locator('.ax-mobilebar').getByRole('button', { name: 'Receber material' }).click();
  const pick = page.getByTestId('receive-pick');
  await pick.getByPlaceholder('Número, fornecedor ou material').fill(poNumber);
  await pick.getByTestId('receive-pick-order').filter({ hasText: poNumber }).click();

  const form = page.getByTestId('receive-form');
  const code = `MOB-${T}`;
  await expect(form.getByLabel(`Recebido ${code}`)).toHaveValue('30');
  // O passo a passo do dedo: menos seis no botão, não teclado.
  for (let i = 0; i < 6; i += 1) await form.getByRole('button', { name: `Menos 1 ${code}` }).click();
  await expect(form.getByLabel(`Recebido ${code}`)).toHaveValue('24');
  await form.getByRole('button', { name: 'Registrar avaria' }).click();
  await form.getByLabel(`Rejeitado ${code}`).fill('6');
  await expect(form.getByRole('button', { name: 'Registrar recebimento' })).toBeDisabled();
  await form.getByLabel(`Motivo ${code}`).fill('Caixas molhadas na chegada');
  await form.getByLabel(/Mandar para inspeção/).check();
  await form.getByLabel(/Divergência com o romaneio/).fill('Nota fiscal diz 30, conferidas 24 boas e 6 avariadas');

  // Foto de celular em WEBP (gerada pelo próprio navegador) — o aparelho converte para JPEG.
  const webp = Buffer.from(await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 96; c.height = 64;
    const x = c.getContext('2d')!; x.fillStyle = '#b3261e'; x.fillRect(0, 0, 96, 64); x.fillStyle = '#fff'; x.fillRect(12, 12, 30, 30);
    const blob: Blob = await new Promise((resolve) => c.toBlob((b) => resolve(b!), 'image/webp', 0.9));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }));
  expect(webp.subarray(0, 4).toString()).toBe('RIFF');
  await form.getByLabel('Foto ou documento').setInputFiles({ name: 'avaria.webp', mimeType: 'image/webp', buffer: webp });
  await expect(form.getByText(/avaria\.jpg · .* \(convertida para JPEG\)/)).toBeVisible();

  await form.getByRole('button', { name: 'Registrar recebimento' }).click();
  const done = page.getByTestId('receive-done');
  await expect(done).toContainText('Em inspeção', { timeout: 60_000 });
  await expect(done).toContainText('Evidência anexada');

  // ── O banco: recebimento, linhas, pedido ──────────────────────────────
  const rc = await one<{ id: string; number: string; location_id: string; inspection_status: string; received_by: string; discrepancy_reason: string }>(db,
    `SELECT id, receipt_number number, location_id, inspection_status, received_by, discrepancy_reason
       FROM public.goods_receipts WHERE purchase_order_id = $1`, [po.poId]);
  receiptId = rc.id;
  await expect(done).toContainText(rc.number);
  expect(rc).toMatchObject({ inspection_status: 'PENDING', received_by: live.users.almoxarifado.id,
    discrepancy_reason: 'Nota fiscal diz 30, conferidas 24 boas e 6 avariadas' });
  expect(await one(db, `SELECT kind FROM public.inventory_locations WHERE id = $1`, [rc.location_id])).toEqual({ kind: 'QUARANTINE' });
  quarantine = rc.location_id;
  const line = await one(db, `SELECT accepted_quantity::float a, rejected_quantity::float r, rejection_reason FROM public.goods_receipt_lines WHERE receipt_id = $1`, [rc.id]);
  expect(line).toEqual({ a: 24, r: 6, rejection_reason: 'Caixas molhadas na chegada' });
  const order = await one(db, `SELECT po.status, l.received_quantity::float rec FROM public.purchase_orders po
    JOIN public.purchase_order_lines l ON l.purchase_order_id = po.id WHERE po.id = $1`, [po.poId]);
  expect(order).toEqual({ status: 'PARTIALLY_RECEIVED', rec: 24 }); // avariado não conta como recebido

  // ── Livro-razão: só o bom entrou, e entrou na quarentena ──────────────
  const moves = await db.query(`SELECT location_id, movement_type, quantity::float q FROM public.inventory_movements WHERE item_id = $1 ORDER BY seq`, [item]);
  expect(moves.rows).toEqual([{ location_id: quarantine, movement_type: 'RECEIPT', q: 24 }]);

  // ── Cobertura: 24 em inspeção (entrando, não reservável), 6 ainda esperados do fornecedor ──
  expect(await coverage()).toMatchObject({ inspection: 24, reserved: 0, on_order: 6, shortage: 0 });

  // ── Evidência: JPEG convertido, conferido pelo conteúdo, no Storage canônico ──
  const ev = await one<{ file_name: string; mime_type: string; size: number; sha: string; bucket: string; path: string; uploaded_by: string }>(db,
    `SELECT file_name, mime_type, size_bytes::int size, content_sha256 sha, storage_bucket bucket, storage_path path, uploaded_by
       FROM public.goods_receipt_evidence WHERE receipt_id = $1`, [rc.id]);
  expect(ev).toMatchObject({ file_name: 'avaria.jpg', mime_type: 'image/jpeg', bucket: 'contract-files', uploaded_by: live.users.almoxarifado.id });
  expect(ev.size).toBeGreaterThan(100);
  expect(ev.sha).toMatch(/^[0-9a-f]{64}$/);
  expect(ev.path.startsWith(`${live.organization.id}/supply-receipts/${live.users.almoxarifado.id}/`)).toBe(true);
  expect((await one<{ n: number }>(db, `SELECT count(*)::int n FROM storage.objects WHERE bucket_id = $1 AND name = $2`, [ev.bucket, ev.path])).n).toBe(1);
});

test('inspeciona no celular: aprova 20, rejeita 4 com motivo — a quarentena libera para o requisito', async ({ page }) => {
  test.skip(!receiptId, 'depende do recebimento do passo anterior');
  await page.goto('/supply/recebimentos?queue=inspection');
  const row = page.getByTestId('inspection-row').filter({ hasText: poNumber });
  await expect(row).toBeVisible({ timeout: 90_000 });
  await row.getByRole('button', { name: 'Inspecionar' }).click();
  const form = page.getByTestId('inspect-form');
  await form.getByLabel(`Aprovado MOB-${T}`).fill('20');
  await expect(form.getByText(/Aprovado 20 un · rejeitado 4 un/)).toBeVisible();
  await expect(form.getByRole('button', { name: 'Registrar inspeção' })).toBeDisabled();
  await form.getByLabel('Motivo da rejeição').fill('Quatro unidades com rosca danificada');
  await form.getByLabel('Liberar para').selectOption({ label: `MOB-S-${T}` });
  await form.getByRole('button', { name: 'Registrar inspeção' }).click();
  await expect(form).toBeHidden({ timeout: 60_000 });

  const rc = await one(db, `SELECT inspection_status, inspection_note FROM public.goods_receipts WHERE id = $1`, [receiptId]);
  expect(rc).toEqual({ inspection_status: 'PARTIALLY_REJECTED', inspection_note: 'Quatro unidades com rosca danificada' });
  // Rejeitado na inspeção volta a ser esperado do fornecedor.
  expect(await one(db, `SELECT received_quantity::float rec FROM public.purchase_order_lines WHERE purchase_order_id = $1`, [po.poId])).toEqual({ rec: 20 });
  // A quarentena esvaziou: 20 seguiram para o canteiro, 4 saíram do estoque.
  const atQuarantine = await one<{ q: number }>(db, `SELECT coalesce(sum(quantity), 0)::float q FROM public.inventory_movements WHERE item_id = $1 AND location_id = $2`,
    [item, quarantine]);
  expect(atQuarantine.q).toBe(0);
  const atSite = await one<{ q: number }>(db, `SELECT coalesce(sum(quantity), 0)::float q FROM public.inventory_movements WHERE item_id = $1 AND location_id = $2`,
    [item, site]);
  expect(atSite.q).toBe(20);
  const cov = await coverage();
  expect(cov.inspection).toBe(0);
  expect(cov.reserved + cov.transit).toBe(20);
  expect(cov.on_order).toBe(10);
  expect(cov.shortage).toBe(0);
});
