-- ============================================================================
-- 247 — COBERTURA: A REQUISIÇÃO DECIDE COM VALORES BRUTOS (SEM ARREDONDAR)
--
-- DEFEITO (provado no QA, revisão adversarial da 246). A 246 anexou à visão
-- `supply_requirement_coverage` o pendente interno e o comprável como
-- numeric(18,4), mas `shortage_qty` segue numeric sem escala — e as
-- quantidades do domínio não têm escala (a API aceita qualquer número finito).
-- `purchase_requisition_from_shortage` lia o pendente e o comprável
-- ARREDONDADOS da visão e os misturava com a falta bruta:
--   • requisito 500, reserva 99,99996, transferência PEDIDA de 150: falta
--     400,00004, pendente 150,0000 e comprável 250,0000 (de 250,00004). A
--     exceção de cobertura leva 400,00004 e o livro recusa a própria linha
--     (`pcx_is_an_exception`: 400,00004 > 250,0000 + 150,0000) — erro cru,
--     sem tradução na camada de aplicação;
--   • reserva 99,99994: comprável 250,0001 (de 250,00006); a requisição levou
--     250,0001 e o requisito ficou reclamado 500,00004 contra 500;
--   • falta ínfima sem transferência pendente: comprável arredondado a zero e
--     a recusa "covered by pending internal transfer(s)" com a lista vazia.
--
-- EVIDÊNCIA. SQL desfeito no QA: `inventory_reserve` 99,99996 + pedido de
-- transferência de 150 num requisito de 500 → a requisição com
-- `coverage_override` falha com `violates check constraint
-- "pcx_is_an_exception"`; com 99,99994, a requisição levou 250,0001 por cima
-- de 249,99994 já comprometidos.
--
-- REGRA (docs/operations-supply/COVERAGE-SEMANTICS.md), no mesmo retrato e
-- sem nenhum cast:
--   pendente   = Σ linhas de transferência REQUESTED/APPROVED sem reserva de
--                origem do requisito (o predicado da visão, lido das linhas)
--   descoberto = falta − requisitado                                 (como na 246)
--   comprável  = GREATEST(descoberto − pendente, 0)
-- O livro de exceções grava esses valores brutos (a CHECK sempre fecha). A
-- recusa que nomeia transferências só sai com pendente > 0.
--
-- O que NÃO muda: a visão (colunas não mudam de tipo no lugar; o pendente e o
-- comprável dela seguem como valores de EXIBIÇÃO), a assinatura, as mensagens,
-- a exceção governada, as travas e a idempotência da 246. A 246 já está
-- aplicada no QA compartilhado e o runner não reaplica versão registrada: a
-- correção vem aqui, para a frente.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Requisição da falta: pendente e comprável brutos. Corpo implantado (246),
--    mudanças marcadas "247".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purchase_requisition_from_shortage(p_organization_id uuid, p_actor uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_key text; v_req public.purchase_requisitions%ROWTYPE; r public.project_requirements%ROWTYPE; v_rid uuid;
        v_short numeric; v_open numeric; v_line uuid; v_projects text[] := '{}'; v_n int := 0; v_min date;
        cov record;
        -- 246
        v_ids uuid[]; v_found uuid; v_override boolean; v_reason text; v_pending numeric; v_purchasable numeric;
        v_take numeric; v_excepted boolean; v_exc_n int := 0; v_exc_qty numeric := 0; v_exc_pending numeric := 0;
        v_event uuid;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['procurement.request']);
  -- 246: exceção de cobertura pedida no payload; permissão própria e motivo conferidos NO BANCO,
  -- antes de qualquer leitura (quem não pode, não pode — nem numa repetição).
  v_override := COALESCE(jsonb_typeof(p_payload->'coverage_override'), 'null') <> 'null';
  IF v_override THEN
    IF NOT public.apex_actor_has_permission(p_organization_id, p_actor, 'procurement.coverage_override') THEN
      RAISE EXCEPTION 'Coverage exception requires procurement.coverage_override.' USING ERRCODE = '42501';
    END IF;
    v_reason := btrim(p_payload->'coverage_override'->>'reason');
    IF v_reason IS NULL OR length(v_reason) < 20 THEN
      RAISE EXCEPTION 'Coverage exception requires a reason of at least 20 characters.' USING ERRCODE = '23514';
    END IF;
  END IF;
  v_key := nullif(p_payload->>'idempotency_key','');
  IF v_key IS NOT NULL THEN
    SELECT id INTO v_found FROM public.purchase_requisitions WHERE organization_id = p_organization_id AND idempotency_key = v_key;
    IF FOUND THEN RETURN public.purchase_requisition_shortage_outcome(p_organization_id, v_found, true); END IF;
  END IF;
  -- 246: payload sem a lista (ausente/nula) também é recusado — antes passava e gravava requisição vazia.
  IF COALESCE(jsonb_typeof(p_payload->'requirement_ids'), '') <> 'array' OR jsonb_array_length(p_payload->'requirement_ids') = 0 THEN
    RAISE EXCEPTION 'Requisition needs at least one requirement.' USING ERRCODE = '22023';
  END IF;

  -- 246: TODAS as travas dos requisitos antes de qualquer escrita, em ordem canônica (uuid) — a mesma
  -- ordem de inventory_transfer_request. A chave é relida SOB a trava (padrão da 238): a segunda
  -- chamada com a mesma chave espera a primeira e responde repetição, não regra de negócio.
  v_ids := ARRAY(SELECT DISTINCT x::uuid FROM jsonb_array_elements_text(p_payload->'requirement_ids') x ORDER BY 1);
  FOREACH v_rid IN ARRAY v_ids LOOP
    PERFORM 1 FROM public.project_requirements WHERE organization_id = p_organization_id AND id = v_rid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Requirement not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  END LOOP;
  IF v_key IS NOT NULL THEN
    SELECT id INTO v_found FROM public.purchase_requisitions WHERE organization_id = p_organization_id AND idempotency_key = v_key;
    IF FOUND THEN RETURN public.purchase_requisition_shortage_outcome(p_organization_id, v_found, true); END IF;
  END IF;

  INSERT INTO public.purchase_requisitions (organization_id, requisition_number, source, status, priority, delivery_location_id,
    justification, idempotency_key, requested_by)
  VALUES (p_organization_id, public.procurement_number('RC'), 'SHORTAGE', 'SUBMITTED',
    COALESCE(nullif(p_payload->>'priority',''), 'medium'), nullif(p_payload->>'delivery_location_id','')::uuid,
    nullif(btrim(p_payload->>'justification'),''), v_key, p_actor)
  RETURNING * INTO v_req;

  FOREACH v_rid IN ARRAY v_ids LOOP
    SELECT * INTO r FROM public.project_requirements WHERE organization_id = p_organization_id AND id = v_rid;
    IF r.status <> 'CONFIRMED' OR r.requirement_type NOT IN ('MATERIAL','EXTERNAL_SERVICE') OR r.item_id IS NULL THEN
      RAISE EXCEPTION 'Requirement % is not a confirmed material with an item.', r.title USING ERRCODE = '23514';
    END IF;
    -- 246: um só retrato (mesma instrução) da falta, do requisitado, do pendente e da lista.
    -- 247: o pendente é a soma BRUTA das linhas (o predicado da visão), nunca a coluna numeric(18,4)
    -- da visão; o comprável é derivado aqui, dos brutos.
    SELECT c.shortage_qty, c.requested_qty,
           (SELECT COALESCE(sum(l.quantity), 0)
              FROM public.inventory_transfer_lines l
              JOIN public.inventory_transfers t ON t.organization_id = l.organization_id AND t.id = l.transfer_id
             WHERE l.organization_id = p_organization_id AND l.requirement_id = r.id
               AND t.status IN ('REQUESTED','APPROVED') AND l.source_reservation_id IS NULL) AS pending_raw,
           public.supply_requirement_pending_transfers(p_organization_id, r.id) AS pending_transfers
      INTO cov FROM public.supply_requirement_coverage c WHERE c.organization_id = p_organization_id AND c.requirement_id = r.id;
    v_open := COALESCE(cov.requested_qty, 0);
    v_pending := COALESCE(cov.pending_raw, 0);
    v_short := COALESCE(cov.shortage_qty, 0) - v_open;              -- descoberto ainda não requisitado (inclui o pendente)
    IF v_short <= 0 THEN
      -- As requisições já cobrem a falta: nem cancelar a transferência nem a exceção deixariam algo a comprar.
      RAISE EXCEPTION 'Requirement % has no uncovered shortage left to requisition (% already requested).', r.title, v_open
        USING ERRCODE = '23514';
    END IF;
    v_purchasable := GREATEST(v_short - v_pending, 0);              -- 247: a regra da visão, sem arredondar
    -- 246: sem exceção, compra só o comprável; com exceção, o descoberto inteiro (o pendente, DECLARADO).
    v_excepted := v_override AND v_pending > 0 AND v_short > v_purchasable;
    v_take := CASE WHEN v_excepted THEN v_short ELSE v_purchasable END;
    IF v_take <= 0 THEN
      -- 247: só um pendente de fato nomeia transferências. Com os brutos, descoberto > 0 e pendente 0 dão
      -- comprável > 0; a mensagem de sempre fica como guarda (nunca a lista vazia).
      IF v_pending > 0 THEN
        RAISE EXCEPTION '% is covered by pending internal transfer(s) %: dispatch or cancel the transfer, or request a coverage exception.',
          r.title, (SELECT string_agg(e->>'transfer_number', ', ') FROM jsonb_array_elements(cov.pending_transfers) e)
          USING ERRCODE = '23514';
      END IF;
      RAISE EXCEPTION 'Requirement % has no uncovered shortage left to requisition (% already requested).', r.title, v_open
        USING ERRCODE = '23514';
    END IF;
    SELECT l.id INTO v_line FROM public.purchase_requisition_lines l
     WHERE l.organization_id = p_organization_id AND l.requisition_id = v_req.id AND l.item_id = r.item_id;
    IF v_line IS NULL THEN
      INSERT INTO public.purchase_requisition_lines (organization_id, requisition_id, item_id, quantity, required_by)
      VALUES (p_organization_id, v_req.id, r.item_id, v_take, r.required_by) RETURNING id INTO v_line;
    ELSE
      UPDATE public.purchase_requisition_lines SET quantity = quantity + v_take,
        required_by = LEAST(required_by, r.required_by) WHERE id = v_line;
    END IF;
    INSERT INTO public.purchase_requisition_line_requirements (organization_id, line_id, requirement_id, quantity)
    VALUES (p_organization_id, v_line, r.id, v_take);
    IF v_excepted THEN
      -- 247: tudo bruto — requisitado = comprável + pendente coberto, e a CHECK do livro fecha.
      INSERT INTO public.procurement_coverage_exceptions (organization_id, requisition_id, requisition_line_id, requirement_id,
        shortage_qty, requested_qty, pending_transfer_qty, pending_transfers, purchasable_qty, requisitioned_qty,
        reason, authorized_by, authorized_permission)
      VALUES (p_organization_id, v_req.id, v_line, r.id, COALESCE(cov.shortage_qty, 0), v_open, v_pending, cov.pending_transfers,
        v_purchasable, v_take, v_reason, p_actor, 'procurement.coverage_override');
      v_exc_n := v_exc_n + 1; v_exc_qty := v_exc_qty + (v_take - v_purchasable); v_exc_pending := v_exc_pending + v_pending;
    END IF;
    v_projects := array_append(v_projects, r.project_id);
    v_n := v_n + 1; v_line := NULL;
  END LOOP;

  SELECT min(required_by) INTO v_min FROM public.purchase_requisition_lines WHERE requisition_id = v_req.id;
  UPDATE public.purchase_requisitions SET required_by = v_min,
    project_id = CASE WHEN (SELECT count(DISTINCT x) FROM unnest(v_projects) x) = 1 THEN v_projects[1] ELSE NULL END
  WHERE id = v_req.id RETURNING * INTO v_req;
  v_event := public.emit_domain_event(p_organization_id, 'supply.requisition.submitted', 1, 'purchase_requisition', v_req.id,
    'requisition:' || v_req.id || ':submitted', jsonb_build_object('project_id', v_req.project_id, 'requisition_number',
      v_req.requisition_number, 'requirements', v_n, 'source', 'SHORTAGE'), now(), 'human', p_actor);
  -- 246: a exceção é um fato próprio, causado pela submissão (detalhe por requisito no livro).
  IF v_exc_n > 0 THEN
    PERFORM public.emit_domain_event(p_organization_id, 'supply.requisition.coverage_exception', 1, 'purchase_requisition', v_req.id,
      'requisition:' || v_req.id || ':coverage_exception',
      jsonb_build_object('project_id', v_req.project_id, 'requisition_number', v_req.requisition_number,
        'requirements', v_exc_n, 'pending_transfer_qty', v_exc_pending, 'excepted_qty', v_exc_qty,
        'authorized_permission', 'procurement.coverage_override', 'reason', left(v_reason, 500)),
      now(), 'human', p_actor, NULL, v_event);
  END IF;
  RETURN public.purchase_requisition_shortage_outcome(p_organization_id, v_req.id, false);
END $function$;

-- ---------------------------------------------------------------------------
-- 2) Privilégios: a reescrita continua só do servidor
-- ---------------------------------------------------------------------------
DO $$
DECLARE sig text;
BEGIN
  FOREACH sig IN ARRAY ARRAY['purchase_requisition_from_shortage(uuid,uuid,jsonb)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', sig);
  END LOOP;
END $$;

COMMIT;
