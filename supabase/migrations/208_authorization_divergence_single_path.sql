-- ============================================================================
-- 208 — O CONFRONTO ENTRE FONTES TEM UM CAMINHO SÓ
--
-- ─── O buraco que a prova E2E encontrou ──────────────────────────────────
--
-- A 205 passou a registrar a autorização `formal_contract` por gatilho, no
-- instante em que o contrato nasce. Correto — e incompleto: o gatilho
-- registrava e NÃO comparava.
--
-- O efeito é exatamente o cenário D do escopo. Um contrato formal que chega
-- depois de uma proposta aceita já reger entrava no mesmo trabalho
-- autorizado, ficava como fonte não regente (isso funcionava) e NÃO abria
-- divergência nenhuma. Quem abrisse o dossiê veria duas fontes concordando
-- em silêncio sobre valores diferentes.
--
-- Pior: o caminho manual (`commercial_engagement_attach_authorization`) fazia
-- a comparação, e o caminho por gatilho não. Duas portas para o mesmo ato,
-- com comportamentos diferentes — o tipo de divergência que só aparece em
-- produção, e no dossiê errado.
--
-- ─── A correção ──────────────────────────────────────────────────────────
--
-- O confronto vira UMA função, e as duas portas passam a chamá-la. E a porta
-- manual vira idempotente: um contrato cuja autorização o gatilho já criou
-- não falha na unicidade — ela devolve o que existe e roda o confronto.
-- ============================================================================

BEGIN;

/*
  O confronto, isolado.

  Compara a fonte recém-anexada com a REGENTE e registra o que diverge. Hoje
  o fato comparável é o VALOR, e ele é `BLOCKING` porque é o número que o
  faturamento usa. Vigência entra como `WARNING`: uma janela diferente é
  informação de governança, não impedimento de emitir OS.

  Escopo NÃO é comparado aqui, de propósito. Comparar texto de escopo por
  igualdade produziria divergência em toda reescrita de redação e silêncio em
  toda mudança real. Divergência semântica de escopo é leitura assistida, e
  entra por `detected_by = 'ai'`, com documento, página e trecho.
*/
CREATE OR REPLACE FUNCTION public.commercial_authorization_detect_divergences(
  p_organization_id uuid, p_authorization_id uuid
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  incoming public.commercial_engagement_authorizations%ROWTYPE;
  governing public.commercial_engagement_authorizations%ROWTYPE;
  opened integer := 0;
BEGIN
  SELECT * INTO incoming FROM public.commercial_engagement_authorizations
   WHERE organization_id = p_organization_id AND id = p_authorization_id;
  IF NOT FOUND OR incoming.governing THEN RETURN 0; END IF;

  SELECT * INTO governing FROM public.commercial_engagement_authorizations
   WHERE organization_id = p_organization_id AND engagement_id = incoming.engagement_id
     AND governing AND state = 'ACTIVE';
  IF NOT FOUND THEN RETURN 0; END IF;

  -- VALOR
  IF incoming.authorized_value IS NOT NULL AND governing.authorized_value IS NOT NULL
     AND incoming.authorized_value <> governing.authorized_value
     AND NOT EXISTS (
       SELECT 1 FROM public.commercial_divergences d
        WHERE d.organization_id = p_organization_id AND d.scope = 'VALUE'
          AND d.left_source_id = governing.id AND d.right_source_id = incoming.id)
  THEN
    INSERT INTO public.commercial_divergences (
      organization_id, engagement_id, scope, field_path,
      left_source_kind, left_source_id, left_value,
      right_source_kind, right_source_id, right_value,
      severity, summary, detected_by)
    VALUES (p_organization_id, incoming.engagement_id, 'VALUE', 'authorized_value',
            governing.source_kind, governing.id, governing.authorized_value::text,
            incoming.source_kind, incoming.id, incoming.authorized_value::text,
            'BLOCKING',
            format('Valor autorizado difere entre a fonte regente (%s) e a fonte anexada (%s).',
                   governing.authorized_value, incoming.authorized_value),
            'rule');
    opened := opened + 1;
  END IF;

  -- VIGÊNCIA
  IF incoming.effective_until IS NOT NULL AND governing.effective_until IS NOT NULL
     AND incoming.effective_until <> governing.effective_until
     AND NOT EXISTS (
       SELECT 1 FROM public.commercial_divergences d
        WHERE d.organization_id = p_organization_id AND d.scope = 'DATES'
          AND d.left_source_id = governing.id AND d.right_source_id = incoming.id)
  THEN
    INSERT INTO public.commercial_divergences (
      organization_id, engagement_id, scope, field_path,
      left_source_kind, left_source_id, left_value,
      right_source_kind, right_source_id, right_value,
      severity, summary, detected_by)
    VALUES (p_organization_id, incoming.engagement_id, 'DATES', 'effective_until',
            governing.source_kind, governing.id, governing.effective_until::text,
            incoming.source_kind, incoming.id, incoming.effective_until::text,
            'WARNING', 'Vigência final difere entre a fonte regente e a fonte anexada.', 'rule');
    opened := opened + 1;
  END IF;

  RETURN opened;
END $$;
REVOKE ALL ON FUNCTION public.commercial_authorization_detect_divergences(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commercial_authorization_detect_divergences(uuid,uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- A porta por GATILHO passa a comparar
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contracts_register_authorization()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_governs boolean; v_divergences integer := 0;
BEGIN
  IF NEW.engagement_id IS NULL THEN RETURN NEW; END IF;

  v_governs := NOT EXISTS (
    SELECT 1 FROM public.commercial_engagement_authorizations a
     WHERE a.organization_id = NEW.organization_id
       AND a.engagement_id = NEW.engagement_id
       AND a.governing AND a.state = 'ACTIVE');

  INSERT INTO public.commercial_engagement_authorizations (
    organization_id, engagement_id, source_kind, contract_id,
    authorized_value, currency, effective_from, effective_until,
    governing, state, created_by)
  VALUES (
    NEW.organization_id, NEW.engagement_id, 'formal_contract', NEW.id,
    NEW.total_value, NEW.currency, NEW.start_date, NEW.end_date,
    v_governs, 'ACTIVE', NEW.created_by)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN RETURN NEW; END IF;

  -- O confronto roda AQUI, e não só no caminho manual. Sem isto, o contrato
  -- que chega depois de uma proposta aceita entraria em silêncio (§D).
  v_divergences := public.commercial_authorization_detect_divergences(NEW.organization_id, v_id);

  INSERT INTO public.commercial_engagement_history (
    organization_id, engagement_id, transition, actor_user_id, provenance)
  VALUES (NEW.organization_id, NEW.engagement_id, 'authorization_attached', NEW.created_by,
          jsonb_build_object('authorization_id', v_id, 'source_kind', 'formal_contract',
                             'governing', v_governs, 'divergences', v_divergences,
                             'via', 'contract_insert'));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contracts_register_authorization() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A porta MANUAL passa a reusar a mesma função, e a ser idempotente
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commercial_engagement_attach_authorization(
  p_organization_id uuid, p_actor uuid, p_engagement_id uuid, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid; v_kind text; v_contract uuid; v_existing public.commercial_engagement_authorizations%ROWTYPE;
  v_has_governing boolean; v_divergences integer := 0;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Authorization attachment denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Authorization attachment requires a named actor.' USING ERRCODE = '42501';
  END IF;

  v_kind := p_payload->>'source_kind';
  v_contract := nullif(p_payload->>'contract_id','')::uuid;

  /*
    IDEMPOTÊNCIA.

    Desde a 205, inserir um contrato já registra a sua autorização. Chamar
    esta função em seguida — que é o que a tela faz ao "anexar contrato" —
    batia no índice `cea_contract_once` e devolvia erro de chave duplicada
    para uma operação que, do ponto de vista de quem clicou, tinha dado certo.

    Devolver o que existe e rodar o confronto é o comportamento correto de uma
    operação que pode chegar duas vezes pelo mesmo motivo.
  */
  IF v_contract IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.commercial_engagement_authorizations
     WHERE organization_id = p_organization_id AND contract_id = v_contract AND state <> 'REVOKED';
    IF FOUND THEN
      v_divergences := public.commercial_authorization_detect_divergences(
        p_organization_id, v_existing.id);
      RETURN jsonb_build_object('authorization_id', v_existing.id,
                                'governing', v_existing.governing,
                                'divergences_opened', v_divergences,
                                'reused', true);
    END IF;
  END IF;

  v_has_governing := EXISTS (
    SELECT 1 FROM public.commercial_engagement_authorizations a
     WHERE a.organization_id = p_organization_id AND a.engagement_id = p_engagement_id
       AND a.governing AND a.state = 'ACTIVE');

  INSERT INTO public.commercial_engagement_authorizations (
    organization_id, engagement_id, source_kind, contract_id, proposal_revision_id,
    document_id, external_reference, authorized_value, currency,
    effective_from, effective_until, governing, state, note, created_by)
  VALUES (
    p_organization_id, p_engagement_id, v_kind, v_contract,
    nullif(p_payload->>'proposal_revision_id','')::uuid,
    nullif(p_payload->>'document_id','')::uuid,
    nullif(btrim(p_payload->>'external_reference'), ''),
    nullif(p_payload->>'authorized_value','')::numeric,
    nullif(btrim(p_payload->>'currency'), ''),
    nullif(p_payload->>'effective_from','')::date,
    nullif(p_payload->>'effective_until','')::date,
    -- Nunca rege automaticamente quando já existe regente (§D).
    NOT v_has_governing, 'ACTIVE',
    nullif(btrim(p_payload->>'note'), ''), p_actor)
  RETURNING id INTO v_id;

  v_divergences := public.commercial_authorization_detect_divergences(p_organization_id, v_id);

  INSERT INTO public.commercial_engagement_history (
    organization_id, engagement_id, transition, actor_user_id, note, provenance)
  VALUES (p_organization_id, p_engagement_id, 'authorization_attached', p_actor,
          nullif(btrim(p_payload->>'note'), ''),
          jsonb_build_object('authorization_id', v_id, 'source_kind', v_kind,
                             'governing', NOT v_has_governing, 'divergences', v_divergences));

  RETURN jsonb_build_object('authorization_id', v_id, 'governing', NOT v_has_governing,
                            'divergences_opened', v_divergences, 'reused', false);
END $$;
REVOKE ALL ON FUNCTION public.commercial_engagement_attach_authorization(uuid,uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commercial_engagement_attach_authorization(uuid,uuid,uuid,jsonb)
  TO service_role;

COMMIT;
