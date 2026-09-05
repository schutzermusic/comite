-- ============================================================
-- ROLLBACK das migrations da Fase 2 do Contracts V2 (108–109)
-- ============================================================
--
-- NÃO é uma migration: fica fora de supabase/migrations/ de propósito, para não
-- ser aplicado por engano por nenhum runner.
--
--   psql "$SUPABASE_DB_URL" -f scripts/rollback-contracts-v2-phase2.sql
--
-- ATENÇÃO ao que o rollback REABRE:
--   * 109 → cláusula referenciada volta a poder ser reescrita ou apagada, e o
--           valor/prazo ORIGINAL de um contrato com aditivo volta a poder ser
--           sobrescrito no lugar de receber um novo instrumento
--   * 108 → aditivo volta a poder ser reparentado e apagado de vez, e a relação
--           aditivo-cláusula volta a poder ser alterada sem deixar rastro
--
-- Reverter é restaurar defeitos. Faça-o apenas para desbloquear, e por tempo
-- medido em horas.
--
-- ─── LEIA ANTES DE RODAR ───────────────────────────────────────────────────
--
-- Este arquivo é DESTRUTIVO se alguém já registrou linhagem ou fato contratual
-- estruturado: garantia, seguro, indexação, condição de faturamento e requisito
-- de medição são verdade contratual com procedência, e o DROP os leva junto. As
-- revisões imutáveis de aditivo também somem — e com elas o histórico de quem
-- alterou o quê.
--
-- A Fase 2 nasce VAZIA em toda tabela nova: enquanto ninguém tiver cadastrado
-- nada, este rollback não perde fato nenhum. Confirme antes:
--
--   SELECT 'lineage' t,count(*) FROM contract_instrument_lineage
--   UNION ALL SELECT 'guarantees',count(*) FROM contract_guarantees
--   UNION ALL SELECT 'insurance',count(*) FROM contract_insurance_requirements
--   UNION ALL SELECT 'indexation',count(*) FROM contract_indexation_rules
--   UNION ALL SELECT 'billing',count(*) FROM contract_billing_conditions
--   UNION ALL SELECT 'measurement',count(*) FROM contract_measurement_requirements;
--
-- Se qualquer contagem for maior que zero, EXPORTE antes de reverter.
--
-- O que este rollback NÃO toca: contracts, contract_clauses, contract_amendments
-- e contract_amendment_clauses mantêm todas as linhas e todo o conteúdo. A única
-- coluna devolvida é contract_amendment_clauses.contract_id, que a 108 derivou do
-- próprio aditivo e é reconstruível a qualquer momento.
-- ============================================================
BEGIN;

-- ─── 110 ───────────────────────────────────────────────────────────────────
-- Os gatilhos de 108/109 caem junto com as tabelas e funções logo abaixo; aqui
-- só ficam os objetos que a 110 criou por conta própria.
DROP TRIGGER IF EXISTS protect_referenced_clause ON public.contract_clauses;
DROP FUNCTION IF EXISTS public.contracts_protect_referenced_clause();
DROP FUNCTION IF EXISTS public.contracts_clause_is_referenced(uuid);
DROP TRIGGER IF EXISTS amendment_clause_history_no_erasure ON public.contract_amendment_clauses;
DROP TRIGGER IF EXISTS amendment_revisions_no_erasure ON public.contract_amendment_revisions;
DROP TRIGGER IF EXISTS lineage_no_erasure ON public.contract_instrument_lineage;
DROP FUNCTION IF EXISTS public.contracts_reject_history_erasure() CASCADE;

-- ─── 109 ───────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS protect_original_terms ON public.contracts;
DROP FUNCTION IF EXISTS public.contracts_protect_original_terms();
DROP TRIGGER IF EXISTS protect_referenced_clause ON public.contract_clauses;
DROP FUNCTION IF EXISTS public.contracts_protect_referenced_clause();
DROP TABLE IF EXISTS public.contract_measurement_requirements;
DROP TABLE IF EXISTS public.contract_billing_conditions;
DROP TABLE IF EXISTS public.contract_indexation_rules;
DROP TABLE IF EXISTS public.contract_insurance_requirements;
DROP TABLE IF EXISTS public.contract_guarantees;
DROP FUNCTION IF EXISTS public.contracts_validate_fact_predecessor();

-- ─── 108 ───────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.create_contract_amendment_with_lineage(jsonb, uuid);
DROP TABLE IF EXISTS public.contract_instrument_lineage;
DROP FUNCTION IF EXISTS public.contracts_validate_instrument_lineage();
DROP TRIGGER IF EXISTS capture_amendment_revision ON public.contract_amendments;
DROP FUNCTION IF EXISTS public.contracts_capture_amendment_revision();
DROP TRIGGER IF EXISTS amendment_identity_immutable ON public.contract_amendments;
DROP FUNCTION IF EXISTS public.contracts_reject_amendment_reparenting();
DROP TABLE IF EXISTS public.contract_amendment_revisions;
DROP TRIGGER IF EXISTS amendment_no_hard_delete ON public.contract_amendments;
DROP TRIGGER IF EXISTS amendment_clause_history_immutable ON public.contract_amendment_clauses;
DROP FUNCTION IF EXISTS public.contracts_reject_history_mutation() CASCADE;
DROP TRIGGER IF EXISTS contracts_fill_clause_link_scope ON public.contract_amendment_clauses;
DROP FUNCTION IF EXISTS public.contracts_fill_clause_link_scope();

DROP INDEX IF EXISTS public.links_unique_target_phase2;
ALTER TABLE public.contract_amendment_clauses
  DROP CONSTRAINT IF EXISTS links_no_self_replacement_phase2,
  DROP CONSTRAINT IF EXISTS links_replacement_contract_phase2,
  DROP CONSTRAINT IF EXISTS links_clause_contract_phase2,
  DROP CONSTRAINT IF EXISTS links_amendment_contract_phase2,
  DROP COLUMN IF EXISTS contract_id;
ALTER TABLE public.contract_amendments
  DROP CONSTRAINT IF EXISTS amendments_document_contract_phase2,
  DROP CONSTRAINT IF EXISTS amendments_contract_tenant_phase2;
ALTER TABLE public.contract_documents DROP CONSTRAINT IF EXISTS documents_contract_tenant_phase2;
ALTER TABLE public.contract_clauses
  DROP CONSTRAINT IF EXISTS clauses_source_document_contract_phase2,
  DROP CONSTRAINT IF EXISTS clauses_contract_tenant_phase2;
DROP INDEX IF EXISTS public.milestones_org_contract_id_phase2;
DROP INDEX IF EXISTS public.amendments_org_contract_id_phase2;
DROP INDEX IF EXISTS public.documents_org_contract_id_phase2;
DROP INDEX IF EXISTS public.clauses_org_contract_id_phase2;
DROP INDEX IF EXISTS public.contracts_org_id_phase2;

COMMIT;
