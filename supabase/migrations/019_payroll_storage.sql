-- ============================================================
-- PAYROLL CLOSING — Secure Storage buckets + policies
-- Migration: 019_payroll_storage
--
-- Five PRIVATE buckets (public = false). Files are sent as DIRECT e-mail
-- attachments (server reads bytes via service role and base64-encodes them) —
-- never via public/secure links. Object path convention enforces tenant
-- isolation: {organization_id}/{batch_id}/{filename}.
--
-- Read tiers mirror 018: holerites and bank files require their dedicated
-- access permissions; imports/reports/supporting need people.payroll_close.
-- The service role (used by API routes) bypasses these — they protect any
-- direct client access.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES
  ('payroll-imports',              'payroll-imports',              false, 52428800),
  ('payroll-holerites',            'payroll-holerites',            false, 52428800),
  ('payroll-bank-files',           'payroll-bank-files',           false, 52428800),
  ('payroll-reports',              'payroll-reports',              false, 52428800),
  ('payroll-supporting-documents', 'payroll-supporting-documents', false, 52428800)
ON CONFLICT (id) DO UPDATE
SET public = false, file_size_limit = EXCLUDED.file_size_limit;

-- ── INSERT / DELETE: same gate for every payroll bucket ─────
-- org path prefix + write permission (admin or people.payroll_close).
DO $$
DECLARE b text;
BEGIN
  FOREACH b IN ARRAY ARRAY[
    'payroll-imports', 'payroll-holerites', 'payroll-bank-files',
    'payroll-reports', 'payroll-supporting-documents'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects;', b || '_insert');
    EXECUTE format($f$
      CREATE POLICY %I ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = %L
        AND split_part(name, '/', 1) = current_user_organization_id()::text
        AND (current_user_is_admin() OR current_user_has_permission('people.payroll_close'))
      );
    $f$, b || '_insert', b);

    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects;', b || '_delete');
    EXECUTE format($f$
      CREATE POLICY %I ON storage.objects FOR DELETE TO authenticated
      USING (
        bucket_id = %L
        AND split_part(name, '/', 1) = current_user_organization_id()::text
        AND (current_user_is_admin() OR current_user_has_permission('people.payroll_close'))
      );
    $f$, b || '_delete', b);
  END LOOP;
END $$;

-- ── READ: per-bucket sensitivity gate ───────────────────────
-- imports / reports / supporting → people.payroll_close (or people.view for reports)
DROP POLICY IF EXISTS payroll_imports_read ON storage.objects;
CREATE POLICY payroll_imports_read ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'payroll-imports'
  AND split_part(name, '/', 1) = current_user_organization_id()::text
  AND (current_user_is_admin() OR current_user_has_permission('people.payroll_close'))
);

DROP POLICY IF EXISTS payroll_supporting_read ON storage.objects;
CREATE POLICY payroll_supporting_read ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'payroll-supporting-documents'
  AND split_part(name, '/', 1) = current_user_organization_id()::text
  AND (current_user_is_admin() OR current_user_has_permission('people.payroll_close'))
);

DROP POLICY IF EXISTS payroll_reports_read ON storage.objects;
CREATE POLICY payroll_reports_read ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'payroll-reports'
  AND split_part(name, '/', 1) = current_user_organization_id()::text
  AND (current_user_is_admin()
       OR current_user_has_permission('people.payroll_close')
       OR current_user_has_permission('people.view'))
);

-- holerites → dedicated access permission
DROP POLICY IF EXISTS payroll_holerites_read ON storage.objects;
CREATE POLICY payroll_holerites_read ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'payroll-holerites'
  AND split_part(name, '/', 1) = current_user_organization_id()::text
  AND (current_user_is_admin() OR current_user_has_permission('people.payroll_holerite_access'))
);

-- bank files → dedicated access permission (Finance)
DROP POLICY IF EXISTS payroll_bank_read ON storage.objects;
CREATE POLICY payroll_bank_read ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'payroll-bank-files'
  AND split_part(name, '/', 1) = current_user_organization_id()::text
  AND (current_user_is_admin() OR current_user_has_permission('people.payroll_bank_file_access'))
);
