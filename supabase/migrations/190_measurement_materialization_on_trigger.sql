-- ============================================================================
-- 190 — A MEDIÇÃO NASCE QUANDO O GATILHO OCORRE
--
-- ─── O defeito ────────────────────────────────────────────────────────────
--
-- `project_measurements_materialize` (134) é o ÚNICO escritor de
-- `project_measurements`, e ele tem três dependências que, juntas, produzem
-- silêncio permanente para uma classe inteira de contrato:
--
--   1. só roda por `apex_jobs` — está REVOKEd de `authenticated`;
--   2. pula cadência `UNKNOWN` e `ON_EVENT`, porque
--      `project_measurement_occurrence_key` devolve NULL para as duas;
--   3. ancora o período em `planned_start`, isto é, no CALENDÁRIO.
--
-- As seis regras de JA10182283/2025 têm `cadence = 'UNKNOWN'`. Não é lacuna de
-- cadastro: o contrato não paga por mês nem por trimestre, paga POR EVENTO —
-- "na assinatura", "no transporte", "na entrega do relatório final". Para
-- esse contrato, nenhuma execução do cron, em nenhum dia, jamais criaria uma
-- medição. Cinco das seis etapas mapeadas já estão concluídas no cronograma e
-- `project_measurements` tinha ZERO linhas.
--
-- ─── A correção, e onde ela mora ──────────────────────────────────────────
--
-- A medição por evento não nasce de um calendário: nasce do GATILHO. E o
-- gatilho contratual deste modelo já tem um fato que o evidencia — a etapa de
-- cronograma GOVERNADA ter terminado. Então a materialização desce para onde
-- esse fato acontece: um gatilho em `project_timeline_items`, na mesma
-- transação em que a etapa é dada por concluída.
--
--   PONTE ACEITA          → item de trabalho existe (derivação, sem escrita)
--   ETAPA CONCLUÍDA       → instância canônica materializa, em PLANNED
--   O RESTO DA CADEIA     → continua sendo ato humano governado
--
-- ─── O que esta migration NÃO faz ─────────────────────────────────────────
--
--   · Não cria segunda tabela de medição. Escreve em `project_measurements`,
--     com a mesma chave de ocorrência e o mesmo índice de unicidade da 130.
--   · Não marca medido, aceito nem elegível. A instância nasce `PLANNED`, e
--     `status` não é parâmetro de nenhuma função abaixo.
--   · Não cria evidência, aceite, evento de faturamento ou recebível.
--   · Não substitui a 134. Cadência MONTHLY/QUARTERLY/ONCE continua sendo
--     dela — ali o calendário É a verdade, e antecipar por conclusão de etapa
--     criaria a medição de novembro em outubro.
--   · Não materializa porque alguém abriu uma tela. Nenhuma função abaixo é
--     chamada por leitura; a RPC humana exige permissão e ato explícito.
--
-- ─── Idempotência ─────────────────────────────────────────────────────────
--
-- A chave de ocorrência é DERIVADA da identidade canônica (regra + marco), e
-- não do instante da execução. Reimportar o cronograma, reabrir e reconcluir
-- a etapa, rodar o backfill duas vezes: `ON CONFLICT DO NOTHING` sobre
-- `pm_occurrence_unique` devolve a mesma linha. Nunca uma segunda.
--
-- E a chave é a MESMA que a 134 usaria se a cadência fosse `MILESTONE` —
-- `'milestone:<uuid>'`. Isso é deliberado: no dia em que alguém corrigir a
-- cadência da regra de `UNKNOWN` para `MILESTONE`, o cron encontrará a linha
-- que o gatilho já criou, em vez de criar uma segunda para o mesmo marco.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) A CHAVE DE OCORRÊNCIA DO GATILHO
-- ---------------------------------------------------------------------------
/*
  Delega primeiro à função da 134 — quem tem cadência de calendário continua
  com a chave de calendário, sem exceção e sem um segundo dono da regra.

  Só quando ela devolve NULL (`UNKNOWN`/`ON_EVENT`) é que esta função responde,
  e responde com IDENTIDADE, não com data: o marco contratual, ou, na falta
  dele, a etapa governada. Nada aqui adivinha ocorrência de calendário — a §15
  continua valendo, e é justamente por obedecê-la que a chave é identitária.
*/
CREATE OR REPLACE FUNCTION public.project_measurement_trigger_occurrence_key(
  p_cadence          text,
  p_period_start     date,
  p_milestone_id     uuid,
  p_timeline_item_id uuid
) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(
    public.project_measurement_occurrence_key(p_cadence, p_period_start, p_milestone_id),
    CASE
      WHEN p_milestone_id     IS NOT NULL THEN 'milestone:' || p_milestone_id::text
      WHEN p_timeline_item_id IS NOT NULL THEN 'timeline:'  || p_timeline_item_id::text
      ELSE NULL
    END)
$$;

COMMENT ON FUNCTION public.project_measurement_trigger_occurrence_key(text, date, uuid, uuid) IS
  'A chave de ocorrência para medição ACIONADA POR EVENTO. Delega à chave de '
  'cadência da 134 e só responde quando ela é NULL. Devolve a MESMA string que '
  'a cadência MILESTONE produziria, para que corrigir a cadência de uma regra '
  'não crie uma segunda medição para o mesmo marco.';

-- ---------------------------------------------------------------------------
-- 2) A MATERIALIZAÇÃO — um ponto de escrita, idempotente
-- ---------------------------------------------------------------------------
/*
  ─── Fronteira de inquilino ──────────────────────────────────────────────

  `SECURITY DEFINER` porque `authenticated` não tem — e não deve ter — INSERT
  em `project_measurements`: houvesse escrita direta, a máquina de estados, a
  proveniência e a prontidão virariam opcionais.

  A organização NUNCA vem por parâmetro. Ela é lida da própria etapa de
  cronograma, e o mapeamento, a regra e o contrato são casados contra ELA em
  todos os JOINs. Um chamador que passasse o id de etapa de outro inquilino
  materializaria dentro do inquilino daquela etapa — que é onde a linha
  pertence —, e não dentro do seu.

  ─── O que é exigido antes de criar ──────────────────────────────────────

    · ponte ACEITA por revisor humano (`..._governed`, review_state=accepted);
    · regra viva (`effect <> 'removed'`) e vigente na data do gatilho;
    · etapa viva (não apagada) e CONCLUÍDA.

  Faltando qualquer uma, a função não cria nada e não levanta erro: ausência
  de gatilho não é falha, é o estado normal da maioria das etapas.
*/
CREATE OR REPLACE FUNCTION public.project_measurement_materialize_for_timeline_item(
  p_timeline_item_id uuid,
  p_origin           text DEFAULT 'event'
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  item    public.project_timeline_items%ROWTYPE;
  cand    record;
  m       public.project_measurements%ROWTYPE;
  okey    text;
  trigger_date date;
  new_id  uuid;
  created integer := 0;
BEGIN
  IF p_origin NOT IN ('event', 'manual') THEN
    RAISE EXCEPTION 'ORIGIN_INVALID: origem % não é reconhecida.', p_origin
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO item FROM public.project_timeline_items WHERE id = p_timeline_item_id;
  IF NOT FOUND OR item.deleted_at IS NOT NULL THEN RETURN 0; END IF;

  -- O GATILHO. `actual_finish` é o fato; `completed` é a afirmação de quem
  -- atualizou a linha. Percentual de avanço continua de fora — 100% é
  -- estimativa, e promovê-la a conclusão é o que faria avanço de obra virar
  -- direito de faturar.
  IF item.actual_finish IS NULL AND item.status IS DISTINCT FROM 'completed' THEN
    RETURN 0;
  END IF;
  trigger_date := COALESCE(item.actual_finish, item.forecast_finish, item.planned_finish, current_date);

  FOR cand IN
    SELECT r.id AS rule_id, r.contract_id, r.cadence, r.measurement_basis,
           r.accumulation_mode, r.effective_from, r.effective_until,
           r.milestone_id, r.title
      FROM public.contract_measurement_rule_timeline_governed g
      JOIN public.contract_measurement_requirements r
        ON r.organization_id = g.organization_id AND r.id = g.rule_id
     WHERE g.organization_id = item.organization_id
       AND g.timeline_item_id = item.id
       AND g.project_id = item.project_id
       AND r.effect <> 'removed'
       AND (r.effective_from  IS NULL OR r.effective_from  <= trigger_date)
       AND (r.effective_until IS NULL OR r.effective_until >  trigger_date)
     ORDER BY r.created_at, r.id
  LOOP
    okey := public.project_measurement_trigger_occurrence_key(
      cand.cadence,
      COALESCE(item.planned_start, item.planned_finish, trigger_date),
      cand.milestone_id,
      item.id);

    -- Sem chave determinística não se cria nada. É a §15 fechando a porta:
    -- regra sem marco e sem etapa não tem ocorrência que se possa nomear.
    CONTINUE WHEN okey IS NULL;

    INSERT INTO public.project_measurements
      (organization_id, project_id, contract_id, contract_measurement_rule_id,
       timeline_item_id, milestone_id, occurrence_key, occurrence_state,
       measurement_period_start, measurement_period_end, expected_at,
       rule_effective_from, rule_effective_until,
       rule_snapshot, measurement_basis, accumulation_mode, status, origin)
    VALUES
      (item.organization_id, item.project_id, cand.contract_id, cand.rule_id,
       item.id, cand.milestone_id, okey, 'resolved',
       COALESCE(item.planned_start, item.planned_finish), trigger_date, trigger_date,
       cand.effective_from, cand.effective_until,
       jsonb_build_object(
         'title', cand.title, 'cadence', cand.cadence,
         'measurement_basis', cand.measurement_basis,
         'accumulation_mode', cand.accumulation_mode,
         'materialized_by', 'schedule_trigger',
         'trigger_timeline_item_id', item.id,
         'trigger_date', trigger_date),
       cand.measurement_basis, cand.accumulation_mode,
       -- PLANNED. Sempre. `status` não é parâmetro desta função, e não passa
       -- a ser: a instância nasce como trabalho a fazer, nunca como trabalho
       -- feito, medido ou aceito.
       'PLANNED', p_origin)
    ON CONFLICT DO NOTHING
    RETURNING id INTO new_id;

    IF new_id IS NOT NULL THEN
      created := created + 1;
      PERFORM public.project_measurement_resolve_requirements(new_id);
      SELECT * INTO m FROM public.project_measurements WHERE id = new_id;
      -- O fato do nascimento sai na MESMA transação da criação (§43).
      PERFORM public.project_measurement_emit(
        m, 'projects.measurement.created',
        jsonb_build_object(
          'expected_at', m.expected_at, 'origin', p_origin,
          'trigger_timeline_item_id', item.id, 'trigger_date', trigger_date),
        NULL,
        CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'human' END);
      PERFORM public.project_measurement_recompute_readiness(new_id);
      new_id := NULL;
    END IF;
  END LOOP;

  RETURN created;
END $$;

REVOKE ALL ON FUNCTION public.project_measurement_materialize_for_timeline_item(uuid, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.project_measurement_materialize_for_timeline_item(uuid, text) IS
  'Materializa a medição canônica quando a etapa GOVERNADA de cronograma é '
  'concluída. Idempotente pela chave de ocorrência. Nasce sempre PLANNED — '
  'nunca medida, aceita ou elegível. Não é chamável do navegador.';

-- ---------------------------------------------------------------------------
-- 3) O GATILHO — na transação em que o cronograma afirma a conclusão
-- ---------------------------------------------------------------------------
/*
  AFTER, e não BEFORE: a linha precisa existir com o valor novo antes de
  servir de âncora à medição.

  A condição do `WHEN` evita trabalho repetido em toda atualização de etapa —
  só passa a transição PARA concluída. A idempotência não depende disso (o
  índice único resolve), mas um cronograma de 69 linhas sendo salvo em lote
  não precisa varrer mapeamentos 69 vezes.

  Falha aqui derruba a atualização da etapa — e é o que se quer: materializar
  na mesma transação é o que impede a etapa ficar concluída sem a medição que
  ela deveria ter criado. Silenciar a exceção produziria exatamente o estado
  que esta migration existe para eliminar.
*/
CREATE OR REPLACE FUNCTION public.project_timeline_items_materialize_measurement()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  PERFORM public.project_measurement_materialize_for_timeline_item(NEW.id, 'event');
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.project_timeline_items_materialize_measurement()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_timeline_materialize_measurement_insert
  ON public.project_timeline_items;
CREATE TRIGGER trg_timeline_materialize_measurement_insert
  AFTER INSERT ON public.project_timeline_items
  FOR EACH ROW
  WHEN (NEW.actual_finish IS NOT NULL OR NEW.status = 'completed')
  EXECUTE FUNCTION public.project_timeline_items_materialize_measurement();

DROP TRIGGER IF EXISTS trg_timeline_materialize_measurement_update
  ON public.project_timeline_items;
CREATE TRIGGER trg_timeline_materialize_measurement_update
  AFTER UPDATE OF status, actual_finish ON public.project_timeline_items
  FOR EACH ROW
  WHEN ((NEW.actual_finish IS NOT NULL OR NEW.status = 'completed')
        AND (OLD.actual_finish IS NULL AND OLD.status IS DISTINCT FROM 'completed'))
  EXECUTE FUNCTION public.project_timeline_items_materialize_measurement();

-- ---------------------------------------------------------------------------
-- 4) A VÁLVULA HUMANA — quando o gatilho ocorreu no mundo, não no cronograma
-- ---------------------------------------------------------------------------
/*
  O cronograma é o melhor sinal disponível, e não é o único mundo. O
  equipamento pode ter sido transportado numa sexta e a etapa só ser fechada
  na segunda; a operação precisa começar a reunir evidência antes disso.

  Esta RPC existe para esse caso, e o que ela NÃO faz é o que a torna segura:
  não marca a etapa como concluída, não mede, não aceita, não fatura. Cria a
  mesma instância PLANNED que o gatilho criaria, pela mesma chave — de modo
  que quando a etapa for concluída depois, o gatilho encontra esta linha em
  vez de criar outra.

  Exige PESSOA (`auth.uid()`) e `projects.measurements.edit`. Não é atalho:
  quem não poderia preparar uma medição não a faz nascer por aqui.
*/
CREATE OR REPLACE FUNCTION public.project_measurement_ensure_for_milestone(
  p_milestone_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor uuid := auth.uid();
  g     record;
  found uuid;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: a criação manual de medição exige uma pessoa autenticada.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT (public.current_user_has_permission('projects.measurements.edit')
          OR public.current_user_is_admin()) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: falta a permissão projects.measurements.edit.'
      USING ERRCODE = '42501';
  END IF;

  -- A ponte ACEITA é a condição de existência. Sem ela não há etapa, não há
  -- data e não há o que medir — e a resposta é a mesma de "marco inexistente",
  -- porque duas mensagens diferentes contariam se aquele UUID existe alhures.
  SELECT g2.timeline_item_id, g2.organization_id
    INTO g
    FROM public.contract_measurement_rule_timeline_governed g2
    JOIN public.contract_measurement_requirements r
      ON r.organization_id = g2.organization_id AND r.id = g2.rule_id
   WHERE r.milestone_id = p_milestone_id
     AND r.effect <> 'removed'
     AND g2.organization_id = public.current_user_organization_id()
   ORDER BY g2.reviewed_at DESC NULLS LAST
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MAPPING_NOT_GOVERNED: este marco não tem etapa de cronograma aceita.'
      USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM public.project_measurement_materialize_for_timeline_item(g.timeline_item_id, 'manual');

  SELECT pm.id INTO found
    FROM public.project_measurements pm
   WHERE pm.organization_id = g.organization_id
     AND pm.milestone_id = p_milestone_id
     AND pm.status NOT IN ('SUPERSEDED','CANCELLED')
   ORDER BY pm.created_at DESC
   LIMIT 1;

  RETURN found;
END $$;

REVOKE ALL ON FUNCTION public.project_measurement_ensure_for_milestone(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_measurement_ensure_for_milestone(uuid) TO authenticated;

COMMENT ON FUNCTION public.project_measurement_ensure_for_milestone(uuid) IS
  'Cria a instância PLANNED do marco quando o gatilho ocorreu no mundo antes '
  'de o cronograma registrá-lo. Exige pessoa autenticada e '
  'projects.measurements.edit. Não conclui etapa, não mede, não aceita e não '
  'fatura. Mesma chave de ocorrência do gatilho — nunca uma segunda linha.';

-- ---------------------------------------------------------------------------
-- 5) O PASSIVO — gatilhos que já ocorreram antes desta migration
-- ---------------------------------------------------------------------------
/*
  Toda etapa governada já concluída é um gatilho que ocorreu enquanto não
  havia quem o escutasse. Esta função reproduz o que o gatilho teria feito.

  Ela NÃO roda sozinha. A migration não a chama: criar medição é fato de
  negócio, e um `SELECT` escondido no fim de um arquivo de DDL não é o lugar
  de decidir isso. Quem roda é o script de aplicação, explicitamente.
*/
CREATE OR REPLACE FUNCTION public.project_measurements_backfill_from_schedule(
  p_organization_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  it record;
  created integer := 0;
  visited integer := 0;
BEGIN
  FOR it IN
    SELECT DISTINCT i.id
      FROM public.contract_measurement_rule_timeline_mappings g
      JOIN public.project_timeline_items i
        ON i.organization_id = g.organization_id AND i.id = g.timeline_item_id
     WHERE g.review_state = 'accepted'
       AND i.deleted_at IS NULL
       AND (i.actual_finish IS NOT NULL OR i.status = 'completed')
       AND (p_organization_id IS NULL OR g.organization_id = p_organization_id)
     ORDER BY i.id
  LOOP
    visited := visited + 1;
    created := created + public.project_measurement_materialize_for_timeline_item(it.id, 'event');
  END LOOP;

  RETURN jsonb_build_object('timeline_items_visited', visited, 'measurements_created', created);
END $$;

REVOKE ALL ON FUNCTION public.project_measurements_backfill_from_schedule(uuid)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.project_measurements_backfill_from_schedule(uuid) IS
  'Reproduz os gatilhos de cronograma que ocorreram antes da 190. Idempotente. '
  'Não é chamada pela migration nem pelo navegador.';

COMMIT;
