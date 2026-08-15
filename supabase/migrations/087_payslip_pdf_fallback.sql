-- ============================================================
-- Contracheque PDF como fallback provisório de rubricas
--
-- Não altera nem completa o S-1010. As linhas do documento ficam em uma
-- tabela própria e os agregados têm prefixo payslip_, preservando a origem.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.payroll_payslip_imports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  file_name       text NOT NULL,
  checksum_sha256 text NOT NULL,
  page_count      integer NOT NULL,
  line_count      integer NOT NULL,
  imported_by     uuid REFERENCES auth.users(id),
  imported_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, checksum_sha256)
);

CREATE TABLE IF NOT EXISTS public.payroll_payslip_lines (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id             uuid NOT NULL REFERENCES payroll_payslip_imports(id) ON DELETE CASCADE,
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_name         text NOT NULL,
  employee_code         text NOT NULL,
  competence            text NOT NULL CHECK (competence ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  cost_center           text NOT NULL,
  job_title             text NOT NULL,
  rubric_code           text NOT NULL,
  rubric_description    text NOT NULL,
  reference             text,
  reference_quantity    numeric,
  reference_hours       numeric,
  earning_cents         bigint NOT NULL DEFAULT 0,
  deduction_cents       bigint NOT NULL DEFAULT 0,
  rubric_role           text NOT NULL CHECK (rubric_role IN ('earning', 'deduction', 'informative')),
  semantic_category     text NOT NULL,
  classification_basis text NOT NULL DEFAULT 'payslip_pdf' CHECK (classification_basis = 'payslip_pdf'),
  -- Campos oficiais deliberadamente nulos: o recibo não os declara.
  nat_rubr              text CHECK (nat_rubr IS NULL),
  inss_incidence        text CHECK (inss_incidence IS NULL),
  fgts_incidence        text CHECK (fgts_incidence IS NULL),
  irrf_incidence        text CHECK (irrf_incidence IS NULL),
  validity              text CHECK (validity IS NULL),
  source_page           integer NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payroll_payslip_lines_comp_idx
  ON public.payroll_payslip_lines (organization_id, competence);

ALTER TABLE public.payroll_payslip_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_payslip_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_payslip_imports_read ON public.payroll_payslip_imports;
CREATE POLICY payroll_payslip_imports_read ON public.payroll_payslip_imports
FOR SELECT TO authenticated
USING (organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('people.view')));

DROP POLICY IF EXISTS payroll_payslip_lines_read ON public.payroll_payslip_lines;
CREATE POLICY payroll_payslip_lines_read ON public.payroll_payslip_lines
FOR SELECT TO authenticated
USING (organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('people.view')));

ALTER TABLE public.esocial_competence_metrics
  ADD COLUMN IF NOT EXISTS payslip_gross_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payslip_deductions_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payslip_net_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payslip_overtime_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payslip_overtime_hours numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payslip_benefits_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payslip_benefits_by_nature jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS payslip_absence_deductions_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payslip_headcount integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payslip_line_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payslip_updated_at timestamptz;

COMMENT ON COLUMN public.esocial_competence_metrics.payslip_gross_cents IS
  'Fallback provisório extraído da coluna Vencimentos do contracheque PDF; não substitui S-1010.';

COMMIT;
