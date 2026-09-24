-- ============================================================================
-- 230 — OPERAÇÕES: a OS interna vira o handoff governado Comercial → Operações
--
-- A OS interna (200) continua sendo A entidade canônica. Nada aqui cria uma
-- segunda OS, um segundo enum de estado ou um segundo motor de divergência.
-- O que a 230 acrescenta é o que o plano de Operações exige e a 200 não tinha:
--
--   1. PROVENIÊNCIA EXATA DO PACOTE. A OS guarda o aceite do pacote
--      (`commercial_proposal_context_acceptances`, 217) e as revisões regentes
--      de PT, PC (ou combinada) daquele instante. Capturada por GATILHO, para
--      que todo caminho de criação — Operações, fechamento comercial (213),
--      cadastro manual — grave a mesma coisa. Revisão posterior da proposta
--      NUNCA reescreve a OS: ela vira divergência PACKAGE_REVISION.
--   2. CONTEÚDO ESTRUTURADO. `internal_service_order_items`: escopo,
--      atividades, entregáveis, requisitos, dependências do cliente,
--      exclusões — cada linha com a proveniência dela (fato lido, página,
--      trecho, item de blueprint) e com confirmação humana distinguível da
--      leitura da IA.
--   3. IMUTABILIDADE PÓS-EMISSÃO. Campo material de OS emitida não se
--      reescreve: muda por EMENDA, que grava revisão nova em
--      `internal_service_order_revisions` (append-only). A emissão grava a
--      revisão 1 — o que foi emitido fica provado.
--   4. EXCEÇÃO GOVERNADA. Divergência BLOCKING continua segurando a emissão
--      normal. O único desvio é `internal_service_order_issue_with_exception`:
--      ator nomeado, permissão `operations.service_orders.override` conferida
--      NO BANCO, motivo escrito, divergências nomeadas, livro append-only.
--   5. CONFRONTO AMPLIADO E IDEMPOTENTE. Reexecutar o confronto não duplica
--      divergência; novas regras verificáveis (pacote mudou, entregável da PT
--      rejeitado na OS). Divergência SEMÂNTICA continua sendo trabalho de
--      leitura assistida (`detected_by = 'ai'`, com proveniência).
--   6. EVENTOS DE DOMÍNIO na mesma transação (criada, emitida, projeto
--      vinculado, emendada) — a Timeline do projeto lê daqui.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) Utilitários de plataforma usados por Operações e Supply
-- ---------------------------------------------------------------------------

/*
  A permissão do ATOR, resolvida no banco.

  As funções governadas rodam pelo service_role, onde `auth.uid()` é nulo e
  `current_user_has_permission` não serve. Para atos protegidos (exceção de
  emissão, aprovação de compra, emissão de pedido, postagem de recebimento) a
  rota confere a permissão ANTES — e o banco confere DE NOVO, com a mesma regra
  de `current_user_has_permission` (sobreposição `deny` vence `grant`, e ambas
  vencem o papel). É isso que permite gravar "sob qual permissão" (INV-15)
  como fato verificado, e não como afirmação do chamador.
*/
CREATE OR REPLACE FUNCTION public.apex_actor_has_permission(
  p_organization_id uuid, p_actor uuid, p_key text
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH perm AS (SELECT id FROM public.permissions WHERE key = p_key),
  ov AS (
    SELECT upo.effect FROM public.user_permission_overrides upo, perm
     WHERE upo.user_id = p_actor AND upo.organization_id = p_organization_id
       AND upo.permission_id = perm.id
     LIMIT 1)
  SELECT CASE
    WHEN p_actor IS NULL OR p_organization_id IS NULL THEN false
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

-- Livro não se reescreve — para NINGUÉM. Apagar segue a regra canônica
-- (`contracts_reject_history_erasure`): recusado à aplicação, permitido ao
-- caminho privilegiado de remoção de inquilino.
CREATE OR REPLACE FUNCTION public.operations_reject_history_rewrite()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION '% não se reescreve: é livro append-only.', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION public.operations_reject_history_rewrite() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1) Permissões de Operações
-- ---------------------------------------------------------------------------
INSERT INTO public.permissions (key, module, action, description) VALUES
  ('operations.view', 'operations', 'view',
   'Ver Operações: visão geral, ordens de serviço, planejamento e mapa'),
  ('operations.service_orders.override', 'operations', 'service_orders.override',
   'Emitir OS interna sob exceção governada apesar de divergência bloqueante'),
  ('operations.planning.view', 'operations', 'planning.view',
   'Ver planejamento de execução e requisitos'),
  ('operations.planning.manage', 'operations', 'planning.manage',
   'Criar, confirmar e cancelar requisitos de execução')
ON CONFLICT (key) DO NOTHING;

-- Critério da 211: a alçada que cada papel JÁ exerce.
--   owner_admin   → módulo inteiro.
--   ceo_diretoria → ver; e a EXCEÇÃO de emissão (decisão de risco da direção).
--   gestor_projetos / engenharia_pcp → ver e planejar.
--   juridico_contratos → ver (responde pela OS no fechamento).
WITH grants(role_key, perm_key) AS (VALUES
  ('owner_admin','operations.view'), ('owner_admin','operations.service_orders.override'),
  ('owner_admin','operations.planning.view'), ('owner_admin','operations.planning.manage'),
  ('ceo_diretoria','operations.view'), ('ceo_diretoria','operations.service_orders.override'),
  ('ceo_diretoria','operations.planning.view'),
  ('gestor_projetos','operations.view'), ('gestor_projetos','operations.planning.view'),
  ('gestor_projetos','operations.planning.manage'),
  ('engenharia_pcp','operations.view'), ('engenharia_pcp','operations.planning.view'),
  ('engenharia_pcp','operations.planning.manage'),
  ('juridico_contratos','operations.view'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM grants g
  JOIN public.roles r ON r.organization_id IS NULL AND r.key = g.role_key
  JOIN public.permissions p ON p.key = g.perm_key
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) Divergência: os escopos que o confronto OS × PT × PC precisa nomear
-- ---------------------------------------------------------------------------
ALTER TABLE public.commercial_divergences DROP CONSTRAINT IF EXISTS commercial_divergences_scope_check;
ALTER TABLE public.commercial_divergences ADD CONSTRAINT commercial_divergences_scope_check
  CHECK (scope IN ('VALUE','SCOPE','DATES','MEASUREMENT_RULE','BILLING_CONDITION','PAYMENT_TERMS',
                   'DELIVERABLE','EVIDENCE_REQUIREMENT','OTHER',
                   'TECHNICAL_REQUIREMENT','MATERIAL','CUSTOMER_DEPENDENCY','EXCLUSION',
                   'COMMERCIAL_REFERENCE','PACKAGE_REVISION'));

-- ---------------------------------------------------------------------------
-- 3) OS: a proveniência do pacote e o local da obra
-- ---------------------------------------------------------------------------
ALTER TABLE public.internal_service_orders
  ADD COLUMN IF NOT EXISTS source_context_acceptance_id uuid,
  ADD COLUMN IF NOT EXISTS governing_technical_revision_id uuid,
  ADD COLUMN IF NOT EXISTS governing_commercial_revision_id uuid,
  ADD COLUMN IF NOT EXISTS governing_combined_revision_id uuid,
  ADD COLUMN IF NOT EXISTS site_label text;

ALTER TABLE public.internal_service_orders
  ADD CONSTRAINT iso_acceptance_tenant FOREIGN KEY (organization_id, source_context_acceptance_id)
    REFERENCES public.commercial_proposal_context_acceptances (organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT iso_gov_technical_tenant FOREIGN KEY (organization_id, governing_technical_revision_id)
    REFERENCES public.commercial_proposal_revisions (organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT iso_gov_commercial_tenant FOREIGN KEY (organization_id, governing_commercial_revision_id)
    REFERENCES public.commercial_proposal_revisions (organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT iso_gov_combined_tenant FOREIGN KEY (organization_id, governing_combined_revision_id)
    REFERENCES public.commercial_proposal_revisions (organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT iso_site_label_nonblank CHECK (site_label IS NULL OR btrim(site_label) <> '');

-- Um pacote aceito produz UMA OS governada viva (idempotência do "Gerar").
CREATE UNIQUE INDEX IF NOT EXISTS iso_one_per_package
  ON public.internal_service_orders (organization_id, source_context_acceptance_id)
  WHERE source_context_acceptance_id IS NOT NULL AND status <> 'CANCELLED';

COMMENT ON COLUMN public.internal_service_orders.source_context_acceptance_id IS
  'Aceite do pacote PT+PC (217) que originou a OS. Revisão posterior da proposta não reescreve a OS: vira divergência PACKAGE_REVISION.';

/*
  O pacote exato, resolvido de uma revisão aceita. Regra ÚNICA, usada pelo
  gatilho de captura, pelo confronto e pelo backfill: a linha de aceite
  COMPLETA mais recente que contém a revisão. Sem linha de aceite (revisão
  isolada sem contexto pareado), só o papel da própria revisão é conhecido.
*/
CREATE OR REPLACE FUNCTION public.operations_package_of_revision(
  p_organization_id uuid, p_revision_id uuid
) RETURNS TABLE (acceptance_id uuid, technical_revision_id uuid,
                 commercial_revision_id uuid, combined_revision_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.commercial_proposal_context_acceptances%ROWTYPE; v_kind text;
BEGIN
  SELECT * INTO a FROM public.commercial_proposal_context_acceptances x
   WHERE x.organization_id = p_organization_id AND x.complete
     AND p_revision_id IN (x.technical_revision_id, x.commercial_revision_id, x.combined_revision_id)
   ORDER BY x.accepted_at DESC, x.created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT a.id, a.technical_revision_id, a.commercial_revision_id, a.combined_revision_id;
    RETURN;
  END IF;
  SELECT p.kind INTO v_kind FROM public.commercial_proposal_revisions r
    JOIN public.commercial_proposals p ON p.organization_id = r.organization_id AND p.id = r.proposal_id
   WHERE r.organization_id = p_organization_id AND r.id = p_revision_id;
  RETURN QUERY SELECT NULL::uuid,
    CASE WHEN v_kind = 'TECHNICAL' THEN p_revision_id END,
    CASE WHEN v_kind = 'COMMERCIAL' THEN p_revision_id END,
    CASE WHEN v_kind = 'COMBINED' THEN p_revision_id END;
END $$;
REVOKE ALL ON FUNCTION public.operations_package_of_revision(uuid,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.internal_service_order_capture_package()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE pkg record;
BEGIN
  IF NEW.source_proposal_revision_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.source_context_acceptance_id IS NOT NULL
     OR COALESCE(NEW.governing_technical_revision_id, NEW.governing_commercial_revision_id,
                 NEW.governing_combined_revision_id) IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO pkg FROM public.operations_package_of_revision(NEW.organization_id, NEW.source_proposal_revision_id);
  NEW.source_context_acceptance_id := pkg.acceptance_id;
  NEW.governing_technical_revision_id := pkg.technical_revision_id;
  NEW.governing_commercial_revision_id := pkg.commercial_revision_id;
  NEW.governing_combined_revision_id := pkg.combined_revision_id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.internal_service_order_capture_package() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS iso_capture_package ON public.internal_service_orders;
CREATE TRIGGER iso_capture_package BEFORE INSERT ON public.internal_service_orders
  FOR EACH ROW EXECUTE FUNCTION public.internal_service_order_capture_package();

-- ---------------------------------------------------------------------------
-- 4) Conteúdo estruturado da OS
-- ---------------------------------------------------------------------------
CREATE TABLE public.internal_service_order_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  service_order_id    uuid NOT NULL,

  kind                text NOT NULL CHECK (kind IN (
                        'SCOPE','ACTIVITY','DELIVERABLE','TECHNICAL_REQUIREMENT','MATERIAL',
                        'EQUIPMENT','WORKFORCE','RESOURCE','CUSTOMER_DEPENDENCY','ASSUMPTION',
                        'EXCLUSION','TEST','MEASUREMENT_CONDITION','COMMERCIAL_REFERENCE',
                        'DOCUMENT','MILESTONE','RISK')),
  position            integer NOT NULL DEFAULT 0,
  title               text NOT NULL CHECK (btrim(title) <> ''),
  detail              text,
  quantity            numeric(18,4) CHECK (quantity IS NULL OR quantity > 0),
  unit                text,
  planned_date        date,

  -- De onde a linha veio. Sem esta coluna, "a IA leu" e "alguém digitou"
  -- seriam a mesma coisa na tela.
  origin              text NOT NULL CHECK (origin IN ('proposal_package','document_extraction','manual')),
  source_document_kind text CHECK (source_document_kind IS NULL OR source_document_kind IN (
                        'TECHNICAL_PROPOSAL','COMMERCIAL_PROPOSAL','INTERNAL_SERVICE_ORDER')),
  source_revision_id  uuid,
  blueprint_item_id   uuid,
  source_fact_id      uuid,
  source_document_id  uuid,
  source_page         integer CHECK (source_page IS NULL OR source_page > 0),
  source_quote        text,
  ai_provider         text,
  ai_model            text,
  confidence          numeric(5,4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),

  confirmation_state  text NOT NULL DEFAULT 'UNCONFIRMED'
                        CHECK (confirmation_state IN ('UNCONFIRMED','CONFIRMED','REJECTED')),
  confirmed_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at        timestamptz,

  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT isoi_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT isoi_order_tenant FOREIGN KEY (organization_id, service_order_id)
    REFERENCES public.internal_service_orders (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT isoi_revision_tenant FOREIGN KEY (organization_id, source_revision_id)
    REFERENCES public.commercial_proposal_revisions (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT isoi_blueprint_tenant FOREIGN KEY (organization_id, blueprint_item_id)
    REFERENCES public.commercial_execution_blueprint_items (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT isoi_fact_tenant FOREIGN KEY (organization_id, source_fact_id)
    REFERENCES public.commercial_extracted_facts (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT isoi_document_tenant FOREIGN KEY (organization_id, source_document_id)
    REFERENCES public.contract_documents (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT isoi_confirmation_attributed CHECK (
    (confirmation_state IN ('CONFIRMED','REJECTED')) = (confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL)),
  CONSTRAINT isoi_ai_provenance CHECK (
    origin <> 'document_extraction' OR (ai_provider IS NOT NULL AND ai_model IS NOT NULL)),
  CONSTRAINT isoi_quantity_unit CHECK (quantity IS NULL OR nullif(btrim(unit), '') IS NOT NULL)
);
CREATE INDEX isoi_order ON public.internal_service_order_items (organization_id, service_order_id, position);
-- Semear do pacote e aplicar a leitura são idempotentes: o mesmo fato não vira duas linhas.
CREATE UNIQUE INDEX isoi_fact_once ON public.internal_service_order_items (organization_id, service_order_id, source_fact_id)
  WHERE source_fact_id IS NOT NULL;
CREATE UNIQUE INDEX isoi_blueprint_once ON public.internal_service_order_items (organization_id, service_order_id, blueprint_item_id)
  WHERE blueprint_item_id IS NOT NULL;

CREATE TRIGGER isoi_touch BEFORE UPDATE ON public.internal_service_order_items
  FOR EACH ROW EXECUTE FUNCTION public.commercial_touch_updated_at();

COMMENT ON TABLE public.internal_service_order_items IS
  'Conteúdo estruturado da OS interna, com proveniência por linha. Imutável depois da emissão, exceto por emenda (nova revisão).';

-- ---------------------------------------------------------------------------
-- 5) Revisões da OS — o que foi emitido, e cada emenda
-- ---------------------------------------------------------------------------
CREATE TABLE public.internal_service_order_revisions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  service_order_id uuid NOT NULL,
  revision         integer NOT NULL CHECK (revision >= 1),
  kind             text NOT NULL CHECK (kind IN ('ISSUE','AMENDMENT','BACKFILL')),
  snapshot         jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  reason           text,
  actor_user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT isor_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT isor_revision_once UNIQUE (organization_id, service_order_id, revision),
  CONSTRAINT isor_order_tenant FOREIGN KEY (organization_id, service_order_id)
    REFERENCES public.internal_service_orders (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT isor_amendment_has_reason CHECK (kind <> 'AMENDMENT' OR nullif(btrim(reason), '') IS NOT NULL)
);
CREATE TRIGGER isor_no_rewrite BEFORE UPDATE ON public.internal_service_order_revisions
  FOR EACH ROW EXECUTE FUNCTION public.operations_reject_history_rewrite();
CREATE TRIGGER isor_no_erasure BEFORE DELETE ON public.internal_service_order_revisions
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

-- ---------------------------------------------------------------------------
-- 6) Exceção governada de emissão
-- ---------------------------------------------------------------------------
CREATE TABLE public.internal_service_order_issue_exceptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  service_order_id       uuid NOT NULL,
  divergence_ids         uuid[] NOT NULL CHECK (cardinality(divergence_ids) > 0),
  reason                 text NOT NULL CHECK (length(btrim(reason)) >= 20),
  evidence_document_id   uuid,
  authorized_by          uuid NOT NULL REFERENCES auth.users(id),
  authorized_permission  text NOT NULL CHECK (authorized_permission = 'operations.service_orders.override'),
  created_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT isoe_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT isoe_order_tenant FOREIGN KEY (organization_id, service_order_id)
    REFERENCES public.internal_service_orders (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT isoe_evidence_tenant FOREIGN KEY (organization_id, evidence_document_id)
    REFERENCES public.contract_documents (organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX isoe_order ON public.internal_service_order_issue_exceptions (organization_id, service_order_id);
CREATE TRIGGER isoe_no_rewrite BEFORE UPDATE ON public.internal_service_order_issue_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.operations_reject_history_rewrite();
CREATE TRIGGER isoe_no_erasure BEFORE DELETE ON public.internal_service_order_issue_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

-- ---------------------------------------------------------------------------
-- 7) Imutabilidade pós-emissão — cabeçalho e itens
--
-- O único desvio é a EMENDA governada, que abre a janela para AQUELA OS
-- (`apex.iso_amendment` = id da OS, local à transação) e grava a revisão.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.internal_service_order_is_locked(p_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_status IN ('ISSUED','IN_EXECUTION','SUSPENDED','CLOSED','CANCELLED')
$$;

CREATE OR REPLACE FUNCTION public.internal_service_order_amendment_open(p_service_order_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('apex.iso_amendment', true), '') IN (p_service_order_id::text, 'migration')
$$;

CREATE OR REPLACE FUNCTION public.internal_service_order_material_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.internal_service_order_is_locked(OLD.status) THEN RETURN NEW; END IF;
  IF public.internal_service_order_amendment_open(OLD.id) THEN RETURN NEW; END IF;
  IF NEW.os_number IS DISTINCT FROM OLD.os_number
  OR NEW.title IS DISTINCT FROM OLD.title
  OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
  OR NEW.origin IS DISTINCT FROM OLD.origin
  OR NEW.source_proposal_revision_id IS DISTINCT FROM OLD.source_proposal_revision_id
  OR NEW.document_id IS DISTINCT FROM OLD.document_id
  OR NEW.authorized_value IS DISTINCT FROM OLD.authorized_value
  OR NEW.currency IS DISTINCT FROM OLD.currency
  OR NEW.scope_summary IS DISTINCT FROM OLD.scope_summary
  OR NEW.planned_start IS DISTINCT FROM OLD.planned_start
  OR NEW.planned_finish IS DISTINCT FROM OLD.planned_finish
  OR NEW.site_label IS DISTINCT FROM OLD.site_label
  OR NEW.source_context_acceptance_id IS DISTINCT FROM OLD.source_context_acceptance_id
  OR NEW.governing_technical_revision_id IS DISTINCT FROM OLD.governing_technical_revision_id
  OR NEW.governing_commercial_revision_id IS DISTINCT FROM OLD.governing_commercial_revision_id
  OR NEW.governing_combined_revision_id IS DISTINCT FROM OLD.governing_combined_revision_id THEN
    RAISE EXCEPTION 'Service order is issued: material fields change only through a governed amendment.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.internal_service_order_material_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS iso_material_guard ON public.internal_service_orders;
CREATE TRIGGER iso_material_guard BEFORE UPDATE ON public.internal_service_orders
  FOR EACH ROW EXECUTE FUNCTION public.internal_service_order_material_guard();

CREATE OR REPLACE FUNCTION public.internal_service_order_items_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_status text; v_order uuid;
BEGIN
  v_order := CASE WHEN TG_OP = 'DELETE' THEN OLD.service_order_id ELSE NEW.service_order_id END;
  SELECT status INTO v_status FROM public.internal_service_orders WHERE id = v_order;
  -- OS já removida (remoção privilegiada de inquilino em cascata): nada a guardar.
  IF v_status IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF public.internal_service_order_is_locked(v_status)
     AND NOT public.internal_service_order_amendment_open(v_order) THEN
    RAISE EXCEPTION 'Service order is issued: its content changes only through a governed amendment.'
      USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.internal_service_order_items_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER isoi_guard BEFORE INSERT OR UPDATE OR DELETE ON public.internal_service_order_items
  FOR EACH ROW EXECUTE FUNCTION public.internal_service_order_items_guard();

-- ---------------------------------------------------------------------------
-- 8) Instantâneo — a mesma forma para emissão, emenda e backfill
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.internal_service_order_snapshot(
  p_organization_id uuid, p_service_order_id uuid
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'os_number', o.os_number, 'title', o.title, 'origin', o.origin, 'status', o.status,
    'engagement_id', o.engagement_id,
    'authorized_value', o.authorized_value, 'currency', o.currency,
    'scope_summary', o.scope_summary, 'site_label', o.site_label,
    'planned_start', o.planned_start, 'planned_finish', o.planned_finish,
    'source_proposal_revision_id', o.source_proposal_revision_id,
    'source_context_acceptance_id', o.source_context_acceptance_id,
    'governing_technical_revision_id', o.governing_technical_revision_id,
    'governing_commercial_revision_id', o.governing_commercial_revision_id,
    'governing_combined_revision_id', o.governing_combined_revision_id,
    'document_id', o.document_id,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'kind', i.kind, 'title', i.title, 'detail', i.detail,
        'quantity', i.quantity, 'unit', i.unit, 'planned_date', i.planned_date,
        'origin', i.origin, 'confirmation_state', i.confirmation_state,
        'source_fact_id', i.source_fact_id, 'blueprint_item_id', i.blueprint_item_id)
        ORDER BY i.position, i.created_at)
        FROM public.internal_service_order_items i
       WHERE i.organization_id = o.organization_id AND i.service_order_id = o.id
         AND i.confirmation_state <> 'REJECTED'), '[]'::jsonb))
  FROM public.internal_service_orders o
  WHERE o.organization_id = p_organization_id AND o.id = p_service_order_id
$$;
REVOKE ALL ON FUNCTION public.internal_service_order_snapshot(uuid,uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9) O portão de emissão — o mesmo gatilho, com a exceção e a revisão humana
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.internal_service_order_issue_gate()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_blocking int; v_authorized int; v_unreviewed int;
BEGIN
  IF NEW.status <> 'ISSUED' OR OLD.status = 'ISSUED' THEN RETURN NEW; END IF;

  /*
    Divergência BLOCKING aberta segura a emissão. A única que NÃO segura é a
    que está nomeada numa exceção governada desta OS — e a exceção é livro,
    com ator, permissão e motivo.
  */
  SELECT count(*)::int INTO v_blocking
    FROM public.commercial_divergences d
   WHERE d.organization_id = NEW.organization_id
     AND d.severity = 'BLOCKING' AND d.state = 'OPEN'
     AND (d.service_order_id = NEW.id OR d.engagement_id = NEW.engagement_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.internal_service_order_issue_exceptions e
        WHERE e.organization_id = NEW.organization_id AND e.service_order_id = NEW.id
          AND d.id = ANY (e.divergence_ids));
  IF v_blocking > 0 THEN
    RAISE EXCEPTION 'Service order cannot be issued: % blocking divergence(s) still open.', v_blocking
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::int INTO v_authorized
    FROM public.commercial_engagement_authorizations a
   WHERE a.organization_id = NEW.organization_id
     AND a.engagement_id = NEW.engagement_id
     AND a.state = 'ACTIVE' AND a.governing;
  IF v_authorized = 0 THEN
    RAISE EXCEPTION 'Service order cannot be issued: engagement has no governing authorization.'
      USING ERRCODE = '23514';
  END IF;

  -- Leitura da IA não vira autorização operacional sem revisão humana.
  SELECT count(*)::int INTO v_unreviewed
    FROM public.internal_service_order_items i
   WHERE i.organization_id = NEW.organization_id AND i.service_order_id = NEW.id
     AND i.confirmation_state = 'UNCONFIRMED';
  IF v_unreviewed > 0 THEN
    RAISE EXCEPTION 'Service order cannot be issued: % content line(s) still awaiting human review.', v_unreviewed
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- 10) Efeitos da transição: revisão emitida + fatos de domínio
--
-- Por gatilho, e não dentro de cada função, porque a OS é emitida e vinculada
-- por mais de um caminho (Operações e fechamento comercial). Um gatilho só é
-- a garantia de que nenhum caminho esquece a revisão ou o evento.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.internal_service_order_after_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.emit_domain_event(
      NEW.organization_id, 'operations.service_order.created', 1, 'internal_service_order', NEW.id,
      'service-order:' || NEW.id || ':created',
      jsonb_build_object('engagement_id', NEW.engagement_id, 'origin', NEW.origin,
                         'os_number', NEW.os_number,
                         'source_context_acceptance_id', NEW.source_context_acceptance_id),
      NEW.created_at, 'human', NEW.created_by);
    RETURN NULL;
  END IF;

  IF NEW.status = 'ISSUED' AND OLD.status IS DISTINCT FROM 'ISSUED'
     AND NOT public.internal_service_order_is_locked(OLD.status) THEN
    INSERT INTO public.internal_service_order_revisions
      (organization_id, service_order_id, revision, kind, snapshot, actor_user_id)
    VALUES (NEW.organization_id, NEW.id, 1, 'ISSUE',
            public.internal_service_order_snapshot(NEW.organization_id, NEW.id), NEW.issued_by)
    ON CONFLICT (organization_id, service_order_id, revision) DO NOTHING;
    PERFORM public.emit_domain_event(
      NEW.organization_id, 'operations.service_order.issued', 1, 'internal_service_order', NEW.id,
      'service-order:' || NEW.id || ':issued',
      jsonb_build_object('engagement_id', NEW.engagement_id, 'os_number', NEW.os_number,
        'with_exception', EXISTS (SELECT 1 FROM public.internal_service_order_issue_exceptions e
                                   WHERE e.organization_id = NEW.organization_id AND e.service_order_id = NEW.id)),
      NEW.issued_at, 'human', NEW.issued_by);
  END IF;

  IF NEW.project_id IS NOT NULL AND OLD.project_id IS NULL THEN
    PERFORM public.emit_domain_event(
      NEW.organization_id, 'operations.service_order.project_linked', 1, 'internal_service_order', NEW.id,
      'service-order:' || NEW.id || ':project:' || NEW.project_id,
      jsonb_build_object('project_id', NEW.project_id, 'engagement_id', NEW.engagement_id,
                         'os_number', NEW.os_number),
      now(), 'system', NULL);
  END IF;

  IF NEW.status = 'CANCELLED' AND OLD.status IS DISTINCT FROM 'CANCELLED' THEN
    PERFORM public.emit_domain_event(
      NEW.organization_id, 'operations.service_order.cancelled', 1, 'internal_service_order', NEW.id,
      'service-order:' || NEW.id || ':cancelled',
      jsonb_build_object('os_number', NEW.os_number), NEW.cancelled_at, 'system', NULL);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.internal_service_order_after_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS iso_after_insert ON public.internal_service_orders;
CREATE TRIGGER iso_after_insert AFTER INSERT ON public.internal_service_orders
  FOR EACH ROW EXECUTE FUNCTION public.internal_service_order_after_change();
DROP TRIGGER IF EXISTS iso_after_update ON public.internal_service_orders;
CREATE TRIGGER iso_after_update AFTER UPDATE OF status, project_id ON public.internal_service_orders
  FOR EACH ROW EXECUTE FUNCTION public.internal_service_order_after_change();

-- ---------------------------------------------------------------------------
-- 11) Confronto com a fonte regente — idempotente e ampliado
-- ---------------------------------------------------------------------------

-- Abre divergência só se a MESMA pergunta ainda não está em aberto. Reexecutar
-- o confronto não pode inflar a fila de decisão.
CREATE OR REPLACE FUNCTION public.internal_service_order_open_divergence(
  p_os public.internal_service_orders, p_scope text, p_field text,
  p_left_kind text, p_left_id uuid, p_left_value text,
  p_right_value text, p_severity text, p_summary text
) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.commercial_divergences d
     WHERE d.organization_id = p_os.organization_id AND d.service_order_id = p_os.id
       AND d.scope = p_scope AND d.field_path IS NOT DISTINCT FROM p_field
       AND d.left_source_id IS NOT DISTINCT FROM p_left_id
       AND d.left_value IS NOT DISTINCT FROM p_left_value
       AND d.right_value IS NOT DISTINCT FROM p_right_value
       AND d.state IN ('OPEN','ACKNOWLEDGED')) THEN
    RETURN 0;
  END IF;
  INSERT INTO public.commercial_divergences (
    organization_id, engagement_id, service_order_id, scope, field_path,
    left_source_kind, left_source_id, left_value,
    right_source_kind, right_source_id, right_value,
    severity, summary, detected_by)
  VALUES (p_os.organization_id, p_os.engagement_id, p_os.id, p_scope, p_field,
          p_left_kind, p_left_id, p_left_value,
          'internal_service_order', p_os.id, p_right_value,
          p_severity, p_summary, 'rule');
  RETURN 1;
END $$;
REVOKE ALL ON FUNCTION public.internal_service_order_open_divergence(
  public.internal_service_orders, text, text, text, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.internal_service_order_compare_with_governing(
  p_organization_id uuid, p_service_order_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_os public.internal_service_orders%ROWTYPE;
  v_gov public.commercial_engagement_authorizations%ROWTYPE;
  v_rev public.commercial_proposal_revisions%ROWTYPE;
  v_opened int := 0;
  v_rev_id uuid; v_newer record; b record;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Service order comparison denied.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_os FROM public.internal_service_orders
   WHERE organization_id = p_organization_id AND id = p_service_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service order not found in tenant.' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_gov FROM public.commercial_engagement_authorizations
   WHERE organization_id = p_organization_id AND engagement_id = v_os.engagement_id
     AND governing AND state = 'ACTIVE';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('service_order_id', p_service_order_id,
                              'compared', false, 'reason', 'NO_GOVERNING_SOURCE');
  END IF;

  IF v_gov.proposal_revision_id IS NOT NULL THEN
    SELECT * INTO v_rev FROM public.commercial_proposal_revisions
     WHERE organization_id = p_organization_id AND id = v_gov.proposal_revision_id;
  END IF;

  -- VALOR. Bloqueia: é o número que o faturamento usa.
  IF v_os.authorized_value IS NOT NULL AND v_gov.authorized_value IS NOT NULL
     AND v_os.authorized_value <> v_gov.authorized_value THEN
    v_opened := v_opened + public.internal_service_order_open_divergence(v_os, 'VALUE', 'authorized_value',
      v_gov.source_kind, v_gov.id, v_gov.authorized_value::text, v_os.authorized_value::text, 'BLOCKING',
      format('OS interna declara %s; a fonte regente declara %s.', v_os.authorized_value, v_gov.authorized_value));
  END IF;

  -- DATAS contra a vigência da fonte regente.
  IF v_os.planned_finish IS NOT NULL AND v_gov.effective_until IS NOT NULL
     AND v_os.planned_finish > v_gov.effective_until THEN
    v_opened := v_opened + public.internal_service_order_open_divergence(v_os, 'DATES', 'planned_finish',
      v_gov.source_kind, v_gov.id, v_gov.effective_until::text, v_os.planned_finish::text, 'WARNING',
      'Término planejado na OS interna ultrapassa a vigência da fonte regente.');
  END IF;

  -- ESCOPO: só a AUSÊNCIA de escopo é fato verificável por regra.
  IF v_rev.id IS NOT NULL
     AND nullif(btrim(v_os.scope_summary), '') IS NULL
     AND nullif(btrim(v_rev.scope_summary), '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.internal_service_order_items i
                      WHERE i.organization_id = v_os.organization_id AND i.service_order_id = v_os.id
                        AND i.kind = 'SCOPE' AND i.confirmation_state <> 'REJECTED') THEN
    v_opened := v_opened + public.internal_service_order_open_divergence(v_os, 'SCOPE', 'scope_summary',
      'accepted_proposal', v_rev.id, left(v_rev.scope_summary, 500), NULL, 'WARNING',
      'A OS interna não declara escopo; a proposta regente declara.');
  END IF;

  /*
    PACOTE MUDOU. A OS aponta revisões exatas; se o cliente aceitou revisão
    POSTERIOR de qualquer documento do pacote, a OS executaria sob uma verdade
    que não é mais a regente. Bloqueia até alguém decidir (emendar a OS ou
    confirmar que a revisão nova não muda a execução).
  */
  FOREACH v_rev_id IN ARRAY ARRAY[v_os.governing_technical_revision_id,
                                  v_os.governing_commercial_revision_id,
                                  v_os.governing_combined_revision_id] LOOP
    CONTINUE WHEN v_rev_id IS NULL;
    SELECT n.id, n.revision, p.proposal_number, o.revision AS old_revision INTO v_newer
      FROM public.commercial_proposal_revisions o
      JOIN public.commercial_proposal_revisions n
        ON n.organization_id = o.organization_id AND n.proposal_id = o.proposal_id
       AND n.revision > o.revision AND n.status = 'ACCEPTED'
      JOIN public.commercial_proposals p ON p.organization_id = o.organization_id AND p.id = o.proposal_id
     WHERE o.organization_id = p_organization_id AND o.id = v_rev_id
     ORDER BY n.revision DESC LIMIT 1;
    IF v_newer.id IS NOT NULL THEN
      v_opened := v_opened + public.internal_service_order_open_divergence(v_os, 'PACKAGE_REVISION',
        'governing_revision', 'accepted_proposal', v_newer.id, 'R' || lpad(v_newer.revision::text, 2, '0'),
        'R' || lpad(v_newer.old_revision::text, 2, '0'), 'BLOCKING',
        format('%s: o cliente aceitou a R%s depois da OS, que foi gerada da R%s.',
               v_newer.proposal_number, lpad(v_newer.revision::text, 2, '0'),
               lpad(v_newer.old_revision::text, 2, '0')));
    END IF;
  END LOOP;

  /*
    O QUE A OS DEIXOU DE FORA. Só para a OS gerada do pacote: cada entregável,
    dependência do cliente e exclusão que a PT declara e que a revisão da OS
    REJEITOU vira aviso — execução sem entregável acordado é o tipo de
    diferença que aparece na medição, tarde demais.
  */
  FOR b IN
    SELECT i.id, i.kind, i.title
      FROM public.internal_service_order_items i
     WHERE i.organization_id = v_os.organization_id AND i.service_order_id = v_os.id
       AND i.origin = 'proposal_package' AND i.confirmation_state = 'REJECTED'
       AND i.kind IN ('DELIVERABLE','CUSTOMER_DEPENDENCY','EXCLUSION')
  LOOP
    v_opened := v_opened + public.internal_service_order_open_divergence(v_os,
      CASE b.kind WHEN 'DELIVERABLE' THEN 'DELIVERABLE'
                  WHEN 'CUSTOMER_DEPENDENCY' THEN 'CUSTOMER_DEPENDENCY' ELSE 'EXCLUSION' END,
      'item:' || b.id, 'accepted_proposal', b.id, left(b.title, 500), NULL, 'WARNING',
      format('A proposta regente declara "%s"; a revisão da OS retirou esta linha.', left(b.title, 160)));
  END LOOP;

  IF v_opened > 0 AND v_os.status = 'DRAFT' THEN
    UPDATE public.internal_service_orders SET status = 'PENDING_CONFIRMATION'
     WHERE organization_id = p_organization_id AND id = p_service_order_id;
  END IF;

  RETURN jsonb_build_object('service_order_id', p_service_order_id, 'compared', true,
                            'divergences_opened', v_opened,
                            'governing_source_kind', v_gov.source_kind);
END $$;

/*
  Divergência CANDIDATA vinda de leitura assistida (ou de gente). Nunca decide:
  abre para decisão humana, com proveniência. A IA propõe a severidade; quem
  resolve diz qual fonte prevalece.
*/
CREATE OR REPLACE FUNCTION public.internal_service_order_record_divergence(
  p_organization_id uuid, p_actor uuid, p_service_order_id uuid, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_os public.internal_service_orders%ROWTYPE; v_id uuid; v_by text;
BEGIN
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
END $$;

-- ---------------------------------------------------------------------------
-- 12) Conteúdo: semear do pacote, aplicar a leitura, editar o rascunho
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.operations_item_kind_for_fact(p_domain text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_domain
    WHEN 'SCOPE' THEN 'SCOPE' WHEN 'DELIVERABLE' THEN 'DELIVERABLE'
    WHEN 'REQUIREMENT' THEN 'TECHNICAL_REQUIREMENT' WHEN 'TEST' THEN 'TEST'
    WHEN 'RESOURCE' THEN 'RESOURCE' WHEN 'EXCLUSION' THEN 'EXCLUSION'
    WHEN 'DEPENDENCY' THEN 'CUSTOMER_DEPENDENCY' WHEN 'DOCUMENT' THEN 'DOCUMENT'
    WHEN 'DATE' THEN 'MILESTONE' WHEN 'MILESTONE' THEN 'MILESTONE'
    WHEN 'MEASUREMENT_RULE' THEN 'MEASUREMENT_CONDITION'
    WHEN 'ACCEPTANCE_CONDITION' THEN 'MEASUREMENT_CONDITION'
    WHEN 'BILLING_MILESTONE' THEN 'COMMERCIAL_REFERENCE' WHEN 'BILLING_PREREQUISITE' THEN 'COMMERCIAL_REFERENCE'
    WHEN 'PAYMENT_TERM' THEN 'COMMERCIAL_REFERENCE' WHEN 'VALUE' THEN 'COMMERCIAL_REFERENCE'
    WHEN 'RATE' THEN 'COMMERCIAL_REFERENCE' WHEN 'UNIT_PRICE' THEN 'COMMERCIAL_REFERENCE'
    WHEN 'VALIDITY' THEN 'COMMERCIAL_REFERENCE' WHEN 'RISK' THEN 'RISK'
    ELSE NULL END
$$;

/*
  Linhas a partir de FATOS: os do pacote (revisões regentes) ou os da OS
  carregada. Fato rejeitado não entra; item de blueprint rejeitado também não.
  Fato confirmado por gente chega confirmado (com o nome de quem confirmou);
  o resto chega pendente de revisão — e pendente segura a emissão.
*/
CREATE OR REPLACE FUNCTION public.internal_service_order_insert_fact_items(
  p_os public.internal_service_orders, p_actor uuid, p_origin text,
  p_subject_kind text, p_subject_ids uuid[]
) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_count int := 0; f record; v_kind text; v_pos int;
BEGIN
  SELECT COALESCE(max(position), 0) INTO v_pos FROM public.internal_service_order_items
   WHERE organization_id = p_os.organization_id AND service_order_id = p_os.id;
  FOR f IN
    SELECT x.*, bi.id AS bp_item_id, bi.state AS bp_state
      FROM public.commercial_extracted_facts x
      LEFT JOIN LATERAL (
        SELECT i.id, i.state FROM public.commercial_execution_blueprint_items i
          JOIN public.commercial_execution_blueprints b
            ON b.organization_id = i.organization_id AND b.id = i.blueprint_id AND b.status <> 'DISCARDED'
         WHERE i.organization_id = x.organization_id AND i.source_fact_id = x.id
         ORDER BY b.created_at DESC LIMIT 1) bi ON true
     WHERE x.organization_id = p_os.organization_id
       AND x.subject_kind = p_subject_kind AND x.subject_id = ANY (p_subject_ids)
       AND x.confirmation_state <> 'REJECTED'
     ORDER BY x.subject_id, x.source_page NULLS LAST, x.created_at
  LOOP
    CONTINUE WHEN f.bp_state = 'REJECTED';
    v_kind := public.operations_item_kind_for_fact(f.fact_domain);
    CONTINUE WHEN v_kind IS NULL;
    v_pos := v_pos + 1;
    INSERT INTO public.internal_service_order_items (
      organization_id, service_order_id, kind, position, title, detail, quantity, unit, planned_date,
      origin, source_document_kind, source_revision_id, blueprint_item_id, source_fact_id,
      source_document_id, source_page, source_quote, ai_provider, ai_model, confidence,
      confirmation_state, confirmed_by, confirmed_at, created_by)
    VALUES (
      p_os.organization_id, p_os.id, v_kind, v_pos, left(f.label, 500),
      COALESCE(f.corrected_value, f.value_text,
               CASE WHEN f.value_numeric IS NOT NULL
                    THEN f.value_numeric::text || COALESCE(' ' || f.currency, ' ' || f.unit, '') END,
               f.value_date::text),
      CASE WHEN f.value_numeric > 0 AND nullif(btrim(f.unit), '') IS NOT NULL AND f.currency IS NULL
           THEN f.value_numeric END,
      CASE WHEN f.value_numeric > 0 AND nullif(btrim(f.unit), '') IS NOT NULL AND f.currency IS NULL
           THEN f.unit END,
      CASE WHEN v_kind = 'MILESTONE' THEN f.value_date END,
      p_origin,
      CASE WHEN f.document_context IN ('TECHNICAL_PROPOSAL','COMMERCIAL_PROPOSAL','INTERNAL_SERVICE_ORDER')
           THEN f.document_context END,
      CASE WHEN p_subject_kind = 'proposal_revision' THEN f.subject_id END,
      f.bp_item_id, f.id, f.document_id, f.source_page, f.source_quote,
      CASE WHEN f.extraction_method = 'ai' THEN f.ai_provider
           WHEN p_origin = 'document_extraction' THEN COALESCE(f.ai_provider, 'human') END,
      CASE WHEN f.extraction_method = 'ai' THEN f.ai_model
           WHEN p_origin = 'document_extraction' THEN COALESCE(f.ai_model, f.extraction_method) END,
      f.confidence,
      CASE WHEN f.confirmation_state IN ('CONFIRMED','CORRECTED') THEN 'CONFIRMED' ELSE 'UNCONFIRMED' END,
      CASE WHEN f.confirmation_state IN ('CONFIRMED','CORRECTED') THEN f.confirmed_by END,
      CASE WHEN f.confirmation_state IN ('CONFIRMED','CORRECTED') THEN f.confirmed_at END,
      p_actor)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN v_count := v_count + 1; END IF;
  END LOOP;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.internal_service_order_insert_fact_items(
  public.internal_service_orders, uuid, text, text, uuid[]) FROM PUBLIC, anon, authenticated;

-- Trazer o escopo do pacote para uma OS ainda aberta (inclusive a criada pelo
-- fechamento comercial, que nasce sem linhas). Idempotente.
CREATE OR REPLACE FUNCTION public.internal_service_order_seed_from_package(
  p_organization_id uuid, p_actor uuid, p_service_order_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_os public.internal_service_orders%ROWTYPE; v_n int;
BEGIN
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
END $$;

/*
  "Gerar a partir de proposta". O ÚNICO ponto de entrada é o ACEITE DO PACOTE:
  é ele que prova que o cliente aceitou exatamente esta PT e esta PC.
  Idempotente pelo aceite — clicar duas vezes, ou repetir após falha de rede,
  devolve a mesma OS.
*/
CREATE OR REPLACE FUNCTION public.internal_service_order_generate_from_package(
  p_organization_id uuid, p_actor uuid, p_acceptance_id uuid, p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a public.commercial_proposal_context_acceptances%ROWTYPE;
  v_existing public.internal_service_orders%ROWTYPE;
  v_os public.internal_service_orders%ROWTYPE;
  v_rev_id uuid; v_eng uuid; v_value_rev uuid; v_number text; v_seq int;
  v_created jsonb; v_items int; v_title text; v_stale text;
BEGIN
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
END $$;

/*
  "Importar OS". O PDF entra no acervo canônico (pai: o engajamento) e a OS
  nasce `uploaded_document`. Mesmo arquivo (hash) no mesmo engajamento é o
  mesmo documento e a mesma OS — reenviar não duplica.
*/
CREATE OR REPLACE FUNCTION public.internal_service_order_register_upload(
  p_organization_id uuid, p_actor uuid, p_engagement_id uuid, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_doc uuid; v_os public.internal_service_orders%ROWTYPE; v_created jsonb;
        v_sha text; v_path text; v_number text; v_seq int; v_eng public.commercial_engagements%ROWTYPE;
BEGIN
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
END $$;

-- A leitura (fatos da OS carregada) vira linhas PENDENTES de revisão.
CREATE OR REPLACE FUNCTION public.internal_service_order_apply_extraction(
  p_organization_id uuid, p_actor uuid, p_service_order_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_os public.internal_service_orders%ROWTYPE; v_n int;
BEGIN
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
END $$;

-- Cabeçalho do RASCUNHO. OS emitida muda por emenda (§13), nunca por aqui.
CREATE OR REPLACE FUNCTION public.internal_service_order_update_draft(
  p_organization_id uuid, p_actor uuid, p_service_order_id uuid, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_os public.internal_service_orders%ROWTYPE;
BEGIN
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
END $$;

-- Linha manual no rascunho (criar ou editar). Linha manual nasce CONFIRMADA:
-- quem digitou é o humano que responde por ela.
CREATE OR REPLACE FUNCTION public.internal_service_order_item_upsert(
  p_organization_id uuid, p_actor uuid, p_service_order_id uuid, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_os public.internal_service_orders%ROWTYPE; v_id uuid; v_item public.internal_service_order_items%ROWTYPE;
BEGIN
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
END $$;

-- Revisão humana das linhas: confirmar ou rejeitar, em lote, numa transação.
CREATE OR REPLACE FUNCTION public.internal_service_order_items_decide(
  p_organization_id uuid, p_actor uuid, p_service_order_id uuid, p_decisions jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d jsonb; v_n int := 0; v_state text;
BEGIN
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
END $$;

-- ---------------------------------------------------------------------------
-- 13) Exceção governada e emenda
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.internal_service_order_issue_with_exception(
  p_organization_id uuid, p_actor uuid, p_service_order_id uuid, p_reason text,
  p_evidence_document_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_os public.internal_service_orders%ROWTYPE; v_ids uuid[]; v_exc uuid; v_res jsonb;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Service order issuance denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Permission required: an exception needs a named actor.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.apex_actor_has_permission(p_organization_id, p_actor, 'operations.service_orders.override') THEN
    RAISE EXCEPTION 'Permission required: operations.service_orders.override.' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 20 THEN
    RAISE EXCEPTION 'Service order exception requires a written reason (20+ characters).' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_os FROM public.internal_service_orders
   WHERE organization_id = p_organization_id AND id = p_service_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service order not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF v_os.status NOT IN ('DRAFT','PENDING_CONFIRMATION') THEN
    RAISE EXCEPTION 'Service order is %: only a draft can be issued.', v_os.status USING ERRCODE = '23514';
  END IF;

  SELECT array_agg(d.id ORDER BY d.created_at) INTO v_ids
    FROM public.commercial_divergences d
   WHERE d.organization_id = p_organization_id AND d.severity = 'BLOCKING' AND d.state = 'OPEN'
     AND (d.service_order_id = v_os.id OR d.engagement_id = v_os.engagement_id);
  IF v_ids IS NULL THEN
    RAISE EXCEPTION 'Service order exception is not needed: no blocking divergence is open. Issue normally.'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.internal_service_order_issue_exceptions (
    organization_id, service_order_id, divergence_ids, reason, evidence_document_id,
    authorized_by, authorized_permission)
  VALUES (p_organization_id, v_os.id, v_ids, btrim(p_reason), p_evidence_document_id,
          p_actor, 'operations.service_orders.override')
  RETURNING id INTO v_exc;

  INSERT INTO public.commercial_engagement_history (
    organization_id, engagement_id, transition, actor_user_id, note, provenance)
  VALUES (p_organization_id, v_os.engagement_id, 'service_order_issue_exception', p_actor, btrim(p_reason),
          jsonb_build_object('service_order_id', v_os.id, 'exception_id', v_exc,
                             'divergence_ids', to_jsonb(v_ids),
                             'permission', 'operations.service_orders.override'));

  v_res := public.internal_service_order_issue(p_organization_id, p_actor, v_os.id);
  RETURN v_res || jsonb_build_object('exception_id', v_exc, 'divergences_waived', cardinality(v_ids));
END $$;

/*
  EMENDA de OS emitida. Abre a janela de mudança para ESTA OS, aplica o que
  foi pedido, grava a próxima revisão com o instantâneo e o motivo, e fecha a
  janela no fim da transação (o `set_config` é local). O que estava emitido
  continua provado na revisão anterior.
*/
CREATE OR REPLACE FUNCTION public.internal_service_order_amend(
  p_organization_id uuid, p_actor uuid, p_service_order_id uuid, p_payload jsonb, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_os public.internal_service_orders%ROWTYPE; v_rev int; it jsonb; v_changed int := 0;
BEGIN
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
END $$;

-- ---------------------------------------------------------------------------
-- 14) Privilégios: nenhuma função alcançável pelo navegador
-- ---------------------------------------------------------------------------
DO $grants$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.internal_service_order_compare_with_governing(uuid,uuid)',
    'public.internal_service_order_record_divergence(uuid,uuid,uuid,jsonb)',
    'public.internal_service_order_seed_from_package(uuid,uuid,uuid)',
    'public.internal_service_order_generate_from_package(uuid,uuid,uuid,jsonb)',
    'public.internal_service_order_register_upload(uuid,uuid,uuid,jsonb)',
    'public.internal_service_order_apply_extraction(uuid,uuid,uuid)',
    'public.internal_service_order_update_draft(uuid,uuid,uuid,jsonb)',
    'public.internal_service_order_item_upsert(uuid,uuid,uuid,jsonb)',
    'public.internal_service_order_items_decide(uuid,uuid,uuid,jsonb)',
    'public.internal_service_order_issue_with_exception(uuid,uuid,uuid,text,uuid)',
    'public.internal_service_order_amend(uuid,uuid,uuid,jsonb,text)',
    'public.internal_service_order_snapshot(uuid,uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $grants$;

REVOKE ALL ON FUNCTION public.internal_service_order_is_locked(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.internal_service_order_amendment_open(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.operations_item_kind_for_fact(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_service_order_is_locked(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.internal_service_order_amendment_open(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.operations_item_kind_for_fact(text) TO service_role;

-- ---------------------------------------------------------------------------
-- 15) RLS: Operações lê a OS e o que a descreve; ninguém escreve do navegador
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS iso_select ON public.internal_service_orders;
CREATE POLICY iso_select ON public.internal_service_orders FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND (public.current_user_has_permission('contracts.view')
          OR public.current_user_has_permission('commercial.view')
          OR public.current_user_has_permission('projects.view')
          OR public.current_user_has_permission('operations.view')));

-- As divergências DA OS também são pergunta de Operações.
DROP POLICY IF EXISTS cd_select_operations ON public.commercial_divergences;
CREATE POLICY cd_select_operations ON public.commercial_divergences FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND service_order_id IS NOT NULL
     AND public.current_user_has_permission('operations.view'));

ALTER TABLE public.internal_service_order_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_service_order_revisions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_service_order_issue_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY isoi_select ON public.internal_service_order_items FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND (public.current_user_has_permission('operations.view')
          OR public.current_user_has_permission('contracts.view')
          OR public.current_user_has_permission('commercial.view')
          OR public.current_user_has_permission('projects.view')));
CREATE POLICY isor_select ON public.internal_service_order_revisions FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND (public.current_user_has_permission('operations.view')
          OR public.current_user_has_permission('contracts.view')
          OR public.current_user_has_permission('projects.view')));
CREATE POLICY isoe_select ON public.internal_service_order_issue_exceptions FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND (public.current_user_has_permission('operations.view')
          OR public.current_user_has_permission('contracts.view')));

REVOKE ALL ON TABLE public.internal_service_order_items, public.internal_service_order_revisions,
                    public.internal_service_order_issue_exceptions FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.internal_service_order_items, public.internal_service_order_revisions,
           public.internal_service_order_issue_exceptions FROM authenticated;
GRANT SELECT ON TABLE public.internal_service_order_items, public.internal_service_order_revisions,
                      public.internal_service_order_issue_exceptions TO authenticated;

-- ---------------------------------------------------------------------------
-- 16) BACKFILL — só o que é inequívoco
--
-- OS criada antes da 230 a partir de revisão aceita ganha a proveniência do
-- pacote SE existir exatamente UMA linha de aceite completa contendo a
-- revisão (a mesma regra do gatilho). OS já emitida ganha a revisão 1 como
-- BACKFILL — apenas se nada mudou depois da emissão (updated_at = issued_at),
-- porque só então o instantâneo de hoje É o que foi emitido.
-- ---------------------------------------------------------------------------
-- `iso_touch` desligado só durante o backfill: proveniência acrescentada não
-- é edição da OS, e `updated_at` precisa continuar dizendo quando ela mudou.
ALTER TABLE public.internal_service_orders DISABLE TRIGGER iso_touch;

DO $backfill$
DECLARE v_o record; pkg record; v_n int;
BEGIN
  PERFORM set_config('apex.iso_amendment', 'migration', true);
  FOR v_o IN
    SELECT * FROM public.internal_service_orders
     WHERE source_proposal_revision_id IS NOT NULL AND source_context_acceptance_id IS NULL
       AND governing_technical_revision_id IS NULL AND governing_commercial_revision_id IS NULL
       AND governing_combined_revision_id IS NULL
  LOOP
    SELECT count(*)::int INTO v_n FROM public.commercial_proposal_context_acceptances x
     WHERE x.organization_id = v_o.organization_id AND x.complete
       AND v_o.source_proposal_revision_id IN (x.technical_revision_id, x.commercial_revision_id, x.combined_revision_id);
    CONTINUE WHEN v_n <> 1;
    SELECT * INTO pkg FROM public.operations_package_of_revision(v_o.organization_id, v_o.source_proposal_revision_id);
    UPDATE public.internal_service_orders SET
      source_context_acceptance_id = pkg.acceptance_id,
      governing_technical_revision_id = pkg.technical_revision_id,
      governing_commercial_revision_id = pkg.commercial_revision_id,
      governing_combined_revision_id = pkg.combined_revision_id
     WHERE id = v_o.id;
  END LOOP;

  INSERT INTO public.internal_service_order_revisions
    (organization_id, service_order_id, revision, kind, snapshot, reason, actor_user_id, created_at)
  SELECT o.organization_id, o.id, 1, 'BACKFILL',
         public.internal_service_order_snapshot(o.organization_id, o.id),
         'Instantâneo da OS emitida antes da 230 (sem alteração posterior à emissão).',
         o.issued_by, o.issued_at
    FROM public.internal_service_orders o
   WHERE o.issued_at IS NOT NULL AND o.updated_at = o.issued_at
     AND NOT EXISTS (SELECT 1 FROM public.internal_service_order_revisions r
                      WHERE r.organization_id = o.organization_id AND r.service_order_id = o.id);
  PERFORM set_config('apex.iso_amendment', '', true);
END $backfill$;

ALTER TABLE public.internal_service_orders ENABLE TRIGGER iso_touch;

COMMIT;
