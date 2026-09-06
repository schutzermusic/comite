-- Contracts V2 Phase 2: closes a cross-tenant existence oracle in the clause
-- reference helper introduced by 110.
--
-- THE LEAK
--
-- `contracts_clause_is_referenced` is SECURITY DEFINER — it has to be, because the
-- trigger must see referencing rows past RLS — and 110 granted EXECUTE to
-- `authenticated` (and `anon` inherited it). Definer rights meant it answered about
-- ANY clause in ANY organization, and the three outcomes were distinguishable:
--
--   foreign clause, referenced .... true
--   foreign clause, unreferenced ... false
--   no such clause ................. false
--
-- So a user of Org B holding a clause UUID from Org A could learn that the clause
-- exists and that an amendment, guarantee, insurance requirement, indexation rule,
-- billing condition or measurement requirement points at it. No row was readable,
-- but the relationship was.
--
-- THE FIX
--
-- The caller's tenant is decided from the JWT, not from `current_user` — inside a
-- definer function `current_user` is the OWNER, which is exactly the trap 110 fell
-- into. An application session (auth.uid() present) may only ask about a clause in
-- its own organization; anything else — another tenant's clause, or a UUID that
-- names no clause at all — raises the SAME error, so the two stay indistinguishable
-- and nothing can be probed by comparing outcomes.
--
-- A privileged session (no JWT subject: the erasure/purge path, service-side jobs)
-- keeps full visibility, because that is what contract erasure and the rewrite
-- guard depend on. Rewriting a referenced clause stays refused for every role.
--
-- No table, policy, business fact or historical row is touched.
BEGIN;

CREATE OR REPLACE FUNCTION public.contracts_clause_is_referenced(p_clause_id uuid)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE clause_org uuid; caller_org uuid;
BEGIN
 SELECT organization_id INTO clause_org FROM public.contract_clauses WHERE id=p_clause_id;

 -- Application session: same tenant or nothing, and "nothing" always looks alike.
 IF auth.uid() IS NOT NULL THEN
  caller_org := public.current_user_organization_id();
  IF caller_org IS NULL OR clause_org IS DISTINCT FROM caller_org THEN
   RAISE EXCEPTION 'Clause is not readable in this organization' USING ERRCODE='42501';
  END IF;
 END IF;

 IF clause_org IS NULL THEN RETURN false; END IF;

 -- Scoped by the clause's own tenant: a reference can only ever be same-org, and
 -- saying so here keeps the answer inside one organization structurally.
 RETURN EXISTS(SELECT 1 FROM public.contract_amendment_clauses
        WHERE organization_id=clause_org AND (clause_id=p_clause_id OR replacement_clause_id=p_clause_id))
     OR EXISTS(SELECT 1 FROM public.contract_guarantees
        WHERE organization_id=clause_org AND source_clause_id=p_clause_id)
     OR EXISTS(SELECT 1 FROM public.contract_insurance_requirements
        WHERE organization_id=clause_org AND source_clause_id=p_clause_id)
     OR EXISTS(SELECT 1 FROM public.contract_indexation_rules
        WHERE organization_id=clause_org AND source_clause_id=p_clause_id)
     OR EXISTS(SELECT 1 FROM public.contract_billing_conditions
        WHERE organization_id=clause_org AND source_clause_id=p_clause_id)
     OR EXISTS(SELECT 1 FROM public.contract_measurement_requirements
        WHERE organization_id=clause_org AND source_clause_id=p_clause_id);
END $$;

-- `anon` never legitimately mutates a contractual clause, so it does not need to
-- ask this question at all. `authenticated` keeps EXECUTE because the trigger runs
-- as the caller, and it is now answerable only within the caller's own tenant.
REVOKE ALL ON FUNCTION public.contracts_clause_is_referenced(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contracts_clause_is_referenced(uuid) TO authenticated;
COMMIT;
