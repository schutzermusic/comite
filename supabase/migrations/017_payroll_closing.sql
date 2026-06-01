-- ============================================================
-- PAYROLL CLOSING — Pessoas & Custos > Fechamento da Folha
-- Migration: 017_payroll_closing
--
-- Persists the automated payroll closing workflow (import → parse →
-- AI narrative → attachments → e-mail dispatch → handoff to Finance).
--
-- Conventions follow 005/006: organization-scoped tables, created_by/
-- updated_by referencing auth.users, set_updated_at() triggers, and
-- the org/RBAC helper functions for RLS (added in 018).
--
-- Non-destructive: CREATE TYPE guarded with EXCEPTION, CREATE TABLE IF
-- NOT EXISTS, idempotent triggers. No DROP of existing objects.
--
-- Numbers are stored as integer cents (bigint). The payroll spreadsheet
-- is the source of truth; AI never writes numeric values.
-- ============================================================

-- ── ENUMS ───────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE payroll_closing_status AS ENUM
    ('imported', 'validated', 'reviewed', 'approved', 'sent_to_finance', 'posted', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE payroll_import_file_type AS ENUM
    ('payroll_spreadsheet', 'bank_payment_spreadsheet', 'holerite', 'external_holerite', 'supporting_document');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE payroll_attachment_file_type AS ENUM
    ('executive_pdf', 'dashboard_snapshot', 'payroll_spreadsheet', 'bank_payment_spreadsheet',
     'remittance_file', 'holerite', 'external_holerite', 'esocial', 'tax_guide',
     'supporting_document', 'other');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE payroll_security_level AS ENUM
    ('aggregate', 'confidential', 'finance_restricted', 'hr_restricted', 'board_confidential');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE payroll_report_type AS ENUM
    ('executive_email', 'finance_email', 'hr_email', 'executive_pdf', 'board_summary', 'whatsapp', 'detailed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE payroll_report_status AS ENUM ('draft', 'reviewed', 'approved', 'sent');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE payroll_email_audience AS ENUM ('board', 'finance', 'hr', 'custom');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE payroll_email_package_status AS ENUM ('draft', 'reviewed', 'approved', 'sent', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE payroll_delivery_status AS ENUM ('pending', 'sent', 'failed', 'simulated');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE payroll_validation_severity AS ENUM ('info', 'warning', 'error');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── 1. CLOSING BATCH ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_closing_batches (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  competence_month            char(7) NOT NULL,                       -- YYYY-MM
  total_amount_cents          bigint NOT NULL DEFAULT 0,
  previous_month_amount_cents bigint NOT NULL DEFAULT 0,
  variation_amount_cents      bigint NOT NULL DEFAULT 0,
  variation_percentage        numeric(12,2) NOT NULL DEFAULT 0,
  gross_amount_cents          bigint,
  charges_amount_cents        bigint,
  benefits_amount_cents       bigint,
  headcount                   int,
  payment_deadline            date,
  status                      payroll_closing_status NOT NULL DEFAULT 'imported',
  -- Anti-duplication guard: the finance payroll_batch created on handoff.
  finance_batch_id            uuid REFERENCES payroll_batch(id) ON DELETE SET NULL,
  notes                       text,
  metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by                  uuid REFERENCES auth.users(id),
  approved_by                 uuid REFERENCES auth.users(id),
  updated_by                  uuid REFERENCES auth.users(id),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pcb_org_comp ON payroll_closing_batches (organization_id, competence_month);
CREATE INDEX IF NOT EXISTS idx_pcb_status ON payroll_closing_batches (organization_id, status);
-- A given competence can be closed once per org (drafts excluded by partial uniqueness).
CREATE UNIQUE INDEX IF NOT EXISTS uq_pcb_org_comp_active
  ON payroll_closing_batches (organization_id, competence_month)
  WHERE status <> 'cancelled';

-- ── 2. IMPORT FILES (raw uploads) ───────────────────────────
CREATE TABLE IF NOT EXISTS payroll_import_files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_id        uuid NOT NULL REFERENCES payroll_closing_batches(id) ON DELETE CASCADE,
  file_name       text NOT NULL,
  file_type       payroll_import_file_type NOT NULL,
  storage_bucket  text NOT NULL,
  object_path     text NOT NULL UNIQUE,
  mime_type       text,
  file_size       bigint,
  checksum        text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  uploaded_by     uuid REFERENCES auth.users(id),
  created_by      uuid REFERENCES auth.users(id),
  updated_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pif_batch ON payroll_import_files (batch_id);
CREATE INDEX IF NOT EXISTS idx_pif_org ON payroll_import_files (organization_id);

-- ── 3. ATTACHMENTS (sendable artifacts, incl. generated) ────
CREATE TABLE IF NOT EXISTS payroll_attachments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_id        uuid NOT NULL REFERENCES payroll_closing_batches(id) ON DELETE CASCADE,
  file_name       text NOT NULL,
  file_type       payroll_attachment_file_type NOT NULL,
  security_level  payroll_security_level NOT NULL DEFAULT 'aggregate',
  storage_bucket  text NOT NULL,
  object_path     text NOT NULL UNIQUE,
  mime_type       text,
  file_size       bigint,
  checksum        text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  uploaded_by     uuid REFERENCES auth.users(id),
  approved_by     uuid REFERENCES auth.users(id),
  created_by      uuid REFERENCES auth.users(id),
  updated_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pat_batch ON payroll_attachments (batch_id);
CREATE INDEX IF NOT EXISTS idx_pat_org ON payroll_attachments (organization_id);
CREATE INDEX IF NOT EXISTS idx_pat_security ON payroll_attachments (organization_id, security_level);

-- ── 4. GENERATED REPORTS (AI narrative / HTML) ──────────────
CREATE TABLE IF NOT EXISTS payroll_generated_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_id        uuid NOT NULL REFERENCES payroll_closing_batches(id) ON DELETE CASCADE,
  report_type     payroll_report_type NOT NULL,
  generated_text  text NOT NULL DEFAULT '',
  generated_html  text NOT NULL DEFAULT '',
  status          payroll_report_status NOT NULL DEFAULT 'draft',
  generated_by_ai boolean NOT NULL DEFAULT false,
  reviewed_by     uuid REFERENCES auth.users(id),
  approved_by     uuid REFERENCES auth.users(id),
  created_by      uuid REFERENCES auth.users(id),
  updated_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, report_type)
);
CREATE INDEX IF NOT EXISTS idx_pgr_batch ON payroll_generated_reports (batch_id);

-- ── 5. EMAIL PACKAGES ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_email_packages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_id        uuid NOT NULL REFERENCES payroll_closing_batches(id) ON DELETE CASCADE,
  audience        payroll_email_audience NOT NULL,
  subject         text NOT NULL,
  html_body       text NOT NULL DEFAULT '',
  attachment_ids  uuid[] NOT NULL DEFAULT '{}',
  status          payroll_email_package_status NOT NULL DEFAULT 'draft',
  created_by      uuid REFERENCES auth.users(id),
  approved_by     uuid REFERENCES auth.users(id),
  sent_by         uuid REFERENCES auth.users(id),
  sent_at         timestamptz,
  updated_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pep_batch ON payroll_email_packages (batch_id);

-- ── 6. EMAIL DISPATCHES (send log) ──────────────────────────
CREATE TABLE IF NOT EXISTS payroll_email_dispatches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  package_id          uuid NOT NULL REFERENCES payroll_email_packages(id) ON DELETE CASCADE,
  recipients          text[] NOT NULL DEFAULT '{}',
  cc                  text[] NOT NULL DEFAULT '{}',
  bcc                 text[] NOT NULL DEFAULT '{}',
  delivery_status     payroll_delivery_status NOT NULL DEFAULT 'pending',
  provider_message_id text,
  error_message       text,
  -- Exactly which files left the building (file_name + size) for the audit.
  attachments_sent    jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by          uuid REFERENCES auth.users(id),
  updated_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz
);
CREATE INDEX IF NOT EXISTS idx_ped_package ON payroll_email_dispatches (package_id);
CREATE INDEX IF NOT EXISTS idx_ped_org ON payroll_email_dispatches (organization_id);

-- ── 7. COST CENTER SUMMARIES (parsed) ───────────────────────
CREATE TABLE IF NOT EXISTS payroll_cost_center_summaries (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_id               uuid NOT NULL REFERENCES payroll_closing_batches(id) ON DELETE CASCADE,
  cost_center_label      text NOT NULL,
  matched_cost_center_id uuid REFERENCES cost_center(id) ON DELETE SET NULL,
  amount_cents           bigint NOT NULL DEFAULT 0,
  previous_amount_cents  bigint,
  variation_amount_cents bigint,
  variation_percentage   numeric(12,2),
  created_by             uuid REFERENCES auth.users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pccs_batch ON payroll_cost_center_summaries (batch_id);

-- ── 8. EMPLOYEE LINES (parsed) ──────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_employee_lines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_id           uuid NOT NULL REFERENCES payroll_closing_batches(id) ON DELETE CASCADE,
  employee_name      text NOT NULL,
  cost_center_label  text,
  contract_type      text,            -- CLT | PJ | other
  gross_amount_cents bigint NOT NULL DEFAULT 0,
  net_amount_cents   bigint,
  created_by         uuid REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pel_batch ON payroll_employee_lines (batch_id);

-- ── 9. BANK / PAYMENT LINES (parsed) ────────────────────────
CREATE TABLE IF NOT EXISTS payroll_bank_payment_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_id        uuid NOT NULL REFERENCES payroll_closing_batches(id) ON DELETE CASCADE,
  beneficiary     text NOT NULL,
  bank            text,
  branch          text,
  account         text,
  amount_cents    bigint NOT NULL DEFAULT 0,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pbpl_batch ON payroll_bank_payment_lines (batch_id);

-- ── 10. VALIDATION FLAGS (parsed) ───────────────────────────
CREATE TABLE IF NOT EXISTS payroll_validation_flags (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_id        uuid NOT NULL REFERENCES payroll_closing_batches(id) ON DELETE CASCADE,
  severity        payroll_validation_severity NOT NULL DEFAULT 'info',
  code            text NOT NULL,
  message         text NOT NULL,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pvf_batch ON payroll_validation_flags (batch_id);

-- ── updated_at triggers (reuse set_updated_at from 005) ─────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'payroll_closing_batches', 'payroll_import_files', 'payroll_attachments',
    'payroll_generated_reports', 'payroll_email_packages', 'payroll_email_dispatches',
    'payroll_cost_center_summaries', 'payroll_employee_lines', 'payroll_bank_payment_lines',
    'payroll_validation_flags'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %s;', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t, t);
  END LOOP;
END $$;
