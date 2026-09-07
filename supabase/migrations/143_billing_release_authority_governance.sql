-- ============================================================
-- Fase 7 — 143: DECLARAÇÃO IMUTÁVEL E CAPACIDADE POR VISUALIZADOR
-- ============================================================
--
-- A autoridade criada na 141 era um fato governante, mas ainda podia ser
-- escrita e reescrita diretamente por um administrador no navegador. Também
-- deixava `declared_by` a cargo do chamador e confundia teto ausente com
-- autoridade ilimitada. Esta migration fecha esses caminhos sem alterar as
-- migrations já aplicadas.
-- ============================================================
BEGIN;

-- A produção foi verificada novamente antes desta migration: zero linhas.
-- A própria migration repete a prova e recusa prosseguir se o estado mudar;
-- não existe backfill capaz de inventar ator ou escopo de valor histórico.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.contract_billing_release_authorities) THEN
    RAISE EXCEPTION
      'CBRA_MIGRATION_REQUIRES_EMPTY_TABLE: não é seguro inventar declared_by ou amount_scope.'
      USING ERRCODE = 'check_violation';
  END IF;
END $$;

ALTER TABLE public.contract_billing_release_authorities
  ADD COLUMN amount_scope text;

ALTER TABLE public.contract_billing_release_authorities
  ALTER COLUMN amount_scope SET NOT NULL,
  ALTER COLUMN declared_by SET NOT NULL;

ALTER TABLE public.contract_billing_release_authorities
  DROP CONSTRAINT cbra_amount_needs_currency,
  ADD CONSTRAINT cbra_amount_scope_explicit CHECK (
    (amount_scope = 'CAPPED' AND max_amount IS NOT NULL AND currency IS NOT NULL)
    OR (amount_scope = 'UNLIMITED' AND max_amount IS NULL AND currency IS NULL)
  );

-- Referências que compõem a prova histórica não podem apagar a declaração
-- por cascata nem transformar seu ator em NULL.
ALTER TABLE public.contract_billing_release_authorities
  DROP CONSTRAINT contract_billing_release_authorities_organization_id_fkey,
  ADD CONSTRAINT contract_billing_release_authorities_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  DROP CONSTRAINT cbra_contract_tenant,
  ADD CONSTRAINT cbra_contract_tenant FOREIGN KEY (organization_id, contract_id)
    REFERENCES public.contracts(organization_id, id) ON DELETE RESTRICT,
  DROP CONSTRAINT contract_billing_release_authorities_grantee_role_id_fkey,
  ADD CONSTRAINT contract_billing_release_authorities_grantee_role_id_fkey
    FOREIGN KEY (grantee_role_id) REFERENCES public.roles(id) ON DELETE RESTRICT,
  DROP CONSTRAINT contract_billing_release_authorities_grantee_user_id_fkey,
  ADD CONSTRAINT contract_billing_release_authorities_grantee_user_id_fkey
    FOREIGN KEY (grantee_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  DROP CONSTRAINT contract_billing_release_authorities_declared_by_fkey,
  ADD CONSTRAINT contract_billing_release_authorities_declared_by_fkey
    FOREIGN KEY (declared_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  DROP CONSTRAINT contract_billing_release_authorities_revoked_by_fkey,
  ADD CONSTRAINT contract_billing_release_authorities_revoked_by_fkey
    FOREIGN KEY (revoked_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  DROP CONSTRAINT cbra_revoked_coherent,
  ADD CONSTRAINT cbra_revoked_coherent CHECK (
    (active AND revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL)
    OR (NOT active AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL
        AND btrim(revocation_reason) <> '')
  );

COMMENT ON COLUMN public.contract_billing_release_authorities.amount_scope IS
  'Semântica explícita da alçada: CAPPED exige teto e moeda; UNLIMITED '
  'exige declaração literal e não carrega teto ou moeda. Não há default.';
COMMENT ON COLUMN public.contract_billing_release_authorities.declared_by IS
  'Ator autenticado capturado exclusivamente por contract_billing_release_authority_declare; '
  'nunca é entrada do chamador e nunca se torna NULL.';

-- Escrita direta do navegador deixa de existir. A leitura continua RLS e por
-- organização; declarar e revogar passam pelas RPCs abaixo.
DROP POLICY IF EXISTS cbra_write ON public.contract_billing_release_authorities;
REVOKE INSERT, UPDATE, DELETE ON public.contract_billing_release_authorities
  FROM anon, authenticated;

-- O gatilho exige a transição controlada, torna todos os fatos da declaração
-- imutáveis e proíbe apagar história. O escape de manutenção requer a dona
-- postgres E uma flag transacional explícita; serve apenas para mundos de teste
-- descartáveis e não é exposto por RPC.
CREATE FUNCTION public.contract_billing_release_authority_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE transition text := current_setting('app.cbra_transition', true);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF transition IS DISTINCT FROM 'DECLARE' OR auth.uid() IS NULL
       OR NEW.declared_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'AUTHORITY_DECLARATION_RPC_REQUIRED'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF current_user = 'postgres'
       AND current_setting('app.cbra_history_maintenance', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'AUTHORITY_HISTORY_IMMUTABLE: revogue; não apague a declaração.'
      USING ERRCODE = '42501';
  END IF;

  IF transition IS DISTINCT FROM 'REVOKE'
     OR OLD.revoked_at IS NOT NULL
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.contract_id IS DISTINCT FROM OLD.contract_id
     OR NEW.grantee_kind IS DISTINCT FROM OLD.grantee_kind
     OR NEW.grantee_role_id IS DISTINCT FROM OLD.grantee_role_id
     OR NEW.grantee_user_id IS DISTINCT FROM OLD.grantee_user_id
     OR NEW.amount_scope IS DISTINCT FROM OLD.amount_scope
     OR NEW.max_amount IS DISTINCT FROM OLD.max_amount
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.source_kind IS DISTINCT FROM OLD.source_kind
     OR NEW.source_reference IS DISTINCT FROM OLD.source_reference
     OR NEW.source_document_id IS DISTINCT FROM OLD.source_document_id
     OR NEW.justification IS DISTINCT FROM OLD.justification
     OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
     OR NEW.effective_until IS DISTINCT FROM OLD.effective_until
     OR NEW.declared_by IS DISTINCT FROM OLD.declared_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.active IS DISTINCT FROM false
     OR NEW.revoked_at IS NULL
     OR NEW.revoked_by IS NULL
     OR NEW.revocation_reason IS NULL
     OR btrim(NEW.revocation_reason) = '' THEN
    RAISE EXCEPTION 'AUTHORITY_CORE_IMMUTABLE: somente a RPC de revogação é permitida.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contract_billing_release_authority_immutable()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER cbra_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON public.contract_billing_release_authorities
  FOR EACH ROW EXECUTE FUNCTION public.contract_billing_release_authority_immutable();

-- Declaração governada. O ator não aparece na assinatura: vem de auth.uid().
CREATE FUNCTION public.contract_billing_release_authority_declare(
  p_organization_id   uuid,
  p_contract_id       uuid,
  p_grantee_kind      text,
  p_grantee_role_id   uuid,
  p_grantee_user_id   uuid,
  p_amount_scope      text,
  p_max_amount        numeric,
  p_currency          text,
  p_source_kind       text,
  p_source_reference  text,
  p_source_document_id uuid,
  p_justification     text,
  p_effective_from    date DEFAULT current_date,
  p_effective_until   date DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor uuid := auth.uid();
  caller_org uuid;
  authority_id uuid;
  prior_transition text := current_setting('app.cbra_transition', true);
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'AUTHORITY_DECLARATION_REQUIRES_AUTHENTICATED_ACTOR'
      USING ERRCODE = '42501';
  END IF;
  caller_org := public.apex_browser_organization();
  IF caller_org IS NULL OR caller_org IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'AUTHORITY_DECLARATION_NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'AUTHORITY_DECLARATION_NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;

  IF p_grantee_kind = 'USER' AND p_grantee_user_id = actor THEN
    RAISE EXCEPTION 'AUTHORITY_SELF_DECLARATION_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;
  IF p_grantee_kind = 'ROLE' AND EXISTS (
    SELECT 1 FROM public.user_roles ur
     WHERE ur.user_id = actor
       AND ur.role_id = p_grantee_role_id
       AND ur.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'AUTHORITY_ROLE_SELF_DECLARATION_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.cbra_transition', 'DECLARE', true);
  INSERT INTO public.contract_billing_release_authorities
    (organization_id, contract_id, grantee_kind, grantee_role_id, grantee_user_id,
     amount_scope, max_amount, currency, source_kind, source_reference,
     source_document_id, justification, effective_from, effective_until, declared_by)
  VALUES
    (p_organization_id, p_contract_id, p_grantee_kind, p_grantee_role_id, p_grantee_user_id,
     p_amount_scope, p_max_amount, p_currency, p_source_kind, p_source_reference,
     p_source_document_id, p_justification, p_effective_from, p_effective_until, actor)
  RETURNING id INTO authority_id;
  PERFORM set_config('app.cbra_transition', COALESCE(prior_transition, ''), true);
  RETURN authority_id;
END $$;
REVOKE ALL ON FUNCTION public.contract_billing_release_authority_declare(
  uuid, uuid, text, uuid, uuid, text, numeric, text, text, text, uuid, text, date, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contract_billing_release_authority_declare(
  uuid, uuid, text, uuid, uuid, text, numeric, text, text, text, uuid, text, date, date)
  TO authenticated;

COMMENT ON FUNCTION public.contract_billing_release_authority_declare(
  uuid, uuid, text, uuid, uuid, text, numeric, text, text, text, uuid, text, date, date) IS
  'Declara autoridade pela fronteira governada. declared_by é sempre auth.uid(); '
  'auto-outorga direta ou por papel é recusada.';

-- Revogação é uma transição, não uma edição nem um DELETE.
CREATE FUNCTION public.contract_billing_release_authority_revoke(
  p_authority_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor uuid := auth.uid();
  caller_org uuid;
  authority public.contract_billing_release_authorities%ROWTYPE;
  prior_transition text := current_setting('app.cbra_transition', true);
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'AUTHORITY_REVOCATION_REQUIRES_AUTHENTICATED_ACTOR'
      USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'AUTHORITY_REVOCATION_REASON_REQUIRED'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO authority
    FROM public.contract_billing_release_authorities
   WHERE id = p_authority_id FOR UPDATE;
  caller_org := public.apex_browser_organization();
  IF NOT FOUND OR caller_org IS NULL OR authority.organization_id IS DISTINCT FROM caller_org THEN
    RAISE EXCEPTION 'AUTHORITY_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'AUTHORITY_REVOCATION_NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  IF authority.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('authority_id', authority.id, 'status', 'REVOKED',
                              'idempotent', true, 'revoked_at', authority.revoked_at,
                              'revoked_by', authority.revoked_by);
  END IF;

  PERFORM set_config('app.cbra_transition', 'REVOKE', true);
  UPDATE public.contract_billing_release_authorities
     SET active = false, revoked_at = now(), revoked_by = actor,
         revocation_reason = btrim(p_reason)
   WHERE id = authority.id;
  PERFORM set_config('app.cbra_transition', COALESCE(prior_transition, ''), true);

  RETURN jsonb_build_object('authority_id', authority.id, 'status', 'REVOKED',
                            'idempotent', false, 'revoked_by', actor);
END $$;
REVOKE ALL ON FUNCTION public.contract_billing_release_authority_revoke(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contract_billing_release_authority_revoke(uuid, text)
  TO authenticated;

-- A resolução deixa de tratar ausência como ilimitado. Somente a palavra
-- UNLIMITED, gravada na declaração, abre uma alçada sem teto.
CREATE OR REPLACE FUNCTION public.contract_billing_release_authority_for(
  p_organization_id uuid,
  p_contract_id     uuid,
  p_user_id         uuid,
  p_amount          numeric DEFAULT NULL,
  p_currency        text    DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE found_id uuid;
BEGIN
  IF p_user_id IS NULL THEN RETURN NULL; END IF;

  SELECT a.id INTO found_id
    FROM public.contract_billing_release_authorities a
   WHERE a.organization_id = p_organization_id
     AND a.active AND a.revoked_at IS NULL
     AND a.effective_from <= current_date
     AND (a.effective_until IS NULL OR a.effective_until >= current_date)
     AND (a.contract_id IS NULL OR a.contract_id = p_contract_id)
     AND (
       (a.grantee_kind = 'USER' AND a.grantee_user_id = p_user_id)
       OR (a.grantee_kind = 'ROLE' AND EXISTS (
             SELECT 1 FROM public.user_roles ur
              WHERE ur.user_id = p_user_id
                AND ur.role_id = a.grantee_role_id
                AND ur.organization_id = p_organization_id)))
     AND (
       a.amount_scope = 'UNLIMITED'
       OR (a.amount_scope = 'CAPPED' AND p_amount IS NOT NULL AND p_currency IS NOT NULL
           AND a.max_amount IS NOT NULL AND a.currency = p_currency
           AND p_amount <= a.max_amount)
     )
   ORDER BY (a.grantee_kind = 'USER') DESC,
            (a.contract_id IS NOT NULL) DESC,
            a.created_at DESC
   LIMIT 1;
  RETURN found_id;
END $$;
REVOKE ALL ON FUNCTION public.contract_billing_release_authority_for(uuid, uuid, uuid, numeric, text)
  FROM PUBLIC, anon, authenticated;

-- Resposta segura e específica do visualizador. A RPC de liberação continua
-- sendo a autoridade final e repete todos os controles dentro da transação.
CREATE FUNCTION public.contract_billing_release_capability(p_billing_event_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e public.contract_billing_events%ROWTYPE;
  actor uuid := auth.uid();
  caller_org uuid;
  has_policy boolean;
  has_authority_governance boolean;
BEGIN
  SELECT * INTO e FROM public.contract_billing_events WHERE id = p_billing_event_id;
  caller_org := public.apex_browser_organization();
  IF NOT FOUND OR caller_org IS NULL OR e.organization_id IS DISTINCT FROM caller_org THEN
    RAISE EXCEPTION 'BILLING_EVENT_NOT_FOUND: faturamento inexistente.'
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.approval_policy_versions v
     WHERE v.organization_id = e.organization_id
       AND v.subject_type = 'contract_billing_event'
       AND v.action_type = 'release'
       AND v.decision_purpose = 'RELEASE'
       AND v.status = 'ACTIVE'
  ) INTO has_policy;

  SELECT EXISTS (
    SELECT 1 FROM public.contract_billing_release_authorities a
     WHERE a.organization_id = e.organization_id
       AND a.active AND a.revoked_at IS NULL
       AND a.effective_from <= current_date
       AND (a.effective_until IS NULL OR a.effective_until >= current_date)
       AND (a.contract_id IS NULL OR a.contract_id = e.contract_id)
  ) INTO has_authority_governance;

  IF NOT has_policy AND NOT has_authority_governance THEN RETURN 'NOT_CONFIGURED'; END IF;
  IF actor IS NULL OR NOT public.current_user_has_permission('contracts.billing.release') THEN
    RETURN 'NOT_AUTHORIZED';
  END IF;
  IF has_policy THEN RETURN 'REQUEST_APPROVAL'; END IF;
  IF public.contract_billing_release_authority_for(
       e.organization_id, e.contract_id, actor, e.amount, e.currency) IS NOT NULL THEN
    RETURN 'DIRECT_RELEASE';
  END IF;
  RETURN 'NOT_AUTHORIZED';
END $$;
REVOKE ALL ON FUNCTION public.contract_billing_release_capability(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contract_billing_release_capability(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.contract_billing_release_capability(uuid) IS
  'Capacidade segura do visualizador: NOT_CONFIGURED, NOT_AUTHORIZED, '
  'REQUEST_APPROVAL ou DIRECT_RELEASE. Não substitui contract_billing_release.';

-- A definição permanece canônica e security_invoker. A coluna nova entra
-- no fim para preservar a ordem e os tipos das colunas existentes.
CREATE OR REPLACE VIEW public.contract_to_cash_read_model
WITH (security_invoker = true) AS
SELECT
  e.id AS billing_event_id, e.organization_id, e.contract_id, e.milestone_id,
  e.title, e.legacy_row,
  e.source_kind, e.source_measurement_id, e.entitlement_key,
  e.amount AS eligible_amount, e.currency, e.amount_source, e.amount_source_id,
  e.amount_source_revision, e.amount_derivation_rule, e.amount_derived_at,
  e.amount_fingerprint,
  e.eligibility_state, e.eligibility_reasons, e.eligibility_computed_at,
  e.release_state, e.released_at, e.released_by, e.release_fingerprint,
  e.release_approval_request_id, e.supersedes_id, e.superseded_by_id,
  e.cancelled_at, e.cancellation_reason,
  'NOT_APPLICABLE'::text AS retention_state,
  'NOT_APPLICABLE'::text AS glosa_state,
  'NOT_APPLICABLE'::text AS dispute_state,
  fr.state AS fiscal_request_state, fr.blockers AS fiscal_blockers,
  fa.fiscal_document_id, fd.status AS fiscal_document_status,
  fd.document_number AS fiscal_document_number, fd.environment AS fiscal_environment,
  fd.authorized_at AS fiscal_authorized_at, fd.finance_status AS fiscal_finance_status,
  fd.replaced_document_id, fd.replacement_document_id,
  r.id AS receivable_id, r.party_id, r.amount_basis AS receivable_amount_basis,
  r.original_amount_cents AS receivable_amount_cents,
  r.lifecycle_state AS receivable_lifecycle_state, r.ledger_posting_state,
  r.ledger_blockers, b.first_due_date AS due_date, b.paid_amount_cents,
  b.open_amount_cents, b.derived_status AS receivable_status,
  b.payment_count, b.reversal_count,
  CASE
    WHEN r.id IS NOT NULL AND r.lifecycle_state = 'ACTIVE' THEN 'LINKED'
    WHEN r.id IS NOT NULL THEN 'CLOSED'
    WHEN fr.state = 'BLOCKED_BY_CONFIGURATION' THEN 'PENDING_CONFIGURATION'
    WHEN fa.fiscal_document_id IS NOT NULL THEN 'NOT_LINKED'
    WHEN e.release_state = 'RELEASED' THEN 'NOT_LINKED'
    ELSE 'UNKNOWN'
  END AS finance_link_state,
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
  e.created_at, e.updated_at,
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
  END AS release_governance_state,
  public.contract_billing_release_capability(e.id) AS release_capability
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
LEFT JOIN LATERAL (
  SELECT * FROM public.finance_receivables fr2
   WHERE fr2.organization_id = e.organization_id AND fr2.billing_event_id = e.id
   ORDER BY (fr2.lifecycle_state = 'ACTIVE') DESC, fr2.created_at DESC LIMIT 1) r ON true
LEFT JOIN public.finance_receivable_balances b ON b.receivable_id = r.id;

COMMENT ON VIEW public.contract_to_cash_read_model IS
  'Resolvedor canônico contrato-a-caixa. release_governance_state descreve a '
  'configuração; release_capability descreve com segurança o que o '
  'visualizador atual pode fazer, sem substituir a RPC autoritativa.';

COMMIT;
