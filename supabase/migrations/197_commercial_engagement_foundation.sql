-- ============================================================================
-- 197 — COMMERCIAL ENGAGEMENT: o pai neutro do trabalho autorizado
--
-- ─── O problema que esta migration resolve ───────────────────────────────
--
-- Hoje TUDO que executa pende de `contracts`: `project_measurements.contract_id`
-- é NOT NULL, a regra de medição mora em `contract_measurement_requirements`,
-- o faturamento nasce de `contract_billing_events`. Enquanto todo trabalho
-- autorizado vinha de contrato formal, isso era verdade — não modelo.
--
-- Deixou de ser. A Insight executa trabalho autorizado por PROPOSTA ACEITA,
-- por PEDIDO DE COMPRA, por autorização formal do cliente — sem instrumento
-- contratual. A saída errada seria criar um contrato de mentira para esse
-- trabalho caber na coluna NOT NULL: o dossiê passaria a exibir um contrato
-- que ninguém assinou, e a carteira contaria um instrumento inexistente.
--
-- ─── O que entra ─────────────────────────────────────────────────────────
--
-- `commercial_engagements` é o PAI NEUTRO: representa trabalho autorizado,
-- seja qual for o papel que o autorizou. O contrato formal deixa de ser o
-- pai e passa a ser UMA das fontes de autorização — a mais forte quando
-- existe, ausente quando não existe.
--
-- O nome é interno e deliberadamente sem carga de UI. O rótulo visível
-- ("Carteira", "Engajamento", o que for) vive em TypeScript e muda sem tocar
-- no banco.
--
-- ─── O que NÃO entra ─────────────────────────────────────────────────────
--
-- Nada é removido. `contracts`, `contract_project_links`, as regras e o motor
-- de medição continuam exatamente onde estão, com os mesmos IDs. Esta
-- migration ACRESCENTA um pai e liga o que já existe a ele. Nenhum estado de
-- negócio real muda: o backfill deriva o engajamento DO contrato, não o
-- contrário.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) Pré-requisito estrutural: chave de inquilino em contract_documents
--
-- As FKs compostas deste módulo provam o INQUILINO na própria referência
-- (o padrão de 130 em diante). `contract_documents` ainda não expunha o par
-- (organization_id, id) como chave, então nenhuma tabela conseguia apontar
-- para um documento sem abrir mão dessa prova. Acrescentar a unicidade é
-- aditivo: o par já é único porque `id` é a PK.
-- ---------------------------------------------------------------------------
ALTER TABLE public.contract_documents
  ADD CONSTRAINT cdoc_org_id_unique UNIQUE (organization_id, id);

-- ---------------------------------------------------------------------------
-- 1) O pai neutro
-- ---------------------------------------------------------------------------
CREATE TABLE public.commercial_engagements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Referência humana. Opcional: trabalho autorizado por proposta pode não ter
  -- número próprio antes da OS interna nascer.
  engagement_number     text CHECK (engagement_number IS NULL OR btrim(engagement_number) <> ''),
  title                 text NOT NULL CHECK (btrim(title) <> ''),

  counterparty_party_id uuid,
  counterparty_name     text NOT NULL CHECK (btrim(counterparty_name) <> ''),

  currency              text NOT NULL DEFAULT 'BRL' CHECK (currency ~ '^[A-Z]{3}$'),
  -- Valor autorizado é DERIVADO da fonte regente, e por isso nulo enquanto
  -- ninguém confirmou qual fonte rege. Nulo aqui significa "ainda não se sabe",
  -- não "zero" — e KPI que soma zero silenciosamente mente.
  authorized_value      numeric(18,2),

  /*
    `UNDER_ANALYSIS` é o estado de nascimento de TODA entrada — inclusive do
    contrato recém-carregado (§6 do escopo). Enquanto o engajamento está em
    análise ele NÃO entra em valor autorizado nem em backlog: a carteira mostra
    a entrada, os KPIs a ignoram, e a promoção a `AUTHORIZED` é ato humano com
    carimbo. Sem esse estado, todo PDF subido viraria receita contratada na
    mesma hora.
  */
  status                text NOT NULL DEFAULT 'UNDER_ANALYSIS'
                          CHECK (status IN ('UNDER_ANALYSIS','AUTHORIZED','SUSPENDED','CLOSED','CANCELLED')),
  authorized_at         timestamptz,
  authorized_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_at             timestamptz,

  -- Como este engajamento NASCEU. Não é a fonte regente (essa mora em
  -- `commercial_engagement_authorizations.governing`): é a procedência da
  -- entrada, e ela não muda quando uma fonte nova chega depois.
  origin                text NOT NULL
                          CHECK (origin IN ('formal_contract','accepted_proposal','customer_po',
                                            'customer_authorization','manual','migration_backfill')),

  owner_user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes                 text,

  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ce_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT ce_party_tenant FOREIGN KEY (organization_id, counterparty_party_id)
    REFERENCES public.parties (organization_id, id) ON DELETE SET NULL,
  -- Em análise NUNCA carrega carimbo de autorização; autorizado SEMPRE carrega.
  CONSTRAINT ce_analysis_has_no_authorization CHECK (
    status <> 'UNDER_ANALYSIS' OR (authorized_at IS NULL AND authorized_by IS NULL)),
  CONSTRAINT ce_authorized_is_stamped CHECK (
    status NOT IN ('AUTHORIZED','SUSPENDED','CLOSED') OR authorized_at IS NOT NULL),
  CONSTRAINT ce_closed_is_stamped CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
  CONSTRAINT ce_value_needs_authorization CHECK (
    authorized_value IS NULL OR status <> 'UNDER_ANALYSIS')
);

CREATE UNIQUE INDEX ce_number_unique_per_org
  ON public.commercial_engagements (organization_id, engagement_number)
  WHERE engagement_number IS NOT NULL;
CREATE INDEX ce_org_status ON public.commercial_engagements (organization_id, status);
CREATE INDEX ce_org_recent ON public.commercial_engagements (organization_id, created_at DESC);

COMMENT ON TABLE public.commercial_engagements IS
  'Pai neutro do trabalho autorizado. Contrato formal e OPCIONAL: ver commercial_engagement_authorizations.';

-- ---------------------------------------------------------------------------
-- 2) As fontes de autorização — contrato é UMA delas, não a única
-- ---------------------------------------------------------------------------
CREATE TABLE public.commercial_engagement_authorizations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  engagement_id      uuid NOT NULL,

  source_kind        text NOT NULL
                       CHECK (source_kind IN ('formal_contract','accepted_proposal',
                                              'customer_po','customer_authorization')),
  -- Preenchido conforme o papel. `proposal_revision_id` ganha FK na 198, quando
  -- a tabela de revisões existir: declarar a coluna aqui mantém o CHECK de
  -- coerência num lugar só.
  contract_id            uuid,
  proposal_revision_id   uuid,
  document_id            uuid,
  external_reference     text CHECK (external_reference IS NULL OR btrim(external_reference) <> ''),

  authorized_value   numeric(18,2),
  currency           text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  effective_from     date,
  effective_until    date,

  /*
    A fonte REGENTE. Uma por engajamento, e só enquanto ATIVA.

    Quando um contrato formal chega depois de uma proposta aceita já reger
    (cenário D), ele entra com `governing = false`. Promover exige ato humano
    através de `commercial_engagement_set_governing`, que registra a troca. É
    exatamente isto que impede a sobrescrita silenciosa: o dado governado
    existente continua governando até alguém decidir o contrário, por escrito.
  */
  governing          boolean NOT NULL DEFAULT false,
  state              text NOT NULL DEFAULT 'ACTIVE'
                       CHECK (state IN ('ACTIVE','SUPERSEDED','REVOKED')),

  note               text,
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cea_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT cea_engagement_tenant FOREIGN KEY (organization_id, engagement_id)
    REFERENCES public.commercial_engagements (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT cea_contract_tenant FOREIGN KEY (organization_id, contract_id)
    REFERENCES public.contracts (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT cea_document_tenant FOREIGN KEY (organization_id, document_id)
    REFERENCES public.contract_documents (organization_id, id) ON DELETE RESTRICT,
  -- Cada papel aponta para o seu objeto, e só para ele.
  CONSTRAINT cea_reference_matches_kind CHECK (
    CASE source_kind
      WHEN 'formal_contract'        THEN contract_id IS NOT NULL AND proposal_revision_id IS NULL
      WHEN 'accepted_proposal'      THEN proposal_revision_id IS NOT NULL AND contract_id IS NULL
      WHEN 'customer_po'            THEN contract_id IS NULL AND proposal_revision_id IS NULL
                                         AND (document_id IS NOT NULL OR external_reference IS NOT NULL)
      WHEN 'customer_authorization' THEN contract_id IS NULL AND proposal_revision_id IS NULL
                                         AND (document_id IS NOT NULL OR external_reference IS NOT NULL)
    END),
  CONSTRAINT cea_value_needs_currency CHECK (authorized_value IS NULL OR currency IS NOT NULL),
  CONSTRAINT cea_period_order CHECK (
    effective_from IS NULL OR effective_until IS NULL OR effective_until >= effective_from),
  -- Fonte que não está ativa não rege nada.
  CONSTRAINT cea_governing_requires_active CHECK (NOT governing OR state = 'ACTIVE')
);

-- UMA regente por engajamento. Índice parcial em vez de CHECK porque a regra é
-- entre LINHAS, e CHECK só enxerga a linha.
CREATE UNIQUE INDEX cea_one_governing_per_engagement
  ON public.commercial_engagement_authorizations (organization_id, engagement_id)
  WHERE governing AND state = 'ACTIVE';

-- O MESMO contrato não entra duas vezes no mesmo engajamento, e nem em dois
-- engajamentos: um instrumento pertence a uma relação de negócio (§D — "do not
-- create a second business relationship").
CREATE UNIQUE INDEX cea_contract_once
  ON public.commercial_engagement_authorizations (organization_id, contract_id)
  WHERE contract_id IS NOT NULL AND state <> 'REVOKED';

CREATE INDEX cea_engagement ON public.commercial_engagement_authorizations (organization_id, engagement_id);

-- ---------------------------------------------------------------------------
-- 3) Engajamento ↔ Projeto — a relação generalizada
--
-- `contract_project_links` continua canônica para o escopo CONTRATO e não é
-- tocada. Esta tabela é o vínculo do PAI, e é o que a medição passa a exigir
-- na 201 quando não há contrato. Para trabalho com contrato, um gatilho
-- espelha o vínculo existente — projeção, não segunda verdade.
-- ---------------------------------------------------------------------------
CREATE TABLE public.engagement_project_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  engagement_id   uuid NOT NULL,
  project_id      text NOT NULL,
  linked_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT epl_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT epl_engagement_project_unique UNIQUE (organization_id, engagement_id, project_id),
  CONSTRAINT epl_engagement_tenant FOREIGN KEY (organization_id, engagement_id)
    REFERENCES public.commercial_engagements (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT epl_project_tenant FOREIGN KEY (organization_id, project_id)
    REFERENCES public.projects (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX epl_project ON public.engagement_project_links (organization_id, project_id);

-- ---------------------------------------------------------------------------
-- 4) Divergências — o registro de que duas fontes discordam
--
-- Compartilhada por TODOS os confrontos: proposta × OS interna, proposta ×
-- contrato que chegou depois, OS carregada × OS esperada. Uma tabela só porque
-- a pergunta é sempre a mesma: "duas fontes dizem coisas diferentes sobre o
-- mesmo fato — quem decide?". A resposta nunca é a máquina.
-- ---------------------------------------------------------------------------
CREATE TABLE public.commercial_divergences (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  engagement_id      uuid NOT NULL,

  scope              text NOT NULL
                       CHECK (scope IN ('VALUE','SCOPE','DATES','MEASUREMENT_RULE',
                                        'BILLING_CONDITION','PAYMENT_TERMS','DELIVERABLE',
                                        'EVIDENCE_REQUIREMENT','OTHER')),
  field_path         text,

  left_source_kind   text NOT NULL,
  left_source_id     uuid,
  left_value         text,
  right_source_kind  text NOT NULL,
  right_source_id    uuid,
  right_value        text,

  severity           text NOT NULL DEFAULT 'WARNING'
                       CHECK (severity IN ('INFO','WARNING','BLOCKING')),
  summary            text NOT NULL CHECK (btrim(summary) <> ''),

  detected_by        text NOT NULL CHECK (detected_by IN ('ai','rule','human')),
  ai_provider        text,
  ai_model           text,
  confidence         numeric(5,4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),

  /*
    `OPEN` até alguém decidir. `RESOLVED` exige dizer QUAL fonte prevaleceu e
    quem disse — é o "governed confirmation" do §7. Sem `resolved_source_kind`
    a resolução seria um botão de "ok" que apaga a pergunta sem responder.
  */
  state              text NOT NULL DEFAULT 'OPEN'
                       CHECK (state IN ('OPEN','ACKNOWLEDGED','RESOLVED','DISMISSED')),
  resolved_source_kind text,
  resolution_note    text,
  resolved_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at        timestamptz,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cd_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT cd_engagement_tenant FOREIGN KEY (organization_id, engagement_id)
    REFERENCES public.commercial_engagements (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT cd_ai_provenance CHECK (
    detected_by <> 'ai' OR (ai_provider IS NOT NULL AND ai_model IS NOT NULL)),
  CONSTRAINT cd_resolution_coherent CHECK (
    (state IN ('RESOLVED','DISMISSED'))
      = (resolved_at IS NOT NULL AND resolved_by IS NOT NULL)),
  CONSTRAINT cd_resolution_names_winner CHECK (
    state <> 'RESOLVED' OR nullif(btrim(resolved_source_kind), '') IS NOT NULL)
);
CREATE INDEX cd_engagement_open ON public.commercial_divergences (organization_id, engagement_id)
  WHERE state = 'OPEN';

-- ---------------------------------------------------------------------------
-- 5) O contrato aponta para o seu pai — aditivo, sem tocar em ID canônico
-- ---------------------------------------------------------------------------
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS engagement_id uuid;

ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_engagement_tenant
    FOREIGN KEY (organization_id, engagement_id)
    REFERENCES public.commercial_engagements (organization_id, id) ON DELETE SET NULL;

COMMENT ON COLUMN public.contracts.engagement_id IS
  'Pai neutro. NULL apenas em contratos ainda não migrados; o instrumento continua canônico.';

-- ---------------------------------------------------------------------------
-- 6) BACKFILL — cada contrato vivo ganha o seu pai, derivado dele mesmo
--
-- Nenhum estado de negócio é inventado: título, contraparte, moeda, valor e
-- situação saem do próprio contrato. Um contrato em `draft`/`negotiation` gera
-- engajamento `UNDER_ANALYSIS` — fora dos KPIs de valor autorizado, que é
-- exatamente onde ele já estava.
-- ---------------------------------------------------------------------------
/*
  Laço explícito em vez de INSERT…SELECT + reconciliação por chave natural.

  Um `INSERT … RETURNING` dentro de CTE não é visível ao resto da MESMA
  instrução, e casar depois por (título, created_at) suporia que esse par é
  único entre contratos — suposição que o esquema não garante e que, quando
  falha, liga o contrato ao pai errado. Com 1 engajamento por contrato, o laço
  é exato por construção e custa nada.
*/
DO $backfill$
DECLARE c RECORD; v_status text; v_authorized_at timestamptz; v_engagement uuid;
BEGIN
  FOR c IN
    SELECT * FROM public.contracts
     WHERE deleted_at IS NULL AND engagement_id IS NULL
     ORDER BY created_at
  LOOP
    v_status := CASE
      WHEN c.status IN ('draft','negotiation','legal_review','commercial_review') THEN 'UNDER_ANALYSIS'
      WHEN c.status = 'cancelled' THEN 'CANCELLED'
      WHEN c.status IN ('closed','expired','archived') THEN 'CLOSED'
      ELSE 'AUTHORIZED' END;
    v_authorized_at := CASE WHEN v_status = 'UNDER_ANALYSIS' THEN NULL
      ELSE COALESCE(c.signed_date::timestamptz, c.created_at) END;

    INSERT INTO public.commercial_engagements (
      organization_id, engagement_number, title, counterparty_party_id, counterparty_name,
      currency, authorized_value, status, authorized_at, closed_at, origin,
      owner_user_id, created_by, created_at)
    VALUES (
      c.organization_id,
      -- Número do contrato só vira número do engajamento se for único no
      -- inquilino; duplicata histórica deixa o engajamento sem número em vez
      -- de derrubar a migration.
      (SELECT c.contract_number WHERE NOT EXISTS (
         SELECT 1 FROM public.commercial_engagements x
          WHERE x.organization_id = c.organization_id
            AND x.engagement_number = c.contract_number)),
      c.title, c.counterparty_party_id,
      COALESCE(nullif(btrim(c.counterparty_name), ''), 'Contraparte não informada'),
      c.currency,
      CASE WHEN v_status = 'UNDER_ANALYSIS' THEN NULL ELSE c.total_value END,
      v_status, v_authorized_at,
      CASE WHEN v_status = 'CLOSED' THEN v_authorized_at END,
      'migration_backfill', c.owner_user_id, c.created_by, c.created_at)
    RETURNING id INTO v_engagement;

    UPDATE public.contracts SET engagement_id = v_engagement
     WHERE id = c.id AND organization_id = c.organization_id;
  END LOOP;
END $backfill$;

-- A fonte de autorização do trabalho contratado É o contrato, e ela rege.
INSERT INTO public.commercial_engagement_authorizations (
  organization_id, engagement_id, source_kind, contract_id,
  authorized_value, currency, effective_from, effective_until, governing, state, created_by, created_at)
SELECT c.organization_id, c.engagement_id, 'formal_contract', c.id,
       c.total_value, c.currency, c.start_date, c.end_date, true, 'ACTIVE', c.created_by, c.created_at
  FROM public.contracts c
 WHERE c.engagement_id IS NOT NULL AND c.deleted_at IS NULL;

-- Vínculo projeto↔engajamento espelhando o vínculo projeto↔contrato existente.
INSERT INTO public.engagement_project_links (organization_id, engagement_id, project_id, created_at)
SELECT DISTINCT l.organization_id, c.engagement_id, l.project_id, l.created_at
  FROM public.contract_project_links l
  JOIN public.contracts c ON c.id = l.contract_id AND c.organization_id = l.organization_id
 WHERE c.engagement_id IS NOT NULL
ON CONFLICT (organization_id, engagement_id, project_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7) O espelho continua vivo — vínculo novo de contrato replica no pai
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.engagement_project_links_mirror_contract()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_engagement uuid;
BEGIN
  SELECT engagement_id INTO v_engagement
    FROM public.contracts
   WHERE id = NEW.contract_id AND organization_id = NEW.organization_id;
  IF v_engagement IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.engagement_project_links (organization_id, engagement_id, project_id)
  VALUES (NEW.organization_id, v_engagement, NEW.project_id)
  ON CONFLICT (organization_id, engagement_id, project_id) DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER contract_project_links_mirror_engagement
  AFTER INSERT ON public.contract_project_links
  FOR EACH ROW EXECUTE FUNCTION public.engagement_project_links_mirror_contract();

-- ---------------------------------------------------------------------------
-- 8) updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commercial_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

CREATE TRIGGER ce_touch BEFORE UPDATE ON public.commercial_engagements
  FOR EACH ROW EXECUTE FUNCTION public.commercial_touch_updated_at();
CREATE TRIGGER cea_touch BEFORE UPDATE ON public.commercial_engagement_authorizations
  FOR EACH ROW EXECUTE FUNCTION public.commercial_touch_updated_at();
CREATE TRIGGER cd_touch BEFORE UPDATE ON public.commercial_divergences
  FOR EACH ROW EXECUTE FUNCTION public.commercial_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 9) RLS — inquilino + permissão, o mesmo contrato do módulo de contratos
-- ---------------------------------------------------------------------------
ALTER TABLE public.commercial_engagements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_engagement_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_project_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_divergences ENABLE ROW LEVEL SECURITY;

CREATE POLICY ce_select ON public.commercial_engagements FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND public.current_user_has_permission('contracts.view'));
CREATE POLICY cea_select ON public.commercial_engagement_authorizations FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND public.current_user_has_permission('contracts.view'));
CREATE POLICY epl_select ON public.engagement_project_links FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND (public.current_user_has_permission('contracts.view')
          OR public.current_user_has_permission('projects.view')));
CREATE POLICY cd_select ON public.commercial_divergences FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND public.current_user_has_permission('contracts.view'));

/*
  Escrita NÃO passa por policy. Todo write entra por função governada
  (SECURITY DEFINER, negada a `authenticated`), como já acontece em onboarding,
  medição e faturamento. Uma policy de INSERT aqui abriria um caminho paralelo
  ao redor das regras de estado — exatamente o que o módulo de contratos evita.
*/
GRANT SELECT ON public.commercial_engagements,
               public.commercial_engagement_authorizations,
               public.engagement_project_links,
               public.commercial_divergences TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.commercial_engagements,
       public.commercial_engagement_authorizations, public.engagement_project_links,
       public.commercial_divergences FROM PUBLIC, anon, authenticated;

COMMIT;
