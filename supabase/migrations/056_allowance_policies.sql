-- ============================================================
-- DIÁRIAS DE CAMPO — Allowance policies (configurable rules)
-- Migration: 056_allowance_policies
-- Date:      2026-07-20
-- Purpose:   allowance_policies — regra configurável de diária
--            (valor, projeto/geofence, exigências, schedule_mode).
--            As regras NÃO ficam hardcoded (ADR-005): cada contrato/
--            obra pode ter valor e exigências diferentes. Uma diária
--            só é "prevista" quando existe uma política aplicável.
--            Obra = project_geofences (migration 050): não há tabela
--            worksites; a política referencia project_id + geofence.
-- Dependencies:
--   005_auth_rbac_foundation (helpers, set_updated_at())
--   004_projects_supabase_storage (projects.id TEXT)
--   050_mobile_foundation (project_geofences)
--   061_allowance_perm_seeds (RBAC — data only)
-- NOTE: Idempotent, single transaction, RLS 030-safe (no
--       self-SELECT in policies). Sem motor de aprovação genérico —
--       mesmo padrão de project_allocations/contract_approvals.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.allowance_policies (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name                  text NOT NULL,
  allowance_type        text NOT NULL DEFAULT 'meal'
                          CHECK (allowance_type IN ('meal')),
  -- escopo: quando project_id é NULL, a política é um fallback da org;
  -- quando definido, aplica-se ao projeto (e opcionalmente à obra/cerca).
  project_id            text REFERENCES projects(id) ON DELETE CASCADE,
  geofence_id           uuid REFERENCES project_geofences(id) ON DELETE SET NULL,

  amount_cents          bigint NOT NULL CHECK (amount_cents > 0),
  currency              text NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),

  effective_from        date NOT NULL,
  effective_until       date CHECK (effective_until IS NULL OR effective_until >= effective_from),

  -- exigências de elegibilidade (planejamento)
  active_employment_required   boolean NOT NULL DEFAULT true,
  active_allocation_required   boolean NOT NULL DEFAULT true,
  block_on_leave               boolean NOT NULL DEFAULT true,
  block_on_demobilization      boolean NOT NULL DEFAULT true,

  -- escala configurável (decisão de arquitetura):
  --   derived            -> alocação ativa + calendário operacional
  --   explicit_required  -> exige work_schedule_days por pessoa/data
  --   not_required       -> política excepcional, sem exigência de escala
  schedule_mode         text NOT NULL DEFAULT 'derived'
                          CHECK (schedule_mode IN ('derived','explicit_required','not_required')),

  -- exigências de conciliação (fases posteriores)
  attendance_required_for_reconciliation boolean NOT NULL DEFAULT true,
  geofence_required_for_reconciliation   boolean NOT NULL DEFAULT true,
  geofence_tolerance_meters              integer
                          CHECK (geofence_tolerance_meters IS NULL OR geofence_tolerance_meters >= 0),

  auto_approval_enabled boolean NOT NULL DEFAULT true,

  status                text NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','active','inactive')),
  notes                 text,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS allowance_policies_org_status_idx
  ON public.allowance_policies (organization_id, status);
CREATE INDEX IF NOT EXISTS allowance_policies_org_project_idx
  ON public.allowance_policies (organization_id, project_id, status);
-- resolução por vigência
CREATE INDEX IF NOT EXISTS allowance_policies_effective_idx
  ON public.allowance_policies (organization_id, effective_from, effective_until);

DROP TRIGGER IF EXISTS trg_allowance_policies_updated_at ON public.allowance_policies;
CREATE TRIGGER trg_allowance_policies_updated_at
BEFORE UPDATE ON public.allowance_policies
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- Row Level Security
--   View: allowances.view | allowances.policy_manage.
--   Escrita: allowances.policy_manage (Financeiro/Admin).
--   Sem self-SELECT (030-safe).
-- ============================================================
ALTER TABLE public.allowance_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allowance_policies_select ON public.allowance_policies;
CREATE POLICY allowance_policies_select ON public.allowance_policies
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('allowances.view')
    OR current_user_has_permission('allowances.policy_manage')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS allowance_policies_insert ON public.allowance_policies;
CREATE POLICY allowance_policies_insert ON public.allowance_policies
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('allowances.policy_manage')
    OR current_user_is_admin()
  )
  AND (created_by IS NULL OR created_by = auth.uid())
);

DROP POLICY IF EXISTS allowance_policies_update ON public.allowance_policies;
CREATE POLICY allowance_policies_update ON public.allowance_policies
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('allowances.policy_manage')
    OR current_user_is_admin()
  )
)
WITH CHECK (organization_id = current_user_organization_id());

DROP POLICY IF EXISTS allowance_policies_delete ON public.allowance_policies;
CREATE POLICY allowance_policies_delete ON public.allowance_policies
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('allowances.policy_manage')
    OR current_user_is_admin()
  )
);

COMMIT;

-- ROLLBACK (manual): DROP TABLE IF EXISTS allowance_policies;
