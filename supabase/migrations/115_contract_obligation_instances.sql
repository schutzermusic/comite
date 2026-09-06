-- ============================================================
-- CONTRACTS V2 — FASE 3 (2/3): instâncias, recorrência, prazo, dependências
-- Migration: 115_contract_obligation_instances
--
-- A definição diz o que o contrato exige. A instância é UMA ocorrência disso:
-- o relatório de setembro, a renovação do seguro do ano 2027, o aceite da
-- medição 45. Uma definição mensal produz muitas instâncias, e é por isso que
-- as duas não podem ser a mesma linha — marcar setembro como entregue não pode
-- apagar a exigência de outubro.
--
-- ─── Materialização idempotente ────────────────────────────────────────────
--
-- `contract_obligations_materialize(definição, horizonte)` cria as ocorrências
-- até o horizonte pedido. Rodar de novo não cria duplicata: cada ocorrência tem
-- uma CHAVE estável derivada do período, e a chave é única por definição. Isso é
-- o que permite a Fase 4 chamá-la de um job sem coordenação, e o que permite
-- rodá-la à mão hoje sem agendador nenhum.
--
-- ─── O que a materialização se recusa a fazer ──────────────────────────────
--
-- Sem âncora de data conhecida, ela não inventa uma. Uma definição cuja vigência
-- começa em data desconhecida, ou cujo prazo depende de dias ÚTEIS sem
-- calendário oficial, gera a ocorrência com `due_date` NULL e confiança
-- `unknown`. A alternativa — contar dia útil como dia corrido — produziria um
-- prazo errado com cara de certo.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1) Instância
-- ------------------------------------------------------------
CREATE TABLE public.contract_obligation_instances (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  definition_id           uuid NOT NULL,
  contract_id             uuid NOT NULL,

  -- Identidade da ocorrência: derivada do período, estável entre execuções.
  -- É ela que torna a materialização repetível sem duplicar.
  occurrence_key          text NOT NULL CHECK (btrim(occurrence_key) <> ''),
  sequence                integer CHECK (sequence IS NULL OR sequence > 0),
  period_start            date,
  period_end              date,

  -- ---- ativação ----
  activation_state        text NOT NULL DEFAULT 'unknown'
                            CHECK (activation_state IN ('not_activated','activated','unknown')),
  activated_at            date,
  activation_note         text,

  -- ---- prazo ----
  -- A REGRA mora na definição; aqui fica a data CALCULADA e o quanto se pode
  -- confiar nela. `unknown` não é um defeito a corrigir — é o estado correto
  -- quando a regra é conhecida e a âncora não.
  due_date                date,
  due_confidence          text NOT NULL DEFAULT 'unknown'
                            CHECK (due_confidence IN ('known','unknown')),
  due_basis               text,

  -- ---- estado ----
  state                   text NOT NULL DEFAULT 'NOT_ACTIVATED'
                            CHECK (state IN ('NOT_ACTIVATED','OPEN','SATISFIED','WAIVED','CANCELLED','EXCEPTION')),
  satisfied_at            timestamptz,
  satisfied_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Como se sabe que foi cumprida. Ausente = não se sabe; e "não se sabe" nunca
  -- vira "cumprida" por decurso de prazo.
  satisfaction_basis      text CHECK (satisfaction_basis IS NULL OR satisfaction_basis IN
                            ('explicit_completion','required_evidence_present','contractual_fact')),
  satisfaction_note       text,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT coi_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT coi_org_contract_id_unique UNIQUE (organization_id, contract_id, id),
  -- A garantia de idempotência, no banco e não no chamador.
  CONSTRAINT coi_occurrence_unique UNIQUE (organization_id, definition_id, occurrence_key),
  -- A instância carrega o contrato e a definição juntos: uma ocorrência não
  -- pode pertencer a uma definição de OUTRO contrato.
  CONSTRAINT coi_definition_tenant FOREIGN KEY (organization_id, contract_id, definition_id)
    REFERENCES public.contract_obligation_definitions (organization_id, contract_id, id) ON DELETE CASCADE,
  CONSTRAINT coi_contract_tenant FOREIGN KEY (organization_id, contract_id)
    REFERENCES public.contracts (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT coi_period_order CHECK (period_start IS NULL OR period_end IS NULL OR period_end >= period_start),
  -- Data sem confiança declarada, ou confiança `known` sem data, seriam as duas
  -- formas de mentir sobre prazo.
  CONSTRAINT coi_due_coherent CHECK ((due_confidence = 'known') = (due_date IS NOT NULL)),
  CONSTRAINT coi_satisfied_coherent CHECK (
    (state = 'SATISFIED') = (satisfied_at IS NOT NULL AND satisfaction_basis IS NOT NULL)),
  CONSTRAINT coi_activated_coherent CHECK (
    activation_state <> 'activated' OR state <> 'NOT_ACTIVATED')
);

CREATE INDEX coi_scope ON public.contract_obligation_instances (organization_id, contract_id, state, due_date);
CREATE INDEX coi_definition ON public.contract_obligation_instances (organization_id, definition_id, period_start);
CREATE INDEX coi_open_due ON public.contract_obligation_instances (organization_id, due_date)
  WHERE state = 'OPEN' AND due_date IS NOT NULL;

COMMENT ON COLUMN public.contract_obligation_instances.due_confidence IS
  '`unknown` com due_date NULL é o estado CORRETO quando a regra é conhecida e '
  'a âncora não (vigência desconhecida, ou dias úteis sem calendário oficial). '
  'Nunca preencher com uma data plausível.';

-- ------------------------------------------------------------
-- 2) Histórico de transições — some-acréscimo
-- ------------------------------------------------------------
-- O estado atual da instância é cache; a verdade é esta tabela. Um `status`
-- mutável sozinho não responde "quando virou atrasada" nem "quem deu por
-- cumprida", e essas duas perguntas são o que uma auditoria faz.
CREATE TABLE public.contract_obligation_instance_history (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  instance_id             uuid NOT NULL,
  previous_state          text,
  next_state              text NOT NULL,
  transition              text NOT NULL,
  note                    text,
  actor_user_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recorded_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coih_instance_tenant FOREIGN KEY (organization_id, instance_id)
    REFERENCES public.contract_obligation_instances (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX coih_instance ON public.contract_obligation_instance_history (instance_id, recorded_at);

-- Dois gatilhos, e não um: a 110 separou reescrever de apagar de propósito.
-- `..._mutation` recusa a reescrita a todo mundo; `..._erasure` recusa o
-- apagamento à aplicação mas deixa o caminho privilegiado de exclusão de
-- inquilino passar — que é o que mantém o apagamento de uma organização inteira
-- possível.
CREATE TRIGGER coih_immutable BEFORE UPDATE ON public.contract_obligation_instance_history
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_mutation();
CREATE TRIGGER coih_no_erasure BEFORE DELETE ON public.contract_obligation_instance_history
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

-- ------------------------------------------------------------
-- 3) Transições válidas + histórico na MESMA transação
-- ------------------------------------------------------------
CREATE FUNCTION public.contract_obligation_valid_transition(p_from text, p_to text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_from
    WHEN 'NOT_ACTIVATED' THEN p_to IN ('OPEN','CANCELLED','WAIVED','EXCEPTION')
    WHEN 'OPEN'          THEN p_to IN ('SATISFIED','WAIVED','CANCELLED','EXCEPTION')
    WHEN 'EXCEPTION'     THEN p_to IN ('OPEN','SATISFIED','WAIVED','CANCELLED')
    WHEN 'WAIVED'        THEN p_to IN ('OPEN')   -- dispensa expirada devolve a obrigação
    WHEN 'SATISFIED'     THEN false
    WHEN 'CANCELLED'     THEN false
    ELSE false END
$$;

CREATE FUNCTION public.contract_obligations_record_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.state IS NOT DISTINCT FROM OLD.state THEN RETURN NEW; END IF;

  IF NOT public.contract_obligation_valid_transition(OLD.state, NEW.state) THEN
    RAISE EXCEPTION 'Transição de obrigação inválida: % -> % (instância %).', OLD.state, NEW.state, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Cache e histórico mudam JUNTOS. Se o INSERT abaixo falhar, o UPDATE da
  -- instância cai com ele — que é a única forma de os dois não divergirem.
  INSERT INTO public.contract_obligation_instance_history
    (organization_id, instance_id, previous_state, next_state, transition, actor_user_id)
  VALUES (NEW.organization_id, NEW.id, OLD.state, NEW.state,
          lower(OLD.state) || '_to_' || lower(NEW.state), auth.uid());
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contract_obligations_record_transition() FROM PUBLIC;
CREATE TRIGGER coi_record_transition BEFORE UPDATE ON public.contract_obligation_instances
  FOR EACH ROW EXECUTE FUNCTION public.contract_obligations_record_transition();

CREATE FUNCTION public.contract_obligations_record_birth() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.contract_obligation_instance_history
    (organization_id, instance_id, previous_state, next_state, transition, actor_user_id)
  VALUES (NEW.organization_id, NEW.id, NULL, NEW.state, 'materialized', auth.uid());
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contract_obligations_record_birth() FROM PUBLIC;
CREATE TRIGGER coi_record_birth AFTER INSERT ON public.contract_obligation_instances
  FOR EACH ROW EXECUTE FUNCTION public.contract_obligations_record_birth();

-- ------------------------------------------------------------
-- 4) Dependências entre obrigações
-- ------------------------------------------------------------
-- "O aceite do cliente depende da entrega do relatório de medição."
--
-- A dependência é entre DEFINIÇÕES. Para séries recorrentes, casar a ocorrência
-- de uma com a da outra só é determinístico quando as duas usam a MESMA chave de
-- ocorrência; fora disso, exige mapeamento explícito. Adivinhar o par ("o
-- relatório de setembro deve ser o do aceite de setembro") produziria uma
-- dependência plausível e errada.
CREATE TABLE public.contract_obligation_dependencies (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id             uuid NOT NULL,
  dependent_definition_id uuid NOT NULL,
  depends_on_definition_id uuid NOT NULL,
  -- `same_occurrence_key`: as duas séries usam a mesma chave, o par é exato.
  -- `explicit`: o par vem de contract_obligation_instance_dependencies.
  -- `unresolved`: existe a dependência, o par de ocorrência não é determinável.
  mapping_mode            text NOT NULL DEFAULT 'unresolved'
                            CHECK (mapping_mode IN ('same_occurrence_key','explicit','unresolved')),
  note                    text,
  created_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT codep_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT codep_unique UNIQUE (dependent_definition_id, depends_on_definition_id),
  CONSTRAINT codep_no_self CHECK (dependent_definition_id <> depends_on_definition_id),
  CONSTRAINT codep_dependent_tenant FOREIGN KEY (organization_id, dependent_definition_id)
    REFERENCES public.contract_obligation_definitions (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT codep_depends_tenant FOREIGN KEY (organization_id, depends_on_definition_id)
    REFERENCES public.contract_obligation_definitions (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT codep_contract_tenant FOREIGN KEY (organization_id, contract_id)
    REFERENCES public.contracts (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX codep_dependent ON public.contract_obligation_dependencies (organization_id, dependent_definition_id);
CREATE INDEX codep_depends ON public.contract_obligation_dependencies (organization_id, depends_on_definition_id);

-- Par explícito entre OCORRÊNCIAS, para quando a série não permite dedução.
CREATE TABLE public.contract_obligation_instance_dependencies (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  dependency_id           uuid NOT NULL,
  dependent_instance_id   uuid NOT NULL,
  depends_on_instance_id  uuid NOT NULL,
  created_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coidep_unique UNIQUE (dependent_instance_id, depends_on_instance_id),
  CONSTRAINT coidep_no_self CHECK (dependent_instance_id <> depends_on_instance_id),
  CONSTRAINT coidep_dependency_tenant FOREIGN KEY (organization_id, dependency_id)
    REFERENCES public.contract_obligation_dependencies (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT coidep_dependent_tenant FOREIGN KEY (organization_id, dependent_instance_id)
    REFERENCES public.contract_obligation_instances (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT coidep_depends_tenant FOREIGN KEY (organization_id, depends_on_instance_id)
    REFERENCES public.contract_obligation_instances (organization_id, id) ON DELETE CASCADE
);
-- Ciclo: "A depende de B" e "B depende de A" descreveriam um contrato que não
-- pode ser cumprido. Recusar na escrita é melhor que descobrir na leitura.
CREATE FUNCTION public.contract_obligations_reject_dependency_cycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE cycles integer;
BEGIN
  WITH RECURSIVE reach(node) AS (
    SELECT NEW.depends_on_definition_id
    UNION
    SELECT d.depends_on_definition_id
      FROM public.contract_obligation_dependencies d
      JOIN reach r ON d.dependent_definition_id = r.node
  )
  SELECT count(*) INTO cycles FROM reach WHERE node = NEW.dependent_definition_id;

  IF cycles > 0 THEN
    RAISE EXCEPTION 'Dependência criaria ciclo entre obrigações (% depende de %).',
      NEW.dependent_definition_id, NEW.depends_on_definition_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contract_obligations_reject_dependency_cycle() FROM PUBLIC;
CREATE TRIGGER codep_no_cycle BEFORE INSERT OR UPDATE ON public.contract_obligation_dependencies
  FOR EACH ROW EXECUTE FUNCTION public.contract_obligations_reject_dependency_cycle();

-- ------------------------------------------------------------
-- 5) Materialização determinística e idempotente
-- ------------------------------------------------------------
CREATE FUNCTION public.contract_obligations_materialize(
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
  guard      integer := 0;
BEGIN
  SELECT * INTO d FROM public.contract_obligation_definitions WHERE id = p_definition_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Definição de obrigação % não existe.', p_definition_id USING ERRCODE = 'no_data_found';
  END IF;
  -- Quem chama declara o inquilino esperado; divergir é erro, não filtro.
  IF p_organization_id IS NOT NULL AND p_organization_id <> d.organization_id THEN
    RAISE EXCEPTION 'Definição de obrigação não pertence à organização informada.' USING ERRCODE = 'check_violation';
  END IF;
  IF d.status = 'removed' THEN RETURN 0; END IF;

  SELECT * INTO contract FROM public.contracts WHERE id = d.contract_id;

  -- ---- âncora ----
  -- Sem âncora conhecida não há série datável. A definição continua válida; o
  -- que não existe é uma data para pendurar as ocorrências, e inventá-la seria
  -- o erro que esta fase inteira existe para evitar.
  anchor := COALESCE(d.effective_from, d.activation_fixed_date, contract.start_date);
  IF anchor IS NULL THEN
    IF d.recurrence_kind <> 'one_time' THEN
      RETURN 0;  -- série recorrente sem âncora: nada é materializado
    END IF;
    -- Uma ocorrência única SEM data ainda é uma ocorrência real: ela existe,
    -- e o que se desconhece é o prazo. Registrá-la com prazo desconhecido é
    -- mais honesto que fingir que a obrigação não existe.
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

  -- ---- horizonte ----
  -- Limitado pelo que o contrato disser: fim explícito da recorrência, fim da
  -- vigência da definição, fim do contrato — o que vier primeiro. O horizonte
  -- pedido nunca amplia esses limites.
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
    -- Trava de segurança: uma definição diária com horizonte de um século não
    -- pode transformar uma chamada em um milhão de linhas.
    EXIT WHEN guard > 2000;

    -- Chave estável por período: a mesma data produz a mesma chave em qualquer
    -- execução, hoje ou daqui a um ano. É isso que torna repetir inofensivo.
    key := CASE d.recurrence_kind
      WHEN 'one_time'  THEN 'single'
      WHEN 'monthly'   THEN to_char(cursor_date, 'YYYY-MM')
      WHEN 'quarterly' THEN to_char(cursor_date, 'YYYY') || '-Q' || to_char(EXTRACT(quarter FROM cursor_date), 'FM9')
      WHEN 'yearly'    THEN to_char(cursor_date, 'YYYY')
      WHEN 'weekly'    THEN to_char(cursor_date, 'IYYY-"W"IW')
      ELSE to_char(cursor_date, 'YYYY-MM-DD') END;

    -- ---- prazo da ocorrência ----
    -- Dia útil sem calendário oficial: regra conhecida, data DESCONHECIDA.
    IF d.calendar_basis = 'business_days' AND d.due_kind IN ('days_after_activation','days_before_contract_end') THEN
      due := NULL; confidence := 'unknown';
    ELSE
      due := CASE d.due_kind
        WHEN 'fixed_date'                THEN d.due_fixed_date
        WHEN 'same_day_as_activation'    THEN cursor_date
        WHEN 'days_after_activation'     THEN cursor_date + d.due_offset_days
        WHEN 'days_before_contract_end'  THEN
          CASE WHEN contract.end_date IS NULL THEN NULL ELSE contract.end_date - d.due_offset_days END
        WHEN 'recurring'                 THEN cursor_date
        ELSE NULL END;
      confidence := CASE WHEN due IS NULL THEN 'unknown' ELSE 'known' END;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.contract_obligation_instances
                    WHERE definition_id = d.id AND occurrence_key = key) THEN
      INSERT INTO public.contract_obligation_instances
        (organization_id, definition_id, contract_id, occurrence_key, sequence,
         period_start, period_end, due_date, due_confidence, due_basis,
         activation_state, state)
      VALUES (d.organization_id, d.id, d.contract_id, key, guard,
              cursor_date,
              CASE WHEN step IS NULL THEN NULL ELSE (cursor_date + step - interval '1 day')::date END,
              due, confidence,
              CASE WHEN confidence = 'unknown' AND d.calendar_basis = 'business_days'
                   THEN 'regra em dias úteis sem calendário oficial'
                   WHEN confidence = 'unknown' THEN 'regra de prazo não especificada'
                   ELSE d.due_kind END,
              'unknown', 'NOT_ACTIVATED');
      created := created + 1;
    END IF;

    EXIT WHEN step IS NULL;                 -- one_time / custom: uma ocorrência
    cursor_date := (cursor_date + step)::date;
    EXIT WHEN cursor_date > horizon;
  END LOOP;

  RETURN created;
END $$;
-- Materializar é ato do servidor. O navegador lê obrigação; não a fabrica.
REVOKE ALL ON FUNCTION public.contract_obligations_materialize(uuid, date, uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.contract_obligations_materialize(uuid, date, uuid) IS
  'Idempotente: a chave de ocorrência é derivada do período, então reexecutar '
  'não duplica. Sem âncora de data conhecida, série recorrente não materializa '
  'nada e ocorrência única nasce com prazo DESCONHECIDO — nunca com data '
  'inventada. Nenhum agendador é necessário; a Fase 4 poderá chamá-la.';

COMMIT;
