-- 165 — AI-first amendment onboarding (PDF -> Apex -> governed contractual effect)
-- Forward-only. The master contract and historical amendments are never rewritten.
BEGIN;

ALTER TABLE public.contract_documents
  ADD COLUMN IF NOT EXISTS content_sha256 text;
ALTER TABLE public.contract_documents
  ADD CONSTRAINT contract_documents_sha256_format
  CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$');
CREATE UNIQUE INDEX contract_documents_amendment_content_once
  ON public.contract_documents (organization_id, contract_id, content_sha256)
  WHERE document_type = 'amendment' AND content_sha256 IS NOT NULL
    AND superseded_by_document_id IS NULL;

ALTER TABLE public.contract_amendments
  ADD COLUMN IF NOT EXISTS documentary_state text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS analysis_state text NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS attention_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS apex_summary text,
  ADD COLUMN IF NOT EXISTS ai_extraction jsonb,
  ADD COLUMN IF NOT EXISTS ai_provider text,
  ADD COLUMN IF NOT EXISTS ai_model text,
  ADD COLUMN IF NOT EXISTS ai_pipeline_version text,
  ADD COLUMN IF NOT EXISTS ai_input_tokens bigint,
  ADD COLUMN IF NOT EXISTS ai_output_tokens bigint;

UPDATE public.contract_amendments SET documentary_state = CASE
  WHEN status IN ('signed','active') THEN 'signed'
  WHEN status = 'draft' THEN 'draft' ELSE 'unknown' END;

ALTER TABLE public.contract_amendments
  ADD CONSTRAINT contract_amendments_documentary_state_check
    CHECK (documentary_state IN ('draft','signed','unknown')),
  ADD CONSTRAINT contract_amendments_analysis_state_check
    CHECK (analysis_state IN ('not_requested','queued','reading','comparing','structuring',
      'completed','requires_attention','failed')),
  ADD CONSTRAINT contract_amendments_attention_count_check CHECK (attention_count >= 0),
  ADD CONSTRAINT contract_amendments_ai_provenance_check CHECK (
    analysis_state NOT IN ('completed','requires_attention')
    OR (ai_provider IS NOT NULL AND ai_model IS NOT NULL AND ai_pipeline_version IS NOT NULL)),
  ADD CONSTRAINT contract_amendments_ai_usage_check CHECK (
    (ai_input_tokens IS NULL OR ai_input_tokens >= 0)
    AND (ai_output_tokens IS NULL OR ai_output_tokens >= 0));
CREATE UNIQUE INDEX contract_amendments_one_canonical_document
  ON public.contract_amendments (organization_id, contract_id, document_id)
  WHERE document_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE public.contract_amendment_ingestion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL,
  document_id uuid NOT NULL,
  amendment_id uuid,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN (
    'QUEUED','READING','COMPARING','STRUCTURING','COMPLETED','REQUIRES_ATTENTION','FAILED','CANCELLED')),
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  job_id uuid,
  error_code text,
  error_safe text,
  attention_count integer NOT NULL DEFAULT 0 CHECK (attention_count >= 0),
  CONSTRAINT cair_org_id_unique UNIQUE (organization_id,id),
  CONSTRAINT cair_document_unique UNIQUE (organization_id,contract_id,document_id),
  CONSTRAINT cair_document_tenant FOREIGN KEY (organization_id,contract_id,document_id)
    REFERENCES public.contract_documents(organization_id,contract_id,id) ON DELETE RESTRICT,
  CONSTRAINT cair_amendment_tenant FOREIGN KEY (organization_id,contract_id,amendment_id)
    REFERENCES public.contract_amendments(organization_id,contract_id,id) ON DELETE RESTRICT,
  CONSTRAINT cair_job_tenant FOREIGN KEY (organization_id,job_id)
    REFERENCES public.apex_jobs(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT cair_terminal_coherent CHECK (
    (status IN ('COMPLETED','REQUIRES_ATTENTION','FAILED','CANCELLED')) = (completed_at IS NOT NULL))
);
CREATE INDEX cair_contract_recent ON public.contract_amendment_ingestion_requests
  (organization_id,contract_id,requested_at DESC);

CREATE TABLE public.contract_amendment_effects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL,
  amendment_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN (
    'value','term','scope','clause','obligation','responsible_party','measurement','billing',
    'acceptance','guarantee','insurance','indexation','retention','glosa','penalty',
    'required_document','renewal_notice','termination','sla','approval','technical_requirement',
    'evidence_requirement','other')),
  operation text NOT NULL CHECK (operation IN (
    'ADDED','MODIFIED','REPLACED','REMOVED','EXTENDED','SUPERSEDED','UNCHANGED',
    'EXPANDED','REDUCED','CLARIFIED','UNKNOWN')),
  title text NOT NULL CHECK (btrim(title) <> ''),
  description text NOT NULL,
  effect_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(effect_payload)='object'),
  source_page integer CHECK (source_page > 0),
  source_excerpt text,
  source_clause_reference text,
  source_clause_id uuid,
  replacement_clause_reference text,
  confidence numeric NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  trust_state text NOT NULL CHECK (trust_state IN ('automatic','requires_attention')),
  trust_reasons jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(trust_reasons)='array'),
  trust_policy_version text NOT NULL,
  has_conflict boolean NOT NULL DEFAULT false,
  authoritative boolean NOT NULL DEFAULT false,
  ai_provider text NOT NULL,
  ai_model text NOT NULL,
  ai_pipeline_version text NOT NULL,
  ai_fingerprint text NOT NULL CHECK (ai_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cae_org_id_unique UNIQUE (organization_id,id),
  CONSTRAINT cae_amendment_tenant FOREIGN KEY (organization_id,contract_id,amendment_id)
    REFERENCES public.contract_amendments(organization_id,contract_id,id) ON DELETE RESTRICT,
  CONSTRAINT cae_source_clause_tenant FOREIGN KEY (organization_id,contract_id,source_clause_id)
    REFERENCES public.contract_clauses(organization_id,contract_id,id) ON DELETE RESTRICT,
  CONSTRAINT cae_fingerprint_unique UNIQUE (organization_id,amendment_id,ai_fingerprint),
  CONSTRAINT cae_authority_guard CHECK (
    authoritative = false OR (
      trust_state='automatic' AND confidence >= 0.85 AND source_page IS NOT NULL
      AND length(btrim(coalesce(source_excerpt,''))) >= 8 AND has_conflict=false
      AND jsonb_array_length(trust_reasons)=0))
);
CREATE INDEX cae_amendment ON public.contract_amendment_effects
  (organization_id,contract_id,amendment_id,category);

-- Effectiveness is time-sensitive. Derive it from documentary facts instead
-- of persisting a label that becomes false at midnight.
CREATE FUNCTION public.contract_amendment_effectiveness_state(
  p_documentary_state text, p_effective_date date, p_status text, p_as_of date DEFAULT current_date
) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN p_status='cancelled' THEN 'cancelled'
    WHEN p_documentary_state<>'signed' OR p_effective_date IS NULL THEN 'indeterminate'
    WHEN p_effective_date>p_as_of THEN 'not_yet_effective'
    ELSE 'effective' END
$$;
REVOKE ALL ON FUNCTION public.contract_amendment_effectiveness_state(text,date,text,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contract_amendment_effectiveness_state(text,date,text,date) TO authenticated,service_role;

CREATE VIEW public.contract_amendment_effective_effects WITH (security_invoker=true) AS
SELECT e.*,
  public.contract_amendment_effectiveness_state(a.documentary_state,a.effective_date,a.status,current_date)
    AS effectiveness_state,
  (e.authoritative AND public.contract_amendment_effectiveness_state(
    a.documentary_state,a.effective_date,a.status,current_date)='effective') AS currently_effective
FROM public.contract_amendment_effects e
JOIN public.contract_amendments a ON a.organization_id=e.organization_id
 AND a.contract_id=e.contract_id AND a.id=e.amendment_id;

-- Browser users may read within the same contract/tenant. All writes are made
-- only by the server after the route has checked contracts.analyze_with_ai.
ALTER TABLE public.contract_amendment_ingestion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_amendment_effects ENABLE ROW LEVEL SECURITY;
CREATE POLICY cair_read ON public.contract_amendment_ingestion_requests FOR SELECT TO authenticated
  USING (organization_id=public.current_user_organization_id()
    AND public.current_user_can_read_contract(contract_id));
CREATE POLICY cae_read ON public.contract_amendment_effects FOR SELECT TO authenticated
  USING (organization_id=public.current_user_organization_id()
    AND public.current_user_can_read_contract(contract_id));
GRANT SELECT ON public.contract_amendment_ingestion_requests,
  public.contract_amendment_effects, public.contract_amendment_effective_effects TO authenticated;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.contract_amendment_ingestion_requests,
  public.contract_amendment_effects FROM PUBLIC,anon,authenticated;

CREATE TRIGGER amendment_effects_append_only BEFORE UPDATE OR DELETE ON public.contract_amendment_effects
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_mutation();

-- Creates/reuses the durable request and Apex Job in one transaction. The
-- organization argument is safe because browser roles cannot execute it.
CREATE FUNCTION public.contract_amendment_ingestion_request(
  p_organization_id uuid, p_contract_id uuid, p_document_id uuid, p_requested_by uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.contract_amendment_ingestion_requests%ROWTYPE; next_retry integer; new_job uuid;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Amendment ingestion request denied.' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contract_documents d
      WHERE d.organization_id=p_organization_id AND d.contract_id=p_contract_id
        AND d.id=p_document_id AND d.document_type='amendment'
        AND lower(d.file_path) LIKE '%.pdf') THEN
    RAISE EXCEPTION 'Canonical amendment PDF not found for this contract/tenant.'
      USING ERRCODE='23514';
  END IF;
  SELECT * INTO r FROM public.contract_amendment_ingestion_requests
   WHERE organization_id=p_organization_id AND contract_id=p_contract_id AND document_id=p_document_id
   FOR UPDATE;
  IF FOUND AND r.status IN ('QUEUED','READING','COMPARING','STRUCTURING','COMPLETED','REQUIRES_ATTENTION') THEN
    RETURN jsonb_build_object('request_id',r.id,'status',r.status,'job_id',r.job_id,
      'amendment_id',r.amendment_id,'reused',true);
  END IF;
  IF NOT FOUND THEN
    INSERT INTO public.contract_amendment_ingestion_requests
      (organization_id,contract_id,document_id,requested_by)
    VALUES (p_organization_id,p_contract_id,p_document_id,p_requested_by) RETURNING * INTO r;
    next_retry:=0;
  ELSE
    next_retry:=r.retry_count+1;
    UPDATE public.contract_amendment_ingestion_requests SET status='QUEUED',started_at=NULL,
      completed_at=NULL,error_code=NULL,error_safe=NULL,retry_count=next_retry
      WHERE id=r.id RETURNING * INTO r;
  END IF;
  SELECT public.apex_jobs_enqueue(p_organization_id,'contracts.amendment_extraction.execute',
    'amendment-extraction:'||r.id::text||':'||next_retry::text,
    jsonb_build_object('request_id',r.id,'contract_id',p_contract_id,'document_id',p_document_id),
    1,now(),3,NULL,NULL) INTO new_job;
  UPDATE public.contract_amendment_ingestion_requests SET job_id=new_job WHERE id=r.id;
  RETURN jsonb_build_object('request_id',r.id,'status','QUEUED','job_id',new_job,
    'amendment_id',r.amendment_id,'reused',false);
END $$;
REVOKE ALL ON FUNCTION public.contract_amendment_ingestion_request(uuid,uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.contract_amendment_ingestion_request(uuid,uuid,uuid,uuid) TO service_role;

-- Final interpretation + amendment + lineage + effects are one atomic commit.
-- No reviewed_by field exists here: system provenance stays system provenance.
CREATE FUNCTION public.contract_amendment_apply_ai_extraction(
  p_organization_id uuid, p_request_id uuid, p_extraction jsonb,
  p_provider text, p_model text, p_pipeline_version text,
  p_input_tokens bigint DEFAULT NULL, p_output_tokens bigint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  r public.contract_amendment_ingestion_requests%ROWTYPE; a public.contract_amendments%ROWTYPE;
  eff jsonb; identifier text; documentary_title text; doc_state text; signed_on date; effective_on date;
  parent_amendment uuid; root_id uuid; scope_text text; attention integer; final_state text;
  value_kind text; value_amount numeric; value_trust text;
  term_kind text; term_date date; term_days integer; term_trust text;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Amendment AI persistence denied.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO r FROM public.contract_amendment_ingestion_requests
   WHERE id=p_request_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Amendment request not found in tenant.' USING ERRCODE='P0002'; END IF;
  IF r.amendment_id IS NOT NULL THEN
    RETURN jsonb_build_object('amendment_id',r.amendment_id,'analysis_state',lower(r.status),
      'attention_count',r.attention_count,'reused',true);
  END IF;
  IF nullif(btrim(coalesce(p_provider,'')),'') IS NULL OR nullif(btrim(coalesce(p_model,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Apex provider/model provenance required.' USING ERRCODE='23514';
  END IF;
  identifier:=coalesce(nullif(btrim(p_extraction#>>'{amendment_identifier,value}'),''),'UNKNOWN');
  documentary_title:=nullif(btrim(p_extraction#>>'{documentary_title,value}'),'');
  doc_state:=coalesce(p_extraction#>>'{documentary_state,value}','unknown');
  IF doc_state NOT IN ('draft','signed','unknown') THEN doc_state:='unknown'; END IF;
  signed_on:=CASE WHEN (p_extraction#>>'{signature_date,value}') ~ '^\d{4}-\d{2}-\d{2}$'
    THEN (p_extraction#>>'{signature_date,value}')::date END;
  effective_on:=CASE WHEN (p_extraction#>>'{effective_date,value}') ~ '^\d{4}-\d{2}-\d{2}$'
    THEN (p_extraction#>>'{effective_date,value}')::date END;
  attention:=greatest(coalesce((p_extraction->>'attention_count')::integer,0),0);
  final_state:=CASE WHEN attention>0 THEN 'requires_attention' ELSE 'completed' END;

  SELECT e->>'kind',(e->>'amount')::numeric,e->>'trust_state'
    INTO value_kind,value_amount,value_trust FROM jsonb_array_elements(p_extraction->'effects') e
    WHERE e->>'category'='value' LIMIT 1;
  SELECT e->>'kind',CASE WHEN (e->>'new_end_date') ~ '^\d{4}-\d{2}-\d{2}$' THEN (e->>'new_end_date')::date END,
    (e->>'duration_days')::integer,e->>'trust_state'
    INTO term_kind,term_date,term_days,term_trust FROM jsonb_array_elements(p_extraction->'effects') e
    WHERE e->>'category'='term' LIMIT 1;
  SELECT string_agg(e->>'description',E'\n' ORDER BY ord) INTO scope_text
    FROM jsonb_array_elements(p_extraction->'effects') WITH ORDINALITY x(e,ord)
    WHERE e->>'category'='scope' AND e->>'trust_state'='automatic';

  INSERT INTO public.contract_amendments(
    organization_id,contract_id,amendment_number,title,document_id,status,documentary_state,
    signed_date,effective_date,value_delta,value_absolute,new_end_date,term_extension_days,
    scope_change,notes,analysis_state,attention_count,apex_summary,ai_extraction,
    ai_provider,ai_model,ai_pipeline_version,ai_input_tokens,ai_output_tokens,created_by,updated_by)
  VALUES (r.organization_id,r.contract_id,identifier,documentary_title,r.document_id,
    CASE WHEN doc_state='signed' THEN 'signed' ELSE 'draft' END,doc_state,signed_on,effective_on,
    CASE WHEN value_trust='automatic' AND value_kind='delta' THEN value_amount END,
    CASE WHEN value_trust='automatic' AND value_kind='absolute' THEN value_amount END,
    CASE WHEN term_trust='automatic' AND term_kind='new_end_date' THEN term_date END,
    CASE WHEN term_trust='automatic' AND term_kind='extension' AND term_days>0 THEN term_days END,
    scope_text,NULL,final_state,attention,p_extraction->>'apex_summary',p_extraction,
    p_provider,p_model,p_pipeline_version,p_input_tokens,p_output_tokens,r.requested_by,r.requested_by)
  RETURNING * INTO a;

  -- A predecessor is selected only when effective ordering is deterministic
  -- and the extraction reported no precedence conflict. Otherwise keep the
  -- master as parent and surface the ambiguity instead of guessing.
  IF effective_on IS NOT NULL AND jsonb_array_length(coalesce(p_extraction->'precedence_conflicts','[]'))=0 THEN
    SELECT ca.id INTO parent_amendment FROM public.contract_amendments ca
      WHERE ca.organization_id=r.organization_id AND ca.contract_id=r.contract_id
        AND ca.id<>a.id AND ca.deleted_at IS NULL AND ca.effective_date IS NOT NULL
        AND ca.effective_date<=effective_on
      ORDER BY ca.effective_date DESC,ca.amendment_number DESC,ca.id DESC LIMIT 1;
  END IF;
  IF parent_amendment IS NOT NULL THEN
    SELECT root_contract_id INTO root_id FROM public.contract_instrument_lineage
      WHERE organization_id=r.organization_id AND amendment_id=parent_amendment;
  END IF;
  root_id:=coalesce(root_id,r.contract_id);
  INSERT INTO public.contract_instrument_lineage(organization_id,contract_id,amendment_id,
    root_contract_id,parent_contract_id,parent_amendment_id,lineage_type,effective_date,
    source_document_id,source_reference,created_by)
  VALUES(r.organization_id,r.contract_id,a.id,root_id,r.contract_id,parent_amendment,
    'amendment',a.effective_date,a.document_id,'Apex AI amendment onboarding',r.requested_by);

  FOR eff IN SELECT value FROM jsonb_array_elements(coalesce(p_extraction->'effects','[]')) LOOP
    INSERT INTO public.contract_amendment_effects(
      organization_id,contract_id,amendment_id,category,operation,title,description,effect_payload,
      source_page,source_excerpt,source_clause_reference,source_clause_id,replacement_clause_reference,confidence,
      trust_state,trust_reasons,trust_policy_version,has_conflict,authoritative,
      ai_provider,ai_model,ai_pipeline_version,ai_fingerprint)
    VALUES(r.organization_id,r.contract_id,a.id,eff->>'category',eff->>'operation',
      coalesce(nullif(btrim(eff->>'title'),''),'Efeito contratual'),coalesce(eff->>'description',''),
      coalesce(eff->'payload','{}'),(eff->>'page')::integer,eff->>'excerpt',
      eff->>'source_clause_reference',CASE WHEN (eff->>'source_clause_id') ~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
        THEN (eff->>'source_clause_id')::uuid END,
      eff->>'replacement_clause_reference',(eff->>'confidence')::numeric,
      eff->>'trust_state',coalesce(eff->'trust_reasons','[]'),eff->>'trust_policy_version',
      coalesce((eff->>'conflict')::boolean,false),(eff->>'trust_state')='automatic',
      p_provider,p_model,p_pipeline_version,
      encode(digest(concat_ws('|',a.id::text,eff->>'category',eff->>'operation',
        eff->>'page',eff->>'excerpt',eff->>'description'),'sha256'),'hex'))
    ON CONFLICT (organization_id,amendment_id,ai_fingerprint) DO NOTHING;

    -- Reuse the established canonical clause lineage vocabulary. Added
    -- clauses may have no predecessor; modified/replaced/removed clauses must
    -- point to a validated canonical source id supplied in the prompt.
    IF eff->>'category'='clause' AND eff->>'trust_state'='automatic' THEN
      IF eff->>'operation'='ADDED' THEN
        INSERT INTO public.contract_amendment_clauses(
          organization_id,contract_id,amendment_id,clause_id,replacement_clause_id,effect,note,created_by)
        VALUES(r.organization_id,r.contract_id,a.id,NULL,NULL,'added',eff->>'description',r.requested_by);
      ELSIF (eff->>'source_clause_id') ~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
        AND EXISTS(SELECT 1 FROM public.contract_clauses c WHERE c.organization_id=r.organization_id
          AND c.contract_id=r.contract_id AND c.id=(eff->>'source_clause_id')::uuid) THEN
        INSERT INTO public.contract_amendment_clauses(
          organization_id,contract_id,amendment_id,clause_id,replacement_clause_id,effect,note,created_by)
        VALUES(r.organization_id,r.contract_id,a.id,(eff->>'source_clause_id')::uuid,NULL,
          CASE WHEN eff->>'operation'='REMOVED' THEN 'removed' ELSE 'altered' END,
          eff->>'description',r.requested_by)
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.contract_amendment_ingestion_requests SET amendment_id=a.id,
    status=upper(final_state),attention_count=attention,completed_at=now(),error_code=NULL,error_safe=NULL
    WHERE id=r.id AND organization_id=r.organization_id;
  RETURN jsonb_build_object('amendment_id',a.id,'analysis_state',final_state,
    'attention_count',attention,'reused',false);
END $$;
REVOKE ALL ON FUNCTION public.contract_amendment_apply_ai_extraction(
  uuid,uuid,jsonb,text,text,text,bigint,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.contract_amendment_apply_ai_extraction(
  uuid,uuid,jsonb,text,text,text,bigint,bigint) TO service_role;

COMMIT;
