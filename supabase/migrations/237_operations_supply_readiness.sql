-- ============================================================================
-- 237 — OPERAÇÕES + SUPPLY: FECHAMENTO DE PRONTIDÃO PARA PRODUÇÃO
--
-- Nenhum domínio é redesenhado. OS, requisito, cobertura derivada, livro de
-- estoque, reservas, compras, motor de aprovação, recebimento e sinais da Apex
-- continuam exatamente como as 230–236 os provaram. Esta migration fecha as
-- lacunas que a auditoria de prontidão encontrou nelas:
--
--   1. Papéis que faltavam para a segregação real de funções: Compras e
--      Almoxarifado (hoje só o owner_admin exercia os dois lados).
--   2. Recheque de permissão NO BANCO nas escritas de Operações (230/231/232/
--      236). Supply já rechecava; Operações confiava só na rota — e a rota
--      tinha um furo (sobreposição "deny" ignorada em checagens opcionais).
--      O ator também precisa ter vínculo ATIVO com a organização.
--   3. Ciclo de aprovação do pedido de compra:
--        • cada SUBMISSÃO abre um pedido de aprovação próprio (antes, a
--          ressubmissão de um pedido inalterado se religava ao pedido já
--          rejeitado e entrava em laço);
--        • cancelar o pedido de compra com aprovação PENDENTE cancela o pedido
--          no motor, em nome de quem cancelou — nenhuma decisão órfã;
--        • desfechos devolvido/expirado/cancelado ganham rota, e toda rota de
--          compras só liga quando um trabalhador CAPAZ de executá-la roda
--          (compatível com os trabalhadores já implantados, que mandariam o
--          trabalho desconhecido para a carta morta);
--        • reconciliação periódica aplica desfechos que nenhum evento aplicou.
--   4. Agendamento da leitura da Apex (supply.intelligence.sweep) pelo relógio
--      que já existe (apex_jobs + drain).
--   5. Quarentena: estoque em inspeção só sai pela inspeção.
--   6. Evidência de recebimento presa à pasta do inquilino; o navegador não
--      planta nem apaga arquivo na pasta de recebimentos.
--   7. Alçada de compra honra a CATEGORIA declarada; ninguém declara alçada
--      para um papel que exerce.
--   8. Item em uso não muda código, unidade nem rastreio (o uso agora inclui
--      livro, reservas e compras, não só requisitos).
--   9. ON DELETE RESTRICT (230–232) → NO ACTION: a mesma proteção contra
--      apagamento isolado, sem abortar a cascata privilegiada de inquilino —
--      o defeito que a 207 já tinha corrigido e a 230 reintroduziu.
--  10. Visões sem privilégio de escrita residual; função vazada revogada;
--      índices dos caminhos quentes.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Papéis de sistema: Compras e Almoxarifado
-- ---------------------------------------------------------------------------
INSERT INTO public.roles (organization_id, key, name, description, is_system_role)
SELECT NULL, v.key, v.name, v.description, true
  FROM (VALUES
    ('compras', 'Compras / Suprimentos',
     'Requisita, cota, decide fornecedor e emite pedidos de compra. Não aprova o gasto (segregação de funções).'),
    ('almoxarifado', 'Almoxarifado / Recebimento',
     'Recebe, inspeciona, movimenta, reserva e entrega material à obra. Não compra nem aprova.')
  ) AS v(key, name, description)
 WHERE NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.organization_id IS NULL AND r.key = v.key);

DO $$
DECLARE
  grants jsonb := jsonb_build_object(
    'compras', jsonb_build_array('projects.view', 'operations.view', 'operations.planning.view', 'supply.view',
      'inventory.view', 'procurement.view', 'procurement.request', 'procurement.source', 'procurement.orders.issue',
      'receiving.view', 'suppliers.view', 'suppliers.manage'),
    'almoxarifado', jsonb_build_array('projects.view', 'operations.view', 'supply.view', 'inventory.view',
      'inventory.manage', 'inventory.reserve', 'procurement.view', 'receiving.view', 'receiving.receive', 'suppliers.view'));
  k text; p text; v_role uuid; v_perm uuid;
BEGIN
  FOR k IN SELECT jsonb_object_keys(grants) LOOP
    SELECT id INTO v_role FROM public.roles WHERE organization_id IS NULL AND key = k;
    FOR p IN SELECT jsonb_array_elements_text(grants->k) LOOP
      SELECT id INTO v_perm FROM public.permissions WHERE key = p;
      IF v_perm IS NULL THEN RAISE EXCEPTION '[237] permissão % ausente do vocabulário', p; END IF;
      INSERT INTO public.role_permissions (role_id, permission_id)
      SELECT v_role, v_perm WHERE NOT EXISTS (
        SELECT 1 FROM public.role_permissions WHERE role_id = v_role AND permission_id = v_perm);
    END LOOP;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Autoridade no banco
-- ---------------------------------------------------------------------------
/*
  O ator nomeado precisa ter vínculo ATIVO com uma organização ATIVA. Até aqui
  bastava ter o papel: um membro suspenso cujo `user_roles` ficou para trás
  ainda passava no recheque das escritas governadas.
*/
CREATE OR REPLACE FUNCTION public.apex_actor_has_permission(
  p_organization_id uuid, p_actor uuid, p_key text
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH perm AS (SELECT id FROM public.permissions WHERE key = p_key),
  ov AS (
    SELECT upo.effect FROM public.user_permission_overrides upo, perm
     WHERE upo.user_id = p_actor AND upo.organization_id = p_organization_id
       AND upo.permission_id = perm.id
     LIMIT 1),
  member AS (
    SELECT 1 FROM public.organization_memberships m
      JOIN public.organizations o ON o.id = m.organization_id
     WHERE m.user_id = p_actor AND m.organization_id = p_organization_id
       AND m.status = 'ACTIVE' AND o.status = 'active')
  SELECT CASE
    WHEN p_actor IS NULL OR p_organization_id IS NULL THEN false
    WHEN NOT EXISTS (SELECT 1 FROM member) THEN false
    WHEN (SELECT effect FROM ov) = 'deny'  THEN false
    WHEN (SELECT effect FROM ov) = 'grant' THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.user_roles ur
        JOIN public.role_permissions rp ON rp.role_id = ur.role_id
        JOIN public.permissions p ON p.id = rp.permission_id
       WHERE ur.user_id = p_actor AND ur.organization_id = p_organization_id AND p.key = p_key)
  END
$$;
REVOKE ALL ON FUNCTION public.apex_actor_has_permission(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apex_actor_has_permission(uuid,uuid,text) TO service_role;

/*
  O recheque das escritas de Operações. Mesma semântica do `inventory_require`
  (basta UMA das chaves), com a mensagem do domínio certo.
*/
CREATE OR REPLACE FUNCTION public.operations_require(p_organization_id uuid, p_actor uuid, p_keys text[])
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE k text;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Operations write requires a named actor.' USING ERRCODE = '42501';
  END IF;
  FOREACH k IN ARRAY p_keys LOOP
    IF public.apex_actor_has_permission(p_organization_id, p_actor, k) THEN RETURN; END IF;
  END LOOP;
  RAISE EXCEPTION 'Actor lacks permission (%).', array_to_string(p_keys, ' or ') USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION public.operations_require(uuid,uuid,text[]) FROM PUBLIC, anon, authenticated;

/*
  Quarentena: o que está "em inspeção" só sai pela decisão de inspeção
  (goods_receipt_inspect marca a transação com `apex.inspection_release`), e
  nada entra nela por transferência, ajuste, contagem ou devolução — senão a
  inspeção encontra no local algo que o recebimento não pôs lá, ou deixa de
  encontrar o que pôs.
*/
CREATE OR REPLACE FUNCTION public.inventory_assert_outside_quarantine(
  p_organization_id uuid, p_location_id uuid, p_inspection_may_release boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_inspection_may_release AND COALESCE(current_setting('apex.inspection_release', true), '') <> '' THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_locations
              WHERE organization_id = p_organization_id AND id = p_location_id AND kind = 'QUARANTINE') THEN
    RAISE EXCEPTION 'Inventory in quarantine only moves through goods receipt inspection.' USING ERRCODE = '23514';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.inventory_assert_outside_quarantine(uuid,uuid,boolean) FROM PUBLIC, anon, authenticated;

-- Cadastro de item: a chave da rota conferida no banco; em uso = requisito, livro, reserva ou compra.
CREATE OR REPLACE FUNCTION public.supply_item_upsert(p_organization_id uuid, p_actor uuid, p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid; v_item public.supply_items%ROWTYPE; v_in_use boolean;
BEGIN
  PERFORM public.operations_require(p_organization_id, p_actor, ARRAY['supply.plan']);
  v_id := nullif(p_payload->>'id','')::uuid;
  IF v_id IS NULL THEN
    INSERT INTO public.supply_items (organization_id, code, description, category, unit, manufacturer, brand,
      technical_attributes, tracking, specification_document_id, created_by)
    VALUES (p_organization_id, upper(btrim(p_payload->>'code')), btrim(p_payload->>'description'),
      nullif(btrim(p_payload->>'category'),''), btrim(p_payload->>'unit'), nullif(btrim(p_payload->>'manufacturer'),''),
      nullif(btrim(p_payload->>'brand'),''), COALESCE(p_payload->'technical_attributes', '{}'::jsonb),
      COALESCE(nullif(p_payload->>'tracking',''), 'NONE'), nullif(p_payload->>'specification_document_id','')::uuid, p_actor)
    RETURNING * INTO v_item;
    RETURN jsonb_build_object('item_id', v_item.id, 'created', true);
  END IF;

  SELECT * INTO v_item FROM public.supply_items WHERE organization_id = p_organization_id AND id = v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  -- Código, unidade e rastreio de item EM USO não mudam: mudariam o significado de toda
  -- quantidade já planejada, reservada, comprada ou movimentada.
  v_in_use := EXISTS (SELECT 1 FROM public.project_requirements r WHERE r.organization_id = p_organization_id AND r.item_id = v_id)
           OR EXISTS (SELECT 1 FROM public.inventory_movements m WHERE m.organization_id = p_organization_id AND m.item_id = v_id)
           OR EXISTS (SELECT 1 FROM public.inventory_reservations x WHERE x.organization_id = p_organization_id AND x.item_id = v_id)
           OR EXISTS (SELECT 1 FROM public.purchase_requisition_lines l WHERE l.organization_id = p_organization_id AND l.item_id = v_id)
           OR EXISTS (SELECT 1 FROM public.purchase_order_lines l WHERE l.organization_id = p_organization_id AND l.item_id = v_id);
  IF v_in_use AND ((p_payload ? 'unit' AND btrim(p_payload->>'unit') <> v_item.unit)
                   OR (p_payload ? 'code' AND upper(btrim(p_payload->>'code')) <> v_item.code)
                   OR (nullif(p_payload->>'tracking','') IS NOT NULL AND p_payload->>'tracking' <> v_item.tracking)) THEN
    RAISE EXCEPTION 'Item is in use: its code, unit and tracking do not change.' USING ERRCODE = '23514';
  END IF;
  UPDATE public.supply_items SET
    code = CASE WHEN p_payload ? 'code' THEN upper(btrim(p_payload->>'code')) ELSE code END,
    description = COALESCE(nullif(btrim(p_payload->>'description'),''), description),
    category = CASE WHEN p_payload ? 'category' THEN nullif(btrim(p_payload->>'category'),'') ELSE category END,
    unit = CASE WHEN p_payload ? 'unit' THEN btrim(p_payload->>'unit') ELSE unit END,
    manufacturer = CASE WHEN p_payload ? 'manufacturer' THEN nullif(btrim(p_payload->>'manufacturer'),'') ELSE manufacturer END,
    brand = CASE WHEN p_payload ? 'brand' THEN nullif(btrim(p_payload->>'brand'),'') ELSE brand END,
    technical_attributes = COALESCE(p_payload->'technical_attributes', technical_attributes),
    tracking = COALESCE(nullif(p_payload->>'tracking',''), tracking),
    active = COALESCE((p_payload->>'active')::boolean, active)
  WHERE organization_id = p_organization_id AND id = v_id;
  RETURN jsonb_build_object('item_id', v_id, 'created', false);
END $function$;

-- ---------------------------------------------------------------------------
-- 3) Ciclo de aprovação do pedido de compra
-- ---------------------------------------------------------------------------
/*
  Cada SUBMISSÃO é um pedido de aprovação próprio: a chave carrega o número da
  submissão. Antes, id + impressão digital: um pedido rejeitado e ressubmetido
  SEM mudança tinha a mesma chave, o motor devolvia o pedido de aprovação já
  REJEITADO como "existente", e a sincronização mandava o pedido de volta ao
  rascunho — para sempre.

  Duplo clique continua idempotente: a segunda chamada encontra o pedido já em
  APPROVAL_REQUIRED (sob a trava da linha) e responde "replayed".

  E o motor passa a saber QUEM pediu. Chamado pelo servidor, `auth.uid()` era
  nulo: o pedido de aprovação nascia sem solicitante, e a regra de segregação
  do motor ("quem pede não decide") não tinha a quem excluir — alguém com
  Compras e Financeiro aprovaria o próprio pedido. A identidade de quem submete
  vale só durante a chamada ao motor.
*/
CREATE OR REPLACE FUNCTION public.purchase_order_submit(p_organization_id uuid, p_actor uuid, p_po_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.purchase_orders%ROWTYPE; appr jsonb; fp text; v_gov text; v_attempt int; v_claims text; v_sub text;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['procurement.source','procurement.orders.issue']);
  SELECT * INTO v FROM public.purchase_orders WHERE organization_id = p_organization_id AND id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF v.status = 'APPROVAL_REQUIRED' THEN
    RETURN jsonb_build_object('purchase_order_id', v.id, 'status', v.status, 'governance', v.approval_governance, 'replayed', true);
  END IF;
  IF v.status <> 'DRAFT' THEN RAISE EXCEPTION 'Purchase order is %: only a draft is submitted.', v.status USING ERRCODE = '23514'; END IF;
  IF v.delivery_location_id IS NULL THEN
    RAISE EXCEPTION 'Purchase order needs a delivery location before approval.' USING ERRCODE = '23514';
  END IF;
  fp := public.purchase_order_fingerprint(v.id);
  SELECT count(*)::int + 1 INTO v_attempt FROM public.purchase_order_history
   WHERE organization_id = p_organization_id AND purchase_order_id = v.id AND transition = 'submitted';
  v_claims := current_setting('request.jwt.claims', true);
  v_sub := current_setting('request.jwt.claim.sub', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', p_actor, 'role', 'service_role')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_actor::text, true);
  appr := public.approval_request_create(p_organization_id, 'purchase_order', v.id, 'approve', 'APPROVAL', p_note,
    jsonb_build_object('order_number', v.order_number, 'total', public.purchase_order_total(v.id), 'currency', v.currency,
      'submitted_by', p_actor, 'submission', v_attempt),
    'purchase-order-approval:' || v.id || ':' || fp || ':' || v_attempt, NULL, NULL, NULL);
  PERFORM set_config('request.jwt.claims', COALESCE(v_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_sub, ''), true);
  IF appr->>'status' = 'EXISTING' AND COALESCE(appr->>'request_status', 'PENDING') <> 'PENDING' THEN
    RAISE EXCEPTION 'Approval engine answered with a finished request (%) for a new submission.', appr->>'request_status'
      USING ERRCODE = '23514';
  END IF;
  v_gov := CASE WHEN (appr->>'status') IN ('NO_POLICY','SUBJECT_TYPE_UNSUPPORTED') THEN 'AUTHORITY' ELSE 'POLICY' END;
  UPDATE public.purchase_orders SET status = 'APPROVAL_REQUIRED', approval_governance = v_gov,
    approval_request_id = CASE WHEN v_gov = 'POLICY' THEN nullif(appr->>'request_id','')::uuid END,
    submitted_by = p_actor, submitted_at = now()
  WHERE id = v.id RETURNING * INTO v;
  PERFORM public.purchase_order_log(v, 'submitted', 'DRAFT', p_note,
    jsonb_build_object('governance', v_gov, 'approval', appr, 'fingerprint', fp, 'submission', v_attempt), p_actor);
  RETURN jsonb_build_object('purchase_order_id', v.id, 'status', v.status, 'governance', v_gov, 'approval', appr, 'replayed', false);
END $$;

/*
  Cancelar o pedido de compra com aprovação PENDENTE no motor cancela também o
  pedido de aprovação — em nome de quem cancelou, pela função canônica do motor
  (`approval_request_cancel`), que registra o desfecho e emite o fato. Se o
  motor já tinha decidido, o histórico do pedido registra qual era o desfecho
  no momento do cancelamento: nenhuma decisão fica sem destino explicado.
*/
CREATE OR REPLACE FUNCTION public.purchase_order_cancel(p_organization_id uuid, p_actor uuid, p_po_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.purchase_orders%ROWTYPE; v_from text; v_req_status text; v_engine text; v_claims text; v_sub text;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['procurement.orders.issue']);
  IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Cancellation requires a reason.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v FROM public.purchase_orders WHERE organization_id = p_organization_id AND id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF v.status = 'CANCELLED' THEN RETURN jsonb_build_object('purchase_order_id', v.id, 'status', v.status, 'replayed', true); END IF;
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

  UPDATE public.purchase_orders SET status = 'CANCELLED', closed_at = now(), close_reason = btrim(p_reason) WHERE id = v.id RETURNING * INTO v;
  -- Requisição volta a esperar compra (a falta reaparece como "requisitado").
  UPDATE public.purchase_requisitions r SET status = 'SUBMITTED'
   WHERE r.organization_id = p_organization_id AND r.status IN ('ORDERED','SOURCING')
     AND r.id IN (SELECT l.requisition_id FROM public.purchase_requisition_lines l
                   JOIN public.purchase_order_lines pl ON pl.requisition_line_id = l.id WHERE pl.purchase_order_id = v.id);
  UPDATE public.procurement_rfqs q SET status = 'CANCELLED', close_reason = 'Pedido ' || v.order_number || ' cancelado: ' || btrim(p_reason)
   WHERE q.id = (SELECT rfq_id FROM public.sourcing_decisions WHERE id = v.sourcing_decision_id);
  PERFORM public.purchase_order_log(v, 'cancelled', v_from, p_reason,
    CASE WHEN v.approval_request_id IS NULL THEN '{}'::jsonb
         ELSE jsonb_build_object('approval_request_id', v.approval_request_id, 'approval_request_status_at_cancel', v_req_status,
                                 'approval_request_status', v_engine) END, p_actor);
  RETURN jsonb_build_object('purchase_order_id', v.id, 'status', v.status, 'replayed', false,
    'approval_request_status', v_engine);
END $$;

/*
  Alçada para ESTE pedido: além de moeda, teto, projeto e vigência, a
  CATEGORIA declarada — uma alçada de "Cabos" não aprova "Obras civis". A
  função antiga (`procurement_authority_for`) continua existindo para quem só
  tem valor e projeto; a decisão de pedido passa a usar esta.
*/
CREATE OR REPLACE FUNCTION public.procurement_authority_for_order(p_organization_id uuid, p_actor uuid, p_po_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH po AS (
    SELECT id, currency, project_id, public.purchase_order_total(id) AS total
      FROM public.purchase_orders WHERE organization_id = p_organization_id AND id = p_po_id),
  cats AS (
    SELECT DISTINCT i.category FROM public.purchase_order_lines l
      JOIN public.supply_items i ON i.organization_id = l.organization_id AND i.id = l.item_id
     WHERE l.organization_id = p_organization_id AND l.purchase_order_id = p_po_id)
  SELECT a.id FROM public.procurement_approval_authorities a, po
   WHERE a.organization_id = p_organization_id AND a.active
     AND a.effective_from <= current_date AND (a.effective_until IS NULL OR a.effective_until >= current_date)
     AND a.currency = po.currency
     AND (a.max_amount IS NULL OR po.total <= a.max_amount)
     AND (a.project_id IS NULL OR a.project_id = po.project_id)
     AND (a.category IS NULL OR NOT EXISTS (SELECT 1 FROM cats WHERE cats.category IS DISTINCT FROM a.category))
     AND ((a.grantee_kind = 'USER' AND a.grantee_user_id = p_actor)
          OR (a.grantee_kind = 'ROLE' AND EXISTS (SELECT 1 FROM public.user_roles ur
                WHERE ur.user_id = p_actor AND ur.organization_id = p_organization_id AND ur.role_id = a.grantee_role_id)))
   ORDER BY a.max_amount NULLS LAST, a.created_at LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.procurement_authority_for_order(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.procurement_authority_for_order(uuid,uuid,uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Recheque de permissão NO BANCO nas escritas de Operações (230/231/236)
--    Mesma chave que a rota exige. Corpo idêntico ao implantado; só a 1ª linha é nova.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.internal_service_order_generate_from_package(p_organization_id uuid, p_actor uuid, p_acceptance_id uuid, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  a public.commercial_proposal_context_acceptances%ROWTYPE;
  v_existing public.internal_service_orders%ROWTYPE;
  v_os public.internal_service_orders%ROWTYPE;
  v_rev_id uuid; v_eng uuid; v_value_rev uuid; v_number text; v_seq int;
  v_created jsonb; v_items int; v_title text; v_stale text;
BEGIN
  PERFORM public.operations_require(p_organization_id, p_actor, ARRAY['commercial.service_orders.manage']);
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Service order creation denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Service order creation requires a named actor.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO a FROM public.commercial_proposal_context_acceptances
   WHERE organization_id = p_organization_id AND id = p_acceptance_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pacote: aceite não encontrado no inquilino.' USING ERRCODE = 'P0002'; END IF;
  IF NOT a.complete THEN
    RAISE EXCEPTION 'Pacote: o aceite não cobre todos os documentos do contexto.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_existing FROM public.internal_service_orders
   WHERE organization_id = p_organization_id AND source_context_acceptance_id = p_acceptance_id
     AND status <> 'CANCELLED';
  IF FOUND THEN
    RETURN jsonb_build_object('service_order_id', v_existing.id, 'status', v_existing.status,
                              'reused', true, 'items_added', 0);
  END IF;

  -- O aceite ainda é o REGENTE: cada revisão continua aceita e nenhuma
  -- revisão posterior do mesmo documento foi aceita depois.
  FOREACH v_rev_id IN ARRAY ARRAY[a.technical_revision_id, a.commercial_revision_id, a.combined_revision_id] LOOP
    CONTINUE WHEN v_rev_id IS NULL;
    SELECT p.proposal_number INTO v_stale
      FROM public.commercial_proposal_revisions o
      JOIN public.commercial_proposals p ON p.organization_id = o.organization_id AND p.id = o.proposal_id
     WHERE o.organization_id = p_organization_id AND o.id = v_rev_id
       AND (o.status <> 'ACCEPTED' OR EXISTS (
             SELECT 1 FROM public.commercial_proposal_revisions n
              WHERE n.organization_id = o.organization_id AND n.proposal_id = o.proposal_id
                AND n.revision > o.revision AND n.status = 'ACCEPTED'));
    IF v_stale IS NOT NULL THEN
      RAISE EXCEPTION 'Pacote: % não está mais na revisão aceita deste pacote.', v_stale USING ERRCODE = '23514';
    END IF;
  END LOOP;

  -- A revisão que rege VALOR: a comercial; sem ela, a combinada; sem ela, a técnica.
  v_value_rev := COALESCE(a.commercial_revision_id, a.combined_revision_id, a.technical_revision_id);

  -- O trabalho autorizado: engajamento cuja autorização ativa aponta para o pacote.
  v_eng := nullif(p_payload->>'engagement_id','')::uuid;
  IF v_eng IS NULL THEN
    SELECT au.engagement_id INTO v_eng FROM public.commercial_engagement_authorizations au
     WHERE au.organization_id = p_organization_id AND au.state = 'ACTIVE'
       AND au.proposal_revision_id IN (a.technical_revision_id, a.commercial_revision_id, a.combined_revision_id)
     ORDER BY au.governing DESC, au.created_at DESC LIMIT 1;
  ELSIF NOT EXISTS (SELECT 1 FROM public.commercial_engagement_authorizations au
                     WHERE au.organization_id = p_organization_id AND au.engagement_id = v_eng
                       AND au.state = 'ACTIVE'
                       AND au.proposal_revision_id IN (a.technical_revision_id, a.commercial_revision_id,
                                                       a.combined_revision_id)) THEN
    RAISE EXCEPTION 'Engagement is not authorized by this proposal package.' USING ERRCODE = '23514';
  END IF;
  IF v_eng IS NULL THEN
    RAISE EXCEPTION 'Engagement has no governing authorization: register the accepted package as the authorization source first.'
      USING ERRCODE = '23514';
  END IF;

  v_number := nullif(btrim(p_payload->>'os_number'), '');
  IF v_number IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('iso_number:' || p_organization_id::text));
    SELECT COALESCE(max(nullif(regexp_replace(os_number, '^OS-\d{4}-', ''), os_number)::int), 0) + 1
      INTO v_seq FROM public.internal_service_orders
     WHERE organization_id = p_organization_id AND os_number ~ ('^OS-' || to_char(now(), 'YYYY') || '-\d+$');
    v_number := 'OS-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq::text, 4, '0');
  END IF;

  SELECT COALESCE(nullif(btrim(p_payload->>'title'), ''), e.title) INTO v_title
    FROM public.commercial_engagements e WHERE e.organization_id = p_organization_id AND e.id = v_eng;

  v_created := public.internal_service_order_create(p_organization_id, p_actor, v_eng, jsonb_build_object(
    'origin', 'from_accepted_proposal', 'source_proposal_revision_id', v_value_rev,
    'os_number', v_number, 'title', v_title,
    'planned_start', nullif(p_payload->>'planned_start',''),
    'planned_finish', nullif(p_payload->>'planned_finish',''),
    'responsible_user_id', nullif(p_payload->>'responsible_user_id',''),
    'scope_summary', nullif(p_payload->>'scope_summary',''),
    'notes', nullif(p_payload->>'notes','')));

  SELECT * INTO v_os FROM public.internal_service_orders
   WHERE organization_id = p_organization_id AND id = (v_created->>'service_order_id')::uuid FOR UPDATE;
  -- O gatilho de captura resolveu o pacote pela revisão de valor; o aceite
  -- pedido tem de ser ele. Diferença aqui é pacote trocado sob os pés.
  IF v_os.source_context_acceptance_id IS DISTINCT FROM p_acceptance_id THEN
    RAISE EXCEPTION 'Pacote: o aceite regente mudou durante a geração. Recarregue e gere de novo.'
      USING ERRCODE = '40001';
  END IF;
  IF nullif(btrim(p_payload->>'site_label'), '') IS NOT NULL THEN
    UPDATE public.internal_service_orders SET site_label = btrim(p_payload->>'site_label')
     WHERE organization_id = p_organization_id AND id = v_os.id;
    v_os.site_label := btrim(p_payload->>'site_label');
  END IF;

  v_items := public.internal_service_order_insert_fact_items(v_os, p_actor, 'proposal_package', 'proposal_revision',
    ARRAY_REMOVE(ARRAY[a.technical_revision_id, a.commercial_revision_id, a.combined_revision_id], NULL));

  INSERT INTO public.commercial_engagement_history (
    organization_id, engagement_id, transition, to_state, actor_user_id, provenance)
  VALUES (p_organization_id, v_eng, 'service_order_generated_from_package', 'DRAFT', p_actor,
          jsonb_build_object('service_order_id', v_os.id, 'acceptance_id', p_acceptance_id,
                             'technical_revision_id', a.technical_revision_id,
                             'commercial_revision_id', a.commercial_revision_id,
                             'combined_revision_id', a.combined_revision_id,
                             'items_added', v_items));

  RETURN jsonb_build_object('service_order_id', v_os.id, 'status', v_os.status, 'reused', false,
                            'os_number', v_os.os_number, 'items_added', v_items, 'engagement_id', v_eng);
END $function$;

CREATE OR REPLACE FUNCTION public.internal_service_order_register_upload(p_organization_id uuid, p_actor uuid, p_engagement_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_doc uuid; v_os public.internal_service_orders%ROWTYPE; v_created jsonb;
        v_sha text; v_path text; v_number text; v_seq int; v_eng public.commercial_engagements%ROWTYPE;
BEGIN
  PERFORM public.operations_require(p_organization_id, p_actor, ARRAY['commercial.service_orders.manage']);
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Service order creation denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Service order creation requires a named actor.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_eng FROM public.commercial_engagements
   WHERE organization_id = p_organization_id AND id = p_engagement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Engagement not found in tenant.' USING ERRCODE = 'P0002'; END IF;

  v_path := p_payload->>'file_path';
  IF v_path IS NULL OR position(p_organization_id::text || '/' IN v_path) <> 1 OR v_path LIKE '%..%' THEN
    RAISE EXCEPTION 'Service order document path is outside the tenant.' USING ERRCODE = '42501';
  END IF;
  v_sha := nullif(p_payload->>'content_sha256', '');
  IF v_sha IS NULL OR v_sha !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Service order document requires its content hash.' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_doc FROM public.contract_documents
   WHERE organization_id = p_organization_id AND engagement_id = p_engagement_id
     AND document_type = 'internal_service_order' AND content_sha256 = v_sha
     AND superseded_by_document_id IS NULL
   ORDER BY created_at LIMIT 1;
  IF v_doc IS NOT NULL THEN
    SELECT * INTO v_os FROM public.internal_service_orders
     WHERE organization_id = p_organization_id AND document_id = v_doc AND status <> 'CANCELLED'
     ORDER BY created_at LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('service_order_id', v_os.id, 'document_id', v_doc, 'reused', true);
    END IF;
  ELSE
    INSERT INTO public.contract_documents (
      organization_id, engagement_id, title, file_path, document_type, status, uploaded_by, content_sha256)
    VALUES (p_organization_id, p_engagement_id,
            COALESCE(nullif(btrim(p_payload->>'file_title'), ''), 'OS interna'),
            v_path, 'internal_service_order', 'uploaded', p_actor, v_sha)
    RETURNING id INTO v_doc;
  END IF;

  v_number := nullif(btrim(p_payload->>'os_number'), '');
  IF v_number IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('iso_number:' || p_organization_id::text));
    SELECT COALESCE(max(nullif(regexp_replace(os_number, '^OS-\d{4}-', ''), os_number)::int), 0) + 1
      INTO v_seq FROM public.internal_service_orders
     WHERE organization_id = p_organization_id AND os_number ~ ('^OS-' || to_char(now(), 'YYYY') || '-\d+$');
    v_number := 'OS-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq::text, 4, '0');
  END IF;

  v_created := public.internal_service_order_create(p_organization_id, p_actor, p_engagement_id, jsonb_build_object(
    'origin', 'uploaded_document', 'document_id', v_doc, 'os_number', v_number,
    'title', COALESCE(nullif(btrim(p_payload->>'title'), ''), v_eng.title)));

  RETURN jsonb_build_object('service_order_id', v_created->>'service_order_id', 'document_id', v_doc,
                            'reused', false, 'os_number', v_number);
END $function$;

CREATE OR REPLACE FUNCTION public.internal_service_order_apply_extraction(p_organization_id uuid, p_actor uuid, p_service_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_os public.internal_service_orders%ROWTYPE; v_n int;
BEGIN
  PERFORM public.operations_require(p_organization_id, p_actor, ARRAY['commercial.service_orders.manage']);
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Service order content write denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Service order content write requires a named actor.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_os FROM public.internal_service_orders
   WHERE organization_id = p_organization_id AND id = p_service_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service order not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  v_n := public.internal_service_order_insert_fact_items(v_os, p_actor, 'document_extraction',
                                                          'internal_service_order', ARRAY[v_os.id]);
  RETURN jsonb_build_object('service_order_id', p_service_order_id, 'items_added', v_n);
END $function$;

CREATE OR REPLACE FUNCTION public.internal_service_order_update_draft(p_organization_id uuid, p_actor uuid, p_service_order_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_os public.internal_service_orders%ROWTYPE;
BEGIN
  PERFORM public.operations_require(p_organization_id, p_actor, ARRAY['commercial.service_orders.manage']);
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Service order write denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Service order write requires a named actor.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_os FROM public.internal_service_orders
   WHERE organization_id = p_organization_id AND id = p_service_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service order not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF v_os.status NOT IN ('DRAFT','PENDING_CONFIRMATION') THEN
    RAISE EXCEPTION 'Service order is %: only a draft is edited in place.', v_os.status USING ERRCODE = '23514';
  END IF;
  -- Origem proposta: valor e moeda vêm da revisão aceita, não do formulário.
  IF v_os.origin = 'from_accepted_proposal' AND (p_payload ? 'authorized_value' OR p_payload ? 'currency') THEN
    RAISE EXCEPTION 'Service order value comes from the accepted proposal and is not typed.' USING ERRCODE = '23514';
  END IF;

  UPDATE public.internal_service_orders SET
    title = CASE WHEN p_payload ? 'title' THEN COALESCE(nullif(btrim(p_payload->>'title'),''), title) ELSE title END,
    scope_summary = CASE WHEN p_payload ? 'scope_summary' THEN nullif(btrim(p_payload->>'scope_summary'),'') ELSE scope_summary END,
    site_label = CASE WHEN p_payload ? 'site_label' THEN nullif(btrim(p_payload->>'site_label'),'') ELSE site_label END,
    planned_start = CASE WHEN p_payload ? 'planned_start' THEN nullif(p_payload->>'planned_start','')::date ELSE planned_start END,
    planned_finish = CASE WHEN p_payload ? 'planned_finish' THEN nullif(p_payload->>'planned_finish','')::date ELSE planned_finish END,
    authorized_value = CASE WHEN p_payload ? 'authorized_value' THEN nullif(p_payload->>'authorized_value','')::numeric ELSE authorized_value END,
    currency = CASE WHEN p_payload ? 'currency' THEN nullif(btrim(p_payload->>'currency'),'') ELSE currency END,
    responsible_user_id = CASE WHEN p_payload ? 'responsible_user_id' THEN nullif(p_payload->>'responsible_user_id','')::uuid ELSE responsible_user_id END,
    notes = CASE WHEN p_payload ? 'notes' THEN nullif(btrim(p_payload->>'notes'),'') ELSE notes END
  WHERE organization_id = p_organization_id AND id = p_service_order_id;

  INSERT INTO public.commercial_engagement_history (
    organization_id, engagement_id, transition, actor_user_id, provenance)
  VALUES (p_organization_id, v_os.engagement_id, 'service_order_draft_edited', p_actor,
          jsonb_build_object('service_order_id', p_service_order_id,
                             'fields', (SELECT jsonb_agg(k) FROM jsonb_object_keys(p_payload) k)));
  RETURN jsonb_build_object('service_order_id', p_service_order_id, 'updated', true);
END $function$;

CREATE OR REPLACE FUNCTION public.internal_service_order_item_upsert(p_organization_id uuid, p_actor uuid, p_service_order_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_os public.internal_service_orders%ROWTYPE; v_id uuid; v_item public.internal_service_order_items%ROWTYPE;
BEGIN
  PERFORM public.operations_require(p_organization_id, p_actor, ARRAY['commercial.service_orders.manage']);
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Service order content write denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Service order content write requires a named actor.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_os FROM public.internal_service_orders
   WHERE organization_id = p_organization_id AND id = p_service_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service order not found in tenant.' USING ERRCODE = 'P0002'; END IF;

  v_id := nullif(p_payload->>'id','')::uuid;
  IF v_id IS NULL THEN
    INSERT INTO public.internal_service_order_items (
      organization_id, service_order_id, kind, position, title, detail, quantity, unit, planned_date,
      origin, confirmation_state, confirmed_by, confirmed_at, created_by)
    VALUES (p_organization_id, p_service_order_id, p_payload->>'kind',
            COALESCE(nullif(p_payload->>'position','')::int,
                     (SELECT COALESCE(max(position), 0) + 1 FROM public.internal_service_order_items
                       WHERE organization_id = p_organization_id AND service_order_id = p_service_order_id)),
            p_payload->>'title', nullif(btrim(p_payload->>'detail'),''),
            nullif(p_payload->>'quantity','')::numeric, nullif(btrim(p_payload->>'unit'),''),
            nullif(p_payload->>'planned_date','')::date,
            'manual', 'CONFIRMED', p_actor, now(), p_actor)
    RETURNING id INTO v_id;
  ELSE
    SELECT * INTO v_item FROM public.internal_service_order_items
     WHERE organization_id = p_organization_id AND service_order_id = p_service_order_id AND id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Service order line not found.' USING ERRCODE = 'P0002'; END IF;
    /*
      Editar uma linha LIDA a torna afirmação de quem editou: vira confirmada
      pelo editor, e a proveniência original (fato, página, trecho) continua
      na linha para quem quiser conferir o que o documento dizia.
    */
    UPDATE public.internal_service_order_items SET
      kind = COALESCE(nullif(p_payload->>'kind',''), kind),
      title = COALESCE(nullif(btrim(p_payload->>'title'),''), title),
      detail = CASE WHEN p_payload ? 'detail' THEN nullif(btrim(p_payload->>'detail'),'') ELSE detail END,
      quantity = CASE WHEN p_payload ? 'quantity' THEN nullif(p_payload->>'quantity','')::numeric ELSE quantity END,
      unit = CASE WHEN p_payload ? 'unit' THEN nullif(btrim(p_payload->>'unit'),'') ELSE unit END,
      planned_date = CASE WHEN p_payload ? 'planned_date' THEN nullif(p_payload->>'planned_date','')::date ELSE planned_date END,
      confirmation_state = 'CONFIRMED', confirmed_by = p_actor, confirmed_at = now()
    WHERE organization_id = p_organization_id AND id = v_id;
  END IF;
  RETURN jsonb_build_object('item_id', v_id);
END $function$;

CREATE OR REPLACE FUNCTION public.internal_service_order_items_decide(p_organization_id uuid, p_actor uuid, p_service_order_id uuid, p_decisions jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE d jsonb; v_n int := 0; v_state text;
BEGIN
  PERFORM public.operations_require(p_organization_id, p_actor, ARRAY['commercial.service_orders.manage']);
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Service order content write denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Reviewing service order content requires a named actor.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_decisions) <> 'array' THEN
    RAISE EXCEPTION 'Decisions must be a list.' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.internal_service_orders
   WHERE organization_id = p_organization_id AND id = p_service_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service order not found in tenant.' USING ERRCODE = 'P0002'; END IF;

  FOR d IN SELECT * FROM jsonb_array_elements(p_decisions) LOOP
    v_state := d->>'decision';
    IF v_state NOT IN ('CONFIRMED','REJECTED','UNCONFIRMED') THEN
      RAISE EXCEPTION 'Unsupported decision %.', v_state USING ERRCODE = '22023';
    END IF;
    UPDATE public.internal_service_order_items SET
      confirmation_state = v_state,
      confirmed_by = CASE WHEN v_state = 'UNCONFIRMED' THEN NULL ELSE p_actor END,
      confirmed_at = CASE WHEN v_state = 'UNCONFIRMED' THEN NULL ELSE now() END
     WHERE organization_id = p_organization_id AND service_order_id = p_service_order_id
       AND id = (d->>'item_id')::uuid AND confirmation_state IS DISTINCT FROM v_state;
    IF FOUND THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('service_order_id', p_service_order_id, 'decided', v_n);
END $function$;

CREATE OR REPLACE FUNCTION public.internal_service_order_amend(p_organization_id uuid, p_actor uuid, p_service_order_id uuid, p_payload jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_os public.internal_service_orders%ROWTYPE; v_rev int; it jsonb; v_changed int := 0;
BEGIN
  PERFORM public.operations_require(p_organization_id, p_actor, ARRAY['commercial.service_orders.manage']);
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Service order amendment denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Service order amendment requires a named actor.' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Service order amendment requires a written reason.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_os FROM public.internal_service_orders
   WHERE organization_id = p_organization_id AND id = p_service_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service order not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF v_os.status NOT IN ('ISSUED','IN_EXECUTION','SUSPENDED') THEN
    RAISE EXCEPTION 'Service order is %: only an issued order is amended.', v_os.status USING ERRCODE = '23514';
  END IF;
  IF v_os.origin = 'from_accepted_proposal' AND (p_payload ? 'authorized_value' OR p_payload ? 'currency') THEN
    RAISE EXCEPTION 'Service order value comes from the accepted proposal: a value change is a new proposal revision.'
      USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('apex.iso_amendment', v_os.id::text, true);

  UPDATE public.internal_service_orders SET
    title = CASE WHEN p_payload ? 'title' THEN COALESCE(nullif(btrim(p_payload->>'title'),''), title) ELSE title END,
    scope_summary = CASE WHEN p_payload ? 'scope_summary' THEN nullif(btrim(p_payload->>'scope_summary'),'') ELSE scope_summary END,
    site_label = CASE WHEN p_payload ? 'site_label' THEN nullif(btrim(p_payload->>'site_label'),'') ELSE site_label END,
    planned_start = CASE WHEN p_payload ? 'planned_start' THEN nullif(p_payload->>'planned_start','')::date ELSE planned_start END,
    planned_finish = CASE WHEN p_payload ? 'planned_finish' THEN nullif(p_payload->>'planned_finish','')::date ELSE planned_finish END,
    authorized_value = CASE WHEN p_payload ? 'authorized_value' THEN nullif(p_payload->>'authorized_value','')::numeric ELSE authorized_value END,
    currency = CASE WHEN p_payload ? 'currency' THEN nullif(btrim(p_payload->>'currency'),'') ELSE currency END
  WHERE organization_id = p_organization_id AND id = v_os.id;

  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'add_items', '[]'::jsonb)) LOOP
    INSERT INTO public.internal_service_order_items (
      organization_id, service_order_id, kind, position, title, detail, quantity, unit, planned_date,
      origin, confirmation_state, confirmed_by, confirmed_at, created_by)
    VALUES (p_organization_id, v_os.id, it->>'kind',
            (SELECT COALESCE(max(position), 0) + 1 FROM public.internal_service_order_items
              WHERE organization_id = p_organization_id AND service_order_id = v_os.id),
            it->>'title', nullif(btrim(it->>'detail'),''), nullif(it->>'quantity','')::numeric,
            nullif(btrim(it->>'unit'),''), nullif(it->>'planned_date','')::date,
            'manual', 'CONFIRMED', p_actor, now(), p_actor);
    v_changed := v_changed + 1;
  END LOOP;
  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'remove_item_ids', '[]'::jsonb)) LOOP
    UPDATE public.internal_service_order_items
       SET confirmation_state = 'REJECTED', confirmed_by = p_actor, confirmed_at = now()
     WHERE organization_id = p_organization_id AND service_order_id = v_os.id
       AND id = (it #>> '{}')::uuid AND confirmation_state <> 'REJECTED';
    IF FOUND THEN v_changed := v_changed + 1; END IF;
  END LOOP;

  SELECT COALESCE(max(revision), 0) + 1 INTO v_rev FROM public.internal_service_order_revisions
   WHERE organization_id = p_organization_id AND service_order_id = v_os.id;
  INSERT INTO public.internal_service_order_revisions
    (organization_id, service_order_id, revision, kind, snapshot, reason, actor_user_id)
  VALUES (p_organization_id, v_os.id, v_rev, 'AMENDMENT',
          public.internal_service_order_snapshot(p_organization_id, v_os.id), btrim(p_reason), p_actor);

  PERFORM set_config('apex.iso_amendment', '', true);

  INSERT INTO public.commercial_engagement_history (
    organization_id, engagement_id, transition, actor_user_id, note, provenance)
  VALUES (p_organization_id, v_os.engagement_id, 'service_order_amended', p_actor, btrim(p_reason),
          jsonb_build_object('service_order_id', v_os.id, 'revision', v_rev, 'lines_changed', v_changed));
  PERFORM public.emit_domain_event(
    p_organization_id, 'operations.service_order.amended', 1, 'internal_service_order', v_os.id,
    'service-order:' || v_os.id || ':revision:' || v_rev,
    jsonb_build_object('revision', v_rev, 'os_number', v_os.os_number, 'lines_changed', v_changed),
    now(), 'human', p_actor);

  RETURN jsonb_build_object('service_order_id', v_os.id, 'revision', v_rev, 'lines_changed', v_changed);
END $function$;

CREATE OR REPLACE FUNCTION public.internal_service_order_seed_from_package(p_organization_id uuid, p_actor uuid, p_service_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_os public.internal_service_orders%ROWTYPE; v_n int;
BEGIN
  PERFORM public.operations_require(p_organization_id, p_actor, ARRAY['commercial.service_orders.manage']);
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Service order content write denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Service order content write requires a named actor.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_os FROM public.internal_service_orders
   WHERE organization_id = p_organization_id AND id = p_service_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service order not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF COALESCE(v_os.governing_technical_revision_id, v_os.governing_commercial_revision_id,
              v_os.governing_combined_revision_id) IS NULL THEN
    RAISE EXCEPTION 'Service order has no governing proposal package to bring content from.'
      USING ERRCODE = '23514';
  END IF;
  v_n := public.internal_service_order_insert_fact_items(v_os, p_actor, 'proposal_package', 'proposal_revision',
    ARRAY_REMOVE(ARRAY[v_os.governing_technical_revision_id, v_os.governing_commercial_revision_id,
                       v_os.governing_combined_revision_id], NULL));
  RETURN jsonb_build_object('service_order_id', p_service_order_id, 'items_added', v_n);
END $function$;

CREATE OR REPLACE FUNCTION public.internal_service_order_record_divergence(p_organization_id uuid, p_actor uuid, p_service_order_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_os public.internal_service_orders%ROWTYPE; v_id uuid; v_by text;
BEGIN
  PERFORM public.operations_require(p_organization_id, p_actor, ARRAY['commercial.service_orders.manage']);
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Divergence recording denied.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_os FROM public.internal_service_orders
   WHERE organization_id = p_organization_id AND id = p_service_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service order not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  v_by := COALESCE(p_payload->>'detected_by', 'human');
  IF v_by = 'human' AND p_actor IS NULL THEN
    RAISE EXCEPTION 'A human divergence requires a named actor.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.commercial_divergences d
              WHERE d.organization_id = p_organization_id AND d.service_order_id = p_service_order_id
                AND d.scope = p_payload->>'scope'
                AND d.field_path IS NOT DISTINCT FROM nullif(p_payload->>'field_path','')
                AND d.summary = p_payload->>'summary' AND d.state IN ('OPEN','ACKNOWLEDGED')) THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'ALREADY_OPEN');
  END IF;
  INSERT INTO public.commercial_divergences (
    organization_id, engagement_id, service_order_id, scope, field_path,
    left_source_kind, left_source_id, left_value, right_source_kind, right_source_id, right_value,
    severity, summary, detected_by, ai_provider, ai_model, confidence)
  VALUES (p_organization_id, v_os.engagement_id, v_os.id, p_payload->>'scope',
          nullif(p_payload->>'field_path',''),
          COALESCE(nullif(p_payload->>'left_source_kind',''), 'accepted_proposal'),
          nullif(p_payload->>'left_source_id','')::uuid, nullif(p_payload->>'left_value',''),
          'internal_service_order', v_os.id, nullif(p_payload->>'right_value',''),
          COALESCE(nullif(p_payload->>'severity',''), 'WARNING'), p_payload->>'summary', v_by,
          nullif(p_payload->>'ai_provider',''), nullif(p_payload->>'ai_model',''),
          nullif(p_payload->>'confidence','')::numeric)
  RETURNING id INTO v_id;
  IF v_os.status = 'DRAFT' THEN
    UPDATE public.internal_service_orders SET status = 'PENDING_CONFIRMATION'
     WHERE organization_id = p_organization_id AND id = p_service_order_id;
  END IF;
  RETURN jsonb_build_object('recorded', true, 'divergence_id', v_id);
END $function$;

CREATE OR REPLACE FUNCTION public.project_requirement_upsert(p_organization_id uuid, p_actor uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid; r public.project_requirements%ROWTYPE; v_changes jsonb := '{}'::jsonb; k text;
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
  RETURN jsonb_build_object('requirement_id', r.id, 'status', r.status, 'created', false);
END $function$;

CREATE OR REPLACE FUNCTION public.project_requirement_transition(p_organization_id uuid, p_actor uuid, p_requirement_id uuid, p_to text, p_reason text DEFAULT NULL::text, p_superseded_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r public.project_requirements%ROWTYPE; v_from text; ok boolean;
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

CREATE OR REPLACE FUNCTION public.project_requirement_mark_satisfied(p_organization_id uuid, p_actor uuid, p_requirement_id uuid, p_note text, p_document_id uuid DEFAULT NULL::uuid, p_undo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r public.project_requirements%ROWTYPE;
BEGIN
  PERFORM public.operations_require(p_organization_id, p_actor, ARRAY['operations.planning.manage']);
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
END $function$;

CREATE OR REPLACE FUNCTION public.project_requirements_import_from_service_order(p_organization_id uuid, p_actor uuid, p_project_id text, p_service_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_os public.internal_service_orders%ROWTYPE; i record; v_type text; v_added int := 0; r public.project_requirements%ROWTYPE;
BEGIN
  PERFORM public.operations_require(p_organization_id, p_actor, ARRAY['operations.planning.manage']);
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
END $function$;

CREATE OR REPLACE FUNCTION public.supply_signal_link_followup(p_organization_id uuid, p_actor uuid, p_signal_id uuid, p_followup_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v public.supply_signals%ROWTYPE;
BEGIN
  PERFORM public.operations_require(p_organization_id, p_actor, ARRAY['supply.plan','procurement.request','procurement.source','inventory.reserve','inventory.manage','receiving.receive']);
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Following up requires a named person.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.supply_signals WHERE organization_id = p_organization_id AND id = p_signal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recommendation not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.apex_followups WHERE organization_id = p_organization_id AND id = p_followup_id) THEN
    RAISE EXCEPTION 'Follow-up not found in tenant.' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.supply_signals SET followup_id = p_followup_id WHERE id = v.id;
  INSERT INTO public.supply_signal_history (organization_id, signal_id, transition, actor_kind, actor_user_id, snapshot)
  VALUES (p_organization_id, v.id, 'followed_up', 'human', p_actor, jsonb_build_object('followup_id', p_followup_id));
  RETURN jsonb_build_object('signal_id', v.id, 'followup_id', p_followup_id);
END $function$;

-- ---------------------------------------------------------------------------
-- 5) Quarentena: só a inspeção a esvazia
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

CREATE OR REPLACE FUNCTION public.inventory_transfer_request(p_organization_id uuid, p_actor uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    ELSIF r.id IS NOT NULL AND public.inventory_requirement_committed(p_organization_id, r.id) + v_qty > r.quantity THEN
      RAISE EXCEPTION 'Transfer would over-cover the requirement (% required).', r.quantity USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.inventory_transfer_lines (organization_id, transfer_id, item_id, lot_code, quantity, requirement_id, source_reservation_id)
    VALUES (p_organization_id, t.id, v_item, nullif(btrim(line->>'lot_code'),''), v_qty, r.id, v_res.id);
  END LOOP;

  SELECT * INTO t FROM public.inventory_transfers WHERE organization_id = p_organization_id AND id = t.id;
  PERFORM public.inventory_transfer_event(t, 'requested', p_actor);
  RETURN jsonb_build_object('transfer_id', t.id, 'transfer_number', t.transfer_number, 'replayed', false);
END $function$;

CREATE OR REPLACE FUNCTION public.inventory_adjust(p_organization_id uuid, p_actor uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_item uuid; v_loc uuid; v_qty numeric; v_id uuid; v_key text;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['inventory.manage']);
  v_item := (p_payload->>'item_id')::uuid; v_loc := (p_payload->>'location_id')::uuid;
  v_qty := (p_payload->>'quantity')::numeric;
  PERFORM public.inventory_assert_outside_quarantine(p_organization_id, v_loc, false); -- 237
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
END $function$;

CREATE OR REPLACE FUNCTION public.inventory_count_open(p_organization_id uuid, p_actor uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE c public.inventory_counts%ROWTYPE; b record;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['inventory.manage']);
  PERFORM public.inventory_assert_outside_quarantine(p_organization_id, (p_payload->>'location_id')::uuid, false); -- 237
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
END $function$;

CREATE OR REPLACE FUNCTION public.inventory_return_from_project(p_organization_id uuid, p_actor uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  PERFORM public.inventory_assert_outside_quarantine(p_organization_id, v_loc, false); -- 237
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
END $function$;

-- ---------------------------------------------------------------------------
-- 6) Evidência de recebimento: bucket e pasta do inquilino
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.goods_receipt_attach_evidence(p_organization_id uuid, p_actor uuid, p_receipt_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['receiving.receive']);
  IF NOT EXISTS (SELECT 1 FROM public.goods_receipts WHERE organization_id = p_organization_id AND id = p_receipt_id) THEN
    RAISE EXCEPTION 'Goods receipt not found in tenant.' USING ERRCODE = 'P0002';
  END IF;
  -- 237: a evidência mora no bucket canônico, na pasta de recebimentos DO inquilino — e a
  -- deduplicação só enxerga o próprio inquilino.
  IF p_payload->>'storage_bucket' IS DISTINCT FROM 'contract-files'
     OR split_part(p_payload->>'storage_path', '/', 1) IS DISTINCT FROM p_organization_id::text
     OR split_part(p_payload->>'storage_path', '/', 2) IS DISTINCT FROM 'supply-receipts' THEN
    RAISE EXCEPTION 'Receipt evidence must live in the tenant receipt folder.' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_id FROM public.goods_receipt_evidence
   WHERE organization_id = p_organization_id
     AND storage_bucket = p_payload->>'storage_bucket' AND storage_path = p_payload->>'storage_path';
  IF FOUND THEN RETURN jsonb_build_object('evidence_id', v_id, 'replayed', true); END IF;
  INSERT INTO public.goods_receipt_evidence (organization_id, receipt_id, storage_bucket, storage_path, file_name, mime_type,
    size_bytes, content_sha256, uploaded_by)
  VALUES (p_organization_id, p_receipt_id, p_payload->>'storage_bucket', p_payload->>'storage_path', p_payload->>'file_name',
    p_payload->>'mime_type', (p_payload->>'size_bytes')::bigint, lower(p_payload->>'content_sha256'), p_actor)
  RETURNING id INTO v_id;
  PERFORM public.emit_domain_event(p_organization_id, 'supply.goods_receipt.evidence_attached', 1, 'goods_receipt', p_receipt_id,
    'goods-receipt-evidence:' || v_id, jsonb_build_object('file_name', p_payload->>'file_name'), now(), 'human', p_actor);
  RETURN jsonb_build_object('evidence_id', v_id, 'replayed', false);
END $function$;

-- ---------------------------------------------------------------------------
-- 7) Alçada: categoria honrada e sem autodeclaração por papel
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purchase_order_decide(p_organization_id uuid, p_actor uuid, p_po_id uuid, p_decision text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v public.purchase_orders%ROWTYPE; v_authority uuid; fp text; v_total numeric;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['procurement.approve']);
  IF p_decision NOT IN ('APPROVE','REJECT') THEN RAISE EXCEPTION 'Unsupported decision.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v FROM public.purchase_orders WHERE organization_id = p_organization_id AND id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF v.status <> 'APPROVAL_REQUIRED' THEN RAISE EXCEPTION 'Purchase order is %: nothing to decide.', v.status USING ERRCODE = '23514'; END IF;
  IF v.approval_governance = 'POLICY' THEN
    RAISE EXCEPTION 'Purchase order is governed by an approval policy: decide it in the approvals inbox.' USING ERRCODE = '23514';
  END IF;
  -- Segregação de funções: quem criou ou submeteu não decide.
  IF p_actor = v.created_by OR p_actor = v.submitted_by THEN
    RAISE EXCEPTION 'Purchase approval requires segregation of duties: the creator or submitter does not decide.' USING ERRCODE = '42501';
  END IF;
  IF p_decision = 'REJECT' THEN
    IF nullif(btrim(p_note),'') IS NULL THEN RAISE EXCEPTION 'Rejection requires a reason.' USING ERRCODE = '22023'; END IF;
    UPDATE public.purchase_orders SET status = 'DRAFT', approval_governance = NULL WHERE id = v.id RETURNING * INTO v;
    PERFORM public.purchase_order_log(v, 'rejected', 'APPROVAL_REQUIRED', p_note, '{}'::jsonb, p_actor);
    RETURN jsonb_build_object('purchase_order_id', v.id, 'status', v.status);
  END IF;
  v_total := public.purchase_order_total(v.id);
  v_authority := public.procurement_authority_for_order(p_organization_id, p_actor, v.id); -- 237: honra a categoria
  IF v_authority IS NULL THEN
    RAISE EXCEPTION 'Purchase approval authority not configured for this actor, amount (% %) and scope: declare it with evidence or configure an approval policy.',
      v_total, v.currency USING ERRCODE = '42501';
  END IF;
  fp := public.purchase_order_fingerprint(v.id);
  UPDATE public.purchase_orders SET status = 'APPROVED', approved_fingerprint = fp, approved_by = p_actor, approved_at = now(),
    approval_authority_id = v_authority WHERE id = v.id RETURNING * INTO v;
  PERFORM public.purchase_order_log(v, 'approved', 'APPROVAL_REQUIRED', p_note,
    jsonb_build_object('governance', 'AUTHORITY', 'authority_id', v_authority, 'fingerprint', fp, 'total', v_total), p_actor);
  RETURN jsonb_build_object('purchase_order_id', v.id, 'status', v.status, 'authority_id', v_authority);
END $function$;

CREATE OR REPLACE FUNCTION public.procurement_authority_declare(p_organization_id uuid, p_actor uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['procurement.authorities.manage']);
  -- Ninguém declara alçada para si mesmo.
  IF p_payload->>'grantee_kind' = 'USER' AND (p_payload->>'grantee_user_id')::uuid = p_actor THEN
    RAISE EXCEPTION 'Purchase authority cannot be self-declared.' USING ERRCODE = '42501';
  END IF;
  -- 237: nem para um papel que o próprio declarante exerce.
  IF p_payload->>'grantee_kind' = 'ROLE' AND EXISTS (SELECT 1 FROM public.user_roles ur
       WHERE ur.user_id = p_actor AND ur.organization_id = p_organization_id AND ur.role_id = (p_payload->>'grantee_role_id')::uuid) THEN
    RAISE EXCEPTION 'Purchase authority cannot be declared for a role the declarer holds.' USING ERRCODE = '42501';
  END IF;
  IF p_payload->>'grantee_kind' = 'ROLE' AND NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.id = (p_payload->>'grantee_role_id')::uuid
       AND (r.organization_id IS NULL OR r.organization_id = p_organization_id)) THEN
    RAISE EXCEPTION 'Purchase authority role not found.' USING ERRCODE = 'P0002';
  END IF;
  IF p_payload->>'grantee_kind' = 'USER' AND NOT EXISTS (SELECT 1 FROM public.user_roles ur
       WHERE ur.user_id = (p_payload->>'grantee_user_id')::uuid AND ur.organization_id = p_organization_id) THEN
    RAISE EXCEPTION 'Purchase authority user is not a member of the tenant.' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.procurement_approval_authorities (organization_id, project_id, category, grantee_kind, grantee_role_id,
    grantee_user_id, max_amount, currency, source_kind, source_reference, source_document_id, justification,
    effective_from, effective_until, declared_by)
  VALUES (p_organization_id, nullif(p_payload->>'project_id',''), nullif(btrim(p_payload->>'category'),''), p_payload->>'grantee_kind',
    nullif(p_payload->>'grantee_role_id','')::uuid, nullif(p_payload->>'grantee_user_id','')::uuid,
    nullif(p_payload->>'max_amount','')::numeric, COALESCE(nullif(p_payload->>'currency',''), 'BRL'),
    p_payload->>'source_kind', p_payload->>'source_reference', nullif(p_payload->>'source_document_id','')::uuid,
    p_payload->>'justification', COALESCE(nullif(p_payload->>'effective_from','')::date, current_date),
    nullif(p_payload->>'effective_until','')::date, p_actor)
  RETURNING id INTO v_id;
  PERFORM public.emit_domain_event(p_organization_id, 'supply.procurement_authority.declared', 1, 'procurement_authority', v_id,
    'procurement-authority:' || v_id || ':declared', p_payload, now(), 'human', p_actor);
  RETURN jsonb_build_object('authority_id', v_id);
END $function$;

-- ---------------------------------------------------------------------------
-- 8) Rotas de evento que ligam só com trabalhador CAPAZ
-- ---------------------------------------------------------------------------
/*
  O trabalhador hoje implantado manda tipo de trabalho desconhecido para a
  carta morta (não-retentável). Ligar a rota `approval.request.* → compras`
  antes do código chegar a produção perderia cada desfecho de aprovação.

  `activation = ON_WORKER_CAPABILITY`: a rota nasce desligada e é ligada pelo
  PRÓPRIO trabalhador que sabe executá-la (`apex_event_routes_activate_for`,
  chamado pela passagem de drenagem com o seu vocabulário de trabalho). Até
  lá, a reconciliação periódica (seção 9) aplica os desfechos pelo estado —
  e continua como rede de segurança depois.
*/
ALTER TABLE public.apex_event_routes
  ADD COLUMN IF NOT EXISTS activation text NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS activated_at timestamptz;
DO $$ BEGIN
  ALTER TABLE public.apex_event_routes ADD CONSTRAINT apex_event_routes_activation_check
    CHECK (activation IN ('MANUAL', 'ON_WORKER_CAPABILITY'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

UPDATE public.apex_event_routes SET activation = 'ON_WORKER_CAPABILITY'
 WHERE job_type = 'procurement.purchase_order.apply_approval' AND NOT enabled;

INSERT INTO public.apex_event_routes (event_type, schema_version, job_type, max_attempts, enabled, activation, note)
SELECT v.event_type, 1, 'procurement.purchase_order.apply_approval', 8, false, 'ON_WORKER_CAPABILITY', v.note
  FROM (VALUES
    ('approval.request.returned_for_correction', 'Devolvido para correção: o pedido de compra volta ao rascunho.'),
    ('approval.request.expired', 'Aprovação vencida: o pedido de compra volta ao rascunho.'),
    ('approval.request.cancelled', 'Aprovação cancelada no motor: o pedido de compra volta ao rascunho (ou já está cancelado).')
  ) AS v(event_type, note)
 WHERE NOT EXISTS (SELECT 1 FROM public.apex_event_routes r
                    WHERE r.event_type = v.event_type AND r.schema_version = 1
                      AND r.job_type = 'procurement.purchase_order.apply_approval');

CREATE OR REPLACE FUNCTION public.apex_event_routes_activate_for(p_job_types text[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  UPDATE public.apex_event_routes SET enabled = true, activated_at = now()
   WHERE NOT enabled AND activation = 'ON_WORKER_CAPABILITY' AND job_type = ANY (p_job_types);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.apex_event_routes_activate_for(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apex_event_routes_activate_for(text[]) TO service_role;

-- ---------------------------------------------------------------------------
-- 9) Produtores agendados: leitura da Apex e reconciliação de aprovações
-- ---------------------------------------------------------------------------
/*
  Leitura da Apex por inquilino e por HORA, pelo relógio que já existe
  (apex_jobs + drenagem a cada 10 min). Entram os inquilinos com demanda de
  material confirmada, pedido vivo ou sinal aberto — o último para que a
  recomendação que deixou de ser verdade seja resolvida mesmo sem demanda nova.
*/
CREATE OR REPLACE FUNCTION public.supply_intelligence_enqueue_sweep(p_as_of timestamptz DEFAULT now())
RETURNS integer LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE org record; n integer := 0;
BEGIN
  FOR org IN
    SELECT organization_id FROM public.project_requirements
     WHERE requirement_type = 'MATERIAL' AND status = 'CONFIRMED'
    UNION
    SELECT organization_id FROM public.purchase_orders WHERE status IN ('APPROVAL_REQUIRED','ISSUED','PARTIALLY_RECEIVED')
    UNION
    SELECT organization_id FROM public.supply_signals WHERE status = 'OPEN'
  LOOP
    PERFORM public.apex_jobs_enqueue(
      org.organization_id, 'supply.intelligence.sweep',
      'supply-intelligence-sweep:' || org.organization_id::text || ':' || to_char(p_as_of AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24'),
      jsonb_build_object('reason', 'scheduled'), 1, now(), 3, NULL, NULL);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.supply_intelligence_enqueue_sweep(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supply_intelligence_enqueue_sweep(timestamptz) TO service_role;

/*
  Reconciliação: pedido de compra em APPROVAL_REQUIRED por POLÍTICA cujo pedido
  de aprovação já terminou no motor recebe o desfecho pela MESMA função da rota
  (`purchase_order_apply_approval` — idempotente, confere a impressão digital).
  Cobre o desfecho roteado antes de a rota ligar e o desfecho sem rota.
*/
CREATE OR REPLACE FUNCTION public.purchase_order_reconcile_approvals(p_organization_id uuid, p_limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE po record; res jsonb; n_seen integer := 0; n_applied integer := 0;
BEGIN
  FOR po IN
    SELECT p.approval_request_id FROM public.purchase_orders p
      JOIN public.approval_requests q ON q.id = p.approval_request_id AND q.organization_id = p.organization_id
     WHERE p.organization_id = p_organization_id AND p.status = 'APPROVAL_REQUIRED'
       AND p.approval_governance = 'POLICY' AND q.status <> 'PENDING'
     ORDER BY p.submitted_at LIMIT p_limit
  LOOP
    n_seen := n_seen + 1;
    res := public.purchase_order_apply_approval(po.approval_request_id);
    IF COALESCE((res->>'applied')::boolean, false) THEN n_applied := n_applied + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('candidates', n_seen, 'applied', n_applied);
END $$;
REVOKE ALL ON FUNCTION public.purchase_order_reconcile_approvals(uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_order_reconcile_approvals(uuid,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.purchase_order_enqueue_approval_reconcile(p_as_of timestamptz DEFAULT now())
RETURNS integer LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE org record; n integer := 0;
BEGIN
  FOR org IN
    SELECT DISTINCT p.organization_id FROM public.purchase_orders p
      JOIN public.approval_requests q ON q.id = p.approval_request_id AND q.organization_id = p.organization_id
     WHERE p.status = 'APPROVAL_REQUIRED' AND p.approval_governance = 'POLICY' AND q.status <> 'PENDING'
  LOOP
    PERFORM public.apex_jobs_enqueue(
      org.organization_id, 'procurement.purchase_order.reconcile_approvals',
      'po-approval-reconcile:' || org.organization_id::text || ':'
        || to_char(p_as_of AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24') || ':' || (extract(minute FROM p_as_of)::int / 10)::text,
      jsonb_build_object('reason', 'scheduled'), 1, now(), 5, NULL, NULL);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.purchase_order_enqueue_approval_reconcile(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_order_enqueue_approval_reconcile(timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 10) ON DELETE RESTRICT → NO ACTION (230–232)
--
--    NO ACTION protege igual contra o apagamento ISOLADO do referenciado (a
--    checagem roda no fim do comando), mas deixa a cascata privilegiada de
--    inquilino terminar — RESTRICT checa na hora e aborta no meio, a lição da
--    207. `iso_engagement_tenant` (200/207) fica como está, de propósito.
-- ---------------------------------------------------------------------------
ALTER TABLE public.internal_service_orders
  DROP CONSTRAINT iso_acceptance_tenant,
  ADD CONSTRAINT iso_acceptance_tenant FOREIGN KEY (organization_id, source_context_acceptance_id)
    REFERENCES public.commercial_proposal_context_acceptances (organization_id, id),
  DROP CONSTRAINT iso_gov_combined_tenant,
  ADD CONSTRAINT iso_gov_combined_tenant FOREIGN KEY (organization_id, governing_combined_revision_id)
    REFERENCES public.commercial_proposal_revisions (organization_id, id),
  DROP CONSTRAINT iso_gov_commercial_tenant,
  ADD CONSTRAINT iso_gov_commercial_tenant FOREIGN KEY (organization_id, governing_commercial_revision_id)
    REFERENCES public.commercial_proposal_revisions (organization_id, id),
  DROP CONSTRAINT iso_gov_technical_tenant,
  ADD CONSTRAINT iso_gov_technical_tenant FOREIGN KEY (organization_id, governing_technical_revision_id)
    REFERENCES public.commercial_proposal_revisions (organization_id, id);
ALTER TABLE public.internal_service_order_items
  DROP CONSTRAINT isoi_revision_tenant,
  ADD CONSTRAINT isoi_revision_tenant FOREIGN KEY (organization_id, source_revision_id)
    REFERENCES public.commercial_proposal_revisions (organization_id, id);
ALTER TABLE public.internal_service_order_issue_exceptions
  DROP CONSTRAINT isoe_evidence_tenant,
  ADD CONSTRAINT isoe_evidence_tenant FOREIGN KEY (organization_id, evidence_document_id)
    REFERENCES public.contract_documents (organization_id, id);
ALTER TABLE public.project_requirements
  DROP CONSTRAINT preq_item_tenant,
  ADD CONSTRAINT preq_item_tenant FOREIGN KEY (organization_id, item_id)
    REFERENCES public.supply_items (organization_id, id),
  DROP CONSTRAINT preq_satisfaction_document_tenant,
  ADD CONSTRAINT preq_satisfaction_document_tenant FOREIGN KEY (organization_id, satisfaction_document_id)
    REFERENCES public.contract_documents (organization_id, id),
  DROP CONSTRAINT preq_service_order_item_tenant,
  ADD CONSTRAINT preq_service_order_item_tenant FOREIGN KEY (organization_id, service_order_item_id)
    REFERENCES public.internal_service_order_items (organization_id, id),
  DROP CONSTRAINT preq_service_order_tenant,
  ADD CONSTRAINT preq_service_order_tenant FOREIGN KEY (organization_id, service_order_id)
    REFERENCES public.internal_service_orders (organization_id, id),
  DROP CONSTRAINT preq_superseded_tenant,
  ADD CONSTRAINT preq_superseded_tenant FOREIGN KEY (organization_id, superseded_by_id)
    REFERENCES public.project_requirements (organization_id, id);

-- ---------------------------------------------------------------------------
-- 11) Visões: só leitura para o navegador (o padrão da 174)
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.supply_requirement_coverage, public.inventory_position,
  public.purchase_order_receipt_basis, public.supplier_delivery_performance FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.supply_requirement_coverage, public.inventory_position,
  public.purchase_order_receipt_basis, public.supplier_delivery_performance TO authenticated;

-- A lista constante de origens de Supply não é superfície do navegador (regra da 140).
REVOKE ALL ON FUNCTION public.apex_followup_supply_source_kinds() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apex_followup_supply_source_kinds() TO service_role;

-- ---------------------------------------------------------------------------
-- 12) Storage: a pasta de recebimentos só é escrita pelo servidor
--    (URL de upload assinada) e nunca apagada pelo navegador. A evidência é
--    fato append-only; o arquivo não pode ser menos protegido que a linha.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS contract_files_storage_insert ON storage.objects;
CREATE POLICY contract_files_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK ((bucket_id = 'contract-files'::text)
    AND (split_part(name, '/'::text, 1) = (public.current_user_organization_id())::text)
    AND public.current_user_has_permission('contracts.upload_file'::text)
    AND (split_part(name, '/'::text, 2) <> 'supply-receipts'::text));
DROP POLICY IF EXISTS contract_files_storage_delete ON storage.objects;
CREATE POLICY contract_files_storage_delete ON storage.objects FOR DELETE TO authenticated
  USING ((bucket_id = 'contract-files'::text)
    AND (split_part(name, '/'::text, 1) = (public.current_user_organization_id())::text)
    AND public.current_user_has_permission('contracts.delete'::text)
    AND (split_part(name, '/'::text, 2) <> 'supply-receipts'::text));

-- ---------------------------------------------------------------------------
-- 13) Índices dos caminhos quentes que a auditoria mediu
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS pol_org_requisition_line_idx ON public.purchase_order_lines (organization_id, requisition_line_id)
  WHERE requisition_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS invmov_org_location_item_idx ON public.inventory_movements (organization_id, location_id, item_id);
CREATE INDEX IF NOT EXISTS rfql_org_requisition_line_idx ON public.procurement_rfq_lines (organization_id, requisition_line_id);
CREATE INDEX IF NOT EXISTS po_org_project_idx ON public.purchase_orders (organization_id, project_id) WHERE project_id IS NOT NULL;

-- Grants das funções reescritas pela geração (mesmos da origem: só o servidor).
DO $$
DECLARE sig text;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'internal_service_order_generate_from_package(uuid,uuid,uuid,jsonb)', 'internal_service_order_register_upload(uuid,uuid,uuid,jsonb)',
    'internal_service_order_apply_extraction(uuid,uuid,uuid)', 'internal_service_order_update_draft(uuid,uuid,uuid,jsonb)',
    'internal_service_order_item_upsert(uuid,uuid,uuid,jsonb)', 'internal_service_order_items_decide(uuid,uuid,uuid,jsonb)',
    'internal_service_order_amend(uuid,uuid,uuid,jsonb,text)', 'internal_service_order_seed_from_package(uuid,uuid,uuid)',
    'internal_service_order_record_divergence(uuid,uuid,uuid,jsonb)', 'project_requirement_upsert(uuid,uuid,jsonb)',
    'project_requirement_transition(uuid,uuid,uuid,text,text,uuid)', 'project_requirement_mark_satisfied(uuid,uuid,uuid,text,uuid,boolean)',
    'project_requirements_import_from_service_order(uuid,uuid,text,uuid)', 'supply_signal_link_followup(uuid,uuid,uuid,uuid)',
    'goods_receipt_inspect(uuid,uuid,uuid,jsonb)', 'inventory_transfer_request(uuid,uuid,jsonb)', 'inventory_adjust(uuid,uuid,jsonb)',
    'inventory_count_open(uuid,uuid,jsonb)', 'inventory_return_from_project(uuid,uuid,jsonb)',
    'goods_receipt_attach_evidence(uuid,uuid,uuid,jsonb)', 'purchase_order_decide(uuid,uuid,uuid,text,text)',
    'procurement_authority_declare(uuid,uuid,jsonb)', 'supply_item_upsert(uuid,uuid,jsonb)',
    'purchase_order_submit(uuid,uuid,uuid,text)', 'purchase_order_cancel(uuid,uuid,uuid,text)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', sig);
  END LOOP;
END $$;

COMMIT;
