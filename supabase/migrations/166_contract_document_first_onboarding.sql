-- 166 — Document-first contract onboarding
-- The original PDF is preserved before interpretation; a contract is created only
-- after governed human exceptions are resolved. No Finance/Fiscal/Project writes.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS contract_documents_original_content_once
  ON public.contract_documents (organization_id, content_sha256)
  WHERE document_type='contract' AND content_sha256 IS NOT NULL
    AND superseded_by_document_id IS NULL;

CREATE TABLE public.contract_onboarding_intakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  file_name text NOT NULL CHECK (btrim(file_name)<>''),
  file_path text NOT NULL UNIQUE CHECK (btrim(file_path)<>''),
  file_size bigint NOT NULL CHECK (file_size>0 AND file_size<=31457280),
  mime_type text NOT NULL CHECK (mime_type='application/pdf'),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN (
    'RECEIVED','QUEUED','READING','STRUCTURING','READY','REQUIRES_ATTENTION','FAILED','REGISTERED','CANCELLED')),
  extraction jsonb CHECK (extraction IS NULL OR jsonb_typeof(extraction)='object'),
  structured_result jsonb CHECK (structured_result IS NULL OR jsonb_typeof(structured_result)='object'),
  final_values jsonb CHECK (final_values IS NULL OR jsonb_typeof(final_values)='object'),
  attention_count integer NOT NULL DEFAULT 0 CHECK (attention_count>=0),
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count>=0),
  job_id uuid,
  contract_id uuid,
  error_code text,
  error_safe text,
  ai_provider text,
  ai_model text,
  ai_pipeline_version text,
  trust_policy_version text,
  ai_input_tokens bigint CHECK (ai_input_tokens IS NULL OR ai_input_tokens>=0),
  ai_output_tokens bigint CHECK (ai_output_tokens IS NULL OR ai_output_tokens>=0),
  received_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  registered_at timestamptz,
  CONSTRAINT coni_org_id_unique UNIQUE (organization_id,id),
  CONSTRAINT coni_content_actor_unique UNIQUE (organization_id,uploaded_by,content_sha256),
  CONSTRAINT coni_job_tenant FOREIGN KEY (organization_id,job_id)
    REFERENCES public.apex_jobs(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT coni_contract_tenant FOREIGN KEY (organization_id,contract_id)
    REFERENCES public.contracts(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT coni_registration_coherent CHECK (
    (status='REGISTERED')=(contract_id IS NOT NULL AND registered_at IS NOT NULL)),
  CONSTRAINT coni_apex_provenance CHECK (
    status NOT IN ('READY','REQUIRES_ATTENTION','REGISTERED')
    OR (status='REGISTERED' AND extraction IS NULL)
    OR (ai_provider IS NOT NULL AND ai_model IS NOT NULL
      AND ai_pipeline_version IS NOT NULL AND trust_policy_version IS NOT NULL))
);
CREATE INDEX coni_org_recent ON public.contract_onboarding_intakes(organization_id,received_at DESC);

ALTER TABLE public.contract_onboarding_intakes ENABLE ROW LEVEL SECURITY;
CREATE POLICY coni_read_own ON public.contract_onboarding_intakes FOR SELECT TO authenticated
  USING (organization_id=public.current_user_organization_id() AND uploaded_by=auth.uid()
    AND public.current_user_has_permission('contracts.create'));
GRANT SELECT ON public.contract_onboarding_intakes TO authenticated;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.contract_onboarding_intakes FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.contract_onboarding_enqueue(
  p_organization_id uuid, p_intake_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.contract_onboarding_intakes%ROWTYPE; new_job uuid; next_retry integer;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Contract onboarding enqueue denied.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO r FROM public.contract_onboarding_intakes
    WHERE organization_id=p_organization_id AND id=p_intake_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contract intake not found in tenant.' USING ERRCODE='P0002'; END IF;
  IF r.status IN ('QUEUED','READING','STRUCTURING','READY','REQUIRES_ATTENTION','REGISTERED') THEN
    RETURN jsonb_build_object('intake_id',r.id,'status',r.status,'job_id',r.job_id,'reused',true);
  END IF;
  next_retry:=CASE WHEN r.status='FAILED' THEN r.retry_count+1 ELSE r.retry_count END;
  UPDATE public.contract_onboarding_intakes SET status='QUEUED',retry_count=next_retry,
    started_at=NULL,completed_at=NULL,error_code=NULL,error_safe=NULL
    WHERE id=r.id AND organization_id=r.organization_id;
  SELECT public.apex_jobs_enqueue(r.organization_id,'contracts.onboarding_extraction.execute',
    'contract-onboarding:'||r.id::text||':'||next_retry::text,
    jsonb_build_object('intake_id',r.id),1,now(),3,NULL,NULL) INTO new_job;
  UPDATE public.contract_onboarding_intakes SET job_id=new_job
    WHERE id=r.id AND organization_id=r.organization_id;
  RETURN jsonb_build_object('intake_id',r.id,'status','QUEUED','job_id',new_job,'reused',false);
END $$;
REVOKE ALL ON FUNCTION public.contract_onboarding_enqueue(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.contract_onboarding_enqueue(uuid,uuid) TO service_role;

-- Contract + immutable original document are committed together. The stored raw extraction
-- remains untouched; final_values records the authorized human outcome beside it.
CREATE FUNCTION public.contract_onboarding_finalize(
  p_organization_id uuid, p_intake_id uuid, p_actor uuid, p_final jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.contract_onboarding_intakes%ROWTYPE; c public.contracts%ROWTYPE; d public.contract_documents%ROWTYPE;
  owner_id uuid; project_ref text; party_id uuid; risk text; contract_status text; existing_document_id uuid;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Contract onboarding finalization denied.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO r FROM public.contract_onboarding_intakes
    WHERE organization_id=p_organization_id AND id=p_intake_id FOR UPDATE;
  IF NOT FOUND OR r.uploaded_by<>p_actor THEN
    RAISE EXCEPTION 'Contract intake not found in tenant.' USING ERRCODE='P0002';
  END IF;
  IF r.contract_id IS NOT NULL THEN
    SELECT id INTO existing_document_id FROM public.contract_documents
      WHERE organization_id=r.organization_id AND contract_id=r.contract_id
        AND content_sha256=r.content_sha256 AND document_type='contract'
      ORDER BY created_at LIMIT 1;
    RETURN jsonb_build_object('contract_id',r.contract_id,'document_id',existing_document_id,'reused',true);
  END IF;
  IF r.status NOT IN ('READY','REQUIRES_ATTENTION','FAILED') THEN
    RAISE EXCEPTION 'Contract intake is not ready for registration.' USING ERRCODE='23514';
  END IF;
  IF nullif(btrim(p_final->>'title'),'') IS NULL
    OR nullif(btrim(p_final->>'contract_number'),'') IS NULL
    OR nullif(btrim(p_final->>'counterparty_name'),'') IS NULL
    OR nullif(btrim(p_final->>'contract_type'),'') IS NULL
    OR nullif(btrim(p_final->>'total_value'),'') IS NULL THEN
    RAISE EXCEPTION 'Required contract fields are unresolved.' USING ERRCODE='23514';
  END IF;
  owner_id:=nullif(p_final->>'owner_user_id','')::uuid;
  IF owner_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.organization_memberships m
      WHERE m.organization_id=p_organization_id AND m.user_id=owner_id AND m.status='ACTIVE') THEN
    RAISE EXCEPTION 'Internal responsible person must be an active organization member.' USING ERRCODE='23514';
  END IF;
  project_ref:=nullif(p_final->>'project_id','');
  IF project_ref IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projects p
      WHERE p.organization_id=p_organization_id AND p.id=project_ref) THEN
    RAISE EXCEPTION 'Related project is outside this organization.' USING ERRCODE='23514';
  END IF;
  party_id:=nullif(p_final->>'counterparty_party_id','')::uuid;
  IF party_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.parties p
      WHERE p.organization_id=p_organization_id AND p.id=party_id) THEN
    RAISE EXCEPTION 'Counterparty is outside this organization.' USING ERRCODE='23514';
  END IF;
  risk:=p_final->>'risk_level';
  IF risk NOT IN ('low','medium','high') THEN
    RAISE EXCEPTION 'Risk classification requires a governed human decision.' USING ERRCODE='23514';
  END IF;
  contract_status:=p_final->>'status';
  IF contract_status NOT IN ('negotiation','legal_review','commercial_review','signed','active','cancelled','expired') THEN
    RAISE EXCEPTION 'Contract status is unresolved.' USING ERRCODE='23514';
  END IF;

  INSERT INTO public.contracts(organization_id,project_id,title,contract_number,counterparty_name,
    counterparty_party_id,contract_type,status,lifecycle_stage,start_date,end_date,signed_date,renewal_date,
    currency,total_value,monthly_value,payment_terms,scope_summary,risk_level,owner_user_id,created_by,updated_by,data_class)
  VALUES(p_organization_id,project_ref,p_final->>'title',p_final->>'contract_number',
    p_final->>'counterparty_name',party_id,p_final->>'contract_type',contract_status,'created',
    nullif(p_final->>'start_date','')::date,nullif(p_final->>'end_date','')::date,
    nullif(p_final->>'signed_date','')::date,nullif(p_final->>'renewal_date','')::date,
    coalesce(nullif(p_final->>'currency',''),'BRL'),(p_final->>'total_value')::numeric,
    nullif(p_final->>'monthly_value','')::numeric,nullif(p_final->>'payment_terms',''),
    nullif(p_final->>'scope_summary',''),risk,owner_id,p_actor,p_actor,'unclassified') RETURNING * INTO c;

  INSERT INTO public.contract_documents(organization_id,contract_id,title,file_path,document_type,status,
    uploaded_by,content_sha256)
  VALUES(p_organization_id,c.id,r.file_name,r.file_path,'contract','uploaded',p_actor,r.content_sha256)
  RETURNING * INTO d;
  UPDATE public.contract_onboarding_intakes SET status='REGISTERED',contract_id=c.id,
    final_values=p_final,registered_at=now() WHERE id=r.id AND organization_id=r.organization_id;
  RETURN jsonb_build_object('contract_id',c.id,'document_id',d.id,'reused',false);
END $$;
REVOKE ALL ON FUNCTION public.contract_onboarding_finalize(uuid,uuid,uuid,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.contract_onboarding_finalize(uuid,uuid,uuid,jsonb) TO service_role;

COMMIT;
