-- ============================================================
-- CONTRACTS V2 — FASE 3 (3/3): evidência, exceção, escalonamento,
--                              impacto financeiro, bloqueio de faturamento
-- Migration: 116_contract_obligation_evidence_and_boundaries
--
-- Fecha a fase com as quatro coisas que faltavam para o modelo responder
-- sozinho, e com a fronteira do legado.
--
-- ─── A distinção que mais custa quando se erra ─────────────────────────────
--
-- EXIGÊNCIA de evidência não é evidência. E evidência entregue não é evidência
-- ACEITA. Um relatório anexado prova que alguém anexou um arquivo; não prova
-- que o cliente o aceitou. Onde o contrato exige aceite formal, a instância só
-- é cumprida com o aceite — e o aceite formal é Fase 5, então aqui ele é
-- REPRESENTADO e fica pendente, não simulado.
--
-- ─── Dispensa não apaga obrigação ──────────────────────────────────────────
--
-- Uma dispensa é um objeto NOVO, com autoridade, motivo, vigência e
-- proveniência. A obrigação original continua lá, inteira. E uma dispensa
-- vencida volta a deixar a obrigação bloqueando — foi por isso que ela ganhou
-- data de fim.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1) Exigência de evidência (o que o contrato pede)
-- ------------------------------------------------------------
CREATE TABLE public.contract_obligation_evidence_requirements (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id             uuid NOT NULL,
  definition_id           uuid NOT NULL,
  requirement_text        text NOT NULL CHECK (btrim(requirement_text) <> ''),
  evidence_type           text,
  -- NULL = o contrato não disse quantos. Não é "um".
  required_count          integer CHECK (required_count IS NULL OR required_count > 0),
  -- NULL = não apurado. Um DEFAULT true tornaria obrigatória uma evidência que
  -- ninguém leu no contrato.
  mandatory               boolean,
  -- Quando true, ANEXAR não cumpre: é preciso aceite formal (Fase 5).
  requires_formal_acceptance boolean NOT NULL DEFAULT false,
  source_clause_id        uuid,
  source_page             integer CHECK (source_page IS NULL OR source_page > 0),
  source_excerpt          text,
  created_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT coer_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT coer_definition_tenant FOREIGN KEY (organization_id, contract_id, definition_id)
    REFERENCES public.contract_obligation_definitions (organization_id, contract_id, id) ON DELETE CASCADE,
  CONSTRAINT coer_clause_tenant FOREIGN KEY (organization_id, contract_id, source_clause_id)
    REFERENCES public.contract_clauses (organization_id, contract_id, id) ON DELETE RESTRICT
);
CREATE INDEX coer_definition ON public.contract_obligation_evidence_requirements (organization_id, definition_id);

-- ------------------------------------------------------------
-- 2) Evidência efetivamente apresentada
-- ------------------------------------------------------------
-- Aponta para o documento CANÔNICO de Contratos quando existe; texto livre é o
-- caminho de exceção, não a regra. Não duplica evidência de campo de
-- Projetos/Operações — aquilo é execução, isto é comprovação contratual.
CREATE TABLE public.contract_obligation_evidence (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id             uuid NOT NULL,
  instance_id             uuid NOT NULL,
  requirement_id          uuid,
  document_id             uuid,
  reference_text          text,
  -- Presença NÃO é aprovação. Este campo registra o que se sabe sobre o aceite,
  -- e `pending` é o estado honesto enquanto a Fase 5 não existir.
  acceptance_state        text NOT NULL DEFAULT 'not_required'
                            CHECK (acceptance_state IN ('not_required','pending','accepted','rejected')),
  accepted_at             timestamptz,
  accepted_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  provided_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  provided_at             timestamptz NOT NULL DEFAULT now(),
  note                    text,

  CONSTRAINT coe_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT coe_instance_tenant FOREIGN KEY (organization_id, contract_id, instance_id)
    REFERENCES public.contract_obligation_instances (organization_id, contract_id, id) ON DELETE CASCADE,
  CONSTRAINT coe_requirement_tenant FOREIGN KEY (organization_id, requirement_id)
    REFERENCES public.contract_obligation_evidence_requirements (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT coe_document_tenant FOREIGN KEY (organization_id, contract_id, document_id)
    REFERENCES public.contract_documents (organization_id, contract_id, id) ON DELETE RESTRICT,
  CONSTRAINT coe_identified CHECK (document_id IS NOT NULL OR btrim(coalesce(reference_text,'')) <> ''),
  CONSTRAINT coe_accepted_coherent CHECK (
    (acceptance_state = 'accepted') = (accepted_at IS NOT NULL AND accepted_by IS NOT NULL))
);
CREATE INDEX coe_instance ON public.contract_obligation_evidence (organization_id, instance_id);

CREATE TRIGGER coe_immutable BEFORE UPDATE OF organization_id, instance_id, document_id, provided_at
  ON public.contract_obligation_evidence FOR EACH ROW
  EXECUTE FUNCTION public.contracts_reject_history_mutation();

-- Uma exigência que pede aceite formal não pode nascer com a evidência já
-- aceita por omissão. O gatilho força o estado correto na entrada.
CREATE FUNCTION public.contract_obligations_evidence_acceptance_default() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE needs boolean;
BEGIN
  IF NEW.requirement_id IS NULL THEN RETURN NEW; END IF;
  SELECT requires_formal_acceptance INTO needs
    FROM public.contract_obligation_evidence_requirements WHERE id = NEW.requirement_id;
  IF needs IS TRUE AND NEW.acceptance_state = 'not_required' THEN
    NEW.acceptance_state := 'pending';
  END IF;
  IF needs IS NOT TRUE AND NEW.acceptance_state = 'pending' THEN
    RETURN NEW;  -- pedir aceite onde o contrato não exige é conservador, não errado
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contract_obligations_evidence_acceptance_default() FROM PUBLIC;
CREATE TRIGGER coe_acceptance_default BEFORE INSERT ON public.contract_obligation_evidence
  FOR EACH ROW EXECUTE FUNCTION public.contract_obligations_evidence_acceptance_default();

-- ------------------------------------------------------------
-- 3) Dispensa e exceção
-- ------------------------------------------------------------
CREATE TABLE public.contract_obligation_exceptions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id             uuid NOT NULL,
  definition_id           uuid,
  instance_id             uuid,
  kind                    text NOT NULL CHECK (kind IN ('waiver','exception')),
  reason                  text NOT NULL CHECK (btrim(reason) <> ''),
  scope                   text NOT NULL DEFAULT 'instance' CHECK (scope IN ('definition','instance')),
  effective_from          date,
  effective_to            date,
  -- Quem teve autoridade para dispensar, e onde isso está escrito. Sem os dois
  -- a dispensa não produz efeito — ver o gatilho adiante.
  authority_reference     text,
  source_document_id      uuid,
  source_amendment_id     uuid,
  -- Enquanto a Fase 5 não existe, uma dispensa que o contrato manda aprovar
  -- fica `pending` e NÃO suprime bloqueio nenhum.
  approval_state          text NOT NULL DEFAULT 'not_required'
                            CHECK (approval_state IN ('not_required','pending','approved','rejected')),
  recorded_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recorded_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT coex_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT coex_definition_tenant FOREIGN KEY (organization_id, contract_id, definition_id)
    REFERENCES public.contract_obligation_definitions (organization_id, contract_id, id) ON DELETE CASCADE,
  CONSTRAINT coex_instance_tenant FOREIGN KEY (organization_id, contract_id, instance_id)
    REFERENCES public.contract_obligation_instances (organization_id, contract_id, id) ON DELETE CASCADE,
  CONSTRAINT coex_document_tenant FOREIGN KEY (organization_id, contract_id, source_document_id)
    REFERENCES public.contract_documents (organization_id, contract_id, id) ON DELETE RESTRICT,
  CONSTRAINT coex_amendment_tenant FOREIGN KEY (organization_id, contract_id, source_amendment_id)
    REFERENCES public.contract_amendments (organization_id, contract_id, id) ON DELETE RESTRICT,
  CONSTRAINT coex_target CHECK (definition_id IS NOT NULL OR instance_id IS NOT NULL),
  CONSTRAINT coex_scope_target CHECK (
    (scope = 'definition' AND definition_id IS NOT NULL) OR (scope = 'instance' AND instance_id IS NOT NULL)),
  CONSTRAINT coex_period CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX coex_definition ON public.contract_obligation_exceptions (organization_id, definition_id);
CREATE INDEX coex_instance ON public.contract_obligation_exceptions (organization_id, instance_id);

CREATE TRIGGER coex_immutable BEFORE UPDATE OF organization_id, definition_id, instance_id, kind, scope
  ON public.contract_obligation_exceptions FOR EACH ROW
  EXECUTE FUNCTION public.contracts_reject_history_mutation();
CREATE TRIGGER coex_no_erasure BEFORE DELETE ON public.contract_obligation_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

/**
 * Uma dispensa produz efeito? Só quando TUDO abaixo é verdade ao mesmo tempo.
 * Qualquer resposta menos categórica deixaria uma obrigação parecer dispensada
 * por um documento que ninguém assinou.
 */
CREATE FUNCTION public.contract_obligation_exception_is_effective(
  p_exception public.contract_obligation_exceptions, p_as_of date
) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT
    -- autoridade PROVADA: referência explícita ou documento/aditivo de origem
    (btrim(coalesce(p_exception.authority_reference, '')) <> ''
      OR p_exception.source_document_id IS NOT NULL
      OR p_exception.source_amendment_id IS NOT NULL)
    -- aprovação pendente ou recusada não dispensa nada
    AND p_exception.approval_state IN ('not_required', 'approved')
    -- vigência: começou, e ainda não acabou
    AND (p_exception.effective_from IS NULL OR p_exception.effective_from <= p_as_of)
    AND (p_exception.effective_to   IS NULL OR p_exception.effective_to   >= p_as_of)
$$;

-- ------------------------------------------------------------
-- 4) Escalonamento — regra e estado, não notificação
-- ------------------------------------------------------------
-- A Fase 3 sabe DIZER que um escalonamento é aplicável. Quem avisa alguém é a
-- Fase 4. Nenhum cron é necessário para esta fase estar completa.
CREATE TABLE public.contract_obligation_escalation_rules (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  definition_id           uuid NOT NULL,
  trigger_kind            text NOT NULL CHECK (trigger_kind IN ('days_before_due','on_due_date','days_after_due')),
  offset_days             integer CHECK (offset_days IS NULL OR offset_days >= 0),
  severity                text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  target_role             text,
  target_side             text,
  note                    text,
  created_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT coesc_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT coesc_definition_tenant FOREIGN KEY (organization_id, definition_id)
    REFERENCES public.contract_obligation_definitions (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT coesc_offset CHECK ((trigger_kind = 'on_due_date') = (offset_days IS NULL)),
  CONSTRAINT coesc_side CHECK (target_side IS NULL OR target_side = ANY (public.contract_obligation_responsible_sides())),
  CONSTRAINT coesc_unique UNIQUE (definition_id, trigger_kind, offset_days)
);
CREATE INDEX coesc_definition ON public.contract_obligation_escalation_rules (organization_id, definition_id);

-- ------------------------------------------------------------
-- 5) Impacto financeiro CONTRATUAL
-- ------------------------------------------------------------
-- Consequência prevista no contrato. Não é lançamento, não é título, não é
-- glosa realizada. Finanças continua dona do razão: impacto POTENCIAL não é
-- contabilidade, e escrevê-lo como se fosse seria fabricar dívida.
CREATE TABLE public.contract_obligation_financial_impacts (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id             uuid NOT NULL,
  definition_id           uuid NOT NULL,
  -- `rule` é o que o contrato prevê; `occurrence` é a constatação de que o
  -- gatilho aconteceu. As duas coisas na mesma tabela, distinguidas por esta
  -- coluna, porque a segunda só existe em relação à primeira.
  record_kind             text NOT NULL DEFAULT 'rule' CHECK (record_kind IN ('rule','occurrence')),
  instance_id             uuid,
  impact_type             text NOT NULL CHECK (impact_type IN
                            ('penalty','withholding','billing_block','liquidated_damages','service_credit','other')),
  fixed_amount            numeric(18,2) CHECK (fixed_amount IS NULL OR fixed_amount >= 0),
  percentage              numeric(9,4) CHECK (percentage IS NULL OR (percentage >= 0 AND percentage <= 100)),
  currency                text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  basis_text              text,
  source_clause_id        uuid,
  source_page             integer CHECK (source_page IS NULL OR source_page > 0),
  recorded_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recorded_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cofi_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT cofi_definition_tenant FOREIGN KEY (organization_id, contract_id, definition_id)
    REFERENCES public.contract_obligation_definitions (organization_id, contract_id, id) ON DELETE CASCADE,
  CONSTRAINT cofi_instance_tenant FOREIGN KEY (organization_id, contract_id, instance_id)
    REFERENCES public.contract_obligation_instances (organization_id, contract_id, id) ON DELETE CASCADE,
  CONSTRAINT cofi_clause_tenant FOREIGN KEY (organization_id, contract_id, source_clause_id)
    REFERENCES public.contract_clauses (organization_id, contract_id, id) ON DELETE RESTRICT,
  CONSTRAINT cofi_occurrence_target CHECK ((record_kind = 'occurrence') = (instance_id IS NOT NULL)),
  -- Valor sem moeda é número sem unidade.
  CONSTRAINT cofi_currency_with_amount CHECK (fixed_amount IS NULL OR currency IS NOT NULL)
);
CREATE INDEX cofi_definition ON public.contract_obligation_financial_impacts (organization_id, definition_id);

-- ------------------------------------------------------------
-- 6) RLS e privilégios
-- ------------------------------------------------------------
-- Leitura por inquilino, respeitando a mesma regra de leitura de contrato que
-- o restante do módulo já usa. Escrita passa pelo service role, onde o RBAC das
-- rotas decide. TRUNCATE é revogado explicitamente: ele NÃO é filtrado por RLS,
-- e o padrão do schema o concede a todo mundo.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'contract_obligation_definitions','contract_obligation_parties',
    'contract_obligation_instances','contract_obligation_instance_history',
    'contract_obligation_dependencies','contract_obligation_instance_dependencies',
    'contract_obligation_evidence_requirements','contract_obligation_evidence',
    'contract_obligation_exceptions','contract_obligation_escalation_rules',
    'contract_obligation_financial_impacts']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (organization_id = public.current_user_organization_id())',
                   t || '_read', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM authenticated, anon', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 7) A lista de tarefas legada
-- ------------------------------------------------------------
-- `contract_obligations` NÃO é migrada nem apagada. As linhas continuam
-- legíveis; converter cada uma exigiria inventar a proveniência e a regra de
-- prazo que ninguém registrou.
--
-- O que muda é a fronteira: ela deixa de ser gravável pelo navegador e passa a
-- se declarar legado. Enquanto ela aceitava INSERT/UPDATE/DELETE direto do
-- cliente, existiam dois lugares para registrar a mesma obrigação e nenhuma
-- forma de dizer qual estava certo.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.contract_obligations FROM authenticated, anon;

COMMENT ON TABLE public.contract_obligations IS
  'LEGADO — lista de tarefas operacional anterior à Fase 3, preservada como '
  'histórico. A verdade contratual passou a ser contract_obligation_definitions '
  '(o que o contrato exige) + contract_obligation_instances (cada ocorrência). '
  'Não é migrada: converter estas linhas exigiria inventar proveniência e regra '
  'de prazo que nunca foram registradas. Somente leitura para a aplicação.';

COMMIT;
