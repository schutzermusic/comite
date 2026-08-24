-- ============================================================================
-- 092 — Instrumentação operacional de marcos, cláusulas e penalidades (P2B)
--
-- As três tabelas existem desde a migration 006, com RLS correta, e nunca
-- receberam uma linha: são lidas em três pontos do produto e escritas em
-- nenhum. Esta migration NÃO cria domínio paralelo — ela completa os campos
-- que faltavam para que o domínio existente possa ser operado de verdade.
--
-- Estritamente aditiva:
--   · nenhuma coluna removida ou renomeada;
--   · nenhuma política de RLS alterada (a de 006 já trava escrita em
--     `contracts.edit`, e a de penalidades já restringe leitura a
--     `contracts.view_penalties`);
--   · todo default preserva o comportamento de quem já lê estas tabelas.
--
-- As três tabelas estão vazias em produção, então o CHECK de status pode ser
-- aplicado direto — sem a etapa de normalização que um dado preexistente
-- exigiria.
-- ============================================================================

-- ── 1) MARCOS / MEDIÇÃO ────────────────────────────────────────────────────
--
-- O que faltava para operar: responsável, evidência e autoria.
-- `billing_amount`, `due_date`, `completed_at` e `status` já existiam, e
-- `contract_billing_events.milestone_id` já ligava marco a faturamento — a
-- ponte para o Contract-to-Cash não precisou ser inventada.

ALTER TABLE public.contract_milestones
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Evidência em texto, no mesmo formato de `contract_obligations.evidence`:
  -- descreve O QUE comprova a medição.
  ADD COLUMN IF NOT EXISTS evidence text,
  -- E o documento real, quando existe. Aponta para `contract_documents`, que
  -- continua sendo o dono do arquivo — Contratos referencia, não copia.
  ADD COLUMN IF NOT EXISTS evidence_document_id uuid REFERENCES public.contract_documents(id) ON DELETE SET NULL,
  -- Valor efetivamente medido, quando difere do previsto em `billing_amount`.
  -- Nulo enquanto ninguém mediu: zero seria "mediu e deu zero".
  ADD COLUMN IF NOT EXISTS measured_amount numeric,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Vocabulário explícito de status. Sem ele, `status` é texto livre e cada
-- caminho de escrita inventa o seu — o problema que a auditoria de status de
-- `contracts` já tinha encontrado noutra tabela.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contract_milestones_status_check'
  ) THEN
    ALTER TABLE public.contract_milestones
      ADD CONSTRAINT contract_milestones_status_check
      CHECK (status IN ('pending', 'in_progress', 'measured', 'approved', 'cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contract_milestones_contract
  ON public.contract_milestones(contract_id, due_date);
CREATE INDEX IF NOT EXISTS idx_contract_milestones_owner
  ON public.contract_milestones(owner_user_id) WHERE owner_user_id IS NOT NULL;

-- ── 2) CLÁUSULAS ───────────────────────────────────────────────────────────
--
-- `clause_type` já servia de categoria. Faltava tudo que torna uma cláusula
-- rastreável até o papel e revisável por gente: origem documental, valor
-- contratual e estado de revisão.

ALTER TABLE public.contract_clauses
  -- Proveniência documental: de qual documento e de qual página a cláusula
  -- veio. É o que permitirá, mais tarde, distinguir extração humana de
  -- extração por IA sem reescrever o domínio.
  ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES public.contract_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_page integer,
  ADD COLUMN IF NOT EXISTS source_excerpt text,
  -- Efeito contratual, quando a cláusula tem um. Os três são independentes:
  -- uma multa pode ser valor fixo, percentual, ou prazo.
  ADD COLUMN IF NOT EXISTS amount numeric,
  ADD COLUMN IF NOT EXISTS percentage numeric,
  ADD COLUMN IF NOT EXISTS term_days integer,
  -- Estado de revisão humana. `draft` como default preserva a leitura de quem
  -- já consulta a tabela e deixa explícito que registrar não é validar.
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contract_clauses_review_status_check'
  ) THEN
    ALTER TABLE public.contract_clauses
      ADD CONSTRAINT contract_clauses_review_status_check
      CHECK (review_status IN ('draft', 'in_review', 'validated', 'rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contract_clauses_contract
  ON public.contract_clauses(contract_id, clause_type);

-- ── 3) PENALIDADES ─────────────────────────────────────────────────────────
--
-- A penalidade passa a poder apontar para a cláusula que a origina, em vez de
-- repetir o texto dela. Continuam sendo dois registros porque são dois fatos
-- diferentes: a cláusula é o que o contrato diz; a penalidade é o gatilho
-- monitorado.

ALTER TABLE public.contract_penalties
  ADD COLUMN IF NOT EXISTS clause_id uuid REFERENCES public.contract_clauses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS percentage numeric,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contract_penalties_clause
  ON public.contract_penalties(clause_id) WHERE clause_id IS NOT NULL;

-- ── 4) CLÁUSULA → RISCO ────────────────────────────────────────────────────
--
-- O vínculo cláusula↔risco entra em `contract_risks_links`, que já é o
-- canônico do relacionamento contrato↔risco. Assim uma cláusula que origina um
-- risco aponta para o risco que JÁ VIVE no módulo de Riscos — nenhuma cópia do
-- risco entra em Contratos.

ALTER TABLE public.contract_risks_links
  ADD COLUMN IF NOT EXISTS clause_id uuid REFERENCES public.contract_clauses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contract_risks_links_clause
  ON public.contract_risks_links(clause_id) WHERE clause_id IS NOT NULL;

-- ── 5) ÍNDICE DA PONTE MARCO → FATURAMENTO ─────────────────────────────────
-- `contract_billing_events.milestone_id` existe desde 006 e nunca teve índice.
CREATE INDEX IF NOT EXISTS idx_contract_billing_events_milestone
  ON public.contract_billing_events(milestone_id) WHERE milestone_id IS NOT NULL;
