-- ============================================================================
-- PLATAFORMA — fecha a superfície DEFINER dos gatilhos de governança
-- Migration: 158_definer_trigger_surface_hardening
--
-- ─── O defeito ─────────────────────────────────────────────────────────────
--
-- Uma função criada no schema `public` nasce com `EXECUTE` para `PUBLIC` — e
-- portanto para `anon` e `authenticated`. Para uma função de GATILHO isso é
-- inútil e perigoso ao mesmo tempo: o gatilho a executa por conta própria,
-- independentemente de ACL, então a concessão não serve para nada; e sendo
-- `SECURITY DEFINER`, ela é uma superfície com privilégio de dono exposta a
-- quem quer que consiga chamá-la.
--
-- Três funções ficaram nesse estado:
--
--   · `contracts_guard_review_impersonation` (153) — e ela ainda estava sem
--     `search_path` fixo, o que a torna suscetível a sequestro de resolução de
--     nome por um schema plantado à frente do `public`.
--   · `apex_followups_guard_authority` (156)
--   · `apex_followups_record_event` (156)
--
-- A auditoria permanente da Fase 7.5 já vigiava exatamente isto — foi ela que
-- apontou o buraco. Esta migration o fecha e mantém a auditoria verde, que é o
-- comportamento certo: um invariante que passa a falhar é um invariante que
-- está funcionando.
--
-- ─── O que NÃO muda ────────────────────────────────────────────────────────
--
-- Revogar `EXECUTE` de uma função de gatilho não desliga o gatilho. O Postgres
-- executa a função associada ao gatilho sem consultar privilégio de execução;
-- a checagem de ACL só existe para chamada DIRETA. As guardas continuam
-- valendo exatamente como antes — só deixam de ser chamáveis por fora.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) `search_path` fixo na guarda de personificação
-- ---------------------------------------------------------------------------
-- `CREATE OR REPLACE` preserva a ACL da função, então recriá-la aqui NÃO
-- desfaria a exposição — a revogação abaixo é que faz isso. O que se corrige
-- neste passo é só a resolução de nome.
ALTER FUNCTION public.contracts_guard_review_impersonation()
  SET search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 2) Nenhum gatilho de governança é chamável de fora
-- ---------------------------------------------------------------------------
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'contracts_guard_review_impersonation()',
    'contracts_classify_interpretation()',
    'apex_followups_guard_authority()',
    'apex_followups_record_event()',
    'apex_followups_reject_history_rewrite()'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
END $$;

COMMENT ON FUNCTION public.contracts_guard_review_impersonation() IS
  'Gatilho de governança. NÃO é chamável diretamente: o Postgres executa a '
  'função do gatilho sem consultar privilégio de execução, e conceder EXECUTE '
  'só criaria uma superfície SECURITY DEFINER exposta sem nenhuma finalidade.';

COMMIT;
