-- Invoke inside the runner's transaction AFTER 108/109. All fixtures are rolled back.
-- Any unmet assertion raises and fails the apply gate; no silent skipped security cases.
SAVEPOINT contracts_v2_phase2_assertions;
CREATE FUNCTION pg_temp.phase2_expect_error(statement text, expected_state text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE failed boolean:=false;
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE<>expected_state THEN RAISE EXCEPTION 'Expected %, got %: % (SQL: %)',expected_state,SQLSTATE,SQLERRM,statement; END IF;
  failed:=true;
 END;
 IF NOT failed THEN RAISE EXCEPTION 'Invalid operation unexpectedly succeeded: %',statement; END IF;
END $$;

-- Apagar história pode ser recusado pelo gatilho (23514) ou pela ausência de
-- permissão (42501), conforme a tabela seja legada — onde `authenticated` ainda
-- tem DELETE por grant — ou nova. As duas são recusa; o que importa é que a
-- aplicação não apaga verdade contratual por nenhum dos dois caminhos.
CREATE FUNCTION pg_temp.phase2_expect_refusal(statement text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE failed boolean:=false;
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE NOT IN ('23514','42501') THEN RAISE EXCEPTION 'Expected refusal, got %: % (SQL: %)',SQLSTATE,SQLERRM,statement; END IF;
  failed:=true;
 END;
 IF NOT failed THEN RAISE EXCEPTION 'Erasure unexpectedly succeeded: %',statement; END IF;
END $$;

DO $$
DECLARE org_a uuid; org_b uuid:=gen_random_uuid(); user_a uuid;
 c_a uuid:=gen_random_uuid(); c_sibling uuid:=gen_random_uuid(); c_b uuid:=gen_random_uuid(); c_renew uuid:=gen_random_uuid();
 a uuid:=gen_random_uuid(); a2 uuid:=gen_random_uuid(); a_b uuid:=gen_random_uuid();
 cl uuid:=gen_random_uuid(); cl_new uuid:=gen_random_uuid(); cl_b uuid:=gen_random_uuid(); doc_b uuid:=gen_random_uuid();
 party_b uuid:=gen_random_uuid(); guarantee uuid:=gen_random_uuid(); replacement uuid:=gen_random_uuid(); n integer; t text;
 tables text[]:=ARRAY['contract_instrument_lineage','contract_amendment_revisions','contract_guarantees',
 'contract_insurance_requirements','contract_indexation_rules','contract_billing_conditions','contract_measurement_requirements'];
BEGIN
 SELECT organization_id,user_id INTO org_a,user_a FROM public.profiles WHERE organization_id IS NOT NULL LIMIT 1;
 IF org_a IS NULL OR user_a IS NULL THEN RAISE EXCEPTION 'RLS assertion requires an existing authenticated organization profile'; END IF;
 INSERT INTO public.organizations(id,name,slug) VALUES(org_b,'Phase2 rollback fixture','phase2-'||org_b::text);
 INSERT INTO public.contracts(id,organization_id,title,total_value,start_date,end_date) VALUES
 (c_a,org_a,'Phase2 rollback original',100,'2026-01-01','2026-12-31'),
 (c_sibling,org_a,'Phase2 rollback unrelated',NULL,NULL,NULL),(c_renew,org_a,'Phase2 rollback renewal',NULL,NULL,NULL),
 (c_b,org_b,'Phase2 rollback other tenant',NULL,NULL,NULL);
 INSERT INTO public.contract_clauses(id,organization_id,contract_id,title,content) VALUES
 (cl,org_a,c_a,'Original','Original historical text'),(cl_new,org_a,c_a,'Replacement','Replacement text'),
 (cl_b,org_b,c_b,'Other tenant','Other tenant text');
 INSERT INTO public.contract_documents(id,organization_id,contract_id,title,file_path,document_type)
 VALUES(doc_b,org_b,c_b,'Other tenant source','phase2-rollback/source.pdf','contract');
 INSERT INTO public.parties(id,organization_id,kind,legal_name) VALUES(party_b,org_b,'organization','Phase2 rollback Party');
 INSERT INTO public.contract_amendments(id,organization_id,contract_id,amendment_number,status,effective_date,value_delta)
 VALUES(a,org_a,c_a,'TA-1','signed','2026-02-01',10),(a2,org_a,c_a,'TA-2','signed','2026-03-01',20),
 (a_b,org_b,c_b,'TA-other','draft',NULL,NULL);
 UPDATE public.contract_amendments SET value_delta=15 WHERE id=a;
 SELECT count(*) INTO n FROM public.contract_amendment_revisions WHERE amendment_id=a;
 IF n<>2 THEN RAISE EXCEPTION 'Expected initial and updated immutable amendment revision'; END IF;
 IF (SELECT amendment_snapshot->>'value_delta' FROM public.contract_amendment_revisions WHERE amendment_id=a AND revision=1)::numeric<>10 THEN
  RAISE EXCEPTION 'Original amendment value was overwritten'; END IF;
 PERFORM pg_temp.phase2_expect_error(format('UPDATE public.contract_amendment_revisions SET revision=9 WHERE amendment_id=%L',a),'23514');
 PERFORM pg_temp.phase2_expect_error(format('UPDATE public.contract_amendments SET contract_id=%L WHERE id=%L',c_sibling,a),'23514');
 PERFORM pg_temp.phase2_expect_error(format('UPDATE public.contracts SET total_value=200 WHERE id=%L',c_a),'23514');
 INSERT INTO public.contract_amendment_clauses(organization_id,amendment_id,clause_id,replacement_clause_id,effect)
 VALUES(org_a,a,cl,cl_new,'altered');
 IF NOT EXISTS(SELECT 1 FROM public.contract_amendment_clauses WHERE amendment_id=a AND contract_id=c_a) THEN
  RAISE EXCEPTION 'Legacy clause-link API scope was not filled'; END IF;
 PERFORM pg_temp.phase2_expect_error(format('UPDATE public.contract_amendment_clauses SET effect=''removed'' WHERE amendment_id=%L',a),'23514');
 PERFORM pg_temp.phase2_expect_error(format('UPDATE public.contract_clauses SET content=''rewritten'' WHERE id=%L',cl),'23514');
 PERFORM pg_temp.phase2_expect_error(format('UPDATE public.contract_clauses SET amount=9 WHERE id=%L',cl_new),'23514');
 PERFORM pg_temp.phase2_expect_error(format('INSERT INTO public.contract_amendment_clauses(organization_id,amendment_id,clause_id,effect) VALUES(%L,%L,%L,''removed'')',org_a,a2,cl_b),'23503');
 PERFORM pg_temp.phase2_expect_error(format('INSERT INTO public.contract_amendments(organization_id,contract_id,amendment_number) VALUES(%L,%L,''cross-tenant'')',org_a,c_b),'23503');

 INSERT INTO public.contract_instrument_lineage(organization_id,contract_id,amendment_id,root_contract_id,parent_contract_id,lineage_type,effective_date)
 VALUES(org_a,c_a,a,c_a,c_a,'amendment','2026-02-01');
 INSERT INTO public.contract_instrument_lineage(organization_id,contract_id,amendment_id,root_contract_id,parent_contract_id,parent_amendment_id,lineage_type,effective_date)
 VALUES(org_a,c_a,a2,c_a,c_a,a,'amendment','2026-03-01');
 INSERT INTO public.contract_instrument_lineage(organization_id,contract_id,root_contract_id,parent_contract_id,parent_amendment_id,lineage_type,effective_date)
 VALUES(org_a,c_renew,c_a,c_a,a2,'renewal','2027-01-01');
 PERFORM pg_temp.phase2_expect_error(format('UPDATE public.contract_instrument_lineage SET effective_date=NULL WHERE amendment_id=%L',a),'23514');
 PERFORM pg_temp.phase2_expect_error(format('INSERT INTO public.contract_instrument_lineage(organization_id,contract_id,root_contract_id,parent_contract_id,lineage_type) VALUES(%L,%L,%L,%L,''renewal'')',org_a,c_sibling,c_sibling,c_sibling),'23514');
 PERFORM pg_temp.phase2_expect_error(format('INSERT INTO public.contract_instrument_lineage(organization_id,contract_id,root_contract_id,parent_contract_id,lineage_type) VALUES(%L,%L,%L,%L,''renewal'')',org_a,c_a,c_a,c_renew),'23514');
 PERFORM pg_temp.phase2_expect_error(format('INSERT INTO public.contract_instrument_lineage(organization_id,contract_id,root_contract_id,parent_contract_id,lineage_type) VALUES(%L,%L,%L,%L,''renewal'')',org_a,c_sibling,c_b,c_b),'23503');
 PERFORM pg_temp.phase2_expect_error(format('INSERT INTO public.contract_instrument_lineage(organization_id,contract_id,root_contract_id,parent_contract_id,lineage_type) VALUES(%L,%L,%L,%L,''renewal'')',org_a,c_renew,c_a,c_a),'23505');

 INSERT INTO public.contract_guarantees(id,organization_id,contract_id,title,source_clause_id,required_percentage,percentage_basis,effective_from)
 VALUES(guarantee,org_a,c_a,'Performance guarantee',cl,5,'original contract value','2026-01-01');
 INSERT INTO public.contract_guarantees(id,organization_id,contract_id,title,source_reference,predecessor_id,effect,effective_from,required_percentage,percentage_basis)
 VALUES(replacement,org_a,c_renew,'Renewed guarantee','Renewal instrument',guarantee,'altered','2027-01-01',6,'renewed value');
 PERFORM pg_temp.phase2_expect_error(format('INSERT INTO public.contract_guarantees(organization_id,contract_id,title,source_reference,predecessor_id,effect) VALUES(%L,%L,''bad ancestry'',''source'',%L,''altered'')',org_a,c_sibling,guarantee),'23514');
 PERFORM pg_temp.phase2_expect_error(format('INSERT INTO public.contract_guarantees(organization_id,contract_id,title,source_reference,predecessor_id,effect,effective_from) VALUES(%L,%L,''bad date'',''source'',%L,''altered'',''2025-01-01'')',org_a,c_a,guarantee),'23514');
 PERFORM pg_temp.phase2_expect_error(format('INSERT INTO public.contract_guarantees(organization_id,contract_id,title,source_reference,required_amount) VALUES(%L,%L,''negative'',''source'',-1)',org_a,c_a),'23514');
 PERFORM pg_temp.phase2_expect_error(format('INSERT INTO public.contract_guarantees(organization_id,contract_id,title,source_reference,required_amount) VALUES(%L,%L,''NaN'',''source'',''NaN'')',org_a,c_a),'23514');
 PERFORM pg_temp.phase2_expect_error(format('INSERT INTO public.contract_guarantees(organization_id,contract_id,title,source_reference,required_percentage) VALUES(%L,%L,''missing basis'',''source'',5)',org_a,c_a),'23514');
 PERFORM pg_temp.phase2_expect_error(format('INSERT INTO public.contract_guarantees(organization_id,contract_id,title,source_reference,issuer_party_id) VALUES(%L,%L,''bad Party'',''source'',%L)',org_a,c_a,party_b),'23503');
 PERFORM pg_temp.phase2_expect_error(format('INSERT INTO public.contract_insurance_requirements(organization_id,contract_id,title,source_reference,required_coverage) VALUES(%L,%L,''bad coverage'',''source'',-1)',org_a,c_a),'23514');
 PERFORM pg_temp.phase2_expect_error(format('INSERT INTO public.contract_indexation_rules(organization_id,contract_id,title,source_reference,periodicity_months) VALUES(%L,%L,''bad period'',''source'',0)',org_a,c_a),'23514');
 PERFORM pg_temp.phase2_expect_error(format('INSERT INTO public.contract_indexation_rules(organization_id,contract_id,title,source_reference,floor_percentage,cap_percentage) VALUES(%L,%L,''bad limits'',''source'',10,5)',org_a,c_a),'23514');

 FOREACH t IN ARRAY tables LOOP
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='public' AND c.relname=t AND c.relrowsecurity;
  IF n<>1 THEN RAISE EXCEPTION 'RLS not enabled: %',t; END IF;
  IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND (qual='true' OR with_check='true')) THEN
   RAISE EXCEPTION 'Unrestricted policy: %',t; END IF;
 END LOOP;
 FOREACH t IN ARRAY tables[3:7] LOOP
  PERFORM pg_temp.phase2_expect_error(format('INSERT INTO public.%I(organization_id,contract_id,title) VALUES(%L,%L,''No provenance'')',t,org_a,c_a),'23514');
  PERFORM pg_temp.phase2_expect_error(format('INSERT INTO public.%I(organization_id,contract_id,title,source_document_id) VALUES(%L,%L,''Cross document'',%L)',t,org_a,c_a,doc_b),'23503');
  PERFORM pg_temp.phase2_expect_error(format('INSERT INTO public.%I(organization_id,contract_id,title,source_reference,effective_from,effective_until) VALUES(%L,%L,''Bad period'',''source'',''2026-03-01'',''2026-02-01'')',t,org_a,c_a),'23514');
  EXECUTE format('INSERT INTO public.%I(organization_id,contract_id,title,source_reference) VALUES(%L,%L,''Unknown effective date'',''Source contract'')',t,org_b,c_b);
  EXECUTE format('SELECT count(*) FROM public.%I WHERE contract_id=$1 AND effective_from IS NULL',t) INTO n USING c_b;
  IF n<>1 THEN RAISE EXCEPTION 'Missing date did not remain NULL: %',t; END IF;
  PERFORM pg_temp.phase2_expect_error(format('UPDATE public.%I SET title=''history rewrite'' WHERE contract_id=%L',t,c_b),'23514');
 END LOOP;
 INSERT INTO public.contract_instrument_lineage(organization_id,contract_id,amendment_id,root_contract_id,parent_contract_id,lineage_type)
 VALUES(org_b,c_b,a_b,c_b,c_b,'amendment');

 -- Actual authenticated role: other-tenant fixtures exist in EVERY new table.
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',user_a,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 FOREACH t IN ARRAY tables LOOP
  EXECUTE format('SELECT count(*) FROM public.%I WHERE organization_id=$1',t) INTO n USING org_b;
  IF n<>0 THEN RAISE EXCEPTION 'Tenant data leaked through RLS: %',t; END IF;
 END LOOP;
 PERFORM pg_temp.phase2_expect_error(format('INSERT INTO public.contract_guarantees(organization_id,contract_id,title,source_reference) VALUES(%L,%L,''RLS denied'',''source'')',org_b,c_b),'42501');
 -- `authenticated` holds DELETE by grant on the legacy tables: the refusal below is
 -- structural, and is the guarantee the application actually depends on.
 PERFORM pg_temp.phase2_expect_error(format('DELETE FROM public.contract_amendments WHERE id=%L',a),'23514');
 PERFORM pg_temp.phase2_expect_error(format('DELETE FROM public.contract_amendment_clauses WHERE amendment_id=%L',a),'23514');
 PERFORM pg_temp.phase2_expect_refusal(format('DELETE FROM public.contract_amendment_revisions WHERE amendment_id=%L',a));
 PERFORM pg_temp.phase2_expect_error(format('DELETE FROM public.contract_clauses WHERE id=%L',cl),'23514');
 PERFORM pg_temp.phase2_expect_refusal(format('DELETE FROM public.contract_instrument_lineage WHERE amendment_id=%L',a));
 -- Nas cinco tabelas de fatos a recusa é anterior a qualquer linha: `authenticated`
 -- não tem DELETE nem UPDATE por grant, e o gatilho de apagamento existe em todas.
 -- Ambas as condições são asseridas estruturalmente pelo runner da fase; repetir
 -- aqui um DELETE que a RLS já esvazia provaria zero linha, e não a fronteira.
 EXECUTE 'RESET ROLE';

 -- Apagar o contrato inteiro pelo caminho privilegiado continua possível, e leva
 -- junto tudo que o descreve. Sem isso, offboarding e LGPD ficariam sem saída.
 DELETE FROM public.contract_amendment_clauses WHERE contract_id=c_a;
 DELETE FROM public.contract_guarantees WHERE contract_id IN (c_a,c_renew);
 DELETE FROM public.contracts WHERE id IN (c_a,c_sibling,c_renew);
 IF EXISTS(SELECT 1 FROM public.contract_amendments WHERE contract_id=c_a)
 OR EXISTS(SELECT 1 FROM public.contract_amendment_revisions WHERE contract_id=c_a)
 OR EXISTS(SELECT 1 FROM public.contract_instrument_lineage WHERE root_contract_id=c_a) THEN
  RAISE EXCEPTION 'Privileged contract erasure left orphan contractual history behind';
 END IF;
 RAISE NOTICE 'Phase 2 assertions passed: FK, lineage, immutable revisions/clauses, typed constraints, provenance, NULL semantics, authenticated RLS, erasure boundary and privileged purge';
END $$;
ROLLBACK TO SAVEPOINT contracts_v2_phase2_assertions;
RELEASE SAVEPOINT contracts_v2_phase2_assertions;
