/**
 * 247 — Cobertura: a requisição da falta decide com valores brutos.
 *
 *   node scripts/operations/apply-247.mjs --target=qa [--apply]
 *   node scripts/operations/apply-247.mjs [--apply]
 *
 * Regra: docs/operations-supply/COVERAGE-SEMANTICS.md. Aqui (sempre desfeito):
 * os casos de arredondamento da revisão da 246 com os números exatos dela, a
 * regressão do contrato sequencial da 246 e a trava em ordem canônica do
 * pedido de transferência (conferida no fonte — a corrida fica no E2E).
 * Toda quantidade é comparada como DECIMAL do banco, nunca por float.
 */
import { runMigration } from './lib/proof-kit.mjs';
import { confirmedMaterial, proofItem, proofProject } from './lib/fixtures.mjs';

const FN = 'purchase_requisition_from_shortage(uuid,uuid,jsonb)';

/** Decimal do banco como texto canônico (sem zeros à direita): '150.0000' → '150'. */
const dec = (x) => (x == null ? null : String(x).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''));

await runMigration({
  version: '247',
  expectedTip: '246',
  async proofs(ctx) {
    const { db, one, all, check, succeeds, browserCannotExecute, anchors } = ctx;
    const { org, actor } = anchors;
    const stamp = Date.now().toString(36).toUpperCase();
    const J = (x) => JSON.stringify(x);
    const act = async (fn, ...args) => (await one(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) r`, args)).r;
    let seq = 0;
    /** Recusa com o SQLSTATE e a mensagem esperados (isolada em SAVEPOINT). */
    const refuse = async (label, sql, params, code, pattern) => {
      const sp = `sp247_${++seq}`;
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
    const cov = async (req) => {
      const row = await one(`SELECT shortage_qty::text s, requested_qty::text q, pending_transfer_qty::text p, purchasable_qty::text b
        FROM public.supply_requirement_coverage WHERE organization_id = $1 AND requirement_id = $2`, [org, req]);
      return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, dec(v)]));
    };
    const REQ_SQL = 'SELECT public.purchase_requisition_from_shortage($1,$2,$3)';
    // Uma chamada só (MATERIALIZED): a resposta e as quantidades dela como TEXTO do jsonb (sem passar por float).
    const REQ_TXT = `WITH s AS MATERIALIZED (SELECT public.purchase_requisition_from_shortage($1,$2,$3) x)
      SELECT x r, x->>'requisitioned_qty' t, x->'requirements'->0->>'purchasable_qty' b,
             x->'requirements'->0->>'pending_transfer_qty' p FROM s`;
    const withText = (row) => (row ? { ...row.r, txt: { t: dec(row.t), b: dec(row.b), p: dec(row.p) } } : null);
    const requisition = async (payload, who = actor) => withText(await one(REQ_TXT, [org, who, J(payload)]));
    const pendingMsg = (number) => new RegExp(`is covered by pending internal transfer\\(s\\) ${number}: dispatch or cancel the transfer, or request a coverage exception\\.`);
    const traced = async (req) => dec((await one(`SELECT COALESCE(sum(quantity), 0)::text q
      FROM public.purchase_requisition_line_requirements WHERE organization_id = $1 AND requirement_id = $2`, [org, req])).q);
    const ledger = async (requisitionId) => all(`SELECT requirement_id, shortage_qty::text s, requested_qty::text q,
        pending_transfer_qty::text p, purchasable_qty::text b, requisitioned_qty::text t, pending_transfers,
        requisitioned_qty = shortage_qty - requested_qty AS whole,
        requisitioned_qty > purchasable_qty AND requisitioned_qty <= purchasable_qty + pending_transfer_qty AS closes
      FROM public.procurement_coverage_exceptions WHERE organization_id = $1 AND requisition_id = $2`, [org, requisitionId]);
    const exceptionEvent = async (requisitionId) => all(`SELECT e.causation_event_id = s.id caused,
        e.payload->>'authorized_permission' perm, e.payload->>'excepted_qty' ex FROM public.domain_events e
        JOIN public.domain_events s ON s.organization_id = e.organization_id AND s.event_type = 'supply.requisition.submitted'
         AND s.aggregate_id = e.aggregate_id
      WHERE e.organization_id = $1 AND e.aggregate_id = $2 AND e.event_type = 'supply.requisition.coverage_exception'`, [org, requisitionId]);
    const reason = 'Transferência depende da liberação do cliente em Marabá; a frente de lançamento não pode parar';

    // ── Governança: a reescrita continua só do servidor ─────────────────────
    await browserCannotExecute([FN]);
    const g = await one(`SELECT p.prosecdef d, p.proconfig cfg, p.proowner::regrole::text owner,
        (SELECT array_agg(x ORDER BY x) FROM (SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END x
           FROM aclexplode(p.proacl) a WHERE a.privilege_type = 'EXECUTE') e) grantees
      FROM pg_proc p WHERE p.oid = $1::regprocedure`, [`public.${FN}`]);
    check('requisição da falta: EXECUTE só do service_role (além do dono); DEFINER com search_path fixo',
      J((g.grantees ?? []).filter((x) => x !== g.owner)) === J(['service_role']) && g.d
      && (g.cfg ?? []).some((c) => c.startsWith('search_path=')), J(g));

    // ── Fonte: brutos, sem a coluna arredondada da visão ────────────────────
    const srcReq = (await one(`SELECT prosrc FROM pg_proc WHERE oid = $1::regprocedure`, [`public.${FN}`])).prosrc;
    check('requisição: não lê o pendente nem o comprável numeric(18,4) da visão; soma as linhas e deriva o comprável dos brutos',
      !/\bc\.(purchasable_qty|pending_transfer_qty)\b/.test(srcReq) && srcReq.includes('l.source_reservation_id IS NULL')
      && srcReq.includes('GREATEST(v_short - v_pending, 0)'));
    const guardAt = srcReq.indexOf('IF v_pending > 0 THEN');
    const msgAt = srcReq.indexOf('is covered by pending internal transfer(s)');
    check('requisição: a recusa que nomeia transferências só sai sob "IF v_pending > 0"',
      guardAt > 0 && msgAt > guardAt && srcReq.indexOf('is covered by pending internal transfer(s)', msgAt + 1) < 0, J({ guardAt, msgAt }));
    const lockAt = srcReq.indexOf('FOR UPDATE');
    const rereadAt = srcReq.indexOf('idempotency_key = v_key', srcReq.indexOf('idempotency_key = v_key') + 1);
    const insertAt = srcReq.indexOf('INSERT INTO public.purchase_requisitions');
    check('requisição (regressão 246): trava os requisitos e relê a chave SOB a trava, antes de gravar o cabeçalho',
      lockAt > 0 && rereadAt > lockAt && insertAt > rereadAt, J({ lockAt, rereadAt, insertAt }));
    // A revisão da 246 notou que a prova (6) de lá não observa a ordem das travas: aqui, o fonte.
    const srcTr = (await one(`SELECT prosrc FROM pg_proc WHERE oid = 'public.inventory_transfer_request(uuid,uuid,jsonb)'::regprocedure`)).prosrc;
    const loop = /FOR\s+v_rid\s+IN\s+SELECT\s+DISTINCT[^;]*?\bORDER\s+BY\s+1\s+LOOP\s+PERFORM\s+1\s+FROM\s+public\.project_requirements\b[^;]*\bFOR\s+UPDATE;\s*END\s+LOOP;/.exec(srcTr);
    const loopEnd = loop ? loop.index + loop[0].length : -1;
    const firstLock = srcTr.indexOf('FROM public.project_requirements');
    const trInsertAt = srcTr.indexOf('INSERT INTO public.inventory_transfers (');
    check('pedido de transferência: o laço de travas dos requisitos é ORDENADO (ORDER BY 1), é a primeira trava de requisito e fecha antes de gravar a transferência',
      Boolean(loop) && firstLock > loop.index && firstLock < loopEnd && trInsertAt > loopEnd,
      J({ loopAt: loop?.index ?? -1, firstLock, loopEnd, trInsertAt }));

    // ── Cenário comum (o da 246): canteiro e almoxarifado com 2000 m ────────
    const item = await proofItem(ctx, anchors, `I247-${stamp}`, 'm');
    const project = await proofProject(ctx, anchors, `P247-${stamp}`);
    const loc = async (code, kind, extra = {}) => (await act('inventory_location_upsert', org, actor,
      J({ code: `${code}-${stamp}`, name: code, kind, ...extra }))).location_id;
    const site = await loc('S247', 'PROJECT_SITE', { project_id: project });
    const depot = await loc('D247', 'WAREHOUSE');
    await act('inventory_adjust', org, actor, J({ item_id: item, location_id: site, quantity: 2000, reason: 'Prova 247' }));
    await act('inventory_adjust', org, actor, J({ item_id: item, location_id: depot, quantity: 2000, reason: 'Prova 247' }));
    /** 500 m requeridos; `reserve` no canteiro; transferência PEDIDA de `transfer` do almoxarifado. */
    const scenario = async ({ reserve = 100, transfer = 150 } = {}) => {
      const req = await confirmedMaterial(ctx, anchors, project, item, 500);
      if (reserve) await act('inventory_reserve', org, actor, J({ requirement_id: req, location_id: site, quantity: reserve }));
      const tr = transfer ? await act('inventory_transfer_request', org, actor, J({ from_location_id: depot, to_location_id: site,
        lines: [{ item_id: item, quantity: transfer, requirement_id: req }] })) : null;
      return { req, tr };
    };

    // ── A. Exceção com reserva de 99,99996 (antes: violava pcx_is_an_exception) ──
    const sA = await scenario({ reserve: 99.99996, transfer: 150 });
    let c = await cov(sA.req);
    check('(A) visão inalterada (exibição): falta bruta 400,00004, pendente 150,0000, comprável 250,0000 arredondado',
      c.s === '400.00004' && c.q === '0' && c.p === '150' && c.b === '250', J(c));
    const rqA = withText(await succeeds('(A) titular com motivo: a exceção de cobertura é aceita (antes: erro cru da CHECK do livro)', REQ_TXT,
      [org, actor, J({ requirement_ids: [sA.req], coverage_override: { reason } })]));
    check('(A) requisita 400,00004 (o descoberto inteiro, bruto): comprável 250,00004 e pendente 150, declarados',
      rqA?.override === true && rqA.txt.t === '400.00004' && rqA.txt.b === '250.00004' && rqA.txt.p === '150', J(rqA?.txt));
    const xA = rqA ? await ledger(rqA.requisition_id) : [];
    check('(A) livro: uma linha com os brutos (falta 400,00004, comprável 250,00004, pendente 150, requisitado 400,00004) e a CHECK fecha',
      xA.length === 1 && xA[0].requirement_id === sA.req && dec(xA[0].s) === '400.00004' && dec(xA[0].q) === '0'
      && dec(xA[0].p) === '150' && dec(xA[0].b) === '250.00004' && dec(xA[0].t) === '400.00004' && xA[0].whole && xA[0].closes
      && xA[0].pending_transfers?.[0]?.transfer_number === sA.tr.transfer_number, J(xA));
    const evA = rqA ? await exceptionEvent(rqA.requisition_id) : [];
    check('(A) evento da exceção causado pela submissão, com exatamente 150 comprados por exceção',
      evA.length === 1 && evA[0].caused && evA[0].perm === 'procurement.coverage_override' && dec(evA[0].ex) === '150', J(evA));
    check('(A) rastro: 400,00004 requisitados para o requisito', await traced(sA.req) === '400.00004');

    // ── B. Requisição padrão com reserva de 99,99994 (antes: levava 250,0001) ──
    const sB = await scenario({ reserve: 99.99994, transfer: 150 });
    c = await cov(sB.req);
    check('(B) visão (exibição): comprável 250,0001 arredondado PARA CIMA — a requisição não lê mais essa coluna',
      c.s === '400.00006' && c.p === '150' && c.b === '250.0001', J(c));
    const rqB = await requisition({ requirement_ids: [sB.req] });
    check('(B) a requisição padrão leva 250,00006 (bruto), não 250,0001', rqB.override === false && rqB.txt.t === '250.00006'
      && rqB.txt.b === '250.00006' && rqB.txt.p === '150' && await traced(sB.req) === '250.00006', J(rqB.txt));
    const clB = await one(`SELECT public.supply_requirement_claimed($1,$2)::text cl,
        public.supply_requirement_claimed($1,$2) = (SELECT quantity FROM public.project_requirements WHERE organization_id = $1 AND id = $2) exact`,
      [org, sB.req]);
    check('(B) reclamado (comprometido + requisitado) fecha EXATAMENTE em 500 — nem 0,00004 a mais', clB.exact && dec(clB.cl) === '500', J(clB));
    await refuse('(B) segunda requisição recusada pela transferência pendente (nomeia a TR)', REQ_SQL,
      [org, actor, J({ requirement_ids: [sB.req] })], '23514', pendingMsg(sB.tr.transfer_number));

    // ── C. Falta ínfima sem transferência pendente (antes: "covered by pending … <NULL>") ──
    const sC = await scenario({ reserve: 499.99996, transfer: 0 });
    c = await cov(sC.req);
    check('(C) visão (exibição): falta 0,00004, pendente 0, comprável arredondado a 0', c.s === '0.00004' && c.p === '0' && c.b === '0', J(c));
    const rqC = withText(await succeeds('(C) sem pendente, a requisição NÃO é recusada como coberta por transferência', REQ_TXT,
      [org, actor, J({ requirement_ids: [sC.req] })]));
    check('(C) requisita os 0,00004 que faltam, sem transferência na resposta', rqC?.txt.t === '0.00004'
      && rqC.txt.p === '0' && rqC.requirements?.[0]?.pending_transfers?.length === 0, J(rqC?.txt));
    await refuse('(C) coberto por requisições: a mensagem de sempre, com o requisitado bruto', REQ_SQL,
      [org, actor, J({ requirement_ids: [sC.req] })], '23514', /no uncovered shortage left to requisition \(0\.00004 already requested\)/);

    // ── 1. Regressão 246: 500/100/150 → 250, depois recusa nomeando a TR ────
    const s1 = await scenario();
    c = await cov(s1.req);
    check('(1) 500 requeridos, 100 reservados, 150 PEDIDOS: falta 400, pendente 150, comprável 250', c.s === '400' && c.p === '150' && c.b === '250', J(c));
    const rq1 = await requisition({ requirement_ids: [s1.req] });
    const r1 = rq1.requirements?.[0] ?? {};
    check('(1) a requisição leva só o comprável (250) e nomeia a transferência pendente',
      rq1.txt.t === '250' && rq1.txt.b === '250' && rq1.txt.p === '150' && rq1.override === false && rq1.replayed === false
      && r1.pending_transfers?.length === 1 && r1.pending_transfers[0].transfer_number === s1.tr.transfer_number
      && r1.pending_transfers[0].status === 'REQUESTED', J(rq1));
    await refuse('(1) segunda requisição recusada com a mensagem da transferência pendente (nomeia a TR)', REQ_SQL,
      [org, actor, J({ requirement_ids: [s1.req] })], '23514', pendingMsg(s1.tr.transfer_number));

    // ── 3. Regressão 246: cancelar devolve 150 ao comprável ──────────────────
    await act('inventory_transfer_cancel', org, actor, s1.tr.transfer_id, 'Origem precisa do cabo em outra frente');
    c = await cov(s1.req);
    check('(3) transferência cancelada: pendente 0, comprável 150 (400 − 250 requisitados)', c.p === '0' && c.b === '150' && c.q === '250', J(c));
    const rq3 = await requisition({ requirement_ids: [s1.req] });
    check('(3) nova requisição leva os 150, sem transferência pendente', rq3.txt.t === '150' && rq3.txt.p === '0'
      && rq3.requirements[0].pending_transfers.length === 0, J(rq3.txt));
    await refuse('(3) coberto por requisições: "no uncovered shortage left … (400 already requested)"', REQ_SQL,
      [org, actor, J({ requirement_ids: [s1.req] })], '23514', /no uncovered shortage left to requisition \(400(\.0+)? already requested\)/);

    // ── 7. Regressão 246: exceção de cobertura governada ─────────────────────
    const s7 = await scenario();
    let buyer = (await one(`SELECT ur.user_id FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.organization_id = $1 AND ur.user_id <> $2
        AND public.apex_actor_has_permission($1, ur.user_id, 'procurement.request')
        AND NOT public.apex_actor_has_permission($1, ur.user_id, 'procurement.coverage_override')
      ORDER BY (r.key = 'compras') DESC, ur.user_id LIMIT 1`, [org, actor]))?.user_id;
    let denyOverride = false;
    if (!buyer) {
      // Inquilino sem um comprador semeado: o próprio titular, com a exceção NEGADA por sobreposição.
      await one(`INSERT INTO public.user_permission_overrides (organization_id, user_id, permission_id, effect, reason)
        SELECT $1, $2, id, 'deny', 'Prova 247' FROM public.permissions WHERE key = 'procurement.coverage_override' RETURNING id`, [org, actor]);
      buyer = actor; denyOverride = true;
    }
    const k7 = `k7-247-${stamp}`;
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
    const rq7 = await requisition({ requirement_ids: [s7.req], idempotency_key: k7, coverage_override: { reason } });
    check('(7) titular com motivo: requisita 400 (falta − requisitado), declarado como exceção',
      rq7.override === true && rq7.txt.t === '400' && rq7.txt.b === '250' && rq7.txt.p === '150'
      && rq7.requirements?.[0]?.pending_transfers?.[0]?.transfer_number === s7.tr.transfer_number, J(rq7));
    const x7 = await ledger(rq7.requisition_id);
    check('(7) uma linha no livro: falta 400, requisitado antes 0, pendente 150, comprável 250, requisitado 400',
      x7.length === 1 && dec(x7[0].s) === '400' && dec(x7[0].q) === '0' && dec(x7[0].p) === '150' && dec(x7[0].b) === '250'
      && dec(x7[0].t) === '400' && x7[0].closes, J(x7));
    const ev7 = await exceptionEvent(rq7.requisition_id);
    check('(7) evento supply.requisition.coverage_exception causado pela submissão (150 por exceção)',
      ev7.length === 1 && ev7[0].caused && dec(ev7[0].ex) === '150', J(ev7));
    const s7c = await scenario({ reserve: 100, transfer: 0 });
    const rq7c = await requisition({ requirement_ids: [s7c.req], coverage_override: { reason } });
    const x7c = await ledger(rq7c.requisition_id);
    check('(7) exceção pedida sem transferência pendente não vira exceção: 400, override falso, livro vazio',
      rq7c.txt.t === '400' && rq7c.override === false && x7c.length === 0, J({ t: rq7c.txt, x7c }));

    // ── 8. Regressão 246: repetição idempotente devolve a mesma resposta ────
    const s8 = await scenario();
    const k8 = `k8-247-${stamp}`;
    const a8 = await requisition({ requirement_ids: [s8.req], idempotency_key: k8 });
    const b8 = await requisition({ requirement_ids: [s8.req], idempotency_key: k8 });
    check('(8) mesma chave: a repetição devolve a mesma requisição e a MESMA resposta (não a regra "já coberto")',
      !a8.replayed && b8.replayed && a8.requisition_id === b8.requisition_id
      && J({ ...a8, replayed: null }) === J({ ...b8, replayed: null }) && await traced(s8.req) === '250', J({ a8: a8.txt, b8: b8.txt }));
    const b7 = await requisition({ requirement_ids: [s7.req], idempotency_key: k7, coverage_override: { reason } });
    check('(8) repetição de uma requisição sob exceção devolve o registrado no livro',
      b7.replayed && b7.requisition_id === rq7.requisition_id && J({ ...b7, replayed: null }) === J({ ...rq7, replayed: null }), J(b7.txt));
  },
});
