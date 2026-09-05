-- Contracts V2 Phase 2: separates REWRITING contractual history from ERASING a contract.
--
-- 108/109 refused both with one trigger, and that conflated two different acts:
--
--   rewrite  — changing what a recorded instrument, clause or fact says while the
--              contract still exists. Never legitimate, for any role, ever.
--   erasure  — removing a contract and everything that describes it (tenant
--              offboarding, LGPD erasure, disposable test fixtures). Legitimate,
--              and only through the privileged path that already bypasses RLS.
--
-- Refusing erasure to `postgres` was not a real guarantee either: the owner can
-- drop the trigger. What is enforceable, and what the product actually needs, is
-- that the APPLICATION roles can never rewrite nor erase contractual history —
-- `authenticated` holds DELETE on contract_amendments by grant, so this is a
-- structural guard, not a restatement of RLS.
--
-- No business fact, date, classification or clause text is changed here.
BEGIN;

CREATE FUNCTION public.contracts_reject_history_erasure() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF current_user IN ('authenticated','anon') THEN
  RAISE EXCEPTION 'Contractual history cannot be erased from the application: %', TG_TABLE_NAME USING ERRCODE='23514';
 END IF;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.contracts_reject_history_erasure() FROM PUBLIC;

-- Rewriting stays refused for every role; erasure narrows to the privileged path.
DROP TRIGGER amendment_clause_history_immutable ON public.contract_amendment_clauses;
CREATE TRIGGER amendment_clause_history_immutable BEFORE UPDATE ON public.contract_amendment_clauses
 FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_mutation();
CREATE TRIGGER amendment_clause_history_no_erasure BEFORE DELETE ON public.contract_amendment_clauses
 FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

DROP TRIGGER amendment_revisions_immutable ON public.contract_amendment_revisions;
CREATE TRIGGER amendment_revisions_immutable BEFORE UPDATE ON public.contract_amendment_revisions
 FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_mutation();
CREATE TRIGGER amendment_revisions_no_erasure BEFORE DELETE ON public.contract_amendment_revisions
 FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

DROP TRIGGER amendment_no_hard_delete ON public.contract_amendments;
CREATE TRIGGER amendment_no_hard_delete BEFORE DELETE ON public.contract_amendments
 FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

DROP TRIGGER lineage_immutable ON public.contract_instrument_lineage;
CREATE TRIGGER lineage_immutable BEFORE UPDATE ON public.contract_instrument_lineage
 FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_mutation();
CREATE TRIGGER lineage_no_erasure BEFORE DELETE ON public.contract_instrument_lineage
 FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['contract_guarantees','contract_insurance_requirements','contract_indexation_rules',
  'contract_billing_conditions','contract_measurement_requirements'] LOOP
  EXECUTE format('DROP TRIGGER immutable ON public.%I',t);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE ON public.%I
   FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_mutation()',t);
  EXECUTE format('CREATE TRIGGER no_erasure BEFORE DELETE ON public.%I
   FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure()',t);
 END LOOP;
END $$;

-- A referenced clause still cannot be REWRITTEN by anyone. Deleting it is erasure,
-- and follows the same boundary as everything else that describes a contract.
--
-- The reference check needs SECURITY DEFINER to see past RLS, but inside a definer
-- function `current_user` is the function OWNER, not the caller — asking it there
-- would have exempted every role. The privileged read and the role decision are
-- therefore separate: the trigger runs as the caller and asks the helper.
CREATE FUNCTION public.contracts_clause_is_referenced(p_clause_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.contract_amendment_clauses WHERE clause_id=p_clause_id OR replacement_clause_id=p_clause_id)
     OR EXISTS(SELECT 1 FROM public.contract_guarantees WHERE source_clause_id=p_clause_id)
     OR EXISTS(SELECT 1 FROM public.contract_insurance_requirements WHERE source_clause_id=p_clause_id)
     OR EXISTS(SELECT 1 FROM public.contract_indexation_rules WHERE source_clause_id=p_clause_id)
     OR EXISTS(SELECT 1 FROM public.contract_billing_conditions WHERE source_clause_id=p_clause_id)
     OR EXISTS(SELECT 1 FROM public.contract_measurement_requirements WHERE source_clause_id=p_clause_id)
$$;
REVOKE ALL ON FUNCTION public.contracts_clause_is_referenced(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contracts_clause_is_referenced(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.contracts_protect_referenced_clause() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF public.contracts_clause_is_referenced(OLD.id) THEN
  IF TG_OP='DELETE' THEN
   IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Referenced contractual clause is historical truth' USING ERRCODE='23514';
   END IF;
   RETURN OLD;
  END IF;
  IF (NEW.id,NEW.organization_id,NEW.contract_id,NEW.title,NEW.content,NEW.clause_type,NEW.source_document_id,NEW.source_page,NEW.source_excerpt,NEW.amount,NEW.percentage,NEW.term_days)
     IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.contract_id,OLD.title,OLD.content,OLD.clause_type,OLD.source_document_id,OLD.source_page,OLD.source_excerpt,OLD.amount,OLD.percentage,OLD.term_days) THEN
   RAISE EXCEPTION 'Append a replacement clause instead of rewriting history' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;

-- Erasure has to reach the whole subtree, or the privileged path hits a wall of
-- referential errors and someone "fixes" it by dropping constraints. Only Phase 2
-- rows cascade, and only from rows that describe the very contract being erased —
-- a Party is never followed, because a Party outlives the contract that cited it.
DO $$
DECLARE r record;
BEGIN
 FOR r IN SELECT c.conname, c.conrelid::regclass::text tbl, pg_get_constraintdef(c.oid) def
  FROM pg_constraint c
  WHERE c.contype='f'
   AND c.conrelid::regclass::text IN ('contract_guarantees','contract_insurance_requirements',
    'contract_indexation_rules','contract_billing_conditions','contract_measurement_requirements',
    'contract_instrument_lineage','contract_amendment_revisions','contract_amendment_clauses')
   AND c.confrelid::regclass::text IN ('contracts','contract_amendments','contract_clauses',
    'contract_documents','contract_milestones','contract_guarantees','contract_insurance_requirements',
    'contract_indexation_rules','contract_billing_conditions','contract_measurement_requirements')
   AND pg_get_constraintdef(c.oid) NOT LIKE '%ON DELETE CASCADE%'
 LOOP
  -- ON DELETE SET NULL was worse than no action here: blanking clause_id would
  -- leave a relationship pointing at nothing, which is a rewrite of history by
  -- cascade — and the append-only UPDATE guard refuses it anyway, so erasure
  -- would simply deadlock. The relationship goes when its clause goes.
  EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',r.tbl,r.conname);
  EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s ON DELETE CASCADE',r.tbl,r.conname,
   regexp_replace(r.def,'\s+ON DELETE .*$','') );
 END LOOP;
END $$;
COMMIT;
