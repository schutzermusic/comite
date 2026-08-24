-- ============================================================================
-- 093 — Proveniência de proposta de IA em cláusulas (P2D)
--
-- P2B instrumentou `contract_clauses` para REGISTRO MANUAL: origem documental
-- (`source_document_id`, `source_page`, `source_excerpt`), efeito contratual e
-- estado de revisão humana. Faltam três coisas para que uma PROPOSTA de IA
-- possa conviver ali sem se passar por verdade contratual:
--
--   1. confiança e identidade do modelo que propôs;
--   2. o texto ORIGINAL proposto, preservado quando um humano edita — sem ele
--      não há como comparar o que a máquina leu com o que a pessoa validou;
--   3. cadeia de substituição, para que uma proposta superada continue
--      auditável em vez de desaparecer.
--
-- Estritamente aditiva. `ai_flagged` (006) e `review_status` (092) seguem sendo
-- os campos que separam proposta de verdade; estes só acrescentam evidência.
-- ============================================================================

ALTER TABLE public.contract_clauses
  -- Confiança declarada pelo modelo, 0..1. NULL em registro manual: uma pessoa
  -- que transcreve não emite confiança, afirma.
  ADD COLUMN IF NOT EXISTS ai_confidence numeric,
  ADD COLUMN IF NOT EXISTS ai_model text,
  ADD COLUMN IF NOT EXISTS ai_analysis_id uuid REFERENCES public.contract_ai_analyses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ai_proposed_at timestamptz,
  -- O que a IA propôs, congelado. O par `title`/`content` continua sendo o
  -- estruturado vigente e pode ser editado por gente; estes dois preservam o
  -- original para a comparação lado a lado.
  ADD COLUMN IF NOT EXISTS ai_proposed_title text,
  ADD COLUMN IF NOT EXISTS ai_proposed_content text,
  ADD COLUMN IF NOT EXISTS superseded_by_clause_id uuid REFERENCES public.contract_clauses(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contract_clauses_ai_confidence_check'
  ) THEN
    ALTER TABLE public.contract_clauses
      ADD CONSTRAINT contract_clauses_ai_confidence_check
      CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1));
  END IF;
END $$;

-- `superseded` entra no vocabulário de revisão: uma proposta substituída não é
-- rejeitada (o conteúdo podia estar certo) nem validada.
DO $$
BEGIN
  ALTER TABLE public.contract_clauses DROP CONSTRAINT IF EXISTS contract_clauses_review_status_check;
  ALTER TABLE public.contract_clauses
    ADD CONSTRAINT contract_clauses_review_status_check
    CHECK (review_status IN ('draft', 'in_review', 'validated', 'rejected', 'superseded'));
END $$;

-- Uma proposta de IA SEMPRE tem de carregar evidência documental. Sem página e
-- sem trecho não há como conferir, e uma cláusula que não se confere é
-- exatamente a alucinação que este domínio não pode registrar.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contract_clauses_ai_needs_evidence_check'
  ) THEN
    ALTER TABLE public.contract_clauses
      ADD CONSTRAINT contract_clauses_ai_needs_evidence_check
      CHECK (
        ai_flagged = false
        OR (source_document_id IS NOT NULL
            AND source_page IS NOT NULL
            AND source_excerpt IS NOT NULL
            AND length(btrim(source_excerpt)) > 0)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contract_clauses_ai_analysis
  ON public.contract_clauses(ai_analysis_id) WHERE ai_analysis_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contract_clauses_review
  ON public.contract_clauses(contract_id, review_status);
