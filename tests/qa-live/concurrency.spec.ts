/**
 * CONCORRÊNCIA REAL — navegador→API→banco, com sessões reais e SOBREPOSIÇÃO
 * FORÇADA: um terceiro cliente segura a mesma trava que a função governada
 * toma, as duas chamadas HTTP entram e ficam presas nela dentro das próprias
 * transações, e só quando o banco mostra as duas aguardando a trava é solta.
 *
 * Depois de cada corrida, o estado PERSISTIDO é conferido no banco:
 * sem sobre-reserva, sem recebimento duplicado, sem disponível negativo, sem
 * atendimento em dobro e sem escrita sobre fotografia velha.
 */
import { expect, test } from '@playwright/test';
import type pg from 'pg';
import { issuedPurchaseOrder } from '../../scripts/operations/lib/fixtures.mjs';
import { apiAs, forcedOverlap, governed, one, qaDb, qaLive, tag } from './support';

let db: pg.Client;
test.beforeAll(async () => { db = await qaDb(); });
test.afterAll(async () => { await db?.end(); });

const statuses = (rs: Array<{ status(): number }>) => rs.map((r) => r.status()).sort((a, b) => a - b);
const position = (org: string, item: string, loc: string) => one<{ h: number; r: number; a: number }>(db,
  `SELECT on_hand_qty::float h, reserved_qty::float r, available_qty::float a FROM public.inventory_position
    WHERE organization_id = $1 AND item_id = $2 AND location_id = $3`, [org, item, loc]);

test('duas reservas contra o MESMO saldo: uma vence, a outra é recusada, disponível nunca negativo', async () => {
  const g = await governed(db); const t = tag();
  const item = await g.item(`CC-RES-${t}`); const wh = await g.location(`CC-RES-W-${t}`, 'WAREHOUSE');
  await g.stock(item, wh, 100);
  const project = await g.project(`CCR${t}`);
  const r1 = await g.material(project, item, 80); const r2 = await g.material(project, item, 80);
  const [gestor, almox] = [await apiAs('gestor'), await apiAs('almoxarifado')];

  const results = await forcedOverlap('SELECT public.inventory_lock($1,$2,$3)', [g.org, item, wh], () => [
    gestor.post('/api/supply/inventory/reservations', { data: { requirementId: r1, locationId: wh, quantity: 80, idempotencyKey: `cc-res-a-${t}` } }),
    almox.post('/api/supply/inventory/reservations', { data: { requirementId: r2, locationId: wh, quantity: 80, idempotencyKey: `cc-res-b-${t}` } }),
  ]);
  expect(statuses(results)).toEqual([200, 422]);
  const loser = results.find((r) => r.status() === 422)!;
  expect((await loser.json()).error).toBeTruthy();
  expect(await position(g.org, item, wh)).toEqual({ h: 100, r: 80, a: 20 });
  const active = await one(db, `SELECT count(*)::int n, coalesce(sum(quantity),0)::float q FROM public.inventory_reservations
    WHERE organization_id = $1 AND item_id = $2 AND status = 'ACTIVE'`, [g.org, item]);
  expect(active).toEqual({ n: 1, q: 80 });
});

test('a MESMA reserva enviada duas vezes ao mesmo tempo: um efeito, a outra resposta é replay', async () => {
  const g = await governed(db); const t = tag();
  const item = await g.item(`CC-DUP-${t}`); const wh = await g.location(`CC-DUP-W-${t}`, 'WAREHOUSE');
  await g.stock(item, wh, 100);
  const project = await g.project(`CCD${t}`); const req = await g.material(project, item, 100);
  const gestor = await apiAs('gestor');
  const send = () => gestor.post('/api/supply/inventory/reservations',
    { data: { requirementId: req, locationId: wh, quantity: 100, idempotencyKey: `cc-dup-${t}` } });
  const results = await forcedOverlap('SELECT 1 FROM public.project_requirements WHERE id = $1 FOR UPDATE', [req], () => [send(), send()]);
  expect(statuses(results)).toEqual([200, 200]);
  const bodies = await Promise.all(results.map((r) => r.json()));
  expect(bodies.map((b) => Boolean(b.result.replayed)).sort()).toEqual([false, true]);
  expect(bodies[0].result.reservation_id).toBe(bodies[1].result.reservation_id);
  expect(await position(g.org, item, wh)).toEqual({ h: 100, r: 100, a: 0 });
});

test('duas reservas para o MESMO requisito: o requisito nunca é sobre-coberto', async () => {
  const g = await governed(db); const t = tag();
  const item = await g.item(`CC-REQ-${t}`); const wh = await g.location(`CC-REQ-W-${t}`, 'WAREHOUSE');
  await g.stock(item, wh, 500);
  const project = await g.project(`CCQ${t}`); const req = await g.material(project, item, 100);
  const [gestor, almox] = [await apiAs('gestor'), await apiAs('almoxarifado')];
  const results = await forcedOverlap('SELECT 1 FROM public.project_requirements WHERE id = $1 FOR UPDATE', [req], () => [
    gestor.post('/api/supply/inventory/reservations', { data: { requirementId: req, locationId: wh, quantity: 60, idempotencyKey: `cc-rq-a-${t}` } }),
    almox.post('/api/supply/inventory/reservations', { data: { requirementId: req, locationId: wh, quantity: 60, idempotencyKey: `cc-rq-b-${t}` } }),
  ]);
  expect(statuses(results)).toEqual([200, 422]);
  const cov = await one(db, `SELECT required_qty::float q, reserved_qty::float r, shortage_qty::float s FROM public.supply_requirement_coverage
    WHERE requirement_id = $1`, [req]);
  expect(cov).toEqual({ q: 100, r: 60, s: 40 });
});

test('dois recebimentos contra o mesmo saldo em aberto: sem recebimento duplicado nem acima do pedido', async () => {
  const g = await governed(db); const t = tag(); const live = qaLive();
  const item = await g.item(`CC-RCV-${t}`); const project = await g.project(`CCV${t}`);
  const site = await g.location(`CC-RCV-S-${t}`, 'PROJECT_SITE', { project_id: project });
  const req = await g.material(project, item, 100);
  const ctx = { one: (sql: string, p: unknown[] = []) => one(db, sql, p), all: async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows };
  const po = await issuedPurchaseOrder(ctx, { org: g.org, actor: g.actor }, { tag: `CCV${t}`, requirementIds: [req],
    prices: { [item]: 12.5 }, deliveryLocationId: site });
  const line = po.lineOf[item];
  const almox = await apiAs('almoxarifado');
  const receive = (key: string, qty: number) => almox.post('/api/supply/receiving/receipts',
    { data: { purchaseOrderId: po.poId, idempotencyKey: key, lines: [{ poLineId: line, acceptedQuantity: qty }] } });

  // Chaves diferentes, 70 + 70 contra 100 em aberto.
  const race = await forcedOverlap('SELECT 1 FROM public.purchase_orders WHERE id = $1 FOR UPDATE', [po.poId],
    () => [receive(`cc-rcv-a-${t}`, 70), receive(`cc-rcv-b-${t}`, 70)]);
  expect(statuses(race)).toEqual([200, 422]);
  let state = await one(db, `SELECT (SELECT received_quantity::float FROM public.purchase_order_lines WHERE id = $1) rec,
      (SELECT count(*)::int FROM public.goods_receipts WHERE purchase_order_id = $2) receipts,
      (SELECT coalesce(sum(quantity),0)::float FROM public.inventory_movements WHERE item_id = $3 AND movement_type = 'RECEIPT') ledger,
      (SELECT status FROM public.purchase_orders WHERE id = $2) st`, [line, po.poId, item]);
  expect(state).toEqual({ rec: 70, receipts: 1, ledger: 70, st: 'PARTIALLY_RECEIVED' });

  // A MESMA chave duas vezes ao mesmo tempo (duplo clique no celular): um efeito só.
  const dup = await forcedOverlap('SELECT 1 FROM public.purchase_orders WHERE id = $1 FOR UPDATE', [po.poId],
    () => [receive(`cc-rcv-dup-${t}`, 30), receive(`cc-rcv-dup-${t}`, 30)]);
  expect(statuses(dup)).toEqual([200, 200]);
  const bodies = await Promise.all(dup.map((r) => r.json()));
  expect(bodies.map((b) => Boolean(b.result.replayed)).sort()).toEqual([false, true]);
  state = await one(db, `SELECT (SELECT received_quantity::float FROM public.purchase_order_lines WHERE id = $1) rec,
      (SELECT count(*)::int FROM public.goods_receipts WHERE purchase_order_id = $2) receipts,
      (SELECT coalesce(sum(quantity),0)::float FROM public.inventory_movements WHERE item_id = $3 AND movement_type = 'RECEIPT') ledger,
      (SELECT status FROM public.purchase_orders WHERE id = $2) st`, [line, po.poId, item]);
  expect(state).toEqual({ rec: 100, receipts: 2, ledger: 100, st: 'RECEIVED' });
  void live;
});

test('dois despachos de transferência contra o mesmo disponível: nenhum saldo negativo', async () => {
  const g = await governed(db); const t = tag();
  const item = await g.item(`CC-TR-${t}`); const w1 = await g.location(`CC-TR-A-${t}`, 'WAREHOUSE');
  const w2 = await g.location(`CC-TR-B-${t}`, 'WAREHOUSE');
  await g.stock(item, w1, 100);
  const almox = await apiAs('almoxarifado');
  const request = async (k: string) => {
    const r = await almox.post('/api/supply/inventory/transfers', { data: { fromLocationId: w1, toLocationId: w2, idempotencyKey: k,
      lines: [{ itemId: item, quantity: 70 }] } });
    expect(r.status()).toBe(200);
    const id = (await r.json()).result.transfer_id as string;
    expect((await almox.post(`/api/supply/inventory/transfers/${id}`, { data: { action: 'approve' } })).status()).toBe(200);
    return id;
  };
  const [t1, t2] = [await request(`cc-tr-a-${t}`), await request(`cc-tr-b-${t}`)];
  const race = await forcedOverlap('SELECT public.inventory_lock($1,$2,$3)', [g.org, item, w1], () => [
    almox.post(`/api/supply/inventory/transfers/${t1}`, { data: { action: 'dispatch' } }),
    almox.post(`/api/supply/inventory/transfers/${t2}`, { data: { action: 'dispatch' } }),
  ]);
  expect(statuses(race)).toEqual([200, 422]);
  const src = await position(g.org, item, w1);
  expect(src.h).toBe(30);
  expect(src.a).toBeGreaterThanOrEqual(0);
  const negative = await one(db, `SELECT count(*)::int n FROM (SELECT location_id, sum(quantity) q FROM public.inventory_movements
    WHERE item_id = $1 GROUP BY location_id HAVING sum(quantity) < 0) x`, [item]);
  expect(negative.n).toBe(0);
  const dispatched = await one(db, `SELECT count(*)::int n FROM public.inventory_transfers WHERE id = ANY($1) AND status = 'IN_TRANSIT'`, [[t1, t2]]);
  expect(dispatched.n).toBe(1);
});

test('entrega à obra em dobro: a reserva é consumida uma vez só', async () => {
  const g = await governed(db); const t = tag();
  const item = await g.item(`CC-ISS-${t}`); const wh = await g.location(`CC-ISS-W-${t}`, 'WAREHOUSE');
  await g.stock(item, wh, 40);
  const project = await g.project(`CCI${t}`); const req = await g.material(project, item, 40);
  const almox = await apiAs('almoxarifado');
  const res = await almox.post('/api/supply/inventory/reservations', { data: { requirementId: req, locationId: wh, quantity: 40, idempotencyKey: `cc-iss-r-${t}` } });
  expect(res.status()).toBe(200);
  const reservation = (await res.json()).result.reservation_id as string;
  const race = await forcedOverlap('SELECT 1 FROM public.inventory_reservations WHERE id = $1 FOR UPDATE', [reservation], () => [
    almox.post(`/api/supply/inventory/reservations/${reservation}`, { data: { action: 'issue', quantity: 40, idempotencyKey: `cc-iss-a-${t}` } }),
    almox.post(`/api/supply/inventory/reservations/${reservation}`, { data: { action: 'issue', quantity: 40, idempotencyKey: `cc-iss-b-${t}` } }),
  ]);
  expect(statuses(race)).toEqual([200, 422]);
  const r = await one(db, `SELECT consumed_quantity::float c, status FROM public.inventory_reservations WHERE id = $1`, [reservation]);
  expect(r).toEqual({ c: 40, status: 'CONSUMED' });
  const issued = await one(db, `SELECT coalesce(sum(quantity),0)::float q FROM public.inventory_movements
    WHERE item_id = $1 AND movement_type = 'ISSUE_TO_PROJECT'`, [item]);
  expect(issued.q).toBe(-40);
});

test('contagem sobre fotografia velha é recusada (sem corrupção por escrita obsoleta)', async () => {
  const g = await governed(db); const t = tag();
  const item = await g.item(`CC-CNT-${t}`); const wh = await g.location(`CC-CNT-W-${t}`, 'WAREHOUSE');
  await g.stock(item, wh, 50);
  const almox = await apiAs('almoxarifado');
  const open = await almox.post('/api/supply/inventory/counts', { data: { locationId: wh, itemIds: [item] } });
  expect(open.status()).toBe(200);
  const countId = (await open.json()).result.count_id as string;
  // Depois da fotografia, o livro muda (recebimento de outra frente).
  await g.stock(item, wh, 10);
  const rec = await almox.post(`/api/supply/inventory/counts/${countId}`, { data: { action: 'record', lines: [{ itemId: item, countedQuantity: 50 }] } });
  expect(rec.status()).toBe(200);
  const post = await almox.post(`/api/supply/inventory/counts/${countId}`, { data: { action: 'post' } });
  expect(post.status()).toBe(422);
  expect(await position(g.org, item, wh)).toMatchObject({ h: 60 });
  const corrections = await one(db, `SELECT count(*)::int n FROM public.inventory_movements WHERE item_id = $1 AND movement_type = 'COUNT_CORRECTION'`, [item]);
  expect(corrections.n).toBe(0);
});
