-- ============================================================
-- CUSTO DE MÃO DE OBRA — Employee cost snapshot + project labor cost
-- Migration: 043_labor_cost
-- Date:      2026-07-15
-- Purpose:   Fase 6 (spec §8, §21, §25B-D1/D4):
--            1) employee_cost_snapshots — loaded monthly cost and
--               loaded hourly cost per person per competence, frozen
--               (ADR-006). Source = payroll batch; components rateados.
--            2) project_labor_cost_periods — consolidated planned vs
--               estimated-actual vs reconciled cost per project/person/
--               competence, with variance (basis for project margin, D1).
--            Enables populating time_entries.hourly_cost_cents/cost_cents
--            and the auditable estimated×real reconciliation (D4).
-- Dependencies:
--   005 (helpers, set_updated_at()), 004 (projects.id TEXT)
--   017 (payroll_closing_batches, payroll_employee_lines)
--   022 (finance_cost_centers)
--   038 (people, project_allocations), 041 (time_entries)
--   044_labor_cost_perm_seeds (RBAC — data only)
-- NOTE: Idempotent, single transaction, RLS 030-safe (no self-SELECT).
--       Cost is a competence SNAPSHOT: never mutate a frozen row, add a
--       new version instead (handled in the service).
-- ============================================================

BEGIN;

-- ============================================================
-- 1) employee_cost_snapshots — loaded cost per person/competence
-- ============================================================
CREATE TABLE IF NOT EXISTS public.employee_cost_snapshots (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  person_id                  uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  competence_month           char(7) NOT NULL,          -- YYYY-MM

  -- loaded cost components (cents)
  salary_cents               bigint NOT NULL DEFAULT 0,
  payroll_taxes_cents        bigint NOT NULL DEFAULT 0,   -- encargos
  benefits_cents             bigint NOT NULL DEFAULT 0,
  provisions_cents           bigint NOT NULL DEFAULT 0,   -- 13º, férias provisionadas
  other_costs_cents          bigint NOT NULL DEFAULT 0,
  loaded_monthly_cost_cents  bigint NOT NULL DEFAULT 0,   -- soma dos componentes

  -- capacity + derived hourly cost
  productive_capacity_hours  numeric(8,2) NOT NULL DEFAULT 0,
  loaded_hourly_cost_cents   bigint NOT NULL DEFAULT 0,   -- loaded ÷ capacity

  source                     text NOT NULL DEFAULT 'estimated'
                               CHECK (source IN ('estimated','payroll','manual')),
  source_payroll_batch_id    uuid REFERENCES payroll_closing_batches(id) ON DELETE SET NULL,
  status                     text NOT NULL DEFAULT 'estimated'
                               CHECK (status IN ('estimated','processed','reconciled','superseded')),
  -- versioning: a reopened competence creates a new row and marks the
  -- previous 'superseded' (history preserved, ADR-005/006).
  version                    int NOT NULL DEFAULT 1,
  supersedes_id              uuid REFERENCES employee_cost_snapshots(id) ON DELETE SET NULL,
  notes                      text,
  created_by                 uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

-- one active snapshot per person/competence (superseded excluded)
CREATE UNIQUE INDEX IF NOT EXISTS ecs_active_unique_idx
  ON public.employee_cost_snapshots (organization_id, person_id, competence_month)
  WHERE status <> 'superseded';

CREATE INDEX IF NOT EXISTS ecs_org_comp_idx
  ON public.employee_cost_snapshots (organization_id, competence_month);
CREATE INDEX IF NOT EXISTS ecs_person_idx
  ON public.employee_cost_snapshots (organization_id, person_id, competence_month);

DROP TRIGGER IF EXISTS trg_ecs_updated_at ON public.employee_cost_snapshots;
CREATE TRIGGER trg_ecs_updated_at
BEFORE UPDATE ON public.employee_cost_snapshots
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 2) project_labor_cost_periods — consolidated per project/person/month
-- ============================================================
CREATE TABLE IF NOT EXISTS public.project_labor_cost_periods (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id                  text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  person_id                   uuid REFERENCES people(id) ON DELETE SET NULL,
  competence_month            char(7) NOT NULL,

  planned_hours               numeric(10,2) NOT NULL DEFAULT 0,
  approved_hours              numeric(10,2) NOT NULL DEFAULT 0,

  planned_cost_cents          bigint NOT NULL DEFAULT 0,   -- % × loaded cost
  estimated_actual_cost_cents bigint NOT NULL DEFAULT 0,   -- approved h × estimated hourly
  reconciled_actual_cost_cents bigint NOT NULL DEFAULT 0,  -- approved h × real hourly (pós-folha)

  variance_amount_cents       bigint NOT NULL DEFAULT 0,   -- reconciled − planned
  variance_percentage         numeric(12,2),

  status                      text NOT NULL DEFAULT 'open'
                                CHECK (status IN ('open','estimated','payroll_processed','reconciled','locked')),
  employee_cost_snapshot_id   uuid REFERENCES employee_cost_snapshots(id) ON DELETE SET NULL,
  computed_at                 timestamptz,
  created_by                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS plcp_unique_idx
  ON public.project_labor_cost_periods (organization_id, project_id, person_id, competence_month);
CREATE INDEX IF NOT EXISTS plcp_project_comp_idx
  ON public.project_labor_cost_periods (organization_id, project_id, competence_month);

DROP TRIGGER IF EXISTS trg_plcp_updated_at ON public.project_labor_cost_periods;
CREATE TRIGGER trg_plcp_updated_at
BEFORE UPDATE ON public.project_labor_cost_periods
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 3) Row Level Security
--    Cost is sensitive: read requires people.cost_view (or admin);
--    writes require people.cost_manage. No self-SELECT (030-safe).
-- ============================================================
ALTER TABLE public.employee_cost_snapshots     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_labor_cost_periods  ENABLE ROW LEVEL SECURITY;

-- ---------- employee_cost_snapshots ----------
DROP POLICY IF EXISTS ecs_select ON public.employee_cost_snapshots;
CREATE POLICY ecs_select ON public.employee_cost_snapshots
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('people.cost_view') OR current_user_is_admin())
);

DROP POLICY IF EXISTS ecs_insert ON public.employee_cost_snapshots;
CREATE POLICY ecs_insert ON public.employee_cost_snapshots
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('people.cost_manage') OR current_user_is_admin())
  AND (created_by IS NULL OR created_by = auth.uid())
);

DROP POLICY IF EXISTS ecs_update ON public.employee_cost_snapshots;
CREATE POLICY ecs_update ON public.employee_cost_snapshots
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('people.cost_manage') OR current_user_is_admin())
)
WITH CHECK (organization_id = current_user_organization_id());

DROP POLICY IF EXISTS ecs_delete ON public.employee_cost_snapshots;
CREATE POLICY ecs_delete ON public.employee_cost_snapshots
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('people.cost_manage') OR current_user_is_admin())
);

-- ---------- project_labor_cost_periods ----------
-- Read allowed to project viewers too, but the SERVICE masks cost
-- values unless people.cost_view; hours/variance% are non-sensitive.
DROP POLICY IF EXISTS plcp_select ON public.project_labor_cost_periods;
CREATE POLICY plcp_select ON public.project_labor_cost_periods
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('people.cost_view')
    OR current_user_has_permission('people.allocations_view')
    OR current_user_has_permission('projects.view')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS plcp_insert ON public.project_labor_cost_periods;
CREATE POLICY plcp_insert ON public.project_labor_cost_periods
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('people.cost_manage') OR current_user_is_admin())
  AND (created_by IS NULL OR created_by = auth.uid())
);

DROP POLICY IF EXISTS plcp_update ON public.project_labor_cost_periods;
CREATE POLICY plcp_update ON public.project_labor_cost_periods
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('people.cost_manage') OR current_user_is_admin())
)
WITH CHECK (organization_id = current_user_organization_id());

DROP POLICY IF EXISTS plcp_delete ON public.project_labor_cost_periods;
CREATE POLICY plcp_delete ON public.project_labor_cost_periods
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('people.cost_manage') OR current_user_is_admin())
);

COMMIT;

-- ============================================================
-- Manual verification checklist (staging)
--   1. Re-run -> no-op.
--   2. User without people.cost_view: SELECT employee_cost_snapshots -> 0 rows.
--   3. Two active snapshots for same person/competence -> unique violation.
--   4. Reopen: insert v2 with supersedes_id, mark v1 'superseded' -> both coexist.
--
-- ROLLBACK (manual):
--   DROP TABLE IF EXISTS project_labor_cost_periods;
--   DROP TABLE IF EXISTS employee_cost_snapshots;
-- ============================================================
