-- ============================================================================
-- 203 — `anon` perde o privilégio que nunca deveria ter recebido
--
-- ─── O que a auditoria encontrou ─────────────────────────────────────────
--
-- As treze tabelas do comercial nasceram com SELECT, REFERENCES e TRIGGER
-- concedidos a `anon`. Não foi descuido de quem as escreveu: o Supabase
-- concede isso por privilégio PADRÃO do schema `public`, e o mesmo vale para
-- tabelas antigas como `contracts` e `contract_onboarding_intakes`.
--
-- ─── Por que isso NÃO era um vazamento ───────────────────────────────────
--
-- Nenhuma política das tabelas novas tem `anon` no `TO`: todas dizem
-- `TO authenticated`. Com RLS ligada e nenhuma política aplicável, a leitura
-- de `anon` devolve zero linha, sempre. O privilégio existia e não alcançava
-- nada.
--
-- ─── Por que ainda assim sai ─────────────────────────────────────────────
--
-- Porque a defesa passa a depender de UMA camada em vez de duas. Basta que
-- alguém, um dia, escreva uma política sem `TO` — o padrão do Postgres é
-- `PUBLIC` — para que o privilégio adormecido acorde. Tirar o GRANT faz a
-- tabela ficar fechada a `anon` mesmo que a política erre.
--
-- REFERENCES e TRIGGER saem pelo mesmo motivo: nenhum papel de navegador tem
-- razão para criar chave estrangeira ou gatilho sobre estas tabelas.
-- ============================================================================

BEGIN;

DO $revoke$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'commercial_engagements','commercial_engagement_authorizations','engagement_project_links',
    'commercial_divergences','commercial_contacts','commercial_opportunities',
    'commercial_proposals','commercial_proposal_revisions','commercial_extracted_facts',
    'commercial_execution_blueprints','commercial_execution_blueprint_items',
    'internal_service_orders','commercial_engagement_history'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    -- `authenticated` mantém APENAS leitura: a escrita já entrava por função
    -- governada, e reafirmar aqui evita que um GRANT futuro passe despercebido.
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
                    ON TABLE public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
  END LOOP;
END $revoke$;

-- As visões derivadas seguem a mesma regra.
REVOKE ALL ON public.commercial_forecast_read_model FROM anon;
REVOKE ALL ON public.project_commercial_source_chain FROM anon;
GRANT SELECT ON public.commercial_forecast_read_model TO authenticated;
GRANT SELECT ON public.project_commercial_source_chain TO authenticated;

COMMIT;
