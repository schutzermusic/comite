/**
 * MATRIZ DE PAPÉIS — sessões REAIS de cada papel, contra a API e contra a
 * RLS (cliente do navegador com o JWT da pessoa, sem o servidor no meio).
 *
 * A expectativa não é digitada à mão: sai do RBAC canônico do banco
 * (`role_permissions`). Para cada rota de escrita, o teste declara as chaves
 * que ela aceita (espelho do código da rota) e conclui, papel a papel, se a
 * resposta tem de ser 403. Esconder botão não é autorização: aqui o botão nem
 * existe — é a chamada crua.
 */
import { expect, test } from '@playwright/test';
import type pg from 'pg';
import { issuedPurchaseOrder } from '../../scripts/operations/lib/fixtures.mjs';
import { apiAs, browserClientAs, governed, one, qaDb, qaLive, tag, type QaRole } from './support';

const ROLES: QaRole[] = ['owner', 'gestor', 'engenharia', 'compras', 'almoxarifado', 'financeiro', 'juridico', 'rh'];
const FAKE = '00000000-0000-4000-8000-00000000abcd';

/** Rotas de escrita e as chaves que cada uma aceita (qualquer uma). Corpo inválido: quem PASSA a autorização recebe 400/404/422. */
const WRITES: Array<{ label: string; path: string; body: unknown; anyOf: string[] }> = [
  { label: 'reservar estoque', path: '/api/supply/inventory/reservations', body: {}, anyOf: ['inventory.reserve'] },
  { label: 'ajustar estoque', path: '/api/supply/inventory/adjustments', body: {}, anyOf: ['inventory.manage'] },
  { label: 'pedir transferência', path: '/api/supply/inventory/transfers', body: {}, anyOf: ['inventory.manage', 'inventory.reserve'] },
  { label: 'abrir contagem', path: '/api/supply/inventory/counts', body: {}, anyOf: ['inventory.manage'] },
  { label: 'cadastrar local', path: '/api/supply/inventory/locations', body: {}, anyOf: ['inventory.manage'] },
  { label: 'cadastrar item', path: '/api/supply/items', body: {}, anyOf: ['supply.plan'] },
  { label: 'cadastrar fornecedor', path: '/api/supply/suppliers', body: {}, anyOf: ['suppliers.manage'] },
  { label: 'requisitar compra', path: '/api/supply/procurement/requisitions', body: {}, anyOf: ['procurement.request'] },
  { label: 'abrir cotação', path: '/api/supply/procurement/rfqs', body: {}, anyOf: ['procurement.source'] },
  { label: 'declarar alçada', path: '/api/supply/procurement/authorities', body: {}, anyOf: ['procurement.authorities.manage'] },
  { label: 'aprovar pedido', path: `/api/supply/procurement/purchase-orders/${FAKE}`, body: { action: 'approve' }, anyOf: ['procurement.approve'] },
  { label: 'emitir pedido', path: `/api/supply/procurement/purchase-orders/${FAKE}`, body: { action: 'issue' }, anyOf: ['procurement.orders.issue'] },
  { label: 'sincronizar aprovação', path: `/api/supply/procurement/purchase-orders/${FAKE}`, body: { action: 'sync' },
    anyOf: ['procurement.source', 'procurement.orders.issue', 'procurement.approve'] },
  { label: 'receber mercadoria', path: '/api/supply/receiving/receipts', body: {}, anyOf: ['receiving.receive'] },
  { label: 'registrar embarque', path: '/api/supply/receiving/shipments', body: {}, anyOf: ['receiving.receive', 'procurement.orders.issue'] },
  { label: 'requisito de planejamento', path: '/api/operations/requirements', body: {}, anyOf: ['operations.planning.manage'] },
  { label: 'gerar OS do pacote', path: '/api/operations/service-orders/generate', body: {}, anyOf: ['commercial.service_orders.manage'] },
];

const READS: Array<{ label: string; path: string; anyOf: string[] }> = [
  { label: 'visão de Operações', path: '/api/operations/overview', anyOf: ['operations.view'] },
  { label: 'visão de Supply', path: '/api/supply/overview', anyOf: ['supply.view'] },
  { label: 'estoque', path: '/api/supply/inventory', anyOf: ['inventory.view', 'supply.view'] },
  { label: 'compras', path: '/api/supply/procurement', anyOf: ['procurement.view', 'supply.view'] },
  { label: 'recebimentos', path: '/api/supply/receiving', anyOf: ['receiving.view', 'supply.view', 'procurement.view'] },
];

let db: pg.Client;
let grants: Record<QaRole, Set<string>>;
let poId: string;

test.beforeAll(async () => {
  db = await qaDb();
  const live = qaLive();
  grants = {} as Record<QaRole, Set<string>>;
  for (const role of ROLES) {
    const { rows } = await db.query(`SELECT p.key FROM public.user_roles ur JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      JOIN public.permissions p ON p.id = rp.permission_id WHERE ur.user_id = $1 AND ur.organization_id = $2`,
      [live.users[role].id, live.organization.id]);
    grants[role] = new Set(rows.map((r) => r.key as string));
  }
  // Um pedido emitido no inquilino, para a leitura por RLS ter o que mostrar (ou esconder).
  const g = await governed(db); const t = tag();
  const item = await g.item(`RM-${t}`); const project = await g.project(`RM${t}`);
  const site = await g.location(`RM-S-${t}`, 'PROJECT_SITE', { project_id: project });
  const req = await g.material(project, item, 10);
  const ctx = { one: (sql: string, p: unknown[] = []) => one(db, sql, p), all: async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows };
  poId = (await issuedPurchaseOrder(ctx, { org: g.org, actor: g.actor }, { tag: `RM${t}`, requirementIds: [req],
    prices: { [item]: 99 }, deliveryLocationId: site })).poId;
});
test.afterAll(async () => { await db?.end(); });

const allowed = (role: QaRole, anyOf: string[]) => anyOf.some((k) => grants[role].has(k));

for (const role of ROLES) {
  test(`API — ${role}: escrita autorizada exatamente pelo RBAC do banco`, async () => {
    const api = await apiAs(role);
    const mismatches: string[] = [];
    for (const w of WRITES) {
      const res = await api.post(w.path, { data: w.body });
      const expectForbidden = !allowed(role, w.anyOf);
      if ((res.status() === 403) !== expectForbidden) {
        mismatches.push(`${w.label}: esperado ${expectForbidden ? '403' : 'passar a autorização'}, veio ${res.status()}`);
      }
    }
    for (const r of READS) {
      const res = await api.get(r.path);
      const expectForbidden = !allowed(role, r.anyOf);
      if ((res.status() === 403) !== expectForbidden || (!expectForbidden && res.status() !== 200)) {
        mismatches.push(`leitura ${r.label}: esperado ${expectForbidden ? '403' : '200'}, veio ${res.status()}`);
      }
    }
    expect(mismatches, mismatches.join('\n')).toEqual([]);
  });
}

test('RLS — nenhum papel escreve direto em tabela governada nem executa função protegida', async () => {
  for (const role of ROLES) {
    const sb = await browserClientAs(role);
    const ins = await sb.from('inventory_movements').insert({ movement_type: 'ADJUSTMENT', quantity: 1 });
    expect(ins.error, `${role} inseriu no livro`).not.toBeNull();
    const upd = await sb.from('purchase_orders').update({ status: 'APPROVED' }).eq('id', poId).select();
    expect((upd.data ?? []).length, `${role} alterou pedido`).toBe(0);
    const rpc = await sb.rpc('inventory_reserve', { p_organization_id: qaLive().organization.id, p_actor: qaLive().users[role].id, p_payload: {} });
    expect(rpc.error?.message ?? '', `${role} executou função governada`).toMatch(/permission denied|not find|does not exist/i);
  }
});

test('RLS — leitura do pedido segue o RBAC; o outro inquilino não vê nada', async () => {
  const policyKeys = ['procurement.view', 'supply.view', 'receiving.view', 'operations.planning.view', 'projects.view'];
  for (const role of ROLES) {
    const sb = await browserClientAs(role);
    const { data, error } = await sb.from('purchase_orders').select('id').eq('id', poId);
    expect(error).toBeNull();
    expect((data ?? []).length, `${role} leitura do pedido`).toBe(allowed(role, policyKeys) ? 1 : 0);
  }
  const outsider = await browserClientAs('outsider');
  for (const table of ['purchase_orders', 'purchase_order_lines', 'inventory_movements', 'project_requirements', 'supply_items']) {
    const { data } = await outsider.from(table).select('*').eq('organization_id', qaLive().organization.id).limit(5);
    expect((data ?? []).length, `outro inquilino leu ${table}`).toBe(0);
  }
});

test('sobreposição DENY vence o papel na API (sessão real)', async () => {
  const live = qaLive();
  const perm = await one<{ id: string }>(db, `SELECT id FROM public.permissions WHERE key = 'inventory.reserve'`);
  await db.query(`INSERT INTO public.user_permission_overrides (user_id, organization_id, permission_id, effect)
    VALUES ($1,$2,$3,'deny')`, [live.users.gestor.id, live.organization.id, perm.id]);
  try {
    const api = await apiAs('gestor');
    expect((await api.post('/api/supply/inventory/reservations', { data: {} })).status()).toBe(403);
    expect((await api.post('/api/supply/inventory/transfers', { data: {} })).status()).toBe(403);
  } finally {
    await db.query(`DELETE FROM public.user_permission_overrides WHERE user_id = $1 AND permission_id = $2`, [live.users.gestor.id, perm.id]);
  }
});

test('outro inquilino, com papel de titular no DELE, não age sobre dados deste', async () => {
  const g = await governed(db); const t = tag();
  const item = await g.item(`TX-${t}`); const wh = await g.location(`TX-W-${t}`, 'WAREHOUSE');
  await g.stock(item, wh, 10);
  const project = await g.project(`TX${t}`); const req = await g.material(project, item, 5);
  const outsider = await apiAs('outsider');
  const res = await outsider.post('/api/supply/inventory/reservations', { data: { requirementId: req, locationId: wh, quantity: 5, idempotencyKey: `tx-${t}` } });
  expect(res.status()).toBe(422);
  expect((await res.json()).error).toMatch(/não encontrad|not found/i);
  const r = await one(db, `SELECT count(*)::int n FROM public.inventory_reservations WHERE requirement_id = $1`, [req]);
  expect(r.n).toBe(0);
});
