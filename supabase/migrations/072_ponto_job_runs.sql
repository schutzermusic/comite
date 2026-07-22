-- ============================================================
-- INSIGHT PONTO — job execution observability
-- Migration: 072_ponto_job_runs
--
-- Registro aditivo e multi-tenant das execuções dos jobs agendados
-- (cron de provisionamento/lembretes e retenção de selfies). NUNCA guarda
-- tokens, senhas, headers de autorização ou conteúdo de selfie. Escrito
-- pela API via service role; lido por gestores/admin.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.ponto_job_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              uuid NOT NULL,
  job_type            text NOT NULL CHECK (job_type IN ('cron','provisioning','reminders','retention')),
  organization_id     uuid REFERENCES organizations(id) ON DELETE CASCADE, -- null = global
  started_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  status              text NOT NULL DEFAULT 'running'
                        CHECK (status IN ('running','success','partial','failed')),
  dry_run             boolean NOT NULL DEFAULT false,
  automation_enabled  boolean NOT NULL DEFAULT false,
  scanned             integer NOT NULL DEFAULT 0,
  succeeded           integer NOT NULL DEFAULT 0,
  skipped             integer NOT NULL DEFAULT 0,
  failed              integer NOT NULL DEFAULT 0,
  error_summary       text,
  continuation_cursor text,
  triggered_by        text, -- 'cron' | 'manual' | <user_id>
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ponto_job_runs_type_time_idx
  ON public.ponto_job_runs (job_type, started_at DESC);
CREATE INDEX IF NOT EXISTS ponto_job_runs_org_time_idx
  ON public.ponto_job_runs (organization_id, started_at DESC);

ALTER TABLE public.ponto_job_runs ENABLE ROW LEVEL SECURITY;

-- Leitura: gestores de ponto/pessoas ou admin; linhas globais (org null) ou da
-- própria org. Escrita é só via service role (bypassa RLS).
DROP POLICY IF EXISTS ponto_job_runs_select ON public.ponto_job_runs;
CREATE POLICY ponto_job_runs_select ON public.ponto_job_runs
FOR SELECT TO authenticated
USING (
  (organization_id IS NULL OR organization_id = current_user_organization_id())
  AND (
       current_user_has_permission('people.attendance_manage')
    OR current_user_has_permission('people.manage')
    OR current_user_is_admin()
  )
);

COMMIT;

-- ============================================================
-- Rollback (manual):
--   DROP TABLE IF EXISTS public.ponto_job_runs;
-- ============================================================
