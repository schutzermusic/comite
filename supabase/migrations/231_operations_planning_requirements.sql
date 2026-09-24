-- ============================================================================
-- 231 — PLANEJAMENTO: requisitos de execução, datados, com proveniência
--
-- ─── O que NÃO nasce aqui ───────────────────────────────────────────────
--
-- Não nasce "plano de execução" como tabela. O plano de execução do projeto
-- É o cronograma canônico (`project_timeline_items` + dependências), com WBS,
-- datas planejadas e reais, marcos e responsáveis. Uma segunda tabela de
-- atividades seria uma segunda verdade sobre a mesma obra.
--
-- ─── O que nasce ────────────────────────────────────────────────────────
--
-- `project_requirements`: o que uma atividade PRECISA para acontecer —
-- material, equipamento, veículo, mão de obra, serviço externo, documento,
-- dependência do cliente. Cada requisito diz de onde veio (INV-06): da
-- atividade, da OS, de registro manual, de plano importado ou de proposta da
-- IA confirmada por gente.
--
-- ─── Estado mínimo, cobertura derivada ──────────────────────────────────
--
-- O estado é só o do PLANO: planejado, confirmado, cancelado, substituído. Se
-- o requisito de MATERIAL está coberto, parcialmente coberto ou em falta NÃO
-- é gravado aqui — é derivado do Supply (232+), das reservas, transferências
-- e compras alocadas a ele. Um campo "coberto" editável seria a segunda
-- verdade que a primeira exceção desmente.
--
-- Para o que não tem domínio de suprimento (documento, dependência do
-- cliente, mão de obra, equipamento próprio), "atendido" é um ATO governado:
-- quem, quando, com qual evidência.
-- ============================================================================

BEGIN;

CREATE TABLE public.project_requirements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id            text NOT NULL,
  activity_id           uuid,

  requirement_type      text NOT NULL CHECK (requirement_type IN (
                          'MATERIAL','EQUIPMENT','VEHICLE','WORKFORCE','EXTERNAL_SERVICE',
                          'DOCUMENT','CUSTOMER_DEPENDENCY','OTHER')),
  title                 text NOT NULL CHECK (btrim(title) <> ''),
  description           text,
  quantity              numeric(18,4) CHECK (quantity IS NULL OR quantity > 0),
  unit                  text,
  resource_label        text,
  required_by           date,
  delivery_location_label text,
  priority              text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  constraints_note      text,

  -- De onde o requisito veio (INV-06).
  source                text NOT NULL CHECK (source IN ('ACTIVITY','SERVICE_ORDER','MANUAL','IMPORTED_PLAN','AI_PROPOSAL')),
  service_order_id      uuid,
  service_order_item_id uuid,
  ai_provider           text,
  ai_model              text,
  ai_confidence         numeric(5,4) CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1)),

  status                text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','CONFIRMED','CANCELLED','SUPERSEDED')),
  confirmed_at          timestamptz,
  confirmed_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at          timestamptz,
  cancelled_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancellation_reason   text,
  superseded_by_id      uuid,

  -- "Atendido" como ATO — só para tipos sem domínio de suprimento.
  satisfied_at          timestamptz,
  satisfied_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  satisfaction_note     text,
  satisfaction_document_id uuid,

  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT preq_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT preq_project_tenant FOREIGN KEY (organization_id, project_id)
    REFERENCES public.projects (organization_id, id) ON DELETE CASCADE,
  -- A atividade é do MESMO projeto e do MESMO inquilino. Atividade removida
  -- do cronograma não apaga o requisito: ele volta a ser do projeto.
  CONSTRAINT preq_activity_same_project FOREIGN KEY (organization_id, project_id, activity_id)
    REFERENCES public.project_timeline_items (organization_id, project_id, id) ON DELETE SET NULL (activity_id),
  CONSTRAINT preq_service_order_tenant FOREIGN KEY (organization_id, service_order_id)
    REFERENCES public.internal_service_orders (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT preq_service_order_item_tenant FOREIGN KEY (organization_id, service_order_item_id)
    REFERENCES public.internal_service_order_items (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT preq_superseded_tenant FOREIGN KEY (organization_id, superseded_by_id)
    REFERENCES public.project_requirements (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT preq_satisfaction_document_tenant FOREIGN KEY (organization_id, satisfaction_document_id)
    REFERENCES public.contract_documents (organization_id, id) ON DELETE RESTRICT,

  CONSTRAINT preq_quantity_has_unit CHECK (quantity IS NULL OR nullif(btrim(unit), '') IS NOT NULL),
  CONSTRAINT preq_source_provenance CHECK (
    CASE source
      WHEN 'SERVICE_ORDER' THEN service_order_id IS NOT NULL
      WHEN 'AI_PROPOSAL'   THEN ai_provider IS NOT NULL AND ai_model IS NOT NULL
      ELSE true END),
  CONSTRAINT preq_confirmed_coherent CHECK (
    status = 'CANCELLED' OR ((status IN ('CONFIRMED','SUPERSEDED')) = (confirmed_at IS NOT NULL))),
  CONSTRAINT preq_confirmed_attributed CHECK (confirmed_at IS NULL OR confirmed_by IS NOT NULL),
  CONSTRAINT preq_cancelled_coherent CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  CONSTRAINT preq_cancel_has_reason CHECK (status <> 'CANCELLED' OR nullif(btrim(cancellation_reason), '') IS NOT NULL),
  CONSTRAINT preq_superseded_coherent CHECK ((status = 'SUPERSEDED') = (superseded_by_id IS NOT NULL)),
  -- Confirmar requisito de material é prometer uma data e uma quantidade ao
  -- Supply. Sem as duas, não há o que planejar.
  CONSTRAINT preq_confirmed_material_is_plannable CHECK (
    status <> 'CONFIRMED' OR requirement_type NOT IN ('MATERIAL','EXTERNAL_SERVICE')
    OR (quantity IS NOT NULL AND required_by IS NOT NULL)),
  CONSTRAINT preq_confirmed_has_date CHECK (status <> 'CONFIRMED' OR required_by IS NOT NULL),
  CONSTRAINT preq_satisfaction_scope CHECK (
    satisfied_at IS NULL OR requirement_type NOT IN ('MATERIAL','EXTERNAL_SERVICE')),
  CONSTRAINT preq_satisfaction_attributed CHECK ((satisfied_at IS NULL) = (satisfied_by IS NULL)),
  CONSTRAINT preq_satisfied_is_confirmed CHECK (satisfied_at IS NULL OR status IN ('CONFIRMED','SUPERSEDED'))
);

CREATE INDEX preq_project ON public.project_requirements (organization_id, project_id, status);
CREATE INDEX preq_activity ON public.project_requirements (organization_id, project_id, activity_id)
  WHERE activity_id IS NOT NULL;
CREATE INDEX preq_need_date ON public.project_requirements (organization_id, required_by)
  WHERE status = 'CONFIRMED';
-- Importar da OS é idempotente: a mesma linha da OS vira UM requisito vivo.
CREATE UNIQUE INDEX preq_from_service_order_item_once ON public.project_requirements
  (organization_id, project_id, service_order_item_id)
  WHERE service_order_item_id IS NOT NULL AND status IN ('PLANNED','CONFIRMED');

CREATE TRIGGER preq_touch BEFORE UPDATE ON public.project_requirements
  FOR EACH ROW EXECUTE FUNCTION public.commercial_touch_updated_at();

COMMENT ON TABLE public.project_requirements IS
  'Requisitos de execução por atividade do cronograma canônico. Cobertura de material é DERIVADA do Supply; nunca gravada aqui.';

-- ---------------------------------------------------------------------------
-- História append-only
-- ---------------------------------------------------------------------------
CREATE TABLE public.project_requirement_history (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requirement_id   uuid NOT NULL,
  transition       text NOT NULL CHECK (btrim(transition) <> ''),
  from_status      text,
  to_status        text,
  changes          jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(changes) = 'object'),
  reason           text,
  actor_user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT preqh_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT preqh_requirement_tenant FOREIGN KEY (organization_id, requirement_id)
    REFERENCES public.project_requirements (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX preqh_requirement ON public.project_requirement_history (organization_id, requirement_id, occurred_at DESC);
CREATE TRIGGER preqh_no_rewrite BEFORE UPDATE ON public.project_requirement_history
  FOR EACH ROW EXECUTE FUNCTION public.operations_reject_history_rewrite();
CREATE TRIGGER preqh_no_erasure BEFORE DELETE ON public.project_requirement_history
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

-- ---------------------------------------------------------------------------
-- Funções governadas
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.project_requirement_log(
  r public.project_requirements, p_transition text, p_from text, p_to text,
  p_changes jsonb, p_reason text, p_actor uuid
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO public.project_requirement_history
    (organization_id, requirement_id, transition, from_status, to_status, changes, reason, actor_user_id)
  VALUES (r.organization_id, r.id, p_transition, p_from, p_to, COALESCE(p_changes, '{}'::jsonb), p_reason, p_actor)
$$;
REVOKE ALL ON FUNCTION public.project_requirement_log(public.project_requirements, text, text, text, jsonb, text, uuid)
  FROM PUBLIC, anon, authenticated;

/*
  Criar ou editar. Requisito CANCELADO ou SUBSTITUÍDO não se edita (é
  história). Requisito CONFIRMADO se edita, mas cada mudança de quantidade,
  data ou atividade fica na história — o Supply planeja contra o que está
  confirmado, e a mudança precisa ser visível para quem já reservou ou comprou.
*/
CREATE OR REPLACE FUNCTION public.project_requirement_upsert(
  p_organization_id uuid, p_actor uuid, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; r public.project_requirements%ROWTYPE; v_changes jsonb := '{}'::jsonb; k text;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Requirement write denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Requirement write requires a named actor.' USING ERRCODE = '42501';
  END IF;

  v_id := nullif(p_payload->>'id','')::uuid;
  IF v_id IS NULL THEN
    IF COALESCE(p_payload->>'source','MANUAL') NOT IN ('ACTIVITY','MANUAL','IMPORTED_PLAN','AI_PROPOSAL') THEN
      RAISE EXCEPTION 'Requirement source % is created by its own governed path.', p_payload->>'source' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.project_requirements (
      organization_id, project_id, activity_id, requirement_type, title, description, quantity, unit,
      resource_label, required_by, delivery_location_label, priority, constraints_note, source,
      ai_provider, ai_model, ai_confidence, created_by)
    VALUES (
      p_organization_id, p_payload->>'project_id', nullif(p_payload->>'activity_id','')::uuid,
      p_payload->>'requirement_type', btrim(p_payload->>'title'), nullif(btrim(p_payload->>'description'),''),
      nullif(p_payload->>'quantity','')::numeric, nullif(btrim(p_payload->>'unit'),''),
      nullif(btrim(p_payload->>'resource_label'),''), nullif(p_payload->>'required_by','')::date,
      nullif(btrim(p_payload->>'delivery_location_label'),''), COALESCE(nullif(p_payload->>'priority',''), 'medium'),
      nullif(btrim(p_payload->>'constraints_note'),''),
      COALESCE(nullif(p_payload->>'source',''), CASE WHEN nullif(p_payload->>'activity_id','') IS NULL THEN 'MANUAL' ELSE 'ACTIVITY' END),
      nullif(p_payload->>'ai_provider',''), nullif(p_payload->>'ai_model',''), nullif(p_payload->>'ai_confidence','')::numeric,
      p_actor)
    RETURNING * INTO r;
    PERFORM public.project_requirement_log(r, 'created', NULL, r.status, p_payload - 'id', NULL, p_actor);
    RETURN jsonb_build_object('requirement_id', r.id, 'status', r.status, 'created', true);
  END IF;

  SELECT * INTO r FROM public.project_requirements
   WHERE organization_id = p_organization_id AND id = v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Requirement not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF r.status IN ('CANCELLED','SUPERSEDED') THEN
    RAISE EXCEPTION 'Requirement is %: history is not edited.', r.status USING ERRCODE = '23514';
  END IF;
  IF p_payload ? 'requirement_type' AND p_payload->>'requirement_type' <> r.requirement_type AND r.status = 'CONFIRMED' THEN
    RAISE EXCEPTION 'Requirement is confirmed: its type changes only by superseding it.' USING ERRCODE = '23514';
  END IF;

  FOREACH k IN ARRAY ARRAY['activity_id','requirement_type','title','description','quantity','unit','resource_label',
                           'required_by','delivery_location_label','priority','constraints_note'] LOOP
    IF p_payload ? k THEN v_changes := v_changes || jsonb_build_object(k, p_payload->k); END IF;
  END LOOP;

  UPDATE public.project_requirements SET
    activity_id = CASE WHEN p_payload ? 'activity_id' THEN nullif(p_payload->>'activity_id','')::uuid ELSE activity_id END,
    requirement_type = COALESCE(nullif(p_payload->>'requirement_type',''), requirement_type),
    title = COALESCE(nullif(btrim(p_payload->>'title'),''), title),
    description = CASE WHEN p_payload ? 'description' THEN nullif(btrim(p_payload->>'description'),'') ELSE description END,
    quantity = CASE WHEN p_payload ? 'quantity' THEN nullif(p_payload->>'quantity','')::numeric ELSE quantity END,
    unit = CASE WHEN p_payload ? 'unit' THEN nullif(btrim(p_payload->>'unit'),'') ELSE unit END,
    resource_label = CASE WHEN p_payload ? 'resource_label' THEN nullif(btrim(p_payload->>'resource_label'),'') ELSE resource_label END,
    required_by = CASE WHEN p_payload ? 'required_by' THEN nullif(p_payload->>'required_by','')::date ELSE required_by END,
    delivery_location_label = CASE WHEN p_payload ? 'delivery_location_label' THEN nullif(btrim(p_payload->>'delivery_location_label'),'') ELSE delivery_location_label END,
    priority = COALESCE(nullif(p_payload->>'priority',''), priority),
    constraints_note = CASE WHEN p_payload ? 'constraints_note' THEN nullif(btrim(p_payload->>'constraints_note'),'') ELSE constraints_note END
  WHERE organization_id = p_organization_id AND id = v_id
  RETURNING * INTO r;
  PERFORM public.project_requirement_log(r, 'edited', r.status, r.status, v_changes, nullif(btrim(p_payload->>'reason'),''), p_actor);
  RETURN jsonb_build_object('requirement_id', r.id, 'status', r.status, 'created', false);
END $$;

/*
  Transições do PLANO. Confirmar promete data (e, para material, quantidade)
  ao Supply. Proposta da IA só vira requisito confirmado por gente — o ator é
  quem confirma, e é ele que fica na linha.
*/
CREATE OR REPLACE FUNCTION public.project_requirement_transition(
  p_organization_id uuid, p_actor uuid, p_requirement_id uuid, p_to text, p_reason text DEFAULT NULL,
  p_superseded_by uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.project_requirements%ROWTYPE; v_from text; ok boolean;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Requirement transition denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Requirement transition requires a named actor.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.project_requirements
   WHERE organization_id = p_organization_id AND id = p_requirement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Requirement not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  v_from := r.status;
  IF v_from = p_to THEN
    RETURN jsonb_build_object('requirement_id', r.id, 'status', r.status, 'reused', true);
  END IF;
  ok := CASE v_from
    WHEN 'PLANNED'   THEN p_to IN ('CONFIRMED','CANCELLED')
    WHEN 'CONFIRMED' THEN p_to IN ('PLANNED','CANCELLED','SUPERSEDED')
    ELSE false END;
  IF NOT ok THEN
    RAISE EXCEPTION 'Requirement cannot move from % to %.', v_from, p_to USING ERRCODE = '23514';
  END IF;
  IF p_to = 'CONFIRMED' AND r.required_by IS NULL THEN
    RAISE EXCEPTION 'Requirement needs a required-by date before it is confirmed.' USING ERRCODE = '23514';
  END IF;
  IF p_to = 'CONFIRMED' AND r.requirement_type IN ('MATERIAL','EXTERNAL_SERVICE') AND r.quantity IS NULL THEN
    RAISE EXCEPTION 'Requirement of % needs a quantity before it is confirmed.', r.requirement_type USING ERRCODE = '23514';
  END IF;
  IF p_to = 'CANCELLED' AND nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Requirement cancellation requires a written reason.' USING ERRCODE = '23514';
  END IF;
  IF p_to = 'SUPERSEDED' THEN
    IF p_superseded_by IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.project_requirements n
       WHERE n.organization_id = p_organization_id AND n.id = p_superseded_by
         AND n.project_id = r.project_id AND n.id <> r.id AND n.status IN ('PLANNED','CONFIRMED')) THEN
      RAISE EXCEPTION 'Requirement supersession needs a live replacement in the same project.' USING ERRCODE = '23514';
    END IF;
  END IF;

  UPDATE public.project_requirements SET
    status = p_to,
    confirmed_at = CASE WHEN p_to = 'CONFIRMED' THEN now() WHEN p_to = 'PLANNED' THEN NULL ELSE confirmed_at END,
    confirmed_by = CASE WHEN p_to = 'CONFIRMED' THEN p_actor WHEN p_to = 'PLANNED' THEN NULL ELSE confirmed_by END,
    cancelled_at = CASE WHEN p_to = 'CANCELLED' THEN now() ELSE cancelled_at END,
    cancelled_by = CASE WHEN p_to = 'CANCELLED' THEN p_actor ELSE cancelled_by END,
    cancellation_reason = CASE WHEN p_to = 'CANCELLED' THEN btrim(p_reason) ELSE cancellation_reason END,
    superseded_by_id = CASE WHEN p_to = 'SUPERSEDED' THEN p_superseded_by ELSE superseded_by_id END,
    satisfied_at = CASE WHEN p_to = 'PLANNED' THEN NULL ELSE satisfied_at END,
    satisfied_by = CASE WHEN p_to = 'PLANNED' THEN NULL ELSE satisfied_by END
  WHERE organization_id = p_organization_id AND id = r.id
  RETURNING * INTO r;

  PERFORM public.project_requirement_log(r, lower(p_to), v_from, p_to,
    CASE WHEN p_superseded_by IS NOT NULL THEN jsonb_build_object('superseded_by', p_superseded_by) ELSE '{}'::jsonb END,
    nullif(btrim(p_reason),''), p_actor);
  PERFORM public.emit_domain_event(
    p_organization_id, 'operations.requirement.' || lower(p_to), 1, 'project_requirement', r.id,
    'requirement:' || r.id || ':' || lower(p_to) || ':' || (SELECT count(*) FROM public.project_requirement_history h
                                                              WHERE h.organization_id = p_organization_id AND h.requirement_id = r.id),
    jsonb_build_object('project_id', r.project_id, 'requirement_type', r.requirement_type, 'title', r.title,
                       'required_by', r.required_by, 'quantity', r.quantity, 'unit', r.unit),
    now(), 'human', p_actor);

  RETURN jsonb_build_object('requirement_id', r.id, 'status', r.status, 'from', v_from);
END $$;

-- "Atendido" para o que não tem domínio de suprimento: ato, com evidência.
CREATE OR REPLACE FUNCTION public.project_requirement_mark_satisfied(
  p_organization_id uuid, p_actor uuid, p_requirement_id uuid, p_note text, p_document_id uuid DEFAULT NULL,
  p_undo boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.project_requirements%ROWTYPE;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Requirement write denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL OR nullif(btrim(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'Requirement satisfaction requires a named actor and a note.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.project_requirements
   WHERE organization_id = p_organization_id AND id = p_requirement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Requirement not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF r.requirement_type IN ('MATERIAL','EXTERNAL_SERVICE') THEN
    RAISE EXCEPTION 'Requirement of % is covered by Supply, not marked by hand.', r.requirement_type USING ERRCODE = '23514';
  END IF;
  IF r.status <> 'CONFIRMED' THEN
    RAISE EXCEPTION 'Requirement is %: only a confirmed requirement is satisfied.', r.status USING ERRCODE = '23514';
  END IF;
  UPDATE public.project_requirements SET
    satisfied_at = CASE WHEN p_undo THEN NULL ELSE now() END,
    satisfied_by = CASE WHEN p_undo THEN NULL ELSE p_actor END,
    satisfaction_note = btrim(p_note),
    satisfaction_document_id = CASE WHEN p_undo THEN NULL ELSE p_document_id END
  WHERE organization_id = p_organization_id AND id = r.id
  RETURNING * INTO r;
  PERFORM public.project_requirement_log(r, CASE WHEN p_undo THEN 'satisfaction_undone' ELSE 'satisfied' END,
    r.status, r.status, jsonb_build_object('document_id', p_document_id), btrim(p_note), p_actor);
  RETURN jsonb_build_object('requirement_id', r.id, 'satisfied', NOT p_undo);
END $$;

/*
  Da OS para o PLANO: as linhas CONFIRMADAS da OS emitida que pedem recurso
  viram requisitos PLANEJADOS do projeto — sem data, porque data de
  necessidade é decisão de quem planeja, não da proposta. Idempotente.
*/
CREATE OR REPLACE FUNCTION public.project_requirements_import_from_service_order(
  p_organization_id uuid, p_actor uuid, p_project_id text, p_service_order_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_os public.internal_service_orders%ROWTYPE; i record; v_type text; v_added int := 0; r public.project_requirements%ROWTYPE;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Requirement write denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Requirement write requires a named actor.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_os FROM public.internal_service_orders
   WHERE organization_id = p_organization_id AND id = p_service_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service order not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF v_os.project_id IS DISTINCT FROM p_project_id THEN
    RAISE EXCEPTION 'Service order belongs to another project.' USING ERRCODE = '23514';
  END IF;
  IF v_os.status NOT IN ('ISSUED','IN_EXECUTION','SUSPENDED') THEN
    RAISE EXCEPTION 'Service order is %: only an issued order feeds planning.', v_os.status USING ERRCODE = '23514';
  END IF;

  FOR i IN
    SELECT * FROM public.internal_service_order_items
     WHERE organization_id = p_organization_id AND service_order_id = v_os.id
       AND confirmation_state = 'CONFIRMED'
       AND kind IN ('MATERIAL','EQUIPMENT','WORKFORCE','RESOURCE','CUSTOMER_DEPENDENCY','DOCUMENT')
     ORDER BY position
  LOOP
    v_type := CASE i.kind WHEN 'MATERIAL' THEN 'MATERIAL' WHEN 'EQUIPMENT' THEN 'EQUIPMENT'
                          WHEN 'WORKFORCE' THEN 'WORKFORCE' WHEN 'CUSTOMER_DEPENDENCY' THEN 'CUSTOMER_DEPENDENCY'
                          WHEN 'DOCUMENT' THEN 'DOCUMENT' ELSE 'OTHER' END;
    INSERT INTO public.project_requirements (
      organization_id, project_id, requirement_type, title, description, quantity, unit, source,
      service_order_id, service_order_item_id, created_by)
    VALUES (p_organization_id, p_project_id, v_type, left(i.title, 500), i.detail, i.quantity, i.unit,
            'SERVICE_ORDER', v_os.id, i.id, p_actor)
    ON CONFLICT DO NOTHING
    RETURNING * INTO r;
    IF r.id IS NOT NULL THEN
      v_added := v_added + 1;
      PERFORM public.project_requirement_log(r, 'created', NULL, 'PLANNED',
        jsonb_build_object('service_order_id', v_os.id, 'service_order_item_id', i.id), NULL, p_actor);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('project_id', p_project_id, 'service_order_id', v_os.id, 'requirements_added', v_added);
END $$;

DO $grants$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.project_requirement_upsert(uuid,uuid,jsonb)',
    'public.project_requirement_transition(uuid,uuid,uuid,text,text,uuid)',
    'public.project_requirement_mark_satisfied(uuid,uuid,uuid,text,uuid,boolean)',
    'public.project_requirements_import_from_service_order(uuid,uuid,text,uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $grants$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.project_requirements        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_requirement_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY preq_select ON public.project_requirements FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND (public.current_user_has_permission('operations.planning.view')
          OR public.current_user_has_permission('projects.view')));
CREATE POLICY preqh_select ON public.project_requirement_history FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND (public.current_user_has_permission('operations.planning.view')
          OR public.current_user_has_permission('projects.view')));

REVOKE ALL ON TABLE public.project_requirements, public.project_requirement_history FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.project_requirements, public.project_requirement_history FROM authenticated;
GRANT SELECT ON TABLE public.project_requirements, public.project_requirement_history TO authenticated;

COMMIT;
