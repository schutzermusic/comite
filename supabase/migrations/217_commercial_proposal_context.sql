-- ============================================================================
-- 217 — PT + PC = UM CONTEXTO DE PROPOSTA
--
-- A proposta técnica e a comercial do mesmo cliente/obra são dois DOCUMENTOS
-- (número, PDF, revisões, fatos e proveniência próprios) e UMA proposta
-- comercial. Até aqui o banco só sabia disso por acaso — "irmãs da mesma
-- oportunidade" — e PT/PC sem oportunidade ficavam soltas, contadas duas
-- vezes no funil, no forecast e na conta.
--
--   1. `commercial_proposals.context_id` — o contexto. Nasce igual ao próprio
--      id; o segundo documento entra no contexto do primeiro. Imutável depois
--      de gravado. Um contexto tem no máximo uma TÉCNICA e uma COMERCIAL; a
--      COMBINADA é sempre sozinha. Mesma conta e mesma oportunidade.
--   2. Backfill pela MESMA regra que a tela usa para derivar (proposal-
--      context.ts): mesmo cliente, mesmo número-base sem o prefixo PT/PC,
--      exatamente uma TÉCNICA e uma COMERCIAL, sem oportunidade/conta
--      divergentes.
--   3. `commercial_proposal_create` aceita `context_proposal_id`.
--   4. A PT PAREADA com PC não carrega valor: aprovar, enviar e aceitar não
--      exigem valor nela (a PC rege valor e continua exigindo). PT sozinha
--      continua exigindo valor, como antes.
--   5. Aprovação interna do PACOTE: `commercial_proposal_context_transition`
--      move a revisão corrente de cada documento pelo mesmo ato governado de
--      sempre, numa transação — ou todos, ou nenhum.
--   6. Vincular oportunidade ao CONTEXTO: o ato da 216 aplicado a cada
--      documento, numa transação.
--   7. ACEITE DO PACOTE: um livro append-only grava, a cada aceite, as
--      revisões regentes de PT e PC naquele instante + evidência, ator e
--      hora. Revisão posterior nunca herda aceite. Resposta do cliente ao
--      pacote (aceite/recusa/expiração) numa transação.
--   8. Forecast conta contextos, não documentos.
-- ============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Coluna e backfill
-- ---------------------------------------------------------------------------
ALTER TABLE public.commercial_proposals ADD COLUMN IF NOT EXISTS context_id uuid;

CREATE OR REPLACE FUNCTION public.commercial_proposal_base_number(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT upper(regexp_replace(
           regexp_replace(btrim(p), '^(PT|PC)([[:space:]._/-]+|(?=[0-9]))', '', 'i'),
           '[[:space:]]+', '', 'g'))
$$;

ALTER TABLE public.commercial_proposals DISABLE TRIGGER cp_touch;

UPDATE public.commercial_proposals SET context_id = id WHERE context_id IS NULL;

WITH cand AS (
  SELECT organization_id, id, kind, created_at, opportunity_id, party_id,
         public.commercial_proposal_base_number(proposal_number) AS base,
         lower(regexp_replace(btrim(counterparty_name), '[[:space:]]+', ' ', 'g')) AS cp
    FROM public.commercial_proposals
   WHERE kind IN ('TECHNICAL','COMMERCIAL')
), grp AS (
  SELECT organization_id, base, cp,
         array_agg(id ORDER BY created_at, id) FILTER (WHERE kind = 'TECHNICAL')  AS t,
         array_agg(id ORDER BY created_at, id) FILTER (WHERE kind = 'COMMERCIAL') AS c
    FROM cand GROUP BY organization_id, base, cp
), pairs AS (
  SELECT g.organization_id, g.t[1] AS tid, g.c[1] AS cid
    FROM grp g
    JOIN cand pt ON pt.id = g.t[1]
    JOIN cand pc ON pc.id = g.c[1]
   WHERE cardinality(g.t) = 1 AND cardinality(g.c) = 1
     AND (pt.opportunity_id IS NULL OR pc.opportunity_id IS NULL OR pt.opportunity_id = pc.opportunity_id)
     AND (pt.party_id IS NULL OR pc.party_id IS NULL OR pt.party_id = pc.party_id)
)
UPDATE public.commercial_proposals p
   SET context_id = pairs.tid
  FROM pairs
 WHERE p.organization_id = pairs.organization_id AND p.id = pairs.cid;

ALTER TABLE public.commercial_proposals ENABLE TRIGGER cp_touch;

ALTER TABLE public.commercial_proposals ALTER COLUMN context_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cp_context_kind_unique
  ON public.commercial_proposals (organization_id, context_id, kind);
CREATE INDEX IF NOT EXISTS cp_context ON public.commercial_proposals (organization_id, context_id);

COMMENT ON COLUMN public.commercial_proposals.context_id IS
  'Contexto de proposta: PT e PC do mesmo cliente/obra são UMA proposta comercial. Contadores contam contextos.';

-- ---------------------------------------------------------------------------
-- 2) Regras do contexto — no banco, não na tela
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commercial_proposal_context_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE m record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.context_id IS DISTINCT FROM OLD.context_id THEN
      RAISE EXCEPTION 'O contexto de uma proposta não muda depois de gravado.' USING ERRCODE = '23514';
    END IF;
  ELSE
    NEW.context_id := COALESCE(NEW.context_id, NEW.id);
  END IF;

  FOR m IN
    SELECT id, kind, opportunity_id, party_id FROM public.commercial_proposals
     WHERE organization_id = NEW.organization_id AND context_id = NEW.context_id AND id <> NEW.id
  LOOP
    IF NEW.kind = 'COMBINED' OR m.kind = 'COMBINED' THEN
      RAISE EXCEPTION 'Proposta técnica + comercial é um contexto sozinha.' USING ERRCODE = '23514';
    END IF;
    IF NEW.opportunity_id IS NOT NULL AND m.opportunity_id IS NOT NULL AND NEW.opportunity_id <> m.opportunity_id THEN
      RAISE EXCEPTION 'PT e PC do mesmo contexto não podem pertencer a oportunidades diferentes.' USING ERRCODE = '23514';
    END IF;
    IF NEW.party_id IS NOT NULL AND m.party_id IS NOT NULL AND NEW.party_id <> m.party_id THEN
      RAISE EXCEPTION 'PT e PC do mesmo contexto não podem pertencer a contas diferentes.' USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF TG_OP = 'INSERT' AND NEW.context_id <> NEW.id AND NOT EXISTS (
    SELECT 1 FROM public.commercial_proposals
     WHERE organization_id = NEW.organization_id AND id = NEW.context_id) THEN
    RAISE EXCEPTION 'Contexto de proposta não encontrado no inquilino.' USING ERRCODE = 'P0002';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.commercial_proposal_context_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS cp_context_guard ON public.commercial_proposals;
CREATE TRIGGER cp_context_guard
  BEFORE INSERT OR UPDATE OF context_id, opportunity_id, party_id, kind ON public.commercial_proposals
  FOR EACH ROW EXECUTE FUNCTION public.commercial_proposal_context_guard();

-- ---------------------------------------------------------------------------
-- 3) Criar: entrar no contexto de outra proposta
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commercial_proposal_create(
  p_organization_id uuid, p_actor uuid, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_proposal uuid; v_revision uuid;
  v_ctx public.commercial_proposals%ROWTYPE;
  v_context uuid;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Proposal write denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Proposal write requires a named actor.' USING ERRCODE = '42501';
  END IF;

  IF nullif(p_payload->>'context_proposal_id','') IS NOT NULL THEN
    SELECT * INTO v_ctx FROM public.commercial_proposals
     WHERE organization_id = p_organization_id
       AND id = (p_payload->>'context_proposal_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Contexto de proposta não encontrado no inquilino.' USING ERRCODE = 'P0002';
    END IF;
    v_context := v_ctx.context_id;
  END IF;

  INSERT INTO public.commercial_proposals
    (organization_id, opportunity_id, proposal_number, kind, title, party_id,
     counterparty_name, currency, owner_user_id, created_by, context_id)
  VALUES (p_organization_id,
          COALESCE(nullif(p_payload->>'opportunity_id','')::uuid, v_ctx.opportunity_id),
          p_payload->>'proposal_number', p_payload->>'kind',
          COALESCE(nullif(btrim(p_payload->>'title'),''), v_ctx.title),
          COALESCE(nullif(p_payload->>'party_id','')::uuid, v_ctx.party_id),
          COALESCE(nullif(btrim(p_payload->>'counterparty_name'),''), v_ctx.counterparty_name),
          COALESCE(nullif(btrim(p_payload->>'currency'),''), v_ctx.currency, 'BRL'),
          COALESCE(nullif(p_payload->>'owner_user_id','')::uuid, v_ctx.owner_user_id, p_actor), p_actor,
          v_context)
  RETURNING id INTO v_proposal;

  INSERT INTO public.commercial_proposal_revisions
    (organization_id, proposal_id, revision, status, total_value, currency,
     validity_until, payment_terms, scope_summary, acceptance_conditions,
     document_id, created_by)
  VALUES (p_organization_id, v_proposal, 1, 'DRAFT',
          nullif(p_payload->>'total_value','')::numeric,
          nullif(btrim(p_payload->>'currency'),''),
          nullif(p_payload->>'validity_until','')::date,
          nullif(btrim(p_payload->>'payment_terms'),''),
          nullif(btrim(p_payload->>'scope_summary'),''),
          nullif(btrim(p_payload->>'acceptance_conditions'),''),
          nullif(p_payload->>'document_id','')::uuid, p_actor)
  RETURNING id INTO v_revision;

  RETURN jsonb_build_object('proposal_id', v_proposal, 'revision_id', v_revision, 'revision', 1,
                            'context_id', COALESCE(v_context, v_proposal));
END $$;

-- ---------------------------------------------------------------------------
-- 4) Transição: a TÉCNICA não carrega valor — quando há PC no contexto
--
-- Valor é governado pela PC. Uma PT PAREADA com PC é aprovada, enviada e
-- aceita sem valor próprio; uma PT SOZINHA continua exigindo valor (senão um
-- aceite autorizaria trabalho sem preço). A CHECK `cpr_acceptance_has_value`
-- (198) não enxerga o contexto: vira gatilho com a mesma regra + a exceção.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commercial_revision_value_exempt(p_organization_id uuid, p_proposal_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.commercial_proposals t
      JOIN public.commercial_proposals c
        ON c.organization_id = t.organization_id AND c.context_id = t.context_id AND c.kind = 'COMMERCIAL'
     WHERE t.organization_id = p_organization_id AND t.id = p_proposal_id AND t.kind = 'TECHNICAL')
$$;
REVOKE ALL ON FUNCTION public.commercial_revision_value_exempt(uuid,uuid) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.commercial_proposal_revisions DROP CONSTRAINT IF EXISTS cpr_acceptance_has_value;
CREATE OR REPLACE FUNCTION public.commercial_revision_acceptance_has_value()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'ACCEPTED' AND (NEW.total_value IS NULL OR NEW.currency IS NULL)
     AND NOT public.commercial_revision_value_exempt(NEW.organization_id, NEW.proposal_id) THEN
    RAISE EXCEPTION 'Pacote: revisão aceita exige valor e moeda — só a PT pareada com PC é aceita sem valor próprio.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.commercial_revision_acceptance_has_value() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS cpr_acceptance_has_value ON public.commercial_proposal_revisions;
CREATE TRIGGER cpr_acceptance_has_value
  BEFORE INSERT OR UPDATE OF status, total_value, currency ON public.commercial_proposal_revisions
  FOR EACH ROW EXECUTE FUNCTION public.commercial_revision_acceptance_has_value();

CREATE OR REPLACE FUNCTION public.commercial_proposal_revision_transition(
  p_organization_id uuid, p_actor uuid, p_revision_id uuid, p_to text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.commercial_proposal_revisions%ROWTYPE; ok boolean;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Proposal transition denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Proposal transition requires a named actor.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO r FROM public.commercial_proposal_revisions
   WHERE organization_id = p_organization_id AND id = p_revision_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proposal revision not found in tenant.' USING ERRCODE = 'P0002'; END IF;

  ok := CASE r.status
    WHEN 'DRAFT'                THEN p_to IN ('INTERNAL_REVIEW','WITHDRAWN')
    WHEN 'INTERNAL_REVIEW'      THEN p_to IN ('INTERNALLY_APPROVED','DRAFT','WITHDRAWN')
    WHEN 'INTERNALLY_APPROVED'  THEN p_to IN ('SENT','DRAFT','WITHDRAWN')
    WHEN 'SENT'                 THEN p_to IN ('NEGOTIATION','WITHDRAWN')
    WHEN 'NEGOTIATION'          THEN p_to IN ('WITHDRAWN')
    ELSE false END;
  IF NOT ok THEN
    RAISE EXCEPTION 'Proposal revision cannot move from % to %.', r.status, p_to
      USING ERRCODE = '23514';
  END IF;
  IF p_to = 'SENT' AND r.internally_approved_at IS NULL THEN
    RAISE EXCEPTION 'Proposal revision must be internally approved before it is sent.'
      USING ERRCODE = '23514';
  END IF;
  IF p_to IN ('INTERNALLY_APPROVED','SENT') AND r.total_value IS NULL
     AND NOT public.commercial_revision_value_exempt(p_organization_id, r.proposal_id) THEN
    RAISE EXCEPTION 'Proposal revision without a value cannot be approved or sent.'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.commercial_proposal_revisions
     SET status = p_to,
         internal_review_at = CASE WHEN p_to = 'INTERNAL_REVIEW' THEN now() ELSE internal_review_at END,
         internally_approved_at = CASE WHEN p_to = 'INTERNALLY_APPROVED' THEN now()
                                       ELSE internally_approved_at END,
         internally_approved_by = CASE WHEN p_to = 'INTERNALLY_APPROVED' THEN p_actor
                                       ELSE internally_approved_by END,
         sent_at = CASE WHEN p_to = 'SENT' THEN now() ELSE sent_at END,
         sent_by = CASE WHEN p_to = 'SENT' THEN p_actor ELSE sent_by END,
         negotiation_at = CASE WHEN p_to = 'NEGOTIATION' THEN now() ELSE negotiation_at END,
         withdrawn_at = CASE WHEN p_to = 'WITHDRAWN' THEN now() ELSE withdrawn_at END
   WHERE organization_id = p_organization_id AND id = p_revision_id;

  RETURN jsonb_build_object('revision_id', p_revision_id, 'status', p_to);
END $$;

-- ---------------------------------------------------------------------------
-- 5) Aprovação interna do PACOTE
--
-- "Este pacote exato PT/PC pode ir ao cliente?" A revisão CORRENTE (a mais
-- recente) de cada documento anda junto. Documento já adiante é mantido (ex.:
-- PT R01 já aprovada, PC R02 nova); documento atrás bloqueia o pacote inteiro.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commercial_proposal_context_transition(
  p_organization_id uuid, p_actor uuid, p_proposal_id uuid, p_to text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_context uuid;
  m record;
  r public.commercial_proposal_revisions%ROWTYPE;
  v_from text[]; v_ahead text[];
  v_moved jsonb := '[]'::jsonb;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Proposal transition denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Proposal transition requires a named actor.' USING ERRCODE = '42501';
  END IF;

  SELECT context_id INTO v_context FROM public.commercial_proposals
   WHERE organization_id = p_organization_id AND id = p_proposal_id;
  IF v_context IS NULL THEN RAISE EXCEPTION 'Proposal not found in tenant.' USING ERRCODE = 'P0002'; END IF;

  CASE p_to
    WHEN 'INTERNAL_REVIEW' THEN
      v_from := ARRAY['DRAFT'];
      v_ahead := ARRAY['INTERNAL_REVIEW','INTERNALLY_APPROVED','SENT','NEGOTIATION','ACCEPTED'];
    WHEN 'INTERNALLY_APPROVED' THEN
      v_from := ARRAY['INTERNAL_REVIEW'];
      v_ahead := ARRAY['INTERNALLY_APPROVED','SENT','NEGOTIATION','ACCEPTED'];
    WHEN 'SENT' THEN
      v_from := ARRAY['INTERNALLY_APPROVED'];
      v_ahead := ARRAY['SENT','NEGOTIATION','ACCEPTED'];
    WHEN 'DRAFT' THEN
      v_from := ARRAY['INTERNAL_REVIEW','INTERNALLY_APPROVED'];
      v_ahead := ARRAY['DRAFT','SENT','NEGOTIATION','ACCEPTED'];
    ELSE
      RAISE EXCEPTION 'Pacote: transição não suportada (%).', p_to USING ERRCODE = '23514';
  END CASE;

  FOR m IN
    SELECT id, kind, proposal_number FROM public.commercial_proposals
     WHERE organization_id = p_organization_id AND context_id = v_context
     ORDER BY kind, created_at FOR UPDATE
  LOOP
    SELECT * INTO r FROM public.commercial_proposal_revisions
     WHERE organization_id = p_organization_id AND proposal_id = m.id
     ORDER BY revision DESC LIMIT 1;
    IF NOT FOUND OR r.status = 'WITHDRAWN' THEN CONTINUE; END IF;
    IF r.status = ANY (v_ahead) THEN CONTINUE; END IF;
    IF NOT (r.status = ANY (v_from)) THEN
      RAISE EXCEPTION 'Pacote: % R% está em % — o pacote só anda junto.', m.proposal_number,
        lpad(r.revision::text, 2, '0'), r.status USING ERRCODE = '23514';
    END IF;
    PERFORM public.commercial_proposal_revision_transition(p_organization_id, p_actor, r.id, p_to);
    v_moved := v_moved || jsonb_build_object('proposal_id', m.id, 'revision_id', r.id,
                                             'revision', r.revision, 'kind', m.kind);
  END LOOP;

  IF jsonb_array_length(v_moved) = 0 THEN
    RAISE EXCEPTION 'Pacote: nenhum documento pode ir para %.', p_to USING ERRCODE = '23514';
  END IF;
  RETURN jsonb_build_object('context_id', v_context, 'status', p_to, 'moved', v_moved);
END $$;

-- ---------------------------------------------------------------------------
-- 6) Vincular oportunidade ao CONTEXTO (a 216, documento a documento)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commercial_proposal_context_link_opportunity(
  p_organization_id uuid, p_actor uuid, p_proposal_id uuid, p_opportunity_id uuid, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_context uuid; m record; v_one jsonb;
  v_linked int := 0; v_inherited boolean := false; v_currency boolean := false;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Proposal link denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Proposal link requires a named actor.' USING ERRCODE = '42501';
  END IF;
  SELECT context_id INTO v_context FROM public.commercial_proposals
   WHERE organization_id = p_organization_id AND id = p_proposal_id;
  IF v_context IS NULL THEN RAISE EXCEPTION 'Proposal not found in tenant.' USING ERRCODE = 'P0002'; END IF;

  FOR m IN
    SELECT id FROM public.commercial_proposals
     WHERE organization_id = p_organization_id AND context_id = v_context
     ORDER BY created_at
  LOOP
    v_one := public.commercial_proposal_link_opportunity(p_organization_id, p_actor, m.id, p_opportunity_id, p_reason);
    IF (v_one->>'linked')::boolean THEN v_linked := v_linked + 1; END IF;
    v_inherited := v_inherited OR COALESCE((v_one->>'party_inherited')::boolean, false);
    v_currency := v_currency OR COALESCE((v_one->>'currency_differs')::boolean, false);
  END LOOP;

  RETURN jsonb_build_object('proposal_id', p_proposal_id, 'context_id', v_context,
                            'opportunity_id', p_opportunity_id, 'linked', v_linked > 0,
                            'documents_linked', v_linked, 'party_inherited', v_inherited,
                            'currency_differs', v_currency);
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.commercial_proposal_create(uuid,uuid,jsonb)',
    'public.commercial_proposal_revision_transition(uuid,uuid,uuid,text)',
    'public.commercial_proposal_context_transition(uuid,uuid,uuid,text)',
    'public.commercial_proposal_context_link_opportunity(uuid,uuid,uuid,uuid,text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 7) ACEITE DO PACOTE — qual PT + PC exatamente o cliente aceitou
--
-- O aceite continua sendo gravado por revisão (`record_outcome`, 200) — é o
-- que o fechamento/fast-track e a OS já leem. Mas o CONTEXTO precisa
-- responder, de forma determinística, "qual pacote exato foi aceito?". Toda
-- revisão que vira ACCEPTED — pela tela, pelo fechamento, por qualquer
-- caminho governado — grava/atualiza UMA linha deste livro por transação:
-- as revisões regentes de PT, PC (ou combinada) naquele instante, o estado de
-- cada uma, a evidência, quem registrou e quando.
--
--   • `complete` = todas as revisões do instante estavam ACEITAS.
--   • O livro é append-only entre transações: nenhuma revisão posterior
--     herda o aceite. O pacote só é "aceito" se a linha mais recente é
--     completa E as revisões dela ainda são as regentes de cada documento
--     (quem lê compara; `proposal-context.ts` faz isso).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.commercial_proposal_context_acceptances (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  context_id              uuid NOT NULL,
  technical_revision_id   uuid,
  technical_status        text,
  commercial_revision_id  uuid,
  commercial_status       text,
  combined_revision_id    uuid,
  combined_status         text,
  complete                boolean NOT NULL,
  acceptance_source       text,
  acceptance_document_id  uuid,
  acceptance_external_ref text,
  acceptance_note         text,
  recorded_by             uuid REFERENCES auth.users(id),
  accepted_at             timestamptz NOT NULL,
  origin                  text NOT NULL CHECK (origin IN ('package','revision_outcome','backfill')),
  txid                    bigint NOT NULL DEFAULT txid_current(),
  created_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cpca_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT cpca_one_per_tx UNIQUE (organization_id, context_id, txid),
  CONSTRAINT cpca_has_revision CHECK (COALESCE(technical_revision_id, commercial_revision_id, combined_revision_id) IS NOT NULL),
  CONSTRAINT cpca_technical_tenant FOREIGN KEY (organization_id, technical_revision_id)
    REFERENCES public.commercial_proposal_revisions (organization_id, id),
  CONSTRAINT cpca_commercial_tenant FOREIGN KEY (organization_id, commercial_revision_id)
    REFERENCES public.commercial_proposal_revisions (organization_id, id),
  CONSTRAINT cpca_combined_tenant FOREIGN KEY (organization_id, combined_revision_id)
    REFERENCES public.commercial_proposal_revisions (organization_id, id)
);
CREATE INDEX IF NOT EXISTS cpca_context ON public.commercial_proposal_context_acceptances
  (organization_id, context_id, accepted_at DESC);

-- Reescrever só dentro da MESMA transação que criou a linha (o fechamento
-- aceita PT e PC em sequência e a linha fecha o pacote). Depois, nunca.
CREATE OR REPLACE FUNCTION public.commercial_proposal_context_acceptances_no_rewrite()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.txid <> txid_current()
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.context_id IS DISTINCT FROM OLD.context_id
     OR NEW.txid IS DISTINCT FROM OLD.txid THEN
    RAISE EXCEPTION 'commercial_proposal_context_acceptances não se reescreve.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.commercial_proposal_context_acceptances_no_rewrite() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS cpca_no_rewrite ON public.commercial_proposal_context_acceptances;
CREATE TRIGGER cpca_no_rewrite BEFORE UPDATE ON public.commercial_proposal_context_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.commercial_proposal_context_acceptances_no_rewrite();
DROP TRIGGER IF EXISTS cpca_no_erasure ON public.commercial_proposal_context_acceptances;
CREATE TRIGGER cpca_no_erasure BEFORE DELETE ON public.commercial_proposal_context_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

ALTER TABLE public.commercial_proposal_context_acceptances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cpca_select ON public.commercial_proposal_context_acceptances;
CREATE POLICY cpca_select ON public.commercial_proposal_context_acceptances FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND public.current_user_has_permission('commercial.view'));
REVOKE ALL ON TABLE public.commercial_proposal_context_acceptances FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.commercial_proposal_context_acceptances FROM authenticated;
GRANT SELECT ON TABLE public.commercial_proposal_context_acceptances TO authenticated;

/*
  O instantâneo do pacote: a revisão REGENTE de cada documento do contexto
  (a aceita; senão a mais recente) e o estado dela. Chamado pelo gatilho de
  aceite e pelo backfill — uma regra só.
*/
CREATE OR REPLACE FUNCTION public.commercial_proposal_context_snapshot_acceptance(
  p_organization_id uuid, p_context_id uuid, p_origin text, p_evidence public.commercial_proposal_revisions
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m record; v_id uuid; v_complete boolean := true;
  t_id uuid; t_st text; c_id uuid; c_st text; x_id uuid; x_st text;
BEGIN
  FOR m IN
    SELECT DISTINCT ON (r.proposal_id) p.kind, r.id, r.status
      FROM public.commercial_proposals p
      JOIN public.commercial_proposal_revisions r
        ON r.organization_id = p.organization_id AND r.proposal_id = p.id
     WHERE p.organization_id = p_organization_id AND p.context_id = p_context_id
     ORDER BY r.proposal_id, (r.status = 'ACCEPTED') DESC, r.revision DESC
  LOOP
    v_complete := v_complete AND m.status = 'ACCEPTED';
    IF m.kind = 'TECHNICAL' THEN t_id := m.id; t_st := m.status;
    ELSIF m.kind = 'COMMERCIAL' THEN c_id := m.id; c_st := m.status;
    ELSE x_id := m.id; x_st := m.status; END IF;
  END LOOP;

  UPDATE public.commercial_proposal_context_acceptances
     SET technical_revision_id = t_id, technical_status = t_st,
         commercial_revision_id = c_id, commercial_status = c_st,
         combined_revision_id = x_id, combined_status = x_st,
         complete = v_complete,
         acceptance_source = COALESCE(p_evidence.acceptance_source, acceptance_source),
         acceptance_document_id = COALESCE(p_evidence.acceptance_document_id, acceptance_document_id),
         acceptance_external_ref = COALESCE(p_evidence.acceptance_external_ref, acceptance_external_ref),
         acceptance_note = COALESCE(p_evidence.acceptance_note, acceptance_note),
         recorded_by = COALESCE(p_evidence.recorded_by, recorded_by),
         accepted_at = COALESCE(p_evidence.accepted_at, accepted_at)
   WHERE organization_id = p_organization_id AND context_id = p_context_id AND txid = txid_current()
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    INSERT INTO public.commercial_proposal_context_acceptances
      (organization_id, context_id, technical_revision_id, technical_status,
       commercial_revision_id, commercial_status, combined_revision_id, combined_status, complete,
       acceptance_source, acceptance_document_id, acceptance_external_ref, acceptance_note,
       recorded_by, accepted_at, origin)
    VALUES (p_organization_id, p_context_id, t_id, t_st, c_id, c_st, x_id, x_st, v_complete,
            p_evidence.acceptance_source, p_evidence.acceptance_document_id,
            p_evidence.acceptance_external_ref, p_evidence.acceptance_note,
            p_evidence.recorded_by, COALESCE(p_evidence.accepted_at, now()), p_origin)
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.commercial_proposal_revision_acceptance_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_context uuid;
BEGIN
  SELECT context_id INTO v_context FROM public.commercial_proposals
   WHERE organization_id = NEW.organization_id AND id = NEW.proposal_id;
  PERFORM public.commercial_proposal_context_snapshot_acceptance(
    NEW.organization_id, v_context,
    COALESCE(nullif(current_setting('commercial.acceptance_origin', true), ''), 'revision_outcome'), NEW);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS cpr_acceptance_ledger ON public.commercial_proposal_revisions;
CREATE TRIGGER cpr_acceptance_ledger
  AFTER UPDATE OF status ON public.commercial_proposal_revisions
  FOR EACH ROW WHEN (NEW.status = 'ACCEPTED' AND OLD.status IS DISTINCT FROM 'ACCEPTED')
  EXECUTE FUNCTION public.commercial_proposal_revision_acceptance_ledger();

-- Backfill: contexto com revisão já aceita ganha a sua linha (hoje: nenhuma).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (p.organization_id, p.context_id) p.organization_id, p.context_id, rv AS evidence
      FROM public.commercial_proposal_revisions rv
      JOIN public.commercial_proposals p ON p.organization_id = rv.organization_id AND p.id = rv.proposal_id
     WHERE rv.status = 'ACCEPTED'
     ORDER BY p.organization_id, p.context_id, rv.accepted_at DESC NULLS LAST
  LOOP
    PERFORM public.commercial_proposal_context_snapshot_acceptance(r.organization_id, r.context_id, 'backfill', r.evidence);
  END LOOP;
END $$;

/*
  RESPOSTA DO CLIENTE AO PACOTE. Aceite, recusa e expiração valem para o
  pacote que está com o cliente: a revisão regente de CADA documento, pelo
  mesmo `record_outcome` de sempre, numa transação. Aceitar exige que todos
  estejam enviados/em negociação (ou já aceitos) — o cliente não aceita
  um documento que não recebeu.
*/
CREATE OR REPLACE FUNCTION public.commercial_proposal_context_record_outcome(
  p_organization_id uuid, p_actor uuid, p_proposal_id uuid, p_outcome text, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_context uuid; m record; v_moved jsonb := '[]'::jsonb; v_acc public.commercial_proposal_context_acceptances%ROWTYPE;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Recording a customer outcome is denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Customer outcome must be recorded by a named human actor.' USING ERRCODE = '42501';
  END IF;
  IF p_outcome NOT IN ('ACCEPTED','REJECTED','EXPIRED') THEN
    RAISE EXCEPTION 'Pacote: resultado não suportado (%).', p_outcome USING ERRCODE = '22023';
  END IF;
  SELECT context_id INTO v_context FROM public.commercial_proposals
   WHERE organization_id = p_organization_id AND id = p_proposal_id;
  IF v_context IS NULL THEN RAISE EXCEPTION 'Proposal not found in tenant.' USING ERRCODE = 'P0002'; END IF;

  PERFORM set_config('commercial.acceptance_origin', 'package', true);
  FOR m IN
    SELECT DISTINCT ON (r.proposal_id) p.id AS proposal_id, p.kind, p.proposal_number,
           r.id AS revision_id, r.revision, r.status
      FROM public.commercial_proposals p
      JOIN public.commercial_proposal_revisions r
        ON r.organization_id = p.organization_id AND r.proposal_id = p.id
     WHERE p.organization_id = p_organization_id AND p.context_id = v_context
     ORDER BY r.proposal_id, (r.status = 'ACCEPTED') DESC, r.revision DESC
  LOOP
    IF p_outcome = 'ACCEPTED' THEN
      CONTINUE WHEN m.status = 'ACCEPTED';
      IF m.status NOT IN ('SENT','NEGOTIATION') THEN
        RAISE EXCEPTION 'Pacote: % R% está em % — o cliente só aceita o pacote que recebeu. Aprove e envie o pacote inteiro antes.',
          m.proposal_number, lpad(m.revision::text, 2, '0'), m.status USING ERRCODE = '23514';
      END IF;
    ELSE
      CONTINUE WHEN m.status NOT IN ('SENT','NEGOTIATION');
    END IF;
    PERFORM public.commercial_proposal_revision_record_outcome(p_organization_id, p_actor, m.revision_id, p_outcome, p_payload);
    v_moved := v_moved || jsonb_build_object('proposal_id', m.proposal_id, 'revision_id', m.revision_id,
                                             'revision', m.revision, 'kind', m.kind);
  END LOOP;
  PERFORM set_config('commercial.acceptance_origin', '', true);

  IF jsonb_array_length(v_moved) = 0 THEN
    RAISE EXCEPTION 'Pacote: nenhum documento com o cliente pode receber %.', p_outcome USING ERRCODE = '23514';
  END IF;
  IF p_outcome = 'ACCEPTED' THEN
    SELECT * INTO v_acc FROM public.commercial_proposal_context_acceptances
     WHERE organization_id = p_organization_id AND context_id = v_context AND txid = txid_current();
  END IF;
  RETURN jsonb_build_object('context_id', v_context, 'status', p_outcome, 'moved', v_moved,
    'acceptance', CASE WHEN v_acc.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_acc.id, 'technical_revision_id', v_acc.technical_revision_id,
      'commercial_revision_id', v_acc.commercial_revision_id, 'combined_revision_id', v_acc.combined_revision_id,
      'complete', v_acc.complete, 'accepted_at', v_acc.accepted_at, 'recorded_by', v_acc.recorded_by) END);
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.commercial_proposal_context_record_outcome(uuid,uuid,uuid,text,jsonb)',
    'public.commercial_proposal_context_snapshot_acceptance(uuid,uuid,text,public.commercial_proposal_revisions)',
    'public.commercial_proposal_revision_acceptance_ledger()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.commercial_proposal_context_record_outcome(uuid,uuid,uuid,text,jsonb) TO service_role';
END $$;

-- ---------------------------------------------------------------------------
-- 8) Forecast: contextos, não documentos
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.commercial_forecast_read_model
WITH (security_invoker = true) AS
WITH stage_default AS (
  SELECT * FROM (VALUES
    ('QUALIFICATION', 0.10::numeric), ('DISCOVERY', 0.25::numeric),
    ('PROPOSAL', 0.45::numeric), ('NEGOTIATION', 0.70::numeric)
  ) AS t(stage, p)
)
SELECT
  o.organization_id,
  o.id                                   AS opportunity_id,
  o.code, o.title, o.counterparty_name, o.party_id,
  o.stage, o.currency,
  o.estimated_value,
  o.probability                          AS informed_probability,
  COALESCE(o.probability, sd.p)          AS applied_probability,
  CASE WHEN o.probability IS NOT NULL THEN 'informed' ELSE 'stage_default' END
                                         AS probability_source,
  round(COALESCE(o.estimated_value, 0) * COALESCE(o.probability, sd.p, 0), 2)
                                         AS weighted_value,
  o.expected_decision_date,
  o.owner_user_id,
  o.engagement_id,
  (SELECT count(DISTINCT p.context_id)::int FROM public.commercial_proposals p
    WHERE p.opportunity_id = o.id)       AS proposal_count,
  -- Pacote ACEITO = todo documento do contexto tem revisão aceita (a aceita rege).
  (SELECT count(*)::int FROM (
     SELECT p.context_id FROM public.commercial_proposals p
      WHERE p.opportunity_id = o.id
      GROUP BY p.context_id
     HAVING bool_and(EXISTS (SELECT 1 FROM public.commercial_proposal_revisions r
                              WHERE r.organization_id = p.organization_id AND r.proposal_id = p.id
                                AND r.status = 'ACCEPTED'))) accepted_packages)
                                         AS accepted_revision_count
FROM public.commercial_opportunities o
LEFT JOIN stage_default sd ON sd.stage = o.stage
WHERE o.stage NOT IN ('WON','LOST','ABANDONED');

COMMENT ON VIEW public.commercial_forecast_read_model IS
  'Forecast ponderado, derivado. Conta CONTEXTOS de proposta (PT+PC = 1). Nada aqui é persistido nem alimenta receita contratada.';

COMMIT;
