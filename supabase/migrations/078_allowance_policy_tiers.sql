-- ============================================================
-- DIÁRIAS DE CAMPO — Faixas de valor por função (tiers)
-- Migration: 078_allowance_policy_tiers
-- Date:      2026-07-29
-- Purpose:   Fracionar a diária por função do colaborador sem
--            multiplicar políticas: uma política tem um valor-base
--            (fallback) e N faixas, cada uma com valor próprio e
--            palavras-chave de função (people.job_title).
--            O motor resolve a faixa automaticamente por pessoa/dia
--            e grava a faixa aplicada na diária (auditoria).
--            ADR-005: nada hardcoded — "liderança = R$120, demais
--            = R$90" é dado configurável, não código.
-- Dependencies:
--   056_allowance_policies (allowance_policies)
--   058_allowance_weeks_and_daily (daily_allowances)
--   062_allowance_municipalities (versionamento/imutabilidade)
--   038 (people.job_title)
-- NOTE: Idempotente, transação única, RLS 030-safe (sem self-SELECT).
-- ============================================================

BEGIN;

-- ============================================================
-- 1) allowance_policy_tiers — faixa de valor por função
--    match_job_titles: palavras-chave comparadas (case/acento-
--    insensitive, por substring) contra people.job_title.
--    priority: menor primeiro; empate resolvido por nome.
--    Faixa nenhuma casou -> vale allowance_policies.amount_cents.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.allowance_policy_tiers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  policy_id         uuid NOT NULL REFERENCES allowance_policies(id) ON DELETE CASCADE,

  name              text NOT NULL,
  amount_cents      bigint NOT NULL CHECK (amount_cents > 0),
  match_job_titles  text[] NOT NULL DEFAULT '{}'::text[]
                      CHECK (array_length(match_job_titles, 1) IS NULL
                             OR array_length(match_job_titles, 1) <= 50),
  priority          integer NOT NULL DEFAULT 100 CHECK (priority >= 0),

  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS allowance_policy_tiers_name_idx
  ON public.allowance_policy_tiers (policy_id, lower(name));
CREATE INDEX IF NOT EXISTS allowance_policy_tiers_policy_idx
  ON public.allowance_policy_tiers (policy_id, priority);
CREATE INDEX IF NOT EXISTS allowance_policy_tiers_org_idx
  ON public.allowance_policy_tiers (organization_id);

DROP TRIGGER IF EXISTS trg_allowance_policy_tiers_updated_at ON public.allowance_policy_tiers;
CREATE TRIGGER trg_allowance_policy_tiers_updated_at
BEFORE UPDATE ON public.allowance_policy_tiers
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 2) daily_allowances — rastro da faixa aplicada
--    A diária já grava amount_cents; estas colunas respondem
--    "por que este valor" sem depender do estado atual da faixa.
-- ============================================================
ALTER TABLE public.daily_allowances
  ADD COLUMN IF NOT EXISTS policy_tier_id uuid
    REFERENCES allowance_policy_tiers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tier_label text;

CREATE INDEX IF NOT EXISTS daily_allowances_tier_idx
  ON public.daily_allowances (organization_id, policy_tier_id);

-- ============================================================
-- 3) Imutabilidade — faixa que já pagou não muda
--    Espelha prevent_referenced_allowance_policy_rule_change (062),
--    mas só trava quando existe diária CONSOLIDADA (aprovada em
--    diante). Diárias em prévia são regeneráveis, então ajustar a
--    faixa antes da aprovação é operação normal.
-- ============================================================
CREATE OR REPLACE FUNCTION public.prevent_settled_allowance_tier_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_policy uuid := COALESCE(NEW.policy_id, OLD.policy_id);
BEGIN
  IF EXISTS (
    SELECT 1 FROM daily_allowances d
    WHERE d.policy_id = target_policy
      AND d.status IN ('approved','included_in_batch','processing',
                       'paid','confirmed','divergent','compensation_pending')
  ) THEN
    RAISE EXCEPTION 'Allowance policy tiers are immutable once allowances are settled; create a successor policy version';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_allowance_policy_tiers_immutable ON public.allowance_policy_tiers;
CREATE TRIGGER trg_allowance_policy_tiers_immutable
BEFORE INSERT OR UPDATE OR DELETE ON public.allowance_policy_tiers
FOR EACH ROW EXECUTE FUNCTION public.prevent_settled_allowance_tier_change();

-- ============================================================
-- 4) Row Level Security — mesmas permissões da política-mãe
--    View: allowances.view | allowances.policy_manage.
--    Escrita: allowances.policy_manage (Financeiro/Admin).
-- ============================================================
ALTER TABLE public.allowance_policy_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allowance_policy_tiers_select ON public.allowance_policy_tiers;
CREATE POLICY allowance_policy_tiers_select ON public.allowance_policy_tiers
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('allowances.view')
    OR current_user_has_permission('allowances.policy_manage')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS allowance_policy_tiers_insert ON public.allowance_policy_tiers;
CREATE POLICY allowance_policy_tiers_insert ON public.allowance_policy_tiers
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('allowances.policy_manage')
    OR current_user_is_admin()
  )
  AND (created_by IS NULL OR created_by = auth.uid())
);

DROP POLICY IF EXISTS allowance_policy_tiers_update ON public.allowance_policy_tiers;
CREATE POLICY allowance_policy_tiers_update ON public.allowance_policy_tiers
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('allowances.policy_manage')
    OR current_user_is_admin()
  )
)
WITH CHECK (organization_id = current_user_organization_id());

DROP POLICY IF EXISTS allowance_policy_tiers_delete ON public.allowance_policy_tiers;
CREATE POLICY allowance_policy_tiers_delete ON public.allowance_policy_tiers
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('allowances.policy_manage')
    OR current_user_is_admin()
  )
);

COMMIT;

-- ROLLBACK (manual):
--   DROP TRIGGER IF EXISTS trg_allowance_policy_tiers_immutable ON public.allowance_policy_tiers;
--   DROP FUNCTION IF EXISTS public.prevent_settled_allowance_tier_change();
--   ALTER TABLE public.daily_allowances DROP COLUMN IF EXISTS tier_label,
--     DROP COLUMN IF EXISTS policy_tier_id;
--   DROP TABLE IF EXISTS public.allowance_policy_tiers;
