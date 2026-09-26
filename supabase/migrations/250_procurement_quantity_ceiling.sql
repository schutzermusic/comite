-- ============================================================================
-- 250 — COMPRAS: PROPOSTA, DECISÃO E PEDIDO NUNCA ACIMA DO ABERTO
--
-- DEFEITO (provado no QA, SQL desfeito). `procurement_quote_record` aceitava
-- qualquer quantidade > 0 na linha da proposta: 150 numa linha de cotação de
-- 100. `procurement_decide` criava a linha do pedido com a quantidade da
-- proposta (150) e alocava aos requisitos só até o aberto (100): 50 comprados
-- sem requisito nenhum, e a cobertura mostrava 100 em pedido. Nada conferia a
-- quantidade de novo na decisão nem na emissão. E uma segunda decisão, com
-- OUTRA proposta, numa cotação já decidida devolvia o pedido da primeira como
-- "repetição".
--
-- REGRA (docs/operations-supply/COVERAGE-SEMANTICS.md, seção 250), sobre o
-- aberto canônico da 248 (alocado − liberado; linha manual = a quantidade dela):
--   cotado   ≤ cotável  = LEAST(linha da cotação, aberto de agora da linha de
--                          requisição), só de requisição em busca
--   decidido ≤ aberto de agora, conferido de novo SOB as travas da decisão
--   pedido   ≤ o que a requisição cobre (Σ alocações do pedido; linha manual =
--              a quantidade da linha), conferido de novo na emissão
-- Acima disso: recusa com erro de domínio. Nunca apara (o fornecedor cota de
-- novo). Proposta parcial (abaixo) segue valendo: a emissão libera o resto
-- (248). Repetição da decisão = a MESMA proposta; outra proposta numa cotação
-- decidida é recusada.
--
-- O que muda (corpos IMPLANTADOS da 249 — pg_get_functiondef —, mesmas
-- assinaturas, mensagens e travas; mudanças marcadas "250"):
--   1. `procurement_quote_record`: quantidade > 0, requisição em busca e
--      cotado ≤ cotável, por linha;
--   2. `procurement_decide`: repetição só com a mesma proposta; cada linha que
--      vira pedido ≤ aberto de agora (já sob as travas requisitos →
--      requisições → cotação); nenhuma unidade sem requisito;
--   3. `purchase_order_issue`: cada linha ≤ o que a requisição cobre.
-- Nenhuma trava nova: a proposta lê o aberto sem travar a requisição, e a
-- decisão, que trava, confere de novo. Nenhum dado é reescrito: o QA não tem
-- proposta nem pedido acima do cotado (conferido).
-- FORA (escopo do usuário): o impasse de travas do recebimento e a edição de
-- requisito comprometido.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Proposta: cotado ≤ cotável, sem aparar. Corpo implantado (234), mudanças
--    marcadas "250".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.procurement_quote_record(p_organization_id uuid, p_actor uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_rfq public.procurement_rfqs%ROWTYPE; v_sup uuid; v_version int; v_quote public.supplier_quotes%ROWTYPE; line jsonb;
        -- 250
        v_rfq_qty numeric; v_qty numeric; v_open numeric; v_quoteable numeric; v_rn text; v_rs text;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['procurement.source']);
  SELECT * INTO v_rfq FROM public.procurement_rfqs WHERE organization_id = p_organization_id AND id = (p_payload->>'rfq_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RFQ not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF v_rfq.status <> 'OPEN' THEN RAISE EXCEPTION 'RFQ is %: quotes are no longer recorded.', v_rfq.status USING ERRCODE = '23514'; END IF;
  v_sup := (p_payload->>'supplier_id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.procurement_rfq_suppliers WHERE rfq_id = v_rfq.id AND supplier_id = v_sup) THEN
    RAISE EXCEPTION 'Quote from a supplier not invited to this RFQ.' USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(p_payload->'lines') <> 'array' OR jsonb_array_length(p_payload->'lines') = 0 THEN
    RAISE EXCEPTION 'Quote needs at least one priced line.' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(max(version), 0) + 1 INTO v_version FROM public.supplier_quotes WHERE rfq_id = v_rfq.id AND supplier_id = v_sup;
  UPDATE public.supplier_quotes SET status = 'SUPERSEDED' WHERE rfq_id = v_rfq.id AND supplier_id = v_sup AND status = 'RECEIVED';
  INSERT INTO public.supplier_quotes (organization_id, rfq_id, supplier_id, version, currency, freight_amount, tax_amount,
    payment_terms, validity_date, lead_time_days, deviations, document_id, recorded_by)
  VALUES (p_organization_id, v_rfq.id, v_sup, v_version, COALESCE(nullif(p_payload->>'currency',''), 'BRL'),
    COALESCE(nullif(p_payload->>'freight_amount','')::numeric, 0), COALESCE(nullif(p_payload->>'tax_amount','')::numeric, 0),
    nullif(btrim(p_payload->>'payment_terms'),''), nullif(p_payload->>'validity_date','')::date,
    nullif(p_payload->>'lead_time_days','')::int, nullif(btrim(p_payload->>'deviations'),''),
    nullif(p_payload->>'document_id','')::uuid, p_actor)
  RETURNING * INTO v_quote;
  FOR line IN SELECT * FROM jsonb_array_elements(p_payload->'lines') LOOP
    IF NOT EXISTS (SELECT 1 FROM public.procurement_rfq_lines WHERE rfq_id = v_rfq.id AND id = (line->>'rfq_line_id')::uuid) THEN
      RAISE EXCEPTION 'Quote line does not belong to this RFQ.' USING ERRCODE = '23514';
    END IF;
    -- 250: a quantidade cotada cabe no COTÁVEL da linha: o menor entre a linha da cotação e o ABERTO de agora da
    -- linha de requisição (248: Σ aberto das alocações; linha manual = a quantidade dela), e só de requisição em
    -- busca. Acima disso a proposta é RECUSADA — nunca aparada: o fornecedor cota de novo o que cabe. A decisão
    -- confere outra vez, sob as travas (a proposta pode ter envelhecido).
    SELECT x.quantity, r.requisition_number, r.status,
           COALESCE((SELECT sum(o.open_qty) FROM public.purchase_requisition_open_allocations o
                      WHERE o.organization_id = l.organization_id AND o.requisition_line_id = l.id), l.quantity)
      INTO v_rfq_qty, v_rn, v_rs, v_open
      FROM public.procurement_rfq_lines x
      JOIN public.purchase_requisition_lines l ON l.organization_id = x.organization_id AND l.id = x.requisition_line_id
      JOIN public.purchase_requisitions r ON r.organization_id = l.organization_id AND r.id = l.requisition_id
     WHERE x.organization_id = p_organization_id AND x.rfq_id = v_rfq.id AND x.id = (line->>'rfq_line_id')::uuid;
    v_qty := COALESCE(nullif(line->>'quantity','')::numeric, v_rfq_qty);
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Quote line quantity must be positive.' USING ERRCODE = '22023';
    END IF;
    IF v_rs NOT IN ('SUBMITTED','SOURCING') THEN
      RAISE EXCEPTION 'Requisition % is %: its line can no longer be quoted.', v_rn, v_rs USING ERRCODE = '23514';
    END IF;
    v_quoteable := GREATEST(LEAST(v_rfq_qty, v_open), 0);
    IF v_qty > v_quoteable THEN
      RAISE EXCEPTION 'Quoted quantity % exceeds the quoteable quantity % (requisition %).', v_qty, v_quoteable, v_rn USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.supplier_quote_lines (organization_id, quote_id, rfq_line_id, unit_price, quantity, lead_time_days, compliant, note)
    VALUES (p_organization_id, v_quote.id, (line->>'rfq_line_id')::uuid, (line->>'unit_price')::numeric,
      COALESCE(nullif(line->>'quantity','')::numeric, (SELECT quantity FROM public.procurement_rfq_lines WHERE id = (line->>'rfq_line_id')::uuid)),
      nullif(line->>'lead_time_days','')::int, COALESCE((line->>'compliant')::boolean, true), nullif(btrim(line->>'note'),''));
  END LOOP;
  PERFORM public.emit_domain_event(p_organization_id, 'supply.quote.recorded', 1, 'supplier_quote', v_quote.id,
    'quote:' || v_quote.id || ':recorded', jsonb_build_object('rfq_id', v_rfq.id, 'supplier_id', v_sup, 'version', v_version),
    now(), 'human', p_actor);
  RETURN jsonb_build_object('quote_id', v_quote.id, 'version', v_version);
END $function$;

-- ---------------------------------------------------------------------------
-- 2) Decisão: repetição só com a mesma proposta; decidido ≤ aberto de agora,
--    sob as travas. Corpo implantado (249), mudanças marcadas "250".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.procurement_decide(p_organization_id uuid, p_actor uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_rfq public.procurement_rfqs%ROWTYPE; v_quote public.supplier_quotes%ROWTYPE; v_sup public.supplier_profiles%ROWTYPE;
        v_dec public.sourcing_decisions%ROWTYPE; v_po public.purchase_orders%ROWTYPE; ql record; v_line uuid; alloc record;
        v_left numeric; v_take numeric; v_projects text[] := '{}'; v_rec uuid; v_loc uuid;
        -- 248
        v_orderable uuid[]; v_not_ordered jsonb;
        -- 250
        v_over record;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['procurement.source']);
  -- 249: os requisitos das alocações ABERTAS nas linhas de requisição da cotação — os alvos da chave estrangeira
  -- das alocações do pedido abaixo —, travados FOR KEY SHARE em ordem canônica (uuid) ANTES das requisições:
  -- requisitos → requisições → cotação, o prefixo do cancelamento do pedido. Antes, a checagem da chave os
  -- travava um a um, na ordem das alocações e já com as requisições na mão: impasse a três com o cancelamento e a
  -- requisição da falta. O aberto só diminui (livro append-only): o conjunto travado aqui cobre o das alocações.
  PERFORM 1 FROM public.project_requirements pr
   WHERE pr.organization_id = p_organization_id
     AND pr.id IN (SELECT o.requirement_id FROM public.purchase_requisition_open_allocations o
                    WHERE o.organization_id = p_organization_id AND o.open_qty > 0
                      AND o.requisition_line_id IN (SELECT x.requisition_line_id FROM public.procurement_rfq_lines x
                                                     WHERE x.organization_id = p_organization_id AND x.rfq_id = (p_payload->>'rfq_id')::uuid))
   ORDER BY pr.id FOR KEY SHARE;
  -- 248: as requisições por trás das linhas da cotação, travadas em ordem canônica (uuid) ANTES da cotação —
  -- a ordem do cancelamento de requisição (requisição → cotação) e do pedido. Sob a trava, uma requisição
  -- cancelada ao mesmo tempo já aparece cancelada; e o cancelamento dela, depois, já vê este pedido.
  PERFORM 1 FROM public.purchase_requisitions r
   WHERE r.organization_id = p_organization_id
     AND r.id IN (SELECT l.requisition_id FROM public.procurement_rfq_lines x
                    JOIN public.purchase_requisition_lines l ON l.organization_id = x.organization_id AND l.id = x.requisition_line_id
                   WHERE x.organization_id = p_organization_id AND x.rfq_id = (p_payload->>'rfq_id')::uuid)
   ORDER BY r.id FOR UPDATE;
  SELECT * INTO v_rfq FROM public.procurement_rfqs WHERE organization_id = p_organization_id AND id = (p_payload->>'rfq_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RFQ not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_dec FROM public.sourcing_decisions WHERE organization_id = p_organization_id AND rfq_id = v_rfq.id;
  IF FOUND THEN
    -- 250: repetição é a MESMA decisão (mesma proposta). Outra proposta numa cotação já decidida é recusada — a
    -- segunda decisão concorrente não vira pedido nem recebe o pedido da primeira como se fosse o dela.
    IF v_dec.quote_id IS DISTINCT FROM nullif(p_payload->>'quote_id','')::uuid THEN
      RAISE EXCEPTION 'RFQ is already decided on another quote.' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO v_po FROM public.purchase_orders WHERE organization_id = p_organization_id AND sourcing_decision_id = v_dec.id;
    RETURN jsonb_build_object('decision_id', v_dec.id, 'purchase_order_id', v_po.id, 'order_number', v_po.order_number, 'replayed', true);
  END IF;
  IF v_rfq.status <> 'OPEN' THEN RAISE EXCEPTION 'RFQ is %.', v_rfq.status USING ERRCODE = '23514'; END IF;
  IF nullif(btrim(p_payload->>'rationale'),'') IS NULL THEN RAISE EXCEPTION 'Sourcing decision requires a rationale.' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_quote FROM public.supplier_quotes WHERE organization_id = p_organization_id AND id = (p_payload->>'quote_id')::uuid;
  IF NOT FOUND OR v_quote.rfq_id <> v_rfq.id THEN RAISE EXCEPTION 'Quote not found in this RFQ.' USING ERRCODE = 'P0002'; END IF;
  IF v_quote.status <> 'RECEIVED' THEN RAISE EXCEPTION 'Quote is % : decide on the current version.', v_quote.status USING ERRCODE = '23514'; END IF;
  IF v_quote.validity_date IS NOT NULL AND v_quote.validity_date < (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'Quote validity expired on %.', v_quote.validity_date USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_sup FROM public.supplier_profiles WHERE id = v_quote.supplier_id;
  IF v_sup.status NOT IN ('PROSPECT','HOMOLOGATED') THEN
    RAISE EXCEPTION 'Supplier is %: no purchase decision on it.', v_sup.status USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.supplier_quote_lines WHERE quote_id = v_quote.id) THEN
    RAISE EXCEPTION 'Quote has no lines.' USING ERRCODE = '23514';
  END IF;
  -- 248: linha de requisição que não está mais em busca (cancelada, encerrada, pedida) ou sem aberto NÃO vira
  -- pedido — como a linha que a proposta não cotou; vai na resposta. Sem nenhuma linha que possa virar
  -- pedido, a decisão é recusada (a cotação velha de requisição morta não vira compra).
  WITH quoted AS (
    SELECT q.id AS quote_line_id, x.requisition_line_id, r.id AS requisition_id, r.requisition_number, r.status,
           COALESCE((SELECT sum(o.open_qty) FROM public.purchase_requisition_open_allocations o
                      WHERE o.organization_id = l.organization_id AND o.requisition_line_id = l.id), l.quantity) AS open_qty
      FROM public.supplier_quote_lines q
      JOIN public.procurement_rfq_lines x ON x.id = q.rfq_line_id
      JOIN public.purchase_requisition_lines l ON l.id = x.requisition_line_id
      JOIN public.purchase_requisitions r ON r.id = l.requisition_id
     WHERE q.quote_id = v_quote.id)
  SELECT COALESCE(array_agg(k.quote_line_id) FILTER (WHERE k.status IN ('SUBMITTED','SOURCING') AND k.open_qty > 0), '{}'),
         COALESCE(jsonb_agg(jsonb_build_object('quote_line_id', k.quote_line_id, 'requisition_line_id', k.requisition_line_id,
                    'requisition_id', k.requisition_id, 'requisition_number', k.requisition_number,
                    'requisition_status', k.status, 'open_qty', k.open_qty) ORDER BY k.requisition_number, k.quote_line_id)
                  FILTER (WHERE NOT (k.status IN ('SUBMITTED','SOURCING') AND k.open_qty > 0)), '[]'::jsonb)
    INTO v_orderable, v_not_ordered
    FROM quoted k;
  IF cardinality(v_orderable) = 0 THEN
    RAISE EXCEPTION 'No line of this quotation can become an order: its requisitions were cancelled or closed.' USING ERRCODE = '23514';
  END IF;
  -- 250: a quantidade que vai virar pedido é conferida de novo, sob as travas (requisitos → requisições → cotação),
  -- contra o ABERTO de agora de cada linha: a proposta que envelheceu (o aberto caiu depois dela) é RECUSADA, nunca
  -- aparada — cota-se de novo. Sob a trava da requisição o aberto não muda, então o que passa aqui é o que se aloca.
  SELECT q.quantity AS qty, r.requisition_number,
         COALESCE((SELECT sum(o.open_qty) FROM public.purchase_requisition_open_allocations o
                    WHERE o.organization_id = l.organization_id AND o.requisition_line_id = l.id), l.quantity) AS open_qty
    INTO v_over
    FROM public.supplier_quote_lines q
    JOIN public.procurement_rfq_lines x ON x.id = q.rfq_line_id
    JOIN public.purchase_requisition_lines l ON l.id = x.requisition_line_id
    JOIN public.purchase_requisitions r ON r.id = l.requisition_id
   WHERE q.id = ANY (v_orderable)
     AND q.quantity > COALESCE((SELECT sum(o.open_qty) FROM public.purchase_requisition_open_allocations o
                                 WHERE o.organization_id = l.organization_id AND o.requisition_line_id = l.id), l.quantity)
   ORDER BY r.requisition_number, q.id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Quoted quantity % exceeds the current open quantity % (requisition %): record a new quote.',
      v_over.qty, v_over.open_qty, v_over.requisition_number USING ERRCODE = '23514';
  END IF;

  v_rec := nullif(p_payload->>'recommended_quote_id','')::uuid;
  INSERT INTO public.sourcing_decisions (organization_id, rfq_id, quote_id, recommended_quote_id, follows_recommendation,
    rationale, comparison_snapshot, decided_by)
  VALUES (p_organization_id, v_rfq.id, v_quote.id, v_rec, v_rec IS NULL OR v_rec = v_quote.id, btrim(p_payload->>'rationale'),
    COALESCE(p_payload->'comparison', '{}'::jsonb), p_actor)
  RETURNING * INTO v_dec;

  SELECT r.delivery_location_id INTO v_loc FROM public.procurement_rfq_lines x
    JOIN public.purchase_requisition_lines l ON l.id = x.requisition_line_id
    JOIN public.purchase_requisitions r ON r.id = l.requisition_id
   WHERE x.rfq_id = v_rfq.id AND r.delivery_location_id IS NOT NULL LIMIT 1;

  INSERT INTO public.purchase_orders (organization_id, order_number, supplier_id, sourcing_decision_id, currency, freight_amount,
    tax_amount, payment_terms, delivery_location_id, expected_delivery, created_by)
  VALUES (p_organization_id, public.procurement_number('OC'), v_quote.supplier_id, v_dec.id, v_quote.currency, v_quote.freight_amount,
    v_quote.tax_amount, v_quote.payment_terms, v_loc,
    CASE WHEN v_quote.lead_time_days IS NOT NULL THEN (now() AT TIME ZONE 'America/Sao_Paulo')::date + v_quote.lead_time_days END, p_actor)
  RETURNING * INTO v_po;

  FOR ql IN SELECT q.*, x.requisition_line_id, x.item_id FROM public.supplier_quote_lines q
              JOIN public.procurement_rfq_lines x ON x.id = q.rfq_line_id
             WHERE q.quote_id = v_quote.id AND q.id = ANY (v_orderable)          -- 248: só as linhas que podem virar pedido
             ORDER BY x.required_by NULLS LAST, q.id LOOP
    INSERT INTO public.purchase_order_lines (organization_id, purchase_order_id, item_id, quantity, unit_price, expected_date,
      requisition_line_id, quote_line_id)
    VALUES (p_organization_id, v_po.id, ql.item_id, ql.quantity, ql.unit_price,
      CASE WHEN COALESCE(ql.lead_time_days, v_quote.lead_time_days) IS NOT NULL
           THEN (now() AT TIME ZONE 'America/Sao_Paulo')::date + COALESCE(ql.lead_time_days, v_quote.lead_time_days) END,
      ql.requisition_line_id, ql.id)
    RETURNING id INTO v_line;
    v_left := ql.quantity;
    -- 248: só alocações com aberto > 0, até o aberto de cada uma — nunca uma alocação de 0 (a CHECK abortaria a decisão).
    FOR alloc IN SELECT o.requirement_id, o.open_qty, pr.project_id FROM public.purchase_requisition_open_allocations o
                   JOIN public.project_requirements pr ON pr.organization_id = o.organization_id AND pr.id = o.requirement_id
                  WHERE o.organization_id = p_organization_id AND o.requisition_line_id = ql.requisition_line_id AND o.open_qty > 0
                  ORDER BY pr.required_by NULLS LAST, o.allocation_id LOOP
      EXIT WHEN v_left <= 0;
      v_take := least(v_left, alloc.open_qty);
      INSERT INTO public.purchase_order_line_requirements (organization_id, line_id, requirement_id, quantity)
      VALUES (p_organization_id, v_line, alloc.requirement_id, v_take);
      v_projects := array_append(v_projects, alloc.project_id);
      v_left := v_left - v_take;
    END LOOP;
    -- 250: toda unidade pedida tem requisito (a linha com alocação não pede sobra sem rastro).
    IF v_left > 0 AND EXISTS (SELECT 1 FROM public.purchase_requisition_line_requirements a
                               WHERE a.organization_id = p_organization_id AND a.line_id = ql.requisition_line_id) THEN
      RAISE EXCEPTION 'Quote line would order % beyond the requirements of its requisition line.', v_left USING ERRCODE = '23514';
    END IF;
  END LOOP;

  UPDATE public.purchase_orders SET project_id = CASE WHEN (SELECT count(DISTINCT x) FROM unnest(v_projects) x) = 1 THEN v_projects[1] END
   WHERE id = v_po.id RETURNING * INTO v_po;
  UPDATE public.procurement_rfqs SET status = 'DECIDED', closed_at = now() WHERE id = v_rfq.id;
  PERFORM public.emit_domain_event(p_organization_id, 'supply.sourcing.decided', 1, 'sourcing_decision', v_dec.id,
    'sourcing:' || v_dec.id || ':decided', jsonb_build_object('project_id', v_po.project_id, 'rfq_id', v_rfq.id, 'quote_id', v_quote.id,
      'follows_recommendation', v_dec.follows_recommendation), now(), 'human', p_actor);
  PERFORM public.purchase_order_log(v_po, 'created', NULL, NULL, jsonb_build_object('sourcing_decision_id', v_dec.id), p_actor);
  RETURN jsonb_build_object('decision_id', v_dec.id, 'purchase_order_id', v_po.id, 'order_number', v_po.order_number, 'replayed', false,
    'not_ordered', v_not_ordered);
END $function$;

-- ---------------------------------------------------------------------------
-- 3) Emissão: cada linha ≤ o que a requisição cobre. Corpo implantado (249),
--    mudança marcada "250".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purchase_order_issue(p_organization_id uuid, p_actor uuid, p_po_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v public.purchase_orders%ROWTYPE; v_sup text; fp text;
        -- 248
        v_rn text; v_rs text; v_reason text; v_released jsonb; ev record;
        -- 250
        v_over record;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['procurement.orders.issue']);
  SELECT * INTO v FROM public.purchase_orders WHERE organization_id = p_organization_id AND id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF v.status IN ('ISSUED','PARTIALLY_RECEIVED','RECEIVED','CLOSED') THEN
    RETURN jsonb_build_object('purchase_order_id', v.id, 'status', v.status, 'replayed', true);
  END IF;
  IF v.status <> 'APPROVED' THEN RAISE EXCEPTION 'Purchase order is %: only an approved order is issued.', v.status USING ERRCODE = '23514'; END IF;
  fp := public.purchase_order_fingerprint(v.id);
  IF fp IS DISTINCT FROM v.approved_fingerprint THEN
    RAISE EXCEPTION 'Purchase order changed after approval: submit it again.' USING ERRCODE = '23514';
  END IF;
  SELECT status INTO v_sup FROM public.supplier_profiles WHERE id = v.supplier_id;
  IF v_sup NOT IN ('PROSPECT','HOMOLOGATED') THEN
    RAISE EXCEPTION 'Supplier is %: the order is not issued.', v_sup USING ERRCODE = '23514';
  END IF;
  -- 249: os requisitos das alocações ABERTAS nas linhas de requisição do pedido com RESTO a liberar (aberto >
  -- pedido) — exatamente os alvos da chave estrangeira das liberações abaixo —, travados FOR KEY SHARE em ordem
  -- canônica (uuid) ANTES das requisições: pedido → requisitos → requisições, o prefixo do cancelamento. Antes, a
  -- checagem da chave os travava um a um, na ordem das alocações e já com as requisições na mão: impasse com a
  -- requisição da falta e o pedido de transferência (FOR UPDATE, uuid) e, por eles, com o cancelamento. KEY
  -- SHARE não espera o FOR NO KEY UPDATE do cancelamento. Pedido emitido por inteiro não libera nada e segue sem
  -- trava de requisito (como na 248) — não entra na fila do recebimento. O conjunto é estável até as liberações:
  -- o aberto só diminui sob a trava da requisição, e as alocações do pedido não mudam depois do rascunho.
  PERFORM 1 FROM public.project_requirements pr
   WHERE pr.organization_id = p_organization_id
     AND pr.id IN (SELECT o.requirement_id FROM public.purchase_requisition_open_allocations o
                    WHERE o.organization_id = p_organization_id AND o.open_qty > 0
                      AND o.requisition_line_id IN (SELECT pl.requisition_line_id FROM public.purchase_order_lines pl
                                                     WHERE pl.organization_id = p_organization_id AND pl.purchase_order_id = v.id)
                      AND o.open_qty > COALESCE((SELECT sum(a.quantity) FROM public.purchase_order_lines pl
                                                   JOIN public.purchase_order_line_requirements a
                                                     ON a.organization_id = pl.organization_id AND a.line_id = pl.id
                                                  WHERE pl.organization_id = p_organization_id AND pl.purchase_order_id = v.id
                                                    AND pl.requisition_line_id = o.requisition_line_id
                                                    AND a.requirement_id = o.requirement_id), 0))
   ORDER BY pr.id FOR KEY SHARE;
  -- 248: as requisições das linhas do pedido, travadas em ordem canônica (uuid) NUMA instrução própria
  -- (pedido → requisições, a ordem do cancelamento: sem ciclo). Sob a trava vale o estado de agora — pedido
  -- de requisição que morreu (cotação velha de requisição cancelada) não é emitido.
  PERFORM 1 FROM public.purchase_requisitions r
   WHERE r.organization_id = p_organization_id
     AND r.id IN (SELECT l.requisition_id FROM public.purchase_order_lines pl
                    JOIN public.purchase_requisition_lines l ON l.organization_id = pl.organization_id AND l.id = pl.requisition_line_id
                   WHERE pl.organization_id = p_organization_id AND pl.purchase_order_id = v.id)
   ORDER BY r.id FOR UPDATE;
  SELECT r.requisition_number, r.status INTO v_rn, v_rs FROM public.purchase_requisitions r
   WHERE r.organization_id = p_organization_id AND r.status NOT IN ('SUBMITTED','SOURCING')
     AND r.id IN (SELECT l.requisition_id FROM public.purchase_order_lines pl
                    JOIN public.purchase_requisition_lines l ON l.organization_id = pl.organization_id AND l.id = pl.requisition_line_id
                   WHERE pl.organization_id = p_organization_id AND pl.purchase_order_id = v.id)
   ORDER BY r.requisition_number LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Requisition % is %: this order can no longer be issued.', v_rn, v_rs USING ERRCODE = '23514';
  END IF;
  -- 250: o pedido só é emitido com cada linha dentro do que a requisição pede: linha com alocação = Σ das alocações
  -- do pedido (nenhuma unidade sem requisito); linha manual = a quantidade da linha de requisição. Pedido anterior
  -- à 250 com proposta acima do cotado fica aqui, sem emitir.
  SELECT pl.quantity AS qty,
         CASE WHEN EXISTS (SELECT 1 FROM public.purchase_requisition_line_requirements a
                            WHERE a.organization_id = pl.organization_id AND a.line_id = pl.requisition_line_id)
              THEN COALESCE((SELECT sum(a.quantity) FROM public.purchase_order_line_requirements a
                              WHERE a.organization_id = pl.organization_id AND a.line_id = pl.id), 0)
              ELSE (SELECT l.quantity FROM public.purchase_requisition_lines l
                     WHERE l.organization_id = pl.organization_id AND l.id = pl.requisition_line_id) END AS covered
    INTO v_over
    FROM public.purchase_order_lines pl
   WHERE pl.organization_id = p_organization_id AND pl.purchase_order_id = v.id AND pl.requisition_line_id IS NOT NULL
     AND pl.quantity > CASE WHEN EXISTS (SELECT 1 FROM public.purchase_requisition_line_requirements a
                                          WHERE a.organization_id = pl.organization_id AND a.line_id = pl.requisition_line_id)
                            THEN COALESCE((SELECT sum(a.quantity) FROM public.purchase_order_line_requirements a
                                            WHERE a.organization_id = pl.organization_id AND a.line_id = pl.id), 0)
                            ELSE (SELECT l.quantity FROM public.purchase_requisition_lines l
                                   WHERE l.organization_id = pl.organization_id AND l.id = pl.requisition_line_id) END
   ORDER BY pl.id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Purchase order line orders % but its requisition covers only %: it cannot be issued.', v_over.qty, v_over.covered
      USING ERRCODE = '23514';
  END IF;
  UPDATE public.purchase_orders SET status = 'ISSUED', issued_by = p_actor, issued_at = now() WHERE id = v.id RETURNING * INTO v;
  -- 248: o que a requisição pediu e este pedido NÃO pediu (proposta parcial, requisito que a proposta não
  -- alcançou) sai do aberto de forma EXPLÍCITA — livro, estágio PO_ISSUED, causa NOT_ORDERED. Nada muda no
  -- reclamado: a linha com pedido emitido já não conta como requisitada, e o resto já era comprável. O
  -- aberto da alocação passa a ser exatamente o pedido — o máximo que um cancelamento pode devolver.
  v_reason := 'Pedido ' || v.order_number || ' emitido com menos do que o requisitado';
  INSERT INTO public.procurement_requisition_releases (organization_id, requisition_id, requisition_line_id, allocation_id,
    requirement_id, purchase_order_id, stage, quantity, cause, reason)
  SELECT o.organization_id, o.requisition_id, o.requisition_line_id, o.allocation_id, o.requirement_id, v.id, 'PO_ISSUED',
         o.open_qty - COALESCE(d.ordered, 0), 'NOT_ORDERED', v_reason
    FROM public.purchase_requisition_open_allocations o
    LEFT JOIN (SELECT pl.requisition_line_id, a.requirement_id, sum(a.quantity) AS ordered
                 FROM public.purchase_order_lines pl
                 JOIN public.purchase_order_line_requirements a ON a.organization_id = pl.organization_id AND a.line_id = pl.id
                WHERE pl.organization_id = p_organization_id AND pl.purchase_order_id = v.id
                GROUP BY pl.requisition_line_id, a.requirement_id) d
      ON d.requisition_line_id = o.requisition_line_id AND d.requirement_id = o.requirement_id
   WHERE o.organization_id = p_organization_id AND o.open_qty > 0
     AND o.requisition_line_id IN (SELECT pl.requisition_line_id FROM public.purchase_order_lines pl
                                    WHERE pl.organization_id = p_organization_id AND pl.purchase_order_id = v.id)
     AND o.open_qty - COALESCE(d.ordered, 0) > 0
   ORDER BY o.allocation_id;
  -- Requisição toda com pedido emitido está atendida pela compra.
  -- 248: instrução PRÓPRIA, depois das travas e das liberações (retrato novo); só contam as linhas com aberto > 0.
  UPDATE public.purchase_requisitions r SET status = 'ORDERED'
   WHERE r.organization_id = p_organization_id AND r.status IN ('SUBMITTED','SOURCING')
     AND r.id IN (SELECT l.requisition_id FROM public.purchase_requisition_lines l
                   JOIN public.purchase_order_lines pl ON pl.requisition_line_id = l.id WHERE pl.purchase_order_id = v.id)
     AND NOT EXISTS (SELECT 1 FROM public.purchase_requisition_lines l2 WHERE l2.requisition_id = r.id
                      AND COALESCE((SELECT sum(o.open_qty) FROM public.purchase_requisition_open_allocations o
                                     WHERE o.organization_id = l2.organization_id AND o.requisition_line_id = l2.id), l2.quantity) > 0
                      AND NOT EXISTS (SELECT 1 FROM public.purchase_order_lines pl2 JOIN public.purchase_orders po2 ON po2.id = pl2.purchase_order_id
                                       WHERE pl2.requisition_line_id = l2.id AND po2.status IN ('ISSUED','PARTIALLY_RECEIVED','RECEIVED','CLOSED')));
  PERFORM public.purchase_order_log(v, 'issued', 'APPROVED', NULL, jsonb_build_object('fingerprint', fp), p_actor);
  -- 248: o fato da liberação, por (requisição, projeto) — requisição de vários projetos tem project_id NULL,
  -- e a linha do tempo do projeto filtra por ele. A chave carrega pedido, estágio e projeto.
  FOR ev IN
    SELECT x.requisition_id, q.requisition_number, q.status AS status_to, x.project_id,
           jsonb_agg(jsonb_build_object('requirement_id', x.requirement_id, 'item_id', x.item_id, 'unit', x.unit,
             'released_qty', x.qty, 'cause', x.cause) ORDER BY x.requirement_id) AS requirements
      FROM (SELECT z.requisition_id, z.requirement_id, pr.item_id, pr.unit, pr.project_id, z.cause, sum(z.quantity) AS qty
              FROM public.procurement_requisition_releases z
              JOIN public.project_requirements pr ON pr.organization_id = z.organization_id AND pr.id = z.requirement_id
             WHERE z.organization_id = p_organization_id AND z.purchase_order_id = v.id AND z.stage = 'PO_ISSUED'
             GROUP BY z.requisition_id, z.requirement_id, pr.item_id, pr.unit, pr.project_id, z.cause) x
      JOIN public.purchase_requisitions q ON q.organization_id = p_organization_id AND q.id = x.requisition_id
     GROUP BY x.requisition_id, q.requisition_number, q.status, x.project_id
     ORDER BY x.requisition_id, x.project_id
  LOOP
    PERFORM public.emit_domain_event(p_organization_id, 'supply.requisition.released', 1, 'purchase_requisition', ev.requisition_id,
      'requisition:' || ev.requisition_id || ':released:' || v.id || ':PO_ISSUED:' || ev.project_id,
      jsonb_build_object('project_id', ev.project_id, 'requisition_number', ev.requisition_number, 'purchase_order_id', v.id,
        'order_number', v.order_number, 'stage', 'PO_ISSUED', 'status_to', ev.status_to, 'requirements', ev.requirements,
        'reason', v_reason), now(), 'human', p_actor);
  END LOOP;
  -- 248: a resposta diz, por requisito (com item e unidade — nada somado entre itens), o que não foi pedido.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('requirement_id', x.requirement_id, 'item_id', x.item_id, 'unit', x.unit,
           'released_qty', x.qty) ORDER BY x.requirement_id), '[]'::jsonb) INTO v_released
    FROM (SELECT z.requirement_id, pr.item_id, pr.unit, sum(z.quantity) AS qty
            FROM public.procurement_requisition_releases z
            JOIN public.project_requirements pr ON pr.organization_id = z.organization_id AND pr.id = z.requirement_id
           WHERE z.organization_id = p_organization_id AND z.purchase_order_id = v.id AND z.stage = 'PO_ISSUED'
           GROUP BY z.requirement_id, pr.item_id, pr.unit) x;
  RETURN jsonb_build_object('purchase_order_id', v.id, 'status', v.status, 'replayed', false, 'released', v_released);
END $function$;

-- ---------------------------------------------------------------------------
-- 4) Privilégios: as reescritas continuam só do servidor
-- ---------------------------------------------------------------------------
DO $$
DECLARE sig text;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'procurement_quote_record(uuid,uuid,jsonb)', 'procurement_decide(uuid,uuid,jsonb)', 'purchase_order_issue(uuid,uuid,uuid)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', sig);
  END LOOP;
END $$;

COMMIT;
