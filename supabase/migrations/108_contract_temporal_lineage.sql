-- Contracts V2 Phase 2: immutable instrument lineage and amendment history.
-- No business facts, dates, classifications or historical clause text are backfilled.
BEGIN;

CREATE UNIQUE INDEX contracts_org_id_phase2 ON public.contracts(organization_id,id);
CREATE UNIQUE INDEX clauses_org_contract_id_phase2 ON public.contract_clauses(organization_id,contract_id,id);
CREATE UNIQUE INDEX documents_org_contract_id_phase2 ON public.contract_documents(organization_id,contract_id,id);
CREATE UNIQUE INDEX amendments_org_contract_id_phase2 ON public.contract_amendments(organization_id,contract_id,id);
CREATE UNIQUE INDEX milestones_org_contract_id_phase2 ON public.contract_milestones(organization_id,contract_id,id);

ALTER TABLE public.contract_clauses ADD CONSTRAINT clauses_contract_tenant_phase2
 FOREIGN KEY(organization_id,contract_id) REFERENCES public.contracts(organization_id,id);
ALTER TABLE public.contract_clauses ADD CONSTRAINT clauses_source_document_contract_phase2
 FOREIGN KEY(organization_id,contract_id,source_document_id) REFERENCES public.contract_documents(organization_id,contract_id,id);
ALTER TABLE public.contract_documents ADD CONSTRAINT documents_contract_tenant_phase2
 FOREIGN KEY(organization_id,contract_id) REFERENCES public.contracts(organization_id,id);
ALTER TABLE public.contract_amendments ADD CONSTRAINT amendments_contract_tenant_phase2
 FOREIGN KEY(organization_id,contract_id) REFERENCES public.contracts(organization_id,id);
ALTER TABLE public.contract_amendments ADD CONSTRAINT amendments_document_contract_phase2
 FOREIGN KEY(organization_id,contract_id,document_id) REFERENCES public.contract_documents(organization_id,contract_id,id);

-- Contract scope comes deterministically from the existing amendment, never user text.
ALTER TABLE public.contract_amendment_clauses ADD COLUMN contract_id uuid;
UPDATE public.contract_amendment_clauses l SET contract_id=a.contract_id
 FROM public.contract_amendments a WHERE a.id=l.amendment_id AND a.organization_id=l.organization_id;
ALTER TABLE public.contract_amendment_clauses ALTER COLUMN contract_id SET NOT NULL;
ALTER TABLE public.contract_amendment_clauses ADD CONSTRAINT links_amendment_contract_phase2
 FOREIGN KEY(organization_id,contract_id,amendment_id) REFERENCES public.contract_amendments(organization_id,contract_id,id);
ALTER TABLE public.contract_amendment_clauses ADD CONSTRAINT links_clause_contract_phase2
 FOREIGN KEY(organization_id,contract_id,clause_id) REFERENCES public.contract_clauses(organization_id,contract_id,id);
ALTER TABLE public.contract_amendment_clauses ADD CONSTRAINT links_replacement_contract_phase2
 FOREIGN KEY(organization_id,contract_id,replacement_clause_id) REFERENCES public.contract_clauses(organization_id,contract_id,id);
ALTER TABLE public.contract_amendment_clauses ADD CONSTRAINT links_no_self_replacement_phase2
 CHECK(clause_id IS NULL OR replacement_clause_id IS NULL OR clause_id<>replacement_clause_id);
CREATE UNIQUE INDEX links_unique_target_phase2 ON public.contract_amendment_clauses(amendment_id,clause_id) WHERE clause_id IS NOT NULL;

CREATE FUNCTION public.contracts_fill_clause_link_scope() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.contract_id IS NULL THEN
   SELECT contract_id INTO NEW.contract_id FROM public.contract_amendments
    WHERE id=NEW.amendment_id AND organization_id=NEW.organization_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER contracts_fill_clause_link_scope BEFORE INSERT ON public.contract_amendment_clauses
 FOR EACH ROW EXECUTE FUNCTION public.contracts_fill_clause_link_scope();

CREATE FUNCTION public.contracts_reject_history_mutation() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'Contractual history is append-only: %', TG_TABLE_NAME USING ERRCODE='23514'; END $$;
CREATE TRIGGER amendment_clause_history_immutable BEFORE UPDATE OR DELETE ON public.contract_amendment_clauses
 FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_mutation();

CREATE TABLE public.contract_amendment_revisions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 contract_id uuid NOT NULL,
 amendment_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0),
 amendment_snapshot jsonb NOT NULL CHECK(jsonb_typeof(amendment_snapshot)='object'),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,contract_id,amendment_id) REFERENCES public.contract_amendments(organization_id,contract_id,id),
 UNIQUE(amendment_id,revision)
);
CREATE INDEX amendment_revisions_scope ON public.contract_amendment_revisions(organization_id,contract_id,amendment_id,revision);
CREATE TRIGGER amendment_revisions_immutable BEFORE UPDATE OR DELETE ON public.contract_amendment_revisions
 FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_mutation();

-- Re-parenting is also structurally impossible: the immutable revision ledger holds a
-- composite FK to (organization_id, contract_id, id). This BEFORE guard runs first so the
-- refusal names the contractual reason instead of the referential one.
CREATE FUNCTION public.contracts_reject_amendment_reparenting() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.contract_id<>OLD.contract_id THEN
  RAISE EXCEPTION 'Amendment ownership and identity are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER amendment_identity_immutable BEFORE UPDATE ON public.contract_amendments
 FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_amendment_reparenting();

-- Row update serialization gives each amendment a monotonic revision number.
-- SECURITY DEFINER only writes snapshots of trigger OLD/NEW, never caller JSON.
CREATE FUNCTION public.contracts_capture_amendment_revision() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE next_revision integer;
BEGIN
 SELECT coalesce(max(revision),0)+1 INTO next_revision FROM public.contract_amendment_revisions WHERE amendment_id=NEW.id;
 IF TG_OP='UPDATE' AND next_revision=1 THEN
  INSERT INTO public.contract_amendment_revisions(organization_id,contract_id,amendment_id,revision,amendment_snapshot,recorded_at)
   VALUES(OLD.organization_id,OLD.contract_id,OLD.id,1,to_jsonb(OLD),now());
  next_revision:=2;
 END IF;
 INSERT INTO public.contract_amendment_revisions(organization_id,contract_id,amendment_id,revision,amendment_snapshot)
  VALUES(NEW.organization_id,NEW.contract_id,NEW.id,next_revision,to_jsonb(NEW));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contracts_capture_amendment_revision() FROM PUBLIC;
CREATE TRIGGER capture_amendment_revision AFTER INSERT OR UPDATE ON public.contract_amendments
 FOR EACH ROW EXECUTE FUNCTION public.contracts_capture_amendment_revision();
CREATE TRIGGER amendment_no_hard_delete BEFORE DELETE ON public.contract_amendments
 FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_mutation();
-- Baseline snapshot recording time is now; actual original timestamps remain in JSON.
INSERT INTO public.contract_amendment_revisions(organization_id,contract_id,amendment_id,revision,amendment_snapshot,recorded_at)
 SELECT organization_id,contract_id,id,1,to_jsonb(a),now() FROM public.contract_amendments a;

CREATE TABLE public.contract_instrument_lineage(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 contract_id uuid NOT NULL,
 amendment_id uuid,
 root_contract_id uuid NOT NULL,
 parent_contract_id uuid NOT NULL,
 parent_amendment_id uuid,
 lineage_type text NOT NULL CHECK(lineage_type IN ('amendment','renewal','extension')),
 effective_date date,
 source_document_id uuid,
 source_reference text,
 created_by uuid REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,contract_id) REFERENCES public.contracts(organization_id,id),
 FOREIGN KEY(organization_id,root_contract_id) REFERENCES public.contracts(organization_id,id),
 FOREIGN KEY(organization_id,parent_contract_id) REFERENCES public.contracts(organization_id,id),
 FOREIGN KEY(organization_id,contract_id,amendment_id) REFERENCES public.contract_amendments(organization_id,contract_id,id),
 FOREIGN KEY(organization_id,parent_contract_id,parent_amendment_id) REFERENCES public.contract_amendments(organization_id,contract_id,id),
 FOREIGN KEY(organization_id,contract_id,source_document_id) REFERENCES public.contract_documents(organization_id,contract_id,id),
 CHECK((amendment_id IS NOT NULL AND lineage_type='amendment' AND parent_contract_id=contract_id)
    OR (amendment_id IS NULL AND lineage_type IN ('renewal','extension') AND parent_contract_id<>contract_id)),
 CHECK(amendment_id IS NULL OR parent_amendment_id IS NULL OR amendment_id<>parent_amendment_id)
);
CREATE UNIQUE INDEX lineage_one_contract_parent ON public.contract_instrument_lineage(contract_id) WHERE amendment_id IS NULL;
CREATE UNIQUE INDEX lineage_one_amendment_parent ON public.contract_instrument_lineage(amendment_id) WHERE amendment_id IS NOT NULL;
CREATE INDEX lineage_root_scope ON public.contract_instrument_lineage(organization_id,root_contract_id,effective_date,id);
CREATE INDEX lineage_parent ON public.contract_instrument_lineage(organization_id,parent_contract_id,parent_amendment_id);
CREATE TRIGGER lineage_immutable BEFORE UPDATE OR DELETE ON public.contract_instrument_lineage
 FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_mutation();

-- Parents must already exist, so cycles cannot be introduced by concurrent inserts.
-- A root used by an existing edge cannot later acquire a parent.
CREATE FUNCTION public.contracts_validate_instrument_lineage() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE parent_root uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text,108));
 IF NEW.amendment_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.contract_amendments a
  WHERE a.id=NEW.amendment_id AND a.effective_date IS DISTINCT FROM NEW.effective_date) THEN
  RAISE EXCEPTION 'Lineage effective date must match the source instrument when recorded' USING ERRCODE='23514';
 END IF;
 IF NEW.amendment_id IS NULL AND EXISTS(SELECT 1 FROM public.contract_instrument_lineage WHERE root_contract_id=NEW.contract_id) THEN
  RAISE EXCEPTION 'A declared lineage root cannot acquire a parent' USING ERRCODE='23514';
 END IF;
 IF NEW.parent_amendment_id IS NOT NULL THEN
  SELECT root_contract_id INTO parent_root FROM public.contract_instrument_lineage
   WHERE organization_id=NEW.organization_id AND amendment_id=NEW.parent_amendment_id;
  IF parent_root IS NULL THEN RAISE EXCEPTION 'Parent amendment lineage must be recorded first' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT root_contract_id INTO parent_root FROM public.contract_instrument_lineage
   WHERE organization_id=NEW.organization_id AND contract_id=NEW.parent_contract_id AND amendment_id IS NULL;
  parent_root:=coalesce(parent_root,NEW.parent_contract_id);
 END IF;
 IF NEW.root_contract_id<>parent_root THEN RAISE EXCEPTION 'Ambiguous lineage root' USING ERRCODE='23514'; END IF;
 IF NEW.amendment_id IS NULL AND NEW.contract_id=parent_root THEN
  RAISE EXCEPTION 'Contract lineage cycle' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contracts_validate_instrument_lineage() FROM PUBLIC;
CREATE TRIGGER validate_instrument_lineage BEFORE INSERT ON public.contract_instrument_lineage
 FOR EACH ROW EXECUTE FUNCTION public.contracts_validate_instrument_lineage();

ALTER TABLE public.contract_amendment_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY amendment_revisions_read ON public.contract_amendment_revisions FOR SELECT TO authenticated
 USING(organization_id=public.current_user_organization_id() AND public.current_user_can_read_contract(contract_id));
REVOKE INSERT,UPDATE,DELETE ON public.contract_amendment_revisions FROM authenticated,anon;
GRANT SELECT ON public.contract_amendment_revisions TO authenticated;
ALTER TABLE public.contract_instrument_lineage ENABLE ROW LEVEL SECURITY;
CREATE POLICY lineage_read ON public.contract_instrument_lineage FOR SELECT TO authenticated
 USING(organization_id=public.current_user_organization_id() AND public.current_user_can_read_contract(contract_id));
CREATE POLICY lineage_insert ON public.contract_instrument_lineage FOR INSERT TO authenticated
 WITH CHECK(organization_id=public.current_user_organization_id()
 AND (public.current_user_is_admin() OR public.current_user_has_permission('contracts.edit'))
 AND public.current_user_can_read_contract(contract_id) AND public.current_user_can_read_contract(parent_contract_id)
 AND public.current_user_can_read_contract(root_contract_id));
GRANT SELECT,INSERT ON public.contract_instrument_lineage TO authenticated;
REVOKE UPDATE,DELETE ON public.contract_instrument_lineage FROM authenticated,anon;
-- Atomic creation keeps the existing amendment authoritative; no second instrument system.
CREATE FUNCTION public.create_contract_amendment_with_lineage(p_payload jsonb,p_parent_amendment_id uuid DEFAULT NULL)
 RETURNS SETOF public.contract_amendments LANGUAGE plpgsql SET search_path=public AS $$
DECLARE a public.contract_amendments; root_id uuid; org_id uuid;
BEGIN
 org_id:=public.current_user_organization_id();
 IF org_id IS NULL OR auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated organization required' USING ERRCODE='42501'; END IF;
 INSERT INTO public.contract_amendments(organization_id,contract_id,amendment_number,title,document_id,status,
 signed_date,effective_date,value_delta,value_absolute,new_end_date,term_extension_days,scope_change,notes,created_by,updated_by)
 VALUES(org_id,(p_payload->>'contract_id')::uuid,p_payload->>'amendment_number',p_payload->>'title',
 (p_payload->>'document_id')::uuid,coalesce(p_payload->>'status','draft'),(p_payload->>'signed_date')::date,
 (p_payload->>'effective_date')::date,(p_payload->>'value_delta')::numeric,(p_payload->>'value_absolute')::numeric,
 (p_payload->>'new_end_date')::date,(p_payload->>'term_extension_days')::integer,p_payload->>'scope_change',
 p_payload->>'notes',auth.uid(),auth.uid()) RETURNING * INTO a;
 IF p_parent_amendment_id IS NOT NULL THEN
  SELECT root_contract_id INTO root_id FROM public.contract_instrument_lineage
   WHERE organization_id=org_id AND contract_id=a.contract_id AND amendment_id=p_parent_amendment_id;
  IF root_id IS NULL THEN RAISE EXCEPTION 'Explicit parent amendment lineage is unavailable' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT root_contract_id INTO root_id FROM public.contract_instrument_lineage
   WHERE organization_id=org_id AND contract_id=a.contract_id AND amendment_id IS NULL;
  root_id:=coalesce(root_id,a.contract_id);
 END IF;
 INSERT INTO public.contract_instrument_lineage(organization_id,contract_id,amendment_id,root_contract_id,
 parent_contract_id,parent_amendment_id,lineage_type,effective_date,source_document_id,created_by)
 VALUES(org_id,a.contract_id,a.id,root_id,a.contract_id,p_parent_amendment_id,'amendment',a.effective_date,a.document_id,auth.uid());
 RETURN NEXT a;
END $$;
REVOKE ALL ON FUNCTION public.create_contract_amendment_with_lineage(jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_contract_amendment_with_lineage(jsonb,uuid) TO authenticated;
COMMIT;
