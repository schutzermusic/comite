-- ============================================================
-- 175 — O CONTRATO VISTO DE DENTRO DO PROJETO
--
-- ─── O problema, dito sem rodeio ──────────────────────────────────────────
--
-- O contrato JA10182283/2025 tem valor, seis eventos de faturamento, direito
-- por evento, exigência de medição e exigência de aceite. O projeto vinculado
-- — 2774.08/2025 — não mostra nada disso. Quem abre o projeto para saber
-- quanto ainda há a faturar precisa sair dele, achar o contrato e somar à mão.
--
-- ─── Por que VISÃO, e não coluna copiada no projeto ───────────────────────
--
-- A tentação óbvia é gravar `valor_contrato` no JSONB do projeto e sincronizar.
-- Isso criaria uma SEGUNDA verdade contratual, editável pela tela de projetos,
-- que divergiria no primeiro aditivo — e obrigaria um botão "Sincronizar", que
-- é a confissão de que as duas cópias já discordam.
--
-- Uma visão não pode divergir porque não guarda nada. Ela recalcula a cada
-- SELECT, e é por isso que estas três satisfazem "atualização automática"
-- sem uma linha de código de sincronização: mudou o vínculo, mudou o valor,
-- entrou aditivo efetivo, mudou o marco, mudou o direito, mudou a
-- operacionalização — a próxima leitura já vê. Não há janela de defasagem
-- porque não há cópia.
--
-- ─── As três visões ───────────────────────────────────────────────────────
--
--   1. project_contract_link_governed     — QUAL contrato pertence ao projeto
--   2. project_contract_financial_read_model — o DINHEIRO, por projeto×contrato
--   3. project_contract_milestone_read_model — os MARCOS, um por linha
--
-- ─── O que estas visões recusam fazer ────────────────────────────────────
--
--   · Não coalescem o R$ 0,01. O cabeçalho do instrumento diz 8.032.339,76 e a
--     soma dos direitos diz 8.032.339,77. A divergência é DOCUMENTAL — está no
--     PDF assinado — e a visão a expõe em `reconciliation_delta` em vez de
--     escolher um dos dois números. Arredondar aqui apagaria a única evidência
--     de que o contrato tem um centavo a mais distribuído do que somado.
--
--   · Não afirmam execução. As colunas de cronograma vêm da bancada (171), que
--     só enxerga mapeamento ACEITO. Sem mapeamento, `trigger_assessment` é
--     'NOT_ASSESSED' — e não 'pendente', que insinuaria que alguém olhou.
--
--   · Não criam evento de faturamento, nota, recebível ou pagamento. Nada aqui
--     escreve. `security_invoker = true` em todas: a RLS das tabelas de origem
--     continua sendo a única porteira.
--
--   · Não derivam conclusão de `percent_complete`. Ver a nota em
--     `execution_evidence` abaixo.
-- ============================================================
BEGIN;

-- ════════════════════════════════════════════════════════════════════════
-- 1. O VÍNCULO — qual contrato é o contrato daquele projeto
--
-- Duas origens convivem no schema desde a 034: a tabela de junção
-- `contract_project_links` e a coluna legada `contracts.project_id`. Uni-las
-- num UNION silencioso perderia a informação de QUAL delas sustentou o
-- vínculo, que é exatamente o que alguém precisa saber quando as duas
-- discordam. `link_source` carrega essa proveniência, e o DISTINCT ON prefere
-- a junção explícita — o vínculo que alguém criou de propósito.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.project_contract_link_governed
WITH (security_invoker = true) AS
SELECT DISTINCT ON (organization_id, project_id, contract_id)
  organization_id, project_id, contract_id, link_source, linked_at
FROM (
  SELECT l.organization_id, l.project_id, l.contract_id,
         'contract_project_links'::text AS link_source, l.created_at AS linked_at
    FROM public.contract_project_links l
  UNION ALL
  SELECT c.organization_id, c.project_id, c.id,
         'contracts.project_id'::text, c.created_at
    FROM public.contracts c
   WHERE c.project_id IS NOT NULL AND c.deleted_at IS NULL
) u
ORDER BY organization_id, project_id, contract_id,
         (link_source = 'contract_project_links') DESC, linked_at;

COMMENT ON VIEW public.project_contract_link_governed IS
  'Vínculo projeto↔contrato com PROVENIÊNCIA. Reconcilia as duas origens que '
  'coexistem no schema (contract_project_links e contracts.project_id) sem '
  'esconder qual delas sustentou o vínculo. Uma linha por par.';

-- ════════════════════════════════════════════════════════════════════════
-- 2. O DINHEIRO — uma linha por projeto×contrato
--
-- Três números que NÃO se fundem, pelo mesmo motivo de sempre:
--
--   contract_value    — o cabeçalho do instrumento assinado
--   entitlement_total — a soma dos direitos fixos por marco (migration 136)
--   measured/accepted — o que a operação apurou e o que alguém aceitou
--
-- E, ao lado deles, `reconciliation_delta`: a diferença entre os dois
-- primeiros, preservada com o sinal. Zero significa conciliado; NULL significa
-- que falta um dos lados — e nunca "conciliado".
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.project_contract_financial_read_model
WITH (security_invoker = true) AS
SELECT
  lk.organization_id,
  lk.project_id,
  lk.contract_id,
  lk.link_source,
  lk.linked_at,

  -- ── Identidade do instrumento ──────────────────────────────────────────
  c.contract_number,
  c.title              AS contract_title,
  c.status             AS contract_status,
  c.counterparty_name,
  c.currency,
  c.start_date,
  c.end_date,
  c.signed_date,

  -- ── O valor do cabeçalho, como assinado ────────────────────────────────
  c.total_value        AS contract_value,

  -- ── O direito, somado dos marcos ───────────────────────────────────────
  agg.entitlement_total,
  agg.entitlement_rule_count,
  agg.milestone_count,

  -- ── A DIVERGÊNCIA DOCUMENTAL, preservada ───────────────────────────────
  -- `entitlement_total - contract_value`. Em JA10182283/2025 dá +0,01: os seis
  -- percentuais do Anexo distribuem um centavo a mais que o Preço da Parte A.
  -- Não é erro de cálculo desta visão — é o que o documento diz, e some no
  -- instante em que alguém arredondar "para bater".
  CASE WHEN c.total_value IS NULL OR agg.entitlement_total IS NULL THEN NULL
       ELSE agg.entitlement_total - c.total_value END AS reconciliation_delta,

  -- ── O que a operação apurou e o que foi aceito ─────────────────────────
  -- NULL quando nada foi apurado. Zero seria a afirmação de que se apurou e
  -- deu zero, que é outro fato.
  agg.measured_total,
  agg.accepted_total,
  agg.billed_event_count,

  -- ── Quanto do direito já tem cronograma governado ──────────────────────
  agg.governed_mapped_milestone_count

FROM public.project_contract_link_governed lk
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
  'O contrato visto do projeto: valor do cabeçalho, total de direitos, e a '
  'DIVERGÊNCIA entre eles preservada em reconciliation_delta (JA10182283/2025: '
  '+0,01, documental). Nenhum dos três valores é coalescido com os outros. '
  'Recalculada a cada SELECT — não existe cópia para sincronizar.';

-- ════════════════════════════════════════════════════════════════════════
-- 3. OS MARCOS — os eventos contratuais dentro do projeto
--
-- Reaproveita a bancada (171) inteira em vez de refazer os JOINs. Refazê-los
-- criaria uma segunda definição de "marco com cronograma", e as duas
-- discordariam no primeiro ajuste que alguém fizesse só de um lado.
--
-- O que esta visão ACRESCENTA à bancada são três coisas que só fazem sentido
-- do lado do projeto: a participação do marco no direito total, a leitura
-- explícita de EXIGÊNCIA contratual, e o veredito de apuração do gatilho.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.project_contract_milestone_read_model
WITH (security_invoker = true) AS
SELECT
  lk.project_id,
  w.organization_id,
  w.contract_id,
  w.id                      AS milestone_id,
  w.title,
  w.description,
  w.milestone_type,
  w.status,
  w.due_date,
  w.completed_at,

  -- ── DIREITO e sua participação no total ────────────────────────────────
  w.entitlement_amount,
  w.entitlement_currency,
  w.entitlement_rule_count,
  -- Aritmética pura sobre dois números já expostos, não julgamento: quanto
  -- deste marco no direito total do contrato. NULL quando falta qualquer lado.
  CASE WHEN w.entitlement_amount IS NULL THEN NULL
       ELSE round(100 * w.entitlement_amount
            / NULLIF(sum(w.entitlement_amount) OVER (PARTITION BY w.contract_id), 0), 6)
  END                       AS entitlement_share_percent,
  w.billing_amount          AS planned_billing_amount,

  -- ── PROVENIÊNCIA DOCUMENTAL do direito ─────────────────────────────────
  w.entitlement_source_document_id,
  w.entitlement_source_page,
  w.entitlement_source_reference,

  -- ── GATILHO CONTRATUAL e EXIGÊNCIAS ────────────────────────────────────
  w.requirement_id IS NOT NULL      AS measurement_required,
  w.required_document_type,
  w.evidence_required,
  w.report_required,
  w.technical_report_required,
  -- A exigência que governa a elegibilidade de faturar. Em JA10182283/2025 é
  -- `true` nos seis eventos: aprovação de Boletim de Medição pela Contratante.
  w.customer_acceptance_required,

  -- ── EXECUÇÃO: o que Projetos registrou, e só isso ──────────────────────
  w.governed_mapping_count,
  w.timeline_item_id,
  w.timeline_project_id,
  w.timeline_title,
  w.timeline_wbs_code,
  w.timeline_status,
  w.timeline_percent_complete,
  w.timeline_planned_finish,
  w.timeline_actual_finish,

  /*
    O VEREDITO DE APURAÇÃO DO GATILHO.

    Três estados, e a diferença entre eles é toda a disciplina desta feature:

      NOT_ASSESSED  — não há ponte ACEITA até uma etapa real. Ninguém olhou.
                      É diferente de "não ocorreu": é "não se sabe".
      NOT_OCCURRED  — há ponte aceita, e a etapa NÃO terminou.
      OCCURRED      — há ponte aceita, e a etapa terminou de fato.

    `percent_complete = 100` não aparece em lugar nenhum desta expressão, de
    propósito. Cem por cento num cronograma é a opinião de quem atualizou a
    linha; `actual_finish` e `status = 'completed'` são o registro do fato. A
    diferença entre os dois é a diferença entre projeto que anda e dinheiro que
    pode ser cobrado.
  */
  CASE
    WHEN COALESCE(w.governed_mapping_count, 0) = 0 OR w.timeline_item_id IS NULL
      THEN 'NOT_ASSESSED'
    WHEN w.timeline_actual_finish IS NOT NULL OR w.timeline_status = 'completed'
      THEN 'OCCURRED'
    ELSE 'NOT_OCCURRED'
  END                       AS trigger_assessment,

  -- ── MEDIÇÃO e ACEITE (autoridade: Projetos / Contratante) ──────────────
  w.measurement_id,
  w.measurement_status,
  w.measurement_readiness,
  w.measurement_accepted_at,
  w.measurement_accepted_value,
  w.measurement_evidence_count,
  w.measured_amount,
  w.evidence_document_id,

  -- ── FATURAMENTO: existência e estado, nunca criação ────────────────────
  w.billing_event_id,
  w.billing_eligibility_state,
  w.billing_release_state,
  w.billing_receivable_status

FROM public.project_contract_link_governed lk
JOIN public.contract_milestone_workbench w
  ON w.contract_id = lk.contract_id
 AND w.organization_id = lk.organization_id;

COMMENT ON VIEW public.project_contract_milestone_read_model IS
  'Os marcos contratuais dentro do projeto: direito, percentual, proveniência '
  'documental, exigência de medição e de aceite, cronograma governado e estado '
  'de faturamento. trigger_assessment distingue NOT_ASSESSED (sem ponte aceita) '
  'de NOT_OCCURRED (ponte aceita, etapa aberta) — e nunca lê percent_complete '
  'como conclusão. Projeto define QUANDO; contrato define O QUÊ.';

-- ── Somente leitura, declarado (a dívida que a 174 fechou não renasce) ──
DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'project_contract_link_governed',
    'project_contract_financial_read_model',
    'project_contract_milestone_read_model'
  ] LOOP
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated', v);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', v);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v);
  END LOOP;
END $$;

COMMIT;
