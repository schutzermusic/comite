/**
 * 248 — Compras: quantidades coerentes (pedido parcial, cancelamento, reabertura).
 *
 *   node scripts/operations/apply-248.mjs --target=qa [--apply]
 *   node scripts/operations/apply-248.mjs [--apply]
 *
 * Regra e contrato: docs/operations-supply/COVERAGE-SEMANTICS.md (seção 248). Aqui, sempre desfeito:
 * os casos do contrato congelado pela cadeia governada de fixtures.mjs (proposta parcial, segundo
 * aprovador, alçada declarada), as repetições, o livro, os eventos, a ordem das travas conferida no
 * fonte, as 20 colunas da visão e a neutralidade da regra sobre os pedidos canceláveis do QA. Toda
 * quantidade é comparada como DECIMAL do banco (texto), nunca por float. As corridas (cancelamento ∥
 * requisição da falta ∥ reserva sob sobreposição forçada; emissão ∥ cancelamento) ficam no E2E.
 *
 * Estados LEGADOS (anteriores à 248: requisição cancelada no meio de uma decisão, pedido emitido sem
 * a conferência da requisição, cancelamento que não gravava desfecho) são montados por escrita direta,
 * dentro do SAVEPOINT das provas — como a sobre-cobertura legada da apply-246.
 */
import { runMigration } from './lib/proof-kit.mjs';
import { confirmedMaterial, proofItem, proofProject, purchaseOrderFromLines } from './lib/fixtures.mjs';

const CHANGED = [
  'procurement_requested_open(uuid,uuid)', 'procurement_rfq_create(uuid,uuid,jsonb)', 'procurement_decide(uuid,uuid,jsonb)',
  'purchase_order_issue(uuid,uuid,uuid)', 'purchase_order_cancel(uuid,uuid,uuid,text)', 'purchase_requisition_cancel(uuid,uuid,uuid,text)',
];

// As 20 colunas da visão de cobertura (nome, tipo, ordem): a 248 só muda o que `requested_qty` soma.
const COVERAGE_COLUMNS = [
  ['organization_id', 'uuid'], ['requirement_id', 'uuid'], ['project_id', 'text'], ['activity_id', 'uuid'], ['item_id', 'uuid'],
  ['requirement_type', 'text'], ['required_by', 'date'], ['unit', 'text'], ['required_qty', 'numeric(18,4)'],
  ['reserved_qty', 'numeric'], ['consumed_qty', 'numeric'], ['in_transit_qty', 'numeric'], ['on_order_qty', 'numeric'],
  ['requested_qty', 'numeric'], ['covered_qty', 'numeric'], ['inbound_qty', 'numeric'], ['shortage_qty', 'numeric'],
  ['inspection_qty', 'numeric'], ['pending_transfer_qty', 'numeric(18,4)'], ['purchasable_qty', 'numeric(18,4)'],
];
// O aberto por alocação: numéricos BRUTOS (sem escala).
const OPEN_COLUMNS = [
  ['organization_id', 'uuid'], ['allocation_id', 'uuid'], ['requisition_id', 'uuid'], ['requisition_line_id', 'uuid'],
  ['requirement_id', 'uuid'], ['allocated_qty', 'numeric'], ['released_qty', 'numeric'], ['open_qty', 'numeric'],
];
const LEDGER_COLUMNS = ['id', 'organization_id', 'requisition_id', 'requisition_line_id', 'allocation_id', 'requirement_id',
  'purchase_order_id', 'stage', 'quantity', 'cause', 'reason', 'created_at'];
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

let before = null;

await runMigration({
  version: '248',
  expectedTip: '247',
  // Antes da migration (mesma transação): o comentário e as colunas da visão de cobertura, para provar que ficam.
  async preflight(db) {
    const q = async (sql) => (await db.query(sql)).rows;
    before = {
      comment: (await q(`SELECT obj_description('public.supply_requirement_coverage'::regclass, 'pg_class') c`))[0].c,
      columns: (await q(`SELECT a.attname n, format_type(a.atttypid, a.atttypmod) t FROM pg_attribute a
        WHERE a.attrelid = 'public.supply_requirement_coverage'::regclass AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`)).map((c) => [c.n, c.t]),
    };
  },
  async proofs(ctx) {
    const { db, one, all, check, browserCannotExecute, tablesAreGoverned, anchors } = ctx;
    const { org, actor } = anchors;
    const stamp = Date.now().toString(36).toUpperCase();
    const J = (x) => JSON.stringify(x);
    const act = async (fn, ...args) => (await one(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) r`, args)).r;
    /** A resposta da função com os números EXATOS (texto canônico). */
    const call = async (fn, ...args) => exact((await one(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')})::text t`, args)).t);
    let seq = 0;
    /** Recusa com o SQLSTATE e a mensagem esperados (isolada em SAVEPOINT). */
    const refuse = async (label, sql, params, sqlstate, pattern) => {
      const sp = `sp248_${++seq}`;
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
      const sp = `sp248_${++seq}`;
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

    // ── Governança: só o servidor executa; livro governado; visões ───────────
    await browserCannotExecute(CHANGED);
    for (const fn of CHANGED) {
      const g = await one(`SELECT p.prosecdef d, p.proconfig cfg, p.proowner::regrole::text owner,
          (SELECT array_agg(x ORDER BY x) FROM (SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END x
             FROM aclexplode(p.proacl) a WHERE a.privilege_type = 'EXECUTE') e) grantees
        FROM pg_proc p WHERE p.oid = $1::regprocedure`, [`public.${fn}`]);
      check(`${fn.split('(')[0]}: EXECUTE só do service_role (além do dono); DEFINER com search_path fixo`,
        J((g.grantees ?? []).filter((x) => x !== g.owner)) === J(['service_role']) && g.d
        && (g.cfg ?? []).some((c) => c.startsWith('search_path=')), J(g));
    }
    await tablesAreGoverned(['procurement_requisition_releases']);
    const led = await one(`SELECT
        (SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
          WHERE t.tgrelid = 'public.procurement_requisition_releases'::regclass AND NOT t.tgisinternal) trg,
        (SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'public.procurement_requisition_releases'::regclass AND contype = 'f'
          AND pg_get_constraintdef(oid) ~ '^FOREIGN KEY \\(organization_id, ') tenant_fks,
        (SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'public.procurement_requisition_releases'::regclass AND contype = 'u'
          AND pg_get_constraintdef(oid) = 'UNIQUE (organization_id, purchase_order_id, allocation_id, stage)') once,
        (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
          WHERE attrelid = 'public.procurement_requisition_releases'::regclass AND attname = 'quantity') qty_type,
        (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute
          WHERE attrelid = 'public.procurement_requisition_releases'::regclass AND attnum > 0 AND NOT attisdropped) cols`);
    check('livro de liberações: append-only, 5 FKs de inquilino, uma linha por (pedido, alocação, estágio), quantidade numeric SEM escala, sem coluna de ator',
      J(led.trg) === J(['contracts_reject_history_erasure', 'operations_reject_history_rewrite']) && led.tenant_fks === 5 && led.once === 1
      && led.qty_type === 'numeric' && J(led.cols) === J(LEDGER_COLUMNS), J(led));
    const pol = await all(`SELECT tablename, cmd, roles::text roles, qual FROM pg_policies WHERE schemaname = 'public'
        AND tablename IN ('procurement_requisition_releases', 'purchase_requisition_line_requirements') ORDER BY tablename, policyname`);
    const allocPol = pol.find((p) => p.tablename === 'purchase_requisition_line_requirements');
    const relPol = pol.filter((p) => p.tablename === 'procurement_requisition_releases');
    check('livro: uma política de LEITURA para authenticated com EXATAMENTE o predicado das alocações (a visão de cobertura lê os dois com os mesmos olhos)',
      relPol.length === 1 && relPol[0].cmd === 'SELECT' && relPol[0].roles === '{authenticated}' && Boolean(allocPol)
      && relPol[0].qual === allocPol.qual, J(relPol));
    const columnsOf = async (rel) => (await all(`SELECT a.attname n, format_type(a.atttypid, a.atttypmod) t FROM pg_attribute a
      WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`, [rel])).map((c) => [c.n, c.t]);
    const viewInfo = (rel) => one(`SELECT c.reloptions opts, has_table_privilege('authenticated', c.oid, 'SELECT') rs,
        has_table_privilege('authenticated', c.oid, 'INSERT') ri, has_table_privilege('authenticated', c.oid, 'UPDATE') ru,
        has_table_privilege('anon', c.oid, 'SELECT') an, obj_description(c.oid, 'pg_class') comment
      FROM pg_class c WHERE c.oid = $1::regclass`, [rel]);
    const covView = await viewInfo('public.supply_requirement_coverage');
    const covCols = await columnsOf('public.supply_requirement_coverage');
    check('visão de cobertura: as 20 colunas intactas (nome, tipo, ordem), security_invoker, só leitura do navegador e o comentário de antes',
      J(covCols) === J(COVERAGE_COLUMNS) && J(covCols) === J(before?.columns) && (covView.opts ?? []).includes('security_invoker=true')
      && covView.rs && !covView.ri && !covView.ru && !covView.an && Boolean(before?.comment) && covView.comment === before.comment,
      J({ columns: covCols.length, opts: covView.opts, sameComment: covView.comment === before?.comment }));
    const openView = await viewInfo('public.purchase_requisition_open_allocations');
    check('visão do aberto: as colunas do contrato com numéricos brutos, security_invoker, o navegador só lê, anônimo não lê',
      J(await columnsOf('public.purchase_requisition_open_allocations')) === J(OPEN_COLUMNS)
      && (openView.opts ?? []).includes('security_invoker=true') && openView.rs && !openView.ri && !openView.ru && !openView.an, J(openView));

    // ── Ordem das travas, conferida no fonte (a corrida em si fica no E2E) ───
    const src = async (fn) => code((await one(`SELECT prosrc FROM pg_proc WHERE oid = $1::regprocedure`, [`public.${fn}`])).prosrc);
    const sCancel = await src('purchase_order_cancel(uuid,uuid,uuid,text)');
    const lc = {
      po: at(sCancel, /FROM public\.purchase_orders WHERE organization_id = p_organization_id AND id = p_po_id FOR UPDATE;/),
      approval: at(sCancel, /FROM public\.approval_requests\s+WHERE[^;]*FOR UPDATE;/),
      requirements: at(sCancel, /PERFORM 1 FROM public\.project_requirements\b[^;]*\bORDER BY id FOR NO KEY UPDATE;/),
      requisitions: at(sCancel, /PERFORM 1 FROM public\.purchase_requisitions\b[^;]*\bORDER BY id FOR UPDATE;/),
      rule: at(sCancel, /supply_requirement_claimed\(/),
      flip: at(sCancel, /UPDATE public\.purchase_orders SET status = 'CANCELLED'/),
      rfq: at(sCancel, /UPDATE public\.procurement_rfqs /),
    };
    check('cancelamento: PO → aprovação → requisitos (FOR NO KEY UPDATE, uuid) → requisições (FOR UPDATE, uuid) → cotação; a regra conta ANTES de o pedido mudar de estado',
      lc.po >= 0 && lc.po < lc.approval && lc.approval < lc.requirements && lc.requirements < lc.requisitions
      && lc.requisitions < lc.rule && lc.rule < lc.flip && lc.flip < lc.rfq, J(lc));
    check('cancelamento: requisitos travados SÓ com FOR NO KEY UPDATE (as travas de chave de decisão/emissão não esperam)',
      (sCancel.match(/FOR NO KEY UPDATE/g) ?? []).length === 1
      && !/project_requirements\b[^;]*\bFOR UPDATE\b/.test(sCancel.replace(/FOR NO KEY UPDATE/g, '')));
    const sIssue = await src('purchase_order_issue(uuid,uuid,uuid)');
    const li = {
      po: at(sIssue, /FROM public\.purchase_orders WHERE organization_id = p_organization_id AND id = p_po_id FOR UPDATE;/),
      requisitions: at(sIssue, /PERFORM 1 FROM public\.purchase_requisitions r\b[^;]*\bORDER BY r\.id FOR UPDATE;/),
      releases: at(sIssue, /INSERT INTO public\.procurement_requisition_releases/),
      ordered: at(sIssue, /UPDATE public\.purchase_requisitions r SET status = 'ORDERED'/),
    };
    const orderedStmt = li.ordered >= 0 ? sIssue.slice(li.ordered, sIssue.indexOf(';', li.ordered)) : '';
    check('emissão: PO → requisições (FOR UPDATE, uuid) numa instrução própria; liberação e PEDIDA em instruções POSTERIORES (retrato novo), sem trava própria',
      li.po >= 0 && li.po < li.requisitions && li.requisitions < li.releases && li.releases < li.ordered
      && orderedStmt.length > 0 && !/FOR UPDATE/.test(orderedStmt) && /open_qty/.test(orderedStmt), J(li));
    const sDecide = await src('procurement_decide(uuid,uuid,jsonb)');
    const ld = {
      requisitions: at(sDecide, /PERFORM 1 FROM public\.purchase_requisitions r\b[^;]*\bORDER BY r\.id FOR UPDATE;/),
      rfq: at(sDecide, /FROM public\.procurement_rfqs WHERE[^;]*FOR UPDATE;/),
      loop: at(sDecide, /FROM public\.purchase_requisition_open_allocations o[^;]*o\.open_qty > 0\s+ORDER BY pr\.required_by NULLS LAST, o\.allocation_id LOOP/),
    };
    check('decisão: requisições (FOR UPDATE, uuid) ANTES da cotação (FOR UPDATE); o laço de alocação só vê aberto > 0 (data, depois uuid)',
      ld.requisitions >= 0 && ld.requisitions < ld.rfq && ld.rfq < ld.loop && /least\(v_left, alloc\.open_qty\)/.test(sDecide), J(ld));
    const sRfq = await src('procurement_rfq_create(uuid,uuid,jsonb)');
    const lr = {
      requisitions: at(sRfq, /PERFORM 1 FROM public\.purchase_requisitions r\b[^;]*\bORDER BY r\.id FOR UPDATE;/),
      line: at(sRfq, /SELECT \* INTO l FROM public\.purchase_requisition_lines/),
      open: at(sRfq, /FROM public\.purchase_requisition_open_allocations o/),
    };
    check('cotação: requisições (FOR UPDATE, uuid) ANTES de ler linha, aberto e data; nenhuma outra trava de requisição no laço',
      lr.requisitions >= 0 && lr.requisitions < lr.line && lr.line < lr.open && (sRfq.match(/FOR UPDATE/g) ?? []).length === 1, J(lr));
    const sRc = await src('purchase_requisition_cancel(uuid,uuid,uuid,text)');
    const lq = { requisition: at(sRc, /FROM public\.purchase_requisitions WHERE[^;]*FOR UPDATE;/), rfq: at(sRc, /UPDATE public\.procurement_rfqs /) };
    check('cancelamento de requisição: requisição → cotação', lq.requisition >= 0 && lq.requisition < lq.rfq, J(lq));
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
    check('requisição da falta, pedido de transferência e reserva: requisitos FOR UPDATE (uuid) antes das próprias travas e escritas (inalterados)',
      lw.shortageLoop >= 0 && lw.shortageLoop < lw.shortageInsert && lw.transferLoop >= 0 && lw.transferLoop < lw.transferInsert
      && lw.reserveLock >= 0 && lw.reserveLock < lw.reserveStock, J(lw));
    const sOpen = await src('procurement_requested_open(uuid,uuid)');
    const vDef = (await one(`SELECT pg_get_viewdef('public.supply_requirement_coverage'::regclass) d`)).d;
    check('requisitado (função e visão) soma o aberto da alocação, com o predicado de sempre para a linha',
      /FROM public\.purchase_requisition_open_allocations a/.test(sOpen) && /sum\(a\.open_qty\)/.test(sOpen)
      && /requested AS \(\s*SELECT a\.organization_id,\s*a\.requirement_id,\s*sum\(a\.open_qty\) AS requested\s+FROM \(?purchase_requisition_open_allocations a\b/.test(vDef));

    // ── Neutralidade: a regra nova sobre CADA pedido cancelável do QA (menos a demo de Tucuruí), desfeita ──
    const cancellable = await all(`SELECT po.id, po.order_number FROM public.purchase_orders po
      WHERE po.organization_id = $1 AND po.status IN ('DRAFT','APPROVAL_REQUIRED','APPROVED','ISSUED') AND po.order_number <> $2
        AND NOT EXISTS (SELECT 1 FROM public.purchase_order_lines l WHERE l.purchase_order_id = po.id AND l.received_quantity > 0)
      ORDER BY po.order_number`, [org, TUCURUI_PO]);
    // São = requisito ativo com reclamado ≤ requerido. Legado já sobre-coberto (os qa-flx-* anteriores à 246) pode
    // DESCER até o requerido — o invariante do legado é "nunca acima do que era"; subir, nunca.
    const tally = { pos: 0, increases: [], healthyReleases: [], healthyChanges: [], legacy: [], failures: [] };
    for (const p of cancellable) {
      await db.query('SAVEPOINT n248');
      try {
        const pre = await all(`WITH s AS (
            SELECT a.requirement_id FROM public.purchase_order_lines pl
              JOIN public.purchase_requisition_line_requirements a ON a.organization_id = pl.organization_id AND a.line_id = pl.requisition_line_id
             WHERE pl.organization_id = $1 AND pl.purchase_order_id = $2
            UNION
            SELECT a.requirement_id FROM public.purchase_order_lines pl
              JOIN public.purchase_order_line_requirements a ON a.organization_id = pl.organization_id AND a.line_id = pl.id
             WHERE pl.organization_id = $1 AND pl.purchase_order_id = $2)
          SELECT r.id, public.supply_requirement_claimed($1, r.id)::text claimed,
                 COALESCE(r.status = 'CONFIRMED' AND r.requirement_type IN ('MATERIAL','EXTERNAL_SERVICE')
                   AND public.supply_requirement_claimed($1, r.id) <= r.quantity, false) healthy
            FROM public.project_requirements r WHERE r.organization_id = $1 AND r.id IN (SELECT requirement_id FROM s)`, [org, p.id]);
        await one('SELECT public.purchase_order_cancel($1,$2,$3,$4) r', [org, actor, p.id, 'Prova 248: neutralidade sobre o QA']);
        const post = await all(`SELECT x.id, x.healthy, x.claimed, public.supply_requirement_claimed($1, x.id)::text after,
            public.supply_requirement_claimed($1, x.id) > x.claimed::numeric up,
            public.supply_requirement_claimed($1, x.id) <> x.claimed::numeric changed,
            (SELECT count(*)::int FROM public.procurement_requisition_releases z
              WHERE z.organization_id = $1 AND z.purchase_order_id = $2 AND z.requirement_id = x.id) releases
          FROM jsonb_to_recordset($3::jsonb) AS x(id uuid, claimed text, healthy boolean)`, [org, p.id, J(pre)]);
        tally.pos += 1;
        for (const x of post) {
          if (x.up) tally.increases.push(`${p.order_number}/${x.id}`);
          if (x.healthy && x.releases > 0) tally.healthyReleases.push(`${p.order_number}/${x.id}`);
          if (x.healthy && x.changed) tally.healthyChanges.push(`${p.order_number}/${x.id}`);
          if (!x.healthy && x.changed) tally.legacy.push(`${p.order_number}: ${dec(x.claimed)} → ${dec(x.after)}`);
        }
      } catch (error) {
        tally.failures.push(`${p.order_number}: ${error.message.slice(0, 100)}`);
      }
      await db.query('ROLLBACK TO SAVEPOINT n248');
      await db.query('RELEASE SAVEPOINT n248');
    }
    check(`neutralidade: a regra nova sobre os ${tally.pos} pedidos canceláveis do QA (cada um desfeito) — nenhum reclamado sobe; requisito são sem liberação e sem mudança`,
      cancellable.length > 0 && tally.pos === cancellable.length && tally.failures.length === 0 && tally.increases.length === 0
      && tally.healthyReleases.length === 0 && tally.healthyChanges.length === 0,
      J({ pos: tally.pos, legacyDown: tally.legacy, increases: tally.increases.slice(0, 5), healthyReleases: tally.healthyReleases.slice(0, 5),
        healthyChanges: tally.healthyChanges.slice(0, 5), failures: tally.failures.slice(0, 3) }));

    // ── Cenários (cada um com item, projeto e canteiro próprios) ─────────────
    let n = 0;
    const scene = async (label, { items = 1, siteStock = 0, depotStock = 0 } = {}) => {
      const k = `${label}${++n}`;
      const project = await proofProject(ctx, anchors, `P248-${k}-${stamp}`);
      const list = [];
      for (let i = 0; i < items; i += 1) list.push(await proofItem(ctx, anchors, `I248-${k}${'XYZ'[i]}-${stamp}`, 'm'));
      const loc = async (prefix, kind, extra = {}) => (await act('inventory_location_upsert', org, actor,
        J({ code: `${prefix}-${k}-${stamp}`, name: `${prefix} ${k}`, kind, ...extra }))).location_id;
      const site = await loc('S248', 'PROJECT_SITE', { project_id: project });
      const depot = depotStock ? await loc('D248', 'WAREHOUSE') : null;
      for (const item of list) {
        if (siteStock) await act('inventory_adjust', org, actor, J({ item_id: item, location_id: site, quantity: siteStock, reason: 'Prova 248' }));
        if (depotStock) await act('inventory_adjust', org, actor, J({ item_id: item, location_id: depot, quantity: depotStock, reason: 'Prova 248' }));
      }
      return { k, project, item: list[0], items: list, site, depot };
    };
    const need = (s, quantity, requiredBy, item = s.item, project = s.project) => confirmedMaterial(ctx, anchors, project, item, quantity, requiredBy);
    /** Requisição da falta (governada): id, número, requisitado exato e a linha de cada item. */
    const requisition = async (requirementIds, extra = {}) => {
      const out = await call('purchase_requisition_from_shortage', org, actor, J({ requirement_ids: requirementIds, ...extra }));
      const lines = await all(`SELECT id, item_id FROM public.purchase_requisition_lines WHERE requisition_id = $1 ORDER BY created_at, id`,
        [out.requisition_id]);
      return { id: out.requisition_id, number: out.requisition_number, qty: out.requisitioned_qty, out,
        lines: lines.map((l) => l.id), lineOf: Object.fromEntries(lines.map((l) => [l.item_id, l.id])) };
    };
    const order = (s, lineIds, opts = {}) => purchaseOrderFromLines(ctx, anchors, { tag: `248${s.k}${stamp}`, lineIds, deliveryLocationId: s.site, ...opts });
    /** Retrato exato de um requisito: reclamado, requerido, requisitado (função e visão), em pedido e comprável bruto. */
    const st = async (req) => {
      const row = await one(`SELECT public.supply_requirement_claimed($1,$2)::text claimed, pr.quantity::text required,
          public.procurement_requested_open($1,$2)::text requested, c.requested_qty::text view_requested,
          public.procurement_on_order($1,$2)::text on_order,
          GREATEST(c.shortage_qty - c.requested_qty - COALESCE((SELECT sum(l.quantity) FROM public.inventory_transfer_lines l
            JOIN public.inventory_transfers t ON t.organization_id = l.organization_id AND t.id = l.transfer_id
           WHERE l.organization_id = $1 AND l.requirement_id = $2 AND t.status IN ('REQUESTED','APPROVED')
             AND l.source_reservation_id IS NULL), 0), 0)::text purchasable,
          public.supply_requirement_claimed($1,$2) <= COALESCE(pr.quantity, 0) AS within
        FROM public.project_requirements pr
        LEFT JOIN public.supply_requirement_coverage c ON c.organization_id = pr.organization_id AND c.requirement_id = pr.id
       WHERE pr.organization_id = $1 AND pr.id = $2`, [org, req]);
      return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'boolean' ? v : dec(v)]));
    };
    const ledger = async (po) => (await all(`SELECT requisition_id, requisition_line_id, allocation_id, requirement_id, stage, cause,
        quantity::text q, reason FROM public.procurement_requisition_releases WHERE organization_id = $1 AND purchase_order_id = $2
       ORDER BY stage, requirement_id, allocation_id`, [org, po])).map((x) => ({ ...x, q: dec(x.q) }));
    const rq = (id) => one(`SELECT status, closed_at IS NOT NULL closed, close_reason, project_id FROM public.purchase_requisitions WHERE id = $1`, [id]);
    const rfqRow = (id) => one(`SELECT status, close_reason FROM public.procurement_rfqs WHERE id = $1`, [id]);
    const rfqLine = async (rfqId) => {
      const x = await one(`SELECT quantity::text q, required_by::text by FROM public.procurement_rfq_lines WHERE rfq_id = $1`, [rfqId]);
      return { q: dec(x.q), by: x.by };
    };
    const lineOpen = async (lineId) => dec((await one(`SELECT COALESCE(sum(open_qty), 0)::text q
      FROM public.purchase_requisition_open_allocations WHERE organization_id = $1 AND requisition_line_id = $2`, [org, lineId])).q);
    const polr = async (po) => (await all(`SELECT a.requirement_id, a.quantity::text q FROM public.purchase_order_line_requirements a
        JOIN public.purchase_order_lines l ON l.id = a.line_id WHERE l.purchase_order_id = $1 ORDER BY a.requirement_id`, [po]))
      .map((x) => ({ requirement_id: x.requirement_id, q: dec(x.q) }));
    const outOf = (res, req) => (res?.requirements ?? []).find((x) => x.requirement_id === req);
    const releasedOf = (res, req) => (res?.released ?? []).find((x) => x.requirement_id === req);
    const events = (aggregate) => all(`SELECT idempotency_key k, payload::text p FROM public.domain_events
        WHERE organization_id = $1 AND event_type = 'supply.requisition.released' AND aggregate_id = $2 ORDER BY idempotency_key`, [org, aggregate])
      .then((rows) => rows.map((e) => ({ k: e.k, p: exact(e.p) })));
    const transfer = async (s, req, quantity) => (await act('inventory_transfer_request', org, actor, J({ from_location_id: s.depot,
      to_location_id: s.site, lines: [{ item_id: s.item, quantity, requirement_id: req }] }))).transfer_id;
    const reserve = (s, req, quantity) => act('inventory_reserve', org, actor, J({ requirement_id: req, location_id: s.site, quantity }));
    const edit = (req, payload) => act('project_requirement_upsert', org, actor, J({ id: req, reason: 'Prova 248', ...payload }));
    const transition = (req, to, reason = null) => act('project_requirement_transition', org, actor, req, to, reason, null);

    // ── a + g. O caso do revisor: 100 requeridos, pedido de 60, RC-B dos 40, cancelamento, nova cotação ──
    {
      const s = await scene('A');
      const r = await need(s, 100);
      const rca = await requisition([r]);
      const po = await order(s, rca.lines, { quantities: { [s.item]: 60 }, until: 'APPROVED' });
      const iss = await issue(po.poId);
      const rel = releasedOf(iss, r);
      check('(a) emissão de 60 contra 100: a resposta traz, por requisito com item e unidade, os 40 não pedidos',
        iss.status === 'ISSUED' && iss.replayed === false && iss.released.length === 1 && rel?.released_qty === '40'
        && rel.item_id === s.item && rel.unit === 'm', J(iss));
      const lg = await ledger(po.poId);
      check('(a) livro: uma linha PO_ISSUED/NOT_ORDERED de 40 na alocação da RC-A, com o número do pedido no motivo',
        lg.length === 1 && lg[0].stage === 'PO_ISSUED' && lg[0].cause === 'NOT_ORDERED' && lg[0].q === '40'
        && lg[0].requisition_id === rca.id && lg[0].reason.includes(po.orderNumber), J(lg));
      let c = await st(r);
      check('(a) depois da emissão: em pedido 60, requisitado 0, comprável 40, reclamado 60 — a liberação não mexe no reclamado; RC-A PEDIDA',
        c.on_order === '60' && c.requested === '0' && c.purchasable === '40' && c.claimed === '60' && (await rq(rca.id)).status === 'ORDERED', J(c));
      const ev = await events(rca.id);
      check('(a) evento supply.requisition.released da emissão: chave por pedido, estágio e projeto; payload com o requisito',
        ev.length === 1 && ev[0].k === `requisition:${rca.id}:released:${po.poId}:PO_ISSUED:${s.project}` && ev[0].p.project_id === s.project
        && ev[0].p.stage === 'PO_ISSUED' && ev[0].p.status_to === 'ORDERED' && ev[0].p.order_number === po.orderNumber
        && ev[0].p.requisition_number === rca.number && ev[0].p.requirements?.[0]?.released_qty === '40', J(ev));
      const again = await issue(po.poId);
      check('(a) repetição da emissão: a resposta de sempre (sem refazer liberação)',
        J(Object.keys(again).sort()) === J(['purchase_order_id', 'replayed', 'status']) && again.replayed === true
        && again.status === 'ISSUED' && (await ledger(po.poId)).length === 1, J(again));
      const rcb = await requisition([r]);
      c = await st(r);
      check('(a) a RC-B requisita os 40 compráveis: reclamado 100', rcb.qty === '40' && c.claimed === '100', J({ rcb: rcb.qty, c }));
      const can = await cancel(po.poId);
      c = await st(r);
      const o = outOf(can, r);
      check('(a) cancelamento: reabre só os 60 que o pedido tinha — reclamado 100 = requerido (antes: 140)',
        c.claimed === '100' && c.requested === '100' && c.view_requested === '100' && c.on_order === '0' && c.within, J(c));
      check('(a) resposta do cancelamento: por requisito (item, unidade) reaberto 60 e liberado 0; RC-A PEDIDA → AGUARDANDO; sem aprovação',
        can.status === 'CANCELLED' && can.replayed === false && can.approval_request_status === null && can.requirements.length === 1
        && o?.reopened_qty === '60' && o.released_qty === '0' && o.cause === null && o.item_id === s.item && o.unit === 'm'
        && can.requisitions.length === 1 && can.requisitions[0].requisition_id === rca.id && can.requisitions[0].requisition_number === rca.number
        && can.requisitions[0].status_from === 'ORDERED' && can.requisitions[0].status_to === 'SUBMITTED', J(can));
      check('(a) o aberto da RC-A ficou 60; nada liberado no cancelamento; a cotação do pedido foi cancelada',
        await lineOpen(rca.lines[0]) === '60' && (await ledger(po.poId)).length === 1 && (await rfqRow(po.rfqId)).status === 'CANCELLED');
      const rep = await cancel(po.poId);
      check('(a) repetição do cancelamento devolve o desfecho GRAVADO (o mesmo do ato), marcada replayed',
        rep.replayed === true && J({ ...rep, replayed: false }) === J({ ...can }), J(rep));
      await refuse('(a) o livro não se reescreve', 'UPDATE public.procurement_requisition_releases SET quantity = quantity + 1 WHERE purchase_order_id = $1',
        [po.poId], '42501', /não se reescreve/);
      // g: a nova cotação da RC-A pede o aberto (60), e o total pedido fecha em 100.
      const po2 = await order(s, rca.lines, { until: 'ISSUED' });
      const line2 = po2 ? await rfqLine(po2.rfqId) : {};
      const po3 = await order(s, rcb.lines, { until: 'ISSUED' });
      c = await st(r);
      check('(g) nova cotação da RC-A sai com 60 (antes: 100); pedidos de 60 e 40 emitidos: em pedido 100, reclamado 100',
        line2.q === '60' && (await ledger(po2.poId)).length === 0 && Boolean(po3.poId) && c.on_order === '100' && c.claimed === '100'
        && c.requested === '0', J({ line2, c }));
    }

    // ── b. Sem RC-B: reabre 60 e os 40 continuam compráveis ──────────────────
    {
      const s = await scene('B');
      const r = await need(s, 100);
      const rca = await requisition([r]);
      const po = await order(s, rca.lines, { quantities: { [s.item]: 60 } });
      const can = await cancel(po.poId);
      const c = await st(r);
      check('(b) emissão libera 40; cancelamento reabre 60: requisitado 60, comprável 40, reclamado 60',
        (await ledger(po.poId)).map((x) => x.q).join() === '40' && outOf(can, r)?.reopened_qty === '60' && c.requested === '60'
        && c.purchasable === '40' && c.claimed === '60', J({ can: can.requirements, c }));
    }

    // ── c. Pedido cheio: o contrato da apply-234 (a requisição volta a AGUARDANDO com tudo) ──
    {
      const s = await scene('C');
      const r = await need(s, 100);
      const rca = await requisition([r]);
      const po = await order(s, rca.lines, { until: 'APPROVED' });
      const iss = await issue(po.poId);
      const can = await cancel(po.poId);
      const c = await st(r);
      check('(c) pedido cheio: a emissão não libera nada; o cancelamento reabre 100 — requisitado 100, em pedido 0, RC AGUARDANDO (apply-234)',
        J(iss.released) === '[]' && (await ledger(po.poId)).length === 0 && outOf(can, r)?.reopened_qty === '100'
        && outOf(can, r)?.released_qty === '0' && c.requested === '100' && c.on_order === '0' && c.claimed === '100'
        && (await rq(rca.id)).status === 'SUBMITTED', J({ can, c }));
    }

    // ── d1–d4. Cancelamento antes da emissão: nada muda no reclamado ─────────
    for (const [label, until, qty] of [['d1', 'DRAFT', 60], ['d2', 'APPROVAL_REQUIRED', 60], ['d3', 'APPROVED', 60], ['d4', 'APPROVED', null]]) {
      const s = await scene(label.toUpperCase());
      const r = await need(s, 100);
      const rca = await requisition([r]);
      const po = await order(s, rca.lines, { until, quantities: qty ? { [s.item]: qty } : {} });
      const pre = await st(r);
      const can = await cancel(po.poId);
      const c = await st(r);
      const o = outOf(can, r);
      const again = await attempt(`(${label}) nova cotação depois do cancelamento`, () => order(s, rca.lines, { until: 'QUOTED' }));
      const line = again ? await rfqLine(again.rfqId) : {};
      check(`(${label}) pedido ${until}${qty ? ` de ${qty}` : ' cheio'} cancelado: reclamado 100 → 100, nada liberado, reaberto 0 (já contava), RC EM COTAÇÃO → AGUARDANDO, nova cotação de 100`,
        pre.claimed === '100' && c.claimed === '100' && (await ledger(po.poId)).length === 0 && o?.reopened_qty === '0' && o.released_qty === '0'
        && can.requisitions[0]?.status_from === 'SOURCING' && can.requisitions[0]?.status_to === 'SUBMITTED'
        && (await rfqRow(po.rfqId)).status === 'CANCELLED' && line.q === '100', J({ pre: pre.claimed, c: c.claimed, o, line }));
    }

    // ── d5. Requisito inativo (replanejado / cancelado) com pedido não emitido: libera tudo, ENCERRADA ──
    for (const [label, to, until] of [['d5-planned', 'PLANNED', 'DRAFT'], ['d5-cancelled', 'CANCELLED', 'APPROVED']]) {
      const s = await scene('D5');
      const r = await need(s, 100);
      const rca = await requisition([r]);
      const po = await order(s, rca.lines, { until });
      await transition(r, to, to === 'CANCELLED' ? 'Escopo removido pelo cliente' : null);
      const can = await cancel(po.poId);
      const lg = await ledger(po.poId);
      const q = await rq(rca.id);
      check(`(${label}) requisito ${to} com pedido ${until}: libera os 100 (REQUIREMENT_INACTIVE), reabre 0, requisição ENCERRADA com data e motivo`,
        outOf(can, r)?.released_qty === '100' && outOf(can, r)?.reopened_qty === '0' && outOf(can, r)?.cause === 'REQUIREMENT_INACTIVE'
        && lg.length === 1 && lg[0].stage === 'PO_CANCELLED' && lg[0].cause === 'REQUIREMENT_INACTIVE' && lg[0].q === '100'
        && q.status === 'CLOSED' && q.closed && q.close_reason.includes(po.orderNumber) && (await st(r)).claimed === '0'
        && can.requisitions[0]?.status_to === 'CLOSED', J({ can, lg, q }));
    }

    // ── e1 / e1b. Uma linha, dois requisitos (R1 100 até 10/11, R2 50 até 20/11); pedido de 60 todo no R1 ──
    for (const label of ['e1', 'e1b']) {
      const s = await scene(label.toUpperCase());
      const r1 = await need(s, 100, '2026-11-10');
      const r2 = await need(s, 50, '2026-11-20');
      const rca = await requisition([r1, r2]);
      const po = await order(s, rca.lines, { quantities: { [s.item]: 60 }, until: 'APPROVED' });
      const iss = await issue(po.poId);
      if (label === 'e1') {
        check('(e1) emissão de 60 numa linha de R1 100 + R2 50: libera R1 40 e R2 50 (NOT_ORDERED)',
          releasedOf(iss, r1)?.released_qty === '40' && releasedOf(iss, r2)?.released_qty === '50' && iss.released.length === 2, J(iss));
      }
      const rcb = await requisition(label === 'e1' ? [r1] : [r1, r2]);
      const can = await cancel(po.poId);
      const [c1, c2] = [await st(r1), await st(r2)];
      check(`(${label}) cancelamento: R1 reabre 60 (reclamado 100); R2 já liberado na emissão não é candidato (reclamado ${label === 'e1' ? '0, comprável 50' : '50 pela RC-B'})`,
        outOf(can, r1)?.reopened_qty === '60' && !outOf(can, r2) && c1.claimed === '100'
        && (label === 'e1' ? c2.claimed === '0' && c2.purchasable === '50' : rcb.qty === '90' && c2.claimed === '50') && c1.within && c2.within,
        J({ can: can.requirements, c1, c2 }));
    }

    // ── e2. Dois itens, duas linhas: X 60 de 100, Y 50 de 50 ─────────────────
    {
      const s = await scene('E2', { items: 2 });
      const [ix, iy] = s.items;
      const r1 = await need(s, 100, undefined, ix);
      const r2 = await need(s, 50, undefined, iy);
      const rca = await requisition([r1, r2]);
      const po = await order(s, rca.lines, { quantities: { [ix]: 60 }, until: 'APPROVED' });
      const iss = await issue(po.poId);
      await requisition([r1]);
      const can = await cancel(po.poId);
      const [c1, c2] = [await st(r1), await st(r2)];
      check('(e2) emissão libera só R1 40; cancelamento reabre R1 60 (reclamado 100) e R2 50 (reclamado 50) — por requisito, sem soma entre itens',
        iss.released.length === 1 && releasedOf(iss, r1)?.released_qty === '40' && outOf(can, r1)?.reopened_qty === '60'
        && outOf(can, r2)?.reopened_qty === '50' && outOf(can, r2)?.item_id === iy && c1.claimed === '100' && c2.claimed === '50'
        && !('reopened_qty' in can) && !('released_qty' in can), J({ can: can.requirements, c1, c2 }));
    }

    // ── f1 / f2. Requisição dividida por linha entre dois pedidos; cancela o parcial ──
    for (const label of ['f1', 'f2']) {
      const s = await scene(label.toUpperCase(), { items: 2 });
      const [ix, iy] = s.items;
      const r1 = await need(s, 100, undefined, ix);
      const r2 = await need(s, 50, undefined, iy);
      const rca = await requisition([r1, r2]);
      const [lx, ly] = [rca.lineOf[ix], rca.lineOf[iy]];
      const poa = await order(s, [lx], { quantities: { [lx]: 60 } });
      const midStatus = (await rq(rca.id)).status;
      await requisition([r1]);
      const pob = await order(s, [ly], { until: label === 'f1' ? 'ISSUED' : 'QUOTED' });
      const statusBefore = (await rq(rca.id)).status;
      const can = await cancel(poa.poId);
      const [c1, c2] = [await st(r1), await st(r2)];
      const q = await rq(rca.id);
      check(`(${label}) cancelar o pedido parcial da linha X: R1 reabre 60 (reclamado 100); R2 intacto (50 ${label === 'f1' ? 'em pedido' : 'requisitados'}); RC ${statusBefore} → EM COTAÇÃO`,
        midStatus === 'SOURCING' && statusBefore === (label === 'f1' ? 'ORDERED' : 'SOURCING') && outOf(can, r1)?.reopened_qty === '60'
        && !outOf(can, r2) && c1.claimed === '100' && c2.claimed === '50' && (label === 'f1' ? c2.on_order === '50' : c2.requested === '50')
        && q.status === 'SOURCING' && can.requisitions[0]?.status_to === 'SOURCING' && (label === 'f1' || (await rfqRow(pob.rfqId)).status === 'OPEN'),
        J({ can, c1, c2, q }));
    }

    // ── f3. A linha que a proposta vencedora não cotou pode ser cotada de novo ──
    {
      const s = await scene('F3', { items: 2 });
      const [ix, iy] = s.items;
      const r1 = await need(s, 100, undefined, ix);
      const r2 = await need(s, 50, undefined, iy);
      const rca = await requisition([r1, r2]);
      const [lx, ly] = [rca.lineOf[ix], rca.lineOf[iy]];
      const po = await order(s, [lx, ly], { quantities: { [lx]: 100 }, only: true });
      const again = await attempt('(f3) nova cotação da linha Y, não cotada pela proposta vencedora', () => order(s, [ly], { until: 'QUOTED' }));
      check('(f3) proposta só de X decidida e emitida; a linha Y (sem preço) volta à cotação com 50 — antes ficava presa ("already in a live RFQ")',
        J(po.decision.not_ordered) === '[]' && Boolean(again) && (await rfqLine(again.rfqId)).q === '50' && (await st(r2)).claimed === '50',
        J({ decision: po.decision }));
    }

    // ── h2 / h3. A folga coberta por reserva ou por transferência pedida ─────
    for (const [label, kind] of [['h2', 'reserva'], ['h3', 'transferência pedida']]) {
      const s = await scene(label.toUpperCase(), { siteStock: 500, depotStock: 500 });
      const r = await need(s, 100);
      const rca = await requisition([r]);
      const po = await order(s, rca.lines, { quantities: { [s.item]: 60 } });
      if (label === 'h2') await reserve(s, r, 40); else await transfer(s, r, 40);
      const pre = await st(r);
      const can = await cancel(po.poId);
      const c = await st(r);
      check(`(${label}) pedido de 60 + ${kind} de 40, cancelamento: reabre 60, reclamado 100 → 100 (antes: 140)`,
        pre.claimed === '100' && outOf(can, r)?.reopened_qty === '60' && outOf(can, r)?.released_qty === '0' && c.claimed === '100',
        J({ pre: pre.claimed, c }));
    }

    // ── K1 (+ B7). Requisito CANCELADO com o pedido cheio emitido ────────────
    {
      const s = await scene('K1');
      const r = await need(s, 100);
      const rca = await requisition([r]);
      const po = await order(s, rca.lines);
      await transition(r, 'CANCELLED', 'Escopo removido pelo cliente');
      const can = await cancel(po.poId);
      const lg = await ledger(po.poId);
      const q = await rq(rca.id);
      check('(K1) requisito cancelado: reabre 0, libera 100 (REQUIREMENT_INACTIVE), requisição ENCERRADA — nada é recomprado',
        outOf(can, r)?.reopened_qty === '0' && outOf(can, r)?.released_qty === '100' && outOf(can, r)?.cause === 'REQUIREMENT_INACTIVE'
        && lg.some((x) => x.stage === 'PO_CANCELLED' && x.cause === 'REQUIREMENT_INACTIVE' && x.q === '100')
        && q.status === 'CLOSED' && q.closed && q.close_reason.includes(po.orderNumber) && (await st(r)).claimed === '0', J({ can, lg, q }));
      const ev = (await events(rca.id)).filter((e) => e.p.stage === 'PO_CANCELLED');
      check('(K1) evento supply.requisition.released do cancelamento: chave por pedido, estágio e projeto; ENCERRADA; motivo do cancelamento',
        ev.length === 1 && ev[0].k === `requisition:${rca.id}:released:${po.poId}:PO_CANCELLED:${s.project}` && ev[0].p.status_to === 'CLOSED'
        && ev[0].p.purchase_order_id === po.poId && ev[0].p.reason === REASON && ev[0].p.requirements?.[0]?.cause === 'REQUIREMENT_INACTIVE'
        && ev[0].p.requirements[0].released_qty === '100', J(ev));
      await refuse('(B7) requisição ENCERRADA não se cancela (o registro do encerramento fica)', 'SELECT public.purchase_requisition_cancel($1,$2,$3,$4)',
        [org, actor, rca.id, 'Limpeza'], '23514', /^Requisition is CLOSED: nothing to cancel\.$/);
      await refuse('(K1) requisição ENCERRADA não vai à cotação (mensagem de sempre)', 'SELECT public.procurement_rfq_create($1,$2,$3)',
        [org, actor, J({ requisition_line_ids: rca.lines, supplier_ids: [po.supplierId] })], '23514', /Requisition is CLOSED: it is not sourced\./);
    }

    // ── K2. Exceção de cobertura: o cancelamento não a carrega (comprar de novo pede NOVA exceção) ──
    for (const [label, qty, dispatched] of [['K2-60', 60, false], ['K2-100', 100, false], ['K2-despachada', 60, true]]) {
      const s = await scene('K2', { depotStock: 500 });
      const r = await need(s, 100);
      const tr = await transfer(s, r, 100);
      const rca = await requisition([r], { coverage_override: OVERRIDE });
      const po = await order(s, rca.lines, { quantities: { [s.item]: qty } });
      if (dispatched) {
        await act('inventory_transfer_approve', org, actor, tr);
        await act('inventory_transfer_dispatch', org, actor, tr, '{}');
      }
      const pre = await st(r);
      const can = await cancel(po.poId);
      const c = await st(r);
      const pcx = await one(`SELECT count(*)::int k, max(requisitioned_qty)::text t FROM public.procurement_coverage_exceptions
        WHERE organization_id = $1 AND requisition_id = $2`, [org, rca.id]);
      check(`(${label}) exceção RC 100 + transferência 100${dispatched ? ' despachada' : ' pedida'}, pedido de ${qty}: reclamado ${pre.claimed} → 100 = requerido; reabre 0, libera ${qty} COVERED; o livro de exceções fica`,
        rca.out.override === true && pre.claimed === (qty === 60 ? '160' : '200') && c.claimed === '100' && outOf(can, r)?.reopened_qty === '0'
        && outOf(can, r)?.released_qty === String(qty) && outOf(can, r)?.cause === 'COVERED' && pcx.k === 1 && dec(pcx.t) === '100'
        && (await rq(rca.id)).status === 'CLOSED', J({ pre: pre.claimed, c, can: can.requirements, pcx }));
    }

    // ── j1. Requisito editado 100 → 80 com o pedido cheio emitido ────────────
    {
      const s = await scene('J1');
      const r = await need(s, 100);
      const rca = await requisition([r]);
      const po = await order(s, rca.lines);
      await edit(r, { quantity: 80 });
      const can = await cancel(po.poId);
      const c = await st(r);
      check('(j1) requisito editado para 80: reabre 80, libera 20 COVERED — reclamado 80 (não 100)',
        outOf(can, r)?.reopened_qty === '80' && outOf(can, r)?.released_qty === '20' && outOf(can, r)?.cause === 'COVERED'
        && c.claimed === '80' && await lineOpen(rca.lines[0]) === '80', J({ can: can.requirements, c }));
    }

    // ── Forma de Tucuruí, montada à parte (nunca na demo): 1200 requeridos, reclamado 1450 ──
    {
      const s = await scene('TUC', { siteStock: 300, depotStock: 5000 });
      const r = await need(s, 1200);
      await reserve(s, r, 300);
      const moving = await transfer(s, r, 400);
      await act('inventory_transfer_approve', org, actor, moving);
      await act('inventory_transfer_dispatch', org, actor, moving, '{}');
      await transfer(s, r, 250);
      const rca = await requisition([r], { coverage_override: OVERRIDE });
      const po = await order(s, rca.lines);
      const pre = await st(r);
      const can = await cancel(po.poId);
      const c = await st(r);
      check('(Tucuruí, sintético) 1200 requeridos: reservado 300 + em trânsito 400 + pendente 250 + exceção 500 → reclamado 1450; cancelar o pedido de 500 reabre 250, libera 250 — reclamado 1200',
        rca.qty === '500' && pre.claimed === '1450' && outOf(can, r)?.reopened_qty === '250' && outOf(can, r)?.released_qty === '250'
        && c.claimed === '1200', J({ pre: pre.claimed, can: can.requirements, c }));
    }

    // ── X3. O mesmo requisito em duas linhas de um pedido (RC-A reaberta + RC-B) ──
    for (const label of ['X3-parcial', 'X3-cheio']) {
      const s = await scene('X3');
      const r = await need(s, 100);
      const rca = await requisition([r]);
      const po1 = await order(s, rca.lines, { quantities: { [s.item]: 60 } });
      const rcb = await requisition([r]);
      await cancel(po1.poId);
      const partial = label === 'X3-parcial';
      const po2 = await order(s, [...rca.lines, ...rcb.lines], { quantities: partial ? { [rca.lines[0]]: 30, [rcb.lines[0]]: 40 } : {} });
      const lg2 = await ledger(po2.poId);
      let rcc = null;
      if (partial) rcc = await requisition([r]);
      const pre = await st(r);
      const can = await cancel(po2.poId);
      const c = await st(r);
      check(partial
        ? '(X3 parcial) nova cotação RC-A 60 + RC-B 40, proposta 30 + 40: emissão libera 30 da RC-A; RC-C 30; cancelar reabre 70 — reclamado 100'
        : '(X3 cheio) proposta 60 + 40: nada liberado; cancelar reabre 100 — reclamado 100',
        (partial ? lg2.length === 1 && lg2[0].q === '30' && lg2[0].requisition_id === rca.id && rcc.qty === '30' : lg2.length === 0)
        && pre.claimed === '100' && outOf(can, r)?.reopened_qty === (partial ? '70' : '100') && outOf(can, r)?.released_qty === '0'
        && c.claimed === '100' && can.requisitions.length === 2, J({ lg2, pre: pre.claimed, can: can.requirements, c }));
    }

    // ── X5. Cancelamentos sucessivos sobre a MESMA alocação ──────────────────
    {
      const s = await scene('X5');
      const r = await need(s, 100);
      const rca = await requisition([r]);
      const po1 = await order(s, rca.lines, { quantities: { [s.item]: 60 } });
      await requisition([r]);
      await cancel(po1.poId);
      const claimed1 = (await st(r)).claimed;
      const po2 = await order(s, rca.lines, { quantities: { [s.item]: 30 } });
      const line2 = await rfqLine(po2.rfqId);
      const rcc = await requisition([r]);
      const can2 = await cancel(po2.poId);
      const claimed2 = (await st(r)).claimed;
      const po3 = await order(s, rca.lines);
      const line3 = await rfqLine(po3.rfqId);
      await cancel(po3.poId);
      const claimed3 = (await st(r)).claimed;
      const rows = await all(`SELECT purchase_order_id, stage, quantity::text q FROM public.procurement_requisition_releases
        WHERE organization_id = $1 AND requisition_id = $2 ORDER BY created_at, purchase_order_id`, [org, rca.id]);
      const ev = await events(rca.id);
      check('(X5) três pedidos sobre a RC-A (60, 30, 30): cotações de 60 e depois 30; reclamado 100 depois de cada cancelamento; livro com uma linha por pedido',
        line2.q === '60' && rcc.qty === '30' && outOf(can2, r)?.reopened_qty === '30' && line3.q === '30'
        && [claimed1, claimed2, claimed3].every((x) => x === '100') && rows.length === 2
        && rows.some((x) => x.purchase_order_id === po1.poId && dec(x.q) === '40') && rows.some((x) => x.purchase_order_id === po2.poId && dec(x.q) === '30')
        && await lineOpen(rca.lines[0]) === '30', J({ line2, line3, claimed: [claimed1, claimed2, claimed3], rows }));
      check('(X5) eventos distintos por pedido (a chave carrega pedido, estágio e projeto)',
        ev.length === 2 && new Set(ev.map((e) => e.k)).size === 2 && ev.every((e) => e.k.endsWith(`:PO_ISSUED:${s.project}`))
        && ev.some((e) => e.k.includes(po1.poId)) && ev.some((e) => e.k.includes(po2.poId)), J(ev.map((e) => e.k)));
    }

    // ── X12. Legado: pedido emitido (antes da 248) com a linha de uma requisição CANCELADA ──
    {
      const s = await scene('X12');
      const r = await need(s, 60);
      const rca = await requisition([r]);
      await edit(r, { quantity: 100 });
      const rcb = await requisition([r]);
      await one(`UPDATE public.purchase_requisitions SET requested_at = requested_at - interval '1 day' WHERE id = $1 RETURNING id`, [rca.id]);
      const po = await order(s, [...rca.lines, ...rcb.lines], { quantities: { [rca.lines[0]]: 60, [rcb.lines[0]]: 10 }, until: 'APPROVED' });
      // O desfecho da corrida anterior à 248: a requisição foi cancelada enquanto a decisão rodava...
      await one(`UPDATE public.purchase_requisitions SET status = 'CANCELLED', closed_at = now(), close_reason = 'Desistência (legado)'
        WHERE id = $1 RETURNING id`, [rca.id]);
      const rcc = await requisition([r]);
      // ...e a emissão de então não conferia a requisição (nem liberava o não pedido).
      await one(`UPDATE public.purchase_orders SET status = 'ISSUED', issued_by = $2, issued_at = now() WHERE id = $1 RETURNING id`, [po.poId, actor]);
      await one(`UPDATE public.purchase_requisitions SET status = 'ORDERED' WHERE id = $1 RETURNING id`, [rcb.id]);
      const pre = await st(r);
      const can = await cancel(po.poId);
      const c = await st(r);
      check('(X12) legado: a alocação da requisição CANCELADA não reabre nem consome o orçamento — RC-B reabre 40; reclamado 130 → 100',
        rcc.qty === '60' && pre.claimed === '130' && outOf(can, r)?.reopened_qty === '40' && outOf(can, r)?.released_qty === '0' && c.claimed === '100'
        && can.requisitions.length === 1 && can.requisitions[0].requisition_id === rcb.id && (await rq(rca.id)).status === 'CANCELLED'
        && (await ledger(po.poId)).length === 0, J({ pre: pre.claimed, can, c }));
    }

    // ── X13. Linha de R1 + R2, pedido de 60 no R1, reserva de 20 para o R2 ───
    {
      const s = await scene('X13', { siteStock: 500 });
      const r1 = await need(s, 100, '2026-11-10');
      const r2 = await need(s, 50, '2026-11-20');
      const rca = await requisition([r1, r2]);
      const po = await order(s, rca.lines, { quantities: { [s.item]: 60 } });
      await reserve(s, r2, 20);
      const can = await cancel(po.poId);
      const [c1, c2] = [await st(r1), await st(r2)];
      check('(X13) R2 liberado na emissão e reservado 20 depois: o cancelamento reabre só R1 60; R2 fica 20 reservados + 30 compráveis; nada no livro do cancelamento',
        outOf(can, r1)?.reopened_qty === '60' && !outOf(can, r2) && c1.claimed === '60' && c1.purchasable === '40'
        && c2.claimed === '20' && c2.purchasable === '30' && !(await ledger(po.poId)).some((x) => x.stage === 'PO_CANCELLED'), J({ can: can.requirements, c1, c2 }));
    }

    // ── X14. Linha de R1 100 + R2 50, pedido cheio; R2 CANCELADO ─────────────
    {
      const s = await scene('X14');
      const r1 = await need(s, 100, '2026-11-10');
      const r2 = await need(s, 50, '2026-11-20');
      const rca = await requisition([r1, r2]);
      const po = await order(s, rca.lines);
      await transition(r2, 'CANCELLED', 'Escopo removido pelo cliente');
      const can = await cancel(po.poId);
      check('(X14) R1 reabre 100 (reclamado 100); R2 cancelado libera 50 (REQUIREMENT_INACTIVE); a linha fica com 100 abertos; RC AGUARDANDO',
        outOf(can, r1)?.reopened_qty === '100' && outOf(can, r2)?.released_qty === '50' && outOf(can, r2)?.cause === 'REQUIREMENT_INACTIVE'
        && (await st(r1)).claimed === '100' && await lineOpen(rca.lines[0]) === '100' && (await rq(rca.id)).status === 'SUBMITTED', J(can));
    }

    // ── Arredondamento: nada é arredondado; nunca acima do requerido ─────────
    {
      const s = await scene('RQ1', { siteStock: 500 });
      const r = await need(s, 100);
      const rca = await requisition([r]);
      const po = await order(s, rca.lines, { quantities: { [s.item]: 33.33333 }, until: 'APPROVED' });
      const iss = await issue(po.poId);
      await reserve(s, r, 0.00003);
      const can = await cancel(po.poId);
      const c = await st(r);
      check('(arredondamento) proposta 33,33333 de 100: emissão libera 66,66667 exatos; reserva 0,00003; cancelamento reabre 33,33333 — reclamado 33,33336 exatos',
        releasedOf(iss, r)?.released_qty === '66.66667' && (await ledger(po.poId))[0]?.q === '66.66667'
        && outOf(can, r)?.reopened_qty === '33.33333' && c.claimed === '33.33336' && c.purchasable === '66.66664' && c.within, J({ iss, c }));
    }
    for (const [label, reservation, cut, keep, release] of [['RQ2', 33.33333, 80, '46.66667', '13.33333'], ['RQ3', 0.00003, 60, '59.99997', '0.00003']]) {
      const s = await scene(label, { siteStock: 500 });
      const r = await need(s, 100);
      const rca = await requisition([r]);
      const po = await order(s, rca.lines, { quantities: { [s.item]: 60 } });
      await reserve(s, r, reservation);
      await edit(r, { quantity: cut });
      const can = await cancel(po.poId);
      const c = await st(r);
      const exactly = await one(`SELECT public.supply_requirement_claimed($1,$2) = quantity eq FROM public.project_requirements WHERE id = $2`, [org, r]);
      const lg = (await ledger(po.poId)).filter((x) => x.stage === 'PO_CANCELLED');
      check(`(arredondamento) reserva ${reservation} e requisito cortado para ${cut}: reabre ${keep}, libera ${release} COVERED gravado EXATO; reclamado = ${cut} exatos`,
        outOf(can, r)?.reopened_qty === keep && outOf(can, r)?.released_qty === release && lg.length === 1 && lg[0].q === release
        && c.claimed === String(cut) && exactly.eq, J({ can: can.requirements, lg, c }));
    }

    // ── B1. Decisão sobre linha reaberta cuja outra alocação foi liberada: não aborta ──
    for (const label of ['B1-data', 'B1-inativo']) {
      const s = await scene('B1');
      const dateShape = label === 'B1-data';
      const r1 = await need(s, 100, dateShape ? '2026-11-10' : '2026-11-20');
      const r2 = await need(s, 50, dateShape ? '2026-11-20' : '2026-11-10');
      const rca = await requisition([r1, r2]);
      const po = await order(s, rca.lines, dateShape ? { quantities: { [s.item]: 60 } } : {});
      if (dateShape) {
        await requisition([r1, r2]);
        await cancel(po.poId);
        await edit(r2, { required_by: '2026-11-01' });   // o R2 (liberado) passa a ser o mais urgente da linha
      } else {
        await transition(r2, 'CANCELLED', 'Escopo removido pelo cliente');
        await cancel(po.poId);
      }
      const again = await attempt(`(${label}) nova cotação, decisão e emissão da linha reaberta`, () => order(s, rca.lines));
      const line = again ? await rfqLine(again.rfqId) : {};
      const alloc = again ? await polr(again.poId) : [];
      check(`(${label}) a linha reaberta (${dateShape ? '60' : '100'}) é cotada com a data do R1, decidida e emitida — só o R1 é alocado (nunca uma alocação de 0)`,
        Boolean(again) && line.q === (dateShape ? '60' : '100') && line.by === (dateShape ? '2026-11-10' : '2026-11-20')
        && alloc.length === 1 && alloc[0].requirement_id === r1 && alloc[0].q === line.q && (await st(r1)).within, J({ line, alloc }));
    }

    // ── B2. Cotação mista com uma requisição cancelada ──────────────────────
    {
      const s = await scene('B2', { items: 2 });
      const [ix, iy] = s.items;
      const r1 = await need(s, 100, undefined, ix);
      const r2 = await need(s, 50, undefined, iy);
      const rca = await requisition([r1]);
      const rcc = await requisition([r2]);
      const quoted = await order(s, [...rca.lines, ...rcc.lines], { until: 'QUOTED' });
      const out = await call('purchase_requisition_cancel', org, actor, rcc.id, 'Frente de obra suspensa');
      check('(B2) cancelar a RC-C deixa a cotação ABERTA (a RC-A segue viva)', J(out.rfqs_cancelled) === '[]'
        && (await rfqRow(quoted.rfqId)).status === 'OPEN', J(out));
      const decided = await attempt('(B2) decisão da cotação mista', () => call('procurement_decide', org, actor,
        J({ rfq_id: quoted.rfqId, quote_id: quoted.quoteId, rationale: 'Prova 248: única proposta.' })));
      const alloc = decided ? await polr(decided.purchase_order_id) : [];
      check('(B2) a decisão pede SÓ a linha viva (RC-A); a linha da RC-C cancelada vai na resposta como não pedida',
        Boolean(decided) && alloc.length === 1 && alloc[0].requirement_id === r1 && decided.not_ordered?.length === 1
        && decided.not_ordered[0].requisition_number === rcc.number && decided.not_ordered[0].requisition_status === 'CANCELLED'
        && decided.not_ordered[0].open_qty === '50', J(decided));
      const t = await scene('B2b', { items: 2 });
      const q1 = await need(t, 100, undefined, t.items[0]);
      const q2 = await need(t, 50, undefined, t.items[1]);
      const ta = await requisition([q1]);
      const tc = await requisition([q2]);
      const rfq = await order(t, [...ta.lines, ...tc.lines], { until: 'QUOTED' });
      await call('purchase_requisition_cancel', org, actor, tc.id, 'Frente de obra suspensa');
      const last = await call('purchase_requisition_cancel', org, actor, ta.id, 'Obra adiada pelo cliente');
      const row = await rfqRow(rfq.rfqId);
      check('(B2) cancelar a ÚLTIMA requisição viva cancela a cotação aberta (motivo nomeia a solicitação)',
        last.rfqs_cancelled?.length === 1 && last.rfqs_cancelled[0].rfq_id === rfq.rfqId && row.status === 'CANCELLED'
        && row.close_reason === `Solicitação ${ta.number} cancelada`, J({ last, row }));
    }

    // ── Cotação velha de requisição morta (prova 4 do ciclo de vida) ─────────
    {
      const s = await scene('SR1');
      const r = await need(s, 100);
      const rca = await requisition([r]);
      const old = await order(s, rca.lines, { until: 'QUOTED' });
      const out = await call('purchase_requisition_cancel', org, actor, rca.id, 'Compra feita por outra frente');
      await requisition([r]);
      check('(cotação velha) cancelar a requisição cancela a cotação aberta dela; a RC-B leva os 100',
        out.rfqs_cancelled?.length === 1 && (await rfqRow(old.rfqId)).status === 'CANCELLED' && (await st(r)).claimed === '100', J(out));
      await refuse('(cotação velha) a decisão sobre ela é recusada (cotação cancelada)', 'SELECT public.procurement_decide($1,$2,$3)',
        [org, actor, J({ rfq_id: old.rfqId, quote_id: old.quoteId, rationale: 'Prova 248' })], '23514', /^RFQ is CANCELLED\.$/);
    }
    {
      const s = await scene('SR2');
      const r = await need(s, 100);
      const rca = await requisition([r]);
      const old = await order(s, rca.lines, { until: 'QUOTED' });
      // Legado: o cancelamento de requisição anterior à 248 deixava a cotação ABERTA.
      await one(`UPDATE public.purchase_requisitions SET status = 'CANCELLED', closed_at = now(), close_reason = 'Desistência (legado)'
        WHERE id = $1 RETURNING id`, [rca.id]);
      await refuse('(cotação velha, legado) cotação aberta só de requisição cancelada: a decisão é recusada (nenhuma linha vira pedido)',
        'SELECT public.procurement_decide($1,$2,$3)', [org, actor, J({ rfq_id: old.rfqId, quote_id: old.quoteId, rationale: 'Prova 248' })],
        '23514', /^No line of this quotation can become an order: its requisitions were cancelled or closed\.$/);
    }
    {
      const s = await scene('SR3');
      const r = await need(s, 100);
      const rca = await requisition([r]);
      const po = await order(s, rca.lines, { until: 'APPROVED' });
      // Legado: a requisição foi cancelada no meio da decisão (antes da 248, a decisão não travava a requisição).
      await one(`UPDATE public.purchase_requisitions SET status = 'CANCELLED', closed_at = now(), close_reason = 'Desistência (legado)'
        WHERE id = $1 RETURNING id`, [rca.id]);
      await requisition([r]);
      await refuse('(cotação velha, legado) a emissão recusa o pedido de requisição cancelada — reclamado fica 100, não 200',
        'SELECT public.purchase_order_issue($1,$2,$3)', [org, actor, po.poId], '23514',
        new RegExp(`^Requisition ${rca.number} is CANCELLED: this order can no longer be issued\\.$`));
      check('(cotação velha, legado) depois da recusa: pedido APROVADO, reclamado 100', (await st(r)).claimed === '100'
        && (await one(`SELECT status FROM public.purchase_orders WHERE id = $1`, [po.poId])).status === 'APPROVED');
    }

    // ── Repetição de um cancelamento anterior à 248 (sem desfecho gravado) ───
    {
      const s = await scene('R237');
      const r = await need(s, 100);
      const rca = await requisition([r]);
      const po = await order(s, rca.lines, { until: 'DRAFT' });
      // Estado e histórico como a 237 gravava (governança por alçada: detalhe vazio).
      await one(`UPDATE public.purchase_orders SET status = 'CANCELLED', closed_at = now(), close_reason = 'Cancelado antes da 248'
        WHERE id = $1 RETURNING id`, [po.poId]);
      await one(`SELECT public.purchase_order_log(po, 'cancelled', 'DRAFT', 'Cancelado antes da 248', '{}'::jsonb, $2) FROM public.purchase_orders po
        WHERE po.id = $1`, [po.poId, actor]);
      const rep = await cancel(po.poId);
      check('repetição de cancelamento anterior à 248: a forma nova, com listas vazias',
        J(Object.keys(rep).sort()) === J(['approval_request_status', 'purchase_order_id', 'replayed', 'requirements', 'requisitions', 'status'])
        && rep.replayed === true && rep.status === 'CANCELLED' && J(rep.requirements) === '[]' && J(rep.requisitions) === '[]'
        && rep.approval_request_status === null && rep.purchase_order_id === po.poId, J(rep));
    }

    // ── Pedido com recebimento não se cancela (mensagem de sempre) ───────────
    {
      const s = await scene('GR');
      const r = await need(s, 100);
      const rca = await requisition([r]);
      const po = await order(s, rca.lines);
      const line = (await one(`SELECT id FROM public.purchase_order_lines WHERE purchase_order_id = $1`, [po.poId])).id;
      await act('goods_receipt_post', org, actor, J({ purchase_order_id: po.poId, location_id: s.site, lines: [{ po_line_id: line, accepted_quantity: 40 }] }));
      await refuse('pedido com recebimento é encerrado, não cancelado (/has receipts/)', 'SELECT public.purchase_order_cancel($1,$2,$3,$4)',
        [org, actor, po.poId, REASON], '23514', /Purchase order has receipts: it is closed, not cancelled\./);
    }

    // ── Eventos por projeto: requisição de dois projetos (project_id NULL) ───
    {
      const s = await scene('MP');
      const other = await proofProject(ctx, anchors, `P248-MP2-${stamp}`);
      const r1 = await need(s, 100, '2026-11-10');
      const r2 = await need(s, 50, '2026-11-20', s.item, other);
      const rca = await requisition([r1, r2]);
      const po = await order(s, rca.lines, { quantities: { [s.item]: 60 } });
      const ev = await events(rca.id);
      const byProject = Object.fromEntries(ev.map((e) => [e.p.project_id, e]));
      check('eventos: requisição de dois projetos (project_id NULL) → um supply.requisition.released por projeto, com project_id e a chave do projeto',
        (await rq(rca.id)).project_id === null && ev.length === 2
        && byProject[s.project]?.k === `requisition:${rca.id}:released:${po.poId}:PO_ISSUED:${s.project}`
        && byProject[other]?.k === `requisition:${rca.id}:released:${po.poId}:PO_ISSUED:${other}`
        && byProject[s.project].p.requirements.length === 1 && byProject[s.project].p.requirements[0].requirement_id === r1
        && byProject[other].p.requirements[0].requirement_id === r2 && byProject[other].p.requirements[0].released_qty === '50', J(ev));
    }

    // ── Leitura pelo navegador: livro e alocações com os mesmos olhos ────────
    {
      const s = await scene('RLS');
      const r = await need(s, 100);
      const rca = await requisition([r]);
      const po = await order(s, rca.lines, { quantities: { [s.item]: 60 } });
      await cancel(po.poId);
      const server = await st(r);
      await db.query('SAVEPOINT p248_rls');
      let seen = null; let write = 'aceita';
      try {
        await db.query('SET LOCAL ROLE authenticated');
        await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [J({ sub: actor, role: 'authenticated' })]);
        seen = await one(`SELECT (SELECT count(*)::int FROM public.procurement_requisition_releases WHERE purchase_order_id = $1) releases,
            (SELECT requested_qty::text FROM public.supply_requirement_coverage WHERE requirement_id = $2) requested,
            (SELECT sum(open_qty)::text FROM public.purchase_requisition_open_allocations WHERE requisition_line_id = $3) open`,
          [po.poId, r, rca.lines[0]]);
        await db.query(`INSERT INTO public.procurement_requisition_releases (organization_id, requisition_id, requisition_line_id, allocation_id,
            requirement_id, purchase_order_id, stage, quantity, cause, reason)
          SELECT organization_id, requisition_id, requisition_line_id, allocation_id, requirement_id, purchase_order_id, 'PO_CANCELLED', 1,
                 'COVERED', 'forjada pelo navegador' FROM public.procurement_requisition_releases WHERE purchase_order_id = $1 LIMIT 1`, [po.poId]);
      } catch (error) {
        write = error.code;
      }
      await db.query('ROLLBACK TO SAVEPOINT p248_rls');
      await db.query('RELEASE SAVEPOINT p248_rls');
      check('navegador (authenticated, titular): lê o livro e o aberto como o servidor (requisitado 60); não grava no livro',
        seen?.releases === 1 && dec(seen.requested) === server.requested && server.requested === '60' && dec(seen.open) === '60' && write === '42501',
        J({ seen, write, server: server.requested }));
    }

    // ── 237: o cancelamento sob POLÍTICA do motor mantém as chaves do histórico ──
    await db.query('SAVEPOINT p248_policy');
    try {
      await all(`INSERT INTO public.approval_engine_cutover (organization_id, business_domain, subject_type, action_type, justification)
        VALUES ($1,'procurement','purchase_order','approve','Prova 248') ON CONFLICT DO NOTHING RETURNING id`, [org]);
      const policy = (await one(`INSERT INTO public.approval_policies (organization_id, policy_key, name, business_domain)
        VALUES ($1,$2,'[P248] Compras','procurement') RETURNING id`, [org, `procurement.po.p248.${stamp.toLowerCase()}`])).id;
      const version = (await one(`INSERT INTO public.approval_policy_versions (organization_id, policy_id, version_no, subject_type, action_type,
        decision_purpose) VALUES ($1,$2,1,'purchase_order','approve','APPROVAL') RETURNING id`, [org, policy])).id;
      const stage = (await one(`INSERT INTO public.approval_policy_stages (organization_id, policy_version_id, stage_no, name)
        VALUES ($1,$2,1,'Financeiro') RETURNING id`, [org, version])).id;
      await one(`INSERT INTO public.approval_policy_steps (organization_id, policy_version_id, policy_stage_id, step_key, name,
        decision_purpose, eligibility_mode, role_key, sod_forbid_requester) VALUES ($1,$2,$3,'fin','[P248] Financeiro','APPROVAL','ROLE',
        'financeiro',true) RETURNING id`, [org, version, stage]);
      await one('SELECT public.approval_policy_activate($1) r', [version]);
      const s = await scene('POL');
      const r = await need(s, 100);
      const rca = await requisition([r]);
      const po = await order(s, rca.lines, { until: 'APPROVAL_REQUIRED' });
      const requestId = (await one(`SELECT approval_request_id rq FROM public.purchase_orders WHERE id = $1`, [po.poId])).rq;
      const can = await cancel(po.poId);
      const detail = exact((await one(`SELECT detail::text t FROM public.purchase_order_history WHERE purchase_order_id = $1
        AND transition = 'cancelled'`, [po.poId])).t);
      const engine = await one(`SELECT status, finalized_by FROM public.approval_requests WHERE id = $1`, [requestId]);
      check('(237) sob POLÍTICA: o motor cancela a aprovação pendente em nome de quem cancelou; a resposta traz o destino',
        po.submitted?.governance === 'POLICY' && can.approval_request_status === 'CANCELLED' && engine.status === 'CANCELLED'
        && engine.finalized_by === actor, J({ gov: po.submitted?.governance, can: can.approval_request_status, engine }));
      check('(237) histórico: as chaves da 237 ficam (id, estado no cancelamento, destino) e o desfecho (requisitos, requisições) é somado',
        detail.approval_request_id === requestId && detail.approval_request_status_at_cancel === 'PENDING'
        && detail.approval_request_status === 'CANCELLED' && J(detail.requirements) === J(can.requirements)
        && J(detail.requisitions) === J(can.requisitions) && can.requirements.length === 1, J(detail));
      const rep = await cancel(po.poId);
      check('(237) repetição sob POLÍTICA devolve o destino da aprovação gravado', rep.replayed === true
        && rep.approval_request_status === 'CANCELLED' && J(rep.requisitions) === J(can.requisitions), J(rep));
    } catch (error) {
      check('(237) cenário sob POLÍTICA do motor', false, error.message.slice(0, 200));
    }
    await db.query('ROLLBACK TO SAVEPOINT p248_policy');
    await db.query('RELEASE SAVEPOINT p248_policy');

    // ── A demo de Tucuruí não foi tocada ─────────────────────────────────────
    const demo = await one(`SELECT (SELECT status FROM public.procurement_rfqs WHERE organization_id = $1 AND rfq_number = $2) rfq,
        (SELECT status FROM public.purchase_orders WHERE organization_id = $1 AND order_number = $3) po,
        (SELECT count(*)::int FROM public.procurement_requisition_releases z JOIN public.purchase_orders p ON p.id = z.purchase_order_id
          WHERE p.order_number = $3) releases`, [org, TUCURUI_RFQ, TUCURUI_PO]);
    check('Tucuruí intacta: cotação da demo ABERTA, pedido da demo EMITIDO, nada no livro', (demo.rfq === 'OPEN' || demo.rfq === null)
      && (demo.po === 'ISSUED' || demo.po === null) && demo.releases === 0, J(demo));
  },
});
