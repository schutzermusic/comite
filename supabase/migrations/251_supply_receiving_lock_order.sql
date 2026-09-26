-- ============================================================================
-- 251 — SUPPLY: UMA ORDEM DE TRAVAS SÓ (O RECEBIMENTO ENTRA NELA)
--
-- DEFEITO (impasse provado no QA e num clone com COMMIT real). Os três
-- recebimentos travavam a CHAVE DE ESTOQUE (inventory_lock: item, local) e SÓ
-- DEPOIS o requisito, e os requisitos na ordem da necessidade (ou da porção):
--   • goods_receipt_post        pedido → linha → chave → alocação → requisito
--   • goods_receipt_inspect     recebimento → pedido → chave (quarentena) →
--                               requisitos (porções) → [liberação: chaves do destino]
--   • inventory_transfer_receive transferência → linha → chave → requisito
-- Todo o resto trava requisito ANTES da chave, e vários requisitos em ordem de
-- uuid: a reserva (requisito → chave), o pedido de transferência, a requisição
-- da falta, o cancelamento do pedido (NO KEY UPDATE), a emissão parcial e a
-- decisão (KEY SHARE). Duas ordens opostas sobre os mesmos requisitos e chaves:
-- recebimento ∥ reserva, recebimento de transferência ∥ reserva, recebimento ∥
-- cancelamento / emissão parcial / decisão de outro pedido com ≥ 2 requisitos
-- em comum → 40P01. O governedRpc repetia; a repetição era a única defesa.
--
-- REGRA — a ordem canônica das travas de Supply/Compras:
--   [linha-documento: pedido | recebimento → pedido | transferência]
--     → project_requirements (uuid; UPDATE | NO KEY UPDATE | KEY SHARE)
--     → purchase_requisitions (uuid) → procurement_rfqs
--     → chaves de estoque inventory_lock (item, local — em ordem)
--     → linhas, alocações, reservas e movimentos
-- Os três recebimentos passam a pré-travar, logo depois da linha-documento,
-- todos os requisitos que vão tocar (FOR UPDATE, uuid) e depois todas as
-- chaves de estoque (item, local, em ordem) — antes de qualquer linha ou
-- movimento. As travas que já existiam lá embaixo continuam e reencontram o que
-- já está na mão. Nada mais muda: mesmas assinaturas, mensagens, conta de
-- reserva (teto do comprometido), repetição e eventos. A repetição do
-- governedRpc (40P01) fica só como defesa.
-- Já seguiam a ordem: despacho de transferência e contagem (chaves por item),
-- reserva, liberação, baixa e devolução à obra, ajuste (uma chave).
-- FORA (escopo do usuário): edição de requisito comprometido.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Recebimento: requisitos (uuid) → chaves de estoque, antes das linhas.
--    Corpo implantado (238), mudanças marcadas "251".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.goods_receipt_post(p_organization_id uuid, p_actor uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_po public.purchase_orders%ROWTYPE; v_loc public.inventory_locations%ROWTYPE; v_rec public.goods_receipts%ROWTYPE;
        line jsonb; pl public.purchase_order_lines%ROWTYPE; v_item public.supply_items%ROWTYPE; v_acc numeric; v_rej numeric;
        v_open numeric; v_rl uuid; v_left numeric; alloc record; v_take numeric; r public.project_requirements%ROWTYPE;
        v_cap numeric; v_res numeric; v_serial text; v_all boolean; v_key text; v_projects text[] := '{}'; v_from text;
        v_tot_acc numeric := 0; v_tot_rej numeric := 0; v_reserved numeric := 0; v_ship public.inbound_shipments%ROWTYPE;
        v_serials text[]; v_p text;
        -- 251
        v_lk record;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['receiving.receive']);
  v_key := nullif(p_payload->>'idempotency_key','');
  IF v_key IS NOT NULL THEN
    SELECT * INTO v_rec FROM public.goods_receipts WHERE organization_id = p_organization_id AND idempotency_key = v_key;
    IF FOUND THEN
      RETURN jsonb_build_object('receipt_id', v_rec.id, 'receipt_number', v_rec.receipt_number, 'replayed', true);
    END IF;
  END IF;

  SELECT * INTO v_po FROM public.purchase_orders
   WHERE organization_id = p_organization_id AND id = (p_payload->>'purchase_order_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  -- 238: a chave é reconferida SOB a trava do pedido. Duas chamadas com a mesma chave passam juntas pela
  -- checagem acima; a segunda espera a trava e, sem esta releitura, bateria na regra do saldo em aberto
  -- (erro) em vez de devolver o recebimento que a primeira acabou de gravar (replay).
  IF v_key IS NOT NULL THEN
    SELECT * INTO v_rec FROM public.goods_receipts WHERE organization_id = p_organization_id AND idempotency_key = v_key;
    IF FOUND THEN
      RETURN jsonb_build_object('receipt_id', v_rec.id, 'receipt_number', v_rec.receipt_number, 'replayed', true);
    END IF;
  END IF;
  -- 238: a chave é reconferida SOB a trava do pedido. Duas chamadas com a mesma chave passam juntas pela
  -- checagem acima; a segunda espera a trava e, sem esta releitura, bateria na regra do saldo em aberto
  -- (erro) em vez de devolver o recebimento que a primeira acabou de gravar (replay).
  IF v_key IS NOT NULL THEN
    SELECT * INTO v_rec FROM public.goods_receipts WHERE organization_id = p_organization_id AND idempotency_key = v_key;
    IF FOUND THEN
      RETURN jsonb_build_object('receipt_id', v_rec.id, 'receipt_number', v_rec.receipt_number, 'replayed', true);
    END IF;
  END IF;
  -- INV-11: só pedido EMITIDO recebe.
  IF v_po.status NOT IN ('ISSUED','PARTIALLY_RECEIVED') THEN
    RAISE EXCEPTION 'Purchase order is %: only an issued order is received.', v_po.status USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(p_payload->'lines') <> 'array' OR jsonb_array_length(p_payload->'lines') = 0 THEN
    RAISE EXCEPTION 'Receipt needs at least one line.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_loc FROM public.inventory_locations
   WHERE organization_id = p_organization_id AND id = COALESCE(nullif(p_payload->>'location_id','')::uuid, v_po.delivery_location_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Receiving location not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF NOT v_loc.active THEN RAISE EXCEPTION 'Location % is inactive: stock does not enter it.', v_loc.code USING ERRCODE = '23514'; END IF;
  IF nullif(p_payload->>'shipment_id','') IS NOT NULL THEN
    SELECT * INTO v_ship FROM public.inbound_shipments
     WHERE organization_id = p_organization_id AND id = (p_payload->>'shipment_id')::uuid FOR UPDATE;
    IF NOT FOUND OR v_ship.purchase_order_id <> v_po.id OR v_ship.status IN ('RECEIVED','CANCELLED') THEN
      RAISE EXCEPTION 'Shipment does not belong to this order or is closed.' USING ERRCODE = '23514';
    END IF;
  END IF;
  -- 251: a ordem canônica das travas de Supply — [pedido] → requisitos (uuid) → chaves de estoque (item, local)
  -- → linhas. Antes, cada linha travava a chave de estoque e SÓ DEPOIS o requisito (na ordem da necessidade),
  -- o contrário da reserva (requisito → chave) e de quem trava requisitos em ordem de uuid (cancelamento, emissão
  -- parcial, decisão): impasse. Aqui, TODOS os requisitos das alocações das linhas recebidas, FOR UPDATE em ordem
  -- de uuid, e depois todas as chaves de estoque em ordem de item — antes de qualquer linha, movimento ou alocação.
  -- As travas de requisito e de chave abaixo passam a reencontrar o que já está na mão.
  PERFORM 1 FROM public.project_requirements pr
   WHERE pr.organization_id = p_organization_id
     AND pr.id IN (SELECT a.requirement_id FROM public.purchase_order_line_requirements a
                    JOIN public.purchase_order_lines ol ON ol.organization_id = a.organization_id AND ol.id = a.line_id
                   WHERE ol.organization_id = p_organization_id AND ol.purchase_order_id = v_po.id
                     AND ol.id IN (SELECT (x->>'po_line_id')::uuid FROM jsonb_array_elements(p_payload->'lines') x))
   ORDER BY pr.id FOR UPDATE;
  FOR v_lk IN SELECT DISTINCT ol.item_id FROM public.purchase_order_lines ol
               WHERE ol.organization_id = p_organization_id AND ol.purchase_order_id = v_po.id
                 AND ol.id IN (SELECT (x->>'po_line_id')::uuid FROM jsonb_array_elements(p_payload->'lines') x)
               ORDER BY ol.item_id LOOP
    PERFORM public.inventory_lock(p_organization_id, v_lk.item_id, v_loc.id);
  END LOOP;

  INSERT INTO public.goods_receipts (organization_id, receipt_number, purchase_order_id, shipment_id, location_id, received_at,
    received_by, note, discrepancy_reason, inspection_status, idempotency_key)
  VALUES (p_organization_id, public.procurement_number('REC'), v_po.id, v_ship.id, v_loc.id,
    COALESCE(nullif(p_payload->>'received_at','')::timestamptz, now()), p_actor, nullif(btrim(p_payload->>'note'),''),
    nullif(btrim(p_payload->>'discrepancy_reason'),''),
    CASE WHEN v_loc.kind = 'QUARANTINE' THEN 'PENDING' ELSE 'NOT_REQUIRED' END, v_key)
  RETURNING * INTO v_rec;

  FOR line IN SELECT * FROM jsonb_array_elements(p_payload->'lines') ORDER BY value->>'po_line_id' LOOP
    SELECT * INTO pl FROM public.purchase_order_lines
     WHERE organization_id = p_organization_id AND id = (line->>'po_line_id')::uuid AND purchase_order_id = v_po.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Receipt line does not belong to this purchase order.' USING ERRCODE = '23514'; END IF;
    v_acc := COALESCE(nullif(line->>'accepted_quantity','')::numeric, 0);
    v_rej := COALESCE(nullif(line->>'rejected_quantity','')::numeric, 0);
    IF v_acc < 0 OR v_rej < 0 OR v_acc + v_rej = 0 THEN
      RAISE EXCEPTION 'Receipt line needs a received or rejected quantity.' USING ERRCODE = '22023';
    END IF;
    v_open := pl.quantity - pl.received_quantity;
    IF v_acc > v_open THEN
      RAISE EXCEPTION 'Receipt exceeds the open quantity of the order line (% open).', v_open USING ERRCODE = '23514';
    END IF;
    SELECT * INTO v_item FROM public.supply_items WHERE id = pl.item_id;
    v_serials := ARRAY(SELECT DISTINCT btrim(x) FROM jsonb_array_elements_text(COALESCE(line->'serials','[]'::jsonb)) x WHERE btrim(x) <> '');
    IF v_item.tracking = 'SERIAL' AND v_acc > 0 AND (v_acc <> floor(v_acc) OR COALESCE(array_length(v_serials, 1), 0) <> v_acc) THEN
      RAISE EXCEPTION 'Serial-tracked item needs one distinct serial per received unit (% received, % serials).',
        v_acc, COALESCE(array_length(v_serials, 1), 0) USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.goods_receipt_lines (organization_id, receipt_id, po_line_id, item_id, accepted_quantity, rejected_quantity,
      rejection_reason, lot_code, serials)
    VALUES (p_organization_id, v_rec.id, pl.id, pl.item_id, v_acc, v_rej, nullif(btrim(line->>'rejection_reason'),''),
      nullif(btrim(line->>'lot_code'),''), CASE WHEN v_item.tracking = 'SERIAL' THEN v_serials ELSE '{}' END)
    RETURNING id INTO v_rl;

    IF v_acc > 0 THEN
      PERFORM public.inventory_lock(p_organization_id, pl.item_id, v_loc.id);
      IF v_item.tracking = 'SERIAL' THEN
        FOREACH v_serial IN ARRAY v_serials LOOP
          PERFORM public.inventory_post_movement(p_organization_id, p_actor, 'RECEIPT', pl.item_id, v_loc.id, 1, v_serial,
            'receipt:' || v_rl || ':' || v_serial, jsonb_build_object('receipt_line_id', v_rl, 'project_id', v_po.project_id), NULL);
        END LOOP;
      ELSE
        PERFORM public.inventory_post_movement(p_organization_id, p_actor, 'RECEIPT', pl.item_id, v_loc.id, v_acc,
          line->>'lot_code', 'receipt:' || v_rl, jsonb_build_object('receipt_line_id', v_rl, 'project_id', v_po.project_id), NULL);
      END IF;
      UPDATE public.purchase_order_lines SET received_quantity = received_quantity + v_acc WHERE id = pl.id;

      v_left := v_acc;
      FOR alloc IN SELECT a.id, a.requirement_id, a.quantity - a.received_quantity AS open
                     FROM public.purchase_order_line_requirements a
                     JOIN public.project_requirements pr ON pr.id = a.requirement_id
                    WHERE a.line_id = pl.id AND a.quantity > a.received_quantity
                    ORDER BY pr.required_by NULLS LAST, a.id LOOP
        EXIT WHEN v_left <= 0;
        v_take := least(v_left, alloc.open);
        UPDATE public.purchase_order_line_requirements SET received_quantity = received_quantity + v_take WHERE id = alloc.id;
        INSERT INTO public.goods_receipt_line_requirements (organization_id, receipt_line_id, requirement_id, quantity)
        VALUES (p_organization_id, v_rl, alloc.requirement_id, v_take);
        SELECT * INTO r FROM public.project_requirements WHERE id = alloc.requirement_id FOR UPDATE;
        v_projects := array_append(v_projects, r.project_id);
        IF v_loc.kind <> 'QUARANTINE' AND r.status = 'CONFIRMED' THEN
          v_cap := r.quantity - public.inventory_requirement_committed(p_organization_id, r.id);
          v_res := least(v_take, greatest(v_cap, 0));
          IF v_res > 0 THEN
            INSERT INTO public.inventory_reservations (organization_id, item_id, location_id, project_id, requirement_id, quantity,
              required_by, source, source_receipt_line_id, note, created_by)
            VALUES (p_organization_id, pl.item_id, v_loc.id, r.project_id, r.id, v_res, r.required_by, 'RECEIPT', v_rl,
              'Recebido em ' || v_rec.receipt_number, p_actor);
            v_reserved := v_reserved + v_res;
          END IF;
        END IF;
        v_left := v_left - v_take;
      END LOOP;
    END IF;
    v_tot_acc := v_tot_acc + v_acc; v_tot_rej := v_tot_rej + v_rej;
  END LOOP;

  SELECT bool_and(received_quantity >= quantity) INTO v_all FROM public.purchase_order_lines WHERE purchase_order_id = v_po.id;
  v_from := v_po.status;
  UPDATE public.purchase_orders SET status = CASE WHEN v_all THEN 'RECEIVED'
      WHEN EXISTS (SELECT 1 FROM public.purchase_order_lines WHERE purchase_order_id = v_po.id AND received_quantity > 0) THEN 'PARTIALLY_RECEIVED'
      ELSE status END
   WHERE id = v_po.id RETURNING * INTO v_po;
  PERFORM public.purchase_order_log(v_po, CASE WHEN v_po.status = 'RECEIVED' THEN 'received' ELSE 'partially_received' END, v_from, NULL,
    jsonb_build_object('receipt_id', v_rec.id, 'receipt_number', v_rec.receipt_number, 'accepted', v_tot_acc, 'rejected', v_tot_rej), p_actor);
  IF v_ship.id IS NOT NULL THEN
    UPDATE public.inbound_shipments SET status = 'RECEIVED', arrived_at = COALESCE(arrived_at, now()) WHERE id = v_ship.id;
  END IF;

  -- O fato canônico para Finanças (3-way match) e para a Timeline de cada projeto atendido.
  PERFORM public.emit_domain_event(p_organization_id, 'supply.goods_receipt.posted', 1, 'goods_receipt', v_rec.id,
    'goods-receipt:' || v_rec.id || ':posted',
    jsonb_build_object('purchase_order_id', v_po.id, 'order_number', v_po.order_number, 'supplier_id', v_po.supplier_id,
      'receipt_number', v_rec.receipt_number, 'accepted', v_tot_acc, 'rejected', v_tot_rej, 'currency', v_po.currency,
      'inspection_status', v_rec.inspection_status,
      'project_ids', (SELECT COALESCE(jsonb_agg(DISTINCT x), '[]'::jsonb) FROM unnest(v_projects) x)), now(), 'human', p_actor);
  FOR v_p IN SELECT DISTINCT x FROM unnest(v_projects) x LOOP
    PERFORM public.emit_domain_event(p_organization_id, 'supply.goods_receipt.project_received', 1, 'goods_receipt', v_rec.id,
      'goods-receipt:' || v_rec.id || ':project:' || v_p,
      jsonb_build_object('project_id', v_p, 'receipt_number', v_rec.receipt_number, 'order_number', v_po.order_number,
        'inspection_status', v_rec.inspection_status), now(), 'human', p_actor);
  END LOOP;

  RETURN jsonb_build_object('receipt_id', v_rec.id, 'receipt_number', v_rec.receipt_number, 'order_status', v_po.status,
    'inspection_status', v_rec.inspection_status, 'accepted', v_tot_acc, 'rejected', v_tot_rej, 'reserved', v_reserved,
    'replayed', false);
END $function$;

-- ---------------------------------------------------------------------------
-- 2) Inspeção: requisitos (uuid) → chaves (quarentena e destino), antes das
--    linhas. Corpo implantado (237), mudanças marcadas "251".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.goods_receipt_inspect(p_organization_id uuid, p_actor uuid, p_receipt_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_rec public.goods_receipts%ROWTYPE; v_dest public.inventory_locations%ROWTYPE; line jsonb;
        rl public.goods_receipt_lines%ROWTYPE; v_item public.supply_items%ROWTYPE; v_app numeric; v_rej numeric;
        v_app_left numeric; portion record; v_a numeric; v_r numeric; v_tlines jsonb := '[]'::jsonb; v_serials_ok text[];
        v_serials_rej text[]; v_serial text; v_i int; v_tr jsonb; v_line record; v_rlines jsonb := '[]'::jsonb;
        v_po public.purchase_orders%ROWTYPE; v_from text; v_tot_app numeric := 0; v_tot_rej numeric := 0; v_status text;
        v_reason text; v_idx int; r public.project_requirements%ROWTYPE; v_cap numeric; v_req numeric;
        v_decided jsonb := '{}'::jsonb;
        -- 251
        v_lk record; v_dest_id uuid;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['receiving.receive']);
  -- A liberação move estoque entre locais: exige também quem gere estoque.
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['inventory.manage']);
  SELECT * INTO v_rec FROM public.goods_receipts WHERE organization_id = p_organization_id AND id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Goods receipt not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF v_rec.inspection_status <> 'PENDING' THEN
    RAISE EXCEPTION 'Goods receipt inspection is %: nothing to decide.', v_rec.inspection_status USING ERRCODE = '23514';
  END IF;
  v_reason := nullif(btrim(p_payload->>'reason'),'');
  SELECT * INTO v_po FROM public.purchase_orders WHERE id = v_rec.purchase_order_id FOR UPDATE;
  -- 251: a ordem canônica — [recebimento → pedido] → requisitos (uuid) → chaves de estoque (item, local). Antes, a
  -- 1ª passada travava a chave da quarentena e a 2ª, os requisitos (na ordem das porções), e a liberação aninhada
  -- travava as chaves do destino: o contrário da reserva e de quem trava requisitos em ordem de uuid. Aqui, todos
  -- os requisitos das porções do recebimento (FOR UPDATE, uuid) e todas as chaves que a inspeção e a liberação
  -- tocam (quarentena e destino, por item), antes de qualquer linha ou movimento; o resto reencontra o que já tem.
  PERFORM 1 FROM public.project_requirements pr
   WHERE pr.organization_id = p_organization_id
     AND pr.id IN (SELECT q.requirement_id FROM public.goods_receipt_line_requirements q
                    JOIN public.goods_receipt_lines l ON l.organization_id = q.organization_id AND l.id = q.receipt_line_id
                   WHERE l.organization_id = p_organization_id AND l.receipt_id = v_rec.id)
   ORDER BY pr.id FOR UPDATE;
  v_dest_id := CASE WHEN p_payload->>'destination_location_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    THEN (p_payload->>'destination_location_id')::uuid END;
  FOR v_lk IN SELECT k.item_id, k.location_id FROM (
                SELECT DISTINCT l.item_id, x.location_id FROM public.goods_receipt_lines l
                  CROSS JOIN LATERAL (VALUES (v_rec.location_id), (v_dest_id)) x(location_id)
                 WHERE l.organization_id = p_organization_id AND l.receipt_id = v_rec.id AND l.accepted_quantity > 0
                   AND x.location_id IS NOT NULL) k
               ORDER BY k.item_id, k.location_id LOOP
    PERFORM public.inventory_lock(p_organization_id, v_lk.item_id, v_lk.location_id);
  END LOOP;

  -- 1ª passada: decide cada linha (aprovado + rejeitado = aceito) e tira o rejeitado do estoque.
  FOR rl IN SELECT * FROM public.goods_receipt_lines WHERE receipt_id = v_rec.id AND accepted_quantity > 0 ORDER BY id LOOP
    SELECT value INTO line FROM jsonb_array_elements(COALESCE(p_payload->'lines','[]'::jsonb)) WHERE value->>'line_id' = rl.id::text;
    IF line IS NULL THEN RAISE EXCEPTION 'Inspection must decide every received line.' USING ERRCODE = '22023'; END IF;
    SELECT * INTO v_item FROM public.supply_items WHERE id = rl.item_id;
    IF v_item.tracking = 'SERIAL' THEN
      v_serials_ok := ARRAY(SELECT jsonb_array_elements_text(COALESCE(line->'approved_serials','[]'::jsonb)));
      v_serials_rej := ARRAY(SELECT jsonb_array_elements_text(COALESCE(line->'rejected_serials','[]'::jsonb)));
      IF (SELECT array_agg(x ORDER BY x) FROM unnest(v_serials_ok || v_serials_rej) x) IS DISTINCT FROM
         (SELECT array_agg(x ORDER BY x) FROM unnest(rl.serials) x) THEN
        RAISE EXCEPTION 'Inspection of a serial line decides each received serial exactly once.' USING ERRCODE = '22023';
      END IF;
      v_app := COALESCE(array_length(v_serials_ok, 1), 0); v_rej := COALESCE(array_length(v_serials_rej, 1), 0);
    ELSE
      v_serials_ok := '{}'; v_serials_rej := '{}';
      v_app := COALESCE(nullif(line->>'approved_quantity','')::numeric, 0);
      v_rej := COALESCE(nullif(line->>'rejected_quantity','')::numeric, 0);
    END IF;
    IF v_app < 0 OR v_rej < 0 OR v_app + v_rej <> rl.accepted_quantity THEN
      RAISE EXCEPTION 'Inspection must decide every accepted unit: approved + rejected = % for the line.', rl.accepted_quantity
        USING ERRCODE = '22023';
    END IF;
    IF v_rej > 0 AND v_reason IS NULL THEN
      RAISE EXCEPTION 'Rejection at inspection requires a reason.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.goods_receipt_lines SET inspection_approved_quantity = v_app, inspection_rejected_quantity = v_rej,
      inspection_reason = CASE WHEN v_rej > 0 THEN v_reason END WHERE id = rl.id;
    v_decided := v_decided || jsonb_build_object(rl.id::text, jsonb_build_object('approved', v_app, 'serials', to_jsonb(v_serials_ok)));

    -- O rejeitado corresponde às últimas porções do rastro: recua a alocação delas (depois da liberação).
    v_app_left := v_app;
    FOR portion IN SELECT requirement_id, quantity FROM public.goods_receipt_line_requirements
                    WHERE receipt_line_id = rl.id ORDER BY id LOOP
      v_a := least(v_app_left, portion.quantity);
      v_r := portion.quantity - v_a;
      IF v_r > 0 THEN
        v_rlines := v_rlines || jsonb_build_object('po_line_id', rl.po_line_id, 'requirement_id', portion.requirement_id, 'quantity', v_r);
      END IF;
      v_app_left := v_app_left - v_a;
    END LOOP;

    -- Rejeitado: sai da quarentena (devolução ao fornecedor) e volta a ser esperado.
    IF v_rej > 0 THEN
      PERFORM public.inventory_lock(p_organization_id, rl.item_id, v_rec.location_id);
      IF v_item.tracking = 'SERIAL' THEN
        FOREACH v_serial IN ARRAY v_serials_rej LOOP
          PERFORM public.inventory_post_movement(p_organization_id, p_actor, 'ADJUSTMENT', rl.item_id, v_rec.location_id, -1, v_serial,
            'inspection-reject:' || rl.id || ':' || v_serial, jsonb_build_object('receipt_line_id', rl.id),
            'Rejeitado na inspeção (' || v_rec.receipt_number || '): ' || v_reason);
        END LOOP;
      ELSE
        PERFORM public.inventory_post_movement(p_organization_id, p_actor, 'ADJUSTMENT', rl.item_id, v_rec.location_id, -v_rej,
          rl.lot_code, 'inspection-reject:' || rl.id, jsonb_build_object('receipt_line_id', rl.id),
          'Rejeitado na inspeção (' || v_rec.receipt_number || '): ' || v_reason);
      END IF;
      UPDATE public.purchase_order_lines SET received_quantity = received_quantity - v_rej WHERE id = rl.po_line_id;
    END IF;
    v_tot_app := v_tot_app + v_app; v_tot_rej := v_tot_rej + v_rej;
  END LOOP;

  -- A decisão fica registrada ANTES da liberação: o que estava "em inspeção" deixa de contar como
  -- entrando, e a liberação não disputa a própria quantidade com a cobertura.
  v_status := CASE WHEN v_tot_rej = 0 THEN 'APPROVED' WHEN v_tot_app = 0 THEN 'REJECTED' ELSE 'PARTIALLY_REJECTED' END;
  UPDATE public.goods_receipts SET inspection_status = v_status, inspected_by = p_actor, inspected_at = now(),
    inspection_note = v_reason WHERE id = v_rec.id;

  -- 2ª passada: aprovado primeiro para os requisitos (na ordem em que o recebimento os atendeu), até
  -- o que cada um ainda comporta; o resto é liberado como estoque livre.
  FOR rl IN SELECT * FROM public.goods_receipt_lines WHERE receipt_id = v_rec.id AND accepted_quantity > 0 ORDER BY id LOOP
    SELECT * INTO v_item FROM public.supply_items WHERE id = rl.item_id;
    v_app := (v_decided->rl.id::text->>'approved')::numeric;
    v_serials_ok := ARRAY(SELECT jsonb_array_elements_text(v_decided->rl.id::text->'serials'));
    v_app_left := v_app; v_idx := 0;
    FOR portion IN SELECT requirement_id, quantity FROM public.goods_receipt_line_requirements
                    WHERE receipt_line_id = rl.id ORDER BY id LOOP
      v_a := least(v_app_left, portion.quantity);
      IF v_a > 0 THEN
        SELECT * INTO r FROM public.project_requirements WHERE id = portion.requirement_id FOR UPDATE;
        v_cap := CASE WHEN r.status = 'CONFIRMED' THEN r.quantity - public.inventory_requirement_committed(p_organization_id, r.id) ELSE 0 END;
        v_req := least(v_a, greatest(v_cap, 0));
        IF v_item.tracking = 'SERIAL' THEN
          FOR v_i IN 1..v_a::int LOOP
            v_tlines := v_tlines || jsonb_build_object('item_id', rl.item_id, 'quantity', 1, 'lot_code', v_serials_ok[v_idx + v_i],
              'requirement_id', CASE WHEN v_i <= v_req THEN portion.requirement_id END);
          END LOOP;
          v_idx := v_idx + v_a::int;
        ELSE
          IF v_req > 0 THEN
            v_tlines := v_tlines || jsonb_build_object('item_id', rl.item_id, 'quantity', v_req, 'requirement_id', portion.requirement_id,
              'lot_code', rl.lot_code);
          END IF;
          IF v_a - v_req > 0 THEN
            v_tlines := v_tlines || jsonb_build_object('item_id', rl.item_id, 'quantity', v_a - v_req, 'lot_code', rl.lot_code);
          END IF;
        END IF;
      END IF;
      v_app_left := v_app_left - v_a;
    END LOOP;
    IF v_app_left > 0 THEN
      IF v_item.tracking = 'SERIAL' THEN
        FOR v_i IN 1..v_app_left::int LOOP
          v_tlines := v_tlines || jsonb_build_object('item_id', rl.item_id, 'quantity', 1, 'lot_code', v_serials_ok[v_idx + v_i]);
        END LOOP;
      ELSE
        v_tlines := v_tlines || jsonb_build_object('item_id', rl.item_id, 'quantity', v_app_left, 'lot_code', rl.lot_code);
      END IF;
    END IF;
  END LOOP;

  -- Liberação pelo fluxo canônico de transferência (quarentena → destino).
  IF jsonb_array_length(v_tlines) > 0 THEN
    SELECT * INTO v_dest FROM public.inventory_locations
     WHERE organization_id = p_organization_id AND id = nullif(p_payload->>'destination_location_id','')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Inspection destination not found in tenant.' USING ERRCODE = 'P0002'; END IF;
    IF v_dest.kind = 'QUARANTINE' OR NOT v_dest.active OR v_dest.id = v_rec.location_id THEN
      RAISE EXCEPTION 'Inspection releases to an active location outside quarantine.' USING ERRCODE = '23514';
    END IF;
    -- 237: a liberação da inspeção é o ÚNICO caminho de saída da quarentena (ver inventory_assert_outside_quarantine).
    PERFORM set_config('apex.inspection_release', v_rec.id::text, true);
    v_tr := public.inventory_transfer_request(p_organization_id, p_actor, jsonb_build_object(
      'from_location_id', v_rec.location_id, 'to_location_id', v_dest.id, 'lines', v_tlines,
      'note', 'Liberação de inspeção ' || v_rec.receipt_number, 'idempotency_key', 'inspection:' || v_rec.id));
    PERFORM public.inventory_transfer_approve(p_organization_id, p_actor, (v_tr->>'transfer_id')::uuid);
    PERFORM public.inventory_transfer_dispatch(p_organization_id, p_actor, (v_tr->>'transfer_id')::uuid, '{}'::jsonb);
    PERFORM public.inventory_transfer_receive(p_organization_id, p_actor, (v_tr->>'transfer_id')::uuid, jsonb_build_object(
      'idempotency_key', 'inspection:' || v_rec.id,
      'lines', (SELECT jsonb_agg(jsonb_build_object('line_id', l.id, 'quantity', l.quantity))
                  FROM public.inventory_transfer_lines l WHERE l.transfer_id = (v_tr->>'transfer_id')::uuid)));
    PERFORM public.inventory_transfer_close(p_organization_id, p_actor, (v_tr->>'transfer_id')::uuid, NULL);
    PERFORM set_config('apex.inspection_release', '', true);
    UPDATE public.goods_receipts SET inspection_transfer_id = (v_tr->>'transfer_id')::uuid WHERE id = v_rec.id;
  END IF;

  -- Alocação ao requisito recua pelo rejeitado (depois da liberação: nunca cobre duas vezes no meio do ato).
  FOR v_line IN SELECT (x->>'po_line_id')::uuid AS po_line_id, (x->>'requirement_id')::uuid AS requirement_id,
                       (x->>'quantity')::numeric AS quantity FROM jsonb_array_elements(v_rlines) x LOOP
    UPDATE public.purchase_order_line_requirements SET received_quantity = received_quantity - v_line.quantity
     WHERE line_id = v_line.po_line_id AND requirement_id = v_line.requirement_id;
  END LOOP;

  IF v_tot_rej > 0 THEN
    v_from := v_po.status;
    UPDATE public.purchase_orders SET status = CASE
        WHEN NOT EXISTS (SELECT 1 FROM public.purchase_order_lines WHERE purchase_order_id = v_po.id AND received_quantity < quantity) THEN 'RECEIVED'
        WHEN EXISTS (SELECT 1 FROM public.purchase_order_lines WHERE purchase_order_id = v_po.id AND received_quantity > 0) THEN 'PARTIALLY_RECEIVED'
        ELSE 'ISSUED' END
     WHERE id = v_po.id AND status IN ('ISSUED','PARTIALLY_RECEIVED','RECEIVED') RETURNING * INTO v_po;
    PERFORM public.purchase_order_log(v_po, 'inspection_rejected', v_from, v_reason,
      jsonb_build_object('receipt_id', v_rec.id, 'rejected', v_tot_rej), p_actor);
  END IF;
  PERFORM public.emit_domain_event(p_organization_id, 'supply.goods_receipt.inspected', 1, 'goods_receipt', v_rec.id,
    'goods-receipt:' || v_rec.id || ':inspected', jsonb_build_object('purchase_order_id', v_rec.purchase_order_id,
      'receipt_number', v_rec.receipt_number, 'approved', v_tot_app, 'rejected', v_tot_rej, 'status', v_status), now(), 'human', p_actor);
  RETURN jsonb_build_object('receipt_id', v_rec.id, 'inspection_status', v_status, 'approved', v_tot_app, 'rejected', v_tot_rej,
    'transfer_id', v_tr->>'transfer_id');
END $function$;

-- ---------------------------------------------------------------------------
-- 3) Recebimento de transferência: requisitos (uuid) → chaves do destino, antes
--    das linhas. Corpo implantado (237), mudanças marcadas "251".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inventory_transfer_receive(p_organization_id uuid, p_actor uuid, p_transfer_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE t public.inventory_transfers%ROWTYPE; l public.inventory_transfer_lines%ROWTYPE; line jsonb; v_qty numeric; v_key text;
        r public.project_requirements%ROWTYPE; v_to public.inventory_locations%ROWTYPE; v_cap numeric; v_reserve numeric;
        v_step int; v_all boolean; v_reserved numeric := 0;
        -- 251
        v_lk record;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['inventory.manage','receiving.receive']);
  v_key := COALESCE(nullif(p_payload->>'idempotency_key',''), gen_random_uuid()::text);
  SELECT * INTO t FROM public.inventory_transfers WHERE organization_id = p_organization_id AND id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_movements WHERE organization_id = p_organization_id
              AND starts_with(idempotency_key, 'transfer-receive:' || v_key || ':')) THEN
    RETURN jsonb_build_object('transfer_id', t.id, 'status', t.status, 'replayed', true);
  END IF;
  IF t.status NOT IN ('IN_TRANSIT','PARTIALLY_RECEIVED') THEN
    RAISE EXCEPTION 'Transfer is %: nothing in transit to receive.', t.status USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(p_payload->'lines') <> 'array' OR jsonb_array_length(p_payload->'lines') = 0 THEN
    RAISE EXCEPTION 'Receipt needs at least one line.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_to FROM public.inventory_locations WHERE organization_id = p_organization_id AND id = t.to_location_id;
  -- 251: a ordem canônica — [transferência] → requisitos (uuid) → chaves de estoque (item, local) → linhas. Antes,
  -- cada linha travava a chave do destino e SÓ DEPOIS o requisito: o contrário da reserva (requisito → chave).
  -- Aqui, todos os requisitos das linhas recebidas (FOR UPDATE, uuid) e todas as chaves do destino (por item),
  -- antes de qualquer linha ou movimento; as travas abaixo reencontram o que já está na mão.
  PERFORM 1 FROM public.project_requirements pr
   WHERE pr.organization_id = p_organization_id
     AND pr.id IN (SELECT l2.requirement_id FROM public.inventory_transfer_lines l2
                    WHERE l2.organization_id = p_organization_id AND l2.transfer_id = t.id AND l2.requirement_id IS NOT NULL
                      AND l2.id IN (SELECT (x->>'line_id')::uuid FROM jsonb_array_elements(p_payload->'lines') x))
   ORDER BY pr.id FOR UPDATE;
  FOR v_lk IN SELECT DISTINCT l2.item_id FROM public.inventory_transfer_lines l2
               WHERE l2.organization_id = p_organization_id AND l2.transfer_id = t.id
                 AND l2.id IN (SELECT (x->>'line_id')::uuid FROM jsonb_array_elements(p_payload->'lines') x)
               ORDER BY l2.item_id LOOP
    PERFORM public.inventory_lock(p_organization_id, v_lk.item_id, t.to_location_id);
  END LOOP;

  FOR line IN SELECT * FROM jsonb_array_elements(p_payload->'lines') ORDER BY value->>'line_id' LOOP
    SELECT * INTO l FROM public.inventory_transfer_lines
     WHERE organization_id = p_organization_id AND transfer_id = t.id AND id = (line->>'line_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Transfer line not found.' USING ERRCODE = 'P0002'; END IF;
    v_qty := (line->>'quantity')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 OR l.received_quantity + v_qty > l.dispatched_quantity THEN
      RAISE EXCEPTION 'Received quantity must be positive and not exceed what was dispatched (% pending).',
        l.dispatched_quantity - l.received_quantity USING ERRCODE = '23514';
    END IF;
    PERFORM public.inventory_lock(p_organization_id, l.item_id, t.to_location_id);
    PERFORM public.inventory_post_movement(p_organization_id, p_actor, 'TRANSFER_IN', l.item_id, t.to_location_id, v_qty,
      l.lot_code, 'transfer-receive:' || v_key || ':' || l.id,
      jsonb_build_object('project_id', t.project_id, 'requirement_id', l.requirement_id, 'transfer_line_id', l.id), NULL);
    UPDATE public.inventory_transfer_lines SET received_quantity = received_quantity + v_qty
     WHERE organization_id = p_organization_id AND id = l.id;

    IF l.requirement_id IS NOT NULL AND v_to.kind <> 'QUARANTINE' THEN
      SELECT * INTO r FROM public.project_requirements WHERE organization_id = p_organization_id AND id = l.requirement_id FOR UPDATE;
      IF r.status = 'CONFIRMED' THEN
        v_cap := r.quantity - public.inventory_requirement_committed(p_organization_id, r.id);
        v_reserve := least(v_qty, greatest(v_cap, 0));
        IF v_reserve > 0 THEN
          INSERT INTO public.inventory_reservations (organization_id, item_id, location_id, project_id, requirement_id, quantity,
            required_by, source, source_transfer_line_id, note, created_by)
          VALUES (p_organization_id, l.item_id, t.to_location_id, r.project_id, r.id, v_reserve, r.required_by, 'TRANSFER', l.id,
            'Recebido pela transferência ' || t.transfer_number, p_actor);
          v_reserved := v_reserved + v_reserve;
        END IF;
      END IF;
    END IF;
  END LOOP;

  SELECT bool_and(received_quantity = dispatched_quantity) INTO v_all
    FROM public.inventory_transfer_lines WHERE organization_id = p_organization_id AND transfer_id = t.id;
  UPDATE public.inventory_transfers SET status = CASE WHEN v_all THEN 'RECEIVED' ELSE 'PARTIALLY_RECEIVED' END,
    received_at = CASE WHEN v_all THEN now() ELSE received_at END,
    evidence_document_id = COALESCE(nullif(p_payload->>'evidence_document_id','')::uuid, evidence_document_id)
  WHERE organization_id = p_organization_id AND id = t.id RETURNING * INTO t;
  SELECT count(*) INTO v_step FROM public.inventory_movements m
    JOIN public.inventory_transfer_lines x ON x.organization_id = m.organization_id AND x.id = m.transfer_line_id
   WHERE m.organization_id = p_organization_id AND x.transfer_id = t.id AND m.movement_type = 'TRANSFER_IN';
  PERFORM public.inventory_transfer_event(t, CASE WHEN v_all THEN 'received' ELSE 'partially_received' END, p_actor,
    jsonb_build_object('step', v_step, 'reserved_at_destination', v_reserved));
  RETURN jsonb_build_object('transfer_id', t.id, 'status', t.status, 'reserved_at_destination', v_reserved, 'replayed', false);
END $function$;

-- ---------------------------------------------------------------------------
-- 4) Privilégios: as reescritas continuam só do servidor
-- ---------------------------------------------------------------------------
DO $$
DECLARE sig text;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'goods_receipt_post(uuid,uuid,jsonb)', 'goods_receipt_inspect(uuid,uuid,uuid,jsonb)', 'inventory_transfer_receive(uuid,uuid,uuid,jsonb)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', sig);
  END LOOP;
END $$;

COMMIT;
