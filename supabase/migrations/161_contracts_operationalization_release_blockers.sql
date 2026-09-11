-- ============================================================================
-- 161 — Contracts operationalization: final confirmed release blockers
--
-- Forward-only. Migrations 153–160 are already applied and remain untouched.
-- ============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) AI requester provenance may honestly be absent.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text; c text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'contract_obligation_definitions', 'contract_billing_conditions',
    'contract_guarantees', 'contract_insurance_requirements', 'contract_indexation_rules'
  ] LOOP
    c := t || '_ai_evidence_check';
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, c);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
         ai_origin <> ''apex_ai'' OR (
           ai_analysis_id IS NOT NULL AND ai_provider IS NOT NULL AND ai_model IS NOT NULL
           AND ai_confidence IS NOT NULL AND ai_pipeline_version IS NOT NULL
           AND ai_fingerprint IS NOT NULL
           AND source_document_id IS NOT NULL AND source_page IS NOT NULL
           AND ai_evidence IS NOT NULL AND jsonb_typeof(ai_evidence) = ''object''
           AND nullif(btrim(ai_evidence->>''excerpt''), '''') IS NOT NULL
           AND (ai_evidence->>''page'')::integer = source_page
           AND (ai_evidence->>''documentId'')::uuid = source_document_id
         ))', t, c);
  END LOOP;
END $$;

-- Every interpretation is retained here. Only an `automatic` interpretation
-- may also be copied to the authority-bearing operational fact tables.
CREATE TABLE public.contract_operational_interpretations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id           uuid NOT NULL,
  analysis_id           uuid NOT NULL,
  source_document_id    uuid NOT NULL,
  family                text NOT NULL CHECK (family IN
    ('obligations','billing_conditions','guarantees','insurance_requirements','indexation_rules')),
  fingerprint           text NOT NULL CHECK (btrim(fingerprint) <> ''),
  normalized_payload    jsonb NOT NULL CHECK (jsonb_typeof(normalized_payload) = 'object'),
  source_page           integer NOT NULL CHECK (source_page > 0),
  source_excerpt        text NOT NULL CHECK (btrim(source_excerpt) <> ''),
  confidence            numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  provider              text NOT NULL,
  model                 text NOT NULL,
  pipeline_version      text NOT NULL,
  requesting_user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  trust_state           text NOT NULL CHECK (trust_state IN ('automatic','requires_attention')),
  trust_reasons         text[] NOT NULL DEFAULT ARRAY[]::text[],
  trust_policy_version  text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT copi_contract_tenant FOREIGN KEY (organization_id, contract_id)
    REFERENCES public.contracts (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT copi_document_tenant FOREIGN KEY (organization_id, contract_id, source_document_id)
    REFERENCES public.contract_documents (organization_id, contract_id, id) ON DELETE CASCADE,
  CONSTRAINT copi_analysis_tenant FOREIGN KEY (organization_id, analysis_id)
    REFERENCES public.contract_ai_analyses (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT copi_analysis_fact_unique UNIQUE (analysis_id, family, fingerprint),
  CONSTRAINT copi_trust_reasons CHECK (
    trust_reasons <@ ARRAY['low_confidence','material_financial_exposure']::text[]),
  CONSTRAINT copi_trust_coherent CHECK (
    (trust_state = 'automatic' AND cardinality(trust_reasons) = 0)
    OR (trust_state = 'requires_attention' AND cardinality(trust_reasons) > 0))
);
CREATE INDEX coi_attention ON public.contract_operational_interpretations
  (organization_id, contract_id, created_at DESC) WHERE trust_state = 'requires_attention';
ALTER TABLE public.contract_operational_interpretations ENABLE ROW LEVEL SECURITY;
CREATE POLICY coi_read ON public.contract_operational_interpretations FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id());
GRANT SELECT ON public.contract_operational_interpretations TO authenticated;
GRANT INSERT ON public.contract_operational_interpretations TO service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.contract_operational_interpretations
  FROM anon, authenticated;

-- Defense in depth: a script cannot bypass the application trust gate and put
-- a low-confidence/material AI reading directly into an authoritative table.
CREATE FUNCTION public.contracts_guard_ai_operational_authority() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE row_json jsonb := to_jsonb(NEW); exposure numeric;
BEGIN
  IF row_json->>'ai_origin' <> 'apex_ai' THEN RETURN NEW; END IF;
  IF (row_json->>'ai_confidence')::numeric < 0.75 THEN
    RAISE EXCEPTION 'AI operational fact requires attention: low confidence.'
      USING ERRCODE = 'check_violation';
  END IF;
  exposure := COALESCE(
    NULLIF(row_json->>'required_amount','')::numeric,
    NULLIF(row_json->>'required_coverage','')::numeric);
  IF exposure IS NOT NULL AND abs(exposure) >= 100000 THEN
    RAISE EXCEPTION 'AI operational fact requires attention: material financial exposure.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contracts_guard_ai_operational_authority() FROM PUBLIC;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'contract_obligation_definitions', 'contract_billing_conditions',
    'contract_guarantees', 'contract_insurance_requirements', 'contract_indexation_rules'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS guard_ai_operational_authority ON public.%I', t);
    EXECUTE format('CREATE TRIGGER guard_ai_operational_authority BEFORE INSERT ON public.%I
      FOR EACH ROW EXECUTE FUNCTION public.contracts_guard_ai_operational_authority()', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Projects schedule/acceptance -> Event Graph -> Apex Job -> Contracts.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.project_measurements_emit_schedule_anchor_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.expected_at IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.expected_at IS NOT DISTINCT FROM OLD.expected_at THEN RETURN NEW; END IF;
  PERFORM public.emit_domain_event(
    NEW.organization_id, 'projects.measurement.schedule_changed', 1,
    'project_measurement', NEW.id,
    'projects.measurement.schedule_changed:' || NEW.id::text || ':' || NEW.expected_at::text,
    jsonb_build_object('project_id', NEW.project_id, 'contract_id', NEW.contract_id,
      'expected_at', NEW.expected_at, 'revision', NEW.revision),
    now(), CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'human' END, auth.uid(),
    NEW.correlation_id, NEW.source_event_id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.project_measurements_emit_schedule_anchor_event() FROM PUBLIC;
DROP TRIGGER IF EXISTS pm_emit_schedule_anchor_insert ON public.project_measurements;
CREATE TRIGGER pm_emit_schedule_anchor_insert AFTER INSERT ON public.project_measurements
  FOR EACH ROW EXECUTE FUNCTION public.project_measurements_emit_schedule_anchor_event();
DROP TRIGGER IF EXISTS pm_emit_schedule_anchor_update ON public.project_measurements;
CREATE TRIGGER pm_emit_schedule_anchor_update AFTER UPDATE OF expected_at ON public.project_measurements
  FOR EACH ROW EXECUTE FUNCTION public.project_measurements_emit_schedule_anchor_event();

INSERT INTO public.apex_event_routes
  (event_type, schema_version, job_type, max_attempts, note) VALUES
  ('projects.measurement.schedule_changed', 1, 'contracts.obligation.schedule_anchor.apply', 5,
   'Projects owns expected_at; Contracts resolves only the contractual deadline.'),
  ('projects.measurement.accepted', 1, 'contracts.obligation.schedule_anchor.apply', 5,
   'Acceptance anchors use the immutable Projects accepted_at fact only.')
ON CONFLICT DO NOTHING;

-- Replaces only the latest function body. It still reads Projects and writes
-- Contracts, but also recalculates when Projects changes the same schedule.
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
        AND i.contract_id = m.contract_id
        AND (i.date_state = 'AWAITING_SCHEDULE_ANCHOR'
          OR (i.schedule_anchor_ref_id = m.id AND i.schedule_anchor_date IS DISTINCT FROM anchor_d))
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
         AND (date_state = 'AWAITING_SCHEDULE_ANCHOR'
           OR (schedule_anchor_ref_id = m.id AND schedule_anchor_date IS DISTINCT FROM anchor_d));
      GET DIAGNOSTICS affected = ROW_COUNT;
      updated := updated + affected;
    END LOOP;
  END LOOP;
  IF updated > 0 THEN PERFORM public.project_measurement_recompute_readiness(m.id); END IF;
  RETURN updated;
END $$;
REVOKE ALL ON FUNCTION public.contract_obligations_apply_schedule_anchor(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contract_obligations_apply_schedule_anchor(uuid,uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) Bounded Follow-up execution on Apex Jobs.
-- ---------------------------------------------------------------------------
CREATE TABLE public.apex_followup_evidence_candidates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  followup_id            uuid NOT NULL,
  contract_id            uuid NOT NULL,
  evidence_document_id   uuid NOT NULL,
  document_tax_id        text,
  valid_until            date,
  source_reference       text NOT NULL CHECK (btrim(source_reference) <> ''),
  recorded_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT afec_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT afec_followup_tenant FOREIGN KEY (organization_id, followup_id)
    REFERENCES public.apex_followups (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT afec_document_tenant FOREIGN KEY (organization_id, contract_id, evidence_document_id)
    REFERENCES public.contract_documents (organization_id, contract_id, id) ON DELETE CASCADE,
  CONSTRAINT afec_has_fact CHECK (document_tax_id IS NOT NULL OR valid_until IS NOT NULL),
  CONSTRAINT afec_unique UNIQUE (organization_id, followup_id, evidence_document_id)
);

CREATE TABLE public.apex_followup_verification_attempts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  followup_id        uuid NOT NULL,
  candidate_id       uuid NOT NULL,
  verified           boolean NOT NULL,
  basis              text NOT NULL,
  attempted_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT afva_followup_tenant FOREIGN KEY (organization_id, followup_id)
    REFERENCES public.apex_followups (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT afva_candidate_tenant FOREIGN KEY (organization_id, candidate_id)
    REFERENCES public.apex_followup_evidence_candidates (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT afva_once UNIQUE (organization_id, followup_id, candidate_id)
);
ALTER TABLE public.apex_followup_evidence_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apex_followup_verification_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.apex_followup_evidence_candidates FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.apex_followup_verification_attempts FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.apex_followup_register_evidence_candidate(
  p_organization_id uuid, p_followup_id uuid, p_evidence_document_id uuid, p_document_tax_id text DEFAULT NULL,
  p_valid_until date DEFAULT NULL, p_source_reference text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE f public.apex_followups%ROWTYPE; candidate_id uuid;
BEGIN
  SELECT * INTO f FROM public.apex_followups
   WHERE id = p_followup_id AND organization_id = p_organization_id;
  IF NOT FOUND OR f.contract_id IS NULL THEN
    RAISE EXCEPTION 'Follow-up not found or has no contract.' USING ERRCODE = 'no_data_found';
  END IF;
  IF f.verification_mode <> 'deterministic_evidence' THEN
    RAISE EXCEPTION 'Follow-up does not accept deterministic evidence.' USING ERRCODE = 'check_violation';
  END IF;
  IF nullif(btrim(coalesce(p_source_reference,'')), '') IS NULL THEN
    RAISE EXCEPTION 'Trusted evidence source reference is required.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contract_documents d
      WHERE d.id = p_evidence_document_id AND d.organization_id = f.organization_id
        AND d.contract_id = f.contract_id) THEN
    RAISE EXCEPTION 'Evidence document is outside this follow-up contract/tenant.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.apex_followup_evidence_candidates
    (organization_id, followup_id, contract_id, evidence_document_id,
     document_tax_id, valid_until, source_reference)
  VALUES (f.organization_id, f.id, f.contract_id, p_evidence_document_id,
          p_document_tax_id, p_valid_until, btrim(p_source_reference))
  ON CONFLICT (organization_id, followup_id, evidence_document_id) DO NOTHING
  RETURNING id INTO candidate_id;
  IF candidate_id IS NULL THEN
    SELECT id INTO candidate_id FROM public.apex_followup_evidence_candidates
     WHERE organization_id = f.organization_id AND followup_id = f.id
       AND evidence_document_id = p_evidence_document_id;
  END IF;
  RETURN candidate_id;
END $$;
REVOKE ALL ON FUNCTION public.apex_followup_register_evidence_candidate(uuid,uuid,uuid,text,date,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apex_followup_register_evidence_candidate(uuid,uuid,uuid,text,date,text)
  TO service_role;

CREATE FUNCTION public.apex_followups_enqueue_execution(
  p_as_of date DEFAULT current_date, p_limit integer DEFAULT 200
) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE org record; n integer := 0;
BEGIN
  IF p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'Follow-up execution limit is out of bounds.' USING ERRCODE = 'check_violation';
  END IF;
  FOR org IN SELECT DISTINCT organization_id FROM public.apex_followups
    WHERE state IN ('ACTIVE','WAITING_EXTERNAL_PARTY','BLOCKED')
  LOOP
    PERFORM public.apex_jobs_enqueue(
      org.organization_id, 'platform.followups.execute',
      'apex-followups-execute:' || org.organization_id::text || ':' || p_as_of::text,
      jsonb_build_object('as_of', p_as_of, 'limit', p_limit),
      1, now(), 5, NULL, NULL);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.apex_followups_enqueue_execution(date,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apex_followups_enqueue_execution(date,integer) TO service_role;

CREATE FUNCTION public.apex_followups_execute_due(
  p_organization_id uuid, p_as_of date DEFAULT current_date, p_limit integer DEFAULT 200
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  f public.apex_followups%ROWTYPE; candidate public.apex_followup_evidence_candidates%ROWTYPE;
  nudged integer := 0; escalated integer := 0; verified integer := 0;
  checked integer := 0; closed_by_evidence boolean; failure text;
BEGIN
  IF p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'Follow-up execution limit is out of bounds.' USING ERRCODE = 'check_violation';
  END IF;
  FOR f IN SELECT * FROM public.apex_followups
    WHERE organization_id = p_organization_id
      AND state IN ('ACTIVE','WAITING_EXTERNAL_PARTY','BLOCKED')
    ORDER BY COALESCE(next_expected_event_at, due_date, 'infinity'::date), created_at, id
    LIMIT p_limit FOR UPDATE SKIP LOCKED
  LOOP
    checked := checked + 1;
    closed_by_evidence := false;

    IF f.verification_mode = 'deterministic_evidence' THEN
      FOR candidate IN SELECT c.* FROM public.apex_followup_evidence_candidates c
        WHERE c.organization_id = f.organization_id AND c.followup_id = f.id
          AND NOT EXISTS (SELECT 1 FROM public.apex_followup_verification_attempts a
            WHERE a.organization_id = c.organization_id AND a.followup_id = c.followup_id
              AND a.candidate_id = c.id)
        ORDER BY c.recorded_at, c.id
      LOOP
        BEGIN
          PERFORM public.apex_followup_complete_verified_evidence(
            f.id, candidate.evidence_document_id, candidate.document_tax_id, candidate.valid_until);
          INSERT INTO public.apex_followup_verification_attempts
            (organization_id, followup_id, candidate_id, verified, basis)
          VALUES (f.organization_id, f.id, candidate.id, true, 'deterministic rule satisfied');
          verified := verified + 1;
          closed_by_evidence := true;
        EXCEPTION WHEN check_violation OR insufficient_privilege THEN
          GET STACKED DIAGNOSTICS failure = MESSAGE_TEXT;
          INSERT INTO public.apex_followup_verification_attempts
            (organization_id, followup_id, candidate_id, verified, basis)
          VALUES (f.organization_id, f.id, candidate.id, false, left(failure, 1000));
        END;
        EXIT WHEN closed_by_evidence;
      END LOOP;
    END IF;
    IF closed_by_evidence THEN CONTINUE; END IF;

    -- BLOCKED changes only when deterministic evidence above changes the fact.
    IF f.state = 'BLOCKED' THEN CONTINUE; END IF;
    -- The expected external event suppresses every timed action until it is due.
    IF f.state = 'WAITING_EXTERNAL_PARTY'
       AND (f.next_expected_event_at IS NULL OR f.next_expected_event_at > p_as_of) THEN
      CONTINUE;
    END IF;

    IF f.escalate_after_days IS NOT NULL AND f.due_date IS NOT NULL
       AND (p_as_of - f.due_date) >= f.escalate_after_days AND f.escalated_at IS NULL THEN
      UPDATE public.apex_followups SET state = 'ESCALATED', escalated_at = p_as_of::timestamptz,
        state_note = 'Política determinística de escalonamento atingida.'
       WHERE id = f.id AND organization_id = f.organization_id AND escalated_at IS NULL;
      IF FOUND THEN escalated := escalated + 1; END IF;
      CONTINUE;
    END IF;

    IF (f.last_nudge_at IS NULL
        OR (f.cadence_days IS NOT NULL AND (p_as_of - f.last_nudge_at::date) >= f.cadence_days))
       AND ((f.state = 'WAITING_EXTERNAL_PARTY' AND f.next_expected_event_at <= p_as_of)
         OR (f.state = 'ACTIVE' AND (
           (f.due_date IS NOT NULL AND f.due_date <= p_as_of) OR f.cadence_days IS NOT NULL))) THEN
      UPDATE public.apex_followups SET last_nudge_at = p_as_of::timestamptz,
        nudge_count = nudge_count + 1
       WHERE id = f.id AND organization_id = f.organization_id
         AND (last_nudge_at IS NULL
           OR (cadence_days IS NOT NULL AND (p_as_of - last_nudge_at::date) >= cadence_days));
      IF FOUND THEN nudged := nudged + 1; END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('checked', checked, 'nudged', nudged,
    'escalated', escalated, 'verified', verified, 'as_of', p_as_of);
END $$;
REVOKE ALL ON FUNCTION public.apex_followups_execute_due(uuid,date,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apex_followups_execute_due(uuid,date,integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Append-only means no browser rewrite, not broken privileged cascades.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apex_followups_reject_history_rewrite() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_user NOT IN ('authenticated','anon') THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Histórico de acompanhamento é append-only.' USING ERRCODE = 'restrict_violation';
END $$;
REVOKE ALL ON FUNCTION public.apex_followups_reject_history_rewrite() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.apex_followups_reject_verification_rewrite() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_user NOT IN ('authenticated','anon') THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Verified-evidence audit is append-only.' USING ERRCODE = 'restrict_violation';
END $$;
REVOKE ALL ON FUNCTION public.apex_followups_reject_verification_rewrite() FROM PUBLIC;

CREATE TRIGGER afva_append_only BEFORE UPDATE OR DELETE ON public.apex_followup_verification_attempts
  FOR EACH ROW EXECUTE FUNCTION public.apex_followups_reject_verification_rewrite();

COMMIT;
