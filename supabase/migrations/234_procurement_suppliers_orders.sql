-- ============================================================================
-- 234 — COMPRAS & FORNECEDORES: requisição → cotação → decisão → pedido
--
-- ─── Compra começa pela necessidade ─────────────────────────────────────
--
-- A requisição nasce da FALTA de um requisito confirmado (231/233), com o
-- rastro requisito → linha preservado em `purchase_requisition_line_requirements`.
-- Consolidar vários requisitos numa linha é permitido SÓ com esse rastro.
-- Requisição manual existe, como exceção com justificativa.
--
-- ─── Fornecedor é papel de parte ────────────────────────────────────────
--
-- Nenhum cadastro paralelo de contraparte: fornecedor = `parties` + papel
-- `supplier` (já no vocabulário canônico da 102). `supplier_profiles` guarda
-- só o que é de COMPRAS: homologação, categorias, condição e prazo padrão.
-- A tabela legada `supplier` (0 linhas, CNPJ único global) não é usada.
--
-- ─── Aprovação: o motor da plataforma, sem motor paralelo ───────────────
--
-- O pedido de compra é um novo SUJEITO do Motor de Aprovação (125–129):
-- `approval_subject_resolve` aprende `purchase_order`. Ao submeter:
--   • há política no motor → o pedido vai para a caixa de aprovações da
--     plataforma; o desfecho volta por evento (`approval.request.*`) e só é
--     aplicado se a impressão digital do pedido não mudou;
--   • não há política → vale a regra da 141 (faturamento): NÃO é "tem
--     permissão, então aprova". Aprova só quem tem ALÇADA DE COMPRA DECLARADA,
--     com evidência (papel ou pessoa, teto, moeda, escopo), e nunca quem criou
--     ou submeteu o pedido (segregação de funções). Sem alçada declarada, o
--     pedido fica não aprovável — e a tela diz isso.
--
-- ─── Cobertura ──────────────────────────────────────────────────────────
-- em pedido  = alocação do pedido EMITIDO ao requisito − recebido
-- requisitado = alocação de requisição viva ainda sem pedido emitido
-- A falta continua sendo requerido − coberto − entrando; requisitado é
-- mostrado à parte para ninguém requisitar duas vezes (e o banco recusa).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) Vocabulário
-- ---------------------------------------------------------------------------
INSERT INTO public.permissions (key, module, action, description) VALUES
  ('procurement.authorities.manage', 'procurement', 'authorities.manage',
   'Declarar e revogar alçadas de aprovação de compra (com evidência)')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
 WHERE r.organization_id IS NULL AND r.key = 'owner_admin' AND p.key = 'procurement.authorities.manage'
ON CONFLICT DO NOTHING;

-- Número legível por inquilino: prefixo + data + sufixo aleatório curto.
CREATE OR REPLACE FUNCTION public.procurement_number(p_prefix text)
RETURNS text LANGUAGE sql VOLATILE SET search_path = public, pg_temp AS $$
  SELECT p_prefix || '-' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYMMDD') || '-'
         || upper(substr(md5(gen_random_uuid()::text), 1, 5))
$$;

-- ---------------------------------------------------------------------------
-- 1) Fornecedores = papel de parte
-- ---------------------------------------------------------------------------
CREATE TABLE public.supplier_profiles (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  party_id                uuid NOT NULL,
  status                  text NOT NULL DEFAULT 'PROSPECT' CHECK (status IN ('PROSPECT','HOMOLOGATED','SUSPENDED','BLOCKED')),
  status_reason           text,
  categories              text[] NOT NULL DEFAULT '{}',
  default_payment_terms   text,
  default_lead_time_days  integer CHECK (default_lead_time_days IS NULL OR default_lead_time_days >= 0),
  contact_name            text,
  contact_email           text,
  contact_phone           text,
  notes                   text,
  homologated_at          timestamptz,
  homologated_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT supp_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT supp_one_per_party UNIQUE (organization_id, party_id),
  CONSTRAINT supp_party_tenant FOREIGN KEY (organization_id, party_id)
    REFERENCES public.parties (organization_id, id),
  CONSTRAINT supp_restriction_has_reason CHECK (status NOT IN ('SUSPENDED','BLOCKED') OR nullif(btrim(status_reason),'') IS NOT NULL)
);
CREATE TRIGGER supp_touch BEFORE UPDATE ON public.supplier_profiles
  FOR EACH ROW EXECUTE FUNCTION public.commercial_touch_updated_at();

-- Quem compra enxerga as partes que são FORNECEDORES — e só elas. O teste de
-- papel mora numa função definidora: uma política em `parties` que lesse
-- `party_roles` (cuja política já lê `parties`) entraria em recursão de RLS.
CREATE OR REPLACE FUNCTION public.party_is_supplier(p_organization_id uuid, p_party_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (public.apex_browser_organization() IS NULL OR public.apex_browser_organization() = p_organization_id)
     AND EXISTS (SELECT 1 FROM public.party_roles pr
                  WHERE pr.organization_id = p_organization_id AND pr.party_id = p_party_id AND pr.role = 'supplier')
$$;
REVOKE ALL ON FUNCTION public.party_is_supplier(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.party_is_supplier(uuid, uuid) TO authenticated, service_role;

CREATE POLICY parties_select_suppliers ON public.parties FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND (public.current_user_has_permission('suppliers.view') OR public.current_user_has_permission('procurement.view'))
     AND public.party_is_supplier(organization_id, id));
CREATE POLICY party_roles_select_suppliers ON public.party_roles FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id() AND role = 'supplier'
     AND (public.current_user_has_permission('suppliers.view') OR public.current_user_has_permission('procurement.view')));

-- ---------------------------------------------------------------------------
-- 2) Alçada de compra DECLARADA (sem política no motor)
-- ---------------------------------------------------------------------------
CREATE TABLE public.procurement_approval_authorities (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id         text,
  category           text,
  grantee_kind       text NOT NULL CHECK (grantee_kind IN ('ROLE','USER')),
  grantee_role_id    uuid REFERENCES public.roles(id) ON DELETE CASCADE,
  grantee_user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  max_amount         numeric(18,2) CHECK (max_amount IS NULL OR max_amount > 0),
  currency           text NOT NULL DEFAULT 'BRL' CHECK (currency ~ '^[A-Z]{3}$'),
  source_kind        text NOT NULL CHECK (source_kind IN ('BOARD_RESOLUTION','POWER_OF_ATTORNEY','DELEGATION_LETTER',
                                                           'CONTRACT_CLAUSE','INTERNAL_POLICY_DOCUMENT','BYLAWS')),
  source_reference   text NOT NULL CHECK (btrim(source_reference) <> ''),
  source_document_id uuid,
  justification      text NOT NULL CHECK (btrim(justification) <> ''),
  effective_from     date NOT NULL DEFAULT current_date,
  effective_until    date,
  active             boolean NOT NULL DEFAULT true,
  declared_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  revoked_at         timestamptz,
  revoked_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revocation_reason  text,

  CONSTRAINT paa_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT paa_project_tenant FOREIGN KEY (organization_id, project_id) REFERENCES public.projects (organization_id, id),
  CONSTRAINT paa_document_tenant FOREIGN KEY (organization_id, source_document_id)
    REFERENCES public.contract_documents (organization_id, id) ON DELETE SET NULL (source_document_id),
  CONSTRAINT paa_grantee_shape CHECK ((grantee_kind = 'ROLE') = (grantee_role_id IS NOT NULL AND grantee_user_id IS NULL)
                                  AND (grantee_kind = 'USER') = (grantee_user_id IS NOT NULL AND grantee_role_id IS NULL)),
  CONSTRAINT paa_window CHECK (effective_until IS NULL OR effective_until >= effective_from),
  CONSTRAINT paa_revocation CHECK ((revoked_at IS NULL) = active AND (active OR nullif(btrim(revocation_reason),'') IS NOT NULL))
);

-- ---------------------------------------------------------------------------
-- 3) Requisição de compra
-- ---------------------------------------------------------------------------
CREATE TABLE public.purchase_requisitions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requisition_number   text NOT NULL,
  project_id           text,
  source               text NOT NULL CHECK (source IN ('SHORTAGE','MANUAL')),
  status               text NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','SOURCING','ORDERED','CANCELLED','CLOSED')),
  priority             text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  required_by          date,
  delivery_location_id uuid,
  justification        text,
  idempotency_key      text,
  requested_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at         timestamptz NOT NULL DEFAULT now(),
  closed_at            timestamptz,
  close_reason         text,
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT preqn_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT preqn_number_unique UNIQUE (organization_id, requisition_number),
  CONSTRAINT preqn_idempotency UNIQUE (organization_id, idempotency_key),
  CONSTRAINT preqn_project_tenant FOREIGN KEY (organization_id, project_id) REFERENCES public.projects (organization_id, id),
  CONSTRAINT preqn_location_tenant FOREIGN KEY (organization_id, delivery_location_id)
    REFERENCES public.inventory_locations (organization_id, id),
  CONSTRAINT preqn_manual_justified CHECK (source <> 'MANUAL' OR nullif(btrim(justification),'') IS NOT NULL),
  CONSTRAINT preqn_cancel_reason CHECK (status <> 'CANCELLED' OR nullif(btrim(close_reason),'') IS NOT NULL)
);
CREATE INDEX preqn_status ON public.purchase_requisitions (organization_id, status);
CREATE TRIGGER preqn_touch BEFORE UPDATE ON public.purchase_requisitions
  FOR EACH ROW EXECUTE FUNCTION public.commercial_touch_updated_at();

CREATE TABLE public.purchase_requisition_lines (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requisition_id        uuid NOT NULL,
  item_id               uuid NOT NULL,
  quantity              numeric NOT NULL CHECK (quantity > 0),
  required_by           date,
  estimated_unit_price  numeric CHECK (estimated_unit_price IS NULL OR estimated_unit_price >= 0),
  note                  text,
  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT prl_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT prl_requisition_tenant FOREIGN KEY (organization_id, requisition_id)
    REFERENCES public.purchase_requisitions (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT prl_item_tenant FOREIGN KEY (organization_id, item_id) REFERENCES public.supply_items (organization_id, id)
);
CREATE INDEX prl_requisition ON public.purchase_requisition_lines (organization_id, requisition_id);

-- O rastro da consolidação: que requisito, quanto, em qual linha.
CREATE TABLE public.purchase_requisition_line_requirements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  line_id          uuid NOT NULL,
  requirement_id   uuid NOT NULL,
  quantity         numeric NOT NULL CHECK (quantity > 0),

  CONSTRAINT prlr_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT prlr_one_per_pair UNIQUE (line_id, requirement_id),
  CONSTRAINT prlr_line_tenant FOREIGN KEY (organization_id, line_id)
    REFERENCES public.purchase_requisition_lines (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT prlr_requirement_tenant FOREIGN KEY (organization_id, requirement_id)
    REFERENCES public.project_requirements (organization_id, id)
);
CREATE INDEX prlr_requirement ON public.purchase_requisition_line_requirements (organization_id, requirement_id);

-- ---------------------------------------------------------------------------
-- 4) Cotação (RFQ), fornecedores convidados, propostas versionadas
-- ---------------------------------------------------------------------------
CREATE TABLE public.procurement_rfqs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rfq_number       text NOT NULL,
  status           text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','DECIDED','CANCELLED')),
  response_due     date,
  note             text,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  closed_at        timestamptz,
  close_reason     text,
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rfq_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT rfq_number_unique UNIQUE (organization_id, rfq_number),
  CONSTRAINT rfq_cancel_reason CHECK (status <> 'CANCELLED' OR nullif(btrim(close_reason),'') IS NOT NULL)
);
CREATE TRIGGER rfq_touch BEFORE UPDATE ON public.procurement_rfqs
  FOR EACH ROW EXECUTE FUNCTION public.commercial_touch_updated_at();

CREATE TABLE public.procurement_rfq_lines (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rfq_id                uuid NOT NULL,
  requisition_line_id   uuid NOT NULL,
  item_id               uuid NOT NULL,
  quantity              numeric NOT NULL CHECK (quantity > 0),
  required_by           date,

  CONSTRAINT rfql_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT rfql_rfq_tenant FOREIGN KEY (organization_id, rfq_id) REFERENCES public.procurement_rfqs (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT rfql_reqline_tenant FOREIGN KEY (organization_id, requisition_line_id)
    REFERENCES public.purchase_requisition_lines (organization_id, id),
  CONSTRAINT rfql_item_tenant FOREIGN KEY (organization_id, item_id) REFERENCES public.supply_items (organization_id, id),
  CONSTRAINT rfql_one_line_per_rfq UNIQUE (rfq_id, requisition_line_id)
);

CREATE TABLE public.procurement_rfq_suppliers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rfq_id           uuid NOT NULL,
  supplier_id      uuid NOT NULL,
  invited_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rfqs_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT rfqs_rfq_tenant FOREIGN KEY (organization_id, rfq_id) REFERENCES public.procurement_rfqs (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT rfqs_supplier_tenant FOREIGN KEY (organization_id, supplier_id) REFERENCES public.supplier_profiles (organization_id, id),
  CONSTRAINT rfqs_once UNIQUE (rfq_id, supplier_id)
);

CREATE TABLE public.supplier_quotes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rfq_id           uuid NOT NULL,
  supplier_id      uuid NOT NULL,
  version          integer NOT NULL CHECK (version > 0),
  status           text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','SUPERSEDED','WITHDRAWN')),
  currency         text NOT NULL DEFAULT 'BRL' CHECK (currency ~ '^[A-Z]{3}$'),
  freight_amount   numeric NOT NULL DEFAULT 0 CHECK (freight_amount >= 0),
  tax_amount       numeric NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  payment_terms    text,
  validity_date    date,
  lead_time_days   integer CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  deviations       text,
  document_id      uuid,
  recorded_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recorded_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sq_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT sq_version_unique UNIQUE (rfq_id, supplier_id, version),
  CONSTRAINT sq_rfq_tenant FOREIGN KEY (organization_id, rfq_id) REFERENCES public.procurement_rfqs (organization_id, id),
  CONSTRAINT sq_supplier_tenant FOREIGN KEY (organization_id, supplier_id) REFERENCES public.supplier_profiles (organization_id, id),
  CONSTRAINT sq_document_tenant FOREIGN KEY (organization_id, document_id)
    REFERENCES public.contract_documents (organization_id, id) ON DELETE SET NULL (document_id)
);

CREATE TABLE public.supplier_quote_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  quote_id         uuid NOT NULL,
  rfq_line_id      uuid NOT NULL,
  unit_price       numeric NOT NULL CHECK (unit_price >= 0),
  quantity         numeric NOT NULL CHECK (quantity > 0),
  lead_time_days   integer CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  compliant        boolean NOT NULL DEFAULT true,
  note             text,

  CONSTRAINT sql_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT sql_quote_tenant FOREIGN KEY (organization_id, quote_id) REFERENCES public.supplier_quotes (organization_id, id),
  CONSTRAINT sql_rfq_line_tenant FOREIGN KEY (organization_id, rfq_line_id) REFERENCES public.procurement_rfq_lines (organization_id, id),
  CONSTRAINT sql_once UNIQUE (quote_id, rfq_line_id)
);

-- Proposta registrada não se reescreve: nova versão. Só o estado muda.
CREATE OR REPLACE FUNCTION public.supplier_quote_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'supplier_quote_lines' THEN
    RAISE EXCEPTION 'Quote lines are immutable: record a new quote version.' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'Quote is immutable: record a new version.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.supplier_quote_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER sq_immutable BEFORE UPDATE ON public.supplier_quotes FOR EACH ROW EXECUTE FUNCTION public.supplier_quote_guard();
CREATE TRIGGER sql_immutable BEFORE UPDATE ON public.supplier_quote_lines FOR EACH ROW EXECUTE FUNCTION public.supplier_quote_guard();

-- ---------------------------------------------------------------------------
-- 5) Decisão de compra (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE public.sourcing_decisions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rfq_id                  uuid NOT NULL,
  quote_id                uuid NOT NULL,
  recommended_quote_id    uuid,
  follows_recommendation  boolean NOT NULL,
  rationale               text NOT NULL CHECK (btrim(rationale) <> ''),
  comparison_snapshot     jsonb NOT NULL DEFAULT '{}'::jsonb,
  decided_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sdec_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT sdec_one_per_rfq UNIQUE (organization_id, rfq_id),
  CONSTRAINT sdec_rfq_tenant FOREIGN KEY (organization_id, rfq_id) REFERENCES public.procurement_rfqs (organization_id, id),
  CONSTRAINT sdec_quote_tenant FOREIGN KEY (organization_id, quote_id) REFERENCES public.supplier_quotes (organization_id, id),
  CONSTRAINT sdec_recommended_tenant FOREIGN KEY (organization_id, recommended_quote_id) REFERENCES public.supplier_quotes (organization_id, id)
);
CREATE TRIGGER sdec_no_rewrite BEFORE UPDATE ON public.sourcing_decisions
  FOR EACH ROW EXECUTE FUNCTION public.operations_reject_history_rewrite();
CREATE TRIGGER sdec_no_erasure BEFORE DELETE ON public.sourcing_decisions
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

-- ---------------------------------------------------------------------------
-- 6) Pedido de compra
-- ---------------------------------------------------------------------------
CREATE TABLE public.purchase_orders (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  order_number           text NOT NULL,
  supplier_id            uuid NOT NULL,
  sourcing_decision_id   uuid,
  project_id             text,
  status                 text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVAL_REQUIRED','APPROVED','ISSUED',
                                                                         'PARTIALLY_RECEIVED','RECEIVED','CLOSED','CANCELLED')),
  currency               text NOT NULL DEFAULT 'BRL' CHECK (currency ~ '^[A-Z]{3}$'),
  freight_amount         numeric NOT NULL DEFAULT 0 CHECK (freight_amount >= 0),
  tax_amount             numeric NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  payment_terms          text,
  delivery_location_id   uuid,
  expected_delivery      date,
  approval_governance    text CHECK (approval_governance IN ('POLICY','AUTHORITY')),
  approval_request_id    uuid,
  approval_authority_id  uuid,
  approved_fingerprint   text,
  approved_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at            timestamptz,
  submitted_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_at           timestamptz,
  issued_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  issued_at              timestamptz,
  closed_at              timestamptz,
  close_reason           text,
  created_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT po_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT po_number_unique UNIQUE (organization_id, order_number),
  CONSTRAINT po_one_per_decision UNIQUE (organization_id, sourcing_decision_id),
  CONSTRAINT po_supplier_tenant FOREIGN KEY (organization_id, supplier_id) REFERENCES public.supplier_profiles (organization_id, id),
  CONSTRAINT po_decision_tenant FOREIGN KEY (organization_id, sourcing_decision_id) REFERENCES public.sourcing_decisions (organization_id, id),
  CONSTRAINT po_project_tenant FOREIGN KEY (organization_id, project_id) REFERENCES public.projects (organization_id, id),
  CONSTRAINT po_location_tenant FOREIGN KEY (organization_id, delivery_location_id) REFERENCES public.inventory_locations (organization_id, id),
  CONSTRAINT po_approval_request_tenant FOREIGN KEY (organization_id, approval_request_id)
    REFERENCES public.approval_requests (organization_id, id) ON DELETE SET NULL (approval_request_id),
  CONSTRAINT po_authority_tenant FOREIGN KEY (organization_id, approval_authority_id)
    REFERENCES public.procurement_approval_authorities (organization_id, id),
  CONSTRAINT po_approved_has_fingerprint CHECK (status NOT IN ('APPROVED','ISSUED','PARTIALLY_RECEIVED','RECEIVED','CLOSED')
                                               OR approved_fingerprint IS NOT NULL),
  CONSTRAINT po_cancel_reason CHECK (status <> 'CANCELLED' OR nullif(btrim(close_reason),'') IS NOT NULL)
);
CREATE INDEX po_status ON public.purchase_orders (organization_id, status);
CREATE INDEX po_supplier ON public.purchase_orders (organization_id, supplier_id);
CREATE TRIGGER po_touch BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.commercial_touch_updated_at();

CREATE TABLE public.purchase_order_lines (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purchase_order_id    uuid NOT NULL,
  item_id              uuid NOT NULL,
  quantity             numeric NOT NULL CHECK (quantity > 0),
  unit_price           numeric NOT NULL CHECK (unit_price >= 0),
  expected_date        date,
  received_quantity    numeric NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  requisition_line_id  uuid,
  quote_line_id        uuid,

  CONSTRAINT pol_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pol_po_tenant FOREIGN KEY (organization_id, purchase_order_id) REFERENCES public.purchase_orders (organization_id, id),
  CONSTRAINT pol_item_tenant FOREIGN KEY (organization_id, item_id) REFERENCES public.supply_items (organization_id, id),
  CONSTRAINT pol_reqline_tenant FOREIGN KEY (organization_id, requisition_line_id)
    REFERENCES public.purchase_requisition_lines (organization_id, id),
  CONSTRAINT pol_quote_line_tenant FOREIGN KEY (organization_id, quote_line_id)
    REFERENCES public.supplier_quote_lines (organization_id, id),
  -- Recebimento a maior é recusado (a 235 posta recebimento contra isto).
  CONSTRAINT pol_not_over_received CHECK (received_quantity <= quantity)
);
CREATE INDEX pol_po ON public.purchase_order_lines (organization_id, purchase_order_id);

CREATE TABLE public.purchase_order_line_requirements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  line_id             uuid NOT NULL,
  requirement_id      uuid NOT NULL,
  quantity            numeric NOT NULL CHECK (quantity > 0),
  received_quantity   numeric NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),

  CONSTRAINT polr_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT polr_one_per_pair UNIQUE (line_id, requirement_id),
  CONSTRAINT polr_line_tenant FOREIGN KEY (organization_id, line_id) REFERENCES public.purchase_order_lines (organization_id, id),
  CONSTRAINT polr_requirement_tenant FOREIGN KEY (organization_id, requirement_id)
    REFERENCES public.project_requirements (organization_id, id),
  CONSTRAINT polr_received_bounds CHECK (received_quantity <= quantity)
);
CREATE INDEX polr_requirement ON public.purchase_order_line_requirements (organization_id, requirement_id);

-- Linha de pedido só muda no rascunho — exceto o recebido (235).
CREATE OR REPLACE FUNCTION public.purchase_order_line_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM public.purchase_orders WHERE id = COALESCE(NEW.purchase_order_id, OLD.purchase_order_id);
  IF v_status <> 'DRAFT' AND (TG_OP <> 'UPDATE' OR (to_jsonb(NEW) - 'received_quantity') IS DISTINCT FROM (to_jsonb(OLD) - 'received_quantity')) THEN
    RAISE EXCEPTION 'Purchase order lines change only while DRAFT.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
REVOKE ALL ON FUNCTION public.purchase_order_line_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER pol_guard BEFORE INSERT OR UPDATE ON public.purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION public.purchase_order_line_guard();

CREATE TABLE public.purchase_order_history (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purchase_order_id  uuid NOT NULL,
  transition         text NOT NULL,
  from_status        text,
  to_status          text,
  reason             text,
  detail             jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_source       text NOT NULL DEFAULT 'human' CHECK (actor_source IN ('human','system')),
  occurred_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT poh_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT poh_po_tenant FOREIGN KEY (organization_id, purchase_order_id) REFERENCES public.purchase_orders (organization_id, id)
);
CREATE INDEX poh_po ON public.purchase_order_history (organization_id, purchase_order_id, occurred_at);
CREATE TRIGGER poh_no_rewrite BEFORE UPDATE ON public.purchase_order_history
  FOR EACH ROW EXECUTE FUNCTION public.operations_reject_history_rewrite();
CREATE TRIGGER poh_no_erasure BEFORE DELETE ON public.purchase_order_history
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

-- ---------------------------------------------------------------------------
-- 7) Núcleo: impressão digital, total, alçada, requisitado e em pedido
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purchase_order_total(p_po_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((SELECT sum(l.quantity * l.unit_price) FROM public.purchase_order_lines l WHERE l.purchase_order_id = po.id), 0)
         + po.freight_amount + po.tax_amount
    FROM public.purchase_orders po WHERE po.id = p_po_id
$$;

-- O que se aprova: fornecedor, moeda, condições, frete, impostos e cada linha.
CREATE OR REPLACE FUNCTION public.purchase_order_fingerprint(p_po_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
  SELECT encode(extensions.digest(concat_ws('|', 'purchase_order.v1', po.id::text, po.supplier_id::text, po.currency,
           po.freight_amount::text, po.tax_amount::text, COALESCE(po.payment_terms, ''), COALESCE(po.delivery_location_id::text, ''),
           COALESCE((SELECT string_agg(concat_ws(':', l.item_id::text, l.quantity::text, l.unit_price::text), ',' ORDER BY l.id)
                       FROM public.purchase_order_lines l WHERE l.purchase_order_id = po.id), ''))::bytea, 'sha256'), 'hex')
    FROM public.purchase_orders po WHERE po.id = p_po_id
$$;

CREATE OR REPLACE FUNCTION public.procurement_authority_for(
  p_organization_id uuid, p_actor uuid, p_amount numeric, p_currency text, p_project_id text
) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.id FROM public.procurement_approval_authorities a
   WHERE a.organization_id = p_organization_id AND a.active
     AND a.effective_from <= current_date AND (a.effective_until IS NULL OR a.effective_until >= current_date)
     AND a.currency = p_currency
     AND (a.max_amount IS NULL OR p_amount <= a.max_amount)
     AND (a.project_id IS NULL OR a.project_id = p_project_id)
     AND ((a.grantee_kind = 'USER' AND a.grantee_user_id = p_actor)
          OR (a.grantee_kind = 'ROLE' AND EXISTS (SELECT 1 FROM public.user_roles ur
                WHERE ur.user_id = p_actor AND ur.organization_id = p_organization_id AND ur.role_id = a.grantee_role_id)))
   ORDER BY a.max_amount NULLS LAST, a.created_at LIMIT 1
$$;

-- Requisitado em aberto: alocação de requisição viva cuja linha ainda não tem pedido EMITIDO.
CREATE OR REPLACE FUNCTION public.procurement_requested_open(p_organization_id uuid, p_requirement_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(sum(a.quantity), 0)
    FROM public.purchase_requisition_line_requirements a
    JOIN public.purchase_requisition_lines l ON l.organization_id = a.organization_id AND l.id = a.line_id
    JOIN public.purchase_requisitions r ON r.organization_id = l.organization_id AND r.id = l.requisition_id
   WHERE a.organization_id = p_organization_id AND a.requirement_id = p_requirement_id
     AND r.status IN ('SUBMITTED','SOURCING')
     AND NOT EXISTS (SELECT 1 FROM public.purchase_order_lines pl
                       JOIN public.purchase_orders po ON po.organization_id = pl.organization_id AND po.id = pl.purchase_order_id
                      WHERE pl.organization_id = a.organization_id AND pl.requisition_line_id = l.id
                        AND po.status IN ('ISSUED','PARTIALLY_RECEIVED','RECEIVED','CLOSED'))
$$;

CREATE OR REPLACE FUNCTION public.procurement_on_order(p_organization_id uuid, p_requirement_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(sum(a.quantity - a.received_quantity), 0)
    FROM public.purchase_order_line_requirements a
    JOIN public.purchase_order_lines l ON l.organization_id = a.organization_id AND l.id = a.line_id
    JOIN public.purchase_orders po ON po.organization_id = l.organization_id AND po.id = l.purchase_order_id
   WHERE a.organization_id = p_organization_id AND a.requirement_id = p_requirement_id
     AND po.status IN ('ISSUED','PARTIALLY_RECEIVED')
$$;

-- A cobertura comprometida (233) passa a contar o que está EM PEDIDO: reservar
-- estoque para um requisito que já tem compra emitida seria cobrir duas vezes.
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
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_log(
  p_po public.purchase_orders, p_transition text, p_from text, p_reason text, p_detail jsonb, p_actor uuid, p_source text DEFAULT 'human'
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.purchase_order_history (organization_id, purchase_order_id, transition, from_status, to_status, reason,
    detail, actor_user_id, actor_source)
  VALUES (p_po.organization_id, p_po.id, p_transition, p_from, p_po.status, nullif(btrim(p_reason),''),
    COALESCE(p_detail, '{}'::jsonb), p_actor, p_source);
  PERFORM public.emit_domain_event(p_po.organization_id, 'supply.purchase_order.' || p_transition, 1, 'purchase_order', p_po.id,
    'purchase-order:' || p_po.id || ':' || p_transition || ':' ||
      (SELECT count(*) FROM public.purchase_order_history h WHERE h.purchase_order_id = p_po.id),
    jsonb_build_object('project_id', p_po.project_id, 'order_number', p_po.order_number, 'status', p_po.status,
      'supplier_id', p_po.supplier_id, 'total', public.purchase_order_total(p_po.id), 'currency', p_po.currency) || COALESCE(p_detail, '{}'::jsonb),
    now(), p_source, p_actor);
END $$;

-- ---------------------------------------------------------------------------
-- 8) Atos: fornecedor e alçada
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.supplier_register(p_organization_id uuid, p_actor uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_party uuid; v_doc_type text; v_doc text; v_profile public.supplier_profiles%ROWTYPE; v_created boolean := false;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['suppliers.manage']);
  v_party := nullif(p_payload->>'party_id','')::uuid;
  v_doc_type := nullif(lower(p_payload->>'document_type'),'');
  v_doc := nullif(regexp_replace(COALESCE(p_payload->>'document_number',''), '\D', '', 'g'), '');
  IF v_party IS NULL AND v_doc_type IN ('cnpj','cpf') AND v_doc IS NOT NULL THEN
    SELECT id INTO v_party FROM public.parties
     WHERE organization_id = p_organization_id AND document_type = v_doc_type AND document_normalized = v_doc;
  END IF;
  IF v_party IS NULL THEN
    IF nullif(btrim(p_payload->>'legal_name'),'') IS NULL THEN
      RAISE EXCEPTION 'Supplier needs a legal name (or an existing party).' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.parties (organization_id, kind, legal_name, trade_name, document_type, document_number, source_system, created_by)
    VALUES (p_organization_id, COALESCE(nullif(p_payload->>'kind',''), 'organization'), btrim(p_payload->>'legal_name'),
      nullif(btrim(p_payload->>'trade_name'),''), v_doc_type, nullif(btrim(p_payload->>'document_number'),''), 'procurement', p_actor)
    RETURNING id INTO v_party;
    v_created := true;
  ELSIF NOT EXISTS (SELECT 1 FROM public.parties WHERE organization_id = p_organization_id AND id = v_party) THEN
    RAISE EXCEPTION 'Supplier party not found in tenant.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.party_roles (organization_id, party_id, role, active, created_by)
  VALUES (p_organization_id, v_party, 'supplier', true, p_actor)
  ON CONFLICT (party_id, role) DO UPDATE SET active = true;

  INSERT INTO public.supplier_profiles (organization_id, party_id, categories, default_payment_terms, default_lead_time_days,
    contact_name, contact_email, contact_phone, notes, created_by)
  VALUES (p_organization_id, v_party,
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'categories')), '{}'),
    nullif(btrim(p_payload->>'default_payment_terms'),''), nullif(p_payload->>'default_lead_time_days','')::int,
    nullif(btrim(p_payload->>'contact_name'),''), nullif(btrim(p_payload->>'contact_email'),''),
    nullif(btrim(p_payload->>'contact_phone'),''), nullif(btrim(p_payload->>'notes'),''), p_actor)
  ON CONFLICT (organization_id, party_id) DO UPDATE SET
    categories = CASE WHEN p_payload ? 'categories' THEN EXCLUDED.categories ELSE supplier_profiles.categories END,
    default_payment_terms = COALESCE(EXCLUDED.default_payment_terms, supplier_profiles.default_payment_terms),
    default_lead_time_days = COALESCE(EXCLUDED.default_lead_time_days, supplier_profiles.default_lead_time_days),
    contact_name = COALESCE(EXCLUDED.contact_name, supplier_profiles.contact_name),
    contact_email = COALESCE(EXCLUDED.contact_email, supplier_profiles.contact_email),
    contact_phone = COALESCE(EXCLUDED.contact_phone, supplier_profiles.contact_phone),
    notes = COALESCE(EXCLUDED.notes, supplier_profiles.notes)
  RETURNING * INTO v_profile;
  RETURN jsonb_build_object('supplier_id', v_profile.id, 'party_id', v_party, 'party_created', v_created);
END $$;

-- Homologar, suspender, bloquear. Restrição exige motivo.
CREATE OR REPLACE FUNCTION public.supplier_set_status(p_organization_id uuid, p_actor uuid, p_supplier_id uuid, p_status text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.supplier_profiles%ROWTYPE; v_from text;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['suppliers.manage']);
  SELECT * INTO v FROM public.supplier_profiles WHERE organization_id = p_organization_id AND id = p_supplier_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Supplier not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  v_from := v.status;
  UPDATE public.supplier_profiles SET status = p_status,
    status_reason = nullif(btrim(p_reason),''),
    homologated_at = CASE WHEN p_status = 'HOMOLOGATED' THEN now() ELSE homologated_at END,
    homologated_by = CASE WHEN p_status = 'HOMOLOGATED' THEN p_actor ELSE homologated_by END
  WHERE organization_id = p_organization_id AND id = v.id;
  PERFORM public.emit_domain_event(p_organization_id, 'supply.supplier.status_changed', 1, 'supplier_profile', v.id,
    'supplier:' || v.id || ':' || p_status || ':' || extract(epoch FROM clock_timestamp())::text,
    jsonb_build_object('from', v_from, 'to', p_status, 'reason', nullif(btrim(p_reason),'')), now(), 'human', p_actor);
  RETURN jsonb_build_object('supplier_id', v.id, 'status', p_status);
END $$;

CREATE OR REPLACE FUNCTION public.procurement_authority_declare(p_organization_id uuid, p_actor uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['procurement.authorities.manage']);
  -- Ninguém declara alçada para si mesmo.
  IF p_payload->>'grantee_kind' = 'USER' AND (p_payload->>'grantee_user_id')::uuid = p_actor THEN
    RAISE EXCEPTION 'Purchase authority cannot be self-declared.' USING ERRCODE = '42501';
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
END $$;

CREATE OR REPLACE FUNCTION public.procurement_authority_revoke(p_organization_id uuid, p_actor uuid, p_authority_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['procurement.authorities.manage']);
  UPDATE public.procurement_approval_authorities SET active = false, revoked_at = now(), revoked_by = p_actor,
    revocation_reason = btrim(p_reason)
  WHERE organization_id = p_organization_id AND id = p_authority_id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active purchase authority not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.emit_domain_event(p_organization_id, 'supply.procurement_authority.revoked', 1, 'procurement_authority', p_authority_id,
    'procurement-authority:' || p_authority_id || ':revoked', jsonb_build_object('reason', p_reason), now(), 'human', p_actor);
  RETURN jsonb_build_object('authority_id', p_authority_id, 'active', false);
END $$;

-- ---------------------------------------------------------------------------
-- 9) Atos: requisição
-- ---------------------------------------------------------------------------
/*
  Da FALTA à requisição. Cada requisito é travado; a quantidade é a falta
  menos o que já está requisitado em aberto — requisitar duas vezes a mesma
  necessidade é recusado. Requisitos do mesmo item viram UMA linha, com o
  rastro de quanto é de quem.
*/
CREATE OR REPLACE FUNCTION public.purchase_requisition_from_shortage(p_organization_id uuid, p_actor uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_key text; v_req public.purchase_requisitions%ROWTYPE; r public.project_requirements%ROWTYPE; v_rid text;
        v_short numeric; v_open numeric; v_line uuid; v_projects text[] := '{}'; v_n int := 0; v_min date;
        cov record;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['procurement.request']);
  v_key := nullif(p_payload->>'idempotency_key','');
  IF v_key IS NOT NULL THEN
    SELECT * INTO v_req FROM public.purchase_requisitions WHERE organization_id = p_organization_id AND idempotency_key = v_key;
    IF FOUND THEN RETURN jsonb_build_object('requisition_id', v_req.id, 'requisition_number', v_req.requisition_number, 'replayed', true); END IF;
  END IF;
  IF jsonb_typeof(p_payload->'requirement_ids') <> 'array' OR jsonb_array_length(p_payload->'requirement_ids') = 0 THEN
    RAISE EXCEPTION 'Requisition needs at least one requirement.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.purchase_requisitions (organization_id, requisition_number, source, status, priority, delivery_location_id,
    justification, idempotency_key, requested_by)
  VALUES (p_organization_id, public.procurement_number('RC'), 'SHORTAGE', 'SUBMITTED',
    COALESCE(nullif(p_payload->>'priority',''), 'medium'), nullif(p_payload->>'delivery_location_id','')::uuid,
    nullif(btrim(p_payload->>'justification'),''), v_key, p_actor)
  RETURNING * INTO v_req;

  FOR v_rid IN SELECT DISTINCT jsonb_array_elements_text(p_payload->'requirement_ids') ORDER BY 1 LOOP
    SELECT * INTO r FROM public.project_requirements WHERE organization_id = p_organization_id AND id = v_rid::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Requirement not found in tenant.' USING ERRCODE = 'P0002'; END IF;
    IF r.status <> 'CONFIRMED' OR r.requirement_type NOT IN ('MATERIAL','EXTERNAL_SERVICE') OR r.item_id IS NULL THEN
      RAISE EXCEPTION 'Requirement % is not a confirmed material with an item.', r.title USING ERRCODE = '23514';
    END IF;
    SELECT * INTO cov FROM public.supply_requirement_coverage c WHERE c.organization_id = p_organization_id AND c.requirement_id = r.id;
    v_open := public.procurement_requested_open(p_organization_id, r.id);
    v_short := COALESCE(cov.shortage_qty, 0) - v_open;
    IF v_short <= 0 THEN
      RAISE EXCEPTION 'Requirement % has no uncovered shortage left to requisition (% already requested).', r.title, v_open
        USING ERRCODE = '23514';
    END IF;
    SELECT l.id INTO v_line FROM public.purchase_requisition_lines l
     WHERE l.organization_id = p_organization_id AND l.requisition_id = v_req.id AND l.item_id = r.item_id;
    IF v_line IS NULL THEN
      INSERT INTO public.purchase_requisition_lines (organization_id, requisition_id, item_id, quantity, required_by)
      VALUES (p_organization_id, v_req.id, r.item_id, v_short, r.required_by) RETURNING id INTO v_line;
    ELSE
      UPDATE public.purchase_requisition_lines SET quantity = quantity + v_short,
        required_by = LEAST(required_by, r.required_by) WHERE id = v_line;
    END IF;
    INSERT INTO public.purchase_requisition_line_requirements (organization_id, line_id, requirement_id, quantity)
    VALUES (p_organization_id, v_line, r.id, v_short);
    v_projects := array_append(v_projects, r.project_id);
    v_n := v_n + 1; v_line := NULL;
  END LOOP;

  SELECT min(required_by) INTO v_min FROM public.purchase_requisition_lines WHERE requisition_id = v_req.id;
  UPDATE public.purchase_requisitions SET required_by = v_min,
    project_id = CASE WHEN (SELECT count(DISTINCT x) FROM unnest(v_projects) x) = 1 THEN v_projects[1] ELSE NULL END
  WHERE id = v_req.id RETURNING * INTO v_req;
  PERFORM public.emit_domain_event(p_organization_id, 'supply.requisition.submitted', 1, 'purchase_requisition', v_req.id,
    'requisition:' || v_req.id || ':submitted', jsonb_build_object('project_id', v_req.project_id, 'requisition_number',
      v_req.requisition_number, 'requirements', v_n, 'source', 'SHORTAGE'), now(), 'human', p_actor);
  RETURN jsonb_build_object('requisition_id', v_req.id, 'requisition_number', v_req.requisition_number, 'replayed', false);
END $$;

-- Exceção manual: justificativa obrigatória; linhas por item.
CREATE OR REPLACE FUNCTION public.purchase_requisition_create_manual(p_organization_id uuid, p_actor uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_req public.purchase_requisitions%ROWTYPE; line jsonb; v_key text;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['procurement.request']);
  v_key := nullif(p_payload->>'idempotency_key','');
  IF v_key IS NOT NULL THEN
    SELECT * INTO v_req FROM public.purchase_requisitions WHERE organization_id = p_organization_id AND idempotency_key = v_key;
    IF FOUND THEN RETURN jsonb_build_object('requisition_id', v_req.id, 'requisition_number', v_req.requisition_number, 'replayed', true); END IF;
  END IF;
  IF jsonb_typeof(p_payload->'lines') <> 'array' OR jsonb_array_length(p_payload->'lines') = 0 THEN
    RAISE EXCEPTION 'Requisition needs at least one line.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.purchase_requisitions (organization_id, requisition_number, project_id, source, status, priority, required_by,
    delivery_location_id, justification, idempotency_key, requested_by)
  VALUES (p_organization_id, public.procurement_number('RC'), nullif(p_payload->>'project_id',''), 'MANUAL', 'SUBMITTED',
    COALESCE(nullif(p_payload->>'priority',''), 'medium'), nullif(p_payload->>'required_by','')::date,
    nullif(p_payload->>'delivery_location_id','')::uuid, p_payload->>'justification', v_key, p_actor)
  RETURNING * INTO v_req;
  FOR line IN SELECT * FROM jsonb_array_elements(p_payload->'lines') LOOP
    INSERT INTO public.purchase_requisition_lines (organization_id, requisition_id, item_id, quantity, required_by,
      estimated_unit_price, note)
    VALUES (p_organization_id, v_req.id, (line->>'item_id')::uuid, (line->>'quantity')::numeric,
      COALESCE(nullif(line->>'required_by','')::date, v_req.required_by), nullif(line->>'estimated_unit_price','')::numeric,
      nullif(btrim(line->>'note'),''));
  END LOOP;
  PERFORM public.emit_domain_event(p_organization_id, 'supply.requisition.submitted', 1, 'purchase_requisition', v_req.id,
    'requisition:' || v_req.id || ':submitted', jsonb_build_object('project_id', v_req.project_id, 'requisition_number',
      v_req.requisition_number, 'source', 'MANUAL', 'justification', v_req.justification), now(), 'human', p_actor);
  RETURN jsonb_build_object('requisition_id', v_req.id, 'requisition_number', v_req.requisition_number, 'replayed', false);
END $$;

CREATE OR REPLACE FUNCTION public.purchase_requisition_cancel(p_organization_id uuid, p_actor uuid, p_requisition_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.purchase_requisitions%ROWTYPE;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['procurement.request','procurement.source']);
  IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Cancellation requires a reason.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v FROM public.purchase_requisitions WHERE organization_id = p_organization_id AND id = p_requisition_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Requisition not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF v.status = 'CANCELLED' THEN RETURN jsonb_build_object('requisition_id', v.id, 'status', v.status, 'replayed', true); END IF;
  IF EXISTS (SELECT 1 FROM public.purchase_order_lines pl JOIN public.purchase_requisition_lines l ON l.id = pl.requisition_line_id
              JOIN public.purchase_orders po ON po.id = pl.purchase_order_id
             WHERE l.requisition_id = v.id AND po.status <> 'CANCELLED') THEN
    RAISE EXCEPTION 'Requisition already has a purchase order: cancel the order first.' USING ERRCODE = '23514';
  END IF;
  UPDATE public.purchase_requisitions SET status = 'CANCELLED', closed_at = now(), close_reason = btrim(p_reason) WHERE id = v.id;
  PERFORM public.emit_domain_event(p_organization_id, 'supply.requisition.cancelled', 1, 'purchase_requisition', v.id,
    'requisition:' || v.id || ':cancelled', jsonb_build_object('project_id', v.project_id, 'reason', btrim(p_reason)), now(), 'human', p_actor);
  RETURN jsonb_build_object('requisition_id', v.id, 'status', 'CANCELLED', 'replayed', false);
END $$;

-- ---------------------------------------------------------------------------
-- 10) Atos: cotação e proposta
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.procurement_rfq_create(p_organization_id uuid, p_actor uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_rfq public.procurement_rfqs%ROWTYPE; v_lid text; l public.purchase_requisition_lines%ROWTYPE; v_sid text;
        v_status text;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['procurement.source']);
  IF jsonb_array_length(COALESCE(p_payload->'requisition_line_ids','[]')) = 0 OR jsonb_array_length(COALESCE(p_payload->'supplier_ids','[]')) = 0 THEN
    RAISE EXCEPTION 'RFQ needs requisition lines and at least one supplier.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.procurement_rfqs (organization_id, rfq_number, response_due, note, created_by)
  VALUES (p_organization_id, public.procurement_number('COT'), nullif(p_payload->>'response_due','')::date,
    nullif(btrim(p_payload->>'note'),''), p_actor) RETURNING * INTO v_rfq;
  FOR v_lid IN SELECT DISTINCT jsonb_array_elements_text(p_payload->'requisition_line_ids') LOOP
    SELECT * INTO l FROM public.purchase_requisition_lines WHERE organization_id = p_organization_id AND id = v_lid::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Requisition line not found in tenant.' USING ERRCODE = 'P0002'; END IF;
    SELECT status INTO v_status FROM public.purchase_requisitions WHERE id = l.requisition_id FOR UPDATE;
    IF v_status NOT IN ('SUBMITTED','SOURCING') THEN
      RAISE EXCEPTION 'Requisition is %: it is not sourced.', v_status USING ERRCODE = '23514';
    END IF;
    -- Uma linha de requisição em uma cotação viva por vez.
    IF EXISTS (SELECT 1 FROM public.procurement_rfq_lines x JOIN public.procurement_rfqs q ON q.id = x.rfq_id
                WHERE x.requisition_line_id = l.id AND q.status IN ('OPEN','DECIDED') AND q.id <> v_rfq.id) THEN
      RAISE EXCEPTION 'RFQ line already in a live RFQ.' USING ERRCODE = '23505';
    END IF;
    INSERT INTO public.procurement_rfq_lines (organization_id, rfq_id, requisition_line_id, item_id, quantity, required_by)
    VALUES (p_organization_id, v_rfq.id, l.id, l.item_id, l.quantity, l.required_by);
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
END $$;

CREATE OR REPLACE FUNCTION public.procurement_quote_record(p_organization_id uuid, p_actor uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_rfq public.procurement_rfqs%ROWTYPE; v_sup uuid; v_version int; v_quote public.supplier_quotes%ROWTYPE; line jsonb;
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
    INSERT INTO public.supplier_quote_lines (organization_id, quote_id, rfq_line_id, unit_price, quantity, lead_time_days, compliant, note)
    VALUES (p_organization_id, v_quote.id, (line->>'rfq_line_id')::uuid, (line->>'unit_price')::numeric,
      COALESCE(nullif(line->>'quantity','')::numeric, (SELECT quantity FROM public.procurement_rfq_lines WHERE id = (line->>'rfq_line_id')::uuid)),
      nullif(line->>'lead_time_days','')::int, COALESCE((line->>'compliant')::boolean, true), nullif(btrim(line->>'note'),''));
  END LOOP;
  PERFORM public.emit_domain_event(p_organization_id, 'supply.quote.recorded', 1, 'supplier_quote', v_quote.id,
    'quote:' || v_quote.id || ':recorded', jsonb_build_object('rfq_id', v_rfq.id, 'supplier_id', v_sup, 'version', v_version),
    now(), 'human', p_actor);
  RETURN jsonb_build_object('quote_id', v_quote.id, 'version', v_version);
END $$;

/*
  DECISÃO → PEDIDO (rascunho), no mesmo ato e idempotente pela cotação.
  A proposta escolhida precisa estar viva (última versão, válida, fornecedor
  não restrito). Seguir ou não a recomendação da Apex fica registrado, com
  a justificativa humana e a foto da comparação. As linhas do pedido
  espelham a proposta; a quantidade de cada linha é alocada aos requisitos
  da requisição na ordem da data de necessidade.
*/
CREATE OR REPLACE FUNCTION public.procurement_decide(p_organization_id uuid, p_actor uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_rfq public.procurement_rfqs%ROWTYPE; v_quote public.supplier_quotes%ROWTYPE; v_sup public.supplier_profiles%ROWTYPE;
        v_dec public.sourcing_decisions%ROWTYPE; v_po public.purchase_orders%ROWTYPE; ql record; v_line uuid; alloc record;
        v_left numeric; v_take numeric; v_projects text[] := '{}'; v_rec uuid; v_loc uuid;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['procurement.source']);
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
              JOIN public.procurement_rfq_lines x ON x.id = q.rfq_line_id WHERE q.quote_id = v_quote.id ORDER BY x.required_by NULLS LAST, q.id LOOP
    INSERT INTO public.purchase_order_lines (organization_id, purchase_order_id, item_id, quantity, unit_price, expected_date,
      requisition_line_id, quote_line_id)
    VALUES (p_organization_id, v_po.id, ql.item_id, ql.quantity, ql.unit_price,
      CASE WHEN COALESCE(ql.lead_time_days, v_quote.lead_time_days) IS NOT NULL
           THEN (now() AT TIME ZONE 'America/Sao_Paulo')::date + COALESCE(ql.lead_time_days, v_quote.lead_time_days) END,
      ql.requisition_line_id, ql.id)
    RETURNING id INTO v_line;
    v_left := ql.quantity;
    FOR alloc IN SELECT a.requirement_id, a.quantity, pr.project_id FROM public.purchase_requisition_line_requirements a
                   JOIN public.project_requirements pr ON pr.id = a.requirement_id
                  WHERE a.line_id = ql.requisition_line_id ORDER BY pr.required_by NULLS LAST, a.id LOOP
      EXIT WHEN v_left <= 0;
      v_take := least(v_left, alloc.quantity);
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
  RETURN jsonb_build_object('decision_id', v_dec.id, 'purchase_order_id', v_po.id, 'order_number', v_po.order_number, 'replayed', false);
END $$;

-- ---------------------------------------------------------------------------
-- 11) Atos: pedido de compra
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purchase_order_update_draft(p_organization_id uuid, p_actor uuid, p_po_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.purchase_orders%ROWTYPE;
BEGIN
  PERFORM public.inventory_require(p_organization_id, p_actor, ARRAY['procurement.source']);
  SELECT * INTO v FROM public.purchase_orders WHERE organization_id = p_organization_id AND id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF v.status <> 'DRAFT' THEN RAISE EXCEPTION 'Purchase order is %: only a draft is edited.', v.status USING ERRCODE = '23514'; END IF;
  UPDATE public.purchase_orders SET
    delivery_location_id = CASE WHEN p_payload ? 'delivery_location_id' THEN nullif(p_payload->>'delivery_location_id','')::uuid ELSE delivery_location_id END,
    expected_delivery = CASE WHEN p_payload ? 'expected_delivery' THEN nullif(p_payload->>'expected_delivery','')::date ELSE expected_delivery END,
    payment_terms = CASE WHEN p_payload ? 'payment_terms' THEN nullif(btrim(p_payload->>'payment_terms'),'') ELSE payment_terms END
  WHERE id = v.id RETURNING * INTO v;
  PERFORM public.purchase_order_log(v, 'edited', 'DRAFT', NULL, p_payload, p_actor);
  RETURN jsonb_build_object('purchase_order_id', v.id, 'status', v.status);
END $$;

/*
  Submeter: consulta o motor. Com política, o pedido vai para a caixa de
  aprovações da plataforma. Sem política, fica esperando quem tenha ALÇADA
  DECLARADA. Nunca se aprova sozinho.
*/
CREATE OR REPLACE FUNCTION public.purchase_order_submit(p_organization_id uuid, p_actor uuid, p_po_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.purchase_orders%ROWTYPE; appr jsonb; fp text; v_gov text;
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
  appr := public.approval_request_create(p_organization_id, 'purchase_order', v.id, 'approve', 'APPROVAL', p_note,
    jsonb_build_object('order_number', v.order_number, 'total', public.purchase_order_total(v.id), 'currency', v.currency,
      'submitted_by', p_actor),
    'purchase-order-approval:' || v.id || ':' || fp, NULL, NULL, NULL);
  v_gov := CASE WHEN (appr->>'status') IN ('NO_POLICY','SUBJECT_TYPE_UNSUPPORTED') THEN 'AUTHORITY' ELSE 'POLICY' END;
  UPDATE public.purchase_orders SET status = 'APPROVAL_REQUIRED', approval_governance = v_gov,
    approval_request_id = CASE WHEN v_gov = 'POLICY' THEN nullif(appr->>'request_id','')::uuid END,
    submitted_by = p_actor, submitted_at = now()
  WHERE id = v.id RETURNING * INTO v;
  PERFORM public.purchase_order_log(v, 'submitted', 'DRAFT', p_note,
    jsonb_build_object('governance', v_gov, 'approval', appr, 'fingerprint', fp), p_actor);
  RETURN jsonb_build_object('purchase_order_id', v.id, 'status', v.status, 'governance', v_gov, 'approval', appr, 'replayed', false);
END $$;

-- Decisão por ALÇADA DECLARADA (quando não há política no motor).
CREATE OR REPLACE FUNCTION public.purchase_order_decide(
  p_organization_id uuid, p_actor uuid, p_po_id uuid, p_decision text, p_note text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
  v_authority := public.procurement_authority_for(p_organization_id, p_actor, v_total, v.currency, v.project_id);
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
END $$;

-- Desfecho do motor (trabalho de plataforma, reentregável).
CREATE OR REPLACE FUNCTION public.purchase_order_apply_approval(p_approval_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE req public.approval_requests%ROWTYPE; v public.purchase_orders%ROWTYPE; fp text;
BEGIN
  SELECT * INTO req FROM public.approval_requests WHERE id = p_approval_request_id;
  IF NOT FOUND OR req.subject_type <> 'purchase_order' THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'NOT_A_PURCHASE_ORDER_APPROVAL');
  END IF;
  SELECT * INTO v FROM public.purchase_orders WHERE organization_id = req.organization_id AND id = req.subject_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('applied', false, 'reason', 'PURCHASE_ORDER_NOT_FOUND'); END IF;
  IF v.status <> 'APPROVAL_REQUIRED' OR v.approval_request_id IS DISTINCT FROM req.id THEN
    RETURN jsonb_build_object('applied', false, 'idempotent', true, 'status', v.status);
  END IF;
  IF req.status IN ('REJECTED','RETURNED_FOR_CORRECTION','CANCELLED','EXPIRED') THEN
    UPDATE public.purchase_orders SET status = 'DRAFT', approval_governance = NULL, approval_request_id = NULL
     WHERE id = v.id RETURNING * INTO v;
    PERFORM public.purchase_order_log(v, 'rejected', 'APPROVAL_REQUIRED', req.outcome_reason,
      jsonb_build_object('approval_request_id', req.id, 'outcome', req.status), req.finalized_by, 'system');
    RETURN jsonb_build_object('applied', true, 'status', v.status);
  END IF;
  IF req.status <> 'APPROVED' THEN RETURN jsonb_build_object('applied', false, 'reason', 'NOT_FINALIZED', 'status', req.status); END IF;
  fp := public.purchase_order_fingerprint(v.id);
  IF req.subject_fingerprint IS DISTINCT FROM fp THEN
    UPDATE public.purchase_orders SET status = 'DRAFT', approval_governance = NULL, approval_request_id = NULL
     WHERE id = v.id RETURNING * INTO v;
    PERFORM public.purchase_order_log(v, 'approval_stale', 'APPROVAL_REQUIRED', 'O pedido mudou depois da aprovação.',
      jsonb_build_object('approved_fingerprint', req.subject_fingerprint, 'current_fingerprint', fp), NULL, 'system');
    RETURN jsonb_build_object('applied', false, 'reason', 'FINGERPRINT_CHANGED');
  END IF;
  UPDATE public.purchase_orders SET status = 'APPROVED', approved_fingerprint = fp, approved_by = req.finalized_by, approved_at = now()
   WHERE id = v.id RETURNING * INTO v;
  PERFORM public.purchase_order_log(v, 'approved', 'APPROVAL_REQUIRED', req.outcome_reason,
    jsonb_build_object('governance', 'POLICY', 'approval_request_id', req.id, 'fingerprint', fp), req.finalized_by, 'system');
  RETURN jsonb_build_object('applied', true, 'status', v.status);
END $$;

CREATE OR REPLACE FUNCTION public.purchase_order_issue(p_organization_id uuid, p_actor uuid, p_po_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.purchase_orders%ROWTYPE; v_sup text; fp text;
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
  UPDATE public.purchase_orders SET status = 'ISSUED', issued_by = p_actor, issued_at = now() WHERE id = v.id RETURNING * INTO v;
  -- Requisição toda com pedido emitido está atendida pela compra.
  UPDATE public.purchase_requisitions r SET status = 'ORDERED'
   WHERE r.organization_id = p_organization_id AND r.status IN ('SUBMITTED','SOURCING')
     AND r.id IN (SELECT l.requisition_id FROM public.purchase_requisition_lines l
                   JOIN public.purchase_order_lines pl ON pl.requisition_line_id = l.id WHERE pl.purchase_order_id = v.id)
     AND NOT EXISTS (SELECT 1 FROM public.purchase_requisition_lines l2 WHERE l2.requisition_id = r.id
                      AND NOT EXISTS (SELECT 1 FROM public.purchase_order_lines pl2 JOIN public.purchase_orders po2 ON po2.id = pl2.purchase_order_id
                                       WHERE pl2.requisition_line_id = l2.id AND po2.status IN ('ISSUED','PARTIALLY_RECEIVED','RECEIVED','CLOSED')));
  PERFORM public.purchase_order_log(v, 'issued', 'APPROVED', NULL, jsonb_build_object('fingerprint', fp), p_actor);
  RETURN jsonb_build_object('purchase_order_id', v.id, 'status', v.status, 'replayed', false);
END $$;

CREATE OR REPLACE FUNCTION public.purchase_order_cancel(p_organization_id uuid, p_actor uuid, p_po_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.purchase_orders%ROWTYPE; v_from text;
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
  UPDATE public.purchase_orders SET status = 'CANCELLED', closed_at = now(), close_reason = btrim(p_reason) WHERE id = v.id RETURNING * INTO v;
  -- Requisição volta a esperar compra (a falta reaparece como "requisitado").
  UPDATE public.purchase_requisitions r SET status = 'SUBMITTED'
   WHERE r.organization_id = p_organization_id AND r.status IN ('ORDERED','SOURCING')
     AND r.id IN (SELECT l.requisition_id FROM public.purchase_requisition_lines l
                   JOIN public.purchase_order_lines pl ON pl.requisition_line_id = l.id WHERE pl.purchase_order_id = v.id);
  UPDATE public.procurement_rfqs q SET status = 'CANCELLED', close_reason = 'Pedido ' || v.order_number || ' cancelado: ' || btrim(p_reason)
   WHERE q.id = (SELECT rfq_id FROM public.sourcing_decisions WHERE id = v.sourcing_decision_id);
  PERFORM public.purchase_order_log(v, 'cancelled', v_from, p_reason, '{}'::jsonb, p_actor);
  RETURN jsonb_build_object('purchase_order_id', v.id, 'status', v.status, 'replayed', false);
END $$;

-- ---------------------------------------------------------------------------
-- 12) O motor de aprovação aprende o pedido de compra
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approval_subject_resolve(
  p_organization_id uuid,
  p_subject_type    text,
  p_subject_id      uuid
) RETURNS TABLE (
  supported        boolean,
  found            boolean,
  fingerprint      text,
  amount           numeric,
  currency         text,
  label            text,
  created_by       uuid,
  business_domain  text,
  contract_type    text,
  risk_class       text,
  cost_center_id   uuid,
  business_unit_id uuid
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  c   public.contracts%ROWTYPE;
  rev public.contract_amendment_revisions%ROWTYPE;
  pm  public.project_measurements%ROWTYPE;
  be  public.contract_billing_events%ROWTYPE;
  po  public.purchase_orders%ROWTYPE;
  caller_org uuid;
  domain text;
BEGIN
  IF p_subject_type NOT IN ('contract','contract_amendment_revision',
                            'project_measurement','contract_billing_event','purchase_order') THEN
    RETURN QUERY SELECT false, false, NULL::text, NULL::numeric, NULL::text, NULL::text,
                        NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  domain := CASE WHEN p_subject_type = 'project_measurement' THEN 'projects'
                 WHEN p_subject_type = 'purchase_order' THEN 'procurement' ELSE 'contracts' END;

  caller_org := public.apex_browser_organization();
  IF caller_org IS NOT NULL AND p_organization_id IS DISTINCT FROM caller_org THEN
    RETURN QUERY SELECT true, false, NULL::text, NULL::numeric, NULL::text, NULL::text,
                        NULL::uuid, domain, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  IF p_subject_type = 'contract' THEN
    SELECT * INTO c FROM public.contracts
     WHERE id = p_subject_id AND organization_id = p_organization_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RETURN QUERY SELECT true, false, NULL::text, NULL::numeric, NULL::text, NULL::text,
                          NULL::uuid, 'contracts'::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
      RETURN;
    END IF;
    RETURN QUERY SELECT
      true, true,
      public.contract_approval_fingerprint(c.id),
      c.total_value,
      CASE WHEN c.currency IS NOT NULL AND c.currency ~ '^[A-Z]{3}$' THEN c.currency END,
      COALESCE(c.contract_number || ' — ', '') || COALESCE(c.title, 'Contrato'),
      c.created_by,
      'contracts'::text, c.contract_type, c.risk_level, NULL::uuid, NULL::uuid;
    RETURN;

  ELSIF p_subject_type = 'contract_amendment_revision' THEN
    SELECT * INTO rev FROM public.contract_amendment_revisions
     WHERE id = p_subject_id AND organization_id = p_organization_id;
    IF NOT FOUND THEN
      RETURN QUERY SELECT true, false, NULL::text, NULL::numeric, NULL::text, NULL::text,
                          NULL::uuid, 'contracts'::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
      RETURN;
    END IF;
    SELECT * INTO c FROM public.contracts WHERE id = rev.contract_id;
    RETURN QUERY SELECT
      true, true,
      encode(extensions.digest(concat_ws('|', 'contract_amendment_revision.v1',
        rev.id::text, rev.revision::text, rev.amendment_id::text,
        md5(COALESCE(rev.amendment_snapshot, '{}'::jsonb)::text))::bytea, 'sha256'), 'hex'),
      NULLIF(rev.amendment_snapshot->>'value_delta','')::numeric,
      CASE WHEN c.currency ~ '^[A-Z]{3}$' THEN c.currency END,
      format('Aditivo rev. %s — %s', rev.revision, COALESCE(c.contract_number, c.title, 'contrato')),
      NULL::uuid,
      'contracts'::text, c.contract_type, c.risk_level, NULL::uuid, NULL::uuid;
    RETURN;

  ELSIF p_subject_type = 'project_measurement' THEN
    SELECT * INTO pm FROM public.project_measurements
     WHERE id = p_subject_id AND organization_id = p_organization_id;
    IF NOT FOUND THEN
      RETURN QUERY SELECT true, false, NULL::text, NULL::numeric, NULL::text, NULL::text,
                          NULL::uuid, 'projects'::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
      RETURN;
    END IF;
    SELECT * INTO c FROM public.contracts WHERE id = pm.contract_id;
    RETURN QUERY SELECT
      true, true,
      public.project_measurement_fingerprint(pm.id),
      pm.measured_value,
      CASE WHEN pm.currency ~ '^[A-Z]{3}$' THEN pm.currency END,
      format('Medição %s rev. %s — %s', pm.occurrence_key, pm.revision,
             COALESCE(c.contract_number, c.title, 'contrato')),
      pm.created_by,
      'projects'::text, c.contract_type, c.risk_level, NULL::uuid, NULL::uuid;
    RETURN;

  ELSIF p_subject_type = 'purchase_order' THEN
    -- Compras (234): o valor é o total do pedido; quem o criou é a base do SoD de autoria.
    SELECT * INTO po FROM public.purchase_orders
     WHERE id = p_subject_id AND organization_id = p_organization_id;
    IF NOT FOUND THEN
      RETURN QUERY SELECT true, false, NULL::text, NULL::numeric, NULL::text, NULL::text,
                          NULL::uuid, 'procurement'::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
      RETURN;
    END IF;
    RETURN QUERY SELECT
      true, true,
      public.purchase_order_fingerprint(po.id),
      public.purchase_order_total(po.id),
      po.currency,
      format('Pedido de compra %s — %s', po.order_number,
             COALESCE((SELECT COALESCE(p.trade_name, p.legal_name) FROM public.supplier_profiles s
                        JOIN public.parties p ON p.id = s.party_id WHERE s.id = po.supplier_id), 'fornecedor')),
      po.created_by,
      'procurement'::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
    RETURN;

  ELSE
    SELECT * INTO be FROM public.contract_billing_events
     WHERE id = p_subject_id AND organization_id = p_organization_id;
    IF NOT FOUND THEN
      RETURN QUERY SELECT true, false, NULL::text, NULL::numeric, NULL::text, NULL::text,
                          NULL::uuid, 'contracts'::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
      RETURN;
    END IF;
    SELECT * INTO c FROM public.contracts WHERE id = be.contract_id;
    RETURN QUERY SELECT
      true, true,
      public.contract_billing_fingerprint(be.id),
      be.amount,
      CASE WHEN be.currency ~ '^[A-Z]{3}$' THEN be.currency END,
      format('Faturamento %s — %s', COALESCE(be.title, be.id::text),
             COALESCE(c.contract_number, c.title, 'contrato')),
      NULL::uuid,
      'contracts'::text, c.contract_type, c.risk_level, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.approval_subject_resolve(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;

/*
  Desfecho do motor volta ao pedido por trabalho durável (mesmo padrão do
  faturamento, 139) — rota semeada DESLIGADA. Ligá-la antes de o código do
  handler estar publicado faria os trabalhadores em produção receberem um
  tipo de trabalho que não conhecem. Até lá, o pedido tem o ato explícito de
  sincronizar o desfecho (mesma função, idempotente). Ligar a rota é passo de
  publicação: UPDATE apex_event_routes SET enabled = true WHERE job_type = ...
*/
INSERT INTO public.apex_event_routes (event_type, schema_version, job_type, max_attempts, enabled, note) VALUES
  ('approval.request.approved', 1, 'procurement.purchase_order.apply_approval', 5, false,
   'Aplica aprovação de pedido de compra decidida no motor, conferindo a impressão digital (234). Ligar na publicação.'),
  ('approval.request.rejected', 1, 'procurement.purchase_order.apply_approval', 5, false,
   'Rejeição de pedido de compra volta o pedido ao rascunho (234). Ligar na publicação.')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 13) Cobertura: em pedido e requisitado entram no contrato da 232
-- ---------------------------------------------------------------------------
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
base AS (
  SELECT r.organization_id, r.id AS requirement_id, r.project_id, r.activity_id, r.item_id, r.requirement_type,
    r.required_by, r.unit, r.quantity AS required_qty,
    COALESCE(res.reserved, 0) AS reserved_qty,
    COALESCE(res.consumed, 0) AS consumed_qty,
    COALESCE(transit.in_transit, 0) AS in_transit_qty,
    COALESCE(ordered.on_order, 0) AS on_order_qty,
    COALESCE(requested.requested, 0) AS requested_qty
  FROM public.project_requirements r
  LEFT JOIN res ON res.organization_id = r.organization_id AND res.requirement_id = r.id
  LEFT JOIN transit ON transit.organization_id = r.organization_id AND transit.requirement_id = r.id
  LEFT JOIN ordered ON ordered.organization_id = r.organization_id AND ordered.requirement_id = r.id
  LEFT JOIN requested ON requested.organization_id = r.organization_id AND requested.requirement_id = r.id
  WHERE r.status = 'CONFIRMED' AND r.requirement_type IN ('MATERIAL','EXTERNAL_SERVICE'))
SELECT organization_id, requirement_id, project_id, activity_id, item_id, requirement_type, required_by, unit,
  required_qty, reserved_qty, consumed_qty, in_transit_qty, on_order_qty, requested_qty,
  reserved_qty + consumed_qty AS covered_qty,
  in_transit_qty + on_order_qty AS inbound_qty,
  GREATEST(COALESCE(required_qty, 0) - reserved_qty - consumed_qty - in_transit_qty - on_order_qty, 0) AS shortage_qty
FROM base;

COMMENT ON VIEW public.supply_requirement_coverage IS
  'Cobertura DERIVADA por requisito de material: coberto = reservado + consumido; entrando = em trânsito + em pedido; falta = requerido − coberto − entrando. Requisitado é mostrado à parte. Nada é gravado.';
GRANT SELECT ON public.supply_requirement_coverage TO authenticated;

-- ---------------------------------------------------------------------------
-- 14) Privilégios e RLS
-- ---------------------------------------------------------------------------
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'procurement_number(text)', 'purchase_order_total(uuid)', 'purchase_order_fingerprint(uuid)',
    'procurement_authority_for(uuid,uuid,numeric,text,text)', 'procurement_requested_open(uuid,uuid)',
    'procurement_on_order(uuid,uuid)',
    'purchase_order_log(public.purchase_orders,text,text,text,jsonb,uuid,text)',
    'supplier_quote_guard()', 'purchase_order_line_guard()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'supplier_register(uuid,uuid,jsonb)', 'supplier_set_status(uuid,uuid,uuid,text,text)',
    'procurement_authority_declare(uuid,uuid,jsonb)', 'procurement_authority_revoke(uuid,uuid,uuid,text)',
    'purchase_requisition_from_shortage(uuid,uuid,jsonb)', 'purchase_requisition_create_manual(uuid,uuid,jsonb)',
    'purchase_requisition_cancel(uuid,uuid,uuid,text)', 'procurement_rfq_create(uuid,uuid,jsonb)',
    'procurement_quote_record(uuid,uuid,jsonb)', 'procurement_decide(uuid,uuid,jsonb)',
    'purchase_order_update_draft(uuid,uuid,uuid,jsonb)', 'purchase_order_submit(uuid,uuid,uuid,text)',
    'purchase_order_decide(uuid,uuid,uuid,text,text)', 'purchase_order_apply_approval(uuid)',
    'purchase_order_issue(uuid,uuid,uuid)', 'purchase_order_cancel(uuid,uuid,uuid,text)',
    'inventory_requirement_committed(uuid,uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END $$;

/*
  Leitura: Compras vê compras; o planejamento do projeto vê o que alimenta a
  cobertura (requisições, pedidos e suas alocações a requisitos), porque a
  visão de cobertura lê essas tabelas com o privilégio de quem pergunta.
*/
DO $$
DECLARE t text; v_plan boolean; v_suppliers boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['supplier_profiles','procurement_approval_authorities','purchase_requisitions',
      'purchase_requisition_lines','purchase_requisition_line_requirements','procurement_rfqs','procurement_rfq_lines',
      'procurement_rfq_suppliers','supplier_quotes','supplier_quote_lines','sourcing_decisions','purchase_orders',
      'purchase_order_lines','purchase_order_line_requirements','purchase_order_history'] LOOP
    v_plan := t IN ('purchase_requisitions','purchase_requisition_lines','purchase_requisition_line_requirements',
                    'purchase_orders','purchase_order_lines','purchase_order_line_requirements');
    v_suppliers := t = 'supplier_profiles';
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
      USING (organization_id = public.current_user_organization_id()
         AND (public.current_user_has_permission('procurement.view') OR public.current_user_has_permission('supply.view')%s%s))$p$,
      t || '_select', t,
      CASE WHEN v_plan THEN $x$ OR public.current_user_has_permission('receiving.view')
              OR public.current_user_has_permission('operations.planning.view') OR public.current_user_has_permission('projects.view')$x$ ELSE '' END,
      CASE WHEN v_suppliers THEN $x$ OR public.current_user_has_permission('suppliers.view') OR public.current_user_has_permission('receiving.view')$x$ ELSE '' END);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
  END LOOP;
END $$;

COMMIT;
