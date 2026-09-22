-- ============================================================================
-- 202 — AS FUNÇÕES GOVERNADAS DO FUNIL COMERCIAL
--
-- A 198 criou as tabelas e REVOGOU escrita de `authenticated`. Sem estas
-- funções, o funil seria somente-leitura — ou alguém abriria uma policy de
-- INSERT e criaria o caminho paralelo que o módulo inteiro evita.
--
-- A máquina de estados da revisão mora AQUI, e não na tela:
--
--   DRAFT → INTERNAL_REVIEW → INTERNALLY_APPROVED → SENT → NEGOTIATION
--                                                     ↘ (198) ACCEPTED / REJECTED / EXPIRED
--
-- `commercial_proposal_revision_record_outcome` (200) é quem fecha o ciclo,
-- porque o que vem do CLIENTE é de outra natureza: exige ator humano nomeado
-- e fonte de manifestação. Transição interna e manifestação do cliente são
-- funções separadas de propósito.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Contato
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commercial_contact_upsert(
  p_organization_id uuid, p_actor uuid, p_payload jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Contact write denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Contact write requires a named actor.' USING ERRCODE = '42501';
  END IF;

  v_id := nullif(p_payload->>'id','')::uuid;
  IF v_id IS NULL THEN
    INSERT INTO public.commercial_contacts
      (organization_id, party_id, full_name, role_title, email, phone, is_primary, notes, created_by)
    VALUES (p_organization_id, (p_payload->>'party_id')::uuid, p_payload->>'full_name',
            nullif(btrim(p_payload->>'role_title'),''), nullif(btrim(p_payload->>'email'),''),
            nullif(btrim(p_payload->>'phone'),''), COALESCE((p_payload->>'is_primary')::boolean, false),
            nullif(btrim(p_payload->>'notes'),''), p_actor)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.commercial_contacts
       SET full_name = COALESCE(nullif(btrim(p_payload->>'full_name'),''), full_name),
           role_title = nullif(btrim(p_payload->>'role_title'),''),
           email = nullif(btrim(p_payload->>'email'),''),
           phone = nullif(btrim(p_payload->>'phone'),''),
           is_primary = COALESCE((p_payload->>'is_primary')::boolean, is_primary),
           active = COALESCE((p_payload->>'active')::boolean, active),
           notes = nullif(btrim(p_payload->>'notes'),'')
     WHERE organization_id = p_organization_id AND id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Contact not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Oportunidade
--
-- `closed_at` não é campo de formulário: ele é consequência do estágio, e o
-- CHECK `co_closed_coherent` recusaria a incoerência de qualquer forma. A
-- função deriva, para que a tela não precise saber a regra.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commercial_opportunity_upsert(
  p_organization_id uuid, p_actor uuid, p_payload jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_stage text; v_closed boolean;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Opportunity write denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Opportunity write requires a named actor.' USING ERRCODE = '42501';
  END IF;

  v_id := nullif(p_payload->>'id','')::uuid;
  v_stage := COALESCE(nullif(btrim(p_payload->>'stage'),''), 'QUALIFICATION');
  v_closed := v_stage IN ('WON','LOST','ABANDONED');

  IF v_id IS NULL THEN
    INSERT INTO public.commercial_opportunities
      (organization_id, code, title, party_id, counterparty_name, primary_contact_id,
       stage, estimated_value, currency, probability, expected_decision_date, source,
       owner_user_id, lost_reason, closed_at, notes, created_by)
    VALUES (p_organization_id, nullif(btrim(p_payload->>'code'),''), p_payload->>'title',
            nullif(p_payload->>'party_id','')::uuid, p_payload->>'counterparty_name',
            nullif(p_payload->>'primary_contact_id','')::uuid, v_stage,
            nullif(p_payload->>'estimated_value','')::numeric,
            COALESCE(nullif(btrim(p_payload->>'currency'),''), 'BRL'),
            nullif(p_payload->>'probability','')::numeric,
            nullif(p_payload->>'expected_decision_date','')::date,
            nullif(btrim(p_payload->>'source'),''),
            COALESCE(nullif(p_payload->>'owner_user_id','')::uuid, p_actor),
            CASE WHEN v_closed THEN nullif(btrim(p_payload->>'lost_reason'),'') END,
            CASE WHEN v_closed THEN now() END,
            nullif(btrim(p_payload->>'notes'),''), p_actor)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.commercial_opportunities
       SET code = nullif(btrim(p_payload->>'code'),''),
           title = COALESCE(nullif(btrim(p_payload->>'title'),''), title),
           party_id = nullif(p_payload->>'party_id','')::uuid,
           counterparty_name = COALESCE(nullif(btrim(p_payload->>'counterparty_name'),''), counterparty_name),
           primary_contact_id = nullif(p_payload->>'primary_contact_id','')::uuid,
           stage = v_stage,
           estimated_value = nullif(p_payload->>'estimated_value','')::numeric,
           currency = COALESCE(nullif(btrim(p_payload->>'currency'),''), currency),
           probability = nullif(p_payload->>'probability','')::numeric,
           expected_decision_date = nullif(p_payload->>'expected_decision_date','')::date,
           source = nullif(btrim(p_payload->>'source'),''),
           lost_reason = CASE WHEN v_closed THEN nullif(btrim(p_payload->>'lost_reason'),'') END,
           closed_at = CASE WHEN v_closed THEN COALESCE(closed_at, now()) END,
           notes = nullif(btrim(p_payload->>'notes'),'')
     WHERE organization_id = p_organization_id AND id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Opportunity not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Proposta e revisão
--
-- Criar proposta cria a REVISÃO 1 junto. Uma proposta sem revisão não tem
-- valor, prazo nem estado — seria um cabeçalho esperando virar documento, e
-- a tela teria de inventar um estado para exibi-la.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commercial_proposal_create(
  p_organization_id uuid, p_actor uuid, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_proposal uuid; v_revision uuid;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Proposal write denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Proposal write requires a named actor.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.commercial_proposals
    (organization_id, opportunity_id, proposal_number, kind, title, party_id,
     counterparty_name, currency, owner_user_id, created_by)
  VALUES (p_organization_id, nullif(p_payload->>'opportunity_id','')::uuid,
          p_payload->>'proposal_number', p_payload->>'kind', p_payload->>'title',
          nullif(p_payload->>'party_id','')::uuid, p_payload->>'counterparty_name',
          COALESCE(nullif(btrim(p_payload->>'currency'),''), 'BRL'),
          COALESCE(nullif(p_payload->>'owner_user_id','')::uuid, p_actor), p_actor)
  RETURNING id INTO v_proposal;

  INSERT INTO public.commercial_proposal_revisions
    (organization_id, proposal_id, revision, status, total_value, currency,
     validity_until, payment_terms, scope_summary, acceptance_conditions,
     document_id, created_by)
  VALUES (p_organization_id, v_proposal, 1, 'DRAFT',
          nullif(p_payload->>'total_value','')::numeric,
          nullif(btrim(p_payload->>'currency'),''),
          nullif(p_payload->>'validity_until','')::date,
          nullif(btrim(p_payload->>'payment_terms'),''),
          nullif(btrim(p_payload->>'scope_summary'),''),
          nullif(btrim(p_payload->>'acceptance_conditions'),''),
          nullif(p_payload->>'document_id','')::uuid, p_actor)
  RETURNING id INTO v_revision;

  RETURN jsonb_build_object('proposal_id', v_proposal, 'revision_id', v_revision, 'revision', 1);
END $$;

/*
  Nova revisão: a anterior é SUCEDIDA, nunca editada.

  Renegociar alterando a revisão que foi enviada apagaria o que o cliente
  recebeu — e a pergunta "sob que termos isto foi oferecido em março?" ficaria
  sem resposta. Revisão aceita NÃO pode ser sucedida: ela rege execução, e
  substituí-la por baixo mudaria a base do trabalho já autorizado.
*/
CREATE OR REPLACE FUNCTION public.commercial_proposal_revise(
  p_organization_id uuid, p_actor uuid, p_revision_id uuid, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE prev public.commercial_proposal_revisions%ROWTYPE; v_new uuid; v_next integer;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Proposal revision denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Proposal revision requires a named actor.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO prev FROM public.commercial_proposal_revisions
   WHERE organization_id = p_organization_id AND id = p_revision_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proposal revision not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF prev.status = 'ACCEPTED' THEN
    RAISE EXCEPTION 'An ACCEPTED revision governs execution and cannot be superseded.'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(max(revision), 0) + 1 INTO v_next
    FROM public.commercial_proposal_revisions
   WHERE organization_id = p_organization_id AND proposal_id = prev.proposal_id;

  INSERT INTO public.commercial_proposal_revisions
    (organization_id, proposal_id, revision, status, total_value, currency,
     validity_until, payment_terms, scope_summary, acceptance_conditions,
     document_id, supersedes_id, created_by)
  VALUES (p_organization_id, prev.proposal_id, v_next, 'DRAFT',
          COALESCE(nullif(p_payload->>'total_value','')::numeric, prev.total_value),
          COALESCE(nullif(btrim(p_payload->>'currency'),''), prev.currency),
          COALESCE(nullif(p_payload->>'validity_until','')::date, prev.validity_until),
          COALESCE(nullif(btrim(p_payload->>'payment_terms'),''), prev.payment_terms),
          COALESCE(nullif(btrim(p_payload->>'scope_summary'),''), prev.scope_summary),
          COALESCE(nullif(btrim(p_payload->>'acceptance_conditions'),''), prev.acceptance_conditions),
          nullif(p_payload->>'document_id','')::uuid, prev.id, p_actor)
  RETURNING id INTO v_new;

  UPDATE public.commercial_proposal_revisions
     SET status = 'SUPERSEDED', superseded_at = now(), superseded_by_id = v_new
   WHERE organization_id = p_organization_id AND id = prev.id;

  RETURN jsonb_build_object('revision_id', v_new, 'revision', v_next, 'supersedes_id', prev.id);
END $$;

/*
  As transições INTERNAS. `SENT` exige aprovação interna carimbada — e o CHECK
  `cpr_sent_is_internally_approved` recusaria de qualquer modo. Aqui a recusa
  vira mensagem legível em vez de erro de constraint.
*/
CREATE OR REPLACE FUNCTION public.commercial_proposal_revision_transition(
  p_organization_id uuid, p_actor uuid, p_revision_id uuid, p_to text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.commercial_proposal_revisions%ROWTYPE; ok boolean;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Proposal transition denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Proposal transition requires a named actor.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO r FROM public.commercial_proposal_revisions
   WHERE organization_id = p_organization_id AND id = p_revision_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proposal revision not found in tenant.' USING ERRCODE = 'P0002'; END IF;

  ok := CASE r.status
    WHEN 'DRAFT'                THEN p_to IN ('INTERNAL_REVIEW','WITHDRAWN')
    WHEN 'INTERNAL_REVIEW'      THEN p_to IN ('INTERNALLY_APPROVED','DRAFT','WITHDRAWN')
    WHEN 'INTERNALLY_APPROVED'  THEN p_to IN ('SENT','DRAFT','WITHDRAWN')
    WHEN 'SENT'                 THEN p_to IN ('NEGOTIATION','WITHDRAWN')
    WHEN 'NEGOTIATION'          THEN p_to IN ('WITHDRAWN')
    ELSE false END;
  IF NOT ok THEN
    RAISE EXCEPTION 'Proposal revision cannot move from % to %.', r.status, p_to
      USING ERRCODE = '23514';
  END IF;
  IF p_to = 'SENT' AND r.internally_approved_at IS NULL THEN
    RAISE EXCEPTION 'Proposal revision must be internally approved before it is sent.'
      USING ERRCODE = '23514';
  END IF;
  IF p_to IN ('INTERNALLY_APPROVED','SENT') AND r.total_value IS NULL THEN
    RAISE EXCEPTION 'Proposal revision without a value cannot be approved or sent.'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.commercial_proposal_revisions
     SET status = p_to,
         internal_review_at = CASE WHEN p_to = 'INTERNAL_REVIEW' THEN now() ELSE internal_review_at END,
         internally_approved_at = CASE WHEN p_to = 'INTERNALLY_APPROVED' THEN now()
                                       ELSE internally_approved_at END,
         internally_approved_by = CASE WHEN p_to = 'INTERNALLY_APPROVED' THEN p_actor
                                       ELSE internally_approved_by END,
         sent_at = CASE WHEN p_to = 'SENT' THEN now() ELSE sent_at END,
         sent_by = CASE WHEN p_to = 'SENT' THEN p_actor ELSE sent_by END,
         negotiation_at = CASE WHEN p_to = 'NEGOTIATION' THEN now() ELSE negotiation_at END,
         withdrawn_at = CASE WHEN p_to = 'WITHDRAWN' THEN now() ELSE withdrawn_at END
   WHERE organization_id = p_organization_id AND id = p_revision_id;

  RETURN jsonb_build_object('revision_id', p_revision_id, 'status', p_to);
END $$;

-- ---------------------------------------------------------------------------
-- 4) Fato extraído: registrar e confirmar
--
-- Registrar é da máquina; CONFIRMAR é de gente. São duas funções porque são
-- dois atos — e a segunda exige ator nomeado, que é o que transforma um
-- palpite de leitura em fato utilizável.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commercial_fact_record(
  p_organization_id uuid, p_payload jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_page integer; v_quote text;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Fact write denied.' USING ERRCODE = '42501';
  END IF;

  v_page := nullif(p_payload->>'source_page','')::integer;
  v_quote := nullif(btrim(p_payload->>'source_quote'), '');

  INSERT INTO public.commercial_extracted_facts
    (organization_id, engagement_id, intake_id, document_id, document_context,
     subject_kind, subject_id, fact_domain, fact_key, label, value_text, value_numeric,
     value_date, unit, currency, payload, source_revision, source_page, source_section,
     source_quote, confidence, extraction_method, ai_provider, ai_model, ai_pipeline_version,
     provenance_state)
  VALUES (p_organization_id,
          nullif(p_payload->>'engagement_id','')::uuid,
          nullif(p_payload->>'intake_id','')::uuid,
          nullif(p_payload->>'document_id','')::uuid,
          p_payload->>'document_context',
          nullif(btrim(p_payload->>'subject_kind'),''),
          nullif(p_payload->>'subject_id','')::uuid,
          p_payload->>'fact_domain', nullif(btrim(p_payload->>'fact_key'),''),
          p_payload->>'label', nullif(btrim(p_payload->>'value_text'),''),
          nullif(p_payload->>'value_numeric','')::numeric,
          nullif(p_payload->>'value_date','')::date,
          nullif(btrim(p_payload->>'unit'),''), nullif(btrim(p_payload->>'currency'),''),
          COALESCE(p_payload->'payload', '{}'::jsonb),
          nullif(btrim(p_payload->>'source_revision'),''), v_page,
          nullif(btrim(p_payload->>'source_section'),''), v_quote,
          nullif(p_payload->>'confidence','')::numeric,
          COALESCE(nullif(btrim(p_payload->>'extraction_method'),''), 'ai'),
          nullif(btrim(p_payload->>'ai_provider'),''), nullif(btrim(p_payload->>'ai_model'),''),
          nullif(btrim(p_payload->>'ai_pipeline_version'),''),
          -- DERIVADO, nunca informado: o provedor não decide se a própria
          -- leitura está ancorada.
          CASE WHEN v_page IS NOT NULL AND v_quote IS NOT NULL THEN 'ANCHORED' ELSE 'UNANCHORED' END)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.commercial_fact_confirm(
  p_organization_id uuid, p_actor uuid, p_fact_id uuid,
  p_state text, p_corrected_value text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Fact confirmation denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Confirming an extracted fact requires a named human actor.' USING ERRCODE = '42501';
  END IF;
  IF p_state NOT IN ('CONFIRMED','CORRECTED','REJECTED') THEN
    RAISE EXCEPTION 'Unsupported confirmation state %.', p_state USING ERRCODE = '22023';
  END IF;

  UPDATE public.commercial_extracted_facts
     SET confirmation_state = p_state,
         corrected_value = CASE WHEN p_state = 'CORRECTED' THEN p_corrected_value END,
         confirmed_by = p_actor, confirmed_at = now()
   WHERE organization_id = p_organization_id AND id = p_fact_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fact not found in tenant.' USING ERRCODE = 'P0002'; END IF;

  RETURN jsonb_build_object('fact_id', p_fact_id, 'confirmation_state', p_state,
                            'promotable', public.commercial_fact_promotable(p_fact_id));
END $$;

-- ---------------------------------------------------------------------------
-- 5) Blueprint de execução — planejamento, e o portão que o separa da execução
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commercial_blueprint_create(
  p_organization_id uuid, p_actor uuid, p_revision_id uuid, p_payload jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_proposal uuid; item jsonb;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Blueprint write denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Blueprint creation requires a named actor.' USING ERRCODE = '42501';
  END IF;

  SELECT proposal_id INTO v_proposal FROM public.commercial_proposal_revisions
   WHERE organization_id = p_organization_id AND id = p_revision_id;
  IF v_proposal IS NULL THEN
    RAISE EXCEPTION 'Proposal revision not found in tenant.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.commercial_execution_blueprints
    (organization_id, proposal_id, proposal_revision_id, status, generated_by,
     ai_provider, ai_model, ai_pipeline_version, created_by)
  VALUES (p_organization_id, v_proposal, p_revision_id, 'DRAFT',
          COALESCE(nullif(btrim(p_payload->>'generated_by'),''), 'human'),
          nullif(btrim(p_payload->>'ai_provider'),''), nullif(btrim(p_payload->>'ai_model'),''),
          nullif(btrim(p_payload->>'ai_pipeline_version'),''), p_actor)
  RETURNING id INTO v_id;

  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'items', '[]'::jsonb))
  LOOP
    INSERT INTO public.commercial_execution_blueprint_items
      (organization_id, blueprint_id, category, title, detail, suggested_payload,
       source_fact_id, confidence)
    VALUES (p_organization_id, v_id, item->>'category', item->>'title',
            nullif(btrim(item->>'detail'),''),
            COALESCE(item->'suggested_payload', '{}'::jsonb),
            nullif(item->>'source_fact_id','')::uuid,
            nullif(item->>'confidence','')::numeric);
  END LOOP;

  RETURN v_id;
END $$;

COMMENT ON FUNCTION public.commercial_blueprint_create(uuid,uuid,uuid,jsonb) IS
  'Cria CONTEXTO DE PLANEJAMENTO. Não cria projeto, OS, medição, faturamento, recebível '
  'nem receita contratada — o blueprint não tem FK para nenhuma tabela de execução.';

-- ---------------------------------------------------------------------------
-- 6) Privilégios
-- ---------------------------------------------------------------------------
DO $grants$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.commercial_contact_upsert(uuid,uuid,jsonb)',
    'public.commercial_opportunity_upsert(uuid,uuid,jsonb)',
    'public.commercial_proposal_create(uuid,uuid,jsonb)',
    'public.commercial_proposal_revise(uuid,uuid,uuid,jsonb)',
    'public.commercial_proposal_revision_transition(uuid,uuid,uuid,text)',
    'public.commercial_fact_record(uuid,jsonb)',
    'public.commercial_fact_confirm(uuid,uuid,uuid,text,text)',
    'public.commercial_blueprint_create(uuid,uuid,uuid,jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $grants$;

COMMIT;
