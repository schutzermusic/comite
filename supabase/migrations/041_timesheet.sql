-- ============================================================
-- PESSOAS & PROJETOS — Timesheet (work sessions + time entries)
-- Migration: 041_timesheet
-- Date:      2026-07-15
-- Purpose:   Web timesheet foundation:
--            1) project_work_sessions — granular timer/draft
--               sessions (one running session per person);
--            2) time_entries — consolidated per person/project/day,
--               the unit of exception-based approval. Exception
--               flags computed at submission live on the row
--               (exception_flags jsonb + auto_approved) — no
--               IntegrityAlert table in this phase.
--            Cost columns (hourly_cost_cents/cost_cents) are
--            nullable hooks for the future payroll cost phase.
-- Dependencies:
--   004 (projects.id TEXT), 005 (helpers), 032 (project_timeline_items)
--   038_people_allocations (people, project_allocations,
--                           current_user_person_id())
--   042_timesheet_perm_seeds (people.timesheet_* perms — data only)
-- NOTE: Idempotent, single transaction, RLS 030-safe.
-- ============================================================

BEGIN;

-- ============================================================
-- 1) project_work_sessions — timer/draft granular sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.project_work_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  person_id         uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  project_id        text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  allocation_id     uuid REFERENCES project_allocations(id) ON DELETE SET NULL,
  timeline_item_id  uuid REFERENCES project_timeline_items(id) ON DELETE SET NULL,
  started_at        timestamptz NOT NULL DEFAULT now(),
  ended_at          timestamptz
                      CHECK (ended_at IS NULL OR ended_at > started_at),
  duration_minutes  integer
                      CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  description       text,
  source            text NOT NULL DEFAULT 'web_timer'
                      CHECK (source IN ('web_timer','manual_entry','manager_adjustment')),
  status            text NOT NULL DEFAULT 'running'
                      CHECK (status IN ('running','draft','consolidated','discarded')),
  time_entry_id     uuid,  -- FK added below, after time_entries exists
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- exactly one running timer per person (switch project = stop + start)
CREATE UNIQUE INDEX IF NOT EXISTS work_sessions_one_running_idx
  ON public.project_work_sessions (person_id)
  WHERE status = 'running';

CREATE INDEX IF NOT EXISTS work_sessions_org_person_idx
  ON public.project_work_sessions (organization_id, person_id, started_at DESC);
CREATE INDEX IF NOT EXISTS work_sessions_org_project_idx
  ON public.project_work_sessions (organization_id, project_id, started_at DESC);

DROP TRIGGER IF EXISTS trg_work_sessions_updated_at ON public.project_work_sessions;
CREATE TRIGGER trg_work_sessions_updated_at
BEFORE UPDATE ON public.project_work_sessions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 2) time_entries — consolidated per person/project/day
-- ============================================================
CREATE TABLE IF NOT EXISTS public.time_entries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  person_id          uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  project_id         text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  allocation_id      uuid REFERENCES project_allocations(id) ON DELETE SET NULL,
  timeline_item_id   uuid REFERENCES project_timeline_items(id) ON DELETE SET NULL,
  work_date          date NOT NULL,
  minutes            integer NOT NULL CHECK (minutes > 0 AND minutes <= 1440),
  description        text,
  source_session_id  uuid REFERENCES project_work_sessions(id) ON DELETE SET NULL,
  status             text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','submitted','approved',
                                         'rejected','locked')),
  exception_flags    jsonb NOT NULL DEFAULT '[]'::jsonb,
  auto_approved      boolean NOT NULL DEFAULT false,
  submitted_at       timestamptz,
  approved_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at        timestamptz,
  rejection_reason   text,
  -- future payroll-cost phase hooks (competence snapshot)
  hourly_cost_cents  bigint CHECK (hourly_cost_cents IS NULL OR hourly_cost_cents >= 0),
  cost_cents         bigint CHECK (cost_cents IS NULL OR cost_cents >= 0),
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS time_entries_org_project_date_idx
  ON public.time_entries (organization_id, project_id, work_date DESC);
CREATE INDEX IF NOT EXISTS time_entries_org_person_date_idx
  ON public.time_entries (organization_id, person_id, work_date DESC);
-- approval queue
CREATE INDEX IF NOT EXISTS time_entries_submitted_idx
  ON public.time_entries (organization_id, submitted_at DESC)
  WHERE status = 'submitted';

DROP TRIGGER IF EXISTS trg_time_entries_updated_at ON public.time_entries;
CREATE TRIGGER trg_time_entries_updated_at
BEFORE UPDATE ON public.time_entries
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- back-reference from sessions to their consolidated entry
DO $$
BEGIN
  ALTER TABLE public.project_work_sessions
    ADD CONSTRAINT work_sessions_time_entry_fk
    FOREIGN KEY (time_entry_id) REFERENCES public.time_entries(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 3) Row Level Security
--    Ownership via current_user_person_id() (SECURITY DEFINER,
--    queries people/profiles — OTHER tables — 030-safe).
-- ============================================================
ALTER TABLE public.project_work_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_entries          ENABLE ROW LEVEL SECURITY;

-- ---------- project_work_sessions ----------
DROP POLICY IF EXISTS work_sessions_select ON public.project_work_sessions;
CREATE POLICY work_sessions_select ON public.project_work_sessions
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       person_id = current_user_person_id()
    OR current_user_has_permission('people.timesheet_view')
    OR current_user_has_permission('people.timesheet_approve')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS work_sessions_insert ON public.project_work_sessions;
CREATE POLICY work_sessions_insert ON public.project_work_sessions
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
       -- own session, needs timesheet_use
       (person_id = current_user_person_id()
        AND current_user_has_permission('people.timesheet_use'))
       -- manager adjustment on behalf of someone else
    OR (source = 'manager_adjustment'
        AND current_user_has_permission('people.timesheet_approve'))
    OR current_user_is_admin()
  )
  AND (created_by IS NULL OR created_by = auth.uid())
);

DROP POLICY IF EXISTS work_sessions_update ON public.project_work_sessions;
CREATE POLICY work_sessions_update ON public.project_work_sessions
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       -- owner edits while not consolidated
       (person_id = current_user_person_id()
        AND status IN ('running','draft')
        AND current_user_has_permission('people.timesheet_use'))
    OR current_user_has_permission('people.timesheet_approve')
    OR current_user_is_admin()
  )
)
WITH CHECK (organization_id = current_user_organization_id());

DROP POLICY IF EXISTS work_sessions_delete ON public.project_work_sessions;
CREATE POLICY work_sessions_delete ON public.project_work_sessions
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       (person_id = current_user_person_id()
        AND status IN ('running','draft')
        AND current_user_has_permission('people.timesheet_use'))
    OR current_user_is_admin()
  )
);

-- ---------- time_entries ----------
DROP POLICY IF EXISTS time_entries_select ON public.time_entries;
CREATE POLICY time_entries_select ON public.time_entries
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       person_id = current_user_person_id()
    OR current_user_has_permission('people.timesheet_view')
    OR current_user_has_permission('people.timesheet_approve')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS time_entries_insert ON public.time_entries;
CREATE POLICY time_entries_insert ON public.time_entries
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
       (person_id = current_user_person_id()
        AND current_user_has_permission('people.timesheet_use'))
    OR current_user_has_permission('people.timesheet_approve')
    OR current_user_is_admin()
  )
  AND (created_by IS NULL OR created_by = auth.uid())
);

-- Owner may edit/submit only draft or rejected rows; the submit
-- transition itself (draft -> submitted/approved) is done by the
-- owner while the row still satisfies USING (status='draft').
-- Approve/reject/lock require timesheet_approve.
DROP POLICY IF EXISTS time_entries_update ON public.time_entries;
CREATE POLICY time_entries_update ON public.time_entries
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       (person_id = current_user_person_id()
        AND status IN ('draft','rejected')
        AND current_user_has_permission('people.timesheet_use'))
    OR current_user_has_permission('people.timesheet_approve')
    OR current_user_is_admin()
  )
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
       -- owner can land the row only in these states
       (person_id = current_user_person_id()
        AND status IN ('draft','submitted','approved')
        AND current_user_has_permission('people.timesheet_use'))
    OR current_user_has_permission('people.timesheet_approve')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS time_entries_delete ON public.time_entries;
CREATE POLICY time_entries_delete ON public.time_entries
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       (person_id = current_user_person_id()
        AND status IN ('draft','rejected')
        AND current_user_has_permission('people.timesheet_use'))
    OR current_user_is_admin()
  )
);

COMMIT;

-- ============================================================
-- Manual verification checklist (staging)
--   1. Re-run -> no-op.
--   2. Second INSERT with status='running' for same person -> 23505.
--   3. Owner UPDATE on approved entry -> denied (USING fails).
--   4. Owner draft -> submitted/approved transition -> allowed.
--   5. timesheet_approve user: approved -> locked -> allowed.
--   6. INSERT ... RETURNING as owner -> returns row.
--
-- ROLLBACK (manual):
--   DROP TABLE IF EXISTS time_entries CASCADE;
--   DROP TABLE IF EXISTS project_work_sessions;
-- ============================================================
