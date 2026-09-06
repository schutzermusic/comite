-- ============================================================
-- CONTRATOS — o SET NULL composto do pedido de extração perde a organização
-- Migration: 123_contracts_extraction_request_set_null_scope
--
-- ─── O defeito ─────────────────────────────────────────────────────────────
--
-- A 122 escreveu, para amarrar o pedido ao inquilino:
--
--   FOREIGN KEY (organization_id, job_id)
--     REFERENCES apex_jobs (organization_id, id) ON DELETE SET NULL
--
-- `ON DELETE SET NULL` sem lista de colunas anula TODAS as colunas da chave —
-- inclusive `organization_id`, que é NOT NULL. Apagar um trabalho referenciado
-- não anulava `job_id`: derrubava a transação inteira com
--
--   null value in column "organization_id" ... violates not-null constraint
--
-- O mesmo vale para `analysis_id`.
--
-- ─── Por que isso importa mais do que parece ───────────────────────────────
--
-- Não é só a limpeza de teste que quebrava. `organizations` apaga em cascata
-- tanto `apex_jobs` quanto `contract_clause_extraction_requests`, e a ORDEM em
-- que o Postgres percorre uma cascata não é garantida: se ele alcançasse o
-- trabalho antes do pedido, o SET NULL disparava e o apagamento do INQUILINO
-- INTEIRO falhava. O smoke da Fase 4 passou porque a ordem saiu favorável — o
-- que é exatamente o tipo de correção que só se descobre executando, e
-- exatamente o risco que a 114 já tinha anotado ao escolher CASCADE em vez de
-- RESTRICT pelo mesmo motivo.
--
-- ─── A correção ────────────────────────────────────────────────────────────
--
-- Postgres 15+ aceita a lista de colunas: só a referência é anulada, e o
-- inquilino permanece. A amarra composta continua inteira — um pedido segue
-- sem poder apontar para trabalho ou análise de outra organização.
-- ============================================================
BEGIN;

ALTER TABLE public.contract_clause_extraction_requests
  DROP CONSTRAINT ccer_job_tenant,
  ADD  CONSTRAINT ccer_job_tenant FOREIGN KEY (organization_id, job_id)
       REFERENCES public.apex_jobs (organization_id, id) ON DELETE SET NULL (job_id);

ALTER TABLE public.contract_clause_extraction_requests
  DROP CONSTRAINT ccer_analysis_tenant,
  ADD  CONSTRAINT ccer_analysis_tenant FOREIGN KEY (organization_id, analysis_id)
       REFERENCES public.contract_ai_analyses (organization_id, id) ON DELETE SET NULL (analysis_id);

COMMIT;
