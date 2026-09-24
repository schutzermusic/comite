-- ============================================================================
-- 235 — RECEBIMENTO & LOGÍSTICA: entrada física governada
--
-- ─── Só o recebimento põe material no estoque ───────────────────────────
--
-- Pedido emitido NÃO aumenta estoque (INV-11): ele é "em pedido". O que
-- vira em mão é o RECEBIMENTO — ato nomeado, contra um pedido EMITIDO, que
-- posta `RECEIPT` no livro da 233 e, para cada requisito que o pedido
-- atende, reserva no local de recebimento o que chegou (até a necessidade).
--
-- ─── Parcial é primeira classe (INV-12) ─────────────────────────────────
-- Pedido 100, chegou 80: a linha fica com 20 em aberto, o pedido fica
-- PARTIALLY_RECEIVED e o requisito continua vendo 20 "em pedido". Receber
-- acima do aberto é recusado. Rejeitado/avariado é contado à parte, com
-- motivo, e NÃO entra no estoque — a quantidade continua esperada.
--
-- ─── Inspeção ───────────────────────────────────────────────────────────
-- Recebido num local de QUARENTENA fica "em inspeção": não é disponível nem
-- cobre demanda. A liberação usa o fluxo canônico de transferência da 233
-- (quarentena → destino, reservando para os requisitos); a rejeição na
-- inspeção sai do estoque com motivo e devolve a quantidade ao "em pedido".
--
-- ─── Logística ──────────────────────────────────────────────────────────
-- `inbound_shipments`: transportadora, veículo, rastreio, ETA e chegada de
-- entregas de pedido. Transferências já carregam a própria logística (233).
--
-- ─── Finanças ───────────────────────────────────────────────────────────
-- Nenhum livro de contas a pagar aqui (INV-17). `purchase_order_receipt_basis`
-- expõe o fato canônico pedido × recebimento (quantidade, preço, rejeitado,
-- em aberto) para o 3-way match de Finanças; o evento
-- `supply.goods_receipt.posted` é o gancho.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Logística de entrada (pedido)
-- ---------------------------------------------------------------------------
CREATE TABLE public.inbound_shipments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  shipment_number         text NOT NULL,
  purchase_order_id       uuid NOT NULL,
  destination_location_id uuid,
  status                  text NOT NULL DEFAULT 'EXPECTED' CHECK (status IN ('EXPECTED','IN_TRANSIT','ARRIVED','RECEIVED','CANCELLED')),
  carrier                 text,
  vehicle                 text,
  tracking_ref            text,
  dispatched_at           timestamptz,
  eta                     date,
  arrived_at              timestamptz,
  note                    text,
  close_reason            text,
  created_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ship_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT ship_number_unique UNIQUE (organization_id, shipment_number),
  CONSTRAINT ship_po_tenant FOREIGN KEY (organization_id, purchase_order_id) REFERENCES public.purchase_orders (organization_id, id),
  CONSTRAINT ship_location_tenant FOREIGN KEY (organization_id, destination_location_id)
    REFERENCES public.inventory_locations (organization_id, id),
  CONSTRAINT ship_cancel_reason CHECK (status <> 'CANCELLED' OR nullif(btrim(close_reason),'') IS NOT NULL)
);
CREATE INDEX ship_po ON public.inbound_shipments (organization_id, purchase_order_id);
CREATE INDEX ship_open ON public.inbound_shipments (organization_id, status, eta) WHERE status IN ('EXPECTED','IN_TRANSIT','ARRIVED');
CREATE TRIGGER ship_touch BEFORE UPDATE ON public.inbound_shipments
  FOR EACH ROW EXECUTE FUNCTION public.commercial_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2) Recebimento
-- ---------------------------------------------------------------------------
CREATE TABLE public.goods_receipts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  receipt_number      text NOT NULL,
  purchase_order_id   uuid NOT NULL,
  shipment_id         uuid,
  location_id         uuid NOT NULL,
  received_at         timestamptz NOT NULL DEFAULT now(),
  received_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note                text,
  discrepancy_reason  text,
  inspection_status   text NOT NULL CHECK (inspection_status IN ('NOT_REQUIRED','PENDING','APPROVED','PARTIALLY_REJECTED','REJECTED')),
  inspected_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  inspected_at        timestamptz,
  inspection_note     text,
  inspection_transfer_id uuid,
  idempotency_key     text,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT grc_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT grc_number_unique UNIQUE (organization_id, receipt_number),
  CONSTRAINT grc_idempotency UNIQUE (organization_id, idempotency_key),
  CONSTRAINT grc_po_tenant FOREIGN KEY (organization_id, purchase_order_id) REFERENCES public.purchase_orders (organization_id, id),
  CONSTRAINT grc_shipment_tenant FOREIGN KEY (organization_id, shipment_id) REFERENCES public.inbound_shipments (organization_id, id),
  CONSTRAINT grc_location_tenant FOREIGN KEY (organization_id, location_id) REFERENCES public.inventory_locations (organization_id, id),
  CONSTRAINT grc_transfer_tenant FOREIGN KEY (organization_id, inspection_transfer_id)
    REFERENCES public.inventory_transfers (organization_id, id),
  CONSTRAINT grc_inspected_named CHECK (inspection_status IN ('NOT_REQUIRED','PENDING') OR (inspected_by IS NOT NULL AND inspected_at IS NOT NULL))
);
CREATE INDEX grc_po ON public.goods_receipts (organization_id, purchase_order_id);
CREATE INDEX grc_pending ON public.goods_receipts (organization_id) WHERE inspection_status = 'PENDING';

CREATE TABLE public.goods_receipt_lines (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id               uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  receipt_id                    uuid NOT NULL,
  po_line_id                    uuid NOT NULL,
  item_id                       uuid NOT NULL,
  accepted_quantity             numeric NOT NULL DEFAULT 0 CHECK (accepted_quantity >= 0),
  rejected_quantity             numeric NOT NULL DEFAULT 0 CHECK (rejected_quantity >= 0),
  rejection_reason              text,
  lot_code                      text,
  serials                       text[] NOT NULL DEFAULT '{}',
  inspection_approved_quantity  numeric CHECK (inspection_approved_quantity IS NULL OR inspection_approved_quantity >= 0),
  inspection_rejected_quantity  numeric CHECK (inspection_rejected_quantity IS NULL OR inspection_rejected_quantity >= 0),
  inspection_reason             text,
  created_at                    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT grl_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT grl_receipt_tenant FOREIGN KEY (organization_id, receipt_id) REFERENCES public.goods_receipts (organization_id, id),
  CONSTRAINT grl_po_line_tenant FOREIGN KEY (organization_id, po_line_id) REFERENCES public.purchase_order_lines (organization_id, id),
  CONSTRAINT grl_item_tenant FOREIGN KEY (organization_id, item_id) REFERENCES public.supply_items (organization_id, id),
  CONSTRAINT grl_something CHECK (accepted_quantity + rejected_quantity > 0),
  CONSTRAINT grl_rejection_reason CHECK (rejected_quantity = 0 OR nullif(btrim(rejection_reason),'') IS NOT NULL),
  CONSTRAINT grl_inspection_bounds CHECK (inspection_approved_quantity IS NULL
    OR inspection_approved_quantity + COALESCE(inspection_rejected_quantity, 0) = accepted_quantity),
  CONSTRAINT grl_inspection_reason CHECK (COALESCE(inspection_rejected_quantity, 0) = 0 OR nullif(btrim(inspection_reason),'') IS NOT NULL)
);
CREATE INDEX grl_receipt ON public.goods_receipt_lines (organization_id, receipt_id);
CREATE INDEX grl_po_line ON public.goods_receipt_lines (organization_id, po_line_id);

-- O rastro do recebimento até o requisito (INV-13): quanto desta linha foi de qual requisito.
CREATE TABLE public.goods_receipt_line_requirements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  receipt_line_id   uuid NOT NULL,
  requirement_id    uuid NOT NULL,
  quantity          numeric NOT NULL CHECK (quantity > 0),

  CONSTRAINT grlr_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT grlr_line_tenant FOREIGN KEY (organization_id, receipt_line_id) REFERENCES public.goods_receipt_lines (organization_id, id),
  CONSTRAINT grlr_requirement_tenant FOREIGN KEY (organization_id, requirement_id) REFERENCES public.project_requirements (organization_id, id),
  CONSTRAINT grlr_once UNIQUE (receipt_line_id, requirement_id)
);
CREATE INDEX grlr_requirement ON public.goods_receipt_line_requirements (organization_id, requirement_id);

-- Evidência (foto, romaneio, nota): objeto no armazenamento privado, caminho gerado pelo servidor.
CREATE TABLE public.goods_receipt_evidence (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  receipt_id        uuid NOT NULL,
  storage_bucket    text NOT NULL,
  storage_path      text NOT NULL,
  file_name         text NOT NULL CHECK (btrim(file_name) <> ''),
  mime_type         text NOT NULL,
  size_bytes        bigint NOT NULL CHECK (size_bytes > 0),
  content_sha256    text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  uploaded_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT gre_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT gre_receipt_tenant FOREIGN KEY (organization_id, receipt_id) REFERENCES public.goods_receipts (organization_id, id),
  CONSTRAINT gre_path_unique UNIQUE (storage_bucket, storage_path),
  -- O caminho é do inquilino: {org}/supply-receipts/...
  CONSTRAINT gre_path_in_tenant CHECK (storage_path LIKE organization_id::text || '/supply-receipts/%')
);

-- Recebimento é fato: só a INSPEÇÃO muda depois (e só uma vez, pelo ato).
CREATE OR REPLACE FUNCTION public.goods_receipt_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'goods_receipts' THEN
    IF (to_jsonb(NEW) - ARRAY['inspection_status','inspected_by','inspected_at','inspection_note','inspection_transfer_id'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['inspection_status','inspected_by','inspected_at','inspection_note','inspection_transfer_id']) THEN
      RAISE EXCEPTION 'Goods receipt is a posted fact: it does not change.' USING ERRCODE = '42501';
    END IF;
    IF OLD.inspection_status NOT IN ('PENDING') AND NEW.inspection_status IS DISTINCT FROM OLD.inspection_status
       AND NOT (OLD.inspection_status = 'NOT_REQUIRED' AND NEW.inspection_status = 'NOT_REQUIRED') THEN
      RAISE EXCEPTION 'Goods receipt inspection is already decided.' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF (to_jsonb(NEW) - ARRAY['inspection_approved_quantity','inspection_rejected_quantity','inspection_reason'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['inspection_approved_quantity','inspection_rejected_quantity','inspection_reason'])
       OR OLD.inspection_approved_quantity IS NOT NULL THEN
      RAISE EXCEPTION 'Goods receipt line is a posted fact: it does not change.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.goods_receipt_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER grc_guard BEFORE UPDATE ON public.goods_receipts FOR EACH ROW EXECUTE FUNCTION public.goods_receipt_guard();
CREATE TRIGGER grl_guard BEFORE UPDATE ON public.goods_receipt_lines FOR EACH ROW EXECUTE FUNCTION public.goods_receipt_guard();
CREATE TRIGGER grc_no_erasure BEFORE DELETE ON public.goods_receipts FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();
CREATE TRIGGER grl_no_erasure BEFORE DELETE ON public.goods_receipt_lines FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();
CREATE TRIGGER grlr_no_rewrite BEFORE UPDATE ON public.goods_receipt_line_requirements
  FOR EACH ROW EXECUTE FUNCTION public.operations_reject_history_rewrite();
CREATE TRIGGER grlr_no_erasure BEFORE DELETE ON public.goods_receipt_line_requirements
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();
CREATE TRIGGER gre_no_rewrite BEFORE UPDATE ON public.goods_receipt_evidence
  FOR EACH ROW EXECUTE FUNCTION public.operations_reject_history_rewrite();
CREATE TRIGGER gre_no_erasure BEFORE DELETE ON public.goods_receipt_evidence
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

-- ---------------------------------------------------------------------------
-- 3) O livro e a reserva apontam o recebimento
-- ---------------------------------------------------------------------------
ALTER TABLE public.inventory_movements ADD COLUMN receipt_line_id uuid;
ALTER TABLE public.inventory_movements
  ADD CONSTRAINT invmov_receipt_line_tenant FOREIGN KEY (organization_id, receipt_line_id)
    REFERENCES public.goods_receipt_lines (organization_id, id),
  -- Entrada por recebimento sempre diz de qual linha de recebimento veio (INV-11).
  ADD CONSTRAINT invmov_receipt_has_line CHECK (movement_type <> 'RECEIPT' OR receipt_line_id IS NOT NULL);

ALTER TABLE public.inventory_reservations ADD COLUMN source_receipt_line_id uuid;
ALTER TABLE public.inventory_reservations
  ADD CONSTRAINT invres_receipt_line_tenant FOREIGN KEY (organization_id, source_receipt_line_id)
    REFERENCES public.goods_receipt_lines (organization_id, id),
  ADD CONSTRAINT invres_receipt_source CHECK (source <> 'RECEIPT' OR source_receipt_line_id IS NOT NULL);

-- A postagem genérica da 233 passa a gravar a linha de recebimento (mesma assinatura).
CREATE OR REPLACE FUNCTION public.inventory_post_movement(
  p_organization_id uuid, p_actor uuid, p_type text, p_item_id uuid, p_location_id uuid, p_quantity numeric,
  p_lot_code text, p_idempotency_key text, p_refs jsonb DEFAULT '{}'::jsonb, p_reason text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_item public.supply_items%ROWTYPE; v_loc public.inventory_locations%ROWTYPE; v_id uuid; v_lot text;
BEGIN
  SELECT id INTO v_id FROM public.inventory_movements
   WHERE organization_id = p_organization_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN v_id; END IF;

  SELECT * INTO v_item FROM public.supply_items WHERE organization_id = p_organization_id AND id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_loc FROM public.inventory_locations WHERE organization_id = p_organization_id AND id = p_location_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Location not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF NOT v_loc.active AND p_quantity > 0 THEN
    RAISE EXCEPTION 'Location % is inactive: stock does not enter it.', v_loc.code USING ERRCODE = '23514';
  END IF;

  v_lot := nullif(btrim(p_lot_code), '');
  IF v_item.tracking = 'NONE' THEN
    v_lot := NULL;
  ELSIF v_lot IS NULL THEN
    RAISE EXCEPTION 'Item % is tracked by %: lot/serial is required.', v_item.code, v_item.tracking USING ERRCODE = '23514';
  END IF;
  IF v_item.tracking = 'SERIAL' AND abs(p_quantity) <> 1 THEN
    RAISE EXCEPTION 'Serial-tracked item moves one serial per line.' USING ERRCODE = '23514';
  END IF;

  IF public.inventory_on_hand(p_organization_id, p_item_id, p_location_id, v_lot, false) + p_quantity < 0 THEN
    RAISE EXCEPTION 'Insufficient stock of % at %: on hand would be negative.', v_item.code, v_loc.code USING ERRCODE = '23514';
  END IF;
  IF v_item.tracking = 'SERIAL' AND p_quantity > 0 AND EXISTS (
       SELECT 1 FROM public.inventory_movements m
        WHERE m.organization_id = p_organization_id AND m.item_id = p_item_id AND m.lot_code = v_lot
        GROUP BY m.lot_code HAVING sum(m.quantity) >= 1) THEN
    RAISE EXCEPTION 'Serial % of % is already in stock.', v_lot, v_item.code USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.inventory_movements (organization_id, item_id, location_id, lot_code, movement_type, quantity,
    project_id, requirement_id, reservation_id, transfer_line_id, count_line_id, receipt_line_id, reference_kind, reference_id,
    reason, idempotency_key, actor_user_id)
  VALUES (p_organization_id, p_item_id, p_location_id, v_lot, p_type, p_quantity,
    nullif(p_refs->>'project_id',''), nullif(p_refs->>'requirement_id','')::uuid, nullif(p_refs->>'reservation_id','')::uuid,
    nullif(p_refs->>'transfer_line_id','')::uuid, nullif(p_refs->>'count_line_id','')::uuid,
    nullif(p_refs->>'receipt_line_id','')::uuid,
    nullif(p_refs->>'reference_kind',''), nullif(p_refs->>'reference_id','')::uuid,
    nullif(btrim(p_reason),''), p_idempotency_key, p_actor)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------
-- 4) Atos: logística
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inbound_shipment_record(p_organization_id uuid, p_actor uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.inbound_shipments%ROWTYPE; v_po public.purchase_orders%ROWTYPE; v_to text; v_rank jsonb :=
  '{"EXPECTED":1,"IN_TRANSIT":2,"ARRIVED":3}'::jsonb;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['receiving.receive','procurement.orders.issue']);
  v_to := nullif(p_payload->>'status','');
  IF nullif(p_payload->>'id','') IS NULL THEN
    SELECT * INTO v_po FROM public.purchase_orders WHERE organization_id = p_organization_id AND id = (p_payload->>'purchase_order_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found in tenant.' USING ERRCODE = 'P0002'; END IF;
    IF v_po.status NOT IN ('ISSUED','PARTIALLY_RECEIVED') THEN
      RAISE EXCEPTION 'Shipment tracks an issued order (order is %).', v_po.status USING ERRCODE = '23514';
    END IF;
    IF v_to IS NOT NULL AND v_to NOT IN ('EXPECTED','IN_TRANSIT','ARRIVED') THEN
      RAISE EXCEPTION 'Shipment starts EXPECTED, IN_TRANSIT or ARRIVED.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.inbound_shipments (organization_id, shipment_number, purchase_order_id, destination_location_id, status,
      carrier, vehicle, tracking_ref, dispatched_at, eta, arrived_at, note, created_by)
    VALUES (p_organization_id, public.procurement_number('EMB'), v_po.id,
      COALESCE(nullif(p_payload->>'destination_location_id','')::uuid, v_po.delivery_location_id), COALESCE(v_to, 'EXPECTED'),
      nullif(btrim(p_payload->>'carrier'),''), nullif(btrim(p_payload->>'vehicle'),''), nullif(btrim(p_payload->>'tracking_ref'),''),
      CASE WHEN v_to IN ('IN_TRANSIT','ARRIVED') THEN now() END, nullif(p_payload->>'eta','')::date,
      CASE WHEN v_to = 'ARRIVED' THEN now() END, nullif(btrim(p_payload->>'note'),''), p_actor)
    RETURNING * INTO v;
  ELSE
    SELECT * INTO v FROM public.inbound_shipments WHERE organization_id = p_organization_id AND id = (p_payload->>'id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Shipment not found in tenant.' USING ERRCODE = 'P0002'; END IF;
    IF v.status IN ('RECEIVED','CANCELLED') THEN RAISE EXCEPTION 'Shipment is %: it is history.', v.status USING ERRCODE = '23514'; END IF;
    IF v_to = 'CANCELLED' AND nullif(btrim(p_payload->>'reason'),'') IS NULL THEN
      RAISE EXCEPTION 'Cancellation requires a reason.' USING ERRCODE = '22023';
    END IF;
    IF v_to IS NOT NULL AND v_to <> 'CANCELLED' AND (v_to = 'RECEIVED' OR (v_rank->>v_to)::int < (v_rank->>v.status)::int) THEN
      RAISE EXCEPTION 'Shipment moves forward only (% → %); RECEIVED comes from the goods receipt.', v.status, v_to USING ERRCODE = '23514';
    END IF;
    UPDATE public.inbound_shipments SET
      status = COALESCE(v_to, status),
      carrier = CASE WHEN p_payload ? 'carrier' THEN nullif(btrim(p_payload->>'carrier'),'') ELSE carrier END,
      vehicle = CASE WHEN p_payload ? 'vehicle' THEN nullif(btrim(p_payload->>'vehicle'),'') ELSE vehicle END,
      tracking_ref = CASE WHEN p_payload ? 'tracking_ref' THEN nullif(btrim(p_payload->>'tracking_ref'),'') ELSE tracking_ref END,
      eta = CASE WHEN p_payload ? 'eta' THEN nullif(p_payload->>'eta','')::date ELSE eta END,
      note = CASE WHEN p_payload ? 'note' THEN nullif(btrim(p_payload->>'note'),'') ELSE note END,
      dispatched_at = CASE WHEN v_to IN ('IN_TRANSIT','ARRIVED') AND dispatched_at IS NULL THEN now() ELSE dispatched_at END,
      arrived_at = CASE WHEN v_to = 'ARRIVED' THEN now() ELSE arrived_at END,
      close_reason = CASE WHEN v_to = 'CANCELLED' THEN btrim(p_payload->>'reason') ELSE close_reason END
    WHERE id = v.id RETURNING * INTO v;
  END IF;
  PERFORM public.emit_domain_event(p_organization_id, 'supply.shipment.' || lower(v.status), 1, 'inbound_shipment', v.id,
    'shipment:' || v.id || ':' || lower(v.status) || ':' || extract(epoch FROM clock_timestamp())::text,
    jsonb_build_object('purchase_order_id', v.purchase_order_id, 'eta', v.eta, 'carrier', v.carrier), now(), 'human', p_actor);
  RETURN jsonb_build_object('shipment_id', v.id, 'shipment_number', v.shipment_number, 'status', v.status);
END $$;

-- ---------------------------------------------------------------------------
-- 5) Ato: recebimento
-- ---------------------------------------------------------------------------
/*
  Um recebimento, várias linhas, uma transação. O pedido é travado (dois
  recebimentos contra a mesma linha serializam). Por linha: aceito ≤ aberto;
  rejeitado com motivo; lote/série conforme o item. O aceito entra no livro
  e é alocado aos requisitos do pedido por data de necessidade: o "em
  pedido" do requisito cai, e — fora da quarentena — o recebido é reservado
  para ele até a necessidade restante.
*/
CREATE OR REPLACE FUNCTION public.goods_receipt_post(p_organization_id uuid, p_actor uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
END $$;

-- ---------------------------------------------------------------------------
-- 6) Ato: inspeção do que entrou em quarentena
-- ---------------------------------------------------------------------------
/*
  Decide TODO o aceito de uma vez, por linha: aprovado + rejeitado = aceito.
  Aprovado vai da quarentena ao destino pelo fluxo canônico de transferência
  (pedida, aprovada, despachada, recebida e encerrada no mesmo ato), com as
  linhas apontando os requisitos — o destino reserva para eles. Rejeitado
  sai do estoque com motivo e volta a ser esperado do fornecedor: o recebido
  da linha do pedido e a alocação ao requisito recuam.
*/
CREATE OR REPLACE FUNCTION public.goods_receipt_inspect(p_organization_id uuid, p_actor uuid, p_receipt_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_rec public.goods_receipts%ROWTYPE; v_dest public.inventory_locations%ROWTYPE; line jsonb;
        rl public.goods_receipt_lines%ROWTYPE; v_item public.supply_items%ROWTYPE; v_app numeric; v_rej numeric;
        v_app_left numeric; portion record; v_a numeric; v_r numeric; v_tlines jsonb := '[]'::jsonb; v_serials_ok text[];
        v_serials_rej text[]; v_serial text; v_i int; v_tr jsonb; v_line record; v_rlines jsonb := '[]'::jsonb;
        v_po public.purchase_orders%ROWTYPE; v_from text; v_tot_app numeric := 0; v_tot_rej numeric := 0; v_status text;
        v_reason text; v_idx int; r public.project_requirements%ROWTYPE; v_cap numeric; v_req numeric;
        v_decided jsonb := '{}'::jsonb;
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
END $$;

-- ---------------------------------------------------------------------------
-- 7) Ato: evidência e encerramento do pedido
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.goods_receipt_attach_evidence(p_organization_id uuid, p_actor uuid, p_receipt_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['receiving.receive']);
  IF NOT EXISTS (SELECT 1 FROM public.goods_receipts WHERE organization_id = p_organization_id AND id = p_receipt_id) THEN
    RAISE EXCEPTION 'Goods receipt not found in tenant.' USING ERRCODE = 'P0002';
  END IF;
  SELECT id INTO v_id FROM public.goods_receipt_evidence
   WHERE storage_bucket = p_payload->>'storage_bucket' AND storage_path = p_payload->>'storage_path';
  IF FOUND THEN RETURN jsonb_build_object('evidence_id', v_id, 'replayed', true); END IF;
  INSERT INTO public.goods_receipt_evidence (organization_id, receipt_id, storage_bucket, storage_path, file_name, mime_type,
    size_bytes, content_sha256, uploaded_by)
  VALUES (p_organization_id, p_receipt_id, p_payload->>'storage_bucket', p_payload->>'storage_path', p_payload->>'file_name',
    p_payload->>'mime_type', (p_payload->>'size_bytes')::bigint, lower(p_payload->>'content_sha256'), p_actor)
  RETURNING id INTO v_id;
  PERFORM public.emit_domain_event(p_organization_id, 'supply.goods_receipt.evidence_attached', 1, 'goods_receipt', p_receipt_id,
    'goods-receipt-evidence:' || v_id, jsonb_build_object('file_name', p_payload->>'file_name'), now(), 'human', p_actor);
  RETURN jsonb_build_object('evidence_id', v_id, 'replayed', false);
END $$;

-- Encerrar: recebido → encerrado; com saldo em aberto, só com motivo (o saldo deixa de ser esperado).
CREATE OR REPLACE FUNCTION public.purchase_order_close(p_organization_id uuid, p_actor uuid, p_po_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.purchase_orders%ROWTYPE; v_open numeric; v_from text;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['procurement.orders.issue']);
  SELECT * INTO v FROM public.purchase_orders WHERE organization_id = p_organization_id AND id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF v.status = 'CLOSED' THEN RETURN jsonb_build_object('purchase_order_id', v.id, 'status', v.status, 'replayed', true); END IF;
  IF v.status NOT IN ('ISSUED','PARTIALLY_RECEIVED','RECEIVED') THEN
    RAISE EXCEPTION 'Purchase order is %: only an issued order is closed (cancel before issuing).', v.status USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.goods_receipts WHERE purchase_order_id = v.id AND inspection_status = 'PENDING') THEN
    RAISE EXCEPTION 'Purchase order has a receipt awaiting inspection: decide it first.' USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(sum(quantity - received_quantity), 0) INTO v_open FROM public.purchase_order_lines WHERE purchase_order_id = v.id;
  IF v_open > 0 AND nullif(btrim(p_reason),'') IS NULL THEN
    RAISE EXCEPTION 'Closing with % still open requires a reason (the balance stops being expected).', v_open USING ERRCODE = '22023';
  END IF;
  v_from := v.status;
  UPDATE public.purchase_orders SET status = 'CLOSED', closed_at = now(), close_reason = nullif(btrim(p_reason),'')
   WHERE id = v.id RETURNING * INTO v;
  PERFORM public.purchase_order_log(v, 'closed', v_from, p_reason, jsonb_build_object('open_quantity', v_open), p_actor);
  RETURN jsonb_build_object('purchase_order_id', v.id, 'status', v.status, 'open_quantity', v_open, 'replayed', false);
END $$;

-- ---------------------------------------------------------------------------
-- 8) Leitura derivada: base do 3-way match e desempenho de entrega
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.purchase_order_receipt_basis
WITH (security_invoker = true) AS
SELECT pl.organization_id, po.id AS purchase_order_id, po.order_number, po.supplier_id, po.status AS order_status, po.currency,
  pl.id AS po_line_id, pl.item_id, pl.quantity AS ordered_qty, pl.unit_price,
  pl.received_quantity AS received_qty,
  COALESCE(rj.rejected, 0) AS rejected_qty,
  CASE WHEN po.status IN ('CLOSED','CANCELLED') THEN 0 ELSE pl.quantity - pl.received_quantity END AS open_qty,
  pl.quantity * pl.unit_price AS ordered_value,
  pl.received_quantity * pl.unit_price AS received_value,
  COALESCE(rj.receipts, 0) AS receipts_count,
  rj.last_received_at
FROM public.purchase_order_lines pl
JOIN public.purchase_orders po ON po.organization_id = pl.organization_id AND po.id = pl.purchase_order_id
LEFT JOIN LATERAL (
  SELECT sum(l.rejected_quantity + COALESCE(l.inspection_rejected_quantity, 0)) AS rejected,
         count(DISTINCT l.receipt_id) AS receipts, max(g.received_at) AS last_received_at
    FROM public.goods_receipt_lines l
    JOIN public.goods_receipts g ON g.organization_id = l.organization_id AND g.id = l.receipt_id
   WHERE l.organization_id = pl.organization_id AND l.po_line_id = pl.id) rj ON true
WHERE po.status NOT IN ('DRAFT','APPROVAL_REQUIRED','APPROVED');

COMMENT ON VIEW public.purchase_order_receipt_basis IS
  'Fato canônico pedido × recebimento por linha (quantidade e preço pedidos, recebido líquido de inspeção, rejeitado, em aberto, valores). Base do 3-way match de Finanças — Supply não mantém contas a pagar.';
GRANT SELECT ON public.purchase_order_receipt_basis TO authenticated;

-- Pontualidade: cada linha recebida contra a data prometida do pedido (horário de São Paulo).
CREATE OR REPLACE VIEW public.supplier_delivery_performance
WITH (security_invoker = true) AS
SELECT po.organization_id, po.supplier_id,
  count(*) FILTER (WHERE COALESCE(pl.expected_date, po.expected_delivery) IS NOT NULL) AS promised_lines,
  count(*) FILTER (WHERE COALESCE(pl.expected_date, po.expected_delivery) IS NOT NULL
                     AND (g.received_at AT TIME ZONE 'America/Sao_Paulo')::date <= COALESCE(pl.expected_date, po.expected_delivery)) AS on_time_lines,
  avg(GREATEST((g.received_at AT TIME ZONE 'America/Sao_Paulo')::date - COALESCE(pl.expected_date, po.expected_delivery), 0))
    FILTER (WHERE COALESCE(pl.expected_date, po.expected_delivery) IS NOT NULL) AS avg_delay_days,
  count(*) FILTER (WHERE l.rejected_quantity > 0 OR COALESCE(l.inspection_rejected_quantity, 0) > 0) AS lines_with_rejection,
  count(*) AS received_lines,
  max(g.received_at) AS last_receipt_at
FROM public.goods_receipt_lines l
JOIN public.goods_receipts g ON g.organization_id = l.organization_id AND g.id = l.receipt_id
JOIN public.purchase_order_lines pl ON pl.organization_id = l.organization_id AND pl.id = l.po_line_id
JOIN public.purchase_orders po ON po.organization_id = pl.organization_id AND po.id = pl.purchase_order_id
GROUP BY po.organization_id, po.supplier_id;

COMMENT ON VIEW public.supplier_delivery_performance IS
  'Desempenho de entrega DERIVADO dos recebimentos: linhas prometidas, no prazo, atraso médio e rejeições. Nunca estimado.';
GRANT SELECT ON public.supplier_delivery_performance TO authenticated;


-- ---------------------------------------------------------------------------
-- 8b) Em inspeção: recebido para o requisito, ainda não liberado
--
-- Não é reservável nem disponível — mas também não é FALTA: já chegou. Conta
-- como "entrando" na cobertura e como comprometido (ninguém recompra nem
-- reserva outra vez o que está na quarentena esperando decisão).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receiving_inspection_pending(p_organization_id uuid, p_requirement_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(sum(q.quantity), 0)
    FROM public.goods_receipt_line_requirements q
    JOIN public.goods_receipt_lines l ON l.organization_id = q.organization_id AND l.id = q.receipt_line_id
    JOIN public.goods_receipts g ON g.organization_id = l.organization_id AND g.id = l.receipt_id
   WHERE q.organization_id = p_organization_id AND q.requirement_id = p_requirement_id AND g.inspection_status = 'PENDING'
$$;

CREATE OR REPLACE FUNCTION public.inventory_requirement_committed(p_organization_id uuid, p_requirement_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT
    COALESCE((SELECT sum(quantity - released_quantity) FROM public.inventory_reservations
               WHERE organization_id = p_organization_id AND requirement_id = p_requirement_id), 0)
  + COALESCE((SELECT sum(CASE WHEN t.status IN ('REQUESTED','APPROVED') AND l.source_reservation_id IS NULL THEN l.quantity
                              WHEN t.status IN ('IN_TRANSIT','PARTIALLY_RECEIVED') THEN l.dispatched_quantity - l.received_quantity
                              ELSE 0 END)
                FROM public.inventory_transfer_lines l
                JOIN public.inventory_transfers t ON t.organization_id = l.organization_id AND t.id = l.transfer_id
               WHERE l.organization_id = p_organization_id AND l.requirement_id = p_requirement_id), 0)
  + public.procurement_on_order(p_organization_id, p_requirement_id)
  + public.receiving_inspection_pending(p_organization_id, p_requirement_id)
$$;

-- Contrato de cobertura: mesmas colunas, `inspection_qty` ANEXADA ao fim; entrando inclui a inspeção.
CREATE OR REPLACE VIEW public.supply_requirement_coverage
WITH (security_invoker = true) AS
WITH res AS (
  SELECT organization_id, requirement_id,
         sum(CASE WHEN status = 'ACTIVE' THEN quantity - consumed_quantity - released_quantity ELSE 0 END) AS reserved,
         sum(consumed_quantity) AS consumed
    FROM public.inventory_reservations GROUP BY organization_id, requirement_id),
transit AS (
  SELECT l.organization_id, l.requirement_id, sum(l.dispatched_quantity - l.received_quantity) AS in_transit
    FROM public.inventory_transfer_lines l
    JOIN public.inventory_transfers t ON t.organization_id = l.organization_id AND t.id = l.transfer_id
   WHERE t.status IN ('IN_TRANSIT','PARTIALLY_RECEIVED') AND l.requirement_id IS NOT NULL
   GROUP BY l.organization_id, l.requirement_id),
ordered AS (
  SELECT a.organization_id, a.requirement_id, sum(a.quantity - a.received_quantity) AS on_order
    FROM public.purchase_order_line_requirements a
    JOIN public.purchase_order_lines l ON l.organization_id = a.organization_id AND l.id = a.line_id
    JOIN public.purchase_orders po ON po.organization_id = l.organization_id AND po.id = l.purchase_order_id
   WHERE po.status IN ('ISSUED','PARTIALLY_RECEIVED')
   GROUP BY a.organization_id, a.requirement_id),
requested AS (
  SELECT a.organization_id, a.requirement_id, sum(a.quantity) AS requested
    FROM public.purchase_requisition_line_requirements a
    JOIN public.purchase_requisition_lines l ON l.organization_id = a.organization_id AND l.id = a.line_id
    JOIN public.purchase_requisitions r ON r.organization_id = l.organization_id AND r.id = l.requisition_id
   WHERE r.status IN ('SUBMITTED','SOURCING')
     AND NOT EXISTS (SELECT 1 FROM public.purchase_order_lines pl
                       JOIN public.purchase_orders po ON po.organization_id = pl.organization_id AND po.id = pl.purchase_order_id
                      WHERE pl.organization_id = a.organization_id AND pl.requisition_line_id = l.id
                        AND po.status IN ('ISSUED','PARTIALLY_RECEIVED','RECEIVED','CLOSED'))
   GROUP BY a.organization_id, a.requirement_id),
inspecting AS (
  SELECT q.organization_id, q.requirement_id, sum(q.quantity) AS inspection
    FROM public.goods_receipt_line_requirements q
    JOIN public.goods_receipt_lines l ON l.organization_id = q.organization_id AND l.id = q.receipt_line_id
    JOIN public.goods_receipts g ON g.organization_id = l.organization_id AND g.id = l.receipt_id
   WHERE g.inspection_status = 'PENDING'
   GROUP BY q.organization_id, q.requirement_id),
base AS (
  SELECT r.organization_id, r.id AS requirement_id, r.project_id, r.activity_id, r.item_id, r.requirement_type,
    r.required_by, r.unit, r.quantity AS required_qty,
    COALESCE(res.reserved, 0) AS reserved_qty,
    COALESCE(res.consumed, 0) AS consumed_qty,
    COALESCE(transit.in_transit, 0) AS in_transit_qty,
    COALESCE(ordered.on_order, 0) AS on_order_qty,
    COALESCE(requested.requested, 0) AS requested_qty,
    COALESCE(inspecting.inspection, 0) AS inspection_qty
  FROM public.project_requirements r
  LEFT JOIN res ON res.organization_id = r.organization_id AND res.requirement_id = r.id
  LEFT JOIN transit ON transit.organization_id = r.organization_id AND transit.requirement_id = r.id
  LEFT JOIN ordered ON ordered.organization_id = r.organization_id AND ordered.requirement_id = r.id
  LEFT JOIN requested ON requested.organization_id = r.organization_id AND requested.requirement_id = r.id
  LEFT JOIN inspecting ON inspecting.organization_id = r.organization_id AND inspecting.requirement_id = r.id
  WHERE r.status = 'CONFIRMED' AND r.requirement_type IN ('MATERIAL','EXTERNAL_SERVICE'))
SELECT organization_id, requirement_id, project_id, activity_id, item_id, requirement_type, required_by, unit,
  required_qty, reserved_qty, consumed_qty, in_transit_qty, on_order_qty, requested_qty,
  reserved_qty + consumed_qty AS covered_qty,
  in_transit_qty + on_order_qty + inspection_qty AS inbound_qty,
  GREATEST(COALESCE(required_qty, 0) - reserved_qty - consumed_qty - in_transit_qty - on_order_qty - inspection_qty, 0) AS shortage_qty,
  inspection_qty
FROM base;

COMMENT ON VIEW public.supply_requirement_coverage IS
  'Cobertura DERIVADA por requisito de material: coberto = reservado + consumido; entrando = em trânsito + em pedido + em inspeção; falta = requerido − coberto − entrando. Requisitado é mostrado à parte. Nada é gravado.';
GRANT SELECT ON public.supply_requirement_coverage TO authenticated;

-- ---------------------------------------------------------------------------
-- 9) Privilégios e RLS
-- ---------------------------------------------------------------------------
DO $$
DECLARE fn text;
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.goods_receipt_guard() FROM PUBLIC, anon, authenticated';
  EXECUTE 'REVOKE ALL ON FUNCTION public.receiving_inspection_pending(uuid,uuid) FROM PUBLIC, anon, authenticated';
  EXECUTE 'REVOKE ALL ON FUNCTION public.inventory_requirement_committed(uuid,uuid) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.inventory_requirement_committed(uuid,uuid) TO service_role';
  EXECUTE 'REVOKE ALL ON FUNCTION public.inventory_post_movement(uuid,uuid,text,uuid,uuid,numeric,text,text,jsonb,text) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.inventory_post_movement(uuid,uuid,text,uuid,uuid,numeric,text,text,jsonb,text) TO service_role';
  FOREACH fn IN ARRAY ARRAY[
    'inbound_shipment_record(uuid,uuid,jsonb)', 'goods_receipt_post(uuid,uuid,jsonb)',
    'goods_receipt_inspect(uuid,uuid,uuid,jsonb)', 'goods_receipt_attach_evidence(uuid,uuid,uuid,jsonb)',
    'purchase_order_close(uuid,uuid,uuid,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END $$;

DO $$
DECLARE t text; v_plan boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['inbound_shipments','goods_receipts','goods_receipt_lines','goods_receipt_line_requirements',
                           'goods_receipt_evidence'] LOOP
    v_plan := t IN ('goods_receipts','goods_receipt_lines','goods_receipt_line_requirements','inbound_shipments');
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
      USING (organization_id = public.current_user_organization_id()
         AND (public.current_user_has_permission('receiving.view') OR public.current_user_has_permission('procurement.view')
              OR public.current_user_has_permission('inventory.view') OR public.current_user_has_permission('supply.view')%s))$p$,
      t || '_select', t,
      CASE WHEN v_plan THEN $x$ OR public.current_user_has_permission('operations.planning.view')
              OR public.current_user_has_permission('projects.view')$x$ ELSE '' END);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
  END LOOP;
END $$;

COMMIT;
