-- ============================================================
-- DELIBERATIONS — operational permission seeds
-- Migration: 037_deliberations_operational_perms
-- Date:      2026-07-08
-- Purpose:   Add the granular operational permissions the Decision
--            Control Room UI gates on (edit / request_opinion /
--            attach_evidence / execute / minutes / admin). The core
--            deliberations.* view/create/vote/approve/reject/close/
--            export perms already exist (005). This migration is
--            PURELY ADDITIVE: new permission rows + role grants.
--
-- Rules honored:
--   * Idempotent (single transaction, ON CONFLICT DO NOTHING).
--   * No destructive changes (no DROP, no data deletes).
--   * owner_admin access preserved — re-runs the owner_admin
--     (roles × permissions) grant so it picks up the new keys.
--   * Backward compatible: the UI falls back to deliberations.create
--     when a granular perm is absent, so pre-existing users keep
--     working even before these grants propagate.
-- Dependencies:
--   005_auth_rbac_foundation  (permissions, roles, role_permissions,
--                              owner_admin all-permissions grant idiom)
-- ============================================================

BEGIN;

-- 1) New permission keys ------------------------------------------------
INSERT INTO permissions (key, module, action, description) VALUES
  ('deliberations.edit',            'deliberations', 'edit',            'Editar deliberacoes'),
  ('deliberations.request_opinion', 'deliberations', 'request_opinion','Solicitar pareceres em deliberacoes'),
  ('deliberations.attach_evidence', 'deliberations', 'attach_evidence','Anexar evidencias em deliberacoes'),
  ('deliberations.execute',         'deliberations', 'execute',        'Gerenciar execucao de deliberacoes'),
  ('deliberations.minutes',         'deliberations', 'minutes',        'Gerar/publicar atas de deliberacoes'),
  ('deliberations.admin',           'deliberations', 'admin',          'Administrar o modulo de deliberacoes')
ON CONFLICT (key) DO NOTHING;

-- 2) owner_admin keeps full access (re-run the 005 cross-join grant) ----
WITH all_permissions AS (
  SELECT id FROM permissions
),
owner_role AS (
  SELECT id FROM roles WHERE key = 'owner_admin' AND organization_id IS NULL
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT owner_role.id, all_permissions.id
FROM owner_role, all_permissions
ON CONFLICT DO NOTHING;

-- 3) Grant operational perms to the roles that already vote -------------
--    (ceo_diretoria, financeiro, juridico_contratos, rh, engenharia_pcp
--     all hold deliberations.vote per 005). request_opinion /
--     attach_evidence / execute follow the same collaboration surface.
--    minutes + admin stay narrower (ceo_diretoria only) — tighten or
--    widen per org via the Roles screen.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key = ANY (ARRAY[
  'deliberations.request_opinion',
  'deliberations.attach_evidence',
  'deliberations.execute'
])
WHERE r.organization_id IS NULL
  AND r.key = ANY (ARRAY[
    'ceo_diretoria','financeiro','juridico_contratos','rh','engenharia_pcp'
  ])
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key = ANY (ARRAY[
  'deliberations.edit',
  'deliberations.minutes',
  'deliberations.admin'
])
WHERE r.organization_id IS NULL
  AND r.key = 'ceo_diretoria'
ON CONFLICT DO NOTHING;

COMMIT;

-- ============================================================
-- Verification (staging):
--   1. SELECT key FROM permissions WHERE key LIKE 'deliberations.%'
--      ORDER BY key;  -- must include the 6 new keys.
--   2. As owner_admin: current_user_has_permission('deliberations.admin')
--      -> true.
--   3. As financeiro:  current_user_has_permission('deliberations.execute')
--      -> true;  ...('deliberations.minutes') -> false.
--   4. Re-run this migration -> no error, no duplicate rows.
-- ============================================================
