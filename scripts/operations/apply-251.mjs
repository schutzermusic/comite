/**
 * 251 — Supply: uma ordem de travas só (o recebimento entra nela).
 *
 *   node scripts/operations/apply-251.mjs --target=qa [--apply]
 *   node scripts/operations/apply-251.mjs [--apply]
 *
 * Regra: docs/operations-supply/COVERAGE-SEMANTICS.md (seção 251). Aqui, sempre desfeito: a governança e o corpo
 * das três reescritas (o implantado mais a pré-trava: toda linha e toda recusa ficam), a ordem das travas
 * conferida no fonte (linha-documento → requisitos em uuid → chaves de estoque em ordem de item → linhas e
 * movimentos), e a semântica de sempre em sequência: recebimento no canteiro (reserva até o teto do
 * comprometido), recebimento em quarentena + inspeção (rejeito e liberação), recebimento de transferência
 * (reserva no destino) e as repetições. Os impasses com COMMIT real ficam no qa-live
 * (tests/qa-live/concurrency.spec.ts) e no estresse (scripts/operations/stress-251.mjs).
 */
import { runMigration } from './lib/proof-kit.mjs';
import { confirmedMaterial, proofItem, proofProject, purchaseOrderFromLines } from './lib/fixtures.mjs';

const CHANGED = ['goods_receipt_post(uuid,uuid,jsonb)', 'goods_receipt_inspect(uuid,uuid,uuid,jsonb)', 'inventory_transfer_receive(uuid,uuid,uuid,jsonb)'];
const dec = (x) => (x == null ? null : String(x).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''));
const code = (source) => source.replace(/--[^\n]*/g, '');
const at = (text, re) => { const m = re.exec(text); return m ? m.index : -1; };
const raises = (source) => [...code(source).matchAll(/RAISE EXCEPTION '((?:[^']|'')*)'[^;]*?ERRCODE = '(\w+)'/g)]
  .map((m) => `${m[2]} ${m[1]}`).sort();
const codeLines = (source) => code(source).split('\n').map((l) => l.trim()).filter(Boolean);

let before = null;

await runMigration({
  version: '251',
  expectedTip: '250',
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
    const attempt = async (label, fn) => {
      const sp = `sp251_${++seq}`;
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
      const lost = before?.[fn] ? codeLines(before[fn]).filter((l) => !kept.has(l)) : ['(fonte 250 não lido)'];
      check(`${fn.split('(')[0]}: toda linha de código implantada continua lá; as MESMAS recusas (nenhuma nova)`,
        Boolean(before?.[fn]) && lost.length === 0 && J(raises(now)) === J(raises(before[fn])), J({ lost }));
    }

    // ── A ordem canônica, conferida no fonte ────────────────────────────────
    const src = async (fn) => code((await one(`SELECT prosrc FROM pg_proc WHERE oid = $1::regprocedure`, [`public.${fn}`])).prosrc);
    const PRE_REQ = /PERFORM 1 FROM public\.project_requirements pr\b[^;]*\bORDER BY pr\.id FOR UPDATE;/;
    {
      const s = await src(CHANGED[0]);
      const o = { po: at(s, /FROM public\.purchase_orders\s+WHERE[^;]*FOR UPDATE;/), req: at(s, PRE_REQ),
        key: at(s, /FOR v_lk IN SELECT DISTINCT ol\.item_id[^;]*ORDER BY ol\.item_id LOOP\s+PERFORM public\.inventory_lock/),
        insert: at(s, /INSERT INTO public\.goods_receipts/), line: at(s, /FROM public\.purchase_order_lines\s+WHERE[^;]*FOR UPDATE;/),
        firstKey: at(s, /PERFORM public\.inventory_lock\(p_organization_id, pl\.item_id, v_loc\.id\)/),
        lateReq: at(s, /FROM public\.project_requirements WHERE id = alloc\.requirement_id FOR UPDATE/) };
      check('recebimento: pedido → requisitos (uuid, todos) → chaves (item) → cabeçalho, linhas, movimentos e a trava de requisito de sempre',
        o.po >= 0 && o.po < o.req && o.req < o.key && o.key < o.insert && o.insert < o.line && o.line < o.firstKey && o.firstKey < o.lateReq, J(o));
    }
    {
      const s = await src(CHANGED[1]);
      const o = { rec: at(s, /FROM public\.goods_receipts WHERE[^;]*FOR UPDATE;/), po: at(s, /FROM public\.purchase_orders WHERE id = v_rec\.purchase_order_id FOR UPDATE;/),
        req: at(s, PRE_REQ), key: at(s, /ORDER BY k\.item_id, k\.location_id LOOP\s+PERFORM public\.inventory_lock/),
        firstKey: at(s, /PERFORM public\.inventory_lock\(p_organization_id, rl\.item_id, v_rec\.location_id\)/),
        lateReq: at(s, /FROM public\.project_requirements WHERE id = portion\.requirement_id FOR UPDATE/),
        release: at(s, /public\.inventory_transfer_request\(/) };
      check('inspeção: recebimento → pedido → requisitos (uuid, todos) → chaves (quarentena e destino, por item) → 1ª passada → 2ª passada → liberação',
        o.rec >= 0 && o.rec < o.po && o.po < o.req && o.req < o.key && o.key < o.firstKey && o.firstKey < o.lateReq && o.lateReq < o.release, J(o));
    }
    {
      const s = await src(CHANGED[2]);
      const o = { tr: at(s, /FROM public\.inventory_transfers WHERE[^;]*FOR UPDATE;/), req: at(s, PRE_REQ),
        key: at(s, /ORDER BY l2\.item_id LOOP\s+PERFORM public\.inventory_lock/),
        line: at(s, /FROM public\.inventory_transfer_lines\s+WHERE[^;]*FOR UPDATE;/),
        firstKey: at(s, /PERFORM public\.inventory_lock\(p_organization_id, l\.item_id, t\.to_location_id\)/),
        lateReq: at(s, /FROM public\.project_requirements WHERE organization_id = p_organization_id AND id = l\.requirement_id FOR UPDATE/) };
      check('recebimento de transferência: transferência → requisitos (uuid, todos) → chaves do destino (item) → linhas → a trava de requisito de sempre',
        o.tr >= 0 && o.tr < o.req && o.req < o.key && o.key < o.line && o.line < o.firstKey && o.firstKey < o.lateReq, J(o));
    }
    // Quem já seguia a ordem: nenhuma trava de chave antes de requisito na reserva; chaves por item no despacho e na contagem.
    {
      const r = await src('inventory_reserve(uuid,uuid,jsonb)');
      const d = await src('inventory_transfer_dispatch(uuid,uuid,uuid,jsonb)');
      const c = await src('inventory_count_post(uuid,uuid,uuid,text)');
      check('já seguiam a ordem: reserva requisito → chave; despacho e contagem com as chaves em ordem de item',
        at(r, /FROM public\.project_requirements\s+WHERE[^;]*FOR UPDATE;/) < at(r, /PERFORM public\.inventory_lock/)
        && /ORDER BY item_id, id LOOP\s+PERFORM public\.inventory_lock/.test(d) && /ORDER BY item_id, id LOOP\s+PERFORM public\.inventory_lock/.test(c));
    }

    // ── Semântica de sempre, em sequência ───────────────────────────────────
    let n = 0;
    const scene = async (label) => {
      const k = `${label}${++n}`;
      const project = await proofProject(ctx, anchors, `P251-${k}-${stamp}`);
      const item = await proofItem(ctx, anchors, `I251-${k}-${stamp}`, 'm');
      const loc = async (prefix, kind, extra = {}) => (await act('inventory_location_upsert', org, actor,
        J({ code: `${prefix}-${k}-${stamp}`, name: `${prefix} ${k}`, kind, ...extra }))).location_id;
      return { k, project, item, site: await loc('S251', 'PROJECT_SITE', { project_id: project }), loc };
    };
    const rc = async (requirementIds) => {
      const out = await act('purchase_requisition_from_shortage', org, actor, J({ requirement_ids: requirementIds }));
      return (await one(`SELECT id FROM public.purchase_requisition_lines WHERE requisition_id = $1`, [out.requisition_id])).id;
    };
    const st = async (req) => {
      const r = await one(`SELECT public.supply_requirement_claimed($1,$2)::text claimed, pr.quantity::text required,
          COALESCE((SELECT sum(quantity - consumed_quantity - released_quantity) FROM public.inventory_reservations
                     WHERE requirement_id = pr.id AND status = 'ACTIVE'), 0)::text reserved
        FROM public.project_requirements pr WHERE pr.id = $2`, [org, req]);
      return { claimed: dec(r.claimed), required: dec(r.required), reserved: dec(r.reserved) };
    };

    // 1) Recebimento no canteiro: parcial (60 de 100) reserva 60; o resto (40) reserva 40; repetição devolve o mesmo
    {
      const s = await scene('RC');
      const r = await confirmedMaterial(ctx, anchors, s.project, s.item, 100);
      const o = await purchaseOrderFromLines(ctx, anchors, { tag: `251${s.k}${stamp}`, lineIds: [await rc([r])], deliveryLocationId: s.site });
      const pol = (await one(`SELECT id FROM public.purchase_order_lines WHERE purchase_order_id = $1`, [o.poId])).id;
      const k1 = `rc251-${s.k}-${stamp}-1`;
      const a = await attempt('(recebimento) 60 no canteiro', () => act('goods_receipt_post', org, actor,
        J({ purchase_order_id: o.poId, location_id: s.site, idempotency_key: k1, lines: [{ po_line_id: pol, accepted_quantity: 60 }] })));
      check('(recebimento) 60 recebidos e 60 reservados; pedido PARCIALMENTE RECEBIDO', a?.order_status === 'PARTIALLY_RECEIVED' && dec(a?.reserved) === '60', J(a));
      const again = await act('goods_receipt_post', org, actor,
        J({ purchase_order_id: o.poId, location_id: s.site, idempotency_key: k1, lines: [{ po_line_id: pol, accepted_quantity: 60 }] }));
      check('(recebimento) a repetição devolve o mesmo recebimento, sem duplicar', again.replayed === true && again.receipt_id === a?.receipt_id);
      const b = await attempt('(recebimento) os 40 que faltam', () => act('goods_receipt_post', org, actor,
        J({ purchase_order_id: o.poId, location_id: s.site, idempotency_key: `${k1}-2`, lines: [{ po_line_id: pol, accepted_quantity: 40 }] })));
      const x = await st(r);
      check('(recebimento) pedido RECEBIDO; 100 reservados; reclamado = requerido', b?.order_status === 'RECEIVED' && x.reserved === '100'
        && x.claimed === '100', J({ b, x }));
    }

    // 2) Quarentena + inspeção: 100 recebidos em quarentena, 30 rejeitados, 70 liberados ao canteiro e reservados
    {
      const s = await scene('IN');
      const quarantine = await s.loc('Q251', 'QUARANTINE');
      const r = await confirmedMaterial(ctx, anchors, s.project, s.item, 100);
      const o = await purchaseOrderFromLines(ctx, anchors, { tag: `251${s.k}${stamp}`, lineIds: [await rc([r])], deliveryLocationId: quarantine });
      const pol = (await one(`SELECT id FROM public.purchase_order_lines WHERE purchase_order_id = $1`, [o.poId])).id;
      const rec = await act('goods_receipt_post', org, actor,
        J({ purchase_order_id: o.poId, location_id: quarantine, idempotency_key: `in251-${s.k}-${stamp}`, lines: [{ po_line_id: pol, accepted_quantity: 100 }] }));
      const line = (await one(`SELECT id FROM public.goods_receipt_lines WHERE receipt_id = $1`, [rec.receipt_id])).id;
      const i = await attempt('(inspeção) aprova 70, rejeita 30, libera ao canteiro', () => act('goods_receipt_inspect', org, actor, rec.receipt_id,
        J({ destination_location_id: s.site, reason: 'Isolamento danificado', lines: [{ line_id: line, approved_quantity: 70, rejected_quantity: 30 }] })));
      const x = await st(r);
      const po = await one(`SELECT status, (SELECT received_quantity::text FROM public.purchase_order_lines WHERE id = $2) rq FROM public.purchase_orders WHERE id = $1`, [o.poId, pol]);
      check('(inspeção) PARCIALMENTE REJEITADO; 70 reservados no canteiro; o pedido volta a esperar 30; reclamado = requerido',
        i?.inspection_status === 'PARTIALLY_REJECTED' && x.reserved === '70' && dec(po.rq) === '70' && po.status === 'PARTIALLY_RECEIVED'
        && x.claimed === '100', J({ i, x, po }));
    }

    // 3) Recebimento de transferência: 50 despachados do almoxarifado, 50 recebidos no canteiro e reservados
    {
      const s = await scene('TR');
      const depot = await s.loc('D251', 'WAREHOUSE');
      await act('inventory_adjust', org, actor, J({ item_id: s.item, location_id: depot, quantity: 50, reason: 'Prova 251' }));
      const r = await confirmedMaterial(ctx, anchors, s.project, s.item, 50);
      const tr = await act('inventory_transfer_request', org, actor, J({ from_location_id: depot, to_location_id: s.site,
        lines: [{ item_id: s.item, quantity: 50, requirement_id: r }] }));
      await act('inventory_transfer_approve', org, actor, tr.transfer_id);
      await act('inventory_transfer_dispatch', org, actor, tr.transfer_id, J({}));
      const line = (await one(`SELECT id FROM public.inventory_transfer_lines WHERE transfer_id = $1`, [tr.transfer_id])).id;
      const key = `tr251-${s.k}-${stamp}`;
      const got = await attempt('(transferência) recebe os 50', () => act('inventory_transfer_receive', org, actor, tr.transfer_id,
        J({ idempotency_key: key, lines: [{ line_id: line, quantity: 50 }] })));
      const again = await act('inventory_transfer_receive', org, actor, tr.transfer_id, J({ idempotency_key: key, lines: [{ line_id: line, quantity: 50 }] }));
      const x = await st(r);
      check('(transferência) RECEBIDA; 50 reservados no destino; a repetição não duplica; reclamado = requerido',
        got?.status === 'RECEIVED' && dec(got?.reserved_at_destination) === '50' && again.replayed === true && x.reserved === '50'
        && x.claimed === '50', J({ got, again, x }));
    }

    // 4) Recebimento de dois requisitos numa linha (a ordem de atendimento é a da necessidade, como sempre)
    {
      const s = await scene('DU');
      const early = await confirmedMaterial(ctx, anchors, s.project, s.item, 40, '2026-11-01');
      const late = await confirmedMaterial(ctx, anchors, s.project, s.item, 60, '2026-11-30');
      const o = await purchaseOrderFromLines(ctx, anchors, { tag: `251${s.k}${stamp}`, lineIds: [await rc([early, late])], deliveryLocationId: s.site });
      const pol = (await one(`SELECT id FROM public.purchase_order_lines WHERE purchase_order_id = $1`, [o.poId])).id;
      await act('goods_receipt_post', org, actor, J({ purchase_order_id: o.poId, location_id: s.site, idempotency_key: `du251-${s.k}-${stamp}`,
        lines: [{ po_line_id: pol, accepted_quantity: 50 }] }));
      const [e, l] = [await st(early), await st(late)];
      check('(dois requisitos) 50 recebidos atendem primeiro a necessidade mais cedo: 40 e 10 reservados',
        e.reserved === '40' && l.reserved === '10' && e.claimed === '40' && l.claimed === '60', J({ e, l }));
    }
  },
});
