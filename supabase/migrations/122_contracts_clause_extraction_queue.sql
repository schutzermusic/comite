-- ============================================================
-- CONTRATOS — extração de cláusulas com execução DURÁVEL
-- Migration: 122_contracts_clause_extraction_queue
--
-- ─── O que muda, e o que não muda ──────────────────────────────────────────
--
-- MUDA a confiabilidade da EXECUÇÃO: hoje a leitura do PDF acontece dentro do
-- pedido HTTP. Uma função serverless reciclada no meio deixa a análise presa em
-- `running` e o trabalho perdido — não há quem retome. A partir daqui o pedido
-- vira uma linha durável e um trabalho na fila; se o processo cair, outro
-- trabalhador pega de onde parou.
--
-- NÃO MUDA o significado jurídico de coisa alguma:
--   · a exigência de documento como origem continua valendo;
--   · página e trecho continuam obrigatórios em toda proposta;
--   · a impressão digital (documento, página, trecho) continua evitando fila
--     de revisão duplicada;
--   · a proposta continua nascendo `ai_flagged` + `draft`;
--   · nenhuma cláusula, e nenhuma OBRIGAÇÃO, vira verdade contratual por ter
--     sido inferida por modelo.
--
-- Enfileirar muda quando o trabalho roda. Não muda o que ele pode afirmar.
-- ============================================================
BEGIN;

-- Alvo composto em `contract_ai_analyses`, para que o pedido não possa apontar
-- para a análise de outro inquilino. A tabela é anterior à disciplina de
-- referência composta da Fase 2; a restrição corrige isso sem tocar em dado.
ALTER TABLE public.contract_ai_analyses
  ADD CONSTRAINT caa_org_id_unique UNIQUE (organization_id, id);

CREATE TABLE public.contract_clause_extraction_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id       uuid NOT NULL,
  document_id       uuid NOT NULL,

  status            text NOT NULL DEFAULT 'QUEUED'
                      CHECK (status IN ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')),

  requested_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at      timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz,
  completed_at      timestamptz,

  -- O resultado continua morando no modelo que já existe. Este campo é o
  -- ponteiro para ele, não uma segunda cópia.
  analysis_id       uuid,
  job_id            uuid,

  -- Mensagem SEGURA. Conteúdo de documento protegido e segredo de provedor
  -- nunca chegam aqui: o texto é montado pelo classificador de erro, não pela
  -- exceção crua.
  error_code        text,
  error_safe        text,

  proposed_count    integer,
  rejected_count    integer,

  CONSTRAINT ccer_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT ccer_document_tenant FOREIGN KEY (organization_id, contract_id, document_id)
    REFERENCES public.contract_documents (organization_id, contract_id, id) ON DELETE CASCADE,
  CONSTRAINT ccer_contract_tenant FOREIGN KEY (organization_id, contract_id)
    REFERENCES public.contracts (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT ccer_analysis_tenant FOREIGN KEY (organization_id, analysis_id)
    REFERENCES public.contract_ai_analyses (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT ccer_job_tenant FOREIGN KEY (organization_id, job_id)
    REFERENCES public.apex_jobs (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT ccer_terminal_coherent CHECK (
    (status IN ('COMPLETED','FAILED','CANCELLED')) = (completed_at IS NOT NULL))
);

-- ─── A regra que impede pedido repetido de virar trabalho repetido ─────────
--
-- No máximo UM pedido ABERTO por (inquilino, contrato, documento). Clicar
-- "analisar" cinco vezes devolve o MESMO pedido cinco vezes; o provedor é
-- chamado uma. Quando o pedido fecha, um novo pode ser aberto — reanalisar um
-- documento depois de uma revisão é legítimo, e um índice único total o
-- proibiria para sempre.
CREATE UNIQUE INDEX ccer_one_open
  ON public.contract_clause_extraction_requests (organization_id, contract_id, document_id)
  WHERE status IN ('QUEUED','RUNNING');
CREATE INDEX ccer_contract ON public.contract_clause_extraction_requests
  (organization_id, contract_id, requested_at DESC);

COMMENT ON TABLE public.contract_clause_extraction_requests IS
  'Pedido DURÁVEL de extração de cláusulas. O resultado continua em '
  'contract_ai_analyses + contract_clauses; esta tabela guarda o ciclo de vida '
  'da execução. Enfileirar mudou a confiabilidade, não o significado jurídico: '
  'a proposta continua nascendo rascunho e nenhuma obrigação nasce de inferência.';

-- ------------------------------------------------------------
-- Abrir o pedido e o trabalho na MESMA transação
-- ------------------------------------------------------------
-- Criar o pedido e depois enfileirar em outra ida ao banco deixaria, entre as
-- duas, um pedido eternamente QUEUED sem trabalho que o execute — a fila
-- diria "em andamento" e nada estaria andando.
CREATE FUNCTION public.contract_clause_extraction_request(
  p_organization_id uuid,
  p_contract_id     uuid,
  p_document_id     uuid,
  p_requested_by    uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE doc record; req_id uuid; job uuid; existing record;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Pedido de extração negado.' USING ERRCODE = '42501';
  END IF;

  -- ---- portão de evidência, antes de qualquer trabalho ----
  -- Documento inexistente, de outro contrato ou que não é PDF é falha
  -- DETERMINÍSTICA: enfileirá-la só produziria cinco tentativas do mesmo erro.
  SELECT id, file_path INTO doc FROM public.contract_documents
   WHERE id = p_document_id AND contract_id = p_contract_id AND organization_id = p_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Documento não encontrado para este contrato.' USING ERRCODE = 'no_data_found';
  END IF;
  IF lower(doc.file_path) NOT LIKE '%.pdf' THEN
    RAISE EXCEPTION 'A extração de cláusulas só lê PDF. Este documento tem outro formato.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT id, status, job_id INTO existing
    FROM public.contract_clause_extraction_requests
   WHERE organization_id = p_organization_id AND contract_id = p_contract_id
     AND document_id = p_document_id AND status IN ('QUEUED','RUNNING');
  IF FOUND THEN
    RETURN jsonb_build_object('request_id', existing.id, 'status', existing.status,
                              'job_id', existing.job_id, 'reused', true);
  END IF;

  INSERT INTO public.contract_clause_extraction_requests
    (organization_id, contract_id, document_id, requested_by)
  VALUES (p_organization_id, p_contract_id, p_document_id, p_requested_by)
  RETURNING id INTO req_id;

  SELECT public.apex_jobs_enqueue(
    p_organization_id,
    'contracts.clause_extraction.execute',
    'clause-extraction:' || req_id::text,
    jsonb_build_object('request_id', req_id, 'contract_id', p_contract_id,
                       'document_id', p_document_id),
    1, now(), 3, NULL, NULL) INTO job;

  UPDATE public.contract_clause_extraction_requests SET job_id = job WHERE id = req_id;

  RETURN jsonb_build_object('request_id', req_id, 'status', 'QUEUED',
                            'job_id', job, 'reused', false);
END $$;
REVOKE ALL ON FUNCTION public.contract_clause_extraction_request(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

ALTER TABLE public.contract_clause_extraction_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY contract_clause_extraction_requests_read
  ON public.contract_clause_extraction_requests FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id());
GRANT SELECT ON public.contract_clause_extraction_requests TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.contract_clause_extraction_requests
  FROM authenticated, anon;

COMMIT;
