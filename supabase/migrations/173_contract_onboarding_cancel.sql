-- 173 — Hard-delete an unfinished document-first contract intake.
-- Removes the intake row entirely (not soft CANCELLED) so the same PDF can be
-- uploaded again without colliding on coni_content_actor_unique / file_path.
-- The API removes the Storage object using the returned file_path.
BEGIN;

CREATE OR REPLACE FUNCTION public.contract_onboarding_cancel(
  p_organization_id uuid, p_intake_id uuid, p_actor uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  r public.contract_onboarding_intakes%ROWTYPE;
  v_file_path text;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Contract onboarding cancel denied.' USING ERRCODE='42501';
  END IF;

  SELECT * INTO r FROM public.contract_onboarding_intakes
    WHERE organization_id=p_organization_id AND id=p_intake_id FOR UPDATE;
  IF NOT FOUND OR r.uploaded_by<>p_actor THEN
    RAISE EXCEPTION 'Contract intake not found in tenant.' USING ERRCODE='P0002';
  END IF;

  -- Já virou contrato canônico: não há cadastro em andamento para excluir.
  IF r.contract_id IS NOT NULL OR r.status='REGISTERED' THEN
    RAISE EXCEPTION 'Contract intake can no longer be cancelled.' USING ERRCODE='23514';
  END IF;

  v_file_path := r.file_path;

  -- Encerra trabalho ainda pendente ligado a esta entrada (se houver).
  IF r.job_id IS NOT NULL THEN
    UPDATE public.apex_jobs
       SET status='CANCELLED',
           completed_at=COALESCE(completed_at, now()),
           locked_at=NULL, locked_by=NULL, lock_token=NULL, lease_expires_at=NULL,
           last_error_code='intake_cancelled',
           last_error_safe='Cadastro de contrato excluído pelo usuário.'
     WHERE organization_id=r.organization_id
       AND id=r.job_id
       AND status IN ('PENDING','DEAD_LETTER');
  END IF;

  DELETE FROM public.contract_onboarding_intakes
   WHERE id=r.id AND organization_id=r.organization_id;

  RETURN jsonb_build_object(
    'intake_id', r.id,
    'deleted', true,
    'file_path', v_file_path
  );
END $$;

REVOKE ALL ON FUNCTION public.contract_onboarding_cancel(uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.contract_onboarding_cancel(uuid,uuid,uuid) TO service_role;

COMMIT;
