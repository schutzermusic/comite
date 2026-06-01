-- ============================================================
-- PAYROLL CLOSING — Row-Level Security
-- Migration: 018_payroll_closing_rls
--
-- Org-scoped RBAC using the helpers from 005 (current_user_organization_id,
-- current_user_has_permission, current_user_is_admin). Server-side writes go
-- through the service role (RLS-exempt) in API routes, so these policies are
-- defense-in-depth for any direct client access and enforce tenant isolation.
--
-- Read tiers:
--   - base payroll data: people.payroll_close OR people.view (+ admin)
--   - holerite attachments: additionally people.payroll_holerite_access
--   - bank/remittance attachments: additionally people.payroll_bank_file_access
-- Write: people.payroll_close (+ admin).
-- ============================================================

ALTER TABLE payroll_closing_batches        ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_import_files           ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_attachments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_generated_reports      ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_email_packages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_email_dispatches       ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_cost_center_summaries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_employee_lines         ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_bank_payment_lines     ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_validation_flags       ENABLE ROW LEVEL SECURITY;

-- Convenience predicates expressed inline:
--   READ  : current_user_is_admin() OR current_user_has_permission('people.payroll_close') OR current_user_has_permission('people.view')
--   WRITE : current_user_is_admin() OR current_user_has_permission('people.payroll_close')

-- Generic SELECT + WRITE policies for the org-scoped tables that share the
-- same read/write tier. Attachments get a stricter SELECT below.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'payroll_closing_batches', 'payroll_import_files',
    'payroll_generated_reports', 'payroll_email_packages', 'payroll_email_dispatches',
    'payroll_cost_center_summaries', 'payroll_employee_lines', 'payroll_bank_payment_lines',
    'payroll_validation_flags'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t || '_select_scoped', t);
    EXECUTE format($f$
      CREATE POLICY %I ON %I FOR SELECT TO authenticated
      USING (
        organization_id = current_user_organization_id()
        AND (current_user_is_admin()
             OR current_user_has_permission('people.payroll_close')
             OR current_user_has_permission('people.view'))
      );
    $f$, t || '_select_scoped', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t || '_write_scoped', t);
    EXECUTE format($f$
      CREATE POLICY %I ON %I FOR ALL TO authenticated
      USING (
        organization_id = current_user_organization_id()
        AND (current_user_is_admin() OR current_user_has_permission('people.payroll_close'))
      )
      WITH CHECK (
        organization_id = current_user_organization_id()
        AND (current_user_is_admin() OR current_user_has_permission('people.payroll_close'))
      );
    $f$, t || '_write_scoped', t);
  END LOOP;
END $$;

-- Attachments: stricter SELECT (sensitive file gating), standard WRITE.
DROP POLICY IF EXISTS payroll_attachments_select_scoped ON payroll_attachments;
CREATE POLICY payroll_attachments_select_scoped ON payroll_attachments
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
    current_user_is_admin()
    OR (
      (current_user_has_permission('people.payroll_close') OR current_user_has_permission('people.view'))
      AND (file_type NOT IN ('holerite', 'external_holerite')
           OR current_user_has_permission('people.payroll_holerite_access'))
      AND (file_type NOT IN ('bank_payment_spreadsheet', 'remittance_file')
           OR current_user_has_permission('people.payroll_bank_file_access'))
    )
  )
);

DROP POLICY IF EXISTS payroll_attachments_write_scoped ON payroll_attachments;
CREATE POLICY payroll_attachments_write_scoped ON payroll_attachments
FOR ALL TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('people.payroll_close'))
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('people.payroll_close'))
);
