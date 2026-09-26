-- ============================================================================
-- 248 — COMPRAS: QUANTIDADES COERENTES (PEDIDO PARCIAL, CANCELAMENTO, REABERTURA)
--
-- DEFEITO (provado no QA, revisão da 247). Requisito de 100 m; a RC-A pede 100;
-- a proposta cobre 60; o pedido de 60 é EMITIDO. A emissão dá a linha por
-- atendida sem olhar quantidade: os 40 não pedidos voltam a ser compráveis e a
-- RC-B os requisita (reclamado 100). Cancelar o pedido devolvia a RC-A INTEIRA
-- ao requisitado: 140 reclamados contra 100, e a nova cotação da RC-A pedia 100
-- de novo (compra em dobro). O mesmo com reserva ou transferência no lugar da
-- RC-B, com uma linha de dois requisitos e com requisição de duas linhas.
-- Vizinhos do mesmo defeito:
--   • cotação velha de requisição CANCELADA virava pedido e era emitida
--     (reclamado 200 contra 100);
--   • linha que a proposta vencedora não cotou ficava presa (nem nova cotação,
--     nem nova requisição);
--   • requisito cancelado ou replanejado depois do pedido era recomprado inteiro.
--
-- EVIDÊNCIA. SQL desfeito no QA, pela cadeia governada de fixtures.mjs: depois
-- do cancelamento, requisitado 140; `from_shortage` recusa "(140 already
-- requested)"; a reserva de 1 m é recusada por over-cover; a recotação da RC-A
-- sai com 100. Causa: `procurement_requested_open` e a visão contam a alocação
-- CHEIA de toda linha sem pedido emitido; a emissão solta o resto sem registro;
-- o cancelamento reabre tudo sem trava do requisito e sem conta.
--
-- REGRA (docs/operations-supply/COVERAGE-SEMANTICS.md, seção 248):
--   aberto(a)    = alocado − Σ liberado(a)        (livro append-only, sem arredondar)
--   requisitado  = Σ aberto das linhas de requisições vivas sem pedido emitido
--   emissão      = o que a requisição pediu e o pedido não pediu é LIBERADO
--                  (PO_ISSUED / NOT_ORDERED) — nada muda no reclamado
--   cancelamento = por requisito, sob trava, ANTES de o pedido mudar de estado:
--                  próprio    = em pedido deste pedido + aberto que já conta como requisitado
--                  orçamento  = GREATEST(capacidade − (reclamado − próprio), 0)
--                  reabre até o orçamento; o resto é LIBERADO (PO_CANCELLED /
--                  COVERED, ou REQUIREMENT_INACTIVE quando a capacidade é 0)
--   capacidade   = required do requisito CONFIRMADO de material/serviço; 0 fora disso
-- Dado são: reclamado ≤ required depois do cancelamento. Dado legado já
-- sobre-coberto: reclamado ≤ o de antes. Exceção de cobertura não atravessa um
-- cancelamento: comprar de novo o pendente pede NOVA exceção (246/247).
--
-- O que muda:
--   1. o livro `procurement_requisition_releases` e a visão
--      `purchase_requisition_open_allocations` (aberto por alocação);
--   2. `procurement_requested_open` e a visão de cobertura contam o aberto
--      (as 20 colunas da visão ficam como estão);
--   3. `procurement_rfq_create`: trava as requisições antes de ler; cota o
--      aberto; recusa linha toda liberada; linha que a proposta vencedora não
--      cotou pode ser cotada de novo;
--   4. `procurement_decide`: trava as requisições antes da cotação; linha de
--      requisição morta ou sem aberto não vira pedido; nunca aloca 0;
--   5. `purchase_order_issue`: trava as requisições; não emite pedido de
--      requisição morta; libera o não pedido; PEDIDA numa instrução própria;
--   6. `purchase_order_cancel`: a regra acima, a situação da requisição vinda
--      das linhas (inclusive ENCERRADA), a repetição devolve o desfecho gravado;
--   7. `purchase_requisition_cancel`: recusa ENCERRADA e cancela a cotação
--      aberta que só tinha linhas de requisições mortas.
-- Ordem das travas (sem ciclo novo): cancelamento PO → aprovação → requisitos
-- (FOR NO KEY UPDATE, uuid) → requisições (uuid) → cotação; emissão PO →
-- requisições (uuid); decisão requisições (uuid) → cotação; cotação requisições
-- (uuid); cancelamento de requisição requisição → cotação.
-- FORA (acompanhamentos próprios, escopo congelado pelo usuário): o impasse de
-- travas do recebimento (inclusive cancelamento ∥ recebimento de outro pedido
-- com ≥ 2 requisitos em comum — o PostgreSQL aborta um lado e o governedRpc
-- repete o 40P01), proposta acima da quantidade cotada e edição de requisito
-- comprometido. Nenhum dado existente é reescrito (o QA não tem pedido emitido
-- e cancelado). Avaliada e desfeita sobre cada pedido cancelável do QA (menos a
-- demo de Tucuruí), a regra não sobe nenhum reclamado nem toca requisito são;
-- só os dois `qa-flx-*` já sobre-cobertos antes da 246 (650 contra 500)
-- desceriam a 500 se cancelados.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Livro append-only das liberações
--    Uma linha por (pedido, alocação, estágio) em que algo deixou de estar
--    aberto. Quem agiu fica no histórico do pedido e no evento — não aqui.
-- ---------------------------------------------------------------------------
CREATE TABLE public.procurement_requisition_releases (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requisition_id       uuid NOT NULL,
  requisition_line_id  uuid NOT NULL,
  allocation_id        uuid NOT NULL,
  requirement_id       uuid NOT NULL,
  purchase_order_id    uuid NOT NULL,
  stage                text NOT NULL CHECK (stage IN ('PO_ISSUED','PO_CANCELLED')),
  quantity             numeric NOT NULL CHECK (quantity > 0),               -- sem escala: exatamente o que saiu do aberto
  cause                text NOT NULL CHECK (cause IN ('NOT_ORDERED','COVERED','REQUIREMENT_INACTIVE')),
  reason               text NOT NULL CHECK (btrim(reason) <> ''),
  created_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT prr_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT prr_once_per_stage UNIQUE (organization_id, purchase_order_id, allocation_id, stage),
  -- A emissão só libera o não pedido; o cancelamento libera o coberto ou o de requisito inativo.
  CONSTRAINT prr_stage_cause CHECK ((stage = 'PO_ISSUED') = (cause = 'NOT_ORDERED')),
  CONSTRAINT prr_requisition_tenant FOREIGN KEY (organization_id, requisition_id)
    REFERENCES public.purchase_requisitions (organization_id, id),
  CONSTRAINT prr_requisition_line_tenant FOREIGN KEY (organization_id, requisition_line_id)
    REFERENCES public.purchase_requisition_lines (organization_id, id),
  CONSTRAINT prr_allocation_tenant FOREIGN KEY (organization_id, allocation_id)
    REFERENCES public.purchase_requisition_line_requirements (organization_id, id),
  CONSTRAINT prr_requirement_tenant FOREIGN KEY (organization_id, requirement_id)
    REFERENCES public.project_requirements (organization_id, id),
  CONSTRAINT prr_purchase_order_tenant FOREIGN KEY (organization_id, purchase_order_id)
    REFERENCES public.purchase_orders (organization_id, id)
);
CREATE INDEX prr_allocation ON public.procurement_requisition_releases (organization_id, allocation_id);
CREATE INDEX prr_requisition_line ON public.procurement_requisition_releases (organization_id, requisition_line_id);
CREATE INDEX prr_requirement ON public.procurement_requisition_releases (organization_id, requirement_id);
CREATE TRIGGER prr_no_rewrite BEFORE UPDATE ON public.procurement_requisition_releases
  FOR EACH ROW EXECUTE FUNCTION public.operations_reject_history_rewrite();
CREATE TRIGGER prr_no_erasure BEFORE DELETE ON public.procurement_requisition_releases
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();
COMMENT ON TABLE public.procurement_requisition_releases IS
  'Liberações de requisição (248): o que deixou de ser demanda aberta de uma alocação — não pedido na emissão (PO_ISSUED/NOT_ORDERED) ou não reaberto no cancelamento do pedido (PO_CANCELLED/COVERED ou REQUIREMENT_INACTIVE). Aberto = alocado − Σ liberado. Nunca é cobertura reclamada. Append-only; escrito só por purchase_order_issue e purchase_order_cancel. Quem agiu fica no histórico do pedido e no evento supply.requisition.released.';

-- Mesma visibilidade das alocações: a visão de cobertura lê as duas com os direitos de quem consulta,
-- e um aberto calculado sem as liberações que a pessoa não enxerga sairia maior do que é.
ALTER TABLE public.procurement_requisition_releases ENABLE ROW LEVEL SECURITY;
CREATE POLICY procurement_requisition_releases_select ON public.procurement_requisition_releases FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND (public.current_user_has_permission('procurement.view') OR public.current_user_has_permission('supply.view')
          OR public.current_user_has_permission('receiving.view') OR public.current_user_has_permission('operations.planning.view')
          OR public.current_user_has_permission('projects.view')));
REVOKE ALL ON TABLE public.procurement_requisition_releases FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.procurement_requisition_releases FROM authenticated;
GRANT SELECT ON TABLE public.procurement_requisition_releases TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Aberto por alocação: alocado − Σ liberado (valores brutos, sem cast)
-- ---------------------------------------------------------------------------
CREATE VIEW public.purchase_requisition_open_allocations WITH (security_invoker = true) AS
SELECT a.organization_id, a.id AS allocation_id, l.requisition_id, a.line_id AS requisition_line_id, a.requirement_id,
       a.quantity AS allocated_qty, x.released_qty, a.quantity - x.released_qty AS open_qty
  FROM public.purchase_requisition_line_requirements a
  JOIN public.purchase_requisition_lines l ON l.organization_id = a.organization_id AND l.id = a.line_id
  CROSS JOIN LATERAL (SELECT COALESCE(sum(z.quantity), 0) AS released_qty
                        FROM public.procurement_requisition_releases z
                       WHERE z.organization_id = a.organization_id AND z.allocation_id = a.id) x;

COMMENT ON VIEW public.purchase_requisition_open_allocations IS
  'Aberto por alocação de requisição (248): alocado (purchase_requisition_line_requirements.quantity), liberado (Σ procurement_requisition_releases) e aberto = alocado − liberado, brutos. Alocação com aberto 0 não é demanda viva: nenhuma lista, laço, data ou conjunto de requisitos a inclui. Linha sem alocação (requisição manual) tem aberto = a quantidade da linha. Nada é gravado.';

REVOKE ALL ON public.purchase_requisition_open_allocations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.purchase_requisition_open_allocations TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Requisitado = o ABERTO (função e visão, mesmo predicado de sempre)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.procurement_requested_open(p_organization_id uuid, p_requirement_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- 248: soma o aberto da alocação (alocado − liberado), nunca a alocação cheia.
  SELECT COALESCE(sum(a.open_qty), 0)
    FROM public.purchase_requisition_open_allocations a
    JOIN public.purchase_requisitions r ON r.organization_id = a.organization_id AND r.id = a.requisition_id
   WHERE a.organization_id = p_organization_id AND a.requirement_id = p_requirement_id
     AND r.status IN ('SUBMITTED','SOURCING')
     AND NOT EXISTS (SELECT 1 FROM public.purchase_order_lines pl
                       JOIN public.purchase_orders po ON po.organization_id = pl.organization_id AND po.id = pl.purchase_order_id
                      WHERE pl.organization_id = a.organization_id AND pl.requisition_line_id = a.requisition_line_id
                        AND po.status IN ('ISSUED','PARTIALLY_RECEIVED','RECEIVED','CLOSED'))
$function$;

-- Visão de cobertura: só o CTE `requested` muda (mesmas 20 colunas, nomes, tipos e ordem).
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
-- 248: o aberto da alocação (alocado − liberado); o predicado da linha é o de sempre.
requested AS (
  SELECT a.organization_id, a.requirement_id, sum(a.open_qty) AS requested
    FROM public.purchase_requisition_open_allocations a
    JOIN public.purchase_requisitions r ON r.organization_id = a.organization_id AND r.id = a.requisition_id
   WHERE r.status IN ('SUBMITTED','SOURCING')
     AND NOT EXISTS (SELECT 1 FROM public.purchase_order_lines pl
                       JOIN public.purchase_orders po ON po.organization_id = pl.organization_id AND po.id = pl.purchase_order_id
                      WHERE pl.organization_id = a.organization_id AND pl.requisition_line_id = a.requisition_line_id
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

-- O comentário da visão segue o de antes (CREATE OR REPLACE o preserva); grants reaplicados (padrão da 237).
REVOKE ALL ON public.supply_requirement_coverage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.supply_requirement_coverage TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Cotação: trava as requisições ANTES de ler; cota o aberto; linha que a
--    proposta vencedora não cotou pode voltar à cotação. Corpo implantado
--    (234), mudanças marcadas "248".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.procurement_rfq_create(p_organization_id uuid, p_actor uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_rfq public.procurement_rfqs%ROWTYPE; v_lid text; l public.purchase_requisition_lines%ROWTYPE; v_sid text;
        v_status text;
        -- 248
        v_open numeric; v_need date;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['procurement.source']);
  IF jsonb_array_length(COALESCE(p_payload->'requisition_line_ids','[]')) = 0 OR jsonb_array_length(COALESCE(p_payload->'supplier_ids','[]')) = 0 THEN
    RAISE EXCEPTION 'RFQ needs requisition lines and at least one supplier.' USING ERRCODE = '22023';
  END IF;
  -- 248: as requisições das linhas pedidas, travadas em ordem canônica (uuid) ANTES de ler quantidade e
  -- data: o cancelamento de um pedido libera sob a mesma trava, então o aberto lido abaixo é o de agora.
  PERFORM 1 FROM public.purchase_requisitions r
   WHERE r.organization_id = p_organization_id
     AND r.id IN (SELECT l2.requisition_id FROM public.purchase_requisition_lines l2
                   WHERE l2.organization_id = p_organization_id
                     AND l2.id IN (SELECT x::uuid FROM jsonb_array_elements_text(p_payload->'requisition_line_ids') x))
   ORDER BY r.id FOR UPDATE;
  INSERT INTO public.procurement_rfqs (organization_id, rfq_number, response_due, note, created_by)
  VALUES (p_organization_id, public.procurement_number('COT'), nullif(p_payload->>'response_due','')::date,
    nullif(btrim(p_payload->>'note'),''), p_actor) RETURNING * INTO v_rfq;
  FOR v_lid IN SELECT DISTINCT jsonb_array_elements_text(p_payload->'requisition_line_ids') LOOP
    SELECT * INTO l FROM public.purchase_requisition_lines WHERE organization_id = p_organization_id AND id = v_lid::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Requisition line not found in tenant.' USING ERRCODE = 'P0002'; END IF;
    SELECT status INTO v_status FROM public.purchase_requisitions WHERE id = l.requisition_id;   -- 248: já travada acima
    IF v_status NOT IN ('SUBMITTED','SOURCING') THEN
      RAISE EXCEPTION 'Requisition is %: it is not sourced.', v_status USING ERRCODE = '23514';
    END IF;
    -- Uma linha de requisição em uma cotação viva por vez.
    -- 248: viva = ABERTA, ou DECIDIDA cujo pedido tem linha para ela e não foi cancelado. A linha que a
    -- proposta vencedora não cotou volta a poder ser cotada (antes ficava presa na cotação decidida).
    IF EXISTS (SELECT 1 FROM public.procurement_rfq_lines x JOIN public.procurement_rfqs q ON q.id = x.rfq_id
                WHERE x.requisition_line_id = l.id AND q.id <> v_rfq.id
                  AND (q.status = 'OPEN'
                       OR (q.status = 'DECIDED' AND EXISTS (
                             SELECT 1 FROM public.sourcing_decisions d
                               JOIN public.purchase_orders po ON po.organization_id = d.organization_id AND po.sourcing_decision_id = d.id
                               JOIN public.purchase_order_lines pl ON pl.organization_id = po.organization_id AND pl.purchase_order_id = po.id
                              WHERE d.organization_id = q.organization_id AND d.rfq_id = q.id
                                AND pl.requisition_line_id = l.id AND po.status <> 'CANCELLED')))) THEN
      RAISE EXCEPTION 'RFQ line already in a live RFQ.' USING ERRCODE = '23505';
    END IF;
    -- 248: a cotação pede o ABERTO da linha (Σ aberto das alocações; linha sem alocação = a quantidade
    -- dela) e a data das alocações ABERTAS — requisito liberado não antecipa a entrega.
    IF EXISTS (SELECT 1 FROM public.purchase_requisition_line_requirements a WHERE a.organization_id = l.organization_id AND a.line_id = l.id) THEN
      SELECT COALESCE(sum(o.open_qty), 0), min(pr.required_by) INTO v_open, v_need
        FROM public.purchase_requisition_open_allocations o
        JOIN public.project_requirements pr ON pr.organization_id = o.organization_id AND pr.id = o.requirement_id
       WHERE o.organization_id = l.organization_id AND o.requisition_line_id = l.id AND o.open_qty > 0;
    ELSE
      v_open := l.quantity; v_need := l.required_by;
    END IF;
    IF v_open <= 0 THEN
      RAISE EXCEPTION 'Requisition line is fully released: nothing left to source.' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.procurement_rfq_lines (organization_id, rfq_id, requisition_line_id, item_id, quantity, required_by)
    VALUES (p_organization_id, v_rfq.id, l.id, l.item_id, v_open, v_need);
    UPDATE public.purchase_requisitions SET status = 'SOURCING' WHERE id = l.requisition_id AND status = 'SUBMITTED';
  END LOOP;
  FOR v_sid IN SELECT DISTINCT jsonb_array_elements_text(p_payload->'supplier_ids') LOOP
    IF NOT EXISTS (SELECT 1 FROM public.supplier_profiles s WHERE s.organization_id = p_organization_id AND s.id = v_sid::uuid
                    AND s.status IN ('PROSPECT','HOMOLOGATED')) THEN
      RAISE EXCEPTION 'Supplier is suspended, blocked or not found: not invited.' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.procurement_rfq_suppliers (organization_id, rfq_id, supplier_id, invited_by)
    VALUES (p_organization_id, v_rfq.id, v_sid::uuid, p_actor);
  END LOOP;
  PERFORM public.emit_domain_event(p_organization_id, 'supply.rfq.created', 1, 'procurement_rfq', v_rfq.id,
    'rfq:' || v_rfq.id || ':created', jsonb_build_object('rfq_number', v_rfq.rfq_number), now(), 'human', p_actor);
  RETURN jsonb_build_object('rfq_id', v_rfq.id, 'rfq_number', v_rfq.rfq_number);
END $function$;

-- ---------------------------------------------------------------------------
-- 5) Decisão: trava as requisições ANTES da cotação; linha de requisição morta
--    ou sem aberto não vira pedido; nunca aloca 0. Corpo implantado (234),
--    mudanças marcadas "248".
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
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['procurement.source']);
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
-- 6) Emissão: trava as requisições; não emite pedido de requisição morta;
--    libera o não pedido; PEDIDA numa instrução própria. Corpo implantado
--    (234), mudanças marcadas "248".
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
-- 7) Cancelamento do pedido: reabre só o que falta, sob trava, e registra o
--    resto. Corpo implantado (237), mudanças marcadas "248".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purchase_order_cancel(p_organization_id uuid, p_actor uuid, p_po_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v public.purchase_orders%ROWTYPE; v_from text; v_req_status text; v_engine text; v_claims text; v_sub text;
        -- 248
        v_detail jsonb; v_reqns uuid[]; v_rids uuid[]; v_cand jsonb; v_reason text; r public.project_requirements%ROWTYPE;
        al record; rq record; ev record; v_pre numeric; v_own numeric; v_cap numeric; v_budget numeric; v_keep numeric;
        v_rel numeric; v_reopened numeric; v_released numeric; v_to text;
        v_requirements jsonb := '[]'::jsonb; v_requisitions jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['procurement.orders.issue']);
  IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Cancellation requires a reason.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v FROM public.purchase_orders WHERE organization_id = p_organization_id AND id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF v.status = 'CANCELLED' THEN
    -- 248: a repetição devolve o desfecho GRAVADO no histórico 'cancelled' (o mesmo que o ato devolveu); o
    -- cancelamento anterior à 248 não gravava desfecho — listas vazias.
    SELECT h.detail INTO v_detail FROM public.purchase_order_history h
     WHERE h.organization_id = p_organization_id AND h.purchase_order_id = v.id AND h.transition = 'cancelled'
     ORDER BY h.seq DESC LIMIT 1;
    RETURN jsonb_build_object('purchase_order_id', v.id, 'status', v.status, 'replayed', true,
      'approval_request_status', v_detail->>'approval_request_status',
      'requirements', COALESCE(v_detail->'requirements', '[]'::jsonb),
      'requisitions', COALESCE(v_detail->'requisitions', '[]'::jsonb));
  END IF;
  IF v.status IN ('PARTIALLY_RECEIVED','RECEIVED','CLOSED')
     OR EXISTS (SELECT 1 FROM public.purchase_order_lines WHERE purchase_order_id = v.id AND received_quantity > 0) THEN
    RAISE EXCEPTION 'Purchase order has receipts: it is closed, not cancelled.' USING ERRCODE = '23514';
  END IF;
  v_from := v.status;

  IF v.approval_request_id IS NOT NULL THEN
    SELECT status INTO v_req_status FROM public.approval_requests
     WHERE organization_id = p_organization_id AND id = v.approval_request_id FOR UPDATE;
    v_engine := v_req_status;
    IF v_req_status = 'PENDING' THEN
      -- O motor registra o autor pelo JWT: o de quem cancela, só durante esta chamada.
      v_claims := current_setting('request.jwt.claims', true);
      v_sub := current_setting('request.jwt.claim.sub', true);
      PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', p_actor, 'role', 'service_role')::text, true);
      PERFORM set_config('request.jwt.claim.sub', p_actor::text, true);
      PERFORM public.approval_request_cancel(v.approval_request_id,
        'Pedido de compra ' || v.order_number || ' cancelado: ' || btrim(p_reason));
      PERFORM set_config('request.jwt.claims', COALESCE(v_claims, ''), true);
      PERFORM set_config('request.jwt.claim.sub', COALESCE(v_sub, ''), true);
      v_engine := 'CANCELLED';
    END IF;
  END IF;

  v_reason := 'Pedido ' || v.order_number || ' cancelado: ' || btrim(p_reason);
  -- 248 (T): as requisições VIVAS com linha neste pedido. Requisição cancelada ou encerrada não reabre, não
  -- é contada e não consome o orçamento de ninguém.
  v_reqns := ARRAY(SELECT DISTINCT l.requisition_id FROM public.purchase_order_lines pl
                     JOIN public.purchase_requisition_lines l ON l.organization_id = pl.organization_id AND l.id = pl.requisition_line_id
                     JOIN public.purchase_requisitions q ON q.organization_id = l.organization_id AND q.id = l.requisition_id
                    WHERE pl.organization_id = p_organization_id AND pl.purchase_order_id = v.id
                      AND q.status IN ('SUBMITTED','SOURCING','ORDERED') ORDER BY 1);
  -- 248 (C): as alocações ABERTAS nas linhas de T que este cancelamento pode fazer contar como requisitadas —
  -- linha sem outro pedido emitido E (linha deste pedido OU requisição PEDIDA: legado incoerente).
  v_rids := ARRAY(SELECT DISTINCT o.requirement_id FROM public.purchase_requisition_open_allocations o
                    JOIN public.purchase_requisitions q ON q.organization_id = o.organization_id AND q.id = o.requisition_id
                   WHERE o.organization_id = p_organization_id AND o.requisition_id = ANY (v_reqns) AND o.open_qty > 0
                     AND NOT EXISTS (SELECT 1 FROM public.purchase_order_lines pl JOIN public.purchase_orders po
                                       ON po.organization_id = pl.organization_id AND po.id = pl.purchase_order_id
                                      WHERE pl.organization_id = o.organization_id AND pl.requisition_line_id = o.requisition_line_id
                                        AND po.id <> v.id AND po.status IN ('ISSUED','PARTIALLY_RECEIVED','RECEIVED','CLOSED'))
                     AND (EXISTS (SELECT 1 FROM public.purchase_order_lines pl
                                   WHERE pl.organization_id = o.organization_id AND pl.purchase_order_id = v.id
                                     AND pl.requisition_line_id = o.requisition_line_id)
                          OR q.status = 'ORDERED')
                   ORDER BY 1);
  -- 248: travas em ordem canônica. Requisitos FOR NO KEY UPDATE (uuid): serializa com quem muda o reclamado
  -- (requisição da falta, reserva, transferência e recebimento travam FOR UPDATE) sem esperar as travas de
  -- chave estrangeira que decisão e emissão tomam. Depois as requisições de T (uuid).
  PERFORM 1 FROM public.project_requirements WHERE organization_id = p_organization_id AND id = ANY (v_rids)
   ORDER BY id FOR NO KEY UPDATE;
  PERFORM 1 FROM public.purchase_requisitions WHERE organization_id = p_organization_id AND id = ANY (v_reqns)
   ORDER BY id FOR UPDATE;

  -- 248: sob as travas, retrato novo de C (só dos requisitos travados), com o que já conta hoje como requisitado
  -- (requisição em busca e linha sem pedido emitido: o pedido ainda não emitido).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('allocation_id', o.allocation_id, 'requisition_line_id', o.requisition_line_id,
           'requisition_id', o.requisition_id, 'requirement_id', o.requirement_id, 'open_qty', o.open_qty,
           'requested_at', q.requested_at,
           'counted', q.status IN ('SUBMITTED','SOURCING') AND NOT EXISTS (
              SELECT 1 FROM public.purchase_order_lines pl JOIN public.purchase_orders po
                ON po.organization_id = pl.organization_id AND po.id = pl.purchase_order_id
               WHERE pl.organization_id = o.organization_id AND pl.requisition_line_id = o.requisition_line_id
                 AND po.status IN ('ISSUED','PARTIALLY_RECEIVED','RECEIVED','CLOSED')))), '[]'::jsonb)
    INTO v_cand
    FROM public.purchase_requisition_open_allocations o
    JOIN public.purchase_requisitions q ON q.organization_id = o.organization_id AND q.id = o.requisition_id
   WHERE o.organization_id = p_organization_id AND o.requisition_id = ANY (v_reqns) AND o.requirement_id = ANY (v_rids)
     AND q.status IN ('SUBMITTED','SOURCING','ORDERED') AND o.open_qty > 0
     AND NOT EXISTS (SELECT 1 FROM public.purchase_order_lines pl JOIN public.purchase_orders po
                       ON po.organization_id = pl.organization_id AND po.id = pl.purchase_order_id
                      WHERE pl.organization_id = o.organization_id AND pl.requisition_line_id = o.requisition_line_id
                        AND po.id <> v.id AND po.status IN ('ISSUED','PARTIALLY_RECEIVED','RECEIVED','CLOSED'))
     AND (EXISTS (SELECT 1 FROM public.purchase_order_lines pl
                   WHERE pl.organization_id = o.organization_id AND pl.purchase_order_id = v.id
                     AND pl.requisition_line_id = o.requisition_line_id)
          OR q.status = 'ORDERED');

  -- 248: por requisito, em retratos novos e ANTES de o pedido mudar de estado (depois dele, as linhas deste
  -- pedido já contariam cheias e o próprio entraria duas vezes):
  --   antes      = reclamado (comprometido + requisitado)
  --   próprio    = o em pedido aberto deste pedido (se emitido) + o aberto de C que já conta como requisitado
  --   capacidade = required do requisito CONFIRMADO de material/serviço; 0 fora disso
  --   orçamento  = GREATEST(capacidade − (antes − próprio), 0)
  -- e, em C, pela requisição mais antiga (depois o uuid da alocação): mantém LEAST(aberto, orçamento que
  -- resta); o resto vai ao livro. Dado são termina ≤ required; dado já sobre-coberto, ≤ o de antes.
  FOR r IN SELECT pr.* FROM public.project_requirements pr
            WHERE pr.organization_id = p_organization_id
              AND pr.id IN (SELECT (c->>'requirement_id')::uuid FROM jsonb_array_elements(v_cand) c)
            ORDER BY pr.id LOOP
    v_pre := public.supply_requirement_claimed(p_organization_id, r.id);
    v_own := CASE WHEN v_from IN ('ISSUED','PARTIALLY_RECEIVED') THEN
               (SELECT COALESCE(sum(a.quantity - a.received_quantity), 0) FROM public.purchase_order_line_requirements a
                  JOIN public.purchase_order_lines pl ON pl.organization_id = a.organization_id AND pl.id = a.line_id
                 WHERE pl.organization_id = p_organization_id AND pl.purchase_order_id = v.id AND a.requirement_id = r.id)
             ELSE 0 END
           + (SELECT COALESCE(sum((c->>'open_qty')::numeric), 0) FROM jsonb_array_elements(v_cand) c
               WHERE (c->>'requirement_id')::uuid = r.id AND (c->>'counted')::boolean);
    v_cap := CASE WHEN r.status = 'CONFIRMED' AND r.requirement_type IN ('MATERIAL','EXTERNAL_SERVICE') THEN r.quantity ELSE 0 END;
    v_budget := GREATEST(v_cap - (v_pre - v_own), 0);
    v_reopened := 0; v_released := 0;
    FOR al IN SELECT * FROM jsonb_to_recordset(v_cand) AS c(allocation_id uuid, requisition_line_id uuid, requisition_id uuid,
                 requirement_id uuid, open_qty numeric, requested_at timestamptz, counted boolean)
               WHERE c.requirement_id = r.id ORDER BY c.requested_at, c.allocation_id LOOP
      v_keep := LEAST(al.open_qty, v_budget);
      v_budget := v_budget - v_keep;
      v_rel := al.open_qty - v_keep;
      IF v_rel > 0 THEN
        INSERT INTO public.procurement_requisition_releases (organization_id, requisition_id, requisition_line_id, allocation_id,
          requirement_id, purchase_order_id, stage, quantity, cause, reason)
        VALUES (p_organization_id, al.requisition_id, al.requisition_line_id, al.allocation_id, r.id, v.id, 'PO_CANCELLED', v_rel,
          CASE WHEN v_cap = 0 THEN 'REQUIREMENT_INACTIVE' ELSE 'COVERED' END, v_reason);
      END IF;
      -- Reaberto = o que passa a contar como requisitado por causa deste cancelamento (o que já contava: 0).
      v_reopened := v_reopened + CASE WHEN al.counted THEN 0 ELSE v_keep END;
      v_released := v_released + v_rel;
    END LOOP;
    v_requirements := v_requirements || jsonb_build_array(jsonb_build_object('requirement_id', r.id, 'item_id', r.item_id,
      'unit', r.unit, 'reopened_qty', v_reopened, 'released_qty', v_released,
      'cause', CASE WHEN v_released > 0 THEN CASE WHEN v_cap = 0 THEN 'REQUIREMENT_INACTIVE' ELSE 'COVERED' END END));
  END LOOP;

  UPDATE public.purchase_orders SET status = 'CANCELLED', closed_at = now(), close_reason = btrim(p_reason) WHERE id = v.id RETURNING * INTO v;
  -- 248: a requisição fica no estado que as linhas dizem (antes: SUBMITTED às cegas). Aberto = aberto > 0;
  -- emitida = pedido ISSUED/PARTIALLY_RECEIVED/RECEIVED/CLOSED; cotação viva como em procurement_rfq_create.
  --   ENCERRADA  toda linha sem aberto (grava closed_at e close_reason)
  --   PEDIDA     toda linha aberta tem pedido emitido
  --   EM COTAÇÃO alguma linha aberta está numa cotação viva
  --   AGUARDANDO nos demais casos
  FOR rq IN SELECT q.id, q.requisition_number, q.status FROM public.purchase_requisitions q
             WHERE q.organization_id = p_organization_id AND q.id = ANY (v_reqns) AND q.status IN ('SUBMITTED','SOURCING','ORDERED')
             ORDER BY q.id LOOP
    SELECT CASE WHEN bool_and(x.open_qty <= 0) THEN 'CLOSED'
                WHEN bool_and(x.open_qty <= 0 OR x.issued) THEN 'ORDERED'
                WHEN bool_or(x.open_qty > 0 AND x.live_rfq) THEN 'SOURCING'
                ELSE 'SUBMITTED' END
      INTO v_to
      FROM (SELECT COALESCE((SELECT sum(o.open_qty) FROM public.purchase_requisition_open_allocations o
                              WHERE o.organization_id = l.organization_id AND o.requisition_line_id = l.id), l.quantity) AS open_qty,
                   EXISTS (SELECT 1 FROM public.purchase_order_lines pl JOIN public.purchase_orders po
                             ON po.organization_id = pl.organization_id AND po.id = pl.purchase_order_id
                            WHERE pl.organization_id = l.organization_id AND pl.requisition_line_id = l.id
                              AND po.status IN ('ISSUED','PARTIALLY_RECEIVED','RECEIVED','CLOSED')) AS issued,
                   EXISTS (SELECT 1 FROM public.procurement_rfq_lines x JOIN public.procurement_rfqs f
                             ON f.organization_id = x.organization_id AND f.id = x.rfq_id
                            WHERE x.organization_id = l.organization_id AND x.requisition_line_id = l.id
                              AND (f.status = 'OPEN'
                                   OR (f.status = 'DECIDED' AND EXISTS (
                                         SELECT 1 FROM public.sourcing_decisions d
                                           JOIN public.purchase_orders po ON po.organization_id = d.organization_id AND po.sourcing_decision_id = d.id
                                           JOIN public.purchase_order_lines pl ON pl.organization_id = po.organization_id AND pl.purchase_order_id = po.id
                                          WHERE d.organization_id = f.organization_id AND d.rfq_id = f.id
                                            AND pl.requisition_line_id = l.id AND po.status <> 'CANCELLED')))) AS live_rfq
              FROM public.purchase_requisition_lines l
             WHERE l.organization_id = p_organization_id AND l.requisition_id = rq.id) x;
    IF v_to IS DISTINCT FROM rq.status THEN
      UPDATE public.purchase_requisitions SET status = v_to,
        closed_at = CASE WHEN v_to = 'CLOSED' THEN now() ELSE closed_at END,
        close_reason = CASE WHEN v_to = 'CLOSED' THEN v_reason ELSE close_reason END
       WHERE id = rq.id;
    END IF;
    v_requisitions := v_requisitions || jsonb_build_array(jsonb_build_object('requisition_id', rq.id,
      'requisition_number', rq.requisition_number, 'status_from', rq.status, 'status_to', v_to));
  END LOOP;
  UPDATE public.procurement_rfqs q SET status = 'CANCELLED', close_reason = 'Pedido ' || v.order_number || ' cancelado: ' || btrim(p_reason)
   WHERE q.id = (SELECT rfq_id FROM public.sourcing_decisions WHERE id = v.sourcing_decision_id);
  -- 248: transição segue 'cancelled'; as chaves da 237 ficam e o desfecho (requisitos e requisições) é somado
  -- a elas — é dele que a repetição responde.
  PERFORM public.purchase_order_log(v, 'cancelled', v_from, p_reason,
    CASE WHEN v.approval_request_id IS NULL THEN '{}'::jsonb
         ELSE jsonb_build_object('approval_request_id', v.approval_request_id, 'approval_request_status_at_cancel', v_req_status,
                                 'approval_request_status', v_engine) END
    || jsonb_build_object('requirements', v_requirements, 'requisitions', v_requisitions), p_actor);
  -- 248: o fato da liberação, por (requisição, projeto) tocados — requisição de vários projetos tem project_id
  -- NULL, e a linha do tempo do projeto filtra por ele. A chave carrega pedido, estágio e projeto.
  FOR ev IN
    SELECT x.requisition_id, q.requisition_number, q.status AS status_to, x.project_id,
           jsonb_agg(jsonb_build_object('requirement_id', x.requirement_id, 'item_id', x.item_id, 'unit', x.unit,
             'released_qty', x.qty, 'cause', x.cause) ORDER BY x.requirement_id) AS requirements
      FROM (SELECT z.requisition_id, z.requirement_id, pr.item_id, pr.unit, pr.project_id, z.cause, sum(z.quantity) AS qty
              FROM public.procurement_requisition_releases z
              JOIN public.project_requirements pr ON pr.organization_id = z.organization_id AND pr.id = z.requirement_id
             WHERE z.organization_id = p_organization_id AND z.purchase_order_id = v.id AND z.stage = 'PO_CANCELLED'
             GROUP BY z.requisition_id, z.requirement_id, pr.item_id, pr.unit, pr.project_id, z.cause) x
      JOIN public.purchase_requisitions q ON q.organization_id = p_organization_id AND q.id = x.requisition_id
     GROUP BY x.requisition_id, q.requisition_number, q.status, x.project_id
     ORDER BY x.requisition_id, x.project_id
  LOOP
    PERFORM public.emit_domain_event(p_organization_id, 'supply.requisition.released', 1, 'purchase_requisition', ev.requisition_id,
      'requisition:' || ev.requisition_id || ':released:' || v.id || ':PO_CANCELLED:' || ev.project_id,
      jsonb_build_object('project_id', ev.project_id, 'requisition_number', ev.requisition_number, 'purchase_order_id', v.id,
        'order_number', v.order_number, 'stage', 'PO_CANCELLED', 'status_to', ev.status_to, 'requirements', ev.requirements,
        'reason', btrim(p_reason)), now(), 'human', p_actor);
  END LOOP;
  RETURN jsonb_build_object('purchase_order_id', v.id, 'status', v.status, 'replayed', false,
    'approval_request_status', v_engine, 'requirements', v_requirements, 'requisitions', v_requisitions);
END $function$;

-- ---------------------------------------------------------------------------
-- 8) Cancelamento de requisição: ENCERRADA não se cancela; cotação aberta que
--    ficou só com requisições mortas é cancelada. Corpo implantado (234),
--    mudanças marcadas "248".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purchase_requisition_cancel(p_organization_id uuid, p_actor uuid, p_requisition_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v public.purchase_requisitions%ROWTYPE;
        -- 248
        v_rfqs jsonb;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['procurement.request','procurement.source']);
  IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Cancellation requires a reason.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v FROM public.purchase_requisitions WHERE organization_id = p_organization_id AND id = p_requisition_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Requisition not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF v.status = 'CANCELLED' THEN RETURN jsonb_build_object('requisition_id', v.id, 'status', v.status, 'replayed', true); END IF;
  -- 248: encerrada (tudo liberado) não tem o que cancelar — e cancelar apagaria o registro do encerramento.
  IF v.status = 'CLOSED' THEN RAISE EXCEPTION 'Requisition is CLOSED: nothing to cancel.' USING ERRCODE = '23514'; END IF;
  IF EXISTS (SELECT 1 FROM public.purchase_order_lines pl JOIN public.purchase_requisition_lines l ON l.id = pl.requisition_line_id
              JOIN public.purchase_orders po ON po.id = pl.purchase_order_id
             WHERE l.requisition_id = v.id AND po.status <> 'CANCELLED') THEN
    RAISE EXCEPTION 'Requisition already has a purchase order: cancel the order first.' USING ERRCODE = '23514';
  END IF;
  UPDATE public.purchase_requisitions SET status = 'CANCELLED', closed_at = now(), close_reason = btrim(p_reason) WHERE id = v.id;
  -- 248: sob a trava da requisição (requisição → cotação, a ordem da decisão): a cotação ABERTA desta
  -- requisição em que só restaram linhas de requisições mortas é cancelada — não vira pedido e não fica
  -- aberta para sempre (e-mail a fornecedor, proposta nova, "pronta para decidir").
  WITH dead AS (
    UPDATE public.procurement_rfqs q SET status = 'CANCELLED', close_reason = 'Solicitação ' || v.requisition_number || ' cancelada'
     WHERE q.organization_id = p_organization_id AND q.status = 'OPEN'
       AND EXISTS (SELECT 1 FROM public.procurement_rfq_lines x
                     JOIN public.purchase_requisition_lines l ON l.organization_id = x.organization_id AND l.id = x.requisition_line_id
                    WHERE x.organization_id = q.organization_id AND x.rfq_id = q.id AND l.requisition_id = v.id)
       AND NOT EXISTS (SELECT 1 FROM public.procurement_rfq_lines x
                         JOIN public.purchase_requisition_lines l ON l.organization_id = x.organization_id AND l.id = x.requisition_line_id
                         JOIN public.purchase_requisitions r ON r.organization_id = l.organization_id AND r.id = l.requisition_id
                        WHERE x.organization_id = q.organization_id AND x.rfq_id = q.id AND r.status IN ('SUBMITTED','SOURCING'))
    RETURNING q.id, q.rfq_number)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('rfq_id', dead.id, 'rfq_number', dead.rfq_number) ORDER BY dead.rfq_number), '[]'::jsonb)
    INTO v_rfqs FROM dead;
  PERFORM public.emit_domain_event(p_organization_id, 'supply.requisition.cancelled', 1, 'purchase_requisition', v.id,
    'requisition:' || v.id || ':cancelled', jsonb_build_object('project_id', v.project_id, 'reason', btrim(p_reason)), now(), 'human', p_actor);
  RETURN jsonb_build_object('requisition_id', v.id, 'status', 'CANCELLED', 'replayed', false, 'rfqs_cancelled', v_rfqs);
END $function$;

-- ---------------------------------------------------------------------------
-- 9) Privilégios: as reescritas continuam só do servidor
-- ---------------------------------------------------------------------------
DO $$
DECLARE sig text;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'procurement_requested_open(uuid,uuid)', 'procurement_rfq_create(uuid,uuid,jsonb)', 'procurement_decide(uuid,uuid,jsonb)',
    'purchase_order_issue(uuid,uuid,uuid)', 'purchase_order_cancel(uuid,uuid,uuid,text)',
    'purchase_requisition_cancel(uuid,uuid,uuid,text)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', sig);
  END LOOP;
END $$;

COMMIT;
