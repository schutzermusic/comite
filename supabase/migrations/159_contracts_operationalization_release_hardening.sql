-- ============================================================================
-- 159 — Release hardening for Contracts Operationalization
--
-- Forward-only correction for the authority, tenant, scheduling and follow-up
-- defects found after migrations 153–158 had reached production.
-- ============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- Follow-up retry identity and verified-evidence audit
-- ---------------------------------------------------------------------------
ALTER TABLE public.apex_followups
  ADD COLUMN IF NOT EXISTS idempotency_key text;

ALTER TABLE public.apex_followups
  DROP CONSTRAINT IF EXISTS af_idempotency_key_not_blank;
ALTER TABLE public.apex_followups
  ADD CONSTRAINT af_idempotency_key_not_blank
  CHECK (idempotency_key IS NULL OR btrim(idempotency_key) <> '');

CREATE UNIQUE INDEX IF NOT EXISTS af_idempotency
  ON public.apex_followups (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.apex_followup_evidence_verifications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  followup_id            uuid NOT NULL,
  contract_id            uuid NOT NULL,
  evidence_document_id   uuid NOT NULL,
  rule_snapshot          jsonb NOT NULL CHECK (jsonb_typeof(rule_snapshot) = 'object'),
  candidate_snapshot     jsonb NOT NULL CHECK (jsonb_typeof(candidate_snapshot) = 'object'),
  verification_basis     text NOT NULL CHECK (btrim(verification_basis) <> ''),
  verified_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT afev_followup_tenant FOREIGN KEY (organization_id, followup_id)
    REFERENCES public.apex_followups (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT afev_document_tenant FOREIGN KEY (organization_id, contract_id, evidence_document_id)
    REFERENCES public.contract_documents (organization_id, contract_id, id) ON DELETE RESTRICT,
  CONSTRAINT afev_one_result UNIQUE (organization_id, followup_id, evidence_document_id)
);

ALTER TABLE public.apex_followup_evidence_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.apex_followup_evidence_verifications FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apex_followups_reject_verification_rewrite()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Verified-evidence audit is append-only.' USING ERRCODE = 'restrict_violation';
END $$;
REVOKE ALL ON FUNCTION public.apex_followups_reject_verification_rewrite() FROM PUBLIC;
DROP TRIGGER IF EXISTS afev_append_only ON public.apex_followup_evidence_verifications;
CREATE TRIGGER afev_append_only BEFORE UPDATE OR DELETE ON public.apex_followup_evidence_verifications
  FOR EACH ROW EXECUTE FUNCTION public.apex_followups_reject_verification_rewrite();

-- ---------------------------------------------------------------------------
-- Browser-callable calendar and queue functions enforce the JWT tenant.
-- Service/background calls have no auth.uid() and must scope explicitly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.organization_has_business_calendar(p_organization_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _uid uuid := auth.uid(); _org uuid;
BEGIN
  IF _uid IS NOT NULL THEN
    _org := public.current_user_organization_id();
    IF _org IS NULL OR _org IS DISTINCT FROM p_organization_id THEN
      RAISE EXCEPTION 'Organization outside authenticated tenant.' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.organization_business_calendars
     WHERE organization_id = p_organization_id
  );
END $$;

CREATE OR REPLACE FUNCTION public.organization_shift_business_days(
  p_organization_id uuid, p_from date, p_days integer
) RETURNS date
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _uid uuid := auth.uid(); _org uuid;
  weekdays smallint[]; step integer; cursor_d date := p_from;
  moved integer := 0; target integer; guard integer := 0;
BEGIN
  IF _uid IS NOT NULL THEN
    _org := public.current_user_organization_id();
    IF _org IS NULL OR _org IS DISTINCT FROM p_organization_id THEN
      RAISE EXCEPTION 'Organization outside authenticated tenant.' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF p_from IS NULL OR p_days IS NULL THEN RETURN NULL; END IF;
  SELECT business_weekdays INTO weekdays
    FROM public.organization_business_calendars WHERE organization_id = p_organization_id;
  IF weekdays IS NULL THEN RETURN NULL; END IF;
  IF p_days = 0 THEN RETURN p_from; END IF;
  step := CASE WHEN p_days > 0 THEN 1 ELSE -1 END;
  target := abs(p_days);
  WHILE moved < target LOOP
    guard := guard + 1;
    IF guard > 3650 THEN RETURN NULL; END IF;
    cursor_d := cursor_d + step;
    IF EXTRACT(isodow FROM cursor_d)::smallint = ANY (weekdays)
       AND NOT EXISTS (
         SELECT 1 FROM public.organization_non_business_days
          WHERE organization_id = p_organization_id AND day = cursor_d
       ) THEN
      moved := moved + 1;
    END IF;
  END LOOP;
  RETURN cursor_d;
END $$;

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
     AND f.state IN ('ACTIVE','WAITING_EXTERNAL_PARTY','BLOCKED','ESCALATED')
     AND (f.state <> 'WAITING_EXTERNAL_PARTY'
          OR (f.next_expected_event_at IS NOT NULL AND f.next_expected_event_at <= p_as_of))
     AND (f.last_nudge_at IS NULL OR f.cadence_days IS NULL
          OR (p_as_of - f.last_nudge_at::date) >= f.cadence_days)
     AND (f.cadence_days IS NOT NULL
          OR (f.due_date IS NOT NULL AND f.due_date <= p_as_of)
          OR (f.state = 'WAITING_EXTERNAL_PARTY' AND f.next_expected_event_at <= p_as_of));
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
     AND f.state IN ('ACTIVE','WAITING_EXTERNAL_PARTY','BLOCKED')
     AND f.escalate_after_days IS NOT NULL AND f.due_date IS NOT NULL
     AND (p_as_of - f.due_date) >= f.escalate_after_days AND f.escalated_at IS NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Terminal rows and human-stamped decision tuples are atomic.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apex_followup_valid_transition(p_from text, p_to text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_from = p_to THEN p_from NOT IN ('COMPLETED','CANCELLED')
    WHEN p_from = 'ACTIVE' THEN p_to IN ('WAITING_EXTERNAL_PARTY','BLOCKED','ESCALATED','COMPLETED','CANCELLED')
    WHEN p_from = 'WAITING_EXTERNAL_PARTY' THEN p_to IN ('ACTIVE','BLOCKED','ESCALATED','COMPLETED','CANCELLED')
    WHEN p_from = 'BLOCKED' THEN p_to IN ('ACTIVE','WAITING_EXTERNAL_PARTY','ESCALATED','COMPLETED','CANCELLED')
    WHEN p_from = 'ESCALATED' THEN p_to IN ('ACTIVE','WAITING_EXTERNAL_PARTY','BLOCKED','COMPLETED','CANCELLED')
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION public.apex_followups_guard_authority() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.state IN ('COMPLETED','CANCELLED') THEN
      RAISE EXCEPTION 'Terminal follow-ups are immutable.' USING ERRCODE = 'restrict_violation';
    END IF;
    NEW.updated_at := now();
    IF NOT public.apex_followup_valid_transition(OLD.state, NEW.state) THEN
      RAISE EXCEPTION 'Invalid follow-up transition: % -> %.', OLD.state, NEW.state
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF (TG_OP = 'INSERT' AND NEW.assigned_by IS NOT NULL)
     OR (TG_OP = 'UPDATE'
         AND (OLD.assigned_by IS NOT NULL OR NEW.assigned_by IS NOT NULL)
         AND (NEW.responsible_user_id, NEW.responsible_party_id, NEW.responsible_text,
              NEW.assigned_by, NEW.assigned_at)
             IS DISTINCT FROM
             (OLD.responsible_user_id, OLD.responsible_party_id, OLD.responsible_text,
              OLD.assigned_by, OLD.assigned_at)) THEN
    IF _uid IS NULL OR NEW.assigned_by IS DISTINCT FROM _uid THEN
      RAISE EXCEPTION 'GOVERNANCE VIOLATION: responsibility tuple requires the authenticated assigning user.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF (TG_OP = 'INSERT' AND NEW.verified_by IS NOT NULL)
     OR (TG_OP = 'UPDATE'
         AND (OLD.verified_by IS NOT NULL OR NEW.verified_by IS NOT NULL)
         AND (NEW.verification_mode, NEW.verification_rule, NEW.verified_at,
              NEW.verified_by, NEW.verification_evidence_id, NEW.closure_basis)
             IS DISTINCT FROM
             (OLD.verification_mode, OLD.verification_rule, OLD.verified_at,
              OLD.verified_by, OLD.verification_evidence_id, OLD.closure_basis)) THEN
    IF _uid IS NULL OR NEW.verified_by IS DISTINCT FROM _uid THEN
      RAISE EXCEPTION 'GOVERNANCE VIOLATION: human verification tuple requires the authenticated verifying user.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.closure_basis = 'human_confirmation'
     AND (TG_OP = 'INSERT' OR OLD.closure_basis IS DISTINCT FROM NEW.closure_basis)
     AND (_uid IS NULL OR NEW.verified_by IS DISTINCT FROM _uid) THEN
    RAISE EXCEPTION 'GOVERNANCE VIOLATION: human confirmation requires the authenticated user stamp.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.closure_basis = 'verified_evidence'
     AND (TG_OP = 'INSERT' OR OLD.closure_basis IS DISTINCT FROM NEW.closure_basis) THEN
    IF NEW.verification_mode <> 'deterministic_evidence' OR NEW.verification_evidence_id IS NULL THEN
      RAISE EXCEPTION 'GOVERNANCE VIOLATION: deterministic closure requires verified evidence.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.apex_followup_evidence_verifications v
       WHERE v.organization_id = NEW.organization_id
         AND v.followup_id = NEW.id
         AND v.evidence_document_id = NEW.verification_evidence_id
    ) THEN
      RAISE EXCEPTION 'GOVERNANCE VIOLATION: evidence was not validated by the trusted verifier.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.apex_followups_guard_authority() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.contracts_guard_review_impersonation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _uid uuid := auth.uid();
  _review_changed boolean;
  _attention_changed boolean;
BEGIN
  _review_changed := TG_OP = 'INSERT' OR
    (NEW.review_status, NEW.reviewed_by, NEW.reviewed_at)
      IS DISTINCT FROM (OLD.review_status, OLD.reviewed_by, OLD.reviewed_at);
  IF _review_changed
     AND (NEW.review_status IN ('validated','rejected') OR NEW.reviewed_by IS NOT NULL
          OR (TG_OP = 'UPDATE' AND (OLD.review_status IN ('validated','rejected') OR OLD.reviewed_by IS NOT NULL))) THEN
    IF _uid IS NULL OR NEW.reviewed_by IS DISTINCT FROM _uid THEN
      RAISE EXCEPTION 'GOVERNANCE VIOLATION: review decision and reviewer stamp are one authenticated tuple.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  _attention_changed := TG_OP = 'INSERT' OR
    (NEW.interpretation_state, NEW.attention_resolved_by, NEW.attention_resolved_at,
     NEW.attention_resolution_note)
      IS DISTINCT FROM
    (OLD.interpretation_state, OLD.attention_resolved_by, OLD.attention_resolved_at,
     OLD.attention_resolution_note);
  IF _attention_changed
     AND (NEW.interpretation_state IN ('human_confirmed','dismissed')
          OR NEW.attention_resolved_by IS NOT NULL
          OR (TG_OP = 'UPDATE' AND (OLD.interpretation_state IN ('human_confirmed','dismissed')
                                    OR OLD.attention_resolved_by IS NOT NULL))) THEN
    IF _uid IS NULL OR NEW.attention_resolved_by IS DISTINCT FROM _uid THEN
      RAISE EXCEPTION 'GOVERNANCE VIOLATION: interpretation/attention decision and human stamp are one authenticated tuple.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contracts_guard_review_impersonation() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Authenticated mutations derive actor and tenant and enforce RBAC in SQL.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apex_followup_create(
  p_idempotency_key text,
  p_source_kind text,
  p_source_id uuid,
  p_contract_id uuid,
  p_goal text,
  p_expected_evidence text DEFAULT NULL,
  p_responsible_user_id uuid DEFAULT NULL,
  p_responsible_party_id uuid DEFAULT NULL,
  p_responsible_text text DEFAULT NULL,
  p_due_date date DEFAULT NULL,
  p_cadence_days integer DEFAULT NULL,
  p_escalate_after_days integer DEFAULT NULL,
  p_escalation_target_user_id uuid DEFAULT NULL,
  p_verification_mode text DEFAULT 'human_confirmation',
  p_verification_rule jsonb DEFAULT NULL
) RETURNS public.apex_followups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _uid uuid := auth.uid(); _org uuid := public.current_user_organization_id(); _row public.apex_followups;
BEGIN
  IF _uid IS NULL OR _org IS NULL THEN
    RAISE EXCEPTION 'Creating a follow-up requires an authenticated tenant.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (public.current_user_is_admin() OR public.current_user_has_permission('contracts.edit')) THEN
    RAISE EXCEPTION 'contracts.edit permission required.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(btrim(coalesce(p_idempotency_key,''))) < 8 OR length(p_idempotency_key) > 200 THEN
    RAISE EXCEPTION 'A valid idempotency key is required.' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.apex_followups (
    organization_id, idempotency_key, source_kind, source_id, contract_id, goal,
    expected_evidence, responsible_user_id, responsible_party_id, responsible_text,
    due_date, cadence_days, escalate_after_days, escalation_target_user_id,
    verification_mode, verification_rule, state, created_by
  ) VALUES (
    _org, btrim(p_idempotency_key), p_source_kind, p_source_id, p_contract_id, p_goal,
    p_expected_evidence, p_responsible_user_id, p_responsible_party_id, p_responsible_text,
    p_due_date, p_cadence_days, p_escalate_after_days, p_escalation_target_user_id,
    p_verification_mode, p_verification_rule, 'ACTIVE', _uid
  ) ON CONFLICT (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL
    DO NOTHING RETURNING * INTO _row;

  IF NOT FOUND THEN
    SELECT * INTO _row FROM public.apex_followups
     WHERE organization_id = _org AND idempotency_key = btrim(p_idempotency_key);
    IF (_row.source_kind, _row.source_id, _row.contract_id, _row.goal)
       IS DISTINCT FROM (p_source_kind, p_source_id, p_contract_id, p_goal) THEN
      RAISE EXCEPTION 'Idempotency key was already used for a different follow-up.'
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;
  RETURN _row;
END $$;

CREATE OR REPLACE FUNCTION public.apex_followup_transition(
  p_followup_id uuid, p_next text, p_note text DEFAULT NULL,
  p_next_expected_event text DEFAULT NULL, p_next_expected_event_at date DEFAULT NULL
) RETURNS public.apex_followups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _uid uuid := auth.uid(); _org uuid := public.current_user_organization_id(); _row public.apex_followups;
BEGIN
  IF _uid IS NULL OR _org IS NULL THEN
    RAISE EXCEPTION 'Changing a follow-up requires an authenticated tenant.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (public.current_user_is_admin() OR public.current_user_has_permission('contracts.edit')) THEN
    RAISE EXCEPTION 'contracts.edit permission required.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_next = 'COMPLETED' THEN
    RAISE EXCEPTION 'Completion requires a governed verification path.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_next = 'WAITING_EXTERNAL_PARTY' AND p_next_expected_event_at IS NULL THEN
    RAISE EXCEPTION 'Waiting for an external party requires the next expected date.' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.apex_followups SET
    state = p_next, state_note = p_note,
    next_expected_event = p_next_expected_event,
    next_expected_event_at = p_next_expected_event_at,
    closed_at = CASE WHEN p_next = 'CANCELLED' THEN now() ELSE NULL END,
    escalated_at = CASE WHEN p_next = 'ESCALATED' THEN now() ELSE escalated_at END
   WHERE id = p_followup_id AND organization_id = _org
     AND state IN ('ACTIVE','WAITING_EXTERNAL_PARTY','BLOCKED','ESCALATED')
  RETURNING * INTO _row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Follow-up not found in this organization, or already terminal.' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN _row;
END $$;

CREATE OR REPLACE FUNCTION public.apex_followup_assign(
  p_followup_id uuid, p_responsible_user_id uuid DEFAULT NULL,
  p_responsible_party_id uuid DEFAULT NULL, p_responsible_text text DEFAULT NULL,
  p_due_date date DEFAULT NULL, p_cadence_days integer DEFAULT NULL,
  p_expected_evidence text DEFAULT NULL
) RETURNS public.apex_followups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _uid uuid := auth.uid(); _org uuid := public.current_user_organization_id(); _row public.apex_followups;
BEGIN
  IF _uid IS NULL OR _org IS NULL THEN
    RAISE EXCEPTION 'Assigning responsibility requires an authenticated tenant.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (public.current_user_is_admin() OR public.current_user_has_permission('contracts.edit')) THEN
    RAISE EXCEPTION 'contracts.edit permission required.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_responsible_user_id IS NULL AND p_responsible_party_id IS NULL
     AND btrim(coalesce(p_responsible_text,'')) = '' THEN
    RAISE EXCEPTION 'A governed follow-up requires a responsible party.' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.apex_followups SET
    responsible_user_id = p_responsible_user_id,
    responsible_party_id = p_responsible_party_id,
    responsible_text = p_responsible_text,
    due_date = COALESCE(p_due_date, due_date),
    cadence_days = COALESCE(p_cadence_days, cadence_days),
    expected_evidence = COALESCE(p_expected_evidence, expected_evidence),
    assigned_by = _uid, assigned_at = now()
   WHERE id = p_followup_id AND organization_id = _org
     AND state IN ('ACTIVE','WAITING_EXTERNAL_PARTY','BLOCKED','ESCALATED')
  RETURNING * INTO _row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Follow-up not found in this organization, or already terminal.' USING ERRCODE = 'no_data_found'; END IF;
  RETURN _row;
END $$;

CREATE OR REPLACE FUNCTION public.apex_followup_confirm_completion(
  p_followup_id uuid, p_note text DEFAULT NULL
) RETURNS public.apex_followups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _uid uuid := auth.uid(); _org uuid := public.current_user_organization_id(); _row public.apex_followups;
BEGIN
  IF _uid IS NULL OR _org IS NULL THEN
    RAISE EXCEPTION 'Human completion requires an authenticated tenant.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (public.current_user_is_admin() OR public.current_user_has_permission('contracts.edit')) THEN
    RAISE EXCEPTION 'contracts.edit permission required.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.apex_followups SET
    state = 'COMPLETED', closure_basis = 'human_confirmation', closed_at = now(),
    verified_at = now(), verified_by = _uid, state_note = COALESCE(p_note, state_note)
   WHERE id = p_followup_id AND organization_id = _org
     AND state IN ('ACTIVE','WAITING_EXTERNAL_PARTY','BLOCKED','ESCALATED')
  RETURNING * INTO _row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Follow-up not found in this organization, or already terminal.' USING ERRCODE = 'no_data_found'; END IF;
  RETURN _row;
END $$;

CREATE OR REPLACE FUNCTION public.contract_clause_resolve_attention(
  p_clause_id uuid, p_decision text, p_note text DEFAULT NULL
) RETURNS public.contract_clauses
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _uid uuid := auth.uid(); _org uuid := public.current_user_organization_id(); _row public.contract_clauses;
BEGIN
  IF _uid IS NULL OR _org IS NULL THEN
    RAISE EXCEPTION 'Interpretation decisions require an authenticated tenant.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (public.current_user_is_admin() OR public.current_user_has_permission('contracts.edit')) THEN
    RAISE EXCEPTION 'contracts.edit permission required.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_decision NOT IN ('confirm','dismiss','acknowledge') THEN
    RAISE EXCEPTION 'Invalid interpretation decision.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_decision = 'dismiss' AND btrim(coalesce(p_note,'')) = '' THEN
    RAISE EXCEPTION 'Dismissal requires a justification.' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.contract_clauses SET
    interpretation_state = CASE p_decision WHEN 'confirm' THEN 'human_confirmed'
                              WHEN 'dismiss' THEN 'dismissed' ELSE interpretation_state END,
    attention_resolved_by = _uid, attention_resolved_at = now(),
    attention_resolution_note = p_note, updated_by = _uid
   WHERE id = p_clause_id AND organization_id = _org RETURNING * INTO _row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Clause not found in this organization.' USING ERRCODE = 'no_data_found'; END IF;
  RETURN _row;
END $$;

-- Service-only, transactional deterministic evidence verification.
CREATE OR REPLACE FUNCTION public.apex_followup_complete_verified_evidence(
  p_followup_id uuid, p_evidence_document_id uuid,
  p_document_tax_id text DEFAULT NULL, p_valid_until date DEFAULT NULL
) RETURNS public.apex_followups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _row public.apex_followups; _expected_tax_id text; _must_cover date; _basis text := '';
BEGIN
  SELECT * INTO _row FROM public.apex_followups
   WHERE id = p_followup_id AND state IN ('ACTIVE','WAITING_EXTERNAL_PARTY','BLOCKED','ESCALATED')
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Follow-up not found or already terminal.' USING ERRCODE = 'no_data_found'; END IF;
  IF _row.verification_mode <> 'deterministic_evidence' OR _row.contract_id IS NULL THEN
    RAISE EXCEPTION 'Follow-up has no deterministic contract evidence rule.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contract_documents d
                  WHERE d.id = p_evidence_document_id
                    AND d.organization_id = _row.organization_id AND d.contract_id = _row.contract_id) THEN
    RAISE EXCEPTION 'Evidence document is outside this follow-up contract/tenant.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  _expected_tax_id := nullif(regexp_replace(coalesce(
    _row.verification_rule->>'expectedTaxId', _row.verification_rule->>'expected_tax_id'), '\D', '', 'g'), '');
  _must_cover := coalesce(_row.verification_rule->>'mustCoverDate',
                          _row.verification_rule->>'must_cover_date')::date;
  IF _expected_tax_id IS NULL AND _must_cover IS NULL THEN
    RAISE EXCEPTION 'No deterministic verification rule was defined.' USING ERRCODE = 'check_violation';
  END IF;
  IF _expected_tax_id IS NOT NULL THEN
    IF nullif(regexp_replace(coalesce(p_document_tax_id,''), '\D', '', 'g'), '') IS DISTINCT FROM _expected_tax_id THEN
      RAISE EXCEPTION 'Evidence tax identifier does not satisfy the verification rule.' USING ERRCODE = 'check_violation';
    END IF;
    _basis := 'CNPJ conferido';
  END IF;
  IF _must_cover IS NOT NULL THEN
    IF p_valid_until IS NULL OR p_valid_until < _must_cover THEN
      RAISE EXCEPTION 'Evidence validity does not cover the required date.' USING ERRCODE = 'check_violation';
    END IF;
    _basis := concat_ws(' · ', nullif(_basis,''), 'validade cobre ' || _must_cover::text);
  END IF;
  INSERT INTO public.apex_followup_evidence_verifications
    (organization_id, followup_id, contract_id, evidence_document_id,
     rule_snapshot, candidate_snapshot, verification_basis)
  VALUES (_row.organization_id, _row.id, _row.contract_id, p_evidence_document_id,
          _row.verification_rule,
          jsonb_build_object('documentTaxId', p_document_tax_id, 'validUntil', p_valid_until), _basis)
  ON CONFLICT (organization_id, followup_id, evidence_document_id) DO NOTHING;

  UPDATE public.apex_followups SET
    state = 'COMPLETED', closure_basis = 'verified_evidence', closed_at = now(),
    verified_at = now(), verified_by = NULL,
    verification_evidence_id = p_evidence_document_id, state_note = _basis
   WHERE id = _row.id RETURNING * INTO _row;
  RETURN _row;
END $$;

-- ---------------------------------------------------------------------------
-- Schedule anchoring: expected date for measurement; actual accepted_at only
-- for measurement_acceptance. Contracts reads Projects and never writes it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contract_obligations_apply_schedule_anchor(
  p_measurement_id uuid, p_organization_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m public.project_measurements%ROWTYPE; d public.contract_obligation_definitions%ROWTYPE;
  inst public.contract_obligation_instances%ROWTYPE; anchor_d date; computed date;
  conf text; basis text; updated integer := 0; affected integer; _uid uuid := auth.uid(); _org uuid;
BEGIN
  SELECT * INTO m FROM public.project_measurements WHERE id = p_measurement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Measurement does not exist.' USING ERRCODE = 'no_data_found'; END IF;
  IF p_organization_id IS NOT NULL AND p_organization_id IS DISTINCT FROM m.organization_id THEN
    RAISE EXCEPTION 'Measurement is outside the supplied organization.' USING ERRCODE = 'check_violation';
  END IF;
  IF _uid IS NOT NULL THEN
    _org := public.current_user_organization_id();
    IF _org IS NULL OR _org IS DISTINCT FROM m.organization_id THEN
      RAISE EXCEPTION 'Measurement is outside authenticated tenant.' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  FOR d IN SELECT def.* FROM public.contract_obligation_definitions def
    WHERE def.organization_id = m.organization_id AND def.contract_id = m.contract_id
      AND def.status = 'active' AND def.schedule_anchor IN ('measurement','measurement_acceptance')
  LOOP
    anchor_d := CASE d.schedule_anchor
      WHEN 'measurement' THEN m.expected_at
      WHEN 'measurement_acceptance' THEN
        CASE WHEN m.status = 'ACCEPTED' AND m.accepted_at IS NOT NULL THEN m.accepted_at::date ELSE NULL END
      ELSE NULL END;
    IF anchor_d IS NULL THEN CONTINUE; END IF;

    FOR inst IN SELECT i.* FROM public.contract_obligation_instances i
      WHERE i.definition_id = d.id AND i.organization_id = m.organization_id
        AND i.contract_id = m.contract_id AND i.date_state = 'AWAITING_SCHEDULE_ANCHOR'
        AND (i.period_start IS NULL OR anchor_d >= i.period_start)
        AND (i.period_end IS NULL OR anchor_d <= i.period_end)
      ORDER BY i.sequence
    LOOP
      IF d.calendar_basis = 'business_days' THEN
        computed := public.organization_shift_business_days(d.organization_id, anchor_d,
          CASE WHEN d.due_kind = 'days_before_schedule_anchor' THEN -d.schedule_anchor_offset_days
               ELSE d.schedule_anchor_offset_days END);
        basis := d.due_kind || ' (' || d.schedule_anchor_offset_days || ' dias úteis)';
      ELSE
        computed := CASE WHEN d.due_kind = 'days_before_schedule_anchor'
                         THEN anchor_d - d.schedule_anchor_offset_days
                         ELSE anchor_d + d.schedule_anchor_offset_days END;
        basis := d.due_kind || ' (' || d.schedule_anchor_offset_days || ' dias corridos)';
      END IF;
      conf := CASE WHEN computed IS NULL THEN 'unknown' ELSE 'known' END;
      UPDATE public.contract_obligation_instances SET
        due_date = computed, due_confidence = conf,
        due_basis = CASE WHEN computed IS NULL THEN 'regra em dias úteis sem calendário declarado pela organização' ELSE basis END,
        date_state = CASE WHEN computed IS NULL THEN 'UNKNOWN' ELSE 'RESOLVED' END,
        schedule_anchor_ref_id = m.id, schedule_anchor_date = anchor_d,
        schedule_anchor_applied_at = now(),
        activation_state = CASE WHEN computed IS NULL THEN activation_state ELSE 'activated' END,
        activated_at = CASE WHEN computed IS NULL THEN activated_at ELSE anchor_d END,
        state = CASE WHEN computed IS NOT NULL AND state = 'NOT_ACTIVATED' THEN 'OPEN' ELSE state END
       WHERE id = inst.id AND organization_id = m.organization_id
         AND date_state = 'AWAITING_SCHEDULE_ANCHOR';
      GET DIAGNOSTICS affected = ROW_COUNT;
      updated := updated + affected;
    END LOOP;
  END LOOP;
  RETURN updated;
END $$;

-- Explicit grants: authenticated gets only tenant/RBAC-bound entry points;
-- deterministic verification is callable only by the service role.
REVOKE ALL ON FUNCTION public.apex_followup_create(text,text,uuid,uuid,text,text,uuid,uuid,text,date,integer,integer,uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apex_followup_create(text,text,uuid,uuid,text,text,uuid,uuid,text,date,integer,integer,uuid,text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.apex_followup_transition(uuid,text,text,text,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apex_followup_transition(uuid,text,text,text,date) TO authenticated;
REVOKE ALL ON FUNCTION public.apex_followup_assign(uuid,uuid,uuid,text,date,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apex_followup_assign(uuid,uuid,uuid,text,date,integer,text) TO authenticated;
REVOKE ALL ON FUNCTION public.apex_followup_confirm_completion(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apex_followup_confirm_completion(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.contract_clause_resolve_attention(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_clause_resolve_attention(uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.apex_followup_complete_verified_evidence(uuid,uuid,text,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apex_followup_complete_verified_evidence(uuid,uuid,text,date) TO service_role;

REVOKE ALL ON FUNCTION public.organization_shift_business_days(uuid,date,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organization_shift_business_days(uuid,date,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.organization_has_business_calendar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organization_has_business_calendar(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.apex_followup_due_nudges(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apex_followup_due_nudges(uuid,date) TO authenticated;
REVOKE ALL ON FUNCTION public.apex_followup_should_escalate(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apex_followup_should_escalate(uuid,date) TO authenticated;
REVOKE ALL ON FUNCTION public.contract_obligations_apply_schedule_anchor(uuid,uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
