-- ============================================================================
-- 192 — ANÁLISE CONTRATUAL DA MEDIÇÃO, ENVIO E ACEITE DA CONTRATANTE
--
-- ─── O que esta migration NÃO faz ─────────────────────────────────────────
--
-- Não cria uma segunda máquina de estados. A máquina canônica é a da 130, e
-- todo caminho de escrita continua sendo a RPC da 133. O que muda aqui é que
-- a máquina passa a NOMEAR três estados que a operação já vivia sem nome:
--
--   APPROVED_FOR_CUSTOMER          o pacote interno foi aprovado para envio
--   AWAITING_CUSTOMER_ACCEPTANCE   o pacote FOI enviado e espera a Contratante
--   CUSTOMER_CORRECTION_REQUESTED  a Contratante pediu correção
--
-- Antes desta migration os três eram `SUBMITTED`. Colapsados, "submetida para
-- análise interna" e "na mão do cliente há vinte dias" tinham a mesma cara — e
-- é justamente entre os dois que mora o SLA que ninguém conseguia cobrar.
--
-- ─── O que continua absolutamente igual ───────────────────────────────────
--
--   · ACEITE É NUNCA AUTOMATIZADO. `project_measurement_accept` continua sendo
--     a única porta, continua exigindo fonte + ator/proveniência, e continua
--     recusando o sistema se passando por revisor.
--   · APROVAR PARA ENVIO NÃO É ACEITE. O estado novo diz, no próprio nome, que
--     o pacote está pronto para SAIR — não que alguém do outro lado disse sim.
--   · Correção NÃO cria medição nova. O mesmo id volta, com a lista exata do
--     que corrigir, e reentra na fila pela mesma linha.
--   · Fato aceito continua imutável e só sai por supersessão.
--
-- ─── Por que o envio ao cliente tem tabela própria ────────────────────────
--
-- Porque enviar acontece MAIS DE UMA VEZ. O cliente pede correção, o pacote
-- volta, é reenviado — e cada remessa tem destinatário, data, referência de
-- comunicação e conjunto de documentos PRÓPRIOS. Em colunas na medição, a
-- segunda remessa apagaria a primeira, que é exatamente a prova que uma
-- discussão contratual de atraso precisa ter.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Os três estados novos
-- ---------------------------------------------------------------------------
ALTER TABLE public.project_measurements
  DROP CONSTRAINT project_measurements_status_check;

ALTER TABLE public.project_measurements
  ADD CONSTRAINT project_measurements_status_check CHECK (status IN (
    'PLANNED','IN_PREPARATION','READY_FOR_SUBMISSION',
    'SUBMITTED','UNDER_REVIEW',
    'APPROVED_FOR_CUSTOMER','AWAITING_CUSTOMER_ACCEPTANCE','CUSTOMER_CORRECTION_REQUESTED',
    'ACCEPTED','REJECTED','RETURNED_FOR_CORRECTION','CANCELLED','SUPERSEDED'));

ALTER TABLE public.project_measurements
  ADD COLUMN IF NOT EXISTS review_started_at               timestamptz,
  ADD COLUMN IF NOT EXISTS approved_for_customer_at        timestamptz,
  ADD COLUMN IF NOT EXISTS sent_to_customer_at             timestamptz,
  ADD COLUMN IF NOT EXISTS customer_correction_at          timestamptz,
  ADD COLUMN IF NOT EXISTS customer_correction_reason      text,
  -- Prazo acordado com a Contratante para a resposta. É DADO DECLARADO por
  -- quem enviou, nunca inferido: sem prazo informado a coluna fica nula e o
  -- SLA diz "prazo não apurado" em vez de inventar trinta dias.
  ADD COLUMN IF NOT EXISTS customer_due_at                 date;

/*
  Coerência dos carimbos, na mesma forma dos que já existiam: o estado exige o
  carimbo, e o carimbo sobrevive ao estado (a medição aceita continua sabendo
  quando foi enviada). A assimetria é deliberada e é a mesma da §41 — apagar a
  data de envio ao aceitar seria reescrever a história do envio.
*/
ALTER TABLE public.project_measurements
  ADD CONSTRAINT pm_approved_for_customer_coherent CHECK (
    (status <> 'APPROVED_FOR_CUSTOMER') OR (approved_for_customer_at IS NOT NULL)),
  ADD CONSTRAINT pm_sent_to_customer_coherent CHECK (
    (status <> 'AWAITING_CUSTOMER_ACCEPTANCE') OR (sent_to_customer_at IS NOT NULL)),
  ADD CONSTRAINT pm_customer_correction_coherent CHECK (
    (status <> 'CUSTOMER_CORRECTION_REQUESTED')
    OR (customer_correction_at IS NOT NULL
        AND NULLIF(btrim(COALESCE(customer_correction_reason,'')), '') IS NOT NULL));

COMMENT ON COLUMN public.project_measurements.approved_for_customer_at IS
  'Quando a Gestão de Contratos aprovou o pacote PARA ENVIO. Não é aceite: o '
  'aceite tem colunas próprias e fonte autoritativa própria (§11).';
COMMENT ON COLUMN public.project_measurements.customer_due_at IS
  'Prazo DECLARADO para a resposta da Contratante. Nulo é "não apurado", e o '
  'SLA o trata como tal — não existe prazo padrão inventado.';

-- ---------------------------------------------------------------------------
-- 2) Remessas ao cliente — uma linha por ENVIO, somente acréscimo
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_measurement_customer_dispatches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  measurement_id      uuid NOT NULL,
  -- Contagem da remessa (1ª, 2ª...). Torna a repetição legível sem contar linhas.
  attempt             integer NOT NULL CHECK (attempt > 0),

  -- ---- quem, de cá e de lá ----
  sent_by_user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_party_id   uuid,
  customer_contact    text,

  -- ---- a comunicação ----
  sent_at             timestamptz NOT NULL DEFAULT now(),
  channel             text NOT NULL DEFAULT 'email'
                        CHECK (channel IN ('email','portal','protocol','courier','meeting','other')),
  -- Protocolo/número do e-mail/ofício. É a âncora da discussão de atraso.
  external_reference  text,
  due_at              date,
  note                text,
  -- Os documentos que SAÍRAM. Ids canônicos de `project_files`, nunca cópias.
  document_ids        uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],

  CONSTRAINT pmcd_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pmcd_attempt_unique UNIQUE (organization_id, measurement_id, attempt),
  CONSTRAINT pmcd_measurement_tenant FOREIGN KEY (organization_id, measurement_id)
    REFERENCES public.project_measurements (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT pmcd_party_tenant FOREIGN KEY (organization_id, customer_party_id)
    REFERENCES public.parties (organization_id, id) ON DELETE SET NULL,
  -- Uma remessa precisa dizer PARA QUEM ou SOB QUAL referência. Sem nenhum dos
  -- dois, "enviado ao cliente" é afirmação sem lastro — e é exatamente sobre
  -- ela que uma cobrança de atraso viraria palavra contra palavra.
  CONSTRAINT pmcd_addressed CHECK (
    customer_party_id IS NOT NULL
    OR NULLIF(btrim(COALESCE(customer_contact,'')), '') IS NOT NULL
    OR NULLIF(btrim(COALESCE(external_reference,'')), '') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS pmcd_measurement
  ON public.project_measurement_customer_dispatches (organization_id, measurement_id, sent_at DESC);

ALTER TABLE public.project_measurement_customer_dispatches ENABLE ROW LEVEL SECURITY;
CREATE POLICY pmcd_select ON public.project_measurement_customer_dispatches FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.current_user_has_permission('projects.measurements.view')
              OR public.current_user_has_permission('contracts.view')
              OR public.current_user_is_admin()));
GRANT SELECT ON public.project_measurement_customer_dispatches TO authenticated;
-- REFERENCES e TRIGGER entram no REVOKE junto com a escrita: os dois vêm do
-- ACL padrão do schema e, sozinhos, deixam `authenticated` pendurar chave
-- estrangeira e gatilho numa tabela que ele nem pode escrever.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.project_measurement_customer_dispatches FROM authenticated, anon;
REVOKE ALL ON public.project_measurement_customer_dispatches FROM anon;

CREATE TRIGGER pmcd_immutable BEFORE UPDATE ON public.project_measurement_customer_dispatches
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_mutation();
CREATE TRIGGER pmcd_no_erasure BEFORE DELETE ON public.project_measurement_customer_dispatches
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

COMMENT ON TABLE public.project_measurement_customer_dispatches IS
  'Uma linha por REMESSA à Contratante. Somente acréscimo: a segunda remessa '
  'não apaga a primeira, porque as duas são prova.';

-- ---------------------------------------------------------------------------
-- 3) Itens de correção — "o que exatamente eu tenho de arrumar?"
-- ---------------------------------------------------------------------------
/*
  A §6 do pedido exige MOTIVO e ITENS. Um campo de texto livre atende o motivo
  e some com os itens: "faltou o relatório e a assinatura da página 3" vira uma
  frase que ninguém consegue marcar como resolvida. Aqui cada item é linha, com
  a exigência contratual a que se refere quando ela existe.

  A rodada (`round`) é o que impede que a correção pedida em julho e a pedida
  em agosto virem uma lista só de doze pendências sem dono.
*/
CREATE TABLE IF NOT EXISTS public.project_measurement_correction_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  measurement_id    uuid NOT NULL,
  round             integer NOT NULL CHECK (round > 0),
  -- Quem pediu a correção: a análise interna ou a própria Contratante.
  requested_by_side text NOT NULL CHECK (requested_by_side IN ('contract_management','customer')),
  requested_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at      timestamptz NOT NULL DEFAULT now(),

  item              text NOT NULL CHECK (btrim(item) <> ''),
  requirement_kind  text CHECK (requirement_kind IS NULL OR requirement_kind IN
                       ('TECHNICAL_REPORT','SERVICE_REPORT','DOCUMENT','PHOTOS',
                        'TESTS_INSPECTION','EVIDENCE','CUSTOMER_ACCEPTANCE')),
  -- Natureza do trabalho que resolve o item (§2 do pedido).
  category          text NOT NULL DEFAULT 'documental'
                      CHECK (category IN ('operacional','documental','medicao',
                                          'aprovacao_interna','aceite_externo')),

  -- ---- desfecho ----
  -- Resolver é ato de quem corrige; fechar a rodada é consequência do reenvio.
  resolved_at       timestamptz,
  resolved_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_note   text,

  CONSTRAINT pmci_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pmci_measurement_tenant FOREIGN KEY (organization_id, measurement_id)
    REFERENCES public.project_measurements (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT pmci_resolution_stamp CHECK ((resolved_at IS NULL) = (resolved_by IS NULL))
);

CREATE INDEX IF NOT EXISTS pmci_measurement
  ON public.project_measurement_correction_items (organization_id, measurement_id, round DESC);
CREATE INDEX IF NOT EXISTS pmci_open
  ON public.project_measurement_correction_items (organization_id, measurement_id)
  WHERE resolved_at IS NULL;

ALTER TABLE public.project_measurement_correction_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY pmci_select ON public.project_measurement_correction_items FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.current_user_has_permission('projects.measurements.view')
              OR public.current_user_has_permission('contracts.view')
              OR public.current_user_is_admin()));
GRANT SELECT ON public.project_measurement_correction_items TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.project_measurement_correction_items FROM authenticated, anon;
REVOKE ALL ON public.project_measurement_correction_items FROM anon;

COMMENT ON TABLE public.project_measurement_correction_items IS
  'A lista EXATA do que corrigir, por rodada e por lado que pediu. Texto livre '
  'num campo só não se marca como resolvido — e o que não se marca, não se cobra.';

-- ---------------------------------------------------------------------------
-- 4) A máquina de estados, ESTENDIDA
-- ---------------------------------------------------------------------------
/*
  As arestas novas, e o porquê de cada uma:

    SUBMITTED/UNDER_REVIEW → APPROVED_FOR_CUSTOMER
      A Gestão de Contratos fecha a análise interna. Continua faltando o
      cliente.

    APPROVED_FOR_CUSTOMER → AWAITING_CUSTOMER_ACCEPTANCE
      Só o ENVIO move. Aprovar e enviar são dois atos porque o pacote pode ser
      aprovado hoje e sair na segunda — e enquanto não saiu, o relógio da
      Contratante não corre.

    AWAITING_CUSTOMER_ACCEPTANCE → ACCEPTED | CUSTOMER_CORRECTION_REQUESTED | REJECTED
      Os três desfechos reais do outro lado.

    CUSTOMER_CORRECTION_REQUESTED → IN_PREPARATION | READY_FOR_SUBMISSION | SUBMITTED
      O MESMO item volta. Nunca uma medição nova.

    RETURNED_FOR_CORRECTION → SUBMITTED
      O reenvio direto. Antes, devolver obrigava a passar por preparação para
      voltar à fila — três cliques para dizer "corrigi".

  E o que NÃO muda: ACCEPTED continua saindo só por SUPERSEDED, e nada alcança
  ACCEPTED sem passar por um estado em que alguém, de fora, podia responder.
*/
CREATE OR REPLACE FUNCTION public.project_measurement_valid_transition(p_from text, p_to text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE p_from
    WHEN 'PLANNED'                 THEN p_to IN ('IN_PREPARATION','CANCELLED','SUPERSEDED')
    WHEN 'IN_PREPARATION'          THEN p_to IN ('READY_FOR_SUBMISSION','PLANNED','CANCELLED','SUPERSEDED')
    WHEN 'READY_FOR_SUBMISSION'    THEN p_to IN ('SUBMITTED','IN_PREPARATION','CANCELLED','SUPERSEDED')
    WHEN 'SUBMITTED'               THEN p_to IN ('UNDER_REVIEW','APPROVED_FOR_CUSTOMER','ACCEPTED',
                                                 'REJECTED','RETURNED_FOR_CORRECTION','CANCELLED')
    WHEN 'UNDER_REVIEW'            THEN p_to IN ('APPROVED_FOR_CUSTOMER','ACCEPTED',
                                                 'REJECTED','RETURNED_FOR_CORRECTION')
    WHEN 'APPROVED_FOR_CUSTOMER'   THEN p_to IN ('AWAITING_CUSTOMER_ACCEPTANCE','UNDER_REVIEW',
                                                 'RETURNED_FOR_CORRECTION','CANCELLED','SUPERSEDED')
    WHEN 'AWAITING_CUSTOMER_ACCEPTANCE'
                                   THEN p_to IN ('ACCEPTED','CUSTOMER_CORRECTION_REQUESTED',
                                                 'REJECTED','CANCELLED')
    WHEN 'CUSTOMER_CORRECTION_REQUESTED'
                                   THEN p_to IN ('IN_PREPARATION','READY_FOR_SUBMISSION','SUBMITTED',
                                                 'CANCELLED','SUPERSEDED')
    WHEN 'RETURNED_FOR_CORRECTION' THEN p_to IN ('IN_PREPARATION','READY_FOR_SUBMISSION','SUBMITTED',
                                                 'CANCELLED','SUPERSEDED')
    WHEN 'REJECTED'                THEN p_to IN ('SUPERSEDED')
    WHEN 'ACCEPTED'                THEN p_to IN ('SUPERSEDED')
    WHEN 'CANCELLED'               THEN false
    WHEN 'SUPERSEDED'              THEN false
    ELSE false END
$$;

COMMENT ON FUNCTION public.project_measurement_valid_transition(text, text) IS
  'Tabela verdade da máquina de estados, com a análise contratual e o aceite '
  'da Contratante nomeados. ACCEPTED só sai por SUPERSEDED (§73); REJECTED, '
  'RETURNED_FOR_CORRECTION e CUSTOMER_CORRECTION_REQUESTED nunca se confundem.';

-- ---------------------------------------------------------------------------
-- 5) O executor comum aprende os carimbos novos
-- ---------------------------------------------------------------------------
/*
  Só a lista de carimbos muda. O resto do corpo é o da 133, literalmente — e é
  reescrito por inteiro porque `CREATE OR REPLACE FUNCTION` não conhece patch.
  A ordem das etapas continua sendo a da §37.
*/
CREATE OR REPLACE FUNCTION public.project_measurement_transition(
  p_measurement_id uuid,
  p_to_state       text,
  p_event_type     text,
  p_reason         text  DEFAULT NULL,
  p_actor_source   text  DEFAULT 'human',
  p_actor_reference text DEFAULT NULL,
  p_provenance     jsonb DEFAULT '{}'::jsonb,
  p_payload        jsonb DEFAULT '{}'::jsonb,
  p_required_permission text DEFAULT NULL,
  p_stamp          text  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m public.project_measurements%ROWTYPE;
  actor uuid := auth.uid();
  ev uuid;
  hist uuid;
BEGIN
  SELECT * INTO m FROM public.project_measurements WHERE id = p_measurement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEASUREMENT_NOT_FOUND: medição inexistente.' USING ERRCODE = 'no_data_found';
  END IF;

  IF actor IS NOT NULL
     AND m.organization_id IS DISTINCT FROM public.current_user_organization_id() THEN
    RAISE EXCEPTION 'MEASUREMENT_NOT_FOUND: medição inexistente.' USING ERRCODE = 'no_data_found';
  END IF;

  IF p_required_permission IS NOT NULL
     AND actor IS NOT NULL
     AND NOT (public.current_user_has_permission(p_required_permission) OR public.current_user_is_admin()) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: falta a permissão %.', p_required_permission USING ERRCODE = '42501';
  END IF;

  IF NOT public.project_measurement_valid_transition(m.status, p_to_state) THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: % -> % não é permitido.', m.status, p_to_state
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_stamp IS NOT NULL AND p_stamp NOT IN (
       'submitted_at','rejected_at','returned_at','cancelled_at',
       'review_started_at','approved_for_customer_at','sent_to_customer_at',
       'customer_correction_at') THEN
    RAISE EXCEPTION 'UNKNOWN_STAMP: %', p_stamp USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.project_measurements
     SET status = p_to_state,
         submitted_at = CASE WHEN p_stamp = 'submitted_at' THEN now() ELSE submitted_at END,
         rejected_at  = CASE WHEN p_stamp = 'rejected_at'  THEN now() ELSE rejected_at  END,
         returned_at  = CASE WHEN p_stamp = 'returned_at'  THEN now() ELSE returned_at  END,
         cancelled_at = CASE WHEN p_stamp = 'cancelled_at' THEN now() ELSE cancelled_at END,
         review_started_at = CASE WHEN p_stamp = 'review_started_at' THEN now() ELSE review_started_at END,
         approved_for_customer_at = CASE WHEN p_stamp = 'approved_for_customer_at'
                                         THEN now() ELSE approved_for_customer_at END,
         sent_to_customer_at = CASE WHEN p_stamp = 'sent_to_customer_at'
                                    THEN now() ELSE sent_to_customer_at END,
         customer_correction_at = CASE WHEN p_stamp = 'customer_correction_at'
                                       THEN now() ELSE customer_correction_at END
   WHERE id = m.id;
  SELECT * INTO m FROM public.project_measurements WHERE id = m.id;

  SELECT id INTO hist FROM public.project_measurement_history
   WHERE measurement_id = m.id ORDER BY recorded_at DESC, id DESC LIMIT 1;

  ev := public.project_measurement_emit(m, p_event_type, p_payload, actor,
          CASE WHEN p_actor_source IN ('human','system','cron','provider','integration')
               THEN p_actor_source ELSE 'system' END);

  INSERT INTO public.project_measurement_history
    (organization_id, measurement_id, from_state, to_state, transition, reason,
     actor_user_id, actor_source, actor_reference, provenance, correlation_id, domain_event_id)
  VALUES (m.organization_id, m.id, p_to_state, p_to_state, 'provenance_note', p_reason,
          actor, p_actor_source, p_actor_reference,
          COALESCE(p_provenance,'{}'::jsonb) || jsonb_build_object('history_id', hist),
          m.correlation_id, ev);

  PERFORM public.project_measurement_recompute_readiness(m.id);

  RETURN jsonb_build_object('measurement_id', m.id, 'status', m.status,
                            'event_id', ev, 'revision', m.revision);
END $$;
REVOKE ALL ON FUNCTION public.project_measurement_transition(
  uuid, text, text, text, text, text, jsonb, jsonb, text, text) FROM PUBLIC, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 6) A PRONTIDÃO aprende os estados novos
-- ---------------------------------------------------------------------------
/*
  Três lugares mudam, e só três:

    · `submission`  — já submetido é submetido, em qualquer etapa da análise;
    · `acceptance`  — aguardar o cliente é INCOMPLETE, nunca READY. Repare que
      `APPROVED_FOR_CUSTOMER` também é INCOMPLETE: aprovar para envio é ato
      interno, e transformá-lo em aceite é exatamente a fabricação que a §11
      proíbe;
    · `billing_prerequisite` — continua exigindo `ACCEPTED`. Nenhum estado novo
      concede direito de faturar.

  O resto da função é o da 132, palavra por palavra.
*/
CREATE OR REPLACE FUNCTION public.project_measurement_readiness(
  p_measurement_id uuid,
  p_as_of          date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m           public.project_measurements%ROWTYPE;
  r           public.contract_measurement_requirements%ROWTYPE;
  as_of       date := COALESCE(p_as_of, CURRENT_DATE);
  dims        jsonb := '{}'::jsonb;
  reasons     text[] := ARRAY[]::text[];
  overall     text;
  states      text[];
  s           text;

  has_mapping     boolean;
  evidence_count  integer;
  validated_count integer;
  missing_req     text[];
  unknown_req     text[];
  blocking_obl    integer;
  rule_ok         boolean;
  open_corrections integer;

  d_execution text; d_evidence text; d_report text; d_docs text;
  d_complete  text; d_submission text; d_acceptance text; d_billing text;
BEGIN
  SELECT * INTO m FROM public.project_measurements WHERE id = p_measurement_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('overall','UNKNOWN','reasons', to_jsonb(ARRAY['MEASUREMENT_NOT_FOUND']),
                              'dimensions','{}'::jsonb,'as_of',as_of);
  END IF;

  IF auth.uid() IS NOT NULL
     AND m.organization_id IS DISTINCT FROM public.current_user_organization_id() THEN
    RETURN jsonb_build_object('overall','UNKNOWN','reasons', to_jsonb(ARRAY['MEASUREMENT_NOT_FOUND']),
                              'dimensions','{}'::jsonb,'as_of',as_of);
  END IF;

  SELECT * INTO r FROM public.contract_measurement_requirements
   WHERE id = m.contract_measurement_rule_id AND organization_id = m.organization_id;

  rule_ok := FOUND
    AND (r.effective_from IS NULL OR r.effective_from <= COALESCE(m.measurement_period_end, m.expected_at, as_of))
    AND (r.effective_until IS NULL OR r.effective_until > COALESCE(m.measurement_period_start, m.expected_at, as_of))
    AND r.effect <> 'removed';

  IF NOT rule_ok THEN reasons := reasons || 'RULE_UNRESOLVED'::text; END IF;
  IF m.occurrence_state = 'unresolved' THEN reasons := reasons || 'OCCURRENCE_UNRESOLVED'::text; END IF;

  has_mapping := m.timeline_item_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.contract_measurement_rule_timeline_governed g
                WHERE g.organization_id = m.organization_id
                  AND g.rule_id = m.contract_measurement_rule_id
                  AND g.project_id = m.project_id);
  IF NOT has_mapping THEN reasons := reasons || 'TIMELINE_MAPPING_UNRESOLVED'::text; END IF;

  SELECT count(*)::int, count(*) FILTER (WHERE validation_state = 'validated')::int
    INTO evidence_count, validated_count
    FROM public.project_measurement_evidence
   WHERE measurement_id = m.id AND revoked_at IS NULL;

  SELECT array_agg(requirement_kind ORDER BY requirement_kind)
    INTO missing_req
    FROM public.project_measurement_requirements
   WHERE measurement_id = m.id AND required AND satisfaction_state = 'MISSING';

  SELECT array_agg(requirement_kind ORDER BY requirement_kind)
    INTO unknown_req
    FROM public.project_measurement_requirements
   WHERE measurement_id = m.id AND satisfaction_state = 'UNKNOWN';

  SELECT count(*)::int INTO open_corrections
    FROM public.project_measurement_correction_items
   WHERE measurement_id = m.id AND resolved_at IS NULL;

  SELECT count(*)::int INTO blocking_obl
    FROM public.contract_obligation_instances i
    JOIN public.contract_obligation_definitions d
      ON d.id = i.definition_id AND d.organization_id = i.organization_id
   WHERE i.organization_id = m.organization_id
     AND i.contract_id = m.contract_id
     AND d.blocks_billing
     AND i.state IN ('OPEN','EXCEPTION');

  d_execution := CASE WHEN evidence_count > 0 THEN 'READY' ELSE 'INCOMPLETE' END;
  IF d_execution = 'INCOMPLETE' THEN reasons := reasons || 'EXECUTION_NOT_OBSERVED'::text; END IF;

  d_evidence := public.project_measurement_dimension_state(m.id, ARRAY['EVIDENCE']);
  IF d_evidence = 'INCOMPLETE' THEN reasons := reasons || 'MISSING_REQUIRED_EVIDENCE'::text; END IF;

  d_report := public.project_measurement_dimension_state(m.id,
                ARRAY['TECHNICAL_REPORT','SERVICE_REPORT']);
  IF d_report = 'INCOMPLETE' THEN reasons := reasons || 'MISSING_REQUIRED_REPORT'::text; END IF;

  d_docs := public.project_measurement_dimension_state(m.id,
              ARRAY['DOCUMENT','TESTS_INSPECTION','PHOTOS']);
  IF d_docs = 'INCOMPLETE' THEN
    IF missing_req IS NOT NULL AND 'PHOTOS' = ANY(missing_req) THEN reasons := reasons || 'MISSING_PHOTOS'::text; END IF;
    IF missing_req IS NOT NULL AND ('DOCUMENT' = ANY(missing_req) OR 'TESTS_INSPECTION' = ANY(missing_req))
      THEN reasons := reasons || 'MISSING_REQUIRED_DOCUMENT'::text; END IF;
  END IF;

  d_complete := CASE
    WHEN m.measurement_basis = 'UNKNOWN' OR m.accumulation_mode = 'UNKNOWN' THEN 'UNKNOWN'
    WHEN m.measurement_basis = 'MILESTONE_FIXED' THEN 'READY'
    WHEN m.measurement_basis = 'MONETARY' AND m.measured_value IS NOT NULL AND m.currency IS NOT NULL THEN 'READY'
    WHEN m.measurement_basis IN ('QUANTITY','PERCENTAGE') AND m.quantity IS NOT NULL THEN 'READY'
    ELSE 'INCOMPLETE' END;
  IF d_complete = 'UNKNOWN' THEN reasons := reasons || 'MEASUREMENT_SEMANTICS_UNKNOWN'::text; END IF;
  IF d_complete = 'INCOMPLETE' THEN reasons := reasons || 'MEASUREMENT_VALUE_MISSING'::text; END IF;

  IF NOT rule_ok OR m.occurrence_state = 'unresolved' OR NOT has_mapping THEN
    d_submission := 'UNKNOWN';
  ELSIF m.status IN ('SUBMITTED','UNDER_REVIEW','APPROVED_FOR_CUSTOMER',
                     'AWAITING_CUSTOMER_ACCEPTANCE','ACCEPTED','REJECTED') THEN
    d_submission := 'READY';
  ELSIF m.status IN ('CANCELLED','SUPERSEDED') THEN
    d_submission := 'NOT_APPLICABLE';
  ELSE
    states := ARRAY[d_execution, d_evidence, d_report, d_docs, d_complete];
    d_submission := 'READY';
    FOREACH s IN ARRAY states LOOP
      IF s = 'UNKNOWN' THEN d_submission := 'UNKNOWN';
      ELSIF s = 'INCOMPLETE' AND d_submission <> 'UNKNOWN' THEN d_submission := 'INCOMPLETE';
      END IF;
    END LOOP;
  END IF;

  /*
    ACEITE. Aprovar para envio NÃO acende este farol, e o caso mais perigoso é
    `APPROVED_FOR_CUSTOMER`: é o estado que MAIS se parece com aprovação e o
    que menos tem a ver com o cliente.
  */
  d_acceptance := CASE m.status
    WHEN 'ACCEPTED'  THEN 'READY'
    WHEN 'REJECTED'  THEN 'BLOCKED'
    WHEN 'CANCELLED' THEN 'NOT_APPLICABLE'
    WHEN 'SUPERSEDED' THEN 'NOT_APPLICABLE'
    ELSE 'INCOMPLETE' END;
  IF m.status IN ('SUBMITTED','UNDER_REVIEW') THEN reasons := reasons || 'AWAITING_CONTRACT_REVIEW'::text; END IF;
  IF m.status = 'APPROVED_FOR_CUSTOMER' THEN reasons := reasons || 'APPROVED_PENDING_DISPATCH'::text; END IF;
  IF m.status = 'AWAITING_CUSTOMER_ACCEPTANCE' THEN reasons := reasons || 'WAITING_CUSTOMER_ACCEPTANCE'::text; END IF;
  IF m.status = 'CUSTOMER_CORRECTION_REQUESTED' THEN reasons := reasons || 'CUSTOMER_CORRECTION_REQUESTED'::text; END IF;
  IF m.status = 'RETURNED_FOR_CORRECTION' THEN reasons := reasons || 'RETURNED_FOR_CORRECTION'::text; END IF;
  IF m.status = 'REJECTED' THEN reasons := reasons || 'MEASUREMENT_REJECTED'::text; END IF;
  IF open_corrections > 0 THEN reasons := reasons || 'OPEN_CORRECTION_ITEMS'::text; END IF;

  IF blocking_obl > 0 THEN
    d_billing := 'BLOCKED';
    reasons := reasons || 'OBLIGATION_BLOCKING'::text;
  ELSIF m.status = 'ACCEPTED' THEN
    d_billing := 'READY';
  ELSIF m.status IN ('CANCELLED','SUPERSEDED','REJECTED') THEN
    d_billing := 'NOT_APPLICABLE';
  ELSE
    d_billing := 'INCOMPLETE';
  END IF;

  IF unknown_req IS NOT NULL THEN reasons := reasons || 'REQUIREMENT_CERTAINTY_UNKNOWN'::text; END IF;

  dims := jsonb_build_object(
    'execution',               d_execution,
    'required_evidence',       d_evidence,
    'technical_report',        d_report,
    'contractual_documents',   d_docs,
    'measurement_completeness',d_complete,
    'submission',              d_submission,
    'acceptance',              d_acceptance,
    'billing_prerequisite',    d_billing);

  SELECT CASE
           WHEN bool_or(v = 'BLOCKED')    THEN 'BLOCKED'
           WHEN bool_or(v = 'UNKNOWN')    THEN 'UNKNOWN'
           WHEN bool_or(v = 'INCOMPLETE') THEN 'INCOMPLETE'
           WHEN bool_or(v = 'READY')      THEN 'READY'
           ELSE 'NOT_APPLICABLE' END
    INTO overall
    FROM jsonb_each_text(dims) AS t(k, v);

  RETURN jsonb_build_object(
    'measurement_id', m.id,
    'organization_id', m.organization_id,
    'status', m.status,
    'as_of', as_of,
    'overall', overall,
    'dimensions', dims,
    'reasons', to_jsonb(reasons),
    'missing_requirements', to_jsonb(COALESCE(missing_req, ARRAY[]::text[])),
    'unknown_requirements', to_jsonb(COALESCE(unknown_req, ARRAY[]::text[])),
    'open_correction_items', open_corrections,
    'evidence_count', evidence_count,
    'validated_evidence_count', validated_count,
    'blocking_obligations', blocking_obl,
    'rule_resolved', rule_ok,
    'timeline_mapped', has_mapping,
    'occurrence_state', m.occurrence_state);
END $$;

REVOKE ALL ON FUNCTION public.project_measurement_readiness(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_measurement_readiness(uuid, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7) As transições novas do domínio
-- ---------------------------------------------------------------------------

/*
  ENVIAR PARA ANÁLISE CONTRATUAL.

  É o `submit` de sempre — e é por isso que NÃO existe função nova para ele.
  O que existe é o reenvio, que antes não tinha porta.
*/

/* ── ANÁLISE INICIADA ──────────────────────────────────────────────────── */
CREATE OR REPLACE FUNCTION public.project_measurement_start_review(
  p_measurement_id uuid,
  p_note           text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN public.project_measurement_transition(
    p_measurement_id, 'UNDER_REVIEW', 'projects.measurement.review_started',
    p_note, 'human', NULL, '{}'::jsonb, '{}'::jsonb,
    'contracts.measurements.review', 'review_started_at');
END $$;

/* ── CORREÇÃO SOLICITADA (pela Gestão de Contratos) ────────────────────── */
/*
  Motivo E itens. A §6 pede os dois, e a função recusa os dois vazios — pedir
  correção sem dizer o quê devolve trabalho ao projeto sem devolver informação.
*/
CREATE OR REPLACE FUNCTION public.project_measurement_request_correction(
  p_measurement_id uuid,
  p_reason         text,
  p_items          jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m public.project_measurements%ROWTYPE;
  nxt integer;
  it jsonb;
  n integer := 0;
BEGIN
  IF NULLIF(btrim(COALESCE(p_reason,'')), '') IS NULL THEN
    RAISE EXCEPTION 'REASON_REQUIRED: pedir correção exige motivo.' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_typeof(COALESCE(p_items,'[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(p_items,'[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'CORRECTION_ITEMS_REQUIRED: informe os itens a corrigir (§6).'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO m FROM public.project_measurements WHERE id = p_measurement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEASUREMENT_NOT_FOUND: medição inexistente.' USING ERRCODE = 'no_data_found';
  END IF;
  IF m.status NOT IN ('SUBMITTED','UNDER_REVIEW','APPROVED_FOR_CUSTOMER') THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: só medição em análise recebe pedido de correção (estado atual: %).', m.status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(max(round), 0) + 1 INTO nxt
    FROM public.project_measurement_correction_items WHERE measurement_id = m.id;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.project_measurement_correction_items
      (organization_id, measurement_id, round, requested_by_side, requested_by_user_id,
       item, requirement_kind, category)
    VALUES (m.organization_id, m.id, nxt, 'contract_management', auth.uid(),
            btrim(COALESCE(it->>'item','')),
            NULLIF(it->>'requirement_kind',''),
            COALESCE(NULLIF(it->>'category',''), 'documental'));
    n := n + 1;
  END LOOP;

  UPDATE public.project_measurements SET return_reason = p_reason WHERE id = m.id;

  RETURN public.project_measurement_transition(
    p_measurement_id, 'RETURNED_FOR_CORRECTION', 'projects.measurement.returned_for_correction',
    p_reason, 'human', NULL,
    jsonb_build_object('correction_round', nxt, 'item_count', n),
    jsonb_build_object('reason', p_reason, 'correction_round', nxt, 'item_count', n),
    'contracts.measurements.review', 'returned_at');
END $$;

/* ── REENVIAR PARA ANÁLISE — o MESMO item, nunca um novo ───────────────── */
CREATE OR REPLACE FUNCTION public.project_measurement_resubmit(
  p_measurement_id uuid,
  p_note           text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m public.project_measurements%ROWTYPE;
  res jsonb;
  closed integer;
BEGIN
  SELECT * INTO m FROM public.project_measurements WHERE id = p_measurement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEASUREMENT_NOT_FOUND: medição inexistente.' USING ERRCODE = 'no_data_found';
  END IF;
  IF m.status NOT IN ('RETURNED_FOR_CORRECTION','CUSTOMER_CORRECTION_REQUESTED') THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: só medição devolvida é reenviada (estado atual: %).', m.status
      USING ERRCODE = 'check_violation';
  END IF;

  /*
    A prontidão é recalculada AQUI, e não lida do cache. Reenviar o mesmo
    pacote sem ter corrigido nada é o defeito clássico do ciclo de correção —
    e o que ele produz é uma segunda rodada idêntica à primeira.
  */
  res := public.project_measurement_recompute_readiness(p_measurement_id);
  IF res->'dimensions'->>'submission' NOT IN ('READY') THEN
    RAISE EXCEPTION 'NOT_READY: prontidão de submissão é % (%).',
      res->'dimensions'->>'submission', res->>'reasons' USING ERRCODE = 'check_violation';
  END IF;

  /*
    Os itens da rodada aberta fecham NO REENVIO, e com autor. Fechá-los no
    upload faria o anexo se declarar correção; fechá-los nunca faria a lista
    crescer para sempre.
  */
  UPDATE public.project_measurement_correction_items
     SET resolved_at = now(), resolved_by = auth.uid(),
         resolution_note = COALESCE(p_note, 'Fechado pelo reenvio para análise.')
   WHERE measurement_id = m.id AND resolved_at IS NULL;
  GET DIAGNOSTICS closed = ROW_COUNT;

  RETURN public.project_measurement_transition(
    p_measurement_id, 'SUBMITTED', 'projects.measurement.resubmitted',
    p_note, 'human', NULL,
    jsonb_build_object('readiness', res->'dimensions', 'corrections_closed', closed),
    jsonb_build_object('corrections_closed', closed),
    'projects.measurements.submit', 'submitted_at');
END $$;

/* ── APROVAR PARA ENVIO AO CLIENTE — e só isso ─────────────────────────── */
CREATE OR REPLACE FUNCTION public.project_measurement_approve_for_customer(
  p_measurement_id uuid,
  p_note           text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  open_items integer;
BEGIN
  SELECT count(*)::int INTO open_items
    FROM public.project_measurement_correction_items
   WHERE measurement_id = p_measurement_id AND resolved_at IS NULL;
  IF open_items > 0 THEN
    RAISE EXCEPTION 'OPEN_CORRECTIONS: há % item(ns) de correção em aberto.', open_items
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN public.project_measurement_transition(
    p_measurement_id, 'APPROVED_FOR_CUSTOMER', 'projects.measurement.approved_for_customer',
    p_note, 'human', NULL,
    jsonb_build_object('meaning', 'pacote interno pronto para envio; NÃO é aceite'),
    '{}'::jsonb, 'contracts.measurements.review', 'approved_for_customer_at');
END $$;

/* ── ENVIAR PARA ACEITE DA CONTRATANTE ─────────────────────────────────── */
CREATE OR REPLACE FUNCTION public.project_measurement_send_to_customer(
  p_measurement_id    uuid,
  p_channel           text    DEFAULT 'email',
  p_customer_party_id uuid    DEFAULT NULL,
  p_customer_contact  text    DEFAULT NULL,
  p_external_reference text   DEFAULT NULL,
  p_due_at            date    DEFAULT NULL,
  p_document_ids      uuid[]  DEFAULT NULL,
  p_note              text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m public.project_measurements%ROWTYPE;
  nxt integer;
  docs uuid[] := COALESCE(p_document_ids, ARRAY[]::uuid[]);
  bad integer;
BEGIN
  SELECT * INTO m FROM public.project_measurements WHERE id = p_measurement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEASUREMENT_NOT_FOUND: medição inexistente.' USING ERRCODE = 'no_data_found';
  END IF;
  IF m.status <> 'APPROVED_FOR_CUSTOMER' THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: só pacote aprovado para envio vai ao cliente (estado atual: %).', m.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_customer_party_id IS NULL
     AND NULLIF(btrim(COALESCE(p_customer_contact,'')), '') IS NULL
     AND NULLIF(btrim(COALESCE(p_external_reference,'')), '') IS NULL THEN
    RAISE EXCEPTION 'DISPATCH_ADDRESSEE_REQUIRED: informe parte, contato ou referência da comunicação (§7).'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Documento enviado é documento CANÔNICO deste projeto. Um id de outro
  -- inquilino na lista faria a remessa citar arquivo que ninguém pode abrir.
  SELECT count(*)::int INTO bad
    FROM unnest(docs) d
   WHERE NOT EXISTS (SELECT 1 FROM public.project_files f
                      WHERE f.id = d AND f.organization_id = m.organization_id
                        AND f.project_id = m.project_id);
  IF bad > 0 THEN
    RAISE EXCEPTION 'DOCUMENT_NOT_FOUND: % documento(s) não pertencem a este projeto.', bad
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT COALESCE(max(attempt), 0) + 1 INTO nxt
    FROM public.project_measurement_customer_dispatches WHERE measurement_id = m.id;

  INSERT INTO public.project_measurement_customer_dispatches
    (organization_id, measurement_id, attempt, sent_by_user_id, customer_party_id,
     customer_contact, channel, external_reference, due_at, note, document_ids)
  VALUES (m.organization_id, m.id, nxt, auth.uid(), p_customer_party_id,
          NULLIF(btrim(COALESCE(p_customer_contact,'')), ''),
          COALESCE(NULLIF(p_channel,''), 'email'),
          NULLIF(btrim(COALESCE(p_external_reference,'')), ''),
          p_due_at, p_note, docs);

  UPDATE public.project_measurements SET customer_due_at = p_due_at WHERE id = m.id;

  RETURN public.project_measurement_transition(
    p_measurement_id, 'AWAITING_CUSTOMER_ACCEPTANCE', 'projects.measurement.sent_to_customer',
    p_note, 'human', p_external_reference,
    jsonb_build_object('dispatch_attempt', nxt, 'channel', p_channel,
                       'party_id', p_customer_party_id, 'due_at', p_due_at),
    jsonb_build_object('dispatch_attempt', nxt, 'document_count', array_length(docs, 1)),
    'contracts.measurements.review', 'sent_to_customer_at');
END $$;

/* ── CORREÇÃO SOLICITADA PELA CONTRATANTE ──────────────────────────────── */
/*
  A Contratante não escreve no Apex. Quem registra é uma pessoa interna, e a
  linha diz exatamente isso: `requested_by_side = 'customer'`, mas
  `requested_by_user_id` é quem transcreveu. A mesma gramática do aceite.
*/
CREATE OR REPLACE FUNCTION public.project_measurement_customer_correction(
  p_measurement_id uuid,
  p_reason         text,
  p_items          jsonb DEFAULT '[]'::jsonb,
  p_external_reference text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m public.project_measurements%ROWTYPE;
  nxt integer;
  it jsonb;
  n integer := 0;
BEGIN
  IF NULLIF(btrim(COALESCE(p_reason,'')), '') IS NULL THEN
    RAISE EXCEPTION 'REASON_REQUIRED: registre o que a Contratante pediu.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO m FROM public.project_measurements WHERE id = p_measurement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEASUREMENT_NOT_FOUND: medição inexistente.' USING ERRCODE = 'no_data_found';
  END IF;
  IF m.status <> 'AWAITING_CUSTOMER_ACCEPTANCE' THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: só pacote enviado recebe resposta da Contratante (estado atual: %).', m.status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(max(round), 0) + 1 INTO nxt
    FROM public.project_measurement_correction_items WHERE measurement_id = m.id;

  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(p_items,'[]'::jsonb)) LOOP
    INSERT INTO public.project_measurement_correction_items
      (organization_id, measurement_id, round, requested_by_side, requested_by_user_id,
       item, requirement_kind, category)
    VALUES (m.organization_id, m.id, nxt, 'customer', auth.uid(),
            btrim(COALESCE(it->>'item','')),
            NULLIF(it->>'requirement_kind',''),
            COALESCE(NULLIF(it->>'category',''), 'documental'));
    n := n + 1;
  END LOOP;

  UPDATE public.project_measurements
     SET customer_correction_reason = p_reason
   WHERE id = m.id;

  RETURN public.project_measurement_transition(
    p_measurement_id, 'CUSTOMER_CORRECTION_REQUESTED',
    'projects.measurement.customer_correction_requested',
    p_reason, 'human', p_external_reference,
    jsonb_build_object('correction_round', nxt, 'item_count', n,
                       'external_reference', p_external_reference),
    jsonb_build_object('correction_round', nxt, 'item_count', n),
    'contracts.measurements.review', 'customer_correction_at');
END $$;

-- ---------------------------------------------------------------------------
-- 8) ACEITE — a mesma porta, agora alcançável pelo estado certo
-- ---------------------------------------------------------------------------
/*
  UMA linha muda: a lista de estados de partida passa a incluir
  `AWAITING_CUSTOMER_ACCEPTANCE`, que é o estado em que o aceite realmente
  acontece a partir desta migration. `SUBMITTED` e `UNDER_REVIEW` continuam
  aceitos para não invalidar medição que já estava em voo.

  Tudo o mais é idêntico, incluindo as duas recusas que importam: sistema
  aceitando sozinho, e navegador dizendo quem aceitou.
*/
CREATE OR REPLACE FUNCTION public.project_measurement_accept(
  p_measurement_id       uuid,
  p_acceptance_source    text,
  p_accepted_quantity    numeric DEFAULT NULL,
  p_accepted_value       numeric DEFAULT NULL,
  p_accepted_currency    text    DEFAULT NULL,
  p_accepted_by_party_id uuid    DEFAULT NULL,
  p_external_reference   text    DEFAULT NULL,
  p_acceptance_document_id uuid  DEFAULT NULL,
  p_note                 text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m public.project_measurements%ROWTYPE;
  actor uuid := auth.uid();
  is_external boolean;
BEGIN
  SELECT * INTO m FROM public.project_measurements WHERE id = p_measurement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEASUREMENT_NOT_FOUND: medição inexistente.' USING ERRCODE = 'no_data_found';
  END IF;

  IF m.status = 'ACCEPTED' THEN
    RETURN jsonb_build_object('measurement_id', m.id, 'status', m.status,
                              'idempotent', true, 'revision', m.revision);
  END IF;

  IF p_acceptance_source IS NULL THEN
    RAISE EXCEPTION 'ACCEPTANCE_SOURCE_REQUIRED: aceite sem fonte autoritativa não é aceite (§11).'
      USING ERRCODE = 'check_violation';
  END IF;

  is_external := p_acceptance_source IN ('customer_portal','signed_bulletin','external_document','integration');

  IF actor IS NULL AND NOT is_external THEN
    RAISE EXCEPTION 'ACCEPTANCE_NEVER_AUTOMATED: aceite interno exige pessoa autenticada. '
      'Sistema, rotina e IA não aceitem medição (§11).' USING ERRCODE = '42501';
  END IF;

  IF is_external
     AND p_accepted_by_party_id IS NULL
     AND p_acceptance_document_id IS NULL
     AND NULLIF(btrim(COALESCE(p_external_reference,'')), '') IS NULL THEN
    RAISE EXCEPTION 'ACCEPTANCE_PROVENANCE_REQUIRED: aceite externo exige parte, documento ou referência (§34,§35).'
      USING ERRCODE = 'check_violation';
  END IF;

  IF actor IS NOT NULL
     AND NOT (public.current_user_has_permission('projects.measurements.accept') OR public.current_user_is_admin()) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: falta a permissão projects.measurements.accept.' USING ERRCODE = '42501';
  END IF;

  IF actor IS NOT NULL
     AND m.organization_id IS DISTINCT FROM public.current_user_organization_id() THEN
    RAISE EXCEPTION 'MEASUREMENT_NOT_FOUND: medição inexistente.' USING ERRCODE = 'no_data_found';
  END IF;

  IF m.status NOT IN ('SUBMITTED','UNDER_REVIEW','AWAITING_CUSTOMER_ACCEPTANCE') THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: só medição submetida, em análise ou enviada ao cliente é aceita (estado atual: %).', m.status
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.project_measurements
     SET status = 'ACCEPTED',
         accepted_at = now(),
         acceptance_source = p_acceptance_source,
         accepted_by_user_id = CASE WHEN is_external THEN NULL ELSE actor END,
         accepted_by_party_id = p_accepted_by_party_id,
         accepted_external_ref = NULLIF(btrim(COALESCE(p_external_reference,'')), ''),
         acceptance_document_id = p_acceptance_document_id,
         acceptance_note = p_note,
         accepted_quantity = COALESCE(p_accepted_quantity, quantity),
         accepted_value = COALESCE(p_accepted_value, measured_value),
         accepted_currency = COALESCE(p_accepted_currency, currency)
   WHERE id = m.id;

  SELECT * INTO m FROM public.project_measurements WHERE id = m.id;

  INSERT INTO public.project_measurement_history
    (organization_id, measurement_id, from_state, to_state, transition, reason,
     actor_user_id, actor_source, actor_reference, provenance, correlation_id)
  VALUES (m.organization_id, m.id, 'ACCEPTED', 'ACCEPTED', 'acceptance_provenance', p_note,
          CASE WHEN is_external THEN NULL ELSE actor END,
          CASE WHEN is_external THEN 'external' ELSE 'human' END,
          COALESCE(p_external_reference, p_acceptance_document_id::text),
          jsonb_build_object('acceptance_source', p_acceptance_source,
                             'party_id', p_accepted_by_party_id,
                             'document_id', p_acceptance_document_id,
                             'recorded_by', actor),
          m.correlation_id);

  PERFORM public.project_measurement_emit(m, 'projects.measurement.accepted',
    jsonb_build_object(
      'accepted_at', m.accepted_at,
      'acceptance_source', m.acceptance_source,
      'accepted_quantity', m.accepted_quantity,
      'accepted_value', m.accepted_value,
      'accepted_currency', m.accepted_currency,
      'measurement_basis', m.measurement_basis,
      'accumulation_mode', m.accumulation_mode,
      'milestone_id', m.milestone_id,
      'period_start', m.measurement_period_start,
      'period_end', m.measurement_period_end),
    actor, CASE WHEN is_external THEN 'provider' ELSE 'human' END);

  PERFORM public.project_measurement_recompute_readiness(m.id);

  RETURN jsonb_build_object('measurement_id', m.id, 'status', m.status,
                            'idempotent', false, 'revision', m.revision);
END $$;

-- ---------------------------------------------------------------------------
-- 9) Concessões — navegador autenticado, portão por dentro
-- ---------------------------------------------------------------------------
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'project_measurement_start_review(uuid, text)',
    'project_measurement_request_correction(uuid, text, jsonb)',
    'project_measurement_resubmit(uuid, text)',
    'project_measurement_approve_for_customer(uuid, text)',
    'project_measurement_send_to_customer(uuid, text, uuid, text, text, date, uuid[], text)',
    'project_measurement_customer_correction(uuid, text, jsonb, text)',
    'project_measurement_accept(uuid, text, numeric, numeric, text, uuid, text, uuid, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 10) O modelo de leitura expõe o que a fila precisa
-- ---------------------------------------------------------------------------
/*
  `CREATE OR REPLACE VIEW`, e as colunas novas entram no FIM.

  Não é estilo: `contract_milestone_workbench` (171) depende desta visão, e um
  DROP arrastaria a bancada de Contratos junto. Substituir no lugar exige que a
  lista existente permaneça na mesma ordem e com os mesmos nomes — então o que
  esta migration acrescenta vem depois de tudo, exatamente como acrescentar
  coluna a uma tabela.
*/
CREATE OR REPLACE VIEW public.project_measurement_read_model
WITH (security_invoker = true) AS
  SELECT
    m.id, m.organization_id, m.project_id, m.contract_id,
    m.contract_measurement_rule_id, m.timeline_item_id, m.milestone_id,
    m.occurrence_key, m.occurrence_state,
    m.measurement_period_start, m.measurement_period_end, m.expected_at,
    m.status, m.revision, m.supersedes_id, m.superseded_by_id,
    m.measurement_basis, m.accumulation_mode,
    m.quantity, m.unit, m.measured_value, m.currency,
    m.accepted_quantity, m.accepted_value, m.accepted_currency,
    m.acceptance_source, m.accepted_at, m.submitted_at, m.rejected_at, m.returned_at,
    m.origin, m.created_at, m.updated_at,

    r.title            AS rule_title,
    r.effective_from   AS rule_effective_from,
    r.effective_until  AS rule_effective_until,
    r.cadence          AS rule_cadence,
    r.aggregation_mode AS rule_aggregation_mode,
    r.source_clause_id, r.source_document_id, r.source_reference, r.source_page,

    i.title            AS timeline_title,
    i.planned_start    AS timeline_planned_start,
    i.planned_finish   AS timeline_planned_finish,
    i.percent_complete AS timeline_percent_complete,

    c.overall          AS readiness_overall,
    c.dimensions       AS readiness_dimensions,
    c.reasons          AS readiness_reasons,
    c.computed_at      AS readiness_computed_at,

    (SELECT count(*)::int FROM public.project_measurement_evidence e
      WHERE e.measurement_id = m.id AND e.revoked_at IS NULL) AS evidence_count,
    (SELECT count(*)::int FROM public.project_measurement_requirements q
      WHERE q.measurement_id = m.id AND q.required AND q.satisfaction_state = 'MISSING') AS missing_requirement_count,

    -- ---- acréscimos desta migration, no fim por obrigação estrutural ----
    m.review_started_at,
    m.approved_for_customer_at,
    m.sent_to_customer_at,
    m.customer_correction_at,
    m.customer_correction_reason,
    m.customer_due_at,
    m.return_reason,
    m.rejection_reason,
    (SELECT count(*)::int FROM public.project_measurement_correction_items ci
      WHERE ci.measurement_id = m.id AND ci.resolved_at IS NULL) AS open_correction_count,
    (SELECT count(*)::int FROM public.project_measurement_customer_dispatches d
      WHERE d.measurement_id = m.id) AS dispatch_count,
    (SELECT max(d.sent_at) FROM public.project_measurement_customer_dispatches d
      WHERE d.measurement_id = m.id) AS last_dispatch_at
  FROM public.project_measurements m
  LEFT JOIN public.contract_measurement_requirements r
    ON r.id = m.contract_measurement_rule_id AND r.organization_id = m.organization_id
  LEFT JOIN public.project_timeline_items i
    ON i.id = m.timeline_item_id AND i.organization_id = m.organization_id
  LEFT JOIN public.project_measurement_readiness_cache c
    ON c.measurement_id = m.id;

GRANT SELECT ON public.project_measurement_read_model TO authenticated;
REVOKE ALL ON public.project_measurement_read_model FROM anon;

COMMENT ON VIEW public.project_measurement_read_model IS
  'Modelo de leitura CANÔNICO (§84), agora com os carimbos da análise '
  'contratual e do envio à Contratante. `readiness_*` continua vindo do CACHE.';

-- ---------------------------------------------------------------------------
-- 11) A permissão nova
-- ---------------------------------------------------------------------------
/*
  `contracts.measurements.review` é a chave da Gestão de Contratos sobre a
  medição: analisar, pedir correção, aprovar para envio, enviar ao cliente e
  registrar a resposta dele. NÃO é aceite — aceitar continua exigindo
  `projects.measurements.accept`, e são duas chaves porque são dois poderes.

  Nenhum papel a recebe aqui. Conceder permissão a papel é ato de quem
  administra o inquilino, e semear isso seria decidir alçada por fora de quem
  responde por ela.
*/
INSERT INTO public.permissions (key, module, action, description) VALUES
  ('contracts.measurements.review', 'contracts', 'measurements.review',
   'Analisar medição, solicitar correção, aprovar para envio e registrar a resposta da Contratante')
ON CONFLICT (key) DO NOTHING;

COMMIT;
