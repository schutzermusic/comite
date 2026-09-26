/**
 * 254 — Quantidades e valores do Supply sempre finitos (sem NaN nem ±Infinity).
 *
 *   node scripts/operations/apply-254.mjs --target=qa [--apply]
 *   node scripts/operations/apply-254.mjs [--apply]
 *
 * Sempre desfeito:
 *   - toda coluna numeric das tabelas do Supply tem o CHECK "finito", VALIDADO;
 *   - a revisão adversarial repetida pelas funções governadas: cada entrada não finita que antes gravava (ajuste de
 *     estoque NaN/±Infinity, requisito NaN, requisição NaN/Infinity e preço NaN, proposta com preço/frete/imposto não
 *     finitos, alçada com teto NaN, recebimento com rejeitado NaN, contagem NaN/Infinity) agora é recusada (23514,
 *     no CHECK da coluna) — e o mesmo ato com número finito passa;
 *   - sabotagem: sem o CHECK do livro-razão, o ajuste NaN volta a gravar (é a restrição que segura).
 */
import { runMigration } from './lib/proof-kit.mjs';
import { confirmedMaterial, homologatedSupplier, proofItem, proofProject, purchaseOrderFromLines, secondApprover } from './lib/fixtures.mjs';

await runMigration({
  version: '254',
  expectedTip: '253',
  async proofs(ctx) {
    const { db, one, all, check, anchors } = ctx;
    const { org, actor } = anchors;
    const stamp = Date.now().toString(36).toUpperCase();
    const J = (x) => JSON.stringify(x);
    const act = async (fn, ...args) => (await one(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) r`, args)).r;
    let seq = 0;
    const isolated = async (fn) => {
      const sp = `sp254_${++seq}`;
      await db.query(`SAVEPOINT ${sp}`);
      try { return { ok: true, v: await fn() }; }
      catch (e) { return { ok: false, e: e.message, code: e.code, constraint: e.constraint }; }
      finally { await db.query(`ROLLBACK TO SAVEPOINT ${sp}`); await db.query(`RELEASE SAVEPOINT ${sp}`); }
    };
    const refused = async (label, constraint, fn) => {
      const r = await isolated(fn);
      check(`${label} → recusado no CHECK ${constraint}`, !r.ok && r.code === '23514' && r.constraint === constraint, J(r).slice(0, 220));
    };
    const accepted = async (label, fn) => {
      const r = await isolated(fn);
      check(`${label} (controle finito) → aceito`, r.ok, r.ok ? '' : r.e);
    };

    // 1) Toda coluna numeric do Supply com o CHECK finito, validado
    const cols = await all(`SELECT c.table_name t, c.column_name col FROM information_schema.columns c
        JOIN information_schema.tables x ON x.table_schema = c.table_schema AND x.table_name = c.table_name AND x.table_type = 'BASE TABLE'
       WHERE c.table_schema = 'public' AND c.data_type = 'numeric'
         AND c.table_name ~ '^(inventory_|procurement_|purchase_|goods_|inbound_|supplier_|supply_|project_requirement)'`);
    const missing = [];
    for (const { t, col } of cols) {
      const k = await one(`SELECT convalidated v FROM pg_constraint WHERE conrelid = $1::regclass AND conname = $2 AND contype = 'c'`,
        [`public.${t}`, `${t}_${col}_finite`]);
      if (!k?.v) missing.push(`${t}.${col}`);
    }
    check(`as ${cols.length} colunas numeric do Supply têm o CHECK finito validado`, cols.length >= 38 && missing.length === 0, missing.join(', '));

    // Cenário
    const project = await proofProject(ctx, anchors, `P254-${stamp}`);
    const item = await proofItem(ctx, anchors, `I254-${stamp}`, 'm');
    const loc = async (code, kind, extra = {}) => (await act('inventory_location_upsert', org, actor, J({ code: `${code}-${stamp}`, name: code, kind, ...extra }))).location_id;
    const depot = await loc('D254', 'WAREHOUSE');
    const site = await loc('S254', 'PROJECT_SITE', { project_id: project });

    // 2) Livro-razão (com saldo finito de verdade no almoxarifado)
    await act('inventory_adjust', org, actor, J({ item_id: item, location_id: depot, quantity: 100, reason: 'Prova 254: saldo' }));
    for (const bad of ['NaN', 'Infinity']) {
      await refused(`ajuste de estoque ${bad}`, 'inventory_movements_quantity_finite',
        () => act('inventory_adjust', org, actor, J({ item_id: item, location_id: depot, quantity: bad, reason: 'Prova 254' })));
    }
    // -Infinity já cai na regra de saldo negativo enquanto o saldo é finito; na revisão ele só gravou porque um NaN
    // anterior tinha envenenado o saldo (NaN + -Infinity = NaN, e NaN < 0 é falso). Sem NaN no livro, não grava nunca.
    {
      const r = await isolated(() => act('inventory_adjust', org, actor, J({ item_id: item, location_id: depot, quantity: '-Infinity', reason: 'Prova 254' })));
      check('ajuste de estoque -Infinity → recusado (saldo negativo; o NaN que o deixava passar não entra mais)', !r.ok && r.code === '23514', J(r).slice(0, 200));
    }
    await accepted('ajuste de estoque 25', () => act('inventory_adjust', org, actor, J({ item_id: item, location_id: depot, quantity: 25, reason: 'Prova 254' })));
    const onHand = await one(`SELECT on_hand_qty::text h FROM public.inventory_position WHERE organization_id = $1 AND item_id = $2 AND location_id = $3`, [org, item, depot]);
    check('o saldo do almoxarifado segue finito (100) depois das tentativas', onHand?.h != null && Number(onHand.h) === 100, J(onHand));

    // 3) Requisito
    await refused('requisito com quantidade NaN', 'project_requirements_quantity_finite', () => act('project_requirement_upsert', org, actor,
      J({ project_id: project, requirement_type: 'MATERIAL', title: 'NaN', quantity: 'NaN', item_id: item, required_by: '2026-11-18' })));

    // 4) Requisição manual
    await refused('requisição com quantidade NaN', 'purchase_requisition_lines_quantity_finite', () => act('purchase_requisition_create_manual', org, actor,
      J({ justification: 'Prova 254', lines: [{ item_id: item, quantity: 'NaN' }] })));
    await refused('requisição com quantidade Infinity', 'purchase_requisition_lines_quantity_finite', () => act('purchase_requisition_create_manual', org, actor,
      J({ justification: 'Prova 254', lines: [{ item_id: item, quantity: 'Infinity' }] })));
    await refused('requisição com preço estimado NaN', 'purchase_requisition_lines_estimated_unit_price_finite', () => act('purchase_requisition_create_manual', org, actor,
      J({ justification: 'Prova 254', lines: [{ item_id: item, quantity: 2, estimated_unit_price: 'NaN' }] })));
    await accepted('requisição de 2 a 7,5', () => act('purchase_requisition_create_manual', org, actor,
      J({ justification: 'Prova 254', lines: [{ item_id: item, quantity: 2, estimated_unit_price: 7.5 }] })));

    // 5) Proposta
    const req = await confirmedMaterial(ctx, anchors, project, item, 40);
    const rq = await act('purchase_requisition_from_shortage', org, actor, J({ requirement_ids: [req] }));
    const lines = (await all(`SELECT id FROM public.purchase_requisition_lines WHERE requisition_id = $1`, [rq.requisition_id])).map((l) => l.id);
    const supplier = await homologatedSupplier(ctx, anchors, `F254${stamp}`);
    const rfq = await act('procurement_rfq_create', org, actor, J({ requisition_line_ids: lines, supplier_ids: [supplier] }));
    const [rfqLine] = await all(`SELECT id FROM public.procurement_rfq_lines WHERE rfq_id = $1`, [rfq.rfq_id]);
    const quote = (l, extra = {}) => act('procurement_quote_record', org, actor, J({ rfq_id: rfq.rfq_id, supplier_id: supplier, lead_time_days: 5,
      validity_date: '2099-01-01', lines: [{ rfq_line_id: rfqLine.id, ...l }], ...extra }));
    await refused('proposta com preço NaN', 'supplier_quote_lines_unit_price_finite', () => quote({ unit_price: 'NaN' }));
    await refused('proposta com preço Infinity', 'supplier_quote_lines_unit_price_finite', () => quote({ unit_price: 'Infinity' }));
    await refused('proposta com frete NaN', 'supplier_quotes_freight_amount_finite', () => quote({ unit_price: 5 }, { freight_amount: 'NaN' }));
    await refused('proposta com imposto Infinity', 'supplier_quotes_tax_amount_finite', () => quote({ unit_price: 5 }, { tax_amount: 'Infinity' }));
    await accepted('proposta a 5 com frete 10 e imposto 2', () => quote({ unit_price: 5 }, { freight_amount: 10, tax_amount: 2 }));

    // 6) Alçada de compra
    const approver = await secondApprover(ctx, anchors);
    await refused('alçada com teto NaN (NaN ≥ qualquer valor: alçada ilimitada)', 'procurement_approval_authorities_max_amount_finite',
      () => act('procurement_authority_declare', org, actor, J({ grantee_kind: 'ROLE', grantee_role_id: approver.role_id, max_amount: 'NaN',
        source_kind: 'BOARD_RESOLUTION', source_reference: `ATA-254N-${stamp}`, justification: 'Prova 254' })));
    await accepted('alçada com teto 1000', () => act('procurement_authority_declare', org, actor, J({ grantee_kind: 'ROLE', grantee_role_id: approver.role_id,
      max_amount: 1000, source_kind: 'BOARD_RESOLUTION', source_reference: `ATA-254F-${stamp}`, justification: 'Prova 254' })));

    // 7) Recebimento
    const req2 = await confirmedMaterial(ctx, anchors, project, item, 30);
    const rq2 = await act('purchase_requisition_from_shortage', org, actor, J({ requirement_ids: [req2] }));
    const lines2 = (await all(`SELECT id FROM public.purchase_requisition_lines WHERE requisition_id = $1`, [rq2.requisition_id])).map((l) => l.id);
    const po = await purchaseOrderFromLines(ctx, anchors, { tag: `254${stamp}`, lineIds: lines2, deliveryLocationId: site });
    const pol = (await one(`SELECT id FROM public.purchase_order_lines WHERE purchase_order_id = $1`, [po.poId])).id;
    await refused('recebimento com rejeitado NaN', 'goods_receipt_lines_rejected_quantity_finite', () => act('goods_receipt_post', org, actor,
      J({ purchase_order_id: po.poId, location_id: site, idempotency_key: `r254n-${stamp}`,
        lines: [{ po_line_id: pol, accepted_quantity: 1, rejected_quantity: 'NaN', rejection_reason: 'Prova 254' }] })));
    await accepted('recebimento de 5 com 1 rejeitado', () => act('goods_receipt_post', org, actor, J({ purchase_order_id: po.poId, location_id: site,
      idempotency_key: `r254f-${stamp}`, lines: [{ po_line_id: pol, accepted_quantity: 5, rejected_quantity: 1, rejection_reason: 'Prova 254' }] })));

    // 8) Contagem
    const count = await act('inventory_count_open', org, actor, J({ location_id: depot, item_ids: [item], note: 'Prova 254' }));
    const cl = (await one(`SELECT id FROM public.inventory_count_lines WHERE count_id = $1 LIMIT 1`, [count.count_id])).id;
    await refused('contagem NaN', 'inventory_count_lines_counted_quantity_finite', () => act('inventory_count_record', org, actor, count.count_id,
      J([{ line_id: cl, counted_quantity: 'NaN' }])));
    await refused('contagem Infinity', 'inventory_count_lines_counted_quantity_finite', () => act('inventory_count_record', org, actor, count.count_id,
      J([{ line_id: cl, counted_quantity: 'Infinity' }])));
    await accepted('contagem 24', () => act('inventory_count_record', org, actor, count.count_id, J([{ line_id: cl, counted_quantity: 24 }])));

    // 9) Sabotagem: sem o CHECK do livro-razão, o NaN volta a gravar
    {
      const r = await isolated(async () => {
        await db.query('ALTER TABLE public.inventory_movements DROP CONSTRAINT inventory_movements_quantity_finite');
        return act('inventory_adjust', org, actor, J({ item_id: item, location_id: depot, quantity: 'NaN', reason: 'Sabotagem 254' }));
      });
      check('sabotagem: sem o CHECK do livro-razão, o ajuste NaN grava (é a restrição que segura)', r.ok, J(r).slice(0, 200));
    }
  },
});
