-- ============================================================================
-- 198 — COMERCIAL: contas, contatos, oportunidades, propostas, forecast
--
-- ─── O recorte ───────────────────────────────────────────────────────────
--
-- Não é CRM. É o mínimo para que o trabalho que a Insight vende chegue à
-- execução com origem rastreável: quem é o cliente, o que se discutiu, o que
-- foi proposto, qual revisão o cliente aceitou — e só ela alimenta execução.
--
-- ─── O que NÃO ganha tabela ──────────────────────────────────────────────
--
-- CONTA não ganha tabela. `parties` já é o cadastro canônico de contraparte do
-- inquilino, com documento normalizado e papéis em `party_roles`. Criar
-- `commercial_accounts` ao lado produziria dois cadastros do mesmo cliente e
-- duas respostas para "quem é a contraparte deste contrato".
--
-- FOLLOW-UP não ganha tabela. `apex_followups` já é o motor de cobrança com
-- verificação, cadência, escalonamento e autoridade humana (156/157/162/163).
-- Oportunidade e proposta entram nele como mais um `source_kind`.
--
-- ─── A revisão é a unidade ───────────────────────────────────────────────
--
-- A proposta é o DOSSIÊ; a REVISÃO é o que tem valor, prazo, condição e
-- estado. O cliente não aceita "a proposta": aceita a revisão 3. Sem essa
-- separação, aceitar depois de renegociar sobrescreveria o que foi proposto
-- antes, e a pergunta "sob que termos isto foi vendido?" ficaria sem resposta.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Contatos — a pessoa dentro da conta
-- ---------------------------------------------------------------------------
CREATE TABLE public.commercial_contacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  party_id        uuid NOT NULL,
  full_name       text NOT NULL CHECK (btrim(full_name) <> ''),
  role_title      text,
  email           text CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  phone           text,
  is_primary      boolean NOT NULL DEFAULT false,
  active          boolean NOT NULL DEFAULT true,
  notes           text,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cc_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT cc_party_tenant FOREIGN KEY (organization_id, party_id)
    REFERENCES public.parties (organization_id, id) ON DELETE CASCADE
);
-- Um contato principal por conta — a caixa de "para quem mando a proposta"
-- não pode ter duas respostas.
CREATE UNIQUE INDEX cc_one_primary_per_party
  ON public.commercial_contacts (organization_id, party_id)
  WHERE is_primary AND active;
CREATE INDEX cc_party ON public.commercial_contacts (organization_id, party_id);

-- ---------------------------------------------------------------------------
-- 2) Oportunidades
-- ---------------------------------------------------------------------------
CREATE TABLE public.commercial_opportunities (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code                text CHECK (code IS NULL OR btrim(code) <> ''),
  title               text NOT NULL CHECK (btrim(title) <> ''),

  party_id            uuid,
  -- Desnormalizado de propósito: a oportunidade nasce antes do cadastro da
  -- contraparte existir, e exigir `parties` para registrar uma conversa
  -- empurraria o time a cadastrar cliente com dado inventado.
  counterparty_name   text NOT NULL CHECK (btrim(counterparty_name) <> ''),
  primary_contact_id  uuid,

  stage               text NOT NULL DEFAULT 'QUALIFICATION'
                        CHECK (stage IN ('QUALIFICATION','DISCOVERY','PROPOSAL',
                                         'NEGOTIATION','WON','LOST','ABANDONED')),
  estimated_value     numeric(18,2),
  currency            text NOT NULL DEFAULT 'BRL' CHECK (currency ~ '^[A-Z]{3}$'),
  -- Probabilidade é JUÍZO humano, não um número derivado do estágio. O forecast
  -- pondera por ela quando existe e cai para a faixa do estágio quando não.
  probability         numeric(5,4) CHECK (probability IS NULL OR (probability >= 0 AND probability <= 1)),
  expected_decision_date date,
  source              text,

  owner_user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  lost_reason         text,
  closed_at           timestamptz,

  -- Preenchido quando o ganho virou trabalho autorizado. NULL em WON ainda não
  -- convertido — e essa diferença é exatamente o que a autonomia sinaliza.
  engagement_id       uuid,

  notes               text,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT co_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT co_party_tenant FOREIGN KEY (organization_id, party_id)
    REFERENCES public.parties (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT co_contact_tenant FOREIGN KEY (organization_id, primary_contact_id)
    REFERENCES public.commercial_contacts (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT co_engagement_tenant FOREIGN KEY (organization_id, engagement_id)
    REFERENCES public.commercial_engagements (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT co_closed_coherent CHECK (
    (stage IN ('WON','LOST','ABANDONED')) = (closed_at IS NOT NULL)),
  CONSTRAINT co_lost_reason_scope CHECK (
    lost_reason IS NULL OR stage IN ('LOST','ABANDONED')),
  CONSTRAINT co_value_needs_currency CHECK (estimated_value IS NULL OR currency IS NOT NULL)
);
CREATE UNIQUE INDEX co_code_unique ON public.commercial_opportunities (organization_id, code)
  WHERE code IS NOT NULL;
CREATE INDEX co_org_stage ON public.commercial_opportunities (organization_id, stage);
CREATE INDEX co_org_decision ON public.commercial_opportunities (organization_id, expected_decision_date);

-- ---------------------------------------------------------------------------
-- 3) Propostas — o dossiê
-- ---------------------------------------------------------------------------
CREATE TABLE public.commercial_proposals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id    uuid,

  proposal_number   text NOT NULL CHECK (btrim(proposal_number) <> ''),
  /*
    TÉCNICA e COMERCIAL são documentos diferentes com perguntas diferentes —
    escopo/entregáveis de um lado, preço/condição de faturamento do outro — e
    a extração de cada um busca coisas distintas (§2). `COMBINED` existe porque
    a realidade também manda o par num PDF só, e fingir que são dois arquivos
    criaria um documento que não existe.
  */
  kind              text NOT NULL CHECK (kind IN ('TECHNICAL','COMMERCIAL','COMBINED')),
  title             text NOT NULL CHECK (btrim(title) <> ''),

  party_id          uuid,
  counterparty_name text NOT NULL CHECK (btrim(counterparty_name) <> ''),
  currency          text NOT NULL DEFAULT 'BRL' CHECK (currency ~ '^[A-Z]{3}$'),
  owner_user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cp_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT cp_number_unique UNIQUE (organization_id, proposal_number),
  CONSTRAINT cp_opportunity_tenant FOREIGN KEY (organization_id, opportunity_id)
    REFERENCES public.commercial_opportunities (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT cp_party_tenant FOREIGN KEY (organization_id, party_id)
    REFERENCES public.parties (organization_id, id) ON DELETE SET NULL
);
CREATE INDEX cp_org_recent ON public.commercial_proposals (organization_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 4) Revisões — o que realmente foi proposto, e o que foi aceito
-- ---------------------------------------------------------------------------
CREATE TABLE public.commercial_proposal_revisions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  proposal_id       uuid NOT NULL,
  revision          integer NOT NULL CHECK (revision > 0),

  status            text NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT','INTERNAL_REVIEW','INTERNALLY_APPROVED',
                                        'SENT','NEGOTIATION','ACCEPTED','REJECTED',
                                        'EXPIRED','WITHDRAWN','SUPERSEDED')),

  total_value       numeric(18,2),
  currency          text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  validity_until    date,
  payment_terms     text,
  scope_summary     text,
  -- Condições que o cliente precisa cumprir para o aceite valer. Texto, porque
  -- é o que o documento diz; a versão estruturada vive nos fatos extraídos.
  acceptance_conditions text,

  -- PDF canônico. O MESMO `contract_documents` do resto da plataforma: um
  -- arquivo, um id, nenhuma cópia (§9).
  document_id       uuid,

  -- ---- carimbos de cada passagem ----
  internal_review_at      timestamptz,
  internally_approved_at  timestamptz,
  internally_approved_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_at                 timestamptz,
  sent_by                 uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  negotiation_at          timestamptz,

  /*
    ACEITE É DO CLIENTE. O sistema nunca aceita por ele, e a IA muito menos.
    `accepted_at` sempre vem acompanhado de:
      • `acceptance_source` — como o cliente se manifestou;
      • `recorded_by`       — o humano da Insight que REGISTROU a manifestação.
    `recorded_by` não é "quem aceitou": é quem responde pelo registro. Sem essa
    distinção, um aceite registrado por integração ficaria indistinguível de
    um aceite fabricado.
  */
  accepted_at             timestamptz,
  acceptance_source       text CHECK (acceptance_source IS NULL OR acceptance_source IN
                            ('signed_document','customer_email','customer_portal',
                             'purchase_order','meeting_minutes','integration')),
  acceptance_document_id  uuid,
  acceptance_external_ref text,
  acceptance_note         text,
  recorded_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  rejected_at             timestamptz,
  rejection_reason        text,
  expired_at              timestamptz,
  withdrawn_at            timestamptz,
  superseded_at           timestamptz,
  supersedes_id           uuid,
  superseded_by_id        uuid,

  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cpr_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT cpr_revision_unique UNIQUE (organization_id, proposal_id, revision),
  CONSTRAINT cpr_proposal_tenant FOREIGN KEY (organization_id, proposal_id)
    REFERENCES public.commercial_proposals (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT cpr_document_tenant FOREIGN KEY (organization_id, document_id)
    REFERENCES public.contract_documents (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT cpr_acceptance_document_tenant FOREIGN KEY (organization_id, acceptance_document_id)
    REFERENCES public.contract_documents (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT cpr_no_self_supersede CHECK (supersedes_id IS DISTINCT FROM id),

  CONSTRAINT cpr_value_needs_currency CHECK (total_value IS NULL OR currency IS NOT NULL),
  CONSTRAINT cpr_accepted_coherent CHECK (
    (status = 'ACCEPTED') = (accepted_at IS NOT NULL)),
  CONSTRAINT cpr_acceptance_is_attributed CHECK (
    accepted_at IS NULL OR (acceptance_source IS NOT NULL AND recorded_by IS NOT NULL)),
  -- Aceite sem valor não pode autorizar execução: o §11 pergunta "temos direito
  -- comercial governado de faturar?", e sem valor a resposta não existe.
  CONSTRAINT cpr_acceptance_has_value CHECK (
    status <> 'ACCEPTED' OR (total_value IS NOT NULL AND currency IS NOT NULL)),
  CONSTRAINT cpr_rejected_coherent CHECK ((status = 'REJECTED') = (rejected_at IS NOT NULL)),
  CONSTRAINT cpr_expired_coherent CHECK ((status = 'EXPIRED') = (expired_at IS NOT NULL)),
  CONSTRAINT cpr_withdrawn_coherent CHECK ((status = 'WITHDRAWN') = (withdrawn_at IS NOT NULL)),
  CONSTRAINT cpr_superseded_coherent CHECK ((status = 'SUPERSEDED') = (superseded_at IS NOT NULL)),
  CONSTRAINT cpr_sent_is_internally_approved CHECK (
    status NOT IN ('SENT','NEGOTIATION','ACCEPTED','REJECTED','EXPIRED')
    OR internally_approved_at IS NOT NULL)
);

/*
  UMA revisão aceita por proposta. É a regra do §1: "only the accepted/governing
  revision may feed execution". Duas aceitas fariam a execução escolher entre
  dois preços, e a escolha cairia na ordenação da consulta.
*/
CREATE UNIQUE INDEX cpr_one_accepted_per_proposal
  ON public.commercial_proposal_revisions (organization_id, proposal_id)
  WHERE status = 'ACCEPTED';
CREATE INDEX cpr_proposal ON public.commercial_proposal_revisions (organization_id, proposal_id);
CREATE INDEX cpr_status ON public.commercial_proposal_revisions (organization_id, status);

-- A autorização por proposta (197) aponta para a REVISÃO, e agora a FK existe.
ALTER TABLE public.commercial_engagement_authorizations
  ADD CONSTRAINT cea_proposal_revision_tenant
    FOREIGN KEY (organization_id, proposal_revision_id)
    REFERENCES public.commercial_proposal_revisions (organization_id, id) ON DELETE RESTRICT;

/*
  E o portão estrutural do §3: só revisão ACEITA autoriza execução.

  Um CHECK não alcança outra tabela, então é gatilho — e ele roda em INSERT e
  em UPDATE, porque rebaixar a revisão depois de ela já reger seria o mesmo
  furo pela porta dos fundos.
*/
CREATE OR REPLACE FUNCTION public.commercial_authorization_requires_accepted_revision()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_status text;
BEGIN
  IF NEW.proposal_revision_id IS NULL THEN RETURN NEW; END IF;
  SELECT status INTO v_status FROM public.commercial_proposal_revisions
   WHERE id = NEW.proposal_revision_id AND organization_id = NEW.organization_id;
  IF v_status IS DISTINCT FROM 'ACCEPTED' THEN
    RAISE EXCEPTION 'Proposal revision % is % — only an ACCEPTED revision may authorize execution.',
      NEW.proposal_revision_id, COALESCE(v_status, 'missing') USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER cea_proposal_must_be_accepted
  BEFORE INSERT OR UPDATE OF proposal_revision_id
  ON public.commercial_engagement_authorizations
  FOR EACH ROW EXECUTE FUNCTION public.commercial_authorization_requires_accepted_revision();

-- ---------------------------------------------------------------------------
-- 5) Follow-ups: nenhuma tabela nova
--
-- Os papéis comerciais entram no motor de acompanhamento que já existe. O
-- vocabulário de origem é da 156 e vive em `apex_followup_source_kinds()`,
-- cobrado pela constraint `af_source_kind` — uma autoridade só.
--
-- Uma versão anterior desta migration criava aqui uma SEGUNDA constraint com
-- a lista escrita à mão, e a lista discordava da função: os papéis comerciais
-- entravam e `'contract'` saía. A 206 desfaz isso e é quem acrescenta os
-- papéis, no lugar certo. Este bloco fica sem SQL de propósito — o comentário
-- é o que impede alguém de "consertar" de volta.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 6) Forecast — DERIVADO, nunca armazenado
--
-- Guardar forecast criaria um número que envelhece sozinho e que ninguém sabe
-- recalcular. A visão pondera o que existe: oportunidade aberta pela
-- probabilidade informada (ou pela faixa do estágio, quando não informada) e
-- proposta enviada/em negociação pelo valor da revisão regente.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.commercial_forecast_read_model
WITH (security_invoker = true) AS
WITH stage_default AS (
  SELECT * FROM (VALUES
    ('QUALIFICATION', 0.10::numeric), ('DISCOVERY', 0.25::numeric),
    ('PROPOSAL', 0.45::numeric), ('NEGOTIATION', 0.70::numeric)
  ) AS t(stage, p)
)
SELECT
  o.organization_id,
  o.id                                   AS opportunity_id,
  o.code, o.title, o.counterparty_name, o.party_id,
  o.stage, o.currency,
  o.estimated_value,
  o.probability                          AS informed_probability,
  COALESCE(o.probability, sd.p)          AS applied_probability,
  -- `probability_source` existe para a tela nunca apresentar palpite de faixa
  -- como se fosse juízo de alguém.
  CASE WHEN o.probability IS NOT NULL THEN 'informed' ELSE 'stage_default' END
                                         AS probability_source,
  round(COALESCE(o.estimated_value, 0) * COALESCE(o.probability, sd.p, 0), 2)
                                         AS weighted_value,
  o.expected_decision_date,
  o.owner_user_id,
  o.engagement_id,
  (SELECT count(*)::int FROM public.commercial_proposals p
    WHERE p.opportunity_id = o.id)       AS proposal_count,
  (SELECT count(*)::int FROM public.commercial_proposals p
     JOIN public.commercial_proposal_revisions r
       ON r.proposal_id = p.id AND r.organization_id = p.organization_id
    WHERE p.opportunity_id = o.id AND r.status = 'ACCEPTED')
                                         AS accepted_revision_count
FROM public.commercial_opportunities o
LEFT JOIN stage_default sd ON sd.stage = o.stage
WHERE o.stage NOT IN ('WON','LOST','ABANDONED');

COMMENT ON VIEW public.commercial_forecast_read_model IS
  'Forecast ponderado, derivado. Nada aqui é persistido nem alimenta receita contratada.';

-- ---------------------------------------------------------------------------
-- 7) Gatilhos de updated_at
-- ---------------------------------------------------------------------------
CREATE TRIGGER cc_touch  BEFORE UPDATE ON public.commercial_contacts
  FOR EACH ROW EXECUTE FUNCTION public.commercial_touch_updated_at();
CREATE TRIGGER co_touch  BEFORE UPDATE ON public.commercial_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.commercial_touch_updated_at();
CREATE TRIGGER cp_touch  BEFORE UPDATE ON public.commercial_proposals
  FOR EACH ROW EXECUTE FUNCTION public.commercial_touch_updated_at();
CREATE TRIGGER cpr_touch BEFORE UPDATE ON public.commercial_proposal_revisions
  FOR EACH ROW EXECUTE FUNCTION public.commercial_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 8) RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.commercial_contacts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_opportunities        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_proposals            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_proposal_revisions   ENABLE ROW LEVEL SECURITY;

CREATE POLICY cc_select ON public.commercial_contacts FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND public.current_user_has_permission('commercial.view'));
CREATE POLICY co_select ON public.commercial_opportunities FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND public.current_user_has_permission('commercial.view'));
CREATE POLICY cp_select ON public.commercial_proposals FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND public.current_user_has_permission('commercial.view'));
CREATE POLICY cpr_select ON public.commercial_proposal_revisions FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND public.current_user_has_permission('commercial.view'));

GRANT SELECT ON public.commercial_contacts, public.commercial_opportunities,
                public.commercial_proposals, public.commercial_proposal_revisions,
                public.commercial_forecast_read_model TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.commercial_contacts,
       public.commercial_opportunities, public.commercial_proposals,
       public.commercial_proposal_revisions FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9) Permissões
--
-- Nenhuma é atribuída a papel aqui, pelo mesmo motivo da 192: alçada é decisão
-- de quem administra o inquilino.
-- ---------------------------------------------------------------------------
INSERT INTO public.permissions (key, module, action, description) VALUES
  ('commercial.view', 'commercial', 'view',
   'Ver contas, contatos, oportunidades, propostas e forecast'),
  ('commercial.manage', 'commercial', 'manage',
   'Criar e editar contas, contatos e oportunidades'),
  ('commercial.proposals.manage', 'commercial', 'proposals.manage',
   'Criar propostas e revisões'),
  ('commercial.proposals.approve_internal', 'commercial', 'proposals.approve_internal',
   'Aprovar internamente uma revisão de proposta antes do envio ao cliente'),
  ('commercial.proposals.record_acceptance', 'commercial', 'proposals.record_acceptance',
   'Registrar a manifestação do cliente (aceite, recusa, expiração) sobre uma revisão'),
  ('commercial.engagements.manage', 'commercial', 'engagements.manage',
   'Registrar trabalho autorizado, anexar fontes de autorização e definir a fonte regente'),
  ('commercial.divergences.resolve', 'commercial', 'divergences.resolve',
   'Decidir qual fonte prevalece quando duas discordam')
ON CONFLICT (key) DO NOTHING;

COMMIT;
