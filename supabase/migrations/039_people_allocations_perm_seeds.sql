-- ============================================================
-- PESSOAS & PROJETOS — People/allocation permission seeds
-- Migration: 039_people_allocations_perm_seeds
--
-- Data-only, idempotent (same pattern as 033). Seeds the people.*
-- permissions used by the allocation foundation (migration 038)
-- and grants them to the relevant system roles.
--
-- Roles (system, organization_id IS NULL):
--   owner_admin        -> all
--   rh                 -> manage + allocations view/manage + cost_view
--   gestor_projetos    -> allocations view/manage
--   ceo_diretoria      -> allocations view + cost_view
--   financeiro         -> allocations view + cost_view
--   engenharia_pcp     -> allocations view
-- ============================================================
BEGIN;

-- 1) Seed permissions
INSERT INTO public.permissions (key, module, action, description) VALUES
  ('people.manage',             'people', 'manage',             'Gerenciar cadastro de pessoas (colaboradores)'),
  ('people.allocations_view',   'people', 'allocations_view',   'Visualizar alocacoes e capacidade'),
  ('people.allocations_manage', 'people', 'allocations_manage', 'Criar e alterar alocacoes em projetos'),
  ('people.cost_view',          'people', 'cost_view',          'Ver custo individual (custo-hora / custo carregado)')
ON CONFLICT (key) DO NOTHING;

-- 2) owner_admin -> all
WITH r AS (
  SELECT id FROM public.roles WHERE key = 'owner_admin' AND organization_id IS NULL
),
p AS (
  SELECT id FROM public.permissions WHERE key IN (
    'people.manage','people.allocations_view','people.allocations_manage','people.cost_view'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

-- 3) rh -> full people operation
WITH r AS (
  SELECT id FROM public.roles WHERE key = 'rh' AND organization_id IS NULL
),
p AS (
  SELECT id FROM public.permissions WHERE key IN (
    'people.manage','people.allocations_view','people.allocations_manage','people.cost_view'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

-- 4) gestor_projetos -> allocations operation (no individual cost)
WITH r AS (
  SELECT id FROM public.roles WHERE key = 'gestor_projetos' AND organization_id IS NULL
),
p AS (
  SELECT id FROM public.permissions WHERE key IN (
    'people.allocations_view','people.allocations_manage'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

-- 5) ceo_diretoria / financeiro -> view + individual cost
WITH r AS (
  SELECT id FROM public.roles
  WHERE organization_id IS NULL AND key IN ('ceo_diretoria','financeiro')
),
p AS (
  SELECT id FROM public.permissions WHERE key IN (
    'people.allocations_view','people.cost_view'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

-- 6) engenharia_pcp -> read allocations
WITH r AS (
  SELECT id FROM public.roles WHERE key = 'engenharia_pcp' AND organization_id IS NULL
),
p AS (
  SELECT id FROM public.permissions WHERE key IN ('people.allocations_view')
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

COMMIT;
