/**
 * CAMINHO DOURADO de Operações + Supply, ponta a ponta, no banco real — e
 * SEMPRE revertido (uma transação, ROLLBACK no fim; nada fica gravado).
 *
 *   Pacote aceito (PT+PC) → OS gerada, revisada e emitida → Projeto a partir
 *   da OS → requisitos do Planejamento importados da OS → material com item
 *   e confirmado → cobertura mostra a falta → estoque reservado → requisição
 *   pela falta → cotação → proposta → decisão → pedido → alçada declarada →
 *   aprovação por outra pessoa → emissão → recebimento parcial → recebimento
 *   final → disponibilidade no projeto → entrega à obra → fatos na Timeline.
 *
 * Mais os caminhos de exceção do plano de entrega: aprovação rejeitada,
 * recebimento acima do aberto, cancelar pedido com recebimento, referência
 * de outro inquilino e ação repetida (idempotência).
 *
 *   node scripts/operations/golden-path.mjs
 */
import pg from 'pg';
import dotenv from 'dotenv';
import { createProofContext, realAnchors } from './lib/proof-kit.mjs';
import { acceptedPackage, secondApprover } from './lib/fixtures.mjs';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
await db.query('BEGIN');
await db.query('SET TRANSACTION READ WRITE'); // explícito: nada de herdar estado do pooler
const ctx = createProofContext(db);
const { one, all, check, rejects } = ctx;
let failed = 0;
try {
  const anchors = await realAnchors(db);
  const { org, actor } = anchors;
  const stamp = `GP${Date.now().toString(36).toUpperCase()}`;
  const J = (x) => JSON.stringify(x);
  const act = async (fn, ...args) => (await one(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) r`, args)).r;
  const cov = (req) => one(`SELECT required_qty::float req, reserved_qty::float r, consumed_qty::float c, on_order_qty::float o,
    requested_qty::float q, shortage_qty::float s FROM public.supply_requirement_coverage WHERE requirement_id = $1`, [req]);

  // ── 1) Comercial → OS emitida (com a linha de material que a obra consome) ──
  const pkg = await acceptedPackage(ctx, anchors, stamp);
  const gen = await act('internal_service_order_generate_from_package', org, actor, pkg.acceptanceId, J({ os_number: `OS-${stamp}` }));
  const os = gen.service_order_id;
  await act('internal_service_order_item_upsert', org, actor, os, J({ kind: 'MATERIAL', title: 'Cabo 35 mm²', quantity: 1000, unit: 'm' }));
  const items = await all(`SELECT id FROM public.internal_service_order_items WHERE service_order_id = $1`, [os]);
  await act('internal_service_order_items_decide', org, actor, os, J(items.map((i) => ({ item_id: i.id, decision: 'CONFIRMED' }))));
  await act('internal_service_order_issue', org, actor, os);
  check('OS gerada do pacote aceito, revisada e emitida', (await one(`SELECT status FROM public.internal_service_orders WHERE id = $1`, [os])).status === 'ISSUED');

  // ── 2) Projeto a partir da OS e Planejamento importado da OS ──
  const bind = await act('internal_service_order_bind_project', org, actor, os, `proj-${stamp}`,
    J({ nome: `Projeto ${stamp}`, cliente: 'Prova Operações' }));
  const project = bind.project_id;
  const imported = await act('project_requirements_import_from_service_order', org, actor, project, os);
  const again = await act('project_requirements_import_from_service_order', org, actor, project, os);
  check('requisitos do plano importados da OS (repetir não duplica)', imported.requirements_added >= 1 && again.requirements_added === 0,
    J({ imported, again }));
  const reqRow = await one(`SELECT id, unit FROM public.project_requirements WHERE project_id = $1 AND requirement_type = 'MATERIAL'`, [project]);
  const req = reqRow.id;
  const item = (await one('SELECT public.supply_item_upsert($1,$2,$3) r', [org, actor, J({ code: `CAB-${stamp}`, description: 'Cabo 35 mm²', unit: 'm' })])).r.item_id;
  await act('project_requirement_upsert', org, actor, J({ id: req, item_id: item, required_by: '2026-11-30' }));
  await act('project_requirement_transition', org, actor, req, 'CONFIRMED', null, null);
  let c = await cov(req);
  check('material confirmado vira demanda de Supply com a falta inteira', c.req === 1000 && c.s === 1000, J(c));

  // ── 3) Estoque primeiro ──
  const loc = async (code, kind, extra = {}) => (await act('inventory_location_upsert', org, actor, J({ code: `${code}-${stamp}`, name: code, kind, ...extra }))).location_id;
  const wh = await loc('ALM', 'WAREHOUSE');
  const site = await loc('OBRA', 'PROJECT_SITE', { project_id: project });
  await act('inventory_adjust', org, actor, J({ item_id: item, location_id: wh, quantity: 300, reason: 'Saldo inicial' }));
  await act('inventory_reserve', org, actor, J({ requirement_id: req, location_id: wh, quantity: 300, idempotency_key: `res-${stamp}` }));
  c = await cov(req);
  check('estoque reservado cobre parte; a falta cai', c.r === 300 && c.s === 700, J(c));

  // ── 4) Compra do que falta ──
  const sup = (await act('supplier_register', org, actor, J({ legal_name: `Cabos ${stamp}` }))).supplier_id;
  await act('supplier_set_status', org, actor, sup, 'HOMOLOGATED', null);
  const rc = await act('purchase_requisition_from_shortage', org, actor, J({ requirement_ids: [req], idempotency_key: `rc-${stamp}` }));
  c = await cov(req);
  check('requisição pela falta (requisitado aparece, falta continua visível)', c.q === 700 && c.s === 700, J(c));
  const rl = await one(`SELECT id FROM public.purchase_requisition_lines WHERE requisition_id = $1`, [rc.requisition_id]);
  const rfq = await act('procurement_rfq_create', org, actor, J({ requisition_line_ids: [rl.id], supplier_ids: [sup] }));
  const rfql = await one(`SELECT id FROM public.procurement_rfq_lines WHERE rfq_id = $1`, [rfq.rfq_id]);
  const quote = await act('procurement_quote_record', org, actor, J({ rfq_id: rfq.rfq_id, supplier_id: sup, lead_time_days: 7,
    validity_date: '2099-01-01', lines: [{ rfq_line_id: rfql.id, unit_price: 18.5 }] }));
  const dec = await act('procurement_decide', org, actor, J({ rfq_id: rfq.rfq_id, quote_id: quote.quote_id, rationale: 'Única proposta, dentro do prazo.' }));
  const po = dec.purchase_order_id;
  await act('purchase_order_update_draft', org, actor, po, J({ delivery_location_id: site }));
  await act('purchase_order_submit', org, actor, po, 'Compra do cabo da obra');
  const approver = await secondApprover(ctx, anchors);
  check('há um segundo aprovador no inquilino (segregação de funções)', Boolean(approver));
  await rejects('sem alçada declarada, permissão não basta para aprovar', 'SELECT public.purchase_order_decide($1,$2,$3,$4,$5)',
    [org, approver.user_id, po, 'APPROVE', 'ok'], /authority not configured/);
  await act('procurement_authority_declare', org, actor, J({ grantee_kind: 'ROLE', grantee_role_id: approver.role_id,
    source_kind: 'BOARD_RESOLUTION', source_reference: `ATA-${stamp}`, justification: 'Caminho dourado' }));
  const rej = await act('purchase_order_decide', org, approver.user_id, po, 'REJECT', 'Rever prazo de entrega');
  check('rejeição devolve ao rascunho', rej.status === 'DRAFT');
  await act('purchase_order_submit', org, actor, po, 'Prazo confirmado');
  await act('purchase_order_decide', org, approver.user_id, po, 'APPROVE', 'Dentro da alçada');
  await act('purchase_order_issue', org, actor, po);
  const reissue = await act('purchase_order_issue', org, actor, po);
  c = await cov(req);
  check('pedido emitido é "em pedido" (não estoque); repetir a emissão é idempotente', c.o === 700 && c.q === 0 && c.s === 0 && reissue.replayed, J(c));

  // ── 5) Recebimento parcial e final ──
  const pol = await one(`SELECT id FROM public.purchase_order_lines WHERE purchase_order_id = $1`, [po]);
  const r1 = await act('goods_receipt_post', org, actor, J({ purchase_order_id: po, idempotency_key: `rc1-${stamp}`,
    lines: [{ po_line_id: pol.id, accepted_quantity: 400 }] }));
  const r1b = await act('goods_receipt_post', org, actor, J({ purchase_order_id: po, idempotency_key: `rc1-${stamp}`,
    lines: [{ po_line_id: pol.id, accepted_quantity: 400 }] }));
  c = await cov(req);
  check('recebimento parcial: pedido parcial, recebido reservado na obra, resto em pedido; repetir não entra de novo',
    r1.order_status === 'PARTIALLY_RECEIVED' && r1b.replayed && c.r === 700 && c.o === 300, J(c));
  await rejects('receber acima do aberto é recusado', 'SELECT public.goods_receipt_post($1,$2,$3)',
    [org, actor, J({ purchase_order_id: po, lines: [{ po_line_id: pol.id, accepted_quantity: 301 }] })], /exceeds the open quantity/);
  await rejects('pedido com recebimento não se cancela', 'SELECT public.purchase_order_cancel($1,$2,$3,$4)', [org, actor, po, 'x'], /has receipts/);
  const r2 = await act('goods_receipt_post', org, actor, J({ purchase_order_id: po, lines: [{ po_line_id: pol.id, accepted_quantity: 300 }] }));
  c = await cov(req);
  check('recebimento final completa o pedido e cobre o requisito', r2.order_status === 'RECEIVED' && c.r === 1000 && c.o === 0 && c.s === 0, J(c));

  // ── 6) Disponibilidade no projeto e consumo ──
  // Cada recebimento reservou o que chegou (400 e 300 na obra); a entrega consome uma reserva.
  const siteRes = await one(`SELECT id FROM public.inventory_reservations WHERE requirement_id = $1 AND location_id = $2 AND status = 'ACTIVE'
    ORDER BY quantity DESC LIMIT 1`, [req, site]);
  await act('inventory_issue_to_project', org, actor, J({ reservation_id: siteRes.id, quantity: 400, idempotency_key: `iss-${stamp}` }));
  c = await cov(req);
  const pos = await one(`SELECT on_hand_qty::float h, reserved_qty::float r, available_qty::float a FROM public.inventory_position
    WHERE item_id = $1 AND location_id = $2`, [item, site]);
  check('entrega à obra consome a reserva; disponível não mente', c.c === 400 && c.r === 600 && c.s === 0
    && pos.h === 300 && pos.r === 300 && pos.a === 0, J({ c, pos }));

  // ── 7) Fatos na Timeline do projeto ──
  const ev = new Set((await all(`SELECT DISTINCT event_type FROM public.domain_events WHERE organization_id = $1 AND payload->>'project_id' = $2`,
    [org, project])).map((e) => e.event_type));
  check('Timeline do projeto recebe os fatos canônicos da cadeia',
    ['operations.requirement.confirmed', 'supply.inventory.reserved', 'supply.goods_receipt.project_received', 'supply.inventory.issued']
      .every((t) => ev.has(t)), [...ev].join(','));

  // ── 8) Fronteira de inquilino ──
  const other = await one(`SELECT id FROM public.organizations WHERE id <> $1 LIMIT 1`, [org]);
  await rejects('requisito de um inquilino não é usado por outro', 'SELECT public.purchase_requisition_from_shortage($1,$2,$3)',
    [other.id, actor, J({ requirement_ids: [req] })], /lacks permission|not found in tenant/);
} catch (error) {
  check('caminho dourado concluído sem erro inesperado', false, error.message);
} finally {
  await db.query('ROLLBACK');
  await db.end();
  failed = ctx.results.filter((r) => !r.ok).length;
  console.log(`\n${ctx.results.length - failed}/${ctx.results.length} etapas passaram. ROLLBACK — nada foi gravado.`);
  process.exitCode = failed ? 1 : 0;
}
