-- ============================================================
-- 171 — BANCADA DO MARCO CONTRATUAL (somente leitura)
--
-- ─── O que esta migration É ────────────────────────────────────────────────
--
-- Uma VISÃO. Nenhuma tabela nasce aqui, nenhuma coluna é acrescentada, nenhum
-- gatilho é criado e nenhuma linha é escrita. A aba `Medição & Faturamento`
-- precisava, por marco, de sete fatos que hoje moram em sete lugares; buscá-los
-- com sete consultas do navegador produziria sete instantes diferentes do mesmo
-- contrato — e foi assim que, neste repositório, duas telas já discordaram
-- sobre quanto havia sido medido.
--
-- ─── Por que uma VISÃO, e não uma tabela ───────────────────────────────────
--
-- Uma tabela de apoio seria uma SEGUNDA verdade de faturamento: precisaria de
-- escrita, de sincronização e de alguém para culpar quando divergisse. A visão
-- não pode divergir — ela não guarda nada. `security_invoker = true` faz cada
-- linha passar pela RLS das tabelas de origem, então a bancada não concede
-- nem um byte a mais do que o leitor já podia ler.
--
-- ─── O que ela recusa compor ───────────────────────────────────────────────
--
--   · MAPEAMENTO PROPOSTO. O JOIN é com `contract_measurement_rule_timeline_
--     governed`, que já filtra `review_state = 'accepted'`. Uma sugestão de
--     sistema não aparece como etapa mapeada, e nenhum consumidor precisa
--     lembrar do filtro (§17).
--
--   · COALESCÊNCIA DE VALOR. `entitlement_amount`, `measured_amount` e
--     `accepted_value` saem em TRÊS colunas distintas. Um `COALESCE` entre elas
--     aqui apresentaria previsão contratual como apuração — exatamente o
--     defeito que a Fase 6 corrigiu em `resolveMeasuredAmount`.
--
--   · ESTADO DERIVADO. A visão não decide se um marco está "pronto para medir".
--     Ela entrega os fatos; a derivação mora em `milestone-stage.ts`, onde é
--     testável sem banco. Regra de negócio em `CASE WHEN` de visão é regra que
--     ninguém consegue testar nem encontrar depois.
--
-- ─── Cardinalidade ─────────────────────────────────────────────────────────
--
-- Exatamente UMA linha por marco. Todo vínculo de multiplicidade desconhecida
-- entra por LATERAL com `LIMIT 1` mais uma contagem ao lado, porque um JOIN
-- direto multiplicaria o marco por mapeamento e a soma da tela passaria a
-- contar o mesmo direito duas vezes.
-- ============================================================
BEGIN;

CREATE OR REPLACE VIEW public.contract_milestone_workbench
WITH (security_invoker = true) AS
SELECT
  -- ── O MARCO ────────────────────────────────────────────────────────────
  m.id,
  m.organization_id,
  m.contract_id,
  m.project_id,
  m.title,
  m.description,
  m.milestone_type,
  m.status,
  m.due_date,
  m.completed_at,
  m.billing_amount,
  m.measured_amount,
  m.owner_user_id,
  m.evidence,
  m.evidence_document_id,
  m.created_at,
  m.updated_at,

  -- ── DIREITO CONTRATUAL — o que o contrato promete ──────────────────────
  -- Fonte única de FIXED_CONTRACT_ENTITLEMENT (migration 136). Separado do
  -- previsto (`billing_amount`) e do apurado (`measured_amount`) de propósito.
  ent.fixed_amount          AS entitlement_amount,
  ent.currency              AS entitlement_currency,
  ent.source_document_id    AS entitlement_source_document_id,
  ent.source_page           AS entitlement_source_page,
  ent.source_reference      AS entitlement_source_reference,
  ent.rule_count            AS entitlement_rule_count,

  -- ── EXIGÊNCIA DE MEDIÇÃO — o que precisa acontecer ─────────────────────
  req.requirement_id,
  req.requirement_count,
  req.customer_acceptance_required,
  req.evidence_required,
  req.required_document_type,
  req.report_required,
  req.technical_report_required,

  -- ── CRONOGRAMA — QUANDO o gatilho acontece (autoridade: Projetos) ───────
  -- Só mapeamento GOVERNADO. `governed_mapping_count = 0` com exigência
  -- presente é a afirmação "a ponte não foi construída", e não "não sei".
  map.governed_mapping_count,
  map.timeline_item_id,
  map.timeline_project_id,
  map.mapping_source,
  map.mapped_at,
  tl.title                  AS timeline_title,
  tl.wbs_code               AS timeline_wbs_code,
  tl.status                 AS timeline_status,
  tl.percent_complete       AS timeline_percent_complete,
  tl.planned_finish         AS timeline_planned_finish,
  tl.actual_finish          AS timeline_actual_finish,
  tl.is_milestone           AS timeline_is_milestone,

  -- ── MEDIÇÃO OPERACIONAL — o que a execução apurou (autoridade: Projetos) ─
  pm.id                     AS measurement_id,
  pm.status                 AS measurement_status,
  pm.readiness_overall      AS measurement_readiness,
  pm.readiness_reasons      AS measurement_readiness_reasons,
  pm.expected_at            AS measurement_expected_at,
  pm.submitted_at           AS measurement_submitted_at,
  pm.accepted_at            AS measurement_accepted_at,
  pm.accepted_value         AS measurement_accepted_value,
  pm.accepted_currency      AS measurement_accepted_currency,
  pm.evidence_count         AS measurement_evidence_count,
  pm.missing_requirement_count AS measurement_missing_requirement_count,
  pm.live_count             AS measurement_live_count,

  -- ── FATURAMENTO — a jusante (autoridade: Contratos/Fiscal/Finanças) ────
  -- Só a EXISTÊNCIA e o estado. A bancada não libera, não emite e não concilia.
  bill.billing_event_id,
  bill.eligibility_state    AS billing_eligibility_state,
  bill.release_state        AS billing_release_state,
  bill.eligible_amount      AS billing_eligible_amount,
  bill.currency             AS billing_currency,
  bill.amount_source        AS billing_amount_source,
  bill.fiscal_document_status AS billing_fiscal_document_status,
  bill.receivable_status    AS billing_receivable_status,
  bill.finance_link_state   AS billing_finance_link_state

FROM public.contract_milestones m

-- Direito contratual ativo do marco.
LEFT JOIN LATERAL (
  SELECT r.fixed_amount, r.currency, r.source_document_id, r.source_page,
         r.source_reference,
         count(*) OVER () ::int AS rule_count
    FROM public.contract_billing_entitlement_rules r
   WHERE r.organization_id = m.organization_id
     AND r.milestone_id = m.id
     AND r.active
   ORDER BY r.created_at DESC
   LIMIT 1
) ent ON true

-- Exigência de medição do marco.
LEFT JOIN LATERAL (
  SELECT q.id AS requirement_id,
         q.customer_acceptance_required, q.evidence_required,
         q.required_document_type, q.report_required, q.technical_report_required,
         count(*) OVER () ::int AS requirement_count
    FROM public.contract_measurement_requirements q
   WHERE q.organization_id = m.organization_id
     AND q.contract_id = m.contract_id
     AND q.milestone_id = m.id
     AND q.effect <> 'removed'
   ORDER BY q.created_at DESC
   LIMIT 1
) req ON true

-- Etapa de cronograma, SOMENTE por mapeamento aceito por revisor humano.
LEFT JOIN LATERAL (
  SELECT g.timeline_item_id, g.project_id AS timeline_project_id,
         g.mapping_source, g.mapped_at,
         count(*) OVER () ::int AS governed_mapping_count
    FROM public.contract_measurement_rule_timeline_governed g
   WHERE g.organization_id = m.organization_id
     AND g.contract_id = m.contract_id
     AND req.requirement_id IS NOT NULL
     AND g.rule_id = req.requirement_id
   ORDER BY g.mapped_at DESC
   LIMIT 1
) map ON true

LEFT JOIN public.project_timeline_items tl
       ON tl.organization_id = m.organization_id
      AND tl.id = map.timeline_item_id
      AND tl.is_active
      AND tl.deleted_at IS NULL

-- Medição viva. Aceita primeiro; entre iguais, a revisão mais alta.
LEFT JOIN LATERAL (
  SELECT p.id, p.status, p.readiness_overall, p.readiness_reasons,
         p.expected_at, p.submitted_at, p.accepted_at,
         p.accepted_value, p.accepted_currency,
         p.evidence_count, p.missing_requirement_count,
         count(*) OVER () ::int AS live_count
    FROM public.project_measurement_read_model p
   WHERE p.organization_id = m.organization_id
     AND p.contract_id = m.contract_id
     AND p.status NOT IN ('SUPERSEDED', 'CANCELLED')
     AND (p.milestone_id = m.id
          OR (req.requirement_id IS NOT NULL
              AND p.contract_measurement_rule_id = req.requirement_id))
   ORDER BY (p.status = 'ACCEPTED') DESC, p.revision DESC, p.created_at DESC
   LIMIT 1
) pm ON true

-- Evento de faturamento vivo do marco. Superado é história, não trabalho.
LEFT JOIN LATERAL (
  SELECT c.billing_event_id, c.eligibility_state, c.release_state,
         c.eligible_amount, c.currency, c.amount_source,
         c.fiscal_document_status, c.receivable_status, c.finance_link_state
    FROM public.contract_to_cash_read_model c
   WHERE c.organization_id = m.organization_id
     AND c.contract_id = m.contract_id
     AND c.milestone_id = m.id
     AND c.superseded_by_id IS NULL
   ORDER BY c.created_at DESC
   LIMIT 1
) bill ON true;

COMMENT ON VIEW public.contract_milestone_workbench IS
  'Bancada do marco contratual: os fatos de direito, exigência, cronograma, '
  'medição e faturamento em UMA linha por marco, sem persistência nova. '
  'Mapeamento entra somente pela visão governada (proposta não aparece). '
  'entitlement_amount, measured_amount e accepted_value NUNCA são coalescidos: '
  'previsto, apurado e aceito são três verdades distintas. A derivação de '
  'estágio NÃO mora aqui — mora em milestone-stage.ts, onde é testável.';

GRANT SELECT ON public.contract_milestone_workbench TO authenticated;
REVOKE ALL ON public.contract_milestone_workbench FROM anon;

COMMIT;
