-- ============================================================
-- FINANCE MODULE — Row-Level Security (RBAC + ABAC)
-- Migration: 002_finance_rls
-- ============================================================

-- Prerequisites: user_finance_role table maps auth.users to finance roles.
-- Roles: finance_admin, finance_analyst, project_manager, approver, auditor, executive_readonly

CREATE TABLE IF NOT EXISTS user_finance_role (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id),
  role            varchar(30) NOT NULL CHECK (role IN ('finance_admin', 'finance_analyst', 'project_manager', 'approver', 'auditor', 'executive_readonly')),
  business_unit_ids uuid[]     DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_ufr_user ON user_finance_role (user_id);

-- Helper function: check if user has a specific finance role
CREATE OR REPLACE FUNCTION has_finance_role(required_role text)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_finance_role
    WHERE user_id = auth.uid() AND role = required_role
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper: check if user has any of the listed roles
CREATE OR REPLACE FUNCTION has_any_finance_role(required_roles text[])
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_finance_role
    WHERE user_id = auth.uid() AND role = ANY(required_roles)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper: get user's allowed business unit IDs
CREATE OR REPLACE FUNCTION user_business_unit_ids()
RETURNS uuid[] AS $$
DECLARE
  v_bu_ids uuid[];
BEGIN
  SELECT COALESCE(array_agg(DISTINCT unnested), '{}')
  INTO v_bu_ids
  FROM user_finance_role, LATERAL unnest(business_unit_ids) AS unnested
  WHERE user_id = auth.uid();

  IF v_bu_ids = '{}' THEN RETURN NULL; END IF;
  RETURN v_bu_ids;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper: get user's project IDs (for PM role)
CREATE OR REPLACE FUNCTION user_project_ids()
RETURNS uuid[] AS $$
DECLARE
  v_proj_ids uuid[];
BEGIN
  IF to_regclass('public.project_members') IS NULL THEN
    RETURN '{}'::uuid[];
  END IF;

  SELECT COALESCE(array_agg(project_id), '{}')
  INTO v_proj_ids
  FROM project_members
  WHERE user_id = auth.uid();

  RETURN v_proj_ids;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- ENABLE RLS ON ALL FINANCE TABLES
-- ============================================================

ALTER TABLE business_unit ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_center ENABLE ROW LEVEL SECURITY;
ALTER TABLE management_category ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier ENABLE ROW LEVEL SECURITY;
ALTER TABLE client ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocation_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocation_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE apar_title ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE period_close ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE category_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_finance_role ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- REFERENCE DATA: read for all authenticated
-- ============================================================

DROP POLICY IF EXISTS "ref_read_bu" ON business_unit;
CREATE POLICY "ref_read_bu" ON business_unit FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "ref_read_cc" ON cost_center;
CREATE POLICY "ref_read_cc" ON cost_center FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "ref_read_mc" ON management_category;
CREATE POLICY "ref_read_mc" ON management_category FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "ref_read_sup" ON supplier;
CREATE POLICY "ref_read_sup" ON supplier FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "ref_read_cli" ON client;
CREATE POLICY "ref_read_cli" ON client FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "ref_read_cm" ON category_mapping;
CREATE POLICY "ref_read_cm" ON category_mapping FOR SELECT TO authenticated USING (true);

-- Write reference data: finance_admin only
DROP POLICY IF EXISTS "ref_write_bu" ON business_unit;
CREATE POLICY "ref_write_bu" ON business_unit FOR ALL TO authenticated
  USING (has_finance_role('finance_admin'))
  WITH CHECK (has_finance_role('finance_admin'));

DROP POLICY IF EXISTS "ref_write_cc" ON cost_center;
CREATE POLICY "ref_write_cc" ON cost_center FOR ALL TO authenticated
  USING (has_finance_role('finance_admin'))
  WITH CHECK (has_finance_role('finance_admin'));

DROP POLICY IF EXISTS "ref_write_sup" ON supplier;
CREATE POLICY "ref_write_sup" ON supplier FOR INSERT TO authenticated
  WITH CHECK (has_any_finance_role(ARRAY['finance_admin', 'finance_analyst']));

DROP POLICY IF EXISTS "ref_write_cli" ON client;
CREATE POLICY "ref_write_cli" ON client FOR INSERT TO authenticated
  WITH CHECK (has_any_finance_role(ARRAY['finance_admin', 'finance_analyst']));

-- ============================================================
-- LEDGER ENTRY
-- ============================================================

-- SELECT: role-based filtering
DROP POLICY IF EXISTS "le_select" ON ledger_entry;
CREATE POLICY "le_select" ON ledger_entry FOR SELECT TO authenticated
USING (
  CASE
    WHEN has_any_finance_role(ARRAY['finance_admin', 'finance_analyst', 'approver', 'auditor']) THEN true
    WHEN has_finance_role('executive_readonly') THEN true
    WHEN has_finance_role('project_manager') THEN
      project_id = ANY(user_project_ids())
    ELSE false
  END
);

-- INSERT: finance_admin, finance_analyst, project_manager (own projects)
DROP POLICY IF EXISTS "le_insert" ON ledger_entry;
CREATE POLICY "le_insert" ON ledger_entry FOR INSERT TO authenticated
WITH CHECK (
  has_any_finance_role(ARRAY['finance_admin', 'finance_analyst'])
  OR (has_finance_role('project_manager') AND project_id = ANY(user_project_ids()))
);

-- UPDATE: only drafts, by creator or finance_admin
DROP POLICY IF EXISTS "le_update" ON ledger_entry;
CREATE POLICY "le_update" ON ledger_entry FOR UPDATE TO authenticated
USING (
  status = 'draft'
  AND (created_by = auth.uid() OR has_finance_role('finance_admin'))
)
WITH CHECK (
  status = 'draft'
  AND (created_by = auth.uid() OR has_finance_role('finance_admin'))
);

-- ============================================================
-- PAYROLL BATCH — restricted access
-- ============================================================

DROP POLICY IF EXISTS "pb_select" ON payroll_batch;
CREATE POLICY "pb_select" ON payroll_batch FOR SELECT TO authenticated
USING (
  has_any_finance_role(ARRAY['finance_admin', 'finance_analyst', 'auditor'])
);

DROP POLICY IF EXISTS "pb_insert" ON payroll_batch;
CREATE POLICY "pb_insert" ON payroll_batch FOR INSERT TO authenticated
WITH CHECK (
  has_any_finance_role(ARRAY['finance_admin', 'finance_analyst'])
);

DROP POLICY IF EXISTS "pb_update" ON payroll_batch;
CREATE POLICY "pb_update" ON payroll_batch FOR UPDATE TO authenticated
USING (has_any_finance_role(ARRAY['finance_admin', 'finance_analyst']))
WITH CHECK (has_any_finance_role(ARRAY['finance_admin', 'finance_analyst']));

-- ============================================================
-- ALLOCATION RULE
-- ============================================================

DROP POLICY IF EXISTS "ar_select" ON allocation_rule;
CREATE POLICY "ar_select" ON allocation_rule FOR SELECT TO authenticated
USING (has_any_finance_role(ARRAY['finance_admin', 'finance_analyst', 'auditor']));

DROP POLICY IF EXISTS "ar_write" ON allocation_rule;
CREATE POLICY "ar_write" ON allocation_rule FOR ALL TO authenticated
USING (has_finance_role('finance_admin'))
WITH CHECK (has_finance_role('finance_admin'));

-- ============================================================
-- ALLOCATION RESULT
-- ============================================================

DROP POLICY IF EXISTS "alloc_select" ON allocation_result;
CREATE POLICY "alloc_select" ON allocation_result FOR SELECT TO authenticated
USING (has_any_finance_role(ARRAY['finance_admin', 'finance_analyst', 'auditor']));

DROP POLICY IF EXISTS "alloc_write" ON allocation_result;
CREATE POLICY "alloc_write" ON allocation_result FOR ALL TO authenticated
USING (has_any_finance_role(ARRAY['finance_admin', 'finance_analyst']))
WITH CHECK (has_any_finance_role(ARRAY['finance_admin', 'finance_analyst']));

-- ============================================================
-- AP/AR TITLE
-- ============================================================

DROP POLICY IF EXISTS "apar_select" ON apar_title;
CREATE POLICY "apar_select" ON apar_title FOR SELECT TO authenticated
USING (
  has_any_finance_role(ARRAY['finance_admin', 'finance_analyst', 'approver', 'auditor', 'executive_readonly'])
  OR (has_finance_role('project_manager') AND project_id = ANY(user_project_ids()))
);

DROP POLICY IF EXISTS "apar_write" ON apar_title;
CREATE POLICY "apar_write" ON apar_title FOR ALL TO authenticated
USING (has_any_finance_role(ARRAY['finance_admin', 'finance_analyst']))
WITH CHECK (has_any_finance_role(ARRAY['finance_admin', 'finance_analyst']));

-- ============================================================
-- PERIOD CLOSE — admin only for mutations
-- ============================================================

DROP POLICY IF EXISTS "pc_select" ON period_close;
CREATE POLICY "pc_select" ON period_close FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "pc_write" ON period_close;
CREATE POLICY "pc_write" ON period_close FOR ALL TO authenticated
USING (has_finance_role('finance_admin'))
WITH CHECK (has_finance_role('finance_admin'));

-- ============================================================
-- ATTACHMENT
-- ============================================================

DROP POLICY IF EXISTS "att_select" ON attachment;
CREATE POLICY "att_select" ON attachment FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "att_insert" ON attachment;
CREATE POLICY "att_insert" ON attachment FOR INSERT TO authenticated
WITH CHECK (has_any_finance_role(ARRAY['finance_admin', 'finance_analyst', 'project_manager']));

-- ============================================================
-- AUDIT LOG — append-only, read for admin + auditor
-- ============================================================

DROP POLICY IF EXISTS "audit_select" ON finance_audit_log;
CREATE POLICY "audit_select" ON finance_audit_log FOR SELECT TO authenticated
USING (has_any_finance_role(ARRAY['finance_admin', 'auditor']));

DROP POLICY IF EXISTS "audit_insert" ON finance_audit_log;
CREATE POLICY "audit_insert" ON finance_audit_log FOR INSERT TO authenticated
WITH CHECK (true);

-- Prevent UPDATE and DELETE on audit log
-- (already enforced by not creating update/delete policies with RLS enabled)

-- ============================================================
-- INGESTION BATCH
-- ============================================================

DROP POLICY IF EXISTS "ib_select" ON ingestion_batch;
CREATE POLICY "ib_select" ON ingestion_batch FOR SELECT TO authenticated
USING (has_any_finance_role(ARRAY['finance_admin', 'auditor']));

DROP POLICY IF EXISTS "ib_write" ON ingestion_batch;
CREATE POLICY "ib_write" ON ingestion_batch FOR ALL TO authenticated
USING (has_finance_role('finance_admin'))
WITH CHECK (has_finance_role('finance_admin'));

-- ============================================================
-- USER FINANCE ROLE — self-read, admin manage
-- ============================================================

DROP POLICY IF EXISTS "ufr_select" ON user_finance_role;
CREATE POLICY "ufr_select" ON user_finance_role FOR SELECT TO authenticated
USING (user_id = auth.uid() OR has_finance_role('finance_admin'));

DROP POLICY IF EXISTS "ufr_write" ON user_finance_role;
CREATE POLICY "ufr_write" ON user_finance_role FOR ALL TO authenticated
USING (has_finance_role('finance_admin'))
WITH CHECK (has_finance_role('finance_admin'));
