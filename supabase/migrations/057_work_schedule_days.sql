-- ============================================================
-- DIÁRIAS DE CAMPO — Explicit work schedule days (minimal)
-- Migration: 057_work_schedule_days
-- Date:      2026-07-20
-- Purpose:   work_schedule_days — escala explícita por pessoa/data,
--            usada SOMENTE quando a política aplicável tem
--            schedule_mode = 'explicit_required'. Equipes de campo
--            operam em 6x1, 12x36, turnos, domingos e feriados, então
--            alocação + calendário nem sempre bastam. Esta tabela NÃO
--            é um módulo de workforce scheduling: apenas confirma se o
--            colaborador está previsto para trabalhar naquela data, e
--            suporta overrides manuais de inclusão/exclusão (com motivo,
--            autoria e aprovação). Quando a política exige escala e não
--            há registro, a diária fica under_review_missing_schedule
--            (nunca auto-aprovada, nunca bloqueada em definitivo).
-- Dependencies:
--   005_auth_rbac_foundation (helpers, set_updated_at())
--   038_people_allocations (people, current_user_person_id())
--   004_projects_supabase_storage (projects.id TEXT)
--   050_mobile_foundation (project_geofences)
-- NOTE: Idempotent, single transaction, RLS 030-safe.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.work_schedule_days (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  person_id        uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  project_id       text REFERENCES projects(id) ON DELETE CASCADE,
  geofence_id      uuid REFERENCES project_geofences(id) ON DELETE SET NULL,
  work_date        date NOT NULL,
  planned_start    time,
  planned_end      time,
  -- 'planned'   = previsto para trabalhar (inclui inclusão manual)
  -- 'excluded'  = override manual de exclusão (folga/afastamento pontual)
  -- 'cancelled' = registro descartado
  status           text NOT NULL DEFAULT 'planned'
                     CHECK (status IN ('planned','excluded','cancelled')),
  source           text NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('manual','import','override')),
  override_reason  text,
  approved_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at      timestamptz,
  version          integer NOT NULL DEFAULT 1,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- um registro efetivo por pessoa/data (o override substitui o previsto);
-- 'cancelled' fica de fora para preservar histórico sem colidir.
CREATE UNIQUE INDEX IF NOT EXISTS work_schedule_days_person_date_idx
  ON public.work_schedule_days (organization_id, person_id, work_date)
  WHERE status IN ('planned','excluded');

CREATE INDEX IF NOT EXISTS work_schedule_days_period_idx
  ON public.work_schedule_days (organization_id, work_date);
CREATE INDEX IF NOT EXISTS work_schedule_days_project_idx
  ON public.work_schedule_days (organization_id, project_id, work_date);

DROP TRIGGER IF EXISTS trg_work_schedule_days_updated_at ON public.work_schedule_days;
CREATE TRIGGER trg_work_schedule_days_updated_at
BEFORE UPDATE ON public.work_schedule_days
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- Row Level Security
--   View: allowances.view (planejamento) ou dono do registro.
--   Escrita: allowances.manage (Operações/RH) ou admin.
-- ============================================================
ALTER TABLE public.work_schedule_days ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS work_schedule_days_select ON public.work_schedule_days;
CREATE POLICY work_schedule_days_select ON public.work_schedule_days
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('allowances.view')
    OR current_user_has_permission('allowances.manage')
    OR person_id = current_user_person_id()
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS work_schedule_days_insert ON public.work_schedule_days;
CREATE POLICY work_schedule_days_insert ON public.work_schedule_days
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('allowances.manage')
    OR current_user_is_admin()
  )
  AND (created_by IS NULL OR created_by = auth.uid())
);

DROP POLICY IF EXISTS work_schedule_days_update ON public.work_schedule_days;
CREATE POLICY work_schedule_days_update ON public.work_schedule_days
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('allowances.manage')
    OR current_user_is_admin()
  )
)
WITH CHECK (organization_id = current_user_organization_id());

DROP POLICY IF EXISTS work_schedule_days_delete ON public.work_schedule_days;
CREATE POLICY work_schedule_days_delete ON public.work_schedule_days
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('allowances.manage')
    OR current_user_is_admin()
  )
);

COMMIT;

-- ROLLBACK (manual): DROP TABLE IF EXISTS work_schedule_days;
