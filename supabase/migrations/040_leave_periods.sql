-- ============================================================
-- PESSOAS & PROJETOS — Leave periods (capacity reducers)
-- Migration: 040_leave_periods
-- Date:      2026-07-15
-- Purpose:   leave_periods — vacations, medical leave and other
--            unavailabilities that reduce a person's productive
--            capacity. Capacity itself is DERIVED at query time
--            (people.weekly_hours pro-rata minus overlapping
--            leaves) — no materialized capacity table.
-- Dependencies:
--   005_auth_rbac_foundation (helpers, set_updated_at())
--   038_people_allocations   (people, btree_gist,
--                             current_user_person_id())
--   039_people_allocations_perm_seeds (people.allocations_* perms)
-- NOTE: Idempotent, single transaction, RLS 030-safe (no
--       self-SELECT in policies).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.leave_periods (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  person_id        uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  type             text NOT NULL DEFAULT 'vacation'
                     CHECK (type IN ('vacation','medical','parental',
                                     'unpaid','training','other')),
  start_date       date NOT NULL,
  end_date         date NOT NULL CHECK (end_date >= start_date),
  -- NULL = full day off; otherwise partial unavailability (h/day)
  hours_per_day    numeric(4,2)
                     CHECK (hours_per_day IS NULL OR
                            (hours_per_day > 0 AND hours_per_day <= 24)),
  status           text NOT NULL DEFAULT 'approved'
                     CHECK (status IN ('planned','approved','active',
                                       'completed','cancelled')),
  notes            text,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- no overlapping live leaves for the same person
DO $$
BEGIN
  ALTER TABLE public.leave_periods
    ADD CONSTRAINT leave_periods_no_overlap
    EXCLUDE USING gist (
      person_id WITH =,
      daterange(start_date, end_date, '[]') WITH &&
    ) WHERE (status IN ('planned','approved','active'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS leave_periods_org_person_idx
  ON public.leave_periods (organization_id, person_id, start_date);
CREATE INDEX IF NOT EXISTS leave_periods_period_idx
  ON public.leave_periods (organization_id, start_date, end_date);

DROP TRIGGER IF EXISTS trg_leave_periods_updated_at ON public.leave_periods;
CREATE TRIGGER trg_leave_periods_updated_at
BEFORE UPDATE ON public.leave_periods
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE public.leave_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leave_periods_select ON public.leave_periods;
CREATE POLICY leave_periods_select ON public.leave_periods
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('people.allocations_view')
    OR current_user_has_permission('people.view')
    OR person_id = current_user_person_id()
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS leave_periods_insert ON public.leave_periods;
CREATE POLICY leave_periods_insert ON public.leave_periods
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('people.allocations_manage')
    OR current_user_has_permission('people.manage')
    OR current_user_is_admin()
  )
  AND (created_by IS NULL OR created_by = auth.uid())
);

DROP POLICY IF EXISTS leave_periods_update ON public.leave_periods;
CREATE POLICY leave_periods_update ON public.leave_periods
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('people.allocations_manage')
    OR current_user_has_permission('people.manage')
    OR current_user_is_admin()
  )
)
WITH CHECK (organization_id = current_user_organization_id());

DROP POLICY IF EXISTS leave_periods_delete ON public.leave_periods;
CREATE POLICY leave_periods_delete ON public.leave_periods
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('people.allocations_manage')
    OR current_user_has_permission('people.manage')
    OR current_user_is_admin()
  )
);

COMMIT;

-- ROLLBACK (manual): DROP TABLE IF EXISTS leave_periods;
