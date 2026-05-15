-- ============================================================
-- AUTH / RBAC HARDENING
-- Migration: 007_auth_rbac_hardening
-- Date:      2026-05-13
-- Purpose:   Harden SECURITY DEFINER helpers (search_path + grants),
--            tighten current_user_is_admin(), enforce org scope on
--            user_roles writes, split committees ALL policy into
--            granular per-action policies, add a non-destructive
--            bridge between legacy finance roles and the new RBAC
--            permissions, and replace blanket is_admin shortcuts in
--            006 contracts policies with explicit contracts.<action>
--            permission checks.
-- Dependencies: 005_auth_rbac_foundation, 006_contracts_supabase,
--               002_finance_rls
-- NOTE: Do NOT edit older migrations in place. This migration is
--       intended to be fully idempotent (CREATE OR REPLACE /
--       DROP POLICY IF EXISTS / CREATE POLICY).
-- NOTE: Projects and project_files are explicitly untouched here.
-- ============================================================

BEGIN;

-- ============================================================
-- 1) SECURITY DEFINER lockdown
--    Pin search_path and tighten EXECUTE grants on every
--    SECURITY DEFINER helper exposed by 005 / 006.
-- ============================================================

ALTER FUNCTION public.current_user_organization_id() SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.current_user_organization_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_organization_id() TO authenticated;

ALTER FUNCTION public.current_user_has_permission(text) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.current_user_has_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_has_permission(text) TO authenticated;

ALTER FUNCTION public.current_user_is_admin() SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.current_user_is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_is_admin() TO authenticated;

ALTER FUNCTION public.seed_default_committees(uuid) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.seed_default_committees(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_default_committees(uuid) TO authenticated;

ALTER FUNCTION public.setup_first_organization(text, text, text, text, text) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.setup_first_organization(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.setup_first_organization(text, text, text, text, text) TO authenticated;

ALTER FUNCTION public.current_user_can_read_contract(uuid) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.current_user_can_read_contract(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_can_read_contract(uuid) TO authenticated;

-- ============================================================
-- 2) Tighten current_user_is_admin()
--    Removed the OR current_user_has_permission('admin.manage_users')
--    branch. Admin power is now exclusively gated by having a role
--    with key='owner_admin' assigned in the caller's current org.
--    Other admin-ish permissions can be granted independently
--    (admin.manage_users, admin.manage_roles, ...) but they no
--    longer escalate to "is_admin".
-- ============================================================

CREATE OR REPLACE FUNCTION public.current_user_is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid()
      AND ur.organization_id = current_user_organization_id()
      AND r.key = 'owner_admin'
  )
$$;

REVOKE ALL ON FUNCTION public.current_user_is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_is_admin() TO authenticated;

-- ============================================================
-- 3) user_roles_admin_manage — prevent cross-org role grants
--    The WITH CHECK now additionally verifies that the role being
--    assigned belongs either to the caller's org or is a global
--    system role (organization_id IS NULL is intentionally NOT
--    allowed here: assigning a system role to another org must go
--    through a service-role path). Per spec: role.organization_id
--    must equal current_user_organization_id().
-- ============================================================

DROP POLICY IF EXISTS user_roles_admin_manage ON user_roles;
CREATE POLICY user_roles_admin_manage ON user_roles
FOR ALL TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('admin.manage_users')
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('admin.manage_users')
  AND EXISTS (
    SELECT 1 FROM roles r
    WHERE r.id = role_id
      AND r.organization_id = current_user_organization_id()
  )
);

-- ============================================================
-- 4) Granular committees policies
--    Replace the single ALL policy (gated by committees.manage_members)
--    with action-specific policies. SELECT policy from 005 is
--    preserved; we only touch the write path.
-- ============================================================

DROP POLICY IF EXISTS committees_manage_members ON committees;

DROP POLICY IF EXISTS committees_insert ON committees;
CREATE POLICY committees_insert ON committees
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('committees.create')
);

DROP POLICY IF EXISTS committees_update ON committees;
CREATE POLICY committees_update ON committees
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('committees.edit')
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('committees.edit')
);

DROP POLICY IF EXISTS committees_delete ON committees;
CREATE POLICY committees_delete ON committees
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('committees.delete')
);

-- committee_members exists in 005 (verified). Recreate the manage
-- policy to make it explicitly gated by committees.manage_members
-- with org scoping via the parent committee.
DO $$
BEGIN
  IF to_regclass('public.committee_members') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS committee_members_manage ON committee_members';
    EXECUTE $POLICY$
      CREATE POLICY committee_members_manage ON committee_members
      FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM committees c
          WHERE c.id = committee_members.committee_id
            AND c.organization_id = current_user_organization_id()
            AND current_user_has_permission('committees.manage_members')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM committees c
          WHERE c.id = committee_members.committee_id
            AND c.organization_id = current_user_organization_id()
            AND current_user_has_permission('committees.manage_members')
        )
      )
    $POLICY$;
  ELSE
    -- deferred — committee_members table not present in 005
    RAISE NOTICE 'committee_members not found; skipping manage policy';
  END IF;
END
$$;

-- ============================================================
-- 5) Finance bridge — non-destructive
--    Legacy finance roles (user_finance_role) coexist with the new
--    RBAC permissions. Introduce has_finance_role_or_perm(role,perm)
--    and rewrite every 002 policy that referenced has_finance_role /
--    has_any_finance_role so callers can be granted access via
--    either the legacy role OR the equivalent RBAC permission.
--
--    Role -> permission mapping:
--      finance_admin       -> finance.admin (synthetic; see note)
--      finance_analyst     -> finance.edit  (synthetic; see note)
--      approver            -> finance.approve
--      auditor             -> audit.view
--      executive_readonly  -> finance.view
--
--    NOTE on finance.admin / finance.edit:
--      These permission keys are NOT seeded in 005. The bridge is
--      forward-compatible: when those perms are eventually added to
--      the permissions table + role_permissions seed, the bridge
--      will automatically start honoring them. Until then, the
--      OR-branch simply evaluates to false and behavior is
--      identical to today (legacy roles still work). Adding the
--      permissions belongs to a follow-up seed migration.
--
--    The 002 functions (has_finance_role, has_any_finance_role,
--    user_finance_role, user_business_unit_ids, user_project_ids)
--    are intentionally NOT altered or dropped.
--    Organization scoping is not introduced here for finance tables
--    that lack an organization_id column today — follow-up needed.
-- ============================================================

CREATE OR REPLACE FUNCTION public.has_finance_role_or_perm(role_key text, perm_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.has_finance_role(role_key) OR public.current_user_has_permission(perm_key);
$$;

ALTER FUNCTION public.has_finance_role_or_perm(text, text) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.has_finance_role_or_perm(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_finance_role_or_perm(text, text) TO authenticated;

-- --- business_unit / cost_center: finance_admin-only writes ---
DROP POLICY IF EXISTS "ref_write_bu" ON business_unit;
CREATE POLICY "ref_write_bu" ON business_unit FOR ALL TO authenticated
  USING (has_finance_role_or_perm('finance_admin', 'finance.admin'))
  WITH CHECK (has_finance_role_or_perm('finance_admin', 'finance.admin'));

DROP POLICY IF EXISTS "ref_write_cc" ON cost_center;
CREATE POLICY "ref_write_cc" ON cost_center FOR ALL TO authenticated
  USING (has_finance_role_or_perm('finance_admin', 'finance.admin'))
  WITH CHECK (has_finance_role_or_perm('finance_admin', 'finance.admin'));

-- --- supplier / client: finance_admin OR finance_analyst can insert ---
DROP POLICY IF EXISTS "ref_write_sup" ON supplier;
CREATE POLICY "ref_write_sup" ON supplier FOR INSERT TO authenticated
  WITH CHECK (
    has_finance_role_or_perm('finance_admin', 'finance.admin')
    OR has_finance_role_or_perm('finance_analyst', 'finance.edit')
  );

DROP POLICY IF EXISTS "ref_write_cli" ON client;
CREATE POLICY "ref_write_cli" ON client FOR INSERT TO authenticated
  WITH CHECK (
    has_finance_role_or_perm('finance_admin', 'finance.admin')
    OR has_finance_role_or_perm('finance_analyst', 'finance.edit')
  );

-- --- ledger_entry ---
-- SELECT: admin/analyst/approver/auditor OR executive_readonly OR
--         project_manager with assigned project (PM role has no RBAC
--         twin; left untouched).
DROP POLICY IF EXISTS "le_select" ON ledger_entry;
CREATE POLICY "le_select" ON ledger_entry FOR SELECT TO authenticated
USING (
  has_finance_role_or_perm('finance_admin', 'finance.admin')
  OR has_finance_role_or_perm('finance_analyst', 'finance.edit')
  OR has_finance_role_or_perm('approver', 'finance.approve')
  OR has_finance_role_or_perm('auditor', 'audit.view')
  OR has_finance_role_or_perm('executive_readonly', 'finance.view')
  OR (has_finance_role('project_manager') AND project_id = ANY(user_project_ids()))
);

DROP POLICY IF EXISTS "le_insert" ON ledger_entry;
CREATE POLICY "le_insert" ON ledger_entry FOR INSERT TO authenticated
WITH CHECK (
  has_finance_role_or_perm('finance_admin', 'finance.admin')
  OR has_finance_role_or_perm('finance_analyst', 'finance.edit')
  OR (has_finance_role('project_manager') AND project_id = ANY(user_project_ids()))
);

-- UPDATE: only drafts, by creator or finance_admin (status check
-- preserved verbatim from 002).
DROP POLICY IF EXISTS "le_update" ON ledger_entry;
CREATE POLICY "le_update" ON ledger_entry FOR UPDATE TO authenticated
USING (
  status = 'draft'
  AND (created_by = auth.uid() OR has_finance_role_or_perm('finance_admin', 'finance.admin'))
)
WITH CHECK (
  status = 'draft'
  AND (created_by = auth.uid() OR has_finance_role_or_perm('finance_admin', 'finance.admin'))
);

-- --- payroll_batch ---
DROP POLICY IF EXISTS "pb_select" ON payroll_batch;
CREATE POLICY "pb_select" ON payroll_batch FOR SELECT TO authenticated
USING (
  has_finance_role_or_perm('finance_admin', 'finance.admin')
  OR has_finance_role_or_perm('finance_analyst', 'finance.edit')
  OR has_finance_role_or_perm('auditor', 'audit.view')
);

DROP POLICY IF EXISTS "pb_insert" ON payroll_batch;
CREATE POLICY "pb_insert" ON payroll_batch FOR INSERT TO authenticated
WITH CHECK (
  has_finance_role_or_perm('finance_admin', 'finance.admin')
  OR has_finance_role_or_perm('finance_analyst', 'finance.edit')
);

DROP POLICY IF EXISTS "pb_update" ON payroll_batch;
CREATE POLICY "pb_update" ON payroll_batch FOR UPDATE TO authenticated
USING (
  has_finance_role_or_perm('finance_admin', 'finance.admin')
  OR has_finance_role_or_perm('finance_analyst', 'finance.edit')
)
WITH CHECK (
  has_finance_role_or_perm('finance_admin', 'finance.admin')
  OR has_finance_role_or_perm('finance_analyst', 'finance.edit')
);

-- --- allocation_rule ---
DROP POLICY IF EXISTS "ar_select" ON allocation_rule;
CREATE POLICY "ar_select" ON allocation_rule FOR SELECT TO authenticated
USING (
  has_finance_role_or_perm('finance_admin', 'finance.admin')
  OR has_finance_role_or_perm('finance_analyst', 'finance.edit')
  OR has_finance_role_or_perm('auditor', 'audit.view')
);

DROP POLICY IF EXISTS "ar_write" ON allocation_rule;
CREATE POLICY "ar_write" ON allocation_rule FOR ALL TO authenticated
USING (has_finance_role_or_perm('finance_admin', 'finance.admin'))
WITH CHECK (has_finance_role_or_perm('finance_admin', 'finance.admin'));

-- --- allocation_result ---
DROP POLICY IF EXISTS "alloc_select" ON allocation_result;
CREATE POLICY "alloc_select" ON allocation_result FOR SELECT TO authenticated
USING (
  has_finance_role_or_perm('finance_admin', 'finance.admin')
  OR has_finance_role_or_perm('finance_analyst', 'finance.edit')
  OR has_finance_role_or_perm('auditor', 'audit.view')
);

DROP POLICY IF EXISTS "alloc_write" ON allocation_result;
CREATE POLICY "alloc_write" ON allocation_result FOR ALL TO authenticated
USING (
  has_finance_role_or_perm('finance_admin', 'finance.admin')
  OR has_finance_role_or_perm('finance_analyst', 'finance.edit')
)
WITH CHECK (
  has_finance_role_or_perm('finance_admin', 'finance.admin')
  OR has_finance_role_or_perm('finance_analyst', 'finance.edit')
);

-- --- apar_title ---
DROP POLICY IF EXISTS "apar_select" ON apar_title;
CREATE POLICY "apar_select" ON apar_title FOR SELECT TO authenticated
USING (
  has_finance_role_or_perm('finance_admin', 'finance.admin')
  OR has_finance_role_or_perm('finance_analyst', 'finance.edit')
  OR has_finance_role_or_perm('approver', 'finance.approve')
  OR has_finance_role_or_perm('auditor', 'audit.view')
  OR has_finance_role_or_perm('executive_readonly', 'finance.view')
  OR (has_finance_role('project_manager') AND project_id = ANY(user_project_ids()))
);

DROP POLICY IF EXISTS "apar_write" ON apar_title;
CREATE POLICY "apar_write" ON apar_title FOR ALL TO authenticated
USING (
  has_finance_role_or_perm('finance_admin', 'finance.admin')
  OR has_finance_role_or_perm('finance_analyst', 'finance.edit')
)
WITH CHECK (
  has_finance_role_or_perm('finance_admin', 'finance.admin')
  OR has_finance_role_or_perm('finance_analyst', 'finance.edit')
);

-- --- period_close (pc_select is USING(true); skip — non-restrictive) ---
DROP POLICY IF EXISTS "pc_write" ON period_close;
CREATE POLICY "pc_write" ON period_close FOR ALL TO authenticated
USING (has_finance_role_or_perm('finance_admin', 'finance.admin'))
WITH CHECK (has_finance_role_or_perm('finance_admin', 'finance.admin'));

-- --- attachment (att_select USING(true); skip) ---
DROP POLICY IF EXISTS "att_insert" ON attachment;
CREATE POLICY "att_insert" ON attachment FOR INSERT TO authenticated
WITH CHECK (
  has_finance_role_or_perm('finance_admin', 'finance.admin')
  OR has_finance_role_or_perm('finance_analyst', 'finance.edit')
  OR has_finance_role('project_manager')
);

-- --- finance_audit_log ---
DROP POLICY IF EXISTS "audit_select" ON finance_audit_log;
CREATE POLICY "audit_select" ON finance_audit_log FOR SELECT TO authenticated
USING (
  has_finance_role_or_perm('finance_admin', 'finance.admin')
  OR has_finance_role_or_perm('auditor', 'audit.view')
);

-- audit_insert is WITH CHECK(true) — append-only, intentionally permissive. Skip.

-- --- ingestion_batch ---
DROP POLICY IF EXISTS "ib_select" ON ingestion_batch;
CREATE POLICY "ib_select" ON ingestion_batch FOR SELECT TO authenticated
USING (
  has_finance_role_or_perm('finance_admin', 'finance.admin')
  OR has_finance_role_or_perm('auditor', 'audit.view')
);

DROP POLICY IF EXISTS "ib_write" ON ingestion_batch;
CREATE POLICY "ib_write" ON ingestion_batch FOR ALL TO authenticated
USING (has_finance_role_or_perm('finance_admin', 'finance.admin'))
WITH CHECK (has_finance_role_or_perm('finance_admin', 'finance.admin'));

-- --- user_finance_role ---
DROP POLICY IF EXISTS "ufr_select" ON user_finance_role;
CREATE POLICY "ufr_select" ON user_finance_role FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR has_finance_role_or_perm('finance_admin', 'finance.admin')
);

DROP POLICY IF EXISTS "ufr_write" ON user_finance_role;
CREATE POLICY "ufr_write" ON user_finance_role FOR ALL TO authenticated
USING (has_finance_role_or_perm('finance_admin', 'finance.admin'))
WITH CHECK (has_finance_role_or_perm('finance_admin', 'finance.admin'));

-- Follow-up: most finance tables above lack an organization_id
-- column today. Cross-org leakage is therefore still possible if
-- multiple orgs share a Supabase project. A future migration must
-- add organization_id + org-scoped predicates to finance tables.

-- ============================================================
-- 6) 006 contracts compatibility audit
--    The owner_admin role seed in 005 grants ALL permissions to
--    owner_admin (see WITH all_permissions ... insert in 005).
--    Therefore current_user_is_admin() OR current_user_has_permission('contracts.X')
--    is functionally equivalent to current_user_has_permission('contracts.X')
--    for owner_admins — they will already have contracts.<X>. We
--    simplify to make the explicit permission the only gate, which
--    also avoids surprises if owner_admin's blanket grant is ever
--    pruned. Org scoping and deleted_at clauses are preserved
--    verbatim.
-- ============================================================

DROP POLICY IF EXISTS contracts_select_scoped ON contracts;
CREATE POLICY contracts_select_scoped ON contracts
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND deleted_at IS NULL
  AND (
    current_user_has_permission('contracts.view')
    OR current_user_has_permission('contracts.approve')
    OR (
      current_user_has_permission('projects.view_assigned')
      AND EXISTS (
        SELECT 1 FROM projects p
        WHERE p.id = contracts.project_id
          AND p.project->'responsavel'->>'id' = auth.uid()::text
      )
    )
  )
);

DROP POLICY IF EXISTS contracts_insert_permissioned ON contracts;
CREATE POLICY contracts_insert_permissioned ON contracts
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND created_by = auth.uid()
  AND current_user_has_permission('contracts.create')
);

DROP POLICY IF EXISTS contracts_update_permissioned ON contracts;
CREATE POLICY contracts_update_permissioned ON contracts
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND deleted_at IS NULL
  AND (
    current_user_has_permission('contracts.edit')
    OR current_user_has_permission('contracts.delete')
  )
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
    current_user_has_permission('contracts.edit')
    OR current_user_has_permission('contracts.delete')
  )
);

DROP POLICY IF EXISTS contracts_delete_permissioned ON contracts;
CREATE POLICY contracts_delete_permissioned ON contracts
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('contracts.delete')
);

DROP POLICY IF EXISTS contract_clauses_manage_permissioned ON contract_clauses;
CREATE POLICY contract_clauses_manage_permissioned ON contract_clauses
FOR ALL TO authenticated
USING (organization_id = current_user_organization_id() AND current_user_has_permission('contracts.edit'))
WITH CHECK (organization_id = current_user_organization_id() AND current_user_has_permission('contracts.edit'));

DROP POLICY IF EXISTS contract_penalties_select_scoped ON contract_penalties;
CREATE POLICY contract_penalties_select_scoped ON contract_penalties
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND current_user_can_read_contract(contract_id)
  AND (
    current_user_has_permission('contracts.view_penalties')
    OR current_user_has_permission('contracts.edit')
  )
);

DROP POLICY IF EXISTS contract_penalties_manage_permissioned ON contract_penalties;
CREATE POLICY contract_penalties_manage_permissioned ON contract_penalties
FOR ALL TO authenticated
USING (organization_id = current_user_organization_id() AND current_user_has_permission('contracts.edit'))
WITH CHECK (organization_id = current_user_organization_id() AND current_user_has_permission('contracts.edit'));

DROP POLICY IF EXISTS contract_milestones_manage_permissioned ON contract_milestones;
CREATE POLICY contract_milestones_manage_permissioned ON contract_milestones
FOR ALL TO authenticated
USING (organization_id = current_user_organization_id() AND current_user_has_permission('contracts.edit'))
WITH CHECK (organization_id = current_user_organization_id() AND current_user_has_permission('contracts.edit'));

DROP POLICY IF EXISTS contract_billing_events_select_scoped ON contract_billing_events;
CREATE POLICY contract_billing_events_select_scoped ON contract_billing_events
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND current_user_can_read_contract(contract_id)
  AND (
    current_user_has_permission('contracts.view_values')
    OR current_user_has_permission('finance.view')
  )
);

DROP POLICY IF EXISTS contract_billing_events_manage_permissioned ON contract_billing_events;
CREATE POLICY contract_billing_events_manage_permissioned ON contract_billing_events
FOR ALL TO authenticated
USING (organization_id = current_user_organization_id() AND current_user_has_permission('contracts.edit'))
WITH CHECK (organization_id = current_user_organization_id() AND current_user_has_permission('contracts.edit'));

DROP POLICY IF EXISTS contract_risks_manage_permissioned ON contract_risks;
CREATE POLICY contract_risks_manage_permissioned ON contract_risks
FOR ALL TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('contracts.edit') OR current_user_has_permission('risks.edit'))
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('contracts.edit') OR current_user_has_permission('risks.edit'))
);

DROP POLICY IF EXISTS contract_files_insert_permissioned ON contract_files;
CREATE POLICY contract_files_insert_permissioned ON contract_files
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND uploaded_by = auth.uid()
  AND current_user_has_permission('contracts.upload_file')
);

DROP POLICY IF EXISTS contract_ai_analyses_insert_permissioned ON contract_ai_analyses;
CREATE POLICY contract_ai_analyses_insert_permissioned ON contract_ai_analyses
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND created_by = auth.uid()
  AND current_user_has_permission('contracts.analyze_with_ai')
);

-- contract_clauses_select_scoped, contract_milestones_select_scoped,
-- contract_risks_select_scoped, contract_files_select_scoped, and
-- contract_ai_analyses_select_scoped from 006 do NOT use
-- current_user_is_admin() — they rely on current_user_can_read_contract().
-- Left untouched.

-- Storage policies (contract_files_storage_insert/_delete) use
-- current_user_is_admin() OR current_user_has_permission('contracts.<X>').
-- They are rewritten here for consistency with the rest of the
-- audit; owner_admin still passes via the contracts.<X> seed.
DROP POLICY IF EXISTS contract_files_storage_insert ON storage.objects;
CREATE POLICY contract_files_storage_insert
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'contract-files'
  AND split_part(name, '/', 1) = current_user_organization_id()::text
  AND current_user_has_permission('contracts.upload_file')
);

DROP POLICY IF EXISTS contract_files_storage_delete ON storage.objects;
CREATE POLICY contract_files_storage_delete
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'contract-files'
  AND split_part(name, '/', 1) = current_user_organization_id()::text
  AND current_user_has_permission('contracts.delete')
);

-- ============================================================
-- 7) Projects untouched — no statements reference projects or
--    project_files in this migration (beyond preserving the
--    existing 006 predicate that joins to projects for the
--    contracts_select_scoped policy).
-- ============================================================

COMMIT;

-- ============================================================
-- MANUAL SMOKE TESTS (do not run automatically)
-- ============================================================
-- 1. Admin shortcut removed:
--      As a user that has admin.manage_users but NOT owner_admin
--      role in their current org, expect:
--        SELECT current_user_is_admin();        -- false
--      Previously this returned true via the OR branch.
--
-- 2. Cross-org role insertion blocked:
--      As an admin in org A with admin.manage_users, attempt to
--      INSERT INTO user_roles (user_id, role_id, organization_id)
--      VALUES (<some user>, <role from org B>, <org A id>);
--      Expect RLS violation (role_id not in caller's org).
--      Also try organization_id = <org B>; expect denial.
--
-- 3. Committees granular gating:
--      User with committees.view but NOT committees.create:
--        INSERT INTO committees ...   -- denied
--      User with committees.create but NOT committees.edit:
--        INSERT OK; UPDATE same row -- denied.
--      User with committees.delete only:
--        DELETE OK; INSERT denied.
--
-- 4. committee_members manage still requires committees.manage_members
--    AND org match via parent committee.
--
-- 5. Finance bridge accepts new RBAC perm:
--      Grant a user the synthetic finance.admin permission (after
--      seeding it) and NO entry in user_finance_role; ledger_entry
--      SELECT/INSERT should succeed via has_finance_role_or_perm.
--      Conversely, a legacy user_finance_role='finance_admin' with
--      no RBAC permission must continue to work unchanged.
--
-- 6. Contracts: owner_admin still has full access (because the
--    owner_admin role gets every contracts.<X> permission via the
--    005 seed). A user with admin.manage_users but no contracts.*
--    perms must NOT be able to read contracts anymore (previously
--    current_user_is_admin() would have leaked access if they
--    held admin.manage_users — that path is now closed).
--
-- 7. SECURITY DEFINER helpers: verify
--      \df+ public.current_user_is_admin
--    shows search_path = public, pg_temp and EXECUTE only to
--    authenticated.
-- ============================================================
