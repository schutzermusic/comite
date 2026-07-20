-- ============================================================
-- DIÁRIAS DE CAMPO — Weekly batch header + per-day allowances
-- Migration: 058_allowance_weeks_and_daily
-- Date:      2026-07-20
-- Purpose:   Núcleo do módulo (ADR-001): UMA diária por pessoa e por
--            data (daily_allowances), agrupada num lote semanal único
--            (allowance_weeks). A granularidade diária permite alterar
--            um dia sem reprocessar a semana e dá base para auditoria,
--            conciliação e ajustes; o pagamento continua semanal.
--            Fase 1 roda em modo simulação (allowance_weeks.simulation_
--            mode = true): gera e avalia, mas não paga.
--            payment_batch_id é criado aqui como coluna nullable SEM
--            FK; a constraint é adicionada na migration 059 (lote).
-- Dependencies:
--   005 (helpers, set_updated_at())
--   004 (projects.id TEXT)
--   038 (people, project_allocations, current_user_person_id())
--   045 (attendance_punches)  041 (time_entries)
--   050 (project_geofences, location_evidence)
--   056 (allowance_policies)
--   061_allowance_perm_seeds (RBAC — data only)
-- NOTE: Idempotent, single transaction, RLS 030-safe. Anti-duplicidade
--       e idempotência garantidas por índices únicos (seção 12 do spec).
-- ============================================================

BEGIN;

-- ============================================================
-- 1) allowance_weeks — cabeçalho do lote semanal (estado + versão)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.allowance_weeks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  week_start          date NOT NULL,
  week_end            date NOT NULL CHECK (week_end >= week_start),
  status              text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','generated','manager_review',
                                          'hr_validation','finance_approved','scheduled',
                                          'processing','paid','reconciliation','closed',
                                          'cancelled')),
  total_people        integer NOT NULL DEFAULT 0 CHECK (total_people >= 0),
  total_items         integer NOT NULL DEFAULT 0 CHECK (total_items >= 0),
  total_amount_cents  bigint  NOT NULL DEFAULT 0 CHECK (total_amount_cents >= 0),
  generated_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  generated_at        timestamptz,
  approved_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at         timestamptz,
  -- Fase 1: sempre true (shadow — nenhum pagamento é executado)
  simulation_mode     boolean NOT NULL DEFAULT true,
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  notes               text,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- uma versão por período/org (regenerar cria nova versão, nunca duplica)
CREATE UNIQUE INDEX IF NOT EXISTS allowance_weeks_org_period_version_idx
  ON public.allowance_weeks (organization_id, week_start, week_end, version);
CREATE INDEX IF NOT EXISTS allowance_weeks_org_status_idx
  ON public.allowance_weeks (organization_id, status);

DROP TRIGGER IF EXISTS trg_allowance_weeks_updated_at ON public.allowance_weeks;
CREATE TRIGGER trg_allowance_weeks_updated_at
BEFORE UPDATE ON public.allowance_weeks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 2) daily_allowances — uma diária por pessoa/data
-- ============================================================
CREATE TABLE IF NOT EXISTS public.daily_allowances (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  allowance_week_id    uuid NOT NULL REFERENCES allowance_weeks(id) ON DELETE CASCADE,

  person_id            uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  allocation_id        uuid REFERENCES project_allocations(id) ON DELETE SET NULL,
  policy_id            uuid NOT NULL REFERENCES allowance_policies(id) ON DELETE RESTRICT,
  project_id           text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  geofence_id          uuid REFERENCES project_geofences(id) ON DELETE SET NULL,

  allowance_date       date NOT NULL,
  allowance_type       text NOT NULL DEFAULT 'meal' CHECK (allowance_type IN ('meal')),
  amount_cents         bigint NOT NULL CHECK (amount_cents >= 0),
  currency             text NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),

  status               text NOT NULL DEFAULT 'candidate'
                         CHECK (status IN ('candidate','planned','under_review',
                                           'under_review_missing_schedule','blocked',
                                           'approved','included_in_batch','processing',
                                           'paid','confirmed','divergent',
                                           'compensation_pending','reversed')),
  eligibility_reason   text,
  blocking_reason      text,
  -- origem da evidência de escala gravada no snapshot
  schedule_evidence_source text
                         CHECK (schedule_evidence_source IN
                                ('active_allocation_and_calendar','explicit_schedule',
                                 'manual_override','not_required')),

  -- snapshot imutável das evidências de planejamento e (depois) conciliação
  planned_evidence         jsonb NOT NULL DEFAULT '{}'::jsonb,
  reconciliation_evidence  jsonb,

  -- ligações de conciliação (fases posteriores)
  attendance_punch_id  uuid REFERENCES attendance_punches(id) ON DELETE SET NULL,
  location_evidence_id uuid REFERENCES location_evidence(id) ON DELETE SET NULL,
  time_entry_id        uuid REFERENCES time_entries(id) ON DELETE SET NULL,

  rule_version         text NOT NULL,
  -- FK adicionada em 059 (allowance_payment_batches ainda não existe)
  payment_batch_id     uuid,
  idempotency_key      text NOT NULL,

  created_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ── ANTI-DUPLICIDADE (spec §12) ─────────────────────────────
-- No máximo uma diária viva por org+pessoa+data+tipo+política.
-- 'reversed' fica de fora para permitir refazer após estorno.
CREATE UNIQUE INDEX IF NOT EXISTS daily_allowances_no_duplicate_idx
  ON public.daily_allowances (organization_id, person_id, allowance_date, allowance_type, policy_id)
  WHERE status <> 'reversed';

-- idempotência global (reprocessar a prévia não duplica)
CREATE UNIQUE INDEX IF NOT EXISTS daily_allowances_idempotency_idx
  ON public.daily_allowances (idempotency_key);

CREATE INDEX IF NOT EXISTS daily_allowances_week_idx
  ON public.daily_allowances (allowance_week_id, status);
CREATE INDEX IF NOT EXISTS daily_allowances_person_date_idx
  ON public.daily_allowances (organization_id, person_id, allowance_date);
CREATE INDEX IF NOT EXISTS daily_allowances_project_date_idx
  ON public.daily_allowances (organization_id, project_id, allowance_date);

DROP TRIGGER IF EXISTS trg_daily_allowances_updated_at ON public.daily_allowances;
CREATE TRIGGER trg_daily_allowances_updated_at
BEFORE UPDATE ON public.daily_allowances
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 3) Row Level Security
--    View: allowances.view (amplo) ou dono da própria diária.
--    Geração/edição: allowances.manage.
--    Sem self-SELECT (030-safe): posse via current_user_person_id().
-- ============================================================
ALTER TABLE public.allowance_weeks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_allowances   ENABLE ROW LEVEL SECURITY;

-- ---------- allowance_weeks ----------
DROP POLICY IF EXISTS allowance_weeks_select ON public.allowance_weeks;
CREATE POLICY allowance_weeks_select ON public.allowance_weeks
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('allowances.view')
    OR current_user_has_permission('allowances.manage')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS allowance_weeks_insert ON public.allowance_weeks;
CREATE POLICY allowance_weeks_insert ON public.allowance_weeks
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('allowances.manage')
    OR current_user_is_admin()
  )
  AND (created_by IS NULL OR created_by = auth.uid())
);

DROP POLICY IF EXISTS allowance_weeks_update ON public.allowance_weeks;
CREATE POLICY allowance_weeks_update ON public.allowance_weeks
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('allowances.manage')
    OR current_user_has_permission('allowances.hr_validate')
    OR current_user_has_permission('allowances.finance_approve')
    OR current_user_is_admin()
  )
)
WITH CHECK (organization_id = current_user_organization_id());

DROP POLICY IF EXISTS allowance_weeks_delete ON public.allowance_weeks;
CREATE POLICY allowance_weeks_delete ON public.allowance_weeks
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('allowances.manage')
    OR current_user_is_admin()
  )
);

-- ---------- daily_allowances ----------
DROP POLICY IF EXISTS daily_allowances_select ON public.daily_allowances;
CREATE POLICY daily_allowances_select ON public.daily_allowances
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

DROP POLICY IF EXISTS daily_allowances_insert ON public.daily_allowances;
CREATE POLICY daily_allowances_insert ON public.daily_allowances
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('allowances.manage')
    OR current_user_is_admin()
  )
  AND (created_by IS NULL OR created_by = auth.uid())
);

DROP POLICY IF EXISTS daily_allowances_update ON public.daily_allowances;
CREATE POLICY daily_allowances_update ON public.daily_allowances
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('allowances.manage')
    OR current_user_has_permission('allowances.review_exception')
    OR current_user_is_admin()
  )
)
WITH CHECK (organization_id = current_user_organization_id());

DROP POLICY IF EXISTS daily_allowances_delete ON public.daily_allowances;
CREATE POLICY daily_allowances_delete ON public.daily_allowances
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('allowances.manage')
    OR current_user_is_admin()
  )
);

COMMIT;

-- ROLLBACK (manual):
--   DROP TABLE IF EXISTS daily_allowances;
--   DROP TABLE IF EXISTS allowance_weeks;
