-- ============================================================================
-- 212 — PROFUNDIDADE DO FUNIL: ETAPA GOVERNADA E FOLLOW-UP COMERCIAL DE VERDADE
--
-- ─── As duas lacunas que esta migration fecha ────────────────────────────
--
-- 1) MUDAR DE ETAPA ERA UM CAMPO DE FORMULÁRIO.
--
--    `commercial_opportunity_upsert` (202) aceitava `stage` no payload. Ganhar,
--    perder e voltar para descoberta eram a MESMA escrita: sem motivo, sem
--    ator distinguível no histórico e sem marco de tempo. A consequência
--    prática aparecia na pergunta mais banal de um funil — "há quanto tempo
--    esta oportunidade está parada?" — que não tinha onde ser respondida, já
--    que `updated_at` muda quando alguém corrige uma vírgula no título.
--
--    Agora a transição é um ATO: função própria, motivo obrigatório para
--    perder/abandonar, evento append-only e `stage_entered_at` carimbado. O
--    upsert deixa de mexer em etapa depois da criação — um caminho só.
--
-- 2) O FOLLOW-UP COMERCIAL NÃO TINHA COMO NASCER.
--
--    A 198 e a 206 acertaram o vocabulário: `commercial_opportunity`,
--    `commercial_proposal`, `commercial_engagement` e `internal_service_order`
--    são papéis de origem válidos em `apex_followups`. Mas os RPCs humanos da
--    159 exigem `contracts.edit` — a permissão do PÓS-VENDA. Quem tem alçada
--    comercial e nenhuma de contratos não conseguia abrir o acompanhamento de
--    uma oportunidade sua, e a tela de Follow-ups exibia um botão desabilitado
--    com um bilhete explicando a lacuna.
--
--    A correção NÃO é um segundo motor de acompanhamento. É a autoridade do
--    motor existente passar a perguntar de qual domínio é o acompanhamento:
--    papel comercial → `commercial.manage`; papel de contrato → `contracts.edit`.
--    Uma função responde a essa pergunta, e as quatro entradas humanas a
--    consultam. Continua valendo o resto — ator autenticado, idempotência,
--    histórico append-only, conclusão só pelo caminho verificado.
--
-- Nada aqui concede escrita a `authenticated` em tabela nenhuma.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Desde quando a oportunidade está nesta etapa
--
-- Coluna própria, e não `updated_at`: idade de etapa precisa sobreviver a
-- qualquer outra edição da linha. O backfill usa `created_at` porque é o único
-- instante conhecido em que a linha comprovadamente estava na etapa em que
-- nasceu; daqui em diante, quem carimba é a transição.
-- ---------------------------------------------------------------------------
ALTER TABLE public.commercial_opportunities
  ADD COLUMN IF NOT EXISTS stage_entered_at timestamptz;

UPDATE public.commercial_opportunities
   SET stage_entered_at = created_at
 WHERE stage_entered_at IS NULL;

ALTER TABLE public.commercial_opportunities
  ALTER COLUMN stage_entered_at SET DEFAULT now(),
  ALTER COLUMN stage_entered_at SET NOT NULL;

COMMENT ON COLUMN public.commercial_opportunities.stage_entered_at IS
  'Quando a oportunidade entrou na etapa ATUAL. Carimbado por '
  'commercial_opportunity_transition_stage. Não use updated_at para idade de '
  'etapa: ele muda a cada edição de qualquer campo.';

-- ---------------------------------------------------------------------------
-- 2) O histórico de etapa — append-only, como toda história neste módulo
--
-- O mesmo contrato de `commercial_engagement_history` (200): UPDATE e DELETE
-- recusados no banco. Um funil cujo passado pode ser reescrito não responde a
-- "por que perdemos", que é a única pergunta que um histórico de etapa existe
-- para responder.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.commercial_opportunity_stage_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id  uuid NOT NULL,
  -- NULL na criação: não havia etapa anterior, e inventar 'QUALIFICATION' como
  -- origem faria a primeira linha parecer uma transição que nunca houve.
  from_stage      text,
  to_stage        text NOT NULL,
  reason          text,
  actor_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cose_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT cose_opportunity_tenant FOREIGN KEY (organization_id, opportunity_id)
    REFERENCES public.commercial_opportunities (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT cose_stages CHECK (
    to_stage IN ('QUALIFICATION','DISCOVERY','PROPOSAL','NEGOTIATION','WON','LOST','ABANDONED')
    AND (from_stage IS NULL OR from_stage IN
      ('QUALIFICATION','DISCOVERY','PROPOSAL','NEGOTIATION','WON','LOST','ABANDONED'))),
  CONSTRAINT cose_no_self_transition CHECK (from_stage IS DISTINCT FROM to_stage),
  -- Perder e abandonar exigem motivo. A regra vale na função E aqui: a função
  -- é a porta, a constraint é a fechadura.
  CONSTRAINT cose_closure_has_reason CHECK (
    to_stage NOT IN ('LOST','ABANDONED') OR btrim(coalesce(reason,'')) <> '')
);
CREATE INDEX IF NOT EXISTS cose_by_opportunity
  ON public.commercial_opportunity_stage_events (organization_id, opportunity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS cose_by_period
  ON public.commercial_opportunity_stage_events (organization_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.commercial_stage_events_are_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'commercial_opportunity_stage_events is append-only.' USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION public.commercial_stage_events_are_append_only() FROM PUBLIC;

DROP TRIGGER IF EXISTS cose_append_only ON public.commercial_opportunity_stage_events;
CREATE TRIGGER cose_append_only
  BEFORE UPDATE OR DELETE ON public.commercial_opportunity_stage_events
  FOR EACH ROW EXECUTE FUNCTION public.commercial_stage_events_are_append_only();

COMMENT ON TABLE public.commercial_opportunity_stage_events IS
  'Cada mudança de etapa de uma oportunidade, com motivo e ator. Append-only. '
  'É daqui que saem idade de etapa, movimento de forecast e a resposta a '
  '"quando isto parou".';

-- ---------------------------------------------------------------------------
-- 3) A transição governada
--
-- Avanço e RECUO são ambos legítimos: negociação que volta para descoberta
-- acontece, e proibir o recuo só ensinaria o time a mentir sobre a etapa. O
-- que não existe é saída de etapa ENCERRADA — "desganhar" seria reescrever o
-- passado, e uma oportunidade encerrada por engano se resolve abrindo outra,
-- que é o que de fato aconteceu.
--
-- `engagement_id` NÃO é tocado aqui. Ganhar registra o resultado comercial;
-- autorizar a execução é outro ato, com outra permissão e outra fonte. O
-- intervalo entre os dois é visível de propósito — é o sinal
-- WON_WITHOUT_AUTHORIZED_WORK.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commercial_opportunity_transition_stage(
  p_organization_id uuid, p_actor uuid, p_opportunity_id uuid,
  p_to_stage text, p_reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_from text; v_closed boolean; v_reason text;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Opportunity stage write denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Opportunity stage change requires a named actor.' USING ERRCODE = '42501';
  END IF;

  SELECT stage INTO v_from FROM public.commercial_opportunities
   WHERE organization_id = p_organization_id AND id = p_opportunity_id
   FOR UPDATE;
  IF v_from IS NULL THEN
    RAISE EXCEPTION 'Opportunity not found in tenant.' USING ERRCODE = 'P0002';
  END IF;

  IF v_from IN ('WON','LOST','ABANDONED') THEN
    RAISE EXCEPTION 'Opportunity is already closed as % — a closed opportunity does not return to the funnel.',
      v_from USING ERRCODE = '23514';
  END IF;
  IF p_to_stage = v_from THEN
    RAISE EXCEPTION 'Opportunity is already in stage %.', v_from USING ERRCODE = '23514';
  END IF;
  IF p_to_stage NOT IN ('QUALIFICATION','DISCOVERY','PROPOSAL','NEGOTIATION','WON','LOST','ABANDONED') THEN
    RAISE EXCEPTION 'Opportunity stage % is not a valid stage.', p_to_stage USING ERRCODE = '23514';
  END IF;

  v_closed := p_to_stage IN ('WON','LOST','ABANDONED');
  v_reason := nullif(btrim(coalesce(p_reason,'')), '');
  IF p_to_stage IN ('LOST','ABANDONED') AND v_reason IS NULL THEN
    RAISE EXCEPTION 'Opportunity closure as % requires a stated reason.', p_to_stage
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.commercial_opportunities
     SET stage = p_to_stage,
         stage_entered_at = now(),
         closed_at = CASE WHEN v_closed THEN now() END,
         lost_reason = CASE WHEN p_to_stage IN ('LOST','ABANDONED') THEN v_reason END
   WHERE organization_id = p_organization_id AND id = p_opportunity_id;

  INSERT INTO public.commercial_opportunity_stage_events
    (organization_id, opportunity_id, from_stage, to_stage, reason, actor_user_id)
  VALUES (p_organization_id, p_opportunity_id, v_from, p_to_stage, v_reason, p_actor);

  RETURN jsonb_build_object(
    'opportunity_id', p_opportunity_id, 'from_stage', v_from,
    'to_stage', p_to_stage, 'closed', v_closed);
END $$;

REVOKE ALL ON FUNCTION public.commercial_opportunity_transition_stage(uuid,uuid,uuid,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commercial_opportunity_transition_stage(uuid,uuid,uuid,text,text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 4) O upsert para de mexer em etapa
--
-- Só o corpo muda: na CRIAÇÃO a etapa continua sendo escolhida (e agora deixa
-- um evento de nascimento no histórico); na EDIÇÃO, `stage` do payload é
-- ignorado. Duas portas para o mesmo campo produziriam exatamente o que esta
-- migration veio consertar.
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
       stage, stage_entered_at, estimated_value, currency, probability,
       expected_decision_date, source, owner_user_id, lost_reason, closed_at, notes, created_by)
    VALUES (p_organization_id, nullif(btrim(p_payload->>'code'),''), p_payload->>'title',
            nullif(p_payload->>'party_id','')::uuid, p_payload->>'counterparty_name',
            nullif(p_payload->>'primary_contact_id','')::uuid, v_stage, now(),
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

    INSERT INTO public.commercial_opportunity_stage_events
      (organization_id, opportunity_id, from_stage, to_stage, reason, actor_user_id)
    VALUES (p_organization_id, v_id, NULL, v_stage,
            CASE WHEN v_closed THEN COALESCE(nullif(btrim(p_payload->>'lost_reason'),''),
                                             'Registrada já encerrada.') END,
            p_actor);
  ELSE
    -- `stage`, `closed_at` e `lost_reason` ficam de fora: pertencem à transição.
    UPDATE public.commercial_opportunities
       SET code = nullif(btrim(p_payload->>'code'),''),
           title = COALESCE(nullif(btrim(p_payload->>'title'),''), title),
           party_id = nullif(p_payload->>'party_id','')::uuid,
           counterparty_name = COALESCE(nullif(btrim(p_payload->>'counterparty_name'),''), counterparty_name),
           primary_contact_id = nullif(p_payload->>'primary_contact_id','')::uuid,
           estimated_value = nullif(p_payload->>'estimated_value','')::numeric,
           currency = COALESCE(nullif(btrim(p_payload->>'currency'),''), currency),
           probability = nullif(p_payload->>'probability','')::numeric,
           expected_decision_date = nullif(p_payload->>'expected_decision_date','')::date,
           source = nullif(btrim(p_payload->>'source'),''),
           owner_user_id = COALESCE(nullif(p_payload->>'owner_user_id','')::uuid, owner_user_id),
           notes = nullif(btrim(p_payload->>'notes'),'')
     WHERE organization_id = p_organization_id AND id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Opportunity not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------
-- 5) RLS e privilégios do histórico de etapa
-- ---------------------------------------------------------------------------
ALTER TABLE public.commercial_opportunity_stage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cose_select ON public.commercial_opportunity_stage_events;
CREATE POLICY cose_select ON public.commercial_opportunity_stage_events FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND public.current_user_has_permission('commercial.view'));

GRANT SELECT ON public.commercial_opportunity_stage_events TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.commercial_opportunity_stage_events
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6) A autoridade do acompanhamento passa a perguntar DE QUAL DOMÍNIO ele é
--
-- Uma função, consultada pelas quatro entradas humanas. Sem ela, cada RPC
-- carregaria sua própria cópia do predicado — e a próxima permissão de domínio
-- a entrar no motor teria quatro lugares para ser esquecida.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apex_followup_commercial_source_kinds() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY[
  'commercial_opportunity',
  'commercial_proposal',
  'commercial_engagement',
  'internal_service_order'
] $$;

CREATE OR REPLACE FUNCTION public.apex_followup_authority_ok(p_source_kind text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  IF public.current_user_is_admin() THEN RETURN true; END IF;
  IF p_source_kind = ANY (public.apex_followup_commercial_source_kinds()) THEN
    -- Alçada COMERCIAL basta para o acompanhamento de um objeto comercial.
    -- `contracts.edit` continua valendo: quem opera os dois lados não perde nada.
    RETURN public.current_user_has_permission('commercial.manage')
        OR public.current_user_has_permission('contracts.edit');
  END IF;
  RETURN public.current_user_has_permission('contracts.edit');
END $$;

REVOKE ALL ON FUNCTION public.apex_followup_authority_ok(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apex_followup_authority_ok(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.apex_followup_authority_ok(text) IS
  'Quem pode abrir/mexer num acompanhamento, conforme o DOMÍNIO da origem. '
  'Um motor de acompanhamento; a alçada é a do domínio de onde ele nasce.';

-- 6.1 Criar — mesma função da 159, com a autoridade delegada.
CREATE OR REPLACE FUNCTION public.apex_followup_create(
  p_idempotency_key text,
  p_source_kind text,
  p_source_id uuid,
  p_contract_id uuid,
  p_goal text,
  p_expected_evidence text DEFAULT NULL,
  p_responsible_user_id uuid DEFAULT NULL,
  p_responsible_party_id uuid DEFAULT NULL,
  p_responsible_text text DEFAULT NULL,
  p_due_date date DEFAULT NULL,
  p_cadence_days integer DEFAULT NULL,
  p_escalate_after_days integer DEFAULT NULL,
  p_escalation_target_user_id uuid DEFAULT NULL,
  p_verification_mode text DEFAULT 'human_confirmation',
  p_verification_rule jsonb DEFAULT NULL
) RETURNS public.apex_followups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _uid uuid := auth.uid(); _org uuid := public.current_user_organization_id(); _row public.apex_followups;
BEGIN
  IF _uid IS NULL OR _org IS NULL THEN
    RAISE EXCEPTION 'Creating a follow-up requires an authenticated tenant.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.apex_followup_authority_ok(p_source_kind) THEN
    RAISE EXCEPTION 'Permission required to follow up on a % — commercial.manage or contracts.edit.',
      p_source_kind USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(btrim(coalesce(p_idempotency_key,''))) < 8 OR length(p_idempotency_key) > 200 THEN
    RAISE EXCEPTION 'A valid idempotency key is required.' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.apex_followups (
    organization_id, idempotency_key, source_kind, source_id, contract_id, goal,
    expected_evidence, responsible_user_id, responsible_party_id, responsible_text,
    due_date, cadence_days, escalate_after_days, escalation_target_user_id,
    verification_mode, verification_rule, state, created_by
  ) VALUES (
    _org, btrim(p_idempotency_key), p_source_kind, p_source_id, p_contract_id, p_goal,
    p_expected_evidence, p_responsible_user_id, p_responsible_party_id, p_responsible_text,
    p_due_date, p_cadence_days, p_escalate_after_days, p_escalation_target_user_id,
    p_verification_mode, p_verification_rule, 'ACTIVE', _uid
  ) ON CONFLICT (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL
    DO NOTHING RETURNING * INTO _row;

  IF NOT FOUND THEN
    SELECT * INTO _row FROM public.apex_followups
     WHERE organization_id = _org AND idempotency_key = btrim(p_idempotency_key);
    IF (_row.source_kind, _row.source_id, _row.contract_id, _row.goal)
       IS DISTINCT FROM (p_source_kind, p_source_id, p_contract_id, p_goal) THEN
      RAISE EXCEPTION 'Idempotency key was already used for a different follow-up.'
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;
  RETURN _row;
END $$;

-- 6.2 Transicionar — a autoridade sai da linha que está sendo mexida.
CREATE OR REPLACE FUNCTION public.apex_followup_transition(
  p_followup_id uuid, p_next text, p_note text DEFAULT NULL,
  p_next_expected_event text DEFAULT NULL, p_next_expected_event_at date DEFAULT NULL
) RETURNS public.apex_followups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _uid uuid := auth.uid(); _org uuid := public.current_user_organization_id();
        _row public.apex_followups; _kind text;
BEGIN
  IF _uid IS NULL OR _org IS NULL THEN
    RAISE EXCEPTION 'Changing a follow-up requires an authenticated tenant.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT source_kind INTO _kind FROM public.apex_followups
   WHERE id = p_followup_id AND organization_id = _org;
  IF _kind IS NULL THEN
    RAISE EXCEPTION 'Follow-up not found in this organization, or already terminal.' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.apex_followup_authority_ok(_kind) THEN
    RAISE EXCEPTION 'Permission required to change this follow-up.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_next = 'COMPLETED' THEN
    RAISE EXCEPTION 'Completion requires a governed verification path.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_next = 'WAITING_EXTERNAL_PARTY' AND p_next_expected_event_at IS NULL THEN
    RAISE EXCEPTION 'Waiting for an external party requires the next expected date.' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.apex_followups SET
    state = p_next, state_note = p_note,
    next_expected_event = p_next_expected_event,
    next_expected_event_at = p_next_expected_event_at,
    closed_at = CASE WHEN p_next = 'CANCELLED' THEN now() ELSE NULL END,
    escalated_at = CASE WHEN p_next = 'ESCALATED' THEN now() ELSE escalated_at END
   WHERE id = p_followup_id AND organization_id = _org
     AND state IN ('ACTIVE','WAITING_EXTERNAL_PARTY','BLOCKED','ESCALATED')
  RETURNING * INTO _row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Follow-up not found in this organization, or already terminal.' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN _row;
END $$;

-- 6.3 Designar responsável.
CREATE OR REPLACE FUNCTION public.apex_followup_assign(
  p_followup_id uuid, p_responsible_user_id uuid DEFAULT NULL,
  p_responsible_party_id uuid DEFAULT NULL, p_responsible_text text DEFAULT NULL,
  p_due_date date DEFAULT NULL, p_cadence_days integer DEFAULT NULL,
  p_expected_evidence text DEFAULT NULL
) RETURNS public.apex_followups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _uid uuid := auth.uid(); _org uuid := public.current_user_organization_id();
        _row public.apex_followups; _kind text;
BEGIN
  IF _uid IS NULL OR _org IS NULL THEN
    RAISE EXCEPTION 'Assigning responsibility requires an authenticated tenant.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT source_kind INTO _kind FROM public.apex_followups
   WHERE id = p_followup_id AND organization_id = _org;
  IF _kind IS NULL THEN
    RAISE EXCEPTION 'Follow-up not found in this organization.' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.apex_followup_authority_ok(_kind) THEN
    RAISE EXCEPTION 'Permission required to assign this follow-up.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_responsible_user_id IS NULL AND p_responsible_party_id IS NULL
     AND btrim(coalesce(p_responsible_text,'')) = '' THEN
    RAISE EXCEPTION 'A governed follow-up requires a responsible party.' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.apex_followups SET
    responsible_user_id = p_responsible_user_id,
    responsible_party_id = p_responsible_party_id,
    responsible_text = p_responsible_text,
    due_date = COALESCE(p_due_date, due_date),
    cadence_days = COALESCE(p_cadence_days, cadence_days),
    expected_evidence = COALESCE(p_expected_evidence, expected_evidence),
    assigned_by = _uid, assigned_at = now()
   WHERE id = p_followup_id AND organization_id = _org
     AND state IN ('ACTIVE','WAITING_EXTERNAL_PARTY','BLOCKED','ESCALATED')
  RETURNING * INTO _row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Follow-up not found in this organization, or already terminal.' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN _row;
END $$;

-- 6.4 Concluir por confirmação humana.
--
-- A regra que NÃO muda: concluir continua exigindo o caminho verificado. Só
-- quem pergunta pela alçada mudou — o domínio da origem, não mais o pós-venda
-- por padrão.
CREATE OR REPLACE FUNCTION public.apex_followup_confirm_completion(
  p_followup_id uuid, p_note text DEFAULT NULL
) RETURNS public.apex_followups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _uid uuid := auth.uid(); _org uuid := public.current_user_organization_id();
        _row public.apex_followups; _kind text;
BEGIN
  IF _uid IS NULL OR _org IS NULL THEN
    RAISE EXCEPTION 'Human completion requires an authenticated tenant.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT source_kind INTO _kind FROM public.apex_followups
   WHERE id = p_followup_id AND organization_id = _org;
  IF _kind IS NULL THEN
    RAISE EXCEPTION 'Follow-up not found in this organization, or already terminal.' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.apex_followup_authority_ok(_kind) THEN
    RAISE EXCEPTION 'Permission required to complete this follow-up.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.apex_followups SET
    state = 'COMPLETED', closure_basis = 'human_confirmation', closed_at = now(),
    verified_at = now(), verified_by = _uid, state_note = COALESCE(p_note, state_note)
   WHERE id = p_followup_id AND organization_id = _org
     AND state IN ('ACTIVE','WAITING_EXTERNAL_PARTY','BLOCKED','ESCALATED')
  RETURNING * INTO _row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Follow-up not found in this organization, or already terminal.' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN _row;
END $$;

REVOKE ALL ON FUNCTION public.apex_followup_create(text,text,uuid,uuid,text,text,uuid,uuid,text,date,integer,integer,uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apex_followup_create(text,text,uuid,uuid,text,text,uuid,uuid,text,date,integer,integer,uuid,text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.apex_followup_transition(uuid,text,text,text,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apex_followup_transition(uuid,text,text,text,date) TO authenticated;
REVOKE ALL ON FUNCTION public.apex_followup_assign(uuid,uuid,uuid,text,date,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apex_followup_assign(uuid,uuid,uuid,text,date,integer,text) TO authenticated;
REVOKE ALL ON FUNCTION public.apex_followup_confirm_completion(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apex_followup_confirm_completion(uuid,text) TO authenticated;

COMMIT;
