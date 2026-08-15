-- ============================================================
-- INSIGHT FISCAL — NFS-e service invoice foundation
-- Migration: 090_fiscal_nfse
-- ============================================================
BEGIN;

-- Private, backend-only artifacts. XML/PDF paths are organization-prefixed.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'fiscal-documents', 'fiscal-documents', false, 10485760,
  ARRAY['application/xml', 'text/xml', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- No browser policy is intentional. Artifacts are served by authenticated API routes.

CREATE TABLE IF NOT EXISTS public.fiscal_establishments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  business_unit_id      uuid REFERENCES public.business_unit(id) ON DELETE SET NULL,
  legal_name            text NOT NULL,
  trade_name            text,
  cnpj                  text NOT NULL CHECK (cnpj ~ '^[0-9]{14}$'),
  municipal_registration text NOT NULL,
  state_registration    text,
  tax_regime            text NOT NULL CHECK (tax_regime IN ('mei','simples_nacional','lucro_presumido','lucro_real','other')),
  special_tax_regime    text,
  municipality_ibge     text NOT NULL CHECK (municipality_ibge ~ '^[0-9]{7}$'),
  municipality_name     text NOT NULL,
  uf                    text NOT NULL CHECK (uf ~ '^[A-Z]{2}$'),
  postal_code           text NOT NULL,
  street                text NOT NULL,
  street_number         text NOT NULL,
  complement            text,
  district              text NOT NULL,
  environment           text NOT NULL DEFAULT 'homologation' CHECK (environment IN ('homologation','production')),
  nfse_series           text NOT NULL DEFAULT '1',
  next_dps_number       bigint NOT NULL DEFAULT 1 CHECK (next_dps_number > 0),
  production_enabled    boolean NOT NULL DEFAULT false,
  active                boolean NOT NULL DEFAULT true,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, cnpj, municipal_registration)
);

CREATE TABLE IF NOT EXISTS public.fiscal_provider_configs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  establishment_id      uuid NOT NULL REFERENCES public.fiscal_establishments(id) ON DELETE CASCADE,
  provider_key          text NOT NULL DEFAULT 'sandbox',
  environment           text NOT NULL DEFAULT 'homologation' CHECK (environment IN ('homologation','production')),
  credentials_cipher    text,
  webhook_secret_cipher text,
  certificate_path      text,
  certificate_subject   text,
  certificate_expires_at timestamptz,
  certificate_fingerprint text,
  enabled               boolean NOT NULL DEFAULT false,
  last_health_at        timestamptz,
  last_health_status    text,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (establishment_id, provider_key, environment)
);

CREATE TABLE IF NOT EXISTS public.fiscal_parties (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id             uuid REFERENCES public.client(id) ON DELETE SET NULL,
  legal_name            text NOT NULL,
  trade_name            text,
  document_type         text NOT NULL CHECK (document_type IN ('cpf','cnpj','foreign')),
  document_number       text NOT NULL,
  municipal_registration text,
  state_registration    text,
  email                 text,
  phone                 text,
  municipality_ibge     text,
  municipality_name     text,
  uf                    text,
  country_code          text NOT NULL DEFAULT 'BR',
  postal_code           text,
  street                text,
  street_number         text,
  complement            text,
  district              text,
  active                boolean NOT NULL DEFAULT true,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, document_type, document_number)
);

CREATE TABLE IF NOT EXISTS public.fiscal_service_catalog (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  establishment_id      uuid NOT NULL REFERENCES public.fiscal_establishments(id) ON DELETE CASCADE,
  code                  text NOT NULL,
  description           text NOT NULL,
  lc116_code            text NOT NULL,
  nbs_code              text,
  municipal_service_code text NOT NULL,
  cnae_code             text,
  iss_rate              numeric(7,4) NOT NULL CHECK (iss_rate >= 0 AND iss_rate <= 100),
  pis_rate              numeric(7,4) NOT NULL DEFAULT 0 CHECK (pis_rate >= 0 AND pis_rate <= 100),
  cofins_rate           numeric(7,4) NOT NULL DEFAULT 0 CHECK (cofins_rate >= 0 AND cofins_rate <= 100),
  inss_rate             numeric(7,4) NOT NULL DEFAULT 0 CHECK (inss_rate >= 0 AND inss_rate <= 100),
  ir_rate               numeric(7,4) NOT NULL DEFAULT 0 CHECK (ir_rate >= 0 AND ir_rate <= 100),
  csll_rate             numeric(7,4) NOT NULL DEFAULT 0 CHECK (csll_rate >= 0 AND csll_rate <= 100),
  ibs_rate              numeric(7,4) NOT NULL DEFAULT 0 CHECK (ibs_rate >= 0 AND ibs_rate <= 100),
  cbs_rate              numeric(7,4) NOT NULL DEFAULT 0 CHECK (cbs_rate >= 0 AND cbs_rate <= 100),
  iss_withheld_default  boolean NOT NULL DEFAULT false,
  tax_rules             jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_from        date NOT NULL,
  effective_to          date,
  version               integer NOT NULL DEFAULT 1 CHECK (version > 0),
  active                boolean NOT NULL DEFAULT true,
  approved_by_accountant boolean NOT NULL DEFAULT false,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (establishment_id, code, version)
);

CREATE TABLE IF NOT EXISTS public.fiscal_documents (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  establishment_id      uuid NOT NULL REFERENCES public.fiscal_establishments(id) ON DELETE RESTRICT,
  party_id              uuid NOT NULL REFERENCES public.fiscal_parties(id) ON DELETE RESTRICT,
  project_id            uuid,
  contract_id           uuid,
  business_unit_id      uuid REFERENCES public.business_unit(id) ON DELETE SET NULL,
  cost_center_id        uuid REFERENCES public.cost_center(id) ON DELETE SET NULL,
  revenue_category_id   uuid REFERENCES public.management_category(id) ON DELETE SET NULL,
  kind                  text NOT NULL DEFAULT 'nfse' CHECK (kind = 'nfse'),
  status                text NOT NULL DEFAULT 'draft' CHECK (status IN (
                          'draft','pending_approval','approved','queued','processing',
                          'authorized','rejected','error','cancellation_requested',
                          'cancelled','replaced','archived')),
  competence_date       date NOT NULL,
  issue_date            date,
  due_date              date,
  dps_number            bigint,
  series                text NOT NULL,
  provider_key          text,
  provider_document_id  text,
  access_key            text,
  document_number       text,
  verification_code     text,
  service_amount_cents  bigint NOT NULL CHECK (service_amount_cents > 0),
  deductions_cents      bigint NOT NULL DEFAULT 0 CHECK (deductions_cents >= 0),
  unconditional_discount_cents bigint NOT NULL DEFAULT 0 CHECK (unconditional_discount_cents >= 0),
  conditional_discount_cents bigint NOT NULL DEFAULT 0 CHECK (conditional_discount_cents >= 0),
  withheld_total_cents  bigint NOT NULL DEFAULT 0 CHECK (withheld_total_cents >= 0),
  issuer_tax_total_cents bigint NOT NULL DEFAULT 0 CHECK (issuer_tax_total_cents >= 0),
  net_amount_cents      bigint NOT NULL CHECK (net_amount_cents >= 0),
  service_location_ibge text NOT NULL CHECK (service_location_ibge ~ '^[0-9]{7}$'),
  description           text NOT NULL,
  additional_information text,
  issuer_snapshot       jsonb NOT NULL,
  recipient_snapshot    jsonb NOT NULL,
  service_snapshot      jsonb NOT NULL,
  tax_snapshot          jsonb NOT NULL,
  provider_payload_sanitized jsonb,
  rejection_code        text,
  rejection_message     text,
  authorized_at         timestamptz,
  cancelled_at          timestamptz,
  replaced_document_id  uuid REFERENCES public.fiscal_documents(id) ON DELETE SET NULL,
  replacement_document_id uuid REFERENCES public.fiscal_documents(id) ON DELETE SET NULL,
  xml_storage_path      text,
  xml_sha256            text,
  danfse_storage_path   text,
  danfse_sha256         text,
  finance_status        text NOT NULL DEFAULT 'not_posted' CHECK (finance_status IN ('not_posted','pending_configuration','posted','reversed','review_required','error')),
  ledger_entry_id       uuid REFERENCES public.ledger_entry(id) ON DELETE SET NULL,
  apar_title_id         uuid REFERENCES public.apar_title(id) ON DELETE SET NULL,
  idempotency_key       text NOT NULL,
  submitted_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at           timestamptz,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (organization_id, access_key)
);

CREATE TABLE IF NOT EXISTS public.fiscal_document_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_id           uuid NOT NULL REFERENCES public.fiscal_documents(id) ON DELETE CASCADE,
  service_catalog_id    uuid REFERENCES public.fiscal_service_catalog(id) ON DELETE SET NULL,
  sequence              integer NOT NULL CHECK (sequence > 0),
  description           text NOT NULL,
  quantity              numeric(15,4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_amount_cents     bigint NOT NULL CHECK (unit_amount_cents > 0),
  total_amount_cents    bigint NOT NULL CHECK (total_amount_cents > 0),
  service_snapshot      jsonb NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, sequence)
);

CREATE TABLE IF NOT EXISTS public.fiscal_tax_lines (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_id           uuid NOT NULL REFERENCES public.fiscal_documents(id) ON DELETE CASCADE,
  tax_code              text NOT NULL CHECK (tax_code IN ('ISS','PIS','COFINS','INSS','IRRF','CSLL','IBS','CBS','OTHER')),
  tax_base_cents        bigint NOT NULL CHECK (tax_base_cents >= 0),
  rate                  numeric(7,4) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  amount_cents          bigint NOT NULL CHECK (amount_cents >= 0),
  responsibility        text NOT NULL CHECK (responsibility IN ('issuer','recipient','informational')),
  withheld              boolean NOT NULL DEFAULT false,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fiscal_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_id           uuid NOT NULL REFERENCES public.fiscal_documents(id) ON DELETE CASCADE,
  event_type            text NOT NULL,
  previous_status       text,
  next_status           text,
  provider_event_id     text,
  message               text,
  payload_sanitized     jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider_event_id)
);

CREATE TABLE IF NOT EXISTS public.fiscal_transmission_attempts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_id           uuid NOT NULL REFERENCES public.fiscal_documents(id) ON DELETE CASCADE,
  operation             text NOT NULL CHECK (operation IN ('issue','consult','cancel','replace','artifact')),
  attempt_number        integer NOT NULL CHECK (attempt_number > 0),
  request_id            text NOT NULL,
  status                text NOT NULL CHECK (status IN ('started','success','retryable_error','terminal_error')),
  http_status           integer,
  provider_code         text,
  safe_message          text,
  duration_ms           integer,
  started_at            timestamptz NOT NULL DEFAULT now(),
  finished_at           timestamptz,
  UNIQUE (document_id, operation, attempt_number),
  UNIQUE (request_id)
);

CREATE TABLE IF NOT EXISTS public.fiscal_jobs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_id           uuid NOT NULL REFERENCES public.fiscal_documents(id) ON DELETE CASCADE,
  operation             text NOT NULL CHECK (operation IN ('issue','consult','cancel','replace','artifact','finance_post','finance_reverse')),
  status                text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','dead_letter')),
  idempotency_key       text NOT NULL,
  payload               jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts              integer NOT NULL DEFAULT 0,
  max_attempts          integer NOT NULL DEFAULT 6,
  next_attempt_at       timestamptz NOT NULL DEFAULT now(),
  locked_at             timestamptz,
  locked_by             text,
  last_error            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.tax_obligation (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  fiscal_document_id    uuid REFERENCES public.fiscal_documents(id) ON DELETE SET NULL,
  tax_type              text NOT NULL,
  title                 text NOT NULL,
  description           text,
  competence_month      text NOT NULL CHECK (competence_month ~ '^[0-9]{4}-[0-9]{2}$'),
  due_date              date NOT NULL,
  paid_date             date,
  status                text NOT NULL DEFAULT 'open' CHECK (status IN ('open','scheduled','paid','partial','overdue','cancelled')),
  amount_cents          bigint NOT NULL CHECK (amount_cents >= 0),
  paid_amount_cents     bigint NOT NULL DEFAULT 0 CHECK (paid_amount_cents >= 0),
  client_id             uuid REFERENCES public.client(id) ON DELETE SET NULL,
  contract_id           uuid,
  project_id            uuid,
  cost_center_id        uuid REFERENCES public.cost_center(id) ON DELETE SET NULL,
  accrual_entry_id      uuid REFERENCES public.ledger_entry(id) ON DELETE SET NULL,
  linked_entry_id       uuid REFERENCES public.ledger_entry(id) ON DELETE SET NULL,
  linked_apar_title_id  uuid REFERENCES public.apar_title(id) ON DELETE SET NULL,
  settlement_entry_ids  uuid[] NOT NULL DEFAULT '{}',
  source_document       text,
  invoice_number        text,
  notes                 text,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (paid_amount_cents <= amount_cents)
);

CREATE INDEX IF NOT EXISTS fiscal_establishments_org_idx ON public.fiscal_establishments (organization_id, active);
CREATE INDEX IF NOT EXISTS fiscal_parties_org_name_idx ON public.fiscal_parties (organization_id, legal_name);
CREATE INDEX IF NOT EXISTS fiscal_services_org_active_idx ON public.fiscal_service_catalog (organization_id, active, effective_from);
CREATE INDEX IF NOT EXISTS fiscal_documents_org_status_idx ON public.fiscal_documents (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS fiscal_documents_org_comp_idx ON public.fiscal_documents (organization_id, competence_date DESC);
CREATE INDEX IF NOT EXISTS fiscal_events_document_idx ON public.fiscal_events (document_id, created_at);
CREATE INDEX IF NOT EXISTS fiscal_jobs_due_idx ON public.fiscal_jobs (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS tax_obligation_org_due_idx ON public.tax_obligation (organization_id, status, due_date);

-- Minimal tenant hardening for finance entities touched by fiscal posting.
ALTER TABLE public.business_unit ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.client ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.ledger_entry ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.apar_title ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

-- Existing single-tenant installations can be backfilled safely. In a multi-org
-- database, unmapped legacy rows stay NULL and are not visible through new fiscal APIs.
DO $$
DECLARE only_org uuid;
BEGIN
  IF (SELECT count(*) FROM public.organizations) = 1 THEN
    SELECT id INTO only_org FROM public.organizations LIMIT 1;
    UPDATE public.business_unit SET organization_id = only_org WHERE organization_id IS NULL;
    UPDATE public.client SET organization_id = only_org WHERE organization_id IS NULL;
    UPDATE public.ledger_entry SET organization_id = only_org WHERE organization_id IS NULL;
    UPDATE public.apar_title SET organization_id = only_org WHERE organization_id IS NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS business_unit_org_idx ON public.business_unit (organization_id);
CREATE INDEX IF NOT EXISTS client_org_idx ON public.client (organization_id);
CREATE INDEX IF NOT EXISTS ledger_entry_org_idx ON public.ledger_entry (organization_id);
CREATE INDEX IF NOT EXISTS apar_title_org_idx ON public.apar_title (organization_id);

-- Replace the legacy permissive finance policies on the entities that fiscal
-- posting touches. NULL legacy rows are deliberately hidden in multi-org
-- installations until an administrator maps them to an organization.
ALTER TABLE public.business_unit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ref_read_bu" ON public.business_unit;
DROP POLICY IF EXISTS "ref_write_bu" ON public.business_unit;
CREATE POLICY "ref_read_bu" ON public.business_unit FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('finance.view') OR current_user_has_permission('fiscal.view'))
);
CREATE POLICY "ref_write_bu" ON public.business_unit FOR ALL TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('finance.admin'))
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('finance.admin'))
);

ALTER TABLE public.client ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ref_read_cli" ON public.client;
DROP POLICY IF EXISTS "ref_write_cli" ON public.client;
CREATE POLICY "ref_read_cli" ON public.client FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('finance.view') OR current_user_has_permission('fiscal.view'))
);
CREATE POLICY "ref_write_cli" ON public.client FOR ALL TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('finance.edit'))
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('finance.edit'))
);

ALTER TABLE public.ledger_entry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "le_select" ON public.ledger_entry;
DROP POLICY IF EXISTS "le_insert" ON public.ledger_entry;
DROP POLICY IF EXISTS "le_update" ON public.ledger_entry;
CREATE POLICY "le_select" ON public.ledger_entry FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
    current_user_is_admin()
    OR current_user_has_permission('finance.view')
    OR current_user_has_permission('finance.edit')
    OR current_user_has_permission('finance.approve')
    OR current_user_has_permission('fiscal.view')
    OR current_user_has_permission('audit.view')
  )
);
CREATE POLICY "le_insert" ON public.ledger_entry FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('finance.edit') OR current_user_has_permission('fiscal.transmit'))
);
CREATE POLICY "le_update" ON public.ledger_entry FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('finance.edit') OR current_user_has_permission('finance.approve'))
)
WITH CHECK (organization_id = current_user_organization_id());

ALTER TABLE public.apar_title ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "apar_select" ON public.apar_title;
DROP POLICY IF EXISTS "apar_write" ON public.apar_title;
CREATE POLICY "apar_select" ON public.apar_title FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
    current_user_is_admin()
    OR current_user_has_permission('finance.view')
    OR current_user_has_permission('finance.edit')
    OR current_user_has_permission('finance.approve')
    OR current_user_has_permission('fiscal.view')
    OR current_user_has_permission('audit.view')
  )
);
CREATE POLICY "apar_write" ON public.apar_title FOR ALL TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('finance.edit') OR current_user_has_permission('fiscal.transmit'))
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('finance.edit') OR current_user_has_permission('fiscal.transmit'))
);

-- Timestamp triggers.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'fiscal_establishments','fiscal_provider_configs','fiscal_parties',
    'fiscal_service_catalog','fiscal_documents','fiscal_jobs','tax_obligation'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_updated_at ON public.%I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER %I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      table_name, table_name
    );
  END LOOP;
END $$;

-- A fiscal snapshot becomes immutable as soon as it leaves draft.
CREATE OR REPLACE FUNCTION public.protect_fiscal_document_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' AND (
    NEW.issuer_snapshot IS DISTINCT FROM OLD.issuer_snapshot OR
    NEW.recipient_snapshot IS DISTINCT FROM OLD.recipient_snapshot OR
    NEW.service_snapshot IS DISTINCT FROM OLD.service_snapshot OR
    NEW.tax_snapshot IS DISTINCT FROM OLD.tax_snapshot OR
    NEW.service_amount_cents IS DISTINCT FROM OLD.service_amount_cents OR
    NEW.net_amount_cents IS DISTINCT FROM OLD.net_amount_cents
  ) THEN
    RAISE EXCEPTION 'Fiscal snapshots cannot be changed after submission';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_fiscal_document_snapshot ON public.fiscal_documents;
CREATE TRIGGER protect_fiscal_document_snapshot
BEFORE UPDATE ON public.fiscal_documents
FOR EACH ROW EXECUTE FUNCTION public.protect_fiscal_document_snapshot();

-- RBAC seeds.
INSERT INTO public.permissions (key, module, action, description) VALUES
  ('fiscal.view',      'fiscal', 'view',      'Visualizar documentos e indicadores fiscais'),
  ('fiscal.create',    'fiscal', 'create',    'Criar e editar rascunhos fiscais'),
  ('fiscal.approve',   'fiscal', 'approve',   'Aprovar documentos fiscais'),
  ('fiscal.transmit',  'fiscal', 'transmit',  'Transmitir documentos ao provedor fiscal'),
  ('fiscal.cancel',    'fiscal', 'cancel',    'Cancelar ou substituir documentos fiscais'),
  ('fiscal.configure', 'fiscal', 'configure', 'Configurar estabelecimentos, serviços e integração'),
  ('fiscal.export',    'fiscal', 'export',    'Exportar XML e DANFSe'),
  ('fiscal.audit',     'fiscal', 'audit',     'Consultar eventos e tentativas fiscais')
ON CONFLICT (key) DO NOTHING;

WITH role_rows AS (
  SELECT id, key FROM public.roles WHERE organization_id IS NULL AND key IN ('owner_admin','financeiro')
), permission_rows AS (
  SELECT id, key FROM public.permissions WHERE module = 'fiscal'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM role_rows r CROSS JOIN permission_rows p
WHERE r.key = 'owner_admin'
   OR (r.key = 'financeiro' AND p.key IN ('fiscal.view','fiscal.create','fiscal.approve','fiscal.transmit','fiscal.export','fiscal.audit'))
ON CONFLICT DO NOTHING;

-- Tenant RLS. Client writes are intentionally allowed only with explicit perms;
-- provider configs and jobs are backend-write-only.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'fiscal_establishments','fiscal_provider_configs','fiscal_parties',
    'fiscal_service_catalog','fiscal_documents','fiscal_document_items',
    'fiscal_tax_lines','fiscal_events','fiscal_transmission_attempts','fiscal_jobs','tax_obligation'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I_org_read ON public.%I', table_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I_org_read ON public.%I FOR SELECT TO authenticated USING (organization_id = current_user_organization_id() AND (current_user_is_admin() OR current_user_has_permission(''fiscal.view'')))',
      table_name, table_name
    );
  END LOOP;
END $$;

CREATE POLICY fiscal_establishments_manage ON public.fiscal_establishments FOR ALL TO authenticated
USING (organization_id = current_user_organization_id() AND (current_user_is_admin() OR current_user_has_permission('fiscal.configure')))
WITH CHECK (organization_id = current_user_organization_id() AND (current_user_is_admin() OR current_user_has_permission('fiscal.configure')));
CREATE POLICY fiscal_parties_manage ON public.fiscal_parties FOR ALL TO authenticated
USING (organization_id = current_user_organization_id() AND (current_user_is_admin() OR current_user_has_permission('fiscal.create')))
WITH CHECK (organization_id = current_user_organization_id() AND (current_user_is_admin() OR current_user_has_permission('fiscal.create')));
CREATE POLICY fiscal_services_manage ON public.fiscal_service_catalog FOR ALL TO authenticated
USING (organization_id = current_user_organization_id() AND (current_user_is_admin() OR current_user_has_permission('fiscal.configure')))
WITH CHECK (organization_id = current_user_organization_id() AND (current_user_is_admin() OR current_user_has_permission('fiscal.configure')));
CREATE POLICY fiscal_documents_create ON public.fiscal_documents FOR INSERT TO authenticated
WITH CHECK (organization_id = current_user_organization_id() AND (current_user_is_admin() OR current_user_has_permission('fiscal.create')));
CREATE POLICY fiscal_documents_draft_update ON public.fiscal_documents FOR UPDATE TO authenticated
USING (organization_id = current_user_organization_id() AND status = 'draft' AND (current_user_is_admin() OR current_user_has_permission('fiscal.create')))
WITH CHECK (organization_id = current_user_organization_id());

-- Provider configuration, events, attempts and jobs have no browser write policy.
-- All state transitions pass through guarded server APIs using the service role.

COMMIT;
