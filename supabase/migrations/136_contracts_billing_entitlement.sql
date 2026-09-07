-- ============================================================
-- Fase 7 — 136: DIREITO DE FATURAR, PROCEDÊNCIA, ELEGIBILIDADE E LIBERAÇÃO
-- ============================================================
--
-- ─── Por que EVOLUIR `contract_billing_events` em vez de sucedê-la ────────
--
-- A §10 manda auditar antes de decidir, e a §10 também proíbe "duas verdades
-- de faturamento concorrentes". A auditoria encontrou 5 linhas reais, com
-- `status` em português livre ('pendente', 'pago'), `paid_at` preenchido em
-- duas delas e `amount` sem nenhuma indicação de origem.
--
-- Criar uma tabela sucessora obrigaria a escolher entre duas coisas ruins:
-- migrar as 5 linhas inventando a procedência que elas não têm, ou deixá-las
-- para trás e passar a ter dois lugares onde alguém procura faturamento. A
-- extensão evita as duas: as colunas novas nascem NULAS nas linhas antigas, e
-- `LEGACY_UNKNOWN` é uma afirmação verdadeira sobre elas — não sabemos de onde
-- veio aquele número, e a tabela passa a dizer isso em voz alta.
--
-- ─── O que um evento de faturamento é, e o que não é ─────────────────────
--
-- É contexto de DIREITO COMERCIAL a faturar. Não é nota, não é título, não é
-- pagamento e não é liquidação. As sete dimensões da §60 são sete colunas, e
-- não um `status` só, porque um texto único não consegue dizer ao mesmo tempo
-- "elegível", "liberado", "faturado" e "recebido" sem mentir sobre três.
--
-- ─── `billing_amount` NUNCA vira valor medido ────────────────────────────
--
-- A precedência da Fase 6 continua congelada, e esta migration não abre exceção
-- nenhuma: quem quer valor MEDIDO chama `contract_milestone_measured_amount`.
-- O que existe aqui de novo é a possibilidade de um valor faturável ser um
-- DIREITO CONTRATUAL FIXO — e isso exige linha em
-- `contract_billing_entitlement_rules`, com cláusula, documento ou referência
-- contratual. Coluna preenchida não é prova de direito (§11).
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 0) Chaves compostas que faltavam nas pontas
-- ------------------------------------------------------------
-- Sem elas, nenhuma FK de mesmo inquilino é possível a partir daqui. A §72 é
-- explícita: RLS sozinha não basta.
ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_org_id_unique UNIQUE (organization_id, id);
ALTER TABLE public.contract_milestones
  ADD CONSTRAINT contract_milestones_org_id_unique UNIQUE (organization_id, id);

-- ------------------------------------------------------------
-- 1) Regra de direito contratual FIXO
-- ------------------------------------------------------------
/*
  A única porta pela qual `FIXED_CONTRACT_ENTITLEMENT` existe.

  A §11 é categórica: um `billing_amount` preenchido pode ser previsão. Para
  que ele seja direito, alguém precisa afirmar — com origem contratual
  verificável — que aquele valor é devido independentemente de medição. Esta
  tabela é o lugar dessa afirmação, e o CHECK de origem copia deliberadamente a
  forma da Fase 2: cláusula, documento ou referência textual, pelo menos uma.

  Ela nasce VAZIA. Nenhuma linha é semeada, porque semear seria exatamente a
  inferência que a §11 proíbe.
*/
CREATE TABLE public.contract_billing_entitlement_rules (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id        uuid NOT NULL,
  -- Nulo = vale para o contrato inteiro; preenchido = vale para aquele marco.
  milestone_id       uuid,

  basis              text NOT NULL DEFAULT 'FIXED_CONTRACT_ENTITLEMENT'
                       CHECK (basis = 'FIXED_CONTRACT_ENTITLEMENT'),
  fixed_amount       numeric(18,2) NOT NULL CHECK (fixed_amount > 0),
  currency           text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),

  -- Procedência contratual. Sem uma das três, não há regra.
  source_clause_id   uuid,
  source_document_id uuid,
  source_reference   text,
  source_page        integer CHECK (source_page IS NULL OR source_page > 0),

  effective_from     date,
  effective_until    date,
  active             boolean NOT NULL DEFAULT true,

  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  note               text,

  CONSTRAINT cber_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT cber_contract_tenant FOREIGN KEY (organization_id, contract_id)
    REFERENCES public.contracts (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT cber_milestone_tenant FOREIGN KEY (organization_id, milestone_id)
    REFERENCES public.contract_milestones (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT cber_provenance_required CHECK (
    source_clause_id IS NOT NULL
    OR source_document_id IS NOT NULL
    OR NULLIF(btrim(COALESCE(source_reference, '')), '') IS NOT NULL),
  CONSTRAINT cber_page_needs_document CHECK (source_page IS NULL OR source_document_id IS NOT NULL),
  CONSTRAINT cber_window CHECK (effective_from IS NULL OR effective_until IS NULL
                                OR effective_until >= effective_from)
);

COMMENT ON TABLE public.contract_billing_entitlement_rules IS
  'Direito contratual FIXO a faturar, com origem em cláusula, documento ou '
  'referência. É a ÚNICA fonte de FIXED_CONTRACT_ENTITLEMENT. Nasce vazia: '
  'deduzir direito de billing_amount preenchido é o que a §11 proíbe.';

CREATE INDEX cber_lookup ON public.contract_billing_entitlement_rules
  (organization_id, contract_id, milestone_id) WHERE active;

ALTER TABLE public.contract_billing_entitlement_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY cber_select ON public.contract_billing_entitlement_rules
  FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND public.current_user_can_read_contract(contract_id));

-- Escrever regra de direito é ato governado: exige a permissão comercial de
-- edição de contrato, não a de faturar.
CREATE POLICY cber_write ON public.contract_billing_entitlement_rules
  FOR ALL TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND public.current_user_has_permission('contracts.edit'))
  WITH CHECK (organization_id = public.current_user_organization_id()
         AND public.current_user_has_permission('contracts.edit'));

-- ------------------------------------------------------------
-- 2) As sete dimensões da cadeia, em colunas
-- ------------------------------------------------------------
ALTER TABLE public.contract_billing_events
  -- ---- moeda ----
  -- Nula por padrão: a §78 manda preservar moeda, e afirmar 'BRL' nas 5 linhas
  -- históricas seria inventar o que ninguém registrou.
  ADD COLUMN currency               text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),

  -- ---- de onde veio o direito ----
  ADD COLUMN source_kind            text CHECK (source_kind IN (
    'ACCEPTED_MEASUREMENT','LEGACY_MILESTONE','FIXED_CONTRACT_ENTITLEMENT','MANUAL','LEGACY_UNKNOWN')),
  ADD COLUMN source_measurement_id  uuid,
  ADD COLUMN occurrence_key         text,
  -- Identidade de NEGÓCIO do direito (§22). É ela que faz a reentrega do
  -- evento da Fase 6 não criar um segundo candidato.
  ADD COLUMN entitlement_key        text,

  -- ---- procedência do VALOR (§11) ----
  ADD COLUMN amount_source          text CHECK (amount_source IN (
    'ACCEPTED_MEASUREMENT','LEGACY_MEASURED_AMOUNT','FIXED_CONTRACT_ENTITLEMENT',
    'GOVERNED_ADJUSTMENT','UNKNOWN','LEGACY_UNKNOWN')),
  ADD COLUMN amount_source_id       uuid,
  ADD COLUMN amount_source_revision integer,
  ADD COLUMN amount_fingerprint     text,
  ADD COLUMN amount_derived_at      timestamptz,
  ADD COLUMN amount_derivation_rule text,

  -- ---- elegibilidade ----
  ADD COLUMN eligibility_state      text CHECK (eligibility_state IN (
    'UNKNOWN','ELIGIBLE','BLOCKED','INCOMPLETE','NOT_APPLICABLE','LEGACY')),
  ADD COLUMN eligibility_reasons    jsonb NOT NULL DEFAULT '[]'::jsonb
                                     CHECK (jsonb_typeof(eligibility_reasons) = 'array'),
  ADD COLUMN eligibility_computed_at timestamptz,

  -- ---- liberação ----
  ADD COLUMN release_state          text CHECK (release_state IN (
    'NOT_ELIGIBLE','ELIGIBLE','PENDING_RELEASE','RELEASED','RELEASE_REJECTED',
    'CANCELLED','SUPERSEDED','LEGACY')),
  ADD COLUMN released_at            timestamptz,
  ADD COLUMN released_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN release_note           text,
  ADD COLUMN release_fingerprint    text,
  ADD COLUMN release_approval_request_id uuid,

  -- ---- ciclo de vida ----
  ADD COLUMN supersedes_id          uuid,
  ADD COLUMN superseded_by_id       uuid,
  ADD COLUMN supersession_reason    text,
  ADD COLUMN cancelled_at           timestamptz,
  ADD COLUMN cancelled_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN cancellation_reason    text,

  -- ---- rastreio causal ----
  ADD COLUMN correlation_id         uuid,
  ADD COLUMN source_event_id        uuid,

  -- ---- fronteira do legado ----
  -- As 5 linhas anteriores à Fase 7 recebem `true` abaixo. É o que permite ao
  -- resolvedor e à tela distinguirem "sem procedência porque é antigo" de
  -- "sem procedência porque algo falhou".
  ADD COLUMN legacy_row             boolean NOT NULL DEFAULT false;

ALTER TABLE public.contract_billing_events
  ADD CONSTRAINT cbe_org_id_unique UNIQUE (organization_id, id),
  ADD CONSTRAINT cbe_contract_tenant FOREIGN KEY (organization_id, contract_id)
    REFERENCES public.contracts (organization_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT cbe_milestone_tenant FOREIGN KEY (organization_id, milestone_id)
    REFERENCES public.contract_milestones (organization_id, id) ON DELETE SET NULL,
  ADD CONSTRAINT cbe_measurement_tenant FOREIGN KEY (organization_id, source_measurement_id)
    REFERENCES public.project_measurements (organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT cbe_supersedes_tenant FOREIGN KEY (organization_id, supersedes_id)
    REFERENCES public.contract_billing_events (organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT cbe_superseded_by_tenant FOREIGN KEY (organization_id, superseded_by_id)
    REFERENCES public.contract_billing_events (organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT cbe_approval_tenant FOREIGN KEY (organization_id, release_approval_request_id)
    REFERENCES public.approval_requests (organization_id, id) ON DELETE SET NULL,
  ADD CONSTRAINT cbe_event_tenant FOREIGN KEY (organization_id, source_event_id)
    REFERENCES public.domain_events (organization_id, id) ON DELETE SET NULL,
  ADD CONSTRAINT cbe_no_self_supersession CHECK (
    supersedes_id IS DISTINCT FROM id AND superseded_by_id IS DISTINCT FROM id),
  /*
    Liberado exige as duas coisas: instante E impressão digital. Um "liberado"
    sem impressão não pode ser invalidado por mudança material, porque não há
    com o que comparar.

    IMPLICAÇÃO, e não equivalência. A primeira versão desta restrição exigia
    que só o estado RELEASED tivesse instante de liberação — e isso quebrava a
    supersessão: um faturamento liberado que é superado vira SUPERSEDED e
    PRECISA continuar dizendo quando e por quem foi liberado. Apagar
    `released_at` para satisfazer a restrição seria apagar história, que é
    exatamente o que a §57 proíbe. O que se exige, então, é o par de baixo:
    quem está RELEASED tem as duas marcas, e quem tem as marcas passou por
    liberação em algum momento.
  */
  ADD CONSTRAINT cbe_release_coherent CHECK (
    release_state <> 'RELEASED' OR (released_at IS NOT NULL AND release_fingerprint IS NOT NULL)),
  ADD CONSTRAINT cbe_release_history_kept CHECK (
    released_at IS NULL OR release_state IN ('RELEASED','SUPERSEDED','CANCELLED')),
  -- A medição de origem só existe quando a origem é medição.
  ADD CONSTRAINT cbe_measurement_coherent CHECK (
    source_measurement_id IS NULL OR source_kind = 'ACCEPTED_MEASUREMENT');

/*
  A UNICIDADE DO DIREITO (§22).

  Índice PARCIAL: só amarra linhas que têm chave de direito, ou seja, as que a
  Fase 7 cria. As 5 linhas legadas ficam de fora com `entitlement_key` nula, e
  não é indulgência — é que elas não têm identidade de negócio derivável, e
  fabricar uma faria duas delas colidirem ou nenhuma.

  Vivas apenas: um direito CANCELADO ou SUPERADO não deve impedir que a mesma
  origem produza um direito novo. Foi isso que a renegociação e a substituição
  de nota precisam poder fazer.
*/
CREATE UNIQUE INDEX cbe_entitlement_unique
  ON public.contract_billing_events (organization_id, entitlement_key)
  WHERE entitlement_key IS NOT NULL
    AND release_state IS DISTINCT FROM 'CANCELLED'
    AND release_state IS DISTINCT FROM 'SUPERSEDED';

CREATE INDEX cbe_org_release   ON public.contract_billing_events (organization_id, release_state);
CREATE INDEX cbe_org_eligible  ON public.contract_billing_events (organization_id, eligibility_state);
CREATE INDEX cbe_measurement   ON public.contract_billing_events (organization_id, source_measurement_id)
  WHERE source_measurement_id IS NOT NULL;
CREATE INDEX cbe_correlation   ON public.contract_billing_events (correlation_id)
  WHERE correlation_id IS NOT NULL;

-- ---- classificação das linhas anteriores à Fase 7 ----
/*
  A §126 proíbe reclassificar em massa o `status` histórico, e ele não é tocado.
  O que se grava é a NOVA dimensão, dizendo a verdade sobre o que se sabe:
  nada. `LEGACY_UNKNOWN` não é um palpite conservador — é a resposta certa.
*/
UPDATE public.contract_billing_events
   SET legacy_row        = true,
       source_kind       = 'LEGACY_UNKNOWN',
       amount_source     = 'LEGACY_UNKNOWN',
       eligibility_state = 'LEGACY',
       release_state     = 'LEGACY';

COMMENT ON COLUMN public.contract_billing_events.amount_source IS
  'De onde o número veio. LEGACY_UNKNOWN nas linhas anteriores à Fase 7: elas '
  'foram criadas por `measured_amount ?? billing_amount` sem registrar qual '
  'venceu, e afirmar uma das duas agora seria inventar história.';
COMMENT ON COLUMN public.contract_billing_events.paid_at IS
  'LEGADO. Deixou de ser verdade de pagamento na Fase 7 (§59): pago passa a ser '
  'DERIVADO de finance_settlements. Permanece como procedência histórica.';
COMMENT ON COLUMN public.contract_billing_events.status IS
  'LEGADO, texto livre em português. A §126 proíbe reclassificá-lo. As sete '
  'dimensões reais estão em eligibility_state / release_state e nos modelos de '
  'leitura de Fiscal e Finanças.';

-- ------------------------------------------------------------
-- 3) História append-only do direito
-- ------------------------------------------------------------
CREATE TABLE public.contract_billing_event_history (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  billing_event_id   uuid NOT NULL,
  transition         text NOT NULL CHECK (btrim(transition) <> ''),
  from_state         text,
  to_state           text,
  reason             text,
  detail             jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_source       text NOT NULL DEFAULT 'system'
                       CHECK (actor_source IN ('human','system','cron','provider','integration')),
  correlation_id     uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cbeh_event_tenant FOREIGN KEY (organization_id, billing_event_id)
    REFERENCES public.contract_billing_events (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX cbeh_event ON public.contract_billing_event_history
  (organization_id, billing_event_id, created_at DESC);

ALTER TABLE public.contract_billing_event_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY cbeh_select ON public.contract_billing_event_history FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND EXISTS (SELECT 1 FROM public.contract_billing_events e
                      WHERE e.id = billing_event_id
                        AND public.current_user_can_read_contract(e.contract_id)));
REVOKE INSERT, UPDATE, DELETE ON public.contract_billing_event_history FROM anon, authenticated;

-- História não se reescreve nem se apaga.
CREATE TRIGGER cbeh_no_erasure BEFORE DELETE ON public.contract_billing_event_history
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();
CREATE FUNCTION public.contract_billing_history_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Histórico de faturamento é append-only (linha %).', OLD.id
    USING ERRCODE = 'check_violation';
END $$;
REVOKE ALL ON FUNCTION public.contract_billing_history_immutable() FROM PUBLIC;
CREATE TRIGGER cbeh_immutable BEFORE UPDATE ON public.contract_billing_event_history
  FOR EACH ROW EXECUTE FUNCTION public.contract_billing_history_immutable();

-- ------------------------------------------------------------
-- 4) Ajuste comercial governado (§28)
-- ------------------------------------------------------------
CREATE TABLE public.contract_billing_adjustments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  billing_event_id   uuid NOT NULL,
  original_amount    numeric(18,2) NOT NULL,
  adjustment_amount  numeric(18,2) NOT NULL CHECK (adjustment_amount <> 0),
  resulting_amount   numeric(18,2) NOT NULL CHECK (resulting_amount >= 0),
  currency           text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reason_code        text NOT NULL CHECK (reason_code IN (
    'SCOPE_CORRECTION','PRICE_CORRECTION','ROUNDING','CONTRACTUAL_INDEXATION','OTHER')),
  reason_text        text NOT NULL CHECK (btrim(reason_text) <> ''),
  approval_request_id uuid,
  actor_user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cba_event_tenant FOREIGN KEY (organization_id, billing_event_id)
    REFERENCES public.contract_billing_events (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT cba_approval_tenant FOREIGN KEY (organization_id, approval_request_id)
    REFERENCES public.approval_requests (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT cba_math CHECK (resulting_amount = original_amount + adjustment_amount)
);
COMMENT ON TABLE public.contract_billing_adjustments IS
  'Ajuste comercial explícito: valor original, delta, motivo, ator e instante. '
  'A §28 proíbe sobrescrita silenciosa; `ator NOT NULL` é o que impede um '
  'ajuste sem dono.';
CREATE INDEX cba_event ON public.contract_billing_adjustments (organization_id, billing_event_id);
ALTER TABLE public.contract_billing_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY cba_select ON public.contract_billing_adjustments FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id());
REVOKE INSERT, UPDATE, DELETE ON public.contract_billing_adjustments FROM anon, authenticated;
CREATE TRIGGER cba_no_erasure BEFORE DELETE ON public.contract_billing_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

-- ------------------------------------------------------------
-- 5) Imutabilidade do que foi liberado (§19, §95)
-- ------------------------------------------------------------
/*
  Depois de LIBERADO, valor, moeda, procedência e vínculo de origem param de se
  mexer. Mudança material NÃO é bloqueada: ela é obrigada a passar por
  supersessão, que preserva o direito antigo e cria um novo. Bloquear seria
  fingir que o mundo não muda; deixar mutar seria fingir que a liberação valia
  para o número novo.
*/
CREATE FUNCTION public.contract_billing_events_guard_released() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.release_state IS DISTINCT FROM 'RELEASED' THEN RETURN NEW; END IF;

  IF NEW.amount            IS DISTINCT FROM OLD.amount
  OR NEW.currency          IS DISTINCT FROM OLD.currency
  OR NEW.amount_source     IS DISTINCT FROM OLD.amount_source
  OR NEW.amount_source_id  IS DISTINCT FROM OLD.amount_source_id
  OR NEW.amount_fingerprint IS DISTINCT FROM OLD.amount_fingerprint
  OR NEW.contract_id       IS DISTINCT FROM OLD.contract_id
  OR NEW.source_measurement_id IS DISTINCT FROM OLD.source_measurement_id
  OR NEW.entitlement_key   IS DISTINCT FROM OLD.entitlement_key THEN
    -- Só o caminho de supersessão/cancelamento pode mexer, e ele sinaliza.
    IF NEW.release_state NOT IN ('SUPERSEDED','CANCELLED') THEN
      RAISE EXCEPTION
        'Faturamento liberado não muda de valor nem de origem: supersede ou cancele (evento %).', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.released_at IS DISTINCT FROM OLD.released_at
  OR NEW.released_by IS DISTINCT FROM OLD.released_by THEN
    RAISE EXCEPTION 'Quem liberou e quando não se reescreve (evento %).', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contract_billing_events_guard_released() FROM PUBLIC;
CREATE TRIGGER cbe_guard_released BEFORE UPDATE ON public.contract_billing_events
  FOR EACH ROW EXECUTE FUNCTION public.contract_billing_events_guard_released();

-- Direito faturado não se apaga: cancela-se.
CREATE TRIGGER cbe_no_erasure BEFORE DELETE ON public.contract_billing_events
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

-- ------------------------------------------------------------
-- 6) FRONTEIRA DE ESCRITA DO NAVEGADOR (§69, §70)
-- ------------------------------------------------------------
/*
  `contract_billing_events` tem, desde antes da Fase 7, política ALL para quem
  tem `contracts.edit`. Isso era aceitável quando a tabela guardava um título,
  um valor e uma data. Deixou de ser no instante em que ela passou a guardar
  LIBERAÇÃO.

  Sem esta guarda, um `POST` do navegador para o PostgREST gravaria
  `release_state = 'RELEASED'` com `released_by` de outra pessoa — que é
  exatamente a forja que a §70 proíbe. A RLS não ajudaria: ela decide QUAIS
  LINHAS, não QUAIS COLUNAS.

  A guarda é por COLUNA e só vale para papel de navegador. As RPCs governadas
  desta migration são SECURITY DEFINER e rodam como dono, então passam.
*/
CREATE FUNCTION public.contract_billing_events_guard_browser() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.release_state IS NOT NULL OR NEW.released_at IS NOT NULL
    OR NEW.released_by IS NOT NULL OR NEW.release_fingerprint IS NOT NULL
    OR NEW.release_approval_request_id IS NOT NULL
    OR NEW.eligibility_state IS NOT NULL OR NEW.eligibility_computed_at IS NOT NULL
    OR NEW.eligibility_reasons <> '[]'::jsonb
    OR NEW.amount_source IS NOT NULL OR NEW.amount_fingerprint IS NOT NULL
    OR NEW.entitlement_key IS NOT NULL OR NEW.source_measurement_id IS NOT NULL
    OR NEW.legacy_row IS TRUE THEN
      RAISE EXCEPTION 'Elegibilidade, procedência e liberação não se escrevem pelo navegador: use a RPC governada (§69).'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.release_state       IS DISTINCT FROM OLD.release_state
  OR NEW.released_at         IS DISTINCT FROM OLD.released_at
  OR NEW.released_by         IS DISTINCT FROM OLD.released_by
  OR NEW.release_fingerprint IS DISTINCT FROM OLD.release_fingerprint
  OR NEW.release_approval_request_id IS DISTINCT FROM OLD.release_approval_request_id
  OR NEW.eligibility_state   IS DISTINCT FROM OLD.eligibility_state
  OR NEW.eligibility_reasons IS DISTINCT FROM OLD.eligibility_reasons
  OR NEW.eligibility_computed_at IS DISTINCT FROM OLD.eligibility_computed_at
  OR NEW.amount_source       IS DISTINCT FROM OLD.amount_source
  OR NEW.amount_source_id    IS DISTINCT FROM OLD.amount_source_id
  OR NEW.amount_fingerprint  IS DISTINCT FROM OLD.amount_fingerprint
  OR NEW.entitlement_key     IS DISTINCT FROM OLD.entitlement_key
  OR NEW.source_measurement_id IS DISTINCT FROM OLD.source_measurement_id
  OR NEW.supersedes_id       IS DISTINCT FROM OLD.supersedes_id
  OR NEW.superseded_by_id    IS DISTINCT FROM OLD.superseded_by_id
  OR NEW.legacy_row          IS DISTINCT FROM OLD.legacy_row THEN
    RAISE EXCEPTION 'Elegibilidade, procedência e liberação não se escrevem pelo navegador: use a RPC governada (§69).'
      USING ERRCODE = '42501';
  END IF;

  /*
    `paid_at` numa linha da Fase 7 seria pagamento afirmado pelo lado errado da
    fronteira. A §58 é explícita: nenhum `paid_at` de Contratos permanece
    autoritativo. Nas 5 linhas legadas ele continua editável — elas não têm
    título de Finanças nenhum atrás, e travá-las quebraria a tela que existe.
  */
  IF NEW.legacy_row IS NOT TRUE AND NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
    RAISE EXCEPTION 'Pagamento é verdade de Finanças, derivada de liquidação (§58/§59). '
      'Contratos não grava paid_at em faturamento da Fase 7.' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contract_billing_events_guard_browser() FROM PUBLIC;
CREATE TRIGGER cbe_guard_browser BEFORE INSERT OR UPDATE ON public.contract_billing_events
  FOR EACH ROW EXECUTE FUNCTION public.contract_billing_events_guard_browser();

-- ------------------------------------------------------------
-- 7) PROCEDÊNCIA DO VALOR (§11) — a função, e a única
-- ------------------------------------------------------------
/*
  Devolve valor, moeda E fonte. A fonte não é enfeite: é o que permite à tela
  dizer "faturando o MEDIDO" ou "faturando o DIREITO FIXO", distinção que o
  `measured_amount ?? billing_amount` da Fase 6 apagava (registro de deferidos).

  A ordem tem uma razão para cada degrau:

    1. medição canônica ACEITA — verdade operacional apurada e aceita;
    2. `contract_milestones.measured_amount` — legado, medição sem o motor;
    3. direito contratual FIXO — só com regra cadastrada e origem contratual;
    4. UNKNOWN.

  E não existe degrau para `billing_amount`. Ele é PREVISÃO. O diagnóstico
  `billing_amount_present_and_ignored` sai no detalhe justamente para a tela
  poder dizer "há previsto, não há apurado nem direito" — que é informação, e é
  o oposto de usar o previsto como se fosse apurado.
*/
CREATE FUNCTION public.contract_billing_resolve_amount(
  p_organization_id uuid,
  p_contract_id     uuid,
  p_milestone_id    uuid DEFAULT NULL,
  p_measurement_id  uuid DEFAULT NULL,
  p_as_of           date DEFAULT NULL
) RETURNS TABLE (
  amount            numeric,
  currency          text,
  amount_source     text,
  source_id         uuid,
  source_revision   integer,
  derivation_rule   text,
  detail            jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  pm     public.project_measurements%ROWTYPE;
  legacy record;
  rule   public.contract_billing_entitlement_rules%ROWTYPE;
  ms     public.contract_milestones%ROWTYPE;
  as_of  date := COALESCE(p_as_of, current_date);
BEGIN
  IF p_milestone_id IS NOT NULL THEN
    SELECT * INTO ms FROM public.contract_milestones
     WHERE id = p_milestone_id AND organization_id = p_organization_id;
  END IF;

  -- ---- 1) medição canônica aceita, apontada explicitamente ----
  IF p_measurement_id IS NOT NULL THEN
    SELECT * INTO pm FROM public.project_measurements
     WHERE id = p_measurement_id AND organization_id = p_organization_id;
    IF FOUND AND pm.status = 'ACCEPTED' THEN
      RETURN QUERY SELECT
        pm.accepted_value,
        CASE WHEN pm.accepted_currency ~ '^[A-Z]{3}$' THEN pm.accepted_currency END,
        'ACCEPTED_MEASUREMENT'::text,
        pm.id, pm.revision,
        'accepted_measurement.v1'::text,
        jsonb_build_object(
          'occurrence_key', pm.occurrence_key,
          'accepted_at', pm.accepted_at,
          'acceptance_source', pm.acceptance_source,
          'accepted_quantity', pm.accepted_quantity,
          'billing_amount_present_and_ignored',
            (ms.billing_amount IS NOT NULL));
      RETURN;
    END IF;
    -- Medição apontada e NÃO aceita não cai para o legado: a origem foi
    -- declarada, e o que ela diz hoje é "ainda não há valor aceito".
    IF FOUND THEN
      RETURN QUERY SELECT
        NULL::numeric, NULL::text, 'UNKNOWN'::text, pm.id, pm.revision,
        'accepted_measurement.v1'::text,
        jsonb_build_object('measurement_status', pm.status,
                           'reason', 'MEASUREMENT_NOT_ACCEPTED',
                           'billing_amount_present_and_ignored', (ms.billing_amount IS NOT NULL));
      RETURN;
    END IF;
  END IF;

  -- ---- 2) precedência congelada da Fase 6, via a função dela ----
  -- Chamar `contract_milestone_measured_amount` em vez de reimplementar é o
  -- que garante que a Fase 7 não abra uma segunda interpretação da regra.
  IF p_milestone_id IS NOT NULL THEN
    SELECT * INTO legacy
      FROM public.contract_milestone_measured_amount(p_organization_id, p_milestone_id);
    IF legacy.source = 'canonical_accepted' THEN
      RETURN QUERY SELECT legacy.amount, legacy.currency, 'ACCEPTED_MEASUREMENT'::text,
        NULLIF(legacy.detail->>'measurement_id','')::uuid,
        NULLIF(legacy.detail->>'revision','')::integer,
        'measurement_precedence.v1'::text,
        legacy.detail || jsonb_build_object('billing_amount_present_and_ignored', (ms.billing_amount IS NOT NULL));
      RETURN;
    ELSIF legacy.source = 'legacy_measured_amount' THEN
      RETURN QUERY SELECT legacy.amount, legacy.currency, 'LEGACY_MEASURED_AMOUNT'::text,
        p_milestone_id, NULL::integer, 'measurement_precedence.v1'::text,
        legacy.detail || jsonb_build_object('billing_amount_present_and_ignored', (ms.billing_amount IS NOT NULL));
      RETURN;
    END IF;
  END IF;

  -- ---- 3) direito contratual FIXO, só com regra cadastrada ----
  SELECT * INTO rule FROM public.contract_billing_entitlement_rules r
   WHERE r.organization_id = p_organization_id
     AND r.contract_id = p_contract_id
     AND r.active
     AND (r.milestone_id IS NOT DISTINCT FROM p_milestone_id OR r.milestone_id IS NULL)
     AND (r.effective_from  IS NULL OR r.effective_from  <= as_of)
     AND (r.effective_until IS NULL OR r.effective_until >= as_of)
   -- Regra do marco vence a do contrato: a mais específica é a que fala do caso.
   ORDER BY (r.milestone_id IS NOT NULL) DESC, r.created_at DESC
   LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT rule.fixed_amount, rule.currency, 'FIXED_CONTRACT_ENTITLEMENT'::text,
      rule.id, NULL::integer, 'fixed_entitlement.v1'::text,
      jsonb_build_object(
        'source_clause_id', rule.source_clause_id,
        'source_document_id', rule.source_document_id,
        'source_reference', rule.source_reference,
        'billing_amount_present_and_ignored', (ms.billing_amount IS NOT NULL));
    RETURN;
  END IF;

  -- ---- 4) não se sabe ----
  RETURN QUERY SELECT NULL::numeric, NULL::text, 'UNKNOWN'::text, NULL::uuid, NULL::integer,
    'no_source.v1'::text,
    jsonb_build_object(
      'reason', CASE WHEN p_milestone_id IS NULL THEN 'NO_SOURCE' ELSE 'NO_MEASUREMENT_NO_ENTITLEMENT' END,
      -- A linha mais importante desta função: o previsto EXISTE e foi
      -- deliberadamente ignorado. Dizer isso é o contrário de usá-lo.
      'billing_amount_present_and_ignored', (ms.billing_amount IS NOT NULL));
END $$;
REVOKE ALL ON FUNCTION public.contract_billing_resolve_amount(uuid, uuid, uuid, uuid, date)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.contract_billing_resolve_amount(uuid, uuid, uuid, uuid, date) IS
  'Valor faturável COM procedência. Nunca lê billing_amount como valor: ele é '
  'previsão, e o único caminho para direito fixo é '
  'contract_billing_entitlement_rules, que exige origem contratual (§11).';

-- ------------------------------------------------------------
-- 8) Impressão digital do direito e da liberação (§19)
-- ------------------------------------------------------------
CREATE FUNCTION public.contract_billing_fingerprint(p_billing_event_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE e public.contract_billing_events%ROWTYPE;
BEGIN
  SELECT * INTO e FROM public.contract_billing_events WHERE id = p_billing_event_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  /*
    Amarra os FATOS EXATOS que a §19 lista. Retenção, glosa e disputa entram na
    composição como literais nulos, e isso é deliberado: quando (e se) essas
    semânticas existirem, a impressão MUDA, e toda liberação presa à impressão
    antiga deixa de valer — que é precisamente o comportamento correto.
  */
  RETURN encode(extensions.digest(concat_ws('|',
    'contract_billing_event.v1',
    e.id::text,
    e.organization_id::text,
    e.contract_id::text,
    COALESCE(e.milestone_id::text, '-'),
    COALESCE(e.source_measurement_id::text, '-'),
    COALESCE(e.amount_source, '-'),
    COALESCE(e.amount_source_id::text, '-'),
    COALESCE(e.amount_source_revision::text, '-'),
    COALESCE(e.amount::text, '-'),
    COALESCE(e.currency, '-'),
    COALESCE(e.due_date::text, '-'),
    COALESCE(e.entitlement_key, '-'),
    'retention:-', 'glosa:-', 'dispute:-'
  )::bytea, 'sha256'), 'hex');
END $$;
REVOKE ALL ON FUNCTION public.contract_billing_fingerprint(uuid) FROM PUBLIC;

-- ------------------------------------------------------------
-- 9) Emissão de fato de faturamento — na transação da mutação
-- ------------------------------------------------------------
CREATE FUNCTION public.contract_billing_emit(
  p_event      public.contract_billing_events,
  p_event_type text,
  p_payload    jsonb DEFAULT '{}'::jsonb,
  p_actor      uuid  DEFAULT NULL,
  p_source     text  DEFAULT 'system',
  /*
    Discriminador da OCORRÊNCIA, quando o fato pode repetir legitimamente.

    A liberação acontece uma vez por impressão digital, então a impressão basta
    para identificá-la. A elegibilidade não: um direito pode ir a ELIGIBLE,
    voltar a BLOCKED quando uma obrigação abre, e voltar a ELIGIBLE quando ela
    é satisfeita — três fatos distintos com a MESMA impressão. A primeira
    versão desta função chaveava só pela impressão, e o segundo `eligible`
    batia na recusa de "chave reusada com significado diferente".

    Quem chama passa a identidade durável daquela ocorrência (a linha de
    história), que é estável para retentativa e distinta a cada transição real.
  */
  p_occurrence text  DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN public.emit_domain_event(
    p_event.organization_id, p_event_type, 1,
    'contract_billing_event', p_event.id,
    p_event_type || ':' || p_event.id::text || ':'
      || COALESCE(p_occurrence, public.contract_billing_fingerprint(p_event.id), 'nofp'),
    p_payload || jsonb_build_object(
      'contract_id', p_event.contract_id,
      'milestone_id', p_event.milestone_id,
      'source_measurement_id', p_event.source_measurement_id,
      'amount', p_event.amount,
      'currency', p_event.currency,
      'amount_source', p_event.amount_source,
      'eligibility_state', p_event.eligibility_state,
      'release_state', p_event.release_state,
      'entitlement_key', p_event.entitlement_key),
    now(), p_source, p_actor, p_event.correlation_id, p_event.source_event_id);
END $$;
REVOKE ALL ON FUNCTION public.contract_billing_emit(
  public.contract_billing_events, text, jsonb, uuid, text, text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 10) RESOLVEDOR DE ELEGIBILIDADE (§15, §16) — um só
-- ------------------------------------------------------------
/*
  Devolve ESTADO e MOTIVOS. Nunca um booleano opaco: "não pode faturar" sem
  dizer por quê obriga a pessoa a descobrir sozinha, e é assim que se fatura
  errado por impaciência.

  ─── Bloqueante vs. informativo ───────────────────────────────────────────

  Cada motivo carrega `blocking`. A distinção é de FRONTEIRA, não de gravidade:

    · bloqueante   → falta DIREITO CONTRATUAL de faturar. Enquanto existir um,
                     o estado nunca é ELIGIBLE.
    · informativo  → o direito existe, mas o próximo estágio (emissão fiscal,
                     lançamento contábil) está sem configuração. Isso não
                     retira o direito; retira a capacidade de executá-lo, e
                     quem precisa saber é a etapa seguinte.

  Tratar "perfil fiscal incompleto" como bloqueio de ELEGIBILIDADE faria a tela
  dizer que o cliente não deve — quando ele deve, e o que falta é cadastro.

  ─── Verdade ausente nunca vira ELIGIBLE (§15) ────────────────────────────

  Condição contratual que não se consegue avaliar produz
  `CONTRACT_RULE_UNRESOLVED` BLOQUEANTE, e o estado vai a INCOMPLETE. Não há
  caminho em que o desconhecido seja tratado como satisfeito.

  ─── Retenção, glosa e disputa ────────────────────────────────────────────

  Os códigos `RETENTION_APPLIES` e `DISPUTE_OPEN` estão no vocabulário da §16 e
  NÃO são emitidos por nenhum ramo. Não há esquema de retenção, glosa ou
  disputa em lugar nenhum do repositório — a auditoria procurou. A §25, a §26 e
  a §27 mandam modelar "onde for real", e a §114 manda relatar NOT_APPLICABLE
  quando não for. Emitir um deles hoje seria afirmar um fato que nada sustenta.
*/
CREATE FUNCTION public.contract_billing_eligibility_resolve(p_billing_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e        public.contract_billing_events%ROWTYPE;
  c        public.contracts%ROWTYPE;
  ms       public.contract_milestones%ROWTYPE;
  src      record;
  cond     record;
  obl      record;
  reasons  jsonb := '[]'::jsonb;
  state    text;
  n_block  integer;
  satisfied boolean;
  detail   jsonb;
  as_of    date := current_date;
BEGIN
  SELECT * INTO e FROM public.contract_billing_events WHERE id = p_billing_event_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state','UNKNOWN',
      'reasons', jsonb_build_array(jsonb_build_object(
        'code','BILLING_EVENT_NOT_FOUND','blocking',true)));
  END IF;

  -- Linha anterior à Fase 7: não se afirma elegibilidade sobre o que não tem
  -- procedência. Reclassificá-la seria a reclassificação em massa que a §126
  -- proíbe, feita uma linha por vez.
  IF e.legacy_row THEN
    RETURN jsonb_build_object('state','LEGACY',
      'reasons', jsonb_build_array(jsonb_build_object(
        'code','LEGACY_ROW_NO_PROVENANCE','blocking',true,
        'detail','Faturamento anterior à Fase 7: origem do valor desconhecida.')));
  END IF;

  IF e.release_state IN ('CANCELLED','SUPERSEDED') THEN
    RETURN jsonb_build_object('state','NOT_APPLICABLE',
      'reasons', jsonb_build_array(jsonb_build_object(
        'code','BILLING_EVENT_CLOSED','blocking',true,'detail',e.release_state)));
  END IF;

  SELECT * INTO c FROM public.contracts WHERE id = e.contract_id;
  IF e.milestone_id IS NOT NULL THEN
    SELECT * INTO ms FROM public.contract_milestones WHERE id = e.milestone_id;
  END IF;

  -- ---------- 1) o valor e sua procedência ----------
  SELECT * INTO src FROM public.contract_billing_resolve_amount(
    e.organization_id, e.contract_id, e.milestone_id, e.source_measurement_id, as_of);

  IF src.amount_source = 'UNKNOWN' OR src.amount IS NULL THEN
    reasons := reasons || jsonb_build_object('code','AMOUNT_UNKNOWN','blocking',true,
      'detail', src.detail);
    IF (src.detail->>'reason') = 'MEASUREMENT_NOT_ACCEPTED' THEN
      reasons := reasons || jsonb_build_object('code','MEASUREMENT_NOT_ACCEPTED','blocking',true,
        'detail', src.detail->>'measurement_status');
    ELSIF e.milestone_id IS NOT NULL THEN
      reasons := reasons || jsonb_build_object('code','MEASUREMENT_UNKNOWN','blocking',true);
    END IF;
  ELSIF src.currency IS NULL THEN
    -- Valor sem moeda não é valor: a §78 manda preservá-la, e somar moeda
    -- desconhecida a BRL é como se faz um portfólio errado sem perceber.
    reasons := reasons || jsonb_build_object('code','CURRENCY_UNKNOWN','blocking',true,
      'detail','Fonte ' || src.amount_source || ' não declarou moeda.');
  END IF;

  -- ---------- 2) condições contratuais de faturamento ----------
  /*
    `contract_billing_conditions` é lineage temporal da Fase 2: as linhas com
    `effect = 'removed'` deixaram de valer, e as fora da janela não valem
    ainda/mais. A §96 exige regra COMO ERA, não como ficou.
  */
  FOR cond IN
    SELECT * FROM public.contract_billing_conditions bc
     WHERE bc.organization_id = e.organization_id
       AND bc.contract_id = e.contract_id
       AND bc.effect <> 'removed'
       AND (bc.effective_from  IS NULL OR bc.effective_from  <= as_of)
       AND (bc.effective_until IS NULL OR bc.effective_until >= as_of)
       AND (bc.milestone_id IS NULL OR bc.milestone_id = e.milestone_id)
       -- Só a última versão de cada linhagem: a antecessora foi substituída.
       AND NOT EXISTS (SELECT 1 FROM public.contract_billing_conditions s
                        WHERE s.predecessor_id = bc.id)
  LOOP
    satisfied := NULL;
    detail := jsonb_build_object('condition_id', cond.id, 'title', cond.title,
                                 'condition_type', cond.condition_type,
                                 'source_clause_id', cond.source_clause_id,
                                 'source_reference', cond.source_reference);

    IF cond.condition_type = 'measurement_accepted' THEN
      satisfied := EXISTS (
        SELECT 1 FROM public.project_measurements m
         WHERE m.organization_id = e.organization_id AND m.status = 'ACCEPTED'
           AND (m.id = e.source_measurement_id
             OR (e.milestone_id IS NOT NULL AND m.milestone_id = e.milestone_id)));
      IF satisfied IS NOT TRUE THEN
        reasons := reasons || (detail || jsonb_build_object('code','MEASUREMENT_NOT_ACCEPTED','blocking',true));
      END IF;

    ELSIF cond.condition_type = 'milestone_reached' THEN
      IF e.milestone_id IS NULL THEN
        reasons := reasons || (detail || jsonb_build_object('code','CONTRACT_RULE_UNRESOLVED','blocking',true,
          'why','Condição exige marco e o faturamento não referencia nenhum.'));
      ELSE
        satisfied := (ms.completed_at IS NOT NULL) OR ms.status IN ('measured','approved');
        IF NOT satisfied THEN
          reasons := reasons || (detail || jsonb_build_object('code','CONTRACT_RULE_UNRESOLVED','blocking',true,
            'why','Marco em ' || COALESCE(ms.status,'?')));
        END IF;
      END IF;

    ELSIF cond.condition_type IN ('customer_approval_required','technical_acceptance_required') THEN
      /*
        Aceite FORMAL do cliente. A Fase 6 já distingue aceite interno de
        aceite com procedência externa; só o segundo satisfaz uma cláusula que
        diz "o cliente aprova". Aceitar internamente e chamar de aprovação do
        cliente é a confusão que essa distinção existe para impedir.
      */
      satisfied := EXISTS (
        SELECT 1 FROM public.project_measurements m
         WHERE m.organization_id = e.organization_id AND m.status = 'ACCEPTED'
           AND (m.id = e.source_measurement_id
             OR (e.milestone_id IS NOT NULL AND m.milestone_id = e.milestone_id))
           AND m.acceptance_source IN ('customer_portal','signed_bulletin','external_document','integration'));
      IF NOT satisfied THEN
        reasons := reasons || (detail || jsonb_build_object('code','FORMAL_ACCEPTANCE_PENDING','blocking',true));
      END IF;

    ELSIF cond.condition_type IN ('service_report_required','evidence_required','specific_document_required') THEN
      satisfied := EXISTS (
        SELECT 1 FROM public.project_measurement_evidence ev
          JOIN public.project_measurements m
            ON m.id = ev.measurement_id AND m.organization_id = ev.organization_id
         WHERE ev.organization_id = e.organization_id
           AND (m.id = e.source_measurement_id
             OR (e.milestone_id IS NOT NULL AND m.milestone_id = e.milestone_id))
           AND (cond.required_document_type IS NULL
             OR ev.requirement_kind = cond.required_document_type));
      IF NOT satisfied THEN
        reasons := reasons || (detail || jsonb_build_object('code','REQUIRED_DOCUMENT_MISSING','blocking',true,
          'required_document_type', cond.required_document_type));
      END IF;

    ELSIF cond.condition_type = 'elapsed_contractual_period' THEN
      IF cond.elapsed_period_days IS NULL OR ms.completed_at IS NULL THEN
        reasons := reasons || (detail || jsonb_build_object('code','CONTRACT_RULE_UNRESOLVED','blocking',true,
          'why','Prazo contratual sem marco concluído ou sem número de dias.'));
      ELSE
        satisfied := (ms.completed_at::date + cond.elapsed_period_days) <= as_of;
        IF NOT satisfied THEN
          reasons := reasons || (detail || jsonb_build_object('code','CONTRACT_RULE_UNRESOLVED','blocking',true,
            'why','Prazo contratual ainda não decorrido.',
            'eligible_from', (ms.completed_at::date + cond.elapsed_period_days)));
        END IF;
      END IF;

    ELSE
      -- 'contractual_event' e qualquer tipo futuro. Não há como avaliar sem
      -- inventar o que o evento é. Desconhecido BLOQUEIA (§15).
      reasons := reasons || (detail || jsonb_build_object('code','CONTRACT_RULE_UNRESOLVED','blocking',true,
        'why','Tipo de condição sem avaliação determinística.'));
    END IF;
  END LOOP;

  -- ---------- 3) obrigações que bloqueiam faturamento ----------
  -- `blocks_billing` é campo EXTRAÍDO do contrato pela Fase 3, não heurística.
  FOR obl IN
    SELECT i.id, i.occurrence_key, i.state, i.due_date, d.title
      FROM public.contract_obligation_instances i
      JOIN public.contract_obligation_definitions d
        ON d.id = i.definition_id AND d.organization_id = i.organization_id
     WHERE i.organization_id = e.organization_id
       AND i.contract_id = e.contract_id
       AND d.blocks_billing IS TRUE
       AND i.state IN ('OPEN','EXCEPTION')
  LOOP
    reasons := reasons || jsonb_build_object('code','OBLIGATION_BLOCKING','blocking',true,
      'obligation_instance_id', obl.id, 'title', obl.title,
      'occurrence_key', obl.occurrence_key, 'state', obl.state, 'due_date', obl.due_date);
  END LOOP;

  -- ---------- 4) contraparte ----------
  -- Canônica é `parties` (§8). `counterparty_name` texto NÃO substitui: nome
  -- não é identidade, e casar nome com parte é o matching difuso que a §8 veta.
  IF c.counterparty_party_id IS NULL THEN
    reasons := reasons || jsonb_build_object('code','COUNTERPARTY_UNRESOLVED','blocking',true,
      'detail','Contrato sem parte canônica vinculada.');
  END IF;

  -- ---------- 5) prontidão FISCAL — informativa ----------
  IF c.counterparty_party_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.fiscal_party_profiles p
                      WHERE p.organization_id = e.organization_id
                        AND p.party_id = c.counterparty_party_id AND p.active) THEN
    reasons := reasons || jsonb_build_object('code','FISCAL_PROFILE_INCOMPLETE','blocking',false,
      'detail','Parte sem perfil fiscal ativo: a emissão não sai, o direito permanece.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fiscal_establishments fe
                  WHERE fe.organization_id = e.organization_id AND fe.active) THEN
    reasons := reasons || jsonb_build_object('code','FISCAL_PROFILE_INCOMPLETE','blocking',false,
      'detail','Organização sem estabelecimento fiscal ativo.');
  END IF;

  -- ---------- 6) configuração contábil — informativa ----------
  -- A §42 manda BLOQUEAR o lançamento, não o direito. Sem centro de custo
  -- canônico não há como postar no razão; ainda assim o cliente deve.
  IF NOT EXISTS (SELECT 1 FROM public.finance_cost_centers cc
                  WHERE cc.organization_id = e.organization_id AND cc.active) THEN
    reasons := reasons || jsonb_build_object('code','ACCOUNTING_CONFIGURATION_MISSING','blocking',false,
      'detail','Sem centro de custo canônico ativo.');
  END IF;

  -- ---------- desfecho ----------
  SELECT count(*)::int INTO n_block
    FROM jsonb_array_elements(reasons) r WHERE (r->>'blocking')::boolean;

  IF n_block = 0 THEN
    state := 'ELIGIBLE';
  ELSIF EXISTS (SELECT 1 FROM jsonb_array_elements(reasons) r
                 WHERE r->>'code' IN ('AMOUNT_UNKNOWN','CURRENCY_UNKNOWN','MEASUREMENT_UNKNOWN',
                                      'CONTRACT_RULE_UNRESOLVED','COUNTERPARTY_UNRESOLVED')) THEN
    -- INCOMPLETE = falta VERDADE. BLOCKED = a verdade é conhecida e diz não.
    -- A distinção muda a ação: uma se resolve cadastrando, a outra cobrando.
    state := 'INCOMPLETE';
  ELSE
    state := 'BLOCKED';
  END IF;

  RETURN jsonb_build_object(
    'state', state,
    'reasons', reasons,
    'amount', src.amount,
    'currency', src.currency,
    'amount_source', src.amount_source,
    'amount_source_id', src.source_id,
    'amount_source_revision', src.source_revision,
    'derivation_rule', src.derivation_rule,
    'amount_detail', src.detail,
    'computed_at', now());
END $$;
REVOKE ALL ON FUNCTION public.contract_billing_eligibility_resolve(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_billing_eligibility_resolve(uuid) TO authenticated;

COMMENT ON FUNCTION public.contract_billing_eligibility_resolve(uuid) IS
  'Resolvedor CANÔNICO de elegibilidade. Estado + motivos legíveis por máquina '
  '(§15,§16). Verdade ausente nunca vira ELIGIBLE. Motivos informativos '
  '(fiscal/contábil) não retiram direito: bloqueiam o estágio seguinte.';

-- ------------------------------------------------------------
-- 11) Materialização da elegibilidade + fato transacional
-- ------------------------------------------------------------
CREATE FUNCTION public.contract_billing_recompute_eligibility(p_billing_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e     public.contract_billing_events%ROWTYPE;
  res   jsonb;
  prev  text;
  fp    text;
  hist_id uuid;
BEGIN
  SELECT * INTO e FROM public.contract_billing_events WHERE id = p_billing_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BILLING_EVENT_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF e.legacy_row THEN
    RETURN jsonb_build_object('billing_event_id', e.id, 'state', 'LEGACY', 'skipped', true);
  END IF;

  res  := public.contract_billing_eligibility_resolve(p_billing_event_id);
  prev := e.eligibility_state;

  /*
    Depois de LIBERADO, elegibilidade continua sendo recomputada mas não pode
    voltar a mexer no valor: quem manda nisso é a supersessão (§19). Por isso o
    UPDATE de valor é condicionado ao estado de liberação.
  */
  UPDATE public.contract_billing_events
     SET eligibility_state       = res->>'state',
         eligibility_reasons     = res->'reasons',
         eligibility_computed_at = now(),
         amount                  = CASE WHEN e.release_state IS DISTINCT FROM 'RELEASED'
                                          AND (res->>'amount') IS NOT NULL
                                        THEN (res->>'amount')::numeric ELSE amount END,
         currency                = CASE WHEN e.release_state IS DISTINCT FROM 'RELEASED'
                                        THEN res->>'currency' ELSE currency END,
         amount_source           = CASE WHEN e.release_state IS DISTINCT FROM 'RELEASED'
                                        THEN res->>'amount_source' ELSE amount_source END,
         amount_source_id        = CASE WHEN e.release_state IS DISTINCT FROM 'RELEASED'
                                        THEN NULLIF(res->>'amount_source_id','')::uuid ELSE amount_source_id END,
         amount_source_revision  = CASE WHEN e.release_state IS DISTINCT FROM 'RELEASED'
                                        THEN NULLIF(res->>'amount_source_revision','')::integer ELSE amount_source_revision END,
         amount_derivation_rule  = CASE WHEN e.release_state IS DISTINCT FROM 'RELEASED'
                                        THEN res->>'derivation_rule' ELSE amount_derivation_rule END,
         amount_derived_at       = CASE WHEN e.release_state IS DISTINCT FROM 'RELEASED'
                                        THEN now() ELSE amount_derived_at END,
         release_state           = CASE
                                     WHEN e.release_state IN ('RELEASED','PENDING_RELEASE','CANCELLED',
                                                              'SUPERSEDED','RELEASE_REJECTED','LEGACY')
                                       THEN e.release_state
                                     WHEN res->>'state' = 'ELIGIBLE' THEN 'ELIGIBLE'
                                     ELSE 'NOT_ELIGIBLE' END,
         updated_at              = now()
   WHERE id = e.id;

  SELECT * INTO e FROM public.contract_billing_events WHERE id = e.id;
  IF e.release_state IS DISTINCT FROM 'RELEASED' THEN
    fp := public.contract_billing_fingerprint(e.id);
    UPDATE public.contract_billing_events SET amount_fingerprint = fp WHERE id = e.id;
    SELECT * INTO e FROM public.contract_billing_events WHERE id = e.id;
  END IF;

  -- Fato só quando o estado MUDA. Emitir a cada recomputo encheria o grafo de
  -- eventos que dizem "continua igual", e um grafo assim não é consultável.
  IF prev IS DISTINCT FROM e.eligibility_state THEN
    INSERT INTO public.contract_billing_event_history
      (organization_id, billing_event_id, transition, from_state, to_state, detail, actor_source, correlation_id)
    VALUES (e.organization_id, e.id, 'eligibility_recomputed', prev, e.eligibility_state,
            jsonb_build_object('reasons', e.eligibility_reasons,
                               'amount_source', e.amount_source),
            'system', e.correlation_id)
    RETURNING id INTO hist_id;

    PERFORM public.contract_billing_emit(e,
      CASE WHEN e.eligibility_state = 'ELIGIBLE'
           THEN 'contracts.billing.eligible' ELSE 'contracts.billing.blocked' END,
      jsonb_build_object('previous_state', prev, 'reasons', e.eligibility_reasons),
      auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'human' END,
      -- A linha de história é a identidade daquela transição.
      'history:' || hist_id::text);
  END IF;

  RETURN jsonb_build_object('billing_event_id', e.id, 'state', e.eligibility_state,
                            'release_state', e.release_state,
                            'amount', e.amount, 'currency', e.currency,
                            'amount_source', e.amount_source,
                            'reasons', e.eligibility_reasons,
                            'changed', prev IS DISTINCT FROM e.eligibility_state);
END $$;
REVOKE ALL ON FUNCTION public.contract_billing_recompute_eligibility(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_billing_recompute_eligibility(uuid) TO authenticated;

-- ------------------------------------------------------------
-- 12) O Motor de Aprovação lê o faturamento (§18, §75)
-- ------------------------------------------------------------
/*
  MECANISMO, sem REGRA. A auditoria da Fase 7 confirmou o que a Fase 5 e a
  Fase 6 já tinham encontrado: ZERO política de aprovação, em qualquer
  inquilino, para qualquer propósito. A §18 é literal — "se não existe política
  real, não invente uma" — e a §75 proíbe motor de aprovação próprio de
  Finanças.

  Então o sujeito passa a ser resolvível, com impressão digital da versão
  exata, e a liberação consulta o motor. Sem política, o motor responde
  NO_POLICY e a liberação segue pelo caminho humano governado por permissão.
  Alçada, quórum e aprovador nomeado continuam inexistentes.
*/
CREATE OR REPLACE FUNCTION public.approval_subject_resolve(
  p_organization_id uuid,
  p_subject_type    text,
  p_subject_id      uuid
) RETURNS TABLE (
  supported        boolean,
  found            boolean,
  fingerprint      text,
  amount           numeric,
  currency         text,
  label            text,
  created_by       uuid,
  business_domain  text,
  contract_type    text,
  risk_class       text,
  cost_center_id   uuid,
  business_unit_id uuid
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  c   public.contracts%ROWTYPE;
  rev public.contract_amendment_revisions%ROWTYPE;
  pm  public.project_measurements%ROWTYPE;
  be  public.contract_billing_events%ROWTYPE;
BEGIN
  IF p_subject_type = 'contract' THEN
    SELECT * INTO c FROM public.contracts
     WHERE id = p_subject_id AND organization_id = p_organization_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RETURN QUERY SELECT true, false, NULL::text, NULL::numeric, NULL::text, NULL::text,
                          NULL::uuid, 'contracts'::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
      RETURN;
    END IF;
    RETURN QUERY SELECT
      true, true,
      public.contract_approval_fingerprint(c.id),
      c.total_value,
      CASE WHEN c.currency IS NOT NULL AND c.currency ~ '^[A-Z]{3}$' THEN c.currency END,
      COALESCE(c.contract_number || ' — ', '') || COALESCE(c.title, 'Contrato'),
      c.created_by,
      'contracts'::text, c.contract_type, c.risk_level, NULL::uuid, NULL::uuid;
    RETURN;

  ELSIF p_subject_type = 'contract_amendment_revision' THEN
    SELECT * INTO rev FROM public.contract_amendment_revisions
     WHERE id = p_subject_id AND organization_id = p_organization_id;
    IF NOT FOUND THEN
      RETURN QUERY SELECT true, false, NULL::text, NULL::numeric, NULL::text, NULL::text,
                          NULL::uuid, 'contracts'::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
      RETURN;
    END IF;
    SELECT * INTO c FROM public.contracts WHERE id = rev.contract_id;
    RETURN QUERY SELECT
      true, true,
      encode(extensions.digest(concat_ws('|', 'contract_amendment_revision.v1',
        rev.id::text, rev.revision::text, rev.amendment_id::text,
        md5(COALESCE(rev.amendment_snapshot, '{}'::jsonb)::text))::bytea, 'sha256'), 'hex'),
      NULLIF(rev.amendment_snapshot->>'value_delta','')::numeric,
      CASE WHEN c.currency ~ '^[A-Z]{3}$' THEN c.currency END,
      format('Aditivo rev. %s — %s', rev.revision, COALESCE(c.contract_number, c.title, 'contrato')),
      NULL::uuid,
      'contracts'::text, c.contract_type, c.risk_level, NULL::uuid, NULL::uuid;
    RETURN;

  ELSIF p_subject_type = 'project_measurement' THEN
    SELECT * INTO pm FROM public.project_measurements
     WHERE id = p_subject_id AND organization_id = p_organization_id;
    IF NOT FOUND THEN
      RETURN QUERY SELECT true, false, NULL::text, NULL::numeric, NULL::text, NULL::text,
                          NULL::uuid, 'projects'::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
      RETURN;
    END IF;
    SELECT * INTO c FROM public.contracts WHERE id = pm.contract_id;
    RETURN QUERY SELECT
      true, true,
      public.project_measurement_fingerprint(pm.id),
      pm.measured_value,
      CASE WHEN pm.currency ~ '^[A-Z]{3}$' THEN pm.currency END,
      format('Medição %s rev. %s — %s', pm.occurrence_key, pm.revision,
             COALESCE(c.contract_number, c.title, 'contrato')),
      pm.created_by,
      'projects'::text, c.contract_type, c.risk_level, NULL::uuid, NULL::uuid;
    RETURN;

  ELSIF p_subject_type = 'contract_billing_event' THEN
    SELECT * INTO be FROM public.contract_billing_events
     WHERE id = p_subject_id AND organization_id = p_organization_id;
    IF NOT FOUND THEN
      RETURN QUERY SELECT true, false, NULL::text, NULL::numeric, NULL::text, NULL::text,
                          NULL::uuid, 'contracts'::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
      RETURN;
    END IF;
    SELECT * INTO c FROM public.contracts WHERE id = be.contract_id;
    RETURN QUERY SELECT
      true, true,
      -- A impressão digital da §19: valor, moeda, origem e vencimento exatos.
      -- Mudar qualquer um deles muda a impressão, e a aprovação presa à
      -- impressão antiga deixa de valer — que é o comportamento correto.
      public.contract_billing_fingerprint(be.id),
      be.amount,
      CASE WHEN be.currency ~ '^[A-Z]{3}$' THEN be.currency END,
      format('Faturamento %s — %s', COALESCE(be.title, be.id::text),
             COALESCE(c.contract_number, c.title, 'contrato')),
      NULL::uuid,
      'contracts'::text, c.contract_type, c.risk_level, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, false, NULL::text, NULL::numeric, NULL::text, NULL::text,
                      NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
END $$;
REVOKE ALL ON FUNCTION public.approval_subject_resolve(uuid, text, uuid) FROM PUBLIC;

-- ------------------------------------------------------------
-- 13) LIBERAÇÃO DE FATURAMENTO (§17, §18, §19, §20)
-- ------------------------------------------------------------
/*
  Elegível e liberado são coisas distintas, e esta função é a fronteira.

  ─── Por que não há liberação automática ──────────────────────────────────

  A §17 permite auto-liberação apenas "se uma política real explícita a
  autorizar". Não existe nenhuma. Então a postura padrão vale integralmente: o
  sistema PREPARA, uma pessoa LIBERA. `auth.uid()` obrigatório não é
  formalidade — é o que impede um trabalhador de fundo de transformar "medição
  aceita" em "pode cobrar o cliente".

  ─── O que a liberação amarra ─────────────────────────────────────────────

  A impressão digital dos fatos exatos (§19). Ela fica gravada, e é ela que a
  supersessão compara depois: valor que mudou é liberação que não vale mais.
*/
CREATE FUNCTION public.contract_billing_release(
  p_billing_event_id uuid,
  p_note             text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e      public.contract_billing_events%ROWTYPE;
  actor  uuid := auth.uid();
  elig   jsonb;
  appr   jsonb;
  fp     text;
BEGIN
  SELECT * INTO e FROM public.contract_billing_events
   WHERE id = p_billing_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BILLING_EVENT_NOT_FOUND: faturamento inexistente.' USING ERRCODE = 'no_data_found';
  END IF;

  -- Idempotência: liberar de novo devolve a liberação que existe, e não uma
  -- segunda. Erro aqui faria a interface tentar outra vez.
  IF e.release_state = 'RELEASED' THEN
    RETURN jsonb_build_object('billing_event_id', e.id, 'release_state', 'RELEASED',
                              'idempotent', true, 'release_fingerprint', e.release_fingerprint);
  END IF;
  IF e.release_state = 'PENDING_RELEASE' THEN
    RETURN jsonb_build_object('billing_event_id', e.id, 'release_state', 'PENDING_RELEASE',
                              'idempotent', true,
                              'approval_request_id', e.release_approval_request_id);
  END IF;

  IF e.legacy_row THEN
    RAISE EXCEPTION 'LEGACY_ROW_NOT_RELEASABLE: faturamento anterior à Fase 7 não tem procedência para liberar (§126).'
      USING ERRCODE = 'check_violation';
  END IF;
  IF e.release_state IN ('CANCELLED','SUPERSEDED') THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: faturamento em % não se libera.', e.release_state
      USING ERRCODE = 'check_violation';
  END IF;

  -- ---- A RECUSA CENTRAL (§17, §70, §98) ----
  IF actor IS NULL THEN
    RAISE EXCEPTION 'RELEASE_NEVER_AUTOMATED: liberação de faturamento exige pessoa autenticada. '
      'Sistema, rotina e IA não liberam faturamento (§17, §98).' USING ERRCODE = '42501';
  END IF;
  IF e.organization_id IS DISTINCT FROM public.current_user_organization_id() THEN
    -- Mesma mensagem de "não existe": duas mensagens diferentes responderiam,
    -- para quem tem um UUID, se aquele faturamento existe em outro inquilino.
    RAISE EXCEPTION 'BILLING_EVENT_NOT_FOUND: faturamento inexistente.' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT (public.current_user_has_permission('contracts.billing.release')
          OR public.current_user_is_admin()) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: falta a permissão contracts.billing.release.'
      USING ERRCODE = '42501';
  END IF;

  -- ---- elegibilidade recomputada AGORA ----
  -- Ler o estado gravado bastaria até o instante em que alguém mudasse o
  -- contrato entre o cálculo e o clique. Recomputar fecha essa janela.
  elig := public.contract_billing_recompute_eligibility(e.id);
  IF (elig->>'state') <> 'ELIGIBLE' THEN
    RAISE EXCEPTION 'NOT_ELIGIBLE: faturamento em % — %', elig->>'state', (elig->'reasons')::text
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO e FROM public.contract_billing_events WHERE id = e.id;

  -- ---- Motor de Aprovação compartilhado (§18, §75) ----
  appr := public.approval_request_create(
    e.organization_id, 'contract_billing_event', e.id, 'release', 'RELEASE',
    p_note,
    jsonb_build_object('contract_id', e.contract_id, 'amount', e.amount,
                       'currency', e.currency, 'amount_source', e.amount_source),
    'billing-release:' || e.id::text || ':' || COALESCE(public.contract_billing_fingerprint(e.id),'nofp'),
    e.source_event_id, NULL, e.correlation_id);

  IF (appr->>'status') NOT IN ('NO_POLICY','SUBJECT_TYPE_UNSUPPORTED') THEN
    -- Existe política REAL: a liberação passa a depender da decisão dela, e
    -- não deste clique. O estado diz isso em voz alta.
    UPDATE public.contract_billing_events
       SET release_state = 'PENDING_RELEASE',
           release_approval_request_id = NULLIF(appr->>'request_id','')::uuid,
           release_note = p_note, updated_at = now()
     WHERE id = e.id;
    SELECT * INTO e FROM public.contract_billing_events WHERE id = e.id;

    INSERT INTO public.contract_billing_event_history
      (organization_id, billing_event_id, transition, from_state, to_state, reason,
       detail, actor_user_id, actor_source, correlation_id)
    VALUES (e.organization_id, e.id, 'release_requested', 'ELIGIBLE', 'PENDING_RELEASE', p_note,
            appr, actor, 'human', e.correlation_id);

    RETURN jsonb_build_object('billing_event_id', e.id, 'release_state', 'PENDING_RELEASE',
                              'approval', appr, 'idempotent', false);
  END IF;

  -- ---- sem política: liberação humana governada por permissão ----
  fp := public.contract_billing_fingerprint(e.id);
  UPDATE public.contract_billing_events
     SET release_state = 'RELEASED', released_at = now(), released_by = actor,
         release_fingerprint = fp, release_note = p_note, updated_at = now()
   WHERE id = e.id;
  SELECT * INTO e FROM public.contract_billing_events WHERE id = e.id;

  INSERT INTO public.contract_billing_event_history
    (organization_id, billing_event_id, transition, from_state, to_state, reason,
     detail, actor_user_id, actor_source, correlation_id)
  VALUES (e.organization_id, e.id, 'released', 'ELIGIBLE', 'RELEASED', p_note,
          jsonb_build_object('release_fingerprint', fp, 'amount', e.amount,
                             'currency', e.currency, 'amount_source', e.amount_source,
                             'governance', 'permission_only_no_policy'),
          actor, 'human', e.correlation_id);

  -- Fato e mutação na MESMA transação (§20). Nunca "commita e depois emite".
  PERFORM public.contract_billing_emit(e, 'contracts.billing.released',
    jsonb_build_object('release_fingerprint', fp, 'released_at', e.released_at,
                       'due_date', e.due_date, 'title', e.title),
    actor, 'human');

  RETURN jsonb_build_object('billing_event_id', e.id, 'release_state', 'RELEASED',
                            'release_fingerprint', fp, 'idempotent', false);
END $$;
REVOKE ALL ON FUNCTION public.contract_billing_release(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_billing_release(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.contract_billing_release(uuid, text) IS
  'Liberação GOVERNADA. Exige pessoa autenticada, permissão e elegibilidade '
  'recomputada no ato. Consulta o Motor de Aprovação compartilhado; sem '
  'política real, libera por permissão. Nunca automática (§17, §98).';

-- ---- aplicação da decisão de aprovação, quando houver política ----
CREATE FUNCTION public.contract_billing_apply_approval(p_approval_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  req public.approval_requests%ROWTYPE;
  e   public.contract_billing_events%ROWTYPE;
  fp  text;
BEGIN
  SELECT * INTO req FROM public.approval_requests WHERE id = p_approval_request_id;
  IF NOT FOUND OR req.subject_type <> 'contract_billing_event' THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'NOT_A_BILLING_APPROVAL');
  END IF;

  SELECT * INTO e FROM public.contract_billing_events
   WHERE id = req.subject_id AND organization_id = req.organization_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('applied', false, 'reason', 'BILLING_EVENT_NOT_FOUND'); END IF;

  -- Reentrega é a norma (§67). Já aplicado devolve o que existe.
  IF e.release_state IN ('RELEASED','RELEASE_REJECTED','CANCELLED','SUPERSEDED') THEN
    RETURN jsonb_build_object('applied', false, 'idempotent', true, 'release_state', e.release_state);
  END IF;

  IF req.status = 'REJECTED' THEN
    UPDATE public.contract_billing_events
       SET release_state = 'RELEASE_REJECTED', updated_at = now() WHERE id = e.id;
    SELECT * INTO e FROM public.contract_billing_events WHERE id = e.id;
    INSERT INTO public.contract_billing_event_history
      (organization_id, billing_event_id, transition, from_state, to_state, reason, actor_source, correlation_id)
    VALUES (e.organization_id, e.id, 'release_rejected', 'PENDING_RELEASE', 'RELEASE_REJECTED',
            req.outcome_reason, 'system', e.correlation_id);
    RETURN jsonb_build_object('applied', true, 'release_state', 'RELEASE_REJECTED');
  END IF;

  IF req.status <> 'APPROVED' THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'NOT_FINALIZED', 'status', req.status);
  END IF;

  /*
    A CONFERÊNCIA DA IMPRESSÃO DIGITAL (§19).

    Aprovou-se um valor. Se o valor mudou entre a decisão e a aplicação, aplicar
    a aprovação antiga liberaria um número que ninguém aprovou. O pedido fica
    obsoleto e o faturamento volta a exigir liberação — que é a supersessão da
    §95 no seu caso mais simples.
  */
  fp := public.contract_billing_fingerprint(e.id);
  IF req.subject_fingerprint IS DISTINCT FROM fp THEN
    UPDATE public.contract_billing_events
       SET release_state = 'ELIGIBLE', release_approval_request_id = NULL, updated_at = now()
     WHERE id = e.id;
    INSERT INTO public.contract_billing_event_history
      (organization_id, billing_event_id, transition, from_state, to_state, reason, detail, actor_source, correlation_id)
    VALUES (e.organization_id, e.id, 'release_approval_stale', 'PENDING_RELEASE', 'ELIGIBLE',
            'Fatos mudaram depois da aprovação.',
            jsonb_build_object('approved_fingerprint', req.subject_fingerprint, 'current_fingerprint', fp),
            'system', e.correlation_id);
    RETURN jsonb_build_object('applied', false, 'reason', 'FINGERPRINT_CHANGED');
  END IF;

  UPDATE public.contract_billing_events
     SET release_state = 'RELEASED', released_at = now(),
         released_by = req.finalized_by, release_fingerprint = fp, updated_at = now()
   WHERE id = e.id;
  SELECT * INTO e FROM public.contract_billing_events WHERE id = e.id;

  INSERT INTO public.contract_billing_event_history
    (organization_id, billing_event_id, transition, from_state, to_state, detail, actor_user_id, actor_source, correlation_id)
  VALUES (e.organization_id, e.id, 'released', 'PENDING_RELEASE', 'RELEASED',
          jsonb_build_object('approval_request_id', req.id, 'release_fingerprint', fp,
                             'governance', 'approval_engine'),
          req.finalized_by, 'human', e.correlation_id);

  PERFORM public.contract_billing_emit(e, 'contracts.billing.released',
    jsonb_build_object('release_fingerprint', fp, 'approval_request_id', req.id,
                       'released_at', e.released_at),
    req.finalized_by, 'human');

  RETURN jsonb_build_object('applied', true, 'release_state', 'RELEASED', 'release_fingerprint', fp);
END $$;
REVOKE ALL ON FUNCTION public.contract_billing_apply_approval(uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 14) Cancelamento e supersessão (§57, §95)
-- ------------------------------------------------------------
-- Verdade financeira é REVERSÍVEL, não apagável. Não há DELETE aqui, e o
-- gatilho `cbe_no_erasure` garante que também não haja em lugar nenhum.
CREATE FUNCTION public.contract_billing_cancel(
  p_billing_event_id uuid,
  p_reason           text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e public.contract_billing_events%ROWTYPE; actor uuid := auth.uid();
BEGIN
  SELECT * INTO e FROM public.contract_billing_events WHERE id = p_billing_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_EVENT_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;
  IF e.release_state = 'CANCELLED' THEN
    RETURN jsonb_build_object('billing_event_id', e.id, 'release_state', 'CANCELLED', 'idempotent', true);
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'REASON_REQUIRED: cancelamento sem motivo não é registro, é apagamento com outro nome.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF actor IS NOT NULL THEN
    IF e.organization_id IS DISTINCT FROM public.current_user_organization_id() THEN
      RAISE EXCEPTION 'BILLING_EVENT_NOT_FOUND' USING ERRCODE = 'no_data_found';
    END IF;
    IF NOT (public.current_user_has_permission('contracts.billing.release')
            OR public.current_user_is_admin()) THEN
      RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.contract_billing_events
     SET release_state = 'CANCELLED', cancelled_at = now(), cancelled_by = actor,
         cancellation_reason = p_reason, updated_at = now()
   WHERE id = e.id;
  SELECT * INTO e FROM public.contract_billing_events WHERE id = e.id;

  INSERT INTO public.contract_billing_event_history
    (organization_id, billing_event_id, transition, from_state, to_state, reason,
     actor_user_id, actor_source, correlation_id)
  VALUES (e.organization_id, e.id, 'cancelled', NULL, 'CANCELLED', p_reason,
          actor, CASE WHEN actor IS NULL THEN 'system' ELSE 'human' END, e.correlation_id);

  PERFORM public.contract_billing_emit(e, 'contracts.billing.cancelled',
    jsonb_build_object('reason', p_reason), actor,
    CASE WHEN actor IS NULL THEN 'system' ELSE 'human' END);

  RETURN jsonb_build_object('billing_event_id', e.id, 'release_state', 'CANCELLED', 'idempotent', false);
END $$;
REVOKE ALL ON FUNCTION public.contract_billing_cancel(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_billing_cancel(uuid, text) TO authenticated;

/*
  Supersessão: o direito antigo permanece inteiro e um novo nasce apontando
  para ele. É a resposta da §95 à mudança material depois da liberação —
  sobrescrever o valor faria a liberação antiga passar a atestar um número que
  ninguém liberou.
*/
CREATE FUNCTION public.contract_billing_supersede(
  p_billing_event_id uuid,
  p_reason           text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e public.contract_billing_events%ROWTYPE;
  n public.contract_billing_events%ROWTYPE;
  actor uuid := auth.uid();
  new_id uuid;
BEGIN
  SELECT * INTO e FROM public.contract_billing_events WHERE id = p_billing_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_EVENT_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;
  IF e.superseded_by_id IS NOT NULL THEN
    RETURN jsonb_build_object('billing_event_id', e.id, 'successor_id', e.superseded_by_id,
                              'idempotent', true);
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;
  IF actor IS NOT NULL THEN
    IF e.organization_id IS DISTINCT FROM public.current_user_organization_id() THEN
      RAISE EXCEPTION 'BILLING_EVENT_NOT_FOUND' USING ERRCODE = 'no_data_found';
    END IF;
    IF NOT (public.current_user_has_permission('contracts.billing.release')
            OR public.current_user_is_admin()) THEN
      RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- O antigo sai do índice de unicidade ao virar SUPERSEDED; só então a mesma
  -- chave de direito pode ser reusada pelo sucessor.
  UPDATE public.contract_billing_events
     SET release_state = 'SUPERSEDED', supersession_reason = p_reason, updated_at = now()
   WHERE id = e.id;

  INSERT INTO public.contract_billing_events
    (organization_id, contract_id, milestone_id, title, amount, due_date, status,
     currency, source_kind, source_measurement_id, occurrence_key, entitlement_key,
     amount_source, amount_source_id, amount_source_revision, amount_derivation_rule,
     amount_derived_at, release_state, supersedes_id, correlation_id, source_event_id)
  VALUES
    (e.organization_id, e.contract_id, e.milestone_id, e.title, e.amount, e.due_date, e.status,
     e.currency, e.source_kind, e.source_measurement_id, e.occurrence_key, e.entitlement_key,
     e.amount_source, e.amount_source_id, e.amount_source_revision, e.amount_derivation_rule,
     now(), 'NOT_ELIGIBLE', e.id, e.correlation_id, e.source_event_id)
  RETURNING id INTO new_id;

  UPDATE public.contract_billing_events SET superseded_by_id = new_id WHERE id = e.id;
  SELECT * INTO e FROM public.contract_billing_events WHERE id = e.id;
  SELECT * INTO n FROM public.contract_billing_events WHERE id = new_id;

  INSERT INTO public.contract_billing_event_history
    (organization_id, billing_event_id, transition, from_state, to_state, reason, detail,
     actor_user_id, actor_source, correlation_id)
  VALUES (e.organization_id, e.id, 'superseded', NULL, 'SUPERSEDED', p_reason,
          jsonb_build_object('successor_id', new_id), actor,
          CASE WHEN actor IS NULL THEN 'system' ELSE 'human' END, e.correlation_id);

  PERFORM public.contract_billing_recompute_eligibility(new_id);
  RETURN jsonb_build_object('billing_event_id', e.id, 'successor_id', new_id, 'idempotent', false);
END $$;
REVOKE ALL ON FUNCTION public.contract_billing_supersede(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_billing_supersede(uuid, text) TO authenticated;

-- ------------------------------------------------------------
-- 15) PONTE DA FASE 6 — medição aceita vira CANDIDATO (§21, §22)
-- ------------------------------------------------------------
/*
  `projects.measurement.accepted` é o primeiro fato canônico a montante da
  Fase 7. O que ele produz é um CANDIDATO a faturar, com procedência, e nada
  além disso — a §14 e a §21 são explícitas: aceitar medição NÃO libera
  faturamento.

  ─── Idempotência (§22, §67) ──────────────────────────────────────────────

  A chave de direito é derivada da identidade de negócio: organização, contrato,
  tipo de origem, medição e revisão. A unicidade mora num índice do banco, e não
  numa checagem do chamador — duas entregas simultâneas do mesmo evento
  chegariam as duas ao `EXISTS` e as duas o veriam falso. O caminho de escrita
  é protegido pelo índice, e a violação é traduzida em resposta idempotente.
*/
CREATE FUNCTION public.contract_billing_apply_measurement_accepted(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ev   public.domain_events%ROWTYPE;
  m    public.project_measurements%ROWTYPE;
  key  text;
  new_id uuid;
  existing uuid;
  elig jsonb;
BEGIN
  SELECT * INTO ev FROM public.domain_events WHERE id = p_event_id;
  IF NOT FOUND OR ev.event_type <> 'projects.measurement.accepted' THEN
    RETURN jsonb_build_object('created', false, 'reason', 'NOT_A_MEASUREMENT_ACCEPTED_EVENT');
  END IF;

  SELECT * INTO m FROM public.project_measurements
   WHERE id = ev.aggregate_id AND organization_id = ev.organization_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('created', false, 'reason', 'MEASUREMENT_NOT_FOUND');
  END IF;
  -- Medição que deixou de estar aceita (rejeitada depois, superada) não vira
  -- candidato retroativamente. O fato é histórico; o estado é o que vale.
  IF m.status <> 'ACCEPTED' THEN
    RETURN jsonb_build_object('created', false, 'reason', 'MEASUREMENT_NOT_ACCEPTED',
                              'status', m.status);
  END IF;
  IF m.contract_id IS NULL THEN
    -- Sem contrato não há direito comercial a faturar. Isto é informação, não
    -- falha: medição de projeto sem vínculo contratual existe e é legítima.
    RETURN jsonb_build_object('created', false, 'reason', 'MEASUREMENT_WITHOUT_CONTRACT');
  END IF;

  key := concat_ws(':', 'ACCEPTED_MEASUREMENT', m.contract_id::text, m.id::text, m.revision::text);

  SELECT id INTO existing FROM public.contract_billing_events
   WHERE organization_id = m.organization_id AND entitlement_key = key
     AND release_state NOT IN ('CANCELLED','SUPERSEDED');
  IF existing IS NOT NULL THEN
    RETURN jsonb_build_object('created', false, 'idempotent', true, 'billing_event_id', existing);
  END IF;

  BEGIN
    INSERT INTO public.contract_billing_events
      (organization_id, contract_id, milestone_id, title, amount, due_date, status,
       currency, source_kind, source_measurement_id, occurrence_key, entitlement_key,
       release_state, eligibility_state, correlation_id, source_event_id)
    VALUES
      (m.organization_id, m.contract_id, m.milestone_id,
       format('Medição %s', COALESCE(m.occurrence_key, m.id::text)),
       -- Nasce com o valor ACEITO. A procedência é gravada logo abaixo pelo
       -- recomputo, que é o único lugar que decide `amount_source`.
       COALESCE(m.accepted_value, 0), NULL, 'pendente',
       CASE WHEN m.accepted_currency ~ '^[A-Z]{3}$' THEN m.accepted_currency END,
       'ACCEPTED_MEASUREMENT', m.id, m.occurrence_key, key,
       'NOT_ELIGIBLE', 'UNKNOWN', ev.correlation_id, ev.id)
    RETURNING id INTO new_id;
  EXCEPTION WHEN unique_violation THEN
    -- Corrida perdida: o outro consumidor criou o mesmo direito. Devolver o
    -- que existe é o comportamento correto de um handler at-least-once.
    SELECT id INTO existing FROM public.contract_billing_events
     WHERE organization_id = m.organization_id AND entitlement_key = key
       AND release_state NOT IN ('CANCELLED','SUPERSEDED');
    RETURN jsonb_build_object('created', false, 'idempotent', true, 'billing_event_id', existing);
  END;

  INSERT INTO public.contract_billing_event_history
    (organization_id, billing_event_id, transition, to_state, detail, actor_source, correlation_id)
  VALUES (m.organization_id, new_id, 'candidate_from_accepted_measurement', 'NOT_ELIGIBLE',
          jsonb_build_object('measurement_id', m.id, 'revision', m.revision,
                             'source_event_id', ev.id, 'entitlement_key', key),
          'system', ev.correlation_id);

  -- Candidato criado, elegibilidade calculada, liberação NÃO. A §21 é literal.
  elig := public.contract_billing_recompute_eligibility(new_id);

  RETURN jsonb_build_object('created', true, 'billing_event_id', new_id,
                            'entitlement_key', key, 'eligibility', elig->>'state',
                            'released', false);
END $$;
REVOKE ALL ON FUNCTION public.contract_billing_apply_measurement_accepted(uuid)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.contract_billing_apply_measurement_accepted(uuid) IS
  'Ponte Fase 6 → Fase 7. Medição aceita produz CANDIDATO com procedência; '
  'nunca liberação (§14, §21). Idempotente por chave de direito no banco.';

-- ------------------------------------------------------------
-- 16) O RESÍDUO DA FASE 6, RESOLVIDO (§12)
-- ------------------------------------------------------------
/*
  `createBillingEventFromMilestone` montava o valor com
  `measured_amount ?? billing_amount` e gravava o resultado sem dizer qual das
  duas fontes venceu. Ficou registrado nos deferidos da Fase 6 como resíduo, e
  a §12 manda resolvê-lo aqui.

  O problema nunca foi o `??` em si — era o SILÊNCIO depois dele: "faturado
  pelo previsto" e "faturado pelo medido" viravam a mesma linha, e a diferença
  reaparecia na conversa com o cliente.

  Esta função substitui aquele caminho. Ela não escolhe entre duas colunas: ela
  chama o resolvedor de procedência, que percorre a precedência congelada da
  Fase 6 e devolve valor E FONTE. `billing_amount` continua sem degrau
  nenhum — quando não há medição nem direito contratual cadastrado, o
  faturamento nasce com `amount_source = 'UNKNOWN'` e elegibilidade
  INCOMPLETE, e o `AMOUNT_UNKNOWN` fica visível na tela.

  Nascer com valor 0 e fonte UNKNOWN não é afirmar que vale zero: `amount` é
  NOT NULL desde a criação da tabela, e quem lê o número é obrigado a ler a
  fonte junto — o modelo de leitura da 139 entrega as duas na mesma linha, e a
  §62 é o que exige essa leitura conjunta.
*/
CREATE FUNCTION public.contract_billing_create_from_milestone(
  p_milestone_id uuid,
  p_title        text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ms    public.contract_milestones%ROWTYPE;
  actor uuid := auth.uid();
  new_id uuid;
  elig  jsonb;
BEGIN
  SELECT * INTO ms FROM public.contract_milestones WHERE id = p_milestone_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MILESTONE_NOT_FOUND: marco inexistente.' USING ERRCODE = 'no_data_found';
  END IF;
  IF actor IS NULL THEN
    RAISE EXCEPTION 'ACTOR_REQUIRED: criação de faturamento exige pessoa autenticada.'
      USING ERRCODE = '42501';
  END IF;
  IF ms.organization_id IS DISTINCT FROM public.current_user_organization_id() THEN
    RAISE EXCEPTION 'MILESTONE_NOT_FOUND: marco inexistente.' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT (public.current_user_has_permission('contracts.edit')
          OR public.current_user_is_admin()) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: falta a permissão contracts.edit.' USING ERRCODE = '42501';
  END IF;

  -- Sem escrita dupla: o marco já governado pela Fase 7 não ganha um segundo
  -- direito por este caminho (§129).
  IF EXISTS (SELECT 1 FROM public.contract_billing_events g
              WHERE g.organization_id = ms.organization_id AND g.milestone_id = ms.id
                AND g.entitlement_key IS NOT NULL
                AND g.release_state NOT IN ('CANCELLED','SUPERSEDED')) THEN
    RAISE EXCEPTION 'BILLING_CUTOVER: este marco já tem direito de faturamento governado (§129).'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.contract_billing_events
    (organization_id, contract_id, milestone_id, title, amount, due_date, status,
     source_kind, entitlement_key, release_state, eligibility_state)
  VALUES
    (ms.organization_id, ms.contract_id, ms.id,
     COALESCE(NULLIF(btrim(COALESCE(p_title,'')),''), ms.title),
     0, ms.due_date, 'pendente',
     'LEGACY_MILESTONE',
     -- Um direito por marco, por este caminho. A unicidade mora no índice.
     concat_ws(':', 'LEGACY_MILESTONE', ms.contract_id::text, ms.id::text),
     'NOT_ELIGIBLE', 'UNKNOWN')
  RETURNING id INTO new_id;

  INSERT INTO public.contract_billing_event_history
    (organization_id, billing_event_id, transition, to_state, detail, actor_user_id,
     actor_source)
  VALUES (ms.organization_id, new_id, 'created_from_milestone', 'NOT_ELIGIBLE',
          jsonb_build_object('milestone_id', ms.id,
                             'billing_amount_present', ms.billing_amount IS NOT NULL),
          actor, 'human');

  -- É o recomputo que grava valor E procedência. Nenhum outro caminho decide
  -- `amount_source`, e é por isso que não sobra lugar para o `??` voltar.
  elig := public.contract_billing_recompute_eligibility(new_id);

  RETURN jsonb_build_object('billing_event_id', new_id,
                            'amount', elig->'amount', 'currency', elig->>'currency',
                            'amount_source', elig->>'amount_source',
                            'eligibility_state', elig->>'state',
                            'reasons', elig->'reasons');
END $$;
REVOKE ALL ON FUNCTION public.contract_billing_create_from_milestone(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_billing_create_from_milestone(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.contract_billing_create_from_milestone(uuid, text) IS
  'Substitui o `measured_amount ?? billing_amount` opaco da Fase 6 (§12). O '
  'valor e a FONTE vêm do resolvedor de procedência; billing_amount nunca é '
  'degrau. Sem fonte, nasce UNKNOWN e visivelmente não faturável.';

-- ------------------------------------------------------------
-- 17) Permissões
-- ------------------------------------------------------------
INSERT INTO public.permissions (key, module, action, description) VALUES
  ('contracts.billing.release', 'contracts', 'billing.release',
   'Liberar faturamento elegível, cancelar e superar liberação'),
  ('contracts.billing.adjust',  'contracts', 'billing.adjust',
   'Registrar ajuste comercial governado sobre faturamento')
ON CONFLICT (key) DO NOTHING;

/*
  Quem MEDE e quem LIBERA COBRANÇA são papéis distintos, e a seed é onde a
  distinção começa.

  `owner_admin` recebe tudo, como sempre. `juridico_contratos` e `financeiro`
  recebem a liberação porque liberar faturamento é ato comercial/financeiro.
  `engenharia_pcp` NÃO recebe: ela prepara e submete medição, e dar-lhe a
  liberação tornaria impossível escrever o teste que prova que quem mediu não
  cobrou.

  Isto é atribuição de PAPEL, e não política de alçada. Alçada, quórum e
  aprovador nomeado continuam inexistentes — a §18 proíbe inventá-los.
*/
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
 WHERE r.organization_id IS NULL
   AND r.key IN ('owner_admin', 'juridico_contratos', 'financeiro')
   AND p.key LIKE 'contracts.billing.%'
ON CONFLICT DO NOTHING;

COMMIT;
