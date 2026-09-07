-- ============================================================
-- PROJETOS — candidatos determinísticos, trabalho, valor medido e leitura
-- Migration: 134_project_measurement_candidates_and_legacy
--
-- ─── A regra que bloqueia merge ────────────────────────────────────────────
--
--   PRECEDÊNCIA DO VALOR MEDIDO
--     1. medição canônica ACEITA
--     2. contract_milestones.measured_amount (legado)
--     3. UNKNOWN
--
--   E NUNCA, em hipótese nenhuma:
--     → billing_amount
--
-- `billing_amount` é o valor PREVISTO no contrato. Somá-lo como se fosse
-- medição apresenta previsão como fato apurado, e é o defeito que a auditoria
-- desta fase encontrou vivo em `src/lib/contracts/trust/contract-to-cash.ts`
-- (`m.measured_amount ?? m.billing_amount`). A função abaixo existe para que a
-- regra tenha UM lugar, e para que o teste de regressão tenha o que apontar.
--
-- ─── Candidatos ────────────────────────────────────────────────────────────
--
-- A materialização cria medição PLANEJADA quando — e só quando — regra,
-- projeto, ocorrência e mapeamento de cronograma são todos determinísticos
-- (§45). Cadência `UNKNOWN` e `ON_EVENT` não geram nada: a §15 proíbe deduzir
-- a ocorrência pela data mais próxima, e um candidato inventado é pior que
-- candidato nenhum porque parece trabalho pendente de verdade.
--
-- Nenhum candidato nasce SUBMETIDO nem ACEITO. Nunca.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1) A chave de ocorrência determinística
-- ------------------------------------------------------------
/*
  A chave é derivada da CADÊNCIA declarada na regra, e só dela. Devolver NULL é
  a resposta correta e frequente: cadência desconhecida ou por evento não tem
  ocorrência de calendário, e forçar uma faria duas medições diferentes
  disputarem a mesma chave.

  Trimestre usa o trimestre CIVIL. Não há trimestre contratual declarado em
  lugar nenhum do modelo, e inventar um (por data de assinatura, por exemplo)
  seria a mesma classe de erro que a §15 nomeia.
*/
CREATE FUNCTION public.project_measurement_occurrence_key(
  p_cadence text,
  p_period_start date,
  p_milestone_id uuid DEFAULT NULL
) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE p_cadence
    WHEN 'MONTHLY'   THEN CASE WHEN p_period_start IS NULL THEN NULL ELSE to_char(p_period_start, 'YYYY-MM') END
    WHEN 'QUARTERLY' THEN CASE WHEN p_period_start IS NULL THEN NULL
                               ELSE to_char(p_period_start, 'YYYY') || '-Q' || to_char(p_period_start, 'Q') END
    WHEN 'ONCE'      THEN 'once'
    WHEN 'MILESTONE' THEN CASE WHEN p_milestone_id IS NULL THEN NULL ELSE 'milestone:' || p_milestone_id::text END
    ELSE NULL END
$$;

COMMENT ON FUNCTION public.project_measurement_occurrence_key(text, date, uuid) IS
  'NULL é resposta legítima: ON_EVENT e UNKNOWN não têm ocorrência de '
  'calendário, e a §15 proíbe adivinhá-la pela data mais próxima.';

-- ------------------------------------------------------------
-- 2) Materialização de candidatos — idempotente e limitada
-- ------------------------------------------------------------
CREATE FUNCTION public.project_measurements_materialize(
  p_organization_id uuid,
  p_as_of           date DEFAULT current_date,
  p_horizon_days    integer DEFAULT 180
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  cand record;
  created integer := 0;
  skipped_unresolved integer := 0;
  considered integer := 0;
  horizon date;
  okey text;
  pstart date; pend date;
  new_id uuid;
  m public.project_measurements%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'ORG_REQUIRED: materialização é por inquilino.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_horizon_days < 1 OR p_horizon_days > 730 THEN
    RAISE EXCEPTION 'HORIZON_OUT_OF_RANGE: horizonte fora do intervalo permitido.' USING ERRCODE = 'check_violation';
  END IF;
  horizon := p_as_of + p_horizon_days;

  /*
    O conjunto candidato é ESTREITO por desenho (§47, §87): regra vigente, de
    contrato ligado a projeto, com mapeamento de cronograma ACEITO. Uma
    varredura sobre todas as regras de todos os contratos seria a "varredura
    completa a cada dez minutos" que a §47 proíbe.
  */
  FOR cand IN
    SELECT r.id AS rule_id, r.contract_id, r.cadence, r.cadence_anchor_day,
           r.measurement_basis, r.accumulation_mode, r.effective_from, r.effective_until,
           r.milestone_id, r.title,
           g.project_id, g.timeline_item_id,
           i.planned_start, i.planned_finish
      FROM public.contract_measurement_requirements r
      JOIN public.contract_measurement_rule_timeline_governed g
        ON g.organization_id = r.organization_id AND g.rule_id = r.id
      JOIN public.project_timeline_items i
        ON i.organization_id = g.organization_id AND i.id = g.timeline_item_id
     WHERE r.organization_id = p_organization_id
       AND r.effect <> 'removed'
       AND (r.effective_from IS NULL OR r.effective_from <= horizon)
       AND (r.effective_until IS NULL OR r.effective_until > p_as_of)
       AND i.deleted_at IS NULL
     ORDER BY r.created_at, r.id
  LOOP
    considered := considered + 1;

    -- Cadência sem ocorrência de calendário não vira candidato. Não é falha:
    -- é a §15 sendo obedecida. Contabiliza-se para que a operação veja quantas
    -- regras estão esperando semântica declarada.
    IF cand.cadence IN ('UNKNOWN','ON_EVENT') THEN
      skipped_unresolved := skipped_unresolved + 1;
      CONTINUE;
    END IF;

    -- A âncora do período é a data PLANEJADA da etapa mapeada. É o único
    -- ancoradouro que o modelo oferece sem inventar: o cronograma responde
    -- "quando se espera" (§16), e é exatamente isso que a ocorrência precisa.
    pstart := COALESCE(cand.planned_start, cand.effective_from);
    IF pstart IS NULL THEN
      skipped_unresolved := skipped_unresolved + 1;
      CONTINUE;
    END IF;

    IF cand.cadence = 'MONTHLY' THEN
      pstart := date_trunc('month', pstart)::date;
      pend := (date_trunc('month', pstart) + interval '1 month - 1 day')::date;
    ELSIF cand.cadence = 'QUARTERLY' THEN
      pstart := date_trunc('quarter', pstart)::date;
      pend := (date_trunc('quarter', pstart) + interval '3 months - 1 day')::date;
    ELSE
      pend := COALESCE(cand.planned_finish, pstart);
    END IF;

    okey := public.project_measurement_occurrence_key(cand.cadence, pstart, cand.milestone_id);
    IF okey IS NULL THEN
      skipped_unresolved := skipped_unresolved + 1;
      CONTINUE;
    END IF;

    -- A idempotência mora no ÍNDICE (§46), não aqui. `ON CONFLICT DO NOTHING`
    -- é o que faz o trabalho repetido não duplicar mesmo quando duas execuções
    -- se cruzam — a verificação prévia sozinha tem janela de corrida.
    INSERT INTO public.project_measurements
      (organization_id, project_id, contract_id, contract_measurement_rule_id, timeline_item_id,
       milestone_id, occurrence_key, occurrence_state,
       measurement_period_start, measurement_period_end, expected_at,
       rule_effective_from, rule_effective_until,
       rule_snapshot, measurement_basis, accumulation_mode, status, origin)
    VALUES
      (p_organization_id, cand.project_id, cand.contract_id, cand.rule_id, cand.timeline_item_id,
       cand.milestone_id, okey, 'resolved',
       pstart, pend, COALESCE(cand.planned_finish, pend),
       cand.effective_from, cand.effective_until,
       jsonb_build_object('title', cand.title, 'cadence', cand.cadence,
                          'measurement_basis', cand.measurement_basis,
                          'accumulation_mode', cand.accumulation_mode,
                          'materialized_as_of', p_as_of),
       cand.measurement_basis, cand.accumulation_mode, 'PLANNED', 'candidate_materialization')
    ON CONFLICT DO NOTHING
    RETURNING id INTO new_id;

    IF new_id IS NOT NULL THEN
      created := created + 1;
      PERFORM public.project_measurement_resolve_requirements(new_id);
      SELECT * INTO m FROM public.project_measurements WHERE id = new_id;
      -- O fato do nascimento sai na MESMA transação da criação (§43).
      PERFORM public.project_measurement_emit(m, 'projects.measurement.created',
        jsonb_build_object('expected_at', m.expected_at, 'period_start', pstart, 'period_end', pend,
                           'origin', 'candidate_materialization'),
        NULL, 'cron');
      PERFORM public.project_measurement_recompute_readiness(new_id);
      new_id := NULL;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('organization_id', p_organization_id, 'as_of', p_as_of,
                            'considered', considered, 'created', created,
                            'occurrence_unresolved', skipped_unresolved);
END $$;
REVOKE ALL ON FUNCTION public.project_measurements_materialize(uuid, date, integer)
  FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 3) Trabalho agendado — LIMITADO, na fila que já existe
-- ------------------------------------------------------------
-- A §47 é explícita: não criar fila nova. Estes dois entram em `apex_jobs`.
CREATE FUNCTION public.projects_enqueue_measurement_reconciliation(
  p_as_of date DEFAULT current_date,
  p_horizon_days integer DEFAULT 180
) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE org record; n integer := 0;
BEGIN
  IF p_horizon_days < 1 OR p_horizon_days > 730 THEN
    RAISE EXCEPTION 'HORIZON_OUT_OF_RANGE' USING ERRCODE = 'check_violation';
  END IF;
  -- Só inquilino que TEM mapeamento governado entra. Enfileirar trabalho para
  -- organização sem nenhuma regra mapeada gastaria fila para não fazer nada.
  FOR org IN
    SELECT DISTINCT organization_id FROM public.contract_measurement_rule_timeline_mappings
     WHERE review_state = 'accepted'
  LOOP
    PERFORM public.apex_jobs_enqueue(
      org.organization_id, 'projects.measurements.reconcile_candidates',
      'projects-measurement-reconcile:' || org.organization_id::text || ':' || to_char(p_as_of, 'YYYY-MM-DD'),
      jsonb_build_object('as_of', p_as_of, 'horizon_days', p_horizon_days),
      1, now(), 5, NULL, NULL);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.projects_enqueue_measurement_reconciliation(date, integer)
  FROM PUBLIC, anon, authenticated;

/*
  Recomputo de prontidão INCREMENTAL. `p_changed_since` é o que impede a
  varredura da carteira inteira a cada tique (§87): só medição viva que mudou,
  ou cujo cache é mais velho que a mudança, entra.
*/
CREATE FUNCTION public.projects_recompute_measurement_readiness(
  p_organization_id uuid,
  p_changed_since   timestamptz DEFAULT NULL,
  p_limit           integer DEFAULT 200
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record; n integer := 0;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'ORG_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;
  -- A lição da 124: limite nulo ou absurdo não passa em silêncio.
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 2000 THEN
    RAISE EXCEPTION 'LIMIT_OUT_OF_RANGE: limite deve estar entre 1 e 2000.' USING ERRCODE = 'check_violation';
  END IF;

  FOR r IN
    SELECT m.id FROM public.project_measurements m
     LEFT JOIN public.project_measurement_readiness_cache c ON c.measurement_id = m.id
     WHERE m.organization_id = p_organization_id
       AND m.status NOT IN ('ACCEPTED','REJECTED','CANCELLED','SUPERSEDED')
       AND (p_changed_since IS NULL OR m.updated_at >= p_changed_since
            OR c.computed_at IS NULL OR c.computed_at < m.updated_at)
     ORDER BY m.updated_at
     LIMIT p_limit
  LOOP
    PERFORM public.project_measurement_recompute_readiness(r.id);
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('organization_id', p_organization_id, 'recomputed', n);
END $$;
REVOKE ALL ON FUNCTION public.projects_recompute_measurement_readiness(uuid, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4) PRECEDÊNCIA DO VALOR MEDIDO — o invariante permanente
-- ------------------------------------------------------------
/*
  Devolve o valor E a FONTE. A fonte não é enfeite: é ela que permite à tela
  dizer "R$ 455.000 apurado no legado" em vez de apresentar um número sem
  procedência como se fosse medição canônica.

  `billing_amount` não aparece nesta função — nem como último recurso, nem
  como valor de referência. Quando não há medição aceita nem valor legado, a
  resposta é UNKNOWN, e UNKNOWN é uma resposta melhor que um número errado.

  A agregação de várias medições aceitas segue `aggregation_mode` da regra
  (§71). `UNKNOWN` ali devolve UNKNOWN aqui: somar sem saber se as parcelas são
  incrementais ou cumulativas é como se conta a mesma medição duas vezes.
*/
CREATE FUNCTION public.contract_milestone_measured_amount(
  p_organization_id uuid,
  p_milestone_id    uuid
) RETURNS TABLE (amount numeric, currency text, source text, detail jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ms public.contract_milestones%ROWTYPE;
  n_accepted integer;
  modes text[];
  agg text;
  v numeric;
  cur text;
BEGIN
  SELECT * INTO ms FROM public.contract_milestones
   WHERE id = p_milestone_id AND organization_id = p_organization_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::numeric, NULL::text, 'UNKNOWN'::text,
                        jsonb_build_object('reason','MILESTONE_NOT_FOUND');
    RETURN;
  END IF;

  IF auth.uid() IS NOT NULL
     AND p_organization_id IS DISTINCT FROM public.current_user_organization_id() THEN
    RETURN QUERY SELECT NULL::numeric, NULL::text, 'UNKNOWN'::text,
                        jsonb_build_object('reason','MILESTONE_NOT_FOUND');
    RETURN;
  END IF;

  -- ---------- 1) medição canônica ACEITA ----------
  SELECT count(*)::int,
         array_agg(DISTINCT r.aggregation_mode),
         sum(m.accepted_value),
         max(m.accepted_currency)
    INTO n_accepted, modes, v, cur
    FROM public.project_measurements m
    JOIN public.contract_measurement_requirements r
      ON r.id = m.contract_measurement_rule_id AND r.organization_id = m.organization_id
   WHERE m.organization_id = p_organization_id
     AND m.milestone_id = p_milestone_id
     AND m.status = 'ACCEPTED';

  IF n_accepted > 0 THEN
    agg := CASE WHEN array_length(modes, 1) = 1 THEN modes[1] ELSE 'MIXED' END;

    IF agg = 'SUM_INCREMENTAL' THEN
      RETURN QUERY SELECT v, cur, 'canonical_accepted'::text,
        jsonb_build_object('accepted_count', n_accepted, 'aggregation', agg);
      RETURN;
    ELSIF agg IN ('LATEST_CUMULATIVE','FIXED_MILESTONE') THEN
      -- Cumulativo NÃO soma: o último aceite já traz o total. Somar aqui é o
      -- erro de contagem em dobro que a §14 nomeia.
      RETURN QUERY
        SELECT m.accepted_value, m.accepted_currency, 'canonical_accepted'::text,
               jsonb_build_object('accepted_count', n_accepted, 'aggregation', agg)
          FROM public.project_measurements m
         WHERE m.organization_id = p_organization_id AND m.milestone_id = p_milestone_id
           AND m.status = 'ACCEPTED'
         ORDER BY m.accepted_at DESC LIMIT 1;
      RETURN;
    ELSE
      -- PERCENTAGE, UNKNOWN ou MIXED: existe medição aceita, mas o valor
      -- agregado não é afirmável. Dizer isso é mais útil que somar às cegas.
      RETURN QUERY SELECT NULL::numeric, cur, 'UNKNOWN'::text,
        jsonb_build_object('reason','AGGREGATION_SEMANTICS_UNKNOWN',
                           'accepted_count', n_accepted, 'aggregation', agg);
      RETURN;
    END IF;
  END IF;

  -- ---------- 2) legado ----------
  IF ms.measured_amount IS NOT NULL THEN
    RETURN QUERY SELECT ms.measured_amount, NULL::text, 'legacy_measured_amount'::text,
      jsonb_build_object('milestone_status', ms.status);
    RETURN;
  END IF;

  -- ---------- 3) UNKNOWN ----------
  -- E aqui termina. `billing_amount` existe na linha e continua NÃO SENDO
  -- medição: ele é o previsto, e previsto não é apurado (§12, §68).
  RETURN QUERY SELECT NULL::numeric, NULL::text, 'UNKNOWN'::text,
    jsonb_build_object('reason','NO_MEASUREMENT',
                       'billing_amount_present', ms.billing_amount IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.contract_milestone_measured_amount(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_milestone_measured_amount(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.contract_milestone_measured_amount(uuid, uuid) IS
  'PRECEDÊNCIA DO VALOR MEDIDO (§12, §68): medição canônica aceita → '
  'measured_amount legado → UNKNOWN. billing_amount NUNCA entra — nem como '
  'último recurso. Regra que bloqueia merge, com regressão permanente.';

-- ------------------------------------------------------------
-- 5) Modelo de leitura canônico
-- ------------------------------------------------------------
-- Um só (§84), consumido por Projetos e por Contratos. A regra de negócio não
-- se repete na tela — duas telas com a mesma regra copiada divergem.
CREATE VIEW public.project_measurement_read_model
WITH (security_invoker = true) AS
  SELECT
    m.id, m.organization_id, m.project_id, m.contract_id,
    m.contract_measurement_rule_id, m.timeline_item_id, m.milestone_id,
    m.occurrence_key, m.occurrence_state,
    m.measurement_period_start, m.measurement_period_end, m.expected_at,
    m.status, m.revision, m.supersedes_id, m.superseded_by_id,
    m.measurement_basis, m.accumulation_mode,
    m.quantity, m.unit, m.measured_value, m.currency,
    m.accepted_quantity, m.accepted_value, m.accepted_currency,
    m.acceptance_source, m.accepted_at, m.submitted_at, m.rejected_at, m.returned_at,
    m.origin, m.created_at, m.updated_at,

    r.title            AS rule_title,
    r.effective_from   AS rule_effective_from,
    r.effective_until  AS rule_effective_until,
    r.cadence          AS rule_cadence,
    r.aggregation_mode AS rule_aggregation_mode,
    r.source_clause_id, r.source_document_id, r.source_reference, r.source_page,

    i.title            AS timeline_title,
    i.planned_start    AS timeline_planned_start,
    i.planned_finish   AS timeline_planned_finish,
    i.percent_complete AS timeline_percent_complete,

    c.overall          AS readiness_overall,
    c.dimensions       AS readiness_dimensions,
    c.reasons          AS readiness_reasons,
    c.computed_at      AS readiness_computed_at,

    (SELECT count(*)::int FROM public.project_measurement_evidence e
      WHERE e.measurement_id = m.id AND e.revoked_at IS NULL) AS evidence_count,
    (SELECT count(*)::int FROM public.project_measurement_requirements q
      WHERE q.measurement_id = m.id AND q.required AND q.satisfaction_state = 'MISSING') AS missing_requirement_count
  FROM public.project_measurements m
  LEFT JOIN public.contract_measurement_requirements r
    ON r.id = m.contract_measurement_rule_id AND r.organization_id = m.organization_id
  LEFT JOIN public.project_timeline_items i
    ON i.id = m.timeline_item_id AND i.organization_id = m.organization_id
  LEFT JOIN public.project_measurement_readiness_cache c
    ON c.measurement_id = m.id;

GRANT SELECT ON public.project_measurement_read_model TO authenticated;
REVOKE ALL ON public.project_measurement_read_model FROM anon;

COMMENT ON VIEW public.project_measurement_read_model IS
  'Modelo de leitura CANÔNICO (§84). `readiness_*` vem do CACHE e carrega '
  '`readiness_computed_at` para que uma leitura velha seja reconhecível.';

-- ------------------------------------------------------------
-- 6) Motor de Aprovação — MECANISMO, sem REGRA inventada
-- ------------------------------------------------------------
/*
  A §33 e a §100 mandam o mesmo que a Fase 5 concluiu para Contratos: sem
  política de aceite autoritativa REAL, registra-se o sujeito e para-se aí.

  A auditoria da Fase 6 encontrou, no banco de produção:
    · ZERO linha em `contract_measurement_requirements`;
    · ZERO medição de projeto (a tabela nasce nesta fase);
    · ZERO política de aprovação, de qualquer propósito, em qualquer inquilino;
    · nenhuma alçada, quórum ou aprovador nomeado para ACEITE em lugar nenhum
      do repositório.

  Então o que entra aqui é a capacidade de o motor LER uma medição — com
  impressão digital da REVISÃO EXATA, como a §64 exige — e nada mais.
  `approval_engine_cutover` continua sem linha para medição, e o aceite segue
  pela RPC da 133. Semear "o cliente aprova acima de R$ X" seria inventar
  governança, e alçada inventada é indistinguível de alçada real depois que
  alguém decide por cima dela.
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
BEGIN
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
      -- A REVISÃO EXATA (§64). Mudar a quantidade muda a impressão, e uma
      -- aprovação presa à impressão antiga deixa de valer — que é o ponto.
      public.project_measurement_fingerprint(pm.id),
      pm.measured_value,
      CASE WHEN pm.currency ~ '^[A-Z]{3}$' THEN pm.currency END,
      format('Medição %s rev. %s — %s', pm.occurrence_key, pm.revision,
             COALESCE(c.contract_number, c.title, 'contrato')),
      pm.created_by,
      'projects'::text, c.contract_type, c.risk_level, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, false, NULL::text, NULL::numeric, NULL::text, NULL::text,
                      NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
END $$;
REVOKE ALL ON FUNCTION public.approval_subject_resolve(uuid, text, uuid) FROM PUBLIC;

COMMIT;
