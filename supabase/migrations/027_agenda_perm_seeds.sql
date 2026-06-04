-- ============================================================
-- AGENDA & TAREFAS — Permission seeds + role grants
-- Migration: 027_agenda_perm_seeds
--
-- Data-only, idempotent (same pattern as 013/020). Seeds the new
-- tasks.* permissions and grants them to the relevant system roles.
-- The meetings.* permissions already exist (migration 005) and are
-- reused as-is by the calendar/meeting flows.
--
-- Roles (system, organization_id IS NULL):
--   owner_admin        -> all tasks.* permissions
--   gestor_projetos    -> view/create/assign/edit/complete (PMs delegate work)
--   ceo_diretoria      -> view/create/assign/edit/complete + admin (oversight)
--   financeiro         -> view/create/assign/edit/complete
--   rh                 -> view/create/assign/edit/complete
--   juridico_contratos -> view/create/assign/edit/complete
--   engenharia_pcp     -> view/create/assign/edit/complete
-- ============================================================
BEGIN;

-- 1) Seed permissions
INSERT INTO public.permissions (key, module, action, description) VALUES
  ('tasks.view',     'tasks', 'view',     'Visualizar tarefas'),
  ('tasks.create',   'tasks', 'create',   'Criar tarefas'),
  ('tasks.assign',   'tasks', 'assign',   'Atribuir tarefas a outros usuários'),
  ('tasks.edit',     'tasks', 'edit',     'Editar tarefas'),
  ('tasks.complete', 'tasks', 'complete', 'Concluir tarefas'),
  ('tasks.admin',    'tasks', 'admin',    'Administrar todas as tarefas da organização')
ON CONFLICT (key) DO NOTHING;

-- 2) Grant ALL tasks permissions to owner_admin
WITH owner_role AS (
  SELECT id FROM public.roles WHERE key = 'owner_admin' AND organization_id IS NULL
),
task_perms AS (
  SELECT id FROM public.permissions WHERE key IN (
    'tasks.view','tasks.create','tasks.assign','tasks.edit','tasks.complete','tasks.admin'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT owner_role.id, task_perms.id FROM owner_role, task_perms
ON CONFLICT DO NOTHING;

-- 3) Grant view/create/assign/edit/complete to the operational roles
WITH base_perms AS (
  SELECT id FROM public.permissions WHERE key IN (
    'tasks.view','tasks.create','tasks.assign','tasks.edit','tasks.complete'
  )
),
target_roles AS (
  SELECT id FROM public.roles
  WHERE organization_id IS NULL
    AND key IN ('gestor_projetos','ceo_diretoria','financeiro','rh','juridico_contratos','engenharia_pcp')
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT target_roles.id, base_perms.id FROM target_roles, base_perms
ON CONFLICT DO NOTHING;

-- 4) ceo_diretoria also gets tasks.admin (org-wide oversight)
WITH ceo_role AS (
  SELECT id FROM public.roles WHERE key = 'ceo_diretoria' AND organization_id IS NULL
),
admin_perm AS (
  SELECT id FROM public.permissions WHERE key = 'tasks.admin'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT ceo_role.id, admin_perm.id FROM ceo_role, admin_perm
ON CONFLICT DO NOTHING;

COMMIT;
