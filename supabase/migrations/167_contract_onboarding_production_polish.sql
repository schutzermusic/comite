-- 167 — Contract document-first onboarding: canonical People responsibility
--
-- Additive only. Existing owner_user_id and project JSON remain available for
-- backwards compatibility. No existing row is backfilled: responsibility is a
-- governed human choice and must never be fabricated from historical actors.

BEGIN;

-- The compact People form needs no login. Phone belongs to the canonical
-- People record and remains optional, like email, job title and department.
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS phone text;

-- Composite tenant keys make cross-organization responsibility impossible at
-- the relational boundary. The id is already globally unique; this additional
-- key exists specifically so dependants can include organization_id in the FK.
ALTER TABLE public.people
  ADD CONSTRAINT people_org_id_unique UNIQUE (organization_id, id);

ALTER TABLE public.contracts
  ADD COLUMN owner_person_id uuid;

ALTER TABLE public.projects
  ADD COLUMN responsible_person_id uuid;

ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_owner_person_tenant_fk
  FOREIGN KEY (organization_id, owner_person_id)
  REFERENCES public.people(organization_id, id)
  ON DELETE RESTRICT;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_responsible_person_tenant_fk
  FOREIGN KEY (organization_id, responsible_person_id)
  REFERENCES public.people(organization_id, id)
  ON DELETE RESTRICT;

CREATE INDEX contracts_owner_person_idx
  ON public.contracts(organization_id, owner_person_id)
  WHERE owner_person_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX projects_responsible_person_idx
  ON public.projects(organization_id, responsible_person_id)
  WHERE responsible_person_id IS NOT NULL;

-- Minimum table privileges needed by the canonical browser services. RLS is
-- still the authority: people.manage and projects.create policies decide who
-- may insert, and organization policies decide which rows may be returned.
REVOKE ALL ON TABLE public.people, public.projects FROM anon;
GRANT SELECT, INSERT ON TABLE public.people, public.projects TO authenticated;

-- A responsibility may point only to an active canonical Person. SECURITY
-- DEFINER is intentional: callers with contracts/projects permission but no
-- people.view must still be checked without receiving broader People access.
CREATE FUNCTION public.enforce_active_business_responsible_person()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE responsible_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'contracts' THEN
    responsible_id := NEW.owner_person_id;
  ELSIF TG_TABLE_NAME = 'projects' THEN
    responsible_id := NEW.responsible_person_id;
  ELSE
    RAISE EXCEPTION 'Unsupported responsibility relation: %.', TG_TABLE_NAME;
  END IF;

  IF responsible_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.people p
    WHERE p.organization_id = NEW.organization_id
      AND p.id = responsible_id
      AND p.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Business responsible person must be active in the same organization.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.enforce_active_business_responsible_person()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER contracts_active_owner_person
BEFORE INSERT OR UPDATE OF organization_id, owner_person_id ON public.contracts
FOR EACH ROW EXECUTE FUNCTION public.enforce_active_business_responsible_person();

CREATE TRIGGER projects_active_responsible_person
BEFORE INSERT OR UPDATE OF organization_id, responsible_person_id ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.enforce_active_business_responsible_person();

-- Active responsibility remains an invariant after assignment too: a Person
-- cannot be inactivated until their contracts/projects have been reassigned.
CREATE FUNCTION public.prevent_inactive_business_responsible_person()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'active' AND NEW.status <> 'active' AND (
    EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.organization_id = NEW.organization_id
        AND c.owner_person_id = NEW.id
        AND c.deleted_at IS NULL
    ) OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.organization_id = NEW.organization_id
        AND p.responsible_person_id = NEW.id
    )
  ) THEN
    RAISE EXCEPTION 'Reassign active contract/project responsibility before inactivating this person.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.prevent_inactive_business_responsible_person()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER people_keep_business_responsibility_active
BEFORE UPDATE OF status ON public.people
FOR EACH ROW EXECUTE FUNCTION public.prevent_inactive_business_responsible_person();

-- Limited directories expose only the fields required by onboarding. They let
-- a contract creator select an existing Person/Project without granting broad
-- Workforce or Projects-table access. Tenant and capability checks are inside
-- the definer boundary; neither function writes or bypasses create policies.
CREATE FUNCTION public.contract_onboarding_responsible_people_directory()
RETURNS TABLE (
  id uuid, full_name text, email text, phone text, job_title text, department text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE org_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT (
       public.current_user_is_admin()
    OR public.current_user_has_permission('contracts.create')
    OR public.current_user_has_permission('projects.create')
    OR public.current_user_has_permission('people.manage')
  ) THEN
    RAISE EXCEPTION 'Responsible People directory denied.' USING ERRCODE='42501';
  END IF;
  org_id := public.current_user_organization_id();
  RETURN QUERY
    SELECT p.id, p.full_name, p.email, p.phone, p.job_title, p.department
    FROM public.people p
    WHERE p.organization_id=org_id AND p.status='active'
    ORDER BY p.full_name;
END
$$;

REVOKE ALL ON FUNCTION public.contract_onboarding_responsible_people_directory()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_onboarding_responsible_people_directory()
  TO authenticated;

CREATE FUNCTION public.contract_onboarding_project_directory()
RETURNS TABLE (
  id text, name text, code text, counterparty text, scope_summary text,
  responsible_person_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE org_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT (
       public.current_user_is_admin()
    OR public.current_user_has_permission('contracts.create')
    OR public.current_user_has_permission('projects.view_all')
    OR public.current_user_has_permission('projects.view_assigned')
  ) THEN
    RAISE EXCEPTION 'Project directory denied.' USING ERRCODE='42501';
  END IF;
  org_id := public.current_user_organization_id();
  RETURN QUERY
    SELECT p.id, p.project->>'nome', p.project->>'codigo', p.project->>'cliente',
      p.project->>'descricao', p.responsible_person_id
    FROM public.projects p
    WHERE p.organization_id=org_id
    ORDER BY p.updated_at DESC;
END
$$;

REVOKE ALL ON FUNCTION public.contract_onboarding_project_directory()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_onboarding_project_directory()
  TO authenticated;

-- Same canonical finalization path introduced by 166. auth.uid()/p_actor is
-- still the actor; owner_person_id is independent business responsibility.
-- owner_user_id remains nullable and accepted for backwards compatibility.
CREATE OR REPLACE FUNCTION public.contract_onboarding_finalize(
  p_organization_id uuid, p_intake_id uuid, p_actor uuid, p_final jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.contract_onboarding_intakes%ROWTYPE; c public.contracts%ROWTYPE; d public.contract_documents%ROWTYPE;
  owner_id uuid; owner_person_id uuid; project_ref text; party_id uuid; risk text;
  contract_status text; existing_document_id uuid;
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

  owner_person_id:=nullif(p_final->>'owner_person_id','')::uuid;
  owner_id:=nullif(p_final->>'owner_user_id','')::uuid;
  IF owner_person_id IS NULL AND owner_id IS NULL THEN
    RAISE EXCEPTION 'Contract responsible person is unresolved.' USING ERRCODE='23514';
  END IF;
  IF owner_person_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.people p
    WHERE p.organization_id=p_organization_id AND p.id=owner_person_id AND p.status='active'
  ) THEN
    RAISE EXCEPTION 'Contract responsible person must be active in the same organization.' USING ERRCODE='23514';
  END IF;
  IF owner_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.organization_memberships m
    WHERE m.organization_id=p_organization_id AND m.user_id=owner_id AND m.status='ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Legacy contract owner must be an active organization member.' USING ERRCODE='23514';
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
    currency,total_value,monthly_value,payment_terms,scope_summary,risk_level,owner_user_id,owner_person_id,
    created_by,updated_by,data_class)
  VALUES(p_organization_id,project_ref,p_final->>'title',p_final->>'contract_number',
    p_final->>'counterparty_name',party_id,p_final->>'contract_type',contract_status,'created',
    nullif(p_final->>'start_date','')::date,nullif(p_final->>'end_date','')::date,
    nullif(p_final->>'signed_date','')::date,nullif(p_final->>'renewal_date','')::date,
    coalesce(nullif(p_final->>'currency',''),'BRL'),(p_final->>'total_value')::numeric,
    nullif(p_final->>'monthly_value','')::numeric,nullif(p_final->>'payment_terms',''),
    nullif(p_final->>'scope_summary',''),risk,owner_id,owner_person_id,p_actor,p_actor,'unclassified') RETURNING * INTO c;

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
