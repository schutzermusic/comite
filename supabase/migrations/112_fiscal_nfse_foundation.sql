-- ============================================================
-- INSIGHT FISCAL — fundação NFS-e alinhada à arquitetura congelada
-- Migration: 112_fiscal_nfse_foundation
--
-- Substitui o rascunho 090_fiscal_nfse.sql, que NUNCA foi aplicado. A 090 foi
-- escrita antes das fases 1 e 2 do Contracts V2 e contradiz três decisões hoje
-- congeladas:
--
--   D1  identidade de contraparte é `parties` + `party_roles`. A 090 criava
--       `fiscal_parties` como cadastro rival, com nome e documento próprios.
--       Aqui o tomador É uma Party canônica; o Fiscal só acrescenta o que o
--       layout da NFS-e exige e a Party não guarda (inscrição municipal,
--       endereço fiscal, município IBGE).
--   D4  centro de custo canônico é `finance_cost_centers`. A 090 apontava para
--       o `cost_center` legado.
--   §2  coerência de inquilino é estrutural. A 090 usava chave simples em todo
--       lugar; aqui toda referência entre tabelas de inquilino é composta
--       (organization_id, id), como a fase 2 fez em Contracts.
--
-- Fora de escopo, de propósito: `tax_obligation`, `ledger_entry`, `apar_title`
-- e a contabilização automática. Isso é Finanças, dono do razão e do contas a
-- receber, e a integração é a Fase 7. O documento fiscal guarda `finance_status`
-- em 'not_posted' e não escreve uma linha sequer no Financeiro.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 0) Alvos compostos que ainda não existiam
-- ------------------------------------------------------------
-- `projects` e `contracts` já são obrigatoriamente de um inquilino; faltava só
-- o alvo composto para que uma FK possa exigir MESMO inquilino em vez de
-- apenas "algum projeto existente".
CREATE UNIQUE INDEX IF NOT EXISTS projects_org_id_fiscal ON public.projects (organization_id, id);

-- ------------------------------------------------------------
-- 1) Estabelecimento emitente
-- ------------------------------------------------------------
CREATE TABLE public.fiscal_establishments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_name              text NOT NULL,
  trade_name              text,
  cnpj                    text NOT NULL CHECK (cnpj ~ '^[0-9]{14}$'),
  municipal_registration  text NOT NULL,
  state_registration      text,
  tax_regime              text NOT NULL CHECK (tax_regime IN ('mei','simples_nacional','lucro_presumido','lucro_real','other')),
  special_tax_regime      text,
  municipality_ibge       text NOT NULL CHECK (municipality_ibge ~ '^[0-9]{7}$'),
  municipality_name       text NOT NULL,
  uf                      text NOT NULL CHECK (uf ~ '^[A-Z]{2}$'),
  postal_code             text NOT NULL CHECK (postal_code ~ '^[0-9]{8}$'),
  street                  text NOT NULL,
  street_number           text NOT NULL,
  complement              text,
  district                text NOT NULL,
  -- Ambiente do estabelecimento. Nasce em homologação e só sai de lá pelo
  -- portão de produção da seção 10 — nunca por UPDATE direto.
  environment             text NOT NULL DEFAULT 'homologation' CHECK (environment IN ('homologation','production')),
  nfse_series             text NOT NULL DEFAULT '1',
  next_dps_number         bigint NOT NULL DEFAULT 1 CHECK (next_dps_number > 0),
  production_enabled      boolean NOT NULL DEFAULT false,
  active                  boolean NOT NULL DEFAULT true,
  created_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fiscal_establishments_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT fiscal_establishments_org_cnpj_im UNIQUE (organization_id, cnpj, municipal_registration)
);
CREATE INDEX fiscal_establishments_org_idx ON public.fiscal_establishments (organization_id, active);

COMMENT ON COLUMN public.fiscal_establishments.production_enabled IS
  'Só o portão de produção (fiscal_production_gates + gatilho fiscal_guard_production) '
  'pode levar esta coluna a true. UPDATE direto é recusado.';

-- ------------------------------------------------------------
-- 2) Tomador — extensão fiscal da Party canônica
-- ------------------------------------------------------------
-- Identidade jurídica (razão social, CNPJ/CPF) NÃO se repete aqui: ela é da
-- `parties`. O que existe nesta tabela é o que o layout da NFS-e exige do
-- tomador e a Party canônica legitimamente não guarda.
CREATE TABLE public.fiscal_party_profiles (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  party_id                uuid NOT NULL,
  municipal_registration  text,
  state_registration      text,
  email                   text,
  phone                   text,
  municipality_ibge       text CHECK (municipality_ibge IS NULL OR municipality_ibge ~ '^[0-9]{7}$'),
  municipality_name       text,
  uf                      text CHECK (uf IS NULL OR uf ~ '^[A-Z]{2}$'),
  country_code            text NOT NULL DEFAULT 'BR' CHECK (country_code ~ '^[A-Z]{2}$'),
  postal_code             text,
  street                  text,
  street_number           text,
  complement              text,
  district                text,
  active                  boolean NOT NULL DEFAULT true,
  created_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fiscal_party_profiles_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT fiscal_party_profiles_one_per_party UNIQUE (organization_id, party_id),
  CONSTRAINT fiscal_party_profiles_party_tenant
    FOREIGN KEY (organization_id, party_id) REFERENCES public.parties (organization_id, id) ON DELETE CASCADE
);
COMMENT ON TABLE public.fiscal_party_profiles IS
  'Extensão fiscal da Party canônica (D1). Não duplica razão social nem documento: '
  'esses vivem em public.parties e são lidos de lá.';

-- ------------------------------------------------------------
-- 3) Catálogo de serviços
-- ------------------------------------------------------------
CREATE TABLE public.fiscal_service_catalog (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  establishment_id        uuid NOT NULL,
  code                    text NOT NULL,
  description             text NOT NULL,
  lc116_code              text NOT NULL,
  nbs_code                text,
  municipal_service_code  text NOT NULL,
  cnae_code               text,
  iss_rate                numeric(7,4) NOT NULL DEFAULT 0 CHECK (iss_rate    BETWEEN 0 AND 100),
  pis_rate                numeric(7,4) NOT NULL DEFAULT 0 CHECK (pis_rate    BETWEEN 0 AND 100),
  cofins_rate             numeric(7,4) NOT NULL DEFAULT 0 CHECK (cofins_rate BETWEEN 0 AND 100),
  inss_rate               numeric(7,4) NOT NULL DEFAULT 0 CHECK (inss_rate   BETWEEN 0 AND 100),
  ir_rate                 numeric(7,4) NOT NULL DEFAULT 0 CHECK (ir_rate     BETWEEN 0 AND 100),
  csll_rate               numeric(7,4) NOT NULL DEFAULT 0 CHECK (csll_rate   BETWEEN 0 AND 100),
  ibs_rate                numeric(7,4) NOT NULL DEFAULT 0 CHECK (ibs_rate    BETWEEN 0 AND 100),
  cbs_rate                numeric(7,4) NOT NULL DEFAULT 0 CHECK (cbs_rate    BETWEEN 0 AND 100),
  iss_withheld_default    boolean NOT NULL DEFAULT false,
  tax_rules               jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_from          date NOT NULL,
  effective_to            date,
  version                 integer NOT NULL DEFAULT 1 CHECK (version > 0),
  active                  boolean NOT NULL DEFAULT true,
  -- Alíquota é responsabilidade contábil. O campo registra que alguém assumiu
  -- essa responsabilidade; ele NÃO é preenchido por inferência.
  approved_by_accountant  boolean NOT NULL DEFAULT false,
  created_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT fiscal_service_catalog_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT fiscal_service_catalog_version UNIQUE (organization_id, establishment_id, code, version),
  CONSTRAINT fiscal_service_catalog_estab_tenant
    FOREIGN KEY (organization_id, establishment_id)
    REFERENCES public.fiscal_establishments (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX fiscal_service_catalog_scope ON public.fiscal_service_catalog (organization_id, active, effective_from);

-- ------------------------------------------------------------
-- 4) Documento fiscal (NFS-e)
-- ------------------------------------------------------------
CREATE TABLE public.fiscal_documents (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  establishment_id        uuid NOT NULL,
  -- Tomador: Party CANÔNICA. O perfil fiscal é opcional porque uma Party sem
  -- inscrição municipal ainda pode ser tomadora.
  party_id                uuid NOT NULL,
  party_profile_id        uuid,
  -- `projects.id` é TEXT neste banco (identificador vindo do domínio, não um
  -- uuid gerado). A coluna acompanha o tipo real; forçar uuid aqui só produziria
  -- uma FK que o Postgres recusa a criar.
  project_id              text,
  contract_id             uuid,
  business_unit_id        uuid,
  cost_center_id          uuid,
  kind                    text NOT NULL DEFAULT 'nfse' CHECK (kind = 'nfse'),
  status                  text NOT NULL DEFAULT 'draft' CHECK (status IN (
                            'draft','pending_approval','approved','queued','processing',
                            'authorized','rejected','error','cancellation_requested',
                            'cancelled','replaced','archived')),
  environment             text NOT NULL DEFAULT 'homologation' CHECK (environment IN ('homologation','production')),
  competence_date         date NOT NULL,
  issue_date              date,
  due_date                date,
  dps_number              bigint,
  series                  text NOT NULL,
  provider_key            text,
  provider_document_id    text,
  access_key              text,
  document_number         text,
  verification_code       text,
  service_amount_cents    bigint NOT NULL CHECK (service_amount_cents > 0),
  deductions_cents        bigint NOT NULL DEFAULT 0 CHECK (deductions_cents >= 0),
  unconditional_discount_cents bigint NOT NULL DEFAULT 0 CHECK (unconditional_discount_cents >= 0),
  conditional_discount_cents   bigint NOT NULL DEFAULT 0 CHECK (conditional_discount_cents >= 0),
  withheld_total_cents    bigint NOT NULL DEFAULT 0 CHECK (withheld_total_cents >= 0),
  issuer_tax_total_cents  bigint NOT NULL DEFAULT 0 CHECK (issuer_tax_total_cents >= 0),
  net_amount_cents        bigint NOT NULL CHECK (net_amount_cents >= 0),
  service_location_ibge   text NOT NULL CHECK (service_location_ibge ~ '^[0-9]{7}$'),
  description             text NOT NULL,
  additional_information  text,
  -- Retratos do momento da emissão. Uma NFS-e emitida não pode passar a
  -- descrever um cadastro que mudou depois dela.
  issuer_snapshot         jsonb NOT NULL,
  recipient_snapshot      jsonb NOT NULL,
  service_snapshot        jsonb NOT NULL,
  tax_snapshot            jsonb NOT NULL,
  provider_payload_sanitized jsonb,
  rejection_code          text,
  rejection_message       text,
  authorized_at           timestamptz,
  cancelled_at            timestamptz,
  cancellation_reason     text,
  replaced_document_id    uuid,
  replacement_document_id uuid,
  xml_storage_path        text,
  xml_sha256              text,
  danfse_storage_path     text,
  danfse_sha256           text,
  -- Fase 7. Nada no Fiscal escreve no Financeiro; a coluna existe para que a
  -- ausência de contabilização seja um estado declarado, não um silêncio.
  finance_status          text NOT NULL DEFAULT 'not_posted' CHECK (finance_status IN (
                            'not_posted','pending_configuration','posted','reversed','review_required','error')),
  idempotency_key         text NOT NULL,
  submitted_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at             timestamptz,
  created_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fiscal_documents_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT fiscal_documents_idempotency  UNIQUE (organization_id, idempotency_key),
  CONSTRAINT fiscal_documents_access_key   UNIQUE (organization_id, access_key),
  -- Toda referência de inquilino é composta: nunca "algum contrato", sempre
  -- "um contrato DESTA organização".
  CONSTRAINT fiscal_documents_estab_tenant   FOREIGN KEY (organization_id, establishment_id)
    REFERENCES public.fiscal_establishments (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT fiscal_documents_party_tenant   FOREIGN KEY (organization_id, party_id)
    REFERENCES public.parties (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT fiscal_documents_profile_tenant FOREIGN KEY (organization_id, party_profile_id)
    REFERENCES public.fiscal_party_profiles (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT fiscal_documents_project_tenant FOREIGN KEY (organization_id, project_id)
    REFERENCES public.projects (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT fiscal_documents_contract_tenant FOREIGN KEY (organization_id, contract_id)
    REFERENCES public.contracts (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT fiscal_documents_bu_tenant      FOREIGN KEY (organization_id, business_unit_id)
    REFERENCES public.business_unit (organization_id, id) ON DELETE SET NULL,
  -- D4: centro de custo canônico, não o `cost_center` legado.
  CONSTRAINT fiscal_documents_cc_tenant      FOREIGN KEY (organization_id, cost_center_id)
    REFERENCES public.finance_cost_centers (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT fiscal_documents_replaced_tenant FOREIGN KEY (organization_id, replaced_document_id)
    REFERENCES public.fiscal_documents (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT fiscal_documents_replacement_tenant FOREIGN KEY (organization_id, replacement_document_id)
    REFERENCES public.fiscal_documents (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT fiscal_documents_no_self_replacement CHECK (
    replaced_document_id IS DISTINCT FROM id AND replacement_document_id IS DISTINCT FROM id)
);
CREATE INDEX fiscal_documents_org_status_idx ON public.fiscal_documents (organization_id, status, created_at DESC);
CREATE INDEX fiscal_documents_org_comp_idx   ON public.fiscal_documents (organization_id, competence_date DESC);
CREATE UNIQUE INDEX fiscal_documents_dps_number ON public.fiscal_documents (organization_id, establishment_id, series, dps_number)
  WHERE dps_number IS NOT NULL;

-- ------------------------------------------------------------
-- 5) Itens e tributos
-- ------------------------------------------------------------
CREATE TABLE public.fiscal_document_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_id           uuid NOT NULL,
  service_catalog_id    uuid,
  sequence              integer NOT NULL CHECK (sequence > 0),
  description           text NOT NULL,
  quantity              numeric(15,4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_amount_cents     bigint NOT NULL CHECK (unit_amount_cents > 0),
  total_amount_cents    bigint NOT NULL CHECK (total_amount_cents > 0),
  service_snapshot      jsonb NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, sequence),
  CONSTRAINT fiscal_document_items_doc_tenant FOREIGN KEY (organization_id, document_id)
    REFERENCES public.fiscal_documents (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fiscal_document_items_service_tenant FOREIGN KEY (organization_id, service_catalog_id)
    REFERENCES public.fiscal_service_catalog (organization_id, id) ON DELETE SET NULL
);

CREATE TABLE public.fiscal_tax_lines (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_id           uuid NOT NULL,
  tax_code              text NOT NULL CHECK (tax_code IN ('ISS','PIS','COFINS','INSS','IRRF','CSLL','IBS','CBS','OTHER')),
  tax_base_cents        bigint NOT NULL CHECK (tax_base_cents >= 0),
  rate                  numeric(7,4) NOT NULL CHECK (rate BETWEEN 0 AND 100),
  amount_cents          bigint NOT NULL CHECK (amount_cents >= 0),
  responsibility        text NOT NULL CHECK (responsibility IN ('issuer','recipient','informational')),
  withheld              boolean NOT NULL DEFAULT false,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, tax_code),
  CONSTRAINT fiscal_tax_lines_doc_tenant FOREIGN KEY (organization_id, document_id)
    REFERENCES public.fiscal_documents (organization_id, id) ON DELETE CASCADE
);

-- ------------------------------------------------------------
-- 6) Eventos e tentativas de transmissão — append-only
-- ------------------------------------------------------------
CREATE TABLE public.fiscal_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_id           uuid NOT NULL,
  event_type            text NOT NULL,
  previous_status       text,
  next_status           text,
  provider_event_id     text,
  message               text,
  payload_sanitized     jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fiscal_events_provider_event UNIQUE (organization_id, provider_event_id),
  CONSTRAINT fiscal_events_doc_tenant FOREIGN KEY (organization_id, document_id)
    REFERENCES public.fiscal_documents (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX fiscal_events_document_idx ON public.fiscal_events (document_id, created_at);

CREATE TABLE public.fiscal_transmission_attempts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_id           uuid NOT NULL,
  operation             text NOT NULL CHECK (operation IN ('issue','consult','cancel','replace','artifact')),
  attempt_number        integer NOT NULL CHECK (attempt_number > 0),
  request_id            text NOT NULL,
  environment           text NOT NULL DEFAULT 'homologation' CHECK (environment IN ('homologation','production')),
  provider_key          text,
  endpoint              text,
  status                text NOT NULL CHECK (status IN ('started','success','retryable_error','terminal_error')),
  http_status           integer,
  provider_code         text,
  safe_message          text,
  duration_ms           integer,
  started_at            timestamptz NOT NULL DEFAULT now(),
  finished_at           timestamptz,
  UNIQUE (document_id, operation, attempt_number),
  UNIQUE (request_id),
  CONSTRAINT fiscal_transmission_attempts_doc_tenant FOREIGN KEY (organization_id, document_id)
    REFERENCES public.fiscal_documents (organization_id, id) ON DELETE CASCADE
);

-- ------------------------------------------------------------
-- 7) Fila fiscal
-- ------------------------------------------------------------
-- Fila PRÓPRIA do Fiscal, não o Event Graph da Fase 4. Existe porque transmitir
-- para uma administração tributária é chamada externa: precisa de tentativa
-- numerada, backoff e chave de idempotência para que reenviar não vire NFS-e
-- duplicada. Quando a Fase 4 trouxer `apex_jobs`, esta tabela é candidata a ser
-- migrada — não a ganhar uma irmã.
CREATE TABLE public.fiscal_jobs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_id           uuid NOT NULL,
  operation             text NOT NULL CHECK (operation IN ('issue','consult','cancel','replace','artifact')),
  status                text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','dead_letter')),
  idempotency_key       text NOT NULL,
  payload               jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts              integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts          integer NOT NULL DEFAULT 6 CHECK (max_attempts > 0),
  next_attempt_at       timestamptz NOT NULL DEFAULT now(),
  locked_at             timestamptz,
  locked_by             text,
  last_error            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fiscal_jobs_idempotency UNIQUE (organization_id, idempotency_key),
  CONSTRAINT fiscal_jobs_doc_tenant FOREIGN KEY (organization_id, document_id)
    REFERENCES public.fiscal_documents (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX fiscal_jobs_due_idx ON public.fiscal_jobs (status, next_attempt_at);

-- ------------------------------------------------------------
-- 8) Configuração de provedor — segredo nunca sai daqui
-- ------------------------------------------------------------
-- Nenhum GRANT para `authenticated`: nem leitura. Credencial e certificado
-- ficam cifrados e só o service role (as rotas, já protegidas por RBAC) os
-- alcança. Uma política de leitura por inquilino ainda exporia `*` ao
-- PostgREST, e "cifrado" não é desculpa para publicar o material cifrado.
CREATE TABLE public.fiscal_provider_configs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  establishment_id        uuid NOT NULL,
  provider_key            text NOT NULL DEFAULT 'sandbox',
  environment             text NOT NULL DEFAULT 'homologation' CHECK (environment IN ('homologation','production')),
  base_url                text,
  credentials_cipher      text,
  webhook_secret_cipher   text,
  certificate_cipher      text,
  certificate_password_cipher text,
  certificate_subject     text,
  certificate_expires_at  timestamptz,
  certificate_fingerprint text,
  enabled                 boolean NOT NULL DEFAULT false,
  last_health_at          timestamptz,
  last_health_status      text,
  last_health_message     text,
  created_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fiscal_provider_configs_unique UNIQUE (organization_id, establishment_id, provider_key, environment),
  CONSTRAINT fiscal_provider_configs_estab_tenant FOREIGN KEY (organization_id, establishment_id)
    REFERENCES public.fiscal_establishments (organization_id, id) ON DELETE CASCADE,
  -- O sandbox é adaptador de homologação. Ligá-lo em produção seria emitir
  -- documento fiscal fingido contra a Receita; o banco recusa a linha.
  CONSTRAINT fiscal_provider_configs_no_sandbox_prod CHECK (
    NOT (environment = 'production' AND provider_key = 'sandbox'))
);

-- ------------------------------------------------------------
-- 9) Timestamps
-- ------------------------------------------------------------
CREATE FUNCTION public.fiscal_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.fiscal_touch_updated_at() FROM PUBLIC;

CREATE TRIGGER fiscal_touch BEFORE UPDATE ON public.fiscal_establishments   FOR EACH ROW EXECUTE FUNCTION public.fiscal_touch_updated_at();
CREATE TRIGGER fiscal_touch BEFORE UPDATE ON public.fiscal_party_profiles   FOR EACH ROW EXECUTE FUNCTION public.fiscal_touch_updated_at();
CREATE TRIGGER fiscal_touch BEFORE UPDATE ON public.fiscal_service_catalog  FOR EACH ROW EXECUTE FUNCTION public.fiscal_touch_updated_at();
CREATE TRIGGER fiscal_touch BEFORE UPDATE ON public.fiscal_documents        FOR EACH ROW EXECUTE FUNCTION public.fiscal_touch_updated_at();
CREATE TRIGGER fiscal_touch BEFORE UPDATE ON public.fiscal_jobs             FOR EACH ROW EXECUTE FUNCTION public.fiscal_touch_updated_at();
CREATE TRIGGER fiscal_touch BEFORE UPDATE ON public.fiscal_provider_configs FOR EACH ROW EXECUTE FUNCTION public.fiscal_touch_updated_at();

-- ------------------------------------------------------------
-- 10) Portão de produção — bloqueio ESTRUTURAL
-- ------------------------------------------------------------
-- Produção não é uma flag que alguém liga. Cada condição é uma coluna, tem que
-- estar registrada com autor e data, e o gatilho recusa a virada enquanto
-- faltar qualquer uma. Não existe caminho de aplicação que contorne isso: o
-- gatilho roda para todo mundo, service role incluído.
CREATE TABLE public.fiscal_production_gates (
  organization_id             uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  establishment_id            uuid NOT NULL,
  certificate_installed       boolean NOT NULL DEFAULT false,
  municipal_registration_active boolean NOT NULL DEFAULT false,
  provider_contract_signed    boolean NOT NULL DEFAULT false,
  homologation_pilot_approved boolean NOT NULL DEFAULT false,
  accountant_signoff          boolean NOT NULL DEFAULT false,
  legal_signoff               boolean NOT NULL DEFAULT false,
  evidence_reference          text,
  recorded_by                 uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recorded_at                 timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, establishment_id),
  CONSTRAINT fiscal_production_gates_estab_tenant FOREIGN KEY (organization_id, establishment_id)
    REFERENCES public.fiscal_establishments (organization_id, id) ON DELETE CASCADE
);

CREATE FUNCTION public.fiscal_guard_production() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g public.fiscal_production_gates%ROWTYPE;
BEGIN
  IF NEW.production_enabled IS NOT TRUE AND NEW.environment <> 'production' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO g FROM public.fiscal_production_gates
   WHERE organization_id = NEW.organization_id AND establishment_id = NEW.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produção fiscal bloqueada: nenhum portão de produção registrado para este estabelecimento.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (g.certificate_installed AND g.municipal_registration_active AND g.provider_contract_signed
          AND g.homologation_pilot_approved AND g.accountant_signoff AND g.legal_signoff) THEN
    RAISE EXCEPTION 'Produção fiscal bloqueada: há portão de produção não satisfeito para este estabelecimento.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fiscal_guard_production() FROM PUBLIC;

CREATE TRIGGER fiscal_guard_production_ins BEFORE INSERT ON public.fiscal_establishments
  FOR EACH ROW EXECUTE FUNCTION public.fiscal_guard_production();
CREATE TRIGGER fiscal_guard_production_upd BEFORE UPDATE ON public.fiscal_establishments
  FOR EACH ROW WHEN (NEW.production_enabled IS DISTINCT FROM OLD.production_enabled
                     OR NEW.environment IS DISTINCT FROM OLD.environment)
  EXECUTE FUNCTION public.fiscal_guard_production();

-- Provedor habilitado em produção obedece ao mesmo portão.
CREATE FUNCTION public.fiscal_guard_production_config() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE ok boolean;
BEGIN
  IF NEW.environment <> 'production' OR NEW.enabled IS NOT TRUE THEN RETURN NEW; END IF;
  SELECT e.production_enabled INTO ok FROM public.fiscal_establishments e
   WHERE e.organization_id = NEW.organization_id AND e.id = NEW.establishment_id;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'Produção fiscal bloqueada: o estabelecimento não tem produção habilitada.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fiscal_guard_production_config() FROM PUBLIC;
CREATE TRIGGER fiscal_guard_production_config BEFORE INSERT OR UPDATE ON public.fiscal_provider_configs
  FOR EACH ROW EXECUTE FUNCTION public.fiscal_guard_production_config();

-- ------------------------------------------------------------
-- 11) Imutabilidade do documento emitido
-- ------------------------------------------------------------
-- Uma NFS-e autorizada é declaração feita a um fisco. Corrigi-la é cancelar ou
-- substituir — nunca reescrever a linha. O gatilho deixa passar só o que a
-- operação posterior legitimamente muda: estado, artefatos, vínculo de
-- substituição e o campo de Finanças da Fase 7.
CREATE FUNCTION public.fiscal_documents_protect_issued() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status NOT IN ('authorized','cancelled','replaced') THEN RETURN NEW; END IF;
  IF NEW.organization_id      IS DISTINCT FROM OLD.organization_id
     OR NEW.establishment_id  IS DISTINCT FROM OLD.establishment_id
     OR NEW.party_id          IS DISTINCT FROM OLD.party_id
     OR NEW.competence_date   IS DISTINCT FROM OLD.competence_date
     OR NEW.series            IS DISTINCT FROM OLD.series
     OR NEW.dps_number        IS DISTINCT FROM OLD.dps_number
     OR NEW.access_key        IS DISTINCT FROM OLD.access_key
     OR NEW.document_number   IS DISTINCT FROM OLD.document_number
     OR NEW.service_amount_cents   IS DISTINCT FROM OLD.service_amount_cents
     OR NEW.deductions_cents       IS DISTINCT FROM OLD.deductions_cents
     OR NEW.unconditional_discount_cents IS DISTINCT FROM OLD.unconditional_discount_cents
     OR NEW.withheld_total_cents   IS DISTINCT FROM OLD.withheld_total_cents
     OR NEW.issuer_tax_total_cents IS DISTINCT FROM OLD.issuer_tax_total_cents
     OR NEW.net_amount_cents       IS DISTINCT FROM OLD.net_amount_cents
     OR NEW.description       IS DISTINCT FROM OLD.description
     OR NEW.issuer_snapshot    IS DISTINCT FROM OLD.issuer_snapshot
     OR NEW.recipient_snapshot IS DISTINCT FROM OLD.recipient_snapshot
     OR NEW.service_snapshot   IS DISTINCT FROM OLD.service_snapshot
     OR NEW.tax_snapshot       IS DISTINCT FROM OLD.tax_snapshot
     OR NEW.authorized_at      IS DISTINCT FROM OLD.authorized_at THEN
    RAISE EXCEPTION 'NFS-e emitida é imutável: cancele ou substitua, não reescreva (documento %).', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fiscal_documents_protect_issued() FROM PUBLIC;
CREATE TRIGGER fiscal_documents_protect_issued BEFORE UPDATE ON public.fiscal_documents
  FOR EACH ROW EXECUTE FUNCTION public.fiscal_documents_protect_issued();

-- Item, tributo, evento e tentativa são registro do que aconteceu.
CREATE FUNCTION public.fiscal_reject_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Histórico fiscal é somente-acréscimo: % em % foi recusado.', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END $$;
REVOKE ALL ON FUNCTION public.fiscal_reject_history_mutation() FROM PUBLIC;
CREATE TRIGGER fiscal_events_immutable BEFORE UPDATE ON public.fiscal_events
  FOR EACH ROW EXECUTE FUNCTION public.fiscal_reject_history_mutation();
CREATE TRIGGER fiscal_attempts_immutable BEFORE UPDATE OF organization_id, document_id, operation, attempt_number, request_id
  ON public.fiscal_transmission_attempts FOR EACH ROW EXECUTE FUNCTION public.fiscal_reject_history_mutation();

-- ------------------------------------------------------------
-- 12) RLS e privilégios
-- ------------------------------------------------------------
-- Leitura por inquilino para `authenticated`; escrita só pelo service role, que
-- é onde o RBAC das rotas já decidiu quem pode o quê. `fiscal_provider_configs`
-- não recebe grant nenhum: segredo não se lê pelo PostgREST.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fiscal_establishments','fiscal_party_profiles','fiscal_service_catalog',
                           'fiscal_documents','fiscal_document_items','fiscal_tax_lines','fiscal_events',
                           'fiscal_transmission_attempts','fiscal_jobs','fiscal_production_gates']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (organization_id = public.current_user_organization_id())',
                   t || '_read', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM authenticated, anon', t);
  END LOOP;
END $$;

ALTER TABLE public.fiscal_provider_configs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fiscal_provider_configs FROM authenticated, anon;

-- ------------------------------------------------------------
-- 12b) Numeração da DPS
-- ------------------------------------------------------------
-- Número de DPS não pode repetir. Duas transmissões simultâneas do mesmo
-- estabelecimento lendo `next_dps_number` e gravando depois produziriam o mesmo
-- número — e duas declarações com o mesmo número são um problema fiscal, não um
-- bug de tela. O UPDATE ... RETURNING resolve no próprio banco: quem chegar
-- segundo espera a linha e recebe o número seguinte.
CREATE FUNCTION public.fiscal_reserve_dps_number(p_organization_id uuid, p_establishment_id uuid)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE reserved bigint;
BEGIN
  UPDATE public.fiscal_establishments
     SET next_dps_number = next_dps_number + 1
   WHERE organization_id = p_organization_id AND id = p_establishment_id
  RETURNING next_dps_number - 1 INTO reserved;

  IF reserved IS NULL THEN
    RAISE EXCEPTION 'Estabelecimento fiscal não encontrado nesta organização.'
      USING ERRCODE = 'no_data_found';
  END IF;
  RETURN reserved;
END $$;
-- Reservar numeração é ato do servidor fiscal, não do navegador.
REVOKE ALL ON FUNCTION public.fiscal_reserve_dps_number(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 13) Armazenamento privado dos artefatos
-- ------------------------------------------------------------
-- Sem política de storage para o navegador, de propósito: XML e DANFSe saem
-- pela rota autenticada `/api/fiscal/documents/[id]/artifact/[kind]`, que
-- confere organização e permissão antes de entregar o arquivo.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('fiscal-documents','fiscal-documents', false, 10485760,
        ARRAY['application/xml','text/xml','application/pdf'])
ON CONFLICT (id) DO UPDATE
SET public = false, file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMIT;
