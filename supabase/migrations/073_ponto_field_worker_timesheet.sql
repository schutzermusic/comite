-- ============================================================
-- INSIGHT PONTO — field worker can record own apontamento
-- Migration: 073_ponto_field_worker_timesheet
--
-- O fluxo de ponto (entrada + etapa do cronograma) INICIA uma sessão de
-- trabalho (project_work_sessions) — o apontamento. A política de insert
-- (041) exige `people.timesheet_use` para a sessão própria. A role
-- `ponto_field_worker` só tinha `people.attendance_use`, então o
-- colaborador conseguia bater o ponto mas NÃO iniciar o apontamento
-- (RLS negava). Concedemos `people.timesheet_use` (própria jornada) — ambas
-- as permissões são self-scoped (menor privilégio preservado).
-- ============================================================
BEGIN;

WITH r AS (
  SELECT id FROM public.roles WHERE key = 'ponto_field_worker' AND organization_id IS NULL
),
p AS (
  SELECT id FROM public.permissions WHERE key = 'people.timesheet_use'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

COMMIT;

-- ============================================================
-- Rollback (manual):
--   DELETE FROM role_permissions
--   WHERE role_id = (SELECT id FROM roles WHERE key='ponto_field_worker' AND organization_id IS NULL)
--     AND permission_id = (SELECT id FROM permissions WHERE key='people.timesheet_use');
-- ============================================================
