-- ============================================================================
-- 252 — REQUISITO COM COBERTURA: EDITAR SEM DEIXAR A COBERTURA INCONSISTENTE
--
-- DEFEITO (provado no QA, SQL desfeito). `project_requirement_upsert` e
-- `project_requirement_transition` travam o requisito, mas não olham a cobertura:
--   • a quantidade de um requisito CONFIRMADO podia cair de 100 para 80 com um
--     pedido de 100 emitido (reclamado 100 contra 80), ou abaixo de reservas,
--     transferências e requisições;
--   • o ITEM podia ser trocado com reservas, requisições e pedidos do item
--     antigo vivos (a linha de requisição seguia com o item antigo);
--   • CONFIRMADO → CANCELADO / SUBSTITUÍDO / PLANEJADO passava com reservas,
--     transferências, requisições e pedidos vivos presos a uma demanda morta.
--
-- REGRA (docs/operations-supply/COVERAGE-SEMANTICS.md, seção 252) — o
-- invariante cobertura comprometida ≤ requerido, com "comprometido" = o
-- reclamado da 246 (reservado + consumido + transferências pendentes e em
-- trânsito + em pedido + em inspeção + requisitado):
--   • quantidade MAIOR: a cobertura fica; só a diferença vira falta;
--   • quantidade MENOR: até o comprometido; abaixo dele, recusada — com a
--     cobertura por parcela na mensagem, para reconciliar antes pelos caminhos
--     governados (liberar reserva; cancelar transferência, requisição, pedido);
--   • ITEM: não muda enquanto houver cobertura (a unidade segue o item — gatilho);
--   • CANCELAR / SUBSTITUIR / DEVOLVER AO PLANEJAMENTO: recusado enquanto houver
--     cobertura ATIVA (o consumido é história e não impede);
--   • DATA: muda sem tocar em quantidade nem em documento de compra; o fato
--     `operations.requirement.rescheduled` leva a data de antes e a de agora.
-- Ordem das travas (251): as duas funções travam só o requisito (FOR UPDATE);
-- todo escritor que aumenta a cobertura trava o mesmo requisito, então edição ∥
-- reserva / compra / recebimento se serializam e a conferência vê o estado de
-- agora. Nenhum dado é reescrito.
-- FORA: nada além da edição de requisito.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) O retrato da cobertura de um requisito (as mesmas parcelas do reclamado,
--    246) e o texto exato de uma quantidade
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.supply_quantity_text(p numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN p IS NULL THEN NULL
              ELSE regexp_replace(regexp_replace(p::text, '(\.\d*?)0+$', '\1'), '\.$', '') END
$$;

CREATE OR REPLACE FUNCTION public.project_requirement_coverage_footprint(p_organization_id uuid, p_requirement_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE v_res numeric; v_con numeric; v_pen numeric; v_tra numeric; v_ord numeric; v_ins numeric; v_req numeric; v_cla numeric;
        v_parts text[] := '{}'; v_active text[] := '{}';
BEGIN
  SELECT COALESCE(sum(CASE WHEN status = 'ACTIVE' THEN quantity - consumed_quantity - released_quantity ELSE 0 END), 0),
         COALESCE(sum(consumed_quantity), 0)
    INTO v_res, v_con FROM public.inventory_reservations
   WHERE organization_id = p_organization_id AND requirement_id = p_requirement_id;
  SELECT COALESCE(sum(CASE WHEN t.status IN ('REQUESTED','APPROVED') AND l.source_reservation_id IS NULL THEN l.quantity ELSE 0 END), 0),
         COALESCE(sum(CASE WHEN t.status IN ('IN_TRANSIT','PARTIALLY_RECEIVED') THEN l.dispatched_quantity - l.received_quantity ELSE 0 END), 0)
    INTO v_pen, v_tra FROM public.inventory_transfer_lines l
    JOIN public.inventory_transfers t ON t.organization_id = l.organization_id AND t.id = l.transfer_id
   WHERE l.organization_id = p_organization_id AND l.requirement_id = p_requirement_id;
  v_ord := public.procurement_on_order(p_organization_id, p_requirement_id);
  v_ins := public.receiving_inspection_pending(p_organization_id, p_requirement_id);
  v_req := public.procurement_requested_open(p_organization_id, p_requirement_id);
  v_cla := public.supply_requirement_claimed(p_organization_id, p_requirement_id);
  IF v_res > 0 THEN v_parts := v_parts || ('reserved ' || public.supply_quantity_text(v_res)); END IF;
  IF v_con > 0 THEN v_parts := v_parts || ('consumed ' || public.supply_quantity_text(v_con)); END IF;
  IF v_pen > 0 THEN v_parts := v_parts || ('pending transfers ' || public.supply_quantity_text(v_pen)); END IF;
  IF v_tra > 0 THEN v_parts := v_parts || ('in transit ' || public.supply_quantity_text(v_tra)); END IF;
  IF v_ord > 0 THEN v_parts := v_parts || ('on order ' || public.supply_quantity_text(v_ord)); END IF;
  IF v_ins > 0 THEN v_parts := v_parts || ('in inspection ' || public.supply_quantity_text(v_ins)); END IF;
  IF v_req > 0 THEN v_parts := v_parts || ('requested ' || public.supply_quantity_text(v_req)); END IF;
  v_active := array_remove(v_parts, 'consumed ' || public.supply_quantity_text(v_con));
  RETURN jsonb_build_object('reserved', v_res, 'consumed', v_con, 'pending_transfer', v_pen, 'in_transit', v_tra,
    'on_order', v_ord, 'inspection', v_ins, 'requested', v_req, 'claimed', v_cla, 'active', GREATEST(v_cla - v_con, 0),
    'claimed_text', public.supply_quantity_text(v_cla), 'active_text', public.supply_quantity_text(GREATEST(v_cla - v_con, 0)),
    'detail', COALESCE(array_to_string(v_parts, ', '), ''), 'active_detail', COALESCE(array_to_string(v_active, ', '), ''));
END $function$;
COMMENT ON FUNCTION public.project_requirement_coverage_footprint(uuid, uuid) IS
  'Cobertura de um requisito (252): reservado ativo, consumido, transferências pendentes e em trânsito, em pedido, em inspeção e requisitado; reclamado (= supply_requirement_claimed) e ativo (= reclamado − consumido), com o texto de cada parcela. Só leitura; só do servidor.';

-- ---------------------------------------------------------------------------
-- 2) Edição: quantidade não cai abaixo do comprometido; item não muda com
--    cobertura; data muda com fato próprio. Corpo implantado, mudanças "252".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.project_requirement_upsert(p_organization_id uuid, p_actor uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid; r public.project_requirements%ROWTYPE; v_changes jsonb := '{}'::jsonb; k text;
        -- 252
        v_new_qty numeric; v_new_item uuid; v_fp jsonb; v_old_date date;
BEGIN
  PERFORM public.operations_require(p_organization_id, p_actor, ARRAY['operations.planning.manage']);
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
      ai_provider, ai_model, ai_confidence, item_id, created_by)
    VALUES (
      p_organization_id, p_payload->>'project_id', nullif(p_payload->>'activity_id','')::uuid,
      p_payload->>'requirement_type', btrim(p_payload->>'title'), nullif(btrim(p_payload->>'description'),''),
      nullif(p_payload->>'quantity','')::numeric, nullif(btrim(p_payload->>'unit'),''),
      nullif(btrim(p_payload->>'resource_label'),''), nullif(p_payload->>'required_by','')::date,
      nullif(btrim(p_payload->>'delivery_location_label'),''), COALESCE(nullif(p_payload->>'priority',''), 'medium'),
      nullif(btrim(p_payload->>'constraints_note'),''),
      COALESCE(nullif(p_payload->>'source',''), CASE WHEN nullif(p_payload->>'activity_id','') IS NULL THEN 'MANUAL' ELSE 'ACTIVITY' END),
      nullif(p_payload->>'ai_provider',''), nullif(p_payload->>'ai_model',''), nullif(p_payload->>'ai_confidence','')::numeric,
      nullif(p_payload->>'item_id','')::uuid, p_actor)
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
  -- 252: com a trava do requisito na mão (todo escritor que aumenta a cobertura trava o requisito), a edição não
  -- deixa a cobertura inconsistente — o invariante é cobertura comprometida ≤ requerido:
  --   • quantidade MENOR que o comprometido (reservado, consumido, transferências, em pedido, em inspeção,
  --     requisitado): recusada — reconcilia-se antes pelos caminhos governados (liberar a reserva, cancelar a
  --     transferência, a requisição ou o pedido). Maior: a cobertura fica e só a diferença vira falta;
  --   • ITEM trocado com cobertura: recusado — a cobertura não muda de item em silêncio.
  IF r.requirement_type IN ('MATERIAL','EXTERNAL_SERVICE') AND (p_payload ? 'quantity' OR p_payload ? 'item_id') THEN
    v_new_qty := CASE WHEN p_payload ? 'quantity' THEN nullif(p_payload->>'quantity','')::numeric ELSE r.quantity END;
    v_new_item := CASE WHEN p_payload ? 'item_id' THEN nullif(p_payload->>'item_id','')::uuid ELSE r.item_id END;
    IF v_new_item IS DISTINCT FROM r.item_id OR v_new_qty IS DISTINCT FROM r.quantity THEN
      v_fp := public.project_requirement_coverage_footprint(p_organization_id, r.id);
      IF v_new_item IS DISTINCT FROM r.item_id AND (v_fp->>'claimed')::numeric > 0 THEN
        RAISE EXCEPTION 'Requirement has coverage of its current item (% committed: %): the item changes only after that coverage is released or cancelled.',
          v_fp->>'claimed_text', v_fp->>'detail' USING ERRCODE = '23514';
      END IF;
      IF v_new_qty IS DISTINCT FROM r.quantity AND COALESCE(v_new_qty, 0) < (v_fp->>'claimed')::numeric THEN
        RAISE EXCEPTION 'Requirement quantity % is below its committed coverage % (%): release or cancel coverage first.',
          COALESCE(public.supply_quantity_text(v_new_qty), 'empty'), v_fp->>'claimed_text', v_fp->>'detail' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  v_old_date := r.required_by;

  FOREACH k IN ARRAY ARRAY['activity_id','requirement_type','title','description','quantity','unit','resource_label',
                           'required_by','delivery_location_label','priority','constraints_note','item_id'] LOOP
    IF p_payload ? k THEN v_changes := v_changes || jsonb_build_object(k, p_payload->k); END IF;
  END LOOP;

  UPDATE public.project_requirements SET
    activity_id = CASE WHEN p_payload ? 'activity_id' THEN nullif(p_payload->>'activity_id','')::uuid ELSE activity_id END,
    requirement_type = COALESCE(nullif(p_payload->>'requirement_type',''), requirement_type),
    title = COALESCE(nullif(btrim(p_payload->>'title'),''), title),
    description = CASE WHEN p_payload ? 'description' THEN nullif(btrim(p_payload->>'description'),'') ELSE description END,
    quantity = CASE WHEN p_payload ? 'quantity' THEN nullif(p_payload->>'quantity','')::numeric ELSE quantity END,
    unit = CASE WHEN p_payload ? 'unit' THEN nullif(btrim(p_payload->>'unit'),'')
                WHEN p_payload ? 'item_id' AND nullif(p_payload->>'item_id','') IS NOT NULL THEN NULL
                ELSE unit END,
    resource_label = CASE WHEN p_payload ? 'resource_label' THEN nullif(btrim(p_payload->>'resource_label'),'') ELSE resource_label END,
    required_by = CASE WHEN p_payload ? 'required_by' THEN nullif(p_payload->>'required_by','')::date ELSE required_by END,
    delivery_location_label = CASE WHEN p_payload ? 'delivery_location_label' THEN nullif(btrim(p_payload->>'delivery_location_label'),'') ELSE delivery_location_label END,
    priority = COALESCE(nullif(p_payload->>'priority',''), priority),
    constraints_note = CASE WHEN p_payload ? 'constraints_note' THEN nullif(btrim(p_payload->>'constraints_note'),'') ELSE constraints_note END,
    item_id = CASE WHEN p_payload ? 'item_id' THEN nullif(p_payload->>'item_id','')::uuid ELSE item_id END
  WHERE organization_id = p_organization_id AND id = v_id
  RETURNING * INTO r;
  PERFORM public.project_requirement_log(r, 'edited', r.status, r.status, v_changes, nullif(btrim(p_payload->>'reason'),''), p_actor);
  -- 252: a data muda sem tocar em quantidade nem em documento de compra (os leitores tiram a data das alocações
  -- abertas, 248); o planejamento fica sabendo pelo fato próprio, com a data de antes e a de agora.
  IF r.required_by IS DISTINCT FROM v_old_date THEN
    PERFORM public.emit_domain_event(p_organization_id, 'operations.requirement.rescheduled', 1, 'project_requirement', r.id,
      'requirement:' || r.id || ':rescheduled:' || (SELECT count(*) FROM public.project_requirement_history h
                                                     WHERE h.organization_id = p_organization_id AND h.requirement_id = r.id),
      jsonb_build_object('project_id', r.project_id, 'requirement_type', r.requirement_type, 'title', r.title,
                         'required_by_before', v_old_date, 'required_by', r.required_by, 'quantity', r.quantity, 'unit', r.unit),
      now(), 'human', p_actor);
  END IF;
  RETURN jsonb_build_object('requirement_id', r.id, 'status', r.status, 'created', false);
END $function$;

-- ---------------------------------------------------------------------------
-- 3) Estado: cancelar / substituir / planejar só sem cobertura ativa. Corpo
--    implantado, mudança "252".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.project_requirement_transition(p_organization_id uuid, p_actor uuid, p_requirement_id uuid, p_to text, p_reason text DEFAULT NULL::text, p_superseded_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r public.project_requirements%ROWTYPE; v_from text; ok boolean;
        -- 252
        v_fp jsonb;
BEGIN
  PERFORM public.operations_require(p_organization_id, p_actor, ARRAY['operations.planning.manage']);
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
  -- 252: cancelar, substituir ou devolver ao planejamento um requisito com cobertura ATIVA (reservada,
  -- transferida, em pedido, em inspeção, requisitada — o consumido é história) deixaria essa cobertura presa a uma
  -- demanda morta: recusado. Reconcilia-se antes pelos caminhos governados; a trava do requisito serializa tudo.
  IF p_to IN ('CANCELLED','SUPERSEDED','PLANNED') AND r.requirement_type IN ('MATERIAL','EXTERNAL_SERVICE') THEN
    v_fp := public.project_requirement_coverage_footprint(p_organization_id, r.id);
    IF (v_fp->>'active')::numeric > 0 THEN
      RAISE EXCEPTION 'Requirement has active coverage % (%): release or cancel it before moving the requirement to %.',
        v_fp->>'active_text', v_fp->>'active_detail', p_to USING ERRCODE = '23514';
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
END $function$;

-- ---------------------------------------------------------------------------
-- 4) Privilégios: só do servidor
-- ---------------------------------------------------------------------------
DO $$
DECLARE sig text;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'supply_quantity_text(numeric)', 'project_requirement_coverage_footprint(uuid,uuid)', 'project_requirement_upsert(uuid,uuid,jsonb)',
    'project_requirement_transition(uuid,uuid,uuid,text,text,uuid)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', sig);
  END LOOP;
END $$;

COMMIT;
