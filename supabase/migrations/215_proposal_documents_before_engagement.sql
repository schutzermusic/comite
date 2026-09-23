-- ============================================================================
-- 215 — O PDF DA PROPOSTA ANTES DE EXISTIR TRABALHO AUTORIZADO
--
-- A 199 generalizou `contract_documents` para pender de contrato OU de
-- engajamento. Faltou o caso mais comum do funil: a proposta técnica e a
-- comercial são escritas, revisadas e enviadas MUITO antes de qualquer
-- engajamento existir — e `commercial_proposal_revisions.document_id` aponta
-- para `contract_documents`, que recusava a linha sem pai.
--
-- A saída é a mesma da 213 para o levantamento: um terceiro pai possível
-- (`proposal_id`), a mesma tabela, o mesmo bucket, nenhum sistema paralelo de
-- arquivos. Quando o trabalho for autorizado, o documento continua sendo a
-- MESMA linha — a cadeia de origem do projeto aponta para ela.
-- ============================================================================
BEGIN;

ALTER TABLE public.contract_documents ADD COLUMN IF NOT EXISTS proposal_id uuid;
ALTER TABLE public.contract_documents
  ADD CONSTRAINT cdoc_proposal_tenant FOREIGN KEY (organization_id, proposal_id)
    REFERENCES public.commercial_proposals (organization_id, id) ON DELETE CASCADE;
ALTER TABLE public.contract_documents DROP CONSTRAINT cdoc_has_parent;
ALTER TABLE public.contract_documents
  ADD CONSTRAINT cdoc_has_parent CHECK (
    contract_id IS NOT NULL OR engagement_id IS NOT NULL
    OR site_survey_id IS NOT NULL OR proposal_id IS NOT NULL);

CREATE UNIQUE INDEX contract_documents_proposal_content_once
  ON public.contract_documents (organization_id, proposal_id, content_sha256)
  WHERE proposal_id IS NOT NULL AND content_sha256 IS NOT NULL AND superseded_by_document_id IS NULL;
CREATE INDEX cdoc_proposal ON public.contract_documents (organization_id, proposal_id)
  WHERE proposal_id IS NOT NULL;

DROP POLICY contract_documents_select ON public.contract_documents;
CREATE POLICY contract_documents_select ON public.contract_documents FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND (
       (contract_id IS NOT NULL AND public.current_user_can_read_contract(contract_id))
       OR (contract_id IS NULL AND engagement_id IS NOT NULL
           AND public.current_user_has_permission('contracts.view'))
       OR (contract_id IS NULL AND engagement_id IS NULL AND site_survey_id IS NOT NULL
           AND (public.current_user_has_permission('commercial.view')
                OR public.current_user_has_permission('commercial.surveys.manage')))
       OR (contract_id IS NULL AND engagement_id IS NULL AND proposal_id IS NOT NULL
           AND public.current_user_has_permission('commercial.view'))
     ));

-- A política de escrita do navegador continua fora dos pais comerciais novos.
DROP POLICY contract_documents_manage ON public.contract_documents;
CREATE POLICY contract_documents_manage ON public.contract_documents FOR ALL TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND site_survey_id IS NULL AND proposal_id IS NULL
     AND (public.current_user_is_admin()
          OR public.current_user_has_permission('contracts.documents.upload')
          OR public.current_user_has_permission('contracts.edit')))
  WITH CHECK (organization_id = public.current_user_organization_id()
     AND site_survey_id IS NULL AND proposal_id IS NULL
     AND (public.current_user_is_admin()
          OR public.current_user_has_permission('contracts.documents.upload')
          OR public.current_user_has_permission('contracts.edit')));

/*
  Registrar o PDF de uma revisão. Uma revisão tem UM documento de registro:
  se já tem outro, a resposta é criar a revisão seguinte, não trocar o
  arquivo da anterior — trocar reescreveria o que o cliente recebeu.
*/
CREATE OR REPLACE FUNCTION public.commercial_proposal_register_document(
  p_organization_id uuid, p_actor uuid, p_revision_id uuid, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rev public.commercial_proposal_revisions%ROWTYPE; v_prop public.commercial_proposals%ROWTYPE;
  v_doc uuid; v_sha text; v_type text; v_reused boolean := false;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Proposal document write denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Proposal document requires a named actor.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_rev FROM public.commercial_proposal_revisions
   WHERE organization_id = p_organization_id AND id = p_revision_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proposal revision not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_prop FROM public.commercial_proposals
   WHERE organization_id = p_organization_id AND id = v_rev.proposal_id;
  IF (p_payload->>'file_path') IS NULL
     OR position(p_organization_id::text || '/' IN p_payload->>'file_path') <> 1 THEN
    RAISE EXCEPTION 'Proposal document path is outside the tenant.' USING ERRCODE = '42501';
  END IF;
  v_sha := nullif(p_payload->>'content_sha256', '');
  v_type := CASE v_prop.kind WHEN 'TECHNICAL' THEN 'technical_proposal' ELSE 'commercial_proposal' END;

  IF v_sha IS NOT NULL THEN
    SELECT id INTO v_doc FROM public.contract_documents
     WHERE organization_id = p_organization_id AND proposal_id = v_prop.id
       AND content_sha256 = v_sha AND superseded_by_document_id IS NULL;
    v_reused := FOUND;
  END IF;
  IF v_rev.document_id IS NOT NULL AND v_rev.document_id IS DISTINCT FROM v_doc THEN
    RAISE EXCEPTION 'Proposal revision % already has its document; create the next revision instead of replacing it.',
      v_rev.revision USING ERRCODE = '23514';
  END IF;

  IF v_doc IS NULL THEN
    INSERT INTO public.contract_documents (
      organization_id, proposal_id, title, file_path, document_type, status, uploaded_by, content_sha256)
    VALUES (p_organization_id, v_prop.id,
            COALESCE(nullif(btrim(p_payload->>'title'), ''), v_prop.proposal_number || ' R' || v_rev.revision),
            p_payload->>'file_path', v_type, 'uploaded', p_actor, v_sha)
    RETURNING id INTO v_doc;
  END IF;

  UPDATE public.commercial_proposal_revisions SET document_id = v_doc
   WHERE organization_id = p_organization_id AND id = p_revision_id AND document_id IS NULL;

  RETURN jsonb_build_object('document_id', v_doc, 'reused', v_reused,
                            'document_context', CASE v_prop.kind WHEN 'TECHNICAL' THEN 'TECHNICAL_PROPOSAL'
                                                                 ELSE 'COMMERCIAL_PROPOSAL' END);
END $$;
REVOKE ALL ON FUNCTION public.commercial_proposal_register_document(uuid,uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commercial_proposal_register_document(uuid,uuid,uuid,jsonb) TO service_role;

COMMIT;
