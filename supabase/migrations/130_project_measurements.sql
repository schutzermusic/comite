-- ============================================================
-- PROJETOS — a MEDIÇÃO canônica e sua história imutável
-- Migration: 130_project_measurements
--
-- ─── O que esta migration decide ───────────────────────────────────────────
--
-- A Fase 2 deu ao Contrato o direito de dizer O QUE deve ser medido
-- (`contract_measurement_requirements`, com vigência e linhagem). Faltava o
-- outro lado: ONDE e QUANDO aquilo acontece, e o QUE de fato aconteceu. Esse
-- outro lado é OPERAÇÃO, e por isso a instância mora em Projetos.
--
--   CONTRATO   define a regra           (fonte contratual, imutável por aditivo)
--   PROJETO    executa e registra       (instância operacional, aqui)
--
-- A instância aponta para a regra. A regra NÃO é copiada para cá como segunda
-- fonte de verdade — só o instantâneo necessário para fidelidade histórica.
--
-- ─── O que esta migration NÃO faz ──────────────────────────────────────────
--
--   · não cria medição nenhuma em organização real;
--   · não escreve Fiscal nem Financeiro;
--   · não aceita nada automaticamente — ACEITE É NUNCA AUTOMATIZADO, e a
--     estrutura abaixo é desenhada para que nem o dono do banco consiga
--     aceitar sem passar pela RPC da 133 (a 133 é quem congela os fatos);
--   · não apaga nem reescreve `contract_milestones.measured_amount`.
--
-- ─── Semântica estruturada, e não inferida ─────────────────────────────────
--
-- A §14 do plano manda PARAR em vez de inferir se incremental é cumulativo.
-- A auditoria encontrou `contract_measurement_requirements` com ZERO linhas em
-- produção e sem coluna nenhuma de cadência, unidade ou acumulação. Então não
-- há dado real em risco, e o caminho correto é declarar a semântica como
-- ESTRUTURA — com `UNKNOWN` como padrão, que é o que a regra realmente diz
-- hoje. Um `UNKNOWN` explícito é auditável; um `INCREMENTAL` presumido não.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1) Alvos de chave estrangeira composta (mesmo inquilino)
-- ------------------------------------------------------------
-- A §61 exige integridade estrutural de inquilino, não confiança no chamador.
-- Para apontar `(organization_id, project_id)` é preciso que o par seja único
-- no destino — e hoje `projects` só tem PRIMARY KEY (id). Estas três restrições
-- são o que torna a FK composta possível; nenhuma delas altera dado existente.
ALTER TABLE public.projects
  ADD CONSTRAINT projects_org_id_unique UNIQUE (organization_id, id);

ALTER TABLE public.project_timeline_items
  ADD CONSTRAINT pti_org_id_unique UNIQUE (organization_id, id),
  ADD CONSTRAINT pti_org_project_id_unique UNIQUE (organization_id, project_id, id);

ALTER TABLE public.contract_project_links
  ADD CONSTRAINT cpl_org_contract_project_unique UNIQUE (organization_id, contract_id, project_id);

COMMENT ON CONSTRAINT cpl_org_contract_project_unique ON public.contract_project_links IS
  'O vínculo Projeto↔Contrato é EXPLÍCITO e é o único aceito pela Fase 6. '
  'A §76 proíbe casar projeto com contrato por nome ou por cliente: sem linha '
  'aqui, a prontidão contratual do projeto é UNKNOWN, e não "sem pendência".';

-- ------------------------------------------------------------
-- 2) Semântica de medição na REGRA contratual
-- ------------------------------------------------------------
/*
  Estas colunas respondem perguntas que a instância não tem o direito de
  responder sozinha: a §13 (o que se mede), a §14 (como acumula), a §15 (com
  que periodicidade a ocorrência nasce) e a §71 (como várias medições somam
  num marco). Todas nascem `UNKNOWN`, e `UNKNOWN` é a resposta honesta para
  toda regra já cadastrada — nenhuma delas declarou nada disso.

  `cadence_anchor_day` para em 28 de propósito: 29, 30 e 31 não existem em todo
  mês, e resolver isso exigiria uma regra de fim de mês que o contrato não deu.
*/
ALTER TABLE public.contract_measurement_requirements
  ADD COLUMN measurement_basis text NOT NULL DEFAULT 'UNKNOWN'
    CHECK (measurement_basis IN ('QUANTITY','PERCENTAGE','MILESTONE_FIXED','MONETARY','UNKNOWN')),
  ADD COLUMN measurement_unit text
    CHECK (measurement_unit IS NULL OR btrim(measurement_unit) <> ''),
  ADD COLUMN measurement_currency text
    CHECK (measurement_currency IS NULL OR measurement_currency ~ '^[A-Z]{3}$'),
  ADD COLUMN accumulation_mode text NOT NULL DEFAULT 'UNKNOWN'
    CHECK (accumulation_mode IN ('INCREMENTAL','CUMULATIVE','MILESTONE_FIXED','UNKNOWN')),
  ADD COLUMN aggregation_mode text NOT NULL DEFAULT 'UNKNOWN'
    CHECK (aggregation_mode IN ('SUM_INCREMENTAL','LATEST_CUMULATIVE','FIXED_MILESTONE','PERCENTAGE','UNKNOWN')),
  ADD COLUMN cadence text NOT NULL DEFAULT 'UNKNOWN'
    CHECK (cadence IN ('MONTHLY','QUARTERLY','MILESTONE','ON_EVENT','ONCE','UNKNOWN')),
  ADD COLUMN cadence_anchor_day integer
    CHECK (cadence_anchor_day IS NULL OR cadence_anchor_day BETWEEN 1 AND 28);

COMMENT ON COLUMN public.contract_measurement_requirements.accumulation_mode IS
  'INCREMENTAL soma o período; CUMULATIVE já traz o total até a data. '
  'Confundir os dois é a origem clássica de medição contada em dobro, e por '
  'isso o padrão é UNKNOWN: sem a declaração, a §71 manda devolver UNKNOWN em '
  'vez de escolher uma agregação.';

COMMENT ON COLUMN public.contract_measurement_requirements.cadence IS
  'Governa a materialização de ocorrências (§45). UNKNOWN e ON_EVENT NUNCA '
  'geram candidato por calendário — a §15 proíbe adivinhar a ocorrência pela '
  'data mais próxima.';

-- ------------------------------------------------------------
-- 3) project_measurements — a instância canônica
-- ------------------------------------------------------------
CREATE TABLE public.project_measurements (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- ---- de quem é, e sob que regra ----
  project_id                text NOT NULL,
  contract_id               uuid NOT NULL,
  contract_measurement_rule_id uuid NOT NULL,
  -- Etapa de cronograma é ORGANIZAÇÃO da execução, não a regra (§78). Nula
  -- quando o mapeamento não foi resolvido — e nula é um estado legítimo que a
  -- prontidão sabe explicar (TIMELINE_MAPPING_UNRESOLVED).
  timeline_item_id          uuid,
  milestone_id              uuid,

  -- ---- identidade da ocorrência ----
  -- `occurrence_key` é sempre preenchida para que a chave da tabela seja real;
  -- o que distingue verdade de espaço reservado é `occurrence_state`. Uma
  -- ocorrência `unresolved` NÃO participa da unicidade determinística, porque
  -- unificá-la seria afirmar que duas coisas desconhecidas são a mesma.
  occurrence_key            text NOT NULL CHECK (btrim(occurrence_key) <> ''),
  occurrence_state          text NOT NULL DEFAULT 'resolved'
                              CHECK (occurrence_state IN ('resolved','unresolved')),
  measurement_period_start  date,
  measurement_period_end    date,
  expected_at               date,

  -- ---- o instantâneo mínimo da regra (fidelidade histórica, §26) ----
  -- Não é segunda fonte de verdade: é o que a regra DIZIA quando esta
  -- ocorrência nasceu. A §75 exige que um aditivo de hoje não faça a medição
  -- de ontem parecer regida pela regra nova.
  rule_effective_from       date,
  rule_effective_until      date,
  rule_snapshot             jsonb NOT NULL DEFAULT '{}'::jsonb
                              CHECK (jsonb_typeof(rule_snapshot) = 'object'),

  -- ---- o que se mede ----
  measurement_basis         text NOT NULL DEFAULT 'UNKNOWN'
                              CHECK (measurement_basis IN ('QUANTITY','PERCENTAGE','MILESTONE_FIXED','MONETARY','UNKNOWN')),
  accumulation_mode         text NOT NULL DEFAULT 'UNKNOWN'
                              CHECK (accumulation_mode IN ('INCREMENTAL','CUMULATIVE','MILESTONE_FIXED','UNKNOWN')),
  quantity                  numeric(18,4),
  unit                      text CHECK (unit IS NULL OR btrim(unit) <> ''),
  measured_value            numeric(18,2),
  currency                  text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),

  -- ---- estado ----
  status                    text NOT NULL DEFAULT 'PLANNED'
                              CHECK (status IN ('PLANNED','IN_PREPARATION','READY_FOR_SUBMISSION',
                                                'SUBMITTED','UNDER_REVIEW','ACCEPTED','REJECTED',
                                                'RETURNED_FOR_CORRECTION','CANCELLED','SUPERSEDED')),
  measured_at               timestamptz,
  submitted_at              timestamptz,
  accepted_at               timestamptz,
  rejected_at               timestamptz,
  returned_at               timestamptz,
  cancelled_at              timestamptz,
  superseded_at             timestamptz,

  -- ---- fatos congelados no ACEITE (§41) ----
  -- Colunas separadas de propósito. O que foi submetido pode ser corrigido
  -- enquanto ninguém aceitou; o que foi ACEITO não muda mais, e ter as duas
  -- coisas na mesma coluna tornaria a imutabilidade indistinguível de um
  -- travamento de edição.
  accepted_quantity         numeric(18,4),
  accepted_value            numeric(18,2),
  accepted_currency         text CHECK (accepted_currency IS NULL OR accepted_currency ~ '^[A-Z]{3}$'),
  acceptance_source         text CHECK (acceptance_source IS NULL OR acceptance_source IN
                              ('customer_portal','signed_bulletin','internal_reviewer',
                               'external_document','approval_engine','integration')),
  accepted_by_user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_by_party_id      uuid,
  accepted_external_ref     text,
  acceptance_document_id    uuid,
  acceptance_note           text,

  rejection_reason          text,
  return_reason             text,

  -- ---- revisão / supersessão (§40) ----
  revision                  integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  supersedes_id             uuid,
  superseded_by_id          uuid,
  supersession_reason       text,

  -- ---- proveniência ----
  origin                    text NOT NULL DEFAULT 'manual'
                              CHECK (origin IN ('manual','candidate_materialization','event')),
  correlation_id            uuid,
  source_event_id           uuid,
  created_by                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  -- ---------- integridade de inquilino, estrutural ----------
  CONSTRAINT pm_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pm_project_tenant FOREIGN KEY (organization_id, project_id)
    REFERENCES public.projects (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT pm_contract_tenant FOREIGN KEY (organization_id, contract_id)
    REFERENCES public.contracts (organization_id, id) ON DELETE CASCADE,
  -- A regra pertence AO MESMO contrato. Sem os três campos juntos, uma medição
  -- do contrato A poderia citar a regra do contrato B dentro do mesmo inquilino.
  CONSTRAINT pm_rule_tenant FOREIGN KEY (organization_id, contract_id, contract_measurement_rule_id)
    REFERENCES public.contract_measurement_requirements (organization_id, contract_id, id) ON DELETE CASCADE,
  CONSTRAINT pm_timeline_tenant FOREIGN KEY (organization_id, project_id, timeline_item_id)
    REFERENCES public.project_timeline_items (organization_id, project_id, id) ON DELETE SET NULL,
  CONSTRAINT pm_milestone_tenant FOREIGN KEY (organization_id, contract_id, milestone_id)
    REFERENCES public.contract_milestones (organization_id, contract_id, id) ON DELETE SET NULL,
  -- O vínculo Projeto↔Contrato precisa EXISTIR (§76). Não é redundância com as
  -- duas FKs acima: elas provam o inquilino, esta prova a RELAÇÃO.
  CONSTRAINT pm_project_contract_linked FOREIGN KEY (organization_id, contract_id, project_id)
    REFERENCES public.contract_project_links (organization_id, contract_id, project_id) ON DELETE RESTRICT,
  CONSTRAINT pm_party_tenant FOREIGN KEY (organization_id, accepted_by_party_id)
    REFERENCES public.parties (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT pm_supersedes_tenant FOREIGN KEY (organization_id, supersedes_id)
    REFERENCES public.project_measurements (organization_id, id) ON DELETE SET NULL,
  /*
    DIFERIDA, e a razão é a ordem obrigatória da supersessão.

    `pm_superseded_coherent` exige que a linha SUPERSEDED já aponte para a
    sucessora, e o índice de ocorrência única exige que a antiga saia do índice
    ANTES de a nova entrar — as duas exigências juntas obrigam a marcar a
    antiga antes de a nova existir. Sem o adiamento para o commit, esse
    intervalo de um instante seria uma violação de chave estrangeira, e a única
    saída seria afrouxar a coerência ou a unicidade. Adiar a verificação
    preserva as duas: no commit, a sucessora existe.
  */
  CONSTRAINT pm_superseded_by_tenant FOREIGN KEY (organization_id, superseded_by_id)
    REFERENCES public.project_measurements (organization_id, id)
    ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT pm_source_event_tenant FOREIGN KEY (organization_id, source_event_id)
    REFERENCES public.domain_events (organization_id, id) ON DELETE SET NULL,

  -- ---------- coerência ----------
  CONSTRAINT pm_period_order CHECK (
    measurement_period_start IS NULL OR measurement_period_end IS NULL
    OR measurement_period_end >= measurement_period_start),
  CONSTRAINT pm_no_self_supersede CHECK (supersedes_id IS DISTINCT FROM id),
  CONSTRAINT pm_no_self_superseded_by CHECK (superseded_by_id IS DISTINCT FROM id),
  -- Valor monetário sem moeda é valor DESCONHECIDO. A mesma regra da 126.
  CONSTRAINT pm_value_needs_currency CHECK ((measured_value IS NULL) OR (currency IS NOT NULL)),
  CONSTRAINT pm_accepted_value_needs_currency CHECK ((accepted_value IS NULL) OR (accepted_currency IS NOT NULL)),
  /*
    ACEITO exige proveniência — tradução estrutural da §11: sem fonte
    autoritativa registrada, o estado correto é PENDENTE, nunca ACEITO.

    A implicação vale numa direção só, e isso é a §41 falando. Uma medição
    SUPERSEDED continua carregando `accepted_at` e a fonte do aceite que
    realmente houve; uma equivalência estrita obrigaria a APAGÁ-LOS na
    supersessão, e apagar a proveniência de um aceite que existiu é
    exatamente a reescrita de história que a fase inteira proíbe. A segunda
    restrição fecha a volta: fato de aceite só existe em quem é, ou foi, aceito.
  */
  CONSTRAINT pm_accepted_coherent CHECK (
    (status <> 'ACCEPTED') OR (accepted_at IS NOT NULL AND acceptance_source IS NOT NULL)),
  CONSTRAINT pm_acceptance_facts_scope CHECK (
    (accepted_at IS NULL AND acceptance_source IS NULL) OR status IN ('ACCEPTED','SUPERSEDED')),
  -- ...e a fonte tem de dizer QUEM. Pessoa autenticada, parte externa nomeada,
  -- ou documento/referência externa. Um comentário livre não serve (§34).
  CONSTRAINT pm_acceptance_actor CHECK (
    acceptance_source IS NULL
    OR accepted_by_user_id IS NOT NULL
    OR accepted_by_party_id IS NOT NULL
    OR acceptance_document_id IS NOT NULL
    OR NULLIF(btrim(accepted_external_ref), '') IS NOT NULL),
  -- Mesma assimetria, mesma razão: a rejeição superseded preserva quando foi.
  CONSTRAINT pm_rejected_coherent CHECK (
    (status <> 'REJECTED') OR (rejected_at IS NOT NULL)),
  CONSTRAINT pm_rejection_facts_scope CHECK (
    rejected_at IS NULL OR status IN ('REJECTED','SUPERSEDED')),
  CONSTRAINT pm_returned_coherent CHECK (
    (status <> 'RETURNED_FOR_CORRECTION') OR (returned_at IS NOT NULL)),
  CONSTRAINT pm_cancelled_coherent CHECK (
    (status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  CONSTRAINT pm_supersession_reason_scope CHECK (
    supersession_reason IS NULL OR status = 'SUPERSEDED'),
  CONSTRAINT pm_superseded_coherent CHECK (
    (status = 'SUPERSEDED') = (superseded_at IS NOT NULL AND superseded_by_id IS NOT NULL)),
  -- Ocorrência não resolvida nunca é submetida nem aceita: submeter uma
  -- ocorrência que ninguém sabe identificar é o caminho para medir duas vezes
  -- o mesmo período (§15).
  CONSTRAINT pm_unresolved_stays_early CHECK (
    occurrence_state = 'resolved'
    OR status IN ('PLANNED','IN_PREPARATION','CANCELLED','SUPERSEDED'))
);

/*
  A UNICIDADE DETERMINÍSTICA — a garantia de idempotência da §46.

  Índice parcial, e não restrição de tabela, por duas razões que o modelo exige:
  · ocorrência `unresolved` fica de fora (não se unifica o desconhecido);
  · linha SUPERSEDED/CANCELLED fica de fora, senão a supersessão da §40 seria
    impossível — a revisão nova ocuparia a mesma chave da revisão morta.
*/
CREATE UNIQUE INDEX pm_occurrence_unique
  ON public.project_measurements (organization_id, project_id, contract_measurement_rule_id, occurrence_key)
  WHERE occurrence_state = 'resolved' AND status NOT IN ('SUPERSEDED','CANCELLED');

-- Índices para os acessos reais da §86 — nenhum deles é decorativo.
CREATE INDEX pm_project_status   ON public.project_measurements (organization_id, project_id, status, expected_at);
CREATE INDEX pm_contract_status  ON public.project_measurements (organization_id, contract_id, status, expected_at);
CREATE INDEX pm_rule_occurrence  ON public.project_measurements (organization_id, contract_measurement_rule_id, occurrence_key);
CREATE INDEX pm_timeline         ON public.project_measurements (organization_id, timeline_item_id)
  WHERE timeline_item_id IS NOT NULL;
CREATE INDEX pm_milestone        ON public.project_measurements (organization_id, milestone_id)
  WHERE milestone_id IS NOT NULL;
CREATE INDEX pm_expected         ON public.project_measurements (organization_id, expected_at)
  WHERE status IN ('PLANNED','IN_PREPARATION','READY_FOR_SUBMISSION');
CREATE INDEX pm_submitted        ON public.project_measurements (organization_id, submitted_at)
  WHERE submitted_at IS NOT NULL;
CREATE INDEX pm_accepted         ON public.project_measurements (organization_id, accepted_at)
  WHERE accepted_at IS NOT NULL;
CREATE INDEX pm_correlation      ON public.project_measurements (correlation_id)
  WHERE correlation_id IS NOT NULL;
-- A resolução de valor medido do marco (§68) entra por aqui, e ela roda em
-- toda leitura de carteira: sem este índice seria varredura.
CREATE INDEX pm_milestone_accepted ON public.project_measurements (organization_id, milestone_id, accepted_at)
  WHERE status = 'ACCEPTED' AND milestone_id IS NOT NULL;

COMMENT ON TABLE public.project_measurements IS
  'A instância operacional de medição. PROJETOS é dono; CONTRATOS define a '
  'regra. Aceite NUNCA é automatizado (§11) e fato aceito é imutável (§41).';

COMMENT ON COLUMN public.project_measurements.occurrence_state IS
  '`unresolved` é resposta legítima e primeira classe: a §15 proíbe deduzir a '
  'ocorrência pela data mais próxima. Ocorrência não resolvida não entra na '
  'unicidade determinística e não pode ser submetida.';

COMMENT ON COLUMN public.project_measurements.rule_snapshot IS
  'Instantâneo do que a regra DIZIA nesta ocorrência — fidelidade histórica, '
  'não segunda fonte de verdade. A verdade contratual segue em '
  'contract_measurement_requirements, com sua linhagem.';

-- ------------------------------------------------------------
-- 4) História de transição — SOMENTE ACRÉSCIMO
-- ------------------------------------------------------------
/*
  A §38 é literal: a história não é sobrescrita quando o estado muda. O
  `status` da linha acima é CACHE de leitura; a verdade auditável é esta
  tabela. Um status mutável sozinho não responde "quem aceitou", "quando
  voltou para correção" nem "o que a revisão anterior dizia" — e são
  exatamente essas as perguntas de uma auditoria de medição.
*/
CREATE TABLE public.project_measurement_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  measurement_id      uuid NOT NULL,
  from_state          text,
  to_state            text NOT NULL,
  transition          text NOT NULL CHECK (btrim(transition) <> ''),
  reason              text,
  -- Quem/o quê. `actor_source` distingue pessoa de sistema de parte externa —
  -- e é o que impede um relatório de apresentar rotina como decisão humana.
  actor_user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_source        text NOT NULL DEFAULT 'system'
                        CHECK (actor_source IN ('human','system','cron','external','integration')),
  actor_reference     text,
  provenance          jsonb NOT NULL DEFAULT '{}'::jsonb
                        CHECK (jsonb_typeof(provenance) = 'object'),
  correlation_id      uuid,
  domain_event_id     uuid,
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  recorded_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pmh_measurement_tenant FOREIGN KEY (organization_id, measurement_id)
    REFERENCES public.project_measurements (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT pmh_event_tenant FOREIGN KEY (organization_id, domain_event_id)
    REFERENCES public.domain_events (organization_id, id) ON DELETE SET NULL
);

CREATE INDEX pmh_measurement ON public.project_measurement_history (measurement_id, recorded_at);
CREATE INDEX pmh_org_recorded ON public.project_measurement_history (organization_id, recorded_at DESC);

-- Os dois gatilhos da 110, pela mesma razão da 115: recusar REESCRITA a todo
-- mundo, e recusar APAGAMENTO à aplicação sem impedir a exclusão de inquilino.
CREATE TRIGGER pmh_immutable BEFORE UPDATE ON public.project_measurement_history
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_mutation();
CREATE TRIGGER pmh_no_erasure BEFORE DELETE ON public.project_measurement_history
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

COMMENT ON TABLE public.project_measurement_history IS
  'Somente acréscimo. `project_measurements.status` é cache; a verdade é aqui.';

-- ------------------------------------------------------------
-- 5) Transições válidas
-- ------------------------------------------------------------
/*
  Ler a máquina de estados como tabela verdade é o que permite testá-la sem
  executar o produto. Três decisões merecem nome:

  · nenhum caminho leva a ACCEPTED que não venha de SUBMITTED ou UNDER_REVIEW.
    Evidência de execução não alcança o aceite por construção (§11, §45);
  · REJECTED e RETURNED_FOR_CORRECTION são estados DIFERENTES (§39). Devolvido
    volta para preparação; rejeitado é decisão negativa e só sai por supersessão;
  · ACCEPTED só vai para SUPERSEDED (§73). Não existe rollback de aceite.
*/
CREATE FUNCTION public.project_measurement_valid_transition(p_from text, p_to text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE p_from
    WHEN 'PLANNED'                 THEN p_to IN ('IN_PREPARATION','CANCELLED','SUPERSEDED')
    WHEN 'IN_PREPARATION'          THEN p_to IN ('READY_FOR_SUBMISSION','PLANNED','CANCELLED','SUPERSEDED')
    WHEN 'READY_FOR_SUBMISSION'    THEN p_to IN ('SUBMITTED','IN_PREPARATION','CANCELLED','SUPERSEDED')
    WHEN 'SUBMITTED'               THEN p_to IN ('UNDER_REVIEW','ACCEPTED','REJECTED','RETURNED_FOR_CORRECTION','CANCELLED')
    WHEN 'UNDER_REVIEW'            THEN p_to IN ('ACCEPTED','REJECTED','RETURNED_FOR_CORRECTION')
    WHEN 'RETURNED_FOR_CORRECTION' THEN p_to IN ('IN_PREPARATION','READY_FOR_SUBMISSION','CANCELLED','SUPERSEDED')
    WHEN 'REJECTED'                THEN p_to IN ('SUPERSEDED')
    WHEN 'ACCEPTED'                THEN p_to IN ('SUPERSEDED')
    WHEN 'CANCELLED'               THEN false
    WHEN 'SUPERSEDED'              THEN false
    ELSE false END
$$;

COMMENT ON FUNCTION public.project_measurement_valid_transition(text, text) IS
  'Tabela verdade da máquina de estados. ACCEPTED só sai por SUPERSEDED (§73); '
  'REJECTED e RETURNED_FOR_CORRECTION nunca se confundem (§39).';

-- ------------------------------------------------------------
-- 6) Transição + história na MESMA transação, e fato aceito imutável
-- ------------------------------------------------------------
/*
  A §41 lista o que é imutável depois do aceite: quantidade/valor aceitos,
  período, regra, projeto, proveniência do aceite, `accepted_at`. O gatilho
  abaixo recusa a alteração DELES, e permite exatamente uma mudança na linha
  aceita: a marcação de supersessão. É por isso que a lista é explícita em vez
  de um "recuse todo UPDATE" — congelar a linha inteira tornaria a reversão
  governada da §73 impossível, e aí a correção de um aceite errado só sairia
  por acesso direto ao banco.
*/
CREATE FUNCTION public.project_measurements_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  frozen_touched boolean;
BEGIN
  NEW.updated_at := now();

  IF OLD.status = 'ACCEPTED' THEN
    frozen_touched :=
         NEW.accepted_quantity      IS DISTINCT FROM OLD.accepted_quantity
      OR NEW.accepted_value         IS DISTINCT FROM OLD.accepted_value
      OR NEW.accepted_currency      IS DISTINCT FROM OLD.accepted_currency
      OR NEW.accepted_at            IS DISTINCT FROM OLD.accepted_at
      OR NEW.acceptance_source      IS DISTINCT FROM OLD.acceptance_source
      OR NEW.accepted_by_user_id    IS DISTINCT FROM OLD.accepted_by_user_id
      OR NEW.accepted_by_party_id   IS DISTINCT FROM OLD.accepted_by_party_id
      OR NEW.accepted_external_ref  IS DISTINCT FROM OLD.accepted_external_ref
      OR NEW.acceptance_document_id IS DISTINCT FROM OLD.acceptance_document_id
      OR NEW.quantity               IS DISTINCT FROM OLD.quantity
      OR NEW.measured_value         IS DISTINCT FROM OLD.measured_value
      OR NEW.currency               IS DISTINCT FROM OLD.currency
      OR NEW.unit                   IS DISTINCT FROM OLD.unit
      OR NEW.measurement_period_start IS DISTINCT FROM OLD.measurement_period_start
      OR NEW.measurement_period_end   IS DISTINCT FROM OLD.measurement_period_end
      OR NEW.contract_measurement_rule_id IS DISTINCT FROM OLD.contract_measurement_rule_id
      OR NEW.project_id             IS DISTINCT FROM OLD.project_id
      OR NEW.contract_id            IS DISTINCT FROM OLD.contract_id
      OR NEW.occurrence_key         IS DISTINCT FROM OLD.occurrence_key;

    IF frozen_touched THEN
      RAISE EXCEPTION
        'ACCEPTED_IMMUTABLE: medição aceita não é editada no lugar (§41). Use supersessão governada.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  IF NOT public.project_measurement_valid_transition(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: medição % -> % (instância %).', OLD.status, NEW.status, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  /*
    A história entra na MESMA transação do cache. Se este INSERT falhar, o
    UPDATE cai junto — que é a única forma de os dois nunca divergirem.

    `actor_source` é derivado do papel do banco, e não de um parâmetro: quem
    chama como `authenticated` com `auth.uid()` conhecido é gente; o resto é
    sistema. As RPCs da 133 sobrescrevem esta linha com a proveniência exata
    quando a têm (aceite externo, por exemplo).
  */
  INSERT INTO public.project_measurement_history
    (organization_id, measurement_id, from_state, to_state, transition,
     actor_user_id, actor_source, correlation_id)
  VALUES (NEW.organization_id, NEW.id, OLD.status, NEW.status,
          lower(OLD.status) || '_to_' || lower(NEW.status),
          auth.uid(),
          CASE WHEN auth.uid() IS NOT NULL THEN 'human' ELSE 'system' END,
          NEW.correlation_id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.project_measurements_guard() FROM PUBLIC;

CREATE TRIGGER pm_guard BEFORE UPDATE ON public.project_measurements
  FOR EACH ROW EXECUTE FUNCTION public.project_measurements_guard();

CREATE FUNCTION public.project_measurements_record_birth() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.project_measurement_history
    (organization_id, measurement_id, from_state, to_state, transition,
     actor_user_id, actor_source, correlation_id, provenance)
  VALUES (NEW.organization_id, NEW.id, NULL, NEW.status, 'created',
          auth.uid(),
          CASE WHEN auth.uid() IS NOT NULL THEN 'human' ELSE 'system' END,
          NEW.correlation_id,
          jsonb_build_object('origin', NEW.origin, 'revision', NEW.revision));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.project_measurements_record_birth() FROM PUBLIC;

CREATE TRIGGER pm_record_birth AFTER INSERT ON public.project_measurements
  FOR EACH ROW EXECUTE FUNCTION public.project_measurements_record_birth();

-- Medição é fato operacional. A 110 já proíbe apagar história de contrato; a
-- mesma proteção vale aqui, e pela mesma razão.
CREATE TRIGGER pm_no_erasure BEFORE DELETE ON public.project_measurements
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

-- ------------------------------------------------------------
-- 7) Impressão digital da medição (sujeito de aprovação, §64)
-- ------------------------------------------------------------
/*
  A §64 exige que o sujeito aprovado seja a REVISÃO EXATA, e não um contêiner
  mutável: se a medição mudar materialmente, a aprovação antiga não pode valer.
  A impressão digital cobre exatamente o material — quantidade, valor, moeda,
  período, regra, ocorrência e revisão. Mudar a nota de rodapé não invalida uma
  aprovação; mudar a quantidade invalida.
*/
CREATE FUNCTION public.project_measurement_fingerprint(p_measurement_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
  SELECT encode(extensions.digest(concat_ws('|',
    'project_measurement.v1',
    m.id::text, m.revision::text,
    m.contract_measurement_rule_id::text, m.occurrence_key,
    COALESCE(m.measurement_period_start::text,''), COALESCE(m.measurement_period_end::text,''),
    COALESCE(m.quantity::text,''), COALESCE(m.unit,''),
    COALESCE(m.measured_value::text,''), COALESCE(m.currency,''),
    m.measurement_basis, m.accumulation_mode
  )::bytea, 'sha256'), 'hex')
  FROM public.project_measurements m WHERE m.id = p_measurement_id
$$;
REVOKE ALL ON FUNCTION public.project_measurement_fingerprint(uuid) FROM PUBLIC;

-- ------------------------------------------------------------
-- 8) RLS e concessões — leitura pelo navegador, escrita pelo servidor
-- ------------------------------------------------------------
/*
  A §60 e a §63 mandam o mesmo: o navegador LÊ e não muta verdade governada.
  Então `authenticated` recebe SELECT (com RLS de inquilino e permissão) e
  NADA mais. Toda transição entra pelas RPCs da 133, que são as únicas que
  validam ator, estado e proveniência — e que emitem o evento na mesma
  transação. Sem esse desenho, `accepted_by = outra_pessoa` seria um UPDATE.
*/
ALTER TABLE public.project_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_measurement_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY pm_select ON public.project_measurements FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.current_user_has_permission('projects.measurements.view')
              OR public.current_user_has_permission('projects.view')
              OR public.current_user_has_permission('projects.view_all')
              OR public.current_user_is_admin()));

CREATE POLICY pmh_select ON public.project_measurement_history FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.current_user_has_permission('projects.measurements.view')
              OR public.current_user_has_permission('projects.view')
              OR public.current_user_has_permission('projects.view_all')
              OR public.current_user_is_admin()));

GRANT SELECT ON public.project_measurements TO authenticated;
GRANT SELECT ON public.project_measurement_history TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.project_measurements FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.project_measurement_history FROM authenticated, anon;
REVOKE ALL ON public.project_measurements FROM anon;
REVOKE ALL ON public.project_measurement_history FROM anon;

-- ------------------------------------------------------------
-- 9) Permissões do módulo
-- ------------------------------------------------------------
INSERT INTO public.permissions (key, module, action, description) VALUES
  ('projects.measurements.view',   'projects', 'measurements.view',   'Visualizar medições de projeto e sua prontidão'),
  ('projects.measurements.edit',   'projects', 'measurements.edit',   'Preparar o pacote de medição e vincular evidência'),
  ('projects.measurements.submit', 'projects', 'measurements.submit', 'Submeter medição para aceite'),
  ('projects.measurements.accept', 'projects', 'measurements.accept', 'Registrar aceite ou rejeição autoritativa de medição')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
 WHERE r.key = 'owner_admin' AND r.organization_id IS NULL
   AND p.key LIKE 'projects.measurements.%'
ON CONFLICT DO NOTHING;

/*
  Quem PREPARA e quem REGISTRA O ACEITE são papéis distintos, e a seed é onde
  essa distinção começa a existir.

  Engenharia/PCP monta o pacote e submete — é o trabalho dela. Registrar o
  aceite é ato de outra natureza: a §91 exige provar que quem preparou não
  decide, e uma seed que desse `accept` a engenharia_pcp tornaria essa prova
  impossível de escrever. `gestor_projetos` recebe o ciclo completo porque a
  §36 põe submissão, aceite e rejeição em Operações.

  Isto é atribuição de PAPEL, e não política de alçada. Alçada, quórum e
  aprovador nomeado seguem inexistentes — a §33 proíbe inventá-los.
*/
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
 WHERE r.key = 'engenharia_pcp' AND r.organization_id IS NULL
   AND p.key IN ('projects.measurements.view','projects.measurements.edit','projects.measurements.submit')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
 WHERE r.key = 'gestor_projetos' AND r.organization_id IS NULL
   AND p.key LIKE 'projects.measurements.%'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
 WHERE r.key IN ('ceo_diretoria','juridico_contratos','financeiro') AND r.organization_id IS NULL
   AND p.key = 'projects.measurements.view'
ON CONFLICT DO NOTHING;

COMMIT;
