-- ============================================================
-- 013_finance_perm_seeds.sql
--
-- Closes RBAC audit finding R2 (see docs/auth/RBAC_ACCESS_MATRIX.md).
--
-- The bridge function `has_finance_role_or_perm(role_key, perm_key)`
-- created in 007_auth_rbac_hardening.sql evaluates RLS using either a
-- legacy `user_finance_role` row OR a new RBAC permission. It already
-- references the perm keys `finance.admin` and `finance.edit`, but
-- those keys were intentionally NOT seeded in 005 / 007.
--
-- This migration is data-only (no schema change). It is idempotent
-- and follows the same seed/grant pattern used by 011 (risks.ai_scan)
-- and 012 (risks.ai_dismiss):
--
--   1) seed the permission rows (ON CONFLICT DO NOTHING)
--   2) grant to owner_admin (catch-all CTE in 005 only ran once)
--   3) grant finance.edit to financeiro
--      finance.admin remains owner_admin-only for now
--
-- Effect on existing RLS:
--   - has_finance_role_or_perm('finance_admin', 'finance.admin')
--     now evaluates to true for users holding finance.admin.
--   - Same for finance.edit on the analyst-tier policies.
--   - Behaviour for users without these perms is unchanged
--     (legacy `user_finance_role` rows remain authoritative).
-- ============================================================
BEGIN;

-- ---------------------------------------------------------------------
-- Section 1 — Seed permissions (idempotent)
-- ---------------------------------------------------------------------
INSERT INTO public.permissions (key, module, action, description) VALUES
  ('finance.admin', 'finance', 'admin', 'Administracao geral do modulo financeiro (escrita em referenciais)'),
  ('finance.edit',  'finance', 'edit',  'Edicao de entidades financeiras (lancamentos, anexos, periodos)')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- Section 2 — Grant both perms to owner_admin
-- ---------------------------------------------------------------------
WITH owner_role AS (
  SELECT id FROM public.roles
   WHERE key = 'owner_admin' AND organization_id IS NULL
),
new_perms AS (
  SELECT id FROM public.permissions WHERE key IN ('finance.admin', 'finance.edit')
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT owner_role.id, new_perms.id
FROM owner_role, new_perms
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- Section 3 — Grant finance.edit to the Financeiro role
-- ---------------------------------------------------------------------
-- Rationale: `financeiro` already holds finance.create_entry,
-- finance.edit_entry, finance.approve etc. (see 005 lines 619-636).
-- Granting the bridge-level finance.edit lets analyst-tier RLS
-- policies (supplier/client INSERT, ledger writes, payroll batches,
-- attachments, period close) accept this role without forcing every
-- analyst to also hold a row in legacy user_finance_role.
WITH analyst_role AS (
  SELECT id FROM public.roles
   WHERE key = 'financeiro' AND organization_id IS NULL
),
edit_perm AS (
  SELECT id FROM public.permissions WHERE key = 'finance.edit'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT analyst_role.id, edit_perm.id
FROM analyst_role, edit_perm
ON CONFLICT DO NOTHING;

-- finance.admin is intentionally NOT granted to `financeiro`.
-- Keep module-admin reserved for owner_admin until the next governance review.

COMMIT;
