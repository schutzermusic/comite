-- ============================================================
-- 172 — A BANCADA É SOMENTE LEITURA, E O GRANT PASSA A DIZER ISSO
--
-- ─── O que a 171 deixou implícito ─────────────────────────────────────────
--
-- A 171 concedeu SELECT e revogou tudo de `anon`, mas não revogou escrita de
-- `authenticated`. O privilégio continuou lá porque o Supabase aplica
-- ALTER DEFAULT PRIVILEGES concedendo ALL em objetos novos do schema `public` —
-- então a visão nasceu com INSERT, UPDATE e DELETE para `authenticated` sem que
-- nenhuma linha da migration pedisse isso.
--
-- ─── Por que isso não era um buraco, e mesmo assim é consertado ───────────
--
-- A bancada tem LATERAL e vários FROM: o Postgres a classifica como NÃO
-- atualizável (`information_schema.views.is_insertable_into = 'NO'`), e um
-- INSERT nela falha por construção. Além disso ela é `security_invoker`, então
-- qualquer caminho até as tabelas de origem passaria pela RLS de quem chama.
--
-- Duas defesas, nenhuma delas declarada. O privilégio ficava como uma afirmação
-- FALSA sobre a intenção — e a próxima pessoa a ler `\dp` concluiria que
-- escrever ali é previsto. A migration não corrige um vazamento: corrige o que
-- o catálogo DIZ, que é o que a próxima pessoa vai acreditar.
--
-- ─── Escopo ──────────────────────────────────────────────────────────────
--
-- SÓ a bancada. As demais visões de leitura do schema (`contract_to_cash_read_
-- model`, `project_measurement_read_model`, `contract_measurement_rule_timeline_
-- governed`, `contract_to_cash_health`) têm a MESMA herança de privilégio, e
-- mexer nelas aqui seria alterar a superfície de objetos de produção numa
-- migration cujo assunto é outro. Fica registrado para tratamento próprio.
-- ============================================================
BEGIN;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.contract_milestone_workbench FROM authenticated;
REVOKE ALL ON public.contract_milestone_workbench FROM anon;
GRANT SELECT ON public.contract_milestone_workbench TO authenticated;

COMMIT;
