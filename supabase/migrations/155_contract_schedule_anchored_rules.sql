-- ============================================================================
-- CONTRACTS — Operacionalização (2/3): regra ancorada em AGENDA
-- Migration: 155_contract_schedule_anchored_rules
--
-- ─── O buraco que esta migration fecha ─────────────────────────────────────
--
-- "Os documentos devem ser entregues 5 dias úteis ANTES da medição."
--
-- A regra é perfeitamente conhecida no dia em que o contrato entra. A DATA não
-- é — ela depende de uma medição que Projetos ainda não agendou. O modelo da
-- fase 3 só sabia duas respostas para isso: inventar uma data a partir do
-- início do contrato (errada, com cara de certa) ou devolver UNKNOWN para
-- sempre (verdadeira e inútil, porque quando a medição FOR agendada nada
-- recalcula nada).
--
-- Falta um terceiro estado, que é o correto:
--
--     regra conhecida · âncora conhecida · data AGUARDANDO A AGENDA
--
-- `date_state = 'AWAITING_SCHEDULE_ANCHOR'`. Quando Projetos agenda a medição,
-- `contract_obligations_apply_schedule_anchor()` calcula o prazo real,
-- materializa a exigência e ativa a ocorrência. O usuário não recria à mão uma
-- obrigação que o Apex já entendeu.
--
-- ─── A fronteira que NÃO se move ───────────────────────────────────────────
--
-- Contratos continua dono da REGRA; Projetos continua dono do QUANDO. Esta
-- migration não cria instância de medição, não escreve em project_measurements
-- e não adivinha agenda: ela LÊ `expected_at` da medição que Projetos agendou.
--
-- ─── Dia útil continua sendo dia útil ──────────────────────────────────────
--
-- A 115 recusa contar dia útil como dia corrido, e com razão: erra o prazo e
-- parece certo. Em vez de afrouxar a regra, esta migration dá à organização um
-- CALENDÁRIO declarado. Sem calendário declarado, uma regra em dias úteis
-- resolve para data DESCONHECIDA — exatamente como antes. Com calendário, ela
-- resolve para a data certa.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Calendário de dias úteis da organização
-- ---------------------------------------------------------------------------
-- Declarar o calendário é um ato explícito. A tabela de declaração existe
-- separada dos feriados porque uma organização SEM feriado cadastrado e uma
-- organização que nunca declarou calendário são coisas diferentes: a primeira
-- diz "só sábado e domingo"; a segunda não disse nada.
CREATE TABLE IF NOT EXISTS public.organization_business_calendars (
  organization_id  uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  declared_at      timestamptz NOT NULL DEFAULT now(),
  declared_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Dias da semana considerados úteis. ISO: 1=segunda … 7=domingo.
  business_weekdays smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::smallint[],
  note             text,
  CONSTRAINT obc_weekdays_valid CHECK (
    business_weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]
    AND array_length(business_weekdays, 1) BETWEEN 1 AND 7)
);

CREATE TABLE IF NOT EXISTS public.organization_non_business_days (
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  day              date NOT NULL,
  label            text,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, day)
);

COMMENT ON TABLE public.organization_business_calendars IS
  'DECLARAÇÃO de calendário útil da organização. A ausência de linha é a '
  'ausência de calendário — e regra contratual em dias úteis sem calendário '
  'declarado continua resolvendo para data DESCONHECIDA, nunca para uma '
  'contagem de dias corridos disfarçada.';

-- ---------------------------------------------------------------------------
-- 2) Aritmética de dia útil
-- ---------------------------------------------------------------------------
-- NULL quando a organização não declarou calendário. É a diferença entre "o
-- prazo é 23/09" e "não dá para saber o prazo", e ela precisa sobreviver até a
-- tela.
CREATE OR REPLACE FUNCTION public.organization_has_business_calendar(p_organization_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.organization_business_calendars
                  WHERE organization_id = p_organization_id)
$$;

CREATE OR REPLACE FUNCTION public.organization_shift_business_days(
  p_organization_id uuid,
  p_from            date,
  p_days            integer
) RETURNS date
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  weekdays smallint[];
  step     integer;
  cursor_d date := p_from;
  moved    integer := 0;
  target   integer;
  guard    integer := 0;
BEGIN
  IF p_from IS NULL OR p_days IS NULL THEN RETURN NULL; END IF;

  SELECT business_weekdays INTO weekdays
    FROM public.organization_business_calendars
   WHERE organization_id = p_organization_id;
  -- Sem calendário declarado não há resposta honesta.
  IF weekdays IS NULL THEN RETURN NULL; END IF;

  IF p_days = 0 THEN RETURN p_from; END IF;
  step   := CASE WHEN p_days > 0 THEN 1 ELSE -1 END;
  target := abs(p_days);

  WHILE moved < target LOOP
    guard := guard + 1;
    -- Um calendário patológico (todo dia é feriado) não pode virar laço eterno.
    IF guard > 3650 THEN RETURN NULL; END IF;

    cursor_d := cursor_d + step;
    IF EXTRACT(isodow FROM cursor_d)::smallint = ANY (weekdays)
       AND NOT EXISTS (SELECT 1 FROM public.organization_non_business_days
                        WHERE organization_id = p_organization_id AND day = cursor_d) THEN
      moved := moved + 1;
    END IF;
  END LOOP;

  RETURN cursor_d;
END $$;

COMMENT ON FUNCTION public.organization_shift_business_days(uuid, date, integer) IS
  'Desloca N dias ÚTEIS a partir de uma data, pelo calendário DECLARADO da '
  'organização (dias úteis da semana + feriados). NULL quando não há calendário '
  'declarado: o prazo continua desconhecido em vez de virar dia corrido.';

REVOKE ALL ON FUNCTION public.organization_shift_business_days(uuid, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organization_shift_business_days(uuid, date, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.organization_has_business_calendar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organization_has_business_calendar(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) A regra: âncora de agenda na DEFINIÇÃO
-- ---------------------------------------------------------------------------
ALTER TABLE public.contract_obligation_definitions
  ADD COLUMN IF NOT EXISTS schedule_anchor             text,
  ADD COLUMN IF NOT EXISTS schedule_anchor_offset_days integer,
  -- Texto literal do gatilho, para quem for conferir no papel.
  ADD COLUMN IF NOT EXISTS schedule_anchor_text        text;

ALTER TABLE public.contract_obligation_definitions
  DROP CONSTRAINT IF EXISTS cod_activation_kind;
ALTER TABLE public.contract_obligation_definitions
  ADD CONSTRAINT cod_activation_kind CHECK (activation_kind IN
    ('contract_start','days_after_contract_start','days_before_contract_end',
     'fixed_date','manual','external_event','schedule_anchor','unspecified'));

ALTER TABLE public.contract_obligation_definitions
  DROP CONSTRAINT IF EXISTS cod_due_kind;
ALTER TABLE public.contract_obligation_definitions
  ADD CONSTRAINT cod_due_kind CHECK (due_kind IN
    ('fixed_date','days_after_activation','days_before_contract_end',
     'same_day_as_activation','recurring',
     'days_before_schedule_anchor','days_after_schedule_anchor','unspecified'));

ALTER TABLE public.contract_obligation_definitions
  DROP CONSTRAINT IF EXISTS cod_schedule_anchor_kind;
ALTER TABLE public.contract_obligation_definitions
  ADD CONSTRAINT cod_schedule_anchor_kind CHECK (
    schedule_anchor IS NULL OR schedule_anchor IN
      ('measurement','measurement_acceptance','project_milestone','project_start','project_end'));

-- Regra ancorada exige âncora; âncora solta não existe.
ALTER TABLE public.contract_obligation_definitions
  DROP CONSTRAINT IF EXISTS cod_schedule_anchor_coherent;
ALTER TABLE public.contract_obligation_definitions
  ADD CONSTRAINT cod_schedule_anchor_coherent CHECK (
    (activation_kind = 'schedule_anchor'
     OR due_kind IN ('days_before_schedule_anchor','days_after_schedule_anchor'))
    = (schedule_anchor IS NOT NULL));

ALTER TABLE public.contract_obligation_definitions
  DROP CONSTRAINT IF EXISTS cod_schedule_anchor_offset;
ALTER TABLE public.contract_obligation_definitions
  ADD CONSTRAINT cod_schedule_anchor_offset CHECK (
    (due_kind IN ('days_before_schedule_anchor','days_after_schedule_anchor'))
    = (schedule_anchor_offset_days IS NOT NULL));

COMMENT ON COLUMN public.contract_obligation_definitions.schedule_anchor IS
  'EVENTO OPERACIONAL a que o prazo se amarra. Contratos guarda a regra; a data '
  'do evento pertence a Projetos e é lida de lá quando existir.';

-- ---------------------------------------------------------------------------
-- 4) O terceiro estado na INSTÂNCIA
-- ---------------------------------------------------------------------------
ALTER TABLE public.contract_obligation_instances
  ADD COLUMN IF NOT EXISTS date_state            text NOT NULL DEFAULT 'RESOLVED',
  ADD COLUMN IF NOT EXISTS schedule_anchor       text,
  ADD COLUMN IF NOT EXISTS schedule_anchor_ref_id uuid,
  ADD COLUMN IF NOT EXISTS schedule_anchor_date  date,
  ADD COLUMN IF NOT EXISTS schedule_anchor_applied_at timestamptz;

ALTER TABLE public.contract_obligation_instances
  DROP CONSTRAINT IF EXISTS coi_date_state;
ALTER TABLE public.contract_obligation_instances
  ADD CONSTRAINT coi_date_state CHECK (date_state IN
    ('RESOLVED','AWAITING_SCHEDULE_ANCHOR','UNKNOWN'));

-- Aguardando âncora é, por definição, prazo ainda não calculado.
ALTER TABLE public.contract_obligation_instances
  DROP CONSTRAINT IF EXISTS coi_awaiting_has_no_due;
ALTER TABLE public.contract_obligation_instances
  ADD CONSTRAINT coi_awaiting_has_no_due CHECK (
    date_state <> 'AWAITING_SCHEDULE_ANCHOR' OR due_date IS NULL);

COMMENT ON COLUMN public.contract_obligation_instances.date_state IS
  'AWAITING_SCHEDULE_ANCHOR = a regra é conhecida, a âncora é conhecida e a '
  'AGENDA ainda não existe. Não é defeito nem pendência de cadastro: é o '
  'estado correto até Projetos agendar o evento. Data inventada seria pior.';

-- Retroativo: tudo que já existe nasceu sem âncora de agenda.
UPDATE public.contract_obligation_instances
   SET date_state = CASE WHEN due_confidence = 'known' THEN 'RESOLVED' ELSE 'UNKNOWN' END
 WHERE date_state = 'RESOLVED' AND due_confidence <> 'known';

-- ---------------------------------------------------------------------------
-- 5) Materialização — ciente da âncora
-- ---------------------------------------------------------------------------
-- Substitui a versão da 117. A única mudança de comportamento: regra ancorada
-- em agenda nasce AWAITING_SCHEDULE_ANCHOR, com due_date NULL, em vez de cair
-- no ramo "desconhecido" genérico. Todo o resto é idêntico.
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
  d_state    text;
  guard      integer := 0;
  anchored   boolean;
BEGIN
  SELECT * INTO d FROM public.contract_obligation_definitions WHERE id = p_definition_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Definição de obrigação % não existe.', p_definition_id USING ERRCODE = 'no_data_found';
  END IF;
  IF p_organization_id IS NOT NULL AND p_organization_id <> d.organization_id THEN
    RAISE EXCEPTION 'Definição de obrigação não pertence à organização informada.' USING ERRCODE = 'check_violation';
  END IF;
  IF d.status = 'removed' THEN RETURN 0; END IF;

  anchored := (d.due_kind IN ('days_before_schedule_anchor','days_after_schedule_anchor')
               OR d.activation_kind = 'schedule_anchor');

  SELECT * INTO contract FROM public.contracts WHERE id = d.contract_id;

  anchor := COALESCE(d.effective_from, d.activation_fixed_date, contract.start_date);
  IF anchor IS NULL THEN
    IF d.recurrence_kind <> 'one_time' THEN RETURN 0; END IF;
    key := 'single';
    IF NOT EXISTS (SELECT 1 FROM public.contract_obligation_instances
                    WHERE definition_id = d.id AND occurrence_key = key) THEN
      INSERT INTO public.contract_obligation_instances
        (organization_id, definition_id, contract_id, occurrence_key, sequence,
         due_date, due_confidence, due_basis, activation_state, state,
         date_state, schedule_anchor)
      VALUES (d.organization_id, d.id, d.contract_id, key, 1,
              NULL, 'unknown',
              CASE WHEN anchored THEN 'prazo ancorado em evento operacional ainda não agendado'
                   ELSE 'âncora de vigência desconhecida' END,
              'unknown', 'NOT_ACTIVATED',
              CASE WHEN anchored THEN 'AWAITING_SCHEDULE_ANCHOR' ELSE 'UNKNOWN' END,
              d.schedule_anchor);
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
      -- 'schedule_anchor', 'manual' e 'external_event': o fato ainda não
      -- ocorreu. 'unspecified': o contrato não disse.
      ELSE NULL END;

    IF activation IS NULL THEN
      act_state := 'unknown';
      life_state := 'NOT_ACTIVATED';
    ELSE
      act_state := 'activated';
      life_state := 'OPEN';
    END IF;

    -- ---- prazo ----
    IF anchored THEN
      -- A regra é conhecida; a agenda não existe ainda. Nenhuma data é
      -- inventada e o estado diz exatamente o que falta.
      due := NULL; confidence := 'unknown'; d_state := 'AWAITING_SCHEDULE_ANCHOR';
    ELSIF d.calendar_basis = 'business_days' AND d.due_kind IN ('days_after_activation','days_before_contract_end') THEN
      -- Com calendário declarado a conta em dias úteis é possível; sem ele,
      -- continua desconhecida — a regra da 115 não afrouxou.
      due := CASE d.due_kind
        WHEN 'days_after_activation' THEN
          public.organization_shift_business_days(d.organization_id, activation, d.due_offset_days)
        WHEN 'days_before_contract_end' THEN
          public.organization_shift_business_days(d.organization_id, contract.end_date, -d.due_offset_days)
        ELSE NULL END;
      confidence := CASE WHEN due IS NULL THEN 'unknown' ELSE 'known' END;
      d_state := CASE WHEN due IS NULL THEN 'UNKNOWN' ELSE 'RESOLVED' END;
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
      d_state := CASE WHEN due IS NULL THEN 'UNKNOWN' ELSE 'RESOLVED' END;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.contract_obligation_instances
                    WHERE definition_id = d.id AND occurrence_key = key) THEN
      INSERT INTO public.contract_obligation_instances
        (organization_id, definition_id, contract_id, occurrence_key, sequence,
         period_start, period_end, activated_at, due_date, due_confidence, due_basis,
         activation_state, state, date_state, schedule_anchor)
      VALUES (d.organization_id, d.id, d.contract_id, key, guard,
              cursor_date,
              CASE WHEN step IS NULL THEN NULL ELSE (cursor_date + step - interval '1 day')::date END,
              activation, due, confidence,
              CASE WHEN anchored
                   THEN 'prazo ancorado em ' || d.schedule_anchor || ' ainda não agendado'
                   WHEN confidence = 'unknown' AND d.calendar_basis = 'business_days'
                   THEN 'regra em dias úteis sem calendário oficial'
                   WHEN confidence = 'unknown' AND activation IS NULL
                   THEN 'ativação depende de fato ainda não observado'
                   WHEN confidence = 'unknown' THEN 'regra de prazo não especificada'
                   ELSE d.due_kind END,
              act_state, life_state, d_state, d.schedule_anchor);
      created := created + 1;
    END IF;

    EXIT WHEN step IS NULL;
    cursor_date := (cursor_date + step)::date;
    EXIT WHEN cursor_date > horizon;
  END LOOP;

  RETURN created;
END $$;

REVOKE ALL ON FUNCTION public.contract_obligations_materialize(uuid, date, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6) A âncora chega: Projetos agendou a medição
-- ---------------------------------------------------------------------------
-- Idempotente pela mesma razão da materialização: um job pode chamar isto
-- quantas vezes quiser. Uma ocorrência já resolvida por esta MESMA medição não
-- é recalculada; uma ocorrência resolvida por outro caminho não é sequestrada.
CREATE OR REPLACE FUNCTION public.contract_obligations_apply_schedule_anchor(
  p_measurement_id  uuid,
  p_organization_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m        public.project_measurements%ROWTYPE;
  d        public.contract_obligation_definitions%ROWTYPE;
  inst     public.contract_obligation_instances%ROWTYPE;
  anchor_d date;
  computed date;
  conf     text;
  basis    text;
  updated  integer := 0;
BEGIN
  SELECT * INTO m FROM public.project_measurements WHERE id = p_measurement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Medição % não existe.', p_measurement_id USING ERRCODE = 'no_data_found';
  END IF;
  IF p_organization_id IS NOT NULL AND p_organization_id <> m.organization_id THEN
    RAISE EXCEPTION 'Medição não pertence à organização informada.' USING ERRCODE = 'check_violation';
  END IF;

  -- A DATA vem de Projetos. Contratos não a escolhe, não a corrige e não a
  -- inventa quando ela falta.
  anchor_d := m.expected_at;
  IF anchor_d IS NULL THEN RETURN 0; END IF;

  FOR d IN
    SELECT def.* FROM public.contract_obligation_definitions def
     WHERE def.organization_id = m.organization_id
       AND def.contract_id     = m.contract_id
       AND def.status          = 'active'
       AND def.schedule_anchor IN ('measurement','measurement_acceptance')
  LOOP
    FOR inst IN
      SELECT i.* FROM public.contract_obligation_instances i
       WHERE i.definition_id = d.id
         AND i.date_state    = 'AWAITING_SCHEDULE_ANCHOR'
         -- Série recorrente casa pelo período que contém a medição; série
         -- única resolve na primeira âncora. Adivinhar o par produziria uma
         -- exigência plausível e errada.
         AND (i.period_start IS NULL OR anchor_d >= i.period_start)
         AND (i.period_end   IS NULL OR anchor_d <= i.period_end)
       ORDER BY i.sequence
    LOOP
      IF d.calendar_basis = 'business_days' THEN
        computed := public.organization_shift_business_days(
          d.organization_id, anchor_d,
          CASE WHEN d.due_kind = 'days_before_schedule_anchor'
               THEN -d.schedule_anchor_offset_days
               ELSE  d.schedule_anchor_offset_days END);
        basis := d.due_kind || ' (' || d.schedule_anchor_offset_days || ' dias úteis)';
      ELSE
        computed := CASE WHEN d.due_kind = 'days_before_schedule_anchor'
                         THEN anchor_d - d.schedule_anchor_offset_days
                         ELSE anchor_d + d.schedule_anchor_offset_days END;
        basis := d.due_kind || ' (' || d.schedule_anchor_offset_days || ' dias corridos)';
      END IF;

      conf := CASE WHEN computed IS NULL THEN 'unknown' ELSE 'known' END;

      UPDATE public.contract_obligation_instances
         SET due_date        = computed,
             due_confidence  = conf,
             due_basis       = CASE WHEN computed IS NULL
                               THEN 'regra em dias úteis sem calendário declarado pela organização'
                               ELSE basis END,
             date_state      = CASE WHEN computed IS NULL THEN 'UNKNOWN' ELSE 'RESOLVED' END,
             schedule_anchor_ref_id = m.id,
             schedule_anchor_date   = anchor_d,
             schedule_anchor_applied_at = now(),
             -- A exigência passa a valer: a agenda existe.
             activation_state = CASE WHEN computed IS NULL THEN activation_state ELSE 'activated' END,
             activated_at     = CASE WHEN computed IS NULL THEN activated_at ELSE anchor_d END,
             state            = CASE WHEN computed IS NULL THEN state
                                     WHEN state = 'NOT_ACTIVATED' THEN 'OPEN'
                                     ELSE state END
       WHERE id = inst.id;
      updated := updated + 1;
    END LOOP;
  END LOOP;

  RETURN updated;
END $$;

REVOKE ALL ON FUNCTION public.contract_obligations_apply_schedule_anchor(uuid, uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.contract_obligations_apply_schedule_anchor(uuid, uuid) IS
  'Projetos agendou a medição; Contratos calcula o prazo REAL das exigências '
  'que estavam AWAITING_SCHEDULE_ANCHOR e as ativa. Idempotente. Lê expected_at '
  'de project_measurements e nunca escreve nada lá: o QUANDO continua de '
  'Projetos, o QUE continua de Contratos.';

-- ---------------------------------------------------------------------------
-- 7) RLS dos objetos novos
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['organization_business_calendars','organization_non_business_days']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (organization_id = public.current_user_organization_id())',
                   t || '_read', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM authenticated, anon', t);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS coi_awaiting_anchor
  ON public.contract_obligation_instances (organization_id, contract_id, schedule_anchor)
  WHERE date_state = 'AWAITING_SCHEDULE_ANCHOR';

COMMIT;
