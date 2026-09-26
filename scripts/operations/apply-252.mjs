/**
 * 252 — Requisito com cobertura: editar sem deixar a cobertura inconsistente.
 *
 *   node scripts/operations/apply-252.mjs --target=qa [--apply]
 *   node scripts/operations/apply-252.mjs [--apply]
 *
 * Regra: docs/operations-supply/COVERAGE-SEMANTICS.md (seção 252). Aqui, sempre desfeito: a governança (as
 * reescritas e as duas funções novas só do servidor), o corpo implantado mantido (toda linha e toda recusa, mais as
 * novas), a trava de sempre (só o requisito), o retrato da cobertura igual ao reclamado da 246, e os casos:
 * aumento com cobertura, redução acima e abaixo do comprometido, item trocado com e sem cobertura, cancelar /
 * substituir / planejar com reserva, transferência, requisição e pedido — e depois da reconciliação —, o consumido
 * que não impede o cancelamento, e a data que muda sem tocar em quantidade nem em compra (com o fato próprio).
 * As corridas edição ∥ reserva / compra / recebimento com COMMIT real ficam no qa-live (concurrency.spec.ts).
 */
import { runMigration } from './lib/proof-kit.mjs';
import { confirmedMaterial, proofItem, proofProject, purchaseOrderFromLines } from './lib/fixtures.mjs';

const CHANGED = ['project_requirement_upsert(uuid,uuid,jsonb)', 'project_requirement_transition(uuid,uuid,uuid,text,text,uuid)'];
const NEW = ['supply_quantity_text(numeric)', 'project_requirement_coverage_footprint(uuid,uuid)'];
const dec = (x) => (x == null ? null : String(x).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''));
const code = (source) => source.replace(/--[^\n]*/g, '');
const raises = (source) => [...code(source).matchAll(/RAISE EXCEPTION '((?:[^']|'')*)'[^;]*?ERRCODE = '(\w+)'/g)]
  .map((m) => `${m[2]} ${m[1]}`).sort();
const codeLines = (source) => code(source).split('\n').map((l) => l.trim()).filter(Boolean);
const LOCK = /\bFOR (?:UPDATE|NO KEY UPDATE|SHARE|KEY SHARE)\b/g;
const NEW_RAISES = {
  [CHANGED[0]]: [
    '23514 Requirement has coverage of its current item (% committed: %): the item changes only after that coverage is released or cancelled.',
    '23514 Requirement quantity % is below its committed coverage % (%): release or cancel coverage first.'],
  [CHANGED[1]]: ['23514 Requirement has active coverage % (%): release or cancel it before moving the requirement to %.'],
};

let before = null;

await runMigration({
  version: '252',
  expectedTip: '251',
  async preflight(db) {
    before = {};
    for (const fn of CHANGED) {
      before[fn] = (await db.query(`SELECT prosrc FROM pg_proc WHERE oid = $1::regprocedure`, [`public.${fn}`])).rows[0]?.prosrc ?? null;
    }
  },
  async proofs(ctx) {
    const { db, one, check, browserCannotExecute, anchors } = ctx;
    const { org, actor } = anchors;
    const stamp = Date.now().toString(36).toUpperCase();
    const J = (x) => JSON.stringify(x);
    const act = async (fn, ...args) => (await one(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) r`, args)).r;
    let seq = 0;
    const refuse = async (label, sql, params, sqlstate, pattern) => {
      const sp = `sp252_${++seq}`;
      await db.query(`SAVEPOINT ${sp}`);
      try {
        await db.query(sql, params);
        await db.query(`RELEASE SAVEPOINT ${sp}`);
        return check(label, false, 'foi aceito, deveria ter sido recusado');
      } catch (error) {
        await db.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        await db.query(`RELEASE SAVEPOINT ${sp}`);
        return check(label, error.code === sqlstate && pattern.test(error.message), `${error.code}: ${error.message.slice(0, 220)}`);
      }
    };
    const attempt = async (label, fn) => {
      const sp = `sp252_${++seq}`;
      await db.query(`SAVEPOINT ${sp}`);
      try {
        const out = await fn();
        await db.query(`RELEASE SAVEPOINT ${sp}`);
        return out;
      } catch (error) {
        await db.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        await db.query(`RELEASE SAVEPOINT ${sp}`);
        check(label, false, `${error.code ?? ''}: ${error.message.slice(0, 220)}`);
        return null;
      }
    };

    // ── Governança e fonte ──────────────────────────────────────────────────
    await browserCannotExecute([...CHANGED, ...NEW]);
    for (const fn of [...CHANGED, ...NEW]) {
      const g = await one(`SELECT (SELECT array_agg(x ORDER BY x) FROM (SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END x
             FROM aclexplode(p.proacl) a WHERE a.privilege_type = 'EXECUTE') e) grantees, p.proowner::regrole::text owner,
           p.proconfig cfg FROM pg_proc p WHERE p.oid = $1::regprocedure`, [`public.${fn}`]);
      check(`${fn.split('(')[0]}: EXECUTE só do service_role; search_path fixo`,
        J((g.grantees ?? []).filter((x) => x !== g.owner)) === J(['service_role']) && (g.cfg ?? []).some((c) => c.startsWith('search_path=')), J(g));
    }
    for (const fn of CHANGED) {
      const now = (await one(`SELECT prosrc FROM pg_proc WHERE oid = $1::regprocedure`, [`public.${fn}`])).prosrc;
      const kept = new Set(codeLines(now));
      const lost = before?.[fn] ? codeLines(before[fn]).filter((l) => !kept.has(l)) : ['(fonte implantado não lido)'];
      check(`${fn.split('(')[0]}: toda linha implantada continua; recusas = as de antes + as novas; a mesma trava (só o requisito)`,
        Boolean(before?.[fn]) && lost.length === 0 && J(raises(now)) === J([...raises(before[fn]), ...NEW_RAISES[fn]].sort())
        && (code(now).match(LOCK) ?? []).length === (code(before[fn]).match(LOCK) ?? []).length, J({ lost, raises: raises(now) }));
    }

    // ── Cenários ────────────────────────────────────────────────────────────
    let n = 0;
    const scene = async (label, items = 1) => {
      const k = `${label}${++n}`;
      const project = await proofProject(ctx, anchors, `P252-${k}-${stamp}`);
      const list = [];
      for (let i = 0; i < items; i += 1) list.push(await proofItem(ctx, anchors, `I252-${k}${'XY'[i]}-${stamp}`, 'm'));
      const loc = async (prefix, kind, extra = {}) => (await act('inventory_location_upsert', org, actor,
        J({ code: `${prefix}-${k}-${stamp}`, name: `${prefix} ${k}`, kind, ...extra }))).location_id;
      const site = await loc('S252', 'PROJECT_SITE', { project_id: project });
      return { k, project, item: list[0], items: list, site, loc };
    };
    const stock = (item, loc, q) => act('inventory_adjust', org, actor, J({ item_id: item, location_id: loc, quantity: q, reason: 'Prova 252' }));
    const reserve = (req, loc, q) => act('inventory_reserve', org, actor, J({ requirement_id: req, location_id: loc, quantity: q }));
    const rcLine = async (req) => {
      const out = await act('purchase_requisition_from_shortage', org, actor, J({ requirement_ids: [req] }));
      return { rc: out.requisition_id, line: (await one(`SELECT id FROM public.purchase_requisition_lines WHERE requisition_id = $1`, [out.requisition_id])).id };
    };
    const edit = (req, patch) => act('project_requirement_upsert', org, actor, J({ id: req, ...patch }));
    const editSql = 'SELECT public.project_requirement_upsert($1,$2,$3) r';
    const moveSql = 'SELECT public.project_requirement_transition($1,$2,$3,$4,$5,$6) r';
    const fp = async (req) => act('project_requirement_coverage_footprint', org, req);
    const view = async (req) => {
      const v = await one(`SELECT required_qty::text q, shortage_qty::text s, purchasable_qty::text p, requested_qty::text r
        FROM public.supply_requirement_coverage WHERE requirement_id = $1`, [req]);
      return v ? Object.fromEntries(Object.entries(v).map(([a, b]) => [a, dec(b)])) : null;
    };

    // O retrato é o reclamado da 246, parcela por parcela
    {
      const s = await scene('FP');
      await stock(s.item, s.site, 30);
      const r = await confirmedMaterial(ctx, anchors, s.project, s.item, 100);
      await reserve(r, s.site, 30);
      await rcLine(r);
      const f = await fp(r);
      const claimed = dec((await one(`SELECT public.supply_requirement_claimed($1,$2)::text c`, [org, r])).c);
      check('retrato: reservado 30 + requisitado 70 = reclamado 100; ativo 100; texto das parcelas',
        dec(f.reserved) === '30' && dec(f.requested) === '70' && dec(f.claimed) === claimed && claimed === '100' && dec(f.active) === '100'
        && f.detail === 'reserved 30, requested 70', J(f));
    }

    // 1) Aumento com cobertura: a cobertura fica, só a diferença vira falta
    {
      const s = await scene('UP');
      await stock(s.item, s.site, 30);
      const r = await confirmedMaterial(ctx, anchors, s.project, s.item, 100);
      await reserve(r, s.site, 30);
      await rcLine(r);
      await attempt('(aumento) 100 → 150 com 100 comprometidos', () => edit(r, { quantity: 150 }));
      const v = await view(r);
      check('(aumento) requerido 150, falta 120 (sem a reserva), requisitado 70, comprável 50 — a cobertura não se mexeu',
        J(v) === J({ q: '150', s: '120', p: '50', r: '70' }) && dec((await fp(r)).claimed) === '100', J(v));
    }

    // 2) Redução: acima do comprometido passa; abaixo é recusada com as parcelas
    {
      const s = await scene('DN');
      await stock(s.item, s.site, 30);
      const r = await confirmedMaterial(ctx, anchors, s.project, s.item, 100);
      await reserve(r, s.site, 30);
      await attempt('(redução acima) 100 → 50 com 30 reservados', () => edit(r, { quantity: 50 }));
      check('(redução acima) requerido 50, falta 20', J(await view(r)) === J({ q: '50', s: '20', p: '20', r: '0' }), J(await view(r)));
      await rcLine(r);
      await refuse('(redução abaixo) 50 → 40 com 30 reservados + 20 requisitados: recusada, com as parcelas', editSql,
        [org, actor, J({ id: r, quantity: 40 })], '23514',
        /^Requirement quantity 40 is below its committed coverage 50 \(reserved 30, requested 20\): release or cancel coverage first\.$/);
      await attempt('(redução no limite) 50 → 50 exatos (nada muda) e o limite exato passa', () => edit(r, { quantity: 50 }));
      check('(redução abaixo) o requisito segue em 50', dec((await one(`SELECT quantity::text q FROM public.project_requirements WHERE id = $1`, [r])).q) === '50');
    }

    // Redução abaixo de pedido emitido (o caso do legado j1: 100 → 80 com pedido de 100)
    {
      const s = await scene('PO');
      const r = await confirmedMaterial(ctx, anchors, s.project, s.item, 100);
      const { line } = await rcLine(r);
      await purchaseOrderFromLines(ctx, anchors, { tag: `252${s.k}${stamp}`, lineIds: [line], deliveryLocationId: s.site });
      await refuse('(pedido emitido) 100 → 80 com 100 em pedido: recusada', editSql, [org, actor, J({ id: r, quantity: 80 })], '23514',
        /^Requirement quantity 80 is below its committed coverage 100 \(on order 100\)/);
    }

    // 3) Item: não muda com cobertura; muda sem cobertura
    {
      const s = await scene('IT', 2);
      const [ix, iy] = s.items;
      const r = await confirmedMaterial(ctx, anchors, s.project, ix, 100);
      await rcLine(r);
      await refuse('(item) trocar X por Y com 100 requisitados de X: recusada', editSql, [org, actor, J({ id: r, item_id: iy })], '23514',
        /^Requirement has coverage of its current item \(100 committed: requested 100\): the item changes only after that coverage is released or cancelled\.$/);
      const free = await confirmedMaterial(ctx, anchors, s.project, ix, 10);
      await attempt('(item) sem cobertura, o item muda', () => edit(free, { item_id: iy }));
      check('(item) o requisito sem cobertura agora é de Y', (await one(`SELECT item_id FROM public.project_requirements WHERE id = $1`, [free])).item_id === iy);
    }

    // 4) Cancelar / substituir / planejar: recusado com cobertura ativa; passa depois da reconciliação
    {
      const s = await scene('CX');
      const depot = await s.loc('D252', 'WAREHOUSE');
      await stock(s.item, s.site, 30); await stock(s.item, depot, 20);
      const r = await confirmedMaterial(ctx, anchors, s.project, s.item, 100);
      const res = await reserve(r, s.site, 30);
      const tr = await act('inventory_transfer_request', org, actor, J({ from_location_id: depot, to_location_id: s.site,
        lines: [{ item_id: s.item, quantity: 20, requirement_id: r }] }));
      const { rc } = await rcLine(r);
      const replacement = await confirmedMaterial(ctx, anchors, s.project, s.item, 1);
      await refuse('(cancelar) com reserva 30, transferência 20 e requisição 50: recusado com as parcelas', moveSql,
        [org, actor, r, 'CANCELLED', 'Escopo removido', null], '23514',
        /^Requirement has active coverage 100 \(reserved 30, pending transfers 20, requested 50\): release or cancel it before moving the requirement to CANCELLED\.$/);
      await refuse('(planejar) devolver ao planejamento com cobertura ativa: recusado', moveSql, [org, actor, r, 'PLANNED', null, null], '23514',
        /before moving the requirement to PLANNED\.$/);
      await refuse('(substituir) com cobertura ativa: recusado', moveSql, [org, actor, r, 'SUPERSEDED', null, replacement], '23514',
        /before moving the requirement to SUPERSEDED\.$/);
      await act('inventory_release', org, actor, res.reservation_id, 30, 'Reconciliação da prova 252');
      await act('inventory_transfer_cancel', org, actor, tr.transfer_id, 'Reconciliação da prova 252');
      await act('purchase_requisition_cancel', org, actor, rc, 'Reconciliação da prova 252');
      const done = await attempt('(cancelar) reconciliado (reserva liberada, transferência e requisição canceladas): passa',
        () => act('project_requirement_transition', org, actor, r, 'CANCELLED', 'Escopo removido', null));
      check('(cancelar) CANCELADO depois da reconciliação', done?.status === 'CANCELLED', J(done));
    }

    // Cancelar com pedido emitido: recusado (o pedido se cancela ou encerra antes)
    {
      const s = await scene('CP');
      const r = await confirmedMaterial(ctx, anchors, s.project, s.item, 100);
      const { line } = await rcLine(r);
      const po = await purchaseOrderFromLines(ctx, anchors, { tag: `252${s.k}${stamp}`, lineIds: [line], quantities: { [line]: 60 }, deliveryLocationId: s.site });
      await refuse('(cancelar) com pedido de 60 emitido: recusado', moveSql, [org, actor, r, 'CANCELLED', 'Escopo removido', null], '23514',
        /^Requirement has active coverage 60 \(on order 60\)/);
      await act('purchase_order_cancel', org, actor, po.poId, 'Reconciliação da prova 252');
      const after = await fp(r);
      check('(cancelar) cancelado o pedido, a RC reabre os 60 (248): ainda há cobertura ativa — requisitada',
        dec(after.requested) === '60' && dec(after.active) === '60', J(after));
    }

    // O consumido é história: não impede cancelar
    {
      const s = await scene('CO');
      await stock(s.item, s.site, 30);
      const r = await confirmedMaterial(ctx, anchors, s.project, s.item, 100);
      const res = await reserve(r, s.site, 30);
      await act('inventory_issue_to_project', org, actor, J({ reservation_id: res.reservation_id, quantity: 30 }));
      const f = await fp(r);
      check('(consumido) 30 consumidos: reclamado 30, ativo 0', dec(f.consumed) === '30' && dec(f.claimed) === '30' && dec(f.active) === '0', J(f));
      await refuse('(consumido) reduzir abaixo do consumido (30 → 20): recusado', editSql, [org, actor, J({ id: r, quantity: 20 })], '23514',
        /^Requirement quantity 20 is below its committed coverage 30 \(consumed 30\)/);
      const done = await attempt('(consumido) cancelar com só o consumido: passa',
        () => act('project_requirement_transition', org, actor, r, 'CANCELLED', 'Obra encerrada antes', null));
      check('(consumido) CANCELADO', done?.status === 'CANCELLED');
    }

    // 5) Data: muda sem tocar em quantidade nem em compra; fato próprio; a cotação nova usa a data nova
    {
      const s = await scene('DT');
      const r = await confirmedMaterial(ctx, anchors, s.project, s.item, 100, '2026-11-18');
      const { line } = await rcLine(r);
      const before1 = await fp(r);
      const lineBefore = await one(`SELECT quantity::text q FROM public.purchase_requisition_lines WHERE id = $1`, [line]);
      await attempt('(data) 18/11 → 05/11 com 100 requisitados', () => edit(r, { required_by: '2026-11-05' }));
      const after = await fp(r);
      const ev = await one(`SELECT payload->>'required_by_before' b, payload->>'required_by' a FROM public.domain_events
        WHERE aggregate_id = $1 AND event_type = 'operations.requirement.rescheduled'`, [r]);
      check('(data) cobertura e linha de requisição intactas; fato rescheduled com a data de antes e a de agora',
        J(after) === J(before1) && dec((await one(`SELECT quantity::text q FROM public.purchase_requisition_lines WHERE id = $1`, [line])).q) === dec(lineBefore.q)
        && ev?.b === '2026-11-18' && ev?.a === '2026-11-05', J({ ev }));
      const q = await purchaseOrderFromLines(ctx, anchors, { tag: `252${s.k}${stamp}`, lineIds: [line], deliveryLocationId: s.site, until: 'QUOTED' });
      const rfqLine = await one(`SELECT required_by::text d FROM public.procurement_rfq_lines WHERE rfq_id = $1`, [q.rfqId]);
      check('(data) a cotação nova pede a data nova', rfqLine.d === '2026-11-05', J(rfqLine));
      await attempt('(data) editar outro campo não emite o fato', () => edit(r, { priority: 'high' }));
      check('(data) um fato só', (await one(`SELECT count(*)::int n FROM public.domain_events WHERE aggregate_id = $1
        AND event_type = 'operations.requirement.rescheduled'`, [r])).n === 1);
    }
  },
});
