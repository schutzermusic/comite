-- ============================================================================
-- 236 — INTELIGÊNCIA DE SUPPLY: recomendações explicáveis, atos governados
--
-- ─── O que a Apex faz aqui ──────────────────────────────────────────────
--
-- OBSERVA a cobertura, as entradas, os fornecedores e o estoque; INFERE o
-- risco (falta, ETA depois da necessidade, entrada atrasada, fornecedor pouco
-- pontual, decisão parada, inspeção esquecida); RECOMENDA uma ação com
-- evidência e justificativa; quando uma pessoa ACEITA, executa o MESMO ato
-- governado que a pessoa executaria à mão (reservar, pedir transferência,
-- requisitar compra) — com a identidade dela e todas as checagens do banco;
-- VERIFICA: a cada leitura, o que deixou de ser verdade é resolvido sozinho;
-- ESCALA pelo acompanhamento do Apex (156) quando alguém assume a cobrança.
--
-- ─── O que a Apex NÃO faz ───────────────────────────────────────────────
-- Não recebe material, não consome estoque, não aprova nem emite compra, não
-- decide sozinha (INV-15, INV-16). Recomendação não é verdade: é uma linha
-- deste livro, com versão do motor, evidência e o desfecho humano.
--
-- ─── Por que um livro, e não só uma tela ────────────────────────────────
-- Para responder depois: o que a Apex recomendou, quando, com base em quê,
-- quem aceitou ou descartou (e por quê), e o que foi executado.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) O livro de recomendações
-- ---------------------------------------------------------------------------
CREATE TABLE public.supply_signals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  signal_key         text NOT NULL CHECK (btrim(signal_key) <> ''),
  kind               text NOT NULL CHECK (kind IN ('SHORTAGE','ALTERNATE_STOCK','ETA_RISK','LATE_INBOUND',
                                                   'SUPPLIER_RELIABILITY','DECISION_PENDING','INSPECTION_AGING')),
  severity           text NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  status             text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','EXECUTED','DISMISSED','RESOLVED')),
  project_id         text,
  requirement_id     uuid,
  purchase_order_id  uuid,
  transfer_id        uuid,
  supplier_id        uuid,
  item_id            uuid,
  location_id        uuid,
  title              text NOT NULL CHECK (btrim(title) <> ''),
  rationale          text NOT NULL CHECK (btrim(rationale) <> ''),
  evidence           jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array'),
  recommended_action jsonb NOT NULL CHECK (jsonb_typeof(recommended_action) = 'object'
                                           AND recommended_action->>'kind' IN ('RESERVE','TRANSFER','REQUISITION','FOLLOW_UP','OPEN')),
  engine_version     text NOT NULL,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at        timestamptz,
  decided_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at         timestamptz,
  decision_note      text,
  execution_result   jsonb,
  followup_id        uuid,

  CONSTRAINT ssig_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT ssig_key_unique UNIQUE (organization_id, signal_key),
  -- Derivado: não segura a remoção de nada (some junto com o que o originou).
  CONSTRAINT ssig_project_tenant FOREIGN KEY (organization_id, project_id) REFERENCES public.projects (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT ssig_requirement_tenant FOREIGN KEY (organization_id, requirement_id)
    REFERENCES public.project_requirements (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT ssig_po_tenant FOREIGN KEY (organization_id, purchase_order_id) REFERENCES public.purchase_orders (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT ssig_transfer_tenant FOREIGN KEY (organization_id, transfer_id) REFERENCES public.inventory_transfers (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT ssig_supplier_tenant FOREIGN KEY (organization_id, supplier_id) REFERENCES public.supplier_profiles (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT ssig_item_tenant FOREIGN KEY (organization_id, item_id) REFERENCES public.supply_items (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT ssig_location_tenant FOREIGN KEY (organization_id, location_id) REFERENCES public.inventory_locations (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT ssig_followup_tenant FOREIGN KEY (organization_id, followup_id) REFERENCES public.apex_followups (organization_id, id) ON DELETE SET NULL (followup_id),
  -- Decisão humana é nomeada; recomendação resolvida sabe quando.
  CONSTRAINT ssig_decided_named CHECK (status NOT IN ('EXECUTED','DISMISSED') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT ssig_dismiss_reason CHECK (status <> 'DISMISSED' OR nullif(btrim(decision_note),'') IS NOT NULL),
  CONSTRAINT ssig_resolved_at CHECK ((status = 'RESOLVED') = (resolved_at IS NOT NULL))
);
CREATE INDEX ssig_open ON public.supply_signals (organization_id, status, severity) WHERE status = 'OPEN';
CREATE INDEX ssig_project ON public.supply_signals (organization_id, project_id) WHERE project_id IS NOT NULL;

CREATE TABLE public.supply_signal_history (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  signal_id         uuid NOT NULL,
  transition        text NOT NULL CHECK (transition IN ('opened','reopened','resolved','dismissed','executed','followed_up')),
  actor_kind        text NOT NULL CHECK (actor_kind IN ('apex','human')),
  actor_user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note              text,
  snapshot          jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ssigh_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT ssigh_signal_tenant FOREIGN KEY (organization_id, signal_id) REFERENCES public.supply_signals (organization_id, id) ON DELETE CASCADE,
  -- A Apex abre, reabre e resolve; só pessoa descarta, executa ou assume acompanhamento.
  CONSTRAINT ssigh_actor_coherent CHECK (
    (actor_kind = 'apex' AND transition IN ('opened','reopened','resolved') AND actor_user_id IS NULL)
    OR (actor_kind = 'human' AND transition IN ('dismissed','executed','followed_up') AND actor_user_id IS NOT NULL))
);
CREATE INDEX ssigh_signal ON public.supply_signal_history (organization_id, signal_id, occurred_at);
CREATE TRIGGER ssigh_no_rewrite BEFORE UPDATE ON public.supply_signal_history
  FOR EACH ROW EXECUTE FUNCTION public.operations_reject_history_rewrite();
-- Apagar só pelo caminho privilegiado (o sinal derivado some com a origem; o navegador nunca apaga).
CREATE TRIGGER ssigh_no_erasure BEFORE DELETE ON public.supply_signal_history
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

-- Quando a Apex leu pela última vez (a tela diz "leitura de há N minutos").
CREATE TABLE public.supply_intelligence_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  engine_version   text NOT NULL,
  opened           integer NOT NULL DEFAULT 0,
  updated          integer NOT NULL DEFAULT 0,
  resolved         integer NOT NULL DEFAULT 0,
  ran_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sir_org_id_unique UNIQUE (organization_id, id)
);
CREATE INDEX sir_recent ON public.supply_intelligence_runs (organization_id, ran_at DESC);

-- ---------------------------------------------------------------------------
-- 2) A Apex sincroniza a leitura (sistema; sem ator humano)
-- ---------------------------------------------------------------------------
/*
  Cada sinal vem com a CHAVE da condição (ex.: falta do requisito X para a
  data D). Novo → abre. Aberto → atualiza evidência e severidade. Resolvido
  ou executado cuja condição voltou → reabre (a ação não bastou: verificação).
  Descartado → continua descartado enquanto a condição for a mesma (a pessoa
  já disse não). Aberto que não veio nesta leitura → resolvido: a condição
  deixou de ser verdade.
*/
CREATE OR REPLACE FUNCTION public.supply_signals_sync(p_organization_id uuid, p_signals jsonb, p_engine_version text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s jsonb; v public.supply_signals%ROWTYPE; v_keys text[] := '{}'; v_opened int := 0; v_updated int := 0; v_resolved int := 0;
BEGIN
  IF jsonb_typeof(p_signals) <> 'array' THEN RAISE EXCEPTION 'Signals must be an array.' USING ERRCODE = '22023'; END IF;
  -- Uma leitura por inquilino por vez.
  PERFORM pg_advisory_xact_lock(hashtextextended('supply-intelligence:' || p_organization_id::text, 0));
  FOR s IN SELECT * FROM jsonb_array_elements(p_signals) LOOP
    v_keys := array_append(v_keys, s->>'signal_key');
    SELECT * INTO v FROM public.supply_signals WHERE organization_id = p_organization_id AND signal_key = s->>'signal_key' FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.supply_signals (organization_id, signal_key, kind, severity, project_id, requirement_id, purchase_order_id,
        transfer_id, supplier_id, item_id, location_id, title, rationale, evidence, recommended_action, engine_version)
      VALUES (p_organization_id, s->>'signal_key', s->>'kind', s->>'severity', nullif(s->>'project_id',''),
        nullif(s->>'requirement_id','')::uuid, nullif(s->>'purchase_order_id','')::uuid, nullif(s->>'transfer_id','')::uuid,
        nullif(s->>'supplier_id','')::uuid, nullif(s->>'item_id','')::uuid, nullif(s->>'location_id','')::uuid,
        s->>'title', s->>'rationale', COALESCE(s->'evidence','[]'::jsonb), s->'recommended_action', p_engine_version)
      RETURNING * INTO v;
      INSERT INTO public.supply_signal_history (organization_id, signal_id, transition, actor_kind, snapshot)
      VALUES (p_organization_id, v.id, 'opened', 'apex', s);
      v_opened := v_opened + 1;
    ELSE
      UPDATE public.supply_signals SET
        severity = s->>'severity', title = s->>'title', rationale = s->>'rationale', evidence = COALESCE(s->'evidence','[]'::jsonb),
        recommended_action = CASE WHEN status = 'OPEN' OR status IN ('RESOLVED','EXECUTED') THEN s->'recommended_action' ELSE recommended_action END,
        engine_version = p_engine_version, last_seen_at = now(),
        status = CASE WHEN status IN ('RESOLVED','EXECUTED') THEN 'OPEN' ELSE status END,
        resolved_at = CASE WHEN status IN ('RESOLVED','EXECUTED') THEN NULL ELSE resolved_at END
      WHERE id = v.id;
      IF v.status IN ('RESOLVED','EXECUTED') THEN
        INSERT INTO public.supply_signal_history (organization_id, signal_id, transition, actor_kind, note, snapshot)
        VALUES (p_organization_id, v.id, 'reopened', 'apex',
          CASE WHEN v.status = 'EXECUTED' THEN 'A condição persiste depois da ação executada.' ELSE 'A condição voltou.' END, s);
        v_opened := v_opened + 1;
      ELSE
        v_updated := v_updated + 1;
      END IF;
    END IF;
  END LOOP;

  FOR v IN SELECT * FROM public.supply_signals WHERE organization_id = p_organization_id AND status = 'OPEN'
            AND NOT (signal_key = ANY (v_keys)) FOR UPDATE LOOP
    UPDATE public.supply_signals SET status = 'RESOLVED', resolved_at = now() WHERE id = v.id;
    INSERT INTO public.supply_signal_history (organization_id, signal_id, transition, actor_kind, note)
    VALUES (p_organization_id, v.id, 'resolved', 'apex', 'A condição deixou de ser verdade na leitura.');
    v_resolved := v_resolved + 1;
  END LOOP;

  INSERT INTO public.supply_intelligence_runs (organization_id, engine_version, opened, updated, resolved)
  VALUES (p_organization_id, p_engine_version, v_opened, v_updated, v_resolved);
  RETURN jsonb_build_object('opened', v_opened, 'updated', v_updated, 'resolved', v_resolved);
END $$;

-- ---------------------------------------------------------------------------
-- 3) Pessoa decide: descartar (com motivo) ou executar (o ato governado)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.supply_signal_dismiss(p_organization_id uuid, p_actor uuid, p_signal_id uuid, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.supply_signals%ROWTYPE;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor,
    ARRAY['supply.plan','inventory.reserve','inventory.manage','procurement.request','procurement.source','receiving.receive']);
  IF nullif(btrim(p_note),'') IS NULL THEN RAISE EXCEPTION 'Dismissing a recommendation requires a reason.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v FROM public.supply_signals WHERE organization_id = p_organization_id AND id = p_signal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recommendation not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF v.status <> 'OPEN' THEN RAISE EXCEPTION 'Recommendation is %: nothing to decide.', v.status USING ERRCODE = '23514'; END IF;
  UPDATE public.supply_signals SET status = 'DISMISSED', decided_by = p_actor, decided_at = now(), decision_note = btrim(p_note)
   WHERE id = v.id;
  INSERT INTO public.supply_signal_history (organization_id, signal_id, transition, actor_kind, actor_user_id, note)
  VALUES (p_organization_id, v.id, 'dismissed', 'human', p_actor, btrim(p_note));
  PERFORM public.emit_domain_event(p_organization_id, 'supply.signal.dismissed', 1, 'supply_signal', v.id,
    'supply-signal:' || v.id || ':dismissed:' || extract(epoch FROM clock_timestamp())::text,
    jsonb_build_object('project_id', v.project_id, 'kind', v.kind, 'title', v.title, 'reason', btrim(p_note)), now(), 'human', p_actor);
  RETURN jsonb_build_object('signal_id', v.id, 'status', 'DISMISSED');
END $$;

/*
  EXECUTAR é chamar o ato governado que a recomendação descreve, com a
  identidade de quem aceitou. Cada ato refaz suas próprias checagens
  (alçada, disponibilidade, sobre-cobertura, idempotência pela chave do
  sinal). `p_overrides` deixa a pessoa ajustar a quantidade ou o local —
  o banco decide se cabe.
*/
CREATE OR REPLACE FUNCTION public.supply_signal_execute(p_organization_id uuid, p_actor uuid, p_signal_id uuid, p_overrides jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.supply_signals%ROWTYPE; a jsonb; v_kind text; v_out jsonb; v_qty numeric; v_key text;
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Executing a recommendation requires a named person.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.supply_signals WHERE organization_id = p_organization_id AND id = p_signal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recommendation not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF v.status <> 'OPEN' THEN RAISE EXCEPTION 'Recommendation is %: nothing to execute.', v.status USING ERRCODE = '23514'; END IF;
  a := v.recommended_action->'payload';
  v_kind := v.recommended_action->>'kind';
  v_qty := COALESCE(nullif(p_overrides->>'quantity','')::numeric, (a->>'quantity')::numeric);
  -- A chave muda a cada execução do mesmo sinal (reaberto porque a ação não bastou): repetir o
  -- clique é idempotente, executar de novo depois de reabrir é um ato novo.
  v_key := 'signal:' || v.id || ':' || (SELECT count(*) FROM public.supply_signal_history h
                                          WHERE h.signal_id = v.id AND h.transition = 'executed');

  IF v_kind = 'RESERVE' THEN
    v_out := public.inventory_reserve(p_organization_id, p_actor, jsonb_build_object(
      'requirement_id', a->>'requirement_id', 'location_id', COALESCE(nullif(p_overrides->>'location_id',''), a->>'location_id'),
      'quantity', v_qty, 'idempotency_key', v_key, 'note', 'Recomendação da Apex: ' || v.title));
  ELSIF v_kind = 'TRANSFER' THEN
    v_out := public.inventory_transfer_request(p_organization_id, p_actor, jsonb_build_object(
      'from_location_id', COALESCE(nullif(p_overrides->>'from_location_id',''), a->>'from_location_id'),
      'to_location_id', COALESCE(nullif(p_overrides->>'to_location_id',''), a->>'to_location_id'),
      'expected_arrival', a->>'expected_arrival', 'idempotency_key', v_key, 'note', 'Recomendação da Apex: ' || v.title,
      'lines', jsonb_build_array(jsonb_build_object('item_id', a->>'item_id', 'quantity', v_qty, 'requirement_id', a->>'requirement_id'))));
  ELSIF v_kind = 'REQUISITION' THEN
    v_out := public.purchase_requisition_from_shortage(p_organization_id, p_actor, jsonb_build_object(
      'requirement_ids', a->'requirement_ids', 'idempotency_key', v_key, 'priority', COALESCE(a->>'priority', 'high'),
      'delivery_location_id', a->>'delivery_location_id', 'justification', 'Recomendação da Apex: ' || v.rationale));
  ELSE
    RAISE EXCEPTION 'Recommendation % is not executable: follow it up or open the related record.', v_kind USING ERRCODE = '22023';
  END IF;

  UPDATE public.supply_signals SET status = 'EXECUTED', decided_by = p_actor, decided_at = now(),
    decision_note = nullif(btrim(p_overrides->>'note'),''), execution_result = jsonb_build_object('kind', v_kind, 'result', v_out)
  WHERE id = v.id;
  INSERT INTO public.supply_signal_history (organization_id, signal_id, transition, actor_kind, actor_user_id, note, snapshot)
  VALUES (p_organization_id, v.id, 'executed', 'human', p_actor, nullif(btrim(p_overrides->>'note'),''),
    jsonb_build_object('kind', v_kind, 'overrides', p_overrides, 'result', v_out));
  PERFORM public.emit_domain_event(p_organization_id, 'supply.signal.executed', 1, 'supply_signal', v.id,
    'supply-signal:' || v.id || ':executed:' || extract(epoch FROM clock_timestamp())::text,
    jsonb_build_object('project_id', v.project_id, 'kind', v.kind, 'action', v_kind, 'title', v.title, 'result', v_out),
    now(), 'human', p_actor);
  RETURN jsonb_build_object('signal_id', v.id, 'status', 'EXECUTED', 'action', v_kind, 'result', v_out);
END $$;

-- Liga a recomendação ao acompanhamento aberto por uma pessoa (sessão) para ela.
CREATE OR REPLACE FUNCTION public.supply_signal_link_followup(p_organization_id uuid, p_actor uuid, p_signal_id uuid, p_followup_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.supply_signals%ROWTYPE;
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Following up requires a named person.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.supply_signals WHERE organization_id = p_organization_id AND id = p_signal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recommendation not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.apex_followups WHERE organization_id = p_organization_id AND id = p_followup_id) THEN
    RAISE EXCEPTION 'Follow-up not found in tenant.' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.supply_signals SET followup_id = p_followup_id WHERE id = v.id;
  INSERT INTO public.supply_signal_history (organization_id, signal_id, transition, actor_kind, actor_user_id, snapshot)
  VALUES (p_organization_id, v.id, 'followed_up', 'human', p_actor, jsonb_build_object('followup_id', p_followup_id));
  RETURN jsonb_build_object('signal_id', v.id, 'followup_id', p_followup_id);
END $$;

-- ---------------------------------------------------------------------------
-- 4) O acompanhamento do Apex (156) aprende as origens de Supply
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apex_followup_supply_source_kinds() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY[
  'project_requirement',
  'purchase_order',
  'inventory_transfer',
  'goods_receipt'
] $$;

-- Autoridade ÚNICA da lista (206): cresce, nunca encolhe.
CREATE OR REPLACE FUNCTION public.apex_followup_source_kinds() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY[
  'contract',
  'contract_clause',
  'contract_obligation_instance',
  'contract_billing_condition',
  'contract_risk',
  'contract_guarantee',
  'contract_insurance_requirement',
  'commercial_opportunity',
  'commercial_proposal',
  'commercial_engagement',
  'internal_service_order',
  -- ---- Supply (236) ----
  'project_requirement',
  'purchase_order',
  'inventory_transfer',
  'goods_receipt'
] $$;

-- A alçada é a do domínio de onde o acompanhamento nasce (212), agora também Supply.
CREATE OR REPLACE FUNCTION public.apex_followup_authority_ok(p_source_kind text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  IF public.current_user_is_admin() THEN RETURN true; END IF;
  IF p_source_kind = ANY (public.apex_followup_commercial_source_kinds()) THEN
    RETURN public.current_user_has_permission('commercial.manage')
        OR public.current_user_has_permission('contracts.edit');
  END IF;
  IF p_source_kind = ANY (public.apex_followup_supply_source_kinds()) THEN
    RETURN public.current_user_has_permission('supply.plan')
        OR public.current_user_has_permission('procurement.source')
        OR public.current_user_has_permission('procurement.orders.issue')
        OR public.current_user_has_permission('inventory.manage')
        OR public.current_user_has_permission('receiving.receive');
  END IF;
  RETURN public.current_user_has_permission('contracts.edit');
END $$;
REVOKE ALL ON FUNCTION public.apex_followup_authority_ok(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apex_followup_authority_ok(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) Privilégios e RLS
-- ---------------------------------------------------------------------------
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['supply_signals_sync(uuid,jsonb,text)', 'supply_signal_dismiss(uuid,uuid,uuid,text)',
      'supply_signal_execute(uuid,uuid,uuid,jsonb)', 'supply_signal_link_followup(uuid,uuid,uuid,uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['supply_signals','supply_signal_history','supply_intelligence_runs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
      USING (organization_id = public.current_user_organization_id()
         AND (public.current_user_has_permission('supply.view') OR public.current_user_has_permission('procurement.view')
              OR public.current_user_has_permission('inventory.view') OR public.current_user_has_permission('receiving.view')
              OR public.current_user_has_permission('operations.planning.view') OR public.current_user_has_permission('projects.view')))$p$,
      t || '_select', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
  END LOOP;
END $$;

COMMIT;
