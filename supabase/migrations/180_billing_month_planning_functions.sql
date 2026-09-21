-- ============================================================================
-- 180 — PLANEJAMENTO MENSAL DE FATURAMENTO: as funções de servidor
--
-- A 179 criou a visão, o diário de reprogramação e as três tabelas de alerta.
-- Esta migration cria os ÚNICOS caminhos de escrita até elas.
--
-- ─── Por que nenhuma delas aceita INSERT de navegador ─────────────────────
--
-- Um alerta é uma afirmação sobre dinheiro que sai deste produto por e-mail e
-- chega a um gerente. "Marco de faturamento vencido — R$ 803.233,98" fabricado
-- pelo próprio navegador custa uma ligação para o cliente. Por isso as tabelas
-- da 179 revogam INSERT de `authenticated` e a materialização é SECURITY
-- DEFINER, com o recorte de organização passado e CONFERIDO.
--
-- ─── A fronteira que estas funções NÃO cruzam ─────────────────────────────
--
--   · Não derivam estágio de marco. A derivação é de `milestone-stage.ts`.
--     O alerta guarda FATOS (`facts_snapshot`) e quem renderiza chama a
--     derivação canônica sobre eles.
--   · Não criam evento de faturamento, nota, recebível ou pagamento.
--   · Não ACEITAM mapeamento. `contract_billing_propose_timeline_mapping`
--     escreve `system_proposed` + `proposed`, e o CHECK da 131
--     (`cmrtm_proposal_needs_review`) continua exigindo revisor humano nomeado
--     para chegar a `accepted`. Proposta não é verdade (§17).
--   · Não alteram data de cronograma. O QUANDO continua sendo de Projetos.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) MATERIALIZAÇÃO DO ALERTA
-- ---------------------------------------------------------------------------
/*
  ─── Sobre ler uma visão `security_invoker` dentro de uma função DEFINER ───

  `contract_billing_month_plan` é `security_invoker = true`. Lida daqui, o
  "invocador" é o DONO desta função, e a RLS das tabelas de origem não filtra
  nada. É o mesmo padrão de `contract_obligations_apply_schedule_anchor` (155),
  e a proteção é a mesma: o recorte de organização é EXPLÍCITO no WHERE e
  conferido contra o parâmetro. Sem essa linha, esta função seria um vazamento
  entre inquilinos com cara de rotina de alerta.

  ─── O que NÃO gera alerta ────────────────────────────────────────────────

    · marco sem data prevista        — não há do que avisar; avisar "em breve"
                                       sem data seria ruído puro
    · marco cancelado                — fim de linha declarado
    · marco com evento de faturamento já gerado — dali para frente o dono é a
                                       cadeia a jusante (liberação, NF,
                                       recebível), que tem os próprios avisos

  ─── Idempotência ─────────────────────────────────────────────────────────

  `ON CONFLICT DO NOTHING` sobre `cbma_idempotent`. Rodar dez vezes no mesmo
  dia insere na primeira e zero nas outras nove — e dois workers simultâneos
  também, porque a garantia é o índice único, não uma leitura anterior.
*/
CREATE OR REPLACE FUNCTION public.contract_billing_alerts_materialize(
  p_organization_id uuid,
  p_as_of           date DEFAULT current_date,
  p_limit           integer DEFAULT 500
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  DEFAULT_OFFSETS CONSTANT smallint[] := ARRAY[30,15,7,3,0]::smallint[];
  r               record;
  v_offsets       smallint[];
  v_overdue       boolean;
  v_source        text;
  v_delta         integer;
  v_offset        smallint;
  v_created       integer := 0;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organização é obrigatória.' USING ERRCODE = 'check_violation';
  END IF;

  FOR r IN
    SELECT *
      FROM public.contract_billing_month_plan m
     WHERE m.organization_id = p_organization_id   -- ← o recorte, explícito
       AND m.planned_billing_date IS NOT NULL
       AND m.status <> 'cancelled'
       AND m.billing_event_id IS NULL
     ORDER BY m.planned_billing_date
     LIMIT GREATEST(p_limit, 0)
  LOOP
    -- Política: do contrato, senão da organização, senão o padrão — e o alerta
    -- REGISTRA qual delas valeu, para que "30 dias antes" nunca se leia como
    -- escolha da organização quando ninguém escolheu nada.
    SELECT p.offsets_days, p.overdue_enabled,
           CASE WHEN p.contract_id IS NULL THEN 'organization' ELSE 'contract' END
      INTO v_offsets, v_overdue, v_source
      FROM public.contract_billing_alert_policies p
     WHERE p.organization_id = p_organization_id
       AND p.active
       AND (p.contract_id = r.contract_id OR p.contract_id IS NULL)
     ORDER BY (p.contract_id IS NOT NULL) DESC
     LIMIT 1;

    IF v_offsets IS NULL THEN
      v_offsets := DEFAULT_OFFSETS;
      v_overdue := true;
      v_source  := 'default';
    END IF;

    v_delta := r.planned_billing_date - p_as_of;

    IF v_delta >= 0 THEN
      -- Antecedência: só dispara no dia EXATO da cadência. Disparar em
      -- "<= 30" reenviaria o aviso de 30 dias todo dia durante um mês.
      IF NOT (v_delta = ANY (v_offsets)) THEN CONTINUE; END IF;
      v_offset := v_delta::smallint;
    ELSE
      IF NOT COALESCE(v_overdue, true) THEN CONTINUE; END IF;
      -- Vencido é UM alerta por data prevista, não um por dia de atraso: o
      -- sentinela -1 fixa a chave de idempotência. O dia em que venceu
      -- continua legível em `planned_date`.
      v_offset := -1;
    END IF;

    INSERT INTO public.contract_billing_milestone_alerts
      (organization_id, contract_id, milestone_id, project_id,
       planned_date, planned_date_basis, offset_days, kind,
       facts_snapshot, amount, currency, policy_source, as_of_date)
    VALUES (
      p_organization_id, r.contract_id, r.milestone_id, r.project_id,
      r.planned_billing_date, r.planned_billing_date_basis, v_offset,
      CASE WHEN v_offset < 0 THEN 'OVERDUE'
           WHEN v_offset = 0 THEN 'DUE_TODAY'
           ELSE 'UPCOMING' END,
      /*
        Os fatos que `milestone-stage.ts` consome, em snake_case — a mesma
        forma que `toWorkbenchRow` já sabe normalizar. Guardar o retrato assim
        é o que permite renderizar o alerta de trinta dias atrás com a
        derivação canônica de hoje, sem reescrever a derivação em SQL.
      */
      jsonb_build_object(
        'status',                       r.status,
        'billing_event_id',             r.billing_event_id,
        'billing_eligibility_state',    r.billing_eligibility_state,
        'billing_release_state',        r.billing_release_state,
        'billing_receivable_status',    r.billing_receivable_status,
        'measurement_id',               r.measurement_id,
        'measurement_status',           r.measurement_status,
        'measurement_readiness',        r.measurement_readiness,
        'measurement_accepted_at',      r.measurement_accepted_at,
        'measurement_evidence_count',   r.measurement_evidence_count,
        'customer_acceptance_required', r.customer_acceptance_required,
        'evidence_required',            r.evidence_required,
        'evidence',                     r.evidence,
        'evidence_document_id',         r.evidence_document_id,
        'requirement_id',               r.requirement_id,
        'governed_mapping_count',       r.governed_mapping_count,
        'timeline_item_id',             r.timeline_item_id,
        'timeline_title',               r.timeline_title,
        'timeline_wbs_code',            r.timeline_wbs_code,
        'timeline_status',              r.timeline_status,
        'timeline_actual_finish',       r.timeline_actual_finish,
        'timeline_planned_finish',      r.timeline_planned_finish,
        'due_date',                     r.milestone_due_date,
        'completed_at',                 r.completed_at,
        'owner_user_id',                r.milestone_owner_user_id,
        'entitlement_amount',           r.entitlement_amount,
        'measured_amount',              r.measured_amount,
        'accepted_value',               r.accepted_value,
        'title',                        r.title,
        'contract_number',              r.contract_number,
        'counterparty_name',            r.counterparty_name
      ),
      r.planned_amount, r.currency, v_source, p_as_of)
    ON CONFLICT ON CONSTRAINT cbma_idempotent DO NOTHING;

    IF FOUND THEN v_created := v_created + 1; END IF;
  END LOOP;

  RETURN v_created;
END $$;

REVOKE ALL ON FUNCTION public.contract_billing_alerts_materialize(uuid, date, integer)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.contract_billing_alerts_materialize(uuid, date, integer) IS
  'Materializa alertas de marco de faturamento próximo/vencido para a '
  'organização, na cadência DECLARADA (ou na padrão, dizendo que é padrão). '
  'Idempotente pelo índice único (marco, data prevista, antecedência). Não '
  'deriva estágio, não envia nada e não cria fato financeiro.';

-- ---------------------------------------------------------------------------
-- 2) DESTINATÁRIOS — derivados do domínio, com o PAPEL declarado
-- ---------------------------------------------------------------------------
/*
  Só campos que carregam um `uuid` de usuário AUTORITATIVO entram aqui:

    milestone_owner          ← contract_milestones.owner_user_id
    measurement_responsible  ← project_timeline_items.responsible_user_id
                               (da etapa GOVERNADAMENTE mapeada, não de
                                qualquer etapa parecida)
    contract_manager         ← contracts.owner_user_id
    configured_recipient     ← contract_billing_alert_policies.extra_recipient_user_ids

  `project_manager` está no CHECK da 179 e NÃO é preenchido por esta função:
  `projects` guarda o projeto em JSONB e o gerente aparece lá como NOME, não
  como `uuid` de usuário. Resolver nome para usuário por semelhança é
  exatamente o casamento por aproximação que a §76 proíbe — e o preço do erro
  aqui é mandar valor de contrato para a pessoa errada. Enquanto não existir
  coluna de gerente com `uuid`, o gerente do projeto se avisa como
  `configured_recipient`, explicitamente escolhido por alguém.
*/
CREATE OR REPLACE FUNCTION public.contract_billing_alert_recipients(
  p_organization_id uuid,
  p_alert_id        uuid
) RETURNS TABLE (recipient_user_id uuid, recipient_role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a public.contract_billing_milestone_alerts%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.contract_billing_milestone_alerts
   WHERE id = p_alert_id AND organization_id = p_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alerta % não existe nesta organização.', p_alert_id
      USING ERRCODE = 'no_data_found';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT m.owner_user_id AS uid, 'milestone_owner'::text AS role
      FROM public.contract_milestones m
     WHERE m.organization_id = a.organization_id AND m.id = a.milestone_id
    UNION ALL
    SELECT tl.responsible_user_id, 'measurement_responsible'
      FROM public.contract_measurement_rule_timeline_governed g
      JOIN public.contract_measurement_requirements q
        ON q.organization_id = g.organization_id AND q.id = g.rule_id
      JOIN public.project_timeline_items tl
        ON tl.organization_id = g.organization_id AND tl.id = g.timeline_item_id
     WHERE g.organization_id = a.organization_id
       AND q.milestone_id = a.milestone_id
       AND tl.is_active AND tl.deleted_at IS NULL
    UNION ALL
    SELECT c.owner_user_id, 'contract_manager'
      FROM public.contracts c
     WHERE c.organization_id = a.organization_id AND c.id = a.contract_id
    UNION ALL
    SELECT u, 'configured_recipient'
      FROM public.contract_billing_alert_policies p,
           LATERAL unnest(p.extra_recipient_user_ids) u
     WHERE p.organization_id = a.organization_id
       AND p.active
       AND (p.contract_id = a.contract_id OR p.contract_id IS NULL)
  )
  -- A mesma pessoa pode ser dona do marco E gerente do contrato. Ela recebe
  -- UMA vez, no papel mais específico — dois e-mails idênticos ensinam a
  -- ignorar o aviso.
  SELECT DISTINCT ON (c.uid) c.uid, c.role
    FROM candidates c
   WHERE c.uid IS NOT NULL
     -- Destinatário precisa ser membro ativo do inquilino. Um usuário que saiu
     -- da organização não recebe valor de contrato dela.
     AND EXISTS (SELECT 1 FROM public.profiles pr
                  WHERE pr.user_id = c.uid
                    AND pr.organization_id = a.organization_id
                    AND pr.status = 'active')
   ORDER BY c.uid,
            array_position(ARRAY['milestone_owner','measurement_responsible',
                                 'contract_manager','configured_recipient'], c.role);
END $$;

REVOKE ALL ON FUNCTION public.contract_billing_alert_recipients(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) REGISTRO DE ENTREGA
-- ---------------------------------------------------------------------------
/*
  Idempotente por (alerta, destinatário, canal). A segunda chamada com o mesmo
  trio devolve o id da PRIMEIRA e não reescreve o estado: se o e-mail já saiu
  como DELIVERED, um retry da rotina não pode rebaixá-lo a SIMULATED.
*/
CREATE OR REPLACE FUNCTION public.contract_billing_alert_record_dispatch(
  p_organization_id  uuid,
  p_alert_id         uuid,
  p_recipient_user_id uuid,
  p_recipient_role   text,
  p_channel          text,
  p_state            text,
  p_recipient_email  text DEFAULT NULL,
  p_provider         text DEFAULT NULL,
  p_notification_id  uuid DEFAULT NULL,
  p_email_dispatch_id uuid DEFAULT NULL,
  p_error_message    text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.contract_billing_milestone_alerts
                  WHERE id = p_alert_id AND organization_id = p_organization_id) THEN
    RAISE EXCEPTION 'Alerta % não existe nesta organização.', p_alert_id
      USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO public.contract_billing_alert_dispatches
    (organization_id, alert_id, recipient_user_id, recipient_email, recipient_role,
     channel, state, provider, notification_id, email_dispatch_id, error_message)
  VALUES (p_organization_id, p_alert_id, p_recipient_user_id, p_recipient_email,
          p_recipient_role, p_channel, p_state, p_provider, p_notification_id,
          p_email_dispatch_id, p_error_message)
  ON CONFLICT ON CONSTRAINT cbad_idempotent DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT d.id INTO v_id FROM public.contract_billing_alert_dispatches d
     WHERE d.organization_id = p_organization_id AND d.alert_id = p_alert_id
       AND d.recipient_user_id IS NOT DISTINCT FROM p_recipient_user_id
       AND d.channel = p_channel;
  END IF;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.contract_billing_alert_record_dispatch(
  uuid, uuid, uuid, text, text, text, text, text, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) PROPOSTA DE MAPEAMENTO marco ↔ etapa de cronograma
-- ---------------------------------------------------------------------------
/*
  O caminho por onde a sugestão automática entra — e o teto que ela nunca passa.

  Escreve SEMPRE `mapping_source = 'system_proposed'` e `review_state =
  'proposed'`. Os dois são literais no INSERT, não parâmetros: um parâmetro
  `p_review_state` seria o buraco por onde a rotina de importação acabaria
  escrevendo `accepted` "só nos casos de alta confiança", e o CHECK da 131
  existe justamente para que esse caso não tenha atalho.

  O re-proposto NÃO sobrescreve decisão humana:
    · já `accepted`  → devolve o id existente, intocado. É o "mapeamento aceito
                       se atualiza sozinho": ele continua valendo, e a data nova
                       do cronograma flui por ele sem ninguém tocar em nada.
    · já `rejected`  → devolve o id existente, intocado. Propor de novo o que
                       um humano recusou é discutir com o revisor.
    · já `proposed`  → atualiza só a confiança e a nota (a proposta melhorou).
*/
CREATE OR REPLACE FUNCTION public.contract_billing_propose_timeline_mapping(
  p_organization_id  uuid,
  p_contract_id      uuid,
  p_rule_id          uuid,
  p_project_id       text,
  p_timeline_item_id uuid,
  p_confidence       numeric,
  p_note             text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_existing public.contract_measurement_rule_timeline_mappings%ROWTYPE;
  v_id       uuid;
BEGIN
  IF p_confidence IS NULL OR p_confidence < 0 OR p_confidence > 1 THEN
    RAISE EXCEPTION 'Confiança da proposta deve estar entre 0 e 1.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- A regra tem de ser do contrato informado, e o projeto tem de estar ligado a
  -- ele. A 131 já exige isso por FK; conferir aqui devolve erro legível em vez
  -- de violação de restrição.
  IF NOT EXISTS (SELECT 1 FROM public.contract_measurement_requirements q
                  WHERE q.organization_id = p_organization_id
                    AND q.id = p_rule_id AND q.contract_id = p_contract_id) THEN
    RAISE EXCEPTION 'Regra de medição % não pertence ao contrato informado.', p_rule_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_existing
    FROM public.contract_measurement_rule_timeline_mappings
   WHERE organization_id = p_organization_id
     AND rule_id = p_rule_id
     AND timeline_item_id = p_timeline_item_id;

  IF FOUND THEN
    IF v_existing.review_state = 'proposed'
       AND v_existing.mapping_source = 'system_proposed' THEN
      UPDATE public.contract_measurement_rule_timeline_mappings
         SET confidence = p_confidence,
             note       = COALESCE(p_note, note),
             mapped_at  = now()
       WHERE id = v_existing.id;
    END IF;
    RETURN v_existing.id;
  END IF;

  INSERT INTO public.contract_measurement_rule_timeline_mappings
    (organization_id, contract_id, rule_id, project_id, timeline_item_id,
     mapping_source, confidence, review_state, note)
  VALUES (p_organization_id, p_contract_id, p_rule_id, p_project_id, p_timeline_item_id,
          'system_proposed', p_confidence, 'proposed', p_note)
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.contract_billing_propose_timeline_mapping(
  uuid, uuid, uuid, text, uuid, numeric, text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.contract_billing_propose_timeline_mapping(
  uuid, uuid, uuid, text, uuid, numeric, text) IS
  'Único caminho de escrita da PROPOSTA automática de mapeamento marco↔etapa. '
  'Grava sempre system_proposed/proposed — nunca accepted, e sem parâmetro que '
  'permita pedir accepted. Mapeamento já aceito ou já rejeitado é devolvido '
  'intocado: a rotina não discute com o revisor humano (§17).';

-- ---------------------------------------------------------------------------
-- 4b) A REVISÃO HUMANA — o único caminho de proposta para verdade
-- ---------------------------------------------------------------------------
/*
  ─── O buraco que esta função fecha ──────────────────────────────────────

  A 131 criou o mapeamento governado com o estado `proposed` e o CHECK que
  exige revisor nomeado para chegar a `accepted` — e revogou UPDATE de
  `authenticated`. O resultado, até aqui, é que NENHUM caminho do produto
  conseguia aceitar uma proposta. A governança estava correta e inalcançável:
  toda sugestão nascia inerte e morria inerte, e o único jeito de criar um
  vínculo aceito era um `psql` na mão de alguém.

  Uma regra que só se cumpre fora do produto não é uma regra cumprida.

  ─── O que esta função garante ──────────────────────────────────────────

    · `auth.uid()` OBRIGATÓRIO. É o que impede que uma rotina de servidor —
      inclusive a rotina de proposta desta mesma migration, que roda no
      service role e não tem usuário — aceite o próprio palpite. Revisor
      humano nomeado é literalmente `NOT NULL` aqui.

    · permissão explícita de edição de contratos. Ver a carteira não dá
      direito de decidir a data de faturamento de R$ 8 milhões.

    · decisão sobre proposta JÁ DECIDIDA é recusada. Reaceitar um mapeamento
      rejeitado é uma decisão nova, e ela precisa ser tomada sabendo que
      houve uma anterior — não por um clique num botão que parecia disponível.
*/
CREATE OR REPLACE FUNCTION public.contract_measurement_rule_timeline_review(
  p_mapping_id uuid,
  p_decision   text,
  p_note       text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m   public.contract_measurement_rule_timeline_mappings%ROWTYPE;
  uid uuid := auth.uid();
BEGIN
  IF p_decision NOT IN ('accepted', 'rejected') THEN
    RAISE EXCEPTION 'Decisão deve ser accepted ou rejected.' USING ERRCODE = 'check_violation';
  END IF;

  -- Sem usuário autenticado não há revisor. Service role cai aqui, e é o que
  -- garante que a proposta automática nunca se aprove sozinha.
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Revisão de mapeamento exige usuário autenticado.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (public.current_user_has_permission('contracts.edit') OR public.current_user_is_admin()) THEN
    RAISE EXCEPTION 'Sem permissão para revisar mapeamento de cronograma.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO m FROM public.contract_measurement_rule_timeline_mappings
   WHERE id = p_mapping_id
     AND organization_id = public.current_user_organization_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mapeamento % não existe nesta organização.', p_mapping_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF m.review_state <> 'proposed' THEN
    RAISE EXCEPTION 'Mapeamento já revisado (%). Decisão anterior não é sobrescrita aqui.',
      m.review_state USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.contract_measurement_rule_timeline_mappings
     SET review_state = p_decision,
         reviewed_by  = uid,
         reviewed_at  = now(),
         note         = COALESCE(p_note, note)
   WHERE id = p_mapping_id;

  RETURN p_mapping_id;
END $$;

REVOKE ALL ON FUNCTION public.contract_measurement_rule_timeline_review(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_measurement_rule_timeline_review(uuid, text, text)
  TO authenticated;

COMMENT ON FUNCTION public.contract_measurement_rule_timeline_review(uuid, text, text) IS
  'A revisão HUMANA de um mapeamento marco↔cronograma proposto. Exige '
  'auth.uid() — service role não passa, e por isso a rotina de proposta não '
  'consegue aceitar o próprio palpite. Proposta já decidida não é sobrescrita.';

-- ---------------------------------------------------------------------------
-- 5) DECLARAÇÃO DA CADÊNCIA
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contract_billing_alert_policy_declare(
  p_organization_id uuid,
  p_contract_id     uuid,
  p_offsets_days    smallint[],
  p_overdue_enabled boolean,
  p_channels        text[],
  p_extra_recipients uuid[] DEFAULT ARRAY[]::uuid[],
  p_note            text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_organization_id <> public.current_user_organization_id() THEN
    RAISE EXCEPTION 'Política de alerta só pode ser declarada na própria organização.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (public.current_user_has_permission('contracts.edit') OR public.current_user_is_admin()) THEN
    RAISE EXCEPTION 'Sem permissão para declarar cadência de alerta de faturamento.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  /*
    UPDATE e depois INSERT, em vez de `ON CONFLICT (organization_id,
    contract_id)`.

    A unicidade da política da organização mora num índice PARCIAL
    (`WHERE contract_id IS NULL`), e `ON CONFLICT` com lista de colunas não
    casa com índice parcial — a cláusula seria aceita na escrita e falharia na
    hora exata em que alguém redeclarasse a cadência da organização. Os dois
    caminhos ficam explícitos, e o `IS NOT DISTINCT FROM` trata o NULL como
    valor, que é o que ele significa aqui.
  */
  UPDATE public.contract_billing_alert_policies
     SET offsets_days = p_offsets_days,
         overdue_enabled = p_overdue_enabled,
         channels = p_channels,
         extra_recipient_user_ids = COALESCE(p_extra_recipients, ARRAY[]::uuid[]),
         declared_by = auth.uid(),
         declared_at = now(),
         note = p_note,
         active = true
   WHERE organization_id = p_organization_id
     AND contract_id IS NOT DISTINCT FROM p_contract_id;

  IF NOT FOUND THEN
    INSERT INTO public.contract_billing_alert_policies
      (organization_id, contract_id, offsets_days, overdue_enabled, channels,
       extra_recipient_user_ids, declared_by, note)
    VALUES (p_organization_id, p_contract_id, p_offsets_days, p_overdue_enabled,
            p_channels, COALESCE(p_extra_recipients, ARRAY[]::uuid[]), auth.uid(), p_note);
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.contract_billing_alert_policy_declare(
  uuid, uuid, smallint[], boolean, text[], uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_billing_alert_policy_declare(
  uuid, uuid, smallint[], boolean, text[], uuid[], text) TO authenticated;

COMMIT;
