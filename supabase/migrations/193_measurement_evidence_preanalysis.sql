-- ============================================================================
-- 193 — PRÉ-ANÁLISE DO APEX SOBRE A EVIDÊNCIA
--
-- ─── A pergunta que esta migration responde ───────────────────────────────
--
--   "Este documento atende às exigências contratuais DESTE marco?"
--
-- E a resposta é um PARECER, nunca uma decisão. A distinção está escrita no
-- esquema: nada aqui escreve em `project_measurement_requirements`, em
-- `project_measurement_evidence.validation_state`, em `project_measurements`
-- nem em qualquer tabela de faturamento. A pré-análise SÓ acrescenta linhas às
-- duas tabelas abaixo.
--
-- ─── Os cinco desfechos, e por que são cinco ──────────────────────────────
--
--   MET                   o documento diz o que a exigência pede
--   NOT_MET               o documento diz o contrário, ou diz menos
--   NOT_FOUND             a informação não foi localizada no documento
--   INCONSISTENT          o documento se contradiz, ou contradiz o contrato
--   NEEDS_HUMAN_REVIEW    verificável só por gente
--
-- Um sistema com três desfechos (sim/não/talvez) colapsa `NOT_FOUND` em
-- `NOT_MET` — e aí "o laudo não menciona a data do ensaio" vira "o ensaio não
-- foi feito". São coisas diferentes, e a segunda é uma acusação.
--
-- ─── O que o Apex NÃO pode, e o esquema garante ───────────────────────────
--
--   · Não valida evidência. `validation_state` continua sendo escrito só pela
--     RPC da 131, por uma pessoa.
--   · Não satisfaz exigência. `satisfaction_state` continua vindo da
--     reconciliação da 132, que olha o VÍNCULO, não o parecer.
--   · Não conclui medição, não aceita, não torna elegível e não fatura.
--   · Não sobrescreve parecer anterior: cada execução é uma VERSÃO nova, e a
--     anterior continua legível. Um parecer que muda sozinho não é auditável.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) A execução da pré-análise
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_measurement_evidence_analyses (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  measurement_id      uuid NOT NULL,
  evidence_id         uuid NOT NULL,
  -- O documento canônico. Guardado aqui para que a leitura não dependa de
  -- reabrir o vínculo — e é o MESMO id de `project_files`, nunca uma cópia.
  document_id         uuid,

  analysis_version    integer NOT NULL DEFAULT 1 CHECK (analysis_version > 0),
  state               text NOT NULL DEFAULT 'PENDING'
                        CHECK (state IN ('PENDING','COMPLETED','FAILED')),
  requested_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at        timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  failure_reason      text,

  -- ---- o veredito agregado, e o denominador junto ----
  /*
    "4/5 requisitos verificáveis atendidos" só é honesto se o 5 for os
    VERIFICÁVEIS, e não o total. Exigência que depende de ato humano — aceite
    da Contratante, por exemplo — não entra no denominador, porque nenhum PDF
    pode satisfazê-la.
  */
  verifiable_count    integer NOT NULL DEFAULT 0 CHECK (verifiable_count >= 0),
  met_count           integer NOT NULL DEFAULT 0 CHECK (met_count >= 0),
  not_met_count       integer NOT NULL DEFAULT 0 CHECK (not_met_count >= 0),
  not_found_count     integer NOT NULL DEFAULT 0 CHECK (not_found_count >= 0),
  inconsistent_count  integer NOT NULL DEFAULT 0 CHECK (inconsistent_count >= 0),
  human_review_count  integer NOT NULL DEFAULT 0 CHECK (human_review_count >= 0),
  summary             text,

  -- ---- proveniência do modelo (§14, e a convenção da 152) ----
  ai_provider         text,
  ai_model            text,
  ai_task             text,
  ai_input_tokens     bigint,
  ai_output_tokens    bigint,
  ai_duration_ms      integer,
  ai_attempts         integer,

  CONSTRAINT pmea_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pmea_version_unique UNIQUE (organization_id, evidence_id, analysis_version),
  CONSTRAINT pmea_measurement_tenant FOREIGN KEY (organization_id, measurement_id)
    REFERENCES public.project_measurements (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT pmea_evidence_tenant FOREIGN KEY (organization_id, evidence_id)
    REFERENCES public.project_measurement_evidence (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT pmea_completed_stamp CHECK ((state = 'COMPLETED') = (completed_at IS NOT NULL)),
  -- Falha DIZ por que falhou. Falha muda é indistinguível de "ninguém rodou".
  CONSTRAINT pmea_failure_reason CHECK (
    (state <> 'FAILED') OR NULLIF(btrim(COALESCE(failure_reason,'')), '') IS NOT NULL),
  -- O agregado tem de fechar com ele mesmo. Sem isto, "4/5" poderia sair de
  -- uma soma que nunca somou cinco.
  CONSTRAINT pmea_counts_coherent CHECK (
    state <> 'COMPLETED'
    OR met_count + not_met_count + not_found_count + inconsistent_count + human_review_count
       >= verifiable_count),
  CONSTRAINT pmea_met_within CHECK (met_count <= verifiable_count)
);

CREATE INDEX IF NOT EXISTS pmea_measurement
  ON public.project_measurement_evidence_analyses (organization_id, measurement_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS pmea_evidence
  ON public.project_measurement_evidence_analyses (organization_id, evidence_id, analysis_version DESC);

ALTER TABLE public.project_measurement_evidence_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY pmea_select ON public.project_measurement_evidence_analyses FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.current_user_has_permission('projects.measurements.view')
              OR public.current_user_has_permission('contracts.view')
              OR public.current_user_is_admin()));
GRANT SELECT ON public.project_measurement_evidence_analyses TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.project_measurement_evidence_analyses FROM authenticated, anon;
REVOKE ALL ON public.project_measurement_evidence_analyses FROM anon;

COMMENT ON TABLE public.project_measurement_evidence_analyses IS
  'PARECER do Apex sobre uma evidência, versionado. Não valida, não satisfaz '
  'exigência, não aceita e não fatura. Cada execução é uma versão nova.';

-- ---------------------------------------------------------------------------
-- 2) Os achados, um por exigência
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_measurement_evidence_findings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  analysis_id       uuid NOT NULL,
  measurement_id    uuid NOT NULL,

  requirement_kind  text NOT NULL CHECK (requirement_kind IN
                      ('TECHNICAL_REPORT','SERVICE_REPORT','DOCUMENT','PHOTOS',
                       'TESTS_INSPECTION','EVIDENCE','CUSTOMER_ACCEPTANCE')),
  -- A linha de exigência RESOLVIDA a que o achado se refere, quando existe.
  requirement_id    uuid,

  verdict           text NOT NULL CHECK (verdict IN
                      ('MET','NOT_MET','NOT_FOUND','INCONSISTENT','NEEDS_HUMAN_REVIEW')),
  -- O que o Apex viu, e ONDE viu. Parecer sem trecho é opinião; com trecho e
  -- página, é algo que uma pessoa confere em dez segundos.
  rationale         text,
  quote             text,
  page              integer CHECK (page IS NULL OR page > 0),
  confidence        numeric(4,3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),

  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pmef_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pmef_analysis_tenant FOREIGN KEY (organization_id, analysis_id)
    REFERENCES public.project_measurement_evidence_analyses (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT pmef_measurement_tenant FOREIGN KEY (organization_id, measurement_id)
    REFERENCES public.project_measurements (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT pmef_requirement_tenant FOREIGN KEY (organization_id, requirement_id)
    REFERENCES public.project_measurement_requirements (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT pmef_kind_unique UNIQUE (organization_id, analysis_id, requirement_kind),
  /*
    MET exige lastro. Um "atendido" sem trecho nem justificativa é exatamente
    a aprovação de inferência incerta que a §14 do pedido proíbe — e é a única
    forma de o parecer se tornar perigoso.
  */
  CONSTRAINT pmef_met_needs_basis CHECK (
    verdict <> 'MET'
    OR NULLIF(btrim(COALESCE(quote,'')), '') IS NOT NULL
    OR NULLIF(btrim(COALESCE(rationale,'')), '') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS pmef_analysis
  ON public.project_measurement_evidence_findings (organization_id, analysis_id);
CREATE INDEX IF NOT EXISTS pmef_measurement
  ON public.project_measurement_evidence_findings (organization_id, measurement_id, requirement_kind);

ALTER TABLE public.project_measurement_evidence_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY pmef_select ON public.project_measurement_evidence_findings FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.current_user_has_permission('projects.measurements.view')
              OR public.current_user_has_permission('contracts.view')
              OR public.current_user_is_admin()));
GRANT SELECT ON public.project_measurement_evidence_findings TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.project_measurement_evidence_findings FROM authenticated, anon;
REVOKE ALL ON public.project_measurement_evidence_findings FROM anon;

COMMENT ON TABLE public.project_measurement_evidence_findings IS
  'Um achado por exigência contratual. `NOT_FOUND` e `NOT_MET` são desfechos '
  'DIFERENTES: o primeiro é ausência de informação, o segundo é negativa.';

-- ---------------------------------------------------------------------------
-- 3) Abrir a execução — server-only
-- ---------------------------------------------------------------------------
/*
  As duas funções abaixo são REVOKEd de `authenticated` de propósito. Quem as
  chama é a rota de servidor, que já autorizou o pedido e já falou com o
  provedor. Expor a gravação ao navegador permitiria a qualquer pessoa do
  inquilino inscrever um parecer "4/5 atendidos" que nenhum modelo produziu.
*/
CREATE OR REPLACE FUNCTION public.project_measurement_preanalysis_open(
  p_evidence_id uuid,
  p_requested_by uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e public.project_measurement_evidence%ROWTYPE;
  nxt integer;
  new_id uuid;
BEGIN
  SELECT * INTO e FROM public.project_measurement_evidence WHERE id = p_evidence_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EVIDENCE_NOT_FOUND: vínculo de evidência inexistente.' USING ERRCODE = 'no_data_found';
  END IF;
  IF e.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'EVIDENCE_REVOKED: evidência revogada não é pré-analisada.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(max(analysis_version), 0) + 1 INTO nxt
    FROM public.project_measurement_evidence_analyses WHERE evidence_id = e.id;

  INSERT INTO public.project_measurement_evidence_analyses
    (organization_id, measurement_id, evidence_id, document_id, analysis_version,
     state, requested_by, ai_task)
  VALUES (e.organization_id, e.measurement_id, e.id,
          CASE WHEN e.source_type = 'project_file' THEN e.source_id ELSE NULL END,
          nxt, 'PENDING', p_requested_by, 'MEASUREMENT_EVIDENCE_PREANALYSIS')
  RETURNING id INTO new_id;

  RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION public.project_measurement_preanalysis_open(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) Fechar a execução com o parecer — server-only, tudo numa transação
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.project_measurement_preanalysis_complete(
  p_analysis_id uuid,
  p_findings    jsonb,
  p_summary     text DEFAULT NULL,
  p_provider    text DEFAULT NULL,
  p_model       text DEFAULT NULL,
  p_input_tokens  bigint DEFAULT NULL,
  p_output_tokens bigint DEFAULT NULL,
  p_duration_ms   integer DEFAULT NULL,
  p_attempts      integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a public.project_measurement_evidence_analyses%ROWTYPE;
  f jsonb;
  kind text;
  verdict text;
  req_id uuid;
  n_met int := 0; n_not_met int := 0; n_not_found int := 0;
  n_inc int := 0; n_human int := 0; n_verifiable int := 0;
BEGIN
  SELECT * INTO a FROM public.project_measurement_evidence_analyses
   WHERE id = p_analysis_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ANALYSIS_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF a.state <> 'PENDING' THEN
    -- Idempotência: reentregar o mesmo parecer devolve o que já existe, em vez
    -- de criar um segundo veredito sobre o mesmo documento.
    RETURN jsonb_build_object('analysis_id', a.id, 'state', a.state, 'idempotent', true);
  END IF;
  IF jsonb_typeof(COALESCE(p_findings,'[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'FINDINGS_INVALID: parecer precisa ser uma lista de achados.'
      USING ERRCODE = 'check_violation';
  END IF;

  FOR f IN SELECT * FROM jsonb_array_elements(p_findings) LOOP
    kind := f->>'requirement_kind';
    verdict := f->>'verdict';
    IF kind IS NULL OR verdict IS NULL THEN CONTINUE; END IF;

    SELECT id INTO req_id FROM public.project_measurement_requirements
     WHERE measurement_id = a.measurement_id AND requirement_kind = kind;

    INSERT INTO public.project_measurement_evidence_findings
      (organization_id, analysis_id, measurement_id, requirement_kind, requirement_id,
       verdict, rationale, quote, page, confidence)
    VALUES (a.organization_id, a.id, a.measurement_id, kind, req_id, verdict,
            NULLIF(btrim(COALESCE(f->>'rationale','')), ''),
            NULLIF(btrim(COALESCE(f->>'quote','')), ''),
            NULLIF(f->>'page','')::integer,
            NULLIF(f->>'confidence','')::numeric)
    ON CONFLICT (organization_id, analysis_id, requirement_kind) DO NOTHING;

    /*
      O denominador. `CUSTOMER_ACCEPTANCE` fica de fora porque nenhum documento
      de execução a satisfaz — quem a satisfaz é a Contratante, e contá-la aqui
      faria todo parecer nascer com um "não atendido" que não é trabalho de
      ninguém do lado de cá.
    */
    IF kind <> 'CUSTOMER_ACCEPTANCE' AND verdict <> 'NEEDS_HUMAN_REVIEW' THEN
      n_verifiable := n_verifiable + 1;
    END IF;

    CASE verdict
      WHEN 'MET'                THEN n_met := n_met + 1;
      WHEN 'NOT_MET'            THEN n_not_met := n_not_met + 1;
      WHEN 'NOT_FOUND'          THEN n_not_found := n_not_found + 1;
      WHEN 'INCONSISTENT'       THEN n_inc := n_inc + 1;
      WHEN 'NEEDS_HUMAN_REVIEW' THEN n_human := n_human + 1;
      ELSE NULL;
    END CASE;
  END LOOP;

  UPDATE public.project_measurement_evidence_analyses
     SET state = 'COMPLETED', completed_at = now(),
         verifiable_count = n_verifiable,
         met_count = LEAST(n_met, n_verifiable),
         not_met_count = n_not_met, not_found_count = n_not_found,
         inconsistent_count = n_inc, human_review_count = n_human,
         summary = p_summary,
         ai_provider = p_provider, ai_model = p_model,
         ai_input_tokens = p_input_tokens, ai_output_tokens = p_output_tokens,
         ai_duration_ms = p_duration_ms, ai_attempts = p_attempts
   WHERE id = a.id;

  RETURN jsonb_build_object(
    'analysis_id', a.id, 'state', 'COMPLETED', 'idempotent', false,
    'verifiable', n_verifiable, 'met', LEAST(n_met, n_verifiable),
    'not_met', n_not_met, 'not_found', n_not_found,
    'inconsistent', n_inc, 'needs_human_review', n_human);
END $$;
REVOKE ALL ON FUNCTION public.project_measurement_preanalysis_complete(
  uuid, jsonb, text, text, text, bigint, bigint, integer, integer)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.project_measurement_preanalysis_fail(
  p_analysis_id uuid,
  p_reason      text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.project_measurement_evidence_analyses
     SET state = 'FAILED',
         failure_reason = COALESCE(NULLIF(btrim(p_reason), ''), 'Falha não descrita pelo chamador.')
   WHERE id = p_analysis_id AND state = 'PENDING';
END $$;
REVOKE ALL ON FUNCTION public.project_measurement_preanalysis_fail(uuid, text)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) O parecer CONSOLIDADO da medição
-- ---------------------------------------------------------------------------
/*
  Uma medição tem várias evidências, e cada uma tem seu parecer. A tela precisa
  de UM número — "4/5 requisitos verificáveis atendidos" — e ele não é a soma:
  é a consolidação POR EXIGÊNCIA, com o melhor achado de qualquer documento.

  A precedência entre achados da mesma exigência:

    INCONSISTENT > NEEDS_HUMAN_REVIEW > MET > NOT_MET > NOT_FOUND

  Contradição vence tudo porque é a única que pede decisão AGORA. E `MET` vence
  `NOT_MET` porque duas evidências sobre a mesma exigência é o caso normal do
  reenvio: o documento novo atende, o antigo não atendia.
*/
CREATE OR REPLACE FUNCTION public.project_measurement_preanalysis(p_measurement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m public.project_measurements%ROWTYPE;
  res jsonb;
BEGIN
  SELECT * INTO m FROM public.project_measurements WHERE id = p_measurement_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('measurement_id', p_measurement_id, 'analyzed', false,
                              'reason', 'MEASUREMENT_NOT_FOUND');
  END IF;
  IF auth.uid() IS NOT NULL
     AND m.organization_id IS DISTINCT FROM public.current_user_organization_id() THEN
    RETURN jsonb_build_object('measurement_id', p_measurement_id, 'analyzed', false,
                              'reason', 'MEASUREMENT_NOT_FOUND');
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (a.evidence_id) a.*
      FROM public.project_measurement_evidence_analyses a
      JOIN public.project_measurement_evidence e
        ON e.id = a.evidence_id AND e.revoked_at IS NULL
     WHERE a.measurement_id = m.id AND a.state = 'COMPLETED'
     ORDER BY a.evidence_id, a.analysis_version DESC
  ),
  ranked AS (
    SELECT f.requirement_kind, f.verdict, f.rationale, f.quote, f.page, f.confidence,
           row_number() OVER (
             PARTITION BY f.requirement_kind
             ORDER BY array_position(
               ARRAY['INCONSISTENT','NEEDS_HUMAN_REVIEW','MET','NOT_MET','NOT_FOUND'],
               f.verdict)) AS rk
      FROM public.project_measurement_evidence_findings f
      JOIN latest l ON l.id = f.analysis_id
  ),
  best AS (SELECT * FROM ranked WHERE rk = 1)
  SELECT jsonb_build_object(
    'measurement_id', m.id,
    'analyzed', EXISTS (SELECT 1 FROM latest),
    'analyses', (SELECT count(*)::int FROM latest),
    'last_analyzed_at', (SELECT max(completed_at) FROM latest),
    'verifiable', (SELECT count(*)::int FROM best
                    WHERE requirement_kind <> 'CUSTOMER_ACCEPTANCE'
                      AND verdict <> 'NEEDS_HUMAN_REVIEW'),
    'met', (SELECT count(*)::int FROM best
             WHERE verdict = 'MET' AND requirement_kind <> 'CUSTOMER_ACCEPTANCE'),
    'not_met', (SELECT count(*)::int FROM best WHERE verdict = 'NOT_MET'),
    'not_found', (SELECT count(*)::int FROM best WHERE verdict = 'NOT_FOUND'),
    'inconsistent', (SELECT count(*)::int FROM best WHERE verdict = 'INCONSISTENT'),
    'needs_human_review', (SELECT count(*)::int FROM best WHERE verdict = 'NEEDS_HUMAN_REVIEW'),
    'findings', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'requirement_kind', requirement_kind, 'verdict', verdict,
        'rationale', rationale, 'quote', quote, 'page', page, 'confidence', confidence)
        ORDER BY requirement_kind) FROM best), '[]'::jsonb)
  ) INTO res;

  RETURN res;
END $$;
REVOKE ALL ON FUNCTION public.project_measurement_preanalysis(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_measurement_preanalysis(uuid) TO authenticated;

COMMENT ON FUNCTION public.project_measurement_preanalysis(uuid) IS
  'Parecer CONSOLIDADO por exigência. Não é prontidão e não é aceite: a '
  'prontidão continua em project_measurement_readiness(), que não lê daqui.';

COMMIT;
