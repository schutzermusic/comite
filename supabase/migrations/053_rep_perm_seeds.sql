-- ============================================================
-- PONTO OFICIAL (REP-P) — Permission seeds
-- Migration: 053_rep_perm_seeds
--
-- Data-only, idempotente. people.rep_manage governa o módulo de
-- ponto oficial: configurar empregador, gerar AFD/espelho/comprovante
-- e consultar a trilha de exportações fiscais.
--
-- Roles: owner_admin / rh -> manage. (Leitura de settings também é
-- permitida a quem tem attendance_view — política na migration 052.)
-- ============================================================
BEGIN;

INSERT INTO public.permissions (key, module, action, description) VALUES
  ('people.rep_manage', 'people', 'rep_manage', 'Ponto oficial (REP-P): configurar e gerar arquivos fiscais')
ON CONFLICT (key) DO NOTHING;

WITH r AS (
  SELECT id FROM public.roles
  WHERE organization_id IS NULL AND key IN ('owner_admin','rh')
),
p AS (
  SELECT id FROM public.permissions WHERE key = 'people.rep_manage'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

COMMIT;
