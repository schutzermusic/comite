-- ============================================================================
-- 238 — IDEMPOTÊNCIA SOB A TRAVA (recebimento e reserva) + CHAVE DA RECONCILIAÇÃO
--
-- A prova viva de concorrência (tests/qa-live/concurrency.spec.ts) encontrou:
-- duas chamadas com a MESMA chave de idempotência (o duplo toque no celular, a
-- repetição automática da rede) passavam juntas pela checagem de replay, que
-- rodava ANTES da trava. A segunda esperava a trava do pedido/requisito e,
-- solta, batia na regra de negócio (saldo em aberto / cobertura) — respondia
-- ERRO para um ato que já tinha acontecido. Nenhum dado se corrompia (a regra
-- segurava), mas a resposta mentia para quem repetiu.
--
-- A correção relê a chave DEPOIS da trava. O corpo das funções é o implantado;
-- só a releitura é nova. Transferência, entrega à obra, devolução e ajuste já
-- conferiam a chave sob a trava; requisição e pedido de transferência gravam a
-- linha com a chave antes de qualquer regra (a corrida vira 23505 na chave, que
-- o servidor repete como replay).
-- ============================================================================

BEGIN;

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

CREATE OR REPLACE FUNCTION public.inventory_reserve(p_organization_id uuid, p_actor uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r public.project_requirements%ROWTYPE; v_loc public.inventory_locations%ROWTYPE; v_qty numeric;
        v_available numeric; v_committed numeric; v_res public.inventory_reservations%ROWTYPE; v_key text;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['inventory.reserve']);
  v_qty := (p_payload->>'quantity')::numeric;
  IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Reservation needs a positive quantity.' USING ERRCODE = '22023'; END IF;
  v_key := nullif(p_payload->>'idempotency_key','');
  IF v_key IS NOT NULL THEN
    SELECT * INTO v_res FROM public.inventory_reservations WHERE organization_id = p_organization_id AND idempotency_key = v_key;
    IF FOUND THEN
      IF v_res.requirement_id <> (p_payload->>'requirement_id')::uuid OR v_res.quantity <> v_qty THEN
        RAISE EXCEPTION 'Idempotency key reused for a different reservation.' USING ERRCODE = '23505';
      END IF;
      RETURN jsonb_build_object('reservation_id', v_res.id, 'replayed', true);
    END IF;
  END IF;

  -- Trava 1: a demanda (dois reservando para o MESMO requisito serializam aqui).
  SELECT * INTO r FROM public.project_requirements
   WHERE organization_id = p_organization_id AND id = (p_payload->>'requirement_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Requirement not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  -- 238: mesma releitura da chave, agora sob a trava do requisito (ver goods_receipt_post).
  IF v_key IS NOT NULL THEN
    SELECT * INTO v_res FROM public.inventory_reservations WHERE organization_id = p_organization_id AND idempotency_key = v_key;
    IF FOUND THEN
      IF v_res.requirement_id <> (p_payload->>'requirement_id')::uuid OR v_res.quantity <> v_qty THEN
        RAISE EXCEPTION 'Idempotency key reused for a different reservation.' USING ERRCODE = '23505';
      END IF;
      RETURN jsonb_build_object('reservation_id', v_res.id, 'replayed', true);
    END IF;
  END IF;
  -- 238: mesma releitura da chave, agora sob a trava do requisito (ver goods_receipt_post).
  IF v_key IS NOT NULL THEN
    SELECT * INTO v_res FROM public.inventory_reservations WHERE organization_id = p_organization_id AND idempotency_key = v_key;
    IF FOUND THEN
      IF v_res.requirement_id <> (p_payload->>'requirement_id')::uuid OR v_res.quantity <> v_qty THEN
        RAISE EXCEPTION 'Idempotency key reused for a different reservation.' USING ERRCODE = '23505';
      END IF;
      RETURN jsonb_build_object('reservation_id', v_res.id, 'replayed', true);
    END IF;
  END IF;
  IF r.status <> 'CONFIRMED' OR r.requirement_type <> 'MATERIAL' OR r.item_id IS NULL THEN
    RAISE EXCEPTION 'Only a confirmed MATERIAL requirement with an item receives a reservation.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_loc FROM public.inventory_locations
   WHERE organization_id = p_organization_id AND id = (p_payload->>'location_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Location not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF v_loc.kind = 'QUARANTINE' OR NOT v_loc.active THEN
    RAISE EXCEPTION 'Stock under inspection or in an inactive location is not reservable.' USING ERRCODE = '23514';
  END IF;

  -- Trava 2: o saldo (dois reservando o MESMO estoque para demandas diferentes serializam aqui).
  PERFORM public.inventory_lock(p_organization_id, r.item_id, v_loc.id);
  v_available := public.inventory_on_hand(p_organization_id, r.item_id, v_loc.id)
               - public.inventory_reserved_open(p_organization_id, r.item_id, v_loc.id);
  IF v_qty > v_available THEN
    RAISE EXCEPTION 'Not enough available stock at %: % available, % requested.', v_loc.code, greatest(v_available, 0), v_qty
      USING ERRCODE = '23514';
  END IF;
  v_committed := public.inventory_requirement_committed(p_organization_id, r.id);
  IF v_committed + v_qty > r.quantity THEN
    RAISE EXCEPTION 'Reservation would over-cover the requirement: % required, % already committed.', r.quantity, v_committed
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.inventory_reservations (organization_id, item_id, location_id, project_id, requirement_id, quantity,
    required_by, source, note, idempotency_key, created_by)
  VALUES (p_organization_id, r.item_id, v_loc.id, r.project_id, r.id, v_qty, r.required_by, 'MANUAL',
    nullif(btrim(p_payload->>'note'),''), v_key, p_actor)
  RETURNING * INTO v_res;

  PERFORM public.emit_domain_event(p_organization_id, 'supply.inventory.reserved', 1, 'inventory_reservation', v_res.id,
    'reservation:' || v_res.id || ':reserved',
    jsonb_build_object('project_id', r.project_id, 'requirement_id', r.id, 'item_id', r.item_id, 'location_id', v_loc.id,
      'quantity', v_qty, 'unit', r.unit, 'title', r.title), now(), 'human', p_actor);
  RETURN jsonb_build_object('reservation_id', v_res.id, 'replayed', false);
END $function$;

/*
  Reconciliação de aprovações de compra (237): a chave do trabalho passa a ser
  o DESFECHO mais recente pendente de aplicação, não a janela de 10 minutos.
  Com a janela, um desfecho decidido depois que o trabalho da janela já rodou
  esperava a próxima; com o desfecho, drenar de novo o mesmo conjunto não
  enfileira nada, e desfecho novo enfileira na hora.
*/
CREATE OR REPLACE FUNCTION public.purchase_order_enqueue_approval_reconcile(p_as_of timestamptz DEFAULT now())
RETURNS integer LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE org record; n integer := 0;
BEGIN
  FOR org IN
    SELECT p.organization_id, max(q.finalized_at) AS last_outcome FROM public.purchase_orders p
      JOIN public.approval_requests q ON q.id = p.approval_request_id AND q.organization_id = p.organization_id
     WHERE p.status = 'APPROVAL_REQUIRED' AND p.approval_governance = 'POLICY' AND q.status <> 'PENDING'
     GROUP BY p.organization_id
  LOOP
    PERFORM public.apex_jobs_enqueue(
      org.organization_id, 'procurement.purchase_order.reconcile_approvals',
      'po-approval-reconcile:' || org.organization_id::text || ':'
        || COALESCE(to_char(org.last_outcome AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS'), to_char(p_as_of AT TIME ZONE 'UTC', 'YYYYMMDDHH24')),
      jsonb_build_object('reason', 'scheduled'), 1, now(), 5, NULL, NULL);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.purchase_order_enqueue_approval_reconcile(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_order_enqueue_approval_reconcile(timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.goods_receipt_post(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.goods_receipt_post(uuid,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.inventory_reserve(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_reserve(uuid,uuid,jsonb) TO service_role;

COMMIT;
