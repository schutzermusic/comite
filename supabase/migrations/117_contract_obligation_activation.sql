-- ============================================================
-- CONTRACTS V2 — FASE 3 (correção): ativação derivada da regra
-- Migration: 117_contract_obligation_activation
--
-- ─── O defeito que esta migration corrige ──────────────────────────────────
--
-- A materialização da 115 criava toda ocorrência com `activation_state =
-- 'unknown'` e `state = 'NOT_ACTIVATED'`, e nada mais no sistema as tirava
-- dali. O efeito era silencioso e grave: uma obrigação mensal com vigência,
-- regra de prazo e recorrência conhecidas — tudo determinístico — resolvia para
-- urgência DESCONHECIDA e bloqueio DESCONHECIDO, para sempre. O modelo sabia
-- responder "quando vence" e mesmo assim respondia "não sei".
--
-- ─── A distinção que faltava ───────────────────────────────────────────────
--
-- Há duas ativações diferentes, e tratá-las igual foi o erro:
--
--   · a que a REGRA determina — início do contrato, N dias após o início,
--     N dias antes do fim, data fixa. A data é calculável no momento em que a
--     ocorrência nasce, e chamá-la de desconhecida é jogar fora informação que
--     o contrato deu.
--
--   · a que depende de um FATO EXTERNO — ativação manual, ou um evento
--     contratual ("na primeira medição aprovada"). Essa continua DESCONHECIDA
--     até alguém observar o fato. Evento não observado não ativa nada, e a
--     Fase 3 não consome barramento de evento — isso é Fase 4.
--
-- Então: quando a regra determina, gravamos `activated_at` e a ocorrência nasce
-- OPEN. Quando não determina, ela nasce NOT_ACTIVATED com `activated_at` nulo, e
-- é o resolvedor que reporta UNKNOWN.
--
-- `activated_at` é a DATA em que a ativação ocorre, não um carimbo de "já
-- ocorreu": comparar essa data com o `asOf` da pergunta é trabalho do
-- resolvedor. É o que mantém a resposta correta para qualquer data — passada ou
-- futura — sem nenhum agendador mantendo colunas atualizadas.
--
-- A 115 não é editada: migration aplicada é registro histórico. Esta substitui
-- a função, e uma base nova roda as duas na ordem.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.contract_obligations_materialize(
  p_definition_id uuid,
  p_through       date,
  p_organization_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d          public.contract_obligation_definitions%ROWTYPE;
  contract   public.contracts%ROWTYPE;
  anchor     date;
  horizon    date;
  cursor_date date;
  step       interval;
  created    integer := 0;
  key        text;
  due        date;
  confidence text;
  activation date;
  act_state  text;
  life_state text;
  guard      integer := 0;
BEGIN
  SELECT * INTO d FROM public.contract_obligation_definitions WHERE id = p_definition_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Definição de obrigação % não existe.', p_definition_id USING ERRCODE = 'no_data_found';
  END IF;
  IF p_organization_id IS NOT NULL AND p_organization_id <> d.organization_id THEN
    RAISE EXCEPTION 'Definição de obrigação não pertence à organização informada.' USING ERRCODE = 'check_violation';
  END IF;
  IF d.status = 'removed' THEN RETURN 0; END IF;

  SELECT * INTO contract FROM public.contracts WHERE id = d.contract_id;

  anchor := COALESCE(d.effective_from, d.activation_fixed_date, contract.start_date);
  IF anchor IS NULL THEN
    IF d.recurrence_kind <> 'one_time' THEN RETURN 0; END IF;
    key := 'single';
    IF NOT EXISTS (SELECT 1 FROM public.contract_obligation_instances
                    WHERE definition_id = d.id AND occurrence_key = key) THEN
      INSERT INTO public.contract_obligation_instances
        (organization_id, definition_id, contract_id, occurrence_key, sequence,
         due_date, due_confidence, due_basis, activation_state, state)
      VALUES (d.organization_id, d.id, d.contract_id, key, 1,
              NULL, 'unknown', 'âncora de vigência desconhecida', 'unknown', 'NOT_ACTIVATED');
      created := 1;
    END IF;
    RETURN created;
  END IF;

  horizon := LEAST(
    p_through,
    COALESCE(d.recurrence_until, p_through),
    COALESCE(d.effective_to, p_through),
    COALESCE(contract.end_date, p_through)
  );
  IF horizon < anchor THEN RETURN 0; END IF;

  step := CASE d.recurrence_kind
    WHEN 'daily'     THEN interval '1 day'
    WHEN 'weekly'    THEN interval '1 week'
    WHEN 'monthly'   THEN interval '1 month'
    WHEN 'quarterly' THEN interval '3 months'
    WHEN 'yearly'    THEN interval '1 year'
    WHEN 'fixed_interval' THEN make_interval(days => d.recurrence_interval)
    ELSE NULL END;

  cursor_date := anchor;
  LOOP
    guard := guard + 1;
    EXIT WHEN guard > 2000;

    key := CASE d.recurrence_kind
      WHEN 'one_time'  THEN 'single'
      WHEN 'monthly'   THEN to_char(cursor_date, 'YYYY-MM')
      WHEN 'quarterly' THEN to_char(cursor_date, 'YYYY') || '-Q' || to_char(EXTRACT(quarter FROM cursor_date), 'FM9')
      WHEN 'yearly'    THEN to_char(cursor_date, 'YYYY')
      WHEN 'weekly'    THEN to_char(cursor_date, 'IYYY-"W"IW')
      ELSE to_char(cursor_date, 'YYYY-MM-DD') END;

    -- ---- ativação DETERMINADA PELA REGRA ----
    activation := CASE d.activation_kind
      WHEN 'contract_start'             THEN cursor_date
      WHEN 'days_after_contract_start'  THEN cursor_date + d.activation_offset_days
      WHEN 'days_before_contract_end'   THEN
        CASE WHEN contract.end_date IS NULL THEN NULL
             ELSE contract.end_date - d.activation_offset_days END
      WHEN 'fixed_date'                 THEN d.activation_fixed_date
      -- 'manual' e 'external_event': o fato ainda não foi observado.
      -- 'unspecified': o contrato não disse. Nos dois casos, desconhecido.
      ELSE NULL END;

    IF activation IS NULL THEN
      act_state := 'unknown';
      life_state := 'NOT_ACTIVATED';
    ELSE
      act_state := 'activated';
      -- A ocorrência EXISTE e está por cumprir. Se ela já venceu, se vence hoje
      -- ou se vence daqui a três meses é pergunta do resolvedor, respondida
      -- comparando o prazo com a data de referência.
      life_state := 'OPEN';
    END IF;

    -- ---- prazo ----
    IF d.calendar_basis = 'business_days' AND d.due_kind IN ('days_after_activation','days_before_contract_end') THEN
      due := NULL; confidence := 'unknown';
    ELSE
      due := CASE d.due_kind
        WHEN 'fixed_date'                THEN d.due_fixed_date
        WHEN 'same_day_as_activation'    THEN activation
        WHEN 'days_after_activation'     THEN
          CASE WHEN activation IS NULL THEN NULL ELSE activation + d.due_offset_days END
        WHEN 'days_before_contract_end'  THEN
          CASE WHEN contract.end_date IS NULL THEN NULL ELSE contract.end_date - d.due_offset_days END
        WHEN 'recurring'                 THEN activation
        ELSE NULL END;
      confidence := CASE WHEN due IS NULL THEN 'unknown' ELSE 'known' END;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.contract_obligation_instances
                    WHERE definition_id = d.id AND occurrence_key = key) THEN
      INSERT INTO public.contract_obligation_instances
        (organization_id, definition_id, contract_id, occurrence_key, sequence,
         period_start, period_end, activated_at, due_date, due_confidence, due_basis,
         activation_state, state)
      VALUES (d.organization_id, d.id, d.contract_id, key, guard,
              cursor_date,
              CASE WHEN step IS NULL THEN NULL ELSE (cursor_date + step - interval '1 day')::date END,
              activation, due, confidence,
              CASE WHEN confidence = 'unknown' AND d.calendar_basis = 'business_days'
                   THEN 'regra em dias úteis sem calendário oficial'
                   WHEN confidence = 'unknown' AND activation IS NULL
                   THEN 'ativação depende de fato ainda não observado'
                   WHEN confidence = 'unknown' THEN 'regra de prazo não especificada'
                   ELSE d.due_kind END,
              act_state, life_state);
      created := created + 1;
    END IF;

    EXIT WHEN step IS NULL;
    cursor_date := (cursor_date + step)::date;
    EXIT WHEN cursor_date > horizon;
  END LOOP;

  RETURN created;
END $$;

REVOKE ALL ON FUNCTION public.contract_obligations_materialize(uuid, date, uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.contract_obligations_materialize(uuid, date, uuid) IS
  'Idempotente: a chave de ocorrência é derivada do período. A ativação é '
  'DERIVADA da regra quando a regra a determina (início do contrato, N dias '
  'após/antes, data fixa) — nesse caso a ocorrência nasce OPEN com activated_at '
  'gravado. Ativação manual ou por evento externo nasce NOT_ACTIVATED e '
  'activated_at nulo: evento não observado não ativa nada. Comparar activated_at '
  'e due_date com a data da pergunta é trabalho do resolvedor, o que dispensa '
  'agendador para manter coluna alguma atualizada.';

COMMIT;
