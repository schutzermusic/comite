-- ============================================================================
-- 184 — O MESMO PORTÃO NO CABEÇALHO DO PROJETO
--
-- ─── A porta que a 183 deixou aberta ──────────────────────────────────────
--
-- A 183 fez o EVENTO DE MEDIÇÃO perguntar a
-- `current_user_can_view_project_financials()`. Mas o KPI "Contrato Total
-- (Receita)" do cabeçalho do projeto lê outra visão —
-- `project_contract_financial_read_model` (175) — que entrega
-- `contract_value` a qualquer um com `contracts.view`.
--
-- Esconder o KPI no React e deixar a visão respondendo não é esconder nada:
-- `GET /rest/v1/project_contract_financial_read_model?project_id=eq.…`
-- devolve os R$ 8.032.339,76 do mesmo jeito. Mascarar na tela e servir na API
-- é o padrão que a §13 chama pelo nome.
--
-- ─── O que entra no portão, e o que não entra ─────────────────────────────
--
-- ENTRA (é dinheiro deste projeto):
--   contract_value, entitlement_total, measured_total, accepted_total,
--   reconciliation_delta, currency
--
-- NÃO ENTRA (é estrutura, e o cronograma precisa dela):
--   número e título do contrato, contraparte, vigência, contagem de marcos,
--   quantos marcos têm cronograma governado, quantos viraram evento de
--   faturamento
--
-- A contagem de eventos faturados fica fora de propósito: "3 dos 6 marcos já
-- viraram faturamento" é andamento de projeto. Quanto valem é outra pergunta.
--
-- ─── Coerência com a 183 ──────────────────────────────────────────────────
--
-- Mesma função, mesma coluna `can_view_values`, mesma regra de leitura:
-- NULL com `can_view_values = false` é RESTRITO; NULL com `true` é NÃO
-- APURADO. Nenhuma permissão nova, nada concedido, RLS de linha intocada.
-- ============================================================================

BEGIN;

/*
  ─── A ORDEM DAS COLUNAS É PARTE DO CONTRATO ──────────────────────────────

  `CREATE OR REPLACE VIEW` recusa reordenar ou renomear coluna existente. A
  ordem abaixo é EXATAMENTE a da 175, com as máscaras aplicadas no lugar de
  cada coluna monetária e `can_view_values` acrescentada no fim — o único
  ponto onde a substituição aceita crescer.

  Trocar por DROP + CREATE resolveria a ordenação e quebraria qualquer objeto
  que dependa desta visão, sem aviso e no meio de uma migration.
*/
CREATE OR REPLACE VIEW public.project_contract_financial_read_model
WITH (security_invoker = true) AS
WITH gate AS (
  SELECT public.current_user_can_view_project_financials() AS can_view_values
)
SELECT
  lk.organization_id,
  lk.project_id,
  lk.contract_id,
  lk.link_source,
  lk.linked_at,

  -- ── Identidade do instrumento — estrutura, não valor ───────────────────
  c.contract_number,
  c.title              AS contract_title,
  c.status             AS contract_status,
  c.counterparty_name,

  -- Moeda acompanha o valor: "BRL" sozinho só serviria para sugerir que há um
  -- número ali que a tela deixou de mostrar por engano.
  CASE WHEN g.can_view_values THEN c.currency END     AS currency,

  c.start_date,
  c.end_date,
  c.signed_date,

  -- ── VALORES — atrás do portão ──────────────────────────────────────────
  -- O CAST preserva o tipo exato da 175 (numeric(14,2)). Sem ele, o CASE
  -- promove para `numeric` sem precisão e CREATE OR REPLACE recusa a troca.
  CASE WHEN g.can_view_values THEN c.total_value END::numeric(14,2) AS contract_value,
  CASE WHEN g.can_view_values THEN agg.entitlement_total END AS entitlement_total,

  -- Contagem de regras é estrutura: diz se o contrato foi instrumentado.
  agg.entitlement_rule_count,
  agg.milestone_count,

  -- A DIVERGÊNCIA DOCUMENTAL continua preservada para quem vê valor. Em
  -- JA10182283/2025 ela é +0,01, e some no instante em que alguém arredondar.
  CASE WHEN g.can_view_values
       THEN (CASE WHEN c.total_value IS NULL OR agg.entitlement_total IS NULL THEN NULL
                  ELSE agg.entitlement_total - c.total_value END) END AS reconciliation_delta,

  CASE WHEN g.can_view_values THEN agg.measured_total END AS measured_total,
  CASE WHEN g.can_view_values THEN agg.accepted_total END AS accepted_total,

  -- ── Contagens — andamento do projeto, sempre visível ───────────────────
  agg.billed_event_count,
  agg.governed_mapped_milestone_count,

  -- Acrescentada no fim: é o único lugar onde CREATE OR REPLACE aceita
  -- coluna nova.
  g.can_view_values

FROM public.project_contract_link_governed lk
CROSS JOIN gate g
JOIN public.contracts c
  ON c.id = lk.contract_id
 AND c.organization_id = lk.organization_id
 AND c.deleted_at IS NULL

LEFT JOIN LATERAL (
  SELECT
    count(*)::int                                            AS milestone_count,
    sum(w.entitlement_amount)                                AS entitlement_total,
    sum(COALESCE(w.entitlement_rule_count, 0))::int          AS entitlement_rule_count,
    sum(w.measured_amount)                                   AS measured_total,
    sum(w.measurement_accepted_value)                        AS accepted_total,
    count(*) FILTER (WHERE w.billing_event_id IS NOT NULL)::int AS billed_event_count,
    count(*) FILTER (WHERE COALESCE(w.governed_mapping_count, 0) > 0
                       AND w.timeline_item_id IS NOT NULL)::int AS governed_mapped_milestone_count
    FROM public.contract_milestone_workbench w
   WHERE w.organization_id = lk.organization_id
     AND w.contract_id = lk.contract_id
     AND w.status <> 'cancelled'
) agg ON true;

COMMENT ON VIEW public.project_contract_financial_read_model IS
  'O contrato visto do projeto. Valores atrás de '
  'current_user_can_view_project_financials() — a MESMA decisão do cabeçalho, '
  'da aba Financeiro e do evento de medição. Estrutura (número, contraparte, '
  'vigência, contagens) permanece visível a quem lê o contrato. '
  'can_view_values distingue RESTRITO de NÃO APURADO. A divergência '
  'documental de JA10182283/2025 (+0,01) continua preservada para quem vê.';

GRANT SELECT ON public.project_contract_financial_read_model TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.project_contract_financial_read_model FROM authenticated;
REVOKE ALL ON public.project_contract_financial_read_model FROM anon;

COMMIT;
