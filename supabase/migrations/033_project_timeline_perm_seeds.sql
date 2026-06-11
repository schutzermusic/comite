-- ============================================================
-- PROJETOS — Timeline/Documents permission seeds + role grants
-- Migration: 033_project_timeline_perm_seeds
--
-- Data-only, idempotent (same pattern as 013/020/027). Seeds the
-- projects.timeline.* and projects.documents.* permissions used by
-- the new enterprise timeline (migration 032) and grants them to
-- the relevant system roles.
--
-- Roles (system, organization_id IS NULL):
--   owner_admin        -> all
--   gestor_projetos    -> timeline view/edit/import/assign/delay_update + documents.*
--   engenharia_pcp     -> timeline view/edit/delay_update + documents.*
--   ceo_diretoria      -> timeline view + admin (oversight) + documents.view
--   financeiro         -> timeline.view
--   juridico_contratos -> timeline.view + documents.view
-- ============================================================
BEGIN;

-- 1) Seed permissions
INSERT INTO public.permissions (key, module, action, description) VALUES
  ('projects.timeline.view',         'projects', 'timeline.view',         'Visualizar cronograma (timeline/Gantt) dos projetos'),
  ('projects.timeline.edit',         'projects', 'timeline.edit',         'Editar atividades do cronograma'),
  ('projects.timeline.import',       'projects', 'timeline.import',       'Importar cronograma (MS Project PDF)'),
  ('projects.timeline.assign',       'projects', 'timeline.assign',       'Atribuir responsável e equipe de execução'),
  ('projects.timeline.delay_update', 'projects', 'timeline.delay_update', 'Registrar e atualizar atrasos de atividades'),
  ('projects.timeline.admin',        'projects', 'timeline.admin',        'Administrar cronogramas de todos os projetos'),
  ('projects.documents.view',        'projects', 'documents.view',        'Visualizar documentos do projeto'),
  ('projects.documents.upload',      'projects', 'documents.upload',      'Enviar documentos do projeto')
ON CONFLICT (key) DO NOTHING;

-- 2) owner_admin -> all
WITH owner_role AS (
  SELECT id FROM public.roles WHERE key = 'owner_admin' AND organization_id IS NULL
),
perms AS (
  SELECT id FROM public.permissions WHERE key IN (
    'projects.timeline.view','projects.timeline.edit','projects.timeline.import',
    'projects.timeline.assign','projects.timeline.delay_update','projects.timeline.admin',
    'projects.documents.view','projects.documents.upload'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT owner_role.id, perms.id FROM owner_role, perms
ON CONFLICT DO NOTHING;

-- 3) gestor_projetos -> operação completa do cronograma + documentos
WITH r AS (
  SELECT id FROM public.roles WHERE key = 'gestor_projetos' AND organization_id IS NULL
),
p AS (
  SELECT id FROM public.permissions WHERE key IN (
    'projects.timeline.view','projects.timeline.edit','projects.timeline.import',
    'projects.timeline.assign','projects.timeline.delay_update',
    'projects.documents.view','projects.documents.upload'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

-- 4) engenharia_pcp -> executa/atualiza cronograma + documentos
WITH r AS (
  SELECT id FROM public.roles WHERE key = 'engenharia_pcp' AND organization_id IS NULL
),
p AS (
  SELECT id FROM public.permissions WHERE key IN (
    'projects.timeline.view','projects.timeline.edit','projects.timeline.delay_update',
    'projects.documents.view','projects.documents.upload'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

-- 5) ceo_diretoria -> visão + administração (oversight) + documentos
WITH r AS (
  SELECT id FROM public.roles WHERE key = 'ceo_diretoria' AND organization_id IS NULL
),
p AS (
  SELECT id FROM public.permissions WHERE key IN (
    'projects.timeline.view','projects.timeline.admin','projects.documents.view'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

-- 6) financeiro / juridico_contratos -> leitura
WITH r AS (
  SELECT id FROM public.roles
  WHERE organization_id IS NULL AND key IN ('financeiro','juridico_contratos')
),
p AS (
  SELECT id FROM public.permissions WHERE key IN (
    'projects.timeline.view','projects.documents.view'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

COMMIT;
