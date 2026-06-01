-- ============================================================
-- PAYROLL CLOSING — Permission seeds + role grants
-- Migration: 020_payroll_perm_seeds
--
-- Data-only, idempotent (same pattern as 011/012/013). Seeds the payroll
-- closing permissions and grants them to the relevant system roles.
--
-- Roles (system, organization_id IS NULL):
--   owner_admin   → all payroll permissions
--   rh            → close, send, send_sensitive, holerite_access, view_sensitive
--   financeiro    → bank_file_access, view_sensitive (Finance receives bank files)
--   ceo_diretoria → view_sensitive (directors may view aggregate sensitive data)
--
-- Note: directors "receive" board/confidential packages by e-mail when HR
-- explicitly selects them; that is not gated by a DB permission.
-- ============================================================
BEGIN;

-- 1) Seed permissions
INSERT INTO public.permissions (key, module, action, description) VALUES
  ('people.payroll_close',          'people', 'payroll_close',          'Criar e validar fechamento da folha'),
  ('people.payroll_send',           'people', 'payroll_send',           'Enviar fechamento da folha por e-mail'),
  ('people.payroll_send_sensitive', 'people', 'payroll_send_sensitive', 'Enviar anexos sensiveis da folha'),
  ('people.payroll_view_sensitive', 'people', 'payroll_view_sensitive', 'Visualizar dados sensiveis da folha'),
  ('people.payroll_bank_file_access','people','payroll_bank_file_access','Acessar arquivos bancarios/pagamento da folha'),
  ('people.payroll_holerite_access','people', 'payroll_holerite_access','Acessar holerites da folha')
ON CONFLICT (key) DO NOTHING;

-- 2) Grant ALL payroll permissions to owner_admin
WITH owner_role AS (
  SELECT id FROM public.roles WHERE key = 'owner_admin' AND organization_id IS NULL
),
payroll_perms AS (
  SELECT id FROM public.permissions WHERE key IN (
    'people.payroll_close', 'people.payroll_send', 'people.payroll_send_sensitive',
    'people.payroll_view_sensitive', 'people.payroll_bank_file_access', 'people.payroll_holerite_access'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT owner_role.id, payroll_perms.id FROM owner_role, payroll_perms
ON CONFLICT DO NOTHING;

-- 3) Grant to RH
WITH rh_role AS (
  SELECT id FROM public.roles WHERE key = 'rh' AND organization_id IS NULL
),
rh_perms AS (
  SELECT id FROM public.permissions WHERE key IN (
    'people.payroll_close', 'people.payroll_send', 'people.payroll_send_sensitive',
    'people.payroll_holerite_access', 'people.payroll_view_sensitive'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT rh_role.id, rh_perms.id FROM rh_role, rh_perms
ON CONFLICT DO NOTHING;

-- 4) Grant to Financeiro (bank/payment file access + view sensitive)
WITH fin_role AS (
  SELECT id FROM public.roles WHERE key = 'financeiro' AND organization_id IS NULL
),
fin_perms AS (
  SELECT id FROM public.permissions WHERE key IN (
    'people.payroll_bank_file_access', 'people.payroll_view_sensitive'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT fin_role.id, fin_perms.id FROM fin_role, fin_perms
ON CONFLICT DO NOTHING;

-- 5) Grant to CEO / Diretoria (view sensitive aggregate)
WITH ceo_role AS (
  SELECT id FROM public.roles WHERE key = 'ceo_diretoria' AND organization_id IS NULL
),
ceo_perms AS (
  SELECT id FROM public.permissions WHERE key = 'people.payroll_view_sensitive'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT ceo_role.id, ceo_perms.id FROM ceo_role, ceo_perms
ON CONFLICT DO NOTHING;

COMMIT;
