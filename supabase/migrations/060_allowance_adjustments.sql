-- ============================================================
-- DIÁRIAS DE CAMPO — Adjustments + workflow segregation stamps
-- Migration: 060_allowance_adjustments
-- Date:      2026-07-20
-- Purpose:   Fase 2 (revisão e aprovação).
--            1) allowance_adjustments (ADR-004): mudanças após a
--               aprovação NÃO sobrescrevem o histórico — geram um
--               registro de ajuste imutável (suplemento, compensação,
--               correção, exceção aprovada, baixa) com valor, motivo,
--               solicitante e aprovador.
--            2) Colunas de carimbo de fluxo em allowance_weeks para
--               segregação de funções: gestor conclui a revisão, RH
--               valida vínculo/ausências e SÓ ENTÃO o Financeiro pode
--               aprovar o lote (e o aprovador ≠ quem gerou).
-- Dependencies:
--   005 (helpers, set_updated_at())
--   038 (people)
--   056/058 (allowance_policies, allowance_weeks, daily_allowances)
--   061_allowance_perm_seeds (allowances.adjustment_manage etc.)
-- NOTE: Idempotente, transação única, RLS 030-safe. Aditiva.
-- ============================================================

BEGIN;

-- ============================================================
-- 1) Carimbos de segregação de funções em allowance_weeks
--    (aditivo; colunas nullable — semanas existentes não mudam)
-- ============================================================
ALTER TABLE public.allowance_weeks
  ADD COLUMN IF NOT EXISTS manager_reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manager_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS hr_validated_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hr_validated_at     timestamptz;

-- ============================================================
-- 2) allowance_adjustments — ajuste imutável pós-aprovação
-- ============================================================
CREATE TABLE IF NOT EXISTS public.allowance_adjustments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  person_id          uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  daily_allowance_id uuid REFERENCES daily_allowances(id) ON DELETE SET NULL,
  source_week_id     uuid REFERENCES allowance_weeks(id) ON DELETE SET NULL,
  target_week_id     uuid REFERENCES allowance_weeks(id) ON DELETE SET NULL,
  type               text NOT NULL
                       CHECK (type IN ('supplement','compensation','manual_correction',
                                       'approved_exception','write_off')),
  -- pode ser negativo (compensação/baixa) ou positivo (suplemento)
  amount_cents       bigint NOT NULL,
  reason             text NOT NULL,
  status             text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','pending_approval','approved','applied','cancelled')),
  requested_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  applied_at         timestamptz
);

CREATE INDEX IF NOT EXISTS allowance_adjustments_org_person_idx
  ON public.allowance_adjustments (organization_id, person_id);
CREATE INDEX IF NOT EXISTS allowance_adjustments_daily_idx
  ON public.allowance_adjustments (daily_allowance_id);
CREATE INDEX IF NOT EXISTS allowance_adjustments_target_week_idx
  ON public.allowance_adjustments (target_week_id, status);

DROP TRIGGER IF EXISTS trg_allowance_adjustments_updated_at ON public.allowance_adjustments;
CREATE TRIGGER trg_allowance_adjustments_updated_at
BEFORE UPDATE ON public.allowance_adjustments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 3) Row Level Security
--    View: allowances.view/manage. Escrita: allowances.adjustment_manage.
-- ============================================================
ALTER TABLE public.allowance_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allowance_adjustments_select ON public.allowance_adjustments;
CREATE POLICY allowance_adjustments_select ON public.allowance_adjustments
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('allowances.view')
    OR current_user_has_permission('allowances.manage')
    OR current_user_has_permission('allowances.adjustment_manage')
    OR person_id = current_user_person_id()
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS allowance_adjustments_insert ON public.allowance_adjustments;
CREATE POLICY allowance_adjustments_insert ON public.allowance_adjustments
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('allowances.adjustment_manage')
    OR current_user_is_admin()
  )
  AND (requested_by IS NULL OR requested_by = auth.uid())
);

DROP POLICY IF EXISTS allowance_adjustments_update ON public.allowance_adjustments;
CREATE POLICY allowance_adjustments_update ON public.allowance_adjustments
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('allowances.adjustment_manage')
    OR current_user_is_admin()
  )
)
WITH CHECK (organization_id = current_user_organization_id());

DROP POLICY IF EXISTS allowance_adjustments_delete ON public.allowance_adjustments;
CREATE POLICY allowance_adjustments_delete ON public.allowance_adjustments
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('allowances.adjustment_manage')
    OR current_user_is_admin()
  )
);

COMMIT;

-- ROLLBACK (manual):
--   DROP TABLE IF EXISTS allowance_adjustments;
--   ALTER TABLE allowance_weeks
--     DROP COLUMN IF EXISTS manager_reviewed_by, DROP COLUMN IF EXISTS manager_reviewed_at,
--     DROP COLUMN IF EXISTS hr_validated_by,     DROP COLUMN IF EXISTS hr_validated_at;
