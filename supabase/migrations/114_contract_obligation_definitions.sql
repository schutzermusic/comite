-- ============================================================
-- CONTRACTS V2 — FASE 3 (1/3): definições de obrigação, partes, proveniência
-- Migration: 114_contract_obligation_definitions
--
-- ─── O que já existia, e por que não basta ─────────────────────────────────
--
-- `contract_obligations` existe desde a sala de controle (034) e é uma LISTA DE
-- TAREFAS: título, responsável interno, um `status` mutável, uma data de
-- vencimento já calculada e um campo de evidência em texto livre. Ela não
-- guarda por que a obrigação existe, quem é contratualmente responsável, quando
-- passa a valer, com que regra o prazo foi calculado, se repete, do que depende,
-- nem se bloqueia faturamento. As três linhas em produção são semeadas de QA,
-- todas `[QA]`, todas num contrato `demo`.
--
-- Ela NÃO é migrada destrutivamente e NÃO é apagada: as linhas continuam onde
-- estão, legíveis, e a 116 as marca como legado. Convertê-las exigiria inventar
-- proveniência e regra de prazo que ninguém registrou — exatamente o que a
-- arquitetura proíbe.
--
-- ─── A separação que sustenta o resto ──────────────────────────────────────
--
-- Definição é o que o contrato EXIGE. Instância é uma OCORRÊNCIA disso. Um
-- relatório mensal de segurança é uma definição e doze instâncias por ano; num
-- registro só, marcar setembro como entregue apagaria a exigência de outubro.
-- Esta migration traz a definição; a 115 traz a ocorrência.
--
-- ─── Ausência continua ausência ────────────────────────────────────────────
--
-- Quase toda coluna de regra aceita NULL, e NULL quer dizer "o contrato não
-- disse" — não "zero", não "não se aplica". `blocks_billing` é o caso mais
-- importante: ele é NULLABLE de propósito, porque um DEFAULT false afirmaria
-- que a obrigação não bloqueia faturamento sem que ninguém tenha lido o
-- contrato para saber.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1) Vocabulários
-- ------------------------------------------------------------
-- Funções em vez de ENUM: acrescentar um valor a um ENUM em produção trava a
-- tabela, e o vocabulário contratual ainda vai crescer. O CHECK abaixo é
-- gerado a partir delas, então a lista mora num lugar só.
CREATE FUNCTION public.contract_obligation_responsible_sides() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY[
  'contracting_organization',  -- a Insight / organização contratante
  'counterparty',              -- cliente / contraparte do instrumento
  'supplier',
  'third_party',
  'shared',
  'unknown'                    -- lido no contrato, mas o lado não ficou claro
] $$;

CREATE FUNCTION public.contract_obligation_party_roles() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY[
  'obligor', 'beneficiary', 'recipient', 'verifier', 'guarantor', 'insurer', 'other'
] $$;
COMMENT ON FUNCTION public.contract_obligation_party_roles() IS
  'Papéis RELATIVOS À OBRIGAÇÃO. Não confundir com public.party_roles, que é '
  'cadastro mestre da Party (cliente, fornecedor) e não relação contratual. '
  'Garantidor DO CONTRATO X não é um atributo da Party — é desta tabela.';

-- ------------------------------------------------------------
-- 2) Definição de obrigação
-- ------------------------------------------------------------
CREATE TABLE public.contract_obligation_definitions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id             uuid NOT NULL,

  title                   text NOT NULL CHECK (btrim(title) <> ''),
  requirement_text        text,
  category                text,
  responsible_side        text NOT NULL DEFAULT 'unknown',

  -- ---- proveniência: por que o Apex acredita que esta obrigação existe ----
  -- Nenhum caminho é obrigatório isoladamente, mas ao menos UM tem que existir:
  -- obrigação sem origem é afirmação sem fonte, e é o que esta fase existe para
  -- não produzir.
  source_clause_id        uuid,
  source_amendment_id     uuid,
  source_document_id      uuid,
  source_page             integer CHECK (source_page IS NULL OR source_page > 0),
  source_excerpt          text,

  -- ---- vigência ----
  -- NULL em `effective_from` é DESCONHECIDO, não "desde sempre". A 115 e o
  -- resolvedor tratam isso como não-comparável em vez de assumir uma data.
  effective_from          date,
  effective_to            date,

  -- ---- linhagem ----
  predecessor_id          uuid,
  change_effect           text CHECK (change_effect IS NULL OR change_effect IN ('added','altered','removed')),

  -- ---- ativação: quando a obrigação passa a ser aplicável ----
  activation_kind         text NOT NULL DEFAULT 'unspecified',
  activation_offset_days  integer,
  activation_fixed_date   date,
  -- Descritor TEXTUAL do gatilho contratual. A Fase 3 guarda o que o contrato
  -- diz; ela não consome barramento de evento — isso é Fase 4. Evento não
  -- observado não ativa nada.
  activation_event_text   text,

  -- ---- regra de prazo (a REGRA, não a data) ----
  due_kind                text NOT NULL DEFAULT 'unspecified',
  due_offset_days         integer,
  due_fixed_date          date,
  -- "5 dias úteis" sem calendário oficial não vira data. A regra fica conhecida
  -- e a data fica DESCONHECIDA — nunca contada como se fossem dias corridos.
  calendar_basis          text NOT NULL DEFAULT 'unspecified',

  -- ---- recorrência ----
  recurrence_kind         text NOT NULL DEFAULT 'one_time',
  recurrence_interval     integer CHECK (recurrence_interval IS NULL OR recurrence_interval > 0),
  recurrence_until        date,

  -- ---- consequência contratual ----
  -- NULLABLE de propósito: false afirmaria que não bloqueia faturamento sem que
  -- ninguém tenha lido o contrato. NULL é DESCONHECIDO, e o resolvedor o
  -- devolve como UNKNOWN em vez de FALSE.
  blocks_billing          boolean,

  status                  text NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','removed')),

  created_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  recorded_note           text,

  CONSTRAINT cod_org_id_unique UNIQUE (organization_id, id),
  -- Alvo de três colunas: quem referenciar uma definição carrega o contrato
  -- junto, e o banco recusa a linha que aponte para outro contrato. É o mesmo
  -- recurso que a fase 2 usou para cláusula e documento.
  CONSTRAINT cod_org_contract_id_unique UNIQUE (organization_id, contract_id, id),
  CONSTRAINT cod_contract_tenant FOREIGN KEY (organization_id, contract_id)
    REFERENCES public.contracts (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT cod_clause_tenant FOREIGN KEY (organization_id, contract_id, source_clause_id)
    REFERENCES public.contract_clauses (organization_id, contract_id, id) ON DELETE RESTRICT,
  CONSTRAINT cod_amendment_tenant FOREIGN KEY (organization_id, contract_id, source_amendment_id)
    REFERENCES public.contract_amendments (organization_id, contract_id, id) ON DELETE RESTRICT,
  CONSTRAINT cod_document_tenant FOREIGN KEY (organization_id, contract_id, source_document_id)
    REFERENCES public.contract_documents (organization_id, contract_id, id) ON DELETE RESTRICT,
  -- CASCADE, e não RESTRICT: quem impede a aplicação de apagar um antecessor é
  -- o gatilho `cod_no_erasure`, não esta ação. Deixá-la RESTRICT só faria a
  -- exclusão privilegiada de um inquilino depender da ORDEM em que o Postgres
  -- percorre a cascata — e essa exclusão precisa funcionar sempre.
  CONSTRAINT cod_predecessor_tenant FOREIGN KEY (organization_id, predecessor_id)
    REFERENCES public.contract_obligation_definitions (organization_id, id) ON DELETE CASCADE,

  CONSTRAINT cod_responsible_side CHECK (responsible_side = ANY (public.contract_obligation_responsible_sides())),
  CONSTRAINT cod_activation_kind CHECK (activation_kind IN
    ('contract_start','days_after_contract_start','days_before_contract_end','fixed_date','manual','external_event','unspecified')),
  CONSTRAINT cod_due_kind CHECK (due_kind IN
    ('fixed_date','days_after_activation','days_before_contract_end','same_day_as_activation','recurring','unspecified')),
  CONSTRAINT cod_calendar_basis CHECK (calendar_basis IN ('calendar_days','business_days','unspecified')),
  CONSTRAINT cod_recurrence_kind CHECK (recurrence_kind IN
    ('one_time','daily','weekly','monthly','quarterly','yearly','fixed_interval','custom')),

  -- Proveniência mínima: pelo menos um caminho de origem.
  CONSTRAINT cod_has_provenance CHECK (
    source_clause_id IS NOT NULL OR source_amendment_id IS NOT NULL OR source_document_id IS NOT NULL),
  -- Coerência entre regra e parâmetro: a regra que precisa de deslocamento tem
  -- que trazê-lo, e a que não precisa não pode trazer um deslocamento solto.
  CONSTRAINT cod_activation_offset CHECK (
    (activation_kind IN ('days_after_contract_start','days_before_contract_end')) = (activation_offset_days IS NOT NULL)),
  CONSTRAINT cod_activation_fixed CHECK (
    (activation_kind = 'fixed_date') = (activation_fixed_date IS NOT NULL)),
  CONSTRAINT cod_activation_event CHECK (
    activation_kind <> 'external_event' OR activation_event_text IS NOT NULL),
  CONSTRAINT cod_due_offset CHECK (
    (due_kind IN ('days_after_activation','days_before_contract_end')) = (due_offset_days IS NOT NULL)),
  CONSTRAINT cod_due_fixed CHECK ((due_kind = 'fixed_date') = (due_fixed_date IS NOT NULL)),
  CONSTRAINT cod_recurrence_interval CHECK (
    (recurrence_kind = 'fixed_interval') = (recurrence_interval IS NOT NULL)),
  CONSTRAINT cod_recurring_due CHECK (recurrence_kind = 'one_time' OR due_kind <> 'fixed_date'),
  CONSTRAINT cod_effective_order CHECK (
    effective_from IS NULL OR effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT cod_no_self_predecessor CHECK (predecessor_id IS DISTINCT FROM id)
);

CREATE INDEX cod_scope ON public.contract_obligation_definitions (organization_id, contract_id, effective_from, id);
CREATE INDEX cod_predecessor ON public.contract_obligation_definitions (predecessor_id) WHERE predecessor_id IS NOT NULL;
CREATE INDEX cod_blocking ON public.contract_obligation_definitions (organization_id, contract_id)
  WHERE blocks_billing IS NOT FALSE;
-- Um antecessor tem no máximo UM sucessor: dois sucessores tornariam o estado
-- atual ambíguo, e ambiguidade de linhagem é rejeitada, não resolvida por
-- desempate.
CREATE UNIQUE INDEX cod_one_successor ON public.contract_obligation_definitions (organization_id, predecessor_id)
  WHERE predecessor_id IS NOT NULL;

COMMENT ON COLUMN public.contract_obligation_definitions.blocks_billing IS
  'NULL = DESCONHECIDO (ninguém apurou), não "não bloqueia". O resolvedor '
  'devolve UNKNOWN nesse caso; nunca FALSE por omissão.';
COMMENT ON COLUMN public.contract_obligation_definitions.effective_from IS
  'NULL = data de vigência DESCONHECIDA. Estado afetado fica não-comparável em '
  'vez de assumir "desde sempre".';
COMMENT ON COLUMN public.contract_obligation_definitions.calendar_basis IS
  'business_days sem calendário oficial mantém a REGRA conhecida e a DATA '
  'desconhecida. Dia útil nunca é contado como dia corrido.';

-- ------------------------------------------------------------
-- 3) Partes contratuais da obrigação
-- ------------------------------------------------------------
-- Bilateral e multilateral: uma obrigação pode ter devedor, beneficiário,
-- verificador, seguradora e banco garantidor ao mesmo tempo.
--
-- Identidade canônica é opcional DE PROPÓSITO. Quando o contrato nomeia
-- "Seguradora XYZ" e não há Party provada, o texto é preservado e o vínculo
-- fica ausente. Casar por semelhança de nome é proibido: errar a identidade
-- jurídica de um garantidor é pior que não tê-la.
CREATE TABLE public.contract_obligation_parties (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  definition_id           uuid NOT NULL,
  role                    text NOT NULL,
  party_id                uuid,
  party_text              text,
  note                    text,
  created_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cop_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT cop_definition_tenant FOREIGN KEY (organization_id, definition_id)
    REFERENCES public.contract_obligation_definitions (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT cop_party_tenant FOREIGN KEY (organization_id, party_id)
    REFERENCES public.parties (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT cop_role CHECK (role = ANY (public.contract_obligation_party_roles())),
  -- Uma das duas pontas tem que existir: sem Party e sem texto não há parte.
  CONSTRAINT cop_identified CHECK (party_id IS NOT NULL OR btrim(coalesce(party_text,'')) <> ''),
  -- Mesmo papel, mesma Party, uma vez só.
  CONSTRAINT cop_unique_party_role UNIQUE (definition_id, role, party_id)
);
CREATE INDEX cop_definition ON public.contract_obligation_parties (organization_id, definition_id, role);

COMMENT ON TABLE public.contract_obligation_parties IS
  'Responsabilidade CONTRATUAL. Designação interna de time ou pessoa é '
  'coordenação operacional e vive noutro lugar — misturar as duas faria '
  '"quem tem que fazer" e "quem o contrato obriga" virarem a mesma coluna.';

-- ------------------------------------------------------------
-- 4) Linhagem: aditivo não reescreve exigência
-- ------------------------------------------------------------
CREATE FUNCTION public.contract_obligations_validate_lineage() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE parent public.contract_obligation_definitions%ROWTYPE;
BEGIN
  IF NEW.predecessor_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO parent FROM public.contract_obligation_definitions WHERE id = NEW.predecessor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Antecessor % não existe.', NEW.predecessor_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  -- A FK composta já garante o inquilino; o contrato é a segunda metade da
  -- coerência: uma obrigação não sucede outra de OUTRO contrato.
  IF parent.contract_id <> NEW.contract_id THEN
    RAISE EXCEPTION 'Linhagem entre contratos diferentes é recusada (% -> %).', parent.contract_id, NEW.contract_id
      USING ERRCODE = 'check_violation';
  END IF;
  -- Sucessão sem efeito declarado deixaria "o que mudou" por conta de quem lê.
  IF NEW.change_effect IS NULL THEN
    RAISE EXCEPTION 'Sucessão exige change_effect (added, altered ou removed).' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contract_obligations_validate_lineage() FROM PUBLIC;
CREATE TRIGGER cod_validate_lineage BEFORE INSERT ON public.contract_obligation_definitions
  FOR EACH ROW EXECUTE FUNCTION public.contract_obligations_validate_lineage();

-- A definição é verdade contratual: some-acréscimo. Um aditivo cria uma NOVA
-- definição apontando para a anterior; a anterior segue legível como era.
CREATE FUNCTION public.contract_obligations_reject_definition_rewrite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- `status` é o único campo que a supersessão legitimamente vira, e só no
  -- sentido que não apaga nada.
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.title IS NOT DISTINCT FROM OLD.title
     AND NEW.requirement_text IS NOT DISTINCT FROM OLD.requirement_text
     AND NEW.effective_from IS NOT DISTINCT FROM OLD.effective_from
     AND NEW.effective_to IS NOT DISTINCT FROM OLD.effective_to
     AND NEW.blocks_billing IS NOT DISTINCT FROM OLD.blocks_billing
     AND NEW.due_kind IS NOT DISTINCT FROM OLD.due_kind
     AND NEW.recurrence_kind IS NOT DISTINCT FROM OLD.recurrence_kind
     AND NEW.predecessor_id IS NOT DISTINCT FROM OLD.predecessor_id
     AND NEW.contract_id IS NOT DISTINCT FROM OLD.contract_id
     AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Definição de obrigação é histórica: crie uma sucessora em vez de reescrever (%).', OLD.id
    USING ERRCODE = 'restrict_violation';
END $$;
REVOKE ALL ON FUNCTION public.contract_obligations_reject_definition_rewrite() FROM PUBLIC;
CREATE TRIGGER cod_immutable BEFORE UPDATE ON public.contract_obligation_definitions
  FOR EACH ROW EXECUTE FUNCTION public.contract_obligations_reject_definition_rewrite();
-- Apagar segue a fronteira da 110: recusado à APLICAÇÃO, aberto ao caminho
-- privilegiado. Recusar a todo mundo tornaria impossível apagar um inquilino
-- inteiro — e essa possibilidade é requisito aprovado, não descuido.
CREATE TRIGGER cod_no_erasure BEFORE DELETE ON public.contract_obligation_definitions
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

CREATE TRIGGER cop_immutable BEFORE UPDATE ON public.contract_obligation_parties
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_mutation();

COMMIT;
