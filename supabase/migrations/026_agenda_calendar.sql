-- ============================================================
-- AGENDA & TAREFAS — Calendar, meetings, tasks, notifications
-- Migration: 026_agenda_calendar
-- Date:      2026-06-03
-- Purpose:   Replace the in-memory mock store for the Reuniões
--            module with a real, organization-scoped calendar:
--            meetings (calendar_events + attendees), tasks
--            (tasks + checklist), in-app notifications and an
--            e-mail dispatch audit log. Strictly org-scoped and
--            permission-gated (RBAC seeds live in 027).
-- Dependencies:
--   005_auth_rbac_foundation  (organizations, profiles,
--                              committees, current_user_organization_id(),
--                              current_user_has_permission(),
--                              current_user_is_admin(),
--                              set_updated_at() trigger fn,
--                              meetings.* permission seeds)
--   010_deliberations_supabase (reference RLS pattern — copied idiom)
-- NOTE: Idempotent. Wrapped in a single transaction. Re-running
--       must be a no-op. Tables are referenced read-only from
--       projects/contracts/committees by id (ON DELETE SET NULL),
--       so this never breaks the existing pautas/deliberações flows.
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1) calendar_events — canonical store for MEETINGS.
--    `type` kept as meeting|task for forward-compat, but tasks
--    have their own canonical table below; the calendar UI merges
--    both into one item model. Soft-delete via deleted_at.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.calendar_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  owner_user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  type                  text NOT NULL DEFAULT 'meeting'
                          CHECK (type IN ('meeting','task')),
  title                 text NOT NULL,
  description           text,
  starts_at             timestamptz NOT NULL,
  ends_at               timestamptz,
  all_day               boolean NOT NULL DEFAULT false,
  status                text NOT NULL DEFAULT 'scheduled'
                          CHECK (status IN ('scheduled','confirmed','cancelled','completed')),
  visibility            text NOT NULL DEFAULT 'personal'
                          CHECK (visibility IN ('personal','group','organization')),
  location              text,
  meeting_link          text,
  related_project_id    uuid,
  related_contract_id   uuid,
  related_committee_id  uuid REFERENCES committees(id) ON DELETE SET NULL,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

CREATE INDEX IF NOT EXISTS calendar_events_org_idx
  ON public.calendar_events (organization_id);
CREATE INDEX IF NOT EXISTS calendar_events_org_starts_idx
  ON public.calendar_events (organization_id, starts_at);
CREATE INDEX IF NOT EXISTS calendar_events_owner_idx
  ON public.calendar_events (organization_id, owner_user_id);
CREATE INDEX IF NOT EXISTS calendar_events_committee_idx
  ON public.calendar_events (organization_id, related_committee_id);

DROP TRIGGER IF EXISTS trg_calendar_events_updated_at ON public.calendar_events;
CREATE TRIGGER trg_calendar_events_updated_at
BEFORE UPDATE ON public.calendar_events
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 2) calendar_event_attendees — invitees (internal + external).
--    organization_id denormalized so RLS never needs a join to
--    the parent for the org check. Internal invitees link via
--    user_id; externals carry only email/name.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.calendar_event_attendees (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          uuid NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email             text NOT NULL,
  name              text,
  role              text NOT NULL DEFAULT 'attendee'
                      CHECK (role IN ('organizer','attendee','optional')),
  response_status   text NOT NULL DEFAULT 'pending'
                      CHECK (response_status IN ('pending','accepted','declined','tentative')),
  is_external       boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attendees_event_idx
  ON public.calendar_event_attendees (event_id);
CREATE INDEX IF NOT EXISTS attendees_user_idx
  ON public.calendar_event_attendees (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS attendees_event_email_unique
  ON public.calendar_event_attendees (event_id, lower(email));

-- ============================================================
-- 3) tasks — canonical store for TASKS. Assignee is internal-only
--    (enforced by RLS WITH CHECK against profiles in the same org).
--    Soft-delete via deleted_at.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tasks (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  creator_user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  assignee_user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title                 text NOT NULL,
  description           text,
  due_at                timestamptz,
  due_all_day           boolean NOT NULL DEFAULT false,
  priority              text NOT NULL DEFAULT 'medium'
                          CHECK (priority IN ('low','medium','high','critical')),
  status                text NOT NULL DEFAULT 'todo'
                          CHECK (status IN ('todo','in_progress','done','cancelled')),
  related_event_id      uuid REFERENCES calendar_events(id) ON DELETE SET NULL,
  related_project_id    uuid,
  related_contract_id   uuid,
  notify_emails         jsonb NOT NULL DEFAULT '[]'::jsonb,
  completed_at          timestamptz,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

CREATE INDEX IF NOT EXISTS tasks_org_idx
  ON public.tasks (organization_id);
CREATE INDEX IF NOT EXISTS tasks_assignee_idx
  ON public.tasks (organization_id, assignee_user_id);
CREATE INDEX IF NOT EXISTS tasks_creator_idx
  ON public.tasks (organization_id, creator_user_id);
CREATE INDEX IF NOT EXISTS tasks_org_status_idx
  ON public.tasks (organization_id, status);
CREATE INDEX IF NOT EXISTS tasks_due_idx
  ON public.tasks (organization_id, due_at)
  WHERE status NOT IN ('done','cancelled');

DROP TRIGGER IF EXISTS trg_tasks_updated_at ON public.tasks;
CREATE TRIGGER trg_tasks_updated_at
BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 4) task_checklist_items
-- ============================================================
CREATE TABLE IF NOT EXISTS public.task_checklist_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id           uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  title             text NOT NULL,
  completed         boolean NOT NULL DEFAULT false,
  position          integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checklist_task_idx
  ON public.task_checklist_items (task_id);

DROP TRIGGER IF EXISTS trg_checklist_updated_at ON public.task_checklist_items;
CREATE TRIGGER trg_checklist_updated_at
BEFORE UPDATE ON public.task_checklist_items
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 5) notifications — in-app messages. Insert ONLY through the
--    SECURITY DEFINER create_notification() RPC (no INSERT policy),
--    so a creator can notify another internal user without a
--    permissive cross-user insert policy.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recipient_user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type                text NOT NULL,
  title               text NOT NULL,
  body                text,
  link_url            text,
  read_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_recipient_idx
  ON public.notifications (recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_recipient_unread_idx
  ON public.notifications (recipient_user_id)
  WHERE read_at IS NULL;

-- ============================================================
-- 6) email_dispatches — audit log of outbound e-mails. One row
--    per recipient. Status mirrors the payroll dispatch model.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.email_dispatches (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  target_email          text NOT NULL,
  subject               text NOT NULL,
  status                text NOT NULL DEFAULT 'simulated'
                          CHECK (status IN ('sent','failed','simulated')),
  provider              text,
  provider_message_id   text,
  related_entity_type   text,
  related_entity_id     uuid,
  error_message         text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_dispatches_org_idx
  ON public.email_dispatches (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_dispatches_entity_idx
  ON public.email_dispatches (related_entity_type, related_entity_id);

-- ============================================================
-- 6.5) SECURITY DEFINER access helpers
--   These break two problems that arise when RLS policies cross
--   table boundaries:
--     a) Mutual recursion between calendar_events and
--        calendar_event_attendees SELECT policies ("infinite
--        recursion detected in policy").
--     b) The internal-assignee check on tasks would otherwise run
--        a sub-SELECT on profiles UNDER profiles RLS, which hides
--        other members' rows from non-admins — wrongly blocking a
--        legitimate assignment.
--   Running these as SECURITY DEFINER bypasses the referenced
--   tables' RLS while still scoping everything to the caller's org
--   and auth.uid().
-- ============================================================

-- True if p_user_id is an active member of the caller's organization.
CREATE OR REPLACE FUNCTION public.is_org_member(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.user_id = p_user_id
      AND p.organization_id = current_user_organization_id()
  )
$$;

-- True if the caller may SEE the event (owner, attendee, or a
-- group/organization event with meetings.view, or admin).
CREATE OR REPLACE FUNCTION public.user_can_access_event(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM calendar_events e
    WHERE e.id = p_event_id
      AND e.organization_id = current_user_organization_id()
      AND (
           e.owner_user_id = auth.uid()
        OR (e.visibility IN ('group','organization') AND current_user_has_permission('meetings.view'))
        OR EXISTS (
             SELECT 1 FROM calendar_event_attendees a
             WHERE a.event_id = e.id AND a.user_id = auth.uid()
           )
        OR current_user_is_admin()
      )
  )
$$;

-- True if the caller may MANAGE the event (owner, meetings.edit,
-- meetings.delete or admin).
CREATE OR REPLACE FUNCTION public.user_can_manage_event(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM calendar_events e
    WHERE e.id = p_event_id
      AND e.organization_id = current_user_organization_id()
      AND (
           e.owner_user_id = auth.uid()
        OR current_user_has_permission('meetings.edit')
        OR current_user_has_permission('meetings.delete')
        OR current_user_is_admin()
      )
  )
$$;

REVOKE ALL ON FUNCTION public.is_org_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_can_access_event(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_can_manage_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_access_event(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_manage_event(uuid) TO authenticated;

-- ============================================================
-- 7) Row Level Security
-- ============================================================
ALTER TABLE public.calendar_events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_event_attendees   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_checklist_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_dispatches           ENABLE ROW LEVEL SECURITY;

-- ---------- calendar_events ----------
-- Uses user_can_access_event() (SECURITY DEFINER) so the attendee
-- sub-check does not recurse into the attendees SELECT policy.
DROP POLICY IF EXISTS calendar_events_select ON public.calendar_events;
CREATE POLICY calendar_events_select ON public.calendar_events
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND user_can_access_event(id)
);

DROP POLICY IF EXISTS calendar_events_insert ON public.calendar_events;
CREATE POLICY calendar_events_insert ON public.calendar_events
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('meetings.create')
  AND owner_user_id = auth.uid()
);

DROP POLICY IF EXISTS calendar_events_update ON public.calendar_events;
CREATE POLICY calendar_events_update ON public.calendar_events
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       owner_user_id = auth.uid()
    OR current_user_has_permission('meetings.edit')
    OR current_user_is_admin()
  )
)
WITH CHECK (
  organization_id = current_user_organization_id()
);

DROP POLICY IF EXISTS calendar_events_delete ON public.calendar_events;
CREATE POLICY calendar_events_delete ON public.calendar_events
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       owner_user_id = auth.uid()
    OR current_user_has_permission('meetings.delete')
    OR current_user_is_admin()
  )
);

-- ---------- calendar_event_attendees ----------
-- Cross-table checks go through SECURITY DEFINER helpers to avoid
-- recursion with the calendar_events policies.
DROP POLICY IF EXISTS attendees_select ON public.calendar_event_attendees;
CREATE POLICY attendees_select ON public.calendar_event_attendees
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       user_id = auth.uid()
    OR user_can_access_event(event_id)
  )
);

-- owner / editor / admin manage the guest list
DROP POLICY IF EXISTS attendees_insert ON public.calendar_event_attendees;
CREATE POLICY attendees_insert ON public.calendar_event_attendees
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND user_can_manage_event(event_id)
);

-- owner/editor/admin may edit any attendee; an attendee may update
-- their own response_status (RSVP).
DROP POLICY IF EXISTS attendees_update ON public.calendar_event_attendees;
CREATE POLICY attendees_update ON public.calendar_event_attendees
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (user_id = auth.uid() OR user_can_manage_event(event_id))
)
WITH CHECK (organization_id = current_user_organization_id());

DROP POLICY IF EXISTS attendees_delete ON public.calendar_event_attendees;
CREATE POLICY attendees_delete ON public.calendar_event_attendees
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND user_can_manage_event(event_id)
);

-- ---------- tasks ----------
DROP POLICY IF EXISTS tasks_select ON public.tasks;
CREATE POLICY tasks_select ON public.tasks
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       creator_user_id = auth.uid()
    OR assignee_user_id = auth.uid()
    OR current_user_has_permission('tasks.admin')
    OR current_user_is_admin()
  )
);

-- create: must be creator; assignee (if any) must be internal to the
-- same org; assigning to anyone other than yourself requires tasks.assign.
DROP POLICY IF EXISTS tasks_insert ON public.tasks;
CREATE POLICY tasks_insert ON public.tasks
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('tasks.create')
  AND creator_user_id = auth.uid()
  AND (
       assignee_user_id IS NULL
    OR assignee_user_id = auth.uid()
    OR current_user_has_permission('tasks.assign')
    OR current_user_is_admin()
  )
  -- internal-only assignee, checked via SECURITY DEFINER so profiles
  -- RLS does not hide other members from non-admins
  AND (assignee_user_id IS NULL OR is_org_member(assignee_user_id))
);

DROP POLICY IF EXISTS tasks_update ON public.tasks;
CREATE POLICY tasks_update ON public.tasks
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       creator_user_id = auth.uid()
    OR assignee_user_id = auth.uid()
    OR current_user_has_permission('tasks.edit')
    OR current_user_has_permission('tasks.admin')
    OR current_user_is_admin()
  )
)
WITH CHECK (
  organization_id = current_user_organization_id()
  -- keep assignee internal; (re)assigning to others requires tasks.assign
  AND (
       assignee_user_id IS NULL
    OR assignee_user_id = auth.uid()
    OR current_user_has_permission('tasks.assign')
    OR current_user_is_admin()
  )
  AND (assignee_user_id IS NULL OR is_org_member(assignee_user_id))
);

DROP POLICY IF EXISTS tasks_delete ON public.tasks;
CREATE POLICY tasks_delete ON public.tasks
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       creator_user_id = auth.uid()
    OR current_user_has_permission('tasks.admin')
    OR current_user_is_admin()
  )
);

-- ---------- task_checklist_items ----------
DROP POLICY IF EXISTS checklist_select ON public.task_checklist_items;
CREATE POLICY checklist_select ON public.task_checklist_items
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND EXISTS (
    SELECT 1 FROM tasks t
    WHERE t.id = task_checklist_items.task_id
      AND (
           t.creator_user_id = auth.uid()
        OR t.assignee_user_id = auth.uid()
        OR current_user_has_permission('tasks.admin')
        OR current_user_is_admin()
      )
  )
);

DROP POLICY IF EXISTS checklist_write ON public.task_checklist_items;
CREATE POLICY checklist_write ON public.task_checklist_items
FOR ALL TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND EXISTS (
    SELECT 1 FROM tasks t
    WHERE t.id = task_checklist_items.task_id
      AND (
           t.creator_user_id = auth.uid()
        OR t.assignee_user_id = auth.uid()
        OR current_user_has_permission('tasks.edit')
        OR current_user_has_permission('tasks.admin')
        OR current_user_is_admin()
      )
  )
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND EXISTS (
    SELECT 1 FROM tasks t
    WHERE t.id = task_checklist_items.task_id
      AND (
           t.creator_user_id = auth.uid()
        OR t.assignee_user_id = auth.uid()
        OR current_user_has_permission('tasks.edit')
        OR current_user_has_permission('tasks.admin')
        OR current_user_is_admin()
      )
  )
);

-- ---------- notifications ----------
-- recipient-only. No INSERT policy: rows are created exclusively by
-- create_notification() (SECURITY DEFINER), so org members can notify
-- each other without a permissive cross-user insert policy.
DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications
FOR SELECT TO authenticated
USING (recipient_user_id = auth.uid());

DROP POLICY IF EXISTS notifications_update ON public.notifications;
CREATE POLICY notifications_update ON public.notifications
FOR UPDATE TO authenticated
USING (recipient_user_id = auth.uid())
WITH CHECK (recipient_user_id = auth.uid());

DROP POLICY IF EXISTS notifications_delete ON public.notifications;
CREATE POLICY notifications_delete ON public.notifications
FOR DELETE TO authenticated
USING (recipient_user_id = auth.uid());

-- ---------- email_dispatches ----------
-- Logged server-side under the triggering user's session. Readable by
-- admins / audit viewers only.
DROP POLICY IF EXISTS email_dispatches_insert ON public.email_dispatches;
CREATE POLICY email_dispatches_insert ON public.email_dispatches
FOR INSERT TO authenticated
WITH CHECK (organization_id = current_user_organization_id());

DROP POLICY IF EXISTS email_dispatches_select ON public.email_dispatches;
CREATE POLICY email_dispatches_select ON public.email_dispatches
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('audit.view'))
);

-- ============================================================
-- 8) SECURITY DEFINER helpers
-- ============================================================

-- list_organization_members(): safe member directory for the caller's
-- org (assignee picker + internal-attendee linking) WITHOUT widening
-- the column-blind profiles RLS. Exposes only name/title/avatar/email.
CREATE OR REPLACE FUNCTION public.list_organization_members()
RETURNS TABLE (
  user_id    uuid,
  full_name  text,
  job_title  text,
  avatar_url text,
  email      text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id, p.full_name, p.job_title, p.avatar_url, u.email::text
  FROM profiles p
  JOIN auth.users u ON u.id = p.user_id
  WHERE p.organization_id = current_user_organization_id()
    AND p.status = 'active'
  ORDER BY p.full_name NULLS LAST
$$;

REVOKE ALL ON FUNCTION public.list_organization_members() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_organization_members() TO authenticated;

-- create_notification(): insert an in-app notification for a recipient
-- in the caller's organization. Returns the new id.
CREATE OR REPLACE FUNCTION public.create_notification(
  p_recipient uuid,
  p_type      text,
  p_title     text,
  p_body      text DEFAULT NULL,
  p_link      text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_id  uuid;
BEGIN
  v_org := current_user_organization_id();
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Usuário sem organização ativa';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.user_id = p_recipient AND p.organization_id = v_org
  ) THEN
    RAISE EXCEPTION 'Destinatário fora da organização';
  END IF;

  INSERT INTO notifications (organization_id, recipient_user_id, type, title, body, link_url)
  VALUES (v_org, p_recipient, p_type, p_title, p_body, p_link)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_notification(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_notification(uuid, text, text, text, text) TO authenticated;

COMMIT;

-- ============================================================
-- 9) Manual verification checklist (run in a staging DB)
--    1. As anon: SELECT from each table -> denied / 0 rows.
--    2. As user in Org A: SELECT calendar_events WHERE organization_id
--       = '<Org B id>' -> 0 rows.
--    3. INSERT task with assignee_user_id from another org -> denied
--       (tasks_insert WITH CHECK: assignee not internal).
--    4. INSERT task with assignee = another user but WITHOUT
--       tasks.assign -> denied.
--    5. INSERT notification directly -> denied (no INSERT policy);
--       SELECT create_notification('<peer>', ...) -> succeeds.
--    6. list_organization_members() as a plain member -> returns the
--       org directory (even without admin.manage_users).
--    7. UPDATE calendar_events SET organization_id = '<other org>'
--       -> denied (WITH CHECK fails).
-- ============================================================
