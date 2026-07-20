-- ============================================================
-- DIÁRIAS DE CAMPO — immutable server-side PDF exports
-- Migration: 064_allowance_report_exports
-- ============================================================
BEGIN;

INSERT INTO public.permissions (key, module, action, description) VALUES
  ('allowances.financial_export', 'allowances', 'financial_export', 'Gerar e baixar resumo financeiro de diárias'),
  ('allowances.audit_export', 'allowances', 'audit_export', 'Gerar e baixar relatório restrito de auditoria de diárias')
ON CONFLICT (key) DO NOTHING;

WITH r AS (
  SELECT id FROM roles WHERE organization_id IS NULL AND key = 'owner_admin'
), p AS (
  SELECT id FROM permissions WHERE key IN ('allowances.financial_export','allowances.audit_export')
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p ON CONFLICT DO NOTHING;

WITH r AS (
  SELECT id FROM roles WHERE organization_id IS NULL AND key = 'financeiro'
), p AS (
  SELECT id FROM permissions WHERE key = 'allowances.financial_export'
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.allowance_report_exports (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  allowance_week_id          uuid NOT NULL REFERENCES allowance_weeks(id) ON DELETE RESTRICT,
  allowance_payment_batch_id uuid REFERENCES allowance_payment_batches(id) ON DELETE SET NULL,
  report_type                text NOT NULL CHECK (report_type IN ('financial_summary','audit_report')),
  week_version               integer NOT NULL CHECK (week_version >= 1),
  execution_mode             text NOT NULL CHECK (execution_mode IN ('shadow','assisted','live')),
  export_version             integer NOT NULL DEFAULT 1 CHECK (export_version >= 1),
  content_hash               text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  storage_bucket             text NOT NULL DEFAULT 'allowance-reports' CHECK (storage_bucket = 'allowance-reports'),
  file_path                  text NOT NULL UNIQUE,
  file_hash                  text NOT NULL CHECK (file_hash ~ '^[0-9a-f]{64}$'),
  verification_code          text NOT NULL,
  generated_by               uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  generated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, allowance_week_id, report_type, week_version, content_hash),
  UNIQUE (organization_id, allowance_week_id, report_type, week_version, export_version)
);

CREATE INDEX IF NOT EXISTS allowance_report_exports_week_idx
  ON public.allowance_report_exports
  (organization_id, allowance_week_id, report_type, week_version, export_version DESC);

ALTER TABLE public.allowance_report_exports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allowance_report_exports_select ON public.allowance_report_exports;
CREATE POLICY allowance_report_exports_select
ON public.allowance_report_exports FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
    (report_type = 'financial_summary' AND current_user_has_permission('allowances.financial_export'))
    OR (report_type = 'audit_report' AND current_user_has_permission('allowances.audit_export'))
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS allowance_report_exports_insert ON public.allowance_report_exports;
CREATE POLICY allowance_report_exports_insert
ON public.allowance_report_exports FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND generated_by = auth.uid()
  AND (
    (report_type = 'financial_summary' AND current_user_has_permission('allowances.financial_export'))
    OR (report_type = 'audit_report' AND current_user_has_permission('allowances.audit_export'))
    OR current_user_is_admin()
  )
);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('allowance-reports', 'allowance-reports', false, 20971520, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS allowance_reports_storage_insert ON storage.objects;
CREATE POLICY allowance_reports_storage_insert
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'allowance-reports'
  AND split_part(name, '/', 1) = current_user_organization_id()::text
  AND (
    current_user_has_permission('allowances.financial_export')
    OR current_user_has_permission('allowances.audit_export')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS allowance_reports_storage_select ON storage.objects;
CREATE POLICY allowance_reports_storage_select
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'allowance-reports'
  AND split_part(name, '/', 1) = current_user_organization_id()::text
  AND EXISTS (
    SELECT 1 FROM allowance_report_exports e
    WHERE e.file_path = storage.objects.name
      AND e.organization_id = current_user_organization_id()
      AND (
        (e.report_type = 'financial_summary' AND current_user_has_permission('allowances.financial_export'))
        OR (e.report_type = 'audit_report' AND current_user_has_permission('allowances.audit_export'))
        OR current_user_is_admin()
      )
  )
);

COMMIT;

-- No UPDATE/DELETE table policy and no Storage DELETE policy: exports are immutable.
