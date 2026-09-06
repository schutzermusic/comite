-- ============================================================
-- PLATAFORMA — TRUNCATE deixa de ser concedido a anon e authenticated
-- Migration: 118_platform_truncate_privilege_hardening
--
-- ─── A causa raiz ──────────────────────────────────────────────────────────
--
-- O schema `public` carrega DEFAULT PRIVILEGES que concedem `arwdDxtm` — todos
-- os privilégios de tabela, TRUNCATE incluído — a `anon` e `authenticated` em
-- toda tabela nova. Ninguém escreveu isso: é o padrão que o Supabase instala no
-- projeto. O efeito é que cada migration que cria uma tabela concede TRUNCATE
-- aos dois papéis do navegador sem uma linha sequer pedindo por isso.
--
-- ─── Por que TRUNCATE especificamente ──────────────────────────────────────
--
-- Porque ele é o único privilégio de escrita que a RLS **não filtra**. SELECT,
-- INSERT, UPDATE e DELETE passam pelas políticas: um `anon` sem organização não
-- casa com nenhuma linha e não faz nada. TRUNCATE não olha para linha — ele
-- esvazia a tabela inteira. A política de inquilino mais bem escrita do
-- repositório não o alcança.
--
-- Isso NÃO significa que havia porta aberta. O PostgREST, que é como `anon` e
-- `authenticated` falam com este banco, não expõe TRUNCATE: o verbo não existe
-- na API dele, e não há função `SECURITY INVOKER` que o execute — as duas
-- coisas foram verificadas antes desta migration. O que havia era um privilégio
-- muito mais largo que o desenho, esperando pela primeira função nova que
-- rodasse como quem a chamou.
--
-- ─── O que esta migration NÃO faz ──────────────────────────────────────────
--
-- Não encosta em SELECT, INSERT, UPDATE nem DELETE: esses são deliberadamente
-- amplos e governados por RLS, e mexer neles seria redesenhar o controle de
-- acesso a pretexto de uma correção de privilégio.
-- Não encosta em `service_role` nem `postgres`: é por eles que as rotas e as
-- próprias migrations trabalham.
-- Não altera política, papel, permissão nem RBAC.
--
-- ─── Nenhum fluxo perde nada ───────────────────────────────────────────────
--
-- O único TRUNCATE do repositório está na migration 005, sobre uma TEMP TABLE
-- (`role_permission_seed`, `ON COMMIT DROP`), executada como `postgres`. Tabela
-- temporária pertence à sessão e não depende de grant a `anon` nem a
-- `authenticated`. Nenhuma outra ocorrência existe em `src/`, em `scripts/`, em
-- migration ou em função de banco.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1) O que já existe
-- ------------------------------------------------------------
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- ------------------------------------------------------------
-- 2) O que ainda vai existir
-- ------------------------------------------------------------
-- Revogar as tabelas de hoje sem corrigir o DEFAULT deixaria a próxima
-- migration reabrindo o buraco — e ninguém repararia, porque a abertura não
-- aparece em diff nenhum.
--
-- O laço percorre os papéis que REALMENTE possuem tabela em `public`, em vez de
-- fixar `postgres` no texto: se um dia as migrations passarem a rodar sob outro
-- dono, o alvo acompanha. Hoje esse conjunto tem um elemento só.
DO $$
DECLARE owner_role text;
BEGIN
  FOR owner_role IN
    SELECT DISTINCT c.relowner::regrole::text
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p')
  LOOP
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM anon, authenticated',
      owner_role);
    RAISE NOTICE '[118] default privileges corrigidos para o dono %', owner_role;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 3) O que não podemos corrigir — declarado, não escondido
-- ------------------------------------------------------------
-- `supabase_admin` também tem um DEFAULT ACL concedendo TRUNCATE, e `postgres`
-- não é membro dele: `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` responde
-- "permission denied to change default privileges". É papel da plataforma, e
-- forçá-lo não está ao nosso alcance nem deveria estar.
--
-- Na prática ele não alcança nada nosso: aquele default só vale para tabela
-- CRIADA POR supabase_admin, e nenhuma das tabelas de `public` é dele — todas
-- pertencem a `postgres`, que é sob quem as migrations rodam. O aviso existe
-- para que a assimetria fique registrada em vez de descoberta de novo daqui a
-- um ano.
DO $$
DECLARE residual text;
BEGIN
  SELECT string_agg(DISTINCT d.defaclrole::regrole::text, ', ')
    INTO residual
    FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
   WHERE d.defaclnamespace = 'public'::regnamespace
     AND d.defaclobjtype = 'r'
     AND a.privilege_type = 'TRUNCATE'
     AND a.grantee::regrole::text IN ('anon','authenticated');

  IF residual IS NOT NULL THEN
    RAISE NOTICE '[118] DEFAULT ACL de TRUNCATE remanescente, fora do nosso alcance: %. '
                 'Só afeta tabela criada POR esse papel; nenhuma tabela de public pertence a ele.', residual;
  ELSE
    RAISE NOTICE '[118] nenhum DEFAULT ACL concede mais TRUNCATE a anon/authenticated em public.';
  END IF;
END $$;

COMMIT;
