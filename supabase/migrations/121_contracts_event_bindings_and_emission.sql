-- ============================================================
-- CONTRATOS — emissão transacional de fatos e ativação por evento EXPLÍCITO
-- Migration: 121_contracts_event_bindings_and_emission
--
-- ─── Duas metades ──────────────────────────────────────────────────────────
--
-- SAÍDA: os fatos que Contratos passa a publicar. Cada um é emitido por
-- gatilho, na MESMA transação da mutação que o produziu. Não existe caminho em
-- que a obrigação mude de estado e o fato correspondente não seja gravado —
-- ou os dois acontecem, ou nenhum acontece.
--
-- ENTRADA: o vínculo que faz um fato ativar uma obrigação.
--
-- ─── Por que o vínculo é EXPLÍCITO ─────────────────────────────────────────
--
-- A Fase 3 grava `activation_event_text`: o que o CONTRATO diz, em português
-- jurídico — "mediante o aceite da medição pelo Contratante". Isso é
-- proveniência legal, e continua sendo.
--
-- Deduzir dali que o gatilho é `projects.measurement.accepted` seria casamento
-- semântico por semelhança, e errar produziria uma obrigação ativada na data
-- errada com aparência de correta. Um prazo contratual contado a partir de uma
-- ativação inventada é pior que um prazo desconhecido.
--
-- Por isso o vínculo é CONFIGURAÇÃO DE EXECUÇÃO declarada por gente:
--
--   definição de obrigação + tipo de evento + versão + (sujeito opcional)
--   + estratégia EXPLÍCITA de ocorrência
--
-- O texto contratual não é reescrito para caber na taxonomia de eventos, e a
-- taxonomia não é esticada para caber no texto.
--
-- ─── Mapeamento de ocorrência ──────────────────────────────────────────────
--
-- Para uma obrigação recorrente, "qual ocorrência este evento ativa?" nem
-- sempre tem resposta. Quando não tem, o resultado é NÃO RESOLVIDO — não um
-- palpite plausível. As três estratégias abaixo são todas determinísticas;
-- não há uma quarta que adivinhe.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1) Vínculo de ativação
-- ------------------------------------------------------------
CREATE TABLE public.contract_obligation_event_bindings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id         uuid NOT NULL,
  definition_id       uuid NOT NULL,

  event_type          text NOT NULL
                        CHECK (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$'),
  schema_version      integer NOT NULL CHECK (schema_version > 0),

  -- Restrição opcional de SUJEITO: "só o aceite DESTE projeto ativa esta
  -- obrigação". Sem ela, qualquer fato daquele tipo, naquele inquilino, ativa.
  subject_aggregate_type text,
  subject_aggregate_id   uuid,

  -- ---- como o evento vira OCORRÊNCIA ----
  --   single                  a obrigação é única; o evento ativa a ocorrência 'single'.
  --   payload_occurrence_key  o evento CARREGA a chave, num caminho declarado.
  --   event_period            a ocorrência é a do PERÍODO em que o fato ocorreu,
  --                           pela recorrência da definição. Opt-in explícito:
  --                           só vale porque alguém declarou que vale.
  occurrence_strategy text NOT NULL
                        CHECK (occurrence_strategy IN ('single','payload_occurrence_key','event_period')),
  -- Chave de primeiro nível do payload que carrega a ocorrência.
  occurrence_key_field text,

  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  -- Quem declarou, e por quê. Vínculo é ato administrativo: sem autor, ele vira
  -- configuração órfã que ninguém sabe explicar dois anos depois.
  source              text NOT NULL DEFAULT 'human' CHECK (source IN ('human','import','migration')),
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  revoked_at          timestamptz,
  note                text,

  CONSTRAINT coeb_org_id_unique UNIQUE (organization_id, id),
  -- Alvo composto: o vínculo não alcança definição de OUTRO inquilino nem de
  -- outro contrato. É estrutural, não convenção.
  CONSTRAINT coeb_definition_tenant FOREIGN KEY (organization_id, contract_id, definition_id)
    REFERENCES public.contract_obligation_definitions (organization_id, contract_id, id) ON DELETE CASCADE,
  CONSTRAINT coeb_contract_tenant FOREIGN KEY (organization_id, contract_id)
    REFERENCES public.contracts (organization_id, id) ON DELETE CASCADE,
  -- Uma definição não escuta o mesmo fato duas vezes na mesma versão.
  CONSTRAINT coeb_unique UNIQUE (organization_id, definition_id, event_type, schema_version),
  CONSTRAINT coeb_key_field_coherent CHECK (
    (occurrence_strategy = 'payload_occurrence_key') = (occurrence_key_field IS NOT NULL)),
  CONSTRAINT coeb_subject_coherent CHECK (
    subject_aggregate_id IS NULL OR subject_aggregate_type IS NOT NULL),
  CONSTRAINT coeb_revoked_coherent CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);

CREATE INDEX coeb_lookup ON public.contract_obligation_event_bindings
  (organization_id, event_type, schema_version) WHERE status = 'active';
CREATE INDEX coeb_definition ON public.contract_obligation_event_bindings (definition_id);

COMMENT ON TABLE public.contract_obligation_event_bindings IS
  'Configuração de EXECUÇÃO: qual fato de plataforma ativa qual obrigação. NÃO '
  'é proveniência jurídica — essa continua em activation_event_text. O vínculo '
  'é declarado por gente; nada aqui é inferido do texto contratual.';

-- Só definição cuja ativação é POR EVENTO aceita vínculo. Vincular uma
-- obrigação de `contract_start` a um evento criaria duas fontes de verdade
-- para a mesma data de ativação.
CREATE FUNCTION public.contract_obligations_validate_binding() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d public.contract_obligation_definitions%ROWTYPE;
BEGIN
  SELECT * INTO d FROM public.contract_obligation_definitions
   WHERE id = NEW.definition_id AND organization_id = NEW.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Definição de obrigação inválida para vínculo.' USING ERRCODE = 'check_violation';
  END IF;
  IF d.activation_kind <> 'external_event' THEN
    RAISE EXCEPTION 'Só obrigação com ativação por evento externo aceita vínculo (definição %, ativação %).',
      d.id, d.activation_kind USING ERRCODE = 'check_violation';
  END IF;
  IF d.status <> 'active' THEN
    RAISE EXCEPTION 'Definição % não está ativa: siga a linhagem em vez de retroalvejar história.', d.id
      USING ERRCODE = 'check_violation';
  END IF;
  -- `single` exige obrigação única; numa série recorrente ela ativaria uma
  -- ocorrência que não é a que o fato descreve.
  IF NEW.occurrence_strategy = 'single' AND d.recurrence_kind <> 'one_time' THEN
    RAISE EXCEPTION 'Estratégia `single` exige recorrência one_time (definição % é %).',
      d.id, d.recurrence_kind USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.occurrence_strategy = 'event_period' AND d.recurrence_kind = 'one_time' THEN
    RAISE EXCEPTION 'Estratégia `event_period` exige recorrência (definição % é one_time).', d.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contract_obligations_validate_binding() FROM PUBLIC;
CREATE TRIGGER coeb_validate BEFORE INSERT ON public.contract_obligation_event_bindings
  FOR EACH ROW EXECUTE FUNCTION public.contract_obligations_validate_binding();

-- Vínculo é histórico: revoga-se, não se reescreve o alvo. Retroalvejar um
-- vínculo antigo mudaria, retroativamente, a explicação de ativações que já
-- aconteceram.
CREATE FUNCTION public.contract_obligations_reject_binding_retarget() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
  OR NEW.contract_id     IS DISTINCT FROM OLD.contract_id
  OR NEW.definition_id   IS DISTINCT FROM OLD.definition_id
  OR NEW.event_type      IS DISTINCT FROM OLD.event_type
  OR NEW.schema_version  IS DISTINCT FROM OLD.schema_version
  OR NEW.occurrence_strategy IS DISTINCT FROM OLD.occurrence_strategy
  OR NEW.occurrence_key_field IS DISTINCT FROM OLD.occurrence_key_field
  OR NEW.subject_aggregate_type IS DISTINCT FROM OLD.subject_aggregate_type
  OR NEW.subject_aggregate_id   IS DISTINCT FROM OLD.subject_aggregate_id THEN
    RAISE EXCEPTION 'Vínculo de evento não é retroalvejado: revogue e crie outro (vínculo %).', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contract_obligations_reject_binding_retarget() FROM PUBLIC;
CREATE TRIGGER coeb_immutable BEFORE UPDATE ON public.contract_obligation_event_bindings
  FOR EACH ROW EXECUTE FUNCTION public.contract_obligations_reject_binding_retarget();

-- ------------------------------------------------------------
-- 2) Emissão transacional dos fatos de Contratos
-- ------------------------------------------------------------
-- O ponto de emissão é o HISTÓRICO de transição, e não a instância. A Fase 3
-- já grava a linha de histórico dentro da MESMA transação da mudança de estado
-- (gatilho `coi_record_transition`), e ela é imutável. Pendurar a emissão ali
-- é herdar uma atomicidade que já existe e já é testada, em vez de inventar
-- outra ao lado.
--
-- A chave de idempotência é a linha de histórico: `history:<id>`. Cada
-- transição é um fato, e a mesma transição nunca é dois fatos.

-- Contexto causal opcional, posto pela transação que está causando a mudança.
-- Vive como GUC LOCAL: morre no fim da transação e não vaza entre pedidos.
CREATE FUNCTION public.apex_causal_context_event_id() RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v text;
BEGIN
  v := current_setting('apex.causation_event_id', true);
  IF v IS NULL OR btrim(v) = '' THEN RETURN NULL; END IF;
  RETURN v::uuid;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

CREATE FUNCTION public.apex_causal_context_occurred_at() RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v text;
BEGIN
  v := current_setting('apex.event_occurred_at', true);
  IF v IS NULL OR btrim(v) = '' THEN RETURN NULL; END IF;
  RETURN v::timestamptz;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

/*
  SECURITY DEFINER aqui é necessário e é seguro.

  NECESSÁRIO porque quem muta a tabela de domínio pode ser qualquer papel que a
  Fase 3 autorize, e nenhum deles tem — nem deve ter — INSERT em
  `domain_events`. Sem DEFINER, a emissão falharia e derrubaria a transição
  junto; com ela, o fato é gravado pelo dono.

  SEGURO porque a função não recebe parâmetro nenhum: tudo que ela lê vem de
  `NEW`, que o Postgres montou a partir da linha que ACABOU de ser gravada com
  as regras de inquilino da Fase 3 valendo. Não há entrada de usuário para
  ramificar, não há UUID de fora para sondar, e a organização vem da linha —
  nunca de quem chamou.
*/
CREATE FUNCTION public.contract_obligations_emit_transition_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  inst public.contract_obligation_instances%ROWTYPE;
  ev_type text;
  occurred timestamptz;
BEGIN
  -- O nascimento da ocorrência é RESULTADO DE TRABALHO, não fato de negócio.
  -- Emitir "materializada" faria a materialização agendada publicar milhares
  -- de fatos que nada significam para o contrato.
  IF NEW.previous_state IS NULL THEN RETURN NULL; END IF;

  ev_type := CASE NEW.next_state
    WHEN 'OPEN'      THEN 'contracts.obligation.instance_activated'
    WHEN 'SATISFIED' THEN 'contracts.obligation.instance_satisfied'
    WHEN 'WAIVED'    THEN 'contracts.obligation.instance_waived'
    ELSE NULL END;
  -- CANCELLED e EXCEPTION não estão no vocabulário inicial: não há hoje
  -- consumidor nem semântica acordada para eles, e publicar um tipo que
  -- ninguém definiu é dívida, não cobertura.
  IF ev_type IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO inst FROM public.contract_obligation_instances WHERE id = NEW.instance_id;

  /*
    O tempo do FATO, e não o do trabalhador. Quando a ativação veio de um
    evento autoritativo do dia 10 e o trabalhador rodou no dia 11, o fato
    ocorreu no dia 10. Sem isto, todo prazo contado a partir da ativação
    andaria um dia — e andaria em silêncio.
  */
  occurred := COALESCE(public.apex_causal_context_occurred_at(), NEW.recorded_at);

  PERFORM public.emit_domain_event(
    NEW.organization_id,
    ev_type,
    1,
    'contract_obligation_instance',
    NEW.instance_id,
    'obligation-instance:' || NEW.instance_id::text || ':history:' || NEW.id::text,
    jsonb_build_object(
      'contract_id',    inst.contract_id,
      'definition_id',  inst.definition_id,
      'occurrence_key', inst.occurrence_key,
      'previous_state', NEW.previous_state,
      'next_state',     NEW.next_state,
      'activated_at',   inst.activated_at,
      'due_date',       inst.due_date,
      'due_confidence', inst.due_confidence),
    occurred,
    CASE WHEN NEW.actor_user_id IS NULL THEN 'system' ELSE 'human' END,
    NEW.actor_user_id,
    NULL,
    public.apex_causal_context_event_id());
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.contract_obligations_emit_transition_event() FROM PUBLIC;

CREATE TRIGGER coih_emit_event AFTER INSERT ON public.contract_obligation_instance_history
  FOR EACH ROW EXECUTE FUNCTION public.contract_obligations_emit_transition_event();

CREATE FUNCTION public.contract_obligations_emit_evidence_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE inst public.contract_obligation_instances%ROWTYPE;
BEGIN
  SELECT * INTO inst FROM public.contract_obligation_instances WHERE id = NEW.instance_id;
  PERFORM public.emit_domain_event(
    NEW.organization_id,
    'contracts.obligation.evidence_recorded',
    1,
    'contract_obligation_instance',
    NEW.instance_id,
    'obligation-evidence:' || NEW.id::text,
    -- Referências, nunca conteúdo: o documento fica no armazenamento, e o
    -- evento guarda o id que aponta para ele.
    jsonb_build_object(
      'evidence_id',      NEW.id,
      'contract_id',      NEW.contract_id,
      'definition_id',    inst.definition_id,
      'requirement_id',   NEW.requirement_id,
      'document_id',      NEW.document_id,
      'acceptance_state', NEW.acceptance_state),
    NEW.provided_at,
    CASE WHEN NEW.provided_by IS NULL THEN 'system' ELSE 'human' END,
    NEW.provided_by,
    NULL,
    public.apex_causal_context_event_id());
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.contract_obligations_emit_evidence_event() FROM PUBLIC;
CREATE TRIGGER coe_emit_event AFTER INSERT ON public.contract_obligation_evidence
  FOR EACH ROW EXECUTE FUNCTION public.contract_obligations_emit_evidence_event();

CREATE FUNCTION public.contracts_emit_amendment_created_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.emit_domain_event(
    NEW.organization_id,
    'contracts.amendment.created',
    1,
    'contract_amendment',
    NEW.id,
    'amendment:' || NEW.id::text || ':created',
    jsonb_build_object(
      'contract_id',      NEW.contract_id,
      'amendment_number', NEW.amendment_number,
      'effective_date',   NEW.effective_date,
      'status',           NEW.status),
    COALESCE(NEW.effective_date::timestamptz, NEW.created_at, now()),
    CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'human' END,
    auth.uid(),
    NULL,
    public.apex_causal_context_event_id());
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.contracts_emit_amendment_created_event() FROM PUBLIC;
CREATE TRIGGER ca_emit_created_event AFTER INSERT ON public.contract_amendments
  FOR EACH ROW EXECUTE FUNCTION public.contracts_emit_amendment_created_event();

-- ------------------------------------------------------------
-- 3) Provedor de rota
-- ------------------------------------------------------------
-- Devolve `contracts.obligation.external_activation.apply` quando existe
-- vínculo ativo, no MESMO inquilino, para (tipo, versão) do evento. Devolve
-- uma linha com `job_type` nulo quando existe vínculo para o tipo em OUTRA
-- versão — conflito de versão é visível, não silencioso.
CREATE FUNCTION public.contracts_obligation_activation_routes(p_event_id uuid)
RETURNS TABLE (job_type text, max_attempts integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE ev public.domain_events%ROWTYPE; n integer;
BEGIN
  SELECT * INTO ev FROM public.domain_events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*) INTO n FROM public.contract_obligation_event_bindings b
   WHERE b.organization_id = ev.organization_id AND b.status = 'active'
     AND b.event_type = ev.event_type AND b.schema_version = ev.schema_version
     AND (b.subject_aggregate_type IS NULL OR b.subject_aggregate_type = ev.aggregate_type)
     AND (b.subject_aggregate_id   IS NULL OR b.subject_aggregate_id   = ev.aggregate_id);

  IF n > 0 THEN
    -- UM trabalho por evento, não um por vínculo: o handler percorre todos os
    -- vínculos que casam. Um trabalho por vínculo multiplicaria retentativa e
    -- carta morta por um número que ninguém controla.
    RETURN QUERY SELECT 'contracts.obligation.external_activation.apply'::text, 5;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.contract_obligation_event_bindings b
     WHERE b.organization_id = ev.organization_id AND b.status = 'active'
       AND b.event_type = ev.event_type AND b.schema_version <> ev.schema_version)
  THEN
    RETURN QUERY SELECT NULL::text, 5;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.contracts_obligation_activation_routes(uuid) FROM PUBLIC, anon, authenticated;

INSERT INTO public.apex_dynamic_route_providers (provider_function, owner_domain, note)
VALUES ('public.contracts_obligation_activation_routes', 'contracts',
        'Ativação de obrigação por vínculo EXPLÍCITO de evento (Fase 4).');

-- ------------------------------------------------------------
-- 4) O handler de ativação externa
-- ------------------------------------------------------------
-- Roda numa transação: se qualquer ativação falhar, nenhuma vale, e o trabalho
-- volta para a fila. Reentregar é seguro — ativar o que já está ativado não
-- produz transição, logo não produz histórico, logo não produz fato novo. É
-- assim que a repetição não vira duplicata, e é assim que uma cadeia causal
-- não vira laço.
CREATE FUNCTION public.contract_obligations_apply_external_activation(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  ev        public.domain_events%ROWTYPE;
  b         public.contract_obligation_event_bindings%ROWTYPE;
  d         public.contract_obligation_definitions%ROWTYPE;
  inst      public.contract_obligation_instances%ROWTYPE;
  key       text;
  event_day date;
  new_due   date;
  new_conf  text;
  activated integer := 0;
  already   integer := 0;
  unresolved integer := 0;
  details   jsonb := '[]'::jsonb;
  reason    text;
BEGIN
  SELECT * INTO ev FROM public.domain_events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evento % não existe.', p_event_id USING ERRCODE = 'no_data_found';
  END IF;

  event_day := (ev.occurred_at AT TIME ZONE 'UTC')::date;

  /*
    Contexto causal para os gatilhos de emissão: a ativação que este handler
    provoca vai gerar um fato NOVO, e esse fato tem de apontar para o fato que
    o causou e carregar o tempo do NEGÓCIO. Sem isso a cadeia causal se perde e
    o horário do trabalhador se disfarça de horário do fato.
  */
  PERFORM set_config('apex.causation_event_id', ev.id::text, true);
  PERFORM set_config('apex.event_occurred_at', ev.occurred_at::text, true);

  FOR b IN
    SELECT * FROM public.contract_obligation_event_bindings
     WHERE organization_id = ev.organization_id AND status = 'active'
       AND event_type = ev.event_type AND schema_version = ev.schema_version
       AND (subject_aggregate_type IS NULL OR subject_aggregate_type = ev.aggregate_type)
       AND (subject_aggregate_id   IS NULL OR subject_aggregate_id   = ev.aggregate_id)
     ORDER BY created_at, id
  LOOP
    reason := NULL;
    key := NULL;

    SELECT * INTO d FROM public.contract_obligation_definitions
     WHERE id = b.definition_id AND organization_id = b.organization_id;

    -- Definição removida ou sucedida NÃO é ativada. Seguir a linhagem é
    -- trabalho de quem criou a sucessora; adivinhar o alvo aqui reescreveria
    -- história contratual para caber num evento.
    IF d.status <> 'active' THEN
      reason := 'definition_' || d.status;
    ELSE
      -- ---- qual ocorrência? ----
      key := CASE b.occurrence_strategy
        WHEN 'single' THEN 'single'
        WHEN 'payload_occurrence_key' THEN
          NULLIF(btrim(COALESCE(ev.payload ->> b.occurrence_key_field, '')), '')
        WHEN 'event_period' THEN CASE d.recurrence_kind
          WHEN 'monthly'   THEN to_char(event_day, 'YYYY-MM')
          WHEN 'quarterly' THEN to_char(event_day, 'YYYY') || '-Q' || to_char(EXTRACT(quarter FROM event_day), 'FM9')
          WHEN 'yearly'    THEN to_char(event_day, 'YYYY')
          WHEN 'weekly'    THEN to_char(event_day, 'IYYY-"W"IW')
          -- daily/fixed_interval/custom: a chave depende da âncora e do passo,
          -- e derivá-la da data do evento acertaria por acaso. Sem resposta.
          ELSE NULL END
        ELSE NULL END;
      IF key IS NULL THEN reason := 'occurrence_unresolved'; END IF;
    END IF;

    IF reason IS NULL THEN
      SELECT * INTO inst FROM public.contract_obligation_instances
       WHERE definition_id = b.definition_id AND occurrence_key = key;

      /*
        A ocorrência não existe ainda. Materializamos pela função da Fase 3 —
        a mesma, sem recriar recorrência em outro lugar — e procuramos de novo.
        Se ainda assim não existir, a chave descreve um período FORA da
        vigência da definição, e inventar a linha seria fabricar ocorrência.
      */
      IF NOT FOUND THEN
        PERFORM public.contract_obligations_materialize(b.definition_id, event_day, b.organization_id);
        SELECT * INTO inst FROM public.contract_obligation_instances
         WHERE definition_id = b.definition_id AND occurrence_key = key;
        IF NOT FOUND THEN reason := 'occurrence_not_materializable'; END IF;
      END IF;
    END IF;

    IF reason IS NULL THEN
      IF inst.state <> 'NOT_ACTIVATED' THEN
        -- Reentrega, ou obrigação já resolvida por outro caminho. Nenhum dos
        -- dois é erro, e nenhum dos dois reabre nada.
        already := already + 1;
        details := details || jsonb_build_object(
          'binding_id', b.id, 'instance_id', inst.id, 'outcome', 'already_' || lower(inst.state));
      ELSE
        -- Prazo derivado da ativação REAL. A regra é a da 117, aplicada agora
        -- que a âncora deixou de ser desconhecida.
        IF d.calendar_basis = 'business_days'
           AND d.due_kind IN ('days_after_activation','days_before_contract_end') THEN
          new_due := NULL; new_conf := 'unknown';
        ELSE
          new_due := CASE d.due_kind
            WHEN 'same_day_as_activation' THEN event_day
            WHEN 'days_after_activation'  THEN event_day + d.due_offset_days
            ELSE inst.due_date END;
          new_conf := CASE WHEN new_due IS NULL THEN 'unknown' ELSE 'known' END;
        END IF;

        UPDATE public.contract_obligation_instances
           SET activation_state = 'activated',
               activated_at     = event_day,
               activation_note  = 'Ativada pelo fato ' || ev.event_type || ' (evento ' || ev.id::text || ').',
               due_date         = new_due,
               due_confidence   = new_conf,
               due_basis        = CASE WHEN new_conf = 'unknown'
                                       THEN COALESCE(inst.due_basis, 'regra de prazo não especificada')
                                       ELSE d.due_kind END,
               state            = 'OPEN'
         WHERE id = inst.id;
        activated := activated + 1;
        details := details || jsonb_build_object(
          'binding_id', b.id, 'instance_id', inst.id, 'outcome', 'activated',
          'activated_at', event_day);
      END IF;
    ELSE
      unresolved := unresolved + 1;
      details := details || jsonb_build_object(
        'binding_id', b.id, 'outcome', 'unresolved', 'reason', reason,
        'occurrence_key', key);
    END IF;
  END LOOP;

  PERFORM set_config('apex.causation_event_id', '', true);
  PERFORM set_config('apex.event_occurred_at', '', true);

  RETURN jsonb_build_object(
    'event_id', ev.id, 'activated', activated, 'already_activated', already,
    'unresolved', unresolved, 'details', details);
END $$;
REVOKE ALL ON FUNCTION public.contract_obligations_apply_external_activation(uuid)
  FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 5) Produtor agendado — materialização automática
-- ------------------------------------------------------------
-- A Fase 3 deixou `contract_obligations_materialize` pronta e sem quem a
-- chamasse. Este é quem chama.
--
-- A chave de idempotência é (organização, dia). O relógio atual como chave
-- criaria um trabalho novo a cada acordar — 144 por dia, por inquilino.
CREATE FUNCTION public.contracts_enqueue_obligation_materialization(
  p_as_of date DEFAULT current_date,
  p_horizon_days integer DEFAULT 180
) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE org record; n integer := 0;
BEGIN
  IF p_horizon_days < 1 OR p_horizon_days > 730 THEN
    RAISE EXCEPTION 'Horizonte de materialização fora do intervalo permitido.' USING ERRCODE = 'check_violation';
  END IF;
  FOR org IN
    SELECT DISTINCT organization_id FROM public.contract_obligation_definitions WHERE status = 'active'
  LOOP
    PERFORM public.apex_jobs_enqueue(
      org.organization_id,
      'contracts.obligations.materialize',
      'contracts-obligation-materialize:' || org.organization_id::text || ':' || to_char(p_as_of, 'YYYY-MM-DD'),
      jsonb_build_object('as_of', p_as_of, 'horizon_days', p_horizon_days),
      1, now(), 5, NULL, NULL);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.contracts_enqueue_obligation_materialization(date, integer)
  FROM PUBLIC, anon, authenticated;

-- Execução da materialização do dia, para um inquilino. Horizonte ROLANTE e
-- limitado: materializar dez anos à frente encheria a base de ocorrências que
-- ninguém vai olhar e cujo contrato pode nem existir mais.
CREATE FUNCTION public.contracts_run_obligation_materialization(
  p_organization_id uuid,
  p_as_of date DEFAULT current_date,
  p_horizon_days integer DEFAULT 180
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE d record; created integer := 0; defs integer := 0; c integer;
BEGIN
  IF p_horizon_days < 1 OR p_horizon_days > 730 THEN
    RAISE EXCEPTION 'Horizonte de materialização fora do intervalo permitido.' USING ERRCODE = 'check_violation';
  END IF;
  FOR d IN
    SELECT id FROM public.contract_obligation_definitions
     WHERE organization_id = p_organization_id AND status = 'active'
     ORDER BY created_at, id
  LOOP
    -- O terceiro argumento é a checagem de inquilino da própria função da
    -- Fase 3: ela recusa a definição que não seja desta organização.
    SELECT public.contract_obligations_materialize(d.id, p_as_of + p_horizon_days, p_organization_id) INTO c;
    created := created + COALESCE(c, 0);
    defs := defs + 1;
  END LOOP;
  RETURN jsonb_build_object('definitions', defs, 'occurrences_created', created,
                            'through', p_as_of + p_horizon_days);
END $$;
REVOKE ALL ON FUNCTION public.contracts_run_obligation_materialization(uuid, date, integer)
  FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 6) Postura de acesso
-- ------------------------------------------------------------
-- Leitura escopada pela organização, como o resto do módulo; escrita pelo
-- service role, depois que a rota decidiu a permissão.
ALTER TABLE public.contract_obligation_event_bindings ENABLE ROW LEVEL SECURITY;
CREATE POLICY contract_obligation_event_bindings_read
  ON public.contract_obligation_event_bindings FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id());
GRANT SELECT ON public.contract_obligation_event_bindings TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.contract_obligation_event_bindings
  FROM authenticated, anon;

COMMIT;
