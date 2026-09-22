-- ============================================================================
-- 207 — O APAGAMENTO GOVERNADO VOLTA A ATRAVESSAR A SUBÁRVORE INTEIRA
--
-- ─── O que quebrou ───────────────────────────────────────────────────────
--
-- A 197 declarou `cea_contract_tenant` como ON DELETE RESTRICT, com a
-- intenção de proteger a referência. O efeito foi outro: o apagamento
-- privilegiado de um contrato — o mesmo caminho que a Fase 2 provou e que a
-- Fase 7.5 usa para limpar um inquilino inteiro — passou a falhar, porque a
-- linha de autorização segurava o contrato.
--
-- Isso não ficou em teste. A limpeza de `phase75-multi-organization-live`
-- abortou no meio e DEIXOU dados para trás no banco vivo: dois contratos
-- `[P75]` e duas `parties` `[P75]`. Um RESTRICT mal colocado não bloqueia uma
-- operação — ele bloqueia a FAXINA dela, e o resíduo é pior que a operação.
--
-- ─── Por que CASCADE é a resposta certa, e não um relaxamento ────────────
--
-- A linha de autorização não é um fato independente: ela AFIRMA que um
-- instrumento autoriza um trabalho. Apagado o instrumento, a afirmação perde
-- o referente. Mantê-la seria preservar a frase "o contrato X autoriza este
-- trabalho" depois que X deixou de existir — o oposto de integridade.
--
-- O mesmo vale para documento e revisão de proposta: cada um é a EVIDÊNCIA da
-- autorização, e evidência apagada não deixa autorização órfã.
--
-- ─── O que continua protegido ────────────────────────────────────────────
--
-- `iso_engagement_tenant` segue RESTRICT: um trabalho autorizado com Ordem de
-- Serviço emitida não some por apagamento de outra coisa. E o engajamento só
-- é removido junto quando NADA mais pende dele — a regra está no gatilho
-- abaixo, e ela é deliberadamente conservadora.
-- ============================================================================

BEGIN;

ALTER TABLE public.commercial_engagement_authorizations
  DROP CONSTRAINT cea_contract_tenant,
  ADD CONSTRAINT cea_contract_tenant FOREIGN KEY (organization_id, contract_id)
    REFERENCES public.contracts (organization_id, id) ON DELETE CASCADE,
  DROP CONSTRAINT cea_document_tenant,
  ADD CONSTRAINT cea_document_tenant FOREIGN KEY (organization_id, document_id)
    REFERENCES public.contract_documents (organization_id, id) ON DELETE CASCADE,
  DROP CONSTRAINT cea_proposal_revision_tenant,
  ADD CONSTRAINT cea_proposal_revision_tenant
    FOREIGN KEY (organization_id, proposal_revision_id)
    REFERENCES public.commercial_proposal_revisions (organization_id, id) ON DELETE CASCADE;

ALTER TABLE public.commercial_proposal_revisions
  DROP CONSTRAINT cpr_document_tenant,
  ADD CONSTRAINT cpr_document_tenant FOREIGN KEY (organization_id, document_id)
    REFERENCES public.contract_documents (organization_id, id) ON DELETE SET NULL,
  DROP CONSTRAINT cpr_acceptance_document_tenant,
  ADD CONSTRAINT cpr_acceptance_document_tenant
    FOREIGN KEY (organization_id, acceptance_document_id)
    REFERENCES public.contract_documents (organization_id, id) ON DELETE SET NULL;

/*
  SET NULL e não CASCADE nas duas acima: o PDF pode ser removido do acervo sem
  que a revisão deixe de ter existido. O aceite continua registrado — com
  fonte, data e quem registrou —, apenas sem o anexo. Apagar a revisão junto
  destruiria a história comercial por causa de um arquivo.

  `cpr_acceptance_document_tenant` perde o documento e mantém
  `acceptance_source` e `recorded_by`, que é o que `cpr_acceptance_is_attributed`
  exige. Nenhuma constraint fica insatisfeita.
*/

-- ---------------------------------------------------------------------------
-- O engajamento sai junto SOMENTE quando não sobra nada
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commercial_engagement_drop_if_empty()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_engagement uuid;
BEGIN
  v_engagement := OLD.engagement_id;
  IF v_engagement IS NULL THEN RETURN OLD; END IF;

  /*
    A lista de guardas é longa de propósito. `project_measurements` referencia
    o engajamento com ON DELETE CASCADE — apagar um engajamento com medição
    apagaria MEDIÇÃO ACEITA, que é história de governança e nunca some por
    efeito colateral. Cada linha abaixo é uma razão concreta para o
    engajamento continuar existindo.
  */
  IF EXISTS (SELECT 1 FROM public.commercial_engagement_authorizations
              WHERE engagement_id = v_engagement)
  OR EXISTS (SELECT 1 FROM public.internal_service_orders
              WHERE engagement_id = v_engagement)
  OR EXISTS (SELECT 1 FROM public.project_measurements
              WHERE engagement_id = v_engagement)
  OR EXISTS (SELECT 1 FROM public.contract_measurement_requirements
              WHERE engagement_id = v_engagement)
  OR EXISTS (SELECT 1 FROM public.engagement_project_links
              WHERE engagement_id = v_engagement)
  OR EXISTS (SELECT 1 FROM public.commercial_divergences
              WHERE engagement_id = v_engagement)
  OR EXISTS (SELECT 1 FROM public.contracts
              WHERE engagement_id = v_engagement AND id <> OLD.id)
  THEN
    RETURN OLD;
  END IF;

  DELETE FROM public.commercial_engagement_history WHERE engagement_id = v_engagement;
  DELETE FROM public.commercial_engagements WHERE id = v_engagement;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.commercial_engagement_drop_if_empty()
  FROM PUBLIC, anon, authenticated;

/*
  AFTER DELETE: as cascatas de `cea_contract_tenant` e de
  `contract_project_links` já correram, então as guardas acima enxergam o
  estado final. Num BEFORE, a autorização ainda existiria e o engajamento
  nunca seria removido.
*/
CREATE TRIGGER contracts_drop_empty_engagement
  AFTER DELETE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.commercial_engagement_drop_if_empty();

COMMIT;
