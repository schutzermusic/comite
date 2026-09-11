-- Keep follow-up read helpers aligned with the bounded production executor.
-- BLOCKED and ESCALATED are quiet. WAITING_EXTERNAL_PARTY is quiet until its
-- expected event date. A null cadence produces at most one due-date nudge.

CREATE OR REPLACE FUNCTION public.apex_followup_due_nudges(
  p_organization_id uuid, p_as_of date DEFAULT CURRENT_DATE
) RETURNS TABLE (
  id uuid, state text, goal text, responsible_user_id uuid,
  due_date date, next_expected_event_at date, reason text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _uid uuid := auth.uid(); _org uuid;
BEGIN
  IF _uid IS NOT NULL THEN
    _org := public.current_user_organization_id();
    IF _org IS NULL OR _org IS DISTINCT FROM p_organization_id THEN
      RAISE EXCEPTION 'Organization outside authenticated tenant.' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN QUERY
  SELECT f.id, f.state, f.goal, f.responsible_user_id, f.due_date, f.next_expected_event_at,
         CASE WHEN f.state = 'WAITING_EXTERNAL_PARTY' THEN 'expected_event_reached'
              WHEN f.due_date IS NOT NULL AND f.due_date < p_as_of THEN 'overdue'
              ELSE 'cadence' END
    FROM public.apex_followups f
   WHERE f.organization_id = p_organization_id
     AND f.state IN ('ACTIVE','WAITING_EXTERNAL_PARTY')
     AND (f.state <> 'WAITING_EXTERNAL_PARTY'
          OR (f.next_expected_event_at IS NOT NULL AND f.next_expected_event_at <= p_as_of))
     AND (f.last_nudge_at IS NULL
          OR (f.cadence_days IS NOT NULL
              AND (p_as_of - f.last_nudge_at::date) >= f.cadence_days))
     AND (f.cadence_days IS NOT NULL
          OR (f.state = 'ACTIVE' AND f.due_date IS NOT NULL AND f.due_date <= p_as_of)
          OR (f.state = 'WAITING_EXTERNAL_PARTY'
              AND f.next_expected_event_at IS NOT NULL
              AND f.next_expected_event_at <= p_as_of));
END $$;

CREATE OR REPLACE FUNCTION public.apex_followup_should_escalate(
  p_organization_id uuid, p_as_of date DEFAULT CURRENT_DATE
) RETURNS SETOF uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _uid uuid := auth.uid(); _org uuid;
BEGIN
  IF _uid IS NOT NULL THEN
    _org := public.current_user_organization_id();
    IF _org IS NULL OR _org IS DISTINCT FROM p_organization_id THEN
      RAISE EXCEPTION 'Organization outside authenticated tenant.' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN QUERY SELECT f.id FROM public.apex_followups f
   WHERE f.organization_id = p_organization_id
     AND f.state IN ('ACTIVE','WAITING_EXTERNAL_PARTY')
     AND (f.state <> 'WAITING_EXTERNAL_PARTY'
          OR (f.next_expected_event_at IS NOT NULL AND f.next_expected_event_at <= p_as_of))
     AND f.escalate_after_days IS NOT NULL
     AND f.due_date IS NOT NULL
     AND (p_as_of - f.due_date) >= f.escalate_after_days
     AND f.escalated_at IS NULL;
END $$;

REVOKE ALL ON FUNCTION public.apex_followup_due_nudges(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apex_followup_due_nudges(uuid,date) TO authenticated;
REVOKE ALL ON FUNCTION public.apex_followup_should_escalate(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apex_followup_should_escalate(uuid,date) TO authenticated;
