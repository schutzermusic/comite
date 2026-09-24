-- ============================================================================
-- 232 — SUPPLY CHAIN: fundação — cadastro de itens e contrato de cobertura
--
-- ─── Supply começa pela DEMANDA ─────────────────────────────────────────
--
-- A demanda de material É o requisito MATERIAL confirmado do projeto (231).
-- Não nasce uma tabela "supply_requirements" copiando quantidade e data: o
-- que o Supply acrescenta ao requisito é o ITEM canônico (o que exatamente é
-- "cabo 35 mm") e a COBERTURA, que é derivada — reservas, transferências,
-- pedidos e recebimentos alocados ao requisito (233–235).
--
-- ─── Cadastro de itens ──────────────────────────────────────────────────
--
-- `supply_items` é a verdade de "que material é este": código interno por
-- inquilino, descrição, categoria, unidade base, fabricante/marca, atributos
-- técnicos e política de rastreio (lote/série). A IA pode sugerir
-- normalização; gravar item é ato governado.
--
-- ─── Contrato de cobertura ──────────────────────────────────────────────
--
-- `supply_requirement_coverage` define AGORA as colunas que Planejamento,
-- Supply e Projeto leem. Nesta migration todas as fontes são zero — não
-- existe alocação ainda — e cada wave seguinte substitui a visão acrescentando
-- a sua fonte, sem mudar o contrato.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Permissões do Supply (vocabulário `módulo.ação`, como o resto da base)
-- ---------------------------------------------------------------------------
INSERT INTO public.permissions (key, module, action, description) VALUES
  ('supply.view', 'supply', 'view', 'Ver Supply Chain: visão geral e planejamento de materiais'),
  ('supply.plan', 'supply', 'plan', 'Planejar materiais e manter o cadastro de itens'),
  ('inventory.view', 'inventory', 'view', 'Ver estoque, reservas e movimentações'),
  ('inventory.manage', 'inventory', 'manage', 'Locais, ajustes, contagens e transferências de estoque'),
  ('inventory.reserve', 'inventory', 'reserve', 'Reservar e liberar estoque para requisitos de projeto'),
  ('procurement.view', 'procurement', 'view', 'Ver compras: requisições, cotações, aprovações e pedidos'),
  ('procurement.request', 'procurement', 'request', 'Criar e submeter requisições de compra'),
  ('procurement.source', 'procurement', 'source', 'Conduzir cotação e propor a decisão de compra'),
  ('procurement.approve', 'procurement', 'approve', 'Aprovar decisão de compra dentro da alçada'),
  ('procurement.orders.issue', 'procurement', 'orders.issue', 'Emitir e cancelar pedido de compra aprovado'),
  ('receiving.view', 'receiving', 'view', 'Ver recebimentos e logística de entrada'),
  ('receiving.receive', 'receiving', 'receive', 'Registrar e postar recebimento físico'),
  ('suppliers.view', 'suppliers', 'view', 'Ver fornecedores (papel de parte canônica)'),
  ('suppliers.manage', 'suppliers', 'manage', 'Cadastrar fornecedor e manter homologação')
ON CONFLICT (key) DO NOTHING;

/*
  Critério da 211 — a alçada que cada papel já exerce:
    owner_admin       → tudo.
    ceo_diretoria     → ver tudo e APROVAR compra (decisão de gasto).
    financeiro        → ver, aprovar compra (gasto) e ver fornecedor.
    engenharia_pcp    → planejar, estocar, cotar, emitir pedido e receber (quem compra e recebe material).
    gestor_projetos   → ver, reservar para o próprio plano, requisitar e ver recebimento.
    juridico_contratos→ ver compras e fornecedores (instrumento com terceiro).
  Ninguém além de owner_admin e engenharia_pcp mantém fornecedor.
*/
WITH grants(role_key, perm_key) AS (VALUES
  ('ceo_diretoria','supply.view'), ('ceo_diretoria','inventory.view'), ('ceo_diretoria','procurement.view'),
  ('ceo_diretoria','procurement.approve'), ('ceo_diretoria','receiving.view'), ('ceo_diretoria','suppliers.view'),
  ('financeiro','supply.view'), ('financeiro','procurement.view'), ('financeiro','procurement.approve'),
  ('financeiro','receiving.view'), ('financeiro','suppliers.view'), ('financeiro','inventory.view'),
  ('engenharia_pcp','supply.view'), ('engenharia_pcp','supply.plan'), ('engenharia_pcp','inventory.view'),
  ('engenharia_pcp','inventory.manage'), ('engenharia_pcp','inventory.reserve'), ('engenharia_pcp','procurement.view'),
  ('engenharia_pcp','procurement.request'), ('engenharia_pcp','procurement.source'), ('engenharia_pcp','procurement.orders.issue'),
  ('engenharia_pcp','receiving.view'), ('engenharia_pcp','receiving.receive'), ('engenharia_pcp','suppliers.view'),
  ('engenharia_pcp','suppliers.manage'),
  ('gestor_projetos','supply.view'), ('gestor_projetos','inventory.view'), ('gestor_projetos','inventory.reserve'),
  ('gestor_projetos','procurement.view'), ('gestor_projetos','procurement.request'), ('gestor_projetos','receiving.view'),
  ('gestor_projetos','suppliers.view'),
  ('juridico_contratos','procurement.view'), ('juridico_contratos','suppliers.view'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM grants g
  JOIN public.roles r ON r.organization_id IS NULL AND r.key = g.role_key
  JOIN public.permissions p ON p.key = g.perm_key
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
 WHERE r.organization_id IS NULL AND r.key = 'owner_admin'
   AND p.module IN ('supply','inventory','procurement','receiving','suppliers')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 1b) FK composta com SET NULL anula SÓ a coluna de referência
--
-- `ON DELETE SET NULL` numa FK (organization_id, x) tentaria anular também
-- `organization_id` (NOT NULL) e a remoção do pai falharia com um erro opaco.
-- A forma por coluna (PG 15+) é a correta; as três FKs da 230 são corrigidas.
-- ---------------------------------------------------------------------------
ALTER TABLE public.internal_service_order_items
  DROP CONSTRAINT isoi_blueprint_tenant,
  DROP CONSTRAINT isoi_fact_tenant,
  DROP CONSTRAINT isoi_document_tenant;
ALTER TABLE public.internal_service_order_items
  ADD CONSTRAINT isoi_blueprint_tenant FOREIGN KEY (organization_id, blueprint_item_id)
    REFERENCES public.commercial_execution_blueprint_items (organization_id, id) ON DELETE SET NULL (blueprint_item_id),
  ADD CONSTRAINT isoi_fact_tenant FOREIGN KEY (organization_id, source_fact_id)
    REFERENCES public.commercial_extracted_facts (organization_id, id) ON DELETE SET NULL (source_fact_id),
  ADD CONSTRAINT isoi_document_tenant FOREIGN KEY (organization_id, source_document_id)
    REFERENCES public.contract_documents (organization_id, id) ON DELETE SET NULL (source_document_id);

-- ---------------------------------------------------------------------------
-- 2) Cadastro de itens
-- ---------------------------------------------------------------------------
CREATE TABLE public.supply_items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code                 text NOT NULL CHECK (code = upper(btrim(code)) AND code <> ''),
  description          text NOT NULL CHECK (btrim(description) <> ''),
  category             text,
  unit                 text NOT NULL CHECK (btrim(unit) <> ''),
  manufacturer         text,
  brand                text,
  technical_attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(technical_attributes) = 'object'),
  tracking             text NOT NULL DEFAULT 'NONE' CHECK (tracking IN ('NONE','LOT','SERIAL')),
  active               boolean NOT NULL DEFAULT true,
  specification_document_id uuid,
  created_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sitem_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT sitem_code_unique UNIQUE (organization_id, code),
  CONSTRAINT sitem_spec_document_tenant FOREIGN KEY (organization_id, specification_document_id)
    REFERENCES public.contract_documents (organization_id, id) ON DELETE SET NULL (specification_document_id)
);
CREATE INDEX sitem_active ON public.supply_items (organization_id, active, category);
CREATE TRIGGER sitem_touch BEFORE UPDATE ON public.supply_items
  FOR EACH ROW EXECUTE FUNCTION public.commercial_touch_updated_at();

COMMENT ON TABLE public.supply_items IS
  'Cadastro canônico de itens/materiais por inquilino. Nome livre de material não circula pela plataforma: o requisito aponta para cá.';

-- ---------------------------------------------------------------------------
-- 3) O requisito de MATERIAL aponta o item — e fala a unidade dele
-- ---------------------------------------------------------------------------
ALTER TABLE public.project_requirements ADD COLUMN IF NOT EXISTS item_id uuid;
ALTER TABLE public.project_requirements
  ADD CONSTRAINT preq_item_tenant FOREIGN KEY (organization_id, item_id)
    REFERENCES public.supply_items (organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT preq_item_only_for_supply CHECK (item_id IS NULL OR requirement_type IN ('MATERIAL','EXTERNAL_SERVICE'));
CREATE INDEX preq_item ON public.project_requirements (organization_id, item_id) WHERE item_id IS NOT NULL;

/*
  Material CONFIRMADO precisa do item: é o que permite ao Supply perguntar
  "quanto disto existe, onde, reservado para quem". E a unidade do requisito
  É a unidade do item — cobertura em metros contra estoque em rolos seria uma
  conta sem sentido que parece certa.
*/
CREATE OR REPLACE FUNCTION public.project_requirement_item_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_unit text; v_active boolean;
BEGIN
  IF NEW.item_id IS NOT NULL THEN
    SELECT unit, active INTO v_unit, v_active FROM public.supply_items
     WHERE organization_id = NEW.organization_id AND id = NEW.item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item not found in tenant.' USING ERRCODE = 'P0002';
    END IF;
    IF NEW.unit IS NULL THEN NEW.unit := v_unit; END IF;
    IF NEW.unit IS DISTINCT FROM v_unit THEN
      RAISE EXCEPTION 'Requirement unit (%) must be the item unit (%).', NEW.unit, v_unit USING ERRCODE = '23514';
    END IF;
    IF NOT v_active AND (TG_OP = 'INSERT' OR NEW.item_id IS DISTINCT FROM OLD.item_id) THEN
      RAISE EXCEPTION 'Item is inactive and cannot receive new demand.' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.status = 'CONFIRMED' AND NEW.requirement_type = 'MATERIAL' AND NEW.item_id IS NULL THEN
    RAISE EXCEPTION 'Requirement of MATERIAL needs a catalogued item before it is confirmed.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.project_requirement_item_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS preq_item_guard ON public.project_requirements;
CREATE TRIGGER preq_item_guard BEFORE INSERT OR UPDATE OF item_id, unit, status, requirement_type
  ON public.project_requirements FOR EACH ROW EXECUTE FUNCTION public.project_requirement_item_guard();

-- O upsert do requisito passa a aceitar o item (mesma função, mesmas regras da 231).
CREATE OR REPLACE FUNCTION public.project_requirement_upsert(
  p_organization_id uuid, p_actor uuid, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; r public.project_requirements%ROWTYPE; v_changes jsonb := '{}'::jsonb; k text;
BEGIN
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
END $$;

-- ---------------------------------------------------------------------------
-- 4) Cadastro de item — ato governado
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.supply_item_upsert(
  p_organization_id uuid, p_actor uuid, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_item public.supply_items%ROWTYPE; v_in_use boolean;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Item write denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Item write requires a named actor.' USING ERRCODE = '42501';
  END IF;
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
  -- Unidade e código de item EM USO não mudam: mudariam o significado de toda
  -- quantidade já planejada, reservada ou movimentada.
  v_in_use := EXISTS (SELECT 1 FROM public.project_requirements r
                       WHERE r.organization_id = p_organization_id AND r.item_id = v_id);
  IF v_in_use AND ((p_payload ? 'unit' AND btrim(p_payload->>'unit') <> v_item.unit)
                   OR (p_payload ? 'code' AND upper(btrim(p_payload->>'code')) <> v_item.code)) THEN
    RAISE EXCEPTION 'Item is in use: its code and unit do not change.' USING ERRCODE = '23514';
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
END $$;

-- ---------------------------------------------------------------------------
-- 5) Contrato de cobertura (fontes entram nas próximas migrations)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.supply_requirement_coverage
WITH (security_invoker = true) AS
SELECT
  r.organization_id, r.id AS requirement_id, r.project_id, r.activity_id, r.item_id, r.requirement_type,
  r.required_by, r.unit,
  r.quantity                     AS required_qty,
  0::numeric                     AS reserved_qty,
  0::numeric                     AS consumed_qty,
  0::numeric                     AS in_transit_qty,
  0::numeric                     AS on_order_qty,
  0::numeric                     AS requested_qty,
  0::numeric                     AS covered_qty,
  0::numeric                     AS inbound_qty,
  GREATEST(COALESCE(r.quantity, 0), 0) AS shortage_qty
FROM public.project_requirements r
WHERE r.status = 'CONFIRMED' AND r.requirement_type IN ('MATERIAL','EXTERNAL_SERVICE');

COMMENT ON VIEW public.supply_requirement_coverage IS
  'Cobertura DERIVADA por requisito de material: coberto = reservado + consumido; entrando = em trânsito + em pedido; falta = requerido − coberto − entrando. Nada é gravado.';
GRANT SELECT ON public.supply_requirement_coverage TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) Privilégios e RLS
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.supply_item_upsert(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supply_item_upsert(uuid,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.project_requirement_upsert(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_requirement_upsert(uuid,uuid,jsonb) TO service_role;

ALTER TABLE public.supply_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY sitem_select ON public.supply_items FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND (public.current_user_has_permission('supply.view')
          OR public.current_user_has_permission('inventory.view')
          OR public.current_user_has_permission('procurement.view')
          OR public.current_user_has_permission('operations.planning.view')
          OR public.current_user_has_permission('projects.view')));
REVOKE ALL ON TABLE public.supply_items FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.supply_items FROM authenticated;
GRANT SELECT ON TABLE public.supply_items TO authenticated;

COMMIT;
