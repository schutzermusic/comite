/**
 * 238 — Idempotência reconferida sob a trava (recebimento e reserva).
 *
 *   node scripts/operations/apply-238.mjs --target=qa [--apply]
 *   node scripts/operations/apply-238.mjs [--apply]
 *
 * A corrida de verdade (duas sessões, mesma chave, sobreposição forçada) é
 * provada em tests/qa-live/concurrency.spec.ts; aqui, o contrato sequencial.
 */
import { runMigration } from './lib/proof-kit.mjs';
import { confirmedMaterial, issuedPurchaseOrder, proofItem, proofProject } from './lib/fixtures.mjs';

await runMigration({
  version: '238',
  expectedTip: '237',
  async proofs(ctx) {
    const { one, check, rejects, browserCannotExecute, anchors } = ctx;
    const { org, actor } = anchors;
    const stamp = Date.now().toString(36).toUpperCase();
    const J = (x) => JSON.stringify(x);
    const act = async (fn, ...args) => (await one(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) r`, args)).r;

    await browserCannotExecute(['goods_receipt_post(uuid,uuid,jsonb)', 'inventory_reserve(uuid,uuid,jsonb)']);
    for (const fn of ['goods_receipt_post(uuid,uuid,jsonb)', 'inventory_reserve(uuid,uuid,jsonb)']) {
      const src = await one(`SELECT prosrc FROM pg_proc WHERE oid = $1::regprocedure`, [`public.${fn}`]);
      check(`${fn.split('(')[0]} relê a chave sob a trava`, (src.prosrc.match(/idempotency_key = v_key/g) ?? []).length >= 2);
    }

    const rec = await one(`SELECT prosrc FROM pg_proc WHERE oid = 'public.purchase_order_enqueue_approval_reconcile(timestamp with time zone)'::regprocedure`);
    check('reconciliação chaveada pelo desfecho mais recente (não pela janela de 10 min)', rec.prosrc.includes('last_outcome'));

    const item = await proofItem(ctx, anchors, `I238-${stamp}`, 'm');
    const project = await proofProject(ctx, anchors, `P238-${stamp}`);
    const wh = (await act('inventory_location_upsert', org, actor, J({ code: `W238-${stamp}`, name: 'W238', kind: 'WAREHOUSE' }))).location_id;
    await act('inventory_adjust', org, actor, J({ item_id: item, location_id: wh, quantity: 100, reason: 'Prova 238' }));
    const req = await confirmedMaterial(ctx, anchors, project, item, 100);
    const r1 = await act('inventory_reserve', org, actor, J({ requirement_id: req, location_id: wh, quantity: 100, idempotency_key: `r238-${stamp}` }));
    const r2 = await act('inventory_reserve', org, actor, J({ requirement_id: req, location_id: wh, quantity: 100, idempotency_key: `r238-${stamp}` }));
    check('reserva repetida com a mesma chave devolve a mesma reserva (mesmo com o requisito já coberto)',
      !r1.replayed && r2.replayed && r1.reservation_id === r2.reservation_id);
    await rejects('mesma chave para outra reserva continua recusada', 'SELECT public.inventory_reserve($1,$2,$3)',
      [org, actor, J({ requirement_id: req, location_id: wh, quantity: 50, idempotency_key: `r238-${stamp}` })], /different reservation/);

    const req2 = await confirmedMaterial(ctx, anchors, project, item, 40);
    const site = (await act('inventory_location_upsert', org, actor, J({ code: `S238-${stamp}`, name: 'S238', kind: 'PROJECT_SITE', project_id: project }))).location_id;
    const po = await issuedPurchaseOrder(ctx, anchors, { tag: `238${stamp}`, requirementIds: [req2], prices: { [item]: 3 }, deliveryLocationId: site });
    const g1 = await act('goods_receipt_post', org, actor, J({ purchase_order_id: po.poId, idempotency_key: `g238-${stamp}`,
      lines: [{ po_line_id: po.lineOf[item], accepted_quantity: 40 }] }));
    const g2 = await act('goods_receipt_post', org, actor, J({ purchase_order_id: po.poId, idempotency_key: `g238-${stamp}`,
      lines: [{ po_line_id: po.lineOf[item], accepted_quantity: 40 }] }));
    check('recebimento repetido com a mesma chave devolve o mesmo recebimento (pedido já todo recebido)',
      !g1.replayed && g2.replayed && g1.receipt_id === g2.receipt_id);
  },
});
