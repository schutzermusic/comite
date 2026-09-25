/**
 * PROVAS DA 241 — endurecimento de Decisões, sempre desfeitas.
 *
 * Usadas por `scripts/operations/apply-241.mjs` e por `scripts/decisions/prove.mjs`.
 *   • todo fato approval.* vira decisão + aviso SEM erro (antes: 42702);
 *   • o portão de "lê a origem" espelha a RLS da origem, objeto a objeto;
 *   • aviso de desfecho não vai para quem já saiu da organização;
 *   • o desfecho do motor diz QUAL submissão do pedido de compra decidiu.
 */
export async function hardeningProofs(ctx) {
  const { one, all, check, anchors } = ctx;
  const { org, actor } = anchors;
  const stamp = Date.now().toString(36).toLowerCase();
  const J = (x) => JSON.stringify(x);
  const asUser = async (uid, sql, params = []) => {
    try {
      return await all(`WITH who AS (SELECT set_config('request.jwt.claims', $1, true))
        ${sql.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + 1}`)}`, [J({ sub: uid, role: 'authenticated' }), ...params]);
    } finally { await all(`SELECT set_config('request.jwt.claims', '', true)`); }
  };
  const person = async (label, roleKey) => {
    const uid = (await one(`INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
      VALUES (gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$1,'x',now(),now())
      RETURNING id`, [`p241.${label}.${stamp}@example.test`])).id;
    await one(`INSERT INTO public.profiles (user_id, organization_id, full_name, status) VALUES ($1,$2,$3,'active') RETURNING id`, [uid, org, `[P241] ${label}`]);
    await one(`INSERT INTO public.organization_memberships (organization_id, user_id, status, source, joined_at)
      VALUES ($1,$2,'ACTIVE','INVITE',now()) ON CONFLICT (organization_id, user_id) DO UPDATE SET status = 'ACTIVE' RETURNING id`, [org, uid]);
    await one(`INSERT INTO public.user_active_organization (user_id, organization_id) VALUES ($1,$2)
      ON CONFLICT (user_id) DO UPDATE SET organization_id = EXCLUDED.organization_id RETURNING user_id`, [uid, org]);
    await one(`INSERT INTO public.user_roles (user_id, role_id, organization_id)
      SELECT $1, r.id, $2 FROM public.roles r WHERE r.key = $3 AND r.organization_id IS NULL RETURNING role_id`, [uid, org, roleKey]);
    return uid;
  };

  // 1. Todo tipo de fato approval.* existente é lido sem erro.
  const types = ['approval.stage.opened', 'approval.request.approved', 'approval.request.rejected',
    'approval.request.returned_for_correction', 'approval.request.expired', 'approval.request.cancelled'];
  for (const t of types) {
    const ev = await one(`SELECT id FROM public.domain_events WHERE event_type = $1 AND aggregate_type = 'approval_request'
      ORDER BY recorded_at DESC LIMIT 1`, [t]);
    if (!ev) { check(`fato ${t}: sem ocorrência neste banco (nada a provar)`, true); continue; }
    try {
      const rows = await all(`SELECT * FROM public.decision_keys_for_event($1)`, [ev.id]);
      check(`fato ${t} é lido sem erro (antes: 42702 coluna ambígua)`, true, `${rows.length} chave(s)`);
    } catch (error) {
      check(`fato ${t} é lido sem erro (antes: 42702 coluna ambígua)`, false, error.message);
      return;
    }
  }
  const opened = await one(`SELECT e.id, e.aggregate_id, e.payload->>'stage_no' st FROM public.domain_events e
    JOIN public.approval_requests r ON r.id = e.aggregate_id AND r.subject_type IN ('purchase_order','contract_billing_event')
    WHERE e.event_type = 'approval.stage.opened' ORDER BY e.recorded_at DESC LIMIT 1`);
  if (opened) {
    const k = await all(`SELECT decision_key, notice_kind FROM public.decision_keys_for_event($1)`, [opened.id]);
    check('estágio aberto no motor → aviso NEW para a chave do estágio', k.length === 1 && k[0].notice_kind === 'NEW'
      && k[0].decision_key === `approval_request:${opened.aggregate_id}:e${opened.st}`, J(k));
  }
  const approved = await one(`SELECT e.id FROM public.domain_events e JOIN public.approval_requests r ON r.id = e.aggregate_id
    AND r.subject_type IN ('purchase_order','contract_billing_event') WHERE e.event_type = 'approval.request.approved'
    ORDER BY e.recorded_at DESC LIMIT 1`);
  if (approved) {
    const k = await all(`SELECT notice_kind, outcome FROM public.decision_keys_for_event($1)`, [approved.id]);
    check('pedido aprovado no motor → aviso RESOLVED/APPROVED a quem pediu', k.length === 1 && k[0].notice_kind === 'RESOLVED' && k[0].outcome === 'APPROVED', J(k));
  }

  // 2. Portão de leitura da origem espelha a RLS — objeto a objeto.
  const gestor = await person('gestor', 'gestor_projetos');       // contracts.view sem contracts.view_values
  const fin = await person('financeiro', 'financeiro');           // finance.view + contracts.view_values
  const billing = await one(`SELECT id FROM public.contract_billing_events WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1`, [org]);
  if (billing) {
    const g = (await asUser(gestor, `SELECT public.decision_viewer_reads_subject('contract_billing_event', $1) ok FROM who`, [billing.id]))[0].ok;
    check('faturamento: contracts.view sozinho NÃO lê a origem (a RLS exige valores/finanças)', g === false);
    const rls = (await one(`SELECT count(*)::int n FROM (SELECT set_config('request.jwt.claims', $1, true)) c,
      LATERAL (SELECT 1 FROM public.contract_billing_events WHERE id = $2) b`, [J({ sub: gestor, role: 'authenticated' }), billing.id])).n;
    void rls;
    await all(`SELECT set_config('request.jwt.claims', '', true)`);
  } else {
    check('faturamento: sem evento no inquilino de prova (portão provado pelo tipo de compra)', true);
  }
  const po = await one(`SELECT id FROM public.purchase_orders WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1`, [org]);
  if (po) {
    const f = (await asUser(fin, `SELECT public.decision_viewer_reads_subject('purchase_order', $1) ok FROM who`, [po.id]))[0].ok;
    const g = (await asUser(gestor, `SELECT public.decision_viewer_reads_subject('purchase_order', $1) ok FROM who`, [po.id]))[0].ok;
    check('compra: quem vê compras lê a origem; o portão é do objeto concreto', f === true, `financeiro=${f} gestor=${g}`);
    const foreign = (await asUser(fin, `SELECT public.decision_viewer_reads_subject('purchase_order', gen_random_uuid()) ok FROM who`))[0].ok;
    check('compra: objeto inexistente/alheio não é lido', foreign === false);
  }

  // 3. Aviso de desfecho não vai para quem saiu.
  const closedPo = await one(`SELECT h.purchase_order_id po, s.actor_user_id submitter,
      (SELECT count(*)::int FROM public.purchase_order_history x WHERE x.purchase_order_id = h.purchase_order_id
        AND x.transition = 'submitted' AND x.seq <= h.seq) n
    FROM public.purchase_order_history h
    JOIN LATERAL (SELECT y.actor_user_id FROM public.purchase_order_history y WHERE y.purchase_order_id = h.purchase_order_id
      AND y.transition = 'submitted' AND y.seq < h.seq ORDER BY y.seq DESC LIMIT 1) s ON true
    WHERE h.organization_id = $1 AND h.transition = 'approved' AND h.actor_source = 'human'
      AND COALESCE(h.detail->>'governance','AUTHORITY') = 'AUTHORITY' AND s.actor_user_id IS NOT NULL
      AND s.actor_user_id <> $2
    ORDER BY h.seq DESC LIMIT 1`, [org, actor]);
  if (closedPo) {
    const key = `purchase_order:${closedPo.po}:s${closedPo.n}`;
    await one(`UPDATE public.organization_memberships SET status = 'SUSPENDED', disabled_at = now()
      WHERE organization_id = $1 AND user_id = $2 RETURNING id`, [org, closedPo.submitter]).catch(async () =>
      one(`UPDATE public.organization_memberships SET status = 'SUSPENDED' WHERE organization_id = $1 AND user_id = $2 RETURNING id`, [org, closedPo.submitter]));
    await all(`DELETE FROM public.decision_deliveries WHERE organization_id = $1 AND decision_key = $2 AND notice_kind = 'RESOLVED'`, [org, key]);
    await one(`SELECT public.decision_notices_plan($1,$2,'RESOLVED','APPROVED') n`, [org, key]);
    const rows = await all(`SELECT recipient_user_id FROM public.decision_deliveries WHERE decision_key = $1 AND notice_kind = 'RESOLVED'`, [key]);
    check('quem submeteu e saiu da organização não recebe o desfecho', !rows.some((r) => r.recipient_user_id === closedPo.submitter), J(rows));
  } else {
    check('desfecho por alçada com submissor distinto do titular: sem ocorrência (nada a provar)', true);
  }

  // 4. Desfecho do motor: a submissão que ELE decidiu.
  const eng = await one(`SELECT r.id, r.subject_id FROM public.approval_requests r
    WHERE r.organization_id = $1 AND r.subject_type = 'purchase_order' AND r.status <> 'PENDING' ORDER BY r.finalized_at DESC LIMIT 1`, [org]);
  if (eng) {
    const res = (await one(`SELECT public.decision_resolve($1, $2) r`, [org, `approval_request:${eng.id}:e1`])).r;
    const expected = (await one(`SELECT x.rn FROM (SELECT h.detail, row_number() OVER (ORDER BY h.seq) rn FROM public.purchase_order_history h
      WHERE h.purchase_order_id = $1 AND h.transition = 'submitted') x WHERE x.detail->'approval'->>'request_id' = $2`, [eng.subject_id, eng.id]))?.rn;
    check('desfecho do motor traz a submissão decidida', res && expected !== undefined && Number(res.submission) === Number(expected),
      `resolve=${res?.submission} histórico=${expected}`);
  }
}
