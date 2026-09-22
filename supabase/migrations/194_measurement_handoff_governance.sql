-- ============================================================================
-- 194 — RESPONSÁVEIS, SLA, NOTIFICAÇÃO DEDUPLICADA E A FILA DE APROVAÇÕES
--
-- ─── As quatro coisas que faltavam para o fluxo ser governado ─────────────
--
--   1. QUEM responde por cada etapa — resolvido por vínculo AUTORITATIVO, e
--      nunca por semelhança de nome;
--   2. QUANDO cobrar — prazo DECLARADO, nunca inventado;
--   3. NÃO REPETIR o aviso — um registro de entrega por (handoff, pessoa,
--      canal), exatamente como a 180 fez para os alertas de marco;
--   4. UMA FILA que Contratos abre e vê o MESMO item que Projetos enviou.
--
-- ─── A regra que governa a resolução de responsável ───────────────────────
--
--   NÃO EXISTE CASAMENTO POR APROXIMAÇÃO.
--
-- `projects.project->>'gerente'` guarda um NOME. Resolver nome para usuário
-- por semelhança é o erro que manda valor de contrato para a pessoa errada, e
-- esta migration recusa fazê-lo — do mesmo jeito que a 180 recusou. O gerente
-- do projeto só resolve pela cadeia declarada
-- `projects.responsible_person_id → people.profile_id → profiles.user_id`;
-- não havendo cadeia, o papel volta `RESPONSIBLE_UNDEFINED` e o trabalho vai
-- para a fila do departamento configurado.
--
-- `RESPONSIBLE_UNDEFINED` é resposta de primeira classe, e é ela que aparece
-- na tela. Um destinatário "mais ou menos certo" é pior que um responsável
-- ausente e declarado: o primeiro parece resolvido.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) A política de notificação e SLA — tudo DECLARADO
-- ---------------------------------------------------------------------------
/*
  Todas as colunas de prazo nascem NULAS, e nulo significa "esta organização
  não declarou prazo". O SLA então responde `NOT_ASSESSED` — e não trinta dias.

  A alternativa (um padrão razoável) produziria atraso fabricado: o produto
  começaria a dizer "vencido há 4 dias" sobre um prazo que ninguém acordou, e
  a primeira reação de quem recebe é desligar o canal.
*/
CREATE TABLE IF NOT EXISTS public.project_measurement_notification_policies (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Nula = política da organização. Preenchida = política daquele contrato.
  contract_id             uuid,
  active                  boolean NOT NULL DEFAULT true,

  channels                text[] NOT NULL DEFAULT ARRAY['in_app','email']::text[],

  -- ---- responsáveis que NÃO se deduzem de lugar nenhum ----
  -- Faturamento e Financeiro não têm coluna de dono em nenhuma tabela deste
  -- esquema. Então são ESCOLHIDOS, por alguém, aqui — e enquanto ninguém
  -- escolher, o papel é `RESPONSIBLE_UNDEFINED`.
  billing_owner_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  finance_owner_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- A fila autorizada para onde o trabalho vai quando não há pessoa. Texto,
  -- porque é o nome do departamento que a organização usa — e porque mandar
  -- para "todo mundo" é o que o pedido proíbe explicitamente.
  fallback_queue          text,
  extra_recipient_user_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],

  -- ---- prazos, por etapa ----
  review_due_days         integer CHECK (review_due_days IS NULL OR review_due_days > 0),
  customer_due_days       integer CHECK (customer_due_days IS NULL OR customer_due_days > 0),
  correction_due_days     integer CHECK (correction_due_days IS NULL OR correction_due_days > 0),
  warning_days            integer CHECK (warning_days IS NULL OR warning_days >= 0),
  escalate_after_days     integer CHECK (escalate_after_days IS NULL OR escalate_after_days > 0),
  escalation_target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Intervalo mínimo entre dois lembretes da MESMA pendência. Sem ele, a
  -- rotina diária vira a cobrança diária que a 156 nomeou como ruído.
  reminder_interval_days  integer NOT NULL DEFAULT 3 CHECK (reminder_interval_days > 0),

  created_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pmnp_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pmnp_scope_unique UNIQUE (organization_id, contract_id),
  CONSTRAINT pmnp_contract_tenant FOREIGN KEY (organization_id, contract_id)
    REFERENCES public.contracts (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT pmnp_channels CHECK (
    channels <@ ARRAY['in_app','email']::text[] AND array_length(channels, 1) >= 1)
);

ALTER TABLE public.project_measurement_notification_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY pmnp_select ON public.project_measurement_notification_policies FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.current_user_has_permission('contracts.view')
              OR public.current_user_has_permission('projects.measurements.view')
              OR public.current_user_is_admin()));
GRANT SELECT ON public.project_measurement_notification_policies TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.project_measurement_notification_policies FROM authenticated, anon;
REVOKE ALL ON public.project_measurement_notification_policies FROM anon;

COMMENT ON TABLE public.project_measurement_notification_policies IS
  'Política DECLARADA de canais, responsáveis de faturamento/financeiro e '
  'prazos. Toda coluna de prazo nasce nula: sem declaração, o SLA responde '
  'NOT_ASSESSED, nunca um padrão inventado.';

-- ---------------------------------------------------------------------------
-- 2) A política efetiva de uma medição
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.project_measurement_policy(p_measurement_id uuid)
RETURNS public.project_measurement_notification_policies
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  -- Contrato vence organização; nenhuma das duas, devolve NULL — e a ausência
  -- de política é lida como "nada declarado", que é a verdade.
  SELECT p.* FROM public.project_measurement_notification_policies p
   JOIN public.project_measurements m ON m.organization_id = p.organization_id
  WHERE m.id = p_measurement_id AND p.active
    AND (p.contract_id = m.contract_id OR p.contract_id IS NULL)
  ORDER BY (p.contract_id IS NOT NULL) DESC
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.project_measurement_policy(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_measurement_policy(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) OS RESPONSÁVEIS — por vínculo autoritativo, e só
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.project_measurement_stakeholders(p_measurement_id uuid)
RETURNS TABLE (
  role            text,
  user_id         uuid,
  resolution      text,
  source          text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m   public.project_measurements%ROWTYPE;
  pol public.project_measurement_notification_policies;
BEGIN
  SELECT * INTO m FROM public.project_measurements WHERE id = p_measurement_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Mesma guarda do resolvedor de prontidão: DEFINER sem ela seria um oráculo
  -- entre inquilinos.
  IF auth.uid() IS NOT NULL
     AND m.organization_id IS DISTINCT FROM public.current_user_organization_id() THEN
    RETURN;
  END IF;

  pol := public.project_measurement_policy(p_measurement_id);

  RETURN QUERY
  WITH candidate AS (
    -- GERENTE DO PROJETO — cadeia declarada, nunca nome.
    SELECT 'project_manager'::text AS role,
           pr.user_id AS uid,
           'projects.responsible_person_id → people.profile_id → profiles.user_id'::text AS src
      FROM public.projects pj
      LEFT JOIN public.people pe
        ON pe.id = pj.responsible_person_id AND pe.organization_id = pj.organization_id
      LEFT JOIN public.profiles pr
        ON pr.id = pe.profile_id AND pr.organization_id = pj.organization_id
     WHERE pj.id = m.project_id AND pj.organization_id = m.organization_id

    UNION ALL
    SELECT 'contract_manager', c.owner_user_id, 'contracts.owner_user_id'
      FROM public.contracts c
     WHERE c.id = m.contract_id AND c.organization_id = m.organization_id

    UNION ALL
    SELECT 'milestone_owner', ms.owner_user_id, 'contract_milestones.owner_user_id'
      FROM public.contract_milestones ms
     WHERE ms.id = m.milestone_id AND ms.organization_id = m.organization_id

    UNION ALL
    -- Responsável pela ETAPA GOVERNADAMENTE mapeada. Não é "uma etapa
    -- parecida": é a que a ponte aceita aponta.
    SELECT 'measurement_responsible', tl.responsible_user_id,
           'project_timeline_items.responsible_user_id (etapa mapeada)'
      FROM public.project_timeline_items tl
     WHERE tl.id = m.timeline_item_id AND tl.organization_id = m.organization_id
       AND tl.is_active AND tl.deleted_at IS NULL

    UNION ALL
    SELECT 'billing_owner', pol.billing_owner_user_id,
           'project_measurement_notification_policies.billing_owner_user_id'

    UNION ALL
    SELECT 'finance_owner', pol.finance_owner_user_id,
           'project_measurement_notification_policies.finance_owner_user_id'
  ),
  -- Um papel pode ter mais de um candidato (duas etapas, por exemplo). O
  -- primeiro NÃO NULO ganha; se nenhum resolver, a linha sai indefinida.
  picked AS (
    SELECT c.role,
           (array_remove(array_agg(c.uid ORDER BY c.uid), NULL))[1] AS uid,
           min(c.src) AS src
      FROM candidate c
     GROUP BY c.role
  )
  SELECT p.role,
         CASE WHEN active_member THEN p.uid END,
         CASE WHEN active_member THEN 'RESOLVED' ELSE 'RESPONSIBLE_UNDEFINED' END,
         p.src
    FROM picked p,
         LATERAL (SELECT p.uid IS NOT NULL AND EXISTS (
                    SELECT 1 FROM public.profiles pr
                     WHERE pr.user_id = p.uid
                       AND pr.organization_id = m.organization_id
                       AND pr.status = 'active') AS active_member) chk
   ORDER BY array_position(
     ARRAY['project_manager','contract_manager','milestone_owner',
           'measurement_responsible','billing_owner','finance_owner'], p.role);
END $$;
REVOKE ALL ON FUNCTION public.project_measurement_stakeholders(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_measurement_stakeholders(uuid) TO authenticated;

COMMENT ON FUNCTION public.project_measurement_stakeholders(uuid) IS
  'Responsáveis por VÍNCULO AUTORITATIVO. Sem cadeia declarada o papel volta '
  'RESPONSIBLE_UNDEFINED — nunca um usuário parecido, nunca o departamento '
  'inteiro.';

-- ---------------------------------------------------------------------------
-- 4) SLA — prazo declarado, estado derivado
-- ---------------------------------------------------------------------------
/*
  A etapa é derivada do ESTADO, e o prazo dela vem de duas fontes, nesta ordem:

    1. o prazo acordado com a Contratante, quando a remessa o declarou
       (`customer_due_at`) — é o mais autoritativo que existe: alguém combinou;
    2. o prazo da política, contado a partir do carimbo da etapa.

  Não havendo nenhuma das duas, `NOT_ASSESSED`. Repare que NOT_ASSESSED não é
  "no prazo": é "ninguém disse qual é o prazo", e a tela precisa dizer isso com
  as palavras certas para que alguém vá declará-lo.
*/
CREATE OR REPLACE FUNCTION public.project_measurement_sla(
  p_measurement_id uuid,
  p_as_of          date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m     public.project_measurements%ROWTYPE;
  pol   public.project_measurement_notification_policies;
  as_of date := COALESCE(p_as_of, CURRENT_DATE);
  stage text;
  since timestamptz;
  days  integer;
  due   date;
  state text;
  warn  integer;
BEGIN
  SELECT * INTO m FROM public.project_measurements WHERE id = p_measurement_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('stage', NULL, 'state', 'NOT_ASSESSED', 'reason', 'MEASUREMENT_NOT_FOUND');
  END IF;
  IF auth.uid() IS NOT NULL
     AND m.organization_id IS DISTINCT FROM public.current_user_organization_id() THEN
    RETURN jsonb_build_object('stage', NULL, 'state', 'NOT_ASSESSED', 'reason', 'MEASUREMENT_NOT_FOUND');
  END IF;

  pol := public.project_measurement_policy(p_measurement_id);

  CASE m.status
    WHEN 'SUBMITTED'                     THEN stage := 'CONTRACT_REVIEW'; since := m.submitted_at; days := pol.review_due_days;
    WHEN 'UNDER_REVIEW'                  THEN stage := 'CONTRACT_REVIEW'; since := COALESCE(m.review_started_at, m.submitted_at); days := pol.review_due_days;
    WHEN 'APPROVED_FOR_CUSTOMER'         THEN stage := 'CUSTOMER_DISPATCH'; since := m.approved_for_customer_at; days := pol.review_due_days;
    WHEN 'AWAITING_CUSTOMER_ACCEPTANCE'  THEN stage := 'CUSTOMER_ACCEPTANCE'; since := m.sent_to_customer_at; days := pol.customer_due_days;
    WHEN 'RETURNED_FOR_CORRECTION'       THEN stage := 'PROJECT_CORRECTION'; since := m.returned_at; days := pol.correction_due_days;
    WHEN 'CUSTOMER_CORRECTION_REQUESTED' THEN stage := 'PROJECT_CORRECTION'; since := m.customer_correction_at; days := pol.correction_due_days;
    ELSE stage := NULL;
  END CASE;

  IF stage IS NULL THEN
    RETURN jsonb_build_object('stage', NULL, 'state', 'NOT_APPLICABLE',
                              'status', m.status, 'as_of', as_of);
  END IF;

  -- O prazo combinado com a Contratante tem precedência sobre a política.
  IF stage = 'CUSTOMER_ACCEPTANCE' AND m.customer_due_at IS NOT NULL THEN
    due := m.customer_due_at;
  ELSIF days IS NOT NULL AND since IS NOT NULL THEN
    due := (since::date + days);
  ELSE
    due := NULL;
  END IF;

  IF due IS NULL THEN
    RETURN jsonb_build_object(
      'stage', stage, 'state', 'NOT_ASSESSED', 'status', m.status,
      'since', since, 'due_at', NULL, 'as_of', as_of,
      'reason', CASE WHEN pol.id IS NULL THEN 'NO_POLICY' ELSE 'NO_DECLARED_TERM' END);
  END IF;

  warn := COALESCE(pol.warning_days, 0);
  state := CASE
    WHEN as_of > due THEN 'OVERDUE'
    WHEN as_of >= (due - warn) THEN 'WARNING'
    ELSE 'ON_TIME' END;

  RETURN jsonb_build_object(
    'stage', stage, 'state', state, 'status', m.status,
    'since', since, 'due_at', due, 'as_of', as_of,
    'days_remaining', (due - as_of),
    'escalate_after_days', pol.escalate_after_days,
    'escalation_target_user_id', pol.escalation_target_user_id,
    'escalated', pol.escalate_after_days IS NOT NULL
                 AND as_of > (due + pol.escalate_after_days));
END $$;
REVOKE ALL ON FUNCTION public.project_measurement_sla(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_measurement_sla(uuid, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) O REGISTRO DE ENTREGA — a deduplicação
-- ---------------------------------------------------------------------------
/*
  A mesma gramática da 180: uma linha por (handoff, destinatário, canal), com
  índice único. Se a rotina cair no meio e for repetida, quem já recebeu não
  recebe de novo.

  `handoff_key` carrega a RODADA (`...:r2`) justamente para que a segunda
  correção volte a avisar. Uma chave só com o nome do evento silenciaria o
  segundo pedido de correção — que é o que mais precisa ser avisado.
*/
CREATE TABLE IF NOT EXISTS public.project_measurement_handoff_dispatches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  measurement_id    uuid NOT NULL,
  handoff_key       text NOT NULL CHECK (btrim(handoff_key) <> ''),
  handoff_event     text NOT NULL CHECK (btrim(handoff_event) <> ''),

  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_role    text NOT NULL,
  channel           text NOT NULL CHECK (channel IN ('in_app','email')),
  state             text NOT NULL CHECK (state IN ('DELIVERED','FAILED','SIMULATED','NOT_CONFIGURED')),

  recipient_email   text,
  provider          text,
  notification_id   uuid,
  error_message     text,
  dispatched_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pmhd_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pmhd_idempotent UNIQUE (organization_id, measurement_id, handoff_key,
                                     recipient_user_id, channel),
  CONSTRAINT pmhd_measurement_tenant FOREIGN KEY (organization_id, measurement_id)
    REFERENCES public.project_measurements (organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS pmhd_measurement
  ON public.project_measurement_handoff_dispatches (organization_id, measurement_id, dispatched_at DESC);

ALTER TABLE public.project_measurement_handoff_dispatches ENABLE ROW LEVEL SECURITY;
CREATE POLICY pmhd_select ON public.project_measurement_handoff_dispatches FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.current_user_has_permission('contracts.view')
              OR public.current_user_has_permission('projects.measurements.view')
              OR public.current_user_is_admin()));
GRANT SELECT ON public.project_measurement_handoff_dispatches TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.project_measurement_handoff_dispatches FROM authenticated, anon;
REVOKE ALL ON public.project_measurement_handoff_dispatches FROM anon;

COMMENT ON TABLE public.project_measurement_handoff_dispatches IS
  'Quem foi avisado sobre qual handoff, por qual canal e com que desfecho. '
  'O índice único é a deduplicação — e a rodada entra na chave para que o '
  'segundo pedido de correção volte a avisar.';

CREATE OR REPLACE FUNCTION public.project_measurement_handoff_record(
  p_measurement_id   uuid,
  p_handoff_key      text,
  p_handoff_event    text,
  p_recipient_user_id uuid,
  p_recipient_role   text,
  p_channel          text,
  p_state            text,
  p_recipient_email  text DEFAULT NULL,
  p_provider         text DEFAULT NULL,
  p_notification_id  uuid DEFAULT NULL,
  p_error_message    text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE org uuid; out_id uuid;
BEGIN
  SELECT organization_id INTO org FROM public.project_measurements WHERE id = p_measurement_id;
  IF org IS NULL THEN
    RAISE EXCEPTION 'MEASUREMENT_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO public.project_measurement_handoff_dispatches
    (organization_id, measurement_id, handoff_key, handoff_event, recipient_user_id,
     recipient_role, channel, state, recipient_email, provider, notification_id, error_message)
  VALUES (org, p_measurement_id, p_handoff_key, p_handoff_event, p_recipient_user_id,
          p_recipient_role, p_channel, p_state, p_recipient_email, p_provider,
          p_notification_id, p_error_message)
  ON CONFLICT ON CONSTRAINT pmhd_idempotent DO NOTHING
  RETURNING id INTO out_id;

  RETURN out_id;
END $$;
REVOKE ALL ON FUNCTION public.project_measurement_handoff_record(
  uuid, text, text, uuid, text, text, text, text, text, uuid, text)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6) A FILA de Contratos → Aprovações
-- ---------------------------------------------------------------------------
/*
  UMA visão, e o MESMO item que Projetos vê. Não há cópia do marco, não há
  segundo id e não há estado próprio: `status` é o da medição canônica, e a
  fila é apenas um recorte dela pelos estados que exigem alguém de Contratos.

  O portão de valor é o mesmo predicado da 182, pela mesma razão: uma quantia
  restrita tem de sair NULA com a restrição nomeada, e não zero.
*/
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
  c.title                             AS contract_title,
  c.counterparty_name,
  c.owner_user_id                     AS contract_owner_user_id,

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
  CASE WHEN g.can_view_values THEN COALESCE(m.accepted_currency, m.currency, c.currency) END AS currency,

  -- ---- carimbos da cadeia ----
  m.submitted_at, m.review_started_at, m.approved_for_customer_at,
  m.sent_to_customer_at, m.customer_correction_at, m.returned_at,
  m.accepted_at, m.rejected_at,
  m.customer_due_at, m.return_reason, m.customer_correction_reason,

  -- ---- prontidão e pendências, da autoridade de cada uma ----
  rc.overall                          AS readiness_overall,
  rc.dimensions                       AS readiness_dimensions,
  rc.reasons                          AS readiness_reasons,
  rc.computed_at                      AS readiness_computed_at,

  (SELECT count(*)::int FROM public.project_measurement_evidence e
    WHERE e.measurement_id = m.id AND e.revoked_at IS NULL)        AS evidence_count,
  (SELECT count(*)::int FROM public.project_measurement_requirements q
    WHERE q.measurement_id = m.id AND q.required
      AND q.satisfaction_state = 'MISSING')                        AS missing_requirement_count,
  (SELECT count(*)::int FROM public.project_measurement_requirements q
    WHERE q.measurement_id = m.id AND q.satisfaction_state = 'UNKNOWN') AS unknown_requirement_count,
  (SELECT count(*)::int FROM public.project_measurement_correction_items ci
    WHERE ci.measurement_id = m.id AND ci.resolved_at IS NULL)     AS open_correction_count,
  (SELECT count(*)::int FROM public.project_measurement_customer_dispatches d
    WHERE d.measurement_id = m.id)                                 AS dispatch_count,

  public.project_measurement_preanalysis(m.id)                     AS preanalysis,
  public.project_measurement_sla(m.id, NULL)                       AS sla
FROM public.project_measurements m
CROSS JOIN gate g
JOIN public.contracts c
  ON c.id = m.contract_id AND c.organization_id = m.organization_id
JOIN public.projects pj
  ON pj.id = m.project_id AND pj.organization_id = m.organization_id
LEFT JOIN public.contract_milestones ms
  ON ms.id = m.milestone_id AND ms.organization_id = m.organization_id
LEFT JOIN public.project_timeline_items ti
  ON ti.id = m.timeline_item_id AND ti.organization_id = m.organization_id
LEFT JOIN public.project_measurement_readiness_cache rc
  ON rc.measurement_id = m.id
-- O recorte da FILA: só o que espera alguém de Contratos, mais o que voltou
-- para o Projeto (que Contratos precisa continuar enxergando para cobrar).
WHERE m.status IN ('SUBMITTED','UNDER_REVIEW','APPROVED_FOR_CUSTOMER',
                   'AWAITING_CUSTOMER_ACCEPTANCE','CUSTOMER_CORRECTION_REQUESTED',
                   'RETURNED_FOR_CORRECTION');

GRANT SELECT ON public.project_measurement_review_queue TO authenticated;
REVOKE ALL ON public.project_measurement_review_queue FROM anon;

COMMENT ON VIEW public.project_measurement_review_queue IS
  'A fila de Contratos → Aprovações. É um RECORTE da medição canônica: mesmo '
  'id, mesmo estado, nenhuma cópia. Quantia sai nula sob restrição, nunca zero.';

-- ---------------------------------------------------------------------------
-- 7) Quem está vencido e ainda não foi cobrado
-- ---------------------------------------------------------------------------
/*
  A rotina de lembrete lê DAQUI. A função não envia nada — ela só responde
  "quais pendências passaram do prazo e não recebem aviso desde o intervalo
  declarado". Enviar é do servidor, pela infraestrutura que já existe.
*/
CREATE OR REPLACE FUNCTION public.project_measurement_sla_nudges(
  p_organization_id uuid,
  p_as_of           date DEFAULT NULL,
  p_limit           integer DEFAULT 200
) RETURNS TABLE (
  measurement_id uuid,
  status         text,
  stage          text,
  sla_state      text,
  due_at         date,
  last_nudged_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH pol AS (
    SELECT COALESCE(min(reminder_interval_days), 3) AS interval_days
      FROM public.project_measurement_notification_policies
     WHERE organization_id = p_organization_id AND active
  ),
  live AS (
    SELECT m.id, m.status, public.project_measurement_sla(m.id, p_as_of) AS s
      FROM public.project_measurements m
     WHERE m.organization_id = p_organization_id
       AND m.status IN ('SUBMITTED','UNDER_REVIEW','APPROVED_FOR_CUSTOMER',
                        'AWAITING_CUSTOMER_ACCEPTANCE','CUSTOMER_CORRECTION_REQUESTED',
                        'RETURNED_FOR_CORRECTION')
  ),
  nudged AS (
    SELECT d.measurement_id, max(d.dispatched_at) AS last_at
      FROM public.project_measurement_handoff_dispatches d
     WHERE d.organization_id = p_organization_id
       AND d.handoff_event = 'sla.reminder'
     GROUP BY d.measurement_id
  )
  SELECT l.id, l.status, l.s->>'stage', l.s->>'state', (l.s->>'due_at')::date, n.last_at
    FROM live l
    LEFT JOIN nudged n ON n.measurement_id = l.id
    CROSS JOIN pol
   WHERE l.s->>'state' IN ('WARNING','OVERDUE')
     AND (n.last_at IS NULL
          OR n.last_at < now() - make_interval(days => pol.interval_days))
   ORDER BY (l.s->>'due_at')::date NULLS LAST
   LIMIT GREATEST(COALESCE(p_limit, 200), 1)
$$;
REVOKE ALL ON FUNCTION public.project_measurement_sla_nudges(uuid, date, integer)
  FROM PUBLIC, anon, authenticated;

COMMIT;
