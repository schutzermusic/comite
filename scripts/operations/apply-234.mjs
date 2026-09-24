/**
 * 234 — Compras & Fornecedores: requisição → cotação → decisão → pedido, com o
 * motor de aprovação da plataforma e alçada declarada.
 *   node scripts/operations/apply-234.mjs [--apply]
 */
import { runMigration } from './lib/proof-kit.mjs';
import { confirmedMaterial, proofItem, proofProject } from './lib/fixtures.mjs';

const ACTS = [
  'supplier_register(uuid,uuid,jsonb)', 'supplier_set_status(uuid,uuid,uuid,text,text)',
  'procurement_authority_declare(uuid,uuid,jsonb)', 'procurement_authority_revoke(uuid,uuid,uuid,text)',
  'purchase_requisition_from_shortage(uuid,uuid,jsonb)', 'purchase_requisition_create_manual(uuid,uuid,jsonb)',
  'purchase_requisition_cancel(uuid,uuid,uuid,text)', 'procurement_rfq_create(uuid,uuid,jsonb)',
  'procurement_quote_record(uuid,uuid,jsonb)', 'procurement_decide(uuid,uuid,jsonb)',
  'purchase_order_update_draft(uuid,uuid,uuid,jsonb)', 'purchase_order_submit(uuid,uuid,uuid,text)',
  'purchase_order_decide(uuid,uuid,uuid,text,text)', 'purchase_order_apply_approval(uuid)',
  'purchase_order_issue(uuid,uuid,uuid)', 'purchase_order_cancel(uuid,uuid,uuid,text)',
];

/** CNPJ sintético com dígitos verificadores válidos (só formato; nunca sai do SAVEPOINT). */
function cnpj(seed) {
  const base = String(seed).padStart(12, '0').slice(-12).split('').map(Number);
  const dv = (nums, w) => { const s = nums.reduce((a, n, i) => a + n * w[i], 0) % 11; return s < 2 ? 0 : 11 - s; };
  const d1 = dv(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv([...base, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return [...base, d1, d2].join('');
}

await runMigration({
  version: '234',
  expectedTip: '233',
  async proofs(ctx) {
    const { db, one, all, check, rejects, browserCannotExecute, tablesAreGoverned, anchors } = ctx;
    const { org, actor } = anchors;
    const stamp = Date.now().toString(36).toUpperCase();
    const J = (x) => JSON.stringify(x);
    const act = async (fn, ...args) => (await one(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) r`, args)).r;
    const coverage = (req) => one(`SELECT reserved_qty::float r, on_order_qty::float o, requested_qty::float q, shortage_qty::float s
      FROM public.supply_requirement_coverage WHERE requirement_id = $1`, [req]);

    await browserCannotExecute(ACTS);
    await tablesAreGoverned(['supplier_profiles', 'procurement_approval_authorities', 'purchase_requisitions',
      'purchase_requisition_lines', 'purchase_requisition_line_requirements', 'procurement_rfqs', 'procurement_rfq_lines',
      'procurement_rfq_suppliers', 'supplier_quotes', 'supplier_quote_lines', 'sourcing_decisions', 'purchase_orders',
      'purchase_order_lines', 'purchase_order_line_requirements', 'purchase_order_history']);

    // ── Fornecedor = papel de parte ──────────────────────────────────────
    const doc = cnpj(Date.now());
    const s1 = await act('supplier_register', org, actor, J({ legal_name: `Cabos Prova ${stamp} Ltda`, document_type: 'cnpj',
      document_number: doc, categories: ['Cabos'], default_lead_time_days: 10 }));
    const again = await act('supplier_register', org, actor, J({ legal_name: 'Outro nome', document_type: 'cnpj', document_number: doc }));
    check('mesmo CNPJ reusa a MESMA parte e o MESMO fornecedor (sem contraparte paralela)',
      s1.party_created && !again.party_created && again.party_id === s1.party_id && again.supplier_id === s1.supplier_id);
    const role = await one(`SELECT count(*)::int n FROM public.party_roles WHERE party_id = $1 AND role = 'supplier'`, [s1.party_id]);
    check('fornecedor é papel canônico da parte', role.n === 1);
    const s2 = (await act('supplier_register', org, actor, J({ legal_name: `Elétrica Prova ${stamp}`, document_type: 'cnpj',
      document_number: cnpj(Date.now() + 7) }))).supplier_id;
    const s3 = (await act('supplier_register', org, actor, J({ legal_name: `Bloqueado Prova ${stamp}` }))).supplier_id;
    await rejects('bloquear fornecedor exige motivo', 'SELECT public.supplier_set_status($1,$2,$3,$4,$5)',
      [org, actor, s3, 'BLOCKED', null], /supp_restriction_has_reason/);
    await act('supplier_set_status', org, actor, s3, 'BLOCKED', 'Não conformidade grave');
    await act('supplier_set_status', org, actor, s1.supplier_id, 'HOMOLOGATED', null);

    // ── Requisição a partir da falta ─────────────────────────────────────
    const item = await proofItem(ctx, anchors, `CAB-${stamp}`, 'm');
    const project = await proofProject(ctx, anchors, `P234-${stamp}`);
    const reqA = await confirmedMaterial(ctx, anchors, project, item, 600, '2026-11-10');
    const reqB = await confirmedMaterial(ctx, anchors, project, item, 400, '2026-11-20');
    const site = (await act('inventory_location_upsert', org, actor, J({ code: `OBRA-${stamp}`, name: 'Canteiro prova',
      kind: 'PROJECT_SITE', project_id: project }))).location_id;
    const rc = await act('purchase_requisition_from_shortage', org, actor, J({ requirement_ids: [reqA, reqB], idempotency_key: `rc-${stamp}` }));
    const lines = await all(`SELECT l.id, l.quantity::float q, (SELECT count(*)::int FROM public.purchase_requisition_line_requirements a WHERE a.line_id = l.id) n
      FROM public.purchase_requisition_lines l WHERE l.requisition_id = $1`, [rc.requisition_id]);
    check('mesmo item consolidado numa linha com rastro de cada requisito', lines.length === 1 && lines[0].q === 1000 && lines[0].n === 2, J(lines));
    let cov = await coverage(reqA);
    check('requisitado aparece na cobertura; a falta continua visível', cov.q === 600 && cov.s === 600, J(cov));
    const replay = await act('purchase_requisition_from_shortage', org, actor, J({ requirement_ids: [reqA, reqB], idempotency_key: `rc-${stamp}` }));
    check('requisição repetida com a mesma chave devolve a mesma', replay.replayed && replay.requisition_id === rc.requisition_id);
    await rejects('mesma falta não é requisitada duas vezes', 'SELECT public.purchase_requisition_from_shortage($1,$2,$3)',
      [org, actor, J({ requirement_ids: [reqA] })], /no uncovered shortage left/);
    await rejects('requisição manual exige justificativa', 'SELECT public.purchase_requisition_create_manual($1,$2,$3)',
      [org, actor, J({ lines: [{ item_id: item, quantity: 5 }] })], /preqn_manual_justified/);

    // ── Cotação e propostas ──────────────────────────────────────────────
    await rejects('fornecedor bloqueado não é convidado', 'SELECT public.procurement_rfq_create($1,$2,$3)',
      [org, actor, J({ requisition_line_ids: [lines[0].id], supplier_ids: [s3] })], /not invited/);
    const rfq = await act('procurement_rfq_create', org, actor, J({ requisition_line_ids: [lines[0].id], supplier_ids: [s1.supplier_id, s2] }));
    const rfqLine = await one(`SELECT id FROM public.procurement_rfq_lines WHERE rfq_id = $1`, [rfq.rfq_id]);
    await rejects('linha de requisição não entra em duas cotações vivas', 'SELECT public.procurement_rfq_create($1,$2,$3)',
      [org, actor, J({ requisition_line_ids: [lines[0].id], supplier_ids: [s2] })], /already in a live RFQ/);
    const q1 = await act('procurement_quote_record', org, actor, J({ rfq_id: rfq.rfq_id, supplier_id: s1.supplier_id, freight_amount: 500,
      lead_time_days: 12, validity_date: '2099-01-01', lines: [{ rfq_line_id: rfqLine.id, unit_price: 20 }] }));
    const q2 = await act('procurement_quote_record', org, actor, J({ rfq_id: rfq.rfq_id, supplier_id: s1.supplier_id, freight_amount: 300,
      lead_time_days: 10, validity_date: '2099-01-01', lines: [{ rfq_line_id: rfqLine.id, unit_price: 19 }] }));
    const v1 = await one(`SELECT status FROM public.supplier_quotes WHERE id = $1`, [q1.quote_id]);
    check('nova versão substitui a anterior (histórico preservado)', q2.version === 2 && v1.status === 'SUPERSEDED');
    await rejects('proposta registrada não se reescreve', 'UPDATE public.supplier_quotes SET freight_amount = 0 WHERE id = $1',
      [q2.quote_id], /immutable/);
    const q3 = await act('procurement_quote_record', org, actor, J({ rfq_id: rfq.rfq_id, supplier_id: s2, lead_time_days: 30,
      validity_date: '2099-01-01', lines: [{ rfq_line_id: rfqLine.id, unit_price: 17 }] }));
    await rejects('decisão sobre versão substituída é recusada', 'SELECT public.procurement_decide($1,$2,$3)',
      [org, actor, J({ rfq_id: rfq.rfq_id, quote_id: q1.quote_id, rationale: 'x' })], /current version/);
    await rejects('decisão sem justificativa é recusada', 'SELECT public.procurement_decide($1,$2,$3)',
      [org, actor, J({ rfq_id: rfq.rfq_id, quote_id: q2.quote_id, rationale: ' ' })], /rationale/);
    const dec = await act('procurement_decide', org, actor, J({ rfq_id: rfq.rfq_id, quote_id: q2.quote_id, recommended_quote_id: q3.quote_id,
      rationale: 'Prazo de 10 dias atende a necessidade de 10/11; a opção mais barata chega tarde.', comparison: { options: 2 } }));
    const d = await one(`SELECT follows_recommendation f FROM public.sourcing_decisions WHERE id = $1`, [dec.decision_id]);
    check('decisão contra a recomendação fica registrada com justificativa', d.f === false);
    const decAgain = await act('procurement_decide', org, actor, J({ rfq_id: rfq.rfq_id, quote_id: q2.quote_id, rationale: 'x' }));
    check('decisão repetida devolve o MESMO pedido (idempotente)', decAgain.replayed && decAgain.purchase_order_id === dec.purchase_order_id);
    const po = dec.purchase_order_id;
    const alloc = await all(`SELECT a.requirement_id, a.quantity::float q FROM public.purchase_order_line_requirements a
      JOIN public.purchase_order_lines l ON l.id = a.line_id WHERE l.purchase_order_id = $1 ORDER BY a.quantity DESC`, [po]);
    check('pedido aloca a quantidade aos requisitos, com rastro', alloc.length === 2 && alloc[0].q === 600 && alloc[1].q === 400, J(alloc));
    const total = await one(`SELECT public.purchase_order_total($1)::float t`, [po]);
    check('total do pedido derivado das linhas + frete (nada digitado)', total.t === 19 * 1000 + 300, String(total.t));

    // ── Aprovação: motor da plataforma, depois alçada declarada ──────────
    const subj = await one(`SELECT supported, found, amount::float a, fingerprint = public.purchase_order_fingerprint($3) fp
      FROM public.approval_subject_resolve($1, 'purchase_order', $2)`, [org, po, po]);
    check('o motor de aprovação reconhece o pedido de compra como sujeito', subj.supported && subj.found && subj.a === 19300 && subj.fp);
    await rejects('emitir sem aprovar é recusado', 'SELECT public.purchase_order_issue($1,$2,$3)', [org, actor, po], /only an approved/);
    await rejects('submeter sem local de entrega é recusado', 'SELECT public.purchase_order_submit($1,$2,$3,$4)',
      [org, actor, po, null], /delivery location/);
    await act('purchase_order_update_draft', org, actor, po, J({ delivery_location_id: site }));
    const sub = await act('purchase_order_submit', org, actor, po, 'Compra do cabo da obra');
    check('sem política no motor: governança por alçada declarada', sub.governance === 'AUTHORITY' && sub.status === 'APPROVAL_REQUIRED', J(sub));
    await rejects('quem criou/submeteu não aprova (segregação de funções)', 'SELECT public.purchase_order_decide($1,$2,$3,$4,$5)',
      [org, actor, po, 'APPROVE', 'ok'], /segregation of duties/);
    const approver = await one(`SELECT DISTINCT ur.user_id, ur.role_id FROM public.user_roles ur
      WHERE ur.organization_id = $1 AND ur.user_id <> $2 AND public.apex_actor_has_permission($1, ur.user_id, 'procurement.approve')
        AND EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id
                     WHERE rp.role_id = ur.role_id AND p.key = 'procurement.approve') LIMIT 1`, [org, actor]);
    if (!approver) {
      check('segundo aprovador disponível no inquilino de prova', false, 'nenhum outro usuário com procurement.approve');
    } else {
      await rejects('sem alçada declarada, permissão não basta para aprovar', 'SELECT public.purchase_order_decide($1,$2,$3,$4,$5)',
        [org, approver.user_id, po, 'APPROVE', 'ok'], /authority not configured/);
      await rejects('ninguém declara alçada para si mesmo', 'SELECT public.procurement_authority_declare($1,$2,$3)',
        [org, actor, J({ grantee_kind: 'USER', grantee_user_id: actor, source_kind: 'BYLAWS', source_reference: 'x', justification: 'x' })], /self-declared/);
      await act('procurement_authority_declare', org, actor, J({ grantee_kind: 'ROLE', grantee_role_id: approver.role_id,
        max_amount: 10000, currency: 'BRL', source_kind: 'BOARD_RESOLUTION', source_reference: `ATA-${stamp}`, justification: 'Prova' }));
      await rejects('alçada com teto abaixo do total não aprova', 'SELECT public.purchase_order_decide($1,$2,$3,$4,$5)',
        [org, approver.user_id, po, 'APPROVE', 'ok'], /authority not configured/);
      await act('procurement_authority_declare', org, actor, J({ grantee_kind: 'ROLE', grantee_role_id: approver.role_id,
        max_amount: 50000, currency: 'BRL', source_kind: 'BOARD_RESOLUTION', source_reference: `ATA2-${stamp}`, justification: 'Prova' }));
      const ok = await act('purchase_order_decide', org, approver.user_id, po, 'APPROVE', 'Dentro da alçada');
      check('aprovação por alçada declarada registra a alçada usada', ok.status === 'APPROVED' && Boolean(ok.authority_id));
      await rejects('linha de pedido aprovado não muda', `UPDATE public.purchase_order_lines SET unit_price = 1 WHERE purchase_order_id = $1`,
        [po], /only while DRAFT/);
      await act('purchase_order_issue', org, actor, po);
      cov = await coverage(reqA);
      check('pedido emitido: em pedido cobre a falta; requisitado zera', cov.o === 600 && cov.q === 0 && cov.s === 0, J(cov));
      const rcs = await one(`SELECT status FROM public.purchase_requisitions WHERE id = $1`, [rc.requisition_id]);
      check('requisição atendida pela compra fica ORDERED', rcs.status === 'ORDERED');
      await act('inventory_adjust', org, actor, J({ item_id: item, location_id: site, quantity: 50, reason: 'Saldo inicial' }));
      await rejects('estoque não cobre de novo o que já está em pedido', 'SELECT public.inventory_reserve($1,$2,$3)',
        [org, actor, J({ requirement_id: reqA, location_id: site, quantity: 10 })], /over-cover/);
      await act('purchase_order_cancel', org, actor, po, 'Fornecedor não confirmou o prazo');
      cov = await coverage(reqA);
      const back = await one(`SELECT status FROM public.purchase_requisitions WHERE id = $1`, [rc.requisition_id]);
      check('cancelar pedido devolve a necessidade à requisição (requisitado volta)', cov.o === 0 && cov.q === 600 && back.status === 'SUBMITTED', J(cov));
    }

    // ── Motor: desfecho e rota ──────────────────────────────────────────
    const notPo = await one(`SELECT public.purchase_order_apply_approval(gen_random_uuid()) r`);
    check('desfecho de outro sujeito não toca pedido', notPo.r.applied === false);
    const route = await one(`SELECT count(*)::int n, bool_or(enabled) e FROM public.apex_event_routes WHERE job_type = 'procurement.purchase_order.apply_approval'`);
    check('rota de desfecho semeada DESLIGADA até o handler ser publicado', route.n === 2 && route.e === false);
    const ev = await all(`SELECT DISTINCT event_type FROM public.domain_events WHERE organization_id = $1 AND aggregate_id = $2`, [org, po]);
    const types = new Set(ev.map((e) => e.event_type));
    check('eventos do pedido: criado, submetido, aprovado, emitido, cancelado',
      ['supply.purchase_order.created', 'supply.purchase_order.submitted', 'supply.purchase_order.approved',
        'supply.purchase_order.issued', 'supply.purchase_order.cancelled'].every((t) => types.has(t)), [...types].join(','));
    // Leitura REAL como navegador (role authenticated + claims do ator): prova que a
    // política nova de fornecedor não entra em recursão e mostra o fornecedor.
    await db.query('SAVEPOINT as_browser');
    try {
      // A organização ATIVA do ator é a da prova (revertido com o SAVEPOINT).
      await db.query(`INSERT INTO public.user_active_organization (user_id, organization_id) VALUES ($1, $2)
        ON CONFLICT (user_id) DO UPDATE SET organization_id = EXCLUDED.organization_id`, [actor, org]);
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [J({ sub: actor, role: 'authenticated' })]);
      await db.query('SET LOCAL ROLE authenticated');
      const seen = (await db.query(`SELECT count(*)::int n FROM public.parties WHERE id = $1`, [s1.party_id])).rows[0];
      const roles = (await db.query(`SELECT count(*)::int n FROM public.party_roles WHERE party_id = $1`, [s1.party_id])).rows[0];
      check('navegador lê parties/party_roles do fornecedor sem recursão de RLS', seen.n === 1 && roles.n === 1, J({ seen, roles }));
    } catch (error) {
      check('navegador lê parties/party_roles do fornecedor sem recursão de RLS', false, error.message);
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT as_browser');
      await db.query('RELEASE SAVEPOINT as_browser');
    }
  },
});
