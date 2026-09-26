/**
 * 250 — Compras: proposta, decisão e pedido nunca acima do aberto.
 *
 *   node scripts/operations/apply-250.mjs --target=qa [--apply]
 *   node scripts/operations/apply-250.mjs [--apply]
 *
 * Regra: docs/operations-supply/COVERAGE-SEMANTICS.md (seção 250). Aqui, sempre desfeito: a governança e as
 * recusas das três reescritas (o corpo novo é o implantado mais as inserções), a ordem das travas intacta, e os
 * casos: quantidade exata, acima (recusada, sem aparar), proposta parcial, proposta envelhecida (o aberto caiu
 * depois dela — montado por escrita direta, como a apply-249 monta o legado), decisão parcial e segunda
 * decisão depois da primeira, outra proposta numa cotação já decidida, cotação de várias linhas, linha de
 * requisição morta, linha manual, quantidade zero, e a emissão como última barreira (pedido acima do que a
 * requisição cobre, montado por escrita direta no rascunho). Toda quantidade é comparada como DECIMAL do banco
 * (texto), nunca por float. As decisões concorrentes com COMMIT real ficam no qa-live
 * (tests/qa-live/dashboard-supply-flow.spec.ts, bloco 250).
 */
import { runMigration } from './lib/proof-kit.mjs';
import { confirmedMaterial, homologatedSupplier, proofItem, proofProject, purchaseOrderFromLines, secondApprover } from './lib/fixtures.mjs';

const CHANGED = ['procurement_quote_record(uuid,uuid,jsonb)', 'procurement_decide(uuid,uuid,jsonb)', 'purchase_order_issue(uuid,uuid,uuid)'];
const TUCURUI_PO = 'OC-260924-5A811';
const TUCURUI_RFQ = 'COT-260924-98CDA';

/** Decimal do banco como texto canônico (sem zeros à direita): '150.0000' → '150'. */
const dec = (x) => (x == null ? null : String(x).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''));
/** Fonte de função sem os comentários `--`. */
const code = (source) => source.replace(/--[^\n]*/g, '');
const at = (text, re) => { const m = re.exec(text); return m ? m.index : -1; };
const raises = (source) => [...code(source).matchAll(/RAISE EXCEPTION '((?:[^']|'')*)'[^;]*?ERRCODE = '(\w+)'/g)]
  .map((m) => `${m[2]} ${m[1]}`).sort();
const codeLines = (source) => code(source).split('\n').map((l) => l.trim()).filter(Boolean);
const LOCK = /\bFOR (?:UPDATE|NO KEY UPDATE|SHARE|KEY SHARE)\b/g;

const NEW_RAISES = {
  'procurement_quote_record(uuid,uuid,jsonb)': [
    '22023 Quote line quantity must be positive.',
    '23514 Quoted quantity % exceeds the quoteable quantity % (requisition %).',
    '23514 Requisition % is %: its line can no longer be quoted.'],
  'procurement_decide(uuid,uuid,jsonb)': [
    '23514 Quote line would order % beyond the requirements of its requisition line.',
    '23514 Quoted quantity % exceeds the current open quantity % (requisition %): record a new quote.',
    '23514 RFQ is already decided on another quote.'],
  'purchase_order_issue(uuid,uuid,uuid)': [
    '23514 Purchase order line orders % but its requisition covers only %: it cannot be issued.'],
};

let before = null;

await runMigration({
  version: '250',
  expectedTip: '249',
  async preflight(db) {
    before = {};
    for (const fn of CHANGED) {
      before[fn] = (await db.query(`SELECT prosrc FROM pg_proc WHERE oid = $1::regprocedure`, [`public.${fn}`])).rows[0]?.prosrc ?? null;
    }
  },
  async proofs(ctx) {
    const { db, one, all, check, browserCannotExecute, anchors } = ctx;
    const { org, actor } = anchors;
    const stamp = Date.now().toString(36).toUpperCase();
    const J = (x) => JSON.stringify(x);
    const act = async (fn, ...args) => (await one(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) r`, args)).r;
    let seq = 0;
    const refuse = async (label, sql, params, sqlstate, pattern) => {
      const sp = `sp250_${++seq}`;
      await db.query(`SAVEPOINT ${sp}`);
      try {
        await db.query(sql, params);
        await db.query(`RELEASE SAVEPOINT ${sp}`);
        return check(label, false, 'foi aceito, deveria ter sido recusado');
      } catch (error) {
        await db.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        await db.query(`RELEASE SAVEPOINT ${sp}`);
        return check(label, error.code === sqlstate && pattern.test(error.message), `${error.code}: ${error.message.slice(0, 170)}`);
      }
    };
    const attempt = async (label, fn) => {
      const sp = `sp250_${++seq}`;
      await db.query(`SAVEPOINT ${sp}`);
      try {
        const out = await fn();
        await db.query(`RELEASE SAVEPOINT ${sp}`);
        return out;
      } catch (error) {
        await db.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        await db.query(`RELEASE SAVEPOINT ${sp}`);
        check(label, false, `${error.code ?? ''}: ${error.message.slice(0, 200)}`);
        return null;
      }
    };

    // ── Governança e fonte ──────────────────────────────────────────────────
    await browserCannotExecute(CHANGED);
    for (const fn of CHANGED) {
      const g = await one(`SELECT p.prosecdef d, p.proconfig cfg, p.proowner::regrole::text owner,
          (SELECT array_agg(x ORDER BY x) FROM (SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END x
             FROM aclexplode(p.proacl) a WHERE a.privilege_type = 'EXECUTE') e) grantees
        FROM pg_proc p WHERE p.oid = $1::regprocedure`, [`public.${fn}`]);
      check(`${fn.split('(')[0]}: mesma assinatura; EXECUTE só do service_role; DEFINER com search_path fixo`,
        J((g.grantees ?? []).filter((x) => x !== g.owner)) === J(['service_role']) && g.d
        && (g.cfg ?? []).some((c) => c.startsWith('search_path=')), J(g));
      const now = (await one(`SELECT prosrc FROM pg_proc WHERE oid = $1::regprocedure`, [`public.${fn}`])).prosrc;
      const kept = new Set(codeLines(now));
      const lost = before?.[fn] ? codeLines(before[fn]).filter((l) => !kept.has(l)) : ['(fonte 249 não lido)'];
      const expected = [...raises(before?.[fn] ?? ''), ...NEW_RAISES[fn]].sort();
      check(`${fn.split('(')[0]}: toda linha de código da 249 continua lá; recusas = as da 249 + as novas da 250`,
        Boolean(before?.[fn]) && lost.length === 0 && J(raises(now)) === J(expected), J({ lost, raises: raises(now) }));
      check(`${fn.split('(')[0]}: nenhuma trava nova (as mesmas travas da 249)`,
        (code(now).match(LOCK) ?? []).length === (code(before?.[fn] ?? '').match(LOCK) ?? []).length);
    }
    const sDecide = code((await one(`SELECT prosrc FROM pg_proc WHERE oid = 'public.procurement_decide(uuid,uuid,jsonb)'::regprocedure`)).prosrc);
    check('decisão: a conferência do aberto vem depois das travas (requisitos → requisições → cotação) e antes de gravar a decisão',
      at(sDecide, /FROM public\.procurement_rfqs WHERE[^;]*FOR UPDATE;/) < at(sDecide, /exceeds the current open quantity/)
      && at(sDecide, /exceeds the current open quantity/) < at(sDecide, /INSERT INTO public\.sourcing_decisions/));
    const sIssue = code((await one(`SELECT prosrc FROM pg_proc WHERE oid = 'public.purchase_order_issue(uuid,uuid,uuid)'::regprocedure`)).prosrc);
    check('emissão: a conferência do que a requisição cobre vem antes de o pedido virar EMITIDO',
      at(sIssue, /its requisition covers only/) >= 0 && at(sIssue, /its requisition covers only/) < at(sIssue, /SET status = 'ISSUED'/));

    // ── Neutralidade: o QA não tem proposta viva nem pedido acima do cotado ─────
    const qa = await one(`SELECT
        (SELECT count(*)::int FROM public.supplier_quote_lines ql
           JOIN public.supplier_quotes q ON q.id = ql.quote_id AND q.status = 'RECEIVED'
           JOIN public.procurement_rfq_lines x ON x.id = ql.rfq_line_id
           JOIN public.procurement_rfqs f ON f.id = x.rfq_id AND f.status = 'OPEN'
           JOIN public.purchase_requisition_lines l ON l.id = x.requisition_line_id
          WHERE ql.quantity > LEAST(x.quantity, COALESCE((SELECT sum(o.open_qty) FROM public.purchase_requisition_open_allocations o
                                                          WHERE o.requisition_line_id = l.id), l.quantity))) quotes,
        (SELECT count(*)::int FROM public.purchase_order_lines pl JOIN public.purchase_orders po ON po.id = pl.purchase_order_id
          WHERE po.status NOT IN ('CANCELLED') AND pl.requisition_line_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM public.purchase_requisition_line_requirements a WHERE a.line_id = pl.requisition_line_id)
            AND pl.quantity > COALESCE((SELECT sum(a.quantity) FROM public.purchase_order_line_requirements a WHERE a.line_id = pl.id), 0)) orders`);
    check('neutralidade: nenhuma proposta viva acima do cotável e nenhum pedido (não cancelado) com unidade sem requisito no QA',
      qa.quotes === 0 && qa.orders === 0, J(qa));

    // ── Cenários ────────────────────────────────────────────────────────────
    let n = 0;
    const scene = async (label, items = 1) => {
      const k = `${label}${++n}`;
      const project = await proofProject(ctx, anchors, `P250-${k}-${stamp}`);
      const list = [];
      for (let i = 0; i < items; i += 1) list.push(await proofItem(ctx, anchors, `I250-${k}${'XYZ'[i]}-${stamp}`, 'm'));
      const site = (await act('inventory_location_upsert', org, actor,
        J({ code: `S250-${k}-${stamp}`, name: `S250 ${k}`, kind: 'PROJECT_SITE', project_id: project }))).location_id;
      return { k, project, item: list[0], items: list, site };
    };
    const need = (s, quantity, item = s.item) => confirmedMaterial(ctx, anchors, s.project, item, quantity);
    const requisition = async (requirementIds) => {
      const out = await act('purchase_requisition_from_shortage', org, actor, J({ requirement_ids: requirementIds }));
      const lines = await all(`SELECT id, item_id FROM public.purchase_requisition_lines WHERE requisition_id = $1 ORDER BY created_at, id`,
        [out.requisition_id]);
      return { id: out.requisition_id, number: out.requisition_number, lineOf: Object.fromEntries(lines.map((l) => [l.item_id, l.id])) };
    };
    const rfqFor = async (lineIds, suppliers) => {
      const rfq = await act('procurement_rfq_create', org, actor, J({ requisition_line_ids: lineIds, supplier_ids: suppliers }));
      const lines = await all(`SELECT id, requisition_line_id, item_id, quantity::text q FROM public.procurement_rfq_lines WHERE rfq_id = $1`, [rfq.rfq_id]);
      return { id: rfq.rfq_id, lineOf: Object.fromEntries(lines.map((l) => [l.item_id, l.id])), lines };
    };
    const quoteSql = 'SELECT public.procurement_quote_record($1,$2,$3) r';
    const quote = (rfq, supplier, lines) => act('procurement_quote_record', org, actor, J({ rfq_id: rfq, supplier_id: supplier,
      validity_date: '2099-01-01', lead_time_days: 10, lines }));
    const decideSql = 'SELECT public.procurement_decide($1,$2,$3) r';
    const decide = (rfq, q) => act('procurement_decide', org, actor, J({ rfq_id: rfq, quote_id: q, rationale: 'Prova 250.' }));
    const poLines = async (po) => (await all(`SELECT pl.item_id, pl.quantity::text q,
        COALESCE((SELECT sum(a.quantity) FROM public.purchase_order_line_requirements a WHERE a.line_id = pl.id), 0)::text traced
        FROM public.purchase_order_lines pl WHERE pl.purchase_order_id = $1 ORDER BY pl.item_id`, [po]))
      .map((l) => ({ item: l.item_id, q: dec(l.q), traced: dec(l.traced) }));
    const claimed = async (req) => dec((await one(`SELECT public.supply_requirement_claimed($1,$2)::text c`, [org, req])).c);
    const order = (s, lineIds, opts = {}) => purchaseOrderFromLines(ctx, anchors, { tag: `250${s.k}${stamp}`, lineIds, deliveryLocationId: s.site, ...opts });

    // 1) Exata: cota 100 de 100, decide, o pedido pede 100 com 100 rastreados
    {
      const s = await scene('EX');
      const r = await need(s, 100);
      const rc = await requisition([r]);
      const sup = await homologatedSupplier(ctx, anchors, `S250EX${stamp}`);
      const rfq = await rfqFor([rc.lineOf[s.item]], [sup]);
      const q = await attempt('(exata) proposta de 100 numa linha de 100', () => quote(rfq.id, sup, [{ rfq_line_id: rfq.lineOf[s.item], unit_price: 5, quantity: 100 }]));
      const d = q ? await attempt('(exata) decisão', () => decide(rfq.id, q.quote_id)) : null;
      check('(exata) pedido de 100, 100 rastreados aos requisitos', d && J(await poLines(d.purchase_order_id)) === J([{ item: s.item, q: '100', traced: '100' }]));
    }

    // 2) Acima: 101 numa linha de 100 → recusa (nada gravado); sem quantidade = a linha inteira; zero → recusa
    {
      const s = await scene('AC');
      const r = await need(s, 100);
      const rc = await requisition([r]);
      const sup = await homologatedSupplier(ctx, anchors, `S250AC${stamp}`);
      const rfq = await rfqFor([rc.lineOf[s.item]], [sup]);
      const qs = async () => (await one(`SELECT count(*)::int n FROM public.supplier_quotes WHERE rfq_id = $1`, [rfq.id])).n;
      await refuse('(acima) proposta de 101 numa linha de 100: recusada com o cotável, sem aparar', quoteSql,
        [org, actor, J({ rfq_id: rfq.id, supplier_id: sup, lines: [{ rfq_line_id: rfq.lineOf[s.item], unit_price: 5, quantity: 101 }] })],
        '23514', new RegExp(`^Quoted quantity 101 exceeds the quoteable quantity 100(\\.0+)? \\(requisition ${rc.number}\\)\\.$`));
      check('(acima) nada ficou gravado da proposta recusada', await qs() === 0);
      await refuse('(acima) quantidade zero: 22023', quoteSql,
        [org, actor, J({ rfq_id: rfq.id, supplier_id: sup, lines: [{ rfq_line_id: rfq.lineOf[s.item], unit_price: 5, quantity: 0 }] })],
        '22023', /^Quote line quantity must be positive\.$/);
      const q = await attempt('(acima) sem quantidade: cota a linha da cotação', () => quote(rfq.id, sup, [{ rfq_line_id: rfq.lineOf[s.item], unit_price: 5 }]));
      const got = q ? await one(`SELECT quantity::text q FROM public.supplier_quote_lines WHERE quote_id = $1`, [q.quote_id]) : null;
      check('(acima) sem quantidade: a proposta leva os 100 da linha', dec(got?.q) === '100', J(got));
    }

    // 3) Parcial e 5) segunda decisão depois da primeira
    {
      const s = await scene('PA');
      const r = await need(s, 100);
      const rc = await requisition([r]);
      const first = await attempt('(parcial) proposta de 60 decidida e emitida', () => order(s, [rc.lineOf[s.item]], { quantities: { [s.item]: 60 } }));
      check('(parcial) o pedido pede 60, 60 rastreados; emissão libera 40; reclamado 60',
        first && J(await poLines(first.poId)) === J([{ item: s.item, q: '60', traced: '60' }]) && await claimed(r) === '60');
      const rcb = await requisition([r]);
      check('(segunda) RC-B requisita os 40 que sobraram', (await one(`SELECT quantity::text q FROM public.purchase_requisition_lines WHERE id = $1`,
        [rcb.lineOf[s.item]]))?.q && dec((await one(`SELECT quantity::text q FROM public.purchase_requisition_lines WHERE id = $1`, [rcb.lineOf[s.item]])).q) === '40');
      const sup = await homologatedSupplier(ctx, anchors, `S250PB${stamp}`);
      const rfq = await rfqFor([rcb.lineOf[s.item]], [sup]);
      await refuse('(segunda) proposta de 41 para os 40 abertos: recusada', quoteSql,
        [org, actor, J({ rfq_id: rfq.id, supplier_id: sup, lines: [{ rfq_line_id: rfq.lineOf[s.item], unit_price: 5, quantity: 41 }] })],
        '23514', /^Quoted quantity 41 exceeds the quoteable quantity 40(\.0+)? \(requisition /);
      const q = await attempt('(segunda) proposta de 40', () => quote(rfq.id, sup, [{ rfq_line_id: rfq.lineOf[s.item], unit_price: 5, quantity: 40 }]));
      const d = q ? await attempt('(segunda) segunda decisão', () => decide(rfq.id, q.quote_id)) : null;
      const total = await one(`SELECT COALESCE(sum(a.quantity), 0)::text t FROM public.purchase_order_line_requirements a
          JOIN public.purchase_order_lines pl ON pl.id = a.line_id JOIN public.purchase_orders po ON po.id = pl.purchase_order_id
         WHERE a.requirement_id = $1 AND po.status <> 'CANCELLED'`, [r]);
      check('(segunda) as duas decisões somam 100 pedidos para o requisito de 100 — nunca acima', d && dec(total.t) === '100', J(total));
    }

    // 4) Proposta envelhecida: o aberto cai depois da proposta (escrita direta) → a decisão recusa; nova proposta passa
    {
      const s = await scene('EN');
      const r = await need(s, 100);
      const rc = await requisition([r]);
      const sup = await homologatedSupplier(ctx, anchors, `S250EN${stamp}`);
      const rfq = await rfqFor([rc.lineOf[s.item]], [sup]);
      const q = await quote(rfq.id, sup, [{ rfq_line_id: rfq.lineOf[s.item], unit_price: 5, quantity: 100 }]);
      // o aberto da linha cai para 70 depois da proposta (mudança de fora do caminho governado, dentro do savepoint)
      await db.query(`UPDATE public.purchase_requisition_line_requirements SET quantity = 70 WHERE line_id = $1`, [rc.lineOf[s.item]]);
      await refuse('(envelhecida) decidir a proposta de 100 com 70 abertos: recusada, cota-se de novo', decideSql,
        [org, actor, J({ rfq_id: rfq.id, quote_id: q.quote_id, rationale: 'Prova 250.' })], '23514',
        new RegExp(`^Quoted quantity 100(\\.0+)? exceeds the current open quantity 70(\\.0+)? \\(requisition ${rc.number}\\): record a new quote\\.$`));
      check('(envelhecida) nenhuma decisão nem pedido ficou', (await one(`SELECT count(*)::int n FROM public.sourcing_decisions WHERE rfq_id = $1`, [rfq.id])).n === 0);
      await refuse('(envelhecida) nova proposta de 80 com 70 abertos: recusada', quoteSql,
        [org, actor, J({ rfq_id: rfq.id, supplier_id: sup, lines: [{ rfq_line_id: rfq.lineOf[s.item], unit_price: 5, quantity: 80 }] })],
        '23514', /^Quoted quantity 80 exceeds the quoteable quantity 70(\.0+)? \(requisition /);
      const q2 = await attempt('(envelhecida) nova proposta de 70', () => quote(rfq.id, sup, [{ rfq_line_id: rfq.lineOf[s.item], unit_price: 5, quantity: 70 }]));
      const d = q2 ? await attempt('(envelhecida) decisão da nova proposta', () => decide(rfq.id, q2.quote_id)) : null;
      check('(envelhecida) o pedido pede 70, 70 rastreados', d && J(await poLines(d.purchase_order_id)) === J([{ item: s.item, q: '70', traced: '70' }]));
    }

    // 6) Outra proposta numa cotação já decidida: recusada; a mesma proposta é repetição
    {
      const s = await scene('OU');
      const r = await need(s, 100);
      const rc = await requisition([r]);
      const a = await homologatedSupplier(ctx, anchors, `S250OA${stamp}`);
      const b = await homologatedSupplier(ctx, anchors, `S250OB${stamp}`);
      const rfq = await rfqFor([rc.lineOf[s.item]], [a, b]);
      const qa1 = await quote(rfq.id, a, [{ rfq_line_id: rfq.lineOf[s.item], unit_price: 5, quantity: 100 }]);
      const qb1 = await quote(rfq.id, b, [{ rfq_line_id: rfq.lineOf[s.item], unit_price: 4, quantity: 100 }]);
      const d = await decide(rfq.id, qa1.quote_id);
      await refuse('(outra proposta) decidir B numa cotação já decidida em A: recusada', decideSql,
        [org, actor, J({ rfq_id: rfq.id, quote_id: qb1.quote_id, rationale: 'Prova 250.' })], '23514', /^RFQ is already decided on another quote\.$/);
      const again = await decide(rfq.id, qa1.quote_id);
      check('(outra proposta) a mesma proposta A é repetição do mesmo pedido; um pedido só na cotação',
        again.replayed === true && again.purchase_order_id === d.purchase_order_id
        && (await one(`SELECT count(*)::int n FROM public.purchase_orders po JOIN public.sourcing_decisions sd ON sd.id = po.sourcing_decision_id
            WHERE sd.rfq_id = $1`, [rfq.id])).n === 1);
    }

    // 7) Cotação de várias linhas: uma linha acima derruba a proposta inteira; parcial numa, exata na outra
    {
      const s = await scene('ML', 2);
      const [ix, iy] = s.items;
      const rx = await need(s, 100, ix);
      const ry = await need(s, 50, iy);
      const rc = await requisition([rx, ry]);
      const sup = await homologatedSupplier(ctx, anchors, `S250ML${stamp}`);
      const rfq = await rfqFor([rc.lineOf[ix], rc.lineOf[iy]], [sup]);
      await refuse('(várias linhas) X 100 e Y 51 (de 50): a proposta inteira é recusada', quoteSql,
        [org, actor, J({ rfq_id: rfq.id, supplier_id: sup, lines: [
          { rfq_line_id: rfq.lineOf[ix], unit_price: 5, quantity: 100 }, { rfq_line_id: rfq.lineOf[iy], unit_price: 5, quantity: 51 }] })],
        '23514', /^Quoted quantity 51 exceeds the quoteable quantity 50(\.0+)? \(requisition /);
      check('(várias linhas) nada gravado', (await one(`SELECT count(*)::int n FROM public.supplier_quotes WHERE rfq_id = $1`, [rfq.id])).n === 0);
      const q = await attempt('(várias linhas) X 60 (parcial) e Y 50 (exata)', () => quote(rfq.id, sup, [
        { rfq_line_id: rfq.lineOf[ix], unit_price: 5, quantity: 60 }, { rfq_line_id: rfq.lineOf[iy], unit_price: 5, quantity: 50 }]));
      const d = q ? await attempt('(várias linhas) decisão', () => decide(rfq.id, q.quote_id)) : null;
      const lines = d ? await poLines(d.purchase_order_id) : [];
      check('(várias linhas) o pedido pede X 60 e Y 50, tudo rastreado',
        J(lines.map((l) => [l.item, l.q, l.traced]).sort()) === J([[ix, '60', '60'], [iy, '50', '50']].sort()), J(lines));
    }

    // 8) Linha de requisição morta: não se cota; a viva segue
    {
      const s = await scene('MO', 2);
      const [ix, iy] = s.items;
      const rca = await requisition([await need(s, 100, ix)]);
      const rcb = await requisition([await need(s, 50, iy)]);
      const sup = await homologatedSupplier(ctx, anchors, `S250MO${stamp}`);
      const rfq = await rfqFor([rca.lineOf[ix], rcb.lineOf[iy]], [sup]);
      await act('purchase_requisition_cancel', org, actor, rcb.id, 'Frente suspensa');
      await refuse('(morta) cotar a linha da RC-B cancelada: recusada', quoteSql,
        [org, actor, J({ rfq_id: rfq.id, supplier_id: sup, lines: [{ rfq_line_id: rfq.lineOf[iy], unit_price: 5, quantity: 50 }] })],
        '23514', new RegExp(`^Requisition ${rcb.number} is CANCELLED: its line can no longer be quoted\\.$`));
      const q = await attempt('(morta) cotar só a linha viva', () => quote(rfq.id, sup, [{ rfq_line_id: rfq.lineOf[ix], unit_price: 5, quantity: 100 }]));
      check('(morta) a proposta da linha viva fica gravada', Boolean(q?.quote_id));
    }

    // 9) Linha manual (sem alocação): cotável = a quantidade da linha
    {
      const s = await scene('MA');
      const man = await act('purchase_requisition_create_manual', org, actor, J({ justification: 'Compra manual de prova 250',
        project_id: s.project, lines: [{ item_id: s.item, quantity: 30 }] }));
      const line = (await one(`SELECT id FROM public.purchase_requisition_lines WHERE requisition_id = $1`, [man.requisition_id])).id;
      const sup = await homologatedSupplier(ctx, anchors, `S250MA${stamp}`);
      const rfq = await rfqFor([line], [sup]);
      await refuse('(manual) 31 numa linha manual de 30: recusada', quoteSql,
        [org, actor, J({ rfq_id: rfq.id, supplier_id: sup, lines: [{ rfq_line_id: rfq.lineOf[s.item], unit_price: 5, quantity: 31 }] })],
        '23514', /^Quoted quantity 31 exceeds the quoteable quantity 30(\.0+)? \(requisition /);
      const q = await attempt('(manual) 30', () => quote(rfq.id, sup, [{ rfq_line_id: rfq.lineOf[s.item], unit_price: 5, quantity: 30 }]));
      const d = q ? await attempt('(manual) decisão', () => decide(rfq.id, q.quote_id)) : null;
      check('(manual) o pedido pede 30', d && (await poLines(d.purchase_order_id))[0]?.q === '30');
    }

    // 10) Emissão, a última barreira: rascunho com linha acima do rastreado (escrita direta) não é emitido
    {
      const s = await scene('EM');
      const r = await need(s, 100);
      const rc = await requisition([r]);
      const o = await order(s, [rc.lineOf[s.item]], { until: 'DRAFT' });
      await db.query(`UPDATE public.purchase_order_lines SET quantity = quantity + 50 WHERE purchase_order_id = $1`, [o.poId]);
      await act('purchase_order_submit', org, actor, o.poId, null);
      const approver = await secondApprover(ctx, anchors);
      await act('procurement_authority_declare', org, actor, J({ grantee_kind: 'ROLE', grantee_role_id: approver.role_id,
        source_kind: 'BOARD_RESOLUTION', source_reference: `ATA-250EM${stamp}`, justification: 'Prova' }));
      await act('purchase_order_decide', org, approver.user_id, o.poId, 'APPROVE', 'Prova');
      await refuse('(emissão) pedido de 150 com 100 rastreados: não é emitido', 'SELECT public.purchase_order_issue($1,$2,$3) r',
        [org, actor, o.poId], '23514', /^Purchase order line orders 150(\.0+)? but its requisition covers only 100(\.0+)?: it cannot be issued\.$/);
      check('(emissão) o pedido segue APROVADO, sem liberação e sem em pedido',
        (await one(`SELECT status FROM public.purchase_orders WHERE id = $1`, [o.poId])).status === 'APPROVED' && await claimed(r) === '100');
    }

    // ── A demo de Tucuruí não foi tocada ─────────────────────────────────────
    const demo = await one(`SELECT (SELECT status FROM public.procurement_rfqs WHERE organization_id = $1 AND rfq_number = $2) rfq,
        (SELECT status FROM public.purchase_orders WHERE organization_id = $1 AND order_number = $3) po`, [org, TUCURUI_RFQ, TUCURUI_PO]);
    check('Tucuruí intacta: cotação da demo ABERTA, pedido da demo EMITIDO', (demo.rfq === 'OPEN' || demo.rfq === null)
      && (demo.po === 'ISSUED' || demo.po === null), J(demo));
  },
});
