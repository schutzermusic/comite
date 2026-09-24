/**
 * EVIDÊNCIA DE RECEBIMENTO — o caminho real do celular, ponta a ponta:
 * autorização (URL assinada) → envio ao Storage → registro (servidor baixa,
 * confere assinatura, calcula hash) → vínculo ao recebimento → leitura por URL
 * temporária. E cada recusa: papel sem alçada, outro inquilino, caminho de
 * outra pessoa, conteúdo falso, e o navegador tentando plantar, ler ou apagar
 * o arquivo por fora do servidor.
 */
import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type pg from 'pg';
import { issuedPurchaseOrder } from '../../scripts/operations/lib/fixtures.mjs';
import { apiAs, browserClientAs, governed, one, qaDb, qaLive, tag } from './support';

// JPEG 1×1 real (cabeçalho FF D8 FF).
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

let db: pg.Client;
let receiptId: string;
test.beforeAll(async () => {
  db = await qaDb();
  const g = await governed(db); const t = tag();
  const item = await g.item(`EV-${t}`); const project = await g.project(`EV${t}`);
  const site = await g.location(`EV-S-${t}`, 'PROJECT_SITE', { project_id: project });
  const req = await g.material(project, item, 10);
  const ctx = { one: (sql: string, p: unknown[] = []) => one(db, sql, p), all: async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows };
  const po = await issuedPurchaseOrder(ctx, { org: g.org, actor: g.actor }, { tag: `EV${t}`, requirementIds: [req], prices: { [item]: 7 }, deliveryLocationId: site });
  const almox = await apiAs('almoxarifado');
  const r = await almox.post('/api/supply/receiving/receipts', { data: { purchaseOrderId: po.poId, idempotencyKey: `ev-${t}`,
    lines: [{ poLineId: po.lineOf[item], acceptedQuantity: 10 }] } });
  expect(r.status()).toBe(200);
  receiptId = (await r.json()).result.receipt_id;
});
test.afterAll(async () => { await db?.end(); });

async function upload(bytes: Buffer, mimeType: 'image/jpeg' | 'image/png' | 'application/pdf', name = 'foto.jpg') {
  const almox = await apiAs('almoxarifado');
  const url = `/api/supply/receiving/receipts/${receiptId}/evidence`;
  const auth = await almox.post(url, { data: { action: 'authorize', fileName: name, mimeType, fileSize: bytes.length } });
  expect(auth.status()).toBe(200);
  const { path, token, bucket } = await auth.json();
  const sb = await browserClientAs('almoxarifado');
  const up = await sb.storage.from(bucket).uploadToSignedUrl(path, token, bytes, { contentType: mimeType });
  expect(up.error).toBeNull();
  const reg = await almox.post(url, { data: { action: 'register', path, fileName: name, mimeType } });
  return { path, bucket, reg };
}

test('envio assinado → armazenamento canônico → vínculo → leitura', async () => {
  const { path, bucket, reg } = await upload(JPEG, 'image/jpeg');
  expect(reg.status()).toBe(200);
  const evidenceId = (await reg.json()).result.evidence_id as string;
  const row = await one(db, `SELECT organization_id, receipt_id, storage_bucket, storage_path, size_bytes::int size, content_sha256, uploaded_by
    FROM public.goods_receipt_evidence WHERE id = $1`, [evidenceId]);
  const live = qaLive();
  expect(row).toMatchObject({ organization_id: live.organization.id, receipt_id: receiptId, storage_bucket: 'contract-files',
    storage_path: path, size: JPEG.length, content_sha256: createHash('sha256').update(JPEG).digest('hex'), uploaded_by: live.users.almoxarifado.id });
  expect(path.startsWith(`${live.organization.id}/supply-receipts/${live.users.almoxarifado.id}/`)).toBe(true);
  const obj = await one(db, `SELECT count(*)::int n FROM storage.objects WHERE bucket_id = $1 AND name = $2`, [bucket, path]);
  expect(obj.n).toBe(1);

  // Leitura: quem vê recebimento recebe URL temporária; o conteúdo é o enviado.
  const viewer = await apiAs('compras');
  const get = await viewer.get(`/api/supply/receiving/receipts/${receiptId}/evidence?evidence=${evidenceId}`);
  expect(get.status()).toBe(200);
  expect(get.headers()['cache-control']).toContain('no-store');
  const signed = (await get.json()).url as string;
  const bytes = Buffer.from(await (await fetch(signed)).arrayBuffer());
  expect(bytes.equals(JPEG)).toBe(true);

  // Repetir o registro não duplica a evidência.
  const again = await (await apiAs('almoxarifado')).post(`/api/supply/receiving/receipts/${receiptId}/evidence`,
    { data: { action: 'register', path, fileName: 'foto.jpg', mimeType: 'image/jpeg' } });
  expect((await again.json()).result).toMatchObject({ evidence_id: evidenceId, replayed: true });
});

test('recusas: sem alçada, outro inquilino, caminho alheio e conteúdo falso', async () => {
  const url = `/api/supply/receiving/receipts/${receiptId}/evidence`;
  // Financeiro vê recebimento mas não recebe.
  expect((await (await apiAs('financeiro')).post(url, { data: { action: 'authorize', fileName: 'x.jpg', mimeType: 'image/jpeg', fileSize: 10 } })).status()).toBe(403);
  // RH não vê recebimento.
  expect((await (await apiAs('rh')).get(`${url}?evidence=00000000-0000-4000-8000-000000000001`)).status()).toBe(403);
  // Outro inquilino: o recebimento "não existe" para ele.
  const outsider = await apiAs('outsider');
  expect((await outsider.post(url, { data: { action: 'authorize', fileName: 'x.jpg', mimeType: 'image/jpeg', fileSize: 10 } })).status()).toBe(404);
  const ev = await one<{ id: string }>(db, `SELECT id FROM public.goods_receipt_evidence WHERE receipt_id = $1 LIMIT 1`, [receiptId]);
  expect((await outsider.get(`${url}?evidence=${ev.id}`)).status()).toBe(404);
  // Caminho de outra pessoa (mesmo inquilino) não é registrado por quem não o gerou.
  const live = qaLive();
  const foreign = `${live.organization.id}/supply-receipts/${live.users.owner.id}/x.jpg`;
  expect((await (await apiAs('almoxarifado')).post(url, { data: { action: 'register', path: foreign, fileName: 'x.jpg', mimeType: 'image/jpeg' } })).status()).toBe(403);
  // Tipo declarado não bate com o conteúdo: recusado E removido do armazenamento.
  const { path, bucket, reg } = await upload(Buffer.from('<html>não é foto</html>'), 'image/jpeg', 'falso.jpg');
  expect(reg.status()).toBe(415);
  const obj = await one(db, `SELECT count(*)::int n FROM storage.objects WHERE bucket_id = $1 AND name = $2`, [bucket, path]);
  expect(obj.n).toBe(0);
});

test('o navegador não planta, não lê direto e não apaga evidência', async () => {
  const live = qaLive();
  const ev = await one<{ storage_path: string }>(db, `SELECT storage_path FROM public.goods_receipt_evidence WHERE receipt_id = $1 LIMIT 1`, [receiptId]);
  for (const role of ['owner', 'almoxarifado'] as const) {
    const sb = await browserClientAs(role);
    const plant = await sb.storage.from('contract-files').upload(`${live.organization.id}/supply-receipts/${live.users[role].id}/plantado.jpg`,
      JPEG, { contentType: 'image/jpeg' });
    expect(plant.error, `${role} plantou arquivo`).not.toBeNull();
    const read = await sb.storage.from('contract-files').download(ev.storage_path);
    expect(read.error, `${role} leu direto`).not.toBeNull();
    await sb.storage.from('contract-files').remove([ev.storage_path]);
    const still = await one(db, `SELECT count(*)::int n FROM storage.objects WHERE bucket_id = 'contract-files' AND name = $1`, [ev.storage_path]);
    expect(still.n, `${role} apagou evidência`).toBe(1);
  }
});
