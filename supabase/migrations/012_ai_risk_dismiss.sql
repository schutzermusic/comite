-- =====================================================================
-- 012_ai_risk_dismiss.sql
-- Phase 1 of the Finance AI Copilot plan: separates "AI suggestion
-- dismissed" from "risk treated/resolved".
--
-- - `closed` (handled via status='resolved' today) means the risk was
--   actually treated. The `status` column already covers this.
-- - `ai_dismissed=true` means the AI suggestion was rejected. This is
--   independent from status — a user can dismiss a low-confidence AI
--   alert without ever opening it for treatment.
--
-- Also adds:
--   - de-duplication of AI risks for the same
--     (organization, source_module, source_entity_id, category)
--     while not dismissed.
--   - permission `risks.ai_dismiss` and grants.
--
-- Idempotent. Depends on 005, 009, 011.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Section 1 — Dismissal columns
-- ---------------------------------------------------------------------
ALTER TABLE public.risks
  ADD COLUMN IF NOT EXISTS ai_dismissed        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_dismissed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS ai_dismissed_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ai_dismissal_reason text;

COMMENT ON COLUMN public.risks.ai_dismissed        IS 'true when the AI suggestion was rejected. Independent from status (closed=treated).';
COMMENT ON COLUMN public.risks.ai_dismissed_at     IS 'Timestamp the AI suggestion was dismissed.';
COMMENT ON COLUMN public.risks.ai_dismissed_by     IS 'User who dismissed the AI suggestion.';
COMMENT ON COLUMN public.risks.ai_dismissal_reason IS 'Free-text reason supplied by the user when dismissing.';

-- ---------------------------------------------------------------------
-- Section 2 — De-duplication index for AI findings
-- ---------------------------------------------------------------------
-- Prevents two active AI risks for the same source entity + category.
-- Dismissed rows are excluded so re-scanning after dismissal works.
CREATE UNIQUE INDEX IF NOT EXISTS risks_ai_unique_active_idx
  ON public.risks (organization_id, source_module, source_entity_id, category)
  WHERE origin = 'ai' AND ai_dismissed = false;

-- ---------------------------------------------------------------------
-- Section 3 — Permission seed
-- ---------------------------------------------------------------------
INSERT INTO public.permissions (key, module, action, description)
VALUES ('risks.ai_dismiss', 'risks', 'ai_dismiss', 'Descartar sugestao de risco gerada por IA')
ON CONFLICT (key) DO NOTHING;

-- owner_admin always
WITH owner_role AS (
  SELECT id FROM public.roles WHERE key = 'owner_admin' AND organization_id IS NULL
),
perm AS (
  SELECT id FROM public.permissions WHERE key = 'risks.ai_dismiss'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT owner_role.id, perm.id FROM owner_role, perm
ON CONFLICT DO NOTHING;

-- Anyone who can trigger AI scans can also dismiss what the AI produced.
WITH target_roles AS (
  SELECT id FROM public.roles
   WHERE organization_id IS NULL
     AND key IN ('ceo_diretoria','gestor_projetos','juridico_contratos','financeiro')
),
perm AS (
  SELECT id FROM public.permissions WHERE key = 'risks.ai_dismiss'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT tr.id, perm.id FROM target_roles tr, perm
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- Section 4 — RLS note
-- ---------------------------------------------------------------------
-- Existing UPDATE policy on `risks` (see 009) already requires
-- organization match + risks.edit. The dismissal endpoint runs server-side
-- using the service-role client after verifying risks.ai_dismiss on the
-- caller, so it bypasses RLS the same way contract scan inserts do.

COMMIT;
