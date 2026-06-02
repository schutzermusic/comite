-- ============================================================
-- PAYROLL CLOSING — lifecycle controls (soft-delete, cancel, reopen)
-- Migration: 023_payroll_closing_lifecycle
--
-- Adds soft-delete/cancel bookkeeping to payroll_closing_batches and seeds the
-- elevated permissions used by the edit/delete/cancel/reopen flow. Idempotent,
-- non-destructive (ADD COLUMN IF NOT EXISTS, perm seeds ON CONFLICT DO NOTHING).
--
-- Production preference is SOFT delete (status = 'cancelled' + deleted_at/by +
-- cancellation_reason). Hard delete is reserved for owner/admin / dev cleanup
-- and removes child rows + Storage objects in the repository layer.
-- ============================================================
BEGIN;

-- ── 1. Soft-delete / cancellation columns ──────────────────
ALTER TABLE payroll_closing_batches
  ADD COLUMN IF NOT EXISTS deleted_at          timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by          uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS reopened_at         timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_by         uuid REFERENCES auth.users(id);

-- The active-competence uniqueness already excludes 'cancelled' (migration 017),
-- so a cancelled closing frees the competence for a new one.

-- ── 2. Elevated permissions ─────────────────────────────────
INSERT INTO public.permissions (key, module, action, description) VALUES
  ('people.payroll_delete', 'people', 'payroll_delete', 'Excluir/cancelar fechamento da folha'),
  ('people.payroll_reopen', 'people', 'payroll_reopen', 'Reabrir fechamento aprovado/enviado ao Financeiro'),
  ('people.payroll_admin',  'people', 'payroll_admin',  'Administracao total do fechamento da folha')
ON CONFLICT (key) DO NOTHING;

-- Grant the new permissions to owner_admin (admins also bypass in code).
WITH owner_role AS (
  SELECT id FROM public.roles WHERE key = 'owner_admin' AND organization_id IS NULL
),
new_perms AS (
  SELECT id FROM public.permissions
  WHERE key IN ('people.payroll_delete', 'people.payroll_reopen', 'people.payroll_admin')
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT owner_role.id, new_perms.id FROM owner_role, new_perms
ON CONFLICT DO NOTHING;

-- RH may reopen its own approved closings (edit cycle) but not delete.
WITH rh_role AS (
  SELECT id FROM public.roles WHERE key = 'rh' AND organization_id IS NULL
),
reopen_perm AS (
  SELECT id FROM public.permissions WHERE key = 'people.payroll_reopen'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT rh_role.id, reopen_perm.id FROM rh_role, reopen_perm
ON CONFLICT DO NOTHING;

COMMIT;
