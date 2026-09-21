-- ============================================================================
-- 181 — EVENTOS DE MEDIÇÃO NO CRONOGRAMA DO PROJETO
--
-- ─── A pergunta que Projetos não sabia responder ──────────────────────────
--
--   "Quais atividades deste cronograma são eventos contratuais de medição?"
--
-- Tudo que responde a isso já existia — do lado de Contratos. A 131 criou a
-- ponte GOVERNADA regra↔etapa, a 171 a bancada do marco, a 179 a visão de
-- planejamento com data e mês previstos, a 180 as funções de proposta e de
-- revisão humana. O que faltava era uma leitura ORIENTADA AO PROJETO: entrar
-- pelo `project_id`, sair com uma linha por marco contratual e o ESTADO DO
-- VÍNCULO ao lado.
--
-- ─── O que esta migration cria ────────────────────────────────────────────
--
--   1. contract_measurement_rule_timeline_mappings.ambiguous_with
--      — as etapas EMPATADAS com a proposta, preservadas
--   2. contract_billing_propose_timeline_mapping(…, p_ambiguous_with)
--      — a proposta passa a registrar o empate que o matcher enxergou
--   3. project_schedule_contract_events
--      — a visão: um marco por linha, com link_state
--
-- ─── O que ela RECUSA criar ───────────────────────────────────────────────
--
--   · nenhuma cópia de marco, de estágio ou de valor. A visão LÊ
--     `contract_billing_month_plan` e repassa; a derivação de estágio
--     continua sendo de `milestone-stage.ts`, em TypeScript, e esta migration
--     não escreve um único CASE WHEN de estágio.
--   · nenhum caminho novo até `accepted`. O aceite continua sendo
--     `contract_measurement_rule_timeline_review`, que exige auth.uid() e
--     `contracts.edit`.
--   · nenhum evento de faturamento, medição, aceite ou recebível.
--   · nenhuma escrita em `project_timeline_items`. A EVIDÊNCIA de medição
--     não vira atividade de projeto: ela é SOBREPOSIÇÃO derivada, e o
--     cronograma segue sendo a verdade operacional.
--
-- ─── Por que AMBÍGUO precisa de coluna ────────────────────────────────────
--
-- O matcher já enxerga o empate: quando duas etapas explicam o mesmo marco
-- dentro da margem de desempate, ele rebaixa a confiança e devolve
-- `ambiguousWith`. Só que isso morria na memória do processo de importação —
-- a proposta era gravada, o empate não. Na tela, meia hora depois, um empate
-- 0,79 × 0,78 aparecia idêntico a um casamento solitário de 0,79.
--
-- A coluna guarda os concorrentes para que a tela possa dizer AMBÍGUO e
-- OFERECER as alternativas ao revisor — que é exatamente a diferença entre
-- "escolha uma destas três" e "aceite esta".
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) O EMPATE, preservado ao lado da proposta
-- ---------------------------------------------------------------------------
ALTER TABLE public.contract_measurement_rule_timeline_mappings
  ADD COLUMN IF NOT EXISTS ambiguous_with uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];

/*
  Empate só existe em PALPITE. Um mapeamento explícito — alguém escolheu a
  etapa — não tem concorrente por definição, e permitir que carregasse um
  abriria espaço para a tela pedir "desempate" de uma decisão já tomada.

  É a mesma fronteira que `cmrtm_confidence_scope` já desenha para a confiança.
*/
ALTER TABLE public.contract_measurement_rule_timeline_mappings
  DROP CONSTRAINT IF EXISTS cmrtm_ambiguity_scope;
ALTER TABLE public.contract_measurement_rule_timeline_mappings
  ADD CONSTRAINT cmrtm_ambiguity_scope CHECK (
    mapping_source = 'system_proposed'
    OR COALESCE(array_length(ambiguous_with, 1), 0) = 0);

COMMENT ON COLUMN public.contract_measurement_rule_timeline_mappings.ambiguous_with IS
  'Etapas EMPATADAS com a proposta, dentro da margem de desempate do matcher. '
  'Vazio = casamento solitário. Não vazio = AMBÍGUO, e a tela deve pedir '
  'escolha humana entre as alternativas em vez de oferecer "aceitar".';

-- Consulta da visão abaixo: mapeamento por (organização, projeto, regra). O
-- índice existente `cmrtm_project` é (org, project_id, timeline_item_id), que
-- não serve a este acesso.
CREATE INDEX IF NOT EXISTS cmrtm_project_rule
  ON public.contract_measurement_rule_timeline_mappings
  (organization_id, project_id, rule_id);

-- ---------------------------------------------------------------------------
-- 2) A PROPOSTA passa a registrar o empate
-- ---------------------------------------------------------------------------
/*
  ─── Por que DROP e não CREATE OR REPLACE ────────────────────────────────

  Adicionar um parâmetro com DEFAULT não substitui a função: cria uma SOBRE-
  CARGA. As duas passariam a existir, e uma chamada com sete argumentos ficaria
  ambígua para o resolvedor do PostgreSQL. A versão de sete argumentos sai.

  ─── O teto é o mesmo, e continua sendo literal ──────────────────────────

  `'system_proposed'` e `'proposed'` seguem escritos no INSERT, sem parâmetro
  que os alcance. O argumento novo carrega EMPATE, não decisão: quanto mais
  concorrentes, MENOS a proposta afirma — nunca mais.
*/
DROP FUNCTION IF EXISTS public.contract_billing_propose_timeline_mapping(
  uuid, uuid, uuid, text, uuid, numeric, text);

CREATE OR REPLACE FUNCTION public.contract_billing_propose_timeline_mapping(
  p_organization_id  uuid,
  p_contract_id      uuid,
  p_rule_id          uuid,
  p_project_id       text,
  p_timeline_item_id uuid,
  p_confidence       numeric,
  p_note             text DEFAULT NULL,
  p_ambiguous_with   uuid[] DEFAULT ARRAY[]::uuid[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_existing public.contract_measurement_rule_timeline_mappings%ROWTYPE;
  v_ambiguous uuid[] := COALESCE(p_ambiguous_with, ARRAY[]::uuid[]);
  v_id       uuid;
BEGIN
  IF p_confidence IS NULL OR p_confidence < 0 OR p_confidence > 1 THEN
    RAISE EXCEPTION 'Confiança da proposta deve estar entre 0 e 1.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- A etapa proposta jamais consta como sua própria concorrente: a tela
  -- listaria a alternativa "a mesma coisa" e o revisor leria isso como um
  -- empate que não existe.
  v_ambiguous := ARRAY(
    SELECT DISTINCT x FROM unnest(v_ambiguous) AS x WHERE x <> p_timeline_item_id);

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
         SET confidence     = p_confidence,
             note           = COALESCE(p_note, note),
             ambiguous_with = v_ambiguous,
             mapped_at      = now()
       WHERE id = v_existing.id;
    END IF;
    RETURN v_existing.id;
  END IF;

  INSERT INTO public.contract_measurement_rule_timeline_mappings
    (organization_id, contract_id, rule_id, project_id, timeline_item_id,
     mapping_source, confidence, review_state, note, ambiguous_with)
  VALUES (p_organization_id, p_contract_id, p_rule_id, p_project_id, p_timeline_item_id,
          'system_proposed', p_confidence, 'proposed', p_note, v_ambiguous)
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.contract_billing_propose_timeline_mapping(
  uuid, uuid, uuid, text, uuid, numeric, text, uuid[]) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.contract_billing_propose_timeline_mapping(
  uuid, uuid, uuid, text, uuid, numeric, text, uuid[]) IS
  'Único caminho de escrita da PROPOSTA automática de mapeamento marco↔etapa. '
  'Grava sempre system_proposed/proposed — nunca accepted, e sem parâmetro que '
  'permita pedir accepted. `p_ambiguous_with` registra o EMPATE que o matcher '
  'enxergou, para que a tela peça escolha em vez de oferecer aceite.';

-- ---------------------------------------------------------------------------
-- 3) A VISÃO — o cronograma perguntando a Contratos
-- ---------------------------------------------------------------------------
/*
  ─── O recorte ───────────────────────────────────────────────────────────

  Entra por `project_id`. Sai uma linha por (projeto, marco contratual) dos
  contratos GOVERNADAMENTE ligados àquele projeto (175) — nunca por semelhança
  de nome ou de código.

  ─── link_state, e por que ele tem quatro valores ────────────────────────

    ACCEPTED   ponte aceita por revisor humano. A data do cronograma alimenta
               a previsão de faturamento, e é ESTE estado — só ele — que
               autoriza a linha derivada EVENTO DE MEDIÇÃO na tela.
    PROPOSED   palpite do sistema aguardando revisão. Aparece como SUGESTÃO,
               e não alimenta previsão nenhuma.
    AMBIGUOUS  palpite com empate. Aparece pedindo ESCOLHA.
    UNMATCHED  sem palpite, ou com palpite já rejeitado. Aparece como SEM
               VÍNCULO NO CRONOGRAMA — que é uma resposta, e melhor que uma
               etapa inventada.

  Rejeitado cai em UNMATCHED de propósito: a decisão humana foi "esta etapa
  não é o marco", e o marco volta a não ter vínculo. Ressuscitá-lo como
  proposta seria discutir com o revisor.

  ─── RLS ─────────────────────────────────────────────────────────────────

  `security_invoker = true`. A visão não abre um milímetro: quem não passa na
  RLS de `contract_billing_month_plan` (que exige, na cadeia,
  `contracts.view`) não lê linha nenhuma aqui. Um gestor de projeto sem
  permissão de contrato não vê valores contratuais — ele simplesmente não vê
  a sobreposição, e a tela mostra o cronograma como sempre mostrou.

  ─── Desempenho ──────────────────────────────────────────────────────────

  Uma consulta por projeto, com as alternativas de empate resolvidas num
  LATERAL agregado. Nenhuma linha do Gantt dispara requisição própria.
*/
CREATE OR REPLACE VIEW public.project_schedule_contract_events
WITH (security_invoker = true) AS
WITH link AS (
  SELECT DISTINCT l.organization_id, l.project_id, l.contract_id
    FROM public.project_contract_link_governed l
),
rule AS (
  SELECT q.organization_id, q.contract_id, q.id AS rule_id, q.milestone_id
    FROM public.contract_measurement_requirements q
   WHERE q.effect <> 'removed'
     AND q.milestone_id IS NOT NULL
),
-- Um mapeamento por (organização, projeto, regra): o aceito vence a proposta,
-- que vence a rejeitada; entre iguais, a de maior confiança.
mapped AS (
  SELECT DISTINCT ON (m.organization_id, m.project_id, m.rule_id)
         m.organization_id, m.project_id, m.rule_id,
         m.id AS mapping_id, m.timeline_item_id AS mapped_timeline_item_id,
         m.review_state, m.mapping_source, m.confidence, m.note,
         m.ambiguous_with, m.mapped_at, m.reviewed_at
    FROM public.contract_measurement_rule_timeline_mappings m
   ORDER BY m.organization_id, m.project_id, m.rule_id,
            CASE m.review_state
              WHEN 'accepted' THEN 0 WHEN 'proposed' THEN 1 ELSE 2 END,
            m.confidence DESC NULLS LAST, m.mapped_at DESC
),
-- Um marco pode carregar mais de uma exigência de medição. A linha da tela é
-- por MARCO, então escolhemos a exigência que melhor explica o vínculo.
best AS (
  SELECT DISTINCT ON (r.organization_id, l.project_id, r.milestone_id)
         r.organization_id, l.project_id, r.contract_id, r.milestone_id, r.rule_id,
         d.mapping_id, d.mapped_timeline_item_id, d.review_state, d.mapping_source,
         d.confidence, d.note, d.ambiguous_with, d.mapped_at, d.reviewed_at
    FROM rule r
    JOIN link l
      ON l.organization_id = r.organization_id AND l.contract_id = r.contract_id
    LEFT JOIN mapped d
      ON d.organization_id = r.organization_id
     AND d.project_id = l.project_id
     AND d.rule_id = r.rule_id
   ORDER BY r.organization_id, l.project_id, r.milestone_id,
            CASE d.review_state
              WHEN 'accepted' THEN 0 WHEN 'proposed' THEN 1
              WHEN 'rejected' THEN 2 ELSE 3 END,
            d.confidence DESC NULLS LAST, r.rule_id
)
SELECT
  -- ── Identidade e recorte ────────────────────────────────────────────────
  b.organization_id,
  b.project_id,
  b.contract_id,
  b.milestone_id,
  b.rule_id,

  -- ── O ESTADO DO VÍNCULO ─────────────────────────────────────────────────
  CASE
    WHEN b.review_state = 'accepted' THEN 'ACCEPTED'
    WHEN b.review_state = 'proposed'
         AND COALESCE(array_length(b.ambiguous_with, 1), 0) > 0 THEN 'AMBIGUOUS'
    WHEN b.review_state = 'proposed' THEN 'PROPOSED'
    ELSE 'UNMATCHED'
  END                                        AS link_state,
  b.mapping_id,
  b.mapping_source,
  b.review_state,
  b.confidence                               AS mapping_confidence,
  b.note                                     AS mapping_note,
  b.mapped_at                                AS mapping_mapped_at,
  b.reviewed_at                              AS mapping_reviewed_at,

  /*
    A etapa CANDIDATA da proposta, em colunas PRÓPRIAS.

    Jamais misturada com `timeline_*`, que vêm da ponte aceita. Uma proposta
    ocupando a coluna da etapa governada é exatamente como um palpite passaria
    a alimentar a data prevista sem ninguém ter aceitado nada.
  */
  CASE WHEN b.review_state = 'proposed' THEN b.mapped_timeline_item_id END
                                             AS proposed_timeline_item_id,
  CASE WHEN b.review_state = 'proposed' THEN pt.title END
                                             AS proposed_timeline_title,
  CASE WHEN b.review_state = 'proposed' THEN pt.wbs_code END
                                             AS proposed_timeline_wbs_code,
  CASE WHEN b.review_state = 'proposed'
       THEN COALESCE(pt.forecast_finish, pt.planned_finish) END
                                             AS proposed_timeline_finish,
  COALESCE(amb.alternatives, '[]'::jsonb)    AS ambiguous_alternatives,

  -- ── O contrato, para o cabeçalho e o percentual ─────────────────────────
  c.total_value                              AS contract_total_value,
  CASE WHEN COALESCE(c.total_value, 0) > 0
       THEN round(COALESCE(p.planned_amount, 0) / c.total_value * 100, 2) END
                                             AS contract_percent,

  -- ── O PLANEJAMENTO, repassado sem reinterpretação ───────────────────────
  -- Todas as colunas abaixo vêm de `contract_billing_month_plan` e mantêm o
  -- nome de origem, para que a MESMA borda tipada as leia dos dois lados.
  p.contract_number, p.counterparty_name,
  p.title, p.description, p.status, p.milestone_due_date, p.completed_at,
  p.milestone_owner_user_id, p.contract_owner_user_id, p.timeline_responsible_user_id,
  p.planned_amount, p.planned_amount_basis, p.entitlement_amount, p.billing_amount,
  p.measured_amount, p.accepted_value, p.billing_eligible_amount, p.currency,
  p.planned_billing_date, p.planned_billing_date_basis, p.planned_billing_month,
  p.governed_mapping_count, p.timeline_item_id, p.timeline_title, p.timeline_wbs_code,
  p.timeline_status, p.timeline_planned_finish, p.timeline_forecast_finish,
  p.timeline_actual_finish, p.timeline_is_active, p.timeline_percent_complete,
  p.reprogramming_count, p.last_previous_planned_finish, p.last_new_planned_finish,
  p.last_reprogrammed_at,
  p.requirement_id, p.customer_acceptance_required, p.evidence_required,
  p.measurement_id, p.measurement_status, p.measurement_readiness,
  p.measurement_expected_at, p.measurement_accepted_at, p.measurement_evidence_count,
  p.evidence_document_id, p.evidence,
  p.billing_event_id, p.billing_eligibility_state, p.billing_release_state,
  p.billing_amount_source, p.billing_fiscal_document_status,
  p.billing_receivable_status, p.billing_finance_link_state,
  p.fiscal_document_number, p.fiscal_authorized_at, p.receivable_first_due_date,
  p.receivable_paid_amount_cents, p.receivable_open_amount_cents,
  p.receivable_last_payment_date, p.reconciled_settlement_count,
  p.payment_term_text

FROM best b
JOIN public.contract_billing_month_plan p
  ON p.organization_id = b.organization_id
 AND p.contract_id = b.contract_id
 AND p.milestone_id = b.milestone_id
LEFT JOIN public.contracts c
  ON c.organization_id = b.organization_id AND c.id = b.contract_id
LEFT JOIN public.project_timeline_items pt
  ON pt.organization_id = b.organization_id
 AND pt.id = b.mapped_timeline_item_id
LEFT JOIN LATERAL (
  SELECT jsonb_agg(jsonb_build_object(
           'id', t.id, 'title', t.title, 'wbsCode', t.wbs_code,
           'plannedFinish', COALESCE(t.forecast_finish, t.planned_finish))
         ORDER BY t.row_order) AS alternatives
    FROM public.project_timeline_items t
   WHERE t.organization_id = b.organization_id
     AND t.id = ANY (COALESCE(b.ambiguous_with, ARRAY[]::uuid[]))
) amb ON true;

COMMENT ON VIEW public.project_schedule_contract_events IS
  'Os EVENTOS DE MEDIÇÃO de um projeto: um marco contratual por linha, com '
  'link_state (ACCEPTED/PROPOSED/AMBIGUOUS/UNMATCHED) e o planejamento da 179 '
  'repassado sem reinterpretação. Só ACCEPTED autoriza a linha derivada no '
  'cronograma. Não deriva estágio (isso é de milestone-stage.ts), não cria '
  'faturamento e não escreve em project_timeline_items.';

GRANT SELECT ON public.project_schedule_contract_events TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.project_schedule_contract_events FROM authenticated;
REVOKE ALL ON public.project_schedule_contract_events FROM anon;

COMMIT;
