-- =====================================================================
-- 011_ai_risk_engine.sql
-- AI Risk Engine — extends `risks` for AI-generated entries (origin='ai'),
-- adds metadata columns, indexes, and seeds the `risks.ai_scan` permission.
--
-- Lifecycle (per user decision):
--   - AI risks land DIRECTLY in the panel (no staging table).
--   - Distinguished by origin='ai' + visible badge in the UI.
--   - Trigger: on-demand via "Analisar com IA" button, gated by
--     `risks.ai_scan` permission (enforced at API route level).
--   - Model: claude-sonnet-4-6 (default for ai_model column).
--
-- Idempotent: BEGIN/COMMIT, IF NOT EXISTS, DROP IF EXISTS, ON CONFLICT.
-- Does NOT modify migrations 001–010. Does NOT alter risks RLS policies.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Section 1 — Extend risks.origin CHECK to include 'ai'
-- ---------------------------------------------------------------------
-- 009 defines `origin` with an inline CHECK (manual|contract|project).
-- Postgres auto-names inline column CHECKs as <table>_<column>_check,
-- i.e. risks_origin_check. We drop and re-add to widen the allowed set.

ALTER TABLE public.risks
  DROP CONSTRAINT IF EXISTS risks_origin_check;

ALTER TABLE public.risks
  ADD CONSTRAINT risks_origin_check
  CHECK (origin IN ('manual','contract','project','ai'));

-- ---------------------------------------------------------------------
-- Section 2 — AI metadata columns + index
-- ---------------------------------------------------------------------
-- All ADD COLUMN IF NOT EXISTS so the migration can be safely re-run.

ALTER TABLE public.risks
  ADD COLUMN IF NOT EXISTS source_module     text,
  ADD COLUMN IF NOT EXISTS source_entity_id  text,
  ADD COLUMN IF NOT EXISTS ai_confidence     numeric(3,2),
  ADD COLUMN IF NOT EXISTS ai_rationale      text,
  ADD COLUMN IF NOT EXISTS ai_model          text,
  ADD COLUMN IF NOT EXISTS ai_analyzed_at    timestamptz;

-- Confidence must be NULL or in [0,1]. Added separately so the column
-- ADD remains idempotent even if the constraint already exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'risks_ai_confidence_check'
      AND conrelid = 'public.risks'::regclass
  ) THEN
    ALTER TABLE public.risks
      ADD CONSTRAINT risks_ai_confidence_check
      CHECK (ai_confidence IS NULL
             OR (ai_confidence >= 0 AND ai_confidence <= 1));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS risks_source_entity_idx
  ON public.risks (organization_id, source_module, source_entity_id);

COMMENT ON COLUMN public.risks.source_module    IS 'AI/derived risk source module: contracts | finance | projects';
COMMENT ON COLUMN public.risks.source_entity_id IS 'ID of the entity the risk was derived from (contract UUID, ledger entry id, etc.)';
COMMENT ON COLUMN public.risks.ai_confidence    IS 'Model confidence score for AI-generated risks, in [0,1].';
COMMENT ON COLUMN public.risks.ai_rationale     IS 'Model explanation of why this risk was flagged.';
COMMENT ON COLUMN public.risks.ai_model         IS 'AI model identifier (e.g. claude-sonnet-4-6).';
COMMENT ON COLUMN public.risks.ai_analyzed_at   IS 'Timestamp of the AI analysis that produced the row.';

-- ---------------------------------------------------------------------
-- Section 3 — Seed permission `risks.ai_scan` and grant to roles
-- ---------------------------------------------------------------------
-- `permissions.key` is UNIQUE (see 005). Use ON CONFLICT (key) DO NOTHING
-- so this migration is idempotent and does NOT overwrite an existing row.

INSERT INTO public.permissions (key, module, action, description)
VALUES ('risks.ai_scan', 'risks', 'ai_scan', 'Disparar analise de risco com IA')
ON CONFLICT (key) DO NOTHING;

-- owner_admin gets every permission via the all-perms CTE in 005,
-- but that seed only runs once. Re-apply the same union here so the
-- new permission is granted on existing installs.
WITH owner_role AS (
  SELECT id FROM public.roles
   WHERE key = 'owner_admin' AND organization_id IS NULL
),
ai_perm AS (
  SELECT id FROM public.permissions WHERE key = 'risks.ai_scan'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT owner_role.id, ai_perm.id
FROM owner_role, ai_perm
ON CONFLICT DO NOTHING;

-- Grant to the roles that already hold risks.create (or executive view)
-- and have legitimate need to trigger AI scans:
--   ceo_diretoria, gestor_projetos, juridico_contratos, financeiro.
WITH target_roles AS (
  SELECT id, key FROM public.roles
   WHERE organization_id IS NULL
     AND key IN ('ceo_diretoria','gestor_projetos','juridico_contratos','financeiro')
),
ai_perm AS (
  SELECT id FROM public.permissions WHERE key = 'risks.ai_scan'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT tr.id, ai_perm.id
FROM target_roles tr, ai_perm
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- Section 4 — RLS note (no policy changes)
-- ---------------------------------------------------------------------
-- The existing `risks_insert` policy (see 009) requires
--   created_by = auth.uid() AND has_permission('risks.create')
-- which is correct for human-authored rows.
--
-- AI-generated rows MUST be inserted by the server-side route using
-- the Supabase service-role key, which BYPASSES RLS. Do NOT weaken
-- the insert policy to accommodate AI writes. The API route is
-- responsible for:
--   1) verifying the caller has `risks.ai_scan`,
--   2) setting origin='ai', source_module, ai_model, ai_analyzed_at,
--   3) leaving created_by NULL or set to a system user id.

-- ---------------------------------------------------------------------
-- Section 5 — Verification notes
-- ---------------------------------------------------------------------
-- - AI rows are visible to anyone with `risks.view` (existing SELECT policy
--   in 009 is unchanged; origin is not part of the predicate).
-- - AI rows are distinguishable by:
--       origin = 'ai'
--   AND source_module IS NOT NULL
--   AND ai_model IS NOT NULL
--   AND ai_analyzed_at IS NOT NULL
-- - `risks.ai_scan` is available for assignment in the RBAC UI but is
--   enforced at the API route level (not by a DB policy), to keep the
--   `risks` insert policy strict for human-authored rows.

COMMIT;
