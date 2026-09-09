-- ============================================================================
-- 153 — Clause review impersonation guard
--
-- GOVERNANCE: An AI agent, script, service-role connection, migration, or
-- backend process must never set review_status to 'validated' or 'rejected'
-- and thereby create human approval/review evidence. Only an authenticated
-- user session (Supabase JWT via auth.uid()) can make review decisions.
--
-- In addition, reviewed_by can never be set to an arbitrary user:
-- it must match the authenticated session user auth.uid().
--
-- This trigger fires BEFORE INSERT OR UPDATE on contract_clauses.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION contracts_guard_review_impersonation()
RETURNS TRIGGER AS $$
DECLARE
  _decision_states TEXT[] := ARRAY['validated', 'rejected'];
  _session_uid UUID;
BEGIN
  _session_uid := auth.uid();

  -- Guard 1: Transition into decision state (validated or rejected)
  IF NEW.review_status = ANY(_decision_states) THEN
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.review_status IS DISTINCT FROM NEW.review_status) THEN
      -- Block 1A: No authenticated session → service-role / migration / script
      IF _session_uid IS NULL THEN
        RAISE EXCEPTION
          'GOVERNANCE VIOLATION: review_status cannot be set to "%" without an authenticated user session (auth.uid() is NULL). '
          'AI agents, scripts, service-role connections, and migrations must not impersonate human reviewers.',
          NEW.review_status
        USING ERRCODE = 'insufficient_privilege';
      END IF;

      -- Block 1B: reviewed_by must match the session user — no impersonation
      IF NEW.reviewed_by IS DISTINCT FROM _session_uid THEN
        RAISE EXCEPTION
          'GOVERNANCE VIOLATION: reviewed_by (%) does not match the authenticated session user (%). '
          'The reviewer stamp must be the actual user making the decision.',
          NEW.reviewed_by, _session_uid
        USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
  END IF;

  -- Guard 2: Setting or changing reviewed_by to any user
  IF NEW.reviewed_by IS NOT NULL THEN
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.reviewed_by IS DISTINCT FROM NEW.reviewed_by) THEN
      IF _session_uid IS NULL THEN
        RAISE EXCEPTION
          'GOVERNANCE VIOLATION: reviewed_by cannot be set without an authenticated user session (auth.uid() is NULL). '
          'AI agents, scripts, service-role connections, and migrations must not impersonate human reviewers.'
        USING ERRCODE = 'insufficient_privilege';
      END IF;

      IF NEW.reviewed_by IS DISTINCT FROM _session_uid THEN
        RAISE EXCEPTION
          'GOVERNANCE VIOLATION: reviewed_by (%) does not match the authenticated session user (%). '
          'Cannot assign review attribution to an arbitrary user.',
          NEW.reviewed_by, _session_uid
        USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION contracts_guard_review_impersonation() IS
  'Prevents AI agents, scripts, and service-role connections from fabricating '
  'human review decisions or reviewer attribution on contract clauses. '
  'Only authenticated user sessions can set review_status to validated/rejected '
  'or set reviewed_by.';

-- Drop if exists to make migration idempotent
DROP TRIGGER IF EXISTS guard_review_impersonation ON contract_clauses;

CREATE TRIGGER guard_review_impersonation
  BEFORE INSERT OR UPDATE ON contract_clauses
  FOR EACH ROW
  EXECUTE FUNCTION contracts_guard_review_impersonation();

COMMIT;
