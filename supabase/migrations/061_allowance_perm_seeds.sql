-- ============================================================
-- DIÁRIAS DE CAMPO — Allowance permission seeds
-- Migration: 061_allowance_perm_seeds
--
-- Data-only, idempotent (mesmo padrão de 039/044/051). Semeia as
-- permissões allowances.* usadas pelas tabelas do módulo (056–060) e
-- concede aos papéis de sistema, respeitando segregação de funções:
--   quem revisa exceção (gestor) não aprova o lote (Financeiro);
--   quem valida ausência (RH) não aprova o lote financeiro.
--
-- Papéis (sistema, organization_id IS NULL):
--   owner_admin      -> todas
--   rh               -> view + manage + hr_validate
--   gestor_projetos  -> view + review_exception
--   financeiro       -> view + finance_approve + policy_manage
--   ceo_diretoria    -> view
--   engenharia_pcp   -> view
-- ============================================================
BEGIN;

-- 1) Seed permissions
INSERT INTO public.permissions (key, module, action, description) VALUES
  ('allowances.view',              'allowances', 'view',              'Visualizar diárias de campo, prévias e lotes'),
  ('allowances.manage',            'allowances', 'manage',            'Gerar prévia semanal e editar diárias'),
  ('allowances.review_exception',  'allowances', 'review_exception',  'Revisar exceções de diárias (gestor da obra)'),
  ('allowances.hr_validate',       'allowances', 'hr_validate',       'Validar vínculo, férias e afastamentos (RH)'),
  ('allowances.finance_approve',   'allowances', 'finance_approve',   'Aprovar e fechar o lote semanal (Financeiro)'),
  ('allowances.policy_manage',     'allowances', 'policy_manage',     'Configurar políticas de diária'),
  ('allowances.adjustment_manage', 'allowances', 'adjustment_manage', 'Criar e aprovar ajustes/compensações de diárias')
ON CONFLICT (key) DO NOTHING;

-- 2) owner_admin -> todas
WITH r AS (
  SELECT id FROM public.roles WHERE key = 'owner_admin' AND organization_id IS NULL
),
p AS (
  SELECT id FROM public.permissions WHERE key IN (
    'allowances.view','allowances.manage','allowances.review_exception',
    'allowances.hr_validate','allowances.finance_approve',
    'allowances.policy_manage','allowances.adjustment_manage'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

-- 3) rh -> operação + validação (não aprova o lote financeiro)
WITH r AS (
  SELECT id FROM public.roles WHERE key = 'rh' AND organization_id IS NULL
),
p AS (
  SELECT id FROM public.permissions WHERE key IN (
    'allowances.view','allowances.manage','allowances.hr_validate','allowances.adjustment_manage'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

-- 4) gestor_projetos -> revisa exceções (não aprova o lote)
WITH r AS (
  SELECT id FROM public.roles WHERE key = 'gestor_projetos' AND organization_id IS NULL
),
p AS (
  SELECT id FROM public.permissions WHERE key IN (
    'allowances.view','allowances.review_exception'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

-- 5) financeiro -> aprova lote + configura política (não gera a prévia)
WITH r AS (
  SELECT id FROM public.roles WHERE key = 'financeiro' AND organization_id IS NULL
),
p AS (
  SELECT id FROM public.permissions WHERE key IN (
    'allowances.view','allowances.finance_approve','allowances.policy_manage','allowances.adjustment_manage'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

-- 6) ceo_diretoria / engenharia_pcp -> leitura
WITH r AS (
  SELECT id FROM public.roles
  WHERE organization_id IS NULL AND key IN ('ceo_diretoria','engenharia_pcp')
),
p AS (
  SELECT id FROM public.permissions WHERE key IN ('allowances.view')
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

COMMIT;
