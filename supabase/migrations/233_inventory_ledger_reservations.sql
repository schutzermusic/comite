-- ============================================================================
-- 233 — ESTOQUE: livro de movimentos, reservas atômicas, transferências e
--       contagens
--
-- ─── O saldo não é um campo ─────────────────────────────────────────────
--
-- Em mão (on hand) é a SOMA do livro `inventory_movements` por item, local e
-- lote. Nenhuma coluna "quantidade" é editada: entrada, saída, transferência,
-- consumo em obra, devolução, ajuste e correção de contagem são linhas
-- append-only. Erro se corrige com outra linha, nunca reescrevendo a anterior.
--
-- ─── Reserva não é movimento físico ─────────────────────────────────────
--
-- Reservar não tira nada da prateleira: tira da DISPONIBILIDADE.
--   disponível = em mão − reservado em aberto        (nunca "em mão" puro)
-- A reserva nasce de um requisito MATERIAL confirmado (a demanda da 231/232),
-- do mesmo item, e passa por uma checagem atômica: trava consultiva por
-- (inquilino, item, local) + trava da linha do requisito. Dois usuários
-- reservando o mesmo saldo serializam; o segundo vê o que sobrou.
-- Um requisito não é coberto duas vezes: reservado + consumido + em trânsito
-- para ele nunca passa do requerido.
--
-- ─── Estados de quantidade (determinísticos) ────────────────────────────
--   em mão        Σ movimentos (local, item)
--   reservado     Σ (quantidade − consumido − liberado) das reservas ATIVAS
--   disponível    em mão − reservado, só em local que não é quarentena
--   em inspeção   em mão em local QUARANTINE (não disponível, não reservável)
--   em trânsito   Σ (despachado − recebido) de transferências em trânsito
--   consumido     Σ consumido das reservas (saiu para a obra)
--
-- ─── Transferência ──────────────────────────────────────────────────────
--   REQUESTED → APPROVED → IN_TRANSIT → PARTIALLY_RECEIVED → RECEIVED → CLOSED
--   (CANCELLED só antes do despacho). Despacho posta TRANSFER_OUT; recebimento
--   (parcial) posta TRANSFER_IN e, se a linha é de um requisito, reserva no
--   destino. Fechar com saldo não recebido exige motivo — a perda fica dita.
--
-- ─── Contagem ───────────────────────────────────────────────────────────
-- A contagem fotografa o esperado ao abrir. Postar aplica (contado − esperado)
-- como COUNT_CORRECTION. Se o item se moveu naquele local depois da foto, a
-- linha está VENCIDA e a postagem é recusada: reconte — o sistema não adivinha
-- se o recebimento aconteceu antes ou depois de alguém contar a prateleira.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Locais de estoque
-- ---------------------------------------------------------------------------
CREATE TABLE public.inventory_locations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code             text NOT NULL CHECK (code = upper(btrim(code)) AND code <> ''),
  name             text NOT NULL CHECK (btrim(name) <> ''),
  kind             text NOT NULL CHECK (kind IN ('WAREHOUSE','PROJECT_SITE','VEHICLE','QUARANTINE','ZONE','BIN')),
  parent_id        uuid,
  project_id       text,
  address_label    text,
  latitude         double precision CHECK (latitude BETWEEN -90 AND 90),
  longitude        double precision CHECK (longitude BETWEEN -180 AND 180),
  active           boolean NOT NULL DEFAULT true,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT invloc_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT invloc_code_unique UNIQUE (organization_id, code),
  CONSTRAINT invloc_parent_tenant FOREIGN KEY (organization_id, parent_id)
    REFERENCES public.inventory_locations (organization_id, id),
  CONSTRAINT invloc_project_tenant FOREIGN KEY (organization_id, project_id)
    REFERENCES public.projects (organization_id, id),
  CONSTRAINT invloc_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id),
  CONSTRAINT invloc_site_has_project CHECK (kind <> 'PROJECT_SITE' OR project_id IS NOT NULL),
  CONSTRAINT invloc_coordinates_pair CHECK ((latitude IS NULL) = (longitude IS NULL))
);
CREATE INDEX invloc_project ON public.inventory_locations (organization_id, project_id) WHERE project_id IS NOT NULL;
CREATE TRIGGER invloc_touch BEFORE UPDATE ON public.inventory_locations
  FOR EACH ROW EXECUTE FUNCTION public.commercial_touch_updated_at();

COMMENT ON TABLE public.inventory_locations IS
  'Locais de estoque (almoxarifado, canteiro do projeto, veículo, quarentena, zona, posição). Zona/posição são opcionais: ninguém é obrigado a endereçar prateleira.';

-- ---------------------------------------------------------------------------
-- 2) Reservas (antes dos movimentos: o movimento de consumo aponta a reserva)
-- ---------------------------------------------------------------------------
CREATE TABLE public.inventory_reservations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  item_id            uuid NOT NULL,
  location_id        uuid NOT NULL,
  project_id         text NOT NULL,
  requirement_id     uuid NOT NULL,
  quantity           numeric NOT NULL CHECK (quantity > 0),
  consumed_quantity  numeric NOT NULL DEFAULT 0 CHECK (consumed_quantity >= 0),
  released_quantity  numeric NOT NULL DEFAULT 0 CHECK (released_quantity >= 0),
  status             text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RELEASED','CONSUMED')),
  required_by        date,
  source             text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','TRANSFER','RECEIPT')),
  source_transfer_line_id uuid,
  note               text,
  idempotency_key    text,
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  closed_at          timestamptz,
  closed_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  close_reason       text,
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT invres_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT invres_item_tenant FOREIGN KEY (organization_id, item_id)
    REFERENCES public.supply_items (organization_id, id),
  CONSTRAINT invres_location_tenant FOREIGN KEY (organization_id, location_id)
    REFERENCES public.inventory_locations (organization_id, id),
  CONSTRAINT invres_project_tenant FOREIGN KEY (organization_id, project_id)
    REFERENCES public.projects (organization_id, id),
  CONSTRAINT invres_requirement_tenant FOREIGN KEY (organization_id, requirement_id)
    REFERENCES public.project_requirements (organization_id, id),
  CONSTRAINT invres_not_over_closed CHECK (consumed_quantity + released_quantity <= quantity),
  -- ATIVA ⇔ ainda há saldo em aberto. O estado não mente sobre a conta.
  CONSTRAINT invres_status_matches_open CHECK ((status = 'ACTIVE') = (quantity - consumed_quantity - released_quantity > 0)),
  CONSTRAINT invres_consumed_status CHECK (status <> 'CONSUMED' OR consumed_quantity > 0),
  CONSTRAINT invres_idempotency UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX invres_open ON public.inventory_reservations (organization_id, item_id, location_id) WHERE status = 'ACTIVE';
CREATE INDEX invres_requirement ON public.inventory_reservations (organization_id, requirement_id);
CREATE INDEX invres_project ON public.inventory_reservations (organization_id, project_id);
CREATE TRIGGER invres_touch BEFORE UPDATE ON public.inventory_reservations
  FOR EACH ROW EXECUTE FUNCTION public.commercial_touch_updated_at();

-- O que a reserva É não muda depois de criada: só o que aconteceu com ela.
CREATE OR REPLACE FUNCTION public.inventory_reservation_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.organization_id <> OLD.organization_id OR NEW.item_id <> OLD.item_id OR NEW.location_id <> OLD.location_id
     OR NEW.project_id <> OLD.project_id OR NEW.requirement_id <> OLD.requirement_id OR NEW.quantity <> OLD.quantity
     OR (NEW.created_by IS DISTINCT FROM OLD.created_by AND NEW.created_by IS NOT NULL) OR NEW.created_at <> OLD.created_at OR NEW.source <> OLD.source THEN
    RAISE EXCEPTION 'Reservation identity does not change: release it and reserve again.' USING ERRCODE = '42501';
  END IF;
  IF OLD.status <> 'ACTIVE' AND NEW.status = 'ACTIVE' THEN
    RAISE EXCEPTION 'Closed reservation does not reopen.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.inventory_reservation_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER invres_guard BEFORE UPDATE ON public.inventory_reservations
  FOR EACH ROW EXECUTE FUNCTION public.inventory_reservation_guard();

-- ---------------------------------------------------------------------------
-- 3) Transferências
-- ---------------------------------------------------------------------------
CREATE TABLE public.inventory_transfers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  transfer_number   text NOT NULL,
  from_location_id  uuid NOT NULL,
  to_location_id    uuid NOT NULL,
  project_id        text,
  status            text NOT NULL DEFAULT 'REQUESTED'
                    CHECK (status IN ('REQUESTED','APPROVED','IN_TRANSIT','PARTIALLY_RECEIVED','RECEIVED','CLOSED','CANCELLED')),
  expected_arrival  date,
  carrier           text,
  tracking_ref      text,
  note              text,
  evidence_document_id uuid,
  idempotency_key   text,
  requested_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at      timestamptz NOT NULL DEFAULT now(),
  approved_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at       timestamptz,
  dispatched_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  dispatched_at     timestamptz,
  received_at       timestamptz,
  closed_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_at         timestamptz,
  close_reason      text,
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT invtr_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT invtr_number_unique UNIQUE (organization_id, transfer_number),
  CONSTRAINT invtr_idempotency UNIQUE (organization_id, idempotency_key),
  CONSTRAINT invtr_from_tenant FOREIGN KEY (organization_id, from_location_id)
    REFERENCES public.inventory_locations (organization_id, id),
  CONSTRAINT invtr_to_tenant FOREIGN KEY (organization_id, to_location_id)
    REFERENCES public.inventory_locations (organization_id, id),
  CONSTRAINT invtr_project_tenant FOREIGN KEY (organization_id, project_id)
    REFERENCES public.projects (organization_id, id),
  CONSTRAINT invtr_evidence_tenant FOREIGN KEY (organization_id, evidence_document_id)
    REFERENCES public.contract_documents (organization_id, id) ON DELETE SET NULL (evidence_document_id),
  CONSTRAINT invtr_distinct_locations CHECK (from_location_id <> to_location_id),
  CONSTRAINT invtr_cancel_has_reason CHECK (status <> 'CANCELLED' OR nullif(btrim(close_reason), '') IS NOT NULL)
);
CREATE INDEX invtr_status ON public.inventory_transfers (organization_id, status);
CREATE TRIGGER invtr_touch BEFORE UPDATE ON public.inventory_transfers
  FOR EACH ROW EXECUTE FUNCTION public.commercial_touch_updated_at();

CREATE TABLE public.inventory_transfer_lines (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  transfer_id            uuid NOT NULL,
  item_id                uuid NOT NULL,
  lot_code               text,
  quantity               numeric NOT NULL CHECK (quantity > 0),
  dispatched_quantity    numeric NOT NULL DEFAULT 0,
  received_quantity      numeric NOT NULL DEFAULT 0,
  requirement_id         uuid,
  source_reservation_id  uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT invtrl_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT invtrl_transfer_tenant FOREIGN KEY (organization_id, transfer_id)
    REFERENCES public.inventory_transfers (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT invtrl_item_tenant FOREIGN KEY (organization_id, item_id)
    REFERENCES public.supply_items (organization_id, id),
  CONSTRAINT invtrl_requirement_tenant FOREIGN KEY (organization_id, requirement_id)
    REFERENCES public.project_requirements (organization_id, id),
  CONSTRAINT invtrl_reservation_tenant FOREIGN KEY (organization_id, source_reservation_id)
    REFERENCES public.inventory_reservations (organization_id, id),
  -- Despacho é da linha inteira; recebimento pode ser parcial e nunca passa do despachado.
  CONSTRAINT invtrl_dispatch_whole CHECK (dispatched_quantity IN (0, quantity)),
  CONSTRAINT invtrl_received_bounds CHECK (received_quantity >= 0 AND received_quantity <= dispatched_quantity),
  CONSTRAINT invtrl_reservation_needs_requirement CHECK (source_reservation_id IS NULL OR requirement_id IS NOT NULL)
);
CREATE INDEX invtrl_transfer ON public.inventory_transfer_lines (organization_id, transfer_id);
CREATE INDEX invtrl_requirement ON public.inventory_transfer_lines (organization_id, requirement_id) WHERE requirement_id IS NOT NULL;

ALTER TABLE public.inventory_reservations
  ADD CONSTRAINT invres_transfer_line_tenant FOREIGN KEY (organization_id, source_transfer_line_id)
    REFERENCES public.inventory_transfer_lines (organization_id, id);

-- ---------------------------------------------------------------------------
-- 4) Contagens
-- ---------------------------------------------------------------------------
CREATE TABLE public.inventory_counts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id      uuid NOT NULL,
  status           text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','POSTED','CANCELLED')),
  note             text,
  opened_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  opened_at        timestamptz NOT NULL DEFAULT now(),
  posted_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  posted_at        timestamptz,
  close_reason     text,
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT invcnt_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT invcnt_location_tenant FOREIGN KEY (organization_id, location_id)
    REFERENCES public.inventory_locations (organization_id, id)
);
CREATE UNIQUE INDEX invcnt_one_open_per_location ON public.inventory_counts (organization_id, location_id) WHERE status = 'OPEN';
CREATE TRIGGER invcnt_touch BEFORE UPDATE ON public.inventory_counts
  FOR EACH ROW EXECUTE FUNCTION public.commercial_touch_updated_at();

CREATE TABLE public.inventory_count_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  count_id         uuid NOT NULL,
  item_id          uuid NOT NULL,
  lot_code         text,
  expected_quantity numeric NOT NULL,
  snapshot_seq     bigint NOT NULL,
  counted_quantity numeric CHECK (counted_quantity >= 0),
  counted_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  counted_at       timestamptz,

  CONSTRAINT invcntl_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT invcntl_count_tenant FOREIGN KEY (organization_id, count_id)
    REFERENCES public.inventory_counts (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT invcntl_item_tenant FOREIGN KEY (organization_id, item_id)
    REFERENCES public.supply_items (organization_id, id)
);
CREATE UNIQUE INDEX invcntl_one_per_item_lot ON public.inventory_count_lines (count_id, item_id, COALESCE(lot_code, ''));

-- ---------------------------------------------------------------------------
-- 5) Livro de movimentos (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE public.inventory_movements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq                bigint GENERATED ALWAYS AS IDENTITY,
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  item_id            uuid NOT NULL,
  location_id        uuid NOT NULL,
  lot_code           text,
  movement_type      text NOT NULL CHECK (movement_type IN ('RECEIPT','TRANSFER_OUT','TRANSFER_IN','ISSUE_TO_PROJECT',
                                                            'RETURN_FROM_PROJECT','ADJUSTMENT','COUNT_CORRECTION')),
  quantity           numeric NOT NULL CHECK (quantity <> 0),
  project_id         text,
  requirement_id     uuid,
  reservation_id     uuid,
  transfer_line_id   uuid,
  count_line_id      uuid,
  reference_kind     text,
  reference_id       uuid,
  reason             text,
  idempotency_key    text NOT NULL,
  actor_user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT invmov_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT invmov_idempotency UNIQUE (organization_id, idempotency_key),
  CONSTRAINT invmov_item_tenant FOREIGN KEY (organization_id, item_id)
    REFERENCES public.supply_items (organization_id, id),
  CONSTRAINT invmov_location_tenant FOREIGN KEY (organization_id, location_id)
    REFERENCES public.inventory_locations (organization_id, id),
  CONSTRAINT invmov_project_tenant FOREIGN KEY (organization_id, project_id)
    REFERENCES public.projects (organization_id, id),
  CONSTRAINT invmov_requirement_tenant FOREIGN KEY (organization_id, requirement_id)
    REFERENCES public.project_requirements (organization_id, id),
  CONSTRAINT invmov_reservation_tenant FOREIGN KEY (organization_id, reservation_id)
    REFERENCES public.inventory_reservations (organization_id, id),
  CONSTRAINT invmov_transfer_line_tenant FOREIGN KEY (organization_id, transfer_line_id)
    REFERENCES public.inventory_transfer_lines (organization_id, id),
  CONSTRAINT invmov_count_line_tenant FOREIGN KEY (organization_id, count_line_id)
    REFERENCES public.inventory_count_lines (organization_id, id),
  -- O sinal é do tipo: ninguém "recebe" quantidade negativa.
  CONSTRAINT invmov_sign_by_type CHECK (
    (movement_type IN ('RECEIPT','TRANSFER_IN','RETURN_FROM_PROJECT') AND quantity > 0)
    OR (movement_type IN ('TRANSFER_OUT','ISSUE_TO_PROJECT') AND quantity < 0)
    OR movement_type IN ('ADJUSTMENT','COUNT_CORRECTION')),
  CONSTRAINT invmov_reason_where_discretionary CHECK (
    movement_type NOT IN ('ADJUSTMENT','COUNT_CORRECTION','RETURN_FROM_PROJECT') OR nullif(btrim(reason), '') IS NOT NULL),
  CONSTRAINT invmov_project_flow_has_reservation CHECK (
    movement_type NOT IN ('ISSUE_TO_PROJECT','RETURN_FROM_PROJECT') OR reservation_id IS NOT NULL),
  CONSTRAINT invmov_transfer_has_line CHECK (
    movement_type NOT IN ('TRANSFER_OUT','TRANSFER_IN') OR transfer_line_id IS NOT NULL)
);
CREATE INDEX invmov_balance ON public.inventory_movements (organization_id, item_id, location_id, lot_code);
CREATE INDEX invmov_recent ON public.inventory_movements (organization_id, occurred_at DESC);
CREATE INDEX invmov_seq ON public.inventory_movements (organization_id, item_id, location_id, seq);
CREATE INDEX invmov_project ON public.inventory_movements (organization_id, project_id) WHERE project_id IS NOT NULL;

CREATE TRIGGER invmov_no_rewrite BEFORE UPDATE ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.operations_reject_history_rewrite();
CREATE TRIGGER invmov_no_erasure BEFORE DELETE ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

COMMENT ON TABLE public.inventory_movements IS
  'Livro físico de estoque, append-only. Em mão = soma das linhas; nenhuma quantidade é editada. Correção é outra linha.';

-- ---------------------------------------------------------------------------
-- 6) Núcleo: travas, saldos e postagem
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inventory_require(p_organization_id uuid, p_actor uuid, p_keys text[])
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE k text;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Inventory write denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Inventory write requires a named actor.' USING ERRCODE = '42501';
  END IF;
  FOREACH k IN ARRAY p_keys LOOP
    IF public.apex_actor_has_permission(p_organization_id, p_actor, k) THEN RETURN; END IF;
  END LOOP;
  RAISE EXCEPTION 'Actor lacks permission (%).', array_to_string(p_keys, ' or ') USING ERRCODE = '42501';
END $$;

-- Trava consultiva por (inquilino, item, local): toda escrita que muda em mão
-- ou reservado daquele saldo passa por aqui, dentro da transação.
CREATE OR REPLACE FUNCTION public.inventory_lock(p_organization_id uuid, p_item_id uuid, p_location_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT pg_advisory_xact_lock(hashtextextended(format('inventory:%s:%s:%s', p_organization_id, p_item_id, p_location_id), 0))
$$;

CREATE OR REPLACE FUNCTION public.inventory_on_hand(
  p_organization_id uuid, p_item_id uuid, p_location_id uuid, p_lot_code text DEFAULT NULL, p_any_lot boolean DEFAULT true
) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(sum(quantity), 0) FROM public.inventory_movements
   WHERE organization_id = p_organization_id AND item_id = p_item_id AND location_id = p_location_id
     AND (p_any_lot OR lot_code IS NOT DISTINCT FROM p_lot_code)
$$;

CREATE OR REPLACE FUNCTION public.inventory_reserved_open(p_organization_id uuid, p_item_id uuid, p_location_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(sum(quantity - consumed_quantity - released_quantity), 0) FROM public.inventory_reservations
   WHERE organization_id = p_organization_id AND item_id = p_item_id AND location_id = p_location_id AND status = 'ACTIVE'
$$;

-- O que já cobre o requisito: reservado em aberto + consumido + em trânsito
-- para ele + transferências pedidas/aprovadas para ele (ainda não despachadas).
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
$$;

/*
  Posta UMA linha no livro. Chamado só pelas funções de ato abaixo, que já
  travaram o saldo. Regras físicas: lote/série conforme o item; em mão do lote
  nunca negativo; número de série existe no máximo uma vez no inquilino.
  Idempotente pela chave: repetir o mesmo ato devolve a linha já postada.
*/
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
    project_id, requirement_id, reservation_id, transfer_line_id, count_line_id, reference_kind, reference_id,
    reason, idempotency_key, actor_user_id)
  VALUES (p_organization_id, p_item_id, p_location_id, v_lot, p_type, p_quantity,
    nullif(p_refs->>'project_id',''), nullif(p_refs->>'requirement_id','')::uuid, nullif(p_refs->>'reservation_id','')::uuid,
    nullif(p_refs->>'transfer_line_id','')::uuid, nullif(p_refs->>'count_line_id','')::uuid,
    nullif(p_refs->>'reference_kind',''), nullif(p_refs->>'reference_id','')::uuid,
    nullif(btrim(p_reason),''), p_idempotency_key, p_actor)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Disponível depois do ato nunca negativo (o ato discricionário não come reserva alheia).
CREATE OR REPLACE FUNCTION public.inventory_assert_available(p_organization_id uuid, p_item_id uuid, p_location_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF public.inventory_on_hand(p_organization_id, p_item_id, p_location_id)
     - public.inventory_reserved_open(p_organization_id, p_item_id, p_location_id) < 0 THEN
    RAISE EXCEPTION 'Not enough available stock: the quantity is reserved for other demand.' USING ERRCODE = '23514';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 7) Atos: local e ajuste
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inventory_location_upsert(p_organization_id uuid, p_actor uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_loc public.inventory_locations%ROWTYPE; v_parent uuid; v_depth int := 0; v_cursor uuid;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['inventory.manage']);
  v_id := nullif(p_payload->>'id','')::uuid;
  v_parent := nullif(p_payload->>'parent_id','')::uuid;
  -- Hierarquia sem ciclo: subir a partir do pai nunca encontra o próprio local.
  v_cursor := v_parent;
  WHILE v_cursor IS NOT NULL LOOP
    IF v_cursor = v_id OR v_depth > 16 THEN
      RAISE EXCEPTION 'Location hierarchy cannot loop.' USING ERRCODE = '23514';
    END IF;
    SELECT parent_id INTO v_cursor FROM public.inventory_locations WHERE organization_id = p_organization_id AND id = v_cursor;
    v_depth := v_depth + 1;
  END LOOP;

  IF v_id IS NULL THEN
    INSERT INTO public.inventory_locations (organization_id, code, name, kind, parent_id, project_id, address_label,
      latitude, longitude, created_by)
    VALUES (p_organization_id, upper(btrim(p_payload->>'code')), btrim(p_payload->>'name'), p_payload->>'kind', v_parent,
      nullif(p_payload->>'project_id',''), nullif(btrim(p_payload->>'address_label'),''),
      nullif(p_payload->>'latitude','')::double precision, nullif(p_payload->>'longitude','')::double precision, p_actor)
    RETURNING * INTO v_loc;
    RETURN jsonb_build_object('location_id', v_loc.id, 'created', true);
  END IF;

  SELECT * INTO v_loc FROM public.inventory_locations WHERE organization_id = p_organization_id AND id = v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Location not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF p_payload ? 'kind' AND p_payload->>'kind' <> v_loc.kind
     AND EXISTS (SELECT 1 FROM public.inventory_movements m WHERE m.organization_id = p_organization_id AND m.location_id = v_id) THEN
    RAISE EXCEPTION 'Location has stock history: its kind does not change.' USING ERRCODE = '23514';
  END IF;
  IF (p_payload->>'active')::boolean IS FALSE AND EXISTS (
       SELECT 1 FROM public.inventory_movements m WHERE m.organization_id = p_organization_id AND m.location_id = v_id
        GROUP BY m.item_id HAVING sum(m.quantity) <> 0) THEN
    RAISE EXCEPTION 'Location still holds stock: move it before deactivating.' USING ERRCODE = '23514';
  END IF;
  UPDATE public.inventory_locations SET
    code = CASE WHEN p_payload ? 'code' THEN upper(btrim(p_payload->>'code')) ELSE code END,
    name = COALESCE(nullif(btrim(p_payload->>'name'),''), name),
    kind = COALESCE(nullif(p_payload->>'kind',''), kind),
    parent_id = CASE WHEN p_payload ? 'parent_id' THEN v_parent ELSE parent_id END,
    project_id = CASE WHEN p_payload ? 'project_id' THEN nullif(p_payload->>'project_id','') ELSE project_id END,
    address_label = CASE WHEN p_payload ? 'address_label' THEN nullif(btrim(p_payload->>'address_label'),'') ELSE address_label END,
    latitude = CASE WHEN p_payload ? 'latitude' THEN nullif(p_payload->>'latitude','')::double precision ELSE latitude END,
    longitude = CASE WHEN p_payload ? 'longitude' THEN nullif(p_payload->>'longitude','')::double precision ELSE longitude END,
    active = COALESCE((p_payload->>'active')::boolean, active)
  WHERE organization_id = p_organization_id AND id = v_id;
  RETURN jsonb_build_object('location_id', v_id, 'created', false);
END $$;

/*
  Ajuste: saldo inicial, avaria, achado. Sempre com motivo. Negativo não pode
  levar o disponível abaixo de zero — ajuste não consome reserva de ninguém.
*/
CREATE OR REPLACE FUNCTION public.inventory_adjust(p_organization_id uuid, p_actor uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_item uuid; v_loc uuid; v_qty numeric; v_id uuid; v_key text;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['inventory.manage']);
  v_item := (p_payload->>'item_id')::uuid; v_loc := (p_payload->>'location_id')::uuid;
  v_qty := (p_payload->>'quantity')::numeric;
  IF v_qty IS NULL OR v_qty = 0 THEN RAISE EXCEPTION 'Adjustment needs a non-zero quantity.' USING ERRCODE = '22023'; END IF;
  IF nullif(btrim(p_payload->>'reason'),'') IS NULL THEN
    RAISE EXCEPTION 'Adjustment requires a reason.' USING ERRCODE = '22023';
  END IF;
  v_key := 'adjust:' || COALESCE(nullif(p_payload->>'idempotency_key',''), gen_random_uuid()::text);
  PERFORM public.inventory_lock(p_organization_id, v_item, v_loc);
  IF EXISTS (SELECT 1 FROM public.inventory_movements WHERE organization_id = p_organization_id AND idempotency_key = v_key) THEN
    SELECT id INTO v_id FROM public.inventory_movements WHERE organization_id = p_organization_id AND idempotency_key = v_key;
    RETURN jsonb_build_object('movement_id', v_id, 'replayed', true);
  END IF;
  v_id := public.inventory_post_movement(p_organization_id, p_actor, 'ADJUSTMENT', v_item, v_loc, v_qty,
    p_payload->>'lot_code', v_key, '{}'::jsonb, p_payload->>'reason');
  IF v_qty < 0 THEN PERFORM public.inventory_assert_available(p_organization_id, v_item, v_loc); END IF;
  PERFORM public.emit_domain_event(p_organization_id, 'supply.inventory.adjusted', 1, 'inventory_movement', v_id,
    'inventory:' || v_key, jsonb_build_object('item_id', v_item, 'location_id', v_loc, 'quantity', v_qty,
      'reason', p_payload->>'reason'), now(), 'human', p_actor);
  RETURN jsonb_build_object('movement_id', v_id, 'replayed', false);
END $$;

-- ---------------------------------------------------------------------------
-- 8) Atos: reservar, liberar, entregar à obra, devolver
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inventory_reserve(p_organization_id uuid, p_actor uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
END $$;

-- Fecha o saldo em aberto como liberado (motivo obrigatório). Parcial é permitido.
CREATE OR REPLACE FUNCTION public.inventory_reservation_close_open(
  v_res public.inventory_reservations, p_quantity numeric, p_actor uuid, p_reason text
) RETURNS public.inventory_reservations LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_open numeric := v_res.quantity - v_res.consumed_quantity - v_res.released_quantity; v_out public.inventory_reservations%ROWTYPE;
BEGIN
  IF p_quantity <= 0 OR p_quantity > v_open THEN
    RAISE EXCEPTION 'Release quantity must be between 0 and the open % .', v_open USING ERRCODE = '22023';
  END IF;
  UPDATE public.inventory_reservations SET
    released_quantity = released_quantity + p_quantity,
    status = CASE WHEN v_open - p_quantity > 0 THEN 'ACTIVE' WHEN consumed_quantity > 0 THEN 'CONSUMED' ELSE 'RELEASED' END,
    closed_at = CASE WHEN v_open - p_quantity > 0 THEN NULL ELSE now() END,
    closed_by = CASE WHEN v_open - p_quantity > 0 THEN NULL ELSE p_actor END,
    close_reason = CASE WHEN v_open - p_quantity > 0 THEN close_reason ELSE p_reason END
  WHERE organization_id = v_res.organization_id AND id = v_res.id
  RETURNING * INTO v_out;
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION public.inventory_release(
  p_organization_id uuid, p_actor uuid, p_reservation_id uuid, p_quantity numeric, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_res public.inventory_reservations%ROWTYPE; v_qty numeric;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['inventory.reserve']);
  IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Release requires a reason.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_res FROM public.inventory_reservations WHERE organization_id = p_organization_id AND id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF v_res.status <> 'ACTIVE' THEN RAISE EXCEPTION 'Reservation is % : nothing to release.', v_res.status USING ERRCODE = '23514'; END IF;
  PERFORM public.inventory_lock(p_organization_id, v_res.item_id, v_res.location_id);
  v_qty := COALESCE(p_quantity, v_res.quantity - v_res.consumed_quantity - v_res.released_quantity);
  v_res := public.inventory_reservation_close_open(v_res, v_qty, p_actor, btrim(p_reason));
  PERFORM public.emit_domain_event(p_organization_id, 'supply.inventory.reservation_released', 1, 'inventory_reservation', v_res.id,
    'reservation:' || v_res.id || ':released:' || v_res.released_quantity,
    jsonb_build_object('project_id', v_res.project_id, 'requirement_id', v_res.requirement_id, 'item_id', v_res.item_id,
      'location_id', v_res.location_id, 'quantity', v_qty, 'reason', btrim(p_reason)), now(), 'human', p_actor);
  RETURN jsonb_build_object('reservation_id', v_res.id, 'status', v_res.status, 'released', v_qty);
END $$;

-- Entrega à obra: consome a reserva (baixa física com rastro até o requisito).
CREATE OR REPLACE FUNCTION public.inventory_issue_to_project(p_organization_id uuid, p_actor uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_res public.inventory_reservations%ROWTYPE; v_qty numeric; v_open numeric; v_key text; v_mov uuid;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['inventory.manage']);
  v_qty := (p_payload->>'quantity')::numeric;
  v_key := 'issue:' || COALESCE(nullif(p_payload->>'idempotency_key',''), gen_random_uuid()::text);
  SELECT * INTO v_res FROM public.inventory_reservations
   WHERE organization_id = p_organization_id AND id = (p_payload->>'reservation_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  SELECT id INTO v_mov FROM public.inventory_movements WHERE organization_id = p_organization_id AND idempotency_key = v_key;
  IF FOUND THEN RETURN jsonb_build_object('movement_id', v_mov, 'replayed', true); END IF;
  v_open := v_res.quantity - v_res.consumed_quantity - v_res.released_quantity;
  IF v_res.status <> 'ACTIVE' OR v_qty IS NULL OR v_qty <= 0 OR v_qty > v_open THEN
    RAISE EXCEPTION 'Issue must be positive and within the open reservation (% open).', v_open USING ERRCODE = '23514';
  END IF;
  PERFORM public.inventory_lock(p_organization_id, v_res.item_id, v_res.location_id);
  v_mov := public.inventory_post_movement(p_organization_id, p_actor, 'ISSUE_TO_PROJECT', v_res.item_id, v_res.location_id,
    -v_qty, p_payload->>'lot_code', v_key,
    jsonb_build_object('project_id', v_res.project_id, 'requirement_id', v_res.requirement_id, 'reservation_id', v_res.id),
    nullif(btrim(p_payload->>'note'),''));
  UPDATE public.inventory_reservations SET
    consumed_quantity = consumed_quantity + v_qty,
    status = CASE WHEN v_open - v_qty > 0 THEN 'ACTIVE' ELSE 'CONSUMED' END,
    closed_at = CASE WHEN v_open - v_qty > 0 THEN NULL ELSE now() END,
    closed_by = CASE WHEN v_open - v_qty > 0 THEN NULL ELSE p_actor END
  WHERE organization_id = p_organization_id AND id = v_res.id;
  PERFORM public.emit_domain_event(p_organization_id, 'supply.inventory.issued', 1, 'inventory_reservation', v_res.id,
    'inventory:' || v_key, jsonb_build_object('project_id', v_res.project_id, 'requirement_id', v_res.requirement_id,
      'item_id', v_res.item_id, 'location_id', v_res.location_id, 'quantity', v_qty), now(), 'human', p_actor);
  RETURN jsonb_build_object('movement_id', v_mov, 'replayed', false);
END $$;

-- Devolução da obra: o consumo volta a ser estoque livre (não re-reservado).
CREATE OR REPLACE FUNCTION public.inventory_return_from_project(p_organization_id uuid, p_actor uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_res public.inventory_reservations%ROWTYPE; v_qty numeric; v_loc uuid; v_key text; v_mov uuid;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['inventory.manage']);
  v_qty := (p_payload->>'quantity')::numeric;
  v_key := 'return:' || COALESCE(nullif(p_payload->>'idempotency_key',''), gen_random_uuid()::text);
  IF nullif(btrim(p_payload->>'reason'),'') IS NULL THEN RAISE EXCEPTION 'Return requires a reason.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_res FROM public.inventory_reservations
   WHERE organization_id = p_organization_id AND id = (p_payload->>'reservation_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  SELECT id INTO v_mov FROM public.inventory_movements WHERE organization_id = p_organization_id AND idempotency_key = v_key;
  IF FOUND THEN RETURN jsonb_build_object('movement_id', v_mov, 'replayed', true); END IF;
  IF v_qty IS NULL OR v_qty <= 0 OR v_qty > v_res.consumed_quantity THEN
    RAISE EXCEPTION 'Return must be positive and within what was issued (%).', v_res.consumed_quantity USING ERRCODE = '23514';
  END IF;
  v_loc := COALESCE(nullif(p_payload->>'location_id','')::uuid, v_res.location_id);
  PERFORM public.inventory_lock(p_organization_id, v_res.item_id, v_loc);
  v_mov := public.inventory_post_movement(p_organization_id, p_actor, 'RETURN_FROM_PROJECT', v_res.item_id, v_loc, v_qty,
    p_payload->>'lot_code', v_key,
    jsonb_build_object('project_id', v_res.project_id, 'requirement_id', v_res.requirement_id, 'reservation_id', v_res.id),
    p_payload->>'reason');
  UPDATE public.inventory_reservations SET
    consumed_quantity = consumed_quantity - v_qty,
    released_quantity = released_quantity + v_qty,
    status = CASE WHEN status = 'ACTIVE' THEN 'ACTIVE' WHEN consumed_quantity - v_qty > 0 THEN 'CONSUMED' ELSE 'RELEASED' END
  WHERE organization_id = p_organization_id AND id = v_res.id;
  PERFORM public.emit_domain_event(p_organization_id, 'supply.inventory.returned', 1, 'inventory_reservation', v_res.id,
    'inventory:' || v_key, jsonb_build_object('project_id', v_res.project_id, 'requirement_id', v_res.requirement_id,
      'item_id', v_res.item_id, 'location_id', v_loc, 'quantity', v_qty, 'reason', p_payload->>'reason'), now(), 'human', p_actor);
  RETURN jsonb_build_object('movement_id', v_mov, 'replayed', false);
END $$;

-- ---------------------------------------------------------------------------
-- 9) Atos: transferência
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inventory_transfer_event(t public.inventory_transfers, p_kind text, p_actor uuid, p_extra jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.emit_domain_event(t.organization_id, 'supply.transfer.' || p_kind, 1, 'inventory_transfer', t.id,
    'transfer:' || t.id || ':' || p_kind || ':' || COALESCE(p_extra->>'step', '1'),
    jsonb_build_object('project_id', t.project_id, 'transfer_number', t.transfer_number, 'from_location_id', t.from_location_id,
      'to_location_id', t.to_location_id, 'status', t.status) || p_extra, now(), 'human', p_actor)
$$;

CREATE OR REPLACE FUNCTION public.inventory_transfer_request(p_organization_id uuid, p_actor uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t public.inventory_transfers%ROWTYPE; v_key text; line jsonb; r public.project_requirements%ROWTYPE;
        v_res public.inventory_reservations%ROWTYPE; v_item uuid; v_qty numeric; v_project text; v_from public.inventory_locations%ROWTYPE;
        v_to public.inventory_locations%ROWTYPE;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['inventory.manage','inventory.reserve']);
  v_key := nullif(p_payload->>'idempotency_key','');
  IF v_key IS NOT NULL THEN
    SELECT * INTO t FROM public.inventory_transfers WHERE organization_id = p_organization_id AND idempotency_key = v_key;
    IF FOUND THEN RETURN jsonb_build_object('transfer_id', t.id, 'transfer_number', t.transfer_number, 'replayed', true); END IF;
  END IF;
  IF jsonb_typeof(p_payload->'lines') <> 'array' OR jsonb_array_length(p_payload->'lines') = 0 THEN
    RAISE EXCEPTION 'Transfer needs at least one line.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_from FROM public.inventory_locations WHERE organization_id = p_organization_id AND id = (p_payload->>'from_location_id')::uuid;
  SELECT * INTO v_to FROM public.inventory_locations WHERE organization_id = p_organization_id AND id = (p_payload->>'to_location_id')::uuid;
  IF v_from.id IS NULL OR v_to.id IS NULL THEN RAISE EXCEPTION 'Location not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF NOT v_to.active THEN RAISE EXCEPTION 'Destination % is inactive.', v_to.code USING ERRCODE = '23514'; END IF;
  v_project := nullif(p_payload->>'project_id','');

  INSERT INTO public.inventory_transfers (organization_id, transfer_number, from_location_id, to_location_id, project_id,
    expected_arrival, carrier, note, idempotency_key, requested_by)
  VALUES (p_organization_id, 'TR-' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 5)),
    v_from.id, v_to.id, v_project, nullif(p_payload->>'expected_arrival','')::date, nullif(btrim(p_payload->>'carrier'),''),
    nullif(btrim(p_payload->>'note'),''), v_key, p_actor)
  RETURNING * INTO t;

  FOR line IN SELECT * FROM jsonb_array_elements(p_payload->'lines') LOOP
    v_item := (line->>'item_id')::uuid; v_qty := (line->>'quantity')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Transfer line needs a positive quantity.' USING ERRCODE = '22023'; END IF;
    r := NULL; v_res := NULL;
    IF nullif(line->>'requirement_id','') IS NOT NULL THEN
      SELECT * INTO r FROM public.project_requirements
       WHERE organization_id = p_organization_id AND id = (line->>'requirement_id')::uuid FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Requirement not found in tenant.' USING ERRCODE = 'P0002'; END IF;
      IF r.status <> 'CONFIRMED' OR r.item_id IS DISTINCT FROM v_item THEN
        RAISE EXCEPTION 'Transfer line must carry the item of a confirmed requirement.' USING ERRCODE = '23514';
      END IF;
      IF v_project IS NULL THEN
        v_project := r.project_id;
        UPDATE public.inventory_transfers SET project_id = v_project WHERE organization_id = p_organization_id AND id = t.id;
      ELSIF r.project_id <> v_project THEN
        RAISE EXCEPTION 'All requirement lines of a transfer belong to its project.' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF nullif(line->>'source_reservation_id','') IS NOT NULL THEN
      SELECT * INTO v_res FROM public.inventory_reservations
       WHERE organization_id = p_organization_id AND id = (line->>'source_reservation_id')::uuid FOR UPDATE;
      IF NOT FOUND OR v_res.status <> 'ACTIVE' OR v_res.location_id <> v_from.id OR v_res.item_id <> v_item
         OR v_res.requirement_id IS DISTINCT FROM r.id
         OR v_qty > v_res.quantity - v_res.consumed_quantity - v_res.released_quantity THEN
        RAISE EXCEPTION 'Source reservation must be active, at the origin, for the same requirement and cover the line.' USING ERRCODE = '23514';
      END IF;
    ELSIF r.id IS NOT NULL AND public.inventory_requirement_committed(p_organization_id, r.id) + v_qty > r.quantity THEN
      RAISE EXCEPTION 'Transfer would over-cover the requirement (% required).', r.quantity USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.inventory_transfer_lines (organization_id, transfer_id, item_id, lot_code, quantity, requirement_id, source_reservation_id)
    VALUES (p_organization_id, t.id, v_item, nullif(btrim(line->>'lot_code'),''), v_qty, r.id, v_res.id);
  END LOOP;

  SELECT * INTO t FROM public.inventory_transfers WHERE organization_id = p_organization_id AND id = t.id;
  PERFORM public.inventory_transfer_event(t, 'requested', p_actor);
  RETURN jsonb_build_object('transfer_id', t.id, 'transfer_number', t.transfer_number, 'replayed', false);
END $$;

CREATE OR REPLACE FUNCTION public.inventory_transfer_approve(p_organization_id uuid, p_actor uuid, p_transfer_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t public.inventory_transfers%ROWTYPE;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['inventory.manage']);
  SELECT * INTO t FROM public.inventory_transfers WHERE organization_id = p_organization_id AND id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF t.status = 'APPROVED' THEN RETURN jsonb_build_object('transfer_id', t.id, 'status', t.status, 'replayed', true); END IF;
  IF t.status <> 'REQUESTED' THEN RAISE EXCEPTION 'Transfer is %: only a requested transfer is approved.', t.status USING ERRCODE = '23514'; END IF;
  UPDATE public.inventory_transfers SET status = 'APPROVED', approved_by = p_actor, approved_at = now()
   WHERE organization_id = p_organization_id AND id = t.id RETURNING * INTO t;
  PERFORM public.inventory_transfer_event(t, 'approved', p_actor);
  RETURN jsonb_build_object('transfer_id', t.id, 'status', t.status, 'replayed', false);
END $$;

/*
  Despacho: TRANSFER_OUT de cada linha na origem. Linha com reserva de
  origem libera a reserva (a cobertura passa a ser "em trânsito"); linha sem
  reserva precisa de disponível — despachar não leva material de outra obra.
  Travas em ordem de item para dois despachos não se cruzarem.
*/
CREATE OR REPLACE FUNCTION public.inventory_transfer_dispatch(p_organization_id uuid, p_actor uuid, p_transfer_id uuid, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t public.inventory_transfers%ROWTYPE; l public.inventory_transfer_lines%ROWTYPE; v_res public.inventory_reservations%ROWTYPE;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['inventory.manage']);
  SELECT * INTO t FROM public.inventory_transfers WHERE organization_id = p_organization_id AND id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF t.status IN ('IN_TRANSIT','PARTIALLY_RECEIVED','RECEIVED','CLOSED') AND t.dispatched_at IS NOT NULL THEN
    RETURN jsonb_build_object('transfer_id', t.id, 'status', t.status, 'replayed', true);
  END IF;
  IF t.status <> 'APPROVED' THEN RAISE EXCEPTION 'Transfer is %: only an approved transfer is dispatched.', t.status USING ERRCODE = '23514'; END IF;

  FOR l IN SELECT * FROM public.inventory_transfer_lines WHERE organization_id = p_organization_id AND transfer_id = t.id ORDER BY item_id, id LOOP
    PERFORM public.inventory_lock(p_organization_id, l.item_id, t.from_location_id);
    IF l.source_reservation_id IS NOT NULL THEN
      SELECT * INTO v_res FROM public.inventory_reservations
       WHERE organization_id = p_organization_id AND id = l.source_reservation_id FOR UPDATE;
      IF v_res.status <> 'ACTIVE' OR l.quantity > v_res.quantity - v_res.consumed_quantity - v_res.released_quantity THEN
        RAISE EXCEPTION 'Source reservation no longer covers the line: review the transfer.' USING ERRCODE = '23514';
      END IF;
      PERFORM public.inventory_reservation_close_open(v_res, l.quantity, p_actor, 'Despachado na transferência ' || t.transfer_number);
    END IF;
    PERFORM public.inventory_post_movement(p_organization_id, p_actor, 'TRANSFER_OUT', l.item_id, t.from_location_id, -l.quantity,
      l.lot_code, 'transfer:' || l.id || ':out',
      jsonb_build_object('project_id', t.project_id, 'requirement_id', l.requirement_id, 'transfer_line_id', l.id), NULL);
    PERFORM public.inventory_assert_available(p_organization_id, l.item_id, t.from_location_id);
    UPDATE public.inventory_transfer_lines SET dispatched_quantity = quantity WHERE organization_id = p_organization_id AND id = l.id;
  END LOOP;

  UPDATE public.inventory_transfers SET status = 'IN_TRANSIT', dispatched_by = p_actor, dispatched_at = now(),
    carrier = COALESCE(nullif(btrim(p_payload->>'carrier'),''), carrier),
    tracking_ref = COALESCE(nullif(btrim(p_payload->>'tracking_ref'),''), tracking_ref),
    expected_arrival = COALESCE(nullif(p_payload->>'expected_arrival','')::date, expected_arrival),
    evidence_document_id = COALESCE(nullif(p_payload->>'evidence_document_id','')::uuid, evidence_document_id)
  WHERE organization_id = p_organization_id AND id = t.id RETURNING * INTO t;
  PERFORM public.inventory_transfer_event(t, 'dispatched', p_actor);
  RETURN jsonb_build_object('transfer_id', t.id, 'status', t.status, 'replayed', false);
END $$;

/*
  Recebimento (parcial ou total). Cada entrega é idempotente pela chave. Linha
  de requisito reserva no destino o que chegou — até o que o requisito ainda
  precisa (se a demanda diminuiu no caminho, o excedente fica livre).
  Destino em quarentena não reserva: material em inspeção não cobre nada.
*/
CREATE OR REPLACE FUNCTION public.inventory_transfer_receive(p_organization_id uuid, p_actor uuid, p_transfer_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t public.inventory_transfers%ROWTYPE; l public.inventory_transfer_lines%ROWTYPE; line jsonb; v_qty numeric; v_key text;
        r public.project_requirements%ROWTYPE; v_to public.inventory_locations%ROWTYPE; v_cap numeric; v_reserve numeric;
        v_step int; v_all boolean; v_reserved numeric := 0;
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
END $$;

CREATE OR REPLACE FUNCTION public.inventory_transfer_close(p_organization_id uuid, p_actor uuid, p_transfer_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t public.inventory_transfers%ROWTYPE; v_missing numeric;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['inventory.manage']);
  SELECT * INTO t FROM public.inventory_transfers WHERE organization_id = p_organization_id AND id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF t.status = 'CLOSED' THEN RETURN jsonb_build_object('transfer_id', t.id, 'status', t.status, 'replayed', true); END IF;
  IF t.status NOT IN ('IN_TRANSIT','PARTIALLY_RECEIVED','RECEIVED') THEN
    RAISE EXCEPTION 'Transfer is %: close applies after dispatch (cancel before it).', t.status USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(sum(dispatched_quantity - received_quantity), 0) INTO v_missing
    FROM public.inventory_transfer_lines WHERE organization_id = p_organization_id AND transfer_id = t.id;
  IF v_missing > 0 AND nullif(btrim(p_reason),'') IS NULL THEN
    RAISE EXCEPTION 'Closing with % not received requires a reason (loss in transit is stated, not hidden).', v_missing USING ERRCODE = '22023';
  END IF;
  UPDATE public.inventory_transfers SET status = 'CLOSED', closed_by = p_actor, closed_at = now(), close_reason = nullif(btrim(p_reason),'')
   WHERE organization_id = p_organization_id AND id = t.id RETURNING * INTO t;
  PERFORM public.inventory_transfer_event(t, 'closed', p_actor, jsonb_build_object('not_received', v_missing, 'reason', t.close_reason));
  RETURN jsonb_build_object('transfer_id', t.id, 'status', t.status, 'not_received', v_missing, 'replayed', false);
END $$;

CREATE OR REPLACE FUNCTION public.inventory_transfer_cancel(p_organization_id uuid, p_actor uuid, p_transfer_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t public.inventory_transfers%ROWTYPE;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['inventory.manage']);
  IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Cancellation requires a reason.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO t FROM public.inventory_transfers WHERE organization_id = p_organization_id AND id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF t.status = 'CANCELLED' THEN RETURN jsonb_build_object('transfer_id', t.id, 'status', t.status, 'replayed', true); END IF;
  IF t.status NOT IN ('REQUESTED','APPROVED') THEN
    RAISE EXCEPTION 'Transfer is %: after dispatch it is received or closed, not cancelled.', t.status USING ERRCODE = '23514';
  END IF;
  UPDATE public.inventory_transfers SET status = 'CANCELLED', closed_by = p_actor, closed_at = now(), close_reason = btrim(p_reason)
   WHERE organization_id = p_organization_id AND id = t.id RETURNING * INTO t;
  PERFORM public.inventory_transfer_event(t, 'cancelled', p_actor, jsonb_build_object('reason', t.close_reason));
  RETURN jsonb_build_object('transfer_id', t.id, 'status', t.status, 'replayed', false);
END $$;

-- ---------------------------------------------------------------------------
-- 10) Atos: contagem
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inventory_count_snapshot_line(p_organization_id uuid, p_count_id uuid, p_location uuid, p_item uuid, p_lot text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_seq bigint;
BEGIN
  PERFORM public.inventory_lock(p_organization_id, p_item, p_location);
  SELECT COALESCE(max(seq), 0) INTO v_seq FROM public.inventory_movements
   WHERE organization_id = p_organization_id AND item_id = p_item AND location_id = p_location;
  INSERT INTO public.inventory_count_lines (organization_id, count_id, item_id, lot_code, expected_quantity, snapshot_seq)
  VALUES (p_organization_id, p_count_id, p_item, p_lot,
    public.inventory_on_hand(p_organization_id, p_item, p_location, p_lot, false), v_seq)
  ON CONFLICT (count_id, item_id, COALESCE(lot_code, '')) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.inventory_count_open(p_organization_id uuid, p_actor uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.inventory_counts%ROWTYPE; b record;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['inventory.manage']);
  INSERT INTO public.inventory_counts (organization_id, location_id, note, opened_by)
  VALUES (p_organization_id, (p_payload->>'location_id')::uuid, nullif(btrim(p_payload->>'note'),''), p_actor)
  RETURNING * INTO c;
  -- Foto do que o livro diz existir no local (por item e lote), já travada.
  FOR b IN SELECT item_id, lot_code FROM public.inventory_movements
            WHERE organization_id = p_organization_id AND location_id = c.location_id
              AND (NOT (p_payload ? 'item_ids') OR item_id::text IN (SELECT jsonb_array_elements_text(p_payload->'item_ids')))
            GROUP BY item_id, lot_code HAVING sum(quantity) <> 0 ORDER BY item_id LOOP
    PERFORM public.inventory_count_snapshot_line(p_organization_id, c.id, c.location_id, b.item_id, b.lot_code);
  END LOOP;
  RETURN jsonb_build_object('count_id', c.id, 'lines', (SELECT count(*) FROM public.inventory_count_lines WHERE count_id = c.id));
END $$;

CREATE OR REPLACE FUNCTION public.inventory_count_record(p_organization_id uuid, p_actor uuid, p_count_id uuid, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.inventory_counts%ROWTYPE; line jsonb; v_line uuid; v_n int := 0;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['inventory.manage']);
  SELECT * INTO c FROM public.inventory_counts WHERE organization_id = p_organization_id AND id = p_count_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Count not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF c.status <> 'OPEN' THEN RAISE EXCEPTION 'Count is %.', c.status USING ERRCODE = '23514'; END IF;
  FOR line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    IF (line->>'counted_quantity')::numeric < 0 THEN RAISE EXCEPTION 'Counted quantity cannot be negative.' USING ERRCODE = '22023'; END IF;
    v_line := nullif(line->>'line_id','')::uuid;
    IF v_line IS NULL THEN
      -- Achado: item/lote que o livro não esperava naquele local.
      PERFORM public.inventory_count_snapshot_line(p_organization_id, c.id, c.location_id, (line->>'item_id')::uuid,
        nullif(btrim(line->>'lot_code'),''));
      SELECT id INTO v_line FROM public.inventory_count_lines
       WHERE count_id = c.id AND item_id = (line->>'item_id')::uuid AND COALESCE(lot_code,'') = COALESCE(nullif(btrim(line->>'lot_code'),''),'');
    END IF;
    UPDATE public.inventory_count_lines SET counted_quantity = (line->>'counted_quantity')::numeric, counted_by = p_actor, counted_at = now()
     WHERE organization_id = p_organization_id AND count_id = c.id AND id = v_line;
    IF NOT FOUND THEN RAISE EXCEPTION 'Count line not found.' USING ERRCODE = 'P0002'; END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('count_id', c.id, 'recorded', v_n);
END $$;

CREATE OR REPLACE FUNCTION public.inventory_count_post(p_organization_id uuid, p_actor uuid, p_count_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.inventory_counts%ROWTYPE; l public.inventory_count_lines%ROWTYPE; v_item public.supply_items%ROWTYPE;
        v_delta numeric; v_posted int := 0; v_stale text[] := ARRAY[]::text[];
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['inventory.manage']);
  SELECT * INTO c FROM public.inventory_counts WHERE organization_id = p_organization_id AND id = p_count_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Count not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF c.status = 'POSTED' THEN RETURN jsonb_build_object('count_id', c.id, 'status', c.status, 'replayed', true); END IF;
  IF c.status <> 'OPEN' THEN RAISE EXCEPTION 'Count is %.', c.status USING ERRCODE = '23514'; END IF;

  FOR l IN SELECT * FROM public.inventory_count_lines WHERE count_id = c.id AND counted_quantity IS NOT NULL ORDER BY item_id, id LOOP
    PERFORM public.inventory_lock(p_organization_id, l.item_id, c.location_id);
    IF EXISTS (SELECT 1 FROM public.inventory_movements WHERE organization_id = p_organization_id AND item_id = l.item_id
                AND location_id = c.location_id AND seq > l.snapshot_seq) THEN
      SELECT * INTO v_item FROM public.supply_items WHERE id = l.item_id;
      v_stale := v_stale || (v_item.code || COALESCE(' / ' || l.lot_code, ''));
    END IF;
  END LOOP;
  IF array_length(v_stale, 1) > 0 THEN
    RAISE EXCEPTION 'Stock moved after the count began for: %. Recount these lines.', array_to_string(v_stale, ', ') USING ERRCODE = '40001';
  END IF;

  FOR l IN SELECT * FROM public.inventory_count_lines WHERE count_id = c.id AND counted_quantity IS NOT NULL ORDER BY item_id, id LOOP
    v_delta := l.counted_quantity - l.expected_quantity;
    IF v_delta <> 0 THEN
      SELECT * INTO v_item FROM public.supply_items WHERE id = l.item_id;
      IF v_item.tracking = 'SERIAL' THEN
        -- Série: a correção é de uma unidade; o contado de uma série é 0 ou 1.
        IF l.counted_quantity > 1 THEN RAISE EXCEPTION 'A serial is counted as 0 or 1.' USING ERRCODE = '23514'; END IF;
      END IF;
      PERFORM public.inventory_post_movement(p_organization_id, p_actor, 'COUNT_CORRECTION', l.item_id, c.location_id, v_delta,
        l.lot_code, 'count:' || l.id, jsonb_build_object('count_line_id', l.id),
        COALESCE(nullif(btrim(p_reason),''), 'Correção de contagem'));
      v_posted := v_posted + 1;
    END IF;
  END LOOP;
  UPDATE public.inventory_counts SET status = 'POSTED', posted_by = p_actor, posted_at = now(), close_reason = nullif(btrim(p_reason),'')
   WHERE organization_id = p_organization_id AND id = c.id;
  PERFORM public.emit_domain_event(p_organization_id, 'supply.inventory.count_posted', 1, 'inventory_count', c.id,
    'count:' || c.id || ':posted', jsonb_build_object('location_id', c.location_id, 'corrections', v_posted), now(), 'human', p_actor);
  RETURN jsonb_build_object('count_id', c.id, 'status', 'POSTED', 'corrections', v_posted, 'replayed', false);
END $$;

CREATE OR REPLACE FUNCTION public.inventory_count_cancel(p_organization_id uuid, p_actor uuid, p_count_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['inventory.manage']);
  IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Cancellation requires a reason.' USING ERRCODE = '22023'; END IF;
  UPDATE public.inventory_counts SET status = 'CANCELLED', close_reason = btrim(p_reason), posted_by = p_actor, posted_at = now()
   WHERE organization_id = p_organization_id AND id = p_count_id AND status = 'OPEN';
  IF NOT FOUND THEN RAISE EXCEPTION 'Open count not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  RETURN jsonb_build_object('count_id', p_count_id, 'status', 'CANCELLED');
END $$;

-- ---------------------------------------------------------------------------
-- 11) Leitura derivada: posição e cobertura
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.inventory_position
WITH (security_invoker = true) AS
WITH hand AS (
  SELECT organization_id, item_id, location_id, sum(quantity) AS on_hand, max(occurred_at) AS last_movement_at
    FROM public.inventory_movements GROUP BY organization_id, item_id, location_id),
res AS (
  SELECT organization_id, item_id, location_id, sum(quantity - consumed_quantity - released_quantity) AS reserved
    FROM public.inventory_reservations WHERE status = 'ACTIVE' GROUP BY organization_id, item_id, location_id),
transit AS (
  SELECT l.organization_id, l.item_id, t.to_location_id AS location_id, sum(l.dispatched_quantity - l.received_quantity) AS in_transit
    FROM public.inventory_transfer_lines l
    JOIN public.inventory_transfers t ON t.organization_id = l.organization_id AND t.id = l.transfer_id
   WHERE t.status IN ('IN_TRANSIT','PARTIALLY_RECEIVED')
   GROUP BY l.organization_id, l.item_id, t.to_location_id),
keys AS (
  SELECT organization_id, item_id, location_id FROM hand
  UNION SELECT organization_id, item_id, location_id FROM res
  UNION SELECT organization_id, item_id, location_id FROM transit)
SELECT k.organization_id, k.item_id, k.location_id, loc.kind AS location_kind,
  COALESCE(h.on_hand, 0) AS on_hand_qty,
  COALESCE(r.reserved, 0) AS reserved_qty,
  CASE WHEN loc.kind = 'QUARANTINE' THEN 0 ELSE COALESCE(h.on_hand, 0) - COALESCE(r.reserved, 0) END AS available_qty,
  CASE WHEN loc.kind = 'QUARANTINE' THEN COALESCE(h.on_hand, 0) ELSE 0 END AS inspection_qty,
  COALESCE(tr.in_transit, 0) AS inbound_transit_qty,
  h.last_movement_at
FROM keys k
JOIN public.inventory_locations loc ON loc.organization_id = k.organization_id AND loc.id = k.location_id
LEFT JOIN hand h ON h.organization_id = k.organization_id AND h.item_id = k.item_id AND h.location_id = k.location_id
LEFT JOIN res r ON r.organization_id = k.organization_id AND r.item_id = k.item_id AND r.location_id = k.location_id
LEFT JOIN transit tr ON tr.organization_id = k.organization_id AND tr.item_id = k.item_id AND tr.location_id = k.location_id;

COMMENT ON VIEW public.inventory_position IS
  'Posição DERIVADA por item e local: em mão (livro), reservado (reservas ativas), disponível = em mão − reservado (zero em quarentena), em inspeção e entrando por transferência.';
GRANT SELECT ON public.inventory_position TO authenticated;

-- Contrato de cobertura da 232 — mesmas colunas, agora com estoque e trânsito.
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
base AS (
  SELECT r.organization_id, r.id AS requirement_id, r.project_id, r.activity_id, r.item_id, r.requirement_type,
    r.required_by, r.unit, r.quantity AS required_qty,
    COALESCE(res.reserved, 0) AS reserved_qty,
    COALESCE(res.consumed, 0) AS consumed_qty,
    COALESCE(transit.in_transit, 0) AS in_transit_qty,
    0::numeric AS on_order_qty,
    0::numeric AS requested_qty
  FROM public.project_requirements r
  LEFT JOIN res ON res.organization_id = r.organization_id AND res.requirement_id = r.id
  LEFT JOIN transit ON transit.organization_id = r.organization_id AND transit.requirement_id = r.id
  WHERE r.status = 'CONFIRMED' AND r.requirement_type IN ('MATERIAL','EXTERNAL_SERVICE'))
SELECT organization_id, requirement_id, project_id, activity_id, item_id, requirement_type, required_by, unit,
  required_qty, reserved_qty, consumed_qty, in_transit_qty, on_order_qty, requested_qty,
  reserved_qty + consumed_qty AS covered_qty,
  in_transit_qty + on_order_qty AS inbound_qty,
  GREATEST(COALESCE(required_qty, 0) - reserved_qty - consumed_qty - in_transit_qty - on_order_qty, 0) AS shortage_qty
FROM base;

COMMENT ON VIEW public.supply_requirement_coverage IS
  'Cobertura DERIVADA por requisito de material: coberto = reservado + consumido; entrando = em trânsito + em pedido; falta = requerido − coberto − entrando. Nada é gravado.';
GRANT SELECT ON public.supply_requirement_coverage TO authenticated;

-- ---------------------------------------------------------------------------
-- 12) Privilégios e RLS
-- ---------------------------------------------------------------------------
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'inventory_require(uuid,uuid,text[])', 'inventory_lock(uuid,uuid,uuid)',
    'inventory_on_hand(uuid,uuid,uuid,text,boolean)', 'inventory_reserved_open(uuid,uuid,uuid)',
    'inventory_requirement_committed(uuid,uuid)',
    'inventory_post_movement(uuid,uuid,text,uuid,uuid,numeric,text,text,jsonb,text)',
    'inventory_assert_available(uuid,uuid,uuid)',
    'inventory_reservation_close_open(public.inventory_reservations,numeric,uuid,text)',
    'inventory_transfer_event(public.inventory_transfers,text,uuid,jsonb)',
    'inventory_count_snapshot_line(uuid,uuid,uuid,uuid,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'inventory_location_upsert(uuid,uuid,jsonb)', 'inventory_adjust(uuid,uuid,jsonb)', 'inventory_reserve(uuid,uuid,jsonb)',
    'inventory_release(uuid,uuid,uuid,numeric,text)', 'inventory_issue_to_project(uuid,uuid,jsonb)',
    'inventory_return_from_project(uuid,uuid,jsonb)', 'inventory_transfer_request(uuid,uuid,jsonb)',
    'inventory_transfer_approve(uuid,uuid,uuid)', 'inventory_transfer_dispatch(uuid,uuid,uuid,jsonb)',
    'inventory_transfer_receive(uuid,uuid,uuid,jsonb)', 'inventory_transfer_close(uuid,uuid,uuid,text)',
    'inventory_transfer_cancel(uuid,uuid,uuid,text)', 'inventory_count_open(uuid,uuid,jsonb)',
    'inventory_count_record(uuid,uuid,uuid,jsonb)', 'inventory_count_post(uuid,uuid,uuid,text)',
    'inventory_count_cancel(uuid,uuid,uuid,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END $$;

/*
  Leitura: quem vê estoque ou Supply vê tudo do estoque do inquilino. Reservas
  e linhas de transferência também são lidas por quem planeja o projeto — a
  cobertura (security_invoker) lê essas tabelas com o privilégio de quem
  pergunta, e o Planejamento precisa enxergar a própria cobertura.
*/
DO $$
DECLARE t text; v_plan boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['inventory_locations','inventory_reservations','inventory_transfers','inventory_transfer_lines',
                           'inventory_counts','inventory_count_lines','inventory_movements'] LOOP
    v_plan := t IN ('inventory_reservations','inventory_transfers','inventory_transfer_lines','inventory_locations');
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
      USING (organization_id = public.current_user_organization_id()
         AND (public.current_user_has_permission('inventory.view') OR public.current_user_has_permission('supply.view')
              OR public.current_user_has_permission('receiving.view')%s))$p$,
      t || '_select', t,
      CASE WHEN v_plan THEN $x$ OR public.current_user_has_permission('operations.planning.view')
              OR public.current_user_has_permission('projects.view') OR public.current_user_has_permission('operations.view')$x$ ELSE '' END);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
  END LOOP;
END $$;

COMMIT;
