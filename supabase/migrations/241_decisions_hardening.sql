-- ============================================================================
-- 241 — DECISÕES: ENDURECIMENTO APÓS REVISÃO ADVERSARIAL
--
-- Nada de modelo novo. Cinco correções verificadas contra o QA isolado:
--
--  1. decision_keys_for_event: `organization_id` é também variável de saída
--     (RETURNS TABLE) — todo fato approval.* levantava 42702 (coluna ambígua),
--     o trabalho de aviso ia para a carta morta e o desfecho do motor não era
--     avisado a quem pediu. Colunas qualificadas + `#variable_conflict use_column`.
--  2. decision_viewer_reads_subject passa a receber o SUJEITO e espelha a RLS
--     da origem: faturamento exige contracts.view_values OU finance.view E a
--     leitura do contrato (ou do engajamento), como contract_billing_events_
--     select_scoped — não mais "contracts.view", que era mais frouxo.
--  3. decision_notices_plan: aviso de desfecho só para quem ainda é membro
--     ATIVO (quem saiu recebia o e-mail; o in-app já recusava).
--  4. decision_resolve (motor, pedido de compra): informa a SUBMISSÃO que o
--     pedido do motor decidiu, para o detalhe não mostrar a nota da última.
--  5. Portas do navegador atualizadas para a nova assinatura.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.decision_viewer_reads_subject(text) CASCADE;

/*
  "Esta pessoa já lê o objeto de origem?" — a MESMA pergunta que a RLS da
  origem responde, para o objeto concreto. É o que libera valor na Equipe e a
  leitura de detalhe como SOURCE_READER.
*/
CREATE FUNCTION public.decision_viewer_reads_subject(p_subject_type text, p_subject_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE p_subject_type
    WHEN 'purchase_order' THEN
      (public.current_user_has_permission('procurement.view') OR public.current_user_has_permission('supply.view'))
      AND EXISTS (SELECT 1 FROM public.purchase_orders p
                   WHERE p.organization_id = public.current_user_organization_id() AND p.id = p_subject_id)
    WHEN 'contract_billing_event' THEN EXISTS (
      SELECT 1 FROM public.contract_billing_events b
       WHERE b.organization_id = public.current_user_organization_id() AND b.id = p_subject_id
         AND (public.current_user_has_permission('contracts.view_values') OR public.current_user_has_permission('finance.view'))
         AND ((b.contract_id IS NOT NULL AND public.current_user_can_read_contract(b.contract_id))
              OR (b.contract_id IS NULL AND b.engagement_id IS NOT NULL AND public.current_user_has_permission('contracts.view'))))
    ELSE false END
$$;
REVOKE ALL ON FUNCTION public.decision_viewer_reads_subject(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decision_viewer_reads_subject(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.decision_team_for_viewer() RETURNS SETOF public.decision_team_item
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE org uuid := public.current_user_organization_id(); scope text := public.decision_team_scope_for_viewer();
        members uuid[]; it public.decision_team_item;
BEGIN
  IF org IS NULL OR scope = 'NONE' THEN RETURN; END IF;
  IF scope = 'DIRECT_REPORTS' THEN
    SELECT COALESCE(array_agg(pr.user_id), '{}') INTO members
      FROM public.people p JOIN public.profiles pr ON pr.id = p.profile_id
     WHERE p.organization_id = org AND p.status = 'active'
       AND p.manager_person_id = public.current_user_person_id();
  END IF;
  FOR it IN SELECT * FROM public.decision_open_all(org) LOOP
    IF scope = 'DIRECT_REPORTS' AND NOT (
         it.requested_by = ANY (members)
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(it.assignees) e
                     WHERE (e->>'user_id')::uuid = ANY (members))) THEN
      CONTINUE;
    END IF;
    -- Valor só para quem já lê o domínio de origem. "Restrito", nunca zero.
    IF NOT public.decision_viewer_reads_subject(it.subject_type, it.subject_id) THEN
      it.amount := NULL; it.amount_restricted := true;
    END IF;
    RETURN NEXT it;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.decision_access_for_viewer(p_key text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE org uuid := public.current_user_organization_id(); uid uuid := auth.uid(); r jsonb; a text;
BEGIN
  IF org IS NULL OR uid IS NULL OR p_key IS NULL THEN RETURN NULL; END IF;
  r := public.decision_resolve(org, p_key);
  IF r IS NULL THEN RETURN NULL; END IF;
  SELECT i.assignment INTO a FROM public.decision_inbox(org, uid) i WHERE i.decision_key = p_key;
  IF a IN ('PRIMARY', 'ESCALATED') THEN RETURN 'DECIDER'; END IF;
  IF a = 'ELIGIBLE' THEN RETURN 'ELIGIBLE'; END IF;
  IF (r->>'requested_by')::uuid = uid OR (r->>'closed_by')::uuid = uid
     OR EXISTS (SELECT 1 FROM public.decision_history(org, uid, 1000) h WHERE h.decision_key = p_key)
     OR EXISTS (SELECT 1 FROM public.decision_deliveries d
                 WHERE d.organization_id = org AND d.decision_key = p_key AND d.recipient_user_id = uid) THEN
    RETURN 'PARTICIPANT';
  END IF;
  IF public.decision_viewer_reads_subject(r->>'subject_type', (r->>'subject_id')::uuid) THEN RETURN 'SOURCE_READER'; END IF;
  IF EXISTS (SELECT 1 FROM public.decision_team_for_viewer() t WHERE t.decision_key = p_key) THEN RETURN 'TEAM'; END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.decision_keys_for_event(p_event_id uuid)
RETURNS TABLE (organization_id uuid, decision_key text, notice_kind text, outcome text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE ev public.domain_events%ROWTYPE; req public.approval_requests%ROWTYPE; last_stage integer; n integer := 0;
BEGIN
  SELECT * INTO ev FROM public.domain_events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF ev.event_type LIKE 'approval.%' AND ev.aggregate_type = 'approval_request' THEN
    SELECT ar.* INTO req FROM public.approval_requests ar WHERE ar.organization_id = ev.organization_id AND ar.id = ev.aggregate_id;
    IF NOT FOUND OR req.subject_type NOT IN ('purchase_order', 'contract_billing_event') THEN RETURN; END IF;
    IF ev.event_type = 'approval.stage.opened' THEN
      RETURN QUERY SELECT ev.organization_id,
        'approval_request:' || req.id || ':e' || (ev.payload->>'stage_no'), 'NEW'::text, NULL::text;
      RETURN;
    END IF;
    SELECT max(x.stage_no) INTO last_stage FROM public.approval_request_stages x
     WHERE x.organization_id = ev.organization_id AND x.request_id = req.id AND x.opened_at IS NOT NULL;
    last_stage := COALESCE(last_stage, 1);
    RETURN QUERY SELECT ev.organization_id, 'approval_request:' || req.id || ':e' || last_stage,
      CASE ev.event_type WHEN 'approval.request.returned_for_correction' THEN 'ADJUSTMENT_REQUESTED' ELSE 'RESOLVED' END,
      CASE ev.event_type WHEN 'approval.request.approved' THEN 'APPROVED'
                         WHEN 'approval.request.rejected' THEN 'REJECTED'
                         WHEN 'approval.request.expired' THEN 'EXPIRED' END
     WHERE ev.event_type IN ('approval.request.approved', 'approval.request.rejected',
                             'approval.request.returned_for_correction', 'approval.request.expired');
    RETURN;
  END IF;

  IF ev.event_type LIKE 'supply.purchase_order.%' THEN
    /*
      purchase_order_log chaveia o fato por 'purchase-order:<id>:<transição>:<N>',
      N = posição da linha de histórico recém-gravada. A submissão vigente no
      fato é a contagem de 'submitted' entre as N primeiras linhas (em seq).
    */
    SELECT count(*) FILTER (WHERE x.transition = 'submitted')::int INTO n
      FROM (SELECT h.transition FROM public.purchase_order_history h
             WHERE h.organization_id = ev.organization_id AND h.purchase_order_id = ev.aggregate_id
             ORDER BY h.seq
             LIMIT NULLIF(split_part(ev.idempotency_key, ':', 4), '')::int) x;
    IF n < 1 THEN RETURN; END IF;
    IF ev.event_type = 'supply.purchase_order.submitted' AND ev.payload->>'governance' = 'AUTHORITY' THEN
      RETURN QUERY SELECT ev.organization_id, 'purchase_order:' || ev.aggregate_id || ':s' || n, 'NEW'::text, NULL::text;
    ELSIF ev.event_type = 'supply.purchase_order.approved' AND ev.payload->>'governance' = 'AUTHORITY' THEN
      RETURN QUERY SELECT ev.organization_id, 'purchase_order:' || ev.aggregate_id || ':s' || n, 'RESOLVED'::text, 'APPROVED'::text;
    ELSIF ev.event_type = 'supply.purchase_order.rejected' AND ev.payload->>'approval_request_id' IS NULL THEN
      RETURN QUERY SELECT ev.organization_id, 'purchase_order:' || ev.aggregate_id || ':s' || n, 'ADJUSTMENT_REQUESTED'::text, NULL::text;
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.decision_notices_plan(p_org uuid, p_key text, p_kind text, p_outcome text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r jsonb; rec record; ch text; st record; n integer := 0; v_key text; v_id uuid;
BEGIN
  IF p_kind NOT IN ('NEW', 'DUE_SOON', 'OVERDUE', 'ESCALATED', 'RESOLVED', 'ADJUSTMENT_REQUESTED') THEN
    RAISE EXCEPTION 'Tipo de aviso inválido: %.', p_kind USING ERRCODE = '22023';
  END IF;
  IF (p_kind = 'RESOLVED') <> (p_outcome IS NOT NULL) THEN
    RAISE EXCEPTION 'Aviso de desfecho exige o desfecho (e só ele).' USING ERRCODE = '22023';
  END IF;
  r := public.decision_resolve(p_org, p_key);
  IF r IS NULL THEN RETURN 0; END IF;
  IF p_kind IN ('NEW', 'DUE_SOON', 'OVERDUE', 'ESCALATED') AND NOT COALESCE((r->>'open')::boolean, false) THEN
    RETURN 0;
  END IF;

  FOR rec IN
    SELECT a.user_id, CASE WHEN p_kind = 'ESCALATED' THEN 'ESCALATION' ELSE 'DECIDER' END AS role
      FROM public.decision_assignees(p_org, p_key) a
     WHERE (p_kind IN ('NEW', 'DUE_SOON', 'OVERDUE') AND a.assignment = 'PRIMARY')
        OR (p_kind = 'ESCALATED' AND a.assignment = 'ESCALATED')
    UNION
    SELECT u.user_id, 'REQUESTER'
      FROM (SELECT (r->>'requested_by')::uuid AS user_id
            UNION SELECT (r->>'created_by')::uuid WHERE r->>'source_kind' = 'PROCUREMENT_AUTHORITY') u
     WHERE p_kind IN ('RESOLVED', 'ADJUSTMENT_REQUESTED') AND u.user_id IS NOT NULL
       AND u.user_id IS DISTINCT FROM (r->>'closed_by')::uuid
       -- 241: quem saiu da organização não recebe aviso dela (a regra de create_notification_for, 195).
       AND EXISTS (SELECT 1 FROM public.organization_memberships m
                    WHERE m.organization_id = p_org AND m.user_id = u.user_id AND m.status = 'ACTIVE')
  LOOP
    FOREACH ch IN ARRAY public.decision_notice_channels(p_kind) LOOP
      SELECT * INTO st FROM public.decision_channel_initial_state(p_org, rec.user_id, ch);
      v_key := concat_ws('|', p_key, p_kind, COALESCE(p_outcome, '-'), rec.user_id::text, ch);
      INSERT INTO public.decision_deliveries (
        organization_id, decision_key, subject_type, subject_id, notice_kind, outcome,
        recipient_user_id, recipient_role, channel, state, failure_code, idempotency_key)
      VALUES (p_org, p_key, r->>'subject_type', (r->>'subject_id')::uuid, p_kind, p_outcome,
              rec.user_id, rec.role, ch, st.state, st.code, v_key)
      ON CONFLICT (organization_id, idempotency_key) DO NOTHING
      RETURNING id INTO v_id;
      IF v_id IS NOT NULL THEN n := n + 1; v_id := NULL; END IF;
    END LOOP;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.decision_resolve(p_org uuid, p_key text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m text[]; v_id uuid; n integer;
  po public.purchase_orders%ROWTYPE; sub record; nxt bigint; out_row record; cur integer;
  req public.approval_requests%ROWTYPE; stg public.approval_request_stages%ROWTYPE; dec record;
  v_open boolean; v_outcome text; v_live boolean;
BEGIN
  IF p_org IS NULL OR p_key IS NULL THEN RETURN NULL; END IF;

  m := regexp_match(p_key, '^purchase_order:([0-9a-f-]{36}):s([0-9]+)$');
  IF m IS NOT NULL THEN
    v_id := m[1]::uuid; n := m[2]::int;
    SELECT * INTO po FROM public.purchase_orders WHERE organization_id = p_org AND id = v_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT h.* INTO sub FROM (
      SELECT h.*, row_number() OVER (ORDER BY h.seq) AS rn
        FROM public.purchase_order_history h
       WHERE h.organization_id = p_org AND h.purchase_order_id = v_id AND h.transition = 'submitted') h
     WHERE h.rn = n;
    IF NOT FOUND OR COALESCE(sub.detail->>'governance', '') <> 'AUTHORITY' THEN RETURN NULL; END IF;
    SELECT min(h.seq) INTO nxt FROM public.purchase_order_history h
     WHERE h.organization_id = p_org AND h.purchase_order_id = v_id AND h.transition = 'submitted'
       AND h.seq > sub.seq;
    SELECT h.* INTO out_row FROM public.purchase_order_history h
     WHERE h.organization_id = p_org AND h.purchase_order_id = v_id
       AND h.transition IN ('approved', 'rejected', 'cancelled')
       AND h.seq > sub.seq AND (nxt IS NULL OR h.seq < nxt)
     ORDER BY h.seq LIMIT 1;
    cur := public.decision_po_submission(p_org, v_id);
    v_open := out_row.id IS NULL AND cur = n AND po.status = 'APPROVAL_REQUIRED' AND po.approval_governance = 'AUTHORITY';
    v_outcome := CASE out_row.transition WHEN 'approved' THEN 'APPROVED'
                                         WHEN 'rejected' THEN 'ADJUSTMENT_REQUESTED'
                                         WHEN 'cancelled' THEN 'CANCELLED' END;
    RETURN jsonb_build_object(
      'decision_key', p_key, 'source_kind', 'PROCUREMENT_AUTHORITY', 'category', 'compras',
      'subject_type', 'purchase_order', 'subject_id', v_id, 'action_type', 'approve',
      'submission', n, 'current_submission', cur,
      'title', 'Pedido de compra ' || po.order_number, 'order_number', po.order_number,
      'amount', COALESCE((out_row.detail->>'total')::numeric, public.purchase_order_total(v_id)),
      'currency', po.currency, 'project_id', po.project_id, 'supplier_id', po.supplier_id,
      'requested_by', sub.actor_user_id, 'requested_at', sub.occurred_at, 'request_note', sub.reason,
      'created_by', po.created_by,
      'open', v_open, 'outcome', v_outcome,
      'closed_by', out_row.actor_user_id, 'closed_at', out_row.occurred_at, 'reason', out_row.reason,
      'record_id', out_row.id,
      'authority_id', COALESCE(out_row.detail->>'authority_id', CASE WHEN out_row.transition = 'approved' THEN po.approval_authority_id::text END),
      'fingerprint', CASE WHEN v_open THEN public.purchase_order_fingerprint(v_id) ELSE out_row.detail->>'fingerprint' END,
      'subject_status', po.status);
  END IF;

  m := regexp_match(p_key, '^approval_request:([0-9a-f-]{36}):e([0-9]+)$');
  IF m IS NOT NULL THEN
    v_id := m[1]::uuid; n := m[2]::int;
    SELECT * INTO req FROM public.approval_requests WHERE organization_id = p_org AND id = v_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT * INTO stg FROM public.approval_request_stages
     WHERE organization_id = p_org AND request_id = v_id AND stage_no = n;
    IF NOT FOUND THEN RETURN NULL; END IF;
    v_live := public.decision_engine_subject_live(p_org, req.subject_type, req.subject_id, req.id);
    v_open := req.status = 'PENDING' AND stg.status = 'OPEN' AND v_live
              AND (req.expires_at IS NULL OR req.expires_at > now());
    SELECT d.* INTO dec FROM public.approval_decisions d
     WHERE d.organization_id = p_org AND d.request_id = v_id AND d.stage_no = n
     ORDER BY d.decided_at DESC LIMIT 1;
    v_outcome := CASE
      WHEN v_open THEN NULL
      WHEN stg.status = 'APPROVED' THEN 'APPROVED'
      WHEN stg.status = 'REJECTED' THEN 'REJECTED'
      WHEN stg.status = 'RETURNED' THEN 'ADJUSTMENT_REQUESTED'
      WHEN stg.status = 'EXPIRED' OR req.status = 'EXPIRED' THEN 'EXPIRED'
      WHEN stg.status = 'OPEN' AND req.status = 'PENDING' AND req.expires_at IS NOT NULL AND req.expires_at <= now() THEN 'EXPIRED'
      WHEN stg.status = 'WAITING' THEN NULL
      ELSE 'CANCELLED' END;
    RETURN jsonb_build_object(
      'decision_key', p_key, 'source_kind', 'APPROVAL_ENGINE', 'category', public.decision_category(req.subject_type),
      'subject_type', req.subject_type, 'subject_id', req.subject_id, 'action_type', req.action_type,
      'request_id', req.id, 'stage_no', n, 'stage_name', stg.name, 'stage_status', stg.status,
      -- 241: a submissão que ESTE pedido do motor decidiu (não a última do pedido de compra).
      'submission', CASE WHEN req.subject_type = 'purchase_order' THEN (
        SELECT x.rn FROM (
          SELECT h.detail, row_number() OVER (ORDER BY h.seq) AS rn FROM public.purchase_order_history h
           WHERE h.organization_id = p_org AND h.purchase_order_id = req.subject_id AND h.transition = 'submitted') x
         WHERE x.detail->'approval'->>'request_id' = req.id::text LIMIT 1) END,
      'request_status', req.status, 'policy_key', req.policy_key, 'policy_version_no', req.policy_version_no,
      'title', req.subject_label, 'amount', req.subject_amount, 'currency', req.subject_currency,
      'project_id', CASE WHEN req.subject_type = 'purchase_order' THEN
                      (SELECT p.project_id FROM public.purchase_orders p WHERE p.organization_id = p_org AND p.id = req.subject_id) END,
      'requested_by', req.requested_by, 'requested_at', req.requested_at, 'request_note', req.request_reason,
      'created_by', req.subject_created_by,
      'due_at', req.expires_at,
      'open', v_open, 'waiting', stg.status = 'WAITING', 'subject_live', v_live, 'outcome', v_outcome,
      'closed_by', COALESCE(dec.actor_user_id, CASE WHEN NOT v_open THEN req.finalized_by END),
      'closed_at', COALESCE(dec.decided_at, CASE WHEN NOT v_open THEN req.finalized_at END),
      'reason', COALESCE(dec.reason, CASE WHEN NOT v_open THEN req.outcome_reason END),
      'record_id', dec.id,
      'authority_source', dec.authority_source, 'authority_basis', dec.authority_basis,
      'authority_limit', dec.authority_limit_amount, 'authority_currency', dec.authority_currency,
      'fingerprint', req.subject_fingerprint);
  END IF;

  RETURN NULL;
END $$;

-- Grants preservados pelo CREATE OR REPLACE; reafirmados por clareza.
REVOKE ALL ON FUNCTION public.decision_team_for_viewer() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decision_team_for_viewer() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.decision_access_for_viewer(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decision_access_for_viewer(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.decision_keys_for_event(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decision_keys_for_event(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.decision_notices_plan(uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decision_notices_plan(uuid,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.decision_resolve(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decision_resolve(uuid,text) TO service_role;

COMMIT;
