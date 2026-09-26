/**
 * 253 — Número de documento do Supply sem colisão (RC, COT, OC, EMB, REC, TR).
 *
 *   node scripts/operations/apply-253.mjs --target=qa [--apply]
 *   node scripts/operations/apply-253.mjs [--apply]
 *
 * Sempre desfeito: a governança da guarda (só do servidor, sem SECURITY DEFINER, search_path fixo), os seis
 * gatilhos BEFORE INSERT e os casos:
 *   - número JÁ GRAVADO no inquilino (clone de um documento de cada tabela com o mesmo número) → trocado, no
 *     formato de sempre, e o original intacto; número livre → mantido (nenhum sorteio à toa);
 *   - o mesmo número duas vezes na mesma transação → o segundo trocado;
 *   - número EM VOO noutra sessão (a chave da guarda presa por outra conexão) → trocado SEM esperar;
 *   - número de OUTRO inquilino → mantido (a unicidade é por inquilino);
 *   - pelo CAMINHO GOVERNADO, com o primeiro sorteio forçado para um número existente: requisição manual e da
 *     falta (RC), cotação (COT), decisão → pedido (OC), embarque (EMB) e recebimento (REC) — todos criam, e o
 *     número devolvido é o gravado;
 *   - sabotagem: sem a guarda, o mesmo sorteio forçado derruba a requisição em `preqn_number_unique`;
 *   - sorteio que só devolve número usado → para em 50 tentativas com erro claro (sem laço infinito).
 * A corrida com COMMIT real (duas sessões, o mesmo número em voo) fica no qa-live (concurrency.spec.ts).
 */
import { runMigration, targetDatabase } from './lib/proof-kit.mjs';
import { confirmedMaterial, homologatedSupplier, proofItem, proofProject, purchaseOrderFromLines } from './lib/fixtures.mjs';

const TABLES = [
  { table: 'purchase_requisitions', trigger: 'preqn_number_guard', col: 'requisition_number', prefix: 'RC', blank: { idempotency_key: null } },
  { table: 'procurement_rfqs', trigger: 'rfq_number_guard', col: 'rfq_number', prefix: 'COT', blank: {} },
  { table: 'purchase_orders', trigger: 'po_number_guard', col: 'order_number', prefix: 'OC', blank: { sourcing_decision_id: null } },
  { table: 'inbound_shipments', trigger: 'ship_number_guard', col: 'shipment_number', prefix: 'EMB', blank: {} },
  { table: 'goods_receipts', trigger: 'grc_number_guard', col: 'receipt_number', prefix: 'REC', blank: { idempotency_key: null } },
  { table: 'inventory_transfers', trigger: 'invtr_number_guard', col: 'transfer_number', prefix: 'TR', blank: { idempotency_key: null } },
];
const RANDOM_BODY = `p_prefix || '-' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 5))`;

await runMigration({
  version: '253',
  expectedTip: '252',
  async proofs(ctx) {
    const { db, one, all, check, browserCannotExecute, anchors } = ctx;
    const { org, actor } = anchors;
    const stamp = Date.now().toString(36).toUpperCase();
    const J = (x) => JSON.stringify(x);
    const act = async (fn, ...args) => (await one(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) r`, args)).r;
    const today = (await one(`SELECT to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYMMDD') d`)).d;
    const shape = (prefix, n) => new RegExp(`^${prefix}-${today}-[0-9A-F]{5}$`).test(String(n));
    let seq = 0;
    /** Roda `fn` num SAVEPOINT que é sempre desfeito; devolve { ok, v } ou { ok: false, e, code }. */
    const isolated = async (fn) => {
      const sp = `sp253_${++seq}`;
      await db.query(`SAVEPOINT ${sp}`);
      try { return { ok: true, v: await fn() }; }
      catch (e) { return { ok: false, e: e.message, code: e.code }; }
      finally { await db.query(`ROLLBACK TO SAVEPOINT ${sp}`); await db.query(`RELEASE SAVEPOINT ${sp}`); }
    };
    const clone = (t, sourceId, number) => one(`INSERT INTO public.${t.table}
        SELECT (jsonb_populate_record(NULL::public.${t.table}, to_jsonb(x) || jsonb_build_object('id', gen_random_uuid(), '${t.col}', $2::text) || $3::jsonb)).*
          FROM public.${t.table} x WHERE x.id = $1
        RETURNING id, ${t.col} AS num`, [sourceId, number, J(t.blank)]);
    /** O próximo sorteio de procurement_number devolve `first` (e depois volta ao aleatório) — só dentro do SAVEPOINT. */
    const forceFirstDraw = async (first, always = false) => {
      await db.query('CREATE TEMP TABLE IF NOT EXISTS pn253 (n int)');
      await db.query('DELETE FROM pg_temp.pn253');
      await db.query('INSERT INTO pg_temp.pn253 VALUES (0)');
      await db.query(`CREATE OR REPLACE FUNCTION public.procurement_number(p_prefix text) RETURNS text LANGUAGE plpgsql VOLATILE
        SET search_path = public, pg_temp AS $f$
        DECLARE c int;
        BEGIN
          UPDATE pg_temp.pn253 SET n = n + 1 RETURNING n INTO c;
          IF c = 1 OR ${always ? 'true' : 'false'} THEN RETURN ${`'${String(first).replace(/'/g, "''")}'`}; END IF;
          RETURN ${RANDOM_BODY};
        END $f$`);
    };

    // 1) Governança
    const g = await one(`SELECT prosecdef d, proconfig c FROM pg_proc WHERE oid = 'public.supply_document_number_guard()'::regprocedure`);
    check('guarda sem SECURITY DEFINER e com search_path fixo', g && !g.d && String(g.c).includes('search_path=public, pg_temp'), J(g));
    await browserCannotExecute(['supply_document_number_guard()']);
    for (const t of TABLES) {
      const d = await one(`SELECT pg_get_triggerdef(oid) def FROM pg_trigger WHERE tgrelid = $1::regclass AND tgname = $2`, [`public.${t.table}`, t.trigger]);
      check(`${t.trigger}: BEFORE INSERT por linha em ${t.table}, na coluna ${t.col}`,
        d && d.def.includes('BEFORE INSERT') && d.def.includes('FOR EACH ROW') && d.def.includes(`supply_document_number_guard('${t.col}')`), d?.def);
    }

    // Cenário do caminho governado (e um embarque real, para haver EMB a clonar)
    const project = await proofProject(ctx, anchors, `P253-${stamp}`);
    const item = await proofItem(ctx, anchors, `I253-${stamp}`, 'm');
    const site = (await act('inventory_location_upsert', org, actor, J({ code: `S253-${stamp}`, name: 'Canteiro 253', kind: 'PROJECT_SITE', project_id: project }))).location_id;
    const req2 = await confirmedMaterial(ctx, anchors, project, item, 25);
    const rq2 = await act('purchase_requisition_from_shortage', org, actor, J({ requirement_ids: [req2] }));
    const lines2 = (await all(`SELECT id FROM public.purchase_requisition_lines WHERE requisition_id = $1`, [rq2.requisition_id])).map((l) => l.id);
    const po = await purchaseOrderFromLines(ctx, anchors, { tag: `253P${stamp}`, lineIds: lines2, deliveryLocationId: site });
    await act('inbound_shipment_record', org, actor, J({ purchase_order_id: po.poId, destination_location_id: site, status: 'EXPECTED', carrier: 'Prova 253' }));

    // 2) Clone com número JÁ GRAVADO → trocado; número livre → mantido
    for (const t of TABLES) {
      const src = await one(`SELECT id, ${t.col} AS num FROM public.${t.table} WHERE organization_id = $1 ORDER BY id LIMIT 1`, [org]);
      if (!src) { check(`${t.table}: há documento para clonar no inquilino de prova`, false); continue; }
      const r = await isolated(async () => {
        const c = await clone(t, src.id, src.num);
        const orig = await one(`SELECT count(*)::int n FROM public.${t.table} WHERE organization_id = $1 AND ${t.col} = $2`, [org, src.num]);
        return { c, orig: orig.n };
      });
      check(`${t.prefix}: número já gravado (${src.num}) → gravado com outro no formato ${t.prefix}-${today}-XXXXX; o original intacto`,
        r.ok && r.v.c.num !== src.num && shape(t.prefix, r.v.c.num) && r.v.orig === 1, J(r));
      const free = `${t.prefix}-P253-${stamp}`;
      const f = await isolated(() => clone(t, src.id, free));
      check(`${t.prefix}: número livre → mantido (nenhum sorteio à toa)`, f.ok && f.v.num === free, J(f));
    }

    // 3) O mesmo número duas vezes na mesma transação → o segundo trocado
    {
      const t = TABLES[0];
      const src = await one(`SELECT id FROM public.purchase_requisitions WHERE organization_id = $1 ORDER BY id LIMIT 1`, [org]);
      const n = `RC-TWICE-${stamp}`;
      const r = await isolated(async () => [await clone(t, src.id, n), await clone(t, src.id, n)]);
      check('RC: o mesmo número duas vezes na transação → o primeiro fica, o segundo é trocado', r.ok && r.v[0].num === n && r.v[1].num !== n
        && shape('RC', r.v[1].num), J(r));
    }

    // 4) Número EM VOO noutra sessão → trocado sem esperar
    {
      const t = TABLES[0];
      const src = await one(`SELECT id FROM public.purchase_requisitions WHERE organization_id = $1 ORDER BY id LIMIT 1`, [org]);
      const n = `RC-${today}-F${stamp.slice(-4)}`;
      const other = targetDatabase().client();
      await other.connect();
      try {
        await other.query(`SELECT pg_advisory_lock(hashtextextended(format('supply-number:%s:%s:%s', 'purchase_requisitions', $1::uuid, $2::text), 0))`, [org, n]);
        const t0 = Date.now();
        const r = await isolated(() => clone(t, src.id, n));
        const ms = Date.now() - t0;
        check('RC: número em voo noutra sessão → trocado, sem esperar a outra transação', r.ok && r.v.num !== n && shape('RC', r.v.num) && ms < 2000,
          J({ ...r, ms }));
      } finally {
        await other.query('SELECT pg_advisory_unlock_all()').catch(() => undefined);
        await other.end();
      }
    }

    // 5) Número de OUTRO inquilino → mantido
    {
      const B = await one(`SELECT ur.organization_id org, ur.user_id actor FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
          AND r.key = 'owner_admin' WHERE ur.organization_id <> $1 LIMIT 1`, [org]);
      let b = null;
      if (B) {
        const itemB = await proofItem(ctx, B, `I253B-${stamp}`, 'm');
        const rb = (await one('SELECT public.purchase_requisition_create_manual($1,$2,$3) r', [B.org, B.actor,
          J({ justification: 'Prova 253 (outro inquilino)', lines: [{ item_id: itemB, quantity: 1 }] })])).r;
        b = { n: rb.requisition_number };
      }
      if (b) {
        const src = await one(`SELECT id FROM public.purchase_requisitions WHERE organization_id = $1 ORDER BY id LIMIT 1`, [org]);
        const r = await isolated(() => clone(TABLES[0], src.id, b.n));
        check('RC: número que só existe noutro inquilino → mantido (a unicidade é por inquilino)', r.ok && r.v.num === b.n, J(r));
      } else check('RC: há outro inquilino para comparar', false, 'sem outro inquilino com owner_admin');
    }

    // 6) Pelo CAMINHO GOVERNADO, primeiro sorteio forçado para um número existente
    const existing = async (t) => (await one(`SELECT ${t.col} AS n FROM public.${t.table} WHERE organization_id = $1 ORDER BY id LIMIT 1`, [org])).n;
    const stored = async (t, id) => (await one(`SELECT ${t.col} AS n FROM public.${t.table} WHERE id = $1`, [id])).n;
    const forced = async (label, t, call, idOf, numOf) => {
      const taken = await existing(t);
      const r = await isolated(async () => { await forceFirstDraw(taken); const out = await call(); return { out, stored: await stored(t, idOf(out)) }; });
      check(`${label}: o primeiro sorteio (${taken}) já existe → o documento nasce com outro, e a resposta traz o número gravado`,
        r.ok && r.v.stored !== taken && shape(t.prefix, r.v.stored) && numOf(r.v.out) === r.v.stored, J(r).slice(0, 300));
    };
    await forced('requisição manual (RC)', TABLES[0],
      () => act('purchase_requisition_create_manual', org, actor, J({ justification: 'Prova 253', lines: [{ item_id: item, quantity: 3 }] })),
      (o) => o.requisition_id, (o) => o.requisition_number);
    const req = await confirmedMaterial(ctx, anchors, project, item, 40);
    await forced('requisição da falta (RC)', TABLES[0],
      () => act('purchase_requisition_from_shortage', org, actor, J({ requirement_ids: [req] })),
      (o) => o.requisition_id, (o) => o.requisition_number);
    const rq = await act('purchase_requisition_from_shortage', org, actor, J({ requirement_ids: [req] }));
    const lines = (await all(`SELECT id FROM public.purchase_requisition_lines WHERE requisition_id = $1`, [rq.requisition_id])).map((l) => l.id);
    const supplier = await homologatedSupplier(ctx, anchors, `F253${stamp}`);
    await forced('cotação (COT)', TABLES[1],
      () => act('procurement_rfq_create', org, actor, J({ requisition_line_ids: lines, supplier_ids: [supplier] })),
      (o) => o.rfq_id, (o) => o.rfq_number);
    const q = await purchaseOrderFromLines(ctx, anchors, { tag: `253Q${stamp}`, lineIds: lines, supplierId: supplier, deliveryLocationId: site, until: 'QUOTED' });
    await forced('decisão → pedido (OC)', TABLES[2],
      () => act('procurement_decide', org, actor, J({ rfq_id: q.rfqId, quote_id: q.quoteId, rationale: 'Prova 253: única proposta.' })),
      (o) => o.purchase_order_id, (o) => o.order_number);
    await forced('embarque (EMB)', TABLES[3],
      () => act('inbound_shipment_record', org, actor, J({ purchase_order_id: po.poId, destination_location_id: site, status: 'EXPECTED', carrier: 'Prova 253' })),
      (o) => o.shipment_id, (o) => o.shipment_number);
    const pol = (await one(`SELECT id FROM public.purchase_order_lines WHERE purchase_order_id = $1`, [po.poId])).id;
    await forced('recebimento (REC)', TABLES[4],
      () => act('goods_receipt_post', org, actor, J({ purchase_order_id: po.poId, location_id: site, idempotency_key: `rec253-${stamp}`,
        lines: [{ po_line_id: pol, accepted_quantity: 5 }] })),
      (o) => o.receipt_id, (o) => o.receipt_number);

    // 7) Sabotagem: sem a guarda, o mesmo sorteio forçado derruba a requisição
    {
      const taken = await existing(TABLES[0]);
      const r = await isolated(async () => {
        await db.query('ALTER TABLE public.purchase_requisitions DISABLE TRIGGER preqn_number_guard');
        await forceFirstDraw(taken);
        return act('purchase_requisition_create_manual', org, actor, J({ justification: 'Sabotagem 253', lines: [{ item_id: item, quantity: 1 }] }));
      });
      check('sabotagem: sem a guarda, o sorteio repetido derruba a criação em preqn_number_unique (é a guarda que segura)',
        !r.ok && r.code === '23505' && /preqn_number_unique/.test(r.e), J(r).slice(0, 200));
    }

    // 8) Sorteio que só devolve número usado → para em 50 tentativas
    {
      const taken = await existing(TABLES[0]);
      const r = await isolated(async () => {
        await forceFirstDraw(taken, true);
        return act('purchase_requisition_create_manual', org, actor, J({ justification: 'Prova 253 esgotada', lines: [{ item_id: item, quantity: 1 }] }));
      });
      check('sorteio esgotado → erro claro depois de 50 tentativas (sem laço infinito)',
        !r.ok && r.code === '23505' && /Could not allocate a free RC number/.test(r.e), J(r).slice(0, 200));
    }

    // 9) O gerador verdadeiro voltou (as substituições acima ficaram nos SAVEPOINTs desfeitos)
    const pn = await one(`SELECT prosrc FROM pg_proc WHERE oid = 'public.procurement_number(text)'::regprocedure`);
    check('procurement_number intacto depois das provas', /md5\(gen_random_uuid\(\)::text\)/.test(pn.prosrc) && !/pn253/.test(pn.prosrc));
  },
});
