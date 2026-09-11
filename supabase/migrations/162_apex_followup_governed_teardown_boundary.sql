-- ============================================================================
-- 162 — Follow-up history: direct service deletion vs governed teardown
--
-- 161 restored FK cascades. This narrows that privilege: direct DELETE remains
-- forbidden even to service/owner paths; only an actual parent cascade or the
-- explicit governed follow-up teardown function may erase the aggregate.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.apex_followups_reject_history_rewrite() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_user NOT IN ('authenticated','anon')
     AND (pg_trigger_depth() > 1
       OR current_setting('apex.governed_followup_teardown', true) = 'on') THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Histórico de acompanhamento é append-only.' USING ERRCODE = 'restrict_violation';
END $$;
REVOKE ALL ON FUNCTION public.apex_followups_reject_history_rewrite() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.apex_followups_reject_verification_rewrite() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_user NOT IN ('authenticated','anon')
     AND (pg_trigger_depth() > 1
       OR current_setting('apex.governed_followup_teardown', true) = 'on') THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Verified-evidence audit is append-only.' USING ERRCODE = 'restrict_violation';
END $$;
REVOKE ALL ON FUNCTION public.apex_followups_reject_verification_rewrite() FROM PUBLIC;

CREATE FUNCTION public.apex_followups_guard_teardown() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user NOT IN ('authenticated','anon')
     AND (pg_trigger_depth() > 1
       OR current_setting('apex.governed_followup_teardown', true) = 'on') THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Follow-up deletion requires governed teardown.' USING ERRCODE = 'restrict_violation';
END $$;
REVOKE ALL ON FUNCTION public.apex_followups_guard_teardown() FROM PUBLIC;
DROP TRIGGER IF EXISTS af_governed_teardown ON public.apex_followups;
CREATE TRIGGER af_governed_teardown BEFORE DELETE ON public.apex_followups
  FOR EACH ROW EXECUTE FUNCTION public.apex_followups_guard_teardown();

CREATE FUNCTION public.apex_followup_delete_governed(
  p_organization_id uuid, p_followup_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM set_config('apex.governed_followup_teardown', 'on', true);
  DELETE FROM public.apex_followups
   WHERE organization_id = p_organization_id AND id = p_followup_id;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.apex_followup_delete_governed(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apex_followup_delete_governed(uuid,uuid) TO service_role;

COMMIT;
