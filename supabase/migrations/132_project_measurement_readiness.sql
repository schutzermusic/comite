-- ============================================================
-- PROJETOS — pacote de medição, exigências resolvidas e PRONTIDÃO
-- Migration: 132_project_measurement_readiness
--
-- ─── A pergunta que esta migration responde ────────────────────────────────
--
--   "O que falta para esta medição poder ser submetida — e por quê?"
--
-- A resposta NÃO é um booleano. A §28 proíbe colapsar prontidão num sim/não
-- opaco, e a §29 exige razão acionável. Então a prontidão sai em DIMENSÕES,
-- cada uma com estado e códigos de razão, e o estado geral é DERIVADO delas
-- por uma regra que se lê em voz alta.
--
-- ─── A regra que manda em tudo ─────────────────────────────────────────────
--
--   INFORMAÇÃO AUSENTE NUNCA VIRA `READY`.
--
-- É por isso que `UNKNOWN` existe como estado de primeira classe (§30) e é por
-- isso que ele DOMINA `INCOMPLETE` na derivação: "falta o relatório" é um
-- problema que alguém sabe resolver; "não sei qual regra rege esta medição" é
-- um problema que ninguém sabe que tem. O segundo é pior, e aparece primeiro.
--
-- ─── O que a prontidão NÃO faz ─────────────────────────────────────────────
--
-- Não libera faturamento. A dimensão `billing_prerequisite` é PROJEÇÃO (§31):
-- ela responde "se o faturamento dependesse só do que Medição sabe, faltaria
-- algo?". Direito de faturar é Fase 7, e esta migration não escreve nem lê
-- Financeiro ou Fiscal.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1) Exigências resolvidas por medição — o PACOTE
-- ------------------------------------------------------------
/*
  A §66 separa quatro coisas que a operação confunde o tempo todo:

    EXIGIDO      o contrato pede
    FORNECIDO    alguém anexou
    VALIDADO     alguém conferiu
    ACEITO       o cliente aceitou

  Um arquivo existir não satisfaz exigência contratual. Por isso a linha guarda
  `satisfaction_state` separado da existência do vínculo de evidência.

  E a exigência é RESOLVIDA NA VIGÊNCIA da ocorrência (§26): o instantâneo da
  cláusula fica aqui para que um aditivo de amanhã não faça a medição de ontem
  parecer que sempre exigiu o relatório novo.
*/
CREATE TABLE public.project_measurement_requirements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  measurement_id        uuid NOT NULL,
  contract_measurement_rule_id uuid NOT NULL,

  requirement_kind      text NOT NULL
                          CHECK (requirement_kind IN ('TECHNICAL_REPORT','SERVICE_REPORT','DOCUMENT',
                                                      'PHOTOS','TESTS_INSPECTION','EVIDENCE','CUSTOMER_ACCEPTANCE')),
  required              boolean NOT NULL,
  -- `UNKNOWN` é o estado correto quando a regra não diz se exige. Não existe
  -- "não exige por omissão": a §30 chama isso de verdade ausente.
  requirement_certainty text NOT NULL DEFAULT 'declared'
                          CHECK (requirement_certainty IN ('declared','unknown')),
  document_type         text,
  detail                text,

  -- ---- proveniência contratual (§49: "por que o Apex está pedindo isso?") ----
  source_clause_id      uuid,
  source_document_id    uuid,
  source_reference      text,
  source_page           integer CHECK (source_page IS NULL OR source_page > 0),
  rule_effective_from   date,
  rule_effective_until  date,
  responsible_party_id  uuid,

  -- ---- estado ----
  satisfaction_state    text NOT NULL DEFAULT 'MISSING'
                          CHECK (satisfaction_state IN ('MISSING','PROVIDED','VALIDATED','NOT_APPLICABLE','UNKNOWN')),
  satisfied_by_evidence_id uuid,
  resolved_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pmr_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pmr_unique UNIQUE (organization_id, measurement_id, requirement_kind),
  CONSTRAINT pmr_measurement_tenant FOREIGN KEY (organization_id, measurement_id)
    REFERENCES public.project_measurements (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT pmr_rule_tenant FOREIGN KEY (organization_id, contract_measurement_rule_id)
    REFERENCES public.contract_measurement_requirements (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT pmr_evidence_tenant FOREIGN KEY (organization_id, satisfied_by_evidence_id)
    REFERENCES public.project_measurement_evidence (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT pmr_party_tenant FOREIGN KEY (organization_id, responsible_party_id)
    REFERENCES public.parties (organization_id, id) ON DELETE SET NULL,
  -- Exigência incerta não é exigência satisfeita. Sem esta linha, `UNKNOWN`
  -- viraria `NOT_APPLICABLE` no primeiro relatório que alguém montasse.
  CONSTRAINT pmr_unknown_coherent CHECK (
    requirement_certainty <> 'unknown' OR satisfaction_state IN ('UNKNOWN','MISSING')),
  CONSTRAINT pmr_satisfied_needs_evidence CHECK (
    satisfaction_state NOT IN ('PROVIDED','VALIDATED') OR satisfied_by_evidence_id IS NOT NULL)
);

CREATE INDEX pmr_measurement ON public.project_measurement_requirements (organization_id, measurement_id);
CREATE INDEX pmr_missing ON public.project_measurement_requirements (organization_id, measurement_id)
  WHERE required AND satisfaction_state = 'MISSING';

COMMENT ON TABLE public.project_measurement_requirements IS
  'Exigências contratuais RESOLVIDAS na vigência da ocorrência (§26), com a '
  'proveniência que responde "por que o Apex pede isso" (§49). Fornecido, '
  'validado e aceito são estados distintos (§66).';

ALTER TABLE public.project_measurement_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY pmr_select ON public.project_measurement_requirements FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.current_user_has_permission('projects.measurements.view')
              OR public.current_user_has_permission('projects.view')
              OR public.current_user_is_admin()));
GRANT SELECT ON public.project_measurement_requirements TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.project_measurement_requirements FROM authenticated, anon;
REVOKE ALL ON public.project_measurement_requirements FROM anon;

-- ------------------------------------------------------------
-- 2) Resolução das exigências a partir da regra vigente
-- ------------------------------------------------------------
/*
  A regra da Fase 2 guarda as exigências como sinalizadores. Traduzi-los em
  linhas é o que permite dizer "falta o laudo de ensaio" em vez de "faltam
  requisitos".

  `NULL` num sinalizador NÃO é `false`. A Fase 2 deixou as colunas anuláveis
  justamente porque nem toda cláusula lida disse alguma coisa sobre ensaio ou
  aceite. Traduzir nulo para "não exige" seria transformar silêncio em
  dispensa — e é assim que uma medição fica pronta sem estar.
*/
CREATE FUNCTION public.project_measurement_resolve_requirements(p_measurement_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m public.project_measurements%ROWTYPE;
  r public.contract_measurement_requirements%ROWTYPE;
  n integer := 0;

  -- (sinalizador, tipo de exigência) na ordem em que a operação os encontra.
  kinds text[] := ARRAY['TECHNICAL_REPORT','SERVICE_REPORT','DOCUMENT','TESTS_INSPECTION','EVIDENCE','CUSTOMER_ACCEPTANCE'];
  k text;
  flag boolean;
  doc_type text;
BEGIN
  SELECT * INTO m FROM public.project_measurements WHERE id = p_measurement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEASUREMENT_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT * INTO r FROM public.contract_measurement_requirements
   WHERE id = m.contract_measurement_rule_id AND organization_id = m.organization_id;
  IF NOT FOUND THEN
    -- Regra sumiu: a prontidão dirá RULE_UNRESOLVED. Não se inventa exigência.
    RETURN 0;
  END IF;

  FOREACH k IN ARRAY kinds LOOP
    flag := CASE k
      WHEN 'TECHNICAL_REPORT'    THEN r.technical_report_required
      WHEN 'SERVICE_REPORT'      THEN r.report_required
      WHEN 'DOCUMENT'            THEN (r.required_document_type IS NOT NULL)
      WHEN 'TESTS_INSPECTION'    THEN r.tests_inspection_required
      WHEN 'EVIDENCE'            THEN r.evidence_required
      WHEN 'CUSTOMER_ACCEPTANCE' THEN r.customer_acceptance_required
    END;

    doc_type := CASE k WHEN 'DOCUMENT' THEN r.required_document_type
                       WHEN 'SERVICE_REPORT' THEN r.report_type END;

    -- Sinalizador FALSO declarado é dispensa real: a linha entra como
    -- `required = false`, e a prontidão a lê como NOT_APPLICABLE.
    -- Sinalizador NULO entra como exigência de certeza desconhecida.
    INSERT INTO public.project_measurement_requirements
      (organization_id, measurement_id, contract_measurement_rule_id, requirement_kind,
       required, requirement_certainty, document_type,
       source_clause_id, source_document_id, source_reference, source_page,
       rule_effective_from, rule_effective_until, responsible_party_id,
       satisfaction_state)
    VALUES
      (m.organization_id, m.id, r.id, k,
       COALESCE(flag, true), CASE WHEN flag IS NULL THEN 'unknown' ELSE 'declared' END, doc_type,
       r.source_clause_id, r.source_document_id, r.source_reference, r.source_page,
       r.effective_from, r.effective_until, r.responsible_party_id,
       CASE WHEN flag IS NULL THEN 'UNKNOWN'
            WHEN flag = false THEN 'NOT_APPLICABLE'
            ELSE 'MISSING' END)
    ON CONFLICT (organization_id, measurement_id, requirement_kind) DO NOTHING;
    n := n + 1;
  END LOOP;

  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.project_measurement_resolve_requirements(uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 3) Reconciliação exigência ↔ evidência
-- ------------------------------------------------------------
-- Casa evidência com exigência pelo `requirement_kind` que o vínculo declarou.
-- Não adivinha por nome de arquivo: um PDF chamado "relatorio.pdf" não é o
-- relatório técnico exigido só porque o nome combina.
CREATE FUNCTION public.project_measurement_reconcile_requirements(p_measurement_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.project_measurement_requirements q
     SET satisfaction_state = CASE
           WHEN q.requirement_certainty = 'unknown' THEN 'UNKNOWN'
           WHEN NOT q.required THEN 'NOT_APPLICABLE'
           WHEN best.evidence_id IS NULL THEN 'MISSING'
           WHEN best.validated THEN 'VALIDATED'
           ELSE 'PROVIDED' END,
         satisfied_by_evidence_id = CASE
           WHEN q.requirement_certainty = 'unknown' OR NOT q.required THEN NULL
           ELSE best.evidence_id END,
         resolved_at = now()
    FROM (SELECT q2.id AS req_id,
                 -- Evidência VALIDADA ganha da meramente fornecida. Se as duas
                 -- existem, é a validada que descreve o estado.
                 (SELECT e.id FROM public.project_measurement_evidence e
                   WHERE e.measurement_id = q2.measurement_id
                     AND e.requirement_kind = q2.requirement_kind
                     AND e.revoked_at IS NULL
                   ORDER BY (e.validation_state = 'validated') DESC, e.linked_at
                   LIMIT 1) AS evidence_id,
                 EXISTS (SELECT 1 FROM public.project_measurement_evidence e
                          WHERE e.measurement_id = q2.measurement_id
                            AND e.requirement_kind = q2.requirement_kind
                            AND e.revoked_at IS NULL
                            AND e.validation_state = 'validated') AS validated
            FROM public.project_measurement_requirements q2
           WHERE q2.measurement_id = p_measurement_id) AS best
   WHERE q.id = best.req_id;
END $$;
REVOKE ALL ON FUNCTION public.project_measurement_reconcile_requirements(uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4) Estado de UMA dimensão a partir das exigências que a compõem
-- ------------------------------------------------------------
/*
  Uma dimensão agrupa exigências afins ("relatório" são duas: técnico e de
  serviço). A ordem de precedência aqui é a mesma do estado geral, e existe
  como função só para que o resolvedor abaixo não repita cinco vezes o mesmo
  bloco — repetido, ele divergiria na primeira manutenção.

  Ausência TOTAL de linha devolve UNKNOWN, e não NOT_APPLICABLE: não ter
  resolvido as exigências ainda é diferente de o contrato tê-las dispensado.
*/
CREATE FUNCTION public.project_measurement_dimension_state(
  p_measurement_id uuid,
  p_kinds          text[]
) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN count(*) = 0 THEN 'UNKNOWN'
    WHEN bool_or(satisfaction_state = 'UNKNOWN') THEN 'UNKNOWN'
    WHEN bool_or(required AND satisfaction_state = 'MISSING') THEN 'INCOMPLETE'
    WHEN bool_and(NOT required) THEN 'NOT_APPLICABLE'
    ELSE 'READY' END
  FROM public.project_measurement_requirements
  WHERE measurement_id = p_measurement_id AND requirement_kind = ANY (p_kinds)
$$;
REVOKE ALL ON FUNCTION public.project_measurement_dimension_state(uuid, text[]) FROM PUBLIC, anon;

-- ------------------------------------------------------------
-- 5) O resolvedor CANÔNICO de prontidão
-- ------------------------------------------------------------
/*
  Um só resolvedor, consumido por Projetos e por Contratos (§27, §84). Duplicar
  esta lógica na tela seria garantir que as duas telas divergissem — e a
  divergência apareceria como "o Contratos diz que está pronto e o Projetos
  diz que não".

  É `STABLE` e derivada: não há booleano guardado que possa envelhecer (§48).
  O que a 133 guarda é CACHE com `computed_at` e impressão das entradas,
  explicitamente rotulado como cache.
*/
CREATE FUNCTION public.project_measurement_readiness(
  p_measurement_id uuid,
  p_as_of          date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m           public.project_measurements%ROWTYPE;
  r           public.contract_measurement_requirements%ROWTYPE;
  as_of       date := COALESCE(p_as_of, CURRENT_DATE);
  dims        jsonb := '{}'::jsonb;
  reasons     text[] := ARRAY[]::text[];
  overall     text;
  states      text[];
  s           text;

  has_mapping     boolean;
  evidence_count  integer;
  validated_count integer;
  missing_req     text[];
  unknown_req     text[];
  blocking_obl    integer;
  rule_ok         boolean;

  d_execution text; d_evidence text; d_report text; d_docs text;
  d_complete  text; d_submission text; d_acceptance text; d_billing text;
BEGIN
  SELECT * INTO m FROM public.project_measurements WHERE id = p_measurement_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('overall','UNKNOWN','reasons', to_jsonb(ARRAY['MEASUREMENT_NOT_FOUND']),
                              'dimensions','{}'::jsonb,'as_of',as_of);
  END IF;

  /*
    A função é DEFINER porque precisa ler obrigações e evidência sem depender
    da RLS de cada tabela. DEFINER sem esta guarda seria um oráculo entre
    inquilinos: bastaria um UUID para descobrir o estado de uma medição alheia.
    A resposta para "de outro inquilino" é a MESMA de "não existe" — a mesma
    decisão da 119.

    A guarda olha `auth.uid()`, e não o papel do banco: prendê-la a
    `current_user = 'authenticated'` a desligaria para o service role, que é
    justamente por onde as rotas de servidor falam.
  */
  IF auth.uid() IS NOT NULL
     AND m.organization_id IS DISTINCT FROM public.current_user_organization_id() THEN
    RETURN jsonb_build_object('overall','UNKNOWN','reasons', to_jsonb(ARRAY['MEASUREMENT_NOT_FOUND']),
                              'dimensions','{}'::jsonb,'as_of',as_of);
  END IF;

  -- ---------- a regra contratual, NA VIGÊNCIA (§26, §75) ----------
  SELECT * INTO r FROM public.contract_measurement_requirements
   WHERE id = m.contract_measurement_rule_id AND organization_id = m.organization_id;

  rule_ok := FOUND
    AND (r.effective_from IS NULL OR r.effective_from <= COALESCE(m.measurement_period_end, m.expected_at, as_of))
    AND (r.effective_until IS NULL OR r.effective_until > COALESCE(m.measurement_period_start, m.expected_at, as_of))
    AND r.effect <> 'removed';

  IF NOT rule_ok THEN reasons := reasons || 'RULE_UNRESOLVED'::text; END IF;

  -- ---------- ocorrência (§15) ----------
  IF m.occurrence_state = 'unresolved' THEN reasons := reasons || 'OCCURRENCE_UNRESOLVED'::text; END IF;

  -- ---------- mapeamento de cronograma (§16, §94) ----------
  -- Só mapeamento ACEITO conta. Proposta pendente é ausência de mapeamento.
  has_mapping := m.timeline_item_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.contract_measurement_rule_timeline_governed g
                WHERE g.organization_id = m.organization_id
                  AND g.rule_id = m.contract_measurement_rule_id
                  AND g.project_id = m.project_id);
  IF NOT has_mapping THEN reasons := reasons || 'TIMELINE_MAPPING_UNRESOLVED'::text; END IF;

  -- ---------- evidência ----------
  SELECT count(*)::int, count(*) FILTER (WHERE validation_state = 'validated')::int
    INTO evidence_count, validated_count
    FROM public.project_measurement_evidence
   WHERE measurement_id = m.id AND revoked_at IS NULL;

  SELECT array_agg(requirement_kind ORDER BY requirement_kind)
    INTO missing_req
    FROM public.project_measurement_requirements
   WHERE measurement_id = m.id AND required AND satisfaction_state = 'MISSING';

  SELECT array_agg(requirement_kind ORDER BY requirement_kind)
    INTO unknown_req
    FROM public.project_measurement_requirements
   WHERE measurement_id = m.id AND satisfaction_state = 'UNKNOWN';

  -- ---------- obrigações que travam faturamento (§32) ----------
  -- LEITURA, e nada mais. Projetos não reescreve verdade de obrigação.
  SELECT count(*)::int INTO blocking_obl
    FROM public.contract_obligation_instances i
    JOIN public.contract_obligation_definitions d
      ON d.id = i.definition_id AND d.organization_id = i.organization_id
   WHERE i.organization_id = m.organization_id
     AND i.contract_id = m.contract_id
     AND d.blocks_billing
     AND i.state IN ('OPEN','EXCEPTION');

  -- ============ dimensão: EXECUÇÃO ============
  -- Cronograma sozinho NÃO prova execução (§16). Por isso a dimensão olha
  -- evidência, e não a data planejada.
  d_execution := CASE
    WHEN evidence_count > 0 THEN 'READY'
    ELSE 'INCOMPLETE' END;
  IF d_execution = 'INCOMPLETE' THEN reasons := reasons || 'EXECUTION_NOT_OBSERVED'::text; END IF;

  -- ============ dimensão: EVIDÊNCIA EXIGIDA ============
  d_evidence := public.project_measurement_dimension_state(m.id, ARRAY['EVIDENCE']);
  IF d_evidence = 'INCOMPLETE' THEN reasons := reasons || 'MISSING_REQUIRED_EVIDENCE'::text; END IF;

  -- ============ dimensão: RELATÓRIO TÉCNICO/SERVIÇO ============
  -- O Apex NÃO escreve o relatório (§104). Ele cobra a existência dele.
  d_report := public.project_measurement_dimension_state(m.id,
                ARRAY['TECHNICAL_REPORT','SERVICE_REPORT']);
  IF d_report = 'INCOMPLETE' THEN reasons := reasons || 'MISSING_REQUIRED_REPORT'::text; END IF;

  -- ============ dimensão: DOCUMENTOS CONTRATUAIS ============
  d_docs := public.project_measurement_dimension_state(m.id,
              ARRAY['DOCUMENT','TESTS_INSPECTION','PHOTOS']);
  IF d_docs = 'INCOMPLETE' THEN
    IF missing_req IS NOT NULL AND 'PHOTOS' = ANY(missing_req) THEN reasons := reasons || 'MISSING_PHOTOS'::text; END IF;
    IF missing_req IS NOT NULL AND ('DOCUMENT' = ANY(missing_req) OR 'TESTS_INSPECTION' = ANY(missing_req))
      THEN reasons := reasons || 'MISSING_REQUIRED_DOCUMENT'::text; END IF;
  END IF;

  -- ============ dimensão: COMPLETUDE DA MEDIÇÃO ============
  /*
    Semântica desconhecida é medição desconhecida. Se a regra não diz se é
    incremental ou cumulativa, um número aqui não é interpretável — e a §14
    manda parar em vez de escolher. O número existe; o SIGNIFICADO dele, não.
  */
  d_complete := CASE
    WHEN m.measurement_basis = 'UNKNOWN' OR m.accumulation_mode = 'UNKNOWN' THEN 'UNKNOWN'
    WHEN m.measurement_basis = 'MILESTONE_FIXED' THEN 'READY'
    WHEN m.measurement_basis = 'MONETARY' AND m.measured_value IS NOT NULL AND m.currency IS NOT NULL THEN 'READY'
    WHEN m.measurement_basis IN ('QUANTITY','PERCENTAGE') AND m.quantity IS NOT NULL THEN 'READY'
    ELSE 'INCOMPLETE' END;
  IF d_complete = 'UNKNOWN' THEN reasons := reasons || 'MEASUREMENT_SEMANTICS_UNKNOWN'::text; END IF;
  IF d_complete = 'INCOMPLETE' THEN reasons := reasons || 'MEASUREMENT_VALUE_MISSING'::text; END IF;

  -- ============ dimensão: SUBMISSÃO ============
  -- Derivada das anteriores mais os bloqueios estruturais. Repare que ela
  -- nunca é READY com regra, ocorrência ou mapeamento pendentes: é aí que a
  -- frase "informação ausente nunca vira READY" vira código.
  IF NOT rule_ok OR m.occurrence_state = 'unresolved' OR NOT has_mapping THEN
    d_submission := 'UNKNOWN';
  ELSIF m.status IN ('SUBMITTED','UNDER_REVIEW','ACCEPTED','REJECTED') THEN
    d_submission := 'READY';
  ELSIF m.status IN ('CANCELLED','SUPERSEDED') THEN
    d_submission := 'NOT_APPLICABLE';
  ELSE
    states := ARRAY[d_execution, d_evidence, d_report, d_docs, d_complete];
    d_submission := 'READY';
    FOREACH s IN ARRAY states LOOP
      IF s = 'UNKNOWN' THEN d_submission := 'UNKNOWN';
      ELSIF s = 'INCOMPLETE' AND d_submission <> 'UNKNOWN' THEN d_submission := 'INCOMPLETE';
      END IF;
    END LOOP;
  END IF;

  -- ============ dimensão: ACEITE ============
  -- ACEITE É NUNCA AUTOMATIZADO (§11). Enquanto não houver decisão
  -- autoritativa, o estado é "esperando", nunca "aceito".
  d_acceptance := CASE m.status
    WHEN 'ACCEPTED'  THEN 'READY'
    WHEN 'REJECTED'  THEN 'BLOCKED'
    WHEN 'CANCELLED' THEN 'NOT_APPLICABLE'
    WHEN 'SUPERSEDED' THEN 'NOT_APPLICABLE'
    WHEN 'SUBMITTED'  THEN 'INCOMPLETE'
    WHEN 'UNDER_REVIEW' THEN 'INCOMPLETE'
    WHEN 'RETURNED_FOR_CORRECTION' THEN 'INCOMPLETE'
    ELSE 'INCOMPLETE' END;
  IF m.status IN ('SUBMITTED','UNDER_REVIEW') THEN reasons := reasons || 'WAITING_CUSTOMER_ACCEPTANCE'::text; END IF;
  IF m.status = 'RETURNED_FOR_CORRECTION' THEN reasons := reasons || 'RETURNED_FOR_CORRECTION'::text; END IF;
  IF m.status = 'REJECTED' THEN reasons := reasons || 'MEASUREMENT_REJECTED'::text; END IF;

  -- ============ dimensão: PRÉ-REQUISITO DE FATURAMENTO (PROJEÇÃO) ============
  -- §31: isto NÃO é direito de faturar. É "o que Medição sabe que faltaria".
  IF blocking_obl > 0 THEN
    d_billing := 'BLOCKED';
    reasons := reasons || 'OBLIGATION_BLOCKING'::text;
  ELSIF m.status = 'ACCEPTED' THEN
    d_billing := 'READY';
  ELSIF m.status IN ('CANCELLED','SUPERSEDED','REJECTED') THEN
    d_billing := 'NOT_APPLICABLE';
  ELSE
    d_billing := 'INCOMPLETE';
  END IF;

  IF unknown_req IS NOT NULL THEN reasons := reasons || 'REQUIREMENT_CERTAINTY_UNKNOWN'::text; END IF;

  dims := jsonb_build_object(
    'execution',               d_execution,
    'required_evidence',       d_evidence,
    'technical_report',        d_report,
    'contractual_documents',   d_docs,
    'measurement_completeness',d_complete,
    'submission',              d_submission,
    'acceptance',              d_acceptance,
    'billing_prerequisite',    d_billing);

  -- ---------- derivação do estado geral ----------
  /*
    Precedência: BLOCKED > UNKNOWN > INCOMPLETE > READY, e NOT_APPLICABLE só
    vence quando TODAS as dimensões o são.

    UNKNOWN acima de INCOMPLETE não é detalhe: "falta o laudo" é trabalho
    conhecido; "não sei qual regra rege isto" é trabalho que ninguém sabe que
    tem. Enterrar o segundo sob o primeiro é como uma medição chega ao aceite
    sem que ninguém tenha notado o buraco.
  */
  SELECT CASE
           WHEN bool_or(v = 'BLOCKED')    THEN 'BLOCKED'
           WHEN bool_or(v = 'UNKNOWN')    THEN 'UNKNOWN'
           WHEN bool_or(v = 'INCOMPLETE') THEN 'INCOMPLETE'
           WHEN bool_or(v = 'READY')      THEN 'READY'
           ELSE 'NOT_APPLICABLE' END
    INTO overall
    FROM jsonb_each_text(dims) AS t(k, v);

  RETURN jsonb_build_object(
    'measurement_id', m.id,
    'organization_id', m.organization_id,
    'status', m.status,
    'as_of', as_of,
    'overall', overall,
    'dimensions', dims,
    'reasons', to_jsonb(reasons),
    'missing_requirements', to_jsonb(COALESCE(missing_req, ARRAY[]::text[])),
    'unknown_requirements', to_jsonb(COALESCE(unknown_req, ARRAY[]::text[])),
    'evidence_count', evidence_count,
    'validated_evidence_count', validated_count,
    'blocking_obligations', blocking_obl,
    'rule_resolved', rule_ok,
    'timeline_mapped', has_mapping,
    'occurrence_state', m.occurrence_state);
END $$;

REVOKE ALL ON FUNCTION public.project_measurement_readiness(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_measurement_readiness(uuid, date) TO authenticated;

COMMENT ON FUNCTION public.project_measurement_readiness(uuid, date) IS
  'Resolvedor CANÔNICO de prontidão (§27). Dimensões + razões acionáveis; o '
  'geral é derivado com BLOCKED > UNKNOWN > INCOMPLETE > READY. Informação '
  'ausente nunca vira READY.';

COMMIT;
