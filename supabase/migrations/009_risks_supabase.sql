-- ============================================================
-- RISKS MODULE - Supabase persistence + RLS
-- Migration: 009_risks_supabase
-- Date:      2026-05-13
-- Purpose:   Replace the in-memory mock store for the Risks
--            module with a real public.risks table, strictly
--            organization-scoped and permission-gated.
-- Dependencies:
--   005_auth_rbac_foundation  (organizations, profiles,
--                              current_user_organization_id(),
--                              current_user_has_permission(),
--                              set_updated_at() trigger fn,
--                              risks.* permission seeds)
--   006_contracts_supabase    (reference pattern for related
--                              risks columns and JSONB usage)
--   008_projects_rls_hardening (reference pattern for tight
--                               org-scoping + WITH CHECK
--                               anti-org-move + REVOKE-style
--                               authenticated-only policies)
-- NOTE: Idempotent. Wrapped in a single transaction.
--       Re-running this migration must be a no-op.
-- NOTE: Does not touch contracts, projects, finance, or
--       deliberations modules.
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1) Table public.risks
--    Columns mirror the TS shape (Risk + ExtendedRisk):
--      - snake_case in DB, camelCase in TS application layer.
--      - level is a STORED generated column (probability*impact)
--        so app code never has to keep it in sync.
--      - actions/history/evidences are JSONB arrays storing
--        the ExtendedRisk sub-records verbatim (Date fields
--        serialized to ISO strings on write).
--      - origin/severity/status enforced via CHECK constraints
--        rather than enums to keep migrations cheap.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.risks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  title             text NOT NULL,
  description       text,
  category          text NOT NULL,
  area              text,
  probability       integer NOT NULL CHECK (probability BETWEEN 1 AND 5),
  impact            integer NOT NULL CHECK (impact BETWEEN 1 AND 5),
  level             integer GENERATED ALWAYS AS (probability * impact) STORED,
  severity          text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  origin            text NOT NULL DEFAULT 'manual'
                      CHECK (origin IN ('manual','contract','project')),
  reference_id      text,
  reference_name    text,
  responsible_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  responsible_name  text,
  status            text NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','mitigating','resolved')),
  mitigation_plan   text,
  next_action       text,
  due_date          timestamptz,
  actions           jsonb NOT NULL DEFAULT '[]'::jsonb,
  history           jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidences         jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  CONSTRAINT risks_category_nonempty CHECK (length(category) > 0)
);

-- Indexes
CREATE INDEX IF NOT EXISTS risks_org_idx
  ON public.risks (organization_id);
CREATE INDEX IF NOT EXISTS risks_status_idx
  ON public.risks (organization_id, status);
CREATE INDEX IF NOT EXISTS risks_severity_idx
  ON public.risks (organization_id, severity);
CREATE INDEX IF NOT EXISTS risks_origin_ref_idx
  ON public.risks (organization_id, origin, reference_id);
CREATE INDEX IF NOT EXISTS risks_updated_idx
  ON public.risks (organization_id, updated_at DESC);

-- updated_at trigger. set_updated_at() is defined in 005.
-- Recreate the trigger idempotently so re-runs don't fail.
DROP TRIGGER IF EXISTS trg_risks_updated_at ON public.risks;
CREATE TRIGGER trg_risks_updated_at
BEFORE UPDATE ON public.risks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 2) Row Level Security
--    All policies restricted to role 'authenticated' (anon
--    explicitly excluded). All require org match. Writes
--    additionally require a specific risks.<action> permission.
--    INSERT pins created_by to the caller. UPDATE blocks moving
--    a risk to another organization via WITH CHECK.
--    risks.* permission keys come from 005 (do not modify them
--    here).
-- ============================================================

ALTER TABLE public.risks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS risks_select ON public.risks;
CREATE POLICY risks_select ON public.risks
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('risks.view')
    OR current_user_has_permission('risks.view_all')
    OR current_user_has_permission('risks.view_assigned')
  )
);

DROP POLICY IF EXISTS risks_insert ON public.risks;
CREATE POLICY risks_insert ON public.risks
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('risks.create')
  AND created_by = auth.uid()
);

DROP POLICY IF EXISTS risks_update ON public.risks;
CREATE POLICY risks_update ON public.risks
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('risks.edit')
)
WITH CHECK (
  organization_id = current_user_organization_id()
);

DROP POLICY IF EXISTS risks_delete ON public.risks;
CREATE POLICY risks_delete ON public.risks
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('risks.delete')
);

COMMIT;

-- ============================================================
-- 3) Manual verification checklist
--    Run these after applying the migration in a staging DB:
--
--    1. As anon (no session):
--         SELECT * FROM risks;
--       -> must return 0 rows / be denied by RLS.
--    2. As authenticated user in Org A:
--         SELECT * FROM risks WHERE organization_id = '<Org B id>';
--       -> must return 0 rows.
--    3. INSERT with created_by != auth.uid()
--       -> must be denied.
--    4. UPDATE risks SET organization_id = '<other org>'
--       -> must be denied (WITH CHECK fails).
--    5. User without 'risks.delete' DELETEs a risk
--       -> must be denied. owner_admin must succeed.
--    6. CHECK constraints:
--         INSERT ... probability = 0  -> denied
--         INSERT ... impact      = 6  -> denied
--         INSERT ... severity = 'foo' -> denied
--         INSERT ... status   = 'foo' -> denied
--         INSERT ... origin   = 'foo' -> denied
--         INSERT ... category = ''    -> denied (length check)
--    7. level column auto-computes: INSERT probability=3, impact=4
--       -> SELECT level returns 12.
-- ============================================================
