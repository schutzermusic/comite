-- ============================================================
-- GOVERNANÇA — Append-only audit + governance exceptions
-- Migration: 047_governance
-- Date:      2026-07-15
-- Purpose:   Fase 7 (spec §7, §18, diferencial D3):
--            1) reforça audit_logs como APPEND-ONLY de verdade — um
--               trigger bloqueia UPDATE/DELETE (hoje só a ausência de
--               policy protegia; roles elevadas passavam).
--            2) governance_exceptions — exceções operacionais (sobre-
--               alocação, self-approval/SoD, projeto encerrado com
--               horas, custo sem centro de custo, correções recorrentes,
--               folha sem alocação) com workflow de análise/resolução
--               (open → under_review → resolved | dismissed). Não acusa
--               fraude (ADR-008): classifica para análise.
-- Dependencies:
--   005 (audit_logs, helpers, set_updated_at())
--   038 (people, project_allocations), 004 (projects.id TEXT)
--   048_governance_perm_seeds (RBAC — data only)
-- NOTE: Idempotent, single transaction, RLS 030-safe.
-- ============================================================

BEGIN;

-- ============================================================
-- 1) audit_logs — append-only enforcement (D3)
--    Blocks UPDATE/DELETE at the row level via trigger, so the trail
--    is immutable even for elevated roles / service contexts.
-- ============================================================
CREATE OR REPLACE FUNCTION public.prevent_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs é append-only: % não permitido', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_append_only
BEFORE UPDATE OR DELETE ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_mutation();

-- ============================================================
-- 2) governance_exceptions — classified exceptions for review
-- ============================================================
CREATE TABLE IF NOT EXISTS public.governance_exceptions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,

  type               text NOT NULL
                       CHECK (type IN (
                         'over_allocation',           -- >100% somando projetos
                         'self_approval',             -- SoD: solicitou e aprovou
                         'closed_project_time',       -- horas em projeto encerrado
                         'cost_without_cost_center',  -- alocação sem centro de custo
                         'recurring_correction',      -- correções de ponto recorrentes
                         'payroll_without_allocation' -- na folha sem alocação ativa
                       )),
  severity           text NOT NULL DEFAULT 'medium'
                       CHECK (severity IN ('info','low','medium','high','critical')),
  status             text NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open','under_review','resolved','dismissed')),

  -- subject references (nullable — depends on the exception type)
  person_id          uuid REFERENCES people(id) ON DELETE CASCADE,
  project_id         text REFERENCES projects(id) ON DELETE CASCADE,
  allocation_id      uuid REFERENCES project_allocations(id) ON DELETE SET NULL,

  title              text NOT NULL,
  evidence           jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- idempotent detection key (upsert target)
  fingerprint        text NOT NULL,

  detected_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at        timestamptz,
  resolved_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_notes   text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS governance_exceptions_fingerprint_idx
  ON public.governance_exceptions (organization_id, fingerprint);
CREATE INDEX IF NOT EXISTS governance_exceptions_status_idx
  ON public.governance_exceptions (organization_id, status, severity);
CREATE INDEX IF NOT EXISTS governance_exceptions_type_idx
  ON public.governance_exceptions (organization_id, type);

DROP TRIGGER IF EXISTS trg_governance_exceptions_updated_at ON public.governance_exceptions;
CREATE TRIGGER trg_governance_exceptions_updated_at
BEFORE UPDATE ON public.governance_exceptions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 3) Row Level Security (030-safe: inline / other-table checks only)
-- ============================================================
ALTER TABLE public.governance_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS governance_exceptions_select ON public.governance_exceptions;
CREATE POLICY governance_exceptions_select ON public.governance_exceptions
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('people.governance_view')
    OR current_user_has_permission('audit.view')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS governance_exceptions_insert ON public.governance_exceptions;
CREATE POLICY governance_exceptions_insert ON public.governance_exceptions
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('people.governance_manage') OR current_user_is_admin())
);

DROP POLICY IF EXISTS governance_exceptions_update ON public.governance_exceptions;
CREATE POLICY governance_exceptions_update ON public.governance_exceptions
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('people.governance_manage') OR current_user_is_admin())
)
WITH CHECK (organization_id = current_user_organization_id());

DROP POLICY IF EXISTS governance_exceptions_delete ON public.governance_exceptions;
CREATE POLICY governance_exceptions_delete ON public.governance_exceptions
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('people.governance_manage') OR current_user_is_admin())
);

COMMIT;

-- ============================================================
-- Manual verification checklist (staging)
--   1. Re-run -> no-op.
--   2. UPDATE audit_logs SET action='x' -> raises restrict_violation.
--   3. DELETE FROM audit_logs -> raises restrict_violation.
--   4. Upsert same fingerprint twice -> single row (idempotent scan).
--   5. User without people.governance_view: SELECT exceptions -> 0 rows.
--
-- ROLLBACK (manual):
--   DROP TABLE IF EXISTS governance_exceptions;
--   DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON audit_logs;
--   DROP FUNCTION IF EXISTS prevent_audit_mutation();
-- ============================================================
