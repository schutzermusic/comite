/**
 * PROVAS DE DECISÕES (migration 240) — no banco, sempre desfeitas.
 *
 * Usadas por `scripts/operations/apply-240.mjs` (na aplicação) e por
 * `scripts/decisions/prove.mjs` (reexecutáveis a qualquer momento contra o
 * esquema já aplicado). Todo cenário nasce pelas funções governadas — o mesmo
 * caminho da aplicação — dentro de um SAVEPOINT que o chamador desfaz.
 *
 * O que se prova:
 *   • projeção: a decisão aparece para quem tem a alçada, e só para ela;
 *   • faixa de alçada: primária × superior, sem limite inventado;
 *   • inquilino: outro inquilino não vê, não abre, não conta;
 *   • concordância: "quem recebe" (avisos) == "caixa de cada um";
 *   • ato: o invólucro executa a função canônica; tela velha e repetição
 *     não reescrevem história; efeito idêntico ao ato feito em Compras;
 *   • motor: etapa de política aparece para o papel certo e decide pelo motor;
 *   • avisos: planejamento idempotente, in-app exatamente uma vez, canal
 *     externo explícito, cancelamento do aviso de decisão já tomada;
 *   • Equipe: alcance por permissão ou hierarquia, valor restrito.
 */
import { confirmedMaterial, proofItem, proofProject } from '../operations/lib/fixtures.mjs';

export const CORE_FUNCTIONS = [
  'decision_today(uuid)', 'decision_po_submission(uuid,uuid)', 'decision_po_timing(uuid,uuid)',
  'decision_po_approvers(uuid,uuid)', 'decision_engine_subject_live(uuid,text,uuid,uuid)',
  'decision_engine_stage_assignees(uuid,uuid,integer)', 'decision_inbox(uuid,uuid)', 'decision_resolve(uuid,text)',
  'decision_assignees(uuid,text)', 'decision_open_all(uuid)', 'decision_history(uuid,uuid,integer)',
  'decision_purchase_order_act(uuid,uuid,uuid,integer,text,text,text)', 'decision_channel_initial_state(uuid,uuid,text)',
  'decision_notices_plan(uuid,text,text,text)', 'decision_keys_for_event(uuid)', 'decision_deliveries_claim(uuid,integer,integer)',
  'decision_delivery_record(uuid,uuid,text,text,text,text,text,text)', 'decision_delivery_in_app(uuid,uuid,text,text,text)',
  'decision_delivery_mark_delivered(text,text,timestamp with time zone)', 'decision_deliveries_maintain(uuid)',
  'decision_sweep_plan(uuid)', 'decisions_enqueue_sweep(timestamp with time zone)',
  'notification_channel_set(uuid,uuid,text,text,text,text,text,jsonb)', 'notification_preference_set(uuid,uuid,text,boolean,text)',
];
export const VIEWER_FUNCTIONS = [
  'decision_inbox_for_viewer()', 'decision_inbox_count_for_viewer()', 'decision_history_for_viewer(integer)',
  'decision_team_scope_for_viewer()', 'decision_team_for_viewer()', 'decision_access_for_viewer(text)',
];
export const TABLES = ['decision_deliveries', 'notification_channel_integrations', 'user_notification_preferences'];

export async function decisionsProofs(ctx) {
  const { one, all, check, rejects, succeeds, browserCannotExecute, tablesAreGoverned, anchors } = ctx;
  const { org, actor } = anchors;
  const stamp = Date.now().toString(36).toUpperCase();
  const low = stamp.toLowerCase();
  const J = (x) => JSON.stringify(x);
  const act = async (fn, ...args) => (await one(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) r`, args)).r;
  const claims = (uid) => J({ sub: uid, role: 'authenticated' });
  /**
   * A identidade viaja NA MESMA instrução (pooler em modo transação) e é
   * LIMPA logo depois: `set_config(..., true)` vale até o fim da TRANSAÇÃO,
   * e as provas seguintes rodam como servidor.
   */
  const asUser = async (uid, sql, params = []) => {
    try {
      return await all(`WITH who AS (SELECT set_config('request.jwt.claims', $1, true))
    ${sql.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + 1}`)}`, [claims(uid), ...params]);
    } finally {
      await all(`SELECT set_config('request.jwt.claims', '', true)`);
    }
  };

  // ── 0. Fronteira de privilégio ─────────────────────────────────────────
  await browserCannotExecute(CORE_FUNCTIONS);
  for (const fn of VIEWER_FUNCTIONS) {
    const r = await one(`SELECT has_function_privilege('authenticated', $1, 'EXECUTE') a,
      has_function_privilege('anon', $1, 'EXECUTE') b`, [`public.${fn}`]);
    check(`porta do navegador ${fn.split('(')[0]}: authenticated executa, anon não`, r.a && !r.b);
  }
  await tablesAreGoverned(TABLES);
  const perms = await all(`SELECT p.key FROM public.roles r JOIN public.role_permissions rp ON rp.role_id = r.id
    JOIN public.permissions p ON p.id = rp.permission_id WHERE r.organization_id IS NULL AND r.key = 'owner_admin'
    AND p.key IN ('decisions.team.view','notifications.channels.manage')`);
  check('permissões novas semeadas e concedidas a owner_admin', perms.length === 2);
  // Nascem desligadas; depois de um trabalhador capaz drenar, ligadas POR ELE (activated_at) — nunca manualmente.
  const routes = await one(`SELECT count(*)::int n,
      count(*) FILTER (WHERE activation = 'ON_WORKER_CAPABILITY' AND (NOT enabled OR activated_at IS NOT NULL))::int governed
    FROM public.apex_event_routes WHERE job_type = 'platform.decisions.notify'`);
  check('rotas de aviso: 8, ativação só pelo trabalhador capaz', routes.n === 8 && routes.governed === 8, J(routes));

  // ── 1. Pessoas (nascem e morrem na transação de prova) ────────────────
  const tenant = async (label) => {
    const acct = (await one(`INSERT INTO public.enterprise_accounts (name, slug, status, created_by)
      VALUES ($1, $2, 'ACTIVE', $3) RETURNING id`, [`[P240] ${label}`, `p240-${label}-${low}`, actor])).id;
    return (await one(`INSERT INTO public.organizations (name, slug, status, enterprise_account_id, timezone)
      VALUES ($1, $2, 'active', $3, 'America/Sao_Paulo') RETURNING id`, [`[P240] ${label}`, `p240-org-${label}-${low}`, acct])).id;
  };
  const person = async (label, orgId, roleKey) => {
    const uid = (await one(`INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
      VALUES (gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$1,'x',now(),now())
      RETURNING id`, [`p240.${label}.${low}@example.test`])).id;
    await one(`INSERT INTO public.profiles (user_id, organization_id, full_name, status) VALUES ($1,$2,$3,'active') RETURNING id`,
      [uid, orgId, `[P240] ${label}`]);
    await one(`INSERT INTO public.organization_memberships (organization_id, user_id, status, source, joined_at)
      VALUES ($1,$2,'ACTIVE','INVITE',now()) ON CONFLICT (organization_id, user_id) DO UPDATE SET status = 'ACTIVE' RETURNING id`,
      [orgId, uid]);
    await one(`INSERT INTO public.user_active_organization (user_id, organization_id) VALUES ($1,$2)
      ON CONFLICT (user_id) DO UPDATE SET organization_id = EXCLUDED.organization_id RETURNING user_id`, [uid, orgId]);
    if (roleKey) {
      await one(`INSERT INTO public.user_roles (user_id, role_id, organization_id)
        SELECT $1, r.id, $2 FROM public.roles r WHERE r.key = $3 AND r.organization_id IS NULL RETURNING role_id`, [uid, orgId, roleKey]);
    }
    return uid;
  };
  const fin = await person('financeiro', org, 'financeiro');       // faixa primária (teto menor)
  const ceo = await person('diretoria', org, 'ceo_diretoria');     // faixa superior (sem teto)
  const buyer = await person('compras', org, 'compras');           // lê compras, não aprova
  const rh = await person('rh', org, 'rh');                        // não lê compras
  const orgB = await tenant('b');
  const outsider = await person('outro', orgB, 'owner_admin');

  // Alçadas DECLARADAS por pessoa (quem declara é o titular; ninguém declara para si).
  const declared = async (grantee, max, ref) => act('procurement_authority_declare', org, actor, J({
    grantee_kind: 'USER', grantee_user_id: grantee, max_amount: max, currency: 'BRL',
    source_kind: 'BOARD_RESOLUTION', source_reference: ref, justification: 'Prova 240' }));
  await declared(fin, 900000, `ATA-P240-F-${stamp}`);
  await declared(ceo, null, `ATA-P240-D-${stamp}`);

  /** Pedido de compra submetido, por ALÇADA (sem política ativa de compra dentro da prova). */
  await one(`WITH x AS (UPDATE public.approval_policy_versions SET status = 'INACTIVE'
    WHERE organization_id = $1 AND subject_type = 'purchase_order' AND status = 'ACTIVE' RETURNING 1) SELECT count(*) n FROM x`, [org]);
  const project = await proofProject(ctx, anchors, `P240-${stamp}`);
  const site = (await act('inventory_location_upsert', org, actor, J({ code: `S240-${stamp}`, name: 'Canteiro P240',
    kind: 'PROJECT_SITE', project_id: project }))).location_id;
  const supplier = (await act('supplier_register', org, actor, J({ legal_name: `Fornecedor P240 ${stamp}` }))).supplier_id;
  await act('supplier_set_status', org, actor, supplier, 'HOMOLOGATED', null);
  let seq = 0;
  const awaitingPo = async ({ qty = 10, price = 100, requiredBy = '2026-12-15', lead = 5 } = {}) => {
    seq += 1;
    const item = await proofItem(ctx, anchors, `I240-${stamp}-${seq}`, 'm');
    const req = await confirmedMaterial(ctx, anchors, project, item, qty, requiredBy);
    const rc = await act('purchase_requisition_from_shortage', org, actor, J({ requirement_ids: [req] }));
    const lines = await all(`SELECT id FROM public.purchase_requisition_lines WHERE requisition_id = $1`, [rc.requisition_id]);
    const rfq = await act('procurement_rfq_create', org, actor, J({ requisition_line_ids: lines.map((l) => l.id), supplier_ids: [supplier] }));
    const rfqLines = await all(`SELECT id FROM public.procurement_rfq_lines WHERE rfq_id = $1`, [rfq.rfq_id]);
    const quote = await act('procurement_quote_record', org, actor, J({ rfq_id: rfq.rfq_id, supplier_id: supplier, lead_time_days: lead,
      validity_date: '2099-01-01', lines: rfqLines.map((l) => ({ rfq_line_id: l.id, unit_price: price })) }));
    const dec = await act('procurement_decide', org, actor, J({ rfq_id: rfq.rfq_id, quote_id: quote.quote_id, rationale: 'Prova 240' }));
    await act('purchase_order_update_draft', org, actor, dec.purchase_order_id, J({ delivery_location_id: site }));
    const sub = await act('purchase_order_submit', org, actor, dec.purchase_order_id, 'Prova 240: submissão');
    return { po: dec.purchase_order_id, governance: sub.governance, item, req };
  };
  /** Leitura COM RLS de verdade: papel `authenticated` + reivindicação, num SAVEPOINT. */
  const asUserRls = async (uid, sql, params = []) => {
    await all('SAVEPOINT rls_probe');
    try {
      await all(`SELECT set_config('request.jwt.claims', $1, true)`, [claims(uid)]);
      await all('SET LOCAL ROLE authenticated');
      const rows = await all(sql, params);
      await all('RELEASE SAVEPOINT rls_probe');
      return rows;
    } catch (error) {
      await all('ROLLBACK TO SAVEPOINT rls_probe');
      throw error;
    } finally {
      await all('RESET ROLE');
      await all(`SELECT set_config('request.jwt.claims', '', true)`);
    }
  };
  const inbox = async (uid) => all(`SELECT * FROM public.decision_inbox($1, $2)`, [org, uid]);
  const find = (rows, key) => rows.find((r) => r.decision_key === key);

  // ── 2. Projeção por ALÇADA DECLARADA ───────────────────────────────────
  const a = await awaitingPo({ qty: 10, price: 100 });
  check('pedido submetido é governado por alçada declarada', a.governance === 'AUTHORITY', a.governance);
  const keyA = `purchase_order:${a.po}:s1`;
  const finRow = find(await inbox(fin), keyA);
  check('a decisão aparece para a faixa PRIMÁRIA (menor teto que cobre)', finRow?.assignment === 'PRIMARY', J(finRow?.assignment));
  check('atos oferecidos = os que o domínio executa (aprovar, devolver para ajuste)',
    J(finRow?.actions) === J(['APPROVE', 'REQUEST_ADJUSTMENT']) && J(finRow?.reason_required) === J(['REQUEST_ADJUSTMENT']));
  check('"por que chegou até mim": alçada, teto e origem do registro declarado',
    finRow?.authority?.kind === 'PROCUREMENT_AUTHORITY' && Number(finRow.authority.ceiling) <= 900000
      && /^ATA-/.test(finRow.authority.source_reference) && finRow.authority.source_kind === 'BOARD_RESOLUTION', J(finRow?.authority));
  check('prazo operacional derivado da necessidade e do prazo da proposta',
    finRow?.need_by && finRow?.decide_by && String(finRow.decide_by).length > 0, `${finRow?.need_by} → ${finRow?.decide_by}`);
  const ceoRow = find(await inbox(ceo), keyA);
  check('faixa superior PODE decidir, mas não é a destinatária (ELIGIBLE)', ceoRow?.assignment === 'ELIGIBLE', J(ceoRow?.assignment));
  check('quem criou/submeteu NÃO recebe a decisão (SoD)', !find(await inbox(actor), keyA));
  check('Compras (sem alçada de aprovação) não recebe', !find(await inbox(buyer), keyA));
  check('RH não recebe', !find(await inbox(rh), keyA));
  check('usuário de OUTRO inquilino não recebe (mesmo com owner_admin)',
    (await all(`SELECT * FROM public.decision_inbox($1,$2)`, [org, outsider])).length === 0);

  // Porta do navegador: identidade da sessão, organização da sessão.
  const viewF = await asUser(fin, `SELECT i.decision_key, i.assignment FROM who, public.decision_inbox_for_viewer() i`);
  check('porta do navegador devolve a caixa DA SESSÃO', viewF.some((r) => r.decision_key === keyA && r.assignment === 'PRIMARY'));
  const countF = (await asUser(fin, `SELECT public.decision_inbox_count_for_viewer() n FROM who`))[0].n;
  const countC = (await asUser(ceo, `SELECT public.decision_inbox_count_for_viewer() n FROM who`))[0].n;
  check('contador conta a decisão da faixa primária', countF >= 1, String(countF));
  check('contador NÃO conta decisão de outra faixa (evita ruído na diretoria)',
    !(await asUser(ceo, `SELECT i.decision_key FROM who, public.decision_inbox_for_viewer() i WHERE i.assignment IN ('PRIMARY','ESCALATED')`))
      .some((r) => r.decision_key === keyA), `contador diretoria=${countC}`);
  const outView = await asUser(outsider, `SELECT i.decision_key FROM who, public.decision_inbox_for_viewer() i`);
  check('sessão de outro inquilino não enxerga nenhuma decisão deste', !outView.some((r) => r.decision_key.includes(a.po)));

  // Acesso ao detalhe
  const access = async (uid, key) => (await asUser(uid, `SELECT public.decision_access_for_viewer($1) a FROM who`, [key]))[0].a;
  check('detalhe: faixa primária = DECIDER', (await access(fin, keyA)) === 'DECIDER');
  check('detalhe: faixa superior = ELIGIBLE', (await access(ceo, keyA)) === 'ELIGIBLE');
  check('detalhe: Compras lê pelo domínio de origem (SOURCE_READER), sem ganhar ato', (await access(buyer, keyA)) === 'SOURCE_READER');
  check('detalhe: RH não abre', (await access(rh, keyA)) === null);
  check('detalhe: outro inquilino não abre (mesma resposta de "não existe")', (await access(outsider, keyA)) === null);
  check('detalhe: chave inventada não abre', (await access(fin, `purchase_order:${a.po}:s9`)) === null);

  // Concordância: quem recebe (avisos) == caixa de cada um.
  const asg = await all(`SELECT * FROM public.decision_assignees($1,$2)`, [org, keyA]);
  let agree = asg.length > 0;
  for (const x of asg) {
    const row = find(await inbox(x.user_id), keyA);
    if (!row || row.assignment !== x.assignment) agree = false;
  }
  check('"quem recebe" e "caixa de cada um" concordam (mesma composição canônica)', agree, J(asg));
  check('SoD também nos destinatários', !asg.some((x) => x.user_id === actor));

  // ── 3. O ATO: invólucro → função canônica ──────────────────────────────
  const fpA = (await one(`SELECT public.purchase_order_fingerprint($1) fp`, [a.po])).fp;
  await rejects('quem submeteu não decide nem pelo invólucro (SoD canônica)',
    `SELECT public.decision_purchase_order_act($1,$2,$3,1,$4,'APPROVE',null)`, [org, actor, a.po, fpA], /segregation of duties/);
  await rejects('sem alçada não aprova nem pelo invólucro (Compras)',
    `SELECT public.decision_purchase_order_act($1,$2,$3,1,$4,'APPROVE',null)`, [org, buyer, a.po, fpA], /permission|authority/i);
  const staleFp = await act('decision_purchase_order_act', org, fin, a.po, 1, 'deadbeef', 'APPROVE', null);
  check('impressão digital diferente da tela: STALE, nada escrito', staleFp.outcome === 'STALE'
    && (await one(`SELECT status FROM public.purchase_orders WHERE id = $1`, [a.po])).status === 'APPROVAL_REQUIRED', J(staleFp));
  const staleSub = await act('decision_purchase_order_act', org, fin, a.po, 2, fpA, 'APPROVE', null);
  check('submissão diferente da tela: STALE', staleSub.outcome === 'STALE', J(staleSub));
  const rec = await act('decision_purchase_order_act', org, fin, a.po, 1, fpA, 'APPROVE', 'Aprovado em Decisões');
  check('ato registrado pela função canônica', rec.outcome === 'RECORDED' && rec.result.status === 'APPROVED', J(rec));
  const poA = await one(`SELECT status, approved_by, approval_authority_id, approved_fingerprint FROM public.purchase_orders WHERE id = $1`, [a.po]);
  check('efeito canônico: APPROVED, aprovador, alçada e impressão digital', poA.status === 'APPROVED' && poA.approved_by === fin
    && poA.approval_authority_id && poA.approved_fingerprint === fpA);
  const replay = await act('decision_purchase_order_act', org, fin, a.po, 1, fpA, 'APPROVE', 'Aprovado em Decisões');
  check('mesmo clique repetido: IDEMPOTENT_REPLAY, sem segunda escrita', replay.outcome === 'IDEMPOTENT_REPLAY', J(replay));
  const staleOther = await act('decision_purchase_order_act', org, ceo, a.po, 1, fpA, 'REJECT', 'Tela velha');
  check('sessão B com a tela velha tenta devolver: STALE com quem decidiu', staleOther.outcome === 'STALE'
    && staleOther.decided_by === fin && staleOther.decided_outcome === 'APPROVED', J(staleOther));
  const hist = await one(`SELECT count(*)::int n FROM public.purchase_order_history WHERE purchase_order_id = $1 AND transition = 'approved'`, [a.po]);
  check('história não foi reescrita: UMA aprovação', hist.n === 1);
  check('decisão sai de "Minhas" depois de decidida', !find(await inbox(fin), keyA));
  const res = await one(`SELECT public.decision_resolve($1,$2) r`, [org, keyA]);
  check('decisão resolvida: encerrada, APROVADA, por quem, quando', res.r.open === false && res.r.outcome === 'APPROVED'
    && res.r.closed_by === fin && res.r.closed_at, J(res.r));
  const hF = (await all(`SELECT * FROM public.decision_history($1,$2,50)`, [org, fin])).find((h) => h.decision_key === keyA);
  check('"Concluídas": aparece com desfecho, autoridade e justificativa', hF?.outcome === 'APPROVED' && hF?.viewer_role === 'DECIDER'
    && hF?.reason === 'Aprovado em Decisões' && hF?.authority?.authority_id, J(hF));
  const hReq = (await all(`SELECT * FROM public.decision_history($1,$2,50)`, [org, actor])).find((h) => h.decision_key === keyA);
  check('"Concluídas" de quem pediu: aparece como REQUESTER', hReq?.viewer_role === 'REQUESTER' && hReq?.outcome === 'APPROVED');

  // Paridade: o mesmo ato feito em Compras (purchase_order_decide direto) produz o mesmo efeito.
  const b = await awaitingPo({ qty: 10, price: 100 });
  const fpB = (await one(`SELECT public.purchase_order_fingerprint($1) fp`, [b.po])).fp;
  await act('purchase_order_decide', org, fin, b.po, 'APPROVE', 'Aprovado em Compras');
  const poB = await one(`SELECT status, approved_by, approval_authority_id IS NOT NULL has_auth, approved_fingerprint FROM public.purchase_orders WHERE id = $1`, [b.po]);
  const hA = await one(`SELECT detail FROM public.purchase_order_history WHERE purchase_order_id = $1 AND transition = 'approved'`, [a.po]);
  const hB = await one(`SELECT detail FROM public.purchase_order_history WHERE purchase_order_id = $1 AND transition = 'approved'`, [b.po]);
  const evA = await one(`SELECT count(*)::int n FROM public.domain_events WHERE aggregate_id = $1 AND event_type = 'supply.purchase_order.approved'`, [a.po]);
  const evB = await one(`SELECT count(*)::int n FROM public.domain_events WHERE aggregate_id = $1 AND event_type = 'supply.purchase_order.approved'`, [b.po]);
  check('paridade Compras × Decisões: mesmo estado, aprovador, alçada, impressão digital',
    poB.status === poA.status && poB.approved_by === poA.approved_by && poB.has_auth && poB.approved_fingerprint === fpB);
  check('paridade Compras × Decisões: mesma forma de histórico e o mesmo fato de domínio',
    J(Object.keys(hA.detail).sort()) === J(Object.keys(hB.detail).sort()) && evA.n === 1 && evB.n === 1,
    `${Object.keys(hA.detail).sort()} | ${Object.keys(hB.detail).sort()}`);

  // Devolver para ajuste → rascunho; ressubmissão é OUTRA decisão.
  const c = await awaitingPo({ qty: 3, price: 50 });
  const keyC1 = `purchase_order:${c.po}:s1`;
  const fpC = (await one(`SELECT public.purchase_order_fingerprint($1) fp`, [c.po])).fp;
  await rejects('devolver sem justificativa é recusado pela função canônica',
    `SELECT public.decision_purchase_order_act($1,$2,$3,1,$4,'REJECT','   ')`, [org, fin, c.po, fpC], /reason/i);
  const adj = await act('decision_purchase_order_act', org, fin, c.po, 1, fpC, 'REJECT', 'Rever o frete');
  check('ajuste solicitado: pedido volta ao rascunho', adj.outcome === 'RECORDED'
    && (await one(`SELECT status FROM public.purchase_orders WHERE id = $1`, [c.po])).status === 'DRAFT');
  check('desfecho lido como AJUSTE SOLICITADO', (await one(`SELECT public.decision_resolve($1,$2) r`, [org, keyC1])).r.outcome === 'ADJUSTMENT_REQUESTED');
  await act('purchase_order_submit', org, actor, c.po, 'Frete revisto');
  const keyC2 = `purchase_order:${c.po}:s2`;
  check('ressubmissão abre a decisão s2 para a faixa primária', find(await inbox(fin), keyC2)?.assignment === 'PRIMARY');
  const oldScreen = await act('decision_purchase_order_act', org, fin, c.po, 1, fpC, 'APPROVE', null);
  check('tela da submissão 1 não aprova a submissão 2', oldScreen.outcome === 'STALE', J(oldScreen));

  // ── 4. MOTOR: etapa de política ────────────────────────────────────────
  const pol = (await one(`INSERT INTO public.approval_policies (organization_id, policy_key, name, business_domain, created_by)
    VALUES ($1,$2,'Prova 240','procurement',$3) RETURNING id`, [org, `p240.${low}`, actor])).id;
  const ver = (await one(`INSERT INTO public.approval_policy_versions (organization_id, policy_id, version_no, subject_type, action_type, decision_purpose)
    VALUES ($1,$2,1,'purchase_order','approve','APPROVAL') RETURNING id`, [org, pol])).id;
  const stg = (await one(`INSERT INTO public.approval_policy_stages (organization_id, policy_version_id, stage_no, name)
    VALUES ($1,$2,1,'Diretoria') RETURNING id`, [org, ver])).id;
  await one(`INSERT INTO public.approval_policy_steps (organization_id, policy_version_id, policy_stage_id, step_key, name,
    decision_purpose, eligibility_mode, role_key, sod_forbid_requester) VALUES ($1,$2,$3,'dir','Diretoria','APPROVAL','ROLE','ceo_diretoria',true) RETURNING id`,
  [org, ver, stg]);
  await one(`SELECT public.approval_policy_activate($1) r`, [ver]);
  const e = await awaitingPo({ qty: 2, price: 10 });
  check('com política ativa, a submissão vai ao MOTOR', e.governance === 'POLICY', e.governance);
  const reqE = (await one(`SELECT approval_request_id r FROM public.purchase_orders WHERE id = $1`, [e.po])).r;
  const keyE = `approval_request:${reqE}:e1`;
  const ceoE = find(await inbox(ceo), keyE);
  check('etapa do motor aparece para o papel da etapa', ceoE?.assignment === 'PRIMARY' && ceoE?.source_kind === 'APPROVAL_ENGINE', J(ceoE));
  check('atos do motor para compra: aprovar, rejeitar, solicitar ajuste', J(ceoE?.actions) === J(['APPROVE', 'REJECT', 'REQUEST_ADJUSTMENT']));
  check('explicação da política: chave, versão, estágio, etapa e base da autoridade',
    ceoE?.authority?.policy_key === `p240.${low}` && ceoE?.authority?.stage_name === 'Diretoria' && /role:ceo_diretoria/.test(ceoE?.authority?.authority_basis));
  check('papel fora da etapa não recebe (financeiro)', !find(await inbox(fin), keyE));
  check('quem pediu não recebe a própria aprovação (SoD do motor)', !find(await inbox(actor), keyE));
  // Pedido órfão: aberto direto no motor sobre um pedido que o domínio não aponta (b já aprovado por alçada).
  // Aberto por uma sessão (o motor exige solicitante para descontar a SoD).
  const orphan = (await asUser(buyer, `SELECT public.approval_request_create($1,'purchase_order',$2,'approve','APPROVAL','órfão',
    '{}'::jsonb,$3) r FROM who`, [org, b.po, `p240-orphan-${stamp}`]))[0]?.r;
  check('pedido do motor aberto sem âncora no domínio (cenário)', orphan?.status === 'CREATED', J(orphan));
  check('pedido do motor sem âncora no domínio NÃO aparece em Decisões',
    !(await inbox(ceo)).some((r) => r.request_id === orphan?.request_id));
  // Decide pelo motor, como a rota de Decisões faz (JWT do decisor).
  const stepE = ceoE?.step_id;
  const decE = (await asUser(ceo, `SELECT public.approval_decide($1,'APPROVED',$2,null,null,$3) r FROM who`,
    [stepE, `dec:${stepE}:${ceo}:APPROVED:p240`, ceoE?.fingerprint]))[0].r;
  check('decisão pelo motor registrada', decE.status === 'RECORDED' && decE.request_status === 'APPROVED', J(decE));
  const applied = await act('purchase_order_apply_approval', reqE);
  check('desfecho aplicado ao pedido pela função canônica (sync)', (await one(`SELECT status FROM public.purchase_orders WHERE id = $1`, [e.po])).status === 'APPROVED', J(applied));
  check('etapa decidida sai de "Minhas"', !find(await inbox(ceo), keyE));
  const hE = (await all(`SELECT * FROM public.decision_history($1,$2,50)`, [org, ceo])).find((h) => h.decision_key === keyE);
  check('"Concluídas" do motor: desfecho, base de autoridade', hE?.outcome === 'APPROVED' && hE?.authority?.authority_source === 'ROLE', J(hE?.authority));
  await one(`UPDATE public.approval_policy_versions SET status = 'INACTIVE' WHERE id = $1 RETURNING id`, [ver]);

  // ── 5. AVISOS ──────────────────────────────────────────────────────────
  const n1 = await act('decision_notices_plan', org, keyC2, 'NEW', null);
  const rows1 = await all(`SELECT recipient_user_id, channel, state, failure_code FROM public.decision_deliveries
    WHERE organization_id = $1 AND decision_key = $2 AND notice_kind = 'NEW'`, [org, keyC2]);
  const finRows = rows1.filter((r) => r.recipient_user_id === fin);
  check('aviso NEW planejado para a faixa primária em in-app, e-mail e WhatsApp', n1 >= 3 && finRows.length === 3, J(finRows));
  check('WhatsApp sem integração explícita: NOT_CONFIGURED, sem tentativa',
    finRows.find((r) => r.channel === 'whatsapp')?.state === 'NOT_CONFIGURED'
    && finRows.find((r) => r.channel === 'whatsapp')?.failure_code === 'CHANNEL_NOT_CONFIGURED');
  check('faixa superior não recebe o aviso NEW', !rows1.some((r) => r.recipient_user_id === ceo));
  const n2 = await act('decision_notices_plan', org, keyC2, 'NEW', null);
  check('replanejar o mesmo aviso não cria segunda linha (idempotente)', n2 === 0);
  const evSub = await one(`SELECT id FROM public.domain_events WHERE aggregate_id = $1 AND event_type = 'supply.purchase_order.submitted'
    ORDER BY split_part(idempotency_key, ':', 4)::int DESC LIMIT 1`, [c.po]);
  const kfe = await all(`SELECT * FROM public.decision_keys_for_event($1)`, [evSub.id]);
  check('evento de submissão → a decisão s2, aviso NEW', kfe.length === 1 && kfe[0].decision_key === keyC2 && kfe[0].notice_kind === 'NEW', J(kfe));
  const claimed = await all(`SELECT * FROM public.decision_deliveries_claim($1, 100, 60)`, [org]);
  const mineApp = claimed.find((d) => d.decision_key === keyC2 && d.recipient_user_id === fin && d.channel === 'in_app');
  const mineMail = claimed.find((d) => d.decision_key === keyC2 && d.recipient_user_id === fin && d.channel === 'email');
  check('entrega arrendada (SENDING, tentativa contada)', mineApp?.state === 'SENDING' && mineApp.attempt_count === 1 && mineMail?.state === 'SENDING');
  const again = await all(`SELECT id FROM public.decision_deliveries_claim($1, 100, 60)`, [org]);
  check('entrega arrendada não é pega de novo (sem envio duplo concorrente)', !again.some((d) => d.id === mineApp?.id));
  const inApp = await act('decision_delivery_in_app', mineApp.id, mineApp.lease_token, 'Decisão necessária', 'Compra', `/decisoes?d=${encodeURIComponent(keyC2)}`);
  const notif = await one(`SELECT n.type, n.link_url, n.recipient_user_id FROM public.decision_deliveries d JOIN public.notifications n ON n.id = d.notification_id WHERE d.id = $1`, [mineApp.id]);
  check('in-app entregue exatamente uma vez, com link relativo ao Apex', inApp === 'DELIVERED' && notif?.type === 'decisions.new'
    && notif.link_url.startsWith('/decisoes?d=') && notif.recipient_user_id === fin, J(notif));
  check('entrega repetida com arrendamento vencido é recusada (STALE)',
    (await act('decision_delivery_in_app', mineApp.id, mineApp.lease_token, 'x', null, '/decisoes')) === 'STALE');
  await rejects('link absoluto é recusado', `SELECT public.decision_delivery_in_app($1,$2,'x',null,'https://evil.example')`, [mineMail.id, mineMail.lease_token], /relativo/);
  const retry = await act('decision_delivery_record', mineMail.id, mineMail.lease_token, 'RETRY', 'resend', null, 'HTTP_503', 'provedor indisponível', null);
  const mailRow = await one(`SELECT state, next_attempt_at > now() later, attempt_count FROM public.decision_deliveries WHERE id = $1`, [mineMail.id]);
  check('falha transitória: FAILED com recuo (nova tentativa agendada)', retry === 'FAILED' && mailRow.later && mailRow.attempt_count === 1, J(mailRow));
  // A decisão fecha: o aviso de AÇÃO pendente é cancelado, não enviado.
  const fpC2 = (await one(`SELECT public.purchase_order_fingerprint($1) fp`, [c.po])).fp;
  await act('decision_purchase_order_act', org, fin, c.po, 2, fpC2, 'APPROVE', null);
  await one(`UPDATE public.decision_deliveries SET next_attempt_at = now() WHERE id = $1 RETURNING id`, [mineMail.id]);
  const maint = await act('decision_deliveries_maintain', org);
  check('decisão fechada: e-mail "decisão necessária" pendente é CANCELADO (sem spam)',
    (await one(`SELECT state, failure_code FROM public.decision_deliveries WHERE id = $1`, [mineMail.id])).state === 'CANCELLED', J(maint));
  const nRes = await act('decision_notices_plan', org, keyC2, 'RESOLVED', 'APPROVED');
  const resRows = await all(`SELECT recipient_user_id, channel, recipient_role FROM public.decision_deliveries WHERE decision_key = $1 AND notice_kind = 'RESOLVED'`, [keyC2]);
  check('desfecho avisa quem pediu (in-app), não quem decidiu', nRes >= 1 && resRows.every((r) => r.recipient_role === 'REQUESTER' && r.recipient_user_id !== fin)
    && resRows.some((r) => r.recipient_user_id === actor), J(resRows));
  check('aviso de ação para decisão fechada não é planejado', (await act('decision_notices_plan', org, keyC2, 'DUE_SOON', null)) === 0);

  // Canal explícito
  await rejects('ligar canal sem notifications.channels.manage é recusado',
    `SELECT public.notification_channel_set($1,$2,'whatsapp','ENABLED','fake','MINIMAL','prova')`, [org, fin], /lacks permission/);
  await rejects('configuração de canal com chave de segredo é recusada',
    `SELECT public.notification_channel_set($1,$2,'whatsapp','ENABLED','fake','MINIMAL','prova',$3)`, [org, actor, J({ api_token: 'x' })], /nci_config_no_secrets|check/i);
  await succeeds('titular liga o WhatsApp explicitamente (provedor + motivo)',
    `SELECT public.notification_channel_set($1,$2,'whatsapp','ENABLED','fake','MINIMAL','Prova 240: integração homologada')`, [org, actor]);
  await rejects('WhatsApp com número fora do E.164 é recusado', `SELECT public.notification_preference_set($1,$2,'whatsapp',true,'11 99999-9999')`,
    [org, fin], /formato internacional/);
  await succeeds('pessoa faz opt-in com o próprio número', `SELECT public.notification_preference_set($1,$2,'whatsapp',true,'+55 (11) 99999-0000')`, [org, fin]);
  await succeeds('pessoa desliga o e-mail para si', `SELECT public.notification_preference_set($1,$2,'email',false)`, [org, fin]);
  const d = await awaitingPo({ qty: 4, price: 25 });
  const keyD = `purchase_order:${d.po}:s1`;
  await act('decision_notices_plan', org, keyD, 'NEW', null);
  const dRows = await all(`SELECT channel, state, failure_code FROM public.decision_deliveries WHERE decision_key = $1 AND recipient_user_id = $2`, [keyD, fin]);
  check('com canal ENABLED e opt-in, o WhatsApp entra na fila (PENDING)', dRows.find((r) => r.channel === 'whatsapp')?.state === 'PENDING', J(dRows));
  check('preferência da pessoa restringe: e-mail SKIPPED (USER_OPTED_OUT)',
    dRows.find((r) => r.channel === 'email')?.state === 'SKIPPED' && dRows.find((r) => r.channel === 'email')?.failure_code === 'USER_OPTED_OUT');
  const vis = await asUserRls(fin, `SELECT count(*)::int n FROM public.decision_deliveries WHERE decision_key = $1`, [keyD]);
  const visC = await asUserRls(ceo, `SELECT count(*)::int n FROM public.decision_deliveries WHERE decision_key = $1`, [keyD]);
  check('RLS: a pessoa vê as próprias entregas; outra pessoa não', vis[0].n === 3 && visC[0].n === 0, `${vis[0].n}/${visC[0].n}`);

  // ── 6. EQUIPE ──────────────────────────────────────────────────────────
  const teamOwner = await asUser(actor, `SELECT t.decision_key, t.amount_restricted, t.assignees FROM who, public.decision_team_for_viewer() t`);
  check('Equipe (decisions.team.view): vê a decisão aberta e quem a tem', teamOwner.some((t) => t.decision_key === keyD
    && t.assignees.some((x) => x.user_id === fin && x.assignment === 'PRIMARY')));
  check('Equipe: sem permissão nem liderados, nada', (await asUser(fin, `SELECT t.decision_key FROM who, public.decision_team_for_viewer() t`)).length === 0);
  // Gestor na hierarquia canônica de pessoas, SEM leitura de compras: vê, com valor restrito.
  const mgr = await person('gestor', org, 'rh');
  const pMgr = (await one(`INSERT INTO public.people (organization_id, profile_id, full_name, status)
    SELECT $1, p.id, '[P240] gestor', 'active' FROM public.profiles p WHERE p.user_id = $2 RETURNING id`, [org, mgr])).id;
  await one(`INSERT INTO public.people (organization_id, profile_id, full_name, status, manager_person_id)
    SELECT $1, p.id, '[P240] financeiro', 'active', $3 FROM public.profiles p WHERE p.user_id = $2 RETURNING id`, [org, fin, pMgr]);
  check('gestor por hierarquia tem alcance DIRECT_REPORTS', (await asUser(mgr, `SELECT public.decision_team_scope_for_viewer() s FROM who`))[0].s === 'DIRECT_REPORTS');
  const teamMgr = await asUser(mgr, `SELECT t.decision_key, t.amount, t.amount_restricted FROM who, public.decision_team_for_viewer() t`);
  const tm = teamMgr.find((t) => t.decision_key === keyD);
  check('gestor vê a decisão do liderado com valor RESTRITO (não lê compras)', tm && tm.amount === null && tm.amount_restricted === true, J(tm));
  check('ver a Equipe não dá ato: gestor continua sem acesso de decisor', (await access(mgr, keyD)) === 'TEAM');

  // ── 7. Varredura e produtor ────────────────────────────────────────────
  const sweep = await act('decision_sweep_plan', org);
  check('varredura roda e reconcilia decisões abertas', typeof sweep.open === 'number' && sweep.open >= 1, J(sweep));
  const enq = await one(`SELECT public.decisions_enqueue_sweep(now()) n`);
  check('produtor agenda a varredura por inquilino', enq.n >= 1);
  const enq2 = await one(`SELECT public.decisions_enqueue_sweep(now()) n`);
  const jobs = await one(`SELECT count(*)::int n FROM public.apex_jobs WHERE organization_id = $1 AND job_type = 'platform.decisions.sweep'
    AND idempotency_key = 'decisions-sweep:' || $1::text || ':' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24')
      || ':' || (extract(minute FROM now())::int / 15)::text`, [org]);
  check('produtor é idempotente na janela (um trabalho por inquilino/janela)', enq2.n >= 1 && jobs.n === 1, `jobs=${jobs.n}`);
}
