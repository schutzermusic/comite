-- ============================================================================
-- 246 — COBERTURA: UMA REGRA SÓ PARA ESTOQUE E COMPRAS
--
-- DEFEITO (provado no QA). O teste ponta a ponta do Dashboard de Supply fez:
-- requisito de 500 m, 100 m reservados no canteiro, transferência de 150 m de
-- outro almoxarifado em REQUESTED — e `purchase_requisition_from_shortage`
-- requisitou 400 m. Ficaram 650 m prometidos contra 500 m (todos os projetos
-- `qa-flx-*`). A ordem inversa também furava: com a requisição aberta primeiro,
-- a transferência (ou a reserva) passava por cima dela (`qa-scn-tucurui`:
-- 1.450 m prometidos contra 1.200 m).
--
-- EVIDÊNCIA. Duas regras canônicas discordavam do que é uma transferência
-- pendente:
--   • compras (`supply_requirement_coverage.shortage_qty` + a requisição):
--     NÃO contava REQUESTED/APPROVED; contava a requisição aberta;
--   • estoque (`inventory_requirement_committed` → guardas de reserva e de
--     pedido de transferência): contava REQUESTED/APPROVED; NÃO contava a
--     requisição aberta.
-- Não é corrida: todo escritor trava `project_requirements … FOR UPDATE` e eles
-- se serializam. A regra assimétrica é que quebra.
--
-- REGRA (docs/operations-supply/COVERAGE-SEMANTICS.md), por requisito:
--   falta (descoberta)  = required − reservado − consumido − em trânsito − em pedido − em inspeção  (INALTERADA)
--   requisitado         = requisições abertas                                                      (INALTERADO)
--   pendente interno    = Σ linhas de transferência REQUESTED/APPROVED sem reserva de origem       (NOVO)
--   comprável           = GREATEST(falta − requisitado − pendente interno, 0)                      (NOVO)
--   reclamado           = comprometido (estoque) + requisitado → guarda simétrica                  (NOVO)
--
-- Uma transferência só reduz a compra quando está COMPROMETIDA (despachada, ou
-- com reserva de origem). REQUESTED/APPROVED sem reserva é PENDENTE: não é
-- cobertura (a falta continua visível para risco, etapas e sinais) e também
-- não é comprada de novo sem decisão humana — a EXCEÇÃO DE COBERTURA
-- governada: permissão `procurement.coverage_override` conferida NO BANCO,
-- motivo de ao menos 20 caracteres, livro append-only
-- `procurement_coverage_exceptions` e o evento
-- `supply.requisition.coverage_exception`. O sinal da Apex nunca usa a exceção.
--
-- O que muda:
--   1. permissão `procurement.coverage_override` (owner_admin e ceo_diretoria;
--      NÃO compras);
--   2. a visão ganha `pending_transfer_qty` e `purchasable_qty` ANEXADAS ao fim
--      (as 18 colunas e `shortage_qty` bruta ficam como estão);
--   3. `supply_requirement_claimed` (reclamado) e
--      `supply_requirement_pending_transfers` (a lista que o texto nomeia);
--   4. o livro `procurement_coverage_exceptions`;
--   5. a requisição da falta compra só o comprável; recusa com mensagem própria
--      quando o pendente cobre a falta; aceita a exceção governada; relê a
--      chave de idempotência SOB a trava dos requisitos (padrão da 238);
--   6. reserva e pedido de transferência usam o reclamado (guarda simétrica);
--      o pedido de transferência trava os requisitos em ordem canônica. A
--      liberação da inspeção (teto do recebimento) segue no comprometido.
-- Os tetos de recebimento (`inventory_transfer_receive`, `goods_receipt_post`,
-- `goods_receipt_inspect`) NÃO mudam. Nenhum dado existente é revalidado
-- (os requisitos já sobre-cobertos do QA continuam legíveis e operáveis).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Vocabulário: a exceção de cobertura é uma decisão de risco da direção
-- ---------------------------------------------------------------------------
INSERT INTO public.permissions (key, module, action, description) VALUES
  ('procurement.coverage_override', 'procurement', 'coverage_override',
   'Requisitar compra também da parte coberta por transferência interna pendente (exceção de cobertura, com motivo registrado)')
ON CONFLICT (key) DO NOTHING;

-- Critério da 230 (exceção de emissão da OS): titular e direção. Compras NÃO —
-- quem compra não decide sozinho comprar o que já está vindo de outro almoxarifado.
WITH grants(role_key) AS (VALUES ('owner_admin'), ('ceo_diretoria'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM grants g
  JOIN public.roles r ON r.organization_id IS NULL AND r.key = g.role_key
  JOIN public.permissions p ON p.key = 'procurement.coverage_override'
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.role_permissions rp
                   JOIN public.roles r ON r.id = rp.role_id AND r.organization_id IS NULL AND r.key = 'owner_admin'
                   JOIN public.permissions p ON p.id = rp.permission_id AND p.key = 'procurement.coverage_override') THEN
    RAISE EXCEPTION '[246] procurement.coverage_override não foi concedida ao owner_admin';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Visão de cobertura: pendente interno e comprável ANEXADOS ao fim
--    (mesmas 18 colunas, mesmos nomes e tipos; `shortage_qty` continua bruta)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.supply_requirement_coverage WITH (security_invoker = true) AS
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
-- 246: pedido/aprovado sem reserva de origem = cobertura PLANEJADA (não segura estoque até o despacho).
pending AS (
  SELECT l.organization_id, l.requirement_id, sum(l.quantity) AS pending_transfer
    FROM public.inventory_transfer_lines l
    JOIN public.inventory_transfers t ON t.organization_id = l.organization_id AND t.id = l.transfer_id
   WHERE t.status IN ('REQUESTED','APPROVED') AND l.source_reservation_id IS NULL AND l.requirement_id IS NOT NULL
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
         COALESCE(res.reserved, 0) AS reserved_qty, COALESCE(res.consumed, 0) AS consumed_qty,
         COALESCE(transit.in_transit, 0) AS in_transit_qty, COALESCE(ordered.on_order, 0) AS on_order_qty,
         COALESCE(requested.requested, 0) AS requested_qty, COALESCE(inspecting.inspection, 0) AS inspection_qty,
         COALESCE(pending.pending_transfer, 0) AS pending_transfer_qty
    FROM public.project_requirements r
    LEFT JOIN res ON res.organization_id = r.organization_id AND res.requirement_id = r.id
    LEFT JOIN transit ON transit.organization_id = r.organization_id AND transit.requirement_id = r.id
    LEFT JOIN pending ON pending.organization_id = r.organization_id AND pending.requirement_id = r.id
    LEFT JOIN ordered ON ordered.organization_id = r.organization_id AND ordered.requirement_id = r.id
    LEFT JOIN requested ON requested.organization_id = r.organization_id AND requested.requirement_id = r.id
    LEFT JOIN inspecting ON inspecting.organization_id = r.organization_id AND inspecting.requirement_id = r.id
   WHERE r.status = 'CONFIRMED' AND r.requirement_type IN ('MATERIAL','EXTERNAL_SERVICE'))
SELECT organization_id, requirement_id, project_id, activity_id, item_id, requirement_type, required_by, unit,
       required_qty, reserved_qty, consumed_qty, in_transit_qty, on_order_qty, requested_qty,
       reserved_qty + consumed_qty AS covered_qty,
       in_transit_qty + on_order_qty + inspection_qty AS inbound_qty,
       GREATEST(COALESCE(required_qty, 0) - reserved_qty - consumed_qty - in_transit_qty - on_order_qty - inspection_qty, 0) AS shortage_qty,
       inspection_qty,
       -- 246: ANEXADAS ao fim.
       pending_transfer_qty::numeric(18,4) AS pending_transfer_qty,
       GREATEST(GREATEST(COALESCE(required_qty, 0) - reserved_qty - consumed_qty - in_transit_qty - on_order_qty - inspection_qty, 0)
                - requested_qty - pending_transfer_qty, 0)::numeric(18,4) AS purchasable_qty
  FROM base;

COMMENT ON VIEW public.supply_requirement_coverage IS
  'Cobertura DERIVADA por requisito de material: coberto = reservado + consumido; entrando = em trânsito + em pedido + em inspeção; falta = requerido − coberto − entrando (bruta). Requisitado é mostrado à parte. Pendente interno (246) = transferências pedidas/aprovadas sem reserva de origem (planejado, não segura estoque). Comprável (246) = GREATEST(falta − requisitado − pendente interno, 0) — o que a requisição da falta compra sem exceção. Nada é gravado.';

-- Padrão da 237 (§11): só leitura para o navegador.
REVOKE ALL ON public.supply_requirement_coverage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.supply_requirement_coverage TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Reclamado (guarda simétrica) e a lista das transferências pendentes
-- ---------------------------------------------------------------------------
-- Tudo o que já reclama o requisito: comprometido pelo estoque (reservas,
-- transferências pedidas/aprovadas/em trânsito, em pedido, em inspeção) + o
-- requisitado em aberto. Sem dupla contagem: a linha de requisição com pedido
-- EMITIDO sai do requisitado e entra no em pedido.
CREATE OR REPLACE FUNCTION public.supply_requirement_claimed(p_organization_id uuid, p_requirement_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.inventory_requirement_committed(p_organization_id, p_requirement_id)
       + public.procurement_requested_open(p_organization_id, p_requirement_id)
$$;

-- As transferências que formam `pending_transfer_qty` (mesmo predicado da visão),
-- para a mensagem, a resposta e o livro de exceções nomearem cada uma.
CREATE OR REPLACE FUNCTION public.supply_requirement_pending_transfers(p_organization_id uuid, p_requirement_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('transfer_id', x.id, 'transfer_number', x.transfer_number,
           'status', x.status, 'quantity', x.quantity) ORDER BY x.transfer_number, x.id), '[]'::jsonb)
    FROM (SELECT t.id, t.transfer_number, t.status, sum(l.quantity) AS quantity
            FROM public.inventory_transfer_lines l
            JOIN public.inventory_transfers t ON t.organization_id = l.organization_id AND t.id = l.transfer_id
           WHERE l.organization_id = p_organization_id AND l.requirement_id = p_requirement_id
             AND t.status IN ('REQUESTED','APPROVED') AND l.source_reservation_id IS NULL
           GROUP BY t.id, t.transfer_number, t.status) x
$$;

-- ---------------------------------------------------------------------------
-- 4) Livro append-only da exceção de cobertura
--    Uma linha por requisito em que a exceção comprou além do comprável.
-- ---------------------------------------------------------------------------
CREATE TABLE public.procurement_coverage_exceptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requisition_id         uuid NOT NULL,
  requisition_line_id    uuid NOT NULL,
  requirement_id         uuid NOT NULL,
  shortage_qty           numeric NOT NULL CHECK (shortage_qty >= 0),          -- falta bruta no instante da decisão
  requested_qty          numeric NOT NULL CHECK (requested_qty >= 0),         -- já requisitado antes desta requisição
  pending_transfer_qty   numeric NOT NULL CHECK (pending_transfer_qty > 0),   -- o pendente interno que a exceção comprou por cima
  pending_transfers      jsonb NOT NULL
                         CHECK (jsonb_typeof(pending_transfers) = 'array' AND jsonb_array_length(pending_transfers) > 0),
  purchasable_qty        numeric NOT NULL CHECK (purchasable_qty >= 0),       -- o comprável pela regra padrão
  requisitioned_qty      numeric NOT NULL,                                    -- o que esta requisição levou
  reason                 text NOT NULL CHECK (length(btrim(reason)) >= 20),
  authorized_by          uuid NOT NULL REFERENCES auth.users(id),
  authorized_permission  text NOT NULL CHECK (authorized_permission = 'procurement.coverage_override'),
  created_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pcx_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pcx_once_per_requirement UNIQUE (organization_id, requisition_id, requirement_id),
  CONSTRAINT pcx_is_an_exception CHECK (requisitioned_qty > purchasable_qty
                                        AND requisitioned_qty <= purchasable_qty + pending_transfer_qty),
  CONSTRAINT pcx_requisition_tenant FOREIGN KEY (organization_id, requisition_id)
    REFERENCES public.purchase_requisitions (organization_id, id),
  CONSTRAINT pcx_requisition_line_tenant FOREIGN KEY (organization_id, requisition_line_id)
    REFERENCES public.purchase_requisition_lines (organization_id, id),
  CONSTRAINT pcx_requirement_tenant FOREIGN KEY (organization_id, requirement_id)
    REFERENCES public.project_requirements (organization_id, id)
);
CREATE INDEX pcx_requirement ON public.procurement_coverage_exceptions (organization_id, requirement_id);
CREATE INDEX pcx_requisition_line ON public.procurement_coverage_exceptions (organization_id, requisition_line_id);
CREATE TRIGGER pcx_no_rewrite BEFORE UPDATE ON public.procurement_coverage_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.operations_reject_history_rewrite();
CREATE TRIGGER pcx_no_erasure BEFORE DELETE ON public.procurement_coverage_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();
COMMENT ON TABLE public.procurement_coverage_exceptions IS
  'Exceção de cobertura (246): requisição da falta que comprou também a parte coberta por transferência interna pendente. Pessoa nomeada, permissão procurement.coverage_override, motivo, transferências e quantidades do instante. Append-only; escrita só por purchase_requisition_from_shortage.';

ALTER TABLE public.procurement_coverage_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY procurement_coverage_exceptions_select ON public.procurement_coverage_exceptions FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND (public.current_user_has_permission('procurement.view') OR public.current_user_has_permission('supply.view')));
REVOKE ALL ON TABLE public.procurement_coverage_exceptions FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.procurement_coverage_exceptions FROM authenticated;
GRANT SELECT ON TABLE public.procurement_coverage_exceptions TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) A resposta da requisição da falta — a MESMA para o ato e para a repetição
--    (tudo lido do que foi gravado: rastro por requisito + livro de exceções).
--    Por requisito: requisitado, comprável pela regra padrão e o pendente
--    interno. Sem exceção, o comprável É o que foi requisitado; o pendente é
--    o de agora. Com exceção, os três vêm do livro (o instante da decisão).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purchase_requisition_shortage_outcome(p_organization_id uuid, p_requisition_id uuid,
  p_replayed boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH trace AS (
    SELECT a.requirement_id, sum(a.quantity) AS qty
      FROM public.purchase_requisition_line_requirements a
      JOIN public.purchase_requisition_lines l ON l.organization_id = a.organization_id AND l.id = a.line_id
     WHERE a.organization_id = p_organization_id AND l.requisition_id = p_requisition_id
     GROUP BY a.requirement_id),
  per AS (
    SELECT t.requirement_id, t.qty, x.purchasable_qty AS x_purchasable, x.pending_transfer_qty AS x_pending,
           x.pending_transfers AS x_list,
           public.supply_requirement_pending_transfers(p_organization_id, t.requirement_id) AS now_list
      FROM trace t
      LEFT JOIN public.procurement_coverage_exceptions x
        ON x.organization_id = p_organization_id AND x.requisition_id = p_requisition_id AND x.requirement_id = t.requirement_id)
  SELECT jsonb_build_object(
    'requisition_id', q.id, 'requisition_number', q.requisition_number, 'replayed', p_replayed,
    'requisitioned_qty', COALESCE((SELECT sum(per.qty) FROM per), 0),
    'override', EXISTS (SELECT 1 FROM per WHERE per.x_purchasable IS NOT NULL),
    'requirements', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'requirement_id', per.requirement_id,
        'requisitioned_qty', per.qty,
        'purchasable_qty', COALESCE(per.x_purchasable, per.qty),
        'pending_transfer_qty', COALESCE(per.x_pending,
            (SELECT COALESCE(sum((e->>'quantity')::numeric), 0) FROM jsonb_array_elements(per.now_list) e)),
        'pending_transfers', COALESCE(per.x_list, per.now_list)) ORDER BY per.requirement_id) FROM per), '[]'::jsonb))
  FROM public.purchase_requisitions q
  WHERE q.organization_id = p_organization_id AND q.id = p_requisition_id
$$;

-- ---------------------------------------------------------------------------
-- 6) Requisição da falta: compra só o comprável; exceção governada; chave
--    relida SOB a trava. Corpo implantado (234), mudanças marcadas "246".
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
    -- 246: um só retrato (mesma instrução) da falta, do requisitado, do pendente, do comprável e da lista.
    SELECT c.shortage_qty, c.requested_qty, c.pending_transfer_qty, c.purchasable_qty,
           public.supply_requirement_pending_transfers(p_organization_id, r.id) AS pending_transfers
      INTO cov FROM public.supply_requirement_coverage c WHERE c.organization_id = p_organization_id AND c.requirement_id = r.id;
    v_open := COALESCE(cov.requested_qty, 0);
    v_pending := COALESCE(cov.pending_transfer_qty, 0);
    v_purchasable := COALESCE(cov.purchasable_qty, 0);
    v_short := COALESCE(cov.shortage_qty, 0) - v_open;              -- descoberto ainda não requisitado (inclui o pendente)
    IF v_short <= 0 THEN
      -- As requisições já cobrem a falta: nem cancelar a transferência nem a exceção deixariam algo a comprar.
      RAISE EXCEPTION 'Requirement % has no uncovered shortage left to requisition (% already requested).', r.title, v_open
        USING ERRCODE = '23514';
    END IF;
    -- 246: sem exceção, compra só o comprável; com exceção, o descoberto inteiro (o pendente, DECLARADO).
    v_excepted := v_override AND v_pending > 0 AND v_short > v_purchasable;
    v_take := CASE WHEN v_excepted THEN v_short ELSE v_purchasable END;
    IF v_take <= 0 THEN
      RAISE EXCEPTION '% is covered by pending internal transfer(s) %: dispatch or cancel the transfer, or request a coverage exception.',
        r.title, (SELECT string_agg(e->>'transfer_number', ', ') FROM jsonb_array_elements(cov.pending_transfers) e)
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
-- 7) Reserva: guarda simétrica (corpo implantado da 238; mudanças marcadas "246")
-- ---------------------------------------------------------------------------
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
  -- 246: o bloco saiu duplicado na 238 (ruído de cópia); fica uma releitura só.
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
  -- 246: guarda SIMÉTRICA à da compra — a requisição aberta também reclama o requisito. Para trocar a
  -- compra por estoque, cancela-se a requisição primeiro.
  v_committed := public.supply_requirement_claimed(p_organization_id, r.id);
  IF v_committed + v_qty > r.quantity THEN
    RAISE EXCEPTION 'Reservation would over-cover the requirement: % required, % already committed or requisitioned (% by open purchase requisitions).',
      r.quantity, v_committed, public.procurement_requested_open(p_organization_id, r.id) USING ERRCODE = '23514';
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

-- ---------------------------------------------------------------------------
-- 8) Pedido de transferência: guarda simétrica + travas em ordem canônica
--    (corpo implantado da 237; mudanças marcadas "246")
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inventory_transfer_request(p_organization_id uuid, p_actor uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE t public.inventory_transfers%ROWTYPE; v_key text; line jsonb; r public.project_requirements%ROWTYPE;
        v_res public.inventory_reservations%ROWTYPE; v_item uuid; v_qty numeric; v_project text; v_from public.inventory_locations%ROWTYPE;
        v_to public.inventory_locations%ROWTYPE;
        -- 246
        v_rid uuid; v_release boolean; v_claimed numeric;
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
  -- 246: trava os requisitos das linhas ANTES de gravar, em ordem canônica (uuid) — a mesma de
  -- purchase_requisition_from_shortage. Na ordem das linhas, dois pedidos cruzados se travariam.
  FOR v_rid IN SELECT DISTINCT (x->>'requirement_id')::uuid FROM jsonb_array_elements(p_payload->'lines') x
                WHERE nullif(x->>'requirement_id','') IS NOT NULL ORDER BY 1 LOOP
    PERFORM 1 FROM public.project_requirements WHERE organization_id = p_organization_id AND id = v_rid FOR UPDATE;
  END LOOP;
  -- 246: a liberação da inspeção (goods_receipt_inspect) já vem limitada pelo teto do recebimento
  -- (comprometido), que NÃO muda; só ela segue na regra antiga.
  v_release := COALESCE(current_setting('apex.inspection_release', true), '') <> '';
  SELECT * INTO v_from FROM public.inventory_locations WHERE organization_id = p_organization_id AND id = (p_payload->>'from_location_id')::uuid;
  SELECT * INTO v_to FROM public.inventory_locations WHERE organization_id = p_organization_id AND id = (p_payload->>'to_location_id')::uuid;
  IF v_from.id IS NULL OR v_to.id IS NULL THEN RAISE EXCEPTION 'Location not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF NOT v_to.active THEN RAISE EXCEPTION 'Destination % is inactive.', v_to.code USING ERRCODE = '23514'; END IF;
  -- 237: quarentena só se esvazia pela inspeção e nunca se enche por transferência.
  PERFORM public.inventory_assert_outside_quarantine(p_organization_id, v_from.id, true);
  PERFORM public.inventory_assert_outside_quarantine(p_organization_id, v_to.id, false);
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
    ELSIF r.id IS NOT NULL THEN
      -- 246: guarda SIMÉTRICA à da compra — a requisição aberta também reclama o requisito.
      v_claimed := CASE WHEN v_release THEN public.inventory_requirement_committed(p_organization_id, r.id)
                        ELSE public.supply_requirement_claimed(p_organization_id, r.id) END;
      IF v_claimed + v_qty > r.quantity THEN
        RAISE EXCEPTION 'Transfer would over-cover the requirement (% required, % already committed or requisitioned, % by open purchase requisitions).',
          r.quantity, v_claimed, CASE WHEN v_release THEN 0 ELSE public.procurement_requested_open(p_organization_id, r.id) END
          USING ERRCODE = '23514';
      END IF;
    END IF;
    INSERT INTO public.inventory_transfer_lines (organization_id, transfer_id, item_id, lot_code, quantity, requirement_id, source_reservation_id)
    VALUES (p_organization_id, t.id, v_item, nullif(btrim(line->>'lot_code'),''), v_qty, r.id, v_res.id);
  END LOOP;

  SELECT * INTO t FROM public.inventory_transfers WHERE organization_id = p_organization_id AND id = t.id;
  PERFORM public.inventory_transfer_event(t, 'requested', p_actor);
  RETURN jsonb_build_object('transfer_id', t.id, 'transfer_number', t.transfer_number, 'replayed', false);
END $function$;

-- ---------------------------------------------------------------------------
-- 9) Privilégios: novas e reescritas — só o servidor
-- ---------------------------------------------------------------------------
DO $$
DECLARE sig text;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'supply_requirement_claimed(uuid,uuid)', 'supply_requirement_pending_transfers(uuid,uuid)',
    'purchase_requisition_shortage_outcome(uuid,uuid,boolean)', 'purchase_requisition_from_shortage(uuid,uuid,jsonb)',
    'inventory_reserve(uuid,uuid,jsonb)', 'inventory_transfer_request(uuid,uuid,jsonb)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', sig);
  END LOOP;
END $$;

COMMIT;
