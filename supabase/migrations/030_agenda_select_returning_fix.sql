-- ============================================================
-- AGENDA — Fix INSERT ... RETURNING on calendar_events
-- Migration: 030_agenda_select_returning_fix
-- Date:      2026-06-10
--
-- Problem
-- -------
-- Creating a meeting failed with "new row violates row-level
-- security policy for table calendar_events" (SQLSTATE 42501),
-- even for owner/admin users whose INSERT WITH CHECK passes.
--
-- Root cause: the client inserts via supabase-js
-- `.insert(...).select('*').single()`, i.e. INSERT ... RETURNING.
-- Postgres applies the SELECT policy to rows produced by RETURNING.
-- The SELECT policy was:
--     organization_id = current_user_organization_id()
--     AND user_can_access_event(id)
-- and user_can_access_event() runs a FRESH self-SELECT on
-- calendar_events looking for that id. During the RETURNING phase
-- the just-inserted row is not yet visible to that sub-SELECT, so
-- the function returns false and RETURNING is blocked — surfaced as
-- an RLS violation. (Tasks were unaffected because tasks_select
-- checks the row's own columns directly, never a self-SELECT.)
--
-- Fix: inline the owner / visibility / admin checks in the SELECT
-- policy using the ROW'S OWN columns (no self-SELECT), so an owned
-- row returned by INSERT ... RETURNING passes immediately. The
-- SECURITY DEFINER helper is kept ONLY for the attendee case (the
-- original source of the recursion the helper was created to avoid).
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS calendar_events_select ON public.calendar_events;
CREATE POLICY calendar_events_select ON public.calendar_events
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       -- Owner: checked on the row's own column → visible to
       -- INSERT ... RETURNING without a self-SELECT.
       owner_user_id = auth.uid()
       -- Group/organization-wide events for users with meetings.view.
    OR (visibility IN ('group','organization') AND current_user_has_permission('meetings.view'))
       -- Admins see everything in their org.
    OR current_user_is_admin()
       -- Attendee check stays in the SECURITY DEFINER helper to avoid
       -- recursion with the attendees SELECT policy. Not needed for the
       -- RETURNING case (the creator is always the owner).
    OR user_can_access_event(id)
  )
);

COMMIT;
