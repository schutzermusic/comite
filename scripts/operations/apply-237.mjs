/**
 * 237 — Operações + Supply: fechamento de prontidão para produção.
 *
 *   node scripts/operations/apply-237.mjs --target=qa [--apply]   # QA isolado primeiro
 *   node scripts/operations/apply-237.mjs [--apply]               # banco hospedado
 *
 * Provas SEMPRE desfeitas (SAVEPOINT). Usuários de papel são criados dentro da
 * transação e somem com ela.
 */
import { runMigration } from './lib/proof-kit.mjs';
import { confirmedMaterial, proofItem, proofProject } from './lib/fixtures.mjs';

const NEW_FUNCTIONS = ['operations_require(uuid,uuid,text[])', 'inventory_assert_outside_quarantine(uuid,uuid,boolean)',
  'procurement_authority_for_order(uuid,uuid,uuid)', 'apex_event_routes_activate_for(text[])',
  'supply_intelligence_enqueue_sweep(timestamp with time zone)', 'purchase_order_reconcile_approvals(uuid,integer)',
  'purchase_order_enqueue_approval_reconcile(timestamp with time zone)', 'apex_followup_supply_source_kinds()',
  'purchase_order_submit(uuid,uuid,uuid,text)', 'purchase_order_cancel(uuid,uuid,uuid,text)',
  'supply_item_upsert(uuid,uuid,jsonb)', 'project_requirement_upsert(uuid,uuid,jsonb)',
  'internal_service_order_generate_from_package(uuid,uuid,uuid,jsonb)'];

await runMigration({
  version: '237',
  expectedTip: '236',
  async proofs(ctx) {
    const { one, all, check, rejects, succeeds, browserCannotExecute, anchors } = ctx;
    const { org, actor } = anchors;
    const stamp = Date.now().toString(36).toUpperCase();
    const J = (x) => JSON.stringify(x);
    const act = async (fn, ...args) => (await one(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) r`, args)).r;
    const asUser = async (uid, sql, params) => one(`WITH who AS (SELECT set_config('request.jwt.claims', $1, true))
      ${sql.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + 1}`)}`, [J({ sub: uid, role: 'authenticated' }), ...params]);

    /** Pessoa do inquilino com UM papel — nasce e morre dentro da transação de prova. */
    const person = async (label, roleKey) => {
      const uid = (await one(`INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
        VALUES (gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$1,'x',now(),now())
        RETURNING id`, [`p237.${label}.${stamp.toLowerCase()}@example.test`])).id;
      await one(`INSERT INTO public.profiles (user_id, organization_id, full_name, status) VALUES ($1,$2,$3,'active') RETURNING id`,
        [uid, org, `[P237] ${label}`]);
      await one(`INSERT INTO public.organization_memberships (organization_id, user_id, status, source, joined_at)
        VALUES ($1,$2,'ACTIVE','INVITE',now()) ON CONFLICT (organization_id, user_id) DO UPDATE SET status = 'ACTIVE',
        disabled_at = NULL RETURNING id`, [org, uid]);
      await one(`INSERT INTO public.user_roles (user_id, role_id, organization_id)
        SELECT $1, r.id, $2 FROM public.roles r WHERE r.key = $3 AND r.organization_id IS NULL RETURNING role_id`, [uid, org, roleKey]);
      return uid;
    };

    await browserCannotExecute(NEW_FUNCTIONS);

    // ── 1. Papéis ─────────────────────────────────────────────────────────
    const perms = async (key) => (await all(`SELECT p.key FROM public.roles r JOIN public.role_permissions rp ON rp.role_id = r.id
      JOIN public.permissions p ON p.id = rp.permission_id WHERE r.organization_id IS NULL AND r.key = $1`, [key])).map((r) => r.key);
    const pc = await perms('compras'); const pa = await perms('almoxarifado');
    check('Compras: requisita, cota e emite — não aprova o gasto (SoD)',
      ['procurement.request', 'procurement.source', 'procurement.orders.issue', 'suppliers.manage'].every((k) => pc.includes(k))
      && !pc.includes('procurement.approve') && !pc.includes('receiving.receive'), pc.join(','));
    check('Almoxarifado: recebe, movimenta e reserva — não compra nem aprova',
      ['receiving.receive', 'inventory.manage', 'inventory.reserve'].every((k) => pa.includes(k))
      && !pa.includes('procurement.orders.issue') && !pa.includes('procurement.approve') && !pa.includes('procurement.source'), pa.join(','));

    const rh = await person('rh', 'rh');
    const gestor = await person('gestor', 'gestor_projetos');
    const eng = await person('engenharia', 'engenharia_pcp');
    const fin = await person('financeiro', 'financeiro');
    const compras = await person('compras', 'compras');
    const almox = await person('almox', 'almoxarifado');

    // ── 2. Recheque no banco (Operações) ─────────────────────────────────
    const project = await proofProject(ctx, anchors, `P237-${stamp}`);
    await rejects('RH não escreve requisito de planejamento (recheque no banco)', 'SELECT public.project_requirement_upsert($1,$2,$3)',
      [org, rh, J({ project_id: project, requirement_type: 'DOCUMENT', title: 'x' })], /lacks permission \(operations\.planning\.manage\)/);
    await succeeds('Gestor de projetos escreve requisito', 'SELECT public.project_requirement_upsert($1,$2,$3)',
      [org, gestor, J({ project_id: project, requirement_type: 'DOCUMENT', title: `Doc ${stamp}` })]);
    await rejects('RH não gera OS do pacote (recheque no banco)', 'SELECT public.internal_service_order_generate_from_package($1,$2,$3,$4)',
      [org, rh, '00000000-0000-4000-8000-000000000237', '{}'], /lacks permission \(commercial\.service_orders\.manage\)/);
    await rejects('RH não cadastra item de material', 'SELECT public.supply_item_upsert($1,$2,$3)',
      [org, rh, J({ code: `X-${stamp}`, description: 'x', unit: 'un' })], /lacks permission \(supply\.plan\)/);
    await succeeds('Engenharia/PCP cadastra item', 'SELECT public.supply_item_upsert($1,$2,$3)',
      [org, eng, J({ code: `ENG-${stamp}`, description: 'Item da engenharia', unit: 'un' })]);
    await rejects('RH não liga acompanhamento a recomendação', 'SELECT public.supply_signal_link_followup($1,$2,$3,$4)',
      [org, rh, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'], /lacks permission/);
    await one(`UPDATE public.organization_memberships SET status = 'SUSPENDED', disabled_at = now()
      WHERE organization_id = $1 AND user_id = $2 RETURNING id`, [org, gestor]);
    const suspended = await one(`SELECT public.apex_actor_has_permission($1,$2,'operations.planning.manage') ok`, [org, gestor]);
    check('membro SUSPENSO perde o recheque mesmo com o papel', suspended.ok === false);
    await one(`UPDATE public.organization_memberships SET status = 'ACTIVE', disabled_at = NULL
      WHERE organization_id = $1 AND user_id = $2 RETURNING id`, [org, gestor]);

    // ── 3. Compras: alçada declarada e, depois, POLÍTICA do motor ─────────
    const cab = await proofItem(ctx, anchors, `C237-${stamp}`, 'm');
    const site = (await act('inventory_location_upsert', org, actor, J({ code: `OB237-${stamp}`, name: 'Obra 237', kind: 'PROJECT_SITE',
      project_id: project }))).location_id;
    const supplier = (await act('supplier_register', org, actor, J({ legal_name: `Fornecedor 237 ${stamp}` }))).supplier_id;
    await act('supplier_set_status', org, actor, supplier, 'HOMOLOGATED', null);
    /** Pedido de compra em RASCUNHO pelo caminho governado (falta → requisição → cotação → decisão). */
    const draftPo = async (qty) => {
      const req = await confirmedMaterial(ctx, anchors, project, cab, qty, '2026-12-01');
      const rc = await act('purchase_requisition_from_shortage', org, compras, J({ requirement_ids: [req] }));
      const reqLines = await all(`SELECT id FROM public.purchase_requisition_lines WHERE requisition_id = $1`, [rc.requisition_id]);
      const rfq = await act('procurement_rfq_create', org, compras, J({ requisition_line_ids: reqLines.map((l) => l.id), supplier_ids: [supplier] }));
      const rfqLines = await all(`SELECT id FROM public.procurement_rfq_lines WHERE rfq_id = $1`, [rfq.rfq_id]);
      const quote = await act('procurement_quote_record', org, compras, J({ rfq_id: rfq.rfq_id, supplier_id: supplier, lead_time_days: 7,
        validity_date: '2099-01-01', lines: rfqLines.map((l) => ({ rfq_line_id: l.id, unit_price: 10 })) }));
      const dec = await act('procurement_decide', org, compras, J({ rfq_id: rfq.rfq_id, quote_id: quote.quote_id, rationale: 'Prova 237' }));
      await act('purchase_order_update_draft', org, compras, dec.purchase_order_id, J({ delivery_location_id: site }));
      return dec.purchase_order_id;
    };
    const poRow = (id) => one(`SELECT status, approval_governance g, approval_request_id rq FROM public.purchase_orders WHERE id = $1`, [id]);
    const reqRow = (id) => one(`SELECT status, finalized_by FROM public.approval_requests WHERE id = $1`, [id]);

    // Alçada por categoria e autodeclaração por papel.
    const adminRole = (await one(`SELECT id FROM public.roles WHERE organization_id IS NULL AND key = 'owner_admin'`)).id;
    await rejects('ninguém declara alçada para um papel que exerce', 'SELECT public.procurement_authority_declare($1,$2,$3)',
      [org, actor, J({ grantee_kind: 'ROLE', grantee_role_id: adminRole, source_kind: 'BOARD_RESOLUTION', source_reference: 'x',
        justification: 'x' })], /role the declarer holds/);
    // Diretoria aprova por alçada de PESSOA (sem alçada de papel declarada para ela no inquilino).
    const diretor = await person('diretor', 'ceo_diretoria');
    await one(`UPDATE public.procurement_approval_authorities SET active = false
      WHERE organization_id = $1 AND grantee_role_id = (SELECT id FROM public.roles WHERE organization_id IS NULL AND key = 'ceo_diretoria')
      RETURNING id`, [org]).catch(() => null);
    await act('procurement_authority_declare', org, actor, J({ grantee_kind: 'USER', grantee_user_id: diretor, category: 'Obras civis',
      max_amount: 100000, source_kind: 'BOARD_RESOLUTION', source_reference: `ATA-237-${stamp}`, justification: 'Prova' }));
    const po3 = await draftPo(20);
    await act('purchase_order_submit', org, compras, po3, null);
    check('sem política, o pedido segue por alçada declarada', (await poRow(po3)).g === 'AUTHORITY');
    await rejects('alçada de "Obras civis" não aprova "Cabos"', 'SELECT public.purchase_order_decide($1,$2,$3,$4,$5)',
      [org, diretor, po3, 'APPROVE', null], /authority not configured/);
    await act('procurement_authority_declare', org, actor, J({ grantee_kind: 'USER', grantee_user_id: diretor, category: 'Cabos',
      max_amount: 100000, source_kind: 'BOARD_RESOLUTION', source_reference: `ATA-237B-${stamp}`, justification: 'Prova' }));
    const ok3 = await act('purchase_order_decide', org, diretor, po3, 'APPROVE', null);
    check('alçada da MESMA categoria aprova', ok3.status === 'APPROVED', J(ok3));

    // Política do motor para pedido de compra (daqui em diante, governança POLICY).
    await one(`INSERT INTO public.approval_engine_cutover (organization_id, business_domain, subject_type, action_type, justification)
      VALUES ($1,'procurement','purchase_order','approve','Prova 237') RETURNING id`, [org]);
    const pol = (await one(`INSERT INTO public.approval_policies (organization_id, policy_key, name, business_domain)
      VALUES ($1,$2,'[P237] Compras','procurement') RETURNING id`, [org, `procurement.po.p237.${stamp.toLowerCase()}`])).id;
    const ver = (await one(`INSERT INTO public.approval_policy_versions (organization_id, policy_id, version_no, subject_type, action_type,
      decision_purpose) VALUES ($1,$2,1,'purchase_order','approve','APPROVAL') RETURNING id`, [org, pol])).id;
    const stage = (await one(`INSERT INTO public.approval_policy_stages (organization_id, policy_version_id, stage_no, name)
      VALUES ($1,$2,1,'Financeiro') RETURNING id`, [org, ver])).id;
    await one(`INSERT INTO public.approval_policy_steps (organization_id, policy_version_id, policy_stage_id, step_key, name,
      decision_purpose, eligibility_mode, role_key, sod_forbid_requester) VALUES ($1,$2,$3,'fin','[P237] Financeiro','APPROVAL','ROLE',
      'financeiro',true) RETURNING id`, [org, ver, stage]);
    await one(`SELECT public.approval_policy_activate($1) r`, [ver]);

    // Cancelar com aprovação pendente cancela o pedido no motor.
    const po1 = await draftPo(100);
    const sub1 = await act('purchase_order_submit', org, compras, po1, 'Prova');
    let p = await poRow(po1);
    check('Compras submete: pedido fica sob POLÍTICA com aprovação PENDENTE', sub1.governance === 'POLICY'
      && (await reqRow(p.rq)).status === 'PENDING', J(sub1));
    await rejects('Almoxarifado não cancela pedido de compra', 'SELECT public.purchase_order_cancel($1,$2,$3,$4)',
      [org, almox, po1, 'x'], /lacks permission/);
    const can = await act('purchase_order_cancel', org, compras, po1, 'Obra adiada pelo cliente');
    const rq1 = await reqRow(p.rq);
    check('cancelar o pedido cancela a aprovação pendente no motor, em nome de quem cancelou',
      can.status === 'CANCELLED' && rq1.status === 'CANCELLED' && rq1.finalized_by === compras, J({ can, rq1 }));
    const ev = await one(`SELECT actor_user_id FROM public.domain_events WHERE aggregate_id = $1 AND event_type = 'approval.request.cancelled'`, [p.rq]);
    check('o motor emitiu approval.request.cancelled com o ator', ev?.actor_user_id === compras, J(ev));
    const hist = await one(`SELECT detail FROM public.purchase_order_history WHERE purchase_order_id = $1 AND transition = 'cancelled'`, [po1]);
    check('histórico do pedido registra o destino da aprovação', hist.detail.approval_request_status === 'CANCELLED', J(hist.detail));

    // Ressubmissão depois de rejeição abre OUTRO pedido de aprovação.
    const po2 = await draftPo(50);
    await act('purchase_order_submit', org, compras, po2, null);
    const r1 = (await poRow(po2)).rq;
    const step = (await one(`SELECT id FROM public.approval_request_steps WHERE request_id = $1`, [r1])).id;
    const dec = await asUser(fin, `SELECT public.approval_decide($1,'REJECTED',$2,'Preço acima da referência') r FROM who`, [step, `p237-rej-${stamp}`]);
    check('Financeiro rejeita no motor', dec.r.request_status === 'REJECTED', J(dec.r));
    await act('purchase_order_apply_approval', r1);
    check('rejeição devolve o pedido ao rascunho', (await poRow(po2)).status === 'DRAFT');
    await act('purchase_order_submit', org, compras, po2, 'Ressubmetido sem mudança');
    const again = await poRow(po2);
    check('ressubmissão abre um pedido de aprovação NOVO e pendente (sem laço)',
      again.status === 'APPROVAL_REQUIRED' && again.rq !== r1 && (await reqRow(again.rq)).status === 'PENDING');

    // O motor sabe quem pediu: quem submete não aprova o próprio pedido, mesmo sendo do Financeiro.
    const both = await person('comprasfin', 'compras');
    await one(`INSERT INTO public.user_roles (user_id, role_id, organization_id)
      SELECT $1, r.id, $2 FROM public.roles r WHERE r.key = 'financeiro' AND r.organization_id IS NULL RETURNING role_id`, [both, org]);
    const poSod = await draftPo(10);
    await act('purchase_order_submit', org, both, poSod, null);
    const rqSod = (await poRow(poSod)).rq;
    const requested = await one(`SELECT requested_by FROM public.approval_requests WHERE id = $1`, [rqSod]);
    check('o pedido de aprovação registra quem submeteu', requested.requested_by === both, J(requested));
    const stepSod = (await one(`SELECT id FROM public.approval_request_steps WHERE request_id = $1`, [rqSod])).id;
    const selfApprove = await ctx.db.query('SAVEPOINT sod').then(async () => {
      try {
        await asUser(both, `SELECT public.approval_decide($1,'APPROVED',$2,NULL) r FROM who`, [stepSod, `p237-sod-${stamp}`]);
        await ctx.db.query('RELEASE SAVEPOINT sod'); return 'aceito';
      } catch (e) { await ctx.db.query('ROLLBACK TO SAVEPOINT sod'); await ctx.db.query('RELEASE SAVEPOINT sod'); return e.message; }
    });
    check('quem submeteu não aprova o próprio pedido no motor (segregação)', selfApprove !== 'aceito', selfApprove.slice(0, 120));

    // Reconciliação aplica desfecho que nenhum evento aplicou.
    const step2 = (await one(`SELECT id FROM public.approval_request_steps WHERE request_id = $1`, [again.rq])).id;
    await asUser(fin, `SELECT public.approval_decide($1,'APPROVED',$2,NULL) r FROM who`, [step2, `p237-ok-${stamp}`]);
    check('aprovado no motor, o pedido ainda espera (rotas desligadas)', (await poRow(po2)).status === 'APPROVAL_REQUIRED');
    const enq = await one(`SELECT public.purchase_order_enqueue_approval_reconcile(now()) n`);
    const job = await one(`SELECT count(*)::int n FROM public.apex_jobs WHERE organization_id = $1
      AND job_type = 'procurement.purchase_order.reconcile_approvals'`, [org]);
    check('produtor enfileira a reconciliação do inquilino', enq.n >= 1 && job.n === 1, J({ enq, job }));
    const rec = await act('purchase_order_reconcile_approvals', org, 200);
    check('reconciliação aplica a aprovação pela função canônica', rec.applied >= 1 && (await poRow(po2)).status === 'APPROVED', J(rec));

    // ── 4. Rotas que ligam com trabalhador capaz ────────────────────────
    const routes = await all(`SELECT event_type, enabled, activation FROM public.apex_event_routes
      WHERE job_type = 'procurement.purchase_order.apply_approval' ORDER BY event_type`);
    check('5 desfechos roteados para compras, todos desligados até haver trabalhador capaz',
      routes.length === 5 && routes.every((r) => !r.enabled && r.activation === 'ON_WORKER_CAPABILITY'), J(routes));
    const none = await one(`SELECT public.apex_event_routes_activate_for(ARRAY['platform.approvals.expire']) n`);
    check('trabalhador sem o handler não liga a rota', none.n === 0);
    const on = await one(`SELECT public.apex_event_routes_activate_for(ARRAY['procurement.purchase_order.apply_approval']) n`);
    const enabled = await one(`SELECT count(*)::int n FROM public.apex_event_routes
      WHERE job_type = 'procurement.purchase_order.apply_approval' AND enabled AND activated_at IS NOT NULL`);
    check('trabalhador capaz liga as 5 rotas', on.n === 5 && enabled.n === 5);
    const billing = await one(`SELECT count(*)::int n FROM public.apex_event_routes WHERE job_type = 'contracts.billing.apply_approval' AND enabled`);
    check('rotas do faturamento continuam como estavam', billing.n === 2);

    // ── 5. Leitura da Apex agendada ─────────────────────────────────────
    const sw1 = await one(`SELECT public.supply_intelligence_enqueue_sweep(now()) n`);
    await one(`SELECT public.supply_intelligence_enqueue_sweep(now()) n`);
    const swJobs = await one(`SELECT count(*)::int n FROM public.apex_jobs WHERE organization_id = $1 AND job_type = 'supply.intelligence.sweep'`, [org]);
    check('leitura da Apex enfileirada por inquilino e por hora, sem duplicar', sw1.n >= 1 && swJobs.n === 1, J({ sw1, swJobs }));

    // ── 6. Quarentena ────────────────────────────────────────────────────
    const quar = (await act('inventory_location_upsert', org, actor, J({ code: `Q237-${stamp}`, name: 'Quarentena 237', kind: 'QUARANTINE' }))).location_id;
    const wh = (await act('inventory_location_upsert', org, actor, J({ code: `W237-${stamp}`, name: 'Almox 237', kind: 'WAREHOUSE' }))).location_id;
    await rejects('ajuste não põe nem tira estoque da quarentena', 'SELECT public.inventory_adjust($1,$2,$3)',
      [org, almox, J({ item_id: cab, location_id: quar, quantity: 5, reason: 'x' })], /quarantine only moves through/);
    await rejects('contagem não corrige quarentena', 'SELECT public.inventory_count_open($1,$2,$3)',
      [org, almox, J({ location_id: quar })], /quarantine only moves through/);
    await act('inventory_adjust', org, almox, J({ item_id: cab, location_id: wh, quantity: 30, reason: 'Saldo de prova' }));
    await rejects('transferência não enche a quarentena', 'SELECT public.inventory_transfer_request($1,$2,$3)',
      [org, almox, J({ from_location_id: wh, to_location_id: quar, lines: [{ item_id: cab, quantity: 1 }] })], /quarantine only moves through/);
    // Item em uso não muda unidade nem rastreio (o uso inclui o livro).
    await rejects('item com movimento no livro não muda de unidade', 'SELECT public.supply_item_upsert($1,$2,$3)',
      [org, eng, J({ id: cab, unit: 'kg' })], /code, unit and tracking do not change/);
    await rejects('nem de rastreio', 'SELECT public.supply_item_upsert($1,$2,$3)',
      [org, eng, J({ id: cab, tracking: 'SERIAL' })], /code, unit and tracking do not change/);

    // ── 7. Evidência presa à pasta do inquilino ─────────────────────────
    await rejects('evidência fora da pasta de recebimentos é recusada', 'SELECT public.goods_receipt_attach_evidence($1,$2,$3,$4)',
      [org, almox, '00000000-0000-4000-8000-000000000003', J({ storage_bucket: 'contract-files', storage_path: `${org}/contratos/x.jpg` })],
      /not found in tenant|tenant receipt folder/);
    const pol7 = await all(`SELECT policyname, cmd, coalesce(qual, with_check) expr FROM pg_policies
      WHERE schemaname = 'storage' AND policyname IN ('contract_files_storage_insert','contract_files_storage_delete')`);
    check('navegador não planta nem apaga arquivo na pasta de recebimentos',
      pol7.length === 2 && pol7.every((r) => r.expr.includes('supply-receipts')), J(pol7.map((r) => r.policyname)));

    // ── 8. Endurecimento ────────────────────────────────────────────────
    const restrict = await all(`SELECT conname FROM pg_constraint WHERE contype = 'f' AND confdeltype = 'r'
      AND conrelid::regclass::text IN ('internal_service_orders','internal_service_order_items','internal_service_order_issue_exceptions',
        'project_requirements')`);
    check('só iso_engagement_tenant continua RESTRICT (as da 230–232 viraram NO ACTION)',
      restrict.length === 1 && restrict[0].conname === 'iso_engagement_tenant', J(restrict));
    const lone = await proofItem(ctx, anchors, `L237-${stamp}`, 'un');
    await confirmedMaterial(ctx, anchors, project, lone, 1);
    await rejects('NO ACTION ainda protege o item referenciado', 'DELETE FROM public.supply_items WHERE id = $1', [lone], /preq_item_tenant/);
    const views = await all(`SELECT c.relname, has_table_privilege('authenticated', c.oid, 'INSERT') ins,
      has_table_privilege('anon', c.oid, 'SELECT') anon_sel, has_table_privilege('authenticated', c.oid, 'SELECT') sel
      FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN
      ('supply_requirement_coverage','inventory_position','purchase_order_receipt_basis','supplier_delivery_performance')`);
    check('visões de Supply: só SELECT para authenticated, nada para anon', views.length === 4
      && views.every((v) => v.sel && !v.ins && !v.anon_sel), J(views));
  },
});
