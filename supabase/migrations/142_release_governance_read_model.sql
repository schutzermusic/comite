-- ============================================================
-- Fase 7 — 142: GOVERNANÇA DA LIBERAÇÃO NO MODELO DE LEITURA
-- ============================================================
--
-- A 141 tirou a liberação por dedução de nome de papel e passou a exigir
-- governança real. Falta a tela conseguir DIZER isso: um faturamento elegível
-- que não pode ser liberado precisa explicar que a autoridade não está
-- declarada, e não deixar o usuário concluir que a interface quebrou.
--
-- `CREATE OR REPLACE VIEW` acrescenta a coluna NO FIM e preserva os grants —
-- por isso a definição inteira é reescrita aqui: o PostgreSQL não deixa
-- acrescentar coluna a uma view sem redeclarar as anteriores, na mesma ordem
-- e com os mesmos tipos.
-- ============================================================
BEGIN;

CREATE OR REPLACE VIEW public.contract_to_cash_read_model
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
  e.updated_at,

  /*
    GOVERNANÇA DA LIBERAÇÃO — acrescentada pela migration 142.

    A 136 liberava por permissão quando o Motor de Aprovação respondia
    NO_POLICY, e concedia a permissão a papéis globais na própria migration.
    A 141 desfez as duas coisas: liberar exige política REAL ou autoridade
    DECLARADA com evidência.

    Esta coluna existe para que a tela consiga dizer POR QUE o botão não
    aparece. Sem ela, um faturamento ELEGÍVEL e não liberável pareceria um
    defeito da interface — que é como configuração ausente vira chamado de
    suporte em vez de decisão de governança.
  */
  CASE
    WHEN EXISTS (
      SELECT 1 FROM public.approval_policy_versions v
       WHERE v.organization_id = e.organization_id
         AND v.subject_type = 'contract_billing_event'
         AND v.action_type = 'release'
         AND v.decision_purpose = 'RELEASE'
         AND v.status = 'ACTIVE') THEN 'APPROVAL_POLICY'
    WHEN EXISTS (
      SELECT 1 FROM public.contract_billing_release_authorities a
       WHERE a.organization_id = e.organization_id
         AND a.active AND a.revoked_at IS NULL
         AND a.effective_from <= current_date
         AND (a.effective_until IS NULL OR a.effective_until >= current_date)
         AND (a.contract_id IS NULL OR a.contract_id = e.contract_id)) THEN 'DECLARED_AUTHORITY'
    ELSE 'NOT_CONFIGURED'
  END                        AS release_governance_state
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
  'zero provado (§62); `release_governance_state` distingue "não pode faturar" '
  'de "ninguém tem autoridade declarada para liberar" (§18).';

COMMIT;
