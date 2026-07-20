-- ============================================================
-- DIÁRIAS DE CAMPO — municipality security + audited overrides
-- Migration: 063_allowance_municipality_security
-- ============================================================
BEGIN;

INSERT INTO public.permissions (key, module, action, description) VALUES
  ('allowances.residence_view', 'allowances', 'residence_view', 'Visualizar município residencial validado'),
  ('allowances.residence_validate', 'allowances', 'residence_validate', 'Validar município residencial no RH'),
  ('allowances.service_municipality_manage', 'allowances', 'service_municipality_manage', 'Gerenciar município do local operacional'),
  ('allowances.override_request', 'allowances', 'override_request', 'Solicitar exceção de elegibilidade'),
  ('allowances.override_approve', 'allowances', 'override_approve', 'Aprovar exceção de elegibilidade')
ON CONFLICT (key) DO NOTHING;

WITH r AS (
  SELECT id FROM roles WHERE organization_id IS NULL AND key = 'owner_admin'
), p AS (
  SELECT id FROM permissions WHERE key IN (
    'allowances.residence_view','allowances.residence_validate',
    'allowances.service_municipality_manage','allowances.override_request','allowances.override_approve'
  )
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p ON CONFLICT DO NOTHING;

WITH r AS (
  SELECT id FROM roles WHERE organization_id IS NULL AND key = 'rh'
), p AS (
  SELECT id FROM permissions WHERE key IN (
    'allowances.residence_view','allowances.residence_validate','allowances.override_approve'
  )
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p ON CONFLICT DO NOTHING;

WITH r AS (
  SELECT id FROM roles
  WHERE organization_id IS NULL AND key IN ('gestor_projetos','engenharia_pcp')
), p AS (
  SELECT id FROM permissions WHERE key IN (
    'allowances.service_municipality_manage','allowances.override_request'
  )
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.current_user_has_project_operational_scope(p_project_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_user_is_admin()
    OR EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = p_project_id
        AND p.organization_id = current_user_organization_id()
        AND p.created_by = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM project_allocations a
      WHERE a.project_id = p_project_id
        AND a.organization_id = current_user_organization_id()
        AND a.person_id = current_user_person_id()
        AND a.status IN ('pending_approval','active')
        AND a.start_date <= current_date
        AND (a.end_date IS NULL OR a.end_date >= current_date)
    )
$$;

REVOKE ALL ON FUNCTION public.current_user_has_project_operational_scope(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_has_project_operational_scope(text) TO authenticated;

DROP POLICY IF EXISTS project_geofences_write ON public.project_geofences;
CREATE POLICY project_geofences_write ON public.project_geofences
FOR ALL TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('people.geofence_manage') OR current_user_is_admin())
  AND current_user_has_project_operational_scope(project_id)
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('people.geofence_manage') OR current_user_is_admin())
  AND current_user_has_project_operational_scope(project_id)
);

ALTER TABLE public.person_residence_municipalities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS person_residence_municipalities_select ON public.person_residence_municipalities;
CREATE POLICY person_residence_municipalities_select
ON public.person_residence_municipalities FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
    person_id = current_user_person_id()
    OR current_user_has_permission('allowances.residence_view')
    OR current_user_has_permission('allowances.residence_validate')
    OR current_user_has_permission('allowances.manage')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS person_residence_municipalities_insert ON public.person_residence_municipalities;
CREATE POLICY person_residence_municipalities_insert
ON public.person_residence_municipalities FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('allowances.residence_validate') OR current_user_is_admin())
  AND (created_by IS NULL OR created_by = auth.uid())
);

DROP POLICY IF EXISTS person_residence_municipalities_update ON public.person_residence_municipalities;
CREATE POLICY person_residence_municipalities_update
ON public.person_residence_municipalities FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('allowances.residence_validate') OR current_user_is_admin())
)
WITH CHECK (organization_id = current_user_organization_id());

CREATE TABLE IF NOT EXISTS public.allowance_eligibility_overrides (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  person_id           uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  allowance_date      date NOT NULL,
  project_id          text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  geofence_id         uuid REFERENCES project_geofences(id) ON DELETE SET NULL,
  action              text NOT NULL CHECK (action IN ('include','exclude')),
  reason              text NOT NULL CHECK (btrim(reason) <> ''),
  status              text NOT NULL DEFAULT 'pending_approval'
                        CHECK (status IN ('pending_approval','approved','rejected','cancelled')),
  requested_by        uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  approved_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (
    status <> 'approved'
    OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND approved_by <> requested_by)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS allowance_eligibility_overrides_approved_idx
  ON public.allowance_eligibility_overrides
  (organization_id, person_id, allowance_date, project_id, COALESCE(geofence_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS allowance_eligibility_overrides_lookup_idx
  ON public.allowance_eligibility_overrides
  (organization_id, person_id, allowance_date, project_id, status);

DROP TRIGGER IF EXISTS trg_allowance_eligibility_overrides_updated_at
  ON public.allowance_eligibility_overrides;
CREATE TRIGGER trg_allowance_eligibility_overrides_updated_at
BEFORE UPDATE ON public.allowance_eligibility_overrides
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION public.prevent_approved_allowance_override_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'approved' THEN
    RAISE EXCEPTION 'Approved eligibility overrides are immutable';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_approved_allowance_override_immutable
  ON public.allowance_eligibility_overrides;
CREATE TRIGGER trg_approved_allowance_override_immutable
BEFORE UPDATE OR DELETE ON public.allowance_eligibility_overrides
FOR EACH ROW EXECUTE FUNCTION public.prevent_approved_allowance_override_change();

ALTER TABLE public.allowance_eligibility_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allowance_eligibility_overrides_select ON public.allowance_eligibility_overrides;
CREATE POLICY allowance_eligibility_overrides_select
ON public.allowance_eligibility_overrides FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
    current_user_has_permission('allowances.view')
    OR current_user_has_permission('allowances.override_request')
    OR current_user_has_permission('allowances.override_approve')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS allowance_eligibility_overrides_insert ON public.allowance_eligibility_overrides;
CREATE POLICY allowance_eligibility_overrides_insert
ON public.allowance_eligibility_overrides FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND requested_by = auth.uid()
  AND (current_user_has_permission('allowances.override_request') OR current_user_is_admin())
  AND current_user_has_project_operational_scope(project_id)
);

DROP POLICY IF EXISTS allowance_eligibility_overrides_update ON public.allowance_eligibility_overrides;
CREATE POLICY allowance_eligibility_overrides_update
ON public.allowance_eligibility_overrides FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('allowances.override_approve') OR current_user_is_admin())
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (approved_by IS NULL OR approved_by = auth.uid())
);

CREATE OR REPLACE FUNCTION public.protect_approved_allowance_planning_evidence()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM allowance_weeks WHERE id = OLD.allowance_week_id;
  IF v_status IN ('finance_approved','scheduled','processing','paid','reconciliation','closed') THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Approved allowance rows cannot be deleted';
    END IF;
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.allowance_week_id IS DISTINCT FROM OLD.allowance_week_id
       OR NEW.person_id IS DISTINCT FROM OLD.person_id
       OR NEW.allocation_id IS DISTINCT FROM OLD.allocation_id
       OR NEW.policy_id IS DISTINCT FROM OLD.policy_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.geofence_id IS DISTINCT FROM OLD.geofence_id
       OR NEW.allowance_date IS DISTINCT FROM OLD.allowance_date
       OR NEW.allowance_type IS DISTINCT FROM OLD.allowance_type
       OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.eligibility_reason IS DISTINCT FROM OLD.eligibility_reason
       OR NEW.blocking_reason IS DISTINCT FROM OLD.blocking_reason
       OR NEW.schedule_evidence_source IS DISTINCT FROM OLD.schedule_evidence_source
       OR NEW.planned_evidence IS DISTINCT FROM OLD.planned_evidence
       OR NEW.rule_version IS DISTINCT FROM OLD.rule_version
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
      RAISE EXCEPTION 'Approved allowance planning evidence is immutable';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS trg_daily_allowance_approved_evidence_immutable
  ON public.daily_allowances;
CREATE TRIGGER trg_daily_allowance_approved_evidence_immutable
BEFORE UPDATE OR DELETE ON public.daily_allowances
FOR EACH ROW EXECUTE FUNCTION public.protect_approved_allowance_planning_evidence();

COMMIT;
