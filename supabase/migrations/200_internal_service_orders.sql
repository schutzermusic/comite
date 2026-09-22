-- ============================================================================
-- 200 — ORDEM DE SERVIÇO INTERNA e as funções governadas do comercial
--
-- ─── O que a OS interna É, e o que ela NÃO é ─────────────────────────────
--
-- É a autorização OPERACIONAL da Insight para começar a executar. Quem a
-- emite é a Insight, para a Insight.
--
-- NÃO é o pedido de compra do cliente, NÃO é a OS do cliente e NÃO é o
-- contrato. Esses três são FONTES DE AUTORIZAÇÃO e moram em
-- `commercial_engagement_authorizations`. Confundi-los faria a plataforma
-- tratar um documento da Insight como se fosse manifestação do cliente — e é
-- justamente essa confusão que permite faturar sem direito.
--
-- ─── Nenhuma escolha silenciosa ──────────────────────────────────────────
--
-- Quando a OS carregada discorda da proposta regente, o sistema NÃO escolhe.
-- Ele registra a divergência, deixa a OS em `PENDING_CONFIRMATION`, e a
-- emissão fica estruturalmente bloqueada enquanto houver divergência
-- `BLOCKING` aberta. A decisão é humana, nomeada e carimbada.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Divergência ganha o campo da OS — mesma tabela, mesmo confronto
-- ---------------------------------------------------------------------------
ALTER TABLE public.commercial_divergences
  ADD COLUMN IF NOT EXISTS service_order_id uuid;

-- ---------------------------------------------------------------------------
-- 2) A OS interna
-- ---------------------------------------------------------------------------
CREATE TABLE public.internal_service_orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  engagement_id       uuid NOT NULL,

  os_number           text NOT NULL CHECK (btrim(os_number) <> ''),
  title               text NOT NULL CHECK (btrim(title) <> ''),

  origin              text NOT NULL
                        CHECK (origin IN ('from_accepted_proposal','manual','uploaded_document')),
  source_proposal_revision_id uuid,
  -- PDF canônico da OS quando ela veio de fora. Mesmo acervo, mesmo id.
  document_id         uuid,
  intake_id           uuid,

  /*
    `PENDING_CONFIRMATION` é o estado do §7: existe OS, existe proposta, e elas
    discordam. A OS não é rejeitada nem aceita — ela ESPERA decisão humana.
    Sem esse estado, a alternativa seria emitir escolhendo uma das fontes, que
    é exatamente o que "never silently choose" proíbe.
  */
  status              text NOT NULL DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT','PENDING_CONFIRMATION','ISSUED',
                                          'IN_EXECUTION','SUSPENDED','CLOSED','CANCELLED')),

  authorized_value    numeric(18,2),
  currency            text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  scope_summary       text,
  planned_start       date,
  planned_finish      date,

  issued_at           timestamptz,
  issued_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_at           timestamptz,
  cancelled_at        timestamptz,

  project_id          text,
  responsible_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes               text,

  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT iso_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT iso_number_unique UNIQUE (organization_id, os_number),
  CONSTRAINT iso_engagement_tenant FOREIGN KEY (organization_id, engagement_id)
    REFERENCES public.commercial_engagements (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT iso_revision_tenant FOREIGN KEY (organization_id, source_proposal_revision_id)
    REFERENCES public.commercial_proposal_revisions (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT iso_document_tenant FOREIGN KEY (organization_id, document_id)
    REFERENCES public.contract_documents (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT iso_intake_tenant FOREIGN KEY (organization_id, intake_id)
    REFERENCES public.contract_onboarding_intakes (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT iso_project_tenant FOREIGN KEY (organization_id, project_id)
    REFERENCES public.projects (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT iso_origin_matches_source CHECK (
    CASE origin
      WHEN 'from_accepted_proposal' THEN source_proposal_revision_id IS NOT NULL
      WHEN 'uploaded_document'      THEN document_id IS NOT NULL
      ELSE true
    END),
  CONSTRAINT iso_issued_coherent CHECK (
    (status IN ('ISSUED','IN_EXECUTION','SUSPENDED','CLOSED')) = (issued_at IS NOT NULL)),
  CONSTRAINT iso_issued_is_attributed CHECK (issued_at IS NULL OR issued_by IS NOT NULL),
  CONSTRAINT iso_closed_coherent CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
  CONSTRAINT iso_cancelled_coherent CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  CONSTRAINT iso_value_needs_currency CHECK (authorized_value IS NULL OR currency IS NOT NULL),
  CONSTRAINT iso_period_order CHECK (
    planned_start IS NULL OR planned_finish IS NULL OR planned_finish >= planned_start)
);
CREATE INDEX iso_engagement ON public.internal_service_orders (organization_id, engagement_id);
CREATE INDEX iso_status ON public.internal_service_orders (organization_id, status);
CREATE INDEX iso_project ON public.internal_service_orders (organization_id, project_id)
  WHERE project_id IS NOT NULL;

ALTER TABLE public.commercial_divergences
  ADD CONSTRAINT cd_service_order_tenant FOREIGN KEY (organization_id, service_order_id)
    REFERENCES public.internal_service_orders (organization_id, id) ON DELETE CASCADE;

COMMENT ON TABLE public.internal_service_orders IS
  'Autorização OPERACIONAL interna da Insight. NÃO é pedido de compra do cliente, OS do cliente nem contrato.';

/*
  O portão de emissão. Enquanto houver divergência BLOCKING aberta ligada à OS
  ou ao engajamento, `ISSUED` é inalcançável — por gatilho, não por tela.
*/
CREATE OR REPLACE FUNCTION public.internal_service_order_issue_gate()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_blocking int; v_authorized int;
BEGIN
  IF NEW.status <> 'ISSUED' OR OLD.status = 'ISSUED' THEN RETURN NEW; END IF;

  SELECT count(*)::int INTO v_blocking
    FROM public.commercial_divergences d
   WHERE d.organization_id = NEW.organization_id
     AND d.severity = 'BLOCKING' AND d.state = 'OPEN'
     AND (d.service_order_id = NEW.id OR d.engagement_id = NEW.engagement_id);
  IF v_blocking > 0 THEN
    RAISE EXCEPTION 'Service order cannot be issued: % blocking divergence(s) still open.', v_blocking
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::int INTO v_authorized
    FROM public.commercial_engagement_authorizations a
   WHERE a.organization_id = NEW.organization_id
     AND a.engagement_id = NEW.engagement_id
     AND a.state = 'ACTIVE' AND a.governing;
  IF v_authorized = 0 THEN
    RAISE EXCEPTION 'Service order cannot be issued: engagement has no governing authorization.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER iso_issue_gate BEFORE UPDATE OF status ON public.internal_service_orders
  FOR EACH ROW EXECUTE FUNCTION public.internal_service_order_issue_gate();

CREATE TRIGGER iso_touch BEFORE UPDATE ON public.internal_service_orders
  FOR EACH ROW EXECUTE FUNCTION public.commercial_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3) História append-only do engajamento
-- ---------------------------------------------------------------------------
CREATE TABLE public.commercial_engagement_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  engagement_id   uuid NOT NULL,
  transition      text NOT NULL CHECK (btrim(transition) <> ''),
  from_state      text,
  to_state        text,
  actor_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_source    text NOT NULL DEFAULT 'human'
                    CHECK (actor_source IN ('human','system','integration')),
  note            text,
  provenance      jsonb NOT NULL DEFAULT '{}'::jsonb
                    CHECK (jsonb_typeof(provenance) = 'object'),
  occurred_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ceh_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT ceh_engagement_tenant FOREIGN KEY (organization_id, engagement_id)
    REFERENCES public.commercial_engagements (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX ceh_engagement ON public.commercial_engagement_history (organization_id, engagement_id, occurred_at DESC);

-- Append-only de verdade: UPDATE e DELETE recusados no nível do banco.
CREATE OR REPLACE FUNCTION public.commercial_history_is_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'commercial_engagement_history is append-only.' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER ceh_append_only BEFORE UPDATE OR DELETE ON public.commercial_engagement_history
  FOR EACH ROW EXECUTE FUNCTION public.commercial_history_is_append_only();

-- ---------------------------------------------------------------------------
-- 4) Funções governadas
--
-- Todas SECURITY DEFINER, todas NEGADAS a `authenticated`, todas exigindo um
-- ator humano nomeado. O mesmo contrato de 166/192: o navegador nunca escreve
-- direto; o servidor decide a autorização e chama daqui.
-- ---------------------------------------------------------------------------

-- 4.1 Criar engajamento (entrada da Carteira: contrato, proposta, pedido, manual)
CREATE OR REPLACE FUNCTION public.commercial_engagement_create(
  p_organization_id uuid, p_actor uuid, p_payload jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_origin text;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Engagement creation denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Engagement creation requires a named actor.' USING ERRCODE = '42501';
  END IF;
  v_origin := COALESCE(nullif(btrim(p_payload->>'origin'), ''), 'manual');

  INSERT INTO public.commercial_engagements (
    organization_id, engagement_number, title, counterparty_party_id, counterparty_name,
    currency, status, origin, owner_user_id, notes, created_by)
  VALUES (
    p_organization_id,
    nullif(btrim(p_payload->>'engagement_number'), ''),
    p_payload->>'title',
    nullif(p_payload->>'counterparty_party_id','')::uuid,
    p_payload->>'counterparty_name',
    COALESCE(nullif(btrim(p_payload->>'currency'), ''), 'BRL'),
    -- Toda entrada nasce EM ANÁLISE (§6). Nenhum KPI de valor autorizado se
    -- mexe por causa de um cadastro.
    'UNDER_ANALYSIS',
    v_origin,
    COALESCE(nullif(p_payload->>'owner_user_id','')::uuid, p_actor),
    nullif(btrim(p_payload->>'notes'), ''),
    p_actor)
  RETURNING id INTO v_id;

  INSERT INTO public.commercial_engagement_history (
    organization_id, engagement_id, transition, to_state, actor_user_id, provenance)
  VALUES (p_organization_id, v_id, 'created', 'UNDER_ANALYSIS', p_actor,
          jsonb_build_object('origin', v_origin));
  RETURN v_id;
END $$;

-- 4.2 Anexar fonte de autorização — e COMPARAR com a regente, sem sobrescrever
CREATE OR REPLACE FUNCTION public.commercial_engagement_attach_authorization(
  p_organization_id uuid, p_actor uuid, p_engagement_id uuid, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid; v_kind text; v_governing_row public.commercial_engagement_authorizations%ROWTYPE;
  v_has_governing boolean; v_new_value numeric; v_divergences int := 0;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Authorization attachment denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Authorization attachment requires a named actor.' USING ERRCODE = '42501';
  END IF;

  v_kind := p_payload->>'source_kind';
  SELECT * INTO v_governing_row FROM public.commercial_engagement_authorizations
   WHERE organization_id = p_organization_id AND engagement_id = p_engagement_id
     AND governing AND state = 'ACTIVE';
  v_has_governing := FOUND;
  v_new_value := nullif(p_payload->>'authorized_value','')::numeric;

  INSERT INTO public.commercial_engagement_authorizations (
    organization_id, engagement_id, source_kind, contract_id, proposal_revision_id,
    document_id, external_reference, authorized_value, currency,
    effective_from, effective_until,
    -- NUNCA rege automaticamente quando já existe regente (§D). Promover é ato
    -- humano separado, por `commercial_engagement_set_governing`.
    governing, state, note, created_by)
  VALUES (
    p_organization_id, p_engagement_id, v_kind,
    nullif(p_payload->>'contract_id','')::uuid,
    nullif(p_payload->>'proposal_revision_id','')::uuid,
    nullif(p_payload->>'document_id','')::uuid,
    nullif(btrim(p_payload->>'external_reference'), ''),
    v_new_value,
    nullif(btrim(p_payload->>'currency'), ''),
    nullif(p_payload->>'effective_from','')::date,
    nullif(p_payload->>'effective_until','')::date,
    NOT v_has_governing, 'ACTIVE',
    nullif(btrim(p_payload->>'note'), ''), p_actor)
  RETURNING id INTO v_id;

  -- Confronto com a regente. Valor é o primeiro fato comparável porque é o que
  -- o faturamento usa; divergência de valor é BLOCKING por isso.
  IF v_has_governing AND v_new_value IS NOT NULL
     AND v_governing_row.authorized_value IS NOT NULL
     AND v_new_value <> v_governing_row.authorized_value THEN
    INSERT INTO public.commercial_divergences (
      organization_id, engagement_id, scope, field_path,
      left_source_kind, left_source_id, left_value,
      right_source_kind, right_source_id, right_value,
      severity, summary, detected_by)
    VALUES (
      p_organization_id, p_engagement_id, 'VALUE', 'authorized_value',
      v_governing_row.source_kind, v_governing_row.id, v_governing_row.authorized_value::text,
      v_kind, v_id, v_new_value::text,
      'BLOCKING',
      format('Valor autorizado difere entre a fonte regente (%s) e a fonte anexada (%s).',
             v_governing_row.authorized_value, v_new_value),
      'rule');
    v_divergences := v_divergences + 1;
  END IF;

  INSERT INTO public.commercial_engagement_history (
    organization_id, engagement_id, transition, actor_user_id, note, provenance)
  VALUES (p_organization_id, p_engagement_id, 'authorization_attached', p_actor,
          nullif(btrim(p_payload->>'note'), ''),
          jsonb_build_object('authorization_id', v_id, 'source_kind', v_kind,
                             'governing', NOT v_has_governing, 'divergences', v_divergences));

  RETURN jsonb_build_object('authorization_id', v_id, 'governing', NOT v_has_governing,
                            'divergences_opened', v_divergences);
END $$;

-- 4.3 Trocar a fonte regente — sempre explícito, sempre nomeado
CREATE OR REPLACE FUNCTION public.commercial_engagement_set_governing(
  p_organization_id uuid, p_actor uuid, p_authorization_id uuid, p_note text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row public.commercial_engagement_authorizations%ROWTYPE; v_previous uuid;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Governing source change denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL OR nullif(btrim(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'Changing the governing source requires a named actor and a written reason.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.commercial_engagement_authorizations
   WHERE organization_id = p_organization_id AND id = p_authorization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Authorization not found in tenant.' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.state <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Only an ACTIVE authorization may govern.' USING ERRCODE = '23514';
  END IF;

  SELECT id INTO v_previous FROM public.commercial_engagement_authorizations
   WHERE organization_id = p_organization_id AND engagement_id = v_row.engagement_id
     AND governing AND state = 'ACTIVE';

  UPDATE public.commercial_engagement_authorizations SET governing = false
   WHERE organization_id = p_organization_id AND engagement_id = v_row.engagement_id
     AND governing AND state = 'ACTIVE';
  UPDATE public.commercial_engagement_authorizations SET governing = true
   WHERE organization_id = p_organization_id AND id = p_authorization_id;

  INSERT INTO public.commercial_engagement_history (
    organization_id, engagement_id, transition, from_state, to_state, actor_user_id, note, provenance)
  VALUES (p_organization_id, v_row.engagement_id, 'governing_source_changed',
          v_previous::text, p_authorization_id::text, p_actor, p_note,
          jsonb_build_object('previous_authorization_id', v_previous,
                             'new_authorization_id', p_authorization_id));

  RETURN jsonb_build_object('engagement_id', v_row.engagement_id,
                            'previous_authorization_id', v_previous,
                            'authorization_id', p_authorization_id);
END $$;

-- 4.4 Promover o engajamento de "em análise" para "autorizado"
CREATE OR REPLACE FUNCTION public.commercial_engagement_authorize(
  p_organization_id uuid, p_actor uuid, p_engagement_id uuid, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row public.commercial_engagements%ROWTYPE; v_gov public.commercial_engagement_authorizations%ROWTYPE;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Engagement authorization denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Engagement authorization requires a named actor.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.commercial_engagements
   WHERE organization_id = p_organization_id AND id = p_engagement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Engagement not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF v_row.status = 'AUTHORIZED' THEN
    RETURN jsonb_build_object('engagement_id', p_engagement_id, 'status', 'AUTHORIZED', 'reused', true);
  END IF;
  IF v_row.status <> 'UNDER_ANALYSIS' THEN
    RAISE EXCEPTION 'Engagement is %, only UNDER_ANALYSIS may be authorized.', v_row.status
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_gov FROM public.commercial_engagement_authorizations
   WHERE organization_id = p_organization_id AND engagement_id = p_engagement_id
     AND governing AND state = 'ACTIVE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Engagement has no governing authorization: nothing authorizes this work.'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.commercial_engagements
     SET status = 'AUTHORIZED', authorized_at = now(), authorized_by = p_actor,
         -- Valor autorizado é DERIVADO da fonte regente. Nunca digitado à parte.
         authorized_value = v_gov.authorized_value,
         currency = COALESCE(v_gov.currency, currency)
   WHERE organization_id = p_organization_id AND id = p_engagement_id;

  INSERT INTO public.commercial_engagement_history (
    organization_id, engagement_id, transition, from_state, to_state, actor_user_id, note, provenance)
  VALUES (p_organization_id, p_engagement_id, 'authorized', 'UNDER_ANALYSIS', 'AUTHORIZED',
          p_actor, p_note,
          jsonb_build_object('governing_authorization_id', v_gov.id,
                             'source_kind', v_gov.source_kind,
                             'authorized_value', v_gov.authorized_value));

  RETURN jsonb_build_object('engagement_id', p_engagement_id, 'status', 'AUTHORIZED',
                            'governing_source_kind', v_gov.source_kind);
END $$;

-- 4.5 Registrar a manifestação do cliente sobre uma revisão de proposta
CREATE OR REPLACE FUNCTION public.commercial_proposal_revision_record_outcome(
  p_organization_id uuid, p_actor uuid, p_revision_id uuid, p_outcome text, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row public.commercial_proposal_revisions%ROWTYPE;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Recording a customer outcome is denied.' USING ERRCODE = '42501';
  END IF;
  /*
    A IA NÃO chega aqui. `p_actor` é o humano da Insight que responde pelo
    registro, e sem ele a função falha — não há caminho "sistema aceitou".
  */
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Customer outcome must be recorded by a named human actor.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.commercial_proposal_revisions
   WHERE organization_id = p_organization_id AND id = p_revision_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proposal revision not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF v_row.status NOT IN ('SENT','NEGOTIATION') THEN
    RAISE EXCEPTION 'Revision is %, only SENT or NEGOTIATION may receive a customer outcome.', v_row.status
      USING ERRCODE = '23514';
  END IF;

  IF p_outcome = 'ACCEPTED' THEN
    IF nullif(btrim(p_payload->>'acceptance_source'), '') IS NULL THEN
      RAISE EXCEPTION 'Acceptance must state how the customer manifested it.' USING ERRCODE = '23514';
    END IF;
    UPDATE public.commercial_proposal_revisions
       SET status = 'ACCEPTED', accepted_at = now(),
           acceptance_source = p_payload->>'acceptance_source',
           acceptance_document_id = nullif(p_payload->>'acceptance_document_id','')::uuid,
           acceptance_external_ref = nullif(btrim(p_payload->>'acceptance_external_ref'), ''),
           acceptance_note = nullif(btrim(p_payload->>'acceptance_note'), ''),
           recorded_by = p_actor
     WHERE organization_id = p_organization_id AND id = p_revision_id;
  ELSIF p_outcome = 'REJECTED' THEN
    UPDATE public.commercial_proposal_revisions
       SET status = 'REJECTED', rejected_at = now(),
           rejection_reason = nullif(btrim(p_payload->>'rejection_reason'), ''),
           recorded_by = p_actor
     WHERE organization_id = p_organization_id AND id = p_revision_id;
  ELSIF p_outcome = 'EXPIRED' THEN
    UPDATE public.commercial_proposal_revisions
       SET status = 'EXPIRED', expired_at = now(), recorded_by = p_actor
     WHERE organization_id = p_organization_id AND id = p_revision_id;
  ELSE
    RAISE EXCEPTION 'Unsupported outcome %.', p_outcome USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object('revision_id', p_revision_id, 'status', p_outcome);
END $$;

-- 4.6 Criar OS interna a partir da proposta aceita, ou manualmente, ou de upload
CREATE OR REPLACE FUNCTION public.internal_service_order_create(
  p_organization_id uuid, p_actor uuid, p_engagement_id uuid, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid; v_origin text; v_revision public.commercial_proposal_revisions%ROWTYPE;
  v_status text; v_divergences int := 0; v_value numeric; v_currency text;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Service order creation denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Service order creation requires a named actor.' USING ERRCODE = '42501';
  END IF;

  v_origin := p_payload->>'origin';
  v_value := nullif(p_payload->>'authorized_value','')::numeric;
  v_currency := nullif(btrim(p_payload->>'currency'), '');

  IF v_origin = 'from_accepted_proposal' THEN
    SELECT * INTO v_revision FROM public.commercial_proposal_revisions
     WHERE organization_id = p_organization_id
       AND id = nullif(p_payload->>'source_proposal_revision_id','')::uuid;
    IF NOT FOUND OR v_revision.status <> 'ACCEPTED' THEN
      RAISE EXCEPTION 'Only an ACCEPTED proposal revision may produce a service order.'
        USING ERRCODE = '23514';
    END IF;
    -- Herda o que a proposta diz. Nada é redigitado (§8).
    v_value := COALESCE(v_value, v_revision.total_value);
    v_currency := COALESCE(v_currency, v_revision.currency);
  END IF;

  v_status := 'DRAFT';

  INSERT INTO public.internal_service_orders (
    organization_id, engagement_id, os_number, title, origin,
    source_proposal_revision_id, document_id, intake_id, status,
    authorized_value, currency, scope_summary, planned_start, planned_finish,
    responsible_user_id, notes, created_by)
  VALUES (
    p_organization_id, p_engagement_id,
    p_payload->>'os_number', p_payload->>'title', v_origin,
    nullif(p_payload->>'source_proposal_revision_id','')::uuid,
    nullif(p_payload->>'document_id','')::uuid,
    nullif(p_payload->>'intake_id','')::uuid,
    v_status, v_value, v_currency,
    COALESCE(nullif(btrim(p_payload->>'scope_summary'), ''), v_revision.scope_summary),
    nullif(p_payload->>'planned_start','')::date,
    nullif(p_payload->>'planned_finish','')::date,
    COALESCE(nullif(p_payload->>'responsible_user_id','')::uuid, p_actor),
    nullif(btrim(p_payload->>'notes'), ''), p_actor)
  RETURNING id INTO v_id;

  INSERT INTO public.commercial_engagement_history (
    organization_id, engagement_id, transition, to_state, actor_user_id, provenance)
  VALUES (p_organization_id, p_engagement_id, 'service_order_created', v_status, p_actor,
          jsonb_build_object('service_order_id', v_id, 'origin', v_origin));

  RETURN jsonb_build_object('service_order_id', v_id, 'status', v_status,
                            'divergences_opened', v_divergences);
END $$;

-- 4.7 Confrontar a OS carregada com a fonte regente
CREATE OR REPLACE FUNCTION public.internal_service_order_compare_with_governing(
  p_organization_id uuid, p_service_order_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_os public.internal_service_orders%ROWTYPE;
  v_gov public.commercial_engagement_authorizations%ROWTYPE;
  v_rev public.commercial_proposal_revisions%ROWTYPE;
  v_opened int := 0;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Service order comparison denied.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_os FROM public.internal_service_orders
   WHERE organization_id = p_organization_id AND id = p_service_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service order not found in tenant.' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_gov FROM public.commercial_engagement_authorizations
   WHERE organization_id = p_organization_id AND engagement_id = v_os.engagement_id
     AND governing AND state = 'ACTIVE';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('service_order_id', p_service_order_id,
                              'compared', false, 'reason', 'NO_GOVERNING_SOURCE');
  END IF;

  IF v_gov.proposal_revision_id IS NOT NULL THEN
    SELECT * INTO v_rev FROM public.commercial_proposal_revisions
     WHERE organization_id = p_organization_id AND id = v_gov.proposal_revision_id;
  END IF;

  -- VALOR. Divergência de valor bloqueia: é o número que o faturamento usa.
  IF v_os.authorized_value IS NOT NULL AND v_gov.authorized_value IS NOT NULL
     AND v_os.authorized_value <> v_gov.authorized_value THEN
    INSERT INTO public.commercial_divergences (
      organization_id, engagement_id, service_order_id, scope, field_path,
      left_source_kind, left_source_id, left_value,
      right_source_kind, right_source_id, right_value,
      severity, summary, detected_by)
    VALUES (p_organization_id, v_os.engagement_id, v_os.id, 'VALUE', 'authorized_value',
            v_gov.source_kind, v_gov.id, v_gov.authorized_value::text,
            'internal_service_order', v_os.id, v_os.authorized_value::text,
            'BLOCKING',
            format('OS interna declara %s; a fonte regente declara %s.',
                   v_os.authorized_value, v_gov.authorized_value),
            'rule');
    v_opened := v_opened + 1;
  END IF;

  -- DATAS contra a vigência da fonte regente.
  IF v_os.planned_finish IS NOT NULL AND v_gov.effective_until IS NOT NULL
     AND v_os.planned_finish > v_gov.effective_until THEN
    INSERT INTO public.commercial_divergences (
      organization_id, engagement_id, service_order_id, scope, field_path,
      left_source_kind, left_source_id, left_value,
      right_source_kind, right_source_id, right_value,
      severity, summary, detected_by)
    VALUES (p_organization_id, v_os.engagement_id, v_os.id, 'DATES', 'planned_finish',
            v_gov.source_kind, v_gov.id, v_gov.effective_until::text,
            'internal_service_order', v_os.id, v_os.planned_finish::text,
            'WARNING',
            'Término planejado na OS interna ultrapassa a vigência da fonte regente.',
            'rule');
    v_opened := v_opened + 1;
  END IF;

  -- ESCOPO: comparação textual literal é ruim, então a regra NÃO afirma
  -- divergência de escopo. Ela afirma apenas a AUSÊNCIA de escopo comparável,
  -- que é um fato verificável. Divergência semântica de escopo é trabalho de
  -- leitura assistida e entra por `detected_by = 'ai'` com proveniência.
  IF v_rev.id IS NOT NULL
     AND nullif(btrim(v_os.scope_summary), '') IS NULL
     AND nullif(btrim(v_rev.scope_summary), '') IS NOT NULL THEN
    INSERT INTO public.commercial_divergences (
      organization_id, engagement_id, service_order_id, scope, field_path,
      left_source_kind, left_source_id, left_value,
      right_source_kind, right_source_id, right_value,
      severity, summary, detected_by)
    VALUES (p_organization_id, v_os.engagement_id, v_os.id, 'SCOPE', 'scope_summary',
            'accepted_proposal', v_rev.id, left(v_rev.scope_summary, 500),
            'internal_service_order', v_os.id, NULL,
            'WARNING', 'A OS interna não declara escopo; a proposta regente declara.', 'rule');
    v_opened := v_opened + 1;
  END IF;

  IF v_opened > 0 AND v_os.status = 'DRAFT' THEN
    UPDATE public.internal_service_orders SET status = 'PENDING_CONFIRMATION'
     WHERE organization_id = p_organization_id AND id = p_service_order_id;
  END IF;

  RETURN jsonb_build_object('service_order_id', p_service_order_id, 'compared', true,
                            'divergences_opened', v_opened,
                            'governing_source_kind', v_gov.source_kind);
END $$;

-- 4.8 Resolver divergência — sempre nomeando a fonte que prevalece
CREATE OR REPLACE FUNCTION public.commercial_divergence_resolve(
  p_organization_id uuid, p_actor uuid, p_divergence_id uuid,
  p_resolved_source_kind text, p_note text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row public.commercial_divergences%ROWTYPE;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Divergence resolution denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL OR nullif(btrim(p_resolved_source_kind), '') IS NULL THEN
    RAISE EXCEPTION 'Resolving a divergence requires a named actor and the prevailing source.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.commercial_divergences
   WHERE organization_id = p_organization_id AND id = p_divergence_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Divergence not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF v_row.state IN ('RESOLVED','DISMISSED') THEN
    RETURN jsonb_build_object('divergence_id', p_divergence_id, 'state', v_row.state, 'reused', true);
  END IF;

  UPDATE public.commercial_divergences
     SET state = 'RESOLVED', resolved_source_kind = p_resolved_source_kind,
         resolution_note = p_note, resolved_by = p_actor, resolved_at = now()
   WHERE organization_id = p_organization_id AND id = p_divergence_id;

  INSERT INTO public.commercial_engagement_history (
    organization_id, engagement_id, transition, actor_user_id, note, provenance)
  VALUES (p_organization_id, v_row.engagement_id, 'divergence_resolved', p_actor, p_note,
          jsonb_build_object('divergence_id', p_divergence_id, 'scope', v_row.scope,
                             'prevailing_source', p_resolved_source_kind));

  RETURN jsonb_build_object('divergence_id', p_divergence_id, 'state', 'RESOLVED');
END $$;

-- 4.9 Emitir a OS
CREATE OR REPLACE FUNCTION public.internal_service_order_issue(
  p_organization_id uuid, p_actor uuid, p_service_order_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_os public.internal_service_orders%ROWTYPE;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Service order issuance denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Service order issuance requires a named actor.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_os FROM public.internal_service_orders
   WHERE organization_id = p_organization_id AND id = p_service_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service order not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF v_os.status = 'ISSUED' THEN
    RETURN jsonb_build_object('service_order_id', p_service_order_id, 'status', 'ISSUED', 'reused', true);
  END IF;

  -- O gatilho `iso_issue_gate` é quem recusa de fato; aqui só carimbamos.
  UPDATE public.internal_service_orders
     SET status = 'ISSUED', issued_at = now(), issued_by = p_actor
   WHERE organization_id = p_organization_id AND id = p_service_order_id;

  INSERT INTO public.commercial_engagement_history (
    organization_id, engagement_id, transition, from_state, to_state, actor_user_id, provenance)
  VALUES (p_organization_id, v_os.engagement_id, 'service_order_issued', v_os.status, 'ISSUED',
          p_actor, jsonb_build_object('service_order_id', p_service_order_id));

  RETURN jsonb_build_object('service_order_id', p_service_order_id, 'status', 'ISSUED');
END $$;

-- 4.10 OS → Projeto (criar novo ou vincular existente)
CREATE OR REPLACE FUNCTION public.internal_service_order_bind_project(
  p_organization_id uuid, p_actor uuid, p_service_order_id uuid,
  p_project_id text, p_project_payload jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_os public.internal_service_orders%ROWTYPE;
  v_eng public.commercial_engagements%ROWTYPE;
  v_created boolean := false; v_contract uuid;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Project binding denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Project binding requires a named actor.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_os FROM public.internal_service_orders
   WHERE organization_id = p_organization_id AND id = p_service_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service order not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  /*
    O projeto nasce da OS EMITIDA, nunca de um rascunho. Uma OS em
    `PENDING_CONFIRMATION` tem divergência aberta, e abrir projeto ali seria
    executar sob duas verdades.
  */
  IF v_os.status NOT IN ('ISSUED','IN_EXECUTION') THEN
    RAISE EXCEPTION 'Service order is %, only an ISSUED order may bind a project.', v_os.status
      USING ERRCODE = '23514';
  END IF;
  IF v_os.project_id IS NOT NULL THEN
    RETURN jsonb_build_object('service_order_id', p_service_order_id,
                              'project_id', v_os.project_id, 'reused', true);
  END IF;

  SELECT * INTO v_eng FROM public.commercial_engagements
   WHERE organization_id = p_organization_id AND id = v_os.engagement_id;

  IF NOT EXISTS (SELECT 1 FROM public.projects
                  WHERE organization_id = p_organization_id AND id = p_project_id) THEN
    IF p_project_payload IS NULL THEN
      RAISE EXCEPTION 'Project % does not exist and no payload was supplied.', p_project_id
        USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.projects (id, organization_id, project, created_by)
    VALUES (p_project_id, p_organization_id,
            p_project_payload || jsonb_build_object('id', p_project_id), p_actor);
    v_created := true;
  END IF;

  INSERT INTO public.engagement_project_links (organization_id, engagement_id, project_id, linked_by)
  VALUES (p_organization_id, v_os.engagement_id, p_project_id, p_actor)
  ON CONFLICT (organization_id, engagement_id, project_id) DO NOTHING;

  -- Quando o trabalho É contratado, o vínculo canônico contrato↔projeto
  -- continua existindo — o motor de medição contratual depende dele.
  SELECT a.contract_id INTO v_contract
    FROM public.commercial_engagement_authorizations a
   WHERE a.organization_id = p_organization_id AND a.engagement_id = v_os.engagement_id
     AND a.governing AND a.state = 'ACTIVE' AND a.contract_id IS NOT NULL;
  IF v_contract IS NOT NULL THEN
    INSERT INTO public.contract_project_links (organization_id, contract_id, project_id)
    VALUES (p_organization_id, v_contract, p_project_id)
    ON CONFLICT (organization_id, contract_id, project_id) DO NOTHING;
  END IF;

  UPDATE public.internal_service_orders
     SET project_id = p_project_id,
         status = CASE WHEN status = 'ISSUED' THEN 'IN_EXECUTION' ELSE status END
   WHERE organization_id = p_organization_id AND id = p_service_order_id;

  INSERT INTO public.commercial_engagement_history (
    organization_id, engagement_id, transition, actor_user_id, provenance)
  VALUES (p_organization_id, v_os.engagement_id,
          CASE WHEN v_created THEN 'project_created' ELSE 'project_linked' END, p_actor,
          jsonb_build_object('service_order_id', p_service_order_id,
                             'project_id', p_project_id, 'created', v_created));

  RETURN jsonb_build_object('service_order_id', p_service_order_id, 'project_id', p_project_id,
                            'created', v_created, 'contract_linked', v_contract IS NOT NULL);
END $$;

-- ---------------------------------------------------------------------------
-- 5) Privilégios das funções — nenhuma alcançável pelo navegador
-- ---------------------------------------------------------------------------
DO $grants$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.commercial_engagement_create(uuid,uuid,jsonb)',
    'public.commercial_engagement_attach_authorization(uuid,uuid,uuid,jsonb)',
    'public.commercial_engagement_set_governing(uuid,uuid,uuid,text)',
    'public.commercial_engagement_authorize(uuid,uuid,uuid,text)',
    'public.commercial_proposal_revision_record_outcome(uuid,uuid,uuid,text,jsonb)',
    'public.internal_service_order_create(uuid,uuid,uuid,jsonb)',
    'public.internal_service_order_compare_with_governing(uuid,uuid)',
    'public.commercial_divergence_resolve(uuid,uuid,uuid,text,text)',
    'public.internal_service_order_issue(uuid,uuid,uuid)',
    'public.internal_service_order_bind_project(uuid,uuid,uuid,text,jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $grants$;

-- ---------------------------------------------------------------------------
-- 6) RLS e leitura
-- ---------------------------------------------------------------------------
ALTER TABLE public.internal_service_orders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_engagement_history  ENABLE ROW LEVEL SECURITY;

CREATE POLICY iso_select ON public.internal_service_orders FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND (public.current_user_has_permission('contracts.view')
          OR public.current_user_has_permission('commercial.view')
          OR public.current_user_has_permission('projects.view')));
CREATE POLICY ceh_select ON public.commercial_engagement_history FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND public.current_user_has_permission('contracts.view'));

GRANT SELECT ON public.internal_service_orders, public.commercial_engagement_history TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.internal_service_orders,
       public.commercial_engagement_history FROM PUBLIC, anon, authenticated;

INSERT INTO public.permissions (key, module, action, description) VALUES
  ('commercial.service_orders.manage', 'commercial', 'service_orders.manage',
   'Criar, confrontar e emitir Ordem de Serviço interna'),
  ('commercial.service_orders.bind_project', 'commercial', 'service_orders.bind_project',
   'Criar ou vincular Projeto a partir de uma Ordem de Serviço interna emitida')
ON CONFLICT (key) DO NOTHING;

COMMIT;
