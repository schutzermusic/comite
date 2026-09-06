-- ============================================================
-- PROJETOS — evidência de execução e mapeamento regra ↔ cronograma
-- Migration: 131_project_measurement_evidence
--
-- ─── As duas afirmações que esta migration protege ─────────────────────────
--
--   1. EVIDÊNCIA DE EXECUÇÃO NÃO É ACEITE.  Uma batida de ponto prova que
--      alguém esteve em algum lugar. Não prova que o serviço foi executado
--      conforme o contrato, e muito menos que o cliente aceitou. Por isso a
--      classe da evidência é COLUNA, com CHECK, e a classe de aceite não pode
--      ser atribuída por vínculo automático nenhum.
--
--   2. CRONOGRAMA DIZ QUANDO SE ESPERA, NÃO O QUE ACONTECEU.  O mapeamento
--      regra↔etapa é governado: quem mapeou, quando, por qual fonte, e — se foi
--      proposta de sistema — com que confiança e em que estado de revisão.
--      Proposta não é verdade (§17), e título parecido nunca vira vínculo (§94).
--
-- ─── Sobre a evidência polimórfica ─────────────────────────────────────────
--
-- `source_type + source_id` é um risco conhecido: sem cuidado, é o caminho
-- para anexar a linha de OUTRO inquilino. A §62 exige que uma função de
-- servidor resolva a origem, derive a organização, derive o projeto quando
-- possível e valide contra a medição alvo. É o que `project_measurement_link_
-- evidence` faz, e é o ÚNICO caminho concedido — a tabela não aceita INSERT de
-- navegador nenhum.
--
-- Batida de ponto e evidência de localização não têm projeto no registro. Isso
-- não é defeito a contornar: a atribuição de projeto delas mora no resolvedor
-- que a operação já usa (`src/lib/projects/execution-matching.ts`), com seus
-- limiares e seus códigos de razão. A §79 manda REUSAR esse resolvedor, e a
-- §23 proíbe inventar um limiar novo. Então elas entram como DERIVED_EVIDENCE
-- carregando a confiança e os códigos de razão do resolvedor — e nunca como
-- evidência validada ou de aceite.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1) Mapeamento regra contratual ↔ etapa de cronograma
-- ------------------------------------------------------------
CREATE TABLE public.contract_measurement_rule_timeline_mappings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id         uuid NOT NULL,
  rule_id             uuid NOT NULL,
  project_id          text NOT NULL,
  timeline_item_id    uuid NOT NULL,

  -- ---- proveniência do mapeamento (§17) ----
  mapping_source      text NOT NULL
                        CHECK (mapping_source IN ('explicit','deterministic_import','governed_system','system_proposed')),
  -- Confiança só existe para proposta. Um mapeamento explícito não tem
  -- "85% de certeza": alguém decidiu.
  confidence          numeric(4,3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  review_state        text NOT NULL DEFAULT 'proposed'
                        CHECK (review_state IN ('proposed','accepted','rejected')),
  mapped_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  mapped_at           timestamptz NOT NULL DEFAULT now(),
  reviewed_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at         timestamptz,
  note                text,

  CONSTRAINT cmrtm_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT cmrtm_unique UNIQUE (organization_id, rule_id, timeline_item_id),
  CONSTRAINT cmrtm_rule_tenant FOREIGN KEY (organization_id, contract_id, rule_id)
    REFERENCES public.contract_measurement_requirements (organization_id, contract_id, id) ON DELETE CASCADE,
  CONSTRAINT cmrtm_timeline_tenant FOREIGN KEY (organization_id, project_id, timeline_item_id)
    REFERENCES public.project_timeline_items (organization_id, project_id, id) ON DELETE CASCADE,
  -- O projeto tem de estar ligado ao contrato. Sem isso, mapear a regra do
  -- contrato A para a etapa de um projeto que ninguém ligou a ele seria
  -- exatamente o casamento por semelhança que a §76 proíbe.
  CONSTRAINT cmrtm_project_contract_linked FOREIGN KEY (organization_id, contract_id, project_id)
    REFERENCES public.contract_project_links (organization_id, contract_id, project_id) ON DELETE RESTRICT,

  /*
    A REGRA QUE FAZ PROPOSTA NÃO VIRAR VERDADE.

    Um mapeamento proposto pelo sistema só chega a `accepted` com revisor
    humano nomeado. Sem esta linha, bastaria um UPDATE de `review_state` para
    que uma sugestão de IA virasse vínculo governado — e é justamente isso que
    a §17 chama de "proposta != verdade".
  */
  CONSTRAINT cmrtm_proposal_needs_review CHECK (
    mapping_source <> 'system_proposed'
    OR review_state <> 'accepted'
    OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  -- Fonte determinística/explícita não carrega confiança; proposta carrega.
  CONSTRAINT cmrtm_confidence_scope CHECK (
    (mapping_source = 'system_proposed') OR (confidence IS NULL)),
  CONSTRAINT cmrtm_reviewed_coherent CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL))
);

CREATE INDEX cmrtm_rule ON public.contract_measurement_rule_timeline_mappings
  (organization_id, rule_id) WHERE review_state = 'accepted';
CREATE INDEX cmrtm_project ON public.contract_measurement_rule_timeline_mappings
  (organization_id, project_id, timeline_item_id);

COMMENT ON TABLE public.contract_measurement_rule_timeline_mappings IS
  'Mapeamento GOVERNADO entre a regra contratual de medição e a etapa de '
  'cronograma. Só `review_state = accepted` é consumido pela materialização e '
  'pela prontidão; proposta fica visível e inerte (§17).';

/*
  O único mapeamento CONSUMÍVEL. Existe como visão para que nenhum consumidor
  precise lembrar do filtro — esquecer o `review_state = 'accepted'` num JOIN
  qualquer é como uma proposta viraria verdade na prática.
*/
CREATE VIEW public.contract_measurement_rule_timeline_governed
WITH (security_invoker = true) AS
  SELECT id, organization_id, contract_id, rule_id, project_id, timeline_item_id,
         mapping_source, mapped_by, mapped_at, reviewed_by, reviewed_at
    FROM public.contract_measurement_rule_timeline_mappings
   WHERE review_state = 'accepted';

ALTER TABLE public.contract_measurement_rule_timeline_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY cmrtm_select ON public.contract_measurement_rule_timeline_mappings FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.current_user_has_permission('projects.measurements.view')
              OR public.current_user_has_permission('contracts.view')
              OR public.current_user_is_admin()));
GRANT SELECT ON public.contract_measurement_rule_timeline_mappings TO authenticated;
GRANT SELECT ON public.contract_measurement_rule_timeline_governed TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.contract_measurement_rule_timeline_mappings FROM authenticated, anon;
REVOKE ALL ON public.contract_measurement_rule_timeline_mappings FROM anon;
REVOKE ALL ON public.contract_measurement_rule_timeline_governed FROM anon;

-- ------------------------------------------------------------
-- 2) Evidência vinculada à medição
-- ------------------------------------------------------------
CREATE TABLE public.project_measurement_evidence (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  measurement_id      uuid NOT NULL,
  -- Projeto desnormalizado NÃO é conveniência de consulta: é o que permite ao
  -- CHECK e à função de vínculo compararem o projeto da ORIGEM com o projeto
  -- da MEDIÇÃO sem uma subconsulta que alguém possa esquecer.
  project_id          text NOT NULL,

  source_type         text NOT NULL
                        CHECK (source_type IN ('attendance_punch','location_evidence','daily_allowance',
                                               'time_entry','work_session','project_file','contract_document',
                                               'timeline_item','task','manual_record')),
  source_id           uuid NOT NULL,

  -- ---- classificação (§21) ----
  evidence_class      text NOT NULL
                        CHECK (evidence_class IN ('RAW_EVIDENCE','DERIVED_EVIDENCE','VALIDATED_EVIDENCE','ACCEPTANCE_EVIDENCE')),
  -- Como o vínculo nasceu. `system_inferred` carrega confiança; os outros não.
  link_source         text NOT NULL
                        CHECK (link_source IN ('deterministic','manual','system_inferred')),
  confidence          numeric(4,3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  validation_state    text NOT NULL DEFAULT 'unvalidated'
                        CHECK (validation_state IN ('unvalidated','validated','rejected')),
  validated_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  validated_at        timestamptz,

  -- Qual exigência contratual esta evidência atende, quando se sabe. Nula é
  -- legítima: nem toda evidência responde a uma exigência nomeada.
  requirement_kind    text,

  captured_at         timestamptz,
  person_id           uuid,
  provenance          jsonb NOT NULL DEFAULT '{}'::jsonb
                        CHECK (jsonb_typeof(provenance) = 'object'),
  note                text,

  linked_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  linked_at           timestamptz NOT NULL DEFAULT now(),
  revoked_at          timestamptz,
  revoked_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revocation_reason   text,

  CONSTRAINT pme_org_id_unique UNIQUE (organization_id, id),
  -- Idempotência do vínculo (§95): a mesma origem não entra duas vezes.
  CONSTRAINT pme_unique UNIQUE (organization_id, measurement_id, source_type, source_id),
  CONSTRAINT pme_measurement_tenant FOREIGN KEY (organization_id, measurement_id)
    REFERENCES public.project_measurements (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT pme_project_tenant FOREIGN KEY (organization_id, project_id)
    REFERENCES public.projects (organization_id, id) ON DELETE CASCADE,

  /*
    A REGRA QUE IMPEDE UMA BATIDA DE PONTO DE VIRAR ACEITE.

    Evidência inferida por sistema nunca é validada nem de aceite. Para subir de
    classe é preciso um humano — e a subida é registrada em `validated_by`.
  */
  CONSTRAINT pme_inferred_stays_derived CHECK (
    link_source <> 'system_inferred'
    OR evidence_class IN ('RAW_EVIDENCE','DERIVED_EVIDENCE')),
  CONSTRAINT pme_validated_needs_human CHECK (
    validation_state <> 'validated' OR (validated_by IS NOT NULL AND validated_at IS NOT NULL)),
  CONSTRAINT pme_validated_class CHECK (
    evidence_class <> 'VALIDATED_EVIDENCE' OR validation_state = 'validated'),
  -- Evidência de ACEITE é documento ou registro manual com pessoa nomeada.
  -- Uma coordenada de GPS não é prova de aceite contratual, e o CHECK diz isso.
  CONSTRAINT pme_acceptance_class_source CHECK (
    evidence_class <> 'ACCEPTANCE_EVIDENCE'
    OR (source_type IN ('contract_document','project_file','manual_record')
        AND link_source = 'manual' AND linked_by IS NOT NULL)),
  CONSTRAINT pme_confidence_scope CHECK (
    (link_source = 'system_inferred') OR (confidence IS NULL)),
  CONSTRAINT pme_revoked_coherent CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  CONSTRAINT pme_validated_pair CHECK ((validated_at IS NULL) = (validated_by IS NULL))
);

CREATE INDEX pme_measurement ON public.project_measurement_evidence (organization_id, measurement_id)
  WHERE revoked_at IS NULL;
CREATE INDEX pme_source ON public.project_measurement_evidence (organization_id, source_type, source_id);
CREATE INDEX pme_requirement ON public.project_measurement_evidence (organization_id, measurement_id, requirement_kind)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE public.project_measurement_evidence IS
  'Evidência vinculada a uma medição, com classe, proveniência e estado de '
  'validação. Vínculo entra SÓ por project_measurement_link_evidence (§62). '
  'Revogar não apaga: `revoked_at` preserva que houve o vínculo (§95).';

ALTER TABLE public.project_measurement_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY pme_select ON public.project_measurement_evidence FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.current_user_has_permission('projects.measurements.view')
              OR public.current_user_has_permission('projects.view')
              OR public.current_user_is_admin()));
GRANT SELECT ON public.project_measurement_evidence TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.project_measurement_evidence FROM authenticated, anon;
REVOKE ALL ON public.project_measurement_evidence FROM anon;

-- ------------------------------------------------------------
-- 3) O resolvedor de origem polimórfica
-- ------------------------------------------------------------
/*
  CASE explícito, um ramo por tabela — a mesma decisão da 128. Não há despacho
  por nome de tabela guardado em coluna: isso deixaria quem escreve a linha
  escolher qual consulta roda.

  `project_id` volta NULO quando a origem genuinamente não afirma projeto
  (batida de ponto, evidência de localização). Nulo aqui NÃO é permissão para
  vincular a qualquer projeto — é o que faz a função de vínculo exigir
  `link_source = 'system_inferred'` com confiança, em vez de aceitar o vínculo
  como determinístico.
*/
CREATE FUNCTION public.project_measurement_resolve_source(
  p_source_type text,
  p_source_id   uuid
) RETURNS TABLE (
  supported     boolean,
  found         boolean,
  organization_id uuid,
  project_id    text,
  captured_at   timestamptz,
  person_id     uuid,
  is_valid      boolean,
  label         text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_source_type = 'attendance_punch' THEN
    RETURN QUERY
      SELECT true, true, p.organization_id, NULL::text, p.occurred_at, p.person_id,
             -- `cancelled` é a batida desfeita; `under_review` ainda não é
             -- fato apurado. Nenhuma das duas é evidência de execução.
             (p.status IN ('accepted','corrected')),
             format('Batida %s', p.type)
        FROM public.attendance_punches p WHERE p.id = p_source_id;

  ELSIF p_source_type = 'location_evidence' THEN
    RETURN QUERY
      SELECT true, true, l.organization_id, NULL::text,
             COALESCE(l.captured_at_device, l.received_at_server), l.person_id,
             -- `suspicious` e `unverified` não sobem para verdade de
             -- execução: a §23 proíbe promover o que não se sustenta.
             (l.integrity_status IN ('trusted','limited')),
             'Evidência de localização'::text
        FROM public.location_evidence l WHERE l.id = p_source_id;

  ELSIF p_source_type = 'daily_allowance' THEN
    RETURN QUERY
      SELECT true, true, d.organization_id, d.project_id, d.allowance_date::timestamptz, d.person_id,
             (d.status NOT IN ('reversed','blocked','candidate')),
             format('Diária %s', d.allowance_date)
        FROM public.daily_allowances d WHERE d.id = p_source_id;

  ELSIF p_source_type = 'time_entry' THEN
    RETURN QUERY
      SELECT true, true, t.organization_id, t.project_id, t.created_at, t.person_id,
             (t.status IN ('approved','locked')), 'Apontamento'::text
        FROM public.time_entries t WHERE t.id = p_source_id;

  ELSIF p_source_type = 'work_session' THEN
    RETURN QUERY
      SELECT true, true, w.organization_id, w.project_id, w.started_at, w.person_id,
             (w.status = 'consolidated'), 'Sessão de trabalho'::text
        FROM public.project_work_sessions w WHERE w.id = p_source_id;

  ELSIF p_source_type = 'project_file' THEN
    RETURN QUERY
      SELECT true, true, f.organization_id, f.project_id, f.created_at, NULL::uuid,
             true, COALESCE(f.file_name, 'Documento do projeto')
        FROM public.project_files f WHERE f.id = p_source_id;

  ELSIF p_source_type = 'contract_document' THEN
    -- Documento contratual não tem projeto, e não deve ter: ele pertence ao
    -- contrato. O vínculo confere a organização e deixa o projeto a cargo da
    -- medição alvo.
    RETURN QUERY
      SELECT true, true, cd.organization_id, NULL::text, cd.created_at, NULL::uuid,
             true, COALESCE(cd.title, 'Documento contratual')
        FROM public.contract_documents cd WHERE cd.id = p_source_id;

  ELSIF p_source_type = 'timeline_item' THEN
    RETURN QUERY
      SELECT true, true, i.organization_id, i.project_id,
             COALESCE(i.actual_finish, i.actual_start)::timestamptz, NULL::uuid,
             (i.deleted_at IS NULL AND i.is_active), i.title
        FROM public.project_timeline_items i WHERE i.id = p_source_id;

  ELSIF p_source_type = 'task' THEN
    -- A §80: tarefa só é evidência quando ela mesma declara o projeto.
    -- `related_project_id` nulo devolve projeto nulo, e o vínculo determinístico
    -- é recusado logo abaixo.
    RETURN QUERY
      SELECT true, true, k.organization_id, k.related_project_id, k.completed_at, NULL::uuid,
             (k.deleted_at IS NULL AND k.status = 'done'), k.title
        FROM public.tasks k WHERE k.id = p_source_id;

  ELSE
    RETURN QUERY SELECT false, false, NULL::uuid, NULL::text, NULL::timestamptz, NULL::uuid, false, NULL::text;
    RETURN;
  END IF;

  -- Nada encontrado: `supported = true`, `found = false`. A distinção importa —
  -- "não sei ler esse tipo" e "esse registro não existe" pedem respostas
  -- diferentes de quem chamou.
  IF NOT FOUND THEN
    RETURN QUERY SELECT true, false, NULL::uuid, NULL::text, NULL::timestamptz, NULL::uuid, false, NULL::text;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.project_measurement_resolve_source(text, uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.project_measurement_resolve_source(text, uuid) IS
  'Adaptador de origem do lado do SERVIDOR (§62). Resolve o registro, deriva a '
  'organização e o projeto QUANDO a origem os afirma. Projeto nulo é resposta '
  'honesta, não convite para escolher um.';

-- ------------------------------------------------------------
-- 4) O único caminho de vínculo
-- ------------------------------------------------------------
CREATE FUNCTION public.project_measurement_link_evidence(
  p_measurement_id   uuid,
  p_source_type      text,
  p_source_id        uuid,
  p_evidence_class   text    DEFAULT 'RAW_EVIDENCE',
  p_link_source      text    DEFAULT 'deterministic',
  p_confidence       numeric DEFAULT NULL,
  p_requirement_kind text    DEFAULT NULL,
  p_provenance       jsonb   DEFAULT '{}'::jsonb,
  p_note             text    DEFAULT NULL,
  p_linked_by        uuid    DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m   public.project_measurements%ROWTYPE;
  src record;
  existing_id uuid;
  actor uuid;
BEGIN
  SELECT * INTO m FROM public.project_measurements WHERE id = p_measurement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEASUREMENT_NOT_FOUND: medição inexistente.' USING ERRCODE = 'no_data_found';
  END IF;

  -- Medição finalizada não recebe evidência nova. Aceitar prova depois do
  -- aceite mudaria, retroativamente, o pacote que sustentou a decisão.
  IF m.status IN ('ACCEPTED','REJECTED','CANCELLED','SUPERSEDED') THEN
    RAISE EXCEPTION 'MEASUREMENT_FINALIZED: medição em % não recebe evidência nova.', m.status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO src FROM public.project_measurement_resolve_source(p_source_type, p_source_id);
  IF NOT src.supported THEN
    RAISE EXCEPTION 'SOURCE_TYPE_UNSUPPORTED: tipo de origem % não é lido pelo servidor.', p_source_type
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT src.found THEN
    RAISE EXCEPTION 'SOURCE_NOT_FOUND: registro de origem inexistente.' USING ERRCODE = 'no_data_found';
  END IF;

  -- ---- inquilino: a fronteira que a §62 existe para fechar ----
  IF src.organization_id IS DISTINCT FROM m.organization_id THEN
    RAISE EXCEPTION 'CROSS_TENANT_EVIDENCE: origem pertence a outro inquilino.' USING ERRCODE = '42501';
  END IF;

  -- ---- projeto: quando a origem afirma, tem de bater ----
  IF src.project_id IS NOT NULL AND src.project_id IS DISTINCT FROM m.project_id THEN
    RAISE EXCEPTION 'WRONG_PROJECT: origem pertence ao projeto %, a medição é do projeto %.',
      src.project_id, m.project_id USING ERRCODE = 'check_violation';
  END IF;

  /*
    ...e quando a origem NÃO afirma projeto, o vínculo não pode se declarar
    determinístico. Documento contratual é a exceção nomeada: ele pertence ao
    CONTRATO, e o contrato da medição já foi provado pela FK composta.
  */
  IF src.project_id IS NULL
     AND p_link_source = 'deterministic'
     AND p_source_type <> 'contract_document' THEN
    RAISE EXCEPTION
      'NOT_DETERMINISTIC: origem % não afirma projeto; use link_source = system_inferred com confiança.', p_source_type
      USING ERRCODE = 'check_violation';
  END IF;

  -- Registro inválido na origem (batida rejeitada, tarefa não concluída) não é
  -- evidência de execução. A §23 proíbe promover o que não se sustenta.
  IF NOT src.is_valid THEN
    RAISE EXCEPTION 'SOURCE_INVALID: registro de origem descartado/não concluído não é evidência.'
      USING ERRCODE = 'check_violation';
  END IF;

  /*
    O ATOR. A §63 é literal: o navegador não escolhe quem agiu. Quando quem
    chama é `authenticated`, o ator é `auth.uid()` e o parâmetro é ignorado.
    O parâmetro só serve ao servidor, que já autorizou a rota.
  */
  actor := CASE WHEN current_user IN ('authenticated','anon') THEN auth.uid() ELSE COALESCE(p_linked_by, auth.uid()) END;

  INSERT INTO public.project_measurement_evidence
    (organization_id, measurement_id, project_id, source_type, source_id,
     evidence_class, link_source, confidence, requirement_kind,
     captured_at, person_id, provenance, note, linked_by)
  VALUES
    (m.organization_id, m.id, m.project_id, p_source_type, p_source_id,
     p_evidence_class, p_link_source, p_confidence, p_requirement_kind,
     src.captured_at, src.person_id, COALESCE(p_provenance, '{}'::jsonb), p_note, actor)
  ON CONFLICT (organization_id, measurement_id, source_type, source_id) DO NOTHING
  RETURNING id INTO existing_id;

  -- Retentativa devolve o vínculo que já existe. A §95 pede idempotência, e
  -- idempotência silenciosa é melhor que erro: o trabalho de reconciliação
  -- roda de novo por desenho.
  IF existing_id IS NULL THEN
    SELECT id INTO existing_id FROM public.project_measurement_evidence
     WHERE organization_id = m.organization_id AND measurement_id = m.id
       AND source_type = p_source_type AND source_id = p_source_id;
  END IF;

  RETURN existing_id;
END $$;
REVOKE ALL ON FUNCTION public.project_measurement_link_evidence(
  uuid, text, uuid, text, text, numeric, text, jsonb, text, uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.project_measurement_link_evidence(
  uuid, text, uuid, text, text, numeric, text, jsonb, text, uuid) IS
  'Único caminho de vínculo de evidência. Resolve origem, valida inquilino e '
  'projeto, recusa registro inválido e é idempotente. O navegador não alcança.';

-- ------------------------------------------------------------
-- 5) Revogação de evidência
-- ------------------------------------------------------------
-- Revogar NÃO apaga a linha. Que a evidência existiu, e foi usada, é parte da
-- história do pacote; apagá-la faria a prontidão de ontem parecer inexplicável.
CREATE FUNCTION public.project_measurement_revoke_evidence(
  p_evidence_id uuid,
  p_reason      text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e public.project_measurement_evidence%ROWTYPE;
  m_status text;
BEGIN
  SELECT * INTO e FROM public.project_measurement_evidence WHERE id = p_evidence_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EVIDENCE_NOT_FOUND: vínculo inexistente.' USING ERRCODE = 'no_data_found';
  END IF;
  IF e.revoked_at IS NOT NULL THEN RETURN; END IF;

  SELECT status INTO m_status FROM public.project_measurements WHERE id = e.measurement_id;
  IF m_status IN ('ACCEPTED','REJECTED','SUPERSEDED') THEN
    RAISE EXCEPTION 'MEASUREMENT_FINALIZED: o pacote que sustentou a decisão não muda depois dela.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NULLIF(btrim(COALESCE(p_reason,'')), '') IS NULL THEN
    RAISE EXCEPTION 'REASON_REQUIRED: revogação exige motivo.' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.project_measurement_evidence
     SET revoked_at = now(), revoked_by = auth.uid(), revocation_reason = p_reason
   WHERE id = p_evidence_id;
END $$;
REVOKE ALL ON FUNCTION public.project_measurement_revoke_evidence(uuid, text) FROM PUBLIC, anon, authenticated;

COMMIT;
