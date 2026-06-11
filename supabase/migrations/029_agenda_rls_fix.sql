-- ============================================================
-- AGENDA — RLS INSERT policy fix + permission re-seed
-- Migration: 029_agenda_rls_fix
-- Date:      2026-06-09
--
-- Problem: calendar_events INSERT policy lacked the admin bypass
-- (OR current_user_is_admin()) present in UPDATE/DELETE, causing
-- owner/admin accounts to receive "Acesso negado pela política de
-- segurança" when creating meetings.
--
-- Fix:
--   1) Recreate the INSERT policy to include current_user_is_admin().
--   2) Re-seed meetings.create into owner_admin (idempotent) as a
--      defensive measure in case role_permissions rows are missing.
-- ============================================================

BEGIN;

-- 1) Fix calendar_events INSERT policy — add admin bypass to match
--    the UPDATE / DELETE policies from migration 026.
DROP POLICY IF EXISTS calendar_events_insert ON public.calendar_events;
CREATE POLICY calendar_events_insert ON public.calendar_events
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('meetings.create')
    OR current_user_is_admin()
  )
  AND owner_user_id = auth.uid()
);

-- 2) Re-seed meetings.* into owner_admin (idempotent — ON CONFLICT DO NOTHING).
--    Protects against any environment where the initial seed was incomplete.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.key = 'owner_admin'
  AND r.organization_id IS NULL
  AND p.key IN (
    'meetings.view',
    'meetings.create',
    'meetings.edit',
    'meetings.delete',
    'meetings.participate'
  )
ON CONFLICT DO NOTHING;

COMMIT;
