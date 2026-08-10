-- ============================================================
-- ADMIN PERSON HISTORY DELETION
-- Migration: 075_admin_person_history_deletion
-- Date:      2026-07-28
-- Purpose:   Owner/admin-only, audited deletion of a person and
--            their cascaded operational history. Immutable fiscal
--            exports and the audit trail remain preserved.
-- ============================================================

BEGIN;

-- No authenticated client may delete people directly. Even owner/admin must
-- use the audited RPC below; updates (including inactivation) remain governed
-- by the existing people_update policy.
DROP POLICY IF EXISTS people_delete ON public.people;

-- Approved allowance overrides remain immutable during every normal
-- operation. The transaction-local flag can only be set by the
-- SECURITY DEFINER admin RPC below.
CREATE OR REPLACE FUNCTION public.prevent_approved_allowance_override_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_setting('app.admin_person_history_deletion', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF OLD.status = 'approved' THEN
    RAISE EXCEPTION 'Approved eligibility overrides are immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

CREATE OR REPLACE FUNCTION public.protect_approved_allowance_planning_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
BEGIN
  IF current_setting('app.admin_person_history_deletion', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  SELECT status INTO v_status
  FROM allowance_weeks
  WHERE id = OLD.allowance_week_id;

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
END
$$;

-- REP exports are fiscal evidence and are never deleted. The person FK uses
-- ON DELETE SET NULL; allow only that unlinking inside the controlled purge.
CREATE OR REPLACE FUNCTION public.prevent_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'rep_file_exports'
     AND TG_OP = 'UPDATE'
     AND current_setting('app.admin_person_history_deletion', true) = 'on' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'audit_logs é append-only: % não permitido', TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_person_history(p_person_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
  v_full_name text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'Apenas Owner / Admin pode excluir todo o histórico de uma pessoa'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_org_id := public.current_user_organization_id();

  SELECT full_name
  INTO v_full_name
  FROM public.people
  WHERE id = p_person_id
    AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pessoa não encontrada nesta organização'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- This flag is transaction-local and is reset automatically at commit/rollback.
  PERFORM set_config('app.admin_person_history_deletion', 'on', true);

  -- Preserve proof that the destructive action occurred. The audit row itself
  -- has no FK to people and remains after the person is deleted.
  INSERT INTO public.audit_logs (
    organization_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) VALUES (
    v_org_id,
    auth.uid(),
    'person.history_deleted',
    'person',
    p_person_id,
    jsonb_build_object(
      'full_name', v_full_name,
      'scope', 'all_linked_operational_history',
      'fiscal_and_audit_evidence_preserved', true
    )
  );

  DELETE FROM public.people
  WHERE id = p_person_id
    AND organization_id = v_org_id;

  RETURN jsonb_build_object(
    'person_id', p_person_id,
    'full_name', v_full_name,
    'deleted', true
  );
END
$$;

REVOKE ALL ON FUNCTION public.admin_delete_person_history(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_person_history(uuid)
  TO authenticated;

COMMIT;
