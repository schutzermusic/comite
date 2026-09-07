-- ============================================================
-- Fase 7 — 140: FRONTEIRA DE INQUILINO DAS FUNÇÕES SECURITY DEFINER
-- ============================================================
--
-- ─── O defeito, e por que ele passou ─────────────────────────────────────
--
-- As migrations 136–138 criaram funções SECURITY DEFINER que recebem um UUID e
-- vão direto à linha:
--
--     SELECT * INTO e FROM contract_billing_events WHERE id = p_billing_event_id;
--
-- Dentro de SECURITY DEFINER isso NÃO passa por RLS — a função roda como dona
-- da tabela. Quem conhecesse (ou adivinhasse) o UUID de um faturamento alheio
-- lia o valor, a moeda, o contrato e os motivos de bloqueio dele. Em
-- `contract_billing_recompute_eligibility` o estrago era pior: a função
-- ESCREVIA na linha do outro inquilino, gravava história e emitia fato.
--
-- A prova que motivou esta migration, com dois inquilinos descartáveis e a
-- chamada feita como `authenticated`, devolveu o título do contrato, o título
-- do faturamento e o valor exato de outra organização.
--
-- ─── Por que a guarda NÃO pode ser `current_user` ────────────────────────
--
-- Dentro de uma função SECURITY DEFINER, `current_user` é a DONA da função, e
-- não quem chamou. O padrão que a Fase 4 usa em `emit_domain_event` funciona
-- porque aquela função é SECURITY INVOKER de propósito — aqui, copiar o padrão
-- daria uma guarda que nunca dispara e um falso senso de proteção.
--
-- A identidade do chamador que SOBREVIVE ao DEFINER é a reivindicação JWT, que
-- o PostgREST grava a partir do token verificado. `apex_caller_is_browser()`
-- lê o PAPEL declarado nela. Um navegador não consegue forjar `service_role`
-- sem a chave de serviço, e um caminho de servidor sem reivindicação nenhuma
-- (os runners e o trabalhador de fila) continua passando.
--
-- ─── Perfil ausente passa a NEGAR, não a liberar ─────────────────────────
--
-- A guarda exige organização do chamador RESOLVIDA. Um `authenticated` sem
-- perfil ativo não vira "sem inquilino, deixa passar": vira negado. A
-- alternativa — comparar contra NULL e seguir — é exatamente como um furo
-- destes nasce.
--
-- ─── Mensagem única ──────────────────────────────────────────────────────
--
-- "Não existe" e "é de outro inquilino" respondem IGUAL, com a mesma forma de
-- retorno que a ausência genuína produz. Duas respostas distintas contariam,
-- a quem tem um UUID na mão, que aquele registro existe em algum lugar — que é
-- o oráculo que esta migration fecha.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1) Quem está chamando: navegador ou servidor?
-- ------------------------------------------------------------
CREATE FUNCTION public.apex_caller_is_browser() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE claims jsonb; claim_role text;
BEGIN
  /*
    A reivindicação pode estar ausente (conexão direta ao banco: runners,
    trabalhador de fila) ou malformada. Nos dois casos o chamador NÃO é
    navegador — e um JSON inválido não pode derrubar a função que protege a
    fronteira, então o parse é defensivo.
  */
  BEGIN
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  EXCEPTION WHEN others THEN
    claims := NULL;
  END;
  claim_role := claims ->> 'role';

  -- `current_user` só diz a verdade fora de SECURITY DEFINER; entra como
  -- reforço, nunca como única evidência.
  RETURN COALESCE(claim_role, '') IN ('authenticated', 'anon')
      OR current_user IN ('authenticated', 'anon');
END $$;
REVOKE ALL ON FUNCTION public.apex_caller_is_browser() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.apex_caller_is_browser() IS
  'Identidade do CHAMADOR que sobrevive a SECURITY DEFINER, lida da '
  'reivindicação JWT verificada pelo PostgREST. `current_user` não serve '
  'dentro de DEFINER: lá ele é a dona da função, não quem chamou.';

/*
  A organização do chamador, exigindo que ela exista.

  Devolve NULL apenas para caminho de SERVIDOR. Para navegador, ou há
  organização resolvida ou a função levanta — e quem chama trata isso como
  "não encontrado", nunca como "sem restrição".
*/
CREATE FUNCTION public.apex_browser_organization() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE org uuid;
BEGIN
  IF NOT public.apex_caller_is_browser() THEN RETURN NULL; END IF;
  org := public.current_user_organization_id();
  IF org IS NULL THEN
    RAISE EXCEPTION 'TENANT_UNRESOLVED' USING ERRCODE = '42501';
  END IF;
  RETURN org;
END $$;
REVOKE ALL ON FUNCTION public.apex_browser_organization() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.apex_browser_organization() IS
  'Organização do chamador de navegador, ou NULL para caminho de servidor. '
  'Navegador SEM perfil ativo levanta em vez de devolver NULL: comparar '
  'contra NULL e seguir é como um furo de inquilino nasce.';

-- ------------------------------------------------------------
-- 2) Privilégio: nada de EXECUTE por ACL padrão do schema
-- ------------------------------------------------------------
/*
  As migrations 136–138 escreveram `REVOKE ALL ON FUNCTION ... FROM PUBLIC` em
  várias funções internas — e isso não bastou. O projeto tem
  `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon, authenticated`,
  que concede aos DOIS PAPÉIS diretamente quando a função nasce. Revogar de
  PUBLIC não toca nesses grants.

  O resultado, medido em produção: `contract_billing_fingerprint` e o gatilho
  `fiscal_documents_emit_lifecycle` estavam executáveis por `anon`.
*/
REVOKE ALL ON FUNCTION public.contract_billing_fingerprint(uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.fiscal_documents_emit_lifecycle() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.contract_billing_events_guard_browser() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.contract_billing_events_guard_cutover() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.contract_billing_events_guard_released() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.contract_billing_history_immutable() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_installments_conserve_total() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_settlements_no_rewrite() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.contract_billing_emit(
  public.contract_billing_events, text, jsonb, uuid, text, text) FROM anon, authenticated;

/*
  RECOMPUTO sai do alcance do navegador.

  Ele MUTA: grava estado, história e fato. Um navegador não precisa disso —
  precisa LER a elegibilidade de agora, e para isso existe o resolvedor abaixo,
  que não escreve nada. Quem materializa a projeção são os caminhos governados:
  a liberação (que recomputa no ato, dentro do DEFINER) e o trabalho de fila
  que reage à medição aceita.

  Deixar a mutação exposta "porque a tela chama" foi o que transformou uma
  projeção derivada num vetor de escrita cross-tenant.
*/
REVOKE ALL ON FUNCTION public.contract_billing_recompute_eligibility(uuid) FROM anon, authenticated;

-- ------------------------------------------------------------
-- 3) Resolvedor de elegibilidade — guarda de inquilino
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contract_billing_eligibility_resolve(p_billing_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e        public.contract_billing_events%ROWTYPE;
  c        public.contracts%ROWTYPE;
  ms       public.contract_milestones%ROWTYPE;
  src      record;
  cond     record;
  obl      record;
  reasons  jsonb := '[]'::jsonb;
  state    text;
  n_block  integer;
  satisfied boolean;
  detail   jsonb;
  as_of    date := current_date;
  caller_org uuid;
  not_found jsonb := jsonb_build_object('state','UNKNOWN',
    'reasons', jsonb_build_array(jsonb_build_object(
      'code','BILLING_EVENT_NOT_FOUND','blocking',true)));
BEGIN
  SELECT * INTO e FROM public.contract_billing_events WHERE id = p_billing_event_id;
  IF NOT FOUND THEN RETURN not_found; END IF;

  /*
    A GUARDA. Vem depois do SELECT porque precisa da organização da linha, e
    ANTES de qualquer coisa derivada dela. A resposta é IDÊNTICA à ausência
    genuína — mesma forma, mesmo código — para que a diferença entre "não
    existe" e "não é seu" não seja observável.
  */
  caller_org := public.apex_browser_organization();
  IF caller_org IS NOT NULL AND e.organization_id IS DISTINCT FROM caller_org THEN
    RETURN not_found;
  END IF;

  IF e.legacy_row THEN
    RETURN jsonb_build_object('state','LEGACY',
      'reasons', jsonb_build_array(jsonb_build_object(
        'code','LEGACY_ROW_NO_PROVENANCE','blocking',true,
        'detail','Faturamento anterior à Fase 7: origem do valor desconhecida.')));
  END IF;

  IF e.release_state IN ('CANCELLED','SUPERSEDED') THEN
    RETURN jsonb_build_object('state','NOT_APPLICABLE',
      'reasons', jsonb_build_array(jsonb_build_object(
        'code','BILLING_EVENT_CLOSED','blocking',true,'detail',e.release_state)));
  END IF;

  SELECT * INTO c FROM public.contracts WHERE id = e.contract_id;
  IF e.milestone_id IS NOT NULL THEN
    SELECT * INTO ms FROM public.contract_milestones WHERE id = e.milestone_id;
  END IF;

  SELECT * INTO src FROM public.contract_billing_resolve_amount(
    e.organization_id, e.contract_id, e.milestone_id, e.source_measurement_id, as_of);

  IF src.amount_source = 'UNKNOWN' OR src.amount IS NULL THEN
    reasons := reasons || jsonb_build_object('code','AMOUNT_UNKNOWN','blocking',true,
      'detail', src.detail);
    IF (src.detail->>'reason') = 'MEASUREMENT_NOT_ACCEPTED' THEN
      reasons := reasons || jsonb_build_object('code','MEASUREMENT_NOT_ACCEPTED','blocking',true,
        'detail', src.detail->>'measurement_status');
    ELSIF e.milestone_id IS NOT NULL THEN
      reasons := reasons || jsonb_build_object('code','MEASUREMENT_UNKNOWN','blocking',true);
    END IF;
  ELSIF src.currency IS NULL THEN
    reasons := reasons || jsonb_build_object('code','CURRENCY_UNKNOWN','blocking',true,
      'detail','Fonte ' || src.amount_source || ' não declarou moeda.');
  END IF;

  FOR cond IN
    SELECT * FROM public.contract_billing_conditions bc
     WHERE bc.organization_id = e.organization_id
       AND bc.contract_id = e.contract_id
       AND bc.effect <> 'removed'
       AND (bc.effective_from  IS NULL OR bc.effective_from  <= as_of)
       AND (bc.effective_until IS NULL OR bc.effective_until >= as_of)
       AND (bc.milestone_id IS NULL OR bc.milestone_id = e.milestone_id)
       AND NOT EXISTS (SELECT 1 FROM public.contract_billing_conditions s
                        WHERE s.predecessor_id = bc.id)
  LOOP
    satisfied := NULL;
    detail := jsonb_build_object('condition_id', cond.id, 'title', cond.title,
                                 'condition_type', cond.condition_type,
                                 'source_clause_id', cond.source_clause_id,
                                 'source_reference', cond.source_reference);

    IF cond.condition_type = 'measurement_accepted' THEN
      satisfied := EXISTS (
        SELECT 1 FROM public.project_measurements m
         WHERE m.organization_id = e.organization_id AND m.status = 'ACCEPTED'
           AND (m.id = e.source_measurement_id
             OR (e.milestone_id IS NOT NULL AND m.milestone_id = e.milestone_id)));
      IF satisfied IS NOT TRUE THEN
        reasons := reasons || (detail || jsonb_build_object('code','MEASUREMENT_NOT_ACCEPTED','blocking',true));
      END IF;

    ELSIF cond.condition_type = 'milestone_reached' THEN
      IF e.milestone_id IS NULL THEN
        reasons := reasons || (detail || jsonb_build_object('code','CONTRACT_RULE_UNRESOLVED','blocking',true,
          'why','Condição exige marco e o faturamento não referencia nenhum.'));
      ELSE
        satisfied := (ms.completed_at IS NOT NULL) OR ms.status IN ('measured','approved');
        IF NOT satisfied THEN
          reasons := reasons || (detail || jsonb_build_object('code','CONTRACT_RULE_UNRESOLVED','blocking',true,
            'why','Marco em ' || COALESCE(ms.status,'?')));
        END IF;
      END IF;

    ELSIF cond.condition_type IN ('customer_approval_required','technical_acceptance_required') THEN
      satisfied := EXISTS (
        SELECT 1 FROM public.project_measurements m
         WHERE m.organization_id = e.organization_id AND m.status = 'ACCEPTED'
           AND (m.id = e.source_measurement_id
             OR (e.milestone_id IS NOT NULL AND m.milestone_id = e.milestone_id))
           AND m.acceptance_source IN ('customer_portal','signed_bulletin','external_document','integration'));
      IF NOT satisfied THEN
        reasons := reasons || (detail || jsonb_build_object('code','FORMAL_ACCEPTANCE_PENDING','blocking',true));
      END IF;

    ELSIF cond.condition_type IN ('service_report_required','evidence_required','specific_document_required') THEN
      satisfied := EXISTS (
        SELECT 1 FROM public.project_measurement_evidence ev
          JOIN public.project_measurements m
            ON m.id = ev.measurement_id AND m.organization_id = ev.organization_id
         WHERE ev.organization_id = e.organization_id
           AND (m.id = e.source_measurement_id
             OR (e.milestone_id IS NOT NULL AND m.milestone_id = e.milestone_id))
           AND (cond.required_document_type IS NULL
             OR ev.requirement_kind = cond.required_document_type));
      IF NOT satisfied THEN
        reasons := reasons || (detail || jsonb_build_object('code','REQUIRED_DOCUMENT_MISSING','blocking',true,
          'required_document_type', cond.required_document_type));
      END IF;

    ELSIF cond.condition_type = 'elapsed_contractual_period' THEN
      IF cond.elapsed_period_days IS NULL OR ms.completed_at IS NULL THEN
        reasons := reasons || (detail || jsonb_build_object('code','CONTRACT_RULE_UNRESOLVED','blocking',true,
          'why','Prazo contratual sem marco concluído ou sem número de dias.'));
      ELSE
        satisfied := (ms.completed_at::date + cond.elapsed_period_days) <= as_of;
        IF NOT satisfied THEN
          reasons := reasons || (detail || jsonb_build_object('code','CONTRACT_RULE_UNRESOLVED','blocking',true,
            'why','Prazo contratual ainda não decorrido.',
            'eligible_from', (ms.completed_at::date + cond.elapsed_period_days)));
        END IF;
      END IF;

    ELSE
      reasons := reasons || (detail || jsonb_build_object('code','CONTRACT_RULE_UNRESOLVED','blocking',true,
        'why','Tipo de condição sem avaliação determinística.'));
    END IF;
  END LOOP;

  FOR obl IN
    SELECT i.id, i.occurrence_key, i.state, i.due_date, d.title
      FROM public.contract_obligation_instances i
      JOIN public.contract_obligation_definitions d
        ON d.id = i.definition_id AND d.organization_id = i.organization_id
     WHERE i.organization_id = e.organization_id
       AND i.contract_id = e.contract_id
       AND d.blocks_billing IS TRUE
       AND i.state IN ('OPEN','EXCEPTION')
  LOOP
    reasons := reasons || jsonb_build_object('code','OBLIGATION_BLOCKING','blocking',true,
      'obligation_instance_id', obl.id, 'title', obl.title,
      'occurrence_key', obl.occurrence_key, 'state', obl.state, 'due_date', obl.due_date);
  END LOOP;

  IF c.counterparty_party_id IS NULL THEN
    reasons := reasons || jsonb_build_object('code','COUNTERPARTY_UNRESOLVED','blocking',true,
      'detail','Contrato sem parte canônica vinculada.');
  END IF;

  IF c.counterparty_party_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.fiscal_party_profiles p
                      WHERE p.organization_id = e.organization_id
                        AND p.party_id = c.counterparty_party_id AND p.active) THEN
    reasons := reasons || jsonb_build_object('code','FISCAL_PROFILE_INCOMPLETE','blocking',false,
      'detail','Parte sem perfil fiscal ativo: a emissão não sai, o direito permanece.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fiscal_establishments fe
                  WHERE fe.organization_id = e.organization_id AND fe.active) THEN
    reasons := reasons || jsonb_build_object('code','FISCAL_PROFILE_INCOMPLETE','blocking',false,
      'detail','Organização sem estabelecimento fiscal ativo.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.finance_cost_centers cc
                  WHERE cc.organization_id = e.organization_id AND cc.active) THEN
    reasons := reasons || jsonb_build_object('code','ACCOUNTING_CONFIGURATION_MISSING','blocking',false,
      'detail','Sem centro de custo canônico ativo.');
  END IF;

  SELECT count(*)::int INTO n_block
    FROM jsonb_array_elements(reasons) r WHERE (r->>'blocking')::boolean;

  IF n_block = 0 THEN
    state := 'ELIGIBLE';
  ELSIF EXISTS (SELECT 1 FROM jsonb_array_elements(reasons) r
                 WHERE r->>'code' IN ('AMOUNT_UNKNOWN','CURRENCY_UNKNOWN','MEASUREMENT_UNKNOWN',
                                      'CONTRACT_RULE_UNRESOLVED','COUNTERPARTY_UNRESOLVED')) THEN
    state := 'INCOMPLETE';
  ELSE
    state := 'BLOCKED';
  END IF;

  RETURN jsonb_build_object(
    'state', state,
    'reasons', reasons,
    'amount', src.amount,
    'currency', src.currency,
    'amount_source', src.amount_source,
    'amount_source_id', src.source_id,
    'amount_source_revision', src.source_revision,
    'derivation_rule', src.derivation_rule,
    'amount_detail', src.detail,
    'computed_at', now());
END $$;

-- ------------------------------------------------------------
-- 4) Recomputo — guarda mesmo fora do alcance do navegador
-- ------------------------------------------------------------
-- O REVOKE acima já tira a função do navegador. A guarda entra assim mesmo:
-- privilégio revogado protege contra o caminho conhecido, a guarda protege
-- contra o caminho que alguém abrir depois.
CREATE OR REPLACE FUNCTION public.contract_billing_recompute_eligibility(p_billing_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e     public.contract_billing_events%ROWTYPE;
  res   jsonb;
  prev  text;
  fp    text;
  hist_id uuid;
  caller_org uuid;
BEGIN
  SELECT * INTO e FROM public.contract_billing_events WHERE id = p_billing_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BILLING_EVENT_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  caller_org := public.apex_browser_organization();
  IF caller_org IS NOT NULL AND e.organization_id IS DISTINCT FROM caller_org THEN
    -- Mesma mensagem de "não existe".
    RAISE EXCEPTION 'BILLING_EVENT_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  IF e.legacy_row THEN
    RETURN jsonb_build_object('billing_event_id', e.id, 'state', 'LEGACY', 'skipped', true);
  END IF;

  res  := public.contract_billing_eligibility_resolve(p_billing_event_id);
  prev := e.eligibility_state;

  UPDATE public.contract_billing_events
     SET eligibility_state       = res->>'state',
         eligibility_reasons     = res->'reasons',
         eligibility_computed_at = now(),
         amount                  = CASE WHEN e.release_state IS DISTINCT FROM 'RELEASED'
                                          AND (res->>'amount') IS NOT NULL
                                        THEN (res->>'amount')::numeric ELSE amount END,
         currency                = CASE WHEN e.release_state IS DISTINCT FROM 'RELEASED'
                                        THEN res->>'currency' ELSE currency END,
         amount_source           = CASE WHEN e.release_state IS DISTINCT FROM 'RELEASED'
                                        THEN res->>'amount_source' ELSE amount_source END,
         amount_source_id        = CASE WHEN e.release_state IS DISTINCT FROM 'RELEASED'
                                        THEN NULLIF(res->>'amount_source_id','')::uuid ELSE amount_source_id END,
         amount_source_revision  = CASE WHEN e.release_state IS DISTINCT FROM 'RELEASED'
                                        THEN NULLIF(res->>'amount_source_revision','')::integer ELSE amount_source_revision END,
         amount_derivation_rule  = CASE WHEN e.release_state IS DISTINCT FROM 'RELEASED'
                                        THEN res->>'derivation_rule' ELSE amount_derivation_rule END,
         amount_derived_at       = CASE WHEN e.release_state IS DISTINCT FROM 'RELEASED'
                                        THEN now() ELSE amount_derived_at END,
         release_state           = CASE
                                     WHEN e.release_state IN ('RELEASED','PENDING_RELEASE','CANCELLED',
                                                              'SUPERSEDED','RELEASE_REJECTED','LEGACY')
                                       THEN e.release_state
                                     WHEN res->>'state' = 'ELIGIBLE' THEN 'ELIGIBLE'
                                     ELSE 'NOT_ELIGIBLE' END,
         updated_at              = now()
   WHERE id = e.id;

  SELECT * INTO e FROM public.contract_billing_events WHERE id = e.id;
  IF e.release_state IS DISTINCT FROM 'RELEASED' THEN
    fp := public.contract_billing_fingerprint(e.id);
    UPDATE public.contract_billing_events SET amount_fingerprint = fp WHERE id = e.id;
    SELECT * INTO e FROM public.contract_billing_events WHERE id = e.id;
  END IF;

  IF prev IS DISTINCT FROM e.eligibility_state THEN
    INSERT INTO public.contract_billing_event_history
      (organization_id, billing_event_id, transition, from_state, to_state, detail, actor_source, correlation_id)
    VALUES (e.organization_id, e.id, 'eligibility_recomputed', prev, e.eligibility_state,
            jsonb_build_object('reasons', e.eligibility_reasons,
                               'amount_source', e.amount_source),
            'system', e.correlation_id)
    RETURNING id INTO hist_id;

    PERFORM public.contract_billing_emit(e,
      CASE WHEN e.eligibility_state = 'ELIGIBLE'
           THEN 'contracts.billing.eligible' ELSE 'contracts.billing.blocked' END,
      jsonb_build_object('previous_state', prev, 'reasons', e.eligibility_reasons),
      auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'human' END,
      'history:' || hist_id::text);
  END IF;

  RETURN jsonb_build_object('billing_event_id', e.id, 'state', e.eligibility_state,
                            'release_state', e.release_state,
                            'amount', e.amount, 'currency', e.currency,
                            'amount_source', e.amount_source,
                            'reasons', e.eligibility_reasons,
                            'changed', prev IS DISTINCT FROM e.eligibility_state);
END $$;
REVOKE ALL ON FUNCTION public.contract_billing_recompute_eligibility(uuid) FROM anon, authenticated;

-- ------------------------------------------------------------
-- 5) Prontidão fiscal — guarda de inquilino
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contract_billing_fiscal_readiness(p_billing_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e        public.contract_billing_events%ROWTYPE;
  c        public.contracts%ROWTYPE;
  blockers jsonb := '[]'::jsonb;
  estab_id uuid;
  caller_org uuid;
  not_found jsonb := jsonb_build_object('ready', false,
    'blockers', jsonb_build_array(jsonb_build_object('code','BILLING_EVENT_NOT_FOUND')));
BEGIN
  SELECT * INTO e FROM public.contract_billing_events WHERE id = p_billing_event_id;
  IF NOT FOUND THEN RETURN not_found; END IF;

  caller_org := public.apex_browser_organization();
  IF caller_org IS NOT NULL AND e.organization_id IS DISTINCT FROM caller_org THEN
    RETURN not_found;
  END IF;

  SELECT * INTO c FROM public.contracts WHERE id = e.contract_id;

  IF e.release_state <> 'RELEASED' THEN
    blockers := blockers || jsonb_build_object('code','BILLING_NOT_RELEASED','detail', e.release_state);
  END IF;
  IF e.amount IS NULL OR e.amount <= 0 THEN
    blockers := blockers || jsonb_build_object('code','AMOUNT_UNKNOWN');
  END IF;
  IF e.currency IS NULL THEN
    blockers := blockers || jsonb_build_object('code','CURRENCY_UNKNOWN');
  END IF;
  IF c.counterparty_party_id IS NULL THEN
    blockers := blockers || jsonb_build_object('code','COUNTERPARTY_UNRESOLVED');
  END IF;

  SELECT id INTO estab_id FROM public.fiscal_establishments
   WHERE organization_id = e.organization_id AND active ORDER BY created_at LIMIT 1;
  IF estab_id IS NULL THEN
    blockers := blockers || jsonb_build_object('code','FISCAL_ESTABLISHMENT_MISSING');
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.fiscal_service_catalog s
                    WHERE s.organization_id = e.organization_id
                      AND s.establishment_id = estab_id AND s.active) THEN
      blockers := blockers || jsonb_build_object('code','FISCAL_SERVICE_CATALOG_MISSING');
    END IF;
  END IF;

  IF c.counterparty_party_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.fiscal_party_profiles p
                      WHERE p.organization_id = e.organization_id
                        AND p.party_id = c.counterparty_party_id AND p.active) THEN
    blockers := blockers || jsonb_build_object('code','FISCAL_PARTY_PROFILE_MISSING');
  END IF;

  RETURN jsonb_build_object(
    'ready', jsonb_array_length(blockers) = 0,
    'blockers', blockers,
    'establishment_id', estab_id,
    'amount_cents', CASE WHEN e.amount IS NOT NULL THEN round(e.amount * 100)::bigint END,
    'currency', e.currency,
    'party_id', c.counterparty_party_id,
    'contract_id', e.contract_id,
    'billing_event_id', e.id);
END $$;

-- ------------------------------------------------------------
-- 6) Impressão digital — guarda, além do REVOKE
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contract_billing_fingerprint(p_billing_event_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE e public.contract_billing_events%ROWTYPE; caller_org uuid;
BEGIN
  SELECT * INTO e FROM public.contract_billing_events WHERE id = p_billing_event_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- NULL é a resposta da ausência: "de outro inquilino" responde igual.
  caller_org := public.apex_browser_organization();
  IF caller_org IS NOT NULL AND e.organization_id IS DISTINCT FROM caller_org THEN
    RETURN NULL;
  END IF;

  RETURN encode(extensions.digest(concat_ws('|',
    'contract_billing_event.v1',
    e.id::text,
    e.organization_id::text,
    e.contract_id::text,
    COALESCE(e.milestone_id::text, '-'),
    COALESCE(e.source_measurement_id::text, '-'),
    COALESCE(e.amount_source, '-'),
    COALESCE(e.amount_source_id::text, '-'),
    COALESCE(e.amount_source_revision::text, '-'),
    COALESCE(e.amount::text, '-'),
    COALESCE(e.currency, '-'),
    COALESCE(e.due_date::text, '-'),
    COALESCE(e.entitlement_key, '-'),
    'retention:-', 'glosa:-', 'dispute:-'
  )::bytea, 'sha256'), 'hex');
END $$;
REVOKE ALL ON FUNCTION public.contract_billing_fingerprint(uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 7) Reversão de recebível — guarda de inquilino E de permissão
-- ------------------------------------------------------------
/*
  Esta é a mais grave das seis: ela CANCELA um título. A versão da 138 não
  tinha guarda de inquilino nenhuma e não pedia permissão — bastava o UUID.
*/
CREATE OR REPLACE FUNCTION public.finance_receivable_reverse(
  p_receivable_id uuid,
  p_reason        text,
  p_state         text DEFAULT 'REVERSED'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r public.finance_receivables%ROWTYPE;
  actor uuid := auth.uid();
  caller_org uuid;
BEGIN
  IF p_state NOT IN ('REVERSED','CANCELLED','RENEGOTIATED') THEN
    RAISE EXCEPTION 'INVALID_LIFECYCLE_STATE' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO r FROM public.finance_receivables WHERE id = p_receivable_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RECEIVABLE_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;

  caller_org := public.apex_browser_organization();
  IF caller_org IS NOT NULL THEN
    IF r.organization_id IS DISTINCT FROM caller_org THEN
      RAISE EXCEPTION 'RECEIVABLE_NOT_FOUND' USING ERRCODE = 'no_data_found';
    END IF;
    -- Derrubar um título é ato de Finanças, e exige o papel dela.
    IF NOT public.has_finance_role_or_perm('finance_admin', 'finance.admin') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: falta a autoridade financeira para reverter título.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF r.lifecycle_state <> 'ACTIVE' THEN
    RETURN jsonb_build_object('receivable_id', r.id, 'lifecycle_state', r.lifecycle_state,
                              'idempotent', true);
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.finance_receivables
     SET lifecycle_state = p_state, closed_at = now(), closed_reason = p_reason, updated_at = now()
   WHERE id = r.id;

  IF r.ledger_posting_state = 'POSTED' THEN
    UPDATE public.finance_receivables SET ledger_posting_state = 'REVERSED' WHERE id = r.id;
    UPDATE public.fiscal_documents SET finance_status = 'reversed'
     WHERE id = r.fiscal_document_id;
  END IF;

  PERFORM public.emit_domain_event(
    r.organization_id, 'finance.receivable.reversed', 1, 'finance_receivable', r.id,
    'finance-receivable-reversed:' || r.id::text || ':' || p_state,
    jsonb_build_object('lifecycle_state', p_state, 'reason', p_reason,
                       'fiscal_document_id', r.fiscal_document_id,
                       'billing_event_id', r.billing_event_id),
    now(), CASE WHEN actor IS NULL THEN 'system' ELSE 'human' END, actor, r.correlation_id, NULL);

  RETURN jsonb_build_object('receivable_id', r.id, 'lifecycle_state', p_state, 'idempotent', false);
END $$;

-- ------------------------------------------------------------
-- 8) Sujeito de aprovação — o chamador não escolhe a organização
-- ------------------------------------------------------------
/*
  `approval_subject_resolve` recebe `p_organization_id` do CHAMADOR e filtra por
  ele. Para um caminho de servidor isso é correto — quem orquestra sabe de quem
  é o sujeito. Para o navegador é um oráculo perfeito: basta passar a
  organização alheia junto do UUID alheio, e a função devolve rótulo, valor e
  impressão digital.

  A função existe desde a Fase 5 e é usada pelo motor de aprovação; a correção
  preserva o comportamento de servidor e recusa a divergência de navegador,
  com a MESMA forma de "não encontrado" que a ausência genuína produz.
*/
CREATE OR REPLACE FUNCTION public.approval_subject_resolve(
  p_organization_id uuid,
  p_subject_type    text,
  p_subject_id      uuid
) RETURNS TABLE (
  supported        boolean,
  found            boolean,
  fingerprint      text,
  amount           numeric,
  currency         text,
  label            text,
  created_by       uuid,
  business_domain  text,
  contract_type    text,
  risk_class       text,
  cost_center_id   uuid,
  business_unit_id uuid
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  c   public.contracts%ROWTYPE;
  rev public.contract_amendment_revisions%ROWTYPE;
  pm  public.project_measurements%ROWTYPE;
  be  public.contract_billing_events%ROWTYPE;
  caller_org uuid;
  domain text;
BEGIN
  -- Tipo desconhecido responde "não suportado" ANTES de qualquer leitura.
  IF p_subject_type NOT IN ('contract','contract_amendment_revision',
                            'project_measurement','contract_billing_event') THEN
    RETURN QUERY SELECT false, false, NULL::text, NULL::numeric, NULL::text, NULL::text,
                        NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  domain := CASE WHEN p_subject_type = 'project_measurement' THEN 'projects' ELSE 'contracts' END;

  /*
    A GUARDA. O navegador não escolhe de qual organização quer o sujeito: a
    dele é a única possível. Divergência responde "suportado, não encontrado" —
    exatamente o que uma organização vazia devolveria.
  */
  caller_org := public.apex_browser_organization();
  IF caller_org IS NOT NULL AND p_organization_id IS DISTINCT FROM caller_org THEN
    RETURN QUERY SELECT true, false, NULL::text, NULL::numeric, NULL::text, NULL::text,
                        NULL::uuid, domain, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  IF p_subject_type = 'contract' THEN
    SELECT * INTO c FROM public.contracts
     WHERE id = p_subject_id AND organization_id = p_organization_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RETURN QUERY SELECT true, false, NULL::text, NULL::numeric, NULL::text, NULL::text,
                          NULL::uuid, 'contracts'::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
      RETURN;
    END IF;
    RETURN QUERY SELECT
      true, true,
      public.contract_approval_fingerprint(c.id),
      c.total_value,
      CASE WHEN c.currency IS NOT NULL AND c.currency ~ '^[A-Z]{3}$' THEN c.currency END,
      COALESCE(c.contract_number || ' — ', '') || COALESCE(c.title, 'Contrato'),
      c.created_by,
      'contracts'::text, c.contract_type, c.risk_level, NULL::uuid, NULL::uuid;
    RETURN;

  ELSIF p_subject_type = 'contract_amendment_revision' THEN
    SELECT * INTO rev FROM public.contract_amendment_revisions
     WHERE id = p_subject_id AND organization_id = p_organization_id;
    IF NOT FOUND THEN
      RETURN QUERY SELECT true, false, NULL::text, NULL::numeric, NULL::text, NULL::text,
                          NULL::uuid, 'contracts'::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
      RETURN;
    END IF;
    SELECT * INTO c FROM public.contracts WHERE id = rev.contract_id;
    RETURN QUERY SELECT
      true, true,
      encode(extensions.digest(concat_ws('|', 'contract_amendment_revision.v1',
        rev.id::text, rev.revision::text, rev.amendment_id::text,
        md5(COALESCE(rev.amendment_snapshot, '{}'::jsonb)::text))::bytea, 'sha256'), 'hex'),
      NULLIF(rev.amendment_snapshot->>'value_delta','')::numeric,
      CASE WHEN c.currency ~ '^[A-Z]{3}$' THEN c.currency END,
      format('Aditivo rev. %s — %s', rev.revision, COALESCE(c.contract_number, c.title, 'contrato')),
      NULL::uuid,
      'contracts'::text, c.contract_type, c.risk_level, NULL::uuid, NULL::uuid;
    RETURN;

  ELSIF p_subject_type = 'project_measurement' THEN
    SELECT * INTO pm FROM public.project_measurements
     WHERE id = p_subject_id AND organization_id = p_organization_id;
    IF NOT FOUND THEN
      RETURN QUERY SELECT true, false, NULL::text, NULL::numeric, NULL::text, NULL::text,
                          NULL::uuid, 'projects'::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
      RETURN;
    END IF;
    SELECT * INTO c FROM public.contracts WHERE id = pm.contract_id;
    RETURN QUERY SELECT
      true, true,
      public.project_measurement_fingerprint(pm.id),
      pm.measured_value,
      CASE WHEN pm.currency ~ '^[A-Z]{3}$' THEN pm.currency END,
      format('Medição %s rev. %s — %s', pm.occurrence_key, pm.revision,
             COALESCE(c.contract_number, c.title, 'contrato')),
      pm.created_by,
      'projects'::text, c.contract_type, c.risk_level, NULL::uuid, NULL::uuid;
    RETURN;

  ELSE
    SELECT * INTO be FROM public.contract_billing_events
     WHERE id = p_subject_id AND organization_id = p_organization_id;
    IF NOT FOUND THEN
      RETURN QUERY SELECT true, false, NULL::text, NULL::numeric, NULL::text, NULL::text,
                          NULL::uuid, 'contracts'::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
      RETURN;
    END IF;
    SELECT * INTO c FROM public.contracts WHERE id = be.contract_id;
    RETURN QUERY SELECT
      true, true,
      public.contract_billing_fingerprint(be.id),
      be.amount,
      CASE WHEN be.currency ~ '^[A-Z]{3}$' THEN be.currency END,
      format('Faturamento %s — %s', COALESCE(be.title, be.id::text),
             COALESCE(c.contract_number, c.title, 'contrato')),
      NULL::uuid,
      'contracts'::text, c.contract_type, c.risk_level, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.approval_subject_resolve(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 9) O MESMO defeito, na forma mais sutil: guarda presa ao ator
-- ------------------------------------------------------------
/*
  Cinco funções de Finanças JÁ conferiam a organização — mas só depois de
  `IF actor IS NOT NULL`, isto é, só quando `auth.uid()` devolvia alguém.

  A intenção era distinguir chamada de servidor (sem ator) de chamada de
  navegador. A consequência é que a guarda inteira — inquilino E permissão —
  desaparece para qualquer chamador cujo token não traga `sub`. Um JWT com
  `role: authenticated` e sem `sub` é aceito pelo PostgREST, vira o papel
  `authenticated` e cai no ramo "sem ator, é servidor".

  A correção troca o gatilho da guarda: quem decide se há guarda passa a ser o
  PAPEL declarado no token, não a presença de uma pessoa. Um token de navegador
  sem `sub` agora levanta `TENANT_UNRESOLVED` em vez de virar servidor.

  O caminho de servidor real (service_role, e as conexões diretas dos runners e
  do trabalhador de fila) continua sem guarda, que é o que ele precisa para
  operar entre inquilinos.
*/
CREATE OR REPLACE FUNCTION public.finance_settlement_record(
  p_receivable_id    uuid,
  p_amount_cents     bigint,
  p_effective_date   date,
  p_source           text,
  p_payment_source_id uuid DEFAULT NULL,
  p_external_reference text DEFAULT NULL,
  p_installment_id   uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r     public.finance_receivables%ROWTYPE;
  bal   record;
  actor uuid := auth.uid();
  s_id  uuid;
  existing uuid;
  caller_org uuid;
BEGIN
  SELECT * INTO r FROM public.finance_receivables WHERE id = p_receivable_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RECEIVABLE_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;

  caller_org := public.apex_browser_organization();
  IF caller_org IS NOT NULL THEN
    IF r.organization_id IS DISTINCT FROM caller_org THEN
      RAISE EXCEPTION 'RECEIVABLE_NOT_FOUND' USING ERRCODE = 'no_data_found';
    END IF;
    IF NOT (public.current_user_has_permission('finance.settlements.record')
            OR public.has_finance_role_or_perm('finance_admin','finance.admin')) THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: falta a permissão finance.settlements.record.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF r.lifecycle_state <> 'ACTIVE' THEN
    RAISE EXCEPTION 'RECEIVABLE_NOT_ACTIVE: título em % não recebe liquidação.', r.lifecycle_state
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'AMOUNT_MUST_BE_POSITIVE' USING ERRCODE = 'check_violation';
  END IF;

  IF p_payment_source_id IS NOT NULL THEN
    SELECT id INTO existing FROM public.finance_settlements
     WHERE organization_id = r.organization_id AND receivable_id = r.id
       AND payment_source_id = p_payment_source_id AND kind = 'PAYMENT';
    IF existing IS NOT NULL THEN
      RETURN jsonb_build_object('settlement_id', existing, 'idempotent', true);
    END IF;
  END IF;

  SELECT * INTO bal FROM public.finance_receivable_balances WHERE receivable_id = r.id;

  IF p_amount_cents > bal.open_amount_cents THEN
    RAISE EXCEPTION
      'OVERPAYMENT_REVIEW_REQUIRED: recebimento de % excede o saldo aberto de % (§47). '
      'Não há modelo de crédito não alocado: registre a diferença por decisão de Finanças.',
      p_amount_cents, bal.open_amount_cents USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.finance_settlements
    (organization_id, receivable_id, installment_id, kind, amount_cents, currency,
     effective_date, source, payment_source_id, external_reference,
     actor_user_id, actor_source, correlation_id)
  VALUES (r.organization_id, r.id, p_installment_id, 'PAYMENT', p_amount_cents, r.currency,
          COALESCE(p_effective_date, current_date), p_source, p_payment_source_id,
          p_external_reference, actor,
          CASE WHEN actor IS NULL THEN 'system' ELSE 'human' END, r.correlation_id)
  RETURNING id INTO s_id;

  SELECT * INTO bal FROM public.finance_receivable_balances WHERE receivable_id = r.id;

  PERFORM public.emit_domain_event(
    r.organization_id, 'finance.settlement.recorded', 1, 'finance_receivable', r.id,
    'finance-settlement:' || s_id::text,
    jsonb_build_object('settlement_id', s_id, 'amount_cents', p_amount_cents,
      'paid_amount_cents', bal.paid_amount_cents, 'open_amount_cents', bal.open_amount_cents,
      'derived_status', bal.derived_status, 'source', p_source,
      'contract_id', r.contract_id, 'billing_event_id', r.billing_event_id),
    now(), CASE WHEN actor IS NULL THEN 'system' ELSE 'human' END, actor, r.correlation_id, NULL);

  IF bal.derived_status = 'PAID' THEN
    PERFORM public.emit_domain_event(
      r.organization_id, 'finance.receivable.paid', 1, 'finance_receivable', r.id,
      'finance-receivable-paid:' || r.id::text,
      jsonb_build_object('paid_amount_cents', bal.paid_amount_cents,
                         'contract_id', r.contract_id, 'billing_event_id', r.billing_event_id),
      now(), 'system', NULL, r.correlation_id, NULL);
  ELSIF bal.derived_status = 'PARTIAL' THEN
    PERFORM public.emit_domain_event(
      r.organization_id, 'finance.receivable.partial', 1, 'finance_receivable', r.id,
      'finance-receivable-partial:' || s_id::text,
      jsonb_build_object('paid_amount_cents', bal.paid_amount_cents,
                         'open_amount_cents', bal.open_amount_cents),
      now(), 'system', NULL, r.correlation_id, NULL);
  END IF;

  RETURN jsonb_build_object('settlement_id', s_id, 'idempotent', false,
    'paid_amount_cents', bal.paid_amount_cents, 'open_amount_cents', bal.open_amount_cents,
    'derived_status', bal.derived_status);
END $$;

CREATE OR REPLACE FUNCTION public.finance_settlement_reverse(
  p_settlement_id uuid,
  p_reason        text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s public.finance_settlements%ROWTYPE;
  r public.finance_receivables%ROWTYPE;
  actor uuid := auth.uid();
  rev_id uuid;
  bal record;
  caller_org uuid;
BEGIN
  SELECT * INTO s FROM public.finance_settlements WHERE id = p_settlement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SETTLEMENT_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;

  caller_org := public.apex_browser_organization();
  IF caller_org IS NOT NULL AND s.organization_id IS DISTINCT FROM caller_org THEN
    RAISE EXCEPTION 'SETTLEMENT_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  IF s.kind <> 'PAYMENT' THEN
    RAISE EXCEPTION 'ONLY_PAYMENTS_REVERSIBLE' USING ERRCODE = 'check_violation';
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO r FROM public.finance_receivables WHERE id = s.receivable_id FOR UPDATE;
  IF caller_org IS NOT NULL THEN
    IF NOT (public.current_user_has_permission('finance.settlements.record')
            OR public.has_finance_role_or_perm('finance_admin','finance.admin')) THEN
      RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT id INTO rev_id FROM public.finance_settlements WHERE reversal_of = s.id;
  IF rev_id IS NOT NULL THEN
    RETURN jsonb_build_object('reversal_id', rev_id, 'idempotent', true);
  END IF;

  INSERT INTO public.finance_settlements
    (organization_id, receivable_id, installment_id, kind, amount_cents, currency,
     effective_date, source, reversal_of, reversal_reason, actor_user_id, actor_source, correlation_id)
  VALUES (s.organization_id, s.receivable_id, s.installment_id, 'REVERSAL', s.amount_cents,
          s.currency, current_date, 'REVERSAL', s.id, p_reason, actor,
          CASE WHEN actor IS NULL THEN 'system' ELSE 'human' END, s.correlation_id)
  RETURNING id INTO rev_id;

  INSERT INTO public.finance_reconciliations
    (organization_id, settlement_id, payment_source_id, state, match_kind,
     matched_amount_cents, reversal_of, reversal_reason, actor_source, reconciled_by)
  SELECT rc.organization_id, rc.settlement_id, rc.payment_source_id, 'REVERSED', rc.match_kind,
         rc.matched_amount_cents, rc.id, p_reason, 'system', NULL
    FROM public.finance_reconciliations rc
   WHERE rc.settlement_id = s.id AND rc.state <> 'REVERSED';

  SELECT * INTO bal FROM public.finance_receivable_balances WHERE receivable_id = r.id;

  PERFORM public.emit_domain_event(
    r.organization_id, 'finance.settlement.reversed', 1, 'finance_receivable', r.id,
    'finance-settlement-reversed:' || rev_id::text,
    jsonb_build_object('reversal_id', rev_id, 'settlement_id', s.id, 'reason', p_reason,
      'paid_amount_cents', bal.paid_amount_cents, 'open_amount_cents', bal.open_amount_cents,
      'derived_status', bal.derived_status),
    now(), CASE WHEN actor IS NULL THEN 'system' ELSE 'human' END, actor, r.correlation_id, NULL);

  RETURN jsonb_build_object('reversal_id', rev_id, 'idempotent', false,
    'paid_amount_cents', bal.paid_amount_cents, 'open_amount_cents', bal.open_amount_cents,
    'derived_status', bal.derived_status);
END $$;

CREATE OR REPLACE FUNCTION public.finance_payment_source_import(
  p_organization_id uuid,
  p_source_kind     text,
  p_amount_cents    bigint,
  p_value_date      date,
  p_external_transaction_id text DEFAULT NULL,
  p_payer_name      text DEFAULT NULL,
  p_payer_document  text DEFAULT NULL,
  p_bank_reference  text DEFAULT NULL,
  p_raw_reference   text DEFAULT NULL,
  p_currency        text DEFAULT 'BRL'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  fp text; existing uuid; new_id uuid; actor uuid := auth.uid(); caller_org uuid;
BEGIN
  caller_org := public.apex_browser_organization();
  IF caller_org IS NOT NULL THEN
    -- O chamador NÃO escolhe a organização da evidência de caixa.
    IF p_organization_id IS DISTINCT FROM caller_org THEN
      RAISE EXCEPTION 'IMPORT_DENIED' USING ERRCODE = '42501';
    END IF;
    IF NOT (public.current_user_has_permission('finance.reconciliation.manage')
            OR public.has_finance_role_or_perm('finance_admin','finance.admin')) THEN
      RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE = '42501';
    END IF;
  END IF;

  fp := COALESCE(
    NULLIF(btrim(COALESCE(p_external_transaction_id,'')), ''),
    encode(extensions.digest(concat_ws('|', 'payment_source.v1', p_source_kind,
      p_amount_cents::text, p_value_date::text, COALESCE(p_payer_document,''),
      COALESCE(p_payer_name,''), COALESCE(p_bank_reference,''),
      COALESCE(p_raw_reference,''))::bytea, 'sha256'), 'hex'));

  SELECT id INTO existing FROM public.finance_payment_sources
   WHERE organization_id = p_organization_id AND fingerprint = fp;
  IF existing IS NOT NULL THEN
    RETURN jsonb_build_object('payment_source_id', existing, 'idempotent', true);
  END IF;

  INSERT INTO public.finance_payment_sources
    (organization_id, source_kind, external_transaction_id, fingerprint, amount_cents,
     currency, value_date, payer_name, payer_document, bank_reference, raw_reference, imported_by)
  VALUES (p_organization_id, p_source_kind,
          NULLIF(btrim(COALESCE(p_external_transaction_id,'')),''), fp, p_amount_cents,
          p_currency, p_value_date, p_payer_name, p_payer_document, p_bank_reference,
          p_raw_reference, actor)
  RETURNING id INTO new_id;

  RETURN jsonb_build_object('payment_source_id', new_id, 'idempotent', false, 'fingerprint', fp);
END $$;

CREATE OR REPLACE FUNCTION public.finance_reconciliation_record(
  p_settlement_id     uuid,
  p_payment_source_id uuid,
  p_match_kind        text,
  p_evidence_reference text DEFAULT NULL,
  p_note              text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s public.finance_settlements%ROWTYPE;
  src public.finance_payment_sources%ROWTYPE;
  actor uuid := auth.uid();
  st text; diff bigint; rec_id uuid; existing uuid; caller_org uuid;
BEGIN
  IF p_match_kind NOT IN ('DETERMINISTIC_SOURCE_ID','MANUAL_GOVERNED') THEN
    RAISE EXCEPTION 'FUZZY_CANNOT_FINALIZE: casamento por semelhança é PROPOSTA (§53). '
      'Use finance_reconciliation_candidates.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO s FROM public.finance_settlements WHERE id = p_settlement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SETTLEMENT_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;

  caller_org := public.apex_browser_organization();
  IF caller_org IS NOT NULL AND s.organization_id IS DISTINCT FROM caller_org THEN
    RAISE EXCEPTION 'SETTLEMENT_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT * INTO src FROM public.finance_payment_sources
   WHERE id = p_payment_source_id AND organization_id = s.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_SOURCE_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  IF caller_org IS NOT NULL THEN
    IF NOT (public.current_user_has_permission('finance.reconciliation.manage')
            OR public.has_finance_role_or_perm('finance_admin','finance.admin')) THEN
      RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF p_match_kind = 'MANUAL_GOVERNED' AND actor IS NULL THEN
    RAISE EXCEPTION 'MANUAL_RECONCILIATION_REQUIRES_ACTOR: conciliação manual sem pessoa '
      'autenticada não tem quem a assine (§70).' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO existing FROM public.finance_reconciliations
   WHERE organization_id = s.organization_id AND settlement_id = s.id
     AND payment_source_id = src.id AND state <> 'REVERSED';
  IF existing IS NOT NULL THEN
    RETURN jsonb_build_object('reconciliation_id', existing, 'idempotent', true);
  END IF;

  diff := src.amount_cents - s.amount_cents;
  st := CASE
    WHEN src.currency <> s.currency THEN 'MISMATCH'
    WHEN diff = 0 THEN 'RECONCILED'
    WHEN diff < 0 THEN 'PARTIAL'
    ELSE 'REVIEW_REQUIRED' END;

  INSERT INTO public.finance_reconciliations
    (organization_id, settlement_id, payment_source_id, state, match_kind,
     matched_amount_cents, difference_cents, evidence_reference, note,
     reconciled_by, actor_source, correlation_id)
  VALUES (s.organization_id, s.id, src.id, st, p_match_kind,
          LEAST(src.amount_cents, s.amount_cents), diff, p_evidence_reference, p_note,
          actor, CASE WHEN actor IS NULL THEN 'system' ELSE 'human' END, s.correlation_id)
  RETURNING id INTO rec_id;

  IF st = 'RECONCILED' THEN
    PERFORM public.emit_domain_event(
      s.organization_id, 'finance.reconciliation.completed', 1, 'finance_receivable', s.receivable_id,
      'finance-reconciliation:' || rec_id::text,
      jsonb_build_object('reconciliation_id', rec_id, 'settlement_id', s.id,
        'payment_source_id', src.id, 'match_kind', p_match_kind,
        'matched_amount_cents', s.amount_cents),
      now(), CASE WHEN actor IS NULL THEN 'system' ELSE 'human' END, actor, s.correlation_id, NULL);
  END IF;

  RETURN jsonb_build_object('reconciliation_id', rec_id, 'state', st,
                            'difference_cents', diff, 'idempotent', false);
END $$;

CREATE OR REPLACE FUNCTION public.finance_reconciliation_reverse(
  p_reconciliation_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE rc public.finance_reconciliations%ROWTYPE; actor uuid := auth.uid();
        new_id uuid; caller_org uuid;
BEGIN
  SELECT * INTO rc FROM public.finance_reconciliations WHERE id = p_reconciliation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'RECONCILIATION_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;

  caller_org := public.apex_browser_organization();
  IF caller_org IS NOT NULL AND rc.organization_id IS DISTINCT FROM caller_org THEN
    RAISE EXCEPTION 'RECONCILIATION_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  IF rc.state = 'REVERSED' THEN
    RETURN jsonb_build_object('reconciliation_id', rc.id, 'idempotent', true);
  END IF;
  IF caller_org IS NOT NULL THEN
    IF NOT (public.current_user_has_permission('finance.reconciliation.manage')
            OR public.has_finance_role_or_perm('finance_admin','finance.admin')) THEN
      RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.finance_reconciliations
    (organization_id, settlement_id, payment_source_id, state, match_kind,
     matched_amount_cents, reversal_of, reversal_reason, reconciled_by, actor_source)
  VALUES (rc.organization_id, rc.settlement_id, rc.payment_source_id, 'REVERSED', rc.match_kind,
          rc.matched_amount_cents, rc.id, p_reason, actor,
          CASE WHEN actor IS NULL THEN 'system' ELSE 'human' END)
  RETURNING id INTO new_id;

  PERFORM public.emit_domain_event(
    rc.organization_id, 'finance.reconciliation.reversed', 1, 'finance_receivable',
    (SELECT receivable_id FROM public.finance_settlements WHERE id = rc.settlement_id),
    'finance-reconciliation-reversed:' || new_id::text,
    jsonb_build_object('reconciliation_id', new_id, 'reversal_of', rc.id, 'reason', p_reason),
    now(), CASE WHEN actor IS NULL THEN 'system' ELSE 'human' END, actor, rc.correlation_id, NULL);

  RETURN jsonb_build_object('reconciliation_id', new_id, 'idempotent', false);
END $$;

/*
  `contract_billing_create_from_milestone` já conferia inquilino sem depender do
  ator, mas a comparação era contra `current_user_organization_id()` direto —
  que devolve NULL para caminho de servidor e faria a checagem passar por
  acidente. Passa a usar o mesmo predicado das demais.
*/
CREATE OR REPLACE FUNCTION public.contract_billing_create_from_milestone(
  p_milestone_id uuid,
  p_title        text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ms    public.contract_milestones%ROWTYPE;
  actor uuid := auth.uid();
  new_id uuid;
  elig  jsonb;
  caller_org uuid;
BEGIN
  SELECT * INTO ms FROM public.contract_milestones WHERE id = p_milestone_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MILESTONE_NOT_FOUND: marco inexistente.' USING ERRCODE = 'no_data_found';
  END IF;

  caller_org := public.apex_browser_organization();
  IF caller_org IS NOT NULL THEN
    IF ms.organization_id IS DISTINCT FROM caller_org THEN
      RAISE EXCEPTION 'MILESTONE_NOT_FOUND: marco inexistente.' USING ERRCODE = 'no_data_found';
    END IF;
    IF NOT public.current_user_has_permission('contracts.edit') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: falta a permissão contracts.edit.' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF actor IS NULL THEN
    RAISE EXCEPTION 'ACTOR_REQUIRED: criação de faturamento exige pessoa autenticada.'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public.contract_billing_events g
              WHERE g.organization_id = ms.organization_id AND g.milestone_id = ms.id
                AND g.entitlement_key IS NOT NULL
                AND g.release_state NOT IN ('CANCELLED','SUPERSEDED')) THEN
    RAISE EXCEPTION 'BILLING_CUTOVER: este marco já tem direito de faturamento governado (§129).'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.contract_billing_events
    (organization_id, contract_id, milestone_id, title, amount, due_date, status,
     source_kind, entitlement_key, release_state, eligibility_state)
  VALUES
    (ms.organization_id, ms.contract_id, ms.id,
     COALESCE(NULLIF(btrim(COALESCE(p_title,'')),''), ms.title),
     0, ms.due_date, 'pendente',
     'LEGACY_MILESTONE',
     concat_ws(':', 'LEGACY_MILESTONE', ms.contract_id::text, ms.id::text),
     'NOT_ELIGIBLE', 'UNKNOWN')
  RETURNING id INTO new_id;

  INSERT INTO public.contract_billing_event_history
    (organization_id, billing_event_id, transition, to_state, detail, actor_user_id,
     actor_source)
  VALUES (ms.organization_id, new_id, 'created_from_milestone', 'NOT_ELIGIBLE',
          jsonb_build_object('milestone_id', ms.id,
                             'billing_amount_present', ms.billing_amount IS NOT NULL),
          actor, 'human');

  elig := public.contract_billing_recompute_eligibility(new_id);

  RETURN jsonb_build_object('billing_event_id', new_id,
                            'amount', elig->'amount', 'currency', elig->>'currency',
                            'amount_source', elig->>'amount_source',
                            'eligibility_state', elig->>'state',
                            'reasons', elig->'reasons');
END $$;

COMMIT;
