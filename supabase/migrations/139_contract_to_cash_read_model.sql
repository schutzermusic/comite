-- ============================================================
-- Fase 7 — 139: MODELO DE LEITURA CONTRATO-A-CAIXA, ROTAS E CORTE
-- ============================================================
--
-- ─── Um resolvedor, não sete somatórios ──────────────────────────────────
--
-- A §61 pede UM serviço compartilhado por evento de faturamento, e a §87 pede
-- que o dossiê do contrato use o MESMO. A alternativa — cada tela somando por
-- conta própria — já produziu, neste repositório, um painel que apresentava
-- previsão como apuração. Uma visão só é o que impede a segunda interpretação.
--
-- ─── Ausência NÃO é zero (§62) ───────────────────────────────────────────
--
-- Cada valor sai com o seu estado ao lado. `received_amount_cents` NULO
-- significa "Finanças não tem título para isto"; zero significa "tem título e
-- nada entrou". Escrever R$ 0 recebido num contrato sem vínculo financeiro é a
-- mentira que faz alguém cobrar quem já pagou.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1) A CADEIA, por evento de faturamento (§61, §86)
-- ------------------------------------------------------------
CREATE VIEW public.contract_to_cash_read_model
WITH (security_invoker = true) AS
SELECT
  e.id                       AS billing_event_id,
  e.organization_id,
  e.contract_id,
  e.milestone_id,
  e.title,
  e.legacy_row,

  -- ---- origem e procedência do valor (§11) ----
  e.source_kind,
  e.source_measurement_id,
  e.entitlement_key,
  e.amount                   AS eligible_amount,
  e.currency,
  e.amount_source,
  e.amount_source_id,
  e.amount_source_revision,
  e.amount_derivation_rule,
  e.amount_derived_at,
  e.amount_fingerprint,

  -- ---- elegibilidade e bloqueios (§16) ----
  e.eligibility_state,
  e.eligibility_reasons,
  e.eligibility_computed_at,

  -- ---- liberação (§17) ----
  e.release_state,
  e.released_at,
  e.released_by,
  e.release_fingerprint,
  e.release_approval_request_id,
  e.supersedes_id,
  e.superseded_by_id,
  e.cancelled_at,
  e.cancellation_reason,

  /*
    Retenção, glosa e disputa saem SEMPRE como NOT_APPLICABLE, e a coluna
    existe justamente para dizer isso. A auditoria não encontrou esquema algum
    para as três (§25, §26, §27); a §114 manda relatar NOT_APPLICABLE em vez de
    inventar. Uma coluna ausente faria a tela adivinhar; esta afirma.
  */
  'NOT_APPLICABLE'::text     AS retention_state,
  'NOT_APPLICABLE'::text     AS glosa_state,
  'NOT_APPLICABLE'::text     AS dispute_state,

  -- ---- fiscal ----
  fr.state                   AS fiscal_request_state,
  fr.blockers                AS fiscal_blockers,
  fa.fiscal_document_id,
  fd.status                  AS fiscal_document_status,
  fd.document_number         AS fiscal_document_number,
  fd.environment             AS fiscal_environment,
  fd.authorized_at           AS fiscal_authorized_at,
  fd.finance_status          AS fiscal_finance_status,
  fd.replaced_document_id,
  fd.replacement_document_id,

  -- ---- contas a receber ----
  r.id                       AS receivable_id,
  r.party_id,
  r.amount_basis             AS receivable_amount_basis,
  r.original_amount_cents    AS receivable_amount_cents,
  r.lifecycle_state          AS receivable_lifecycle_state,
  r.ledger_posting_state,
  r.ledger_blockers,
  b.first_due_date           AS due_date,
  b.paid_amount_cents,
  b.open_amount_cents,
  b.derived_status           AS receivable_status,
  b.payment_count,
  b.reversal_count,

  /*
    ESTADO DO VÍNCULO FINANCEIRO. É esta coluna que a tela consulta ANTES de
    mostrar qualquer número de recebimento — e é por ela que "R$ 0 recebido"
    nunca aparece para quem não tem título.
  */
  CASE
    WHEN r.id IS NOT NULL AND r.lifecycle_state = 'ACTIVE' THEN 'LINKED'
    -- Título existe e NÃO é cobrável. Dizer 'NOT_LINKED' aqui esconderia que
    -- houve cobrança e que ela caiu.
    WHEN r.id IS NOT NULL                      THEN 'CLOSED'
    WHEN fr.state = 'BLOCKED_BY_CONFIGURATION' THEN 'PENDING_CONFIGURATION'
    WHEN fa.fiscal_document_id IS NOT NULL     THEN 'NOT_LINKED'
    WHEN e.release_state = 'RELEASED'  THEN 'NOT_LINKED'
    ELSE 'UNKNOWN'
  END                        AS finance_link_state,

  -- ---- conciliação: dimensão PRÓPRIA, nunca confundida com pagamento (§49) ----
  (SELECT count(*) FROM public.finance_reconciliations rc
     JOIN public.finance_settlements s2 ON s2.id = rc.settlement_id
    WHERE s2.receivable_id = r.id AND rc.state = 'RECONCILED')::integer
                             AS reconciled_settlement_count,
  (SELECT count(*) FROM public.finance_settlements s3
    WHERE s3.receivable_id = r.id AND s3.kind = 'PAYMENT'
      AND NOT EXISTS (SELECT 1 FROM public.finance_settlements rv WHERE rv.reversal_of = s3.id)
      AND NOT EXISTS (SELECT 1 FROM public.finance_reconciliations rc2
                       WHERE rc2.settlement_id = s3.id AND rc2.state = 'RECONCILED'))::integer
                             AS unreconciled_settlement_count,

  e.created_at,
  e.updated_at
FROM public.contract_billing_events e
LEFT JOIN LATERAL (
  SELECT * FROM public.contract_billing_fiscal_requests q
   WHERE q.organization_id = e.organization_id AND q.billing_event_id = e.id
   ORDER BY q.created_at DESC LIMIT 1) fr ON true
LEFT JOIN LATERAL (
  SELECT * FROM public.contract_billing_fiscal_allocations a
   WHERE a.organization_id = e.organization_id AND a.billing_event_id = e.id
     AND a.state = 'ACTIVE'
   ORDER BY a.created_at DESC LIMIT 1) fa ON true
LEFT JOIN public.fiscal_documents fd
       ON fd.organization_id = e.organization_id AND fd.id = fa.fiscal_document_id
/*
  O título MAIS RECENTE, vivo ou não — e o vivo primeiro quando houver os dois.

  A primeira versão desta junção filtrava por `lifecycle_state = 'ACTIVE'`, e o
  efeito era o oposto do pretendido: uma nota cancelada fazia o título sumir da
  leitura, e a tela passava a dizer "sem vínculo financeiro" sobre um
  faturamento que TEM título — cancelado. A §119 exige que nota cancelada
  apareça como NÃO COBRÁVEL, o que é diferente de não aparecer.
*/
LEFT JOIN LATERAL (
  SELECT * FROM public.finance_receivables fr2
   WHERE fr2.organization_id = e.organization_id AND fr2.billing_event_id = e.id
   ORDER BY (fr2.lifecycle_state = 'ACTIVE') DESC, fr2.created_at DESC LIMIT 1) r ON true
LEFT JOIN public.finance_receivable_balances b ON b.receivable_id = r.id;

COMMENT ON VIEW public.contract_to_cash_read_model IS
  'Resolvedor CANÔNICO da cadeia contrato-a-caixa, um por evento de '
  'faturamento (§61). Contratos, dossiê e Finanças leem daqui — não há segunda '
  'implementação do cálculo. `finance_link_state` distingue desconhecido de '
  'zero provado (§62).';

GRANT SELECT ON public.contract_to_cash_read_model TO authenticated;

-- ------------------------------------------------------------
-- 2) Saúde operacional (§94)
-- ------------------------------------------------------------
/*
  Primitivas de leitura, e nada além. A §94 e a §134 proíbem construir a Torre
  de Controle da Fase 9 aqui: o que existe é a resposta a "onde a cadeia
  parou?", que é operação, não painel executivo.
*/
CREATE VIEW public.contract_to_cash_health
WITH (security_invoker = true) AS
SELECT
  e.organization_id,
  count(*) FILTER (WHERE e.eligibility_state = 'ELIGIBLE'
                     AND e.release_state = 'ELIGIBLE')::integer   AS eligible_not_released,
  count(*) FILTER (WHERE e.release_state = 'RELEASED'
                     AND fr.id IS NULL)::integer                  AS released_without_fiscal_request,
  count(*) FILTER (WHERE fr.state = 'BLOCKED_BY_CONFIGURATION')::integer
                                                                  AS fiscal_blocked_by_configuration,
  count(*) FILTER (WHERE fd.status = 'authorized' AND r.id IS NULL)::integer
                                                                  AS authorized_without_receivable,
  count(*) FILTER (WHERE r.ledger_posting_state = 'PENDING_CONFIGURATION')::integer
                                                                  AS ledger_blocked_by_configuration,
  count(*) FILTER (WHERE b.derived_status = 'OVERDUE')::integer    AS overdue_receivables,
  count(*) FILTER (WHERE b.open_amount_cents < 0)::integer         AS negative_open_balance_anomaly
FROM public.contract_billing_events e
LEFT JOIN LATERAL (
  SELECT * FROM public.contract_billing_fiscal_requests q
   WHERE q.billing_event_id = e.id ORDER BY q.created_at DESC LIMIT 1) fr ON true
LEFT JOIN LATERAL (
  SELECT * FROM public.contract_billing_fiscal_allocations a
   WHERE a.billing_event_id = e.id AND a.state = 'ACTIVE' LIMIT 1) fa ON true
LEFT JOIN public.fiscal_documents fd ON fd.id = fa.fiscal_document_id
LEFT JOIN public.finance_receivables r
       ON r.billing_event_id = e.id AND r.lifecycle_state = 'ACTIVE'
LEFT JOIN public.finance_receivable_balances b ON b.receivable_id = r.id
WHERE NOT e.legacy_row
GROUP BY e.organization_id;

COMMENT ON VIEW public.contract_to_cash_health IS
  'Onde a cadeia parou, por inquilino. Contagens, sem segredo e sem valor de '
  'provedor (§94, §124). Não é a Torre de Controle da Fase 9.';
GRANT SELECT ON public.contract_to_cash_health TO authenticated;

-- ------------------------------------------------------------
-- 3) ROTAS estáticas evento → trabalho (§64, §66)
-- ------------------------------------------------------------
/*
  `apex_event_routes` nasceu vazia na Fase 4 de propósito: rota para consumidor
  inexistente é consumidor inventado. A Fase 7 é a primeira a ter consumidores
  reais para semear, e cada linha abaixo corresponde a um handler tipado que
  existe em `src/lib/platform/jobs/handlers.ts`.

  A transmissão ao provedor fiscal NÃO entra aqui: ela continua em
  `fiscal_jobs`, que a §66 congela e a §123 proíbe migrar.
*/
INSERT INTO public.apex_event_routes (event_type, schema_version, job_type, max_attempts, note) VALUES
  ('projects.measurement.accepted', 1, 'contracts.billing.candidate_from_measurement', 5,
   'Medição aceita vira CANDIDATO com procedência. Nunca liberação (§21).'),
  ('contracts.billing.released', 1, 'contracts.billing.request_fiscal_document', 5,
   'Liberação abre pedido durável ao Fiscal. Contratos não escreve fiscal_documents (§29).'),
  ('fiscal.document.authorized', 1, 'finance.receivable.create_from_fiscal', 5,
   'Nota autorizada vira Contas a Receber, de Finanças, idempotente (§38).'),
  ('fiscal.document.cancelled', 1, 'finance.receivable.apply_fiscal_cancellation', 5,
   'Cancelamento derruba título e fecha alocação, sem apagar história (§34).'),
  ('fiscal.document.replaced', 1, 'finance.receivable.apply_fiscal_cancellation', 5,
   'Substituição fecha a alocação antiga preservando a lineage (§34).'),
  ('approval.request.approved', 1, 'contracts.billing.apply_approval', 5,
   'Aplica decisão de liberação quando existir política real (§18).'),
  ('approval.request.rejected', 1, 'contracts.billing.apply_approval', 5,
   'Rejeição de liberação também é desfecho a aplicar (§18).')
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- 4) CORTE DO FATURAMENTO — sem escrita dupla (§129)
-- ------------------------------------------------------------
/*
  `createBillingEventFromMilestone` continua existindo e continua servindo o
  faturamento manual de marco. O que ela não pode mais é criar um SEGUNDO
  evento para um marco que a Fase 7 já governa — seria a verdade concorrente
  que a §10 e a §129 proíbem, e ela apareceria como cobrança em duplicidade.

  A guarda vale para o caminho de NAVEGADOR. As funções governadas são
  SECURITY DEFINER e a supersessão precisa poder criar o sucessor.
*/
CREATE FUNCTION public.contract_billing_events_guard_cutover() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF NEW.milestone_id IS NULL THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM public.contract_billing_events g
     WHERE g.organization_id = NEW.organization_id
       AND g.milestone_id = NEW.milestone_id
       AND g.entitlement_key IS NOT NULL
       AND g.release_state NOT IN ('CANCELLED','SUPERSEDED')
       AND g.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION
      'BILLING_CUTOVER: este marco já tem direito de faturamento governado pela Fase 7. '
      'Criar um evento manual em paralelo produziria cobrança em duplicidade (§129).'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contract_billing_events_guard_cutover() FROM PUBLIC;
CREATE TRIGGER cbe_guard_cutover BEFORE INSERT ON public.contract_billing_events
  FOR EACH ROW EXECUTE FUNCTION public.contract_billing_events_guard_cutover();

-- ------------------------------------------------------------
-- 5) Postura de privilégio das tabelas da Fase 7
-- ------------------------------------------------------------
-- Repetido de propósito por tabela: a 118 corrigiu o ACL padrão do schema, e o
-- REVOKE explícito torna estas migrations independentes daquela correção
-- continuar valendo.
REVOKE TRUNCATE ON
  public.contract_billing_entitlement_rules,
  public.contract_billing_event_history,
  public.contract_billing_adjustments,
  public.contract_billing_fiscal_requests,
  public.contract_billing_fiscal_allocations,
  public.finance_receivable_basis_policies,
  public.finance_posting_rules,
  public.finance_receivables,
  public.finance_receivable_installments,
  public.finance_payment_sources,
  public.finance_settlements,
  public.finance_reconciliations,
  public.finance_reconciliation_candidates
FROM anon, authenticated;

COMMIT;
