-- ============================================================
-- 014_user_permission_overrides.sql
--
-- Adds per-user permission overrides on top of role-based RBAC.
--
-- Design notes:
--   * Resolution order, evaluated inside `current_user_has_permission`:
--       effective = (role_grants UNION grant_overrides) MINUS deny_overrides
--     A `deny` override therefore beats a role grant; a `grant` override
--     adds a permission the user's roles don't already provide.
--
--   * The table is organization-scoped (FK to organizations); cross-org
--     overrides are rejected at insert time by the RLS WITH CHECK clause.
--
--   * Only admins (admin.manage_users) can write overrides. Targets can
--     SELECT their own override rows so the user-detail drawer still works
--     when an admin views their own profile.
--
--   * Idempotent: every CREATE uses IF NOT EXISTS / OR REPLACE; every
--     INSERT is a no-op on re-run.
--
--   * `current_user_is_admin()` is intentionally NOT changed — it still
--     keys off the owner_admin role membership (see 007 lines 60-77),
--     so overrides cannot fabricate or strip "is_admin" status.
-- ============================================================
BEGIN;

-- ---------------------------------------------------------------------
-- Section 1 — Table
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_permission_overrides (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id)         ON DELETE CASCADE,
  permission_id   uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  effect          text NOT NULL CHECK (effect IN ('grant','deny')),
  reason          text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_upo_user_org
  ON public.user_permission_overrides (user_id, organization_id);

CREATE INDEX IF NOT EXISTS idx_upo_perm
  ON public.user_permission_overrides (permission_id);

-- updated_at touch trigger (keeps the column honest without app cooperation)
CREATE OR REPLACE FUNCTION public.touch_user_permission_overrides_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_upo_touch_updated_at ON public.user_permission_overrides;
CREATE TRIGGER trg_upo_touch_updated_at
  BEFORE UPDATE ON public.user_permission_overrides
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_user_permission_overrides_updated_at();

-- ---------------------------------------------------------------------
-- Section 2 — RLS
-- ---------------------------------------------------------------------
ALTER TABLE public.user_permission_overrides ENABLE ROW LEVEL SECURITY;

-- Admins (admin.manage_users) see every row in their org; targets see their own.
DROP POLICY IF EXISTS upo_select_scoped ON public.user_permission_overrides;
CREATE POLICY upo_select_scoped ON public.user_permission_overrides
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR (
    organization_id = current_user_organization_id()
    AND current_user_has_permission('admin.manage_users')
  )
);

-- Only admins can write; org-scoped on both USING and WITH CHECK.
DROP POLICY IF EXISTS upo_admin_manage ON public.user_permission_overrides;
CREATE POLICY upo_admin_manage ON public.user_permission_overrides
FOR ALL TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('admin.manage_users')
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('admin.manage_users')
);

-- ---------------------------------------------------------------------
-- Section 3 — Override-aware permission resolution
-- ---------------------------------------------------------------------
-- Replaces the function from 005 lines 164-181. Resolution order:
--
--   1) `deny` overrides for this perm  → return false
--   2) `grant` overrides for this perm → return true
--   3) role-based grant                 → return true
--   4) otherwise                        → false
--
-- The org-scoping is inherited from `current_user_organization_id()` so
-- overrides assigned in another org do not leak in.
CREATE OR REPLACE FUNCTION public.current_user_has_permission(permission_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH ctx AS (
    SELECT auth.uid() AS uid, current_user_organization_id() AS org_id
  ),
  perm AS (
    SELECT id FROM public.permissions WHERE key = permission_key
  ),
  override AS (
    SELECT upo.effect
      FROM public.user_permission_overrides upo, ctx, perm
     WHERE upo.user_id         = ctx.uid
       AND upo.organization_id = ctx.org_id
       AND upo.permission_id   = perm.id
     LIMIT 1
  ),
  role_grant AS (
    SELECT 1
      FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      JOIN public.permissions p       ON p.id = rp.permission_id, ctx
     WHERE ur.user_id         = ctx.uid
       AND ur.organization_id = ctx.org_id
       AND p.key              = permission_key
  )
  SELECT
    CASE
      WHEN (SELECT effect FROM override) = 'deny'  THEN false
      WHEN (SELECT effect FROM override) = 'grant' THEN true
      ELSE EXISTS (SELECT 1 FROM role_grant)
    END;
$$;

-- Re-apply the search_path / grants (007 hardening pattern).
ALTER FUNCTION public.current_user_has_permission(text) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.current_user_has_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_has_permission(text) TO authenticated;

COMMIT;
