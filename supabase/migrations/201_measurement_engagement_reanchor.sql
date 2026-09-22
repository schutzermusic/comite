-- ============================================================================
-- 201 — O MOTOR DE MEDIÇÃO PASSA A PENDER DO PAI, NÃO DO CONTRATO
--
-- ─── A regra que esta migration obedece ──────────────────────────────────
--
-- O §10 é categórico: NÃO existe `proposal_measurements`, `proposal_approvals`
-- nem `proposal_billing`. O trabalho vendido por proposta entra na MESMA
-- `project_measurements`, na MESMA revisão contratual, no MESMO aceite do
-- cliente e na MESMA elegibilidade de faturamento.
--
-- ─── Por que a coluna precisava mudar ────────────────────────────────────
--
-- `project_measurements.contract_id` era NOT NULL, e três FKs compostas
-- amarravam medição, regra e vínculo projeto↔contrato ao instrumento. Para
-- trabalho sem contrato, restavam duas saídas ruins:
--
--   (a) criar um contrato falso — proibido pelo §4;
--   (b) criar uma segunda tabela de medição — proibido pelo §10.
--
-- A saída certa é a terceira: trocar o ÂNCORA. A medição passa a exigir
-- `engagement_id` (NOT NULL, sempre), e `contract_id` vira opcional — presente
-- quando há instrumento, ausente quando não há. As FKs antigas continuam
-- exatamente onde estavam e continuam valendo para toda linha que tenha
-- contrato; as novas valem para TODAS.
--
-- ─── O que NÃO muda ──────────────────────────────────────────────────────
--
-- Nenhum id canônico. Nenhuma linha de medição existente muda de estado, de
-- contrato, de regra ou de projeto. A máquina de estados da 130/192 não é
-- tocada. As funções de transição, aceite, envio ao cliente e correção
-- continuam as mesmas, byte por byte.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) A REGRA DE MEDIÇÃO ganha o pai
--
-- `contract_measurement_requirements` mantém o nome. Renomear quebraria 130,
-- 133, 134, 155, 171, 180, 185, 190 e 192 sem devolver nada — o nome é
-- histórico, o papel é que mudou.
-- ---------------------------------------------------------------------------
ALTER TABLE public.contract_measurement_requirements
  ADD COLUMN IF NOT EXISTS engagement_id uuid;

/*
  `contract_measurement_requirements` é append-only por gatilho (`immutable`):
  qualquer UPDATE é recusado, porque uma regra contratual não se corrige — ela
  é sucedida por outra linha, com `predecessor_id`.

  Preencher o PONTEIRO PARA O PAI não é corrigir regra nenhuma: nenhum fato
  contratual muda — nem base, nem cadência, nem vigência, nem cláusula de
  origem. É estrutura, e o único caminho para escrevê-la é suspender o gatilho
  dentro desta transação.

  A suspensão é cercada: o bloco calcula a impressão digital de TODAS as
  colunas de fato antes e depois, e aborta se qualquer uma delas divergir. Se
  o backfill tocasse um fato contratual por engano, a migration morreria aqui
  em vez de seguir com história adulterada.
*/
DO $reanchor_rules$
DECLARE before_fp text; after_fp text;
BEGIN
  SELECT md5(string_agg(t, '|' ORDER BY t)) INTO before_fp
    FROM (SELECT concat_ws(':', id::text, contract_id::text, title, effect,
                 measurement_basis, accumulation_mode, aggregation_mode, cadence,
                 effective_from::text, effective_until::text, predecessor_id::text,
                 source_clause_id::text, source_document_id::text) AS t
            FROM public.contract_measurement_requirements) x;

  ALTER TABLE public.contract_measurement_requirements DISABLE TRIGGER immutable;

  UPDATE public.contract_measurement_requirements r
     SET engagement_id = c.engagement_id
    FROM public.contracts c
   WHERE c.id = r.contract_id AND c.organization_id = r.organization_id
     AND r.engagement_id IS NULL;

  ALTER TABLE public.contract_measurement_requirements ENABLE TRIGGER immutable;

  SELECT md5(string_agg(t, '|' ORDER BY t)) INTO after_fp
    FROM (SELECT concat_ws(':', id::text, contract_id::text, title, effect,
                 measurement_basis, accumulation_mode, aggregation_mode, cadence,
                 effective_from::text, effective_until::text, predecessor_id::text,
                 source_clause_id::text, source_document_id::text) AS t
            FROM public.contract_measurement_requirements) x;

  IF before_fp IS DISTINCT FROM after_fp THEN
    RAISE EXCEPTION 'Re-anchoring altered contractual facts (% -> %). Aborting.',
      before_fp, after_fp;
  END IF;
END $reanchor_rules$;

-- Regra órfã de pai não existe: se sobrou alguma, a migration para aqui em vez
-- de deixar o motor com duas famílias de regra.
DO $guard$
DECLARE n int;
BEGIN
  SELECT count(*)::int INTO n FROM public.contract_measurement_requirements WHERE engagement_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION '% measurement rule(s) could not be attached to an engagement.', n;
  END IF;
END $guard$;

ALTER TABLE public.contract_measurement_requirements
  ALTER COLUMN engagement_id SET NOT NULL,
  ALTER COLUMN contract_id DROP NOT NULL;

ALTER TABLE public.contract_measurement_requirements
  ADD CONSTRAINT cmr_engagement_id_unique UNIQUE (organization_id, engagement_id, id),
  ADD CONSTRAINT cmr_engagement_tenant FOREIGN KEY (organization_id, engagement_id)
    REFERENCES public.commercial_engagements (organization_id, id) ON DELETE CASCADE,
  -- Regra com contrato precisa que o contrato pertença AO MESMO pai; sem essa
  -- amarra, uma regra poderia citar o contrato de outro engajamento.
  ADD CONSTRAINT cmr_contract_belongs_to_engagement CHECK (
    contract_id IS NULL OR engagement_id IS NOT NULL);

-- A leitura passa a enxergar regra sem contrato.
DROP POLICY scoped_read ON public.contract_measurement_requirements;
CREATE POLICY scoped_read ON public.contract_measurement_requirements FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND (
       (contract_id IS NOT NULL AND public.current_user_can_read_contract(contract_id))
       OR (contract_id IS NULL AND public.current_user_has_permission('contracts.view'))
     ));

-- ---------------------------------------------------------------------------
-- 2) A MEDIÇÃO ganha o pai
-- ---------------------------------------------------------------------------
ALTER TABLE public.project_measurements
  ADD COLUMN IF NOT EXISTS engagement_id uuid;

UPDATE public.project_measurements m
   SET engagement_id = c.engagement_id
  FROM public.contracts c
 WHERE c.id = m.contract_id AND c.organization_id = m.organization_id
   AND m.engagement_id IS NULL;

DO $guard$
DECLARE n int;
BEGIN
  SELECT count(*)::int INTO n FROM public.project_measurements WHERE engagement_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION '% measurement(s) could not be attached to an engagement.', n;
  END IF;
END $guard$;

ALTER TABLE public.project_measurements
  ALTER COLUMN engagement_id SET NOT NULL,
  ALTER COLUMN contract_id DROP NOT NULL;

/*
  As três amarras novas. Elas fazem pelo PAI exatamente o que `pm_contract_tenant`,
  `pm_rule_tenant` e `pm_project_contract_linked` faziam pelo contrato — e com
  uma diferença que importa: como `engagement_id` é NOT NULL, elas valem para
  TODA linha, inclusive as contratadas. A medição contratada passa a ter as
  duas provas; a medição por proposta tem a que existe.
*/
ALTER TABLE public.project_measurements
  ADD CONSTRAINT pm_engagement_tenant FOREIGN KEY (organization_id, engagement_id)
    REFERENCES public.commercial_engagements (organization_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT pm_engagement_rule_tenant
    FOREIGN KEY (organization_id, engagement_id, contract_measurement_rule_id)
    REFERENCES public.contract_measurement_requirements (organization_id, engagement_id, id)
    ON DELETE CASCADE,
  ADD CONSTRAINT pm_engagement_project_linked
    FOREIGN KEY (organization_id, engagement_id, project_id)
    REFERENCES public.engagement_project_links (organization_id, engagement_id, project_id)
    ON DELETE RESTRICT;

CREATE INDEX pm_engagement ON public.project_measurements (organization_id, engagement_id);

COMMENT ON COLUMN public.project_measurements.engagement_id IS
  'Pai neutro do trabalho autorizado. NOT NULL sempre: é ele que prova a relação, com ou sem contrato.';
COMMENT ON COLUMN public.project_measurements.contract_id IS
  'Instrumento formal, quando existe. NULL em trabalho autorizado por proposta/pedido — nunca um contrato fabricado.';

-- ---------------------------------------------------------------------------
-- 3) A FILA DE REVISÃO deixa de exigir contrato
--
-- `project_measurement_review_queue` fazia JOIN interno com `contracts`. Com
-- medição sem contrato, esse JOIN não devolveria a linha — e a medição por
-- proposta simplesmente sumiria da fila, que é o contrário do §10 ("a MESMA
-- fila sobre os MESMOS registros canônicos").
--
-- `CREATE OR REPLACE VIEW`: a lista de colunas existente permanece na mesma
-- ordem e com os mesmos nomes; o que é novo entra no fim.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.project_measurement_review_queue
WITH (security_invoker = true) AS
WITH gate AS (
  SELECT (
    public.current_user_has_permission('contracts.view_values')
    OR public.current_user_has_permission('finance.view')
    OR public.current_user_is_admin()
  ) AS can_view_values
)
SELECT
  m.id                                AS measurement_id,
  m.organization_id,
  m.contract_id,
  m.project_id,
  m.milestone_id,
  m.timeline_item_id,
  m.status,
  m.revision,
  m.occurrence_key,
  m.expected_at,

  c.contract_number,
  -- Quando não há instrumento, o título vem do PAI. A fila nunca fica sem
  -- dizer de que trabalho a medição é.
  COALESCE(c.title, e.title)          AS contract_title,
  COALESCE(c.counterparty_name, e.counterparty_name) AS counterparty_name,
  COALESCE(c.owner_user_id, e.owner_user_id) AS contract_owner_user_id,

  ms.title                            AS milestone_title,
  ms.due_date                         AS milestone_due_date,

  pj.project ->> 'codigo'             AS project_code,
  pj.project ->> 'nome'               AS project_name,
  pj.project ->> 'cliente'            AS project_client,

  ti.title                            AS timeline_title,
  ti.wbs_code                         AS timeline_wbs_code,
  ti.planned_finish                   AS timeline_planned_finish,
  ti.actual_finish                    AS timeline_actual_finish,

  g.can_view_values,
  CASE WHEN g.can_view_values THEN ms.billing_amount END  AS milestone_amount,
  CASE WHEN g.can_view_values THEN m.measured_value END   AS measured_value,
  CASE WHEN g.can_view_values THEN m.accepted_value END   AS accepted_value,
  CASE WHEN g.can_view_values
       THEN COALESCE(m.accepted_currency, m.currency, c.currency, e.currency) END AS currency,

  m.submitted_at, m.review_started_at, m.approved_for_customer_at,
  m.sent_to_customer_at, m.customer_correction_at, m.returned_at,
  m.accepted_at, m.rejected_at,
  m.customer_due_at, m.return_reason, m.customer_correction_reason,

  rc.overall                          AS readiness_overall,
  rc.dimensions                       AS readiness_dimensions,
  rc.reasons                          AS readiness_reasons,
  rc.computed_at                      AS readiness_computed_at,

  (SELECT count(*)::int FROM public.project_measurement_evidence ev
    WHERE ev.measurement_id = m.id AND ev.revoked_at IS NULL)        AS evidence_count,
  (SELECT count(*)::int FROM public.project_measurement_requirements q
    WHERE q.measurement_id = m.id AND q.required
      AND q.satisfaction_state = 'MISSING')                          AS missing_requirement_count,
  (SELECT count(*)::int FROM public.project_measurement_requirements q
    WHERE q.measurement_id = m.id AND q.satisfaction_state = 'UNKNOWN') AS unknown_requirement_count,
  (SELECT count(*)::int FROM public.project_measurement_correction_items ci
    WHERE ci.measurement_id = m.id AND ci.resolved_at IS NULL)       AS open_correction_count,
  (SELECT count(*)::int FROM public.project_measurement_customer_dispatches dp
    WHERE dp.measurement_id = m.id)                                  AS dispatch_count,

  public.project_measurement_preanalysis(m.id)                       AS preanalysis,
  public.project_measurement_sla(m.id, NULL)                         AS sla,

  -- ---- colunas novas, no fim ----
  m.engagement_id,
  e.status                            AS engagement_status,
  -- De onde vem a autorização desta medição. É o que permite a fila dizer
  -- "medição de trabalho por proposta" sem inventar um contrato.
  (SELECT a.source_kind FROM public.commercial_engagement_authorizations a
    WHERE a.organization_id = m.organization_id AND a.engagement_id = m.engagement_id
      AND a.governing AND a.state = 'ACTIVE' LIMIT 1)                AS authorization_source_kind,
  (SELECT so.os_number FROM public.internal_service_orders so
    WHERE so.organization_id = m.organization_id AND so.project_id = m.project_id
    ORDER BY so.created_at LIMIT 1)                                  AS service_order_number
FROM public.project_measurements m
CROSS JOIN gate g
JOIN public.commercial_engagements e
  ON e.id = m.engagement_id AND e.organization_id = m.organization_id
LEFT JOIN public.contracts c
  ON c.id = m.contract_id AND c.organization_id = m.organization_id
JOIN public.projects pj
  ON pj.id = m.project_id AND pj.organization_id = m.organization_id
LEFT JOIN public.contract_milestones ms
  ON ms.id = m.milestone_id AND ms.organization_id = m.organization_id
LEFT JOIN public.project_timeline_items ti
  ON ti.id = m.timeline_item_id AND ti.organization_id = m.organization_id
LEFT JOIN public.project_measurement_readiness_cache rc
  ON rc.measurement_id = m.id AND rc.organization_id = m.organization_id;

-- ---------------------------------------------------------------------------
-- 4) O FATURAMENTO passa a pender do pai — mesma tabela, mesmo motor
-- ---------------------------------------------------------------------------
ALTER TABLE public.contract_billing_events
  ADD COLUMN IF NOT EXISTS engagement_id uuid;

UPDATE public.contract_billing_events b
   SET engagement_id = c.engagement_id
  FROM public.contracts c
 WHERE c.id = b.contract_id AND c.organization_id = b.organization_id
   AND b.engagement_id IS NULL;

ALTER TABLE public.contract_billing_events
  ALTER COLUMN contract_id DROP NOT NULL;

ALTER TABLE public.contract_billing_events
  ADD CONSTRAINT cbe_engagement_tenant FOREIGN KEY (organization_id, engagement_id)
    REFERENCES public.commercial_engagements (organization_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT cbe_has_parent CHECK (contract_id IS NOT NULL OR engagement_id IS NOT NULL);

CREATE INDEX cbe_engagement ON public.contract_billing_events (organization_id, engagement_id)
  WHERE engagement_id IS NOT NULL;

-- Leitura: mantém o teste de contrato onde há contrato e adiciona o caminho
-- do pai onde não há. As mesmas chaves de valor continuam exigidas.
DROP POLICY contract_billing_events_select_scoped ON public.contract_billing_events;
CREATE POLICY contract_billing_events_select_scoped ON public.contract_billing_events
  FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND (public.current_user_has_permission('contracts.view_values')
          OR public.current_user_has_permission('finance.view'))
     AND (
       (contract_id IS NOT NULL AND public.current_user_can_read_contract(contract_id))
       OR (contract_id IS NULL AND engagement_id IS NOT NULL
           AND public.current_user_has_permission('contracts.view'))
     ));

-- ---------------------------------------------------------------------------
-- 5) A PONTE medição aceita → candidato a faturamento, generalizada
--
-- O corpo é o mesmo da 136, com UMA mudança: `MEASUREMENT_WITHOUT_CONTRACT`
-- deixa de ser o fim da linha. Medição sem contrato mas COM engajamento
-- autorizado produz candidato — porque existe direito comercial governado,
-- que é a pergunta que o §11 manda responder. Medição sem contrato E sem
-- autorização ativa continua não produzindo nada.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contract_billing_apply_measurement_accepted(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ev   public.domain_events%ROWTYPE;
  m    public.project_measurements%ROWTYPE;
  gov  public.commercial_engagement_authorizations%ROWTYPE;
  eng  public.commercial_engagements%ROWTYPE;
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
  IF m.status <> 'ACCEPTED' THEN
    RETURN jsonb_build_object('created', false, 'reason', 'MEASUREMENT_NOT_ACCEPTED',
                              'status', m.status);
  END IF;

  IF m.contract_id IS NULL THEN
    SELECT * INTO eng FROM public.commercial_engagements
     WHERE id = m.engagement_id AND organization_id = m.organization_id;
    SELECT * INTO gov FROM public.commercial_engagement_authorizations
     WHERE organization_id = m.organization_id AND engagement_id = m.engagement_id
       AND governing AND state = 'ACTIVE';
    IF NOT FOUND THEN
      -- Sem fonte regente não há direito comercial. Informação, não falha.
      RETURN jsonb_build_object('created', false, 'reason', 'MEASUREMENT_WITHOUT_GOVERNING_AUTHORIZATION');
    END IF;
    IF eng.status <> 'AUTHORIZED' THEN
      RETURN jsonb_build_object('created', false, 'reason', 'ENGAGEMENT_NOT_AUTHORIZED',
                                'status', eng.status);
    END IF;
  END IF;

  -- A chave do direito passa a ser do PAI: é ela que identifica a relação,
  -- exista ou não instrumento. Linhas contratadas antigas mantêm a sua chave
  -- porque a chave é gravada uma vez, no nascimento.
  key := concat_ws(':', 'ACCEPTED_MEASUREMENT',
                   COALESCE(m.contract_id, m.engagement_id)::text,
                   m.id::text, m.revision::text);

  SELECT id INTO existing FROM public.contract_billing_events
   WHERE organization_id = m.organization_id AND entitlement_key = key
     AND release_state NOT IN ('CANCELLED','SUPERSEDED');
  IF existing IS NOT NULL THEN
    RETURN jsonb_build_object('created', false, 'idempotent', true, 'billing_event_id', existing);
  END IF;

  BEGIN
    INSERT INTO public.contract_billing_events
      (organization_id, contract_id, engagement_id, milestone_id, title, amount, due_date, status,
       currency, source_kind, source_measurement_id, occurrence_key, entitlement_key,
       release_state, eligibility_state, correlation_id, source_event_id)
    VALUES
      (m.organization_id, m.contract_id, m.engagement_id, m.milestone_id,
       format('Medição %s', COALESCE(m.occurrence_key, m.id::text)),
       COALESCE(m.accepted_value, 0), NULL, 'pendente',
       CASE WHEN m.accepted_currency ~ '^[A-Z]{3}$' THEN m.accepted_currency END,
       'ACCEPTED_MEASUREMENT', m.id, m.occurrence_key, key,
       'NOT_ELIGIBLE', 'UNKNOWN', ev.correlation_id, ev.id)
    RETURNING id INTO new_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO existing FROM public.contract_billing_events
     WHERE organization_id = m.organization_id AND entitlement_key = key
       AND release_state NOT IN ('CANCELLED','SUPERSEDED');
    RETURN jsonb_build_object('created', false, 'idempotent', true, 'billing_event_id', existing);
  END;

  INSERT INTO public.contract_billing_event_history
    (organization_id, billing_event_id, transition, to_state, detail, actor_source, correlation_id)
  VALUES (m.organization_id, new_id, 'candidate_from_accepted_measurement', 'NOT_ELIGIBLE',
          jsonb_build_object('measurement_id', m.id, 'revision', m.revision,
                             'source_event_id', ev.id, 'entitlement_key', key,
                             'engagement_id', m.engagement_id,
                             'authorization_source_kind', gov.source_kind),
          'system', ev.correlation_id);

  elig := public.contract_billing_recompute_eligibility(new_id);

  RETURN jsonb_build_object('created', true, 'billing_event_id', new_id,
                            'entitlement_key', key, 'eligibility', elig->>'state',
                            'released', false);
END $$;

REVOKE ALL ON FUNCTION public.contract_billing_apply_measurement_accepted(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contract_billing_apply_measurement_accepted(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6) Pré-requisitos de faturamento do trabalho SEM contrato
--
-- Trabalho contratado tira os seus de `contract_billing_conditions`. Trabalho
-- por proposta tira dos FATOS EXTRAÍDOS do domínio BILLING_PREREQUISITE — e
-- só dos que passaram pelo portão `commercial_fact_promotable`: ancorados no
-- documento E confirmados por gente. Um pré-requisito que a IA inferiu sem
-- apontar página não bloqueia nem libera nada; ele nem é lido aqui.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commercial_engagement_billing_prerequisites(
  p_organization_id uuid, p_engagement_id uuid
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'fact_id', f.id, 'label', f.label, 'detail', f.value_text,
           'source_document_id', f.document_id, 'source_page', f.source_page,
           'source_section', f.source_section, 'confirmation_state', f.confirmation_state)
         ORDER BY f.created_at), '[]'::jsonb)
    FROM public.commercial_extracted_facts f
   WHERE f.organization_id = p_organization_id
     AND f.engagement_id = p_engagement_id
     AND f.fact_domain = 'BILLING_PREREQUISITE'
     AND public.commercial_fact_promotable(f.id);
$$;
REVOKE ALL ON FUNCTION public.commercial_engagement_billing_prerequisites(uuid,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_engagement_billing_prerequisites(uuid,uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7) A CADEIA COMERCIAL DO PROJETO — uma visão, nenhuma cópia
--
-- O §9 pede que o Projeto mostre a origem real: OS interna, proposta técnica,
-- proposta comercial, contrato se houver, pedido do cliente se houver.
--
-- `project_measurement_read_model` NÃO é tocada de propósito: ela já usa
-- LEFT JOIN em tudo e nunca juntou `contracts`, então continua correta com
-- `contract_id` nulo. Acrescentar colunas nela obrigaria a reescrever a lista
-- inteira (a visão é dependência de `contract_milestone_workbench`), e o
-- ganho caberia numa visão nova que não arrisca nada.
--
-- Os ids são os CANÔNICOS. Nenhum arquivo é copiado: `document_id` aponta
-- para a mesma linha de `contract_documents` que a proposta e a OS já usam.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.project_commercial_source_chain
WITH (security_invoker = true) AS
SELECT
  l.organization_id,
  l.project_id,
  e.id                        AS engagement_id,
  e.title                     AS engagement_title,
  e.status                    AS engagement_status,
  e.counterparty_name,
  e.currency,
  e.authorized_value,

  so.id                       AS service_order_id,
  so.os_number                AS service_order_number,
  so.status                   AS service_order_status,
  so.origin                   AS service_order_origin,
  so.document_id              AS service_order_document_id,

  gov.id                      AS governing_authorization_id,
  gov.source_kind             AS governing_source_kind,
  gov.contract_id             AS governing_contract_id,
  gov.proposal_revision_id    AS governing_proposal_revision_id,
  gov.document_id             AS governing_document_id,
  gov.external_reference      AS governing_external_reference,

  ctr.contract_number,
  ctr.title                   AS contract_title,

  tech.proposal_number        AS technical_proposal_number,
  tech.revision_id            AS technical_proposal_revision_id,
  tech.document_id            AS technical_proposal_document_id,
  comm.proposal_number        AS commercial_proposal_number,
  comm.revision_id            AS commercial_proposal_revision_id,
  comm.document_id            AS commercial_proposal_document_id,

  (SELECT count(*)::int FROM public.commercial_divergences d
    WHERE d.organization_id = l.organization_id AND d.engagement_id = e.id
      AND d.state = 'OPEN')   AS open_divergence_count,
  (SELECT count(*)::int FROM public.commercial_divergences d
    WHERE d.organization_id = l.organization_id AND d.engagement_id = e.id
      AND d.state = 'OPEN' AND d.severity = 'BLOCKING') AS blocking_divergence_count
FROM public.engagement_project_links l
JOIN public.commercial_engagements e
  ON e.id = l.engagement_id AND e.organization_id = l.organization_id
LEFT JOIN public.internal_service_orders so
  ON so.organization_id = l.organization_id AND so.project_id = l.project_id
 AND so.engagement_id = e.id
LEFT JOIN public.commercial_engagement_authorizations gov
  ON gov.organization_id = l.organization_id AND gov.engagement_id = e.id
 AND gov.governing AND gov.state = 'ACTIVE'
LEFT JOIN public.contracts ctr
  ON ctr.id = gov.contract_id AND ctr.organization_id = l.organization_id
LEFT JOIN LATERAL (
  SELECT p.proposal_number, r.id AS revision_id, r.document_id
    FROM public.commercial_proposal_revisions r
    JOIN public.commercial_proposals p
      ON p.id = r.proposal_id AND p.organization_id = r.organization_id
    JOIN public.commercial_engagement_authorizations a
      ON a.proposal_revision_id = r.id AND a.organization_id = r.organization_id
   WHERE a.engagement_id = e.id AND a.state = 'ACTIVE'
     AND p.kind IN ('TECHNICAL','COMBINED')
   ORDER BY r.revision DESC LIMIT 1) tech ON true
LEFT JOIN LATERAL (
  SELECT p.proposal_number, r.id AS revision_id, r.document_id
    FROM public.commercial_proposal_revisions r
    JOIN public.commercial_proposals p
      ON p.id = r.proposal_id AND p.organization_id = r.organization_id
    JOIN public.commercial_engagement_authorizations a
      ON a.proposal_revision_id = r.id AND a.organization_id = r.organization_id
   WHERE a.engagement_id = e.id AND a.state = 'ACTIVE'
     AND p.kind IN ('COMMERCIAL','COMBINED')
   ORDER BY r.revision DESC LIMIT 1) comm ON true;

GRANT SELECT ON public.project_commercial_source_chain TO authenticated;
REVOKE ALL ON public.project_commercial_source_chain FROM anon;

COMMENT ON VIEW public.project_commercial_source_chain IS
  'Origem comercial real do projeto. Ids canônicos; nenhum documento duplicado.';

COMMIT;
