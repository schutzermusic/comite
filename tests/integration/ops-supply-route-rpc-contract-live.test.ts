/**
 * CONTRATO ROTA → RPC do Supply, conferido contra o catálogo do banco vivo.
 *
 * Os E2E provam navegador → rota (as escritas são interceptadas para não
 * gravar dado real) e os `apply-2xx` provam RPC → banco (dentro de SAVEPOINT
 * revertido). O elo do meio — a rota chamar a função certa, com os nomes de
 * parâmetro certos — só falharia em produção. Aqui cada rota de escrita de
 * Operações e Supply é chamada com sessão simulada; a chamada RPC é CAPTURADA
 * (nada é executado) e comparada com `pg_proc`: a função existe, recebe
 * exatamente esses parâmetros e nenhum obrigatório ficou de fora. Somente
 * leitura. (O upload de PDF de OS depende do armazenamento e fica de fora.)
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import pg from 'pg';

for (const f of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* ausente em CI */ }
}
const DB = process.env.SUPABASE_DB_URL;
const suite = DB ? describe : describe.skip;

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const captured: Array<{ fn: string; params: Record<string, unknown> }> = [];

// Cadeia de consulta do Supabase que devolve uma linha plausível para as leituras auxiliares das rotas.
function chain(row: Record<string, unknown>) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'or', 'order', 'limit', 'not', 'gte', 'gt', 'lte']) q[m] = () => q;
  q.maybeSingle = async () => ({ data: row, error: null });
  q.single = async () => ({ data: row, error: null });
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: [row], error: null });
  return q;
}
const signalRow = { id: U(1), status: 'OPEN', title: 'Sinal', project_id: 'p1', requirement_id: U(2), purchase_order_id: U(3),
  approval_request_id: U(4), recommended_action: { kind: 'RESERVE', payload: { source_kind: 'purchase_order', source_id: U(3), goal: 'Cobrar' } } };

vi.mock('@/lib/platform/server-client', () => ({
  platformServiceClient: () => ({
    rpc: async (fn: string, params: Record<string, unknown>) => {
      captured.push({ fn, params });
      // Formato plausível para o que as rotas leem depois da chamada (a RPC em si não é executada).
      return { data: { ok: true, created: true, replayed: false, status: 'DRAFT', service_order_id: U(70), requirement_id: U(71),
        item_id: U(72), divergences_opened: 0, divergences: [], imported: 0, revision: 1, reservation_id: U(73) }, error: null };
    },
    from: () => chain(signalRow),
    storage: { from: () => ({ createSignedUploadUrl: async () => ({ data: { token: 't' }, error: null }) }) },
  }),
}));
vi.mock('@/lib/operations/session', () => {
  const session = { organizationId: U(90), user: { id: U(91) }, supabase: { from: () => chain(signalRow) }, permissions: new Set<string>() };
  return {
    requireOperationsSession: async () => session,
    requireAnyOperationsPermission: async () => session,
    isSessionError: () => false,
    hasOptionalPermission: async () => true,
    safeOperationsError: (m: string) => m,
  };
});
vi.mock('@/lib/audit/log-audit-event-server', () => ({ logAuditEventServer: async () => ({ ok: true }) }));
vi.mock('@/lib/platform/followups/session', () => ({
  createFollowupAsHuman: async (_key: string, input: Record<string, unknown>) => {
    captured.push({ fn: 'apex_followup_create', params: { p_source_kind: input.sourceKind, p_source_id: input.sourceId, p_goal: input.goal } });
    return { id: U(80) };
  },
}));

type Call = { route: string; method: 'POST' | 'PATCH' | 'PUT'; body: Record<string, unknown>; params?: Record<string, string> };
const CALLS: Call[] = [
  { route: 'supply/items/route', method: 'POST', body: { code: 'CAB-1', description: 'Cabo', unit: 'm' } },
  { route: 'supply/items/[id]/route', method: 'PATCH', params: { id: U(5) }, body: { description: 'Cabo 2' } },
  { route: 'supply/inventory/locations/route', method: 'POST', body: { code: 'ALM', name: 'Almox', kind: 'WAREHOUSE' } },
  { route: 'supply/inventory/locations/[id]/route', method: 'PATCH', params: { id: U(5) }, body: { name: 'Almox 2' } },
  { route: 'supply/inventory/adjustments/route', method: 'POST', body: { itemId: U(6), locationId: U(7), quantity: 5, reason: 'Saldo inicial' } },
  { route: 'supply/inventory/reservations/route', method: 'POST', body: { requirementId: U(2), locationId: U(7), quantity: 5 } },
  { route: 'supply/inventory/reservations/[id]/route', method: 'POST', params: { id: U(8) }, body: { action: 'release', quantity: 1, reason: 'Replanejado' } },
  { route: 'supply/inventory/reservations/[id]/route', method: 'POST', params: { id: U(8) }, body: { action: 'issue', quantity: 1 } },
  { route: 'supply/inventory/reservations/[id]/route', method: 'POST', params: { id: U(8) }, body: { action: 'return', quantity: 1, reason: 'Sobra' } },
  { route: 'supply/inventory/transfers/route', method: 'POST', body: { fromLocationId: U(7), toLocationId: U(9), lines: [{ itemId: U(6), quantity: 1 }] } },
  ...['approve', 'dispatch', 'close'].map((action) => ({ route: 'supply/inventory/transfers/[id]/route', method: 'POST' as const, params: { id: U(10) },
    body: { action } })),
  { route: 'supply/inventory/transfers/[id]/route', method: 'POST', params: { id: U(10) }, body: { action: 'receive', lines: [{ lineId: U(11), quantity: 1 }] } },
  { route: 'supply/inventory/transfers/[id]/route', method: 'POST', params: { id: U(10) }, body: { action: 'cancel', reason: 'Desistência' } },
  { route: 'supply/inventory/counts/route', method: 'POST', body: { locationId: U(7) } },
  { route: 'supply/inventory/counts/[id]/route', method: 'POST', params: { id: U(12) }, body: { action: 'record', lines: [{ lineId: U(13), countedQuantity: 1 }] } },
  { route: 'supply/inventory/counts/[id]/route', method: 'POST', params: { id: U(12) }, body: { action: 'post' } },
  { route: 'supply/inventory/counts/[id]/route', method: 'POST', params: { id: U(12) }, body: { action: 'cancel', reason: 'Refazer' } },
  { route: 'supply/suppliers/route', method: 'POST', body: { legalName: 'Fornecedor SA' } },
  { route: 'supply/suppliers/[id]/route', method: 'POST', params: { id: U(14) }, body: { status: 'HOMOLOGATED' } },
  { route: 'supply/procurement/authorities/route', method: 'POST', body: { granteeKind: 'ROLE', granteeRoleId: U(15), sourceKind: 'BYLAWS',
    sourceReference: 'Estatuto', justification: 'Alçada' } },
  { route: 'supply/procurement/authorities/[id]/route', method: 'POST', params: { id: U(16) }, body: { action: 'revoke', reason: 'Mudou' } },
  { route: 'supply/procurement/requisitions/route', method: 'POST', body: { source: 'SHORTAGE', requirementIds: [U(2)] } },
  { route: 'supply/procurement/requisitions/route', method: 'POST', body: { source: 'MANUAL', justification: 'Compra emergencial de reposição',
    lines: [{ itemId: U(6), quantity: 1 }] } },
  { route: 'supply/procurement/requisitions/[id]/route', method: 'POST', params: { id: U(17) }, body: { action: 'cancel', reason: 'Duplicada' } },
  { route: 'supply/procurement/rfqs/route', method: 'POST', body: { requisitionLineIds: [U(18)], supplierIds: [U(14)] } },
  { route: 'supply/procurement/rfqs/[id]/route', method: 'POST', params: { id: U(19) }, body: { action: 'quote', supplierId: U(14),
    lines: [{ rfqLineId: U(20), unitPrice: 10 }] } },
  { route: 'supply/procurement/rfqs/[id]/route', method: 'POST', params: { id: U(19) }, body: { action: 'decide', quoteId: U(21),
    rationale: 'Melhor custo e prazo' } },
  ...[{ action: 'update', expectedDelivery: '2026-10-01' }, { action: 'submit' }, { action: 'approve' }, { action: 'reject', note: 'Rever preço' },
    { action: 'sync' }, { action: 'issue' }, { action: 'cancel', reason: 'Desistência' }, { action: 'close', reason: 'Saldo cancelado' }]
    .map((body) => ({ route: 'supply/procurement/purchase-orders/[id]/route', method: 'POST' as const, params: { id: U(3) }, body })),
  { route: 'supply/receiving/receipts/route', method: 'POST', body: { purchaseOrderId: U(3), lines: [{ poLineId: U(22), acceptedQuantity: 1 }] } },
  { route: 'supply/receiving/receipts/[id]/route', method: 'POST', params: { id: U(23) }, body: { destinationLocationId: U(7),
    lines: [{ lineId: U(24), approvedQuantity: 1 }] } },
  { route: 'supply/receiving/shipments/route', method: 'POST', body: { purchaseOrderId: U(3), status: 'IN_TRANSIT', carrier: 'Rodo' } },
  { route: 'supply/intelligence/signals/[id]/route', method: 'POST', params: { id: U(1) }, body: { action: 'execute', quantity: 1 } },
  { route: 'supply/intelligence/signals/[id]/route', method: 'POST', params: { id: U(1) }, body: { action: 'dismiss', note: 'Cliente fornece' } },
  { route: 'supply/intelligence/signals/[id]/route', method: 'POST', params: { id: U(1) }, body: { action: 'follow_up', responsibleText: 'Comprador' } },
  // ── Operações (230/231) ──
  { route: 'operations/service-orders/generate/route', method: 'POST', body: { acceptanceId: U(30) } },
  { route: 'operations/service-orders/[id]/route', method: 'PATCH', params: { id: U(31) }, body: { title: 'OS', siteLabel: 'SE Norte' } },
  { route: 'operations/service-orders/[id]/items/route', method: 'POST', params: { id: U(31) }, body: { kind: 'SCOPE', title: 'Montagem' } },
  { route: 'operations/service-orders/[id]/items/route', method: 'PUT', params: { id: U(31) }, body: { decisions: [{ itemId: U(32), decision: 'CONFIRMED' }] } },
  { route: 'operations/service-orders/[id]/seed/route', method: 'POST', params: { id: U(31) }, body: {} },
  { route: 'operations/service-orders/[id]/compare/route', method: 'POST', params: { id: U(31) }, body: {} },
  { route: 'operations/service-orders/[id]/issue/route', method: 'POST', params: { id: U(31) }, body: { mode: 'normal' } },
  { route: 'operations/service-orders/[id]/issue/route', method: 'POST', params: { id: U(31) }, body: { mode: 'exception',
    reason: 'Divergência aceita pela diretoria com registro.' } },
  { route: 'operations/service-orders/[id]/amend/route', method: 'POST', params: { id: U(31) }, body: { reason: 'Cliente ampliou o escopo',
    addItems: [{ kind: 'SCOPE', title: 'Novo item' }] } },
  { route: 'operations/requirements/route', method: 'POST', body: { projectId: 'p1', requirementType: 'MATERIAL', title: 'Cabo', quantity: 10,
    itemId: U(6) } },
  { route: 'operations/requirements/[id]/route', method: 'PATCH', params: { id: U(2) }, body: { quantity: 12 } },
  { route: 'operations/requirements/[id]/transition/route', method: 'POST', params: { id: U(2) }, body: { to: 'CONFIRMED' } },
  { route: 'operations/requirements/[id]/satisfy/route', method: 'POST', params: { id: U(2) }, body: { note: 'Documento recebido' } },
  { route: 'operations/projects/[id]/requirements/import/route', method: 'POST', params: { id: 'p1' }, body: { serviceOrderId: U(31) } },
];

/** Mapa ESTÁTICO de rotas (o Vite não resolve import dinâmico com variável entre diretórios). */
const ROUTES: Record<string, () => Promise<Record<string, unknown>>> = {
  'operations/projects/[id]/requirements/import/route': () => import('@/app/api/operations/projects/[id]/requirements/import/route'),
  'operations/requirements/[id]/route': () => import('@/app/api/operations/requirements/[id]/route'),
  'operations/requirements/[id]/satisfy/route': () => import('@/app/api/operations/requirements/[id]/satisfy/route'),
  'operations/requirements/[id]/transition/route': () => import('@/app/api/operations/requirements/[id]/transition/route'),
  'operations/requirements/route': () => import('@/app/api/operations/requirements/route'),
  'operations/service-orders/[id]/amend/route': () => import('@/app/api/operations/service-orders/[id]/amend/route'),
  'operations/service-orders/[id]/compare/route': () => import('@/app/api/operations/service-orders/[id]/compare/route'),
  'operations/service-orders/[id]/issue/route': () => import('@/app/api/operations/service-orders/[id]/issue/route'),
  'operations/service-orders/[id]/items/route': () => import('@/app/api/operations/service-orders/[id]/items/route'),
  'operations/service-orders/[id]/route': () => import('@/app/api/operations/service-orders/[id]/route'),
  'operations/service-orders/[id]/seed/route': () => import('@/app/api/operations/service-orders/[id]/seed/route'),
  'operations/service-orders/generate/route': () => import('@/app/api/operations/service-orders/generate/route'),
  'supply/intelligence/signals/[id]/route': () => import('@/app/api/supply/intelligence/signals/[id]/route'),
  'supply/inventory/adjustments/route': () => import('@/app/api/supply/inventory/adjustments/route'),
  'supply/inventory/counts/[id]/route': () => import('@/app/api/supply/inventory/counts/[id]/route'),
  'supply/inventory/counts/route': () => import('@/app/api/supply/inventory/counts/route'),
  'supply/inventory/locations/[id]/route': () => import('@/app/api/supply/inventory/locations/[id]/route'),
  'supply/inventory/locations/route': () => import('@/app/api/supply/inventory/locations/route'),
  'supply/inventory/reservations/[id]/route': () => import('@/app/api/supply/inventory/reservations/[id]/route'),
  'supply/inventory/reservations/route': () => import('@/app/api/supply/inventory/reservations/route'),
  'supply/inventory/transfers/[id]/route': () => import('@/app/api/supply/inventory/transfers/[id]/route'),
  'supply/inventory/transfers/route': () => import('@/app/api/supply/inventory/transfers/route'),
  'supply/items/[id]/route': () => import('@/app/api/supply/items/[id]/route'),
  'supply/items/route': () => import('@/app/api/supply/items/route'),
  'supply/procurement/authorities/[id]/route': () => import('@/app/api/supply/procurement/authorities/[id]/route'),
  'supply/procurement/authorities/route': () => import('@/app/api/supply/procurement/authorities/route'),
  'supply/procurement/purchase-orders/[id]/route': () => import('@/app/api/supply/procurement/purchase-orders/[id]/route'),
  'supply/procurement/requisitions/[id]/route': () => import('@/app/api/supply/procurement/requisitions/[id]/route'),
  'supply/procurement/requisitions/route': () => import('@/app/api/supply/procurement/requisitions/route'),
  'supply/procurement/rfqs/[id]/route': () => import('@/app/api/supply/procurement/rfqs/[id]/route'),
  'supply/procurement/rfqs/route': () => import('@/app/api/supply/procurement/rfqs/route'),
  'supply/receiving/receipts/[id]/route': () => import('@/app/api/supply/receiving/receipts/[id]/route'),
  'supply/receiving/receipts/route': () => import('@/app/api/supply/receiving/receipts/route'),
  'supply/receiving/shipments/route': () => import('@/app/api/supply/receiving/shipments/route'),
  'supply/suppliers/[id]/route': () => import('@/app/api/supply/suppliers/[id]/route'),
  'supply/suppliers/route': () => import('@/app/api/supply/suppliers/route'),
};

suite('Operações & Supply · contrato rota → RPC contra o catálogo do banco (somente leitura)', () => {
  let db: pg.Client;
  beforeAll(async () => {
    db = new pg.Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
    await db.connect();
    // Pooler em modo transação: SET SESSION vazaria para outros clientes. A transação READ ONLY fica presa
    // a uma conexão, é de fato somente leitura e termina com ROLLBACK.
    await db.query('BEGIN TRANSACTION READ ONLY');
  }, 30_000);
  afterAll(async () => { await db?.query('ROLLBACK').catch(() => undefined); await db?.end(); });

  it('cada rota chama uma função existente, com os nomes de parâmetro dela e todos os obrigatórios', async () => {
    const problems: string[] = [];
    for (const call of CALLS) {
      const before = captured.length;
      const load = ROUTES[call.route];
      if (!load) { problems.push(`${call.route}: rota não mapeada`); continue; }
      const mod = await load();
      const handler = mod[call.method] as (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>;
      const response = await handler(new Request('http://test.local/api', { method: call.method, headers: { 'content-type': 'application/json' },
        body: JSON.stringify(call.body) }), { params: Promise.resolve(call.params ?? {}) });
      const payload = await response.json().catch(() => ({}));
      if (response.status >= 400) problems.push(`${call.route} ${JSON.stringify(call.body)} → ${response.status} ${payload?.error ?? ''}`);
      const made = captured.slice(before);
      if (!made.length) problems.push(`${call.route} ${JSON.stringify(call.body)} → nenhuma RPC chamada`);
      for (const c of made) {
        if (c.fn === 'apex_followup_create') continue; // RPC de sessão da plataforma (156/212), já coberta pela plataforma.
        const rows = (await db.query(`SELECT pg_get_function_arguments(p.oid) args FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = $1`, [c.fn])).rows as Array<{ args: string }>;
        if (!rows.length) { problems.push(`${c.fn}: não existe no banco`); continue; }
        const ok = rows.some(({ args }) => {
          const defs = args.split(/,(?![^(]*\))/).map((a) => a.trim()).filter(Boolean);
          const names = defs.map((d) => d.split(/\s+/)[0]);
          const required = defs.filter((d) => !/\bDEFAULT\b/i.test(d)).map((d) => d.split(/\s+/)[0]);
          const given = Object.keys(c.params);
          return given.every((g) => names.includes(g)) && required.every((r) => given.includes(r));
        });
        if (!ok) problems.push(`${c.fn}(${Object.keys(c.params).join(', ')}) não casa com ${rows.map((r) => `(${r.args})`).join(' | ')}`);
      }
    }
    expect(problems).toEqual([]);
    expect(captured.length).toBeGreaterThanOrEqual(CALLS.length);
  }, 120_000);
});
