-- Owner/admin-only removal of a person from one allowance week.
-- Editable weeks delete their rows; approved weeks preserve evidence by
-- reversing rows and create a compensation when payment processing began.

BEGIN;

CREATE TABLE IF NOT EXISTS public.allowance_week_person_exclusions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  allowance_week_id uuid NOT NULL REFERENCES allowance_weeks(id) ON DELETE CASCADE,
  person_id       uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  reason          text NOT NULL CHECK (btrim(reason) <> ''),
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (allowance_week_id, person_id)
);

ALTER TABLE public.allowance_week_person_exclusions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allowance_week_person_exclusions_select
  ON public.allowance_week_person_exclusions;
CREATE POLICY allowance_week_person_exclusions_select
ON public.allowance_week_person_exclusions FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('allowances.view')
    OR current_user_has_permission('allowances.manage')
    OR current_user_is_admin()
  )
);

CREATE OR REPLACE FUNCTION public.admin_remove_person_from_allowance_week(
  p_week_id uuid,
  p_person_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
  v_week_status text;
  v_person_name text;
  v_affected integer := 0;
  v_compensation_cents bigint := 0;
  v_adjustment_id uuid;
  v_mode text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'Apenas Owner / Admin pode remover uma pessoa do lote de diárias'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF btrim(coalesce(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'Informe o motivo da remoção';
  END IF;

  v_org_id := public.current_user_organization_id();

  SELECT status
  INTO v_week_status
  FROM public.allowance_weeks
  WHERE id = p_week_id
    AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Semana de diárias não encontrada nesta organização'
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT full_name
  INTO v_person_name
  FROM public.people
  WHERE id = p_person_id
    AND organization_id = v_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pessoa não encontrada nesta organização'
      USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO public.allowance_week_person_exclusions (
    organization_id,
    allowance_week_id,
    person_id,
    reason,
    created_by
  ) VALUES (
    v_org_id,
    p_week_id,
    p_person_id,
    btrim(p_reason),
    auth.uid()
  )
  ON CONFLICT (allowance_week_id, person_id)
  DO UPDATE SET
    reason = EXCLUDED.reason,
    created_by = EXCLUDED.created_by,
    created_at = now();

  IF v_week_status IN ('draft', 'generated', 'manager_review', 'hr_validation', 'cancelled') THEN
    DELETE FROM public.daily_allowances
    WHERE allowance_week_id = p_week_id
      AND person_id = p_person_id
      AND organization_id = v_org_id;

    GET DIAGNOSTICS v_affected = ROW_COUNT;
    v_mode := 'removed';
  ELSE
    SELECT coalesce(sum(amount_cents), 0)
    INTO v_compensation_cents
    FROM public.daily_allowances
    WHERE allowance_week_id = p_week_id
      AND person_id = p_person_id
      AND organization_id = v_org_id
      AND status <> 'reversed'
      AND (
        payment_batch_id IS NOT NULL
        OR status IN ('included_in_batch', 'processing', 'paid', 'confirmed', 'divergent')
      );

    UPDATE public.daily_allowances
    SET
      status = 'reversed',
      reconciliation_evidence = coalesce(reconciliation_evidence, '{}'::jsonb)
        || jsonb_build_object(
          'admin_reversal', jsonb_build_object(
            'reason', btrim(p_reason),
            'reversed_by', auth.uid(),
            'reversed_at', now()
          )
        )
    WHERE allowance_week_id = p_week_id
      AND person_id = p_person_id
      AND organization_id = v_org_id
      AND status <> 'reversed';

    GET DIAGNOSTICS v_affected = ROW_COUNT;
    v_mode := 'reversed';

    IF v_compensation_cents > 0 THEN
      INSERT INTO public.allowance_adjustments (
        organization_id,
        person_id,
        source_week_id,
        type,
        amount_cents,
        reason,
        status,
        requested_by
      ) VALUES (
        v_org_id,
        p_person_id,
        p_week_id,
        'compensation',
        -v_compensation_cents,
        btrim(p_reason),
        'pending_approval',
        auth.uid()
      )
      RETURNING id INTO v_adjustment_id;
    END IF;
  END IF;

  IF v_affected = 0 THEN
    RAISE EXCEPTION 'A pessoa não possui diárias ativas nesta semana';
  END IF;

  UPDATE public.allowance_weeks
  SET
    total_people = (
      SELECT count(DISTINCT person_id)
      FROM public.daily_allowances
      WHERE allowance_week_id = p_week_id
        AND status IN (
          'planned', 'approved', 'included_in_batch', 'processing',
          'paid', 'confirmed', 'divergent', 'compensation_pending'
        )
    ),
    total_items = (
      SELECT count(*)
      FROM public.daily_allowances
      WHERE allowance_week_id = p_week_id
        AND status IN (
          'planned', 'approved', 'included_in_batch', 'processing',
          'paid', 'confirmed', 'divergent', 'compensation_pending'
        )
    ),
    total_amount_cents = (
      SELECT coalesce(sum(amount_cents), 0)
      FROM public.daily_allowances
      WHERE allowance_week_id = p_week_id
        AND status IN (
          'planned', 'approved', 'included_in_batch', 'processing',
          'paid', 'confirmed', 'divergent', 'compensation_pending'
        )
    )
  WHERE id = p_week_id;

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
    'allowance_week.person_removed',
    'allowance_week',
    p_week_id,
    jsonb_build_object(
      'person_id', p_person_id,
      'person_name', v_person_name,
      'reason', btrim(p_reason),
      'mode', v_mode,
      'affected_rows', v_affected,
      'compensation_cents', v_compensation_cents,
      'adjustment_id', v_adjustment_id
    )
  );

  RETURN jsonb_build_object(
    'mode', v_mode,
    'affected_rows', v_affected,
    'compensation_cents', v_compensation_cents,
    'adjustment_id', v_adjustment_id
  );
END
$$;

REVOKE ALL ON FUNCTION public.admin_remove_person_from_allowance_week(uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_remove_person_from_allowance_week(uuid, uuid, text)
  TO authenticated;

COMMIT;
