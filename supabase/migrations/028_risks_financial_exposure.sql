-- =====================================================================
-- 028_risks_financial_exposure.sql
-- Risk cockpit — persist financial exposure + AI recommendation.
--
-- Adds two optional columns to public.risks consumed by the executive
-- risk cockpit:
--   - financial_exposure : declared monetary exposure of the risk (BRL).
--                          When NULL the app estimates level * 50.000.
--   - ai_recommendation  : actionable recommendation produced by the AI
--                          scanners (distinct from ai_rationale, which
--                          explains *why* the risk was flagged).
--
-- Idempotent: BEGIN/COMMIT + ADD COLUMN IF NOT EXISTS + guarded CHECK.
-- Does NOT alter RLS policies, other modules, or existing columns.
-- Dependencies: 009_risks_supabase, 011_ai_risk_engine.
-- =====================================================================

BEGIN;

ALTER TABLE public.risks
  ADD COLUMN IF NOT EXISTS financial_exposure numeric(14,2),
  ADD COLUMN IF NOT EXISTS ai_recommendation  text;

-- Exposure must be NULL or non-negative. Added separately so the column
-- ADD stays idempotent even if the constraint already exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'risks_financial_exposure_check'
      AND conrelid = 'public.risks'::regclass
  ) THEN
    ALTER TABLE public.risks
      ADD CONSTRAINT risks_financial_exposure_check
      CHECK (financial_exposure IS NULL OR financial_exposure >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.risks.financial_exposure IS
  'Exposição financeira declarada do risco em BRL. NULL => app estima level*50000.';
COMMENT ON COLUMN public.risks.ai_recommendation IS
  'Recomendação acionável gerada pela IA (distinta de ai_rationale).';

COMMIT;
