-- ============================================================================
-- 185 — O VÍNCULO MANUAL: quando o robô não sabe, alguém escolhe
--
-- ─── O buraco ─────────────────────────────────────────────────────────────
--
-- Até aqui existiam DOIS caminhos de escrita para o mapeamento marco↔etapa:
--
--   contract_billing_propose_timeline_mapping  → o palpite (service role)
--   contract_measurement_rule_timeline_review  → aceitar/rejeitar o palpite
--
-- Os dois partem de uma PROPOSTA existente. E o resultado é que o caso mais
-- importante não tinha caminho nenhum: o marco SEM correspondência.
--
-- "Evento 05 · Montagem e fechamento do enrolamento estatórico" não tem etapa
-- óbvia no cronograma de JA10182283/2025 — o matcher empata entre duas e
-- nenhuma convence. A pessoa que conhece a obra sabe qual é. Até esta
-- migration, ela não tinha como dizer: não havia proposta para aceitar, e
-- `authenticated` não escreve na tabela.
--
-- Uma regra de governança que só se cumpre quando o robô acerta não é
-- governança — é sorte.
--
-- ─── O que esta função é, e o que ela NÃO é ───────────────────────────────
--
-- É o caminho HUMANO até `accepted`, com `mapping_source = 'explicit'`:
-- alguém escolheu, e por isso não há confiança associada (a 131 já proíbe
-- confiança em fonte explícita — ninguém tem "85% de certeza" sobre a própria
-- decisão).
--
-- NÃO é um segundo sistema de mapeamento: escreve na MESMA tabela da 131, sob
-- os MESMOS CHECKs, e é lida pelas MESMAS visões. Não há estado novo, não há
-- tabela nova, não há segunda verdade.
--
-- NÃO é um atalho de permissão: exige `auth.uid()` e `contracts.edit` —
-- exatamente o que `contract_measurement_rule_timeline_review` já exigia.
-- Definir a âncora de faturamento de R$ 1.606.467,95 é o mesmo ato, venha ele
-- de um botão "Aceitar" ou de um botão "Vincular".
--
-- ─── A ambiguidade se resolve aqui ────────────────────────────────────────
--
-- Escolher uma etapa REJEITA as propostas concorrentes da mesma regra, no
-- mesmo ato e na mesma transação. Sem isso, o marco ficaria com um vínculo
-- aceito e duas sugestões órfãs pendurradas na fila de revisão, pedindo uma
-- decisão que já foi tomada.
--
-- ─── A invariante que faltava ─────────────────────────────────────────────
--
-- UMA regra tem no máximo UM mapeamento aceito por projeto. A 131 só garante
-- unicidade de (organização, regra, etapa) — duas etapas diferentes aceitas
-- para a mesma regra passavam. Nunca aconteceu porque o matcher propõe uma
-- por regra; "nunca aconteceu" não é uma garantia. As duas funções de escrita
-- passam a conferir.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) O VÍNCULO MANUAL
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contract_measurement_rule_timeline_link(
  p_rule_id          uuid,
  p_timeline_item_id uuid,
  p_note             text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  uid        uuid := auth.uid();
  v_org      uuid := public.current_user_organization_id();
  v_rule     record;
  v_item     record;
  v_existing public.contract_measurement_rule_timeline_mappings%ROWTYPE;
  v_current  record;
  v_id       uuid;
BEGIN
  -- Sem usuário não há quem decida. É o que impede uma rotina de servidor de
  -- criar vínculo aceito por este caminho.
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Vincular etapa a marco exige usuário autenticado.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (public.current_user_has_permission('contracts.edit')
          OR public.current_user_is_admin()) THEN
    RAISE EXCEPTION 'Sem permissão para vincular etapa de cronograma a marco contratual.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT q.id, q.contract_id, q.milestone_id INTO v_rule
    FROM public.contract_measurement_requirements q
   WHERE q.id = p_rule_id AND q.organization_id = v_org AND q.effect <> 'removed';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exigência de medição % não existe nesta organização.', p_rule_id
      USING ERRCODE = 'no_data_found';
  END IF;

  /*
    A etapa precisa estar VIVA.

    Vincular a uma etapa desativada produziria um marco "sincronizado" cuja
    data o planejamento ignora (a visão 179 exige `timeline_is_active`) — um
    vínculo que existe no banco e não existe na tela.
  */
  SELECT t.id, t.project_id, t.title, t.wbs_code INTO v_item
    FROM public.project_timeline_items t
   WHERE t.id = p_timeline_item_id
     AND t.organization_id = v_org
     AND t.is_active
     AND t.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Etapa de cronograma % não existe, está inativa ou não é desta organização.',
      p_timeline_item_id USING ERRCODE = 'no_data_found';
  END IF;

  -- O projeto tem de estar ligado ao contrato. A 131 já exige por FK; conferir
  -- aqui devolve erro legível em vez de violação de restrição.
  IF NOT EXISTS (
    SELECT 1 FROM public.contract_project_links l
     WHERE l.organization_id = v_org
       AND l.contract_id = v_rule.contract_id
       AND l.project_id = v_item.project_id) THEN
    RAISE EXCEPTION 'O projeto % não está vinculado ao contrato deste marco.', v_item.project_id
      USING ERRCODE = 'check_violation';
  END IF;

  /*
    UM vínculo aceito por regra e projeto.

    Trocar a âncora de um marco já vinculado é uma decisão nova — muda a data
    prevista de faturamento e a previsão do mês. Ela não acontece por um clique
    num botão que parecia disponível: esta função recusa e DIZ qual é o vínculo
    vigente, para que a troca seja um ato deliberado.
  */
  SELECT m.id, t.title, t.wbs_code INTO v_current
    FROM public.contract_measurement_rule_timeline_mappings m
    JOIN public.project_timeline_items t ON t.id = m.timeline_item_id
   WHERE m.organization_id = v_org
     AND m.rule_id = p_rule_id
     AND m.project_id = v_item.project_id
     AND m.review_state = 'accepted'
     AND m.timeline_item_id <> p_timeline_item_id
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Este marco já está vinculado à etapa % (%). Desfaça o vínculo atual antes de criar outro.',
      COALESCE(v_current.wbs_code, '—'), v_current.title USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_existing
    FROM public.contract_measurement_rule_timeline_mappings
   WHERE organization_id = v_org
     AND rule_id = p_rule_id
     AND timeline_item_id = p_timeline_item_id;

  IF FOUND THEN
    IF v_existing.review_state = 'accepted' THEN
      -- Já é exatamente o que se pediu. Idempotente de propósito: dois cliques
      -- não podem virar duas decisões.
      RETURN v_existing.id;
    END IF;

    /*
      Proposta confirmada, ou recusa revista.

      Nos dois casos a fonte passa a ser `explicit`: a partir daqui quem
      responde pelo par é a pessoa, não o escore — e a confiança do palpite
      sai junto, porque a 131 proíbe confiança em fonte explícita.
    */
    UPDATE public.contract_measurement_rule_timeline_mappings
       SET review_state   = 'accepted',
           mapping_source = 'explicit',
           confidence     = NULL,
           ambiguous_with = ARRAY[]::uuid[],
           reviewed_by    = uid,
           reviewed_at    = now(),
           note           = COALESCE(p_note, note)
     WHERE id = v_existing.id;
    v_id := v_existing.id;
  ELSE
    INSERT INTO public.contract_measurement_rule_timeline_mappings
      (organization_id, contract_id, rule_id, project_id, timeline_item_id,
       mapping_source, confidence, review_state, mapped_by, reviewed_by, reviewed_at, note)
    VALUES (v_org, v_rule.contract_id, p_rule_id, v_item.project_id, p_timeline_item_id,
            'explicit', NULL, 'accepted', uid, uid, now(), p_note)
    RETURNING id INTO v_id;
  END IF;

  /*
    A AMBIGUIDADE MORRE AQUI.

    As outras propostas da mesma regra neste projeto viram `rejected` no mesmo
    ato — carimbadas com o mesmo revisor, porque foi ele quem as descartou ao
    escolher outra. Deixá-las pendentes encheria a fila com uma decisão já
    tomada, e a próxima importação as reofereceria.
  */
  UPDATE public.contract_measurement_rule_timeline_mappings
     SET review_state = 'rejected',
         reviewed_by  = uid,
         reviewed_at  = now(),
         note         = COALESCE(note || ' · ', '')
                        || 'Descartada: outra etapa foi vinculada manualmente.'
   WHERE organization_id = v_org
     AND rule_id = p_rule_id
     AND project_id = v_item.project_id
     AND review_state = 'proposed'
     AND id <> v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.contract_measurement_rule_timeline_link(uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_measurement_rule_timeline_link(uuid, uuid, text)
  TO authenticated;

COMMENT ON FUNCTION public.contract_measurement_rule_timeline_link(uuid, uuid, text) IS
  'O vínculo MANUAL marco↔etapa: o caminho humano até accepted, com '
  'mapping_source = explicit. Mesma tabela, mesmos CHECKs e mesma permissão '
  '(auth.uid() + contracts.edit) do fluxo de revisão — não é um segundo '
  'sistema de mapeamento. Escolher uma etapa rejeita as propostas '
  'concorrentes da mesma regra no mesmo ato.';

-- ---------------------------------------------------------------------------
-- 2) A MESMA INVARIANTE no caminho de revisão
-- ---------------------------------------------------------------------------
/*
  `contract_measurement_rule_timeline_review` aceitava qualquer proposta sem
  olhar se a regra já tinha vínculo aceito. Com uma proposta por regra isso
  nunca deu problema; agora que existe caminho manual, duas rotas podem
  produzir dois aceitos para o mesmo marco — e a visão 179 escolheria um deles
  em silêncio, deixando a data prevista de faturamento dependendo de qual linha
  o planejador leu primeiro.
*/
CREATE OR REPLACE FUNCTION public.contract_measurement_rule_timeline_review(
  p_mapping_id uuid,
  p_decision   text,
  p_note       text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m   public.contract_measurement_rule_timeline_mappings%ROWTYPE;
  uid uuid := auth.uid();
  v_other record;
BEGIN
  IF p_decision NOT IN ('accepted', 'rejected') THEN
    RAISE EXCEPTION 'Decisão deve ser accepted ou rejected.' USING ERRCODE = 'check_violation';
  END IF;

  IF uid IS NULL THEN
    RAISE EXCEPTION 'Revisão de mapeamento exige usuário autenticado.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (public.current_user_has_permission('contracts.edit') OR public.current_user_is_admin()) THEN
    RAISE EXCEPTION 'Sem permissão para revisar mapeamento de cronograma.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO m FROM public.contract_measurement_rule_timeline_mappings
   WHERE id = p_mapping_id
     AND organization_id = public.current_user_organization_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mapeamento % não existe nesta organização.', p_mapping_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF m.review_state <> 'proposed' THEN
    RAISE EXCEPTION 'Mapeamento já revisado (%). Decisão anterior não é sobrescrita aqui.',
      m.review_state USING ERRCODE = 'check_violation';
  END IF;

  IF p_decision = 'accepted' THEN
    SELECT o.id, t.title, t.wbs_code INTO v_other
      FROM public.contract_measurement_rule_timeline_mappings o
      JOIN public.project_timeline_items t ON t.id = o.timeline_item_id
     WHERE o.organization_id = m.organization_id
       AND o.rule_id = m.rule_id
       AND o.project_id = m.project_id
       AND o.review_state = 'accepted'
       AND o.id <> m.id
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Este marco já está vinculado à etapa % (%). Um marco tem um vínculo por projeto.',
        COALESCE(v_other.wbs_code, '—'), v_other.title USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  UPDATE public.contract_measurement_rule_timeline_mappings
     SET review_state = p_decision,
         reviewed_by  = uid,
         reviewed_at  = now(),
         note         = COALESCE(p_note, note)
   WHERE id = p_mapping_id;

  -- Aceitar uma proposta também encerra as concorrentes: é a mesma escolha,
  -- feita pelo outro botão.
  IF p_decision = 'accepted' THEN
    UPDATE public.contract_measurement_rule_timeline_mappings
       SET review_state = 'rejected',
           reviewed_by  = uid,
           reviewed_at  = now(),
           note         = COALESCE(note || ' · ', '')
                          || 'Descartada: outra etapa foi aceita para este marco.'
     WHERE organization_id = m.organization_id
       AND rule_id = m.rule_id
       AND project_id = m.project_id
       AND review_state = 'proposed'
       AND id <> m.id;
  END IF;

  RETURN p_mapping_id;
END $$;

REVOKE ALL ON FUNCTION public.contract_measurement_rule_timeline_review(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_measurement_rule_timeline_review(uuid, text, text)
  TO authenticated;

COMMIT;
