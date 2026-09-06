-- Contracts V2 Phase 2: typed contractual definitions only. No operational states.
-- Facts are append-only. NULL remains unknown; legal intervals are [from, until).
BEGIN;

-- A predecessor may be inherited from a proven ancestor, never a sibling.
-- Composite FK enforces organization; this trigger adds contract ancestry and chronology.
CREATE FUNCTION public.contracts_validate_fact_predecessor() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE prior_contract uuid; prior_effective date; inherited boolean;
BEGIN
 IF NEW.predecessor_id IS NULL THEN RETURN NEW; END IF;
 EXECUTE format('SELECT contract_id,effective_from FROM public.%I WHERE organization_id=$1 AND id=$2',TG_TABLE_NAME)
  INTO prior_contract,prior_effective USING NEW.organization_id,NEW.predecessor_id;
 IF prior_contract IS NULL THEN RAISE EXCEPTION 'Predecessor must already exist' USING ERRCODE='23503'; END IF;
 IF prior_contract<>NEW.contract_id THEN
  WITH RECURSIVE ancestors(id) AS (
   SELECT parent_contract_id FROM public.contract_instrument_lineage
    WHERE organization_id=NEW.organization_id AND contract_id=NEW.contract_id AND amendment_id IS NULL
   UNION
   SELECT l.parent_contract_id FROM public.contract_instrument_lineage l JOIN ancestors a ON l.contract_id=a.id
    WHERE l.organization_id=NEW.organization_id AND l.amendment_id IS NULL
  ) SELECT EXISTS(SELECT 1 FROM ancestors WHERE id=prior_contract) INTO inherited;
  IF NOT inherited THEN RAISE EXCEPTION 'Fact predecessor belongs to an unrelated contract' USING ERRCODE='23514'; END IF;
 END IF;
 IF prior_effective IS NOT NULL AND NEW.effective_from IS NOT NULL AND NEW.effective_from<prior_effective THEN
  RAISE EXCEPTION 'Fact successor cannot precede its predecessor' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contracts_validate_fact_predecessor() FROM PUBLIC;

CREATE TABLE public.contract_guarantees(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 contract_id uuid NOT NULL,
 title text NOT NULL CHECK(btrim(title)<>''),
 source_amendment_id uuid,
 source_clause_id uuid,
 source_document_id uuid,
 source_reference text,
 source_page integer CHECK(source_page>0),
 effective_from date,
 effective_until date,
 predecessor_id uuid,
 effect text NOT NULL DEFAULT 'added' CHECK(effect IN ('added','altered','removed')),
 created_by uuid REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 guarantee_type text,
 required_amount numeric CHECK(required_amount NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)) CHECK(required_amount>=0),
 required_percentage numeric CHECK(required_percentage NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)) CHECK(required_percentage>=0 AND required_percentage<=100),
 percentage_basis text,
 currency text CHECK(currency ~ '^[A-Z]{3}$'),
 issuer_party_id uuid,
 beneficiary_party_id uuid,
 validity_start date,
 validity_end date,
 renewal_required boolean,
 evidence_document_id uuid,
 CHECK(required_amount IS NULL OR required_percentage IS NULL),
 CHECK(required_percentage IS NULL OR nullif(btrim(percentage_basis),'') IS NOT NULL),
 CHECK(validity_start IS NULL OR validity_end IS NULL OR validity_end>=validity_start),
 FOREIGN KEY(organization_id,issuer_party_id) REFERENCES public.parties(organization_id,id),
 FOREIGN KEY(organization_id,beneficiary_party_id) REFERENCES public.parties(organization_id,id),
 FOREIGN KEY(organization_id,contract_id,evidence_document_id) REFERENCES public.contract_documents(organization_id,contract_id,id),
 UNIQUE(organization_id,contract_id,id),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,contract_id) REFERENCES public.contracts(organization_id,id),
 FOREIGN KEY(organization_id,contract_id,source_amendment_id) REFERENCES public.contract_amendments(organization_id,contract_id,id),
 FOREIGN KEY(organization_id,contract_id,source_clause_id) REFERENCES public.contract_clauses(organization_id,contract_id,id),
 FOREIGN KEY(organization_id,contract_id,source_document_id) REFERENCES public.contract_documents(organization_id,contract_id,id),
 FOREIGN KEY(organization_id,predecessor_id) REFERENCES public.contract_guarantees(organization_id,id),
 CHECK(source_clause_id IS NOT NULL OR source_document_id IS NOT NULL OR nullif(btrim(source_reference),'') IS NOT NULL),
 CHECK(source_page IS NULL OR source_document_id IS NOT NULL),
 CHECK(effective_from IS NULL OR effective_until IS NULL OR effective_until>effective_from),
 CHECK((effect='added' AND predecessor_id IS NULL) OR (effect IN ('altered','removed') AND predecessor_id IS NOT NULL)),
 CHECK(predecessor_id IS NULL OR predecessor_id<>id)
);
CREATE UNIQUE INDEX contract_guarantees_successor ON public.contract_guarantees(contract_id,predecessor_id) WHERE predecessor_id IS NOT NULL;
CREATE INDEX contract_guarantees_scope ON public.contract_guarantees(organization_id,contract_id,effective_from,id);
CREATE INDEX contract_guarantees_amendment ON public.contract_guarantees(source_amendment_id) WHERE source_amendment_id IS NOT NULL;
CREATE TRIGGER validate_predecessor BEFORE INSERT ON public.contract_guarantees
 FOR EACH ROW EXECUTE FUNCTION public.contracts_validate_fact_predecessor();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON public.contract_guarantees
 FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_mutation();
ALTER TABLE public.contract_guarantees ENABLE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.contract_guarantees FOR SELECT TO authenticated
 USING(organization_id=public.current_user_organization_id() AND public.current_user_can_read_contract(contract_id));
CREATE POLICY scoped_insert ON public.contract_guarantees FOR INSERT TO authenticated
 WITH CHECK(organization_id=public.current_user_organization_id() AND public.current_user_can_read_contract(contract_id)
 AND (public.current_user_is_admin() OR public.current_user_has_permission('contracts.edit')));
GRANT SELECT,INSERT ON public.contract_guarantees TO authenticated;
REVOKE UPDATE,DELETE ON public.contract_guarantees FROM authenticated,anon;

CREATE TABLE public.contract_insurance_requirements(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 contract_id uuid NOT NULL,
 title text NOT NULL CHECK(btrim(title)<>''),
 source_amendment_id uuid,
 source_clause_id uuid,
 source_document_id uuid,
 source_reference text,
 source_page integer CHECK(source_page>0),
 effective_from date,
 effective_until date,
 predecessor_id uuid,
 effect text NOT NULL DEFAULT 'added' CHECK(effect IN ('added','altered','removed')),
 created_by uuid REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 insurance_type text,
 required_coverage numeric CHECK(required_coverage NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)) CHECK(required_coverage>=0),
 currency text CHECK(currency ~ '^[A-Z]{3}$'),
 insured_party_id uuid,
 insurer_party_id uuid,
 policy_required boolean,
 validity_requirement text,
 FOREIGN KEY(organization_id,insured_party_id) REFERENCES public.parties(organization_id,id),
 FOREIGN KEY(organization_id,insurer_party_id) REFERENCES public.parties(organization_id,id),
 UNIQUE(organization_id,contract_id,id),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,contract_id) REFERENCES public.contracts(organization_id,id),
 FOREIGN KEY(organization_id,contract_id,source_amendment_id) REFERENCES public.contract_amendments(organization_id,contract_id,id),
 FOREIGN KEY(organization_id,contract_id,source_clause_id) REFERENCES public.contract_clauses(organization_id,contract_id,id),
 FOREIGN KEY(organization_id,contract_id,source_document_id) REFERENCES public.contract_documents(organization_id,contract_id,id),
 FOREIGN KEY(organization_id,predecessor_id) REFERENCES public.contract_insurance_requirements(organization_id,id),
 CHECK(source_clause_id IS NOT NULL OR source_document_id IS NOT NULL OR nullif(btrim(source_reference),'') IS NOT NULL),
 CHECK(source_page IS NULL OR source_document_id IS NOT NULL),
 CHECK(effective_from IS NULL OR effective_until IS NULL OR effective_until>effective_from),
 CHECK((effect='added' AND predecessor_id IS NULL) OR (effect IN ('altered','removed') AND predecessor_id IS NOT NULL)),
 CHECK(predecessor_id IS NULL OR predecessor_id<>id)
);
CREATE UNIQUE INDEX contract_insurance_requirements_successor ON public.contract_insurance_requirements(contract_id,predecessor_id) WHERE predecessor_id IS NOT NULL;
CREATE INDEX contract_insurance_requirements_scope ON public.contract_insurance_requirements(organization_id,contract_id,effective_from,id);
CREATE INDEX contract_insurance_requirements_amendment ON public.contract_insurance_requirements(source_amendment_id) WHERE source_amendment_id IS NOT NULL;
CREATE TRIGGER validate_predecessor BEFORE INSERT ON public.contract_insurance_requirements
 FOR EACH ROW EXECUTE FUNCTION public.contracts_validate_fact_predecessor();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON public.contract_insurance_requirements
 FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_mutation();
ALTER TABLE public.contract_insurance_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.contract_insurance_requirements FOR SELECT TO authenticated
 USING(organization_id=public.current_user_organization_id() AND public.current_user_can_read_contract(contract_id));
CREATE POLICY scoped_insert ON public.contract_insurance_requirements FOR INSERT TO authenticated
 WITH CHECK(organization_id=public.current_user_organization_id() AND public.current_user_can_read_contract(contract_id)
 AND (public.current_user_is_admin() OR public.current_user_has_permission('contracts.edit')));
GRANT SELECT,INSERT ON public.contract_insurance_requirements TO authenticated;
REVOKE UPDATE,DELETE ON public.contract_insurance_requirements FROM authenticated,anon;

CREATE TABLE public.contract_indexation_rules(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 contract_id uuid NOT NULL,
 title text NOT NULL CHECK(btrim(title)<>''),
 source_amendment_id uuid,
 source_clause_id uuid,
 source_document_id uuid,
 source_reference text,
 source_page integer CHECK(source_page>0),
 effective_from date,
 effective_until date,
 predecessor_id uuid,
 effect text NOT NULL DEFAULT 'added' CHECK(effect IN ('added','altered','removed')),
 created_by uuid REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 indexer text,
 base_date date,
 periodicity_months integer CHECK(periodicity_months>0),
 anniversary_rule text,
 formula text,
 lag_months integer CHECK(lag_months>=0),
 floor_percentage numeric CHECK(floor_percentage NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
 cap_percentage numeric CHECK(cap_percentage NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
 CHECK(floor_percentage IS NULL OR cap_percentage IS NULL OR floor_percentage<=cap_percentage),
 UNIQUE(organization_id,contract_id,id),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,contract_id) REFERENCES public.contracts(organization_id,id),
 FOREIGN KEY(organization_id,contract_id,source_amendment_id) REFERENCES public.contract_amendments(organization_id,contract_id,id),
 FOREIGN KEY(organization_id,contract_id,source_clause_id) REFERENCES public.contract_clauses(organization_id,contract_id,id),
 FOREIGN KEY(organization_id,contract_id,source_document_id) REFERENCES public.contract_documents(organization_id,contract_id,id),
 FOREIGN KEY(organization_id,predecessor_id) REFERENCES public.contract_indexation_rules(organization_id,id),
 CHECK(source_clause_id IS NOT NULL OR source_document_id IS NOT NULL OR nullif(btrim(source_reference),'') IS NOT NULL),
 CHECK(source_page IS NULL OR source_document_id IS NOT NULL),
 CHECK(effective_from IS NULL OR effective_until IS NULL OR effective_until>effective_from),
 CHECK((effect='added' AND predecessor_id IS NULL) OR (effect IN ('altered','removed') AND predecessor_id IS NOT NULL)),
 CHECK(predecessor_id IS NULL OR predecessor_id<>id)
);
CREATE UNIQUE INDEX contract_indexation_rules_successor ON public.contract_indexation_rules(contract_id,predecessor_id) WHERE predecessor_id IS NOT NULL;
CREATE INDEX contract_indexation_rules_scope ON public.contract_indexation_rules(organization_id,contract_id,effective_from,id);
CREATE INDEX contract_indexation_rules_amendment ON public.contract_indexation_rules(source_amendment_id) WHERE source_amendment_id IS NOT NULL;
CREATE TRIGGER validate_predecessor BEFORE INSERT ON public.contract_indexation_rules
 FOR EACH ROW EXECUTE FUNCTION public.contracts_validate_fact_predecessor();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON public.contract_indexation_rules
 FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_mutation();
ALTER TABLE public.contract_indexation_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.contract_indexation_rules FOR SELECT TO authenticated
 USING(organization_id=public.current_user_organization_id() AND public.current_user_can_read_contract(contract_id));
CREATE POLICY scoped_insert ON public.contract_indexation_rules FOR INSERT TO authenticated
 WITH CHECK(organization_id=public.current_user_organization_id() AND public.current_user_can_read_contract(contract_id)
 AND (public.current_user_is_admin() OR public.current_user_has_permission('contracts.edit')));
GRANT SELECT,INSERT ON public.contract_indexation_rules TO authenticated;
REVOKE UPDATE,DELETE ON public.contract_indexation_rules FROM authenticated,anon;

CREATE TABLE public.contract_billing_conditions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 contract_id uuid NOT NULL,
 title text NOT NULL CHECK(btrim(title)<>''),
 source_amendment_id uuid,
 source_clause_id uuid,
 source_document_id uuid,
 source_reference text,
 source_page integer CHECK(source_page>0),
 effective_from date,
 effective_until date,
 predecessor_id uuid,
 effect text NOT NULL DEFAULT 'added' CHECK(effect IN ('added','altered','removed')),
 created_by uuid REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 condition_type text CHECK(condition_type IN ('milestone_reached','measurement_accepted','service_report_required','evidence_required','technical_acceptance_required','customer_approval_required','specific_document_required','elapsed_contractual_period','contractual_event')),
 requirement_text text,
 milestone_id uuid,
 responsible_party_id uuid,
 required_document_type text,
 elapsed_period_days integer CHECK(elapsed_period_days>0),
 FOREIGN KEY(organization_id,contract_id,milestone_id) REFERENCES public.contract_milestones(organization_id,contract_id,id),
 FOREIGN KEY(organization_id,responsible_party_id) REFERENCES public.parties(organization_id,id),
 UNIQUE(organization_id,contract_id,id),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,contract_id) REFERENCES public.contracts(organization_id,id),
 FOREIGN KEY(organization_id,contract_id,source_amendment_id) REFERENCES public.contract_amendments(organization_id,contract_id,id),
 FOREIGN KEY(organization_id,contract_id,source_clause_id) REFERENCES public.contract_clauses(organization_id,contract_id,id),
 FOREIGN KEY(organization_id,contract_id,source_document_id) REFERENCES public.contract_documents(organization_id,contract_id,id),
 FOREIGN KEY(organization_id,predecessor_id) REFERENCES public.contract_billing_conditions(organization_id,id),
 CHECK(source_clause_id IS NOT NULL OR source_document_id IS NOT NULL OR nullif(btrim(source_reference),'') IS NOT NULL),
 CHECK(source_page IS NULL OR source_document_id IS NOT NULL),
 CHECK(effective_from IS NULL OR effective_until IS NULL OR effective_until>effective_from),
 CHECK((effect='added' AND predecessor_id IS NULL) OR (effect IN ('altered','removed') AND predecessor_id IS NOT NULL)),
 CHECK(predecessor_id IS NULL OR predecessor_id<>id)
);
CREATE UNIQUE INDEX contract_billing_conditions_successor ON public.contract_billing_conditions(contract_id,predecessor_id) WHERE predecessor_id IS NOT NULL;
CREATE INDEX contract_billing_conditions_scope ON public.contract_billing_conditions(organization_id,contract_id,effective_from,id);
CREATE INDEX contract_billing_conditions_amendment ON public.contract_billing_conditions(source_amendment_id) WHERE source_amendment_id IS NOT NULL;
CREATE TRIGGER validate_predecessor BEFORE INSERT ON public.contract_billing_conditions
 FOR EACH ROW EXECUTE FUNCTION public.contracts_validate_fact_predecessor();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON public.contract_billing_conditions
 FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_mutation();
ALTER TABLE public.contract_billing_conditions ENABLE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.contract_billing_conditions FOR SELECT TO authenticated
 USING(organization_id=public.current_user_organization_id() AND public.current_user_can_read_contract(contract_id));
CREATE POLICY scoped_insert ON public.contract_billing_conditions FOR INSERT TO authenticated
 WITH CHECK(organization_id=public.current_user_organization_id() AND public.current_user_can_read_contract(contract_id)
 AND (public.current_user_is_admin() OR public.current_user_has_permission('contracts.edit')));
GRANT SELECT,INSERT ON public.contract_billing_conditions TO authenticated;
REVOKE UPDATE,DELETE ON public.contract_billing_conditions FROM authenticated,anon;

CREATE TABLE public.contract_measurement_requirements(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 contract_id uuid NOT NULL,
 title text NOT NULL CHECK(btrim(title)<>''),
 source_amendment_id uuid,
 source_clause_id uuid,
 source_document_id uuid,
 source_reference text,
 source_page integer CHECK(source_page>0),
 effective_from date,
 effective_until date,
 predecessor_id uuid,
 effect text NOT NULL DEFAULT 'added' CHECK(effect IN ('added','altered','removed')),
 created_by uuid REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 report_required boolean,
 report_type text,
 required_document_type text,
 technical_report_required boolean,
 tests_inspection_required boolean,
 evidence_required boolean,
 customer_acceptance_required boolean,
 responsible_party_id uuid,
 annex_reference text,
 applicability text,
 billing_condition_id uuid,
 milestone_id uuid,
 FOREIGN KEY(organization_id,responsible_party_id) REFERENCES public.parties(organization_id,id),
 FOREIGN KEY(organization_id,contract_id,billing_condition_id) REFERENCES public.contract_billing_conditions(organization_id,contract_id,id),
 FOREIGN KEY(organization_id,contract_id,milestone_id) REFERENCES public.contract_milestones(organization_id,contract_id,id),
 UNIQUE(organization_id,contract_id,id),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,contract_id) REFERENCES public.contracts(organization_id,id),
 FOREIGN KEY(organization_id,contract_id,source_amendment_id) REFERENCES public.contract_amendments(organization_id,contract_id,id),
 FOREIGN KEY(organization_id,contract_id,source_clause_id) REFERENCES public.contract_clauses(organization_id,contract_id,id),
 FOREIGN KEY(organization_id,contract_id,source_document_id) REFERENCES public.contract_documents(organization_id,contract_id,id),
 FOREIGN KEY(organization_id,predecessor_id) REFERENCES public.contract_measurement_requirements(organization_id,id),
 CHECK(source_clause_id IS NOT NULL OR source_document_id IS NOT NULL OR nullif(btrim(source_reference),'') IS NOT NULL),
 CHECK(source_page IS NULL OR source_document_id IS NOT NULL),
 CHECK(effective_from IS NULL OR effective_until IS NULL OR effective_until>effective_from),
 CHECK((effect='added' AND predecessor_id IS NULL) OR (effect IN ('altered','removed') AND predecessor_id IS NOT NULL)),
 CHECK(predecessor_id IS NULL OR predecessor_id<>id)
);
CREATE UNIQUE INDEX contract_measurement_requirements_successor ON public.contract_measurement_requirements(contract_id,predecessor_id) WHERE predecessor_id IS NOT NULL;
CREATE INDEX contract_measurement_requirements_scope ON public.contract_measurement_requirements(organization_id,contract_id,effective_from,id);
CREATE INDEX contract_measurement_requirements_amendment ON public.contract_measurement_requirements(source_amendment_id) WHERE source_amendment_id IS NOT NULL;
CREATE TRIGGER validate_predecessor BEFORE INSERT ON public.contract_measurement_requirements
 FOR EACH ROW EXECUTE FUNCTION public.contracts_validate_fact_predecessor();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON public.contract_measurement_requirements
 FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_mutation();
ALTER TABLE public.contract_measurement_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.contract_measurement_requirements FOR SELECT TO authenticated
 USING(organization_id=public.current_user_organization_id() AND public.current_user_can_read_contract(contract_id));
CREATE POLICY scoped_insert ON public.contract_measurement_requirements FOR INSERT TO authenticated
 WITH CHECK(organization_id=public.current_user_organization_id() AND public.current_user_can_read_contract(contract_id)
 AND (public.current_user_is_admin() OR public.current_user_has_permission('contracts.edit')));
GRANT SELECT,INSERT ON public.contract_measurement_requirements TO authenticated;
REVOKE UPDATE,DELETE ON public.contract_measurement_requirements FROM authenticated,anon;

-- All previously recorded relationships remain readable; referenced clause text
-- cannot be silently rewritten or deleted, including by a service-role client.
CREATE FUNCTION public.contracts_protect_referenced_clause() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.contract_amendment_clauses WHERE clause_id=OLD.id OR replacement_clause_id=OLD.id)
 OR EXISTS(SELECT 1 FROM public.contract_guarantees WHERE source_clause_id=OLD.id)
 OR EXISTS(SELECT 1 FROM public.contract_insurance_requirements WHERE source_clause_id=OLD.id)
 OR EXISTS(SELECT 1 FROM public.contract_indexation_rules WHERE source_clause_id=OLD.id)
 OR EXISTS(SELECT 1 FROM public.contract_billing_conditions WHERE source_clause_id=OLD.id)
 OR EXISTS(SELECT 1 FROM public.contract_measurement_requirements WHERE source_clause_id=OLD.id) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Referenced contractual clause is historical truth' USING ERRCODE='23514'; END IF;
  IF (NEW.id,NEW.organization_id,NEW.contract_id,NEW.title,NEW.content,NEW.clause_type,NEW.source_document_id,NEW.source_page,NEW.source_excerpt,NEW.amount,NEW.percentage,NEW.term_days)
     IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.contract_id,OLD.title,OLD.content,OLD.clause_type,OLD.source_document_id,OLD.source_page,OLD.source_excerpt,OLD.amount,OLD.percentage,OLD.term_days) THEN
   RAISE EXCEPTION 'Append a replacement clause instead of rewriting history' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contracts_protect_referenced_clause() FROM PUBLIC;
CREATE TRIGGER protect_referenced_clause BEFORE UPDATE OR DELETE ON public.contract_clauses
 FOR EACH ROW EXECUTE FUNCTION public.contracts_protect_referenced_clause();

CREATE FUNCTION public.contracts_protect_original_terms() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF (NEW.total_value,NEW.end_date,NEW.start_date,NEW.currency) IS DISTINCT FROM (OLD.total_value,OLD.end_date,OLD.start_date,OLD.currency)
 AND (EXISTS(SELECT 1 FROM public.contract_amendments WHERE contract_id=OLD.id)
 OR EXISTS(SELECT 1 FROM public.contract_instrument_lineage WHERE contract_id=OLD.id OR root_contract_id=OLD.id OR parent_contract_id=OLD.id)) THEN
  RAISE EXCEPTION 'Record a contractual amendment instead of rewriting original value or term' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contracts_protect_original_terms() FROM PUBLIC;
CREATE TRIGGER protect_original_terms BEFORE UPDATE ON public.contracts
 FOR EACH ROW EXECUTE FUNCTION public.contracts_protect_original_terms();
COMMIT;
