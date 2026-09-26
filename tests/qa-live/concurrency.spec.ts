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
import { issuedPurchaseOrder, purchaseOrderFromLines } from '../../scripts/operations/lib/fixtures.mjs';
import { apiAs, forcedOrder, forcedOverlap, governed, one, qaDb, qaLive, tag } from './support';

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

/* ══ 251 · a ordem canônica das travas: o recebimento não entra mais em impasse ══════════════════════════════
 *
 * Intercalação FORÇADA com COMMIT real, chamando as funções governadas direto, cada uma na sua sessão (sem a
 * repetição do governedRpc, que esconderia o impasse). Um bloqueador segura a linha que o recebimento toca ENTRE
 * a chave de estoque e o requisito (a alocação do pedido; na transferência, a chave de idempotência do movimento):
 *   1. o recebimento entra e para no bloqueador;  2. o outro ato entra e para atrás do recebimento;
 *   3. o bloqueador solta.
 * Antes da 251 o recebimento segurava a chave (e um requisito) e pedia o requisito que o outro já tinha: 40P01.
 * Com a ordem canônica — [documento] → requisitos (uuid) → chaves (item, local) → linhas — os dois se enfileiram.
 * Depois de cada corrida: ninguém abortado por impasse, recebimento gravado uma vez, reserva sem duplicata e
 * reclamado ≤ requerido.
 */
type Session = { c: pg.Client; pid: number };
const session = async (): Promise<Session> => {
  const c = await qaDb();
  return { c, pid: (await c.query('SELECT pg_backend_pid() AS p')).rows[0].p };
};
type Called = { ok: boolean; code: string | null; message: string | null; result: Record<string, unknown> | null };
const invoke = (s: Session, fn: string, ...args: unknown[]): Promise<Called> =>
  s.c.query(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) AS r`, args)
    .then((r) => ({ ok: true, code: null, message: null, result: r.rows[0].r }))
    .catch((e: { code?: string; message?: string }) => ({ ok: false, code: e.code ?? null, message: e.message ?? null, result: null }));
/** Espera a sessão `pid` ficar presa atrás de `by` (pg_blocking_pids lê o gerenciador de travas ao vivo). */
async function blockedBy(pid: number, by: number) {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const { rows } = await db.query('SELECT $2::int = ANY (pg_blocking_pids($1)) AS b', [pid, by]);
    if (rows[0].b) return;
    if (Date.now() > deadline) throw new Error(`a sessão ${pid} não ficou presa atrás de ${by}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
/**
 * A intercalação: `hold` (no bloqueador) segura a linha do meio do recebimento; `receive` entra e para nela; `other`
 * entra e para atrás do recebimento; o bloqueador solta. Devolve os dois desfechos (nenhum pode ser 40P01).
 */
async function interleave(hold: (b: pg.Client) => Promise<unknown>, receive: (s: Session) => Promise<Called>,
  other: (s: Session) => Promise<Called>): Promise<[Called, Called]> {
  const [blocker, a, b] = [await session(), await session(), await session()];
  try {
    await blocker.c.query('BEGIN');
    await hold(blocker.c);
    const first = receive(a);
    await blockedBy(a.pid, blocker.pid);
    const second = other(b);
    await blockedBy(b.pid, a.pid);
    await blocker.c.query('ROLLBACK');
    const out = await Promise.all([first, second]);
    for (const x of out) expect(x.code, `impasse: ${x.message}`).not.toBe('40P01');
    return out;
  } finally {
    await blocker.c.query('ROLLBACK').catch(() => undefined);
    for (const s of [blocker, a, b]) await s.c.end().catch(() => undefined);
  }
}
const proofCtx = () => ({ one: async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0],
  all: async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows });
const anchors = () => ({ org: qaLive().organization.id, actor: qaLive().users.owner.id });
type OrderOut = { poId: string; rfqId: string; quoteId: string };
/** A cadeia governada das provas (fixtures.mjs) com COMMIT real: cotação → proposta → decisão → … até `until`. */
const orderFrom = (opts: { tag: string; lineIds: string[]; deliveryLocationId: string; quantities?: Record<string, number>; until?: string }) =>
  (purchaseOrderFromLines as unknown as (c: unknown, a: unknown, o: typeof opts) => Promise<OrderOut>)(proofCtx(), anchors(), opts);
const claimedOk = async (req: string) => one<{ ok: boolean; c: number; q: number }>(db, `SELECT public.supply_requirement_claimed($1, pr.id) <= pr.quantity AS ok,
    public.supply_requirement_claimed($1, pr.id)::float8 AS c, pr.quantity::float8 AS q FROM public.project_requirements pr WHERE pr.id = $2`,
  [qaLive().organization.id, req]);
const receiptsOf = async (poId: string) => (await one<{ n: number }>(db,
  `SELECT count(*)::int AS n FROM public.goods_receipts WHERE purchase_order_id = $1`, [poId])).n;
const reservationsOf = async (req: string) => (await db.query(`SELECT source, quantity::float8 AS q FROM public.inventory_reservations
  WHERE requirement_id = $1 AND status = 'ACTIVE' ORDER BY created_at`, [req])).rows as Array<{ source: string; q: number }>;
const requisitionLines = async (rcId: string) => (await db.query(`SELECT id, item_id FROM public.purchase_requisition_lines
  WHERE requisition_id = $1`, [rcId])).rows as Array<{ id: string; item_id: string }>;
const fromShortage = async (g: Awaited<ReturnType<typeof governed>>, reqs: string[]) =>
  (await g.act<{ requisition_id: string }>('purchase_requisition_from_shortage', g.org, g.actor, g.J({ requirement_ids: reqs }))).requisition_id;

test('251 · recebimento ∥ reserva do mesmo requisito: sem impasse — a reserva espera o recebimento e não passa do requerido', async () => {
  const g = await governed(db); const t = tag();
  const item = await g.item(`CC251-A-${t}`);
  const project = await g.project(`C251A${t}`);
  const site = await g.location(`CC251-A-S-${t}`, 'PROJECT_SITE', { project_id: project });
  await g.stock(item, site, 30);
  const req = await g.material(project, item, 100);
  const rc = await fromShortage(g, [req]);
  const [line] = await requisitionLines(rc);
  const po = await orderFrom({ tag: `C251A${t}`, lineIds: [line.id], quantities: { [line.id]: 70 }, deliveryLocationId: site });
  const pol = (await one<{ id: string }>(db, `SELECT id FROM public.purchase_order_lines WHERE purchase_order_id = $1`, [po.poId])).id;
  const [rec, res] = await interleave(
    (b) => b.query(`SELECT 1 FROM public.purchase_order_line_requirements WHERE line_id = $1 FOR UPDATE`, [pol]),
    (s) => invoke(s, 'goods_receipt_post', g.org, g.actor, g.J({ purchase_order_id: po.poId, location_id: site,
      idempotency_key: `cc251-a-${t}`, lines: [{ po_line_id: pol, accepted_quantity: 70 }] })),
    (s) => invoke(s, 'inventory_reserve', g.org, g.actor, g.J({ requirement_id: req, location_id: site, quantity: 30, idempotency_key: `cc251-ar-${t}` })));
  expect(rec.ok, rec.message ?? '').toBe(true);
  expect(res.ok, res.message ?? '').toBe(true);
  expect(await receiptsOf(po.poId)).toBe(1);
  expect(await reservationsOf(req)).toEqual([{ source: 'RECEIPT', q: 70 }, { source: 'MANUAL', q: 30 }]);
  expect((await claimedOk(req)).ok).toBe(true);
});

test('251 · recebimento de transferência ∥ reserva do mesmo requisito no destino: sem impasse, sem reserva em dobro', async () => {
  const g = await governed(db); const t = tag();
  const item = await g.item(`CC251-T-${t}`);
  const project = await g.project(`C251T${t}`);
  const site = await g.location(`CC251-T-S-${t}`, 'PROJECT_SITE', { project_id: project });
  const depot = await g.location(`CC251-T-D-${t}`, 'WAREHOUSE');
  await g.stock(item, depot, 50); await g.stock(item, site, 30);
  const req = await g.material(project, item, 100);
  const tr = await g.act<{ transfer_id: string }>('inventory_transfer_request', g.org, g.actor,
    g.J({ from_location_id: depot, to_location_id: site, lines: [{ item_id: item, quantity: 50, requirement_id: req }] }));
  await g.act('inventory_transfer_approve', g.org, g.actor, tr.transfer_id);
  await g.act('inventory_transfer_dispatch', g.org, g.actor, tr.transfer_id, '{}');
  const line = (await one<{ id: string }>(db, `SELECT id FROM public.inventory_transfer_lines WHERE transfer_id = $1`, [tr.transfer_id])).id;
  const key = `cc251-t-${t}`;
  const [got, res] = await interleave(
    // o movimento de entrada desta linha, com a MESMA chave de idempotência, sem COMMIT: o recebimento espera nele
    (b) => b.query(`INSERT INTO public.inventory_movements (organization_id, item_id, location_id, movement_type, quantity, reason, idempotency_key)
      VALUES ($1, $2, $3, 'ADJUSTMENT', 1, 'bloqueador de prova 251', $4)`, [g.org, item, site, `transfer-receive:${key}:${line}`]),
    (s) => invoke(s, 'inventory_transfer_receive', g.org, g.actor, tr.transfer_id, g.J({ idempotency_key: key, lines: [{ line_id: line, quantity: 50 }] })),
    (s) => invoke(s, 'inventory_reserve', g.org, g.actor, g.J({ requirement_id: req, location_id: site, quantity: 30, idempotency_key: `cc251-tr-${t}` })));
  expect(got.ok, got.message ?? '').toBe(true);
  expect(res.ok, res.message ?? '').toBe(true);
  expect((await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM public.inventory_movements WHERE idempotency_key = $1`,
    [`transfer-receive:${key}:${line}`])).n).toBe(1);
  expect(await reservationsOf(req)).toEqual([{ source: 'TRANSFER', q: 50 }, { source: 'MANUAL', q: 30 }]);
  expect((await claimedOk(req)).ok).toBe(true);
});

/**
 * Dois requisitos (itens X e Y) em comum entre o pedido A, que se recebe, e o ato B de outro pedido (cancelamento,
 * emissão parcial ou decisão), que trava os dois em ordem de uuid. O pedido A é 50 + 50 de 100 + 100 (emitido; a
 * emissão libera 50 + 50), e a RC-2 da falta leva os 50 + 50 que sobram. Para a intercalação provar alguma coisa,
 * o recebimento de A precisa atender PRIMEIRO a linha do requisito de uuid MAIOR (a ordem das linhas é a do id):
 * o cenário é refeito até ser assim.
 */
async function sharedPair(label: string) {
  const g = await governed(db);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const t = tag();
    const project = await g.project(`C251${label}${t}`);
    const site = await g.location(`CC251-${label}-S-${t}`, 'PROJECT_SITE', { project_id: project });
    const [ix, iy] = [await g.item(`CC251-${label}X-${t}`), await g.item(`CC251-${label}Y-${t}`)];
    const [rx, ry] = [await g.material(project, ix, 100), await g.material(project, iy, 100)];
    const rc1 = await requisitionLines(await fromShortage(g, [rx, ry]));
    const a = await orderFrom({ tag: `C251${label}A${t}`, lineIds: rc1.map((l) => l.id),
      quantities: Object.fromEntries(rc1.map((l) => [l.id, 50])), deliveryLocationId: site });
    const lines = (await db.query(`SELECT pl.id, a.requirement_id AS req FROM public.purchase_order_lines pl
      JOIN public.purchase_order_line_requirements a ON a.line_id = pl.id WHERE pl.purchase_order_id = $1 ORDER BY pl.id::text`, [a.poId])).rows;
    const [first, second] = lines as Array<{ id: string; req: string }>;
    if (!(first.req > second.req)) continue;   // o 1º atendido tem de ser o de uuid maior
    const rc2 = await requisitionLines(await fromShortage(g, [rx, ry]));
    return { g, t, site, rx, ry, poA: a.poId, first, second, rc2 };
  }
  throw new Error('a ordem das linhas não caiu a favor em 8 tentativas');
}
const receiveBoth = (p: Awaited<ReturnType<typeof sharedPair>>) => (s: Session) => invoke(s, 'goods_receipt_post', p.g.org, p.g.actor,
  p.g.J({ purchase_order_id: p.poA, location_id: p.site, idempotency_key: `cc251-${p.t}`,
    lines: [{ po_line_id: p.first.id, accepted_quantity: 50 }, { po_line_id: p.second.id, accepted_quantity: 50 }] }));
const holdSecond = (p: Awaited<ReturnType<typeof sharedPair>>) => (b: pg.Client) =>
  b.query(`SELECT 1 FROM public.purchase_order_line_requirements WHERE line_id = $1 FOR UPDATE`, [p.second.id]);
async function afterPair(p: Awaited<ReturnType<typeof sharedPair>>) {
  expect(await receiptsOf(p.poA)).toBe(1);
  for (const r of [p.rx, p.ry]) {
    expect((await claimedOk(r)).ok).toBe(true);
    expect((await reservationsOf(r)).filter((x) => x.source === 'RECEIPT')).toEqual([{ source: 'RECEIPT', q: 50 }]);
  }
}

test('251 · recebimento ∥ cancelamento de OUTRO pedido com dois requisitos em comum: sem impasse, reclamado ≤ requerido', async () => {
  const p = await sharedPair('CN');
  const b = await orderFrom({ tag: `C251CNB${p.t}`, lineIds: p.rc2.map((l) => l.id),
    quantities: Object.fromEntries(p.rc2.map((l) => [l.id, 40])), deliveryLocationId: p.site });
  const [rec, can] = await interleave(holdSecond(p), receiveBoth(p),
    (s) => invoke(s, 'purchase_order_cancel', p.g.org, p.g.actor, b.poId, 'Fornecedor desistiu (prova 251)'));
  expect(rec.ok, rec.message ?? '').toBe(true);
  expect(can.ok, can.message ?? '').toBe(true);
  await afterPair(p);
});

test('251 · recebimento ∥ emissão PARCIAL de outro pedido com dois requisitos em comum: sem impasse', async () => {
  const p = await sharedPair('IS');
  const b = await orderFrom({ tag: `C251ISB${p.t}`, lineIds: p.rc2.map((l) => l.id),
    quantities: Object.fromEntries(p.rc2.map((l) => [l.id, 40])), deliveryLocationId: p.site, until: 'APPROVED' });
  const [rec, iss] = await interleave(holdSecond(p), receiveBoth(p), (s) => invoke(s, 'purchase_order_issue', p.g.org, p.g.actor, b.poId));
  expect(rec.ok, rec.message ?? '').toBe(true);
  expect(iss.ok, iss.message ?? '').toBe(true);
  expect((iss.result as { released?: unknown[] }).released).toHaveLength(2);
  await afterPair(p);
});

test('251 · recebimento ∥ decisão de cotação com dois requisitos em comum: sem impasse', async () => {
  const p = await sharedPair('DC');
  const q = await orderFrom({ tag: `C251DCB${p.t}`, lineIds: p.rc2.map((l) => l.id),
    deliveryLocationId: p.site, until: 'QUOTED' });
  const [rec, dec] = await interleave(holdSecond(p), receiveBoth(p),
    (s) => invoke(s, 'procurement_decide', p.g.org, p.g.actor, p.g.J({ rfq_id: q.rfqId, quote_id: q.quoteId, rationale: 'Prova 251.' })));
  expect(rec.ok, rec.message ?? '').toBe(true);
  expect(dec.ok, dec.message ?? '').toBe(true);
  await afterPair(p);
});

/**
 * 251 · ESTRESSE ADVERSARIAL — cada rodada monta, com COMMIT, dois requisitos (itens X e Y, 200 cada) que TODOS os
 * escritores disputam: o pedido A (50 + 50, emitido) a receber; uma transferência despachada com requisito; saldo no
 * canteiro para reservar; e a RC-2 do resto, que vira, conforme a rodada, cotação a decidir, pedido APROVADO (emissão
 * parcial) ou pedido EMITIDO (cancelamento). Então dispara JUNTOS, em ordem e atraso aleatórios: o recebimento de A
 * (metade das vezes preso no meio por um bloqueador), duas reservas, o recebimento da transferência e o ato de
 * Compras da rodada. Conta: nenhum 40P01, contador de impasses do banco parado, recebimento uma vez só, reclamado ≤
 * requerido. `STRESS_ROUNDS` escolhe quantas rodadas (padrão 4).
 */
test('251 · estresse adversarial: recebimento, reservas, transferência e cancelamento/emissão/decisão sobre os mesmos requisitos — zero impasse', async () => {
  test.setTimeout(20 * 60_000);
  const rounds = Number(process.env.STRESS_ROUNDS ?? 4);
  const g = await governed(db);
  const deadlocks = async () => (await one<{ n: number }>(db, `SELECT deadlocks::int AS n FROM pg_stat_database WHERE datname = current_database()`)).n;
  const before = await deadlocks();
  const kinds = ['decide', 'issue', 'cancel'] as const;
  const tally = { rounds: 0, ops: 0, ok: 0, refused: 0, deadlocks: 0, blocked: 0 };
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let round = 0; round < rounds; round += 1) {
    const kind = kinds[round % kinds.length];
    const t = tag();
    const project = await g.project(`C251S${t}`);
    const site = await g.location(`CC251-S-S-${t}`, 'PROJECT_SITE', { project_id: project });
    const depot = await g.location(`CC251-S-D-${t}`, 'WAREHOUSE');
    const items = [await g.item(`CC251-SX-${t}`), await g.item(`CC251-SY-${t}`)];
    const reqs: string[] = [];
    const transfers: Array<{ id: string; line: string }> = [];
    for (const item of items) {
      await g.stock(item, site, 30); await g.stock(item, depot, 20);
      const r = await g.material(project, item, 200);
      reqs.push(r);
      const tr = await g.act<{ transfer_id: string }>('inventory_transfer_request', g.org, g.actor,
        g.J({ from_location_id: depot, to_location_id: site, lines: [{ item_id: item, quantity: 20, requirement_id: r }] }));
      await g.act('inventory_transfer_approve', g.org, g.actor, tr.transfer_id);
      await g.act('inventory_transfer_dispatch', g.org, g.actor, tr.transfer_id, '{}');
      transfers.push({ id: tr.transfer_id, line: (await one<{ id: string }>(db, `SELECT id FROM public.inventory_transfer_lines WHERE transfer_id = $1`, [tr.transfer_id])).id });
    }
    const rc1 = await requisitionLines(await fromShortage(g, reqs));
    const a = await orderFrom({ tag: `C251SA${t}`, lineIds: rc1.map((l) => l.id), quantities: Object.fromEntries(rc1.map((l) => [l.id, 50])), deliveryLocationId: site });
    const aLines = (await db.query(`SELECT id FROM public.purchase_order_lines WHERE purchase_order_id = $1 ORDER BY id`, [a.poId])).rows.map((r) => String(r.id));
    const rc2 = await requisitionLines(await fromShortage(g, reqs));
    const b = await orderFrom({ tag: `C251SB${t}`, lineIds: rc2.map((l) => l.id), quantities: Object.fromEntries(rc2.map((l) => [l.id, 60])),
      deliveryLocationId: site, until: kind === 'decide' ? 'QUOTED' : kind === 'issue' ? 'APPROVED' : 'ISSUED' });

    const ops: Array<(s: Session) => Promise<Called>> = [
      ...items.map((_, i) => (s: Session) => invoke(s, 'inventory_reserve', g.org, g.actor,
        g.J({ requirement_id: reqs[i], location_id: site, quantity: 10, idempotency_key: `cc251-s-${t}-${i}` }))),
      ...transfers.map((x) => (s: Session) => invoke(s, 'inventory_transfer_receive', g.org, g.actor, x.id,
        g.J({ idempotency_key: `cc251-st-${t}-${x.line}`, lines: [{ line_id: x.line, quantity: 20 }] }))),
      kind === 'decide'
        ? (s: Session) => invoke(s, 'procurement_decide', g.org, g.actor, g.J({ rfq_id: b.rfqId, quote_id: b.quoteId, rationale: 'Estresse 251.' }))
        : kind === 'issue'
          ? (s: Session) => invoke(s, 'purchase_order_issue', g.org, g.actor, b.poId)
          : (s: Session) => invoke(s, 'purchase_order_cancel', g.org, g.actor, b.poId, 'Estresse 251: fornecedor desistiu'),
    ].sort(() => rand() - 0.5);

    const blocker = await session();
    const sessions: Session[] = [];
    const hold = rand() < 0.5;
    try {
      await blocker.c.query('BEGIN');
      if (hold) await blocker.c.query(`SELECT 1 FROM public.purchase_order_line_requirements WHERE line_id = $1 FOR UPDATE`,
        [aLines[Math.floor(rand() * aLines.length)]]);
      const rs = await session(); sessions.push(rs);
      const pending: Array<Promise<Called>> = [invoke(rs, 'goods_receipt_post', g.org, g.actor, g.J({ purchase_order_id: a.poId, location_id: site,
        idempotency_key: `cc251-sr-${t}`, lines: aLines.map((id) => ({ po_line_id: id, accepted_quantity: 50 })) }))];
      if (hold) { await blockedBy(rs.pid, blocker.pid); tally.blocked += 1; }
      for (const op of ops) {
        await new Promise((r) => setTimeout(r, Math.floor(rand() * 40)));
        const s = await session(); sessions.push(s);
        pending.push(op(s));
      }
      await new Promise((r) => setTimeout(r, 50 + Math.floor(rand() * 200)));
      await blocker.c.query('ROLLBACK');
      const out = await Promise.all(pending);
      tally.rounds += 1; tally.ops += out.length;
      for (const x of out) {
        if (x.ok) tally.ok += 1; else if (x.code === '40P01') tally.deadlocks += 1; else tally.refused += 1;
        expect(x.code, `rodada ${round} (${kind}): ${x.message}`).not.toBe('40P01');
        expect(x.ok || x.code === '23514', `rodada ${round} (${kind}): erro inesperado ${x.code} ${x.message}`).toBe(true);
      }
      expect(out[0].ok, `recebimento: ${out[0].message}`).toBe(true);
      expect(await receiptsOf(a.poId)).toBe(1);
      for (const r of reqs) expect((await claimedOk(r)).ok, `reclamado acima do requerido em ${r}`).toBe(true);
    } finally {
      await blocker.c.query('ROLLBACK').catch(() => undefined);
      for (const s of [blocker, ...sessions]) await s.c.end().catch(() => undefined);
    }
  }
  const after = await deadlocks();
  test.info().annotations.push({ type: 'stress', description: JSON.stringify({ ...tally, pgDeadlocksDelta: after - before }) });
  console.log(`[estresse 251] ${JSON.stringify({ ...tally, pgDeadlocksDelta: after - before })}`);
  expect(tally.deadlocks).toBe(0);
  expect(after - before).toBe(0);
});

/* ══ 252 · editar o requisito ∥ reservar / comprar / receber — com COMMIT real, nas duas ordens forçadas ════════
 * A edição e os escritores que aumentam a cobertura travam o MESMO requisito (251): com a trava do requisito presa,
 * os dois entram na fila na ordem escolhida e se serializam. Qualquer que seja a ordem: nenhum 40P01, e cobertura
 * comprometida ≤ requerido no fim — quem chega depois é recusado com o motivo certo, nunca grava por cima.
 */
const LOCK_REQ = 'SELECT 1 FROM public.project_requirements WHERE id = $1 FOR UPDATE';
async function editRace<T extends Called>(req: string, edit: (s: Session) => Promise<T>, other: (s: Session) => Promise<T>, editFirst: boolean) {
  const [a, b] = [await session(), await session()];
  try {
    const [first, second] = await forcedOrder(LOCK_REQ, [req], editFirst ? [() => edit(a), () => other(b)] : [() => other(b), () => edit(a)]);
    for (const x of [first, second]) expect(x.code, `impasse: ${x.message}`).not.toBe('40P01');
    return editFirst ? { edit: first, other: second } : { edit: second, other: first };
  } finally {
    for (const s of [a, b]) await s.c.end().catch(() => undefined);
  }
}
const requirementQty = async (req: string) => (await one<{ q: number }>(db, `SELECT quantity::float8 AS q FROM public.project_requirements WHERE id = $1`, [req])).q;

for (const editFirst of [true, false]) {
  const order = editFirst ? 'a edição na frente' : 'a edição atrás';
  test(`252 · reduzir o requisito ∥ reservar (${order}): nunca reservado acima do requerido`, async () => {
    const g = await governed(db); const t = tag();
    const item = await g.item(`CC252-R-${t}`);
    const project = await g.project(`C252R${t}`);
    const site = await g.location(`CC252-R-S-${t}`, 'PROJECT_SITE', { project_id: project });
    await g.stock(item, site, 60);
    const req = await g.material(project, item, 100);
    const { edit, other } = await editRace(req,
      (s) => invoke(s, 'project_requirement_upsert', g.org, g.actor, g.J({ id: req, quantity: 50 })),
      (s) => invoke(s, 'inventory_reserve', g.org, g.actor, g.J({ requirement_id: req, location_id: site, quantity: 60 })), editFirst);
    if (editFirst) {
      expect(edit.ok, edit.message ?? '').toBe(true);
      expect(other.message).toMatch(/Reservation would over-cover the requirement/);
      expect(await requirementQty(req)).toBe(50);
    } else {
      expect(other.ok, other.message ?? '').toBe(true);
      expect(edit.message).toMatch(/^Requirement quantity 50 is below its committed coverage 60 \(reserved 60\)/);
      expect(await requirementQty(req)).toBe(100);
    }
    expect((await claimedOk(req)).ok).toBe(true);
  });

  test(`252 · reduzir o requisito ∥ solicitar a compra da falta (${order}): a requisição nunca passa do requerido`, async () => {
    const g = await governed(db); const t = tag();
    const item = await g.item(`CC252-P-${t}`);
    const project = await g.project(`C252P${t}`);
    const req = await g.material(project, item, 100);
    const { edit, other } = await editRace(req,
      (s) => invoke(s, 'project_requirement_upsert', g.org, g.actor, g.J({ id: req, quantity: 50 })),
      (s) => invoke(s, 'purchase_requisition_from_shortage', g.org, g.actor, g.J({ requirement_ids: [req] })), editFirst);
    expect(other.ok, other.message ?? '').toBe(true);
    if (editFirst) {
      expect(edit.ok, edit.message ?? '').toBe(true);
      expect(Number((other.result as { requisitioned_qty: number }).requisitioned_qty)).toBe(50);
    } else {
      expect(edit.message).toMatch(/^Requirement quantity 50 is below its committed coverage 100 \(requested 100\)/);
      expect(Number((other.result as { requisitioned_qty: number }).requisitioned_qty)).toBe(100);
    }
    expect((await claimedOk(req)).ok).toBe(true);
  });

  test(`252 · editar o requisito ∥ receber o pedido dele (${order}): recebimento gravado uma vez, item e quantidade coerentes`, async () => {
    const g = await governed(db); const t = tag();
    const [item, other] = [await g.item(`CC252-V-${t}`), await g.item(`CC252-V2-${t}`)];
    const project = await g.project(`C252V${t}`);
    const site = await g.location(`CC252-V-S-${t}`, 'PROJECT_SITE', { project_id: project });
    const req = await g.material(project, item, 100);
    const [line] = await requisitionLines(await fromShortage(g, [req]));
    const po = await orderFrom({ tag: `C252V${t}`, lineIds: [line.id], deliveryLocationId: site });
    const pol = (await one<{ id: string }>(db, `SELECT id FROM public.purchase_order_lines WHERE purchase_order_id = $1`, [po.poId])).id;
    const run = await editRace(req,
      // reduzir para 80 E trocar o item: os dois recusados, antes ou depois do recebimento (100 em pedido ou reservados)
      (s) => invoke(s, 'project_requirement_upsert', g.org, g.actor, g.J({ id: req, quantity: 80, item_id: other })),
      (s) => invoke(s, 'goods_receipt_post', g.org, g.actor, g.J({ purchase_order_id: po.poId, location_id: site,
        idempotency_key: `cc252-v-${t}`, lines: [{ po_line_id: pol, accepted_quantity: 100 }] })), editFirst);
    expect(run.other.ok, run.other.message ?? '').toBe(true);
    expect(run.edit.ok).toBe(false);
    expect(run.edit.message).toMatch(/^Requirement has coverage of its current item \(100 committed: (on order|reserved) 100\)/);
    expect(await receiptsOf(po.poId)).toBe(1);
    expect(await reservationsOf(req)).toEqual([{ source: 'RECEIPT', q: 100 }]);
    const row = await one<{ q: number; item: string }>(db, `SELECT quantity::float8 AS q, item_id AS item FROM public.project_requirements WHERE id = $1`, [req]);
    expect(row).toEqual({ q: 100, item });
    expect((await claimedOk(req)).ok).toBe(true);
  });
}

test('252 · cancelar o requisito ∥ reservar: ou cancela antes (e a reserva é recusada) ou a reserva vem antes (e o cancelamento é recusado)', async () => {
  const g = await governed(db); const t = tag();
  const item = await g.item(`CC252-C-${t}`);
  const project = await g.project(`C252C${t}`);
  const site = await g.location(`CC252-C-S-${t}`, 'PROJECT_SITE', { project_id: project });
  await g.stock(item, site, 40);
  for (const editFirst of [true, false]) {
    const req = await g.material(project, item, 100);
    const { edit, other } = await editRace(req,
      (s) => invoke(s, 'project_requirement_transition', g.org, g.actor, req, 'CANCELLED', 'Escopo removido (prova 252)', null),
      (s) => invoke(s, 'inventory_reserve', g.org, g.actor, g.J({ requirement_id: req, location_id: site, quantity: 20 })), editFirst);
    if (editFirst) {
      expect(edit.ok, edit.message ?? '').toBe(true);
      expect(other.message).toMatch(/Only a confirmed MATERIAL requirement with an item receives a reservation/);
    } else {
      expect(other.ok, other.message ?? '').toBe(true);
      expect(edit.message).toMatch(/^Requirement has active coverage 20 \(reserved 20\)/);
    }
  }
});

/* ══ 253 · número de documento sem colisão — duas transações com o MESMO número, COMMIT real ═══════════════════
 * O sorteio (5 hexadecimais por dia) repete. Antes da 253, quem sorteava o número de uma transação ainda aberta ficava
 * presa no índice único dela e caía em 23505 quando ela confirmava (ou em 40P01, com as duas segurando o número uma da
 * outra); quem sorteava um número já gravado caía na hora. O caminho governado não deixa forçar o sorteio: a transação
 * A cria a requisição por ele e fica aberta; a B grava outra com o MESMO número — o "mesmo sorteio". Com a guarda, a B
 * não espera nem cai: nasce com outro número. Depois a A confirma, a B desfaz, e o número confirmado segue único.
 */
const cloneRequisition = (s: Session, org: string, number: string) => s.c.query(`INSERT INTO public.purchase_requisitions
    SELECT (jsonb_populate_record(NULL::public.purchase_requisitions, to_jsonb(x) || jsonb_build_object('id', gen_random_uuid(),
      'requisition_number', $2::text, 'idempotency_key', NULL))).*
      FROM public.purchase_requisitions x WHERE x.organization_id = $1 ORDER BY x.id LIMIT 1
    RETURNING requisition_number AS n`, [org, number])
  .then((r) => ({ ok: true, n: String(r.rows[0].n), code: null as string | null, message: null as string | null }))
  .catch((e: { code?: string; message?: string }) => ({ ok: false, n: null, code: e.code ?? null, message: e.message ?? null }));

test('253 · o mesmo número de requisição em duas transações: a segunda não espera nem cai — nasce com outro número', async () => {
  const g = await governed(db); const t = tag();
  const item = await g.item(`CC253-${t}`);
  const [a, b] = [await session(), await session()];
  try {
    await a.c.query('BEGIN');
    const created = await invoke(a, 'purchase_requisition_create_manual', g.org, g.actor,
      g.J({ justification: 'Prova 253 (concorrência)', lines: [{ item_id: item, quantity: 1 }] }));
    expect(created.ok, created.message ?? '').toBe(true);
    const n = String((created.result as { requisition_number: string }).requisition_number);

    // Em voo: a A segura o número; a B chega com o mesmo — antes da 253 ficava presa atrás da A no índice único.
    await b.c.query('BEGIN');
    const inFlight = await Promise.race([cloneRequisition(b, g.org, n), new Promise<'esperando'>((r) => setTimeout(() => r('esperando'), 4000))]);
    expect(inFlight, 'a transação B ficou esperando a A pelo mesmo número').not.toBe('esperando');
    if (inFlight === 'esperando') return;
    expect(inFlight.ok, inFlight.message ?? '').toBe(true);
    expect(inFlight.n).not.toBe(n);
    expect(inFlight.n).toMatch(/^RC-\d{6}-[0-9A-F]{5}$/);
    await b.c.query('ROLLBACK');
    await a.c.query('COMMIT');

    // Confirmado: o mesmo número de novo é trocado na hora (antes: 23505 em preqn_number_unique).
    await b.c.query('BEGIN');
    const committed = await cloneRequisition(b, g.org, n);
    expect(committed.ok, committed.message ?? '').toBe(true);
    expect(committed.n).not.toBe(n);
    await b.c.query('ROLLBACK');
    expect((await one<{ c: number }>(db, `SELECT count(*)::int AS c FROM public.purchase_requisitions WHERE organization_id = $1
      AND requisition_number = $2`, [g.org, n])).c).toBe(1);
  } finally {
    for (const s of [a, b]) { await s.c.query('ROLLBACK').catch(() => undefined); await s.c.end().catch(() => undefined); }
  }
});
