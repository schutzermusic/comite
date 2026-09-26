/**
 * 249 — Compras: ordem das travas e varredura da cotação sob trava.
 *
 *   node scripts/operations/apply-249.mjs --target=qa [--apply]
 *   node scripts/operations/apply-249.mjs [--apply]
 *
 * Regra: docs/operations-supply/COVERAGE-SEMANTICS.md (seção 248, "Lock order"). Aqui, sempre desfeito:
 * a governança e as mensagens das três reescritas (iguais às da 248: o corpo novo é o implantado mais as
 * inserções), a ordem das travas conferida no fonte (as reescritas e as que não mudam), a varredura da
 * cotação em sequência — inclusive a repetição que conserta uma cotação deixada ABERTA, montada por escrita
 * direta —, a emissão e a decisão de sempre, e as lacunas de prova da revisão da 248: a salvaguarda do
 * legado PEDIDA, a PEDIDA derivada (cancelamento e emissão), a ordem do orçamento e a recusa da linha toda
 * liberada. Toda quantidade é comparada como DECIMAL do banco (texto), nunca por float. As corridas com
 * COMMIT real rodam num clone descartável do QA (IMPLEMENTATION-LOG, seção 249).
 *
 * Estados LEGADOS (a corrida de dois cancelamentos de requisição anterior à 249; a emissão anterior à 248)
 * são montados por escrita direta, dentro do SAVEPOINT das provas — como na apply-248.
 */
import { runMigration } from './lib/proof-kit.mjs';
import { confirmedMaterial, proofItem, proofProject, purchaseOrderFromLines } from './lib/fixtures.mjs';

const CHANGED = ['purchase_requisition_cancel(uuid,uuid,uuid,text)', 'purchase_order_issue(uuid,uuid,uuid)', 'procurement_decide(uuid,uuid,jsonb)'];
// A demo de Tucuruí no QA fica de fora de tudo (nem avaliada em savepoint).
const TUCURUI_PO = 'OC-260924-5A811';
const TUCURUI_RFQ = 'COT-260924-98CDA';
const REASON = 'Fornecedor desistiu do pedido';
const OVERRIDE = { reason: 'Transferência incerta: a frente de obra não espera a liberação do cliente' };

/** Decimal do banco como texto canônico (sem zeros à direita): '150.0000' → '150'. */
const dec = (x) => (x == null ? null : String(x).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''));
/** jsonb em texto → objeto com TODO número como decimal canônico (texto): nada passa por float. */
const exact = (text) => (text == null ? null : JSON.parse(text.replace(/("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
  (m, str, num) => str ?? `"${dec(num)}"`)));
/** Fonte de função sem os comentários `--` (a ordem das travas é conferida no código, não no texto explicativo). */
const code = (source) => source.replace(/--[^\n]*/g, '');
/** Posição da primeira ocorrência de `re` em `text` (−1 se não houver). */
const at = (text, re) => { const m = re.exec(text); return m ? m.index : -1; };
/** As recusas do fonte: SQLSTATE + mensagem, ordenadas. */
const raises = (source) => [...code(source).matchAll(/RAISE EXCEPTION '((?:[^']|'')*)'[^;]*?ERRCODE = '(\w+)'/g)]
  .map((m) => `${m[2]} ${m[1]}`).sort();
/** As linhas de código (sem comentário, sem recuo) do fonte. */
const codeLines = (source) => code(source).split('\n').map((l) => l.trim()).filter(Boolean);
/** Trava explícita de requisito (qualquer força) numa instrução do fonte. */
const REQUIREMENT_LOCK = /FROM public\.project_requirements\b[^;]*\bFOR (?:UPDATE|NO KEY UPDATE|SHARE|KEY SHARE)\b/g;

let before = null;

await runMigration({
  version: '249',
  expectedTip: '248',
  // Antes da migration (mesma transação): o fonte IMPLANTADO (248) das três funções, para provar que o novo o preserva.
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
    /** A resposta da função com os números EXATOS (texto canônico). */
    const call = async (fn, ...args) => exact((await one(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')})::text t`, args)).t);
    let seq = 0;
    /** Recusa com o SQLSTATE e a mensagem esperados (isolada em SAVEPOINT). */
    const refuse = async (label, sql, params, sqlstate, pattern) => {
      const sp = `sp249_${++seq}`;
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
    /** Executa um passo que DEVE funcionar; a falha vira FAIL (com a mensagem) em vez de derrubar as provas. */
    const attempt = async (label, fn) => {
      const sp = `sp249_${++seq}`;
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
    const cancel = (po, reason = REASON) => call('purchase_order_cancel', org, actor, po, reason);
    const issue = (po) => call('purchase_order_issue', org, actor, po);
    const cancelRc = (rc, reason = 'Frente de obra suspensa') => call('purchase_requisition_cancel', org, actor, rc, reason);

    // ── Governança: as reescritas continuam só do servidor ──────────────────
    await browserCannotExecute(CHANGED);
    for (const fn of CHANGED) {
      const g = await one(`SELECT p.prosecdef d, p.proconfig cfg, p.proowner::regrole::text owner,
          (SELECT array_agg(x ORDER BY x) FROM (SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END x
             FROM aclexplode(p.proacl) a WHERE a.privilege_type = 'EXECUTE') e) grantees
        FROM pg_proc p WHERE p.oid = $1::regprocedure`, [`public.${fn}`]);
      check(`${fn.split('(')[0]}: mesma assinatura; EXECUTE só do service_role (além do dono); DEFINER com search_path fixo`,
        J((g.grantees ?? []).filter((x) => x !== g.owner)) === J(['service_role']) && g.d
        && (g.cfg ?? []).some((c) => c.startsWith('search_path=')), J(g));
    }

    // ── O corpo novo é o implantado (248) mais as inserções: mesmas recusas, nenhuma linha de código perdida ──
    const src = async (fn) => code((await one(`SELECT prosrc FROM pg_proc WHERE oid = $1::regprocedure`, [`public.${fn}`])).prosrc);
    // Única linha que sai: a volta antecipada da repetição do cancelamento de requisição (agora ela varre antes de voltar).
    const REPLAY_EARLY_RETURN = "IF v.status = 'CANCELLED' THEN RETURN jsonb_build_object('requisition_id', v.id, 'status', v.status, 'replayed', true); END IF;";
    for (const fn of CHANGED) {
      const now = (await one(`SELECT prosrc FROM pg_proc WHERE oid = $1::regprocedure`, [`public.${fn}`])).prosrc;
      const kept = new Set(codeLines(now));
      const lost = before?.[fn] ? codeLines(before[fn]).filter((l) => !kept.has(l)) : ['(fonte 248 não lido)'];
      const expectedLost = fn.startsWith('purchase_requisition_cancel') ? [REPLAY_EARLY_RETURN] : [];
      check(`${fn.split('(')[0]}: as MESMAS recusas (SQLSTATE e mensagem) da 248; toda linha de código da 248 continua lá${expectedLost.length ? ' (menos a volta antecipada da repetição)' : ''}`,
        Boolean(before?.[fn]) && J(raises(now)) === J(raises(before[fn])) && J(lost) === J(expectedLost),
        J({ raises: raises(now).length, lost }));
    }

    // ── Ordem das travas, conferida no fonte (as corridas com COMMIT real ficam no clone) ──
    const sCancel = await src('purchase_order_cancel(uuid,uuid,uuid,text)');
    const lc = {
      po: at(sCancel, /FROM public\.purchase_orders WHERE organization_id = p_organization_id AND id = p_po_id FOR UPDATE;/),
      approval: at(sCancel, /FROM public\.approval_requests\s+WHERE[^;]*FOR UPDATE;/),
      requirements: at(sCancel, /PERFORM 1 FROM public\.project_requirements\b[^;]*\bORDER BY id FOR NO KEY UPDATE;/),
      requisitions: at(sCancel, /PERFORM 1 FROM public\.purchase_requisitions\b[^;]*\bORDER BY id FOR UPDATE;/),
      rule: at(sCancel, /supply_requirement_claimed\(/),
      releases: at(sCancel, /INSERT INTO public\.procurement_requisition_releases/),
      flip: at(sCancel, /UPDATE public\.purchase_orders SET status = 'CANCELLED'/),
      rfq: at(sCancel, /UPDATE public\.procurement_rfqs /),
    };
    check('cancelamento do pedido (inalterado): PO → aprovação → requisitos (FOR NO KEY UPDATE, uuid) → requisições (uuid) → regra e liberações → estado → cotação',
      lc.po >= 0 && lc.po < lc.approval && lc.approval < lc.requirements && lc.requirements < lc.requisitions
      && lc.requisitions < lc.rule && lc.rule < lc.releases && lc.releases < lc.flip && lc.flip < lc.rfq
      && [...sCancel.matchAll(REQUIREMENT_LOCK)].length === 1 && (sCancel.match(/FOR NO KEY UPDATE/g) ?? []).length === 1, J(lc));
    // O que o cancelamento trava: os requisitos de C (alocações abertas), o mesmo conjunto a que o retrato de C se restringe.
    const cSet = at(sCancel, /v_rids := ARRAY\(SELECT DISTINCT o\.requirement_id FROM public\.purchase_requisition_open_allocations o\b[^;]*\bo\.open_qty > 0[^;]*\);/);
    check('cancelamento do pedido: a trava cobre os requisitos de C (alocações abertas) e o retrato de C só vê requisitos travados',
      cSet >= 0 && cSet < lc.requirements
      && /PERFORM 1 FROM public\.project_requirements WHERE organization_id = p_organization_id AND id = ANY \(v_rids\)\s+ORDER BY id FOR NO KEY UPDATE;/.test(sCancel)
      && /FROM public\.purchase_requisition_open_allocations o\b[^;]*\bo\.requirement_id = ANY \(v_rids\)/.test(sCancel.slice(lc.requisitions)), J({ cSet }));

    const sIssue = await src('purchase_order_issue(uuid,uuid,uuid)');
    const li = {
      po: at(sIssue, /FROM public\.purchase_orders WHERE organization_id = p_organization_id AND id = p_po_id FOR UPDATE;/),
      replay: at(sIssue, /'replayed', true\)/),
      approved: at(sIssue, /only an approved order is issued/),
      fingerprint: at(sIssue, /purchase_order_fingerprint\(v\.id\)/),
      supplier: at(sIssue, /the order is not issued/),
      requirements: at(sIssue, /PERFORM 1 FROM public\.project_requirements pr\b[^;]*\bFROM public\.purchase_requisition_open_allocations o\b[^;]*\bo\.open_qty > 0[^;]*\bpl\.purchase_order_id = v\.id[^;]*\bo\.open_qty > COALESCE\(\(SELECT sum\(a\.quantity\)[^;]*\ba\.requirement_id = o\.requirement_id\), 0\)\)\s+ORDER BY pr\.id FOR KEY SHARE;/),
      requisitions: at(sIssue, /PERFORM 1 FROM public\.purchase_requisitions r\b[^;]*\bORDER BY r\.id FOR UPDATE;/),
      releases: at(sIssue, /INSERT INTO public\.procurement_requisition_releases/),
      ordered: at(sIssue, /UPDATE public\.purchase_requisitions r SET status = 'ORDERED'/),
    };
    check('emissão: PO → (repetição, APROVADO, impressão digital, fornecedor, como na 248) → requisitos FOR KEY SHARE (uuid) das alocações abertas das linhas do pedido → requisições (uuid) → liberações → PEDIDA',
      li.po >= 0 && li.po < li.replay && li.replay < li.approved && li.approved < li.fingerprint && li.fingerprint < li.supplier
      && li.supplier < li.requirements && li.requirements < li.requisitions && li.requisitions < li.releases && li.releases < li.ordered, J(li));
    check('emissão: a única trava de requisito é essa (FOR KEY SHARE, uma instrução) — e o conjunto dela é o das liberações (aberto > pedido nas linhas do pedido; emissão inteira não trava requisito)',
      [...sIssue.matchAll(REQUIREMENT_LOCK)].length === 1 && (sIssue.match(/FOR KEY SHARE/g) ?? []).length === 1
      && /FROM public\.purchase_requisition_open_allocations o\b[^;]*\bo\.open_qty > 0[^;]*\bpl\.purchase_order_id = v\.id\)[^;]*\bo\.open_qty - COALESCE\(d\.ordered, 0\) > 0/.test(sIssue.slice(li.releases)));

    const sDecide = await src('procurement_decide(uuid,uuid,jsonb)');
    const ld = {
      require: at(sDecide, /inventory_require\(/),
      requirements: at(sDecide, /PERFORM 1 FROM public\.project_requirements pr\b[^;]*\bFROM public\.purchase_requisition_open_allocations o\b[^;]*\bo\.open_qty > 0[^;]*\bx\.rfq_id = \(p_payload->>'rfq_id'\)::uuid\)\)\s+ORDER BY pr\.id FOR KEY SHARE;/),
      requisitions: at(sDecide, /PERFORM 1 FROM public\.purchase_requisitions r\b[^;]*\bORDER BY r\.id FOR UPDATE;/),
      rfq: at(sDecide, /FROM public\.procurement_rfqs WHERE[^;]*FOR UPDATE;/),
      polr: at(sDecide, /INSERT INTO public\.purchase_order_line_requirements/),
      firstLock: at(sDecide, /\bFOR (?:UPDATE|NO KEY UPDATE|SHARE|KEY SHARE)\b/),
    };
    check('decisão: requisitos FOR KEY SHARE (uuid) das alocações abertas das linhas da cotação → requisições (uuid) → cotação → alocações do pedido; é a PRIMEIRA trava',
      ld.require >= 0 && ld.require < ld.requirements && ld.requirements < ld.firstLock && ld.firstLock < ld.requisitions
      && ld.requisitions < ld.rfq && ld.rfq < ld.polr, J(ld));
    check('decisão: a única trava de requisito é essa (FOR KEY SHARE, uma instrução); o laço das alocações lê o mesmo aberto > 0',
      [...sDecide.matchAll(REQUIREMENT_LOCK)].length === 1 && (sDecide.match(/FOR KEY SHARE/g) ?? []).length === 1
      && /FROM public\.purchase_requisition_open_allocations o[^;]*o\.open_qty > 0\s+ORDER BY pr\.required_by NULLS LAST, o\.allocation_id LOOP/.test(sDecide));

    const sRfq = await src('procurement_rfq_create(uuid,uuid,jsonb)');
    const lr = {
      requisitions: at(sRfq, /PERFORM 1 FROM public\.purchase_requisitions r\b[^;]*\bORDER BY r\.id FOR UPDATE;/),
      line: at(sRfq, /SELECT \* INTO l FROM public\.purchase_requisition_lines/),
      open: at(sRfq, /FROM public\.purchase_requisition_open_allocations o/),
    };
    check('cotação (inalterada): só requisições (FOR UPDATE, uuid), antes de ler linha, aberto e data',
      lr.requisitions >= 0 && lr.requisitions < lr.line && lr.line < lr.open && (sRfq.match(/FOR UPDATE/g) ?? []).length === 1
      && [...sRfq.matchAll(REQUIREMENT_LOCK)].length === 0, J(lr));

    const sRc = await src('purchase_requisition_cancel(uuid,uuid,uuid,text)');
    const lq = {
      requisition: at(sRc, /FROM public\.purchase_requisitions WHERE organization_id = p_organization_id AND id = p_requisition_id FOR UPDATE;/),
      flip: at(sRc, /UPDATE public\.purchase_requisitions SET status = 'CANCELLED'/),
      lock: at(sRc, /PERFORM 1 FROM public\.procurement_rfqs q\b[^;]*\bq\.status = 'OPEN'[^;]*\bl\.requisition_id = v\.id\)\s+ORDER BY q\.id FOR UPDATE;/),
      sweep: at(sRc, /WITH dead AS \(\s*UPDATE public\.procurement_rfqs q SET status = 'CANCELLED'/),
      firstReturn: at(sRc, /\bRETURN\b/),
    };
    check('cancelamento de requisição: requisição (FOR UPDATE) → cancela → cotações ABERTAS dela (FOR UPDATE, uuid) numa instrução própria → varredura numa instrução POSTERIOR; nenhuma volta (nem a da repetição) antes da varredura',
      lq.requisition >= 0 && lq.requisition < lq.flip && lq.flip < lq.lock && lq.lock < lq.sweep && lq.firstReturn > lq.sweep
      && [...sRc.matchAll(REQUIREMENT_LOCK)].length === 0, J(lq));

    // Os escritores que mudam o reclamado seguem travando os requisitos FOR UPDATE em ordem de uuid antes das próprias travas.
    const sShortage = await src('purchase_requisition_from_shortage(uuid,uuid,jsonb)');
    const sTransfer = await src('inventory_transfer_request(uuid,uuid,jsonb)');
    const sReserve = await src('inventory_reserve(uuid,uuid,jsonb)');
    const lw = {
      shortageLoop: at(sShortage, /v_ids := ARRAY\(SELECT DISTINCT[^;]*ORDER BY 1\);\s*FOREACH v_rid IN ARRAY v_ids LOOP\s+PERFORM 1 FROM public\.project_requirements\b[^;]*FOR UPDATE;/),
      shortageInsert: at(sShortage, /INSERT INTO public\.purchase_requisitions /),
      transferLoop: at(sTransfer, /FOR\s+v_rid\s+IN\s+SELECT\s+DISTINCT[^;]*?\bORDER\s+BY\s+1\s+LOOP\s+PERFORM\s+1\s+FROM\s+public\.project_requirements\b[^;]*\bFOR\s+UPDATE;/),
      transferInsert: at(sTransfer, /INSERT INTO public\.inventory_transfers /),
      reserveLock: at(sReserve, /FROM public\.project_requirements\s+WHERE[^;]*FOR UPDATE;/),
      reserveStock: at(sReserve, /inventory_lock\(/),
    };
    check('requisição da falta, pedido de transferência e reserva (inalterados): requisitos FOR UPDATE (uuid) antes das próprias travas e escritas',
      lw.shortageLoop >= 0 && lw.shortageLoop < lw.shortageInsert && lw.transferLoop >= 0 && lw.transferLoop < lw.transferInsert
      && lw.reserveLock >= 0 && lw.reserveLock < lw.reserveStock, J(lw));

    // O prefixo global: [pedido] → requisitos (uuid) → requisições (uuid) → cotação. Quem trava requisito o faz ANTES
    // da primeira requisição e nunca depois dela (a chave estrangeira das inserções cai em requisito já travado).
    const afterRequisitions = (s, requisitionAt) => [...s.slice(requisitionAt).matchAll(REQUIREMENT_LOCK)].length;
    check('prefixo global: cancelamento, emissão e decisão travam os requisitos ANTES das requisições e nenhum requisito depois delas',
      lc.requirements < lc.requisitions && afterRequisitions(sCancel, lc.requisitions) === 0
      && li.requirements < li.requisitions && afterRequisitions(sIssue, li.requisitions) === 0
      && ld.requirements < ld.requisitions && afterRequisitions(sDecide, ld.requisitions) === 0,
      J({ cancel: afterRequisitions(sCancel, lc.requisitions), issue: afterRequisitions(sIssue, li.requisitions),
        decide: afterRequisitions(sDecide, ld.requisitions) }));

    // ── Neutralidade: a repetição (que agora varre) sobre CADA requisição cancelada do QA (menos a demo), desfeita ──
    const cancelled = await all(`SELECT r.id, r.requisition_number FROM public.purchase_requisitions r
      WHERE r.organization_id = $1 AND r.status = 'CANCELLED'
        AND NOT EXISTS (SELECT 1 FROM public.purchase_requisition_lines l
                          JOIN public.procurement_rfq_lines x ON x.organization_id = l.organization_id AND x.requisition_line_id = l.id
                          JOIN public.procurement_rfqs q ON q.id = x.rfq_id
                         WHERE l.requisition_id = r.id AND q.rfq_number = $2)
        AND NOT EXISTS (SELECT 1 FROM public.purchase_requisition_lines l
                          JOIN public.purchase_order_lines pl ON pl.organization_id = l.organization_id AND pl.requisition_line_id = l.id
                          JOIN public.purchase_orders po ON po.id = pl.purchase_order_id
                         WHERE l.requisition_id = r.id AND po.order_number = $3)
      ORDER BY r.requisition_number`, [org, TUCURUI_RFQ, TUCURUI_PO]);
    const neutral = { n: 0, swept: [], failures: [] };
    for (const r of cancelled) {
      await db.query('SAVEPOINT n249');
      try {
        const out = await cancelRc(r.id, 'Prova 249: neutralidade sobre o QA');
        neutral.n += 1;
        if (!out.replayed || J(out.rfqs_cancelled) !== '[]') neutral.swept.push(`${r.requisition_number}: ${J(out)}`);
      } catch (error) {
        neutral.failures.push(`${r.requisition_number}: ${error.message.slice(0, 100)}`);
      }
      await db.query('ROLLBACK TO SAVEPOINT n249');
      await db.query('RELEASE SAVEPOINT n249');
    }
    check(`neutralidade: a repetição sobre as ${neutral.n} requisições canceladas do QA (cada uma desfeita) não varre nada — o QA não tem cotação aberta só de requisições mortas`,
      neutral.n === cancelled.length && neutral.swept.length === 0 && neutral.failures.length === 0, J(neutral));

    // ── Cenários (cada um com item, projeto e canteiro próprios) ─────────────
    let n = 0;
    const scene = async (label, { items = 1, depotStock = 0 } = {}) => {
      const k = `${label}${++n}`;
      const project = await proofProject(ctx, anchors, `P249-${k}-${stamp}`);
      const list = [];
      for (let i = 0; i < items; i += 1) list.push(await proofItem(ctx, anchors, `I249-${k}${'XYZ'[i]}-${stamp}`, 'm'));
      const loc = async (prefix, kind, extra = {}) => (await act('inventory_location_upsert', org, actor,
        J({ code: `${prefix}-${k}-${stamp}`, name: `${prefix} ${k}`, kind, ...extra }))).location_id;
      const site = await loc('S249', 'PROJECT_SITE', { project_id: project });
      const depot = depotStock ? await loc('D249', 'WAREHOUSE') : null;
      for (const item of list) {
        if (depotStock) await act('inventory_adjust', org, actor, J({ item_id: item, location_id: depot, quantity: depotStock, reason: 'Prova 249' }));
      }
      return { k, project, item: list[0], items: list, site, depot };
    };
    const need = (s, quantity, item = s.item) => confirmedMaterial(ctx, anchors, s.project, item, quantity);
    /** Requisição da falta (governada): id, número, requisitado exato e a linha de cada item. */
    const requisition = async (requirementIds, extra = {}) => {
      const out = await call('purchase_requisition_from_shortage', org, actor, J({ requirement_ids: requirementIds, ...extra }));
      const lines = await all(`SELECT id, item_id FROM public.purchase_requisition_lines WHERE requisition_id = $1 ORDER BY created_at, id`,
        [out.requisition_id]);
      return { id: out.requisition_id, number: out.requisition_number, qty: out.requisitioned_qty, out,
        lines: lines.map((l) => l.id), lineOf: Object.fromEntries(lines.map((l) => [l.item_id, l.id])) };
    };
    const order = (s, lineIds, opts = {}) => purchaseOrderFromLines(ctx, anchors, { tag: `249${s.k}${stamp}`, lineIds, deliveryLocationId: s.site, ...opts });
    /** Retrato exato de um requisito: reclamado, requisitado e em pedido. */
    const st = async (req) => {
      const row = await one(`SELECT public.supply_requirement_claimed($1,$2)::text claimed,
          public.procurement_requested_open($1,$2)::text requested, public.procurement_on_order($1,$2)::text on_order,
          public.supply_requirement_claimed($1,$2) <= COALESCE(pr.quantity, 0) AS within
        FROM public.project_requirements pr WHERE pr.organization_id = $1 AND pr.id = $2`, [org, req]);
      return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'boolean' ? v : dec(v)]));
    };
    const ledger = async (po) => (await all(`SELECT requisition_id, requisition_line_id, allocation_id, requirement_id, stage, cause,
        quantity::text q FROM public.procurement_requisition_releases WHERE organization_id = $1 AND purchase_order_id = $2
       ORDER BY stage, requirement_id, allocation_id`, [org, po])).map((x) => ({ ...x, q: dec(x.q) }));
    const rq = (id) => one(`SELECT status, requisition_number FROM public.purchase_requisitions WHERE id = $1`, [id]);
    const rfqRow = (id) => one(`SELECT status, close_reason FROM public.procurement_rfqs WHERE id = $1`, [id]);
    const lineOpen = async (lineId) => dec((await one(`SELECT COALESCE(sum(open_qty), 0)::text q
      FROM public.purchase_requisition_open_allocations WHERE organization_id = $1 AND requisition_line_id = $2`, [org, lineId])).q);
    const allocationOf = async (rc, req) => (await one(`SELECT a.id FROM public.purchase_requisition_line_requirements a
        JOIN public.purchase_requisition_lines l ON l.organization_id = a.organization_id AND l.id = a.line_id
       WHERE a.organization_id = $1 AND l.requisition_id = $2 AND a.requirement_id = $3`, [org, rc, req])).id;
    const cancelledEvents = async (rc) => (await one(`SELECT count(*)::int k FROM public.domain_events
      WHERE organization_id = $1 AND event_type = 'supply.requisition.cancelled' AND aggregate_id = $2`, [org, rc])).k;
    const outOf = (res, req) => (res?.requirements ?? []).find((x) => x.requirement_id === req);
    const releasedOf = (res, req) => (res?.released ?? []).find((x) => x.requirement_id === req);
    const transfer = async (s, req, quantity) => (await act('inventory_transfer_request', org, actor, J({ from_location_id: s.depot,
      to_location_id: s.site, lines: [{ item_id: s.item, quantity, requirement_id: req }] }))).transfer_id;
    const transition = (req, to, reason = null) => act('project_requirement_transition', org, actor, req, to, reason, null);
    /** Estado LEGADO por escrita direta (dentro do SAVEPOINT das provas). */
    const forceCancelled = (rc) => one(`UPDATE public.purchase_requisitions SET status = 'CANCELLED', closed_at = now(),
      close_reason = 'Cancelada na corrida anterior à 249' WHERE id = $1 RETURNING id`, [rc]);

    // ── Varredura em sequência: a última requisição viva cancelada fecha a cotação ──
    {
      const s = await scene('SW', { items: 2 });
      const [ix, iy] = s.items;
      const rca = await requisition([await need(s, 100, ix)]);
      const rcb = await requisition([await need(s, 50, iy)]);
      const q = await order(s, [...rca.lines, ...rcb.lines], { until: 'QUOTED' });
      const first = await cancelRc(rca.id);
      const mid = await rfqRow(q.rfqId);
      const last = await cancelRc(rcb.id);
      const row = await rfqRow(q.rfqId);
      check('(varredura) cancelar a RC-A deixa a cotação ABERTA (RC-B viva); cancelar a RC-B, a última viva, a cancela — motivo nomeia a RC-B',
        first.replayed === false && J(first.rfqs_cancelled) === '[]' && mid.status === 'OPEN' && last.replayed === false
        && last.rfqs_cancelled?.length === 1 && last.rfqs_cancelled[0].rfq_id === q.rfqId && last.rfqs_cancelled[0].rfq_number === q.rfqNumber
        && row.status === 'CANCELLED' && row.close_reason === `Solicitação ${rcb.number} cancelada`
        && await cancelledEvents(rca.id) === 1 && await cancelledEvents(rcb.id) === 1, J({ first, last, row }));
      await refuse('(varredura) cotação cancelada não recebe proposta (mensagem de sempre)', 'SELECT public.procurement_quote_record($1,$2,$3)',
        [org, actor, J({ rfq_id: q.rfqId, supplier_id: q.supplierId, validity_date: '2099-01-01', lines: [] })], '23514',
        /^RFQ is CANCELLED: quotes are no longer recorded\.$/);
      await refuse('(varredura) nem vira decisão (mensagem de sempre)', 'SELECT public.procurement_decide($1,$2,$3)',
        [org, actor, J({ rfq_id: q.rfqId, quote_id: q.quoteId, rationale: 'Prova 249' })], '23514', /^RFQ is CANCELLED\.$/);
    }

    // ── A repetição conserta a cotação deixada ABERTA pela corrida anterior à 249 ──
    {
      const s = await scene('ST', { items: 2 });
      const [ix, iy] = s.items;
      const rca = await requisition([await need(s, 100, ix)]);
      const rcb = await requisition([await need(s, 50, iy)]);
      const q = await order(s, [...rca.lines, ...rcb.lines], { until: 'QUOTED' });
      // O desfecho da corrida: as duas requisições CANCELADAS e a cotação ABERTA (nenhuma varredura viu a outra).
      await forceCancelled(rca.id);
      await forceCancelled(rcb.id);
      await refuse('(repetição) cotação deixada ABERTA só com requisições canceladas: a decisão é recusada', 'SELECT public.procurement_decide($1,$2,$3)',
        [org, actor, J({ rfq_id: q.rfqId, quote_id: q.quoteId, rationale: 'Prova 249' })], '23514',
        /^No line of this quotation can become an order: its requisitions were cancelled or closed\.$/);
      const rep = await cancelRc(rca.id, 'Repetição do cancelamento');
      const row = await rfqRow(q.rfqId);
      check('(repetição) cancelar de novo a RC-A (já CANCELADA): a repetição trava, varre e fecha a cotação — resposta de repetição com rfqs_cancelled',
        J(Object.keys(rep).sort()) === J(['replayed', 'requisition_id', 'rfqs_cancelled', 'status']) && rep.replayed === true
        && rep.status === 'CANCELLED' && rep.requisition_id === rca.id && rep.rfqs_cancelled?.length === 1
        && rep.rfqs_cancelled[0].rfq_id === q.rfqId && row.status === 'CANCELLED' && row.close_reason === `Solicitação ${rca.number} cancelada`,
        J({ rep, row }));
      const again = await cancelRc(rca.id, 'Repetição do cancelamento');
      const other = await cancelRc(rcb.id, 'Repetição do cancelamento');
      check('(repetição) as repetições seguintes não varrem nada; a repetição não emite evento de cancelamento',
        again.replayed === true && J(again.rfqs_cancelled) === '[]' && other.replayed === true && J(other.rfqs_cancelled) === '[]'
        && await cancelledEvents(rca.id) === 0 && await cancelledEvents(rcb.id) === 0 && (await rq(rca.id)).status === 'CANCELLED',
        J({ again, other }));
      // Repetição com outra requisição ainda viva na cotação: nada muda.
      const t = await scene('SV', { items: 2 });
      const tca = await requisition([await need(t, 100, t.items[0])]);
      const tcb = await requisition([await need(t, 50, t.items[1])]);
      const q2 = await order(t, [...tca.lines, ...tcb.lines], { until: 'QUOTED' });
      await forceCancelled(tca.id);
      const rep2 = await cancelRc(tca.id, 'Repetição do cancelamento');
      const mid = await rfqRow(q2.rfqId);
      const last = await cancelRc(tcb.id);
      check('(repetição) com a RC-B viva a repetição não varre (cotação ABERTA); o cancelamento da RC-B, depois, a fecha',
        rep2.replayed === true && J(rep2.rfqs_cancelled) === '[]' && mid.status === 'OPEN' && last.replayed === false
        && last.rfqs_cancelled?.[0]?.rfq_id === q2.rfqId && (await rfqRow(q2.rfqId)).status === 'CANCELLED', J({ rep2, last }));
    }

    // ── O cancelamento de requisição mantém as recusas de sempre ────────────
    {
      const s = await scene('RR', { items: 2 });
      const [ix, iy] = s.items;
      const r1 = await need(s, 100, ix);
      const rca = await requisition([r1]);
      const po = await order(s, rca.lines, { until: 'DRAFT' });
      await refuse('(recusas) requisição com pedido vivo não se cancela', 'SELECT public.purchase_requisition_cancel($1,$2,$3,$4)',
        [org, actor, rca.id, 'Limpeza'], '23514', /^Requisition already has a purchase order: cancel the order first\.$/);
      await refuse('(recusas) motivo em branco', 'SELECT public.purchase_requisition_cancel($1,$2,$3,$4)', [org, actor, rca.id, '  '],
        '22023', /^Cancellation requires a reason\.$/);
      await refuse('(recusas) requisição de outro inquilino / inexistente', 'SELECT public.purchase_requisition_cancel($1,$2,$3,$4)',
        [org, actor, '00000000-0000-4000-8000-000000000249', 'Limpeza'], 'P0002', /^Requisition not found in tenant\.$/);
      // ENCERRADA: requisito cancelado e pedido cancelado → nada aberto.
      const r2 = await need(s, 50, iy);
      const rcc = await requisition([r2]);
      const po2 = await order(s, rcc.lines, { until: 'DRAFT' });
      await transition(r2, 'CANCELLED', 'Escopo removido pelo cliente');
      await cancel(po2.poId);
      await refuse('(recusas) requisição ENCERRADA não se cancela', 'SELECT public.purchase_requisition_cancel($1,$2,$3,$4)',
        [org, actor, rcc.id, 'Limpeza'], '23514', /^Requisition is CLOSED: nothing to cancel\.$/);
      check('(recusas) depois das recusas: RC-A com pedido em rascunho, RC-C ENCERRADA', (await rq(rca.id)).status === 'SOURCING'
        && (await rq(rcc.id)).status === 'CLOSED' && Boolean(po.poId));
    }

    // ── Emissão e decisão de sempre, com a trava nova ────────────────────────
    {
      const s = await scene('A');
      const r = await need(s, 100);
      const rca = await requisition([r]);
      const po = await order(s, rca.lines, { quantities: { [s.item]: 60 }, until: 'APPROVED' });
      const iss = await issue(po.poId);
      const lg = await ledger(po.poId);
      check('(a) emissão de 60 contra 100: libera os 40 não pedidos (PO_ISSUED/NOT_ORDERED) e responde por requisito, como na 248',
        iss.status === 'ISSUED' && iss.replayed === false && iss.released.length === 1 && releasedOf(iss, r)?.released_qty === '40'
        && lg.length === 1 && lg[0].stage === 'PO_ISSUED' && lg[0].cause === 'NOT_ORDERED' && lg[0].q === '40'
        && (await rq(rca.id)).status === 'ORDERED', J({ iss, lg }));
      const again = await issue(po.poId);
      check('(a) repetição da emissão: a resposta de sempre, sem refazer liberação',
        J(Object.keys(again).sort()) === J(['purchase_order_id', 'replayed', 'status']) && again.replayed === true
        && (await ledger(po.poId)).length === 1, J(again));
      const rcb = await requisition([r]);
      const can = await cancel(po.poId);
      const c = await st(r);
      check('(a) RC-B dos 40, cancelamento: reabre só os 60 — reclamado 100 = requerido',
        rcb.qty === '40' && outOf(can, r)?.reopened_qty === '60' && outOf(can, r)?.released_qty === '0' && c.claimed === '100' && c.within,
        J({ can: can.requirements, c }));
    }
    {
      const s = await scene('B2', { items: 2 });
      const [ix, iy] = s.items;
      const r1 = await need(s, 100, ix);
      const r2 = await need(s, 50, iy);
      const rca = await requisition([r1]);
      const rcc = await requisition([r2]);
      const quoted = await order(s, [...rca.lines, ...rcc.lines], { until: 'QUOTED' });
      await cancelRc(rcc.id);
      const decided = await attempt('(B2) decisão da cotação mista', () => call('procurement_decide', org, actor,
        J({ rfq_id: quoted.rfqId, quote_id: quoted.quoteId, rationale: 'Prova 249: única proposta.' })));
      const alloc = decided ? await all(`SELECT a.requirement_id, a.quantity::text q FROM public.purchase_order_line_requirements a
          JOIN public.purchase_order_lines l ON l.id = a.line_id WHERE l.purchase_order_id = $1`, [decided.purchase_order_id]) : [];
      check('(B2) decisão da cotação mista: pede SÓ a linha viva (RC-A, 100); a da RC-C cancelada vai em not_ordered, como na 248',
        Boolean(decided) && alloc.length === 1 && alloc[0].requirement_id === r1 && dec(alloc[0].q) === '100'
        && decided.not_ordered?.length === 1 && decided.not_ordered[0].requisition_status === 'CANCELLED'
        && decided.not_ordered[0].open_qty === '50', J(decided));
      const replay = decided ? await call('procurement_decide', org, actor,
        J({ rfq_id: quoted.rfqId, quote_id: quoted.quoteId, rationale: 'Prova 249: única proposta.' })) : null;
      check('(B2) repetição da decisão: a resposta de sempre', replay?.replayed === true && replay.purchase_order_id === decided?.purchase_order_id,
        J(replay));
    }
    {
      const s = await scene('SR');
      const r = await need(s, 100);
      const rca = await requisition([r]);
      const po = await order(s, rca.lines, { until: 'APPROVED' });
      await forceCancelled(rca.id);
      await refuse('(cotação velha, legado) a emissão recusa o pedido de requisição cancelada (mensagem de sempre)',
        'SELECT public.purchase_order_issue($1,$2,$3)', [org, actor, po.poId], '23514',
        new RegExp(`^Requisition ${rca.number} is CANCELLED: this order can no longer be issued\\.$`));
    }

    // ── Lacuna 1 da revisão: a salvaguarda do legado PEDIDA (contrato, passo 8 do cancelamento) ──
    {
      const s = await scene('L1', { items: 2 });
      const [ix, iy] = s.items;
      const r1 = await need(s, 100, ix);
      const r2 = await need(s, 50, iy);
      const rca = await requisition([r1, r2]);
      const [lx, ly] = [rca.lineOf[ix], rca.lineOf[iy]];
      const poa = await order(s, [lx], { quantities: { [lx]: 60 } });
      const pob = await order(s, [ly], { until: 'APPROVED' });
      const rcb = await requisition([r1]);
      await cancel(poa.poId);
      // Legado (corrida emissão ∥ cancelamento anterior à 248): PO-B EMITIDO sem a emissão de hoje e a RC-A PEDIDA
      // com a linha X aberta em 60 e o pedido dela cancelado.
      await one(`UPDATE public.purchase_orders SET status = 'ISSUED', issued_by = $2, issued_at = now() WHERE id = $1 RETURNING id`, [pob.poId, actor]);
      await one(`UPDATE public.purchase_requisitions SET status = 'ORDERED' WHERE id = $1 RETURNING id`, [rca.id]);
      const rcc = await requisition([r1]);
      const pre = await st(r1);
      const openX = await lineOpen(lx);
      const can = await cancel(pob.poId);
      const c1 = await st(r1);
      const lg = (await ledger(pob.poId)).filter((x) => x.stage === 'PO_CANCELLED');
      const allocX = await allocationOf(rca.id, r1);
      const o1 = outOf(can, r1);
      check('(lacuna 1) legado RC-A PEDIDA com X aberta 60 sem pedido; RC-B 40 e RC-C 60 cobrem o R1: cancelar o PO-B libera os 60 de X (COVERED) — reclamado 100, não 160',
        rcb.qty === '40' && rcc.qty === '60' && openX === '60' && pre.claimed === '100' && o1?.released_qty === '60' && o1.reopened_qty === '0'
        && o1.cause === 'COVERED' && c1.claimed === '100' && c1.within, J({ pre: pre.claimed, o1, c1 }));
      check('(lacuna 1) livro: linha PO_CANCELLED/COVERED de 60 na alocação de X (R1); RC-A PEDIDA → AGUARDANDO; R2 reabre os 50 de Y',
        lg.some((x) => x.cause === 'COVERED' && x.q === '60' && x.allocation_id === allocX && x.requisition_line_id === lx && x.requirement_id === r1)
        && can.requisitions?.length === 1 && can.requisitions[0].requisition_id === rca.id && can.requisitions[0].status_from === 'ORDERED'
        && can.requisitions[0].status_to === 'SUBMITTED' && outOf(can, r2)?.reopened_qty === '50' && (await st(r2)).claimed === '50',
        J({ lg, requisitions: can.requisitions }));
    }

    // ── Lacuna 4 da revisão: a PEDIDA derivada (cancelamento, passo 13; emissão, passo 5) ──
    {
      const s = await scene('L4B', { items: 2 });
      const [ix, iy] = s.items;
      const r1 = await need(s, 100, ix);
      const r2 = await need(s, 50, iy);
      const rca = await requisition([r1, r2]);
      const poa = await order(s, [rca.lineOf[ix]]);
      await order(s, [rca.lineOf[iy]]);
      const statusBefore = (await rq(rca.id)).status;
      await transition(r1, 'CANCELLED', 'Escopo removido pelo cliente');
      const can = await cancel(poa.poId);
      const lg = (await ledger(poa.poId)).filter((x) => x.stage === 'PO_CANCELLED');
      check('(lacuna 4, demo B) dois itens com os dois pedidos emitidos; R1 CANCELADO; cancelar o PO-A libera os 100 (REQUIREMENT_INACTIVE) e a RC-A SEGUE PEDIDA',
        statusBefore === 'ORDERED' && outOf(can, r1)?.released_qty === '100' && outOf(can, r1)?.reopened_qty === '0'
        && outOf(can, r1)?.cause === 'REQUIREMENT_INACTIVE' && lg.length === 1 && lg[0].cause === 'REQUIREMENT_INACTIVE' && lg[0].q === '100'
        && can.requisitions?.[0]?.status_from === 'ORDERED' && can.requisitions[0].status_to === 'ORDERED'
        && (await rq(rca.id)).status === 'ORDERED' && !outOf(can, r2) && (await st(r2)).on_order === '50', J({ statusBefore, can }));
    }
    {
      const s = await scene('L4D', { items: 2 });
      const [ix, iy] = s.items;
      const r1 = await need(s, 100, ix);
      const r2 = await need(s, 50, iy);
      const rca = await requisition([r1, r2]);
      const poa = await order(s, [rca.lineOf[ix]]);
      const pob = await order(s, [rca.lineOf[iy]], { until: 'APPROVED' });
      await transition(r1, 'CANCELLED', 'Escopo removido pelo cliente');
      const can = await cancel(poa.poId);
      const mid = (await rq(rca.id)).status;
      const iss = await issue(pob.poId);
      const after = (await rq(rca.id)).status;
      check('(lacuna 4, demo D) R1 CANCELADO; cancelar o PO-A deixa a RC-A EM COTAÇÃO (Y na cotação decidida do PO-B); emitir o PO-B a leva a PEDIDA (X, toda liberada, não conta)',
        can.requisitions?.[0]?.status_to === 'SOURCING' && mid === 'SOURCING' && iss.status === 'ISSUED' && J(iss.released) === '[]'
        && after === 'ORDERED' && await lineOpen(rca.lineOf[ix]) === '0' && (await st(r2)).on_order === '50', J({ can: can.requisitions, mid, after }));
    }

    // ── Lacuna 5 da revisão: sob orçamento que aperta, a requisição mais ANTIGA fica com a reabertura ──
    {
      const s = await scene('L5', { depotStock: 500 });
      const r = await need(s, 100);
      await transfer(s, r, 30);
      const rca = await requisition([r]);
      const rcb = await requisition([r], { coverage_override: OVERRIDE });
      // A mais antiga é a de alocação com uuid MAIOR: a ordem por data e a ordem por uuid discordam, e a prova pega as duas trocas.
      const [aa, ab] = [await allocationOf(rca.id, r), await allocationOf(rcb.id, r)];
      const [older, newer] = aa > ab ? [rca, rcb] : [rcb, rca];
      await one(`UPDATE public.purchase_requisitions SET requested_at = requested_at - interval '1 day' WHERE id = $1 RETURNING id`, [older.id]);
      const po = await order(s, [...rca.lines, ...rcb.lines]);
      const pre = await st(r);
      const can = await cancel(po.poId);
      const c = await st(r);
      const lg = (await ledger(po.poId)).filter((x) => x.stage === 'PO_CANCELLED');
      const [openOlder, openNewer] = [await lineOpen(older.lines[0]), await lineOpen(newer.lines[0])];
      const keepOlder = older === rca ? '70' : '30';
      const keepNewer = older === rca ? '0' : '40';
      const statusOf = (rc) => can.requisitions?.find((x) => x.requisition_id === rc.id)?.status_to;
      check(`(lacuna 5) transferência pendente 30 + RC-A 70 + RC-B 30 por exceção, pedido cheio emitido (reclamado 130): orçamento 70 — a mais antiga (${older === rca ? 'RC-A' : 'RC-B'}) mantém ${keepOlder}; a mais nova fica com ${keepNewer} e a linha COVERED de 30; reclamado 100`,
        rca.qty === '70' && rcb.qty === '30' && rcb.out.override === true && pre.claimed === '130' && outOf(can, r)?.reopened_qty === '70'
        && outOf(can, r)?.released_qty === '30' && outOf(can, r)?.cause === 'COVERED' && lg.length === 1 && lg[0].cause === 'COVERED'
        && lg[0].q === '30' && lg[0].requisition_id === newer.id && openOlder === keepOlder && openNewer === keepNewer && c.claimed === '100'
        && statusOf(older) === 'SUBMITTED' && statusOf(newer) === (keepNewer === '0' ? 'CLOSED' : 'SUBMITTED'),
        J({ older: older.number, pre: pre.claimed, can: can.requirements, lg, openOlder, openNewer, c, requisitions: can.requisitions }));
    }

    // ── Lacuna 6 da revisão: a cotação recusa a linha toda liberada (contrato, passo 2.4) ──
    {
      const s = await scene('L6', { items: 2 });
      const [ix, iy] = s.items;
      const r1 = await need(s, 100, ix);
      const r2 = await need(s, 50, iy);
      const rca = await requisition([r1, r2]);
      const [lx, ly] = [rca.lineOf[ix], rca.lineOf[iy]];
      const po = await order(s, [lx]);
      await transition(r1, 'CANCELLED', 'Escopo removido pelo cliente');
      const can = await cancel(po.poId);
      check('(lacuna 6) R1 CANCELADO e o pedido de X cancelado: X toda liberada (0 aberto), Y com 50, RC-A AGUARDANDO',
        await lineOpen(lx) === '0' && await lineOpen(ly) === '50' && can.requisitions?.[0]?.status_to === 'SUBMITTED'
        && (await rq(rca.id)).status === 'SUBMITTED', J(can.requisitions));
      await refuse('(lacuna 6) cotar a linha X toda liberada: 23514 com a mensagem exata do contrato', 'SELECT public.procurement_rfq_create($1,$2,$3)',
        [org, actor, J({ requisition_line_ids: [lx], supplier_ids: [po.supplierId] })], '23514',
        /^Requisition line is fully released: nothing left to source\.$/);
      const again = await attempt('(lacuna 6) a linha Y (50 abertos) segue cotável', () => order(s, [ly], { until: 'QUOTED', supplierId: po.supplierId }));
      const rfqLine = again ? await one(`SELECT quantity::text q FROM public.procurement_rfq_lines WHERE rfq_id = $1`, [again.rfqId]) : null;
      check('(lacuna 6) a linha Y vai à cotação com os 50 abertos', dec(rfqLine?.q) === '50', J(rfqLine));
    }

    // ── A demo de Tucuruí não foi tocada ─────────────────────────────────────
    const demo = await one(`SELECT (SELECT status FROM public.procurement_rfqs WHERE organization_id = $1 AND rfq_number = $2) rfq,
        (SELECT status FROM public.purchase_orders WHERE organization_id = $1 AND order_number = $3) po,
        (SELECT count(*)::int FROM public.procurement_requisition_releases z JOIN public.purchase_orders p ON p.id = z.purchase_order_id
          WHERE p.order_number = $3) releases`, [org, TUCURUI_RFQ, TUCURUI_PO]);
    check('Tucuruí intacta: cotação da demo ABERTA, pedido da demo EMITIDO, nada no livro', (demo.rfq === 'OPEN' || demo.rfq === null)
      && (demo.po === 'ISSUED' || demo.po === null) && demo.releases === 0, J(demo));
  },
});
