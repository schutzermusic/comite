-- ============================================================
-- PROJETOS — Enterprise project controls: timeline / Gantt / import
-- Migration: 032_project_timeline
-- Date:      2026-06-11
-- Purpose:   Relational schedule store for the Projetos module:
--            MS Project schedule imports (versioned batches),
--            timeline items (WBS hierarchy, planned/actual/forecast
--            dates, delay workflow), dependencies, assignments
--            (responsible + execution team), comments and delay
--            logs. Extends project_files with timeline linkage.
-- Dependencies:
--   004_projects_supabase_storage (projects.id TEXT, project_files)
--   005_auth_rbac_foundation      (organizations, profiles,
--                                  current_user_organization_id(),
--                                  current_user_has_permission(),
--                                  current_user_is_admin(),
--                                  set_updated_at())
--   008_projects_rls_hardening    (projects.organization_id)
--   026_agenda_calendar           (is_org_member() helper)
--   033_project_timeline_perm_seeds (RBAC seeds — data only)
-- NOTE: Idempotent. Wrapped in a single transaction. Re-running
--       must be a no-op. RLS SELECT policies check the row's own
--       columns inline (no self-SELECT) so INSERT ... RETURNING
--       works — see migration 030 for the rationale.
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1) project_schedule_imports — one row per import batch (PDF do
--    MS Project, CSV futuro, etc). schedule_version increments per
--    project. Raw parse output preserved for audit.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.project_schedule_imports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id        text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_file_name  text,
  source_file_path  text,
  source_file_hash  text NOT NULL,
  source_type       text NOT NULL DEFAULT 'ms_project_pdf'
                      CHECK (source_type IN ('ms_project_pdf','csv','xlsx','xml','manual')),
  schedule_version  integer NOT NULL DEFAULT 1,
  imported_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  imported_at       timestamptz NOT NULL DEFAULT now(),
  parse_status      text NOT NULL DEFAULT 'completed'
                      CHECK (parse_status IN ('completed','completed_with_warnings','failed')),
  parser_used       text NOT NULL DEFAULT 'deterministic'
                      CHECK (parser_used IN ('deterministic','ai','manual')),
  parse_summary     jsonb NOT NULL DEFAULT '{}'::jsonb,
  warnings          jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS schedule_imports_org_project_idx
  ON public.project_schedule_imports (organization_id, project_id, imported_at DESC);

-- ============================================================
-- 2) project_timeline_items — canonical schedule rows (WBS tree).
--    raw_import keeps the original MS Project strings verbatim
--    (original_start_raw, original_finish_raw, original_duration_raw,
--    original_percent_raw, original_task_name) for audit.
--    Soft lifecycle: is_active=false when a re-import no longer
--    contains the row ("not found in latest import"); deleted_at
--    for manual soft-delete. Never hard-delete automatically.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.project_timeline_items (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id               text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id                uuid REFERENCES project_timeline_items(id) ON DELETE SET NULL,
  import_batch_id          uuid REFERENCES project_schedule_imports(id) ON DELETE SET NULL,
  original_ms_project_id   text,
  wbs_code                 text,
  outline_level            integer NOT NULL DEFAULT 0,
  row_order                integer NOT NULL DEFAULT 0,
  type                     text NOT NULL DEFAULT 'task'
                             CHECK (type IN ('phase','milestone','deliverable','task','meeting',
                                             'decision','document','risk_event','financial_event',
                                             'contract_event')),
  title                    text NOT NULL,
  description              text,
  planned_start            date,
  planned_finish           date,
  actual_start             date,
  actual_finish            date,
  forecast_start           date,
  forecast_finish          date,
  duration_minutes         integer,
  percent_complete         numeric(5,2) NOT NULL DEFAULT 0,
  status                   text NOT NULL DEFAULT 'not_started'
                             CHECK (status IN ('not_started','in_progress','blocked',
                                               'delayed','completed','cancelled')),
  priority                 text NOT NULL DEFAULT 'medium'
                             CHECK (priority IN ('low','medium','high','critical')),
  responsible_user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  delay_status             text NOT NULL DEFAULT 'on_track'
                             CHECK (delay_status IN ('on_track','at_risk','delayed','blocked')),
  delay_reason_category    text
                             CHECK (delay_reason_category IS NULL OR delay_reason_category IN
                                    ('material_delay','logistics_delay','manpower_delay',
                                     'client_dependency','technical_issue','supplier_delay',
                                     'safety_compliance','weather_external','financial_payment',
                                     'other')),
  delay_reason_text        text,
  delay_impact_text        text,
  recovery_plan_text       text,
  related_agenda_task_id   uuid,
  related_meeting_id       uuid,
  related_risk_id          uuid,
  related_contract_id      uuid,
  related_document_id      uuid,
  is_summary               boolean NOT NULL DEFAULT false,
  is_milestone             boolean NOT NULL DEFAULT false,
  is_active                boolean NOT NULL DEFAULT true,
  raw_import               jsonb,
  created_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz
);

CREATE INDEX IF NOT EXISTS timeline_items_org_project_order_idx
  ON public.project_timeline_items (organization_id, project_id, row_order);
CREATE INDEX IF NOT EXISTS timeline_items_active_idx
  ON public.project_timeline_items (organization_id, project_id)
  WHERE is_active AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS timeline_items_wbs_idx
  ON public.project_timeline_items (project_id, wbs_code);
CREATE INDEX IF NOT EXISTS timeline_items_responsible_idx
  ON public.project_timeline_items (responsible_user_id);
CREATE INDEX IF NOT EXISTS timeline_items_late_idx
  ON public.project_timeline_items (organization_id, project_id)
  WHERE status IN ('delayed','blocked');

DROP TRIGGER IF EXISTS trg_timeline_items_updated_at ON public.project_timeline_items;
CREATE TRIGGER trg_timeline_items_updated_at
BEFORE UPDATE ON public.project_timeline_items
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 3) project_timeline_dependencies — FS/SS/FF/SF links. The MS
--    Project PDF export carries no predecessors, so rows here come
--    from manual editing only (never invented by the importer).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.project_timeline_dependencies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id       text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  predecessor_id   uuid NOT NULL REFERENCES project_timeline_items(id) ON DELETE CASCADE,
  successor_id     uuid NOT NULL REFERENCES project_timeline_items(id) ON DELETE CASCADE,
  type             text NOT NULL DEFAULT 'FS' CHECK (type IN ('FS','SS','FF','SF')),
  lag_minutes      integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT timeline_dep_no_self CHECK (predecessor_id <> successor_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS timeline_deps_unique_idx
  ON public.project_timeline_dependencies (predecessor_id, successor_id);
CREATE INDEX IF NOT EXISTS timeline_deps_project_idx
  ON public.project_timeline_dependencies (organization_id, project_id);

-- ============================================================
-- 4) project_timeline_assignments — responsible + execution team.
--    History is kept by setting removed_at (never deleting); the
--    partial unique index allows re-adding a removed member.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.project_timeline_assignments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id        text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  timeline_item_id  uuid NOT NULL REFERENCES project_timeline_items(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role              text NOT NULL DEFAULT 'executor'
                      CHECK (role IN ('responsible','executor','reviewer','approver')),
  assigned_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at       timestamptz NOT NULL DEFAULT now(),
  removed_at        timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS timeline_assignments_active_unique_idx
  ON public.project_timeline_assignments (timeline_item_id, user_id, role)
  WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS timeline_assignments_item_idx
  ON public.project_timeline_assignments (timeline_item_id);
CREATE INDEX IF NOT EXISTS timeline_assignments_user_idx
  ON public.project_timeline_assignments (organization_id, user_id);

-- ============================================================
-- 5) project_timeline_comments — modeled on task_comments (031).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.project_timeline_comments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id        text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  timeline_item_id  uuid NOT NULL REFERENCES project_timeline_items(id) ON DELETE CASCADE,
  author_user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body              text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS timeline_comments_item_idx
  ON public.project_timeline_comments (timeline_item_id, created_at);

-- ============================================================
-- 6) project_delay_logs — immutable history of delay reports and
--    delayed/blocked status transitions (workflow seção 6 da spec).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.project_delay_logs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id           text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  timeline_item_id     uuid NOT NULL REFERENCES project_timeline_items(id) ON DELETE CASCADE,
  reported_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  old_status           text,
  new_status           text,
  reason_category      text
                         CHECK (reason_category IS NULL OR reason_category IN
                                ('material_delay','logistics_delay','manpower_delay',
                                 'client_dependency','technical_issue','supplier_delay',
                                 'safety_compliance','weather_external','financial_payment',
                                 'other')),
  reason_text          text,
  impact_text          text,
  recovery_plan_text   text,
  support_needed_text  text,
  contract_impact      boolean NOT NULL DEFAULT false,
  old_forecast_finish  date,
  new_forecast_finish  date,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS delay_logs_item_idx
  ON public.project_delay_logs (organization_id, timeline_item_id, created_at DESC);

-- ============================================================
-- 7) project_files — timeline linkage + document typing (reuses the
--    existing table/bucket instead of a new project_documents table).
-- ============================================================
ALTER TABLE public.project_files
  ADD COLUMN IF NOT EXISTS timeline_item_id uuid REFERENCES project_timeline_items(id) ON DELETE SET NULL;
ALTER TABLE public.project_files
  ADD COLUMN IF NOT EXISTS document_type text;

CREATE INDEX IF NOT EXISTS project_files_timeline_item_idx
  ON public.project_files (timeline_item_id);

-- ============================================================
-- 8) SECURITY DEFINER helper — true when the caller is the
--    responsible user of the timeline item. Safe inside INSERT
--    WITH CHECK of OTHER tables (delay_logs/comments) because it
--    queries the parent item, never the row being inserted.
-- ============================================================
CREATE OR REPLACE FUNCTION public.user_is_timeline_responsible(p_item_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_timeline_items i
    WHERE i.id = p_item_id
      AND i.organization_id = current_user_organization_id()
      AND i.responsible_user_id = auth.uid()
  )
$$;

REVOKE ALL ON FUNCTION public.user_is_timeline_responsible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_is_timeline_responsible(uuid) TO authenticated;

-- ============================================================
-- 9) Row Level Security
--    SELECT policies use ONLY inline row-column checks (030 lesson)
--    so INSERT ... RETURNING never trips RLS.
-- ============================================================
ALTER TABLE public.project_schedule_imports      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_timeline_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_timeline_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_timeline_assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_timeline_comments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_delay_logs            ENABLE ROW LEVEL SECURITY;

-- ---------- project_schedule_imports ----------
DROP POLICY IF EXISTS schedule_imports_select ON public.project_schedule_imports;
CREATE POLICY schedule_imports_select ON public.project_schedule_imports
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('projects.timeline.view')
    OR current_user_has_permission('projects.view')
    OR imported_by = auth.uid()
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS schedule_imports_insert ON public.project_schedule_imports;
CREATE POLICY schedule_imports_insert ON public.project_schedule_imports
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('projects.timeline.import')
    OR current_user_is_admin()
  )
  AND imported_by = auth.uid()
);

-- ---------- project_timeline_items ----------
DROP POLICY IF EXISTS timeline_items_select ON public.project_timeline_items;
CREATE POLICY timeline_items_select ON public.project_timeline_items
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('projects.timeline.view')
    OR current_user_has_permission('projects.view')
    OR responsible_user_id = auth.uid()
    OR created_by = auth.uid()
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS timeline_items_insert ON public.project_timeline_items;
CREATE POLICY timeline_items_insert ON public.project_timeline_items
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('projects.timeline.edit')
    OR current_user_has_permission('projects.timeline.import')
    OR current_user_is_admin()
  )
  AND created_by = auth.uid()
  -- internal-only responsible (is_org_member é SECURITY DEFINER da 026)
  AND (responsible_user_id IS NULL OR is_org_member(responsible_user_id))
);

DROP POLICY IF EXISTS timeline_items_update ON public.project_timeline_items;
CREATE POLICY timeline_items_update ON public.project_timeline_items
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('projects.timeline.edit')
    OR current_user_has_permission('projects.timeline.import')
    OR current_user_has_permission('projects.timeline.admin')
    -- o responsável atualiza o próprio item (status / % / atraso)
    OR responsible_user_id = auth.uid()
    OR current_user_is_admin()
  )
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (responsible_user_id IS NULL OR is_org_member(responsible_user_id))
  -- (re)atribuir responsável a terceiros exige assign/edit/admin
  AND (
       responsible_user_id IS NULL
    OR responsible_user_id = auth.uid()
    OR current_user_has_permission('projects.timeline.assign')
    OR current_user_has_permission('projects.timeline.edit')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS timeline_items_delete ON public.project_timeline_items;
CREATE POLICY timeline_items_delete ON public.project_timeline_items
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('projects.timeline.admin')
    OR current_user_is_admin()
  )
);

-- ---------- project_timeline_dependencies ----------
DROP POLICY IF EXISTS timeline_deps_select ON public.project_timeline_dependencies;
CREATE POLICY timeline_deps_select ON public.project_timeline_dependencies
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('projects.timeline.view')
    OR current_user_has_permission('projects.view')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS timeline_deps_write ON public.project_timeline_dependencies;
CREATE POLICY timeline_deps_write ON public.project_timeline_dependencies
FOR ALL TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('projects.timeline.edit')
    OR current_user_has_permission('projects.timeline.admin')
    OR current_user_is_admin()
  )
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('projects.timeline.edit')
    OR current_user_has_permission('projects.timeline.admin')
    OR current_user_is_admin()
  )
);

-- ---------- project_timeline_assignments ----------
DROP POLICY IF EXISTS timeline_assignments_select ON public.project_timeline_assignments;
CREATE POLICY timeline_assignments_select ON public.project_timeline_assignments
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       user_id = auth.uid()
    OR current_user_has_permission('projects.timeline.view')
    OR current_user_has_permission('projects.view')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS timeline_assignments_insert ON public.project_timeline_assignments;
CREATE POLICY timeline_assignments_insert ON public.project_timeline_assignments
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('projects.timeline.assign')
    OR current_user_has_permission('projects.timeline.edit')
    OR current_user_is_admin()
  )
  AND assigned_by = auth.uid()
  -- equipe de execução é interna por construção
  AND is_org_member(user_id)
);

-- remoção = soft (removed_at); manter histórico, sem DELETE
DROP POLICY IF EXISTS timeline_assignments_update ON public.project_timeline_assignments;
CREATE POLICY timeline_assignments_update ON public.project_timeline_assignments
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('projects.timeline.assign')
    OR current_user_has_permission('projects.timeline.edit')
    OR current_user_is_admin()
  )
)
WITH CHECK (organization_id = current_user_organization_id());

-- ---------- project_timeline_comments ----------
DROP POLICY IF EXISTS timeline_comments_select ON public.project_timeline_comments;
CREATE POLICY timeline_comments_select ON public.project_timeline_comments
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       author_user_id = auth.uid()
    OR current_user_has_permission('projects.timeline.view')
    OR current_user_has_permission('projects.view')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS timeline_comments_insert ON public.project_timeline_comments;
CREATE POLICY timeline_comments_insert ON public.project_timeline_comments
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND author_user_id = auth.uid()
  AND (
       current_user_has_permission('projects.timeline.view')
    OR current_user_has_permission('projects.view')
    OR user_is_timeline_responsible(timeline_item_id)
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS timeline_comments_delete ON public.project_timeline_comments;
CREATE POLICY timeline_comments_delete ON public.project_timeline_comments
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       author_user_id = auth.uid()
    OR current_user_has_permission('projects.timeline.admin')
    OR current_user_is_admin()
  )
);

-- ---------- project_delay_logs ----------
DROP POLICY IF EXISTS delay_logs_select ON public.project_delay_logs;
CREATE POLICY delay_logs_select ON public.project_delay_logs
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       reported_by = auth.uid()
    OR current_user_has_permission('projects.timeline.view')
    OR current_user_has_permission('projects.view')
    OR current_user_is_admin()
  )
);

-- o responsável do item reporta o próprio atraso mesmo sem permissão
-- global (helper consulta o item pai — seguro no WITH CHECK)
DROP POLICY IF EXISTS delay_logs_insert ON public.project_delay_logs;
CREATE POLICY delay_logs_insert ON public.project_delay_logs
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND reported_by = auth.uid()
  AND (
       current_user_has_permission('projects.timeline.delay_update')
    OR current_user_has_permission('projects.timeline.edit')
    OR user_is_timeline_responsible(timeline_item_id)
    OR current_user_is_admin()
  )
);

COMMIT;

-- ============================================================
-- 10) Manual verification checklist (staging)
--    1. Re-run this migration -> no-op.
--    2. As anon: SELECT em qualquer tabela -> 0 rows / denied.
--    3. Usuário sem projects.timeline.import: INSERT em
--       project_schedule_imports -> denied.
--    4. INSERT project_timeline_items ... RETURNING como editor ->
--       retorna a linha (SELECT policy inline, padrão 030).
--    5. Responsável sem perms globais: UPDATE no próprio item ->
--       permitido; em item alheio -> denied.
--    6. INSERT assignment com user de outra org -> denied
--       (is_org_member).
--    7. Responsável insere delay_log do próprio item -> permitido.
-- ============================================================
