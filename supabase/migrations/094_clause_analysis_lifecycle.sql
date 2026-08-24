-- ============================================================================
-- 094 — Ciclo de vida da análise e linhagem documento → análise → cláusula (P2E)
--
-- P2D fez a extração funcionar. Faltam as três coisas que a tornam OPERÁVEL:
--
--   1. ciclo de vida explícito da análise (hoje `status` é texto livre e as
--      quatro linhas existentes são placeholders 'pending' de P0);
--   2. vínculo CONSULTÁVEL entre documento e análise — hoje o `document_id`
--      mora dentro de `extracted_data` jsonb, o que impede join, índice e
--      qualquer pergunta do tipo "quais documentos nunca foram analisados";
--   3. linhagem de versão de documento, para que proposta de um documento
--      substituído não siga valendo como se fosse do vigente.
--
-- Estritamente aditiva. Nenhuma política de RLS é alterada.
-- ============================================================================

-- ── 1) ANÁLISE: ciclo de vida ──────────────────────────────────────────────

ALTER TABLE public.contract_ai_analyses
  -- O documento analisado, como coluna de verdade e não como campo de jsonb.
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES public.contract_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  -- Motivo da falha, para que "falhou" seja acionável em vez de misterioso.
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS extractor_version text,
  -- Reanálise não apaga a anterior: aponta para a sucessora.
  ADD COLUMN IF NOT EXISTS superseded_by_analysis_id uuid REFERENCES public.contract_ai_analyses(id) ON DELETE SET NULL;

-- As linhas de P0 usam 'pending' e continuam válidas no vocabulário novo.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contract_ai_analyses_status_check'
  ) THEN
    ALTER TABLE public.contract_ai_analyses
      ADD CONSTRAINT contract_ai_analyses_status_check
      CHECK (status IN ('pending', 'running', 'completed', 'failed', 'superseded'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contract_ai_analyses_contract
  ON public.contract_ai_analyses(contract_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contract_ai_analyses_document
  ON public.contract_ai_analyses(document_id) WHERE document_id IS NOT NULL;

-- Backfill do `document_id` a partir do jsonb que P2D já gravava, para que a
-- linhagem das análises existentes não nasça quebrada.
UPDATE public.contract_ai_analyses a
   SET document_id = (a.extracted_data->>'document_id')::uuid,
       model = COALESCE(a.model, a.extracted_data->>'model'),
       extractor_version = COALESCE(a.extractor_version, a.extracted_data->>'version')
 WHERE a.document_id IS NULL
   AND a.extracted_data->>'document_id' IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.contract_documents d
                WHERE d.id = (a.extracted_data->>'document_id')::uuid);

-- ── 2) DOCUMENTO: linhagem de versão ───────────────────────────────────────

ALTER TABLE public.contract_documents
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  -- Documento que este substitui. A cadeia preserva o histórico: nada é
  -- apagado, o anterior deixa de ser o vigente.
  ADD COLUMN IF NOT EXISTS supersedes_document_id uuid REFERENCES public.contract_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_by_document_id uuid REFERENCES public.contract_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_contract_documents_supersedes
  ON public.contract_documents(supersedes_document_id) WHERE supersedes_document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contract_documents_current
  ON public.contract_documents(contract_id) WHERE superseded_by_document_id IS NULL;

-- ── 3) IDEMPOTÊNCIA DA REANÁLISE ───────────────────────────────────────────
--
-- Duas propostas de IA idênticas — mesmo contrato, mesmo documento, mesma
-- página, mesmo trecho — são a MESMA leitura. Reanalisar não pode empilhá-las.
--
-- Rejeitadas ficam fora do índice de propósito: se alguém rejeitou uma leitura
-- e uma análise posterior a propõe de novo, isso é informação (o modelo
-- insiste), não duplicata a esconder. O índice cobre o que ainda vale.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_clauses_ai_fingerprint
  ON public.contract_clauses (
    contract_id, source_document_id, source_page, md5(btrim(source_excerpt))
  )
  WHERE ai_flagged = true AND review_status <> 'rejected';
