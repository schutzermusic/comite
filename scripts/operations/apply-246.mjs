/**
 * 246 — Cobertura: uma regra só para estoque e compras.
 *
 *   node scripts/operations/apply-246.mjs --target=qa [--apply]
 *   node scripts/operations/apply-246.mjs [--apply]
 *
 * Regra e contrato: docs/operations-supply/COVERAGE-SEMANTICS.md. Aqui, o
 * contrato SEQUENCIAL (sempre desfeito); a corrida de verdade (requisição ∥
 * requisição, requisição ∥ transferência sob sobreposição forçada) é provada em
 * tests/qa-live/dashboard-supply-flow.spec.ts.
 */
import { runMigration } from './lib/proof-kit.mjs';
import { confirmedMaterial, issuedPurchaseOrder, proofItem, proofProject } from './lib/fixtures.mjs';

const CHANGED = [
  'supply_requirement_claimed(uuid,uuid)', 'supply_requirement_pending_transfers(uuid,uuid)',
  'purchase_requisition_shortage_outcome(uuid,uuid,boolean)', 'purchase_requisition_from_shortage(uuid,uuid,jsonb)',
  'inventory_reserve(uuid,uuid,jsonb)', 'inventory_transfer_request(uuid,uuid,jsonb)',
];

// As 18 colunas que a visão já tinha (nome e tipo) — não mudam; as novas vêm ANEXADAS.
const VIEW_BEFORE = [
  ['organization_id', 'uuid'], ['requirement_id', 'uuid'], ['project_id', 'text'], ['activity_id', 'uuid'], ['item_id', 'uuid'],
  ['requirement_type', 'text'], ['required_by', 'date'], ['unit', 'text'], ['required_qty', 'numeric(18,4)'],
  ['reserved_qty', 'numeric'], ['consumed_qty', 'numeric'], ['in_transit_qty', 'numeric'], ['on_order_qty', 'numeric'],
  ['requested_qty', 'numeric'], ['covered_qty', 'numeric'], ['inbound_qty', 'numeric'], ['shortage_qty', 'numeric'],
  ['inspection_qty', 'numeric'],
];

await runMigration({
  version: '246',
  expectedTip: '245',
  async proofs(ctx) {
    const { db, one, all, check, browserCannotExecute, tablesAreGoverned, anchors } = ctx;
    const { org, actor } = anchors;
    const stamp = Date.now().toString(36).toUpperCase();
    const J = (x) => JSON.stringify(x);
    const n = (x) => Number(x);
    const act = async (fn, ...args) => (await one(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) r`, args)).r;
    let seq = 0;
    /** Recusa com o SQLSTATE e a mensagem esperados (isolada em SAVEPOINT). */
    const refuse = async (label, sql, params, code, pattern) => {
      const sp = `sp246_${++seq}`;
      await db.query(`SAVEPOINT ${sp}`);
      try {
        await db.query(sql, params);
        await db.query(`RELEASE SAVEPOINT ${sp}`);
        return check(label, false, 'foi aceito, deveria ter sido recusado');
      } catch (error) {
        await db.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        await db.query(`RELEASE SAVEPOINT ${sp}`);
        return check(label, error.code === code && pattern.test(error.message), `${error.code}: ${error.message.slice(0, 170)}`);
      }
    };
    const cov = async (req) => one(`SELECT shortage_qty::float s, requested_qty::float q, pending_transfer_qty::float p,
        purchasable_qty::float b, in_transit_qty::float t, reserved_qty::float r
      FROM public.supply_requirement_coverage WHERE organization_id = $1 AND requirement_id = $2`, [org, req]);
    const requisition = (payload, who = actor) => act('purchase_requisition_from_shortage', org, who, J(payload));
    const REQ_SQL = 'SELECT public.purchase_requisition_from_shortage($1,$2,$3)';
    const pendingMsg = (number) => new RegExp(`is covered by pending internal transfer\\(s\\) ${number}: dispatch or cancel the transfer, or request a coverage exception\\.`);

    // ── 9. Governança (antes do cenário: o que o navegador alcança) ─────────
    await browserCannotExecute(CHANGED);
    for (const fn of CHANGED) {
      const r = await one(`SELECT has_function_privilege('service_role', $1, 'EXECUTE') s, p.prosecdef d, p.proconfig cfg
        FROM pg_proc p WHERE p.oid = $1::regprocedure`, [`public.${fn}`]);
      check(`${fn.split('(')[0]}: alcançável pelo servidor, DEFINER com search_path fixo`,
        r.s && r.d && (r.cfg ?? []).some((c) => c.startsWith('search_path=')));
    }
    await tablesAreGoverned(['procurement_coverage_exceptions']);
    const pcx = await one(`SELECT
        (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'procurement_coverage_exceptions' AND cmd = 'SELECT') pol,
        (SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
          WHERE t.tgrelid = 'public.procurement_coverage_exceptions'::regclass AND NOT t.tgisinternal) trg,
        (SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'public.procurement_coverage_exceptions'::regclass AND contype = 'f'
          AND pg_get_constraintdef(oid) ~ '^FOREIGN KEY \\(organization_id, ') tenant_fks`);
    check('livro de exceções: leitura por política, append-only (reescrita e apagamento recusados), FKs de inquilino',
      pcx.pol === 1 && J(pcx.trg) === J(['contracts_reject_history_erasure', 'operations_reject_history_rewrite']) && pcx.tenant_fks === 3, J(pcx));
    const cols = await all(`SELECT a.attname n, format_type(a.atttypid, a.atttypmod) t FROM pg_attribute a
      WHERE a.attrelid = 'public.supply_requirement_coverage'::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`);
    check('visão: as 18 colunas de antes intactas (nome, tipo, ordem); pendente e comprável ANEXADAS ao fim',
      J(cols.slice(0, 18).map((c) => [c.n, c.t])) === J(VIEW_BEFORE)
      && J(cols.slice(18).map((c) => [c.n, c.t])) === J([['pending_transfer_qty', 'numeric(18,4)'], ['purchasable_qty', 'numeric(18,4)']]),
      J(cols.slice(16).map((c) => c.n)));
    const vw = await one(`SELECT c.reloptions opts, has_table_privilege('authenticated', c.oid, 'SELECT') rs,
        has_table_privilege('authenticated', c.oid, 'INSERT') ri, has_table_privilege('anon', c.oid, 'SELECT') an
      FROM pg_class c WHERE c.oid = 'public.supply_requirement_coverage'::regclass`);
    check('visão: security_invoker; o navegador só lê; anônimo não lê', (vw.opts ?? []).includes('security_invoker=true') && vw.rs && !vw.ri && !vw.an, J(vw));
    const perm = await all(`SELECT r.key FROM public.role_permissions rp JOIN public.roles r ON r.id = rp.role_id AND r.organization_id IS NULL
      JOIN public.permissions p ON p.id = rp.permission_id WHERE p.key = 'procurement.coverage_override' ORDER BY r.key`);
    check('procurement.coverage_override semeada para owner_admin e ceo_diretoria — e NÃO para compras',
      J(perm.map((x) => x.key)) === J(['ceo_diretoria', 'owner_admin']), J(perm));
    const srcReq = (await one(`SELECT prosrc FROM pg_proc WHERE oid = 'public.purchase_requisition_from_shortage(uuid,uuid,jsonb)'::regprocedure`)).prosrc;
    const lockAt = srcReq.indexOf('FOR UPDATE');
    const rereadAt = srcReq.indexOf('idempotency_key = v_key', srcReq.indexOf('idempotency_key = v_key') + 1);
    const insertAt = srcReq.indexOf('INSERT INTO public.purchase_requisitions');
    check('requisição: trava os requisitos e relê a chave SOB a trava, antes de gravar o cabeçalho (padrão da 238)',
      lockAt > 0 && rereadAt > lockAt && insertAt > rereadAt, J({ lockAt, rereadAt, insertAt }));
    const srcTr = (await one(`SELECT prosrc FROM pg_proc WHERE oid = 'public.inventory_transfer_request(uuid,uuid,jsonb)'::regprocedure`)).prosrc;
    const srcRes = (await one(`SELECT prosrc FROM pg_proc WHERE oid = 'public.inventory_reserve(uuid,uuid,jsonb)'::regprocedure`)).prosrc;
    check('reserva e pedido de transferência usam o reclamado (guarda simétrica); a reserva relê a chave sob a trava',
      srcTr.includes('supply_requirement_claimed') && srcRes.includes('supply_requirement_claimed')
      && (srcRes.match(/idempotency_key = v_key/g) ?? []).length === 2);

    // ── Cenário comum: canteiro com 2000 m livres, almoxarifado com 2000 m ──
    const item = await proofItem(ctx, anchors, `I246-${stamp}`, 'm');
    const project = await proofProject(ctx, anchors, `P246-${stamp}`);
    const loc = async (code, kind, extra = {}) => (await act('inventory_location_upsert', org, actor,
      J({ code: `${code}-${stamp}`, name: code, kind, ...extra }))).location_id;
    const site = await loc('S246', 'PROJECT_SITE', { project_id: project });
    const depot = await loc('D246', 'WAREHOUSE');
    await act('inventory_adjust', org, actor, J({ item_id: item, location_id: site, quantity: 2000, reason: 'Prova 246' }));
    await act('inventory_adjust', org, actor, J({ item_id: item, location_id: depot, quantity: 2000, reason: 'Prova 246' }));
    /** 500 m requeridos; `reserve` no canteiro; transferência PEDIDA de `transfer` do almoxarifado. */
    const scenario = async ({ reserve = 100, transfer = 150 } = {}) => {
      const req = await confirmedMaterial(ctx, anchors, project, item, 500);
      if (reserve) await act('inventory_reserve', org, actor, J({ requirement_id: req, location_id: site, quantity: reserve }));
      const tr = transfer ? await act('inventory_transfer_request', org, actor, J({ from_location_id: depot, to_location_id: site,
        lines: [{ item_id: item, quantity: transfer, requirement_id: req }] })) : null;
      return { req, tr };
    };
    const traced = async (req) => n((await one(`SELECT COALESCE(sum(quantity), 0)::float q
      FROM public.purchase_requisition_line_requirements WHERE organization_id = $1 AND requirement_id = $2`, [org, req])).q);

    // ── 1. Pedida: pendente, não coberta — e não comprada de novo ────────────
    const s1 = await scenario();
    let c = await cov(s1.req);
    check('(1) 500 requeridos, 100 reservados, 150 em transferência PEDIDA: falta bruta 400, pendente 150, comprável 250',
      c.s === 400 && c.q === 0 && c.p === 150 && c.b === 250, J(c));
    const rq1 = await requisition({ requirement_ids: [s1.req] });
    const r1 = rq1.requirements?.[0] ?? {};
    check('(1) a requisição compra só o comprável (250) e nomeia a transferência pendente',
      n(rq1.requisitioned_qty) === 250 && rq1.override === false && rq1.replayed === false && rq1.requirements.length === 1
      && r1.requirement_id === s1.req && n(r1.requisitioned_qty) === 250 && n(r1.purchasable_qty) === 250 && n(r1.pending_transfer_qty) === 150
      && r1.pending_transfers?.length === 1 && r1.pending_transfers[0].transfer_number === s1.tr.transfer_number
      && r1.pending_transfers[0].transfer_id === s1.tr.transfer_id && r1.pending_transfers[0].status === 'REQUESTED'
      && n(r1.pending_transfers[0].quantity) === 150, J(rq1));
    c = await cov(s1.req);
    check('(1) rastro e visão: 250 requisitados, comprável 0, falta bruta segue 400 (risco continua vendo a falta)',
      await traced(s1.req) === 250 && c.q === 250 && c.b === 0 && c.s === 400, J(c));
    await refuse('(1) segunda requisição recusada com a mensagem da transferência pendente (nomeia a TR)', REQ_SQL,
      [org, actor, J({ requirement_ids: [s1.req] })], '23514', pendingMsg(s1.tr.transfer_number));

    // ── 2. Aprovada continua pendente ────────────────────────────────────────
    const s2 = await scenario();
    await act('inventory_transfer_approve', org, actor, s2.tr.transfer_id);
    c = await cov(s2.req);
    check('(2) APROVADA continua pendente (aprovar não segura estoque): pendente 150, comprável 250', c.p === 150 && c.b === 250 && c.s === 400, J(c));
    const rq2 = await requisition({ requirement_ids: [s2.req] });
    check('(2) requisição leva 250 e vê a transferência APPROVED', n(rq2.requisitioned_qty) === 250
      && rq2.requirements[0].pending_transfers[0].status === 'APPROVED', J(rq2));
    await refuse('(2) segunda requisição recusada (pendente cobre o resto)', REQ_SQL,
      [org, actor, J({ requirement_ids: [s2.req] })], '23514', pendingMsg(s2.tr.transfer_number));

    // ── 3. Cancelada devolve ao comprável ────────────────────────────────────
    await act('inventory_transfer_cancel', org, actor, s1.tr.transfer_id, 'Origem precisa do cabo em outra frente');
    c = await cov(s1.req);
    check('(3) cancelar a transferência devolve ao comprável: pendente 0, comprável 150 (400 − 250 requisitados)',
      c.p === 0 && c.b === 150 && c.q === 250, J(c));
    const rq3 = await requisition({ requirement_ids: [s1.req] });
    check('(3) nova requisição leva os 150, sem transferência pendente', n(rq3.requisitioned_qty) === 150
      && n(rq3.requirements[0].pending_transfer_qty) === 0 && rq3.requirements[0].pending_transfers.length === 0, J(rq3));
    await refuse('(3) coberto por requisições: mensagem de sempre ("no uncovered shortage left … already requested")', REQ_SQL,
      [org, actor, J({ requirement_ids: [s1.req] })], '23514', /no uncovered shortage left to requisition \(400(\.0+)? already requested\)/);

    // ── 4. Despachada reduz a compra ─────────────────────────────────────────
    await act('inventory_transfer_dispatch', org, actor, s2.tr.transfer_id, '{}');
    c = await cov(s2.req);
    check('(4) despachada (após a requisição de 250): em trânsito 150, pendente 0, falta 250, comprável = falta − requisitado = 0',
      c.t === 150 && c.p === 0 && c.s === 250 && c.q === 250 && c.b === 0, J(c));
    const s4 = await scenario();
    await act('inventory_transfer_approve', org, actor, s4.tr.transfer_id);
    await act('inventory_transfer_dispatch', org, actor, s4.tr.transfer_id, '{}');
    c = await cov(s4.req);
    check('(4) despachada antes de comprar: em trânsito 150, pendente 0, falta 250, comprável 250', c.t === 150 && c.p === 0 && c.s === 250 && c.b === 250, J(c));
    const rq4 = await requisition({ requirement_ids: [s4.req] });
    check('(4) a requisição compra a falta que sobra depois do despacho (250)', n(rq4.requisitioned_qty) === 250, J(rq4));

    // ── 5. Encerrada sem receber volta a ser comprável ──────────────────────
    await act('inventory_transfer_close', org, actor, s4.tr.transfer_id, 'Carga extraviada no trajeto — nada chegou ao canteiro');
    c = await cov(s4.req);
    check('(5) despachada e encerrada com 0 recebido: em trânsito 0, falta 400, comprável 150 (400 − 250 requisitados)',
      c.t === 0 && c.s === 400 && c.q === 250 && c.b === 150, J(c));

    // ── 6. Guarda simétrica: requisição primeiro, estoque depois ─────────────
    const s6 = await scenario({ reserve: 0, transfer: 0 });
    const rq6 = await requisition({ requirement_ids: [s6.req] });
    const claimed6 = await one(`SELECT public.supply_requirement_claimed($1,$2)::float cl, public.inventory_requirement_committed($1,$2)::float cm`, [org, s6.req]);
    check('(6) requisição cobre os 500; reclamado = comprometido (0) + requisitado (500)',
      n(rq6.requisitioned_qty) === 500 && claimed6.cl === 500 && claimed6.cm === 0, J({ rq6: rq6.requisitioned_qty, claimed6 }));
    await refuse('(6) transferência por cima da requisição que já cobre é recusada (over-cover, cita a requisição)',
      'SELECT public.inventory_transfer_request($1,$2,$3)', [org, actor, J({ from_location_id: depot, to_location_id: site,
        lines: [{ item_id: item, quantity: 10, requirement_id: s6.req }] })], '23514', /over-cover the requirement.*500(\.0+)? by open purchase requisitions/);
    await refuse('(6) reserva por cima da requisição que já cobre é recusada (over-cover, cita a requisição)',
      'SELECT public.inventory_reserve($1,$2,$3)', [org, actor, J({ requirement_id: s6.req, location_id: site, quantity: 10 })],
      '23514', /over-cover the requirement.*500(\.0+)? by open purchase requisitions/);
    const s6b = await scenario({ reserve: 100, transfer: 0 });
    await requisition({ requirement_ids: [s6b.req] });
    await refuse('(6) 100 reservados + 400 requisitados: nem 1 m a mais de reserva', 'SELECT public.inventory_reserve($1,$2,$3)',
      [org, actor, J({ requirement_id: s6b.req, location_id: site, quantity: 1 })], '23514', /over-cover the requirement/);
    // Duas linhas de requisitos diferentes, na ordem INVERSA dos ids, passam. A ORDEM das travas não se
    // observa numa transação só: o fonte é conferido em apply-247; a corrida fica no E2E.
    const a6 = await confirmedMaterial(ctx, anchors, project, item, 50);
    const b6 = await confirmedMaterial(ctx, anchors, project, item, 50);
    const [hi, lo] = [a6, b6].sort().reverse();
    const tr6 = await act('inventory_transfer_request', org, actor, J({ from_location_id: depot, to_location_id: site,
      lines: [{ item_id: item, quantity: 50, requirement_id: hi }, { item_id: item, quantity: 50, requirement_id: lo }] }));
    const c6 = await cov(lo);
    check('(6) pedido de transferência com requisitos fora de ordem grava as duas linhas',
      Boolean(tr6.transfer_id) && c6.p === 50 && (await cov(hi)).p === 50, J(c6));

    // ── 7. Exceção de cobertura governada ───────────────────────────────────
    const s7 = await scenario();
    const reason = 'Transferência depende da liberação do cliente em Marabá; a frente de lançamento não pode parar';
    let buyer = (await one(`SELECT ur.user_id FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.organization_id = $1 AND ur.user_id <> $2
        AND public.apex_actor_has_permission($1, ur.user_id, 'procurement.request')
        AND NOT public.apex_actor_has_permission($1, ur.user_id, 'procurement.coverage_override')
      ORDER BY (r.key = 'compras') DESC, ur.user_id LIMIT 1`, [org, actor]))?.user_id;
    let denyOverride = false;
    if (!buyer) {
      // Inquilino sem um comprador semeado: o próprio titular, com a exceção NEGADA por sobreposição.
      await one(`INSERT INTO public.user_permission_overrides (organization_id, user_id, permission_id, effect, reason)
        SELECT $1, $2, id, 'deny', 'Prova 246' FROM public.permissions WHERE key = 'procurement.coverage_override' RETURNING id`, [org, actor]);
      buyer = actor; denyOverride = true;
    }
    const k7 = `k7-${stamp}`;
    await refuse(`(7) ${denyOverride ? 'titular com a exceção negada' : 'compras'} pede a exceção: 42501, permissão conferida no banco`, REQ_SQL,
      [org, buyer, J({ requirement_ids: [s7.req], idempotency_key: k7, coverage_override: { reason } })], '42501',
      /Coverage exception requires procurement\.coverage_override\./);
    if (denyOverride) {
      await one(`DELETE FROM public.user_permission_overrides WHERE organization_id = $1 AND user_id = $2
        AND permission_id = (SELECT id FROM public.permissions WHERE key = 'procurement.coverage_override') RETURNING id`, [org, actor]);
    }
    await refuse('(7) motivo curto é recusado (23514)', REQ_SQL,
      [org, actor, J({ requirement_ids: [s7.req], coverage_override: { reason: 'Obra não pode parar' } })], '23514',
      /Coverage exception requires a reason of at least 20 characters\./);
    await refuse('(7) exceção sem motivo é recusada (23514)', REQ_SQL,
      [org, actor, J({ requirement_ids: [s7.req], coverage_override: {} })], '23514', /at least 20 characters/);
    const rq7 = await requisition({ requirement_ids: [s7.req], idempotency_key: k7, coverage_override: { reason } });
    const r7 = rq7.requirements?.[0] ?? {};
    check('(7) titular com motivo: requisita também o pendente (400 = falta − requisitado), declarado como exceção',
      n(rq7.requisitioned_qty) === 400 && rq7.override === true && n(r7.requisitioned_qty) === 400 && n(r7.purchasable_qty) === 250
      && n(r7.pending_transfer_qty) === 150 && r7.pending_transfers?.[0]?.transfer_number === s7.tr.transfer_number, J(rq7));
    const x7 = await all(`SELECT requirement_id, requisition_line_id IS NOT NULL has_line, shortage_qty::float s, requested_qty::float q,
        pending_transfer_qty::float p, purchasable_qty::float b, requisitioned_qty::float t, pending_transfers, reason, authorized_by,
        authorized_permission FROM public.procurement_coverage_exceptions WHERE organization_id = $1 AND requisition_id = $2`, [org, rq7.requisition_id]);
    check('(7) uma linha no livro: requisito, transferências, pendente, comprável antes, requisitado, motivo, pessoa e permissão',
      x7.length === 1 && x7[0].requirement_id === s7.req && x7[0].has_line && x7[0].s === 400 && x7[0].q === 0 && x7[0].p === 150
      && x7[0].b === 250 && x7[0].t === 400 && x7[0].pending_transfers[0].transfer_number === s7.tr.transfer_number
      && x7[0].reason === reason && x7[0].authorized_by === actor && x7[0].authorized_permission === 'procurement.coverage_override', J(x7));
    const ev7 = await all(`SELECT e.event_type, e.causation_event_id = s.id caused, e.payload->>'authorized_permission' perm,
        (e.payload->>'excepted_qty')::float ex FROM public.domain_events e
        JOIN public.domain_events s ON s.organization_id = e.organization_id AND s.event_type = 'supply.requisition.submitted'
         AND s.aggregate_id = e.aggregate_id
      WHERE e.organization_id = $1 AND e.aggregate_id = $2 AND e.event_type = 'supply.requisition.coverage_exception'`, [org, rq7.requisition_id]);
    check('(7) evento supply.requisition.coverage_exception, causado pela submissão (150 comprados por exceção)',
      ev7.length === 1 && ev7[0].caused && ev7[0].perm === 'procurement.coverage_override' && ev7[0].ex === 150, J(ev7));
    c = await cov(s7.req);
    check('(7) visão: requisitado 400, comprável 0, pendente segue 150 (a transferência continua existindo)', c.q === 400 && c.b === 0 && c.p === 150, J(c));
    await refuse('(7) o livro de exceções não se reescreve', 'UPDATE public.procurement_coverage_exceptions SET reason = $2 WHERE requisition_id = $1',
      [rq7.requisition_id, 'Motivo reescrito depois do fato, o que é proibido'], '42501', /não se reescreve/);
    const s7b = await scenario();
    const rq7b = await requisition({ requirement_ids: [s7b.req], coverage_override: null }, buyer);
    check('(7) sem a exceção, quem só tem procurement.request requisita o comprável (250) — a recusa era só da exceção',
      n(rq7b.requisitioned_qty) === 250 && rq7b.override === false, J(rq7b));
    const s7c = await scenario({ reserve: 100, transfer: 0 });
    const rq7c = await requisition({ requirement_ids: [s7c.req], coverage_override: { reason } });
    const x7c = await one(`SELECT count(*)::int k FROM public.procurement_coverage_exceptions WHERE requisition_id = $1`, [rq7c.requisition_id]);
    check('(7) exceção pedida sem transferência pendente não vira exceção (nada a declarar): 400, override falso, livro vazio',
      n(rq7c.requisitioned_qty) === 400 && rq7c.override === false && x7c.k === 0, J({ rq7c, x7c }));

    // ── 8. Idempotência: a chave relida sob a trava; a resposta repetida é a mesma ──
    const s8 = await scenario();
    const k8 = `k8-${stamp}`;
    const a8 = await requisition({ requirement_ids: [s8.req], idempotency_key: k8 });
    const b8 = await requisition({ requirement_ids: [s8.req], idempotency_key: k8 });
    check('(8) mesma chave: repetição devolve a mesma requisição e a MESMA resposta (não a regra "já coberto")',
      !a8.replayed && b8.replayed && a8.requisition_id === b8.requisition_id
      && J({ ...a8, replayed: null }) === J({ ...b8, replayed: null }) && await traced(s8.req) === 250, J({ a8, b8 }));
    const b7 = await requisition({ requirement_ids: [s7.req], idempotency_key: k7, coverage_override: { reason } });
    check('(8) repetição de uma requisição sob exceção devolve o registrado no livro (override, 250 comprável, 150 pendente)',
      b7.replayed && b7.requisition_id === rq7.requisition_id && J({ ...b7, replayed: null }) === J({ ...rq7, replayed: null }), J(b7));
    if (!denyOverride) {
      await refuse('(8) quem não tem a permissão não obtém nem a repetição de uma exceção (permissão antes da chave)', REQ_SQL,
        [org, buyer, J({ requirement_ids: [s7.req], idempotency_key: k7, coverage_override: { reason } })], '42501',
        /Coverage exception requires procurement\.coverage_override\./);
    }

    // ── 10. O sinal da Apex segue a regra padrão (nunca a exceção) ──────────
    const s10 = await scenario();
    const signal = async (key) => (await one(`INSERT INTO public.supply_signals (organization_id, signal_key, kind, severity, project_id,
        requirement_id, item_id, title, rationale, recommended_action, engine_version)
      VALUES ($1, $2, 'SHORTAGE', 'critical', $3, $4, $5, 'Comprar 400 m', 'Falta sem cobertura confirmada.', $6, 'proof.v1') RETURNING id`,
      [org, key, project, s10.req, item, J({ kind: 'REQUISITION', label: 'Requisitar 400 m',
        payload: { requirement_ids: [s10.req], quantity: 400, priority: 'high' } })])).id;
    const ex10 = await act('supply_signal_execute', org, actor, await signal(`shortage:${s10.req}:a`),
      J({ note: 'Prova 246', coverage_override: { reason: 'Tentativa de exceção pelo sinal da Apex — não vale' } }));
    const x10 = await one(`SELECT count(*)::int k FROM public.procurement_coverage_exceptions WHERE requisition_id = $1`, [ex10.result.requisition_id]);
    check('(10) executar o sinal REQUISITION compra só o comprável (250), mesmo com "coverage_override" nos ajustes',
      ex10.status === 'EXECUTED' && n(ex10.result.requisitioned_qty) === 250 && ex10.result.override === false && x10.k === 0, J(ex10));
    await refuse('(10) com o comprável zerado, o sinal é recusado pela transferência pendente (continua aberto)',
      'SELECT public.supply_signal_execute($1,$2,$3,$4)', [org, actor, await signal(`shortage:${s10.req}:b`), '{}'], '23514',
      pendingMsg(s10.tr.transfer_number));

    // ── 11. Tetos de recebimento inalterados: a liberação da inspeção segue no comprometido ──
    const itemI = await proofItem(ctx, anchors, `J246-${stamp}`, 'm');
    const reqI = await confirmedMaterial(ctx, anchors, project, itemI, 100);
    const quar = await loc('Q246', 'QUARANTINE');
    const po = await issuedPurchaseOrder(ctx, anchors, { tag: `246${stamp}`, requirementIds: [reqI], prices: { [itemI]: 5 }, deliveryLocationId: site });
    const gr = await act('goods_receipt_post', org, actor, J({ purchase_order_id: po.poId, location_id: quar,
      lines: [{ po_line_id: po.lineOf[itemI], accepted_quantity: 100 }] }));
    // Sobre-cobertura LEGADA (como a dos qa-flx-*/Tucuruí): requisição aberta de 30 gravada pela regra antiga.
    const legacy = await one(`INSERT INTO public.purchase_requisitions (organization_id, requisition_number, source, status, requested_by)
      VALUES ($1, $2, 'SHORTAGE', 'SUBMITTED', $3) RETURNING id`, [org, `RC-L246-${stamp}`, actor]);
    const legacyLine = await one(`INSERT INTO public.purchase_requisition_lines (organization_id, requisition_id, item_id, quantity)
      VALUES ($1, $2, $3, 30) RETURNING id`, [org, legacy.id, itemI]);
    await one(`INSERT INTO public.purchase_requisition_line_requirements (organization_id, line_id, requirement_id, quantity)
      VALUES ($1, $2, $3, 30) RETURNING id`, [org, legacyLine.id, reqI]);
    const cl11 = await one(`SELECT public.supply_requirement_claimed($1,$2)::float cl`, [org, reqI]);
    const grLine = await one(`SELECT id FROM public.goods_receipt_lines WHERE receipt_id = $1`, [gr.receipt_id]);
    const insp = await act('goods_receipt_inspect', org, actor, gr.receipt_id, J({ destination_location_id: site,
      lines: [{ line_id: grLine.id, approved_quantity: 100, rejected_quantity: 0 }] }));
    const c11 = await cov(reqI);
    check('(11) requisito já sobre-coberto (legado, reclamado 130/100): a inspeção ainda libera e reserva os 100 recebidos',
      gr.inspection_status === 'PENDING' && cl11.cl === 130 && Boolean(insp.transfer_id) && c11.r === 100, J({ cl11, insp, c11 }));
  },
});
