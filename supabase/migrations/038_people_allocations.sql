-- ============================================================
-- PESSOAS & PROJETOS — Canonical people + project allocations
-- Migration: 038_people_allocations
-- Date:      2026-07-15
-- Purpose:   Foundation of the enterprise allocation layer
--            (spec: plan/INSIGHT_APEX_ALOCACAO_APONTAMENTO_ARQUITETURA.md):
--            1) people — canonical org person (payroll names,
--               login profiles and manual entries unified);
--            2) project_allocations — temporal allocation entity
--               (validity period, percentage, type, status,
--               approval trail, cost center);
--            3) payroll_employee_lines.person_id linkage hook;
--            4) backfill people from payroll_employee_lines and
--               profiles (conservative name matching).
-- Dependencies:
--   004_projects_supabase_storage (projects.id TEXT)
--   005_auth_rbac_foundation      (organizations, profiles,
--                                  current_user_organization_id(),
--                                  current_user_has_permission(),
--                                  current_user_is_admin(),
--                                  set_updated_at())
--   017_payroll_closing           (payroll_employee_lines,
--                                  payroll_closing_batches)
--   022_finance_cost_centers      (finance_cost_centers)
--   039_people_allocations_perm_seeds (RBAC seeds — data only)
-- NOTE: Idempotent. Wrapped in a single transaction. Re-running
--       must be a no-op. RLS SELECT policies check the row's own
--       columns inline or query OTHER tables only (no self-SELECT)
--       so INSERT ... RETURNING works — see migration 030.
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- btree_gist enables the EXCLUDE overlap constraint below. If the
-- instance refuses the extension, drop this line and the constraint
-- block — the allocations service always re-validates overlaps.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ============================================================
-- 1) normalize_person_name — conservative normalization used to
--    match payroll employee names against people. IMMUTABLE so it
--    can back a unique index. Lowercase, trim, collapse whitespace
--    and strip common pt-BR accents (no unaccent dependency).
-- ============================================================
CREATE OR REPLACE FUNCTION public.normalize_person_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(
    translate(
      lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')),
      'áàâãäéèêëíìîïóòôõöúùûüçñ',
      'aaaaaeeeeiiiiooooouuuucn'
    ),
    ''
  )
$$;

-- ============================================================
-- 2) people — canonical organizational person. One row per human,
--    whether or not they have a login (profile_id) or appear on
--    payroll (payroll_name_key). Employment fields are flattened
--    here for now (single active employment per person); a separate
--    employment_contracts table is a future, non-breaking refactor.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.people (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  profile_id         uuid REFERENCES profiles(id) ON DELETE SET NULL,
  full_name          text NOT NULL,
  payroll_name_key   text,
  email              text,
  job_title          text,
  department         text,
  contract_type      text
                       CHECK (contract_type IS NULL OR contract_type IN
                              ('clt','pj','estagio','temporario','outro')),
  weekly_hours       numeric(5,2) NOT NULL DEFAULT 40
                       CHECK (weekly_hours > 0 AND weekly_hours <= 84),
  cost_center_id     uuid REFERENCES finance_cost_centers(id) ON DELETE SET NULL,
  manager_person_id  uuid REFERENCES people(id) ON DELETE SET NULL,
  status             text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','inactive')),
  source             text NOT NULL DEFAULT 'manual'
                       CHECK (source IN ('manual','payroll_import','profile')),
  hired_at           date,
  terminated_at      date,
  notes              text,
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- one payroll identity per org (partial: manual people may lack it)
CREATE UNIQUE INDEX IF NOT EXISTS people_org_payroll_key_unique_idx
  ON public.people (organization_id, payroll_name_key)
  WHERE payroll_name_key IS NOT NULL;

-- one person per login profile
CREATE UNIQUE INDEX IF NOT EXISTS people_profile_unique_idx
  ON public.people (profile_id)
  WHERE profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS people_org_status_idx
  ON public.people (organization_id, status);
CREATE INDEX IF NOT EXISTS people_org_name_idx
  ON public.people (organization_id, full_name);

DROP TRIGGER IF EXISTS trg_people_updated_at ON public.people;
CREATE TRIGGER trg_people_updated_at
BEFORE UPDATE ON public.people
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 3) current_user_person_id — SECURITY DEFINER helper mapping the
--    authenticated user to their canonical person. Safe inside the
--    policies of OTHER tables (allocations/timesheet ownership);
--    people's own policies use inline/other-table checks only.
-- ============================================================
CREATE OR REPLACE FUNCTION public.current_user_person_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id
  FROM people p
  JOIN profiles pr ON pr.id = p.profile_id
  WHERE pr.user_id = auth.uid()
    AND p.organization_id = current_user_organization_id()
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.current_user_person_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_person_id() TO authenticated;

-- ============================================================
-- 4) project_allocations — allocation as a temporal relation
--    (never person.project_id). Validity period + percentage +
--    type + status + approval fields on the row (no generic
--    approval engine — same pattern as contract_approvals/034).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.project_allocations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  person_id           uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  project_id          text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role_title          text,
  allocation_type     text NOT NULL DEFAULT 'billable'
                        CHECK (allocation_type IN
                               ('billable','non_billable','overhead','bench','training')),
  start_date          date NOT NULL,
  end_date            date
                        CHECK (end_date IS NULL OR end_date >= start_date),
  planned_percentage  numeric(5,2) NOT NULL
                        CHECK (planned_percentage > 0 AND planned_percentage <= 100),
  planned_hours_week  numeric(6,2)
                        CHECK (planned_hours_week IS NULL OR planned_hours_week > 0),
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('draft','pending_approval','active',
                                          'ended','cancelled','rejected')),
  source              text NOT NULL DEFAULT 'manual'
                        CHECK (source IN ('manual','project_plan','import')),
  cost_center_id      uuid REFERENCES finance_cost_centers(id) ON DELETE SET NULL,
  justification       text,
  requested_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at         timestamptz,
  rejection_reason    text,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- No overlapping live allocation of the same person on the same
-- project. Cross-project totals above 100% are intentionally NOT a
-- constraint (overload is a warning + justification in the service).
DO $$
BEGIN
  ALTER TABLE public.project_allocations
    ADD CONSTRAINT project_allocations_no_overlap
    EXCLUDE USING gist (
      person_id WITH =,
      project_id WITH =,
      daterange(start_date, COALESCE(end_date, 'infinity'::date), '[]') WITH &&
    ) WHERE (status IN ('pending_approval','active'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS project_allocations_org_project_idx
  ON public.project_allocations (organization_id, project_id, status);
CREATE INDEX IF NOT EXISTS project_allocations_org_person_idx
  ON public.project_allocations (organization_id, person_id, status);
CREATE INDEX IF NOT EXISTS project_allocations_period_idx
  ON public.project_allocations (organization_id, start_date, end_date);

DROP TRIGGER IF EXISTS trg_project_allocations_updated_at ON public.project_allocations;
CREATE TRIGGER trg_project_allocations_updated_at
BEFORE UPDATE ON public.project_allocations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 5) payroll_employee_lines — linkage hook to the canonical person
--    (kept nullable; matching is best-effort by normalized name).
-- ============================================================
ALTER TABLE public.payroll_employee_lines
  ADD COLUMN IF NOT EXISTS person_id uuid REFERENCES people(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pel_person
  ON public.payroll_employee_lines (person_id);

-- ============================================================
-- 6) Backfill — idempotent (ON CONFLICT / NOT EXISTS guards).
-- ============================================================

-- 6.1 people from distinct payroll employee names (latest batch wins
--     for contract_type via competence_month ordering).
INSERT INTO public.people
  (organization_id, full_name, payroll_name_key, contract_type, source)
SELECT DISTINCT ON (pel.organization_id, normalize_person_name(pel.employee_name))
  pel.organization_id,
  regexp_replace(btrim(pel.employee_name), '\s+', ' ', 'g'),
  normalize_person_name(pel.employee_name),
  CASE lower(coalesce(pel.contract_type, ''))
    WHEN 'clt' THEN 'clt'
    WHEN 'pj'  THEN 'pj'
    ELSE NULL
  END,
  'payroll_import'
FROM public.payroll_employee_lines pel
JOIN public.payroll_closing_batches b ON b.id = pel.batch_id
WHERE normalize_person_name(pel.employee_name) IS NOT NULL
  AND b.status <> 'cancelled'
ORDER BY pel.organization_id,
         normalize_person_name(pel.employee_name),
         b.competence_month DESC
ON CONFLICT DO NOTHING;

-- 6.2a link existing people to profiles by normalized name (same org)
UPDATE public.people p
SET profile_id = pr.id,
    email = coalesce(p.email, u.email)
FROM public.profiles pr
JOIN auth.users u ON u.id = pr.user_id
WHERE p.profile_id IS NULL
  AND pr.organization_id = p.organization_id
  AND normalize_person_name(pr.full_name) = p.payroll_name_key
  AND NOT EXISTS (SELECT 1 FROM public.people x WHERE x.profile_id = pr.id);

-- 6.2b people from profiles that matched nothing on payroll
INSERT INTO public.people
  (organization_id, profile_id, full_name, payroll_name_key, email,
   job_title, department, source, status)
SELECT
  pr.organization_id,
  pr.id,
  coalesce(NULLIF(btrim(pr.full_name), ''), u.email, 'Sem nome'),
  normalize_person_name(pr.full_name),
  u.email,
  pr.job_title,
  pr.department,
  'profile',
  CASE WHEN pr.status = 'active' THEN 'active' ELSE 'inactive' END
FROM public.profiles pr
JOIN auth.users u ON u.id = pr.user_id
WHERE pr.organization_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.people x WHERE x.profile_id = pr.id)
ON CONFLICT DO NOTHING;

-- 6.3 link payroll lines to people by normalized name
UPDATE public.payroll_employee_lines pel
SET person_id = p.id
FROM public.people p
WHERE pel.person_id IS NULL
  AND p.organization_id = pel.organization_id
  AND p.payroll_name_key = normalize_person_name(pel.employee_name);

-- ============================================================
-- 7) Row Level Security
--    SELECT policies: inline row columns or subqueries on OTHER
--    tables only (030 lesson) — INSERT ... RETURNING safe.
-- ============================================================
ALTER TABLE public.people              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_allocations ENABLE ROW LEVEL SECURITY;

-- ---------- people ----------
DROP POLICY IF EXISTS people_select ON public.people;
CREATE POLICY people_select ON public.people
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('people.view')
    OR current_user_has_permission('people.allocations_view')
    OR current_user_has_permission('projects.view')
    -- own row (subquery on profiles, not on people)
    OR (profile_id IS NOT NULL AND profile_id IN
          (SELECT pr.id FROM profiles pr WHERE pr.user_id = auth.uid()))
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS people_insert ON public.people;
CREATE POLICY people_insert ON public.people
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('people.manage')
    OR current_user_is_admin()
  )
  AND (created_by IS NULL OR created_by = auth.uid())
);

DROP POLICY IF EXISTS people_update ON public.people;
CREATE POLICY people_update ON public.people
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('people.manage')
    OR current_user_is_admin()
  )
)
WITH CHECK (organization_id = current_user_organization_id());

DROP POLICY IF EXISTS people_delete ON public.people;
CREATE POLICY people_delete ON public.people
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('people.manage')
    OR current_user_is_admin()
  )
);

-- ---------- project_allocations ----------
DROP POLICY IF EXISTS project_allocations_select ON public.project_allocations;
CREATE POLICY project_allocations_select ON public.project_allocations
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('people.allocations_view')
    OR current_user_has_permission('projects.view')
    -- collaborator sees own allocations (helper queries people/profiles)
    OR person_id = current_user_person_id()
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS project_allocations_insert ON public.project_allocations;
CREATE POLICY project_allocations_insert ON public.project_allocations
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('people.allocations_manage')
    OR current_user_is_admin()
  )
  AND (created_by IS NULL OR created_by = auth.uid())
);

DROP POLICY IF EXISTS project_allocations_update ON public.project_allocations;
CREATE POLICY project_allocations_update ON public.project_allocations
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('people.allocations_manage')
    OR current_user_is_admin()
  )
)
WITH CHECK (organization_id = current_user_organization_id());

DROP POLICY IF EXISTS project_allocations_delete ON public.project_allocations;
CREATE POLICY project_allocations_delete ON public.project_allocations
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('people.allocations_manage')
    OR current_user_is_admin()
  )
);

COMMIT;

-- ============================================================
-- 8) Manual verification checklist (staging)
--    1. Re-run this migration -> no-op.
--    2. SELECT count(*) FROM people ≈ distinct payroll names +
--       unmatched profiles (per org).
--    3. User without people.view: SELECT people -> 0 rows.
--    4. User with people.allocations_manage:
--       INSERT project_allocations ... RETURNING -> returns row.
--    5. Overlapping live allocation (same person/project/period)
--       -> exclusion violation (23P01).
--    6. Collaborator with login: SELECT own allocations -> visible.
--
-- ROLLBACK (manual, destructive — only if reverting the feature):
--   ALTER TABLE payroll_employee_lines DROP COLUMN IF EXISTS person_id;
--   DROP TABLE IF EXISTS project_allocations;
--   DROP FUNCTION IF EXISTS current_user_person_id();
--   DROP TABLE IF EXISTS people;
--   DROP FUNCTION IF EXISTS normalize_person_name(text);
-- ============================================================
