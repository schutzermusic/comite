/**
 * 235 — Recebimento & Logística: entrada física governada, inspeção, logística
 * de entrada, base do 3-way match e pontualidade do fornecedor.
 *   node scripts/operations/apply-235.mjs [--apply]
 */
import { runMigration } from './lib/proof-kit.mjs';
import { confirmedMaterial, issuedPurchaseOrder, proofItem, proofProject } from './lib/fixtures.mjs';

const ACTS = ['inbound_shipment_record(uuid,uuid,jsonb)', 'goods_receipt_post(uuid,uuid,jsonb)',
  'goods_receipt_inspect(uuid,uuid,uuid,jsonb)', 'goods_receipt_attach_evidence(uuid,uuid,uuid,jsonb)',
  'purchase_order_close(uuid,uuid,uuid,text)', 'inventory_post_movement(uuid,uuid,text,uuid,uuid,numeric,text,text,jsonb,text)'];

await runMigration({
  version: '235',
  expectedTip: '234',
  async proofs(ctx) {
    const { one, all, check, rejects, browserCannotExecute, tablesAreGoverned, anchors } = ctx;
    const { org, actor } = anchors;
    const stamp = Date.now().toString(36).toUpperCase();
    const J = (x) => JSON.stringify(x);
    const act = async (fn, ...args) => (await one(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) r`, args)).r;
    const coverage = (req) => one(`SELECT reserved_qty::float r, on_order_qty::float o, shortage_qty::float s, inspection_qty::float i
      FROM public.supply_requirement_coverage WHERE requirement_id = $1`, [req]);
    const poStatus = async (po) => (await one(`SELECT status FROM public.purchase_orders WHERE id = $1`, [po])).status;

    await browserCannotExecute(ACTS);
    await tablesAreGoverned(['inbound_shipments', 'goods_receipts', 'goods_receipt_lines', 'goods_receipt_line_requirements',
      'goods_receipt_evidence']);

    // ── Cenário: demanda, locais e um pedido EMITIDO pelo caminho governado ──
    const cab = await proofItem(ctx, anchors, `CAB-${stamp}`, 'm');
    const rel = (await one('SELECT public.supply_item_upsert($1,$2,$3) r', [org, actor,
      J({ code: `REL-${stamp}`, description: 'Relé de proteção', unit: 'un', tracking: 'SERIAL' })])).r.item_id;
    const project = await proofProject(ctx, anchors, `P235-${stamp}`);
    const reqA = await confirmedMaterial(ctx, anchors, project, cab, 1000, '2026-11-10');
    const reqS = await confirmedMaterial(ctx, anchors, project, rel, 2, '2026-11-12');
    const loc = async (code, kind, extra = {}) => (await act('inventory_location_upsert', org, actor,
      J({ code: `${code}-${stamp}`, name: code, kind, ...extra }))).location_id;
    const site = await loc('OBRA', 'PROJECT_SITE', { project_id: project });
    const quar = await loc('QUAR', 'QUARANTINE');
    const po = await issuedPurchaseOrder(ctx, anchors, { tag: stamp, requirementIds: [reqA, reqS],
      prices: { [cab]: 19, [rel]: 500 }, deliveryLocationId: site });
    check('pedido emitido pelo caminho governado (falta → requisição → cotação → alçada → emissão)', await poStatus(po.poId) === 'ISSUED');
    let cov = await coverage(reqA);
    check('pedido emitido é "em pedido", não estoque (INV-11)', cov.o === 1000 && cov.r === 0, J(cov));
    const onHand0 = await one(`SELECT count(*)::int n FROM public.inventory_movements WHERE item_id = $1`, [cab]);
    check('emitir não posta nada no livro', onHand0.n === 0);

    // ── Logística ────────────────────────────────────────────────────────
    const ship = await act('inbound_shipment_record', org, actor, J({ purchase_order_id: po.poId, carrier: 'Transportadora Prova', eta: '2026-10-01' }));
    await act('inbound_shipment_record', org, actor, J({ id: ship.shipment_id, status: 'IN_TRANSIT', tracking_ref: 'BR123' }));
    await rejects('embarque só anda para frente', 'SELECT public.inbound_shipment_record($1,$2,$3)',
      [org, actor, J({ id: ship.shipment_id, status: 'EXPECTED' })], /moves forward only/);
    await rejects('RECEIVED vem do recebimento, não do embarque', 'SELECT public.inbound_shipment_record($1,$2,$3)',
      [org, actor, J({ id: ship.shipment_id, status: 'RECEIVED' })], /comes from the goods receipt/);

    // ── Recebimento parcial ─────────────────────────────────────────────
    const r1 = await act('goods_receipt_post', org, actor, J({ purchase_order_id: po.poId, shipment_id: ship.shipment_id,
      idempotency_key: `rc1-${stamp}`, lines: [{ po_line_id: po.lineOf[cab], accepted_quantity: 800 }] }));
    check('recebimento parcial: pedido fica PARTIALLY_RECEIVED', r1.order_status === 'PARTIALLY_RECEIVED' && r1.reserved === 800, J(r1));
    cov = await coverage(reqA);
    check('recebido vira reserva do requisito; o restante continua em pedido', cov.r === 800 && cov.o === 200 && cov.s === 0, J(cov));
    const mv = await one(`SELECT movement_type, quantity::float q, receipt_line_id IS NOT NULL has_line FROM public.inventory_movements
      WHERE item_id = $1 AND location_id = $2`, [cab, site]);
    check('livro: RECEIPT +800 apontando a linha do recebimento', mv.movement_type === 'RECEIPT' && mv.q === 800 && mv.has_line, J(mv));
    const shipNow = await one(`SELECT status FROM public.inbound_shipments WHERE id = $1`, [ship.shipment_id]);
    check('embarque referenciado fica RECEIVED', shipNow.status === 'RECEIVED');
    const replay = await act('goods_receipt_post', org, actor, J({ purchase_order_id: po.poId, idempotency_key: `rc1-${stamp}`,
      lines: [{ po_line_id: po.lineOf[cab], accepted_quantity: 800 }] }));
    check('recebimento repetido com a mesma chave não entra duas vezes', replay.replayed && replay.receipt_id === r1.receipt_id);
    await rejects('receber acima do aberto é recusado', 'SELECT public.goods_receipt_post($1,$2,$3)',
      [org, actor, J({ purchase_order_id: po.poId, lines: [{ po_line_id: po.lineOf[cab], accepted_quantity: 201 }] })], /exceeds the open quantity/);
    await rejects('rejeitado exige motivo', 'SELECT public.goods_receipt_post($1,$2,$3)',
      [org, actor, J({ purchase_order_id: po.poId, lines: [{ po_line_id: po.lineOf[cab], accepted_quantity: 10, rejected_quantity: 5 }] })],
      /grl_rejection_reason/);
    const r2 = await act('goods_receipt_post', org, actor, J({ purchase_order_id: po.poId, lines: [{ po_line_id: po.lineOf[cab],
      accepted_quantity: 150, rejected_quantity: 50, rejection_reason: 'Bobinas amassadas' }] }));
    cov = await coverage(reqA);
    const line = await one(`SELECT received_quantity::float r FROM public.purchase_order_lines WHERE id = $1`, [po.lineOf[cab]]);
    check('rejeitado não entra no estoque e continua esperado do fornecedor', line.r === 950 && cov.o === 50 && cov.r === 950, J({ line, cov }));
    await rejects('recebimento é fato: não se reescreve', 'UPDATE public.goods_receipts SET note = $2 WHERE id = $1',
      [r2.receipt_id, 'x'], /posted fact/);

    // ── Série, quarentena e inspeção ─────────────────────────────────────
    await rejects('série exige um número por unidade', 'SELECT public.goods_receipt_post($1,$2,$3)',
      [org, actor, J({ purchase_order_id: po.poId, location_id: quar, lines: [{ po_line_id: po.lineOf[rel], accepted_quantity: 2, serials: ['SN-1'] }] })],
      /one distinct serial per received unit/);
    const rq = await act('goods_receipt_post', org, actor, J({ purchase_order_id: po.poId, location_id: quar,
      lines: [{ po_line_id: po.lineOf[rel], accepted_quantity: 2, serials: [`SN1-${stamp}`, `SN2-${stamp}`] }] }));
    cov = await coverage(reqS);
    check('recebido em quarentena fica em inspeção: não é reservado, mas conta como entrando (sem falta)',
      rq.inspection_status === 'PENDING' && cov.r === 0 && cov.i === 2 && cov.s === 0, J(cov));
    await rejects('o que está em inspeção não é comprado de novo', 'SELECT public.purchase_requisition_from_shortage($1,$2,$3)',
      [org, actor, J({ requirement_ids: [reqS] })], /no uncovered shortage left/);
    await act('inventory_adjust', org, actor, J({ item_id: rel, location_id: site, quantity: 1, lot_code: `SNX-${stamp}`, reason: 'Saldo inicial' }));
    await rejects('nem o estoque cobre de novo o que está em inspeção', 'SELECT public.inventory_reserve($1,$2,$3)',
      [org, actor, J({ requirement_id: reqS, location_id: site, quantity: 1 })], /over-cover/);
    await rejects('pedido com recebimento em inspeção não encerra', 'SELECT public.purchase_order_close($1,$2,$3,$4)',
      [org, actor, po.poId, 'x'], /awaiting inspection/);
    const rqLine = await one(`SELECT id FROM public.goods_receipt_lines WHERE receipt_id = $1`, [rq.receipt_id]);
    await rejects('inspeção decide cada série exatamente uma vez', 'SELECT public.goods_receipt_inspect($1,$2,$3,$4)',
      [org, actor, rq.receipt_id, J({ destination_location_id: site, lines: [{ line_id: rqLine.id, approved_serials: [`SN1-${stamp}`] }] })],
      /exactly once/);
    const insp = await act('goods_receipt_inspect', org, actor, rq.receipt_id, J({ destination_location_id: site, reason: 'Relé com carcaça trincada',
      lines: [{ line_id: rqLine.id, approved_serials: [`SN1-${stamp}`], rejected_serials: [`SN2-${stamp}`] }] }));
    cov = await coverage(reqS);
    const relLine = await one(`SELECT received_quantity::float r FROM public.purchase_order_lines WHERE id = $1`, [po.lineOf[rel]]);
    check('inspeção: aprovado vai ao destino e reserva; rejeitado volta a ser esperado',
      insp.inspection_status === 'PARTIALLY_REJECTED' && cov.r === 1 && cov.o === 1 && cov.i === 0 && relLine.r === 1
      && Boolean(insp.transfer_id), J({ insp, cov }));
    const tr = await one(`SELECT status FROM public.inventory_transfers WHERE id = $1`, [insp.transfer_id]);
    check('a liberação usou o fluxo canônico de transferência (encerrada)', tr.status === 'CLOSED');
    await rejects('inspeção decidida não se decide de novo', 'SELECT public.goods_receipt_inspect($1,$2,$3,$4)',
      [org, actor, rq.receipt_id, J({ destination_location_id: site, lines: [] })], /nothing to decide/);

    // ── Recebimento final e encerramento ─────────────────────────────────
    const r3 = await act('goods_receipt_post', org, actor, J({ purchase_order_id: po.poId, lines: [
      { po_line_id: po.lineOf[cab], accepted_quantity: 50 }, { po_line_id: po.lineOf[rel], accepted_quantity: 1, serials: [`SN3-${stamp}`] }] }));
    check('segundo recebimento completa o pedido', r3.order_status === 'RECEIVED', J(r3));
    cov = await coverage(reqA);
    check('requisito coberto: tudo reservado, nada em pedido', cov.r === 1000 && cov.o === 0 && cov.s === 0, J(cov));
    const basis = await all(`SELECT item_id, ordered_qty::float o, received_qty::float r, rejected_qty::float j, open_qty::float p, receipts_count::int n
      FROM public.purchase_order_receipt_basis WHERE purchase_order_id = $1 ORDER BY ordered_qty DESC`, [po.poId]);
    check('base do 3-way match: pedido × recebido × rejeitado por linha',
      basis[0].o === 1000 && basis[0].r === 1000 && basis[0].j === 50 && basis[0].p === 0 && basis[0].n === 3
      && basis[1].o === 2 && basis[1].r === 2 && basis[1].j === 1, J(basis));
    const perf = await one(`SELECT promised_lines::int p, received_lines::int n, lines_with_rejection::int j
      FROM public.supplier_delivery_performance WHERE supplier_id = $1`, [po.supplierId]);
    check('pontualidade do fornecedor derivada dos recebimentos', perf && perf.n === 5 && perf.p === 5 && perf.j === 2, J(perf));
    const closed = await act('purchase_order_close', org, actor, po.poId, null);
    check('pedido recebido encerra sem saldo', closed.status === 'CLOSED' && Number(closed.open_quantity) === 0);

    // ── Evidência ────────────────────────────────────────────────────────
    const sha = 'a'.repeat(64);
    await rejects('evidência fora da área do inquilino é recusada', 'SELECT public.goods_receipt_attach_evidence($1,$2,$3,$4)',
      [org, actor, r1.receipt_id, J({ storage_bucket: 'contract-files', storage_path: `outra-org/supply-receipts/x.jpg`, file_name: 'x.jpg',
        mime_type: 'image/jpeg', size_bytes: 10, content_sha256: sha })], /gre_path_in_tenant/);
    const ev = await act('goods_receipt_attach_evidence', org, actor, r1.receipt_id, J({ storage_bucket: 'contract-files',
      storage_path: `${org}/supply-receipts/${actor}/${stamp}-foto.jpg`, file_name: 'foto.jpg', mime_type: 'image/jpeg', size_bytes: 10, content_sha256: sha }));
    const ev2 = await act('goods_receipt_attach_evidence', org, actor, r1.receipt_id, J({ storage_bucket: 'contract-files',
      storage_path: `${org}/supply-receipts/${actor}/${stamp}-foto.jpg`, file_name: 'foto.jpg', mime_type: 'image/jpeg', size_bytes: 10, content_sha256: sha }));
    check('evidência registrada uma vez (idempotente pelo caminho)', !ev.replayed && ev2.replayed && ev.evidence_id === ev2.evidence_id);

    // ── Fronteiras ───────────────────────────────────────────────────────
    await rejects('pedido encerrado (ou não emitido) não recebe (INV-11)', 'SELECT public.goods_receipt_post($1,$2,$3)',
      [org, actor, J({ purchase_order_id: po.poId, lines: [{ po_line_id: po.lineOf[cab], accepted_quantity: 1 }] })], /only an issued order is received/);
    await rejects('RECEIPT sem linha de recebimento é recusado pelo livro', 'SELECT public.inventory_post_movement($1,$2,$3,$4,$5,$6,$7,$8)',
      [org, actor, 'RECEIPT', cab, site, 1, null, `raw-${stamp}`], /invmov_receipt_has_line/);
    await rejects('ator sem alçada de recebimento é recusado', 'SELECT public.goods_receipt_post($1,$2,$3)',
      [org, '00000000-0000-4000-8000-000000000001', J({ purchase_order_id: po.poId, lines: [] })], /lacks permission/);
    const events = await all(`SELECT DISTINCT event_type FROM public.domain_events WHERE organization_id = $1 AND aggregate_id = $2`, [org, r1.receipt_id]);
    const types = new Set(events.map((e) => e.event_type));
    check('fatos: recebimento postado (gancho de Finanças) e recebido no projeto',
      types.has('supply.goods_receipt.posted') && types.has('supply.goods_receipt.project_received'), [...types].join(','));
  },
});
