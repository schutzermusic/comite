-- ============================================================================
-- 199 — INTELIGÊNCIA DOCUMENTAL COMPARTILHADA
--
-- ─── A regra que governa esta migration ──────────────────────────────────
--
-- "Do NOT build separate AI extraction systems for Contracts, Proposals and
-- Service Orders." Então NADA aqui é um segundo pipeline. O que existe —
-- `contract_onboarding_intakes` (166), `apex_jobs` (120), o ApexAIGateway e as
-- colunas de proveniência da 152 — passa a atender mais CONTEXTOS de
-- documento. A fila é a mesma, o job é o mesmo, o portão de IA é o mesmo, e a
-- prova de proveniência é a mesma.
--
-- ─── Por que o documento canônico muda de dono ───────────────────────────
--
-- `contract_documents` era a casa do arquivo original, e exigia contrato. Uma
-- proposta técnica não tem contrato, e uma OS interna também não. Duplicar a
-- tabela criaria um segundo registro do MESMO PDF — que é exatamente o que o
-- §9 proíbe ("never duplicate files", "reuse the same canonical document IDs").
--
-- Então o documento passa a pender do PAI: contrato quando há contrato,
-- engajamento quando não há. O id canônico não muda, o arquivo não se move, e
-- nenhum documento existente é tocado.
--
-- ─── O que a extração pode e o que não pode ──────────────────────────────
--
-- Pode: classificar, extrair, comparar, explicar, pré-preencher, recomendar.
-- Não pode: virar regra sozinha. Todo fato nasce `UNCONFIRMED`, e um fato sem
-- página e sem trecho literal nasce `UNANCHORED` — e fato não ancorado é
-- estruturalmente proibido de virar regra de medição ou condição de
-- faturamento. É assim que "never fabricate missing rules" deixa de ser
-- recomendação e vira constraint.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) O documento canônico passa a pender do pai neutro
-- ---------------------------------------------------------------------------
ALTER TABLE public.contract_documents
  ADD COLUMN IF NOT EXISTS engagement_id uuid;

ALTER TABLE public.contract_documents
  ALTER COLUMN contract_id DROP NOT NULL;

ALTER TABLE public.contract_documents
  ADD CONSTRAINT cdoc_engagement_tenant FOREIGN KEY (organization_id, engagement_id)
    REFERENCES public.commercial_engagements (organization_id, id) ON DELETE CASCADE,
  -- Documento órfão não existe: ou pende de um instrumento, ou do engajamento.
  ADD CONSTRAINT cdoc_has_parent CHECK (contract_id IS NOT NULL OR engagement_id IS NOT NULL);

-- Todo documento contratado já tem pai; o engajamento do contrato também vira
-- seu pai, para que a consulta por engajamento enxergue o acervo inteiro.
UPDATE public.contract_documents d
   SET engagement_id = c.engagement_id
  FROM public.contracts c
 WHERE c.id = d.contract_id AND c.organization_id = d.organization_id
   AND d.engagement_id IS NULL AND c.engagement_id IS NOT NULL;

-- Os contextos novos. A lista antiga permanece inteira: nenhum tipo sai.
ALTER TABLE public.contract_documents
  DROP CONSTRAINT contract_documents_document_type_check;
ALTER TABLE public.contract_documents
  ADD CONSTRAINT contract_documents_document_type_check CHECK (document_type IN (
    'contract','amendment','invoice','guarantee','insurance','annex','purchase_order',
    'certificate','approval','minutes',
    'technical_proposal','commercial_proposal','internal_service_order','customer_authorization'));

/*
  Arquivo igual não entra duas vezes no mesmo pai e mesmo papel.

  A 166 já fazia isso para `contract`. A mesma garantia vale para os papéis
  novos — e é o que sustenta "no duplicate documents" quando a mesma proposta
  é carregada de novo por engano.
*/
CREATE UNIQUE INDEX contract_documents_commercial_content_once
  ON public.contract_documents (organization_id, engagement_id, document_type, content_sha256)
  WHERE engagement_id IS NOT NULL AND content_sha256 IS NOT NULL
    AND superseded_by_document_id IS NULL
    AND document_type IN ('technical_proposal','commercial_proposal',
                          'internal_service_order','customer_authorization','purchase_order');

-- A leitura passa a enxergar o documento sem contrato, pela mesma chave do
-- módulo. Documento com contrato continua sujeito ao mesmo teste de sempre.
DROP POLICY contract_documents_select ON public.contract_documents;
CREATE POLICY contract_documents_select ON public.contract_documents FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND (
       (contract_id IS NOT NULL AND public.current_user_can_read_contract(contract_id))
       OR (contract_id IS NULL AND engagement_id IS NOT NULL
           AND public.current_user_has_permission('contracts.view'))
     ));

CREATE INDEX cdoc_engagement ON public.contract_documents (organization_id, engagement_id)
  WHERE engagement_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) A MESMA fila de ingestão, agora com contexto
-- ---------------------------------------------------------------------------
ALTER TABLE public.contract_onboarding_intakes
  ADD COLUMN IF NOT EXISTS document_context text NOT NULL DEFAULT 'FORMAL_CONTRACT',
  ADD COLUMN IF NOT EXISTS engagement_id uuid,
  ADD COLUMN IF NOT EXISTS subject_kind text,
  ADD COLUMN IF NOT EXISTS subject_id uuid,
  ADD COLUMN IF NOT EXISTS document_id uuid;

ALTER TABLE public.contract_onboarding_intakes
  ADD CONSTRAINT coni_context_check CHECK (document_context IN (
    'FORMAL_CONTRACT','TECHNICAL_PROPOSAL','COMMERCIAL_PROPOSAL',
    'CUSTOMER_PO','CUSTOMER_AUTHORIZATION','INTERNAL_SERVICE_ORDER','AMENDMENT')),
  ADD CONSTRAINT coni_subject_kind_check CHECK (subject_kind IS NULL OR subject_kind IN (
    'contract','proposal_revision','engagement_authorization','internal_service_order')),
  ADD CONSTRAINT coni_subject_pair CHECK ((subject_kind IS NULL) = (subject_id IS NULL)),
  ADD CONSTRAINT coni_engagement_tenant FOREIGN KEY (organization_id, engagement_id)
    REFERENCES public.commercial_engagements (organization_id, id) ON DELETE SET NULL,
  ADD CONSTRAINT coni_document_tenant FOREIGN KEY (organization_id, document_id)
    REFERENCES public.contract_documents (organization_id, id) ON DELETE SET NULL;

/*
  `REGISTERED` deixa de significar "virou contrato" e passa a significar "virou
  ALGUMA COISA governada". Contrato continua valendo pelo caminho de sempre;
  proposta e OS registram em `subject_kind`/`subject_id`.
*/
ALTER TABLE public.contract_onboarding_intakes
  DROP CONSTRAINT coni_registration_coherent;
ALTER TABLE public.contract_onboarding_intakes
  ADD CONSTRAINT coni_registration_coherent CHECK (
    (status = 'REGISTERED')
      = (registered_at IS NOT NULL AND (contract_id IS NOT NULL OR subject_id IS NOT NULL))),
  -- Contexto de contrato registra contrato; os demais registram sujeito.
  ADD CONSTRAINT coni_context_matches_subject CHECK (
    document_context <> 'FORMAL_CONTRACT' OR subject_kind IS NULL OR subject_kind = 'contract');

-- O mesmo PDF pode ser lido como papéis diferentes; não pode ser lido duas
-- vezes no MESMO papel pelo mesmo ator.
ALTER TABLE public.contract_onboarding_intakes
  DROP CONSTRAINT coni_content_actor_unique;
ALTER TABLE public.contract_onboarding_intakes
  ADD CONSTRAINT coni_content_actor_context_unique
    UNIQUE (organization_id, uploaded_by, content_sha256, document_context);

-- Quem lê a própria fila: a chave depende do contexto que ele subiu.
DROP POLICY coni_read_own ON public.contract_onboarding_intakes;
CREATE POLICY coni_read_own ON public.contract_onboarding_intakes FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND uploaded_by = auth.uid()
     AND (
       (document_context = 'FORMAL_CONTRACT' AND public.current_user_has_permission('contracts.create'))
       OR (document_context IN ('TECHNICAL_PROPOSAL','COMMERCIAL_PROPOSAL')
           AND public.current_user_has_permission('commercial.proposals.manage'))
       OR (document_context IN ('CUSTOMER_PO','CUSTOMER_AUTHORIZATION','INTERNAL_SERVICE_ORDER','AMENDMENT')
           AND public.current_user_has_permission('commercial.engagements.manage'))
     ));

CREATE INDEX coni_context ON public.contract_onboarding_intakes (organization_id, document_context, received_at DESC);

COMMENT ON COLUMN public.contract_onboarding_intakes.document_context IS
  'Papel do documento lido. A fila, o job e o gateway de IA são os mesmos para todos os contextos.';

-- ---------------------------------------------------------------------------
-- 3) Fatos extraídos — uma tabela para todos os contextos
--
-- Não há `proposal_facts` e `service_order_facts` separados pelo mesmo motivo
-- que não há dois pipelines: a pergunta de proveniência é idêntica em todos
-- ("de qual documento, de qual revisão, de qual página, com que confiança, e
-- quem confirmou?") e duas tabelas dariam duas respostas para ela.
-- ---------------------------------------------------------------------------
CREATE TABLE public.commercial_extracted_facts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  engagement_id       uuid,
  intake_id           uuid,
  document_id         uuid,
  document_context    text NOT NULL CHECK (document_context IN (
                        'FORMAL_CONTRACT','TECHNICAL_PROPOSAL','COMMERCIAL_PROPOSAL',
                        'CUSTOMER_PO','CUSTOMER_AUTHORIZATION','INTERNAL_SERVICE_ORDER','AMENDMENT')),
  subject_kind        text CHECK (subject_kind IS NULL OR subject_kind IN (
                        'contract','proposal_revision','engagement_authorization','internal_service_order')),
  subject_id          uuid,

  /*
    Os domínios são a união do que o §2 manda identificar.
    Proposta TÉCNICA:  SCOPE, DELIVERABLE, REQUIREMENT, EXCLUSION, DEPENDENCY,
                       TEST, DOCUMENT, DATE, MILESTONE, RESOURCE.
    Proposta COMERCIAL: VALUE, RATE, UNIT_PRICE, PAYMENT_TERM, MEASUREMENT_RULE,
                       BILLING_MILESTONE, BILLING_PREREQUISITE, VALIDITY,
                       ACCEPTANCE_CONDITION.
    O resto dos contextos reusa os mesmos domínios — um marco de faturamento
    num contrato e num pedido de compra são a mesma espécie de fato.
  */
  fact_domain         text NOT NULL CHECK (fact_domain IN (
                        'SCOPE','DELIVERABLE','REQUIREMENT','EXCLUSION','DEPENDENCY','TEST',
                        'DOCUMENT','DATE','MILESTONE','RESOURCE',
                        'VALUE','RATE','UNIT_PRICE','PAYMENT_TERM','MEASUREMENT_RULE',
                        'BILLING_MILESTONE','BILLING_PREREQUISITE','VALIDITY',
                        'ACCEPTANCE_CONDITION','RISK','OTHER')),
  fact_key            text,
  label               text NOT NULL CHECK (btrim(label) <> ''),
  value_text          text,
  value_numeric       numeric(18,4),
  value_date          date,
  unit                text,
  currency            text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb
                        CHECK (jsonb_typeof(payload) = 'object'),

  -- ---- proveniência ----
  source_revision     text,
  source_page         integer CHECK (source_page IS NULL OR source_page > 0),
  source_section      text,
  source_quote        text,
  confidence          numeric(5,4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),

  extraction_method   text NOT NULL CHECK (extraction_method IN ('ai','human','rule')),
  ai_provider         text,
  ai_model            text,
  ai_pipeline_version text,

  /*
    ANCHORED = tem página E trecho literal do documento. Só fato ancorado pode
    virar regra. Um fato que a IA "deduziu" sem apontar onde leu continua
    visível — mas o motor de promoção o recusa, e é por isso que a coluna é
    derivada por CHECK e não por convenção de código.
  */
  provenance_state    text NOT NULL DEFAULT 'UNANCHORED'
                        CHECK (provenance_state IN ('ANCHORED','UNANCHORED')),

  confirmation_state  text NOT NULL DEFAULT 'UNCONFIRMED'
                        CHECK (confirmation_state IN ('UNCONFIRMED','CONFIRMED','CORRECTED','REJECTED')),
  corrected_value     text,
  confirmed_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at        timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cef_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT cef_engagement_tenant FOREIGN KEY (organization_id, engagement_id)
    REFERENCES public.commercial_engagements (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT cef_intake_tenant FOREIGN KEY (organization_id, intake_id)
    REFERENCES public.contract_onboarding_intakes (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT cef_document_tenant FOREIGN KEY (organization_id, document_id)
    REFERENCES public.contract_documents (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT cef_subject_pair CHECK ((subject_kind IS NULL) = (subject_id IS NULL)),
  CONSTRAINT cef_ai_provenance CHECK (
    extraction_method <> 'ai'
    OR (ai_provider IS NOT NULL AND ai_model IS NOT NULL AND ai_pipeline_version IS NOT NULL)),
  CONSTRAINT cef_anchor_is_earned CHECK (
    (provenance_state = 'ANCHORED')
      = (source_page IS NOT NULL AND nullif(btrim(source_quote), '') IS NOT NULL)),
  CONSTRAINT cef_confirmation_is_attributed CHECK (
    (confirmation_state IN ('CONFIRMED','CORRECTED','REJECTED'))
      = (confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL)),
  CONSTRAINT cef_correction_has_value CHECK (
    confirmation_state <> 'CORRECTED' OR nullif(btrim(corrected_value), '') IS NOT NULL),
  CONSTRAINT cef_value_needs_currency CHECK (
    currency IS NULL OR value_numeric IS NOT NULL)
);
CREATE INDEX cef_engagement_domain
  ON public.commercial_extracted_facts (organization_id, engagement_id, fact_domain);
CREATE INDEX cef_subject ON public.commercial_extracted_facts (organization_id, subject_kind, subject_id);
CREATE INDEX cef_intake ON public.commercial_extracted_facts (organization_id, intake_id);

COMMENT ON TABLE public.commercial_extracted_facts IS
  'Fatos lidos de documento, com documento/revisão/página/trecho/confiança e estado de confirmação. '
  'Fato UNANCHORED nunca vira regra: ver commercial_fact_promotable.';

/*
  O portão único de promoção. Toda função que quiser transformar fato em regra
  de medição, condição de faturamento ou item de OS pergunta AQUI. Uma função
  só porque a regra é uma só, e espalhá-la por chamador a tornaria opcional.
*/
CREATE OR REPLACE FUNCTION public.commercial_fact_promotable(p_fact_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
    (SELECT f.provenance_state = 'ANCHORED'
        AND f.confirmation_state IN ('CONFIRMED','CORRECTED')
       FROM public.commercial_extracted_facts f
      WHERE f.id = p_fact_id),
    false);
$$;

COMMENT ON FUNCTION public.commercial_fact_promotable(uuid) IS
  'Verdadeiro só quando o fato tem âncora documental E confirmação humana. Fato de IA cru nunca vira regra.';

-- ---------------------------------------------------------------------------
-- 4) Blueprint de execução — CONTEXTO DE PLANEJAMENTO, e nada além disso
--
-- O §3 é explícito: antes da autorização do cliente, o blueprint NÃO pode
-- criar projeto, OS, medição, evento de faturamento, recebível ou receita
-- contratada. Aqui isso não é disciplina de código: o blueprint não tem FK
-- para nenhuma tabela de execução, e o gatilho abaixo recusa consumi-lo
-- enquanto não houver autorização ATIVA no engajamento.
-- ---------------------------------------------------------------------------
CREATE TABLE public.commercial_execution_blueprints (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  proposal_id          uuid NOT NULL,
  proposal_revision_id uuid NOT NULL,

  status               text NOT NULL DEFAULT 'DRAFT'
                         CHECK (status IN ('DRAFT','READY','CONSUMED','DISCARDED')),
  generated_by         text NOT NULL CHECK (generated_by IN ('ai','human')),
  ai_provider          text,
  ai_model             text,
  ai_pipeline_version  text,

  consumed_at          timestamptz,
  consumed_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Preenchido pela 200, quando a OS interna existir. Texto de referência e
  -- não FK: o blueprint não deve ser capaz de segurar uma OS por dependência.
  consumed_reference   text,
  discarded_at         timestamptz,

  created_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ceb_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT ceb_proposal_tenant FOREIGN KEY (organization_id, proposal_id)
    REFERENCES public.commercial_proposals (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT ceb_revision_tenant FOREIGN KEY (organization_id, proposal_revision_id)
    REFERENCES public.commercial_proposal_revisions (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT ceb_ai_provenance CHECK (
    generated_by <> 'ai' OR (ai_provider IS NOT NULL AND ai_model IS NOT NULL
                             AND ai_pipeline_version IS NOT NULL)),
  CONSTRAINT ceb_consumed_coherent CHECK (
    (status = 'CONSUMED') = (consumed_at IS NOT NULL AND consumed_by IS NOT NULL)),
  CONSTRAINT ceb_discarded_coherent CHECK ((status = 'DISCARDED') = (discarded_at IS NOT NULL))
);
CREATE INDEX ceb_revision ON public.commercial_execution_blueprints (organization_id, proposal_revision_id);

CREATE TABLE public.commercial_execution_blueprint_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  blueprint_id      uuid NOT NULL,

  category          text NOT NULL CHECK (category IN (
                      'SCOPE','DELIVERABLE','REQUIREMENT','MEASUREMENT_RULE','EVIDENCE_REQUIREMENT',
                      'DATE','DEPENDENCY','BILLING_CONDITION','RISK')),
  title             text NOT NULL CHECK (btrim(title) <> ''),
  detail            text,
  suggested_payload jsonb NOT NULL DEFAULT '{}'::jsonb
                      CHECK (jsonb_typeof(suggested_payload) = 'object'),
  source_fact_id    uuid,
  confidence        numeric(5,4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  state             text NOT NULL DEFAULT 'SUGGESTED'
                      CHECK (state IN ('SUGGESTED','ACCEPTED','REJECTED')),
  decided_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cebi_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT cebi_blueprint_tenant FOREIGN KEY (organization_id, blueprint_id)
    REFERENCES public.commercial_execution_blueprints (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT cebi_fact_tenant FOREIGN KEY (organization_id, source_fact_id)
    REFERENCES public.commercial_extracted_facts (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT cebi_decision_attributed CHECK (
    (state IN ('ACCEPTED','REJECTED')) = (decided_at IS NOT NULL AND decided_by IS NOT NULL))
);
CREATE INDEX cebi_blueprint ON public.commercial_execution_blueprint_items (organization_id, blueprint_id);

/*
  O PORTÃO DO §3, estrutural.

  Consumir um blueprint significa "este planejamento virou trabalho". Só pode
  acontecer quando a revisão está ACEITA e o engajamento tem autorização ATIVA.
  Sem isso, `CONSUMED` seria alcançável por um UPDATE, e o planejamento teria
  virado execução sem o cliente ter autorizado nada.
*/
CREATE OR REPLACE FUNCTION public.commercial_blueprint_consumption_gate()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_status text; v_authorized int;
BEGIN
  IF NEW.status <> 'CONSUMED' OR OLD.status = 'CONSUMED' THEN RETURN NEW; END IF;

  SELECT r.status INTO v_status
    FROM public.commercial_proposal_revisions r
   WHERE r.id = NEW.proposal_revision_id AND r.organization_id = NEW.organization_id;
  IF v_status IS DISTINCT FROM 'ACCEPTED' THEN
    RAISE EXCEPTION 'Blueprint cannot be consumed: proposal revision is %, not ACCEPTED.',
      COALESCE(v_status, 'missing') USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::int INTO v_authorized
    FROM public.commercial_engagement_authorizations a
   WHERE a.organization_id = NEW.organization_id
     AND a.proposal_revision_id = NEW.proposal_revision_id
     AND a.state = 'ACTIVE';
  IF v_authorized = 0 THEN
    RAISE EXCEPTION 'Blueprint cannot be consumed: no active engagement authorization for this revision.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER ceb_consumption_gate
  BEFORE UPDATE OF status ON public.commercial_execution_blueprints
  FOR EACH ROW EXECUTE FUNCTION public.commercial_blueprint_consumption_gate();

-- ---------------------------------------------------------------------------
-- 5) Gatilhos de updated_at, RLS e privilégios
-- ---------------------------------------------------------------------------
CREATE TRIGGER cef_touch BEFORE UPDATE ON public.commercial_extracted_facts
  FOR EACH ROW EXECUTE FUNCTION public.commercial_touch_updated_at();
CREATE TRIGGER ceb_touch BEFORE UPDATE ON public.commercial_execution_blueprints
  FOR EACH ROW EXECUTE FUNCTION public.commercial_touch_updated_at();

ALTER TABLE public.commercial_extracted_facts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_execution_blueprints        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_execution_blueprint_items   ENABLE ROW LEVEL SECURITY;

CREATE POLICY cef_select ON public.commercial_extracted_facts FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND (public.current_user_has_permission('commercial.view')
          OR public.current_user_has_permission('contracts.view')));
CREATE POLICY ceb_select ON public.commercial_execution_blueprints FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND public.current_user_has_permission('commercial.view'));
CREATE POLICY cebi_select ON public.commercial_execution_blueprint_items FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND public.current_user_has_permission('commercial.view'));

GRANT SELECT ON public.commercial_extracted_facts,
                public.commercial_execution_blueprints,
                public.commercial_execution_blueprint_items TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.commercial_extracted_facts,
       public.commercial_execution_blueprints, public.commercial_execution_blueprint_items
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.commercial_fact_promotable(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_fact_promotable(uuid) TO authenticated, service_role;

INSERT INTO public.permissions (key, module, action, description) VALUES
  ('commercial.documents.ingest', 'commercial', 'documents.ingest',
   'Carregar documento comercial para leitura assistida (proposta, pedido, autorização, OS interna)'),
  ('commercial.facts.confirm', 'commercial', 'facts.confirm',
   'Confirmar ou corrigir fato extraído de documento')
ON CONFLICT (key) DO NOTHING;

COMMIT;
