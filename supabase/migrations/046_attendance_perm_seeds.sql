-- ============================================================
-- JORNADA — Attendance permission seeds
-- Migration: 046_attendance_perm_seeds
--
-- Data-only, idempotent. Seeds the people.attendance_* permissions
-- used by migration 045 and grants them to system roles.
--
--   people.attendance_use     -> registrar o próprio ponto
--   people.attendance_view    -> ver jornadas de pessoas/equipe
--   people.attendance_manage  -> corrigir, importar, conciliar
--
-- Roles: owner_admin/rh -> all; gestor_projetos -> view+manage;
--        engenharia_pcp -> use+view; papéis operacionais -> use.
-- ============================================================
BEGIN;

INSERT INTO public.permissions (key, module, action, description) VALUES
  ('people.attendance_use',    'people', 'attendance_use',    'Registrar o proprio ponto (jornada)'),
  ('people.attendance_view',   'people', 'attendance_view',   'Visualizar jornadas e banco de horas'),
  ('people.attendance_manage', 'people', 'attendance_manage', 'Corrigir, importar e conciliar jornadas')
ON CONFLICT (key) DO NOTHING;

-- owner_admin / rh -> full
WITH r AS (
  SELECT id FROM public.roles
  WHERE organization_id IS NULL AND key IN ('owner_admin','rh')
),
p AS (
  SELECT id FROM public.permissions WHERE key IN (
    'people.attendance_use','people.attendance_view','people.attendance_manage'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

-- gestor_projetos -> view + manage
WITH r AS (
  SELECT id FROM public.roles WHERE key = 'gestor_projetos' AND organization_id IS NULL
),
p AS (
  SELECT id FROM public.permissions WHERE key IN (
    'people.attendance_view','people.attendance_manage'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

-- engenharia_pcp -> use + view
WITH r AS (
  SELECT id FROM public.roles WHERE key = 'engenharia_pcp' AND organization_id IS NULL
),
p AS (
  SELECT id FROM public.permissions WHERE key IN (
    'people.attendance_use','people.attendance_view'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

-- juridico_contratos / financeiro -> use (own journey)
WITH r AS (
  SELECT id FROM public.roles
  WHERE organization_id IS NULL AND key IN ('juridico_contratos','financeiro')
),
p AS (
  SELECT id FROM public.permissions WHERE key = 'people.attendance_use'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

COMMIT;
