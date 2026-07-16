-- ============================================================
-- MOBILE — Permission seeds
-- Migration: 051_mobile_perm_seeds
--
-- Data-only, idempotent. Seeds people.geofence_manage (CRUD de cercas
-- por canteiro). O registro de dispositivo e a captura de evidência já
-- são autorizados por people.attendance_use (o próprio colaborador).
--
-- Roles: owner_admin / gestor_projetos / rh / engenharia_pcp.
-- ============================================================
BEGIN;

INSERT INTO public.permissions (key, module, action, description) VALUES
  ('people.geofence_manage', 'people', 'geofence_manage', 'Gerenciar geofences (cercas por canteiro/projeto)')
ON CONFLICT (key) DO NOTHING;

WITH r AS (
  SELECT id FROM public.roles
  WHERE organization_id IS NULL
    AND key IN ('owner_admin','gestor_projetos','rh','engenharia_pcp')
),
p AS (
  SELECT id FROM public.permissions WHERE key = 'people.geofence_manage'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

COMMIT;
