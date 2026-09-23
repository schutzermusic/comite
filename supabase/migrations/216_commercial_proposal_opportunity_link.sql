-- ============================================================================
-- 216 — VINCULAR UMA PROPOSTA JÁ CRIADA À SUA OPORTUNIDADE
--
-- `commercial_proposals.opportunity_id` só era gravado na criação (202). Uma
-- proposta que nasceu solta — importada antes de a oportunidade existir, ou
-- cadastrada às pressas — ficava para sempre sem fechamento, sem cliente do
-- cadastro único e sem comparação PT × PC: não havia ato governado para
-- ligá-la, e a tela não escreve por fora de um.
--
-- Este é o ato. Mínimo de propósito:
--   * VINCULA; não troca nem desfaz. Uma proposta já ligada a outra
--     oportunidade é recusada — mover proposta entre funis reescreveria a
--     história do forecast e da cadeia de origem, e isso não é um clique.
--   * Mesmo inquilino, oportunidade viva (não perdida nem abandonada).
--   * Conta coerente: se as duas têm conta do cadastro único, tem de ser a
--     MESMA; se só a oportunidade tem, a proposta a herda.
--   * Trabalho autorizado coerente: se a proposta já autorizou trabalho e a
--     oportunidade aponta para OUTRO trabalho, o vínculo é recusado.
--   * Histórico append-only com ator, motivo e o que foi herdado.
-- ============================================================================
BEGIN;

CREATE TABLE public.commercial_proposal_link_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  proposal_id      uuid NOT NULL,
  opportunity_id   uuid NOT NULL,
  party_inherited  boolean NOT NULL DEFAULT false,
  reason           text,
  actor_user_id    uuid NOT NULL REFERENCES auth.users(id),
  occurred_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cple_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT cple_proposal_tenant FOREIGN KEY (organization_id, proposal_id)
    REFERENCES public.commercial_proposals (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT cple_opportunity_tenant FOREIGN KEY (organization_id, opportunity_id)
    REFERENCES public.commercial_opportunities (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX cple_proposal ON public.commercial_proposal_link_events (organization_id, proposal_id, occurred_at DESC);

-- História: reescrever é proibido a todos; apagar segue a regra canônica (210).
CREATE OR REPLACE FUNCTION public.commercial_proposal_link_events_no_rewrite()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'commercial_proposal_link_events não se reescreve.' USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION public.commercial_proposal_link_events_no_rewrite() FROM PUBLIC;
CREATE TRIGGER cple_no_rewrite BEFORE UPDATE ON public.commercial_proposal_link_events
  FOR EACH ROW EXECUTE FUNCTION public.commercial_proposal_link_events_no_rewrite();
CREATE TRIGGER cple_no_erasure BEFORE DELETE ON public.commercial_proposal_link_events
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

ALTER TABLE public.commercial_proposal_link_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY cple_select ON public.commercial_proposal_link_events FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND public.current_user_has_permission('commercial.view'));
REVOKE ALL ON TABLE public.commercial_proposal_link_events FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.commercial_proposal_link_events FROM authenticated;
GRANT SELECT ON TABLE public.commercial_proposal_link_events TO authenticated;

CREATE OR REPLACE FUNCTION public.commercial_proposal_link_opportunity(
  p_organization_id uuid, p_actor uuid, p_proposal_id uuid, p_opportunity_id uuid, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_prop public.commercial_proposals%ROWTYPE;
  v_opp  public.commercial_opportunities%ROWTYPE;
  v_inherit boolean := false;
  v_conflicting_work boolean;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Proposal link denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Proposal link requires a named actor.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prop FROM public.commercial_proposals
   WHERE organization_id = p_organization_id AND id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proposal not found in tenant.' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_opp FROM public.commercial_opportunities
   WHERE organization_id = p_organization_id AND id = p_opportunity_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Opportunity not found in tenant.' USING ERRCODE = 'P0002'; END IF;

  -- Repetir o mesmo vínculo não é erro nem evento novo.
  IF v_prop.opportunity_id = p_opportunity_id THEN
    RETURN jsonb_build_object('proposal_id', v_prop.id, 'opportunity_id', p_opportunity_id,
                              'linked', false, 'party_inherited', false);
  END IF;
  IF v_prop.opportunity_id IS NOT NULL THEN
    RAISE EXCEPTION 'A proposta já pertence a outra oportunidade; mover proposta entre oportunidades não é um vínculo.'
      USING ERRCODE = '23514';
  END IF;
  IF v_opp.stage IN ('LOST','ABANDONED') THEN
    RAISE EXCEPTION 'A oportunidade está encerrada (%); vincule a uma oportunidade viva.', v_opp.stage
      USING ERRCODE = '23514';
  END IF;
  IF v_prop.party_id IS NOT NULL AND v_opp.party_id IS NOT NULL AND v_prop.party_id <> v_opp.party_id THEN
    RAISE EXCEPTION 'A proposta e a oportunidade pertencem a contas diferentes do cadastro único.'
      USING ERRCODE = '23514';
  END IF;

  -- Trabalho já autorizado por esta proposta não pode divergir do da oportunidade.
  SELECT EXISTS (
    SELECT 1 FROM public.commercial_engagement_authorizations a
      JOIN public.commercial_proposal_revisions r
        ON r.organization_id = a.organization_id AND r.id = a.proposal_revision_id
     WHERE a.organization_id = p_organization_id AND r.proposal_id = v_prop.id
       AND v_opp.engagement_id IS NOT NULL AND a.engagement_id <> v_opp.engagement_id
  ) INTO v_conflicting_work;
  IF v_conflicting_work THEN
    RAISE EXCEPTION 'A proposta já autorizou um trabalho diferente do trabalho desta oportunidade.'
      USING ERRCODE = '23514';
  END IF;

  v_inherit := v_prop.party_id IS NULL AND v_opp.party_id IS NOT NULL;
  UPDATE public.commercial_proposals
     SET opportunity_id = p_opportunity_id,
         party_id = COALESCE(party_id, v_opp.party_id)
   WHERE organization_id = p_organization_id AND id = v_prop.id;

  INSERT INTO public.commercial_proposal_link_events
    (organization_id, proposal_id, opportunity_id, party_inherited, reason, actor_user_id)
  VALUES (p_organization_id, v_prop.id, p_opportunity_id, v_inherit,
          nullif(btrim(p_reason), ''), p_actor);

  RETURN jsonb_build_object('proposal_id', v_prop.id, 'opportunity_id', p_opportunity_id,
                            'linked', true, 'party_inherited', v_inherit,
                            'currency_differs', v_prop.currency <> v_opp.currency);
END $$;
REVOKE ALL ON FUNCTION public.commercial_proposal_link_opportunity(uuid,uuid,uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commercial_proposal_link_opportunity(uuid,uuid,uuid,uuid,text) TO service_role;

COMMIT;
