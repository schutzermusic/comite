-- ============================================================================
-- 213 — LEVANTAMENTO TÉCNICO, FECHAMENTO GOVERNADO E INÍCIO EXCEPCIONAL
--
-- ─── O que esta migration acrescenta ─────────────────────────────────────
--
-- 1. `commercial_site_surveys` — o levantamento técnico PERTENCE à
--    oportunidade. Não é módulo, não é projeto, não é OS: é descoberta antes
--    da proposta. Os arquivos de campo (fotos, vídeos, relatórios recebidos)
--    vivem em `contract_documents`, o acervo canônico, com um terceiro pai
--    possível (`site_survey_id`). Nenhum segundo sistema de arquivos.
--
-- 2. `commercial_execution_starts` — o REGISTRO do ato "fechar negócio e
--    iniciar execução": qual base comercial, que data, qual evidência, quem
--    confirmou. Não é um fluxo paralelo: a função que o grava orquestra os
--    objetos canônicos que já existem (engajamento, autorização, OS interna,
--    vínculo de projeto) chamando AS MESMAS funções governadas da 200/208.
--    Uma linha por engajamento — é ela que torna o fechamento idempotente.
--
-- 3. Início EXCEPCIONAL — trabalho que começa com documentação pendente.
--    O engajamento fica AUTORIZADO (o projeto pode rodar), e a pendência fica
--    registrada, com dono e prazo de regularização. O faturamento é o que
--    trava: `contract_billing_eligibility_resolve` passa a acrescentar o
--    bloqueio COMMERCIAL_DOCUMENTATION_PENDING enquanto houver pendência.
--    Medição, revisão e aceite continuam no motor de sempre — medir não é
--    faturar, e travar a medição esconderia o trabalho feito.
--
-- ─── O que esta migration NÃO faz ────────────────────────────────────────
--
-- Não cria medição, faturamento, projeto ou OS paralelos. Não cria estado
-- novo em `commercial_engagements.status`: "autorizado com documentação
-- pendente" é AUTHORIZED + uma pendência aberta em
-- `commercial_execution_starts`, porque trinta lugares já perguntam
-- `status = 'AUTHORIZED'` e um estado novo os faria mentir por omissão.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) Permissões novas
-- ---------------------------------------------------------------------------
INSERT INTO public.permissions (key, module, action, description) VALUES
  ('commercial.surveys.manage', 'commercial', 'surveys.manage',
   'Solicitar, executar e concluir levantamento técnico de oportunidade'),
  ('commercial.execution.start', 'commercial', 'execution.start',
   'Fechar negócio e iniciar execução a partir de base comercial comprovada'),
  ('commercial.execution.start_exceptional', 'commercial', 'execution.start_exceptional',
   'Iniciar execução com documentação comercial pendente (início excepcional)')
ON CONFLICT (key) DO NOTHING;

/*
  Concessões espelham a alçada que cada papel já exerce (mesma lógica da 211).

  • engenharia_pcp recebe SÓ o levantamento. É quem vai a campo. A 211 negou a
    este papel o funil comercial — preço e probabilidade — e isso continua
    valendo: a leitura do levantamento não expõe valor da oportunidade.
  • início excepcional é de quem decide risco comercial: owner_admin e
    ceo_diretoria. Jurídico/Contratos fecha negócio COM base comprovada, mas
    não dispensa a base.
*/
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
  JOIN public.permissions p ON p.key = ANY (CASE r.key
    WHEN 'owner_admin'        THEN ARRAY['commercial.surveys.manage','commercial.execution.start',
                                         'commercial.execution.start_exceptional']
    WHEN 'ceo_diretoria'      THEN ARRAY['commercial.execution.start',
                                         'commercial.execution.start_exceptional']
    WHEN 'juridico_contratos' THEN ARRAY['commercial.surveys.manage','commercial.execution.start']
    WHEN 'gestor_projetos'    THEN ARRAY['commercial.surveys.manage']
    WHEN 'engenharia_pcp'     THEN ARRAY['commercial.surveys.manage']
    ELSE ARRAY[]::text[] END)
 WHERE r.organization_id IS NULL
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 1) Levantamento técnico
-- ---------------------------------------------------------------------------
CREATE TABLE public.commercial_site_surveys (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id        uuid NOT NULL,
  code                  text NOT NULL CHECK (btrim(code) <> ''),
  title                 text NOT NULL CHECK (btrim(title) <> ''),

  party_id              uuid,
  counterparty_name     text NOT NULL CHECK (btrim(counterparty_name) <> ''),
  site_name             text,
  site_address          text,
  purpose               text NOT NULL CHECK (btrim(purpose) <> ''),

  technical_responsible_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  planned_visit_date    date,

  status                text NOT NULL DEFAULT 'PLANNED'
                          CHECK (status IN ('PLANNED','SCHEDULED','IN_FIELD','AWAITING_REPORT',
                                            'COMPLETED','CANCELLED')),
  scheduled_at          timestamptz,
  started_at            timestamptz,
  field_finished_at     timestamptz,
  completed_at          timestamptz,
  completed_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at          timestamptz,
  cancel_reason         text,

  /*
    O que o engenheiro REGISTROU. Estrutura por seção (equipamentos,
    condições, medições, dados de placa, acesso, infraestrutura, riscos,
    materiais, atividades estimadas, dependências do cliente, notas). É
    verdade de campo, atribuída a quem registrou pelo histórico.
  */
  findings              jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(findings) = 'object'),
  checklist             jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(checklist) = 'array'),
  open_questions        jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(open_questions) = 'array'),

  /*
    O que a APEX PROPÔS a partir do levantamento. Coluna SEPARADA de
    `findings` de propósito: a leitura assistida nunca escreve na verdade de
    campo. Cada item carrega confiança e origem; virar escopo de proposta é
    decisão de gente, feita na proposta.
  */
  apex_candidate        jsonb CHECK (apex_candidate IS NULL OR jsonb_typeof(apex_candidate) = 'object'),
  apex_generated_at     timestamptz,
  apex_provider         text,
  apex_model            text,
  apex_pipeline_version text,

  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT css_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT css_code_unique UNIQUE (organization_id, code),
  CONSTRAINT css_opportunity_tenant FOREIGN KEY (organization_id, opportunity_id)
    REFERENCES public.commercial_opportunities (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT css_party_tenant FOREIGN KEY (organization_id, party_id)
    REFERENCES public.parties (organization_id, id) ON DELETE SET NULL,
  -- Agendar é ter QUEM e QUANDO. Sem isso "agendado" é só otimismo.
  CONSTRAINT css_scheduled_has_who_and_when CHECK (
    status <> 'SCHEDULED' OR (planned_visit_date IS NOT NULL AND technical_responsible_user_id IS NOT NULL)),
  CONSTRAINT css_field_is_stamped CHECK (
    status NOT IN ('IN_FIELD','AWAITING_REPORT','COMPLETED') OR started_at IS NOT NULL),
  -- Quem concluiu é exigido pela função; o CHECK carimba só o instante, para
  -- que remover a conta de uma pessoa nunca fique refém da história dela.
  CONSTRAINT css_completed_coherent CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)),
  CONSTRAINT css_cancelled_coherent CHECK (
    (status = 'CANCELLED') = (cancelled_at IS NOT NULL AND nullif(btrim(cancel_reason), '') IS NOT NULL)),
  CONSTRAINT css_apex_provenance CHECK (
    apex_candidate IS NULL
    OR (apex_generated_at IS NOT NULL AND apex_provider IS NOT NULL
        AND apex_model IS NOT NULL AND apex_pipeline_version IS NOT NULL))
);
CREATE INDEX css_opportunity ON public.commercial_site_surveys (organization_id, opportunity_id);
CREATE INDEX css_responsible ON public.commercial_site_surveys (organization_id, technical_responsible_user_id)
  WHERE status NOT IN ('COMPLETED','CANCELLED');

COMMENT ON TABLE public.commercial_site_surveys IS
  'Levantamento técnico de uma oportunidade. Descoberta pré-proposta: não cria projeto, OS, medição nem faturamento.';

CREATE TRIGGER css_touch BEFORE UPDATE ON public.commercial_site_surveys
  FOR EACH ROW EXECUTE FUNCTION public.commercial_touch_updated_at();

CREATE TABLE public.commercial_site_survey_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  survey_id       uuid NOT NULL,
  event_type      text NOT NULL CHECK (event_type IN (
                    'created','transition','findings_recorded','attachment_added','apex_candidate_recorded')),
  from_status     text,
  to_status       text,
  actor_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_source    text NOT NULL DEFAULT 'human' CHECK (actor_source IN ('human','apex')),
  note            text,
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  occurred_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT csse_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT csse_survey_tenant FOREIGN KEY (organization_id, survey_id)
    REFERENCES public.commercial_site_surveys (organization_id, id) ON DELETE CASCADE,
  -- Proposta da Apex não tem autor humano. (Ato humano exige ator na função.)
  CONSTRAINT csse_apex_has_no_human CHECK (actor_source <> 'apex' OR actor_user_id IS NULL)
);
CREATE INDEX csse_survey ON public.commercial_site_survey_events (organization_id, survey_id, occurred_at DESC);

-- História: UPDATE proibido para todos; DELETE segue a regra canônica (210).
CREATE OR REPLACE FUNCTION public.commercial_survey_events_no_rewrite()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'commercial_site_survey_events não se reescreve.' USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION public.commercial_survey_events_no_rewrite() FROM PUBLIC;
CREATE TRIGGER csse_no_rewrite BEFORE UPDATE ON public.commercial_site_survey_events
  FOR EACH ROW EXECUTE FUNCTION public.commercial_survey_events_no_rewrite();
CREATE TRIGGER csse_no_erasure BEFORE DELETE ON public.commercial_site_survey_events
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

/*
  A 212 protegeu `commercial_opportunity_stage_events` com o mesmo gatilho
  total que a 210 teve de corrigir na história do engajamento: ele recusa o
  DELETE governado e trava a remoção de inquilino. Mesma correção, mesma
  regra: reescrever continua proibido para todos; apagar segue a regra
  canônica.
*/
DROP TRIGGER IF EXISTS cose_append_only ON public.commercial_opportunity_stage_events;
CREATE TRIGGER cose_no_rewrite BEFORE UPDATE ON public.commercial_opportunity_stage_events
  FOR EACH ROW EXECUTE FUNCTION public.commercial_stage_events_are_append_only();
CREATE TRIGGER cose_no_erasure BEFORE DELETE ON public.commercial_opportunity_stage_events
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

-- ---------------------------------------------------------------------------
-- 2) Arquivos de campo no acervo canônico
-- ---------------------------------------------------------------------------
ALTER TABLE public.contract_documents
  ADD COLUMN IF NOT EXISTS site_survey_id uuid;
ALTER TABLE public.contract_documents
  ADD CONSTRAINT cdoc_site_survey_tenant FOREIGN KEY (organization_id, site_survey_id)
    REFERENCES public.commercial_site_surveys (organization_id, id) ON DELETE CASCADE;
ALTER TABLE public.contract_documents DROP CONSTRAINT cdoc_has_parent;
ALTER TABLE public.contract_documents
  ADD CONSTRAINT cdoc_has_parent CHECK (
    contract_id IS NOT NULL OR engagement_id IS NOT NULL OR site_survey_id IS NOT NULL);

ALTER TABLE public.contract_documents DROP CONSTRAINT contract_documents_document_type_check;
ALTER TABLE public.contract_documents
  ADD CONSTRAINT contract_documents_document_type_check CHECK (document_type IN (
    'contract','amendment','invoice','guarantee','insurance','annex','purchase_order',
    'certificate','approval','minutes',
    'technical_proposal','commercial_proposal','internal_service_order','customer_authorization',
    'site_survey_photo','site_survey_video','site_survey_report','site_survey_attachment'));

CREATE UNIQUE INDEX contract_documents_survey_content_once
  ON public.contract_documents (organization_id, site_survey_id, content_sha256)
  WHERE site_survey_id IS NOT NULL AND content_sha256 IS NOT NULL
    AND superseded_by_document_id IS NULL;
CREATE INDEX cdoc_site_survey ON public.contract_documents (organization_id, site_survey_id)
  WHERE site_survey_id IS NOT NULL;

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
     ));

/*
  `contract_documents_manage` (FOR ALL) deixava quem tem `contracts.edit`
  escrever qualquer linha do inquilino pelo navegador. Arquivo de campo é
  escrito só pela função governada; a política passa a excluí-lo.
*/
DROP POLICY contract_documents_manage ON public.contract_documents;
CREATE POLICY contract_documents_manage ON public.contract_documents FOR ALL TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND site_survey_id IS NULL
     AND (public.current_user_is_admin()
          OR public.current_user_has_permission('contracts.documents.upload')
          OR public.current_user_has_permission('contracts.edit')))
  WITH CHECK (organization_id = public.current_user_organization_id()
     AND site_survey_id IS NULL
     AND (public.current_user_is_admin()
          OR public.current_user_has_permission('contracts.documents.upload')
          OR public.current_user_has_permission('contracts.edit')));

-- ---------------------------------------------------------------------------
-- 3) Funções governadas do levantamento
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commercial_site_survey_create(
  p_organization_id uuid, p_actor uuid, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_opp public.commercial_opportunities%ROWTYPE; v_id uuid; v_code text; v_seq int;
  v_status text; v_date date; v_resp uuid;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Site survey creation denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Site survey requires a named actor.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_opp FROM public.commercial_opportunities
   WHERE organization_id = p_organization_id
     AND id = nullif(p_payload->>'opportunity_id','')::uuid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opportunity not found in tenant.' USING ERRCODE = 'P0002';
  END IF;
  IF v_opp.stage IN ('WON','LOST','ABANDONED') THEN
    RAISE EXCEPTION 'Site survey cannot be requested: opportunity is closed as %.', v_opp.stage
      USING ERRCODE = '23514';
  END IF;
  IF nullif(btrim(p_payload->>'purpose'), '') IS NULL THEN
    RAISE EXCEPTION 'Site survey requires a stated purpose.' USING ERRCODE = '23514';
  END IF;

  v_date := nullif(p_payload->>'planned_visit_date','')::date;
  v_resp := nullif(p_payload->>'technical_responsible_user_id','')::uuid;
  -- Com quem e quando declarados, nasce AGENDADO; senão, PLANEJADO. O
  -- estado reflete o que se sabe, não o que se espera.
  v_status := CASE WHEN v_date IS NOT NULL AND v_resp IS NOT NULL THEN 'SCHEDULED' ELSE 'PLANNED' END;

  PERFORM pg_advisory_xact_lock(hashtext('css_code:' || p_organization_id::text));
  SELECT COALESCE(max(nullif(regexp_replace(code, '^LT-\d{4}-', ''), code)::int), 0) + 1 INTO v_seq
    FROM public.commercial_site_surveys
   WHERE organization_id = p_organization_id AND code ~ ('^LT-' || to_char(now(), 'YYYY') || '-\d+$');
  v_code := 'LT-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq::text, 3, '0');

  INSERT INTO public.commercial_site_surveys (
    organization_id, opportunity_id, code, title, party_id, counterparty_name,
    site_name, site_address, purpose, technical_responsible_user_id, planned_visit_date,
    status, scheduled_at, checklist, created_by)
  VALUES (
    p_organization_id, v_opp.id, v_code,
    COALESCE(nullif(btrim(p_payload->>'title'), ''), 'Levantamento técnico — ' || v_opp.title),
    v_opp.party_id, v_opp.counterparty_name,
    nullif(btrim(p_payload->>'site_name'), ''), nullif(btrim(p_payload->>'site_address'), ''),
    btrim(p_payload->>'purpose'), v_resp, v_date,
    v_status, CASE WHEN v_status = 'SCHEDULED' THEN now() END,
    COALESCE(CASE WHEN jsonb_typeof(p_payload->'checklist') = 'array' THEN p_payload->'checklist' END,
             '[]'::jsonb),
    p_actor)
  RETURNING id INTO v_id;

  INSERT INTO public.commercial_site_survey_events
    (organization_id, survey_id, event_type, to_status, actor_user_id, detail)
  VALUES (p_organization_id, v_id, 'created', v_status, p_actor,
          jsonb_build_object('opportunity_id', v_opp.id, 'code', v_code));

  RETURN jsonb_build_object('survey_id', v_id, 'code', v_code, 'status', v_status);
END $$;

/*
  Máquina de estados.
    PLANNED ──► SCHEDULED ──► IN_FIELD ──► AWAITING_REPORT ──► COMPLETED
       │            │  ▲          │               │
       │            └──┘ (reagendar)              └─► IN_FIELD (voltar a campo)
       └─► IN_FIELD (visita sem agenda)   IN_FIELD ─► COMPLETED (relatório no ato)
    Qualquer estado não terminal ─► CANCELLED (com motivo).
*/
CREATE OR REPLACE FUNCTION public.commercial_site_survey_transition(
  p_organization_id uuid, p_actor uuid, p_survey_id uuid, p_to_status text,
  p_note text DEFAULT NULL, p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row public.commercial_site_surveys%ROWTYPE; v_ok boolean; v_note text;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Site survey transition denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Site survey transition requires a named actor.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.commercial_site_surveys
   WHERE organization_id = p_organization_id AND id = p_survey_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Site survey not found in tenant.' USING ERRCODE = 'P0002'; END IF;

  IF v_row.status = p_to_status THEN
    RETURN jsonb_build_object('survey_id', p_survey_id, 'status', v_row.status, 'reused', true);
  END IF;
  v_ok := CASE v_row.status
    WHEN 'PLANNED'         THEN p_to_status IN ('SCHEDULED','IN_FIELD','CANCELLED')
    WHEN 'SCHEDULED'       THEN p_to_status IN ('PLANNED','IN_FIELD','CANCELLED')
    WHEN 'IN_FIELD'        THEN p_to_status IN ('AWAITING_REPORT','COMPLETED','CANCELLED')
    WHEN 'AWAITING_REPORT' THEN p_to_status IN ('IN_FIELD','COMPLETED','CANCELLED')
    ELSE false END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'Site survey cannot move from % to %.', v_row.status, p_to_status
      USING ERRCODE = '23514';
  END IF;
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  IF p_to_status = 'CANCELLED' AND v_note IS NULL THEN
    RAISE EXCEPTION 'Site survey cancellation requires a stated reason.' USING ERRCODE = '23514';
  END IF;

  UPDATE public.commercial_site_surveys SET
    status = p_to_status,
    planned_visit_date = COALESCE(nullif(p_payload->>'planned_visit_date','')::date, planned_visit_date),
    technical_responsible_user_id = COALESCE(
      nullif(p_payload->>'technical_responsible_user_id','')::uuid, technical_responsible_user_id),
    scheduled_at = CASE WHEN p_to_status = 'SCHEDULED' THEN now() ELSE scheduled_at END,
    started_at = CASE WHEN p_to_status = 'IN_FIELD' AND started_at IS NULL THEN now() ELSE started_at END,
    field_finished_at = CASE WHEN p_to_status IN ('AWAITING_REPORT','COMPLETED') AND field_finished_at IS NULL
                             THEN now() ELSE field_finished_at END,
    completed_at = CASE WHEN p_to_status = 'COMPLETED' THEN now() END,
    completed_by = CASE WHEN p_to_status = 'COMPLETED' THEN p_actor END,
    cancelled_at = CASE WHEN p_to_status = 'CANCELLED' THEN now() END,
    cancel_reason = CASE WHEN p_to_status = 'CANCELLED' THEN v_note END
   WHERE organization_id = p_organization_id AND id = p_survey_id;

  INSERT INTO public.commercial_site_survey_events
    (organization_id, survey_id, event_type, from_status, to_status, actor_user_id, note)
  VALUES (p_organization_id, p_survey_id, 'transition', v_row.status, p_to_status, p_actor, v_note);

  RETURN jsonb_build_object('survey_id', p_survey_id, 'from_status', v_row.status,
                            'status', p_to_status);
END $$;

/*
  Registro de campo. Mescla por SEÇÃO: o celular manda só o que mudou, e uma
  seção que não veio não é apagada. Levantamento concluído ou cancelado não
  aceita mais registro — o relatório concluído é o que a proposta leu.
*/
CREATE OR REPLACE FUNCTION public.commercial_site_survey_record(
  p_organization_id uuid, p_actor uuid, p_survey_id uuid, p_patch jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row public.commercial_site_surveys%ROWTYPE; v_sections text[];
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Site survey record denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Site survey record requires a named actor.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.commercial_site_surveys
   WHERE organization_id = p_organization_id AND id = p_survey_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Site survey not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF v_row.status IN ('COMPLETED','CANCELLED') THEN
    RAISE EXCEPTION 'Site survey is %; its record is closed.', v_row.status USING ERRCODE = '23514';
  END IF;

  SELECT array_agg(k) INTO v_sections
    FROM jsonb_object_keys(COALESCE(p_patch->'findings', '{}'::jsonb)) k;

  UPDATE public.commercial_site_surveys SET
    findings = CASE WHEN jsonb_typeof(p_patch->'findings') = 'object'
                    THEN findings || (p_patch->'findings') ELSE findings END,
    checklist = CASE WHEN jsonb_typeof(p_patch->'checklist') = 'array'
                     THEN p_patch->'checklist' ELSE checklist END,
    open_questions = CASE WHEN jsonb_typeof(p_patch->'open_questions') = 'array'
                          THEN p_patch->'open_questions' ELSE open_questions END,
    site_name = COALESCE(nullif(btrim(p_patch->>'site_name'), ''), site_name),
    site_address = COALESCE(nullif(btrim(p_patch->>'site_address'), ''), site_address)
   WHERE organization_id = p_organization_id AND id = p_survey_id;

  INSERT INTO public.commercial_site_survey_events
    (organization_id, survey_id, event_type, actor_user_id, detail)
  VALUES (p_organization_id, p_survey_id, 'findings_recorded', p_actor,
          jsonb_build_object('sections', to_jsonb(COALESCE(v_sections, ARRAY[]::text[])),
                             'checklist', p_patch ? 'checklist',
                             'open_questions', p_patch ? 'open_questions'));

  RETURN jsonb_build_object('survey_id', p_survey_id, 'sections', to_jsonb(v_sections));
END $$;

CREATE OR REPLACE FUNCTION public.commercial_site_survey_register_attachment(
  p_organization_id uuid, p_actor uuid, p_survey_id uuid, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row public.commercial_site_surveys%ROWTYPE; v_doc uuid; v_type text; v_sha text;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Site survey attachment denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Site survey attachment requires a named actor.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.commercial_site_surveys
   WHERE organization_id = p_organization_id AND id = p_survey_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Site survey not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF v_row.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Site survey is CANCELLED; it accepts no attachment.' USING ERRCODE = '23514';
  END IF;
  v_type := COALESCE(nullif(p_payload->>'document_type',''), 'site_survey_attachment');
  IF v_type NOT IN ('site_survey_photo','site_survey_video','site_survey_report','site_survey_attachment') THEN
    RAISE EXCEPTION 'Site survey attachment type % is not valid.', v_type USING ERRCODE = '22023';
  END IF;
  -- O caminho é do servidor e começa pelo inquilino. Nada fora dele entra.
  IF (p_payload->>'file_path') IS NULL
     OR position(p_organization_id::text || '/' IN p_payload->>'file_path') <> 1 THEN
    RAISE EXCEPTION 'Site survey attachment path is outside the tenant.' USING ERRCODE = '42501';
  END IF;
  v_sha := nullif(p_payload->>'content_sha256','');

  IF v_sha IS NOT NULL THEN
    SELECT id INTO v_doc FROM public.contract_documents
     WHERE organization_id = p_organization_id AND site_survey_id = p_survey_id
       AND content_sha256 = v_sha AND superseded_by_document_id IS NULL;
    IF FOUND THEN
      RETURN jsonb_build_object('document_id', v_doc, 'reused', true);
    END IF;
  END IF;

  INSERT INTO public.contract_documents (
    organization_id, site_survey_id, title, file_path, document_type, status,
    uploaded_by, content_sha256)
  VALUES (p_organization_id, p_survey_id,
          COALESCE(nullif(btrim(p_payload->>'title'), ''), 'Arquivo de campo'),
          p_payload->>'file_path', v_type, 'uploaded', p_actor, v_sha)
  RETURNING id INTO v_doc;

  INSERT INTO public.commercial_site_survey_events
    (organization_id, survey_id, event_type, actor_user_id, detail)
  VALUES (p_organization_id, p_survey_id, 'attachment_added', p_actor,
          jsonb_build_object('document_id', v_doc, 'document_type', v_type,
                             'caption', nullif(btrim(p_payload->>'caption'), '')));

  RETURN jsonb_build_object('document_id', v_doc, 'reused', false);
END $$;

/*
  A leitura assistida GRAVA SÓ NA COLUNA DELA. Sem ator humano (é a Apex), com
  proveniência obrigatória, e só depois que o campo terminou — não se
  interpreta levantamento que ainda está acontecendo.
*/
CREATE OR REPLACE FUNCTION public.commercial_site_survey_record_apex_candidate(
  p_organization_id uuid, p_survey_id uuid, p_candidate jsonb,
  p_provider text, p_model text, p_pipeline_version text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_status text;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Apex candidate write denied.' USING ERRCODE = '42501';
  END IF;
  SELECT status INTO v_status FROM public.commercial_site_surveys
   WHERE organization_id = p_organization_id AND id = p_survey_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Site survey not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF v_status NOT IN ('AWAITING_REPORT','COMPLETED') THEN
    RAISE EXCEPTION 'Site survey is %; Apex reads a survey only after field work ends.', v_status
      USING ERRCODE = '23514';
  END IF;
  UPDATE public.commercial_site_surveys SET
    apex_candidate = p_candidate, apex_generated_at = now(), apex_provider = p_provider,
    apex_model = p_model, apex_pipeline_version = p_pipeline_version
   WHERE organization_id = p_organization_id AND id = p_survey_id;
  INSERT INTO public.commercial_site_survey_events
    (organization_id, survey_id, event_type, actor_source, detail)
  VALUES (p_organization_id, p_survey_id, 'apex_candidate_recorded', 'apex',
          jsonb_build_object('provider', p_provider, 'model', p_model,
                             'pipeline_version', p_pipeline_version));
  RETURN jsonb_build_object('survey_id', p_survey_id, 'recorded', true);
END $$;

-- ---------------------------------------------------------------------------
-- 4) O registro do início de execução
-- ---------------------------------------------------------------------------
CREATE TABLE public.commercial_execution_starts (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  engagement_id             uuid NOT NULL,
  opportunity_id            uuid,
  technical_revision_id     uuid,
  commercial_revision_id    uuid,

  mode                      text NOT NULL CHECK (mode IN ('STANDARD','EXCEPTIONAL')),

  -- A BASE COMERCIAL. Aprovação interna não está na lista, de propósito.
  authorization_type        text NOT NULL CHECK (authorization_type IN (
                              'accepted_proposal','customer_email','customer_po','customer_os',
                              'formal_contract','declared')),
  authorization_date        date NOT NULL,
  authorization_document_id uuid,
  authorization_reference   text,
  authorization_context     text,
  customer_authorizer_name  text,

  confirmed_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at              timestamptz NOT NULL DEFAULT now(),

  -- Início excepcional
  exception_reason          text,
  internal_authorizer_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  regularization_owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  regularization_due_date   date,
  documentation_state       text NOT NULL CHECK (documentation_state IN ('COMPLETE','PENDING','REGULARIZED')),
  regularized_at            timestamptz,
  regularized_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  regularization_note       text,
  regularization_authorization_id uuid,

  service_order_id          uuid,
  project_id                text,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ces_org_id_unique UNIQUE (organization_id, id),
  -- UM início por trabalho autorizado. É a âncora da idempotência.
  CONSTRAINT ces_one_per_engagement UNIQUE (organization_id, engagement_id),
  CONSTRAINT ces_engagement_tenant FOREIGN KEY (organization_id, engagement_id)
    REFERENCES public.commercial_engagements (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT ces_opportunity_tenant FOREIGN KEY (organization_id, opportunity_id)
    REFERENCES public.commercial_opportunities (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT ces_technical_revision_tenant FOREIGN KEY (organization_id, technical_revision_id)
    REFERENCES public.commercial_proposal_revisions (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT ces_commercial_revision_tenant FOREIGN KEY (organization_id, commercial_revision_id)
    REFERENCES public.commercial_proposal_revisions (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT ces_document_tenant FOREIGN KEY (organization_id, authorization_document_id)
    REFERENCES public.contract_documents (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT ces_service_order_tenant FOREIGN KEY (organization_id, service_order_id)
    REFERENCES public.internal_service_orders (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT ces_project_tenant FOREIGN KEY (organization_id, project_id)
    REFERENCES public.projects (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT ces_regularization_authorization_tenant FOREIGN KEY (organization_id, regularization_authorization_id)
    REFERENCES public.commercial_engagement_authorizations (organization_id, id) ON DELETE SET NULL,

  -- Base declarada (sem papel) só existe no início excepcional.
  CONSTRAINT ces_declared_is_exceptional CHECK (authorization_type <> 'declared' OR mode = 'EXCEPTIONAL'),
  -- Base comprovada tem evidência: documento ou referência verificável.
  CONSTRAINT ces_standard_has_evidence CHECK (
    mode <> 'STANDARD' OR authorization_type = 'accepted_proposal'
    OR authorization_document_id IS NOT NULL OR nullif(btrim(authorization_reference), '') IS NOT NULL),
  CONSTRAINT ces_standard_is_complete CHECK (mode <> 'STANDARD' OR documentation_state = 'COMPLETE'),
  CONSTRAINT ces_exception_is_governed CHECK (
    mode <> 'EXCEPTIONAL' OR (
      nullif(btrim(exception_reason), '') IS NOT NULL
      AND regularization_due_date IS NOT NULL
      AND documentation_state IN ('PENDING','REGULARIZED'))),
  CONSTRAINT ces_regularized_coherent CHECK (
    (documentation_state = 'REGULARIZED') = (regularized_at IS NOT NULL))
);
CREATE INDEX ces_pending ON public.commercial_execution_starts (organization_id, regularization_due_date)
  WHERE documentation_state = 'PENDING';

CREATE TRIGGER ces_touch BEFORE UPDATE ON public.commercial_execution_starts
  FOR EACH ROW EXECUTE FUNCTION public.commercial_touch_updated_at();

COMMENT ON TABLE public.commercial_execution_starts IS
  'O ato "fechar negócio e iniciar execução": base comercial, evidência, quem confirmou. '
  'EXCEPTIONAL + PENDING = autorizado com documentação pendente; bloqueia faturamento.';

-- Pendência de documentação: a pergunta que o faturamento faz.
CREATE OR REPLACE FUNCTION public.commercial_engagement_documentation_pending(
  p_organization_id uuid, p_engagement_id uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.commercial_execution_starts s
     WHERE s.organization_id = p_organization_id AND s.engagement_id = p_engagement_id
       AND s.documentation_state = 'PENDING');
$$;
REVOKE ALL ON FUNCTION public.commercial_engagement_documentation_pending(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_engagement_documentation_pending(uuid,uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) Fechar negócio e iniciar execução — orquestra, não duplica
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commercial_close_and_start_execution(
  p_organization_id uuid, p_actor uuid, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_mode      text := COALESCE(nullif(p_payload->>'mode',''), 'STANDARD');
  v_auth      jsonb := COALESCE(p_payload->'authorization', '{}'::jsonb);
  v_exc       jsonb := COALESCE(p_payload->'exception', '{}'::jsonb);
  v_os_in     jsonb := COALESCE(p_payload->'service_order', '{}'::jsonb);
  v_proj_in   jsonb := COALESCE(p_payload->'project', '{}'::jsonb);
  v_type      text;
  v_auth_date date;
  v_auth_doc  uuid;
  v_auth_ref  text;
  v_acc_src   text;
  v_pt        public.commercial_proposal_revisions%ROWTYPE;
  v_pc        public.commercial_proposal_revisions%ROWTYPE;
  v_pt_prop   public.commercial_proposals%ROWTYPE;
  v_pc_prop   public.commercial_proposals%ROWTYPE;
  v_value_rev public.commercial_proposal_revisions%ROWTYPE;
  v_opp       public.commercial_opportunities%ROWTYPE;
  v_has_opp   boolean := false;
  v_eng_id    uuid;
  v_eng       public.commercial_engagements%ROWTYPE;
  v_start     public.commercial_execution_starts%ROWTYPE;
  v_contract  uuid;
  v_created_engagement boolean := false;
  v_os        public.internal_service_orders%ROWTYPE;
  v_os_id     uuid;
  v_os_created boolean := false;
  v_os_number text;
  v_seq       int;
  v_doc       uuid;
  v_blocking  int;
  v_project   text;
  v_bind      jsonb;
  v_blocked   jsonb := '[]'::jsonb;
  v_title     text;
  v_party     uuid;
  v_counterparty text;
  v_currency  text;
  v_origin    text;
  v_rev       public.commercial_proposal_revisions%ROWTYPE;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Execution start denied.' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Execution start requires a named actor.' USING ERRCODE = '42501';
  END IF;
  IF v_mode NOT IN ('STANDARD','EXCEPTIONAL') THEN
    RAISE EXCEPTION 'Execution start mode % is not valid.', v_mode USING ERRCODE = '22023';
  END IF;

  v_type := nullif(btrim(v_auth->>'type'), '');
  v_auth_date := COALESCE(nullif(v_auth->>'date','')::date, current_date);
  v_auth_doc := nullif(v_auth->>'document_id','')::uuid;
  v_auth_ref := nullif(btrim(v_auth->>'reference'), '');
  IF v_type IS NULL OR v_type NOT IN ('accepted_proposal','customer_email','customer_po',
                                       'customer_os','formal_contract','declared') THEN
    RAISE EXCEPTION 'Execution start requires an explicit commercial authorization basis.'
      USING ERRCODE = '23514';
  END IF;
  IF v_type = 'declared' AND v_mode <> 'EXCEPTIONAL' THEN
    RAISE EXCEPTION 'Execution start with a declared (undocumented) basis is only possible as an exceptional start.'
      USING ERRCODE = '23514';
  END IF;
  IF v_mode = 'STANDARD' AND v_type NOT IN ('accepted_proposal','formal_contract')
     AND v_auth_doc IS NULL AND v_auth_ref IS NULL THEN
    RAISE EXCEPTION 'Execution start basis % requires evidence: a document or a verifiable reference.', v_type
      USING ERRCODE = '23514';
  END IF;
  IF v_auth_date > current_date THEN
    RAISE EXCEPTION 'Execution start authorization date cannot be in the future.' USING ERRCODE = '23514';
  END IF;
  IF v_mode = 'EXCEPTIONAL' AND (
       nullif(btrim(v_exc->>'reason'), '') IS NULL
    OR nullif(v_exc->>'internal_authorizer_user_id','') IS NULL
    OR nullif(v_exc->>'regularization_owner_user_id','') IS NULL
    OR nullif(v_exc->>'regularization_due_date','') IS NULL
    OR (v_auth_ref IS NULL AND v_auth_doc IS NULL)) THEN
    RAISE EXCEPTION 'Execution start exception requires reason, internal authorizer, available evidence, regularization owner and due date.'
      USING ERRCODE = '23514';
  END IF;

  -- ── Revisões que regem ────────────────────────────────────────────────
  IF nullif(p_payload->>'technical_revision_id','') IS NOT NULL THEN
    SELECT * INTO v_pt FROM public.commercial_proposal_revisions
     WHERE organization_id = p_organization_id AND id = (p_payload->>'technical_revision_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Proposal revision not found in tenant.' USING ERRCODE = 'P0002'; END IF;
    SELECT * INTO v_pt_prop FROM public.commercial_proposals
     WHERE organization_id = p_organization_id AND id = v_pt.proposal_id;
    IF v_pt_prop.kind NOT IN ('TECHNICAL','COMBINED') THEN
      RAISE EXCEPTION 'Proposal revision % is not a technical proposal.', v_pt.id USING ERRCODE = '23514';
    END IF;
  END IF;
  IF nullif(p_payload->>'commercial_revision_id','') IS NOT NULL THEN
    SELECT * INTO v_pc FROM public.commercial_proposal_revisions
     WHERE organization_id = p_organization_id AND id = (p_payload->>'commercial_revision_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Proposal revision not found in tenant.' USING ERRCODE = 'P0002'; END IF;
    SELECT * INTO v_pc_prop FROM public.commercial_proposals
     WHERE organization_id = p_organization_id AND id = v_pc.proposal_id;
    IF v_pc_prop.kind NOT IN ('COMMERCIAL','COMBINED') THEN
      RAISE EXCEPTION 'Proposal revision % is not a commercial proposal.', v_pc.id USING ERRCODE = '23514';
    END IF;
  END IF;
  IF v_pt.id IS NULL AND v_pc.id IS NULL AND v_type <> 'formal_contract' THEN
    RAISE EXCEPTION 'Execution start requires the governing technical or commercial proposal revision.'
      USING ERRCODE = '23514';
  END IF;
  -- Uma revisão substituída não rege: a vigente é outra.
  FOREACH v_origin IN ARRAY ARRAY['pt','pc'] LOOP
    v_rev := CASE v_origin WHEN 'pt' THEN v_pt ELSE v_pc END;
    IF v_rev.id IS NOT NULL AND v_rev.status IN ('SUPERSEDED','REJECTED','WITHDRAWN','EXPIRED') THEN
      RAISE EXCEPTION 'Proposal revision % is %; it cannot govern execution.', v_rev.revision, v_rev.status
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
  v_value_rev := CASE WHEN v_pc.id IS NOT NULL THEN v_pc ELSE v_pt END;

  -- ── Oportunidade ──────────────────────────────────────────────────────
  SELECT * INTO v_opp FROM public.commercial_opportunities
   WHERE organization_id = p_organization_id
     AND id = COALESCE(nullif(p_payload->>'opportunity_id','')::uuid,
                       v_pc_prop.opportunity_id, v_pt_prop.opportunity_id)
   FOR UPDATE;
  v_has_opp := FOUND;
  IF v_has_opp AND v_opp.stage IN ('LOST','ABANDONED') THEN
    RAISE EXCEPTION 'Opportunity is already closed as % — a closed opportunity does not return to the funnel.',
      v_opp.stage USING ERRCODE = '23514';
  END IF;
  -- Proposta de OUTRA oportunidade não entra neste fechamento: vínculo
  -- impreciso não é autoridade.
  IF v_has_opp AND (
       (v_pt_prop.id IS NOT NULL AND v_pt_prop.opportunity_id IS DISTINCT FROM v_opp.id)
    OR (v_pc_prop.id IS NOT NULL AND v_pc_prop.opportunity_id IS DISTINCT FROM v_opp.id)) THEN
    RAISE EXCEPTION 'Proposal revision belongs to another opportunity.' USING ERRCODE = '23514';
  END IF;

  -- ── Aceite do cliente (só no padrão, e só com a manifestação dele) ─────
  IF v_mode = 'STANDARD' THEN
    v_acc_src := COALESCE(nullif(v_auth->>'acceptance_source',''),
      CASE v_type WHEN 'customer_email'  THEN 'customer_email'
                  WHEN 'customer_po'     THEN 'purchase_order'
                  WHEN 'formal_contract' THEN 'signed_document' END);
    FOREACH v_origin IN ARRAY ARRAY['pt','pc'] LOOP
      v_rev := CASE v_origin WHEN 'pt' THEN v_pt ELSE v_pc END;
      CONTINUE WHEN v_rev.id IS NULL OR v_rev.status = 'ACCEPTED';
      IF v_rev.status NOT IN ('SENT','NEGOTIATION') THEN
        RAISE EXCEPTION 'Proposal revision % is %: only a revision sent to the customer can be accepted. Use the exceptional start if work must begin now.',
          v_rev.revision, v_rev.status USING ERRCODE = '23514';
      END IF;
      IF v_acc_src IS NULL THEN
        RAISE EXCEPTION 'Acceptance must state how the customer manifested it.' USING ERRCODE = '23514';
      END IF;
      PERFORM public.commercial_proposal_revision_record_outcome(
        p_organization_id, p_actor, v_rev.id, 'ACCEPTED',
        jsonb_build_object('acceptance_source', v_acc_src,
                           'acceptance_document_id', v_auth_doc,
                           'acceptance_external_ref', v_auth_ref,
                           'acceptance_note', 'Registrado no fechamento de negócio.'));
    END LOOP;
    IF v_pt.id IS NOT NULL THEN SELECT * INTO v_pt FROM public.commercial_proposal_revisions WHERE id = v_pt.id; END IF;
    IF v_pc.id IS NOT NULL THEN SELECT * INTO v_pc FROM public.commercial_proposal_revisions WHERE id = v_pc.id; END IF;
    v_value_rev := CASE WHEN v_pc.id IS NOT NULL THEN v_pc ELSE v_pt END;
  END IF;

  -- ── Trabalho autorizado: achar antes de criar ─────────────────────────
  IF v_type = 'formal_contract' THEN
    v_contract := nullif(v_auth->>'contract_id','')::uuid;
    IF v_contract IS NULL THEN
      RAISE EXCEPTION 'Execution start basis formal_contract requires the contract.' USING ERRCODE = '23514';
    END IF;
    SELECT a.engagement_id INTO v_eng_id FROM public.commercial_engagement_authorizations a
     WHERE a.organization_id = p_organization_id AND a.contract_id = v_contract AND a.state <> 'REVOKED';
    IF v_eng_id IS NULL THEN
      RAISE EXCEPTION 'Execution start: the contract has no registered engagement.' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF v_eng_id IS NULL AND v_has_opp THEN v_eng_id := v_opp.engagement_id; END IF;
  IF v_eng_id IS NULL THEN
    SELECT a.engagement_id INTO v_eng_id FROM public.commercial_engagement_authorizations a
     WHERE a.organization_id = p_organization_id AND a.state = 'ACTIVE'
       AND a.proposal_revision_id IN (v_pt.id, v_pc.id)
     ORDER BY a.created_at LIMIT 1;
  END IF;
  IF v_eng_id IS NULL THEN
    SELECT s.engagement_id INTO v_eng_id FROM public.commercial_execution_starts s
     WHERE s.organization_id = p_organization_id
       AND (s.commercial_revision_id IN (v_pt.id, v_pc.id) OR s.technical_revision_id IN (v_pt.id, v_pc.id))
     LIMIT 1;
  END IF;

  IF v_eng_id IS NULL THEN
    v_title := COALESCE(CASE WHEN v_has_opp THEN v_opp.title END, v_pc_prop.title, v_pt_prop.title);
    v_party := COALESCE(CASE WHEN v_has_opp THEN v_opp.party_id END, v_pc_prop.party_id, v_pt_prop.party_id);
    v_counterparty := COALESCE(CASE WHEN v_has_opp THEN v_opp.counterparty_name END,
                               v_pc_prop.counterparty_name, v_pt_prop.counterparty_name);
    v_currency := COALESCE(v_value_rev.currency, v_pc_prop.currency, v_pt_prop.currency, 'BRL');
    v_origin := CASE v_type WHEN 'accepted_proposal' THEN 'accepted_proposal'
                            WHEN 'customer_po' THEN 'customer_po'
                            ELSE 'customer_authorization' END;
    -- No padrão com proposta aceita, a origem honesta é a proposta.
    IF v_mode = 'STANDARD' AND v_value_rev.status = 'ACCEPTED' THEN v_origin := 'accepted_proposal'; END IF;
    v_eng_id := public.commercial_engagement_create(p_organization_id, p_actor, jsonb_build_object(
      'title', v_title, 'counterparty_party_id', v_party, 'counterparty_name', v_counterparty,
      'currency', v_currency, 'origin', v_origin,
      'owner_user_id', CASE WHEN v_has_opp THEN v_opp.owner_user_id END));
    v_created_engagement := true;
  END IF;

  SELECT * INTO v_eng FROM public.commercial_engagements
   WHERE organization_id = p_organization_id AND id = v_eng_id FOR UPDATE;
  IF v_eng.status IN ('SUSPENDED','CLOSED','CANCELLED') THEN
    RAISE EXCEPTION 'Engagement is %; execution cannot start on it.', v_eng.status USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_start FROM public.commercial_execution_starts
   WHERE organization_id = p_organization_id AND engagement_id = v_eng_id FOR UPDATE;

  -- ── Fontes de autorização (idempotente por revisão) ───────────────────
  IF v_start.id IS NULL THEN
    IF v_mode = 'STANDARD' THEN
      -- Comercial primeiro: é ela que carrega o valor, e a primeira fonte
      -- anexada rege quando não há regente. A técnica entra sem valor — o
      -- preço dela não é o preço do trabalho, e comparar os dois abriria uma
      -- divergência que não existe.
      FOREACH v_origin IN ARRAY ARRAY['pc','pt'] LOOP
        v_rev := CASE v_origin WHEN 'pt' THEN v_pt ELSE v_pc END;
        CONTINUE WHEN v_rev.id IS NULL OR v_rev.status <> 'ACCEPTED';
        CONTINUE WHEN EXISTS (SELECT 1 FROM public.commercial_engagement_authorizations a
                               WHERE a.organization_id = p_organization_id AND a.engagement_id = v_eng_id
                                 AND a.proposal_revision_id = v_rev.id AND a.state = 'ACTIVE');
        PERFORM public.commercial_engagement_attach_authorization(p_organization_id, p_actor, v_eng_id,
          jsonb_build_object('source_kind', 'accepted_proposal', 'proposal_revision_id', v_rev.id,
            'authorized_value', CASE WHEN v_origin = 'pc' OR v_pc.id IS NULL THEN v_rev.total_value END,
            'currency', CASE WHEN v_origin = 'pc' OR v_pc.id IS NULL THEN v_rev.currency END,
            'note', 'Fechamento de negócio.'));
      END LOOP;
      -- A evidência do cliente (PO, e-mail, OS do cliente) entra como fonte
      -- registrada, sem valor próprio: não disputa a regência da proposta.
      IF v_type IN ('customer_po','customer_email','customer_os') THEN
        PERFORM public.commercial_engagement_attach_authorization(p_organization_id, p_actor, v_eng_id,
          jsonb_build_object(
            'source_kind', CASE v_type WHEN 'customer_po' THEN 'customer_po' ELSE 'customer_authorization' END,
            'document_id', v_auth_doc,
            'external_reference', COALESCE(v_auth_ref,
              CASE v_type WHEN 'customer_os' THEN 'OS do cliente' WHEN 'customer_email' THEN 'E-mail do cliente' END
              || ' de ' || to_char(v_auth_date, 'DD/MM/YYYY')),
            'note', 'Evidência de autorização do cliente registrada no fechamento.'));
      END IF;
    ELSE
      /*
        EXCEPCIONAL. A proposta NÃO é aceita por ninguém aqui — o cliente não
        se manifestou por escrito, e fingir que sim seria fabricar aceite. O
        que rege é a autorização DECLARADA, com a referência que existe, e o
        valor sai da proposta comercial vigente quando houver uma.
      */
      IF NOT EXISTS (SELECT 1 FROM public.commercial_engagement_authorizations a
                      WHERE a.organization_id = p_organization_id AND a.engagement_id = v_eng_id
                        AND a.governing AND a.state = 'ACTIVE') THEN
        PERFORM public.commercial_engagement_attach_authorization(p_organization_id, p_actor, v_eng_id,
          jsonb_build_object(
            'source_kind', CASE v_type WHEN 'customer_po' THEN 'customer_po' ELSE 'customer_authorization' END,
            'document_id', v_auth_doc,
            'external_reference', COALESCE(v_auth_ref, 'Autorização declarada'),
            'authorized_value', v_value_rev.total_value,
            'currency', CASE WHEN v_value_rev.total_value IS NOT NULL THEN v_value_rev.currency END,
            'note', 'Início excepcional — documentação comercial pendente.'));
      END IF;
    END IF;
  END IF;

  IF v_eng.status = 'UNDER_ANALYSIS' THEN
    PERFORM public.commercial_engagement_authorize(p_organization_id, p_actor, v_eng_id,
      CASE v_mode WHEN 'EXCEPTIONAL' THEN 'Início excepcional: ' || btrim(v_exc->>'reason')
                  ELSE 'Fechamento de negócio.' END);
  END IF;

  -- ── Oportunidade: ganha e ligada ao trabalho ──────────────────────────
  IF v_has_opp THEN
    IF v_opp.stage <> 'WON' THEN
      PERFORM public.commercial_opportunity_transition_stage(p_organization_id, p_actor, v_opp.id, 'WON',
        CASE v_mode WHEN 'EXCEPTIONAL' THEN 'Início excepcional de execução.' ELSE 'Negócio fechado.' END);
    END IF;
    IF v_opp.engagement_id IS DISTINCT FROM v_eng_id THEN
      IF v_opp.engagement_id IS NOT NULL THEN
        RAISE EXCEPTION 'Opportunity is already linked to another engagement.' USING ERRCODE = '23514';
      END IF;
      UPDATE public.commercial_opportunities SET engagement_id = v_eng_id
       WHERE organization_id = p_organization_id AND id = v_opp.id;
    END IF;
  END IF;

  -- ── O registro do ato ─────────────────────────────────────────────────
  IF v_start.id IS NULL THEN
    INSERT INTO public.commercial_execution_starts (
      organization_id, engagement_id, opportunity_id, technical_revision_id, commercial_revision_id,
      mode, authorization_type, authorization_date, authorization_document_id, authorization_reference,
      authorization_context, customer_authorizer_name, confirmed_by,
      exception_reason, internal_authorizer_user_id, regularization_owner_user_id,
      regularization_due_date, documentation_state)
    VALUES (
      p_organization_id, v_eng_id, CASE WHEN v_has_opp THEN v_opp.id END, v_pt.id, v_pc.id,
      v_mode, v_type, v_auth_date, v_auth_doc, v_auth_ref,
      nullif(btrim(v_auth->>'context'), ''), nullif(btrim(v_auth->>'customer_authorizer_name'), ''),
      p_actor,
      CASE WHEN v_mode = 'EXCEPTIONAL' THEN btrim(v_exc->>'reason') END,
      CASE WHEN v_mode = 'EXCEPTIONAL' THEN (v_exc->>'internal_authorizer_user_id')::uuid END,
      CASE WHEN v_mode = 'EXCEPTIONAL' THEN (v_exc->>'regularization_owner_user_id')::uuid END,
      CASE WHEN v_mode = 'EXCEPTIONAL' THEN (v_exc->>'regularization_due_date')::date END,
      CASE WHEN v_mode = 'EXCEPTIONAL' THEN 'PENDING' ELSE 'COMPLETE' END)
    RETURNING * INTO v_start;

    INSERT INTO public.commercial_engagement_history (
      organization_id, engagement_id, transition, from_state, to_state, actor_user_id, note, provenance)
    VALUES (p_organization_id, v_eng_id,
            CASE v_mode WHEN 'EXCEPTIONAL' THEN 'execution_started_exceptionally' ELSE 'execution_started' END,
            v_eng.status, CASE v_mode WHEN 'EXCEPTIONAL' THEN 'AUTHORIZED_WITH_PENDING_DOCUMENTATION'
                                      ELSE 'AUTHORIZED' END,
            p_actor, COALESCE(nullif(btrim(v_exc->>'reason'), ''), nullif(btrim(v_auth->>'context'), '')),
            jsonb_build_object('execution_start_id', v_start.id, 'mode', v_mode,
                               'authorization_type', v_type, 'authorization_date', v_auth_date,
                               'technical_revision_id', v_pt.id, 'commercial_revision_id', v_pc.id,
                               'regularization_due_date', v_start.regularization_due_date));
  END IF;

  -- ── OS interna: reusar, vincular, gerar ou registrar a carregada ──────
  SELECT * INTO v_os FROM public.internal_service_orders
   WHERE organization_id = p_organization_id AND engagement_id = v_eng_id
     AND status <> 'CANCELLED'
   ORDER BY (id = v_start.service_order_id) DESC, created_at LIMIT 1;

  IF v_os.id IS NULL AND COALESCE(v_os_in->>'mode', 'generate') <> 'skip' THEN
    IF v_os_in->>'mode' = 'link' THEN
      SELECT * INTO v_os FROM public.internal_service_orders
       WHERE organization_id = p_organization_id AND id = nullif(v_os_in->>'service_order_id','')::uuid;
      IF NOT FOUND THEN RAISE EXCEPTION 'Service order not found in tenant.' USING ERRCODE = 'P0002'; END IF;
      IF v_os.engagement_id <> v_eng_id THEN
        RAISE EXCEPTION 'Service order belongs to another engagement; it cannot be linked here.'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      v_os_number := nullif(btrim(v_os_in->>'os_number'), '');
      IF v_os_number IS NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('iso_number:' || p_organization_id::text));
        SELECT COALESCE(max(nullif(regexp_replace(os_number, '^OS-\d{4}-', ''), os_number)::int), 0) + 1
          INTO v_seq FROM public.internal_service_orders
         WHERE organization_id = p_organization_id AND os_number ~ ('^OS-' || to_char(now(), 'YYYY') || '-\d+$');
        v_os_number := 'OS-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq::text, 4, '0');
      END IF;

      IF v_os_in->>'mode' = 'upload' THEN
        IF (v_os_in->>'file_path') IS NULL
           OR position(p_organization_id::text || '/' IN v_os_in->>'file_path') <> 1 THEN
          RAISE EXCEPTION 'Service order document path is outside the tenant.' USING ERRCODE = '42501';
        END IF;
        INSERT INTO public.contract_documents (
          organization_id, engagement_id, title, file_path, document_type, status, uploaded_by, content_sha256)
        VALUES (p_organization_id, v_eng_id,
                COALESCE(nullif(btrim(v_os_in->>'file_title'), ''), 'OS interna ' || v_os_number),
                v_os_in->>'file_path', 'internal_service_order', 'uploaded', p_actor,
                nullif(v_os_in->>'content_sha256',''))
        ON CONFLICT DO NOTHING
        RETURNING id INTO v_doc;
        IF v_doc IS NULL THEN
          SELECT id INTO v_doc FROM public.contract_documents
           WHERE organization_id = p_organization_id AND engagement_id = v_eng_id
             AND document_type = 'internal_service_order'
             AND content_sha256 = nullif(v_os_in->>'content_sha256','')
             AND superseded_by_document_id IS NULL;
        END IF;
        v_bind := public.internal_service_order_create(p_organization_id, p_actor, v_eng_id, jsonb_build_object(
          'origin', 'uploaded_document', 'document_id', v_doc, 'os_number', v_os_number,
          'title', COALESCE(nullif(btrim(v_os_in->>'title'), ''), v_eng.title),
          'authorized_value', nullif(v_os_in->>'authorized_value',''),
          'currency', COALESCE(nullif(v_os_in->>'currency',''), v_value_rev.currency),
          'scope_summary', COALESCE(nullif(btrim(v_os_in->>'scope_summary'), ''), v_value_rev.scope_summary),
          'planned_start', nullif(v_os_in->>'planned_start',''),
          'planned_finish', nullif(v_os_in->>'planned_finish',''),
          'responsible_user_id', nullif(v_os_in->>'responsible_user_id','')));
      ELSE
        v_bind := public.internal_service_order_create(p_organization_id, p_actor, v_eng_id, jsonb_build_object(
          'origin', CASE WHEN v_value_rev.status = 'ACCEPTED' THEN 'from_accepted_proposal' ELSE 'manual' END,
          'source_proposal_revision_id', CASE WHEN v_value_rev.status = 'ACCEPTED' THEN v_value_rev.id END,
          'os_number', v_os_number,
          'title', COALESCE(nullif(btrim(v_os_in->>'title'), ''), v_eng.title),
          -- Na exceção a OS herda o valor da fonte REGENTE (a declarada), que
          -- é o mesmo número: nada é redigitado.
          'authorized_value', CASE WHEN v_value_rev.status = 'ACCEPTED' THEN NULL
                                   ELSE v_value_rev.total_value END,
          'currency', v_value_rev.currency,
          'scope_summary', COALESCE(nullif(btrim(v_os_in->>'scope_summary'), ''), v_value_rev.scope_summary),
          'planned_start', nullif(v_os_in->>'planned_start',''),
          'planned_finish', nullif(v_os_in->>'planned_finish',''),
          'responsible_user_id', nullif(v_os_in->>'responsible_user_id','')));
      END IF;
      v_os_id := (v_bind->>'service_order_id')::uuid;
      v_os_created := true;
      SELECT * INTO v_os FROM public.internal_service_orders WHERE id = v_os_id;
    END IF;

    -- OS que não nasceu da proposta regente é CONFRONTADA com ela.
    IF v_os.origin <> 'from_accepted_proposal' THEN
      PERFORM public.internal_service_order_compare_with_governing(p_organization_id, v_os.id);
      SELECT * INTO v_os FROM public.internal_service_orders WHERE id = v_os.id;
    END IF;
  END IF;

  -- Emitir, se nada bloqueia. Divergência BLOCKING aberta NÃO é contornada:
  -- o fechamento para aqui e diz o porquê.
  IF v_os.id IS NOT NULL AND v_os.status IN ('DRAFT','PENDING_CONFIRMATION') THEN
    SELECT count(*)::int INTO v_blocking FROM public.commercial_divergences d
     WHERE d.organization_id = p_organization_id AND d.severity = 'BLOCKING' AND d.state = 'OPEN'
       AND (d.service_order_id = v_os.id OR d.engagement_id = v_eng_id);
    IF v_blocking > 0 THEN
      v_blocked := v_blocked || jsonb_build_object('code', 'BLOCKING_DIVERGENCE', 'count', v_blocking,
        'detail', format('%s divergência(s) bloqueante(s) em aberto impedem a emissão da OS.', v_blocking));
    ELSE
      PERFORM public.internal_service_order_issue(p_organization_id, p_actor, v_os.id);
      SELECT * INTO v_os FROM public.internal_service_orders WHERE id = v_os.id;
    END IF;
  END IF;

  -- ── Projeto: reusar o que já existe antes de criar ────────────────────
  v_project := v_os.project_id;
  IF v_project IS NULL AND v_os.status IN ('ISSUED','IN_EXECUTION')
     AND COALESCE(v_proj_in->>'mode', 'create') <> 'skip' THEN
    SELECT l.project_id INTO v_project FROM public.engagement_project_links l
     WHERE l.organization_id = p_organization_id AND l.engagement_id = v_eng_id
     ORDER BY l.created_at LIMIT 1;
    IF v_project IS NULL THEN
      v_project := nullif(btrim(v_proj_in->>'project_id'), '');
      IF v_project IS NULL THEN
        RAISE EXCEPTION 'Project binding requires a project id.' USING ERRCODE = '23514';
      END IF;
    END IF;
    v_bind := public.internal_service_order_bind_project(p_organization_id, p_actor, v_os.id, v_project,
      CASE WHEN v_proj_in->>'mode' = 'link' THEN NULL ELSE v_proj_in->'payload' END);
    v_project := v_bind->>'project_id';
  ELSIF v_os.id IS NOT NULL AND v_os.status NOT IN ('ISSUED','IN_EXECUTION') THEN
    v_blocked := v_blocked || jsonb_build_object('code', 'SERVICE_ORDER_NOT_ISSUED',
      'detail', 'O projeto nasce da OS emitida; a OS está ' || v_os.status || '.');
  ELSIF v_os.id IS NULL THEN
    v_blocked := v_blocked || jsonb_build_object('code', 'SERVICE_ORDER_MISSING',
      'detail', 'Sem OS interna, o projeto não é vinculado.');
  END IF;

  IF v_os.id IS NOT NULL THEN
    SELECT * INTO v_os FROM public.internal_service_orders WHERE id = v_os.id;
  END IF;

  UPDATE public.commercial_execution_starts
     SET service_order_id = COALESCE(v_os.id, service_order_id),
         project_id = COALESCE(v_project, project_id)
   WHERE id = v_start.id;

  RETURN jsonb_build_object(
    'execution_start_id', v_start.id,
    'engagement_id', v_eng_id,
    'engagement_created', v_created_engagement,
    'mode', v_start.mode,
    'documentation_state', v_start.documentation_state,
    'service_order_id', v_os.id,
    'service_order_number', v_os.os_number,
    'service_order_status', v_os.status,
    'service_order_created', v_os_created,
    'project_id', v_project,
    'blocked', v_blocked);
END $$;

-- ---------------------------------------------------------------------------
-- 6) Regularizar a documentação do início excepcional
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commercial_execution_start_regularize(
  p_organization_id uuid, p_actor uuid, p_execution_start_id uuid, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_start public.commercial_execution_starts%ROWTYPE; v_kind text; v_attach jsonb; v_auth uuid;
  v_note text; v_ev record; v_recomputed int := 0; v_rev uuid;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Execution start regularization denied.' USING ERRCODE = '42501';
  END IF;
  v_note := nullif(btrim(p_payload->>'note'), '');
  IF p_actor IS NULL OR v_note IS NULL THEN
    RAISE EXCEPTION 'Execution start regularization requires a named actor and a written note.'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_start FROM public.commercial_execution_starts
   WHERE organization_id = p_organization_id AND id = p_execution_start_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Execution start not found in tenant.' USING ERRCODE = 'P0002'; END IF;
  IF v_start.documentation_state <> 'PENDING' THEN
    RETURN jsonb_build_object('execution_start_id', v_start.id,
                              'documentation_state', v_start.documentation_state, 'reused', true);
  END IF;

  v_kind := p_payload->>'source_kind';
  IF v_kind = 'accepted_proposal' THEN
    -- Aceite formal registrado depois: a revisão já precisa estar ACEITA.
    v_rev := nullif(p_payload->>'proposal_revision_id','')::uuid;
    v_attach := public.commercial_engagement_attach_authorization(p_organization_id, p_actor,
      v_start.engagement_id, jsonb_build_object('source_kind', 'accepted_proposal',
        'proposal_revision_id', v_rev, 'note', v_note));
  ELSIF v_kind IN ('customer_po','customer_authorization','formal_contract') THEN
    IF v_kind <> 'formal_contract' AND nullif(p_payload->>'document_id','') IS NULL
       AND nullif(btrim(p_payload->>'external_reference'), '') IS NULL THEN
      RAISE EXCEPTION 'Execution start regularization requires the document or a verifiable reference.'
        USING ERRCODE = '23514';
    END IF;
    v_attach := public.commercial_engagement_attach_authorization(p_organization_id, p_actor,
      v_start.engagement_id, jsonb_build_object('source_kind', v_kind,
        'contract_id', p_payload->>'contract_id',
        'document_id', p_payload->>'document_id',
        'external_reference', p_payload->>'external_reference',
        'note', v_note));
  ELSE
    RAISE EXCEPTION 'Execution start regularization source % is not valid.', v_kind USING ERRCODE = '22023';
  END IF;
  v_auth := (v_attach->>'authorization_id')::uuid;

  /*
    A evidência que chegou passa a REGER no lugar da declarada — por escrito,
    pela mesma porta de sempre. Se ela divergir em valor da declarada, a
    divergência já foi aberta pelo anexo e continua bloqueando a OS e o
    faturamento até alguém decidir.
  */
  IF NOT (v_attach->>'governing')::boolean THEN
    PERFORM public.commercial_engagement_set_governing(p_organization_id, p_actor, v_auth,
      'Regularização do início excepcional: ' || v_note);
  END IF;

  UPDATE public.commercial_execution_starts
     SET documentation_state = 'REGULARIZED', regularized_at = now(), regularized_by = p_actor,
         regularization_note = v_note, regularization_authorization_id = v_auth
   WHERE id = v_start.id;

  INSERT INTO public.commercial_engagement_history (
    organization_id, engagement_id, transition, from_state, to_state, actor_user_id, note, provenance)
  VALUES (p_organization_id, v_start.engagement_id, 'documentation_regularized',
          'AUTHORIZED_WITH_PENDING_DOCUMENTATION', 'AUTHORIZED', p_actor, v_note,
          jsonb_build_object('execution_start_id', v_start.id, 'authorization_id', v_auth,
                             'source_kind', v_kind));

  -- O faturamento que estava travado pela pendência é reavaliado agora.
  FOR v_ev IN SELECT id FROM public.contract_billing_events
               WHERE organization_id = p_organization_id AND engagement_id = v_start.engagement_id
                 AND release_state NOT IN ('RELEASED','CANCELLED','SUPERSEDED')
                 AND NOT legacy_row LOOP
    PERFORM public.contract_billing_recompute_eligibility(v_ev.id);
    v_recomputed := v_recomputed + 1;
  END LOOP;

  RETURN jsonb_build_object('execution_start_id', v_start.id, 'documentation_state', 'REGULARIZED',
                            'authorization_id', v_auth, 'billing_events_recomputed', v_recomputed);
END $$;

-- ---------------------------------------------------------------------------
-- 7) Faturamento: a pendência documental BLOQUEIA
--
-- O resolvedor existente não é reescrito. Ele passa a se chamar `_core`, e o
-- nome canônico vira um invólucro que (a) repete a guarda de inquilino ANTES
-- de qualquer leitura — o `_core` chamado de dentro de uma função DEFINER não
-- enxerga mais o chamador do navegador — e (b) acrescenta um motivo
-- bloqueante quando o trabalho começou com documentação pendente. Todo
-- chamador (recompute, telas, serviço) passa pelo mesmo nome de sempre.
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.contract_billing_eligibility_resolve(uuid)
  RENAME TO contract_billing_eligibility_resolve_core;
REVOKE ALL ON FUNCTION public.contract_billing_eligibility_resolve_core(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contract_billing_eligibility_resolve_core(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.contract_billing_eligibility_resolve(p_billing_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_org uuid; v_eng uuid; v_res jsonb; v_start record; caller_org uuid;
  not_found jsonb := jsonb_build_object('state','UNKNOWN',
    'reasons', jsonb_build_array(jsonb_build_object('code','BILLING_EVENT_NOT_FOUND','blocking',true)));
BEGIN
  SELECT organization_id, engagement_id INTO v_org, v_eng
    FROM public.contract_billing_events WHERE id = p_billing_event_id;
  IF v_org IS NULL THEN RETURN not_found; END IF;
  caller_org := public.apex_browser_organization();
  IF caller_org IS NOT NULL AND v_org IS DISTINCT FROM caller_org THEN RETURN not_found; END IF;

  v_res := public.contract_billing_eligibility_resolve_core(p_billing_event_id);

  IF v_eng IS NOT NULL AND v_res->>'state' NOT IN ('LEGACY','NOT_APPLICABLE','UNKNOWN') THEN
    SELECT id, regularization_due_date, regularization_owner_user_id INTO v_start
      FROM public.commercial_execution_starts
     WHERE organization_id = v_org AND engagement_id = v_eng AND documentation_state = 'PENDING';
    IF FOUND THEN
      v_res := jsonb_set(v_res, '{reasons}', COALESCE(v_res->'reasons', '[]'::jsonb) || jsonb_build_object(
        'code', 'COMMERCIAL_DOCUMENTATION_PENDING', 'blocking', true,
        'detail', 'Execução iniciada com documentação comercial pendente; regularize antes de faturar.',
        'execution_start_id', v_start.id,
        'regularization_due_date', v_start.regularization_due_date));
      v_res := jsonb_set(v_res, '{state}', to_jsonb(
        CASE WHEN v_res->>'state' = 'INCOMPLETE' THEN 'INCOMPLETE' ELSE 'BLOCKED' END));
    END IF;
  END IF;
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION public.contract_billing_eligibility_resolve(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_billing_eligibility_resolve(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8) Privilégios e RLS
-- ---------------------------------------------------------------------------
DO $grants$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.commercial_site_survey_create(uuid,uuid,jsonb)',
    'public.commercial_site_survey_transition(uuid,uuid,uuid,text,text,jsonb)',
    'public.commercial_site_survey_record(uuid,uuid,uuid,jsonb)',
    'public.commercial_site_survey_register_attachment(uuid,uuid,uuid,jsonb)',
    'public.commercial_site_survey_record_apex_candidate(uuid,uuid,jsonb,text,text,text)',
    'public.commercial_close_and_start_execution(uuid,uuid,jsonb)',
    'public.commercial_execution_start_regularize(uuid,uuid,uuid,jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $grants$;

ALTER TABLE public.commercial_site_surveys        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_site_survey_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_execution_starts    ENABLE ROW LEVEL SECURITY;

CREATE POLICY css_select ON public.commercial_site_surveys FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND (public.current_user_has_permission('commercial.view')
          OR public.current_user_has_permission('commercial.surveys.manage')));
CREATE POLICY csse_select ON public.commercial_site_survey_events FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND (public.current_user_has_permission('commercial.view')
          OR public.current_user_has_permission('commercial.surveys.manage')));
-- A pendência precisa ser vista por quem opera o projeto e por quem fatura:
-- esconder a exceção é exatamente o que o escopo proíbe.
CREATE POLICY ces_select ON public.commercial_execution_starts FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
     AND (public.current_user_has_permission('commercial.view')
          OR public.current_user_has_permission('contracts.view')
          OR public.current_user_has_permission('projects.view')));

GRANT SELECT ON public.commercial_site_surveys, public.commercial_site_survey_events,
                public.commercial_execution_starts TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.commercial_site_surveys,
       public.commercial_site_survey_events, public.commercial_execution_starts
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.commercial_site_surveys, public.commercial_site_survey_events,
       public.commercial_execution_starts FROM anon;

COMMIT;
