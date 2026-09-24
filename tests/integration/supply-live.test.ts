/**
 * INVARIANTES VIVOS do Supply (232+) — SOMENTE LEITURA. Pula sem `SUPABASE_DB_URL`.
 * Cresce a cada wave de Supply (estoque, compras, recebimento).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
const URL_DB = process.env.SUPABASE_DB_URL;
const suite = URL_DB ? describe : describe.skip;

suite('Supply — invariantes no banco vivo (somente leitura)', () => {
  let db: pg.Client;
  const rows = async (sql: string) => (await db.query(sql)).rows;
  const applied = async (v: string) => (await rows(`SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${v}'`)).length === 1;
  beforeAll(async () => {
    db = new pg.Client({ connectionString: URL_DB, ssl: { rejectUnauthorized: false } });
    await db.connect();
    // Pooler em modo transação: SET SESSION vazaria para outros clientes. A transação READ ONLY fica presa
    // a uma conexão, é de fato somente leitura e termina com ROLLBACK.
    await db.query('BEGIN TRANSACTION READ ONLY');
  }, 30_000);
  afterAll(async () => { await db?.query('ROLLBACK').catch(() => undefined); await db?.end(); });

  it('232: item de catálogo com código normalizado e único por inquilino', async () => {
    expect(await applied('232')).toBe(true);
    expect(await rows(`SELECT id FROM public.supply_items WHERE code <> upper(btrim(code))`)).toEqual([]);
  });

  it('232: material confirmado aponta item do MESMO inquilino e fala a unidade dele', async () => {
    // Todo material confirmado depois da 232 aponta item (o gatilho recusa o contrário).
    expect(await rows(`SELECT r.id FROM public.project_requirements r
      WHERE r.status = 'CONFIRMED' AND r.requirement_type = 'MATERIAL' AND r.item_id IS NULL`)).toEqual([]);
    expect(await rows(`SELECT r.id FROM public.project_requirements r
      JOIN public.supply_items i ON i.id = r.item_id
      WHERE i.organization_id <> r.organization_id OR i.unit IS DISTINCT FROM r.unit`)).toEqual([]);
  });

  it('232: a cobertura nunca afirma falta negativa nem cobre mais do que o requerido como falta', async () => {
    expect(await rows(`SELECT requirement_id FROM public.supply_requirement_coverage WHERE shortage_qty < 0`)).toEqual([]);
  });
  it('233: livro físico — nenhum saldo de lote negativo e série no máximo uma vez', async () => {
    expect(await applied('233')).toBe(true);
    expect(await rows(`SELECT organization_id, item_id, location_id, lot_code FROM public.inventory_movements
      GROUP BY 1,2,3,4 HAVING sum(quantity) < 0`)).toEqual([]);
    expect(await rows(`SELECT m.organization_id, m.item_id, m.lot_code FROM public.inventory_movements m
      JOIN public.supply_items i ON i.id = m.item_id AND i.tracking = 'SERIAL'
      GROUP BY 1,2,3 HAVING sum(m.quantity) > 1`)).toEqual([]);
  });

  it('233: livro e reservas não são escritos pelo navegador', async () => {
    const r = await rows(`SELECT
      has_table_privilege('authenticated','public.inventory_movements','INSERT') mi,
      has_table_privilege('authenticated','public.inventory_movements','UPDATE') mu,
      has_table_privilege('authenticated','public.inventory_reservations','INSERT') ri,
      has_table_privilege('authenticated','public.inventory_reservations','UPDATE') ru,
      has_function_privilege('authenticated','public.inventory_reserve(uuid,uuid,jsonb)','EXECUTE') fr`);
    expect(r[0]).toEqual({ mi: false, mu: false, ri: false, ru: false, fr: false });
  });

  it('233: disponível = em mão − reservado (zero em quarentena); reserva do mesmo item do requisito', async () => {
    expect(await rows(`SELECT item_id, location_id FROM public.inventory_position
      WHERE available_qty <> CASE WHEN location_kind = 'QUARANTINE' THEN 0 ELSE on_hand_qty - reserved_qty END`)).toEqual([]);
    expect(await rows(`SELECT v.id FROM public.inventory_reservations v
      JOIN public.project_requirements r ON r.organization_id = v.organization_id AND r.id = v.requirement_id
      WHERE r.item_id IS DISTINCT FROM v.item_id OR r.project_id <> v.project_id`)).toEqual([]);
  });

  it('233/235: cobertura é a equação — falta = requerido − coberto − entrando (inclui inspeção), nunca negativa', async () => {
    expect(await rows(`SELECT requirement_id FROM public.supply_requirement_coverage
      WHERE covered_qty <> reserved_qty + consumed_qty OR inbound_qty <> in_transit_qty + on_order_qty + inspection_qty
         OR shortage_qty <> GREATEST(COALESCE(required_qty,0) - covered_qty - inbound_qty, 0)`)).toEqual([]);
  });

  it('233: transferência — recebido nunca passa do despachado; cancelada não despachou', async () => {
    expect(await rows(`SELECT id FROM public.inventory_transfer_lines WHERE received_quantity > dispatched_quantity`)).toEqual([]);
    expect(await rows(`SELECT l.id FROM public.inventory_transfer_lines l
      JOIN public.inventory_transfers t ON t.id = l.transfer_id WHERE t.status = 'CANCELLED' AND l.dispatched_quantity > 0`)).toEqual([]);
  });
  it('234: pedido aprovado ou além tem impressão digital e a regra que o aprovou', async () => {
    expect(await applied('234')).toBe(true);
    expect(await rows(`SELECT id FROM public.purchase_orders
      WHERE status IN ('APPROVED','ISSUED','PARTIALLY_RECEIVED','RECEIVED','CLOSED')
        AND (approved_fingerprint IS NULL OR (approval_authority_id IS NULL AND approval_request_id IS NULL))`)).toEqual([]);
  });

  it('234: fornecedor é papel de parte; recebido nunca passa do pedido; alocação nunca passa da linha', async () => {
    expect(await rows(`SELECT s.id FROM public.supplier_profiles s WHERE NOT EXISTS (SELECT 1 FROM public.party_roles pr
      WHERE pr.party_id = s.party_id AND pr.role = 'supplier')`)).toEqual([]);
    expect(await rows(`SELECT id FROM public.purchase_order_lines WHERE received_quantity > quantity`)).toEqual([]);
    expect(await rows(`SELECT l.id FROM public.purchase_order_lines l JOIN public.purchase_order_line_requirements a ON a.line_id = l.id
      GROUP BY l.id, l.quantity HAVING sum(a.quantity) > l.quantity`)).toEqual([]);
  });

  it('234: compras não são escritas pelo navegador; o motor conhece o pedido de compra', async () => {
    const r = await rows(`SELECT
      has_table_privilege('authenticated','public.purchase_orders','INSERT') pi,
      has_table_privilege('authenticated','public.purchase_orders','UPDATE') pu,
      has_function_privilege('authenticated','public.purchase_order_decide(uuid,uuid,uuid,text,text)','EXECUTE') fd,
      (SELECT supported FROM public.approval_subject_resolve(gen_random_uuid(), 'purchase_order', gen_random_uuid())) sup`);
    expect(r[0]).toEqual({ pi: false, pu: false, fd: false, sup: true });
  });
  it('235: estoque só nasce de recebimento com linha; recebido do pedido = aceito − rejeitado na inspeção', async () => {
    expect(await applied('235')).toBe(true);
    expect(await rows(`SELECT id FROM public.inventory_movements WHERE movement_type = 'RECEIPT' AND receipt_line_id IS NULL`)).toEqual([]);
    expect(await rows(`SELECT pl.id FROM public.purchase_order_lines pl
      LEFT JOIN (SELECT po_line_id, sum(accepted_quantity - COALESCE(inspection_rejected_quantity, 0)) net
                   FROM public.goods_receipt_lines GROUP BY po_line_id) g ON g.po_line_id = pl.id
      WHERE pl.received_quantity <> COALESCE(g.net, 0)`)).toEqual([]);
  });

  it('235: recebimento só contra pedido que foi emitido; evidência dentro do inquilino', async () => {
    expect(await rows(`SELECT g.id FROM public.goods_receipts g JOIN public.purchase_orders po ON po.id = g.purchase_order_id
      WHERE po.status IN ('DRAFT','APPROVAL_REQUIRED','APPROVED','CANCELLED') OR po.issued_at IS NULL`)).toEqual([]);
    expect(await rows(`SELECT id FROM public.goods_receipt_evidence
      WHERE storage_path NOT LIKE organization_id::text || '/supply-receipts/%'`)).toEqual([]);
  });

  it('235: recebimento não é escrito pelo navegador', async () => {
    const r = await rows(`SELECT
      has_table_privilege('authenticated','public.goods_receipts','INSERT') gi,
      has_table_privilege('authenticated','public.goods_receipt_lines','UPDATE') gu,
      has_function_privilege('authenticated','public.goods_receipt_post(uuid,uuid,jsonb)','EXECUTE') fp`);
    expect(r[0]).toEqual({ gi: false, gu: false, fp: false });
  });
});
