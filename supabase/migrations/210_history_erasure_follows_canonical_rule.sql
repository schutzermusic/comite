-- ============================================================================
-- 210 — A HISTÓRIA DO TRABALHO AUTORIZADO SEGUE A REGRA QUE JÁ EXISTIA
--
-- ─── O erro ──────────────────────────────────────────────────────────────
--
-- A 200 protegeu `commercial_engagement_history` com um gatilho próprio que
-- recusa UPDATE e DELETE de TODO MUNDO — inclusive do `service_role`.
--
-- A plataforma já tinha resolvido esse problema, e resolvido melhor:
-- `contracts_reject_history_erasure` recusa o apagamento vindo da APLICAÇÃO
-- (`authenticated`, `anon`) e deixa passar o apagamento GOVERNADO. Vinte e
-- quatro tabelas de história usam exatamente essa função — medição,
-- faturamento, obrigação, aditivo, recebível, liquidação.
--
-- A diferença não é de rigor, é de alcance. "Append-only" protege a história
-- de ser REESCRITA por quem opera o sistema. Não significa que um inquilino
-- inteiro não possa ser removido: a Fase 7.5 apaga organização inteira por um
-- caminho privilegiado e auditado, e esse caminho precisa alcançar tudo.
--
-- Com o gatilho da 200, a remoção de inquilino parava na história do
-- comercial e abortava no meio — deixando resíduo. É o mesmo padrão de falha
-- que a 207 corrigiu nas chaves estrangeiras.
--
-- ─── A correção ──────────────────────────────────────────────────────────
--
-- UPDATE continua recusado para TODOS: história não se reescreve, nem pelo
-- service_role. DELETE passa a usar a função canônica.
-- ============================================================================

BEGIN;

DROP TRIGGER ceh_append_only ON public.commercial_engagement_history;

CREATE OR REPLACE FUNCTION public.commercial_history_is_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  -- Só UPDATE chega aqui agora. Reescrever história é proibido a qualquer
  -- papel: o registro é o que aconteceu, e "corrigir" um registro de
  -- governança é indistinguível de falsificá-lo.
  RAISE EXCEPTION 'commercial_engagement_history não se reescreve.' USING ERRCODE = '42501';
END $$;

CREATE TRIGGER ceh_no_rewrite
  BEFORE UPDATE ON public.commercial_engagement_history
  FOR EACH ROW EXECUTE FUNCTION public.commercial_history_is_append_only();

-- O apagamento segue a MESMA regra das outras 24 tabelas de história.
CREATE TRIGGER ceh_no_erasure
  BEFORE DELETE ON public.commercial_engagement_history
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

COMMIT;
