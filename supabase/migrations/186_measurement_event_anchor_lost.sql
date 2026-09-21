-- ============================================================================
-- 186 — QUANDO A ÂNCORA SOME DO CRONOGRAMA
--
-- ─── O silêncio que esta migration quebra ─────────────────────────────────
--
-- A importação de cronograma nunca apaga: ela DESATIVA a etapa que sumiu do
-- arquivo novo (`is_active = false`). O mapeamento aceito continua lá,
-- apontando para uma linha que não existe mais na tela.
--
-- O resultado, até aqui, era o pior tipo de erro: a visão continuava dizendo
-- `ACCEPTED`, o cabeçalho continuava contando o marco como "vinculado", e a
-- data prevista de faturamento caía em silêncio para o prazo do marco —
-- porque a 179 exige `timeline_is_active` para usar a data do cronograma.
--
-- Ou seja: a tela afirmava "Sincronizado com cronograma" sobre um marco cuja
-- âncora tinha evaporado, e o número que sustentava a previsão mudava sem que
-- ninguém fosse avisado.
--
-- ─── O que esta migration faz ─────────────────────────────────────────────
--
-- Acrescenta um quinto estado de vínculo: `ANCHOR_LOST`.
--
--   ACCEPTED     ponte aceita, etapa VIVA — sincroniza sozinha
--   ANCHOR_LOST  ponte aceita, etapa desativada ou removida do cronograma
--   AMBIGUOUS / PROPOSED / UNMATCHED  como antes
--
-- ─── Por que NÃO adivinhar a substituta ───────────────────────────────────
--
-- Seria fácil: procurar uma etapa nova com o mesmo `original_ms_project_id`
-- ou título parecido e repontar o mapeamento sozinho. E seria errado.
--
-- Um humano aceitou aquele par olhando para AQUELA etapa. Repontar por
-- semelhança transformaria a decisão dele numa decisão do sistema, com o
-- carimbo de revisor dele — e a próxima reprogramação moveria R$ 1.606.467,95
-- de mês baseada num palpite que ninguém revisou.
--
-- Quando o identificador estável reaparece, a reimportação reencontra a MESMA
-- linha e o mapeamento nunca chega a ficar órfão (é o que `matchRows` já faz,
-- pelo `original_ms_project_id`). Quando não reaparece, a etapa realmente
-- saiu do cronograma — e isso é uma pergunta para quem planeja, não um
-- problema de casamento de texto.
--
-- ─── O que esta migration NÃO faz ─────────────────────────────────────────
--
--   · não apaga, não desativa e não cria linha de cronograma;
--   · não altera nenhum mapeamento — só LÊ o estado da etapa;
--   · não rebaixa a decisão humana: o mapeamento segue `accepted` na tabela,
--     com revisor e data intactos. `ANCHOR_LOST` é leitura, não escrita.
-- ============================================================================

BEGIN;

CREATE OR REPLACE VIEW public.project_schedule_contract_events
WITH (security_invoker = true) AS
WITH gate AS (
  SELECT public.current_user_can_view_project_financials() AS can_view_values
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
  b.organization_id,
  b.project_id,
  b.contract_id,
  b.milestone_id,
  b.rule_id,

  /*
    O ESTADO DO VÍNCULO.

    `ANCHOR_LOST` vem ANTES de `ACCEPTED` no CASE de propósito: um aceite cuja
    etapa morreu não é um aceite vigente, e a ordem do CASE é a única coisa
    que impede a tela de continuar dizendo "Sincronizado" sobre ele.
  */
  CASE
    WHEN b.review_state = 'accepted'
         AND (pt.id IS NULL OR pt.is_active IS NOT TRUE OR pt.deleted_at IS NOT NULL)
      THEN 'ANCHOR_LOST'
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

  g.can_view_values,
  (COALESCE(p.planned_amount, 0) > 0)        AS generates_billing,

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
  CASE WHEN g.can_view_values THEN p.currency END           AS currency,

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

  p.billing_event_id,

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
  CASE WHEN g.can_view_values THEN p.payment_term_text END            AS payment_term_text,

  -- A etapa que o mapeamento aponta, VIVA ou NÃO. É o que permite à tela
  -- dizer "a atividade X saiu do cronograma" em vez de só "requer atenção".
  b.mapped_timeline_item_id                  AS mapped_timeline_item_id,
  pt.title                                   AS mapped_timeline_title,
  pt.wbs_code                                AS mapped_timeline_wbs_code,
  COALESCE(pt.is_active, false)              AS mapped_timeline_is_active

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
  'Os EVENTOS DE MEDIÇÃO de um projeto. link_state: ACCEPTED (ponte aceita e '
  'etapa viva), ANCHOR_LOST (ponte aceita e etapa saiu do cronograma — exige '
  'remapeamento humano, nunca substituição automática), AMBIGUOUS, PROPOSED, '
  'UNMATCHED. Valores atrás de current_user_can_view_project_financials(). '
  'A visão não escreve nada: nenhuma atividade de cronograma nasce daqui.';

GRANT SELECT ON public.project_schedule_contract_events TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.project_schedule_contract_events FROM authenticated;
REVOKE ALL ON public.project_schedule_contract_events FROM anon;

COMMIT;
