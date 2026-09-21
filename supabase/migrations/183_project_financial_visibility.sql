-- ============================================================================
-- 183 — UMA DECISÃO FINANCEIRA PARA O MÓDULO DE PROJETOS
--
-- ─── O erro da 182, nomeado ───────────────────────────────────────────────
--
-- A 182 colocou os valores do evento de medição atrás de
-- `contracts.view_values OR finance.view OR is_admin`. O predicado é bom — é
-- o da 006/007 — e está no MÓDULO ERRADO.
--
-- Dentro de Projetos, o mesmo usuário via:
--
--   cabeçalho do projeto ....... "Contrato Total (Receita) R$ 8.032.339,76"
--   aba Financeiro ............. aberta, com curva S e custos
--   evento de medição .......... "Restrito"
--
-- Três telas do mesmo projeto, três respostas para a mesma pergunta. E a
-- resposta mais restritiva estava justamente na tela que tinha o portão —
-- porque as outras duas NÃO TÊM NENHUM.
--
-- ─── O que a inspeção encontrou ───────────────────────────────────────────
--
-- Não existe, hoje, permissão de financeiro de projeto SENDO APLICADA. As
-- chaves existem no catálogo desde a 005 (`projects.view_costs`,
-- `projects.view_margin`, `finance.view_project_costs`) e estão distribuídas
-- entre os papéis — mas nenhum componente, rota ou visão as consulta. O
-- cabeçalho e a aba Financeiro são abertos para qualquer um que abra o
-- projeto.
--
-- Então a resposta a "reutilize a permissão canônica" é: ela está DECLARADA e
-- não estava LIGADA. Esta migration a liga, sem criar chave nova.
--
-- ─── A decisão, num lugar só ──────────────────────────────────────────────
--
-- `current_user_can_view_project_financials()` compõe as chaves que já
-- existem. É uma função — e não um predicado copiado em cada visão — porque a
-- pergunta vai ser feita pelo cabeçalho, pela aba Financeiro, pela previsão
-- contratual e pelo evento de medição. Copiada quatro vezes, ela divergiria na
-- primeira vez que alguém acrescentasse um papel.
--
-- ─── Por que `contracts.view_values` SAI deste predicado ──────────────────
--
-- Porque ele responde a outra pergunta. São três, e a 182 colapsava duas:
--
--   A. o marco contratual existe?      → `contracts.view`  (RLS das linhas)
--   B. quanto ele vale, em Contratos?  → `contracts.view_values`
--   C. posso ver dinheiro DESTE projeto? → esta função
--
-- A tela é o cronograma do PROJETO, então quem manda é (C). Consequência
-- concreta e deliberada: `juridico_contratos` tem `contracts.view_values` e
-- nenhuma permissão financeira de projeto — passa a ler o valor do marco em
-- Contratos e a vê-lo como "Restrito" dentro de Projetos. É coerente: aquela
-- pessoa tem acesso ao contrato, não ao financeiro do projeto.
--
-- ─── O que esta migration NÃO faz ─────────────────────────────────────────
--
--   · não cria permissão nova — só compõe chaves da 005;
--   · não concede nada a ninguém;
--   · não toca `contract_billing_month_plan` (módulo Contratos, ver 182);
--   · não muda RLS de linha: continua sendo a RLS que decide QUAIS eventos
--     existem; esta função decide quais COLUNAS têm conteúdo.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) A DECISÃO CANÔNICA
-- ---------------------------------------------------------------------------
/*
  SECURITY DEFINER pelo mesmo motivo de `current_user_has_permission` (014):
  ela lê `user_roles`, `role_permissions` e `user_permission_overrides`, que
  `authenticated` não lê diretamente. Não recebe parâmetro, não tem recorte de
  inquilino para errar — só responde sobre QUEM ESTÁ CHAMANDO.

  STABLE para que o planejador a avalie uma vez por consulta, e não uma vez
  por linha do cronograma.
*/
CREATE OR REPLACE FUNCTION public.current_user_can_view_project_financials()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.current_user_is_admin()
      OR public.current_user_has_permission('finance.view_project_costs')
      OR public.current_user_has_permission('projects.view_costs')
      OR public.current_user_has_permission('projects.view_margin')
      OR public.current_user_has_permission('finance.view')
$$;

REVOKE ALL ON FUNCTION public.current_user_can_view_project_financials() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_can_view_project_financials() TO authenticated;

COMMENT ON FUNCTION public.current_user_can_view_project_financials() IS
  'A decisão CANÔNICA de visibilidade financeira dentro do módulo de '
  'Projetos: cabeçalho, aba Financeiro, previsão contratual e valores do '
  'evento de medição respondem todos por aqui. Compõe chaves já existentes da '
  '005 — não cria permissão nova. Distinta de contracts.view_values, que '
  'responde pelo valor dentro do módulo de Contratos.';

-- ---------------------------------------------------------------------------
-- 2) O EVENTO DE MEDIÇÃO passa a perguntar a ela
-- ---------------------------------------------------------------------------
/*
  Só o CTE `gate` muda. O resto da visão é o da 182, linha por linha: a RLS
  continua `security_invoker`, as colunas mascaradas continuam as mesmas, e
  `can_view_values` / `generates_billing` continuam no mesmo lugar.
*/
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
  'quais linhas existem (inquilino + acesso ao contrato) e '
  'current_user_can_view_project_financials() decide quais colunas têm '
  'conteúdo — a MESMA decisão do cabeçalho e da aba Financeiro do projeto. '
  'Quem não passa continua vendo marco, data, estágio e generates_billing, '
  'com can_view_values = false indicando RESTRITO, não "não apurado".';

GRANT SELECT ON public.project_schedule_contract_events TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.project_schedule_contract_events FROM authenticated;
REVOKE ALL ON public.project_schedule_contract_events FROM anon;

COMMIT;
