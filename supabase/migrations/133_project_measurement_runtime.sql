-- ============================================================
-- PROJETOS — transições governadas, eventos transacionais e compatibilidade
-- Migration: 133_project_measurement_runtime
--
-- ─── As quatro coisas que esta migration garante ───────────────────────────
--
--   1. TODA transição passa por uma RPC que trava a linha, valida o estado, o
--      inquilino, o ator e a proveniência, escreve história e emite o evento —
--      NA MESMA TRANSAÇÃO (§37, §43). Não existe "aceita, commita, depois
--      emite": `projects.measurement.accepted` é entrada crítica da Fase 7 e
--      não pode se perder entre dois commits.
--
--   2. ACEITE É NUNCA AUTOMATIZADO. A RPC de aceite exige ator autenticado com
--      permissão OU proveniência externa explícita, e recusa os dois casos que
--      importam: o sistema aceitando sozinho e o navegador dizendo quem
--      aceitou (§11, §63).
--
--   3. O VALOR MEDIDO tem precedência FIXA, e `billing_amount` NUNCA entra
--      nela (§12, §68). Esta é a regra que bloqueia merge, e ela existe aqui
--      como função para que o teste de regressão tenha o que apontar.
--
--   4. O candidato de medição nasce por ocorrência DETERMINÍSTICA e é
--      idempotente (§45, §46). Batida de ponto não cria medição aceita; regra
--      com cadência declarada cria medição PLANEJADA.
--
-- ─── O que esta migration NÃO faz ──────────────────────────────────────────
--
-- Não liga o corte do Motor de Aprovação para aceite de medição. A auditoria
-- da Fase 6 encontrou o mesmo quadro da Fase 5: ZERO medição real, ZERO
-- política de aceite, nenhuma alçada em lugar nenhum. A §33 e a §100 são
-- explícitas — sem política autoritativa real, registra-se o MECANISMO e
-- para-se antes de inventar a REGRA. É o que está abaixo: o sujeito
-- `project_measurement` fica legível para o motor, com impressão digital de
-- conteúdo real, e `approval_engine_cutover` continua sem linha.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1) Cache de prontidão — declarado como CACHE
-- ------------------------------------------------------------
/*
  A §48 permite cache e exige que ele diga QUANDO foi calculado e SOBRE O QUÊ.
  Um booleano solto envelhece em silêncio; este carrega `computed_at` e a
  impressão das entradas, para que quem lê saiba se está olhando a verdade de
  agora ou a de ontem. O resolvedor da 132 continua sendo a verdade.
*/
CREATE TABLE public.project_measurement_readiness_cache (
  measurement_id    uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  overall           text NOT NULL,
  dimensions        jsonb NOT NULL,
  reasons           jsonb NOT NULL,
  input_fingerprint text NOT NULL,
  computed_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pmrc_measurement_tenant FOREIGN KEY (organization_id, measurement_id)
    REFERENCES public.project_measurements (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX pmrc_org_stale ON public.project_measurement_readiness_cache (organization_id, computed_at);

ALTER TABLE public.project_measurement_readiness_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY pmrc_select ON public.project_measurement_readiness_cache FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id());
GRANT SELECT ON public.project_measurement_readiness_cache TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.project_measurement_readiness_cache FROM authenticated, anon;
REVOKE ALL ON public.project_measurement_readiness_cache FROM anon;

COMMENT ON TABLE public.project_measurement_readiness_cache IS
  'CACHE, e o nome diz. A verdade é project_measurement_readiness(). '
  '`computed_at` e `input_fingerprint` existem para que uma leitura velha seja '
  'reconhecível como velha (§48).';

CREATE FUNCTION public.project_measurement_recompute_readiness(p_measurement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE m public.project_measurements%ROWTYPE; res jsonb; fp text;
BEGIN
  SELECT * INTO m FROM public.project_measurements WHERE id = p_measurement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'MEASUREMENT_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;

  PERFORM public.project_measurement_reconcile_requirements(p_measurement_id);
  res := public.project_measurement_readiness(p_measurement_id, NULL);

  -- A impressão cobre as ENTRADAS da prontidão: status, revisão, e o conjunto
  -- de vínculos de evidência e exigências vivos. Mudou alguma, o cache é
  -- reconhecidamente outro.
  SELECT encode(extensions.digest(concat_ws('|', m.status, m.revision::text,
    (SELECT COALESCE(string_agg(e.id::text || ':' || e.validation_state, ',' ORDER BY e.id), '')
       FROM public.project_measurement_evidence e
      WHERE e.measurement_id = m.id AND e.revoked_at IS NULL),
    (SELECT COALESCE(string_agg(q.requirement_kind || ':' || q.satisfaction_state, ',' ORDER BY q.requirement_kind), '')
       FROM public.project_measurement_requirements q WHERE q.measurement_id = m.id)
  )::bytea, 'sha256'), 'hex') INTO fp;

  INSERT INTO public.project_measurement_readiness_cache
    (measurement_id, organization_id, overall, dimensions, reasons, input_fingerprint, computed_at)
  VALUES (m.id, m.organization_id, res->>'overall', res->'dimensions', res->'reasons', fp, now())
  ON CONFLICT (measurement_id) DO UPDATE
    SET overall = EXCLUDED.overall, dimensions = EXCLUDED.dimensions, reasons = EXCLUDED.reasons,
        input_fingerprint = EXCLUDED.input_fingerprint, computed_at = EXCLUDED.computed_at;

  RETURN res;
END $$;
REVOKE ALL ON FUNCTION public.project_measurement_recompute_readiness(uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 2) Emissão de fato de medição — sempre na transação da mutação
-- ------------------------------------------------------------
CREATE FUNCTION public.project_measurement_emit(
  p_measurement public.project_measurements,
  p_event_type  text,
  p_payload     jsonb DEFAULT '{}'::jsonb,
  p_actor       uuid  DEFAULT NULL,
  p_source      text  DEFAULT 'human'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN public.emit_domain_event(
    p_measurement.organization_id,
    p_event_type,
    1,
    'project_measurement',
    p_measurement.id,
    -- A chave de idempotência amarra o fato ao ESTADO que o produziu. Retentar
    -- a mesma transição devolve o mesmo evento; uma transição nova (revisão
    -- diferente) é outro fato, e tem outra chave.
    p_event_type || ':' || p_measurement.id::text || ':' || p_measurement.revision::text
      || ':' || p_measurement.status,
    p_payload
      || jsonb_build_object(
           'project_id', p_measurement.project_id,
           'contract_id', p_measurement.contract_id,
           'contract_measurement_rule_id', p_measurement.contract_measurement_rule_id,
           'occurrence_key', p_measurement.occurrence_key,
           'occurrence_state', p_measurement.occurrence_state,
           'revision', p_measurement.revision,
           'status', p_measurement.status),
    now(), p_source, p_actor, p_measurement.correlation_id, p_measurement.source_event_id);
END $$;
REVOKE ALL ON FUNCTION public.project_measurement_emit(
  public.project_measurements, text, jsonb, uuid, text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.project_measurement_emit(public.project_measurements, text, jsonb, uuid, text) IS
  'Emissão de fato de medição. Chamada DENTRO da transação da transição — a '
  '§43 proíbe commitar a mudança e emitir depois.';

-- ------------------------------------------------------------
-- 3) O executor comum das transições
-- ------------------------------------------------------------
/*
  Um caminho só, e todas as RPCs abaixo entram por ele. A ordem das etapas é a
  da §37 e não é negociável:

    trava → valida estado → valida inquilino → valida ator → valida
    proveniência → história → projeção → evento → commit

  A trava (`FOR UPDATE`) é o que faz a corrida da §92 ter um vencedor só:
  aceitar e rejeitar ao mesmo tempo faz a segunda conexão esperar, e quando ela
  acorda o estado já não permite a transição dela.
*/
CREATE FUNCTION public.project_measurement_transition(
  p_measurement_id uuid,
  p_to_state       text,
  p_event_type     text,
  p_reason         text  DEFAULT NULL,
  p_actor_source   text  DEFAULT 'human',
  p_actor_reference text DEFAULT NULL,
  p_provenance     jsonb DEFAULT '{}'::jsonb,
  p_payload        jsonb DEFAULT '{}'::jsonb,
  p_required_permission text DEFAULT NULL,
  -- Qual marca de tempo o estado novo carimba. Lista fechada, comparada por
  -- igualdade — não há SQL dinâmico, e portanto não há coluna escolhida por
  -- quem chama.
  p_stamp          text  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m public.project_measurements%ROWTYPE;
  actor uuid := auth.uid();
  ev uuid;
  hist uuid;
BEGIN
  SELECT * INTO m FROM public.project_measurements WHERE id = p_measurement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEASUREMENT_NOT_FOUND: medição inexistente.' USING ERRCODE = 'no_data_found';
  END IF;

  /*
    As guardas olham a IDENTIDADE QUE AGE, e não o papel do banco.

    Prender a verificação a `current_user IN ('authenticated','anon')` a
    desligaria para todo chamador de servidor — inclusive a rota Next.js, que
    fala pelo service role. O ator é `auth.uid()`: havendo pessoa, ela precisa
    ter o direito, venha por onde vier. Não havendo, quem chama é o sistema, e
    aí a regra que vale é a do aceite (nunca automatizado).
  */
  IF actor IS NOT NULL
     AND m.organization_id IS DISTINCT FROM public.current_user_organization_id() THEN
    -- Mesma mensagem para "de outro inquilino" e "não existe": duas mensagens
    -- diferentes responderiam se aquele UUID existe noutra organização.
    RAISE EXCEPTION 'MEASUREMENT_NOT_FOUND: medição inexistente.' USING ERRCODE = 'no_data_found';
  END IF;

  IF p_required_permission IS NOT NULL
     AND actor IS NOT NULL
     AND NOT (public.current_user_has_permission(p_required_permission) OR public.current_user_is_admin()) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: falta a permissão %.', p_required_permission USING ERRCODE = '42501';
  END IF;

  IF NOT public.project_measurement_valid_transition(m.status, p_to_state) THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: % -> % não é permitido.', m.status, p_to_state
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_stamp IS NOT NULL AND p_stamp NOT IN ('submitted_at','rejected_at','returned_at','cancelled_at') THEN
    RAISE EXCEPTION 'UNKNOWN_STAMP: %', p_stamp USING ERRCODE = 'check_violation';
  END IF;

  /*
    A projeção. Estado e marca de tempo mudam na MESMA instrução, e não é
    estilo: `pm_rejected_coherent` exige que REJECTED já tenha `rejected_at`, e
    `pm_rejection_facts_scope` proíbe `rejected_at` em quem ainda não é
    rejeitado. As duas juntas fecham qualquer ordem em dois passos — que é o
    ponto delas.

    O gatilho da 130 escreve a história e recusa a transição inválida de novo.
    Não é redundância: ele protege também quem escreva fora daqui, se um dia
    houver.
  */
  UPDATE public.project_measurements
     SET status = p_to_state,
         submitted_at = CASE WHEN p_stamp = 'submitted_at' THEN now() ELSE submitted_at END,
         rejected_at  = CASE WHEN p_stamp = 'rejected_at'  THEN now() ELSE rejected_at  END,
         returned_at  = CASE WHEN p_stamp = 'returned_at'  THEN now() ELSE returned_at  END,
         cancelled_at = CASE WHEN p_stamp = 'cancelled_at' THEN now() ELSE cancelled_at END
   WHERE id = m.id;
  SELECT * INTO m FROM public.project_measurements WHERE id = m.id;

  -- A história ganha a proveniência exata que só a RPC conhece. O gatilho
  -- gravou a linha; aqui ela recebe motivo, fonte de ator e proveniência.
  SELECT id INTO hist FROM public.project_measurement_history
   WHERE measurement_id = m.id ORDER BY recorded_at DESC, id DESC LIMIT 1;

  ev := public.project_measurement_emit(m, p_event_type, p_payload, actor,
          CASE WHEN p_actor_source IN ('human','system','cron','provider','integration')
               THEN p_actor_source ELSE 'system' END);

  /*
    A história é somente-acréscimo, e o gatilho da 130 recusa UPDATE nela. Por
    isso o enriquecimento entra como ACRÉSCIMO de anotação, e não como
    reescrita da linha de transição: a linha original fica exatamente como
    nasceu, e a anotação diz o resto.
  */
  INSERT INTO public.project_measurement_history
    (organization_id, measurement_id, from_state, to_state, transition, reason,
     actor_user_id, actor_source, actor_reference, provenance, correlation_id, domain_event_id)
  VALUES (m.organization_id, m.id, p_to_state, p_to_state, 'provenance_note', p_reason,
          actor, p_actor_source, p_actor_reference,
          COALESCE(p_provenance,'{}'::jsonb) || jsonb_build_object('history_id', hist),
          m.correlation_id, ev);

  PERFORM public.project_measurement_recompute_readiness(m.id);

  RETURN jsonb_build_object('measurement_id', m.id, 'status', m.status,
                            'event_id', ev, 'revision', m.revision);
END $$;
REVOKE ALL ON FUNCTION public.project_measurement_transition(
  uuid, text, text, text, text, text, jsonb, jsonb, text, text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4) As transições públicas do domínio
-- ------------------------------------------------------------
CREATE FUNCTION public.project_measurement_prepare(p_measurement_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.project_measurement_transition(
    p_measurement_id, 'IN_PREPARATION', 'projects.measurement.created',
    NULL, 'human', NULL, '{}'::jsonb, '{}'::jsonb, 'projects.measurements.edit', NULL);
$$;

CREATE FUNCTION public.project_measurement_mark_ready(p_measurement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE res jsonb;
BEGIN
  /*
    Marcar pronto sem estar pronto é o defeito que a §27 existe para impedir.
    A prontidão é recalculada AQUI, e não lida do cache: um cache de ontem
    diria "pronto" sobre um pacote que perdeu evidência hoje.
  */
  res := public.project_measurement_recompute_readiness(p_measurement_id);
  IF res->'dimensions'->>'submission' <> 'READY' THEN
    RAISE EXCEPTION 'NOT_READY: prontidão de submissão é % (%).',
      res->'dimensions'->>'submission', res->>'reasons' USING ERRCODE = 'check_violation';
  END IF;
  RETURN public.project_measurement_transition(
    p_measurement_id, 'READY_FOR_SUBMISSION', 'projects.measurement.ready_for_submission',
    NULL, 'human', NULL, jsonb_build_object('readiness', res->'dimensions'), '{}'::jsonb,
    'projects.measurements.edit', NULL);
END $$;

CREATE FUNCTION public.project_measurement_submit(
  p_measurement_id uuid,
  p_note           text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE res jsonb; m public.project_measurements%ROWTYPE;
BEGIN
  res := public.project_measurement_recompute_readiness(p_measurement_id);
  IF res->'dimensions'->>'submission' <> 'READY' THEN
    RAISE EXCEPTION 'NOT_READY: prontidão de submissão é %.', res->'dimensions'->>'submission'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO m FROM public.project_measurements WHERE id = p_measurement_id;

  RETURN public.project_measurement_transition(
    p_measurement_id, 'SUBMITTED', 'projects.measurement.submitted',
    p_note, 'human', NULL, jsonb_build_object('readiness', res->'dimensions'),
    jsonb_build_object('quantity', m.quantity, 'unit', m.unit,
                       'measured_value', m.measured_value, 'currency', m.currency),
    'projects.measurements.submit', 'submitted_at');
END $$;

/*
  ─── ACEITE ───────────────────────────────────────────────────────────────

  A função mais importante da Fase 6, e a que mais recusa.

  Um aceite precisa de FONTE e de ATOR. As fontes válidas estão no CHECK da
  130; aqui se prova que a fonte veio acompanhada de quem, de fato, aceitou:

    · fonte interna  → pessoa autenticada com permissão de aceite;
    · fonte externa  → parte nomeada, documento, ou referência externa.

  E há uma recusa que não tem exceção: `internal_reviewer` sem `auth.uid()`
  seria o sistema se passando por revisor. A §11 chama isso de fingir que o
  cliente aceitou, e é o único caminho que esta migration fecha duas vezes —
  no CHECK da tabela e aqui.
*/
CREATE FUNCTION public.project_measurement_accept(
  p_measurement_id       uuid,
  p_acceptance_source    text,
  p_accepted_quantity    numeric DEFAULT NULL,
  p_accepted_value       numeric DEFAULT NULL,
  p_accepted_currency    text    DEFAULT NULL,
  p_accepted_by_party_id uuid    DEFAULT NULL,
  p_external_reference   text    DEFAULT NULL,
  p_acceptance_document_id uuid  DEFAULT NULL,
  p_note                 text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m public.project_measurements%ROWTYPE;
  actor uuid := auth.uid();
  is_external boolean;
BEGIN
  SELECT * INTO m FROM public.project_measurements WHERE id = p_measurement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEASUREMENT_NOT_FOUND: medição inexistente.' USING ERRCODE = 'no_data_found';
  END IF;

  -- Aceite repetido devolve o aceite que já existe, e não um segundo aceite.
  -- A §91 pede idempotência; um erro aqui faria a interface tentar de novo.
  IF m.status = 'ACCEPTED' THEN
    RETURN jsonb_build_object('measurement_id', m.id, 'status', m.status,
                              'idempotent', true, 'revision', m.revision);
  END IF;

  IF p_acceptance_source IS NULL THEN
    RAISE EXCEPTION 'ACCEPTANCE_SOURCE_REQUIRED: aceite sem fonte autoritativa não é aceite (§11).'
      USING ERRCODE = 'check_violation';
  END IF;

  is_external := p_acceptance_source IN ('customer_portal','signed_bulletin','external_document','integration');

  /*
    A RECUSA CENTRAL. Sem pessoa autenticada e sem proveniência externa, quem
    estaria aceitando é o processo que roda a função — ou seja, ninguém.
  */
  IF actor IS NULL AND NOT is_external THEN
    RAISE EXCEPTION 'ACCEPTANCE_NEVER_AUTOMATED: aceite interno exige pessoa autenticada. '
      'Sistema, rotina e IA não aceitem medição (§11).' USING ERRCODE = '42501';
  END IF;

  IF is_external
     AND p_accepted_by_party_id IS NULL
     AND p_acceptance_document_id IS NULL
     AND NULLIF(btrim(COALESCE(p_external_reference,'')), '') IS NULL THEN
    RAISE EXCEPTION 'ACCEPTANCE_PROVENANCE_REQUIRED: aceite externo exige parte, documento ou referência (§34,§35).'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Permissão de quem registra o aceite, inclusive o externo: quem TRANSCREVE
  -- o aceite do cliente para dentro do Apex está exercendo um ato governado.
  IF actor IS NOT NULL
     AND NOT (public.current_user_has_permission('projects.measurements.accept') OR public.current_user_is_admin()) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: falta a permissão projects.measurements.accept.' USING ERRCODE = '42501';
  END IF;

  -- Inquilino, pela mesma razão e com a mesma mensagem do executor comum.
  IF actor IS NOT NULL
     AND m.organization_id IS DISTINCT FROM public.current_user_organization_id() THEN
    RAISE EXCEPTION 'MEASUREMENT_NOT_FOUND: medição inexistente.' USING ERRCODE = 'no_data_found';
  END IF;

  IF m.status NOT IN ('SUBMITTED','UNDER_REVIEW') THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: só medição submetida ou em análise é aceita (estado atual: %).', m.status
      USING ERRCODE = 'check_violation';
  END IF;

  /*
    O CONGELAMENTO. Os fatos aceitos entram AGORA, no mesmo UPDATE que muda o
    estado, porque depois da transição o gatilho da 130 os torna imutáveis. Na
    ausência de valor aceito informado, congela-se o medido — o que não é
    inferência: é o significado de aceitar o que foi submetido.
  */
  UPDATE public.project_measurements
     SET status = 'ACCEPTED',
         accepted_at = now(),
         acceptance_source = p_acceptance_source,
         accepted_by_user_id = CASE WHEN is_external THEN NULL ELSE actor END,
         accepted_by_party_id = p_accepted_by_party_id,
         accepted_external_ref = NULLIF(btrim(COALESCE(p_external_reference,'')), ''),
         acceptance_document_id = p_acceptance_document_id,
         acceptance_note = p_note,
         accepted_quantity = COALESCE(p_accepted_quantity, quantity),
         accepted_value = COALESCE(p_accepted_value, measured_value),
         accepted_currency = COALESCE(p_accepted_currency, currency)
   WHERE id = m.id;

  SELECT * INTO m FROM public.project_measurements WHERE id = m.id;

  INSERT INTO public.project_measurement_history
    (organization_id, measurement_id, from_state, to_state, transition, reason,
     actor_user_id, actor_source, actor_reference, provenance, correlation_id)
  VALUES (m.organization_id, m.id, 'ACCEPTED', 'ACCEPTED', 'acceptance_provenance', p_note,
          CASE WHEN is_external THEN NULL ELSE actor END,
          CASE WHEN is_external THEN 'external' ELSE 'human' END,
          COALESCE(p_external_reference, p_acceptance_document_id::text),
          jsonb_build_object('acceptance_source', p_acceptance_source,
                             'party_id', p_accepted_by_party_id,
                             'document_id', p_acceptance_document_id,
                             'recorded_by', actor),
          m.correlation_id);

  PERFORM public.project_measurement_emit(m, 'projects.measurement.accepted',
    jsonb_build_object(
      'accepted_at', m.accepted_at,
      'acceptance_source', m.acceptance_source,
      'accepted_quantity', m.accepted_quantity,
      'accepted_value', m.accepted_value,
      'accepted_currency', m.accepted_currency,
      'measurement_basis', m.measurement_basis,
      'accumulation_mode', m.accumulation_mode,
      'milestone_id', m.milestone_id,
      'period_start', m.measurement_period_start,
      'period_end', m.measurement_period_end),
    actor, CASE WHEN is_external THEN 'provider' ELSE 'human' END);

  PERFORM public.project_measurement_recompute_readiness(m.id);

  RETURN jsonb_build_object('measurement_id', m.id, 'status', m.status,
                            'idempotent', false, 'revision', m.revision);
END $$;

CREATE FUNCTION public.project_measurement_reject(
  p_measurement_id uuid,
  p_reason         text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NULLIF(btrim(COALESCE(p_reason,'')), '') IS NULL THEN
    RAISE EXCEPTION 'REASON_REQUIRED: rejeição é decisão negativa e exige motivo (§39).'
      USING ERRCODE = 'check_violation';
  END IF;
  -- O motivo entra ANTES da transição porque é texto, e texto não tem CHECK de
  -- coerência com o estado. A marca de tempo, que tem, entra com o estado.
  UPDATE public.project_measurements SET rejection_reason = p_reason
   WHERE id = p_measurement_id AND status IN ('SUBMITTED','UNDER_REVIEW');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: só medição submetida ou em análise é rejeitada.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN public.project_measurement_transition(
    p_measurement_id, 'REJECTED', 'projects.measurement.rejected', p_reason,
    'human', NULL, '{}'::jsonb, jsonb_build_object('reason', p_reason),
    'projects.measurements.accept', 'rejected_at');
END $$;

-- Devolver NÃO é rejeitar (§39). O pacote volta para correção e pode ser
-- reenviado; o fato emitido é outro, e a Fase 7 precisa saber a diferença.
CREATE FUNCTION public.project_measurement_return(
  p_measurement_id uuid,
  p_reason         text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NULLIF(btrim(COALESCE(p_reason,'')), '') IS NULL THEN
    RAISE EXCEPTION 'REASON_REQUIRED: devolução exige o que corrigir.' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.project_measurements SET return_reason = p_reason
   WHERE id = p_measurement_id AND status IN ('SUBMITTED','UNDER_REVIEW');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: só medição submetida ou em análise é devolvida.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN public.project_measurement_transition(
    p_measurement_id, 'RETURNED_FOR_CORRECTION', 'projects.measurement.returned_for_correction',
    p_reason, 'human', NULL, '{}'::jsonb, jsonb_build_object('reason', p_reason),
    'projects.measurements.accept', 'returned_at');
END $$;

CREATE FUNCTION public.project_measurement_cancel(
  p_measurement_id uuid,
  p_reason         text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN public.project_measurement_transition(
    p_measurement_id, 'CANCELLED', 'projects.measurement.cancelled', p_reason,
    'human', NULL, '{}'::jsonb, '{}'::jsonb, 'projects.measurements.edit', 'cancelled_at');
END $$;

/*
  ─── SUPERSESSÃO ──────────────────────────────────────────────────────────

  O único caminho para mudar uma verdade aceita (§40, §41, §73). Não é um
  rollback: a medição aceita permanece, aceita, na história, e uma NOVA
  revisão nasce apontando para ela. Quem auditar vê as duas — que é o ponto.
*/
CREATE FUNCTION public.project_measurement_supersede(
  p_measurement_id uuid,
  p_reason         text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE old_m public.project_measurements%ROWTYPE; new_id uuid := gen_random_uuid(); ev uuid;
BEGIN
  IF NULLIF(btrim(COALESCE(p_reason,'')), '') IS NULL THEN
    RAISE EXCEPTION 'REASON_REQUIRED: supersessão de medição exige justificativa registrada (§73).'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO old_m FROM public.project_measurements WHERE id = p_measurement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MEASUREMENT_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;

  IF auth.uid() IS NOT NULL
     AND NOT (public.current_user_has_permission('projects.measurements.accept') OR public.current_user_is_admin()) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: supersessão exige projects.measurements.accept.' USING ERRCODE = '42501';
  END IF;

  /*
    A ORDEM. A antiga sai do índice de ocorrência ANTES de a nova entrar —
    as duas compartilham a mesma `occurrence_key`, e o índice parcial só
    ignora quem já está SUPERSEDED. O `superseded_by_id` aponta para um id que
    ainda não existe, e é por isso que a chave estrangeira da 130 é diferida:
    no commit a sucessora está lá.
  */
  UPDATE public.project_measurements
     SET status = 'SUPERSEDED', superseded_at = now(), superseded_by_id = new_id,
         supersession_reason = p_reason
   WHERE id = old_m.id;

  -- A revisão nova nasce PLANEJADA, com os mesmos vínculos e sem nenhum fato
  -- de aceite herdado. Copiar `accepted_*` faria a revisão nascer aceita — que
  -- é exatamente a fabricação de aceite que a Fase 6 proíbe.
  INSERT INTO public.project_measurements
    (id, organization_id, project_id, contract_id, contract_measurement_rule_id, timeline_item_id, milestone_id,
     occurrence_key, occurrence_state, measurement_period_start, measurement_period_end, expected_at,
     rule_effective_from, rule_effective_until, rule_snapshot,
     measurement_basis, accumulation_mode, quantity, unit, measured_value, currency,
     status, revision, supersedes_id, origin, correlation_id, created_by)
  VALUES
    (new_id, old_m.organization_id, old_m.project_id, old_m.contract_id, old_m.contract_measurement_rule_id,
     old_m.timeline_item_id, old_m.milestone_id,
     old_m.occurrence_key, old_m.occurrence_state, old_m.measurement_period_start, old_m.measurement_period_end,
     old_m.expected_at, old_m.rule_effective_from, old_m.rule_effective_until, old_m.rule_snapshot,
     old_m.measurement_basis, old_m.accumulation_mode, old_m.quantity, old_m.unit,
     old_m.measured_value, old_m.currency,
     'PLANNED', old_m.revision + 1, old_m.id, 'manual', old_m.correlation_id, auth.uid());

  SELECT * INTO old_m FROM public.project_measurements WHERE id = old_m.id;
  ev := public.project_measurement_emit(old_m, 'projects.measurement.superseded',
          jsonb_build_object('superseded_by', new_id, 'reason', p_reason), auth.uid(), 'human');

  PERFORM public.project_measurement_resolve_requirements(new_id);
  PERFORM public.project_measurement_recompute_readiness(new_id);
  PERFORM public.project_measurement_recompute_readiness(old_m.id);

  RETURN jsonb_build_object('superseded_id', old_m.id, 'new_measurement_id', new_id, 'event_id', ev);
END $$;

-- As RPCs de domínio são chamáveis pelo navegador AUTENTICADO. Elas são
-- DEFINER e checam permissão por dentro — é o desenho da §37: nenhum caminho
-- de escrita direto na tabela, e todo caminho governado passa por validação.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'project_measurement_prepare(uuid)',
    'project_measurement_mark_ready(uuid)',
    'project_measurement_submit(uuid, text)',
    'project_measurement_accept(uuid, text, numeric, numeric, text, uuid, text, uuid, text)',
    'project_measurement_reject(uuid, text)',
    'project_measurement_return(uuid, text)',
    'project_measurement_cancel(uuid, text)',
    'project_measurement_supersede(uuid, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

COMMIT;
