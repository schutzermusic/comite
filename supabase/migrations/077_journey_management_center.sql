-- ============================================================
-- JOURNEY MANAGEMENT CENTER
-- Migration: 077_journey_management_center
-- Date:      2026-07-29
-- ============================================================

BEGIN;

-- Granular permissions -------------------------------------------------
INSERT INTO public.permissions (key, module, action, description)
VALUES
  ('people.attendance_approve',         'people', 'attendance_approve',         'Aprovar saldos e exceções de jornada no próprio escopo'),
  ('people.attendance_schedule_manage', 'people', 'attendance_schedule_manage', 'Configurar escalas e exceções de jornada'),
  ('people.attendance_scope_admin',     'people', 'attendance_scope_admin',     'Configurar o escopo dos gestores de jornada'),
  ('people.attendance_close',           'people', 'attendance_close',           'Revisar, fechar e reabrir competências de jornada')
ON CONFLICT (key) DO UPDATE
SET description = EXCLUDED.description;

-- Owner/admin: all new permissions.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.organization_id IS NULL
  AND r.key = 'owner_admin'
  AND p.key IN (
    'people.attendance_approve',
    'people.attendance_schedule_manage',
    'people.attendance_scope_admin',
    'people.attendance_close'
  )
ON CONFLICT DO NOTHING;

-- RH: global operation, schedules, approvals and closing.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.organization_id IS NULL
  AND r.key = 'rh'
  AND p.key IN (
    'people.attendance_approve',
    'people.attendance_schedule_manage',
    'people.attendance_close'
  )
ON CONFLICT DO NOTHING;

-- Project managers can correct/approve, but RLS below limits them to the
-- administrator-configured scope.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.organization_id IS NULL
  AND r.key = 'gestor_projetos'
  AND p.key IN ('people.attendance_manage', 'people.attendance_approve')
ON CONFLICT DO NOTHING;

-- Shift templates and assignments -------------------------------------
CREATE TABLE IF NOT EXISTS public.journey_shift_templates (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                     text NOT NULL CHECK (btrim(name) <> ''),
  weekdays                 smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::smallint[],
  start_time               time NOT NULL,
  end_time                 time NOT NULL,
  break_minutes            integer NOT NULL DEFAULT 60 CHECK (break_minutes >= 0 AND break_minutes <= 360),
  tolerance_before_minutes integer NOT NULL DEFAULT 0 CHECK (tolerance_before_minutes >= 0 AND tolerance_before_minutes <= 180),
  tolerance_after_minutes  integer NOT NULL DEFAULT 10 CHECK (tolerance_after_minutes >= 0 AND tolerance_after_minutes <= 180),
  timezone                 text NOT NULL DEFAULT 'America/Sao_Paulo',
  active                   boolean NOT NULL DEFAULT true,
  created_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS public.journey_shift_assignments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person_id         uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  shift_template_id uuid NOT NULL REFERENCES journey_shift_templates(id) ON DELETE RESTRICT,
  project_id        text REFERENCES projects(id) ON DELETE SET NULL,
  valid_from        date NOT NULL,
  valid_until       date,
  active            boolean NOT NULL DEFAULT true,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until IS NULL OR valid_until >= valid_from)
);

CREATE INDEX IF NOT EXISTS journey_shift_assignments_lookup_idx
  ON public.journey_shift_assignments (organization_id, person_id, valid_from, valid_until)
  WHERE active;

CREATE TABLE IF NOT EXISTS public.journey_schedule_exceptions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person_id                uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  work_date                date NOT NULL,
  type                     text NOT NULL CHECK (type IN ('day_off','custom_shift','planned_absence')),
  start_time               time,
  end_time                 time,
  break_minutes            integer CHECK (break_minutes IS NULL OR (break_minutes >= 0 AND break_minutes <= 360)),
  tolerance_before_minutes integer CHECK (tolerance_before_minutes IS NULL OR (tolerance_before_minutes >= 0 AND tolerance_before_minutes <= 180)),
  tolerance_after_minutes  integer CHECK (tolerance_after_minutes IS NULL OR (tolerance_after_minutes >= 0 AND tolerance_after_minutes <= 180)),
  reason                   text NOT NULL CHECK (btrim(reason) <> ''),
  created_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, person_id, work_date),
  CHECK (
    type <> 'custom_shift'
    OR (start_time IS NOT NULL AND end_time IS NOT NULL)
  )
);

-- Manager scope configured by owner/admin ------------------------------
CREATE TABLE IF NOT EXISTS public.journey_manager_scopes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  manager_person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  access_mode       text NOT NULL CHECK (access_mode IN ('direct_team','projects','both')),
  active            boolean NOT NULL DEFAULT true,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, manager_person_id)
);

CREATE TABLE IF NOT EXISTS public.journey_manager_scope_projects (
  scope_id   uuid NOT NULL REFERENCES journey_manager_scopes(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_id, project_id)
);

-- Balance approval and period closing ---------------------------------
CREATE TABLE IF NOT EXISTS public.journey_balance_approvals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person_id           uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  work_date           date NOT NULL,
  provisional_minutes integer NOT NULL,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reason              text,
  decided_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, person_id, work_date)
);

CREATE TABLE IF NOT EXISTS public.journey_closing_periods (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_start      date NOT NULL,
  period_end        date NOT NULL,
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open','manager_review','rh_review','closed')),
  manager_review_at timestamptz,
  rh_review_at      timestamptz,
  closed_at         timestamptz,
  closed_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reopened_at       timestamptz,
  reopened_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reopen_reason     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, period_start, period_end),
  CHECK (period_end >= period_start)
);

CREATE TABLE IF NOT EXISTS public.journey_manager_period_reviews (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  closing_period_id uuid NOT NULL REFERENCES journey_closing_periods(id) ON DELETE CASCADE,
  manager_person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','submitted')),
  submitted_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (closing_period_id, manager_person_id)
);

-- updated_at triggers --------------------------------------------------
DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'journey_shift_templates',
    'journey_shift_assignments',
    'journey_schedule_exceptions',
    'journey_manager_scopes',
    'journey_balance_approvals',
    'journey_closing_periods',
    'journey_manager_period_reviews'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || v_table || '_updated_at', v_table);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
      'trg_' || v_table || '_updated_at',
      v_table
    );
  END LOOP;
END
$$;

-- Scope helpers --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_has_global_journey_scope()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.current_user_is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
        AND ur.organization_id = public.current_user_organization_id()
        AND r.key = 'rh'
    )
$$;

CREATE OR REPLACE FUNCTION public.current_user_can_access_journey_person(
  p_person_id uuid,
  p_require_manage boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (
    SELECT public.current_user_person_id() AS person_id
  ),
  permission_ok AS (
    SELECT CASE
      WHEN p_require_manage THEN (
        public.current_user_has_permission('people.attendance_manage')
        OR public.current_user_has_permission('people.attendance_approve')
      )
      ELSE (
        public.current_user_has_permission('people.attendance_view')
        OR public.current_user_has_permission('people.attendance_manage')
        OR public.current_user_has_permission('people.attendance_approve')
      )
    END AS ok
  )
  SELECT
    p_person_id = (SELECT person_id FROM me)
    OR public.current_user_has_global_journey_scope()
    OR (
      (SELECT ok FROM permission_ok)
      AND EXISTS (
        SELECT 1
        FROM public.journey_manager_scopes s
        JOIN me ON me.person_id = s.manager_person_id
        WHERE s.organization_id = public.current_user_organization_id()
          AND s.active
          AND (
            (
              s.access_mode IN ('direct_team','both')
              AND EXISTS (
                SELECT 1 FROM public.people target
                WHERE target.id = p_person_id
                  AND target.organization_id = s.organization_id
                  AND target.manager_person_id = s.manager_person_id
              )
            )
            OR (
              s.access_mode IN ('projects','both')
              AND EXISTS (
                SELECT 1
                FROM public.journey_manager_scope_projects sp
                JOIN public.project_allocations pa
                  ON pa.project_id = sp.project_id
                 AND pa.person_id = p_person_id
                 AND pa.organization_id = s.organization_id
                 AND pa.status IN ('draft','pending_approval','active')
                WHERE sp.scope_id = s.id
              )
            )
          )
      )
    )
$$;

CREATE OR REPLACE FUNCTION public.list_accessible_journey_people()
RETURNS TABLE (
  id uuid,
  full_name text,
  department text,
  job_title text,
  weekly_hours numeric,
  manager_person_id uuid,
  status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.full_name, p.department, p.job_title, p.weekly_hours,
         p.manager_person_id, p.status
  FROM public.people p
  WHERE p.organization_id = public.current_user_organization_id()
    AND p.status = 'active'
    AND public.current_user_can_access_journey_person(p.id, false)
  ORDER BY p.full_name
$$;

REVOKE ALL ON FUNCTION public.current_user_has_global_journey_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_can_access_journey_person(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_accessible_journey_people() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_has_global_journey_scope() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_can_access_journey_person(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_accessible_journey_people() TO authenticated;

-- RLS ------------------------------------------------------------------
ALTER TABLE public.journey_shift_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_shift_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_schedule_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_manager_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_manager_scope_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_balance_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_closing_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_manager_period_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY journey_shift_templates_select ON public.journey_shift_templates
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
    current_user_has_permission('people.attendance_view')
    OR current_user_has_permission('people.attendance_manage')
    OR current_user_has_permission('people.attendance_schedule_manage')
    OR current_user_is_admin()
  )
);
CREATE POLICY journey_shift_templates_write ON public.journey_shift_templates
FOR ALL TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('people.attendance_schedule_manage') OR current_user_is_admin())
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('people.attendance_schedule_manage') OR current_user_is_admin())
);

CREATE POLICY journey_shift_assignments_select ON public.journey_shift_assignments
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND current_user_can_access_journey_person(person_id, false)
);
CREATE POLICY journey_shift_assignments_write ON public.journey_shift_assignments
FOR ALL TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('people.attendance_schedule_manage') OR current_user_is_admin())
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('people.attendance_schedule_manage') OR current_user_is_admin())
);

CREATE POLICY journey_schedule_exceptions_select ON public.journey_schedule_exceptions
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND current_user_can_access_journey_person(person_id, false)
);
CREATE POLICY journey_schedule_exceptions_write ON public.journey_schedule_exceptions
FOR ALL TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('people.attendance_schedule_manage') OR current_user_is_admin())
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('people.attendance_schedule_manage') OR current_user_is_admin())
);

CREATE POLICY journey_manager_scopes_select ON public.journey_manager_scopes
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
    manager_person_id = current_user_person_id()
    OR current_user_has_permission('people.attendance_scope_admin')
    OR current_user_has_global_journey_scope()
  )
);
CREATE POLICY journey_manager_scopes_write ON public.journey_manager_scopes
FOR ALL TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('people.attendance_scope_admin') OR current_user_is_admin())
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('people.attendance_scope_admin') OR current_user_is_admin())
);

CREATE POLICY journey_manager_scope_projects_select ON public.journey_manager_scope_projects
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.journey_manager_scopes s
    WHERE s.id = scope_id
      AND s.organization_id = current_user_organization_id()
      AND (
        s.manager_person_id = current_user_person_id()
        OR current_user_has_permission('people.attendance_scope_admin')
        OR current_user_has_global_journey_scope()
      )
  )
);
CREATE POLICY journey_manager_scope_projects_write ON public.journey_manager_scope_projects
FOR ALL TO authenticated
USING (
  current_user_has_permission('people.attendance_scope_admin')
  OR current_user_is_admin()
)
WITH CHECK (
  current_user_has_permission('people.attendance_scope_admin')
  OR current_user_is_admin()
);

CREATE POLICY journey_balance_approvals_select ON public.journey_balance_approvals
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND current_user_can_access_journey_person(person_id, false)
);
CREATE POLICY journey_balance_approvals_write ON public.journey_balance_approvals
FOR ALL TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('people.attendance_approve')
  AND current_user_can_access_journey_person(person_id, true)
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('people.attendance_approve')
  AND current_user_can_access_journey_person(person_id, true)
);

CREATE POLICY journey_closing_periods_select ON public.journey_closing_periods
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
    current_user_has_permission('people.attendance_view')
    OR current_user_has_permission('people.attendance_manage')
    OR current_user_has_permission('people.attendance_close')
    OR current_user_is_admin()
  )
);

CREATE POLICY journey_manager_period_reviews_select ON public.journey_manager_period_reviews
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
    manager_person_id = current_user_person_id()
    OR current_user_has_permission('people.attendance_close')
    OR current_user_has_global_journey_scope()
  )
);

-- Harden attendance/evidence visibility to the configured scope.
DROP POLICY IF EXISTS attendance_select ON public.attendance_punches;
CREATE POLICY attendance_select ON public.attendance_punches
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND current_user_can_access_journey_person(person_id, false)
);

DROP POLICY IF EXISTS attendance_update ON public.attendance_punches;
CREATE POLICY attendance_update ON public.attendance_punches
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('people.attendance_manage')
  AND current_user_can_access_journey_person(person_id, true)
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND current_user_can_access_journey_person(person_id, true)
);

DROP POLICY IF EXISTS attendance_delete ON public.attendance_punches;
-- No direct DELETE policy. Fiscal punches are never physically deleted.

DROP POLICY IF EXISTS location_evidence_select ON public.location_evidence;
CREATE POLICY location_evidence_select ON public.location_evidence
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND current_user_can_access_journey_person(person_id, false)
);

DROP POLICY IF EXISTS authentication_evidence_select ON public.authentication_evidence;
CREATE POLICY authentication_evidence_select ON public.authentication_evidence
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND current_user_can_access_journey_person(person_id, false)
);

-- Transactional manager correction ------------------------------------
CREATE OR REPLACE FUNCTION public.correct_attendance_punch(
  p_original_punch_id uuid,
  p_new_occurred_at timestamptz,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_original public.attendance_punches%ROWTYPE;
  v_new_id uuid;
  v_period_closed boolean;
BEGIN
  IF btrim(coalesce(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'Informe o motivo da correção';
  END IF;

  SELECT * INTO v_original
  FROM public.attendance_punches
  WHERE id = p_original_punch_id
    AND organization_id = current_user_organization_id()
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Marcação não encontrada'; END IF;
  IF NOT current_user_has_permission('people.attendance_manage')
     OR NOT current_user_can_access_journey_person(v_original.person_id, true) THEN
    RAISE EXCEPTION 'Sem permissão para corrigir esta jornada'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_original.status IN ('corrected','cancelled') THEN
    RAISE EXCEPTION 'Esta marcação já foi corrigida ou cancelada';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.journey_closing_periods cp
    WHERE cp.organization_id = v_original.organization_id
      AND cp.status = 'closed'
      AND (v_original.occurred_at AT TIME ZONE v_original.timezone)::date
          BETWEEN cp.period_start AND cp.period_end
  ) INTO v_period_closed;
  IF v_period_closed THEN
    RAISE EXCEPTION 'A competência está fechada; reabra antes de corrigir';
  END IF;

  INSERT INTO public.attendance_punches (
    organization_id, person_id, type, occurred_at, timezone, source, status,
    original_punch_id, correction_reason, corrected_by, notes,
    device_id, location_evidence_id, authentication_evidence_id, created_by
  ) VALUES (
    v_original.organization_id, v_original.person_id, v_original.type,
    p_new_occurred_at, v_original.timezone, 'manager_adjustment', 'accepted',
    v_original.id, btrim(p_reason), auth.uid(), v_original.notes,
    v_original.device_id, v_original.location_evidence_id,
    v_original.authentication_evidence_id, auth.uid()
  )
  RETURNING id INTO v_new_id;

  UPDATE public.attendance_punches
  SET status = 'corrected',
      correction_reason = btrim(p_reason),
      corrected_by = auth.uid()
  WHERE id = v_original.id;

  INSERT INTO public.audit_logs (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    v_original.organization_id, auth.uid(), 'attendance.corrected',
    'attendance_punch', v_original.id,
    jsonb_build_object(
      'new_punch_id', v_new_id,
      'new_occurred_at', p_new_occurred_at,
      'reason', btrim(p_reason),
      'person_id', v_original.person_id
    )
  );
  RETURN v_new_id;
END
$$;

-- Employee undo: logical cancellation of the latest punch within 5 min.
CREATE OR REPLACE FUNCTION public.undo_own_attendance_punch(p_punch_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_punch public.attendance_punches%ROWTYPE;
  v_my_person uuid;
  v_latest_id uuid;
BEGIN
  v_my_person := current_user_person_id();
  IF v_my_person IS NULL THEN RAISE EXCEPTION 'Usuário sem cadastro de pessoa'; END IF;

  SELECT * INTO v_punch
  FROM public.attendance_punches
  WHERE id = p_punch_id
    AND person_id = v_my_person
    AND organization_id = current_user_organization_id()
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Marcação não encontrada'; END IF;
  IF v_punch.status NOT IN ('accepted','under_review') THEN
    RAISE EXCEPTION 'Esta marcação não pode mais ser desfeita';
  END IF;
  IF v_punch.received_at < now() - interval '5 minutes' THEN
    RAISE EXCEPTION 'O prazo de 5 minutos para desfazer expirou';
  END IF;
  IF (v_punch.occurred_at AT TIME ZONE v_punch.timezone)::date
     <> (now() AT TIME ZONE v_punch.timezone)::date THEN
    RAISE EXCEPTION 'Somente marcações de hoje podem ser desfeitas';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.journey_closing_periods cp
    WHERE cp.organization_id = v_punch.organization_id
      AND cp.status = 'closed'
      AND (v_punch.occurred_at AT TIME ZONE v_punch.timezone)::date
          BETWEEN cp.period_start AND cp.period_end
  ) THEN
    RAISE EXCEPTION 'A competência está fechada';
  END IF;

  SELECT id INTO v_latest_id
  FROM public.attendance_punches
  WHERE organization_id = v_punch.organization_id
    AND person_id = v_punch.person_id
    AND status IN ('accepted','under_review')
    AND (occurred_at AT TIME ZONE timezone)::date
        = (v_punch.occurred_at AT TIME ZONE v_punch.timezone)::date
  ORDER BY occurred_at DESC, received_at DESC
  LIMIT 1;

  IF v_latest_id IS DISTINCT FROM v_punch.id THEN
    RAISE EXCEPTION 'Somente a última marcação do dia pode ser desfeita';
  END IF;

  UPDATE public.attendance_punches
  SET status = 'cancelled',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = 'Desfeito pelo colaborador em até 5 minutos'
  WHERE id = v_punch.id;

  INSERT INTO public.audit_logs (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    v_punch.organization_id, auth.uid(), 'attendance.punch.undone_by_employee',
    'attendance_punch', v_punch.id,
    jsonb_build_object('person_id', v_punch.person_id, 'type', v_punch.type)
  );
  RETURN true;
END
$$;

-- Approval and closing transitions ------------------------------------
CREATE OR REPLACE FUNCTION public.decide_journey_balance(
  p_person_id uuid,
  p_work_date date,
  p_minutes integer,
  p_decision text,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid;
BEGIN
  IF p_decision NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'Decisão inválida';
  END IF;
  IF NOT current_user_has_permission('people.attendance_approve')
     OR NOT current_user_can_access_journey_person(p_person_id, true) THEN
    RAISE EXCEPTION 'Sem permissão para decidir este saldo'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF EXISTS (
    SELECT 1 FROM journey_closing_periods
    WHERE organization_id = current_user_organization_id()
      AND status = 'closed'
      AND p_work_date BETWEEN period_start AND period_end
  ) THEN
    RAISE EXCEPTION 'A competência está fechada';
  END IF;

  INSERT INTO journey_balance_approvals (
    organization_id, person_id, work_date, provisional_minutes,
    status, reason, decided_by, decided_at
  ) VALUES (
    current_user_organization_id(), p_person_id, p_work_date, p_minutes,
    p_decision, nullif(btrim(coalesce(p_reason,'')),''), auth.uid(), now()
  )
  ON CONFLICT (organization_id, person_id, work_date)
  DO UPDATE SET
    provisional_minutes = EXCLUDED.provisional_minutes,
    status = EXCLUDED.status,
    reason = EXCLUDED.reason,
    decided_by = EXCLUDED.decided_by,
    decided_at = EXCLUDED.decided_at
  RETURNING id INTO v_id;

  INSERT INTO audit_logs (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    current_user_organization_id(), auth.uid(),
    'journey.balance.' || p_decision, 'journey_balance_approval', v_id,
    jsonb_build_object('person_id', p_person_id, 'work_date', p_work_date, 'minutes', p_minutes)
  );
  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.transition_journey_closing_period(
  p_period_start date,
  p_period_end date,
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS public.journey_closing_periods
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period public.journey_closing_periods%ROWTYPE;
  v_me uuid := current_user_person_id();
BEGIN
  INSERT INTO journey_closing_periods (organization_id, period_start, period_end)
  VALUES (current_user_organization_id(), p_period_start, p_period_end)
  ON CONFLICT (organization_id, period_start, period_end) DO NOTHING;

  SELECT * INTO v_period
  FROM journey_closing_periods
  WHERE organization_id = current_user_organization_id()
    AND period_start = p_period_start
    AND period_end = p_period_end
  FOR UPDATE;

  IF p_action = 'start_review' THEN
    IF NOT current_user_has_permission('people.attendance_close') AND NOT current_user_is_admin() THEN
      RAISE EXCEPTION 'Sem permissão para iniciar a revisão';
    END IF;
    IF v_period.status <> 'open' THEN RAISE EXCEPTION 'A competência não está aberta'; END IF;
    UPDATE journey_closing_periods
    SET status = 'manager_review', manager_review_at = now()
    WHERE id = v_period.id;
    INSERT INTO journey_manager_period_reviews (
      organization_id, closing_period_id, manager_person_id
    )
    SELECT s.organization_id, v_period.id, s.manager_person_id
    FROM journey_manager_scopes s
    WHERE s.organization_id = v_period.organization_id AND s.active
    ON CONFLICT DO NOTHING;

  ELSIF p_action = 'submit_scope' THEN
    IF v_me IS NULL OR NOT current_user_has_permission('people.attendance_approve') THEN
      RAISE EXCEPTION 'Sem permissão para enviar o escopo';
    END IF;
    IF v_period.status <> 'manager_review' THEN RAISE EXCEPTION 'A competência não está em revisão dos gestores'; END IF;
    UPDATE journey_manager_period_reviews
    SET status = 'submitted', submitted_by = auth.uid(), submitted_at = now()
    WHERE closing_period_id = v_period.id AND manager_person_id = v_me;
    IF NOT FOUND THEN RAISE EXCEPTION 'Gestor sem escopo configurado para esta competência'; END IF;

  ELSIF p_action = 'send_to_rh' THEN
    IF NOT current_user_has_permission('people.attendance_close') AND NOT current_user_is_admin() THEN
      RAISE EXCEPTION 'Sem permissão para enviar ao RH';
    END IF;
    IF v_period.status <> 'manager_review' THEN RAISE EXCEPTION 'A competência não está em revisão dos gestores'; END IF;
    IF EXISTS (
      SELECT 1 FROM journey_manager_period_reviews
      WHERE closing_period_id = v_period.id AND status <> 'submitted'
    ) THEN
      RAISE EXCEPTION 'Ainda há gestores com revisão pendente';
    END IF;
    UPDATE journey_closing_periods
    SET status = 'rh_review', rh_review_at = now()
    WHERE id = v_period.id;

  ELSIF p_action = 'close' THEN
    IF NOT current_user_has_permission('people.attendance_close') AND NOT current_user_is_admin() THEN
      RAISE EXCEPTION 'Sem permissão para fechar a competência';
    END IF;
    IF v_period.status <> 'rh_review' THEN RAISE EXCEPTION 'A competência não está em revisão do RH'; END IF;
    IF EXISTS (
      SELECT 1 FROM journey_balance_approvals
      WHERE organization_id = v_period.organization_id
        AND work_date BETWEEN v_period.period_start AND v_period.period_end
        AND status = 'pending'
    ) THEN
      RAISE EXCEPTION 'Ainda há saldos pendentes de aprovação';
    END IF;
    UPDATE journey_closing_periods
    SET status = 'closed', closed_at = now(), closed_by = auth.uid()
    WHERE id = v_period.id;

  ELSIF p_action = 'reopen' THEN
    IF NOT current_user_has_permission('people.attendance_close') AND NOT current_user_is_admin() THEN
      RAISE EXCEPTION 'Sem permissão para reabrir a competência';
    END IF;
    IF v_period.status <> 'closed' THEN RAISE EXCEPTION 'A competência não está fechada'; END IF;
    IF btrim(coalesce(p_reason,'')) = '' THEN RAISE EXCEPTION 'Informe o motivo da reabertura'; END IF;
    UPDATE journey_closing_periods
    SET status = 'open', reopened_at = now(), reopened_by = auth.uid(),
        reopen_reason = btrim(p_reason), closed_at = NULL, closed_by = NULL
    WHERE id = v_period.id;
  ELSE
    RAISE EXCEPTION 'Ação de fechamento inválida';
  END IF;

  INSERT INTO audit_logs (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    v_period.organization_id, auth.uid(), 'journey.period.' || p_action,
    'journey_closing_period', v_period.id,
    jsonb_build_object('period_start', p_period_start, 'period_end', p_period_end, 'reason', p_reason)
  );

  SELECT * INTO v_period FROM journey_closing_periods WHERE id = v_period.id;
  RETURN v_period;
END
$$;

REVOKE ALL ON FUNCTION public.correct_attendance_punch(uuid, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.undo_own_attendance_punch(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decide_journey_balance(uuid, date, integer, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_journey_closing_period(date, date, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.correct_attendance_punch(uuid, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_own_attendance_punch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_journey_balance(uuid, date, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_journey_closing_period(date, date, text, text) TO authenticated;

COMMIT;
