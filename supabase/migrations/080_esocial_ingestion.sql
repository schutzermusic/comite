-- ============================================================
-- INSIGHT eSOCIAL — ingestão automática (conector nativo Node)
-- Migration: 080_esocial_ingestion
--
-- Substitui o conector simulado por uma pipeline real e SOMENTE DE LEITURA:
--   configurar certificado A1 uma vez  →  cron consulta o eSocial  →
--   eventos brutos  →  métricas normalizadas  →  indicadores de Pessoas & Custos.
--
-- O INSIGHT nunca transmite eventos: não assina nem envia nada ao eSocial.
--
-- Segurança:
--   • O .pfx vive num bucket PRIVADO; nunca é servido ao cliente.
--   • A senha do certificado é gravada CIFRADA (AES-256-GCM, chave em
--     ESOCIAL_CERT_KEY, fora do banco). A coluna guarda o texto cifrado.
--   • CPF nunca é gravado em claro: só hash + máscara, como no resto do módulo.
--   • Escrita exclusiva pelo service role (cron); leitura por permissão.
-- ============================================================
BEGIN;

-- ── Bucket privado do certificado ────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('esocial-certificates', 'esocial-certificates', false, 1048576) -- 1 MB
ON CONFLICT (id) DO UPDATE
SET public = false, file_size_limit = EXCLUDED.file_size_limit;

-- Nenhuma política de cliente: o upload e a leitura passam pela API com
-- service role. Sem policy, o RLS do storage nega todo acesso direto.
DROP POLICY IF EXISTS esocial_certificates_no_client_access ON storage.objects;

-- ── Configuração por organização ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.esocial_config (
  organization_id       uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  -- Inscrição do empregador: 1 = CNPJ, 2 = CPF.
  tp_insc               smallint NOT NULL DEFAULT 1 CHECK (tp_insc IN (1, 2)),
  nr_insc               text NOT NULL,
  environment           text NOT NULL DEFAULT 'production'
                          CHECK (environment IN ('production', 'restricted')),

  -- Certificado A1
  cert_storage_path     text,
  cert_password_cipher  text,          -- AES-256-GCM: iv:tag:ciphertext (base64)
  cert_subject          text,
  cert_expires_at       timestamptz,
  cert_fingerprint      text,

  -- Agendamento
  auto_sync_enabled     boolean NOT NULL DEFAULT false,
  sync_frequency        text NOT NULL DEFAULT 'daily'
                          CHECK (sync_frequency IN ('manual', 'daily', 'weekly')),
  /** Quantas competências para trás cada execução reconsulta (fechamentos retroativos). */
  lookback_months       smallint NOT NULL DEFAULT 3 CHECK (lookback_months BETWEEN 1 AND 24),
  last_sync_at          timestamptz,
  last_sync_status      text,
  next_sync_at          timestamptz,

  /**
   * Override das URLs dos serviços de consulta. O manual do desenvolvedor do
   * eSocial altera caminhos entre versões; deixar isto em dado evita que uma
   * mudança de rota vire deploy de código.
   */
  endpoints             jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.esocial_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS esocial_config_read ON public.esocial_config;
CREATE POLICY esocial_config_read ON public.esocial_config
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('admin.manage_integrations'))
);

-- Escrita só pela API (service role). Sem policy de INSERT/UPDATE/DELETE.

-- ── Execuções de sincronização ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.esocial_sync_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id             uuid NOT NULL,
  organization_id    uuid REFERENCES organizations(id) ON DELETE CASCADE,
  started_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz,
  status             text NOT NULL DEFAULT 'running'
                       CHECK (status IN ('running','success','partial','failed','skipped')),
  dry_run            boolean NOT NULL DEFAULT false,
  automation_enabled boolean NOT NULL DEFAULT false,
  triggered_by       text,             -- 'cron' | 'manual' | <user_id>
  environment        text,
  competence_from    text,             -- YYYY-MM
  competence_to      text,
  events_found       integer NOT NULL DEFAULT 0,
  events_imported    integer NOT NULL DEFAULT 0,
  events_duplicated  integer NOT NULL DEFAULT 0,
  events_failed      integer NOT NULL DEFAULT 0,
  /** Mensagem já higienizada — nunca carrega XML, CPF em claro ou segredo. */
  safe_message       text,
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS esocial_sync_runs_org_time_idx
  ON public.esocial_sync_runs (organization_id, started_at DESC);

ALTER TABLE public.esocial_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS esocial_sync_runs_read ON public.esocial_sync_runs;
CREATE POLICY esocial_sync_runs_read ON public.esocial_sync_runs
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
    current_user_is_admin()
    OR current_user_has_permission('admin.manage_integrations')
    OR current_user_has_permission('people.view')
  )
);

-- ── Eventos brutos ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.esocial_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sync_run_id      uuid REFERENCES public.esocial_sync_runs(id) ON DELETE SET NULL,
  event_type       text NOT NULL,      -- 'S-1200', 'S-5011', …
  /** Id do evento no eSocial (atributo Id do XML). Chave natural de deduplicação. */
  esocial_event_id text NOT NULL,
  receipt_number   text,               -- nrRecArqBase / recibo
  competence       text,               -- YYYY-MM (perApur)
  /** Nunca o CPF em claro: hash para correlação + máscara para exibição. */
  worker_cpf_hash  text,
  worker_cpf_mask  text,
  /** XML íntegro, para reprocessamento e auditoria. */
  raw_xml          text,
  raw_xml_sha256   text NOT NULL,
  status           text NOT NULL DEFAULT 'imported'
                     CHECK (status IN ('imported','normalized','duplicate','failed')),
  parse_error      text,
  received_at      timestamptz NOT NULL DEFAULT now(),
  normalized_at    timestamptz,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (organization_id, esocial_event_id)
);

CREATE INDEX IF NOT EXISTS esocial_events_org_comp_type_idx
  ON public.esocial_events (organization_id, competence, event_type);
CREATE INDEX IF NOT EXISTS esocial_events_status_idx
  ON public.esocial_events (organization_id, status);

ALTER TABLE public.esocial_events ENABLE ROW LEVEL SECURITY;

-- O XML pode conter dado sensível de trabalhador: leitura só para quem já
-- pode ver dado sensível de folha.
DROP POLICY IF EXISTS esocial_events_read ON public.esocial_events;
CREATE POLICY esocial_events_read ON public.esocial_events
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
    current_user_is_admin()
    OR current_user_has_permission('people.payroll_view_sensitive')
    OR current_user_has_permission('admin.manage_integrations')
  )
);

-- ── Métricas por competência (agregado que alimenta o cockpit) ──
CREATE TABLE IF NOT EXISTS public.esocial_competence_metrics (
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  competence          text NOT NULL,          -- YYYY-MM
  -- Massa e composição (S-1200)
  gross_payroll_cents bigint NOT NULL DEFAULT 0,
  overtime_cents      bigint NOT NULL DEFAULT 0,
  benefits_cents      bigint NOT NULL DEFAULT 0,
  deductions_cents    bigint NOT NULL DEFAULT 0,
  net_paid_cents      bigint NOT NULL DEFAULT 0,   -- S-1210
  -- Quadro (S-2200 / S-2299)
  headcount           integer NOT NULL DEFAULT 0,
  admissions          integer NOT NULL DEFAULT 0,
  terminations        integer NOT NULL DEFAULT 0,
  -- Afastamentos (S-2230)
  absence_days        integer NOT NULL DEFAULT 0,
  absence_events      integer NOT NULL DEFAULT 0,
  -- Guias REAIS, dos totalizadores. NULL = ainda não transmitido/consultado;
  -- distinto de 0, que significa "apurado e sem valor a recolher".
  inss_cents          bigint,                  -- S-5011
  irrf_cents          bigint,                  -- S-5012
  fgts_cents          bigint,                  -- S-5003
  cp_base_cents       bigint,                  -- S-5001 (base de contribuição)
  rat_fap_rate        numeric(6,4),            -- alíquota RAT × FAP apurada
  /** Quais totalizadores já chegaram — dirige o estado das guias na UI. */
  totalizers          jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_event_count  integer NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, competence)
);

ALTER TABLE public.esocial_competence_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS esocial_competence_metrics_read ON public.esocial_competence_metrics;
CREATE POLICY esocial_competence_metrics_read ON public.esocial_competence_metrics
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('people.view'))
);

-- ── Métricas por lotação/área (o recorte que faltava aos gráficos) ──
CREATE TABLE IF NOT EXISTS public.esocial_area_metrics (
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  competence       text NOT NULL,
  /** Código da lotação tributária (codLotacao) ou departamento do evento. */
  area_code        text NOT NULL,
  area_label       text NOT NULL,
  headcount        integer NOT NULL DEFAULT 0,
  admissions       integer NOT NULL DEFAULT 0,
  terminations     integer NOT NULL DEFAULT 0,
  absence_days     integer NOT NULL DEFAULT 0,
  gross_cents      bigint  NOT NULL DEFAULT 0,
  overtime_cents   bigint  NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, competence, area_code)
);

CREATE INDEX IF NOT EXISTS esocial_area_metrics_comp_idx
  ON public.esocial_area_metrics (organization_id, competence);

ALTER TABLE public.esocial_area_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS esocial_area_metrics_read ON public.esocial_area_metrics;
CREATE POLICY esocial_area_metrics_read ON public.esocial_area_metrics
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('people.view'))
);

-- ── Vínculos ativos (headcount real, tempo de casa, CBO) ─────
CREATE TABLE IF NOT EXISTS public.esocial_employments (
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  /** matrícula do vínculo no eSocial. */
  matricula        text NOT NULL,
  worker_cpf_hash  text NOT NULL,
  worker_cpf_mask  text,
  worker_name      text,
  admission_date   date,
  termination_date date,
  termination_code text,
  cbo_code         text,
  job_title        text,
  area_code        text,
  area_label       text,
  contract_type    text,               -- 'clt' | 'director' | 'intern' | 'other'
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','terminated')),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, matricula)
);

CREATE INDEX IF NOT EXISTS esocial_employments_status_idx
  ON public.esocial_employments (organization_id, status);

ALTER TABLE public.esocial_employments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS esocial_employments_read ON public.esocial_employments;
CREATE POLICY esocial_employments_read ON public.esocial_employments
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('people.view'))
);

COMMIT;
