-- ============================================================================
-- 182 — EVENTO DE MEDIÇÃO: VISIBILIDADE OPERACIONAL ≠ VISIBILIDADE FINANCEIRA
--
-- ─── O problema que a 181 deixou em pé ────────────────────────────────────
--
-- A 181 resolveu a fronteira do INQUILINO e esqueceu a fronteira do VALOR.
-- `project_schedule_contract_events` é `security_invoker`, então quem não lê
-- a cadeia de Contratos não lê linha nenhuma — correto. Só que a cadeia de
-- Contratos pede `contracts.view`, e o papel `gestor_projetos` TEM
-- `contracts.view`. Resultado prático: o gerente de projeto via
-- R$ 1.606.467,95 ao lado da atividade 1.1.2.
--
-- E o modelo de autorização desta base já separava as duas coisas desde a
-- 005: `contracts.view` é "pode saber que o contrato existe";
-- `contracts.view_values` é "pode ver quanto vale". A 181 tratava as duas
-- como uma só.
--
-- ─── As duas perguntas, e quem pode fazer cada uma ────────────────────────
--
--   OPERACIONAL   "esta atividade é um evento de medição contratual?
--                  qual marco? que data? gera faturamento? o vínculo
--                  precisa de revisão?"
--                 → `contracts.view` (o que o gestor de projetos já tem)
--
--   FINANCEIRA    "quanto vale? que percentual do contrato? já foi
--                  faturado, emitido, recebido?"
--                 → `contracts.view_values` OR `finance.view` OR admin
--                   — exatamente o predicado que a 006/007 já usa em
--                     `contract_billing_events`. Nenhum critério novo.
--
-- ─── Por que UMA visão com máscara, e não duas visões ─────────────────────
--
-- Duas visões `security_invoker` não podem ser empilhadas: a de fora resolve
-- os privilégios da de dentro contra o MESMO usuário, então uma "visão base
-- sem portão" teria de ser legível por todos para servir à visão com portão —
-- e aí o portão não existiria. Empilhar exigiria SECURITY DEFINER, isto é,
-- suspender a RLS e reescrever o recorte de inquilino à mão.
--
-- A alternativa seria duplicar as ~180 linhas do SELECT em duas visões, com a
-- garantia de que elas divergiriam na primeira manutenção — que é a mesma
-- razão pela qual a data prevista vive numa expressão só.
--
-- Então: UMA visão, `security_invoker` como antes, e o portão de VALOR
-- aplicado COLUNA A COLUNA. A RLS continua decidindo quais LINHAS existem; o
-- portão decide quais COLUNAS têm conteúdo. Nada é afrouxado: quem via valor
-- sem `contracts.view_values` deixa de ver.
--
-- ─── Como a tela distingue RESTRITO de NÃO APURADO ────────────────────────
--
-- `can_view_values` viaja na linha. Sem ele, um `planned_amount` nulo por
-- falta de permissão seria lido como "não apurado" — e "o sistema não sabe o
-- valor" é uma afirmação muito diferente de "você não pode vê-lo".
--
-- `generates_billing` é calculado ANTES da máscara. É a relevância de
-- faturamento sem o número: o gestor de projeto precisa saber que aquela
-- atividade destrava uma parcela, e não precisa saber de quanto ela é.
--
-- ─── O que esta migration NÃO faz ─────────────────────────────────────────
--
--   · não cria função SECURITY DEFINER, não suspende RLS, não toca recorte
--     de organização;
--   · não concede nada a ninguém — só retira;
--   · não altera `contract_billing_month_plan` (ver nota ao final).
-- ============================================================================

BEGIN;

DROP VIEW IF EXISTS public.project_schedule_contract_events;

CREATE VIEW public.project_schedule_contract_events
WITH (security_invoker = true) AS
WITH gate AS (
  /*
    O PORTÃO DE VALOR, avaliado uma vez por consulta.

    Mesmo predicado de `contract_billing_events_select_scoped` (006/007). Ele
    mora num CTE — e não repetido em trinta CASEs — para que não exista a
    possibilidade de uma coluna ficar com um critério ligeiramente diferente
    das outras vinte e nove.
  */
  SELECT (
    public.current_user_has_permission('contracts.view_values')
    OR public.current_user_has_permission('finance.view')
    OR public.current_user_is_admin()
  ) AS can_view_values
),
link AS (
  SELECT DISTINCT l.organization_id, l.project_id, l.contract_id
    FROM public.project_contract_link_governed l
),
rule AS (
  SELECT q.organization_id, q.contract_id, q.id AS rule_id, q.milestone_id
    FROM public.contract_measurement_requirements q
   WHERE q.effect <> 'removed'
     AND q.milestone_id IS NOT NULL
),
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

  -- ── O ESTADO DO VÍNCULO — operacional, sempre visível ───────────────────
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

  -- ── O PORTÃO, e a relevância que sobrevive a ele ────────────────────────
  g.can_view_values,
  /*
    RELEVÂNCIA DE FATURAMENTO sem o número.

    Calculada antes da máscara, sobre o valor previsto do marco. Responde
    "esta atividade destrava uma parcela?" — que é uma pergunta de execução de
    projeto, não de finanças. O quanto fica do outro lado do portão.
  */
  (COALESCE(p.planned_amount, 0) > 0)        AS generates_billing,

  -- ── VALORES — atrás do portão ───────────────────────────────────────────
  CASE WHEN g.can_view_values THEN c.total_value END      AS contract_total_value,
  CASE WHEN g.can_view_values AND COALESCE(c.total_value, 0) > 0
       THEN round(COALESCE(p.planned_amount, 0) / c.total_value * 100, 2) END
                                                          AS contract_percent,
  CASE WHEN g.can_view_values THEN p.planned_amount END    AS planned_amount,
  CASE WHEN g.can_view_values THEN p.planned_amount_basis END AS planned_amount_basis,
  CASE WHEN g.can_view_values THEN p.entitlement_amount END AS entitlement_amount,
  CASE WHEN g.can_view_values THEN p.billing_amount END     AS billing_amount,
  CASE WHEN g.can_view_values THEN p.measured_amount END    AS measured_amount,
  CASE WHEN g.can_view_values THEN p.accepted_value END     AS accepted_value,
  CASE WHEN g.can_view_values THEN p.billing_eligible_amount END AS billing_eligible_amount,
  -- Moeda também: "BRL" ao lado de um valor mascarado só serviria para
  -- sugerir que há um número ali que a tela decidiu não mostrar por engano.
  CASE WHEN g.can_view_values THEN p.currency END           AS currency,

  -- ── OPERACIONAL — o que o cronograma precisa saber ──────────────────────
  p.contract_number, p.counterparty_name,
  p.title, p.description, p.status, p.milestone_due_date, p.completed_at,
  p.milestone_owner_user_id, p.contract_owner_user_id, p.timeline_responsible_user_id,

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

  /*
    `billing_event_id` fica do lado OPERACIONAL, e é a única coisa de
    faturamento que atravessa o portão.

    Ele não é um valor: é a existência do evento. E `milestone-stage.ts` o lê
    para chegar em BILLED — sem ele, o estágio derivado para quem não vê valor
    divergiria do estágio derivado para quem vê, sobre o mesmo marco. Duas
    respostas para a mesma pergunta é pior que uma resposta incompleta.
  */
  p.billing_event_id,

  -- ── FATURAMENTO E CAIXA — atrás do portão ───────────────────────────────
  CASE WHEN g.can_view_values THEN p.billing_eligibility_state END AS billing_eligibility_state,
  CASE WHEN g.can_view_values THEN p.billing_release_state END     AS billing_release_state,
  CASE WHEN g.can_view_values THEN p.billing_amount_source END     AS billing_amount_source,
  CASE WHEN g.can_view_values THEN p.billing_fiscal_document_status END AS billing_fiscal_document_status,
  CASE WHEN g.can_view_values THEN p.billing_receivable_status END  AS billing_receivable_status,
  CASE WHEN g.can_view_values THEN p.billing_finance_link_state END AS billing_finance_link_state,
  CASE WHEN g.can_view_values THEN p.fiscal_document_number END     AS fiscal_document_number,
  CASE WHEN g.can_view_values THEN p.fiscal_authorized_at END       AS fiscal_authorized_at,
  CASE WHEN g.can_view_values THEN p.receivable_first_due_date END  AS receivable_first_due_date,
  CASE WHEN g.can_view_values THEN p.receivable_paid_amount_cents END AS receivable_paid_amount_cents,
  CASE WHEN g.can_view_values THEN p.receivable_open_amount_cents END AS receivable_open_amount_cents,
  CASE WHEN g.can_view_values THEN p.receivable_last_payment_date END AS receivable_last_payment_date,
  CASE WHEN g.can_view_values THEN p.reconciled_settlement_count END  AS reconciled_settlement_count,
  CASE WHEN g.can_view_values THEN p.payment_term_text END            AS payment_term_text

FROM best b
CROSS JOIN gate g
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
  'Os EVENTOS DE MEDIÇÃO de um projeto, com DUAS fronteiras: a RLS decide '
  'quais linhas existem (inquilino + contracts.view) e o portão de valor '
  'decide quais colunas têm conteúdo (contracts.view_values / finance.view / '
  'admin). Quem não passa no portão continua vendo marco, data, estágio e '
  'generates_billing — e recebe NULL em toda quantia, com can_view_values '
  'dizendo que é RESTRITO e não "não apurado".';

GRANT SELECT ON public.project_schedule_contract_events TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.project_schedule_contract_events FROM authenticated;
REVOKE ALL ON public.project_schedule_contract_events FROM anon;

/*
  ─── NOTA DE FRONTEIRA, deixada de propósito ──────────────────────────────

  `contract_billing_month_plan` (179) continua entregando quantia a quem tem
  apenas `contracts.view`. Ela é a visão da carteira de CONTRATOS, consumida
  pela aba Faturamentos, e fechá-la aqui mudaria aquele módulo para papéis que
  hoje leem valores por lá — uma decisão de produto que não cabe a uma
  migration do cronograma tomar em silêncio.

  Esta migration fecha o caminho que ELA abriu, em Projetos. O outro caminho
  fica registrado aqui, nomeado, para ser decidido.
*/

COMMIT;
