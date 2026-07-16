-- ============================================================
-- PESSOAS & PROJETOS — Timesheet permission seeds
-- Migration: 042_timesheet_perm_seeds
--
-- Data-only, idempotent (same pattern as 033/039). Seeds the
-- people.timesheet_* permissions used by migration 041 and grants
-- them to the relevant system roles.
--
-- Roles (system, organization_id IS NULL):
--   owner_admin        -> all
--   gestor_projetos    -> use + view + approve
--   rh                 -> use + view + approve
--   engenharia_pcp     -> use + view
--   ceo_diretoria      -> view
--   financeiro         -> view
--   juridico_contratos -> use (own hours)
-- ============================================================
BEGIN;

-- 1) Seed permissions
INSERT INTO public.permissions (key, module, action, description) VALUES
  ('people.timesheet_use',     'people', 'timesheet_use',     'Apontar as proprias horas (timer e entrada manual)'),
  ('people.timesheet_view',    'people', 'timesheet_view',    'Visualizar apontamentos de pessoas e projetos'),
  ('people.timesheet_approve', 'people', 'timesheet_approve', 'Aprovar, rejeitar e travar apontamentos')
ON CONFLICT (key) DO NOTHING;

-- 2) owner_admin -> all
WITH r AS (
  SELECT id FROM public.roles WHERE key = 'owner_admin' AND organization_id IS NULL
),
p AS (
  SELECT id FROM public.permissions WHERE key IN (
    'people.timesheet_use','people.timesheet_view','people.timesheet_approve'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

-- 3) gestor_projetos / rh -> full timesheet operation
WITH r AS (
  SELECT id FROM public.roles
  WHERE organization_id IS NULL AND key IN ('gestor_projetos','rh')
),
p AS (
  SELECT id FROM public.permissions WHERE key IN (
    'people.timesheet_use','people.timesheet_view','people.timesheet_approve'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

-- 4) engenharia_pcp -> use + view
WITH r AS (
  SELECT id FROM public.roles WHERE key = 'engenharia_pcp' AND organization_id IS NULL
),
p AS (
  SELECT id FROM public.permissions WHERE key IN (
    'people.timesheet_use','people.timesheet_view'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

-- 5) ceo_diretoria / financeiro -> read
WITH r AS (
  SELECT id FROM public.roles
  WHERE organization_id IS NULL AND key IN ('ceo_diretoria','financeiro')
),
p AS (
  SELECT id FROM public.permissions WHERE key IN ('people.timesheet_view')
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

-- 6) juridico_contratos -> own hours
WITH r AS (
  SELECT id FROM public.roles WHERE key = 'juridico_contratos' AND organization_id IS NULL
),
p AS (
  SELECT id FROM public.permissions WHERE key IN ('people.timesheet_use')
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

COMMIT;
