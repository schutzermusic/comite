-- ============================================================
-- GOVERNANÇA — Permission seeds
-- Migration: 048_governance_perm_seeds
--
-- Data-only, idempotent. Seeds the people.governance_* permissions
-- used by migration 047 and grants them to system roles.
--
--   people.governance_view    -> ver exceções operacionais
--   people.governance_manage  -> executar scan, analisar, resolver
--
-- Roles: owner_admin/ceo_diretoria -> view+manage; financeiro/rh ->
--        view+manage; gestor_projetos -> view; engenharia_pcp -> view.
-- ============================================================
BEGIN;

INSERT INTO public.permissions (key, module, action, description) VALUES
  ('people.governance_view',   'people', 'governance_view',   'Visualizar exceptions de governanca (alocacao/jornada/custo)'),
  ('people.governance_manage', 'people', 'governance_manage', 'Executar scan, analisar e resolver exceptions')
ON CONFLICT (key) DO NOTHING;

-- owner_admin / ceo_diretoria / financeiro / rh -> view + manage
WITH r AS (
  SELECT id FROM public.roles
  WHERE organization_id IS NULL
    AND key IN ('owner_admin','ceo_diretoria','financeiro','rh')
),
p AS (
  SELECT id FROM public.permissions WHERE key IN (
    'people.governance_view','people.governance_manage'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

-- gestor_projetos / engenharia_pcp -> view only
WITH r AS (
  SELECT id FROM public.roles
  WHERE organization_id IS NULL AND key IN ('gestor_projetos','engenharia_pcp')
),
p AS (
  SELECT id FROM public.permissions WHERE key = 'people.governance_view'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

COMMIT;
