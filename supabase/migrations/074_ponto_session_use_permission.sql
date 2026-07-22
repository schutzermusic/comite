-- ============================================================
-- INSIGHT PONTO — dedicated least-privilege permission for apontamento
-- Migration: 074_ponto_session_use_permission
--
-- A 073 concedeu `people.timesheet_use` ao ponto_field_worker para permitir
-- o apontamento (project_work_sessions). Mas essa permissão é AMPLA DEMAIS:
-- ela também libera o módulo de timesheet manual (time_entries — insert/
-- update/delete/select da própria pessoa). O colaborador de campo NÃO deve
-- criar/editar lançamentos manuais de horas.
--
-- Esta migração cria a permissão MÍNIMA `people.ponto_session_use`, que
-- desbloqueia SOMENTE a sessão de trabalho própria (start/stop do ponto,
-- com projeto + etapa do cronograma). Adiciona-a como alternativa nas
-- policies de project_work_sessions e TROCA na role (remove timesheet_use).
-- time_entries permanece inacessível ao colaborador de campo. RLS/tenant
-- inalterados (ownership por current_user_person_id()).
-- ============================================================
BEGIN;

-- 1) catálogo de permissão
INSERT INTO public.permissions (key, module, action, description) VALUES
  ('people.ponto_session_use', 'people', 'ponto_session_use',
   'Registrar a própria sessão de trabalho do ponto (apontamento em projeto/etapa)')
ON CONFLICT (key) DO NOTHING;

-- 2) policies de project_work_sessions: aceitam timesheet_use OU ponto_session_use
DROP POLICY IF EXISTS work_sessions_insert ON public.project_work_sessions;
CREATE POLICY work_sessions_insert ON public.project_work_sessions
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
       (person_id = current_user_person_id()
        AND (current_user_has_permission('people.timesheet_use')
             OR current_user_has_permission('people.ponto_session_use')))
    OR (source = 'manager_adjustment'
        AND current_user_has_permission('people.timesheet_approve'))
    OR current_user_is_admin()
  )
  AND (created_by IS NULL OR created_by = auth.uid())
);

DROP POLICY IF EXISTS work_sessions_update ON public.project_work_sessions;
CREATE POLICY work_sessions_update ON public.project_work_sessions
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       (person_id = current_user_person_id()
        AND status IN ('running','draft')
        AND (current_user_has_permission('people.timesheet_use')
             OR current_user_has_permission('people.ponto_session_use')))
    OR current_user_has_permission('people.timesheet_approve')
    OR current_user_is_admin()
  )
)
WITH CHECK (organization_id = current_user_organization_id());

-- (SELECT da própria sessão já é permitido por ownership, sem permissão.
--  DELETE permanece restrito a timesheet_use/admin — o ponto não apaga.)

-- 3) troca na role de campo: concede ponto_session_use, remove timesheet_use
WITH r AS (
  SELECT id FROM public.roles WHERE key = 'ponto_field_worker' AND organization_id IS NULL
),
p AS (
  SELECT id FROM public.permissions WHERE key = 'people.ponto_session_use'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

DELETE FROM public.role_permissions
WHERE role_id = (SELECT id FROM public.roles WHERE key='ponto_field_worker' AND organization_id IS NULL)
  AND permission_id = (SELECT id FROM public.permissions WHERE key='people.timesheet_use');

-- 4) donos/admin (catálogo) — admins já passam por current_user_is_admin(),
--    mas mantemos a concessão explícita para consistência.
WITH r AS (
  SELECT id FROM public.roles WHERE organization_id IS NULL AND key IN ('owner_admin','rh')
),
p AS (
  SELECT id FROM public.permissions WHERE key = 'people.ponto_session_use'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

COMMIT;

-- ============================================================
-- Rollback (manual): reverter para a 073 (timesheet_use na role) e restaurar
-- as policies originais da 041; DELETE da permissão ponto_session_use.
-- ============================================================
