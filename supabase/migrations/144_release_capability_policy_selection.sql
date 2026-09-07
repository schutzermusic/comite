-- ============================================================
-- Fase 7 — 144: CAPACIDADE USA A MESMA SELEÇÃO DA RPC AUTORITATIVA
-- ============================================================
--
-- A 143 separou configuração de capacidade por visualizador. Esta correção
-- faz o caminho de leitura escolher a política aplicável ao evento pelo mesmo
-- seletor determinístico usado por approval_request_create. Uma versão ativa,
-- mas fora da faixa/condição do evento, não pode fazer a UI prometer pedido.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.contract_billing_release_capability(p_billing_event_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e public.contract_billing_events%ROWTYPE;
  actor uuid := auth.uid();
  caller_org uuid;
  subj record;
  policy_version_id uuid;
  has_authority_governance boolean;
BEGIN
  SELECT * INTO e FROM public.contract_billing_events WHERE id = p_billing_event_id;
  caller_org := public.apex_browser_organization();
  IF NOT FOUND OR caller_org IS NULL OR e.organization_id IS DISTINCT FROM caller_org THEN
    RAISE EXCEPTION 'BILLING_EVENT_NOT_FOUND: faturamento inexistente.'
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT * INTO subj FROM public.approval_subject_resolve(
    e.organization_id, 'contract_billing_event', e.id);
  IF subj.supported AND subj.found THEN
    policy_version_id := public.approval_policy_select(
      e.organization_id, 'contract_billing_event', 'release', 'RELEASE',
      subj.amount, subj.currency, subj.contract_type, subj.risk_class,
      subj.cost_center_id, subj.business_unit_id);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.contract_billing_release_authorities a
     WHERE a.organization_id = e.organization_id
       AND a.active AND a.revoked_at IS NULL
       AND a.effective_from <= current_date
       AND (a.effective_until IS NULL OR a.effective_until >= current_date)
       AND (a.contract_id IS NULL OR a.contract_id = e.contract_id)
  ) INTO has_authority_governance;

  IF policy_version_id IS NULL AND NOT has_authority_governance THEN
    RETURN 'NOT_CONFIGURED';
  END IF;
  IF actor IS NULL OR NOT public.current_user_has_permission('contracts.billing.release') THEN
    RETURN 'NOT_AUTHORIZED';
  END IF;
  IF policy_version_id IS NOT NULL THEN RETURN 'REQUEST_APPROVAL'; END IF;
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
  'Capacidade segura do visualizador. REQUEST_APPROVAL só quando '
  'approval_policy_select encontra a mesma política aplicável que a RPC de '
  'liberação usaria; a RPC continua autoritativa.';

COMMIT;
