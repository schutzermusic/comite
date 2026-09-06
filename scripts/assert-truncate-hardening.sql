-- ============================================================
-- Provas FUNCIONAIS do endurecimento de TRUNCATE.
--
-- Contagem de privilégio prova o estado de hoje. O que estas provas
-- acrescentam é o COMPORTAMENTO: uma tabela criada agora, pelo mesmo dono sob
-- o qual as migrations rodam, não pode nascer com TRUNCATE para o navegador —
-- e `anon`/`authenticated`, agindo como si mesmos, têm que ser recusados ao
-- tentar esvaziar uma tabela.
--
-- Tudo com objeto descartável, dentro da transação do runner.
-- ============================================================
DO $$
DECLARE
  n integer;
  failed boolean;
BEGIN
  -- ---------- 1) nenhuma tabela existente concede TRUNCATE ao navegador ----------
  SELECT count(*) INTO n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND privilege_type = 'TRUNCATE'
     AND grantee IN ('anon','authenticated');
  IF n <> 0 THEN
    RAISE EXCEPTION 'FALHA: % concessão(ões) de TRUNCATE a anon/authenticated permanecem.', n;
  END IF;

  -- ---------- 2) service_role e postgres seguem intactos ----------
  -- É por eles que as rotas e as migrations trabalham. Uma "correção" que os
  -- alcançasse teria quebrado o produto para consertar um privilégio.
  SELECT count(DISTINCT table_name) INTO n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND privilege_type = 'TRUNCATE' AND grantee = 'service_role';
  IF n = 0 THEN RAISE EXCEPTION 'FALHA: service_role perdeu TRUNCATE — a revogação foi longe demais.'; END IF;

  SELECT count(DISTINCT table_name) INTO n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND privilege_type = 'TRUNCATE' AND grantee = 'postgres';
  IF n = 0 THEN RAISE EXCEPTION 'FALHA: postgres perdeu TRUNCATE — as migrations deixariam de funcionar.'; END IF;

  -- ---------- 3) o DML governado por RLS não foi tocado ----------
  -- Estes números são amplos DE PROPÓSITO: quem filtra linha é a política, não
  -- o grant. Se caíssem a zero, o endurecimento teria virado um redesenho de
  -- controle de acesso.
  SELECT count(DISTINCT table_name) INTO n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND privilege_type = 'SELECT' AND grantee = 'authenticated';
  IF n < 100 THEN RAISE EXCEPTION 'FALHA: SELECT de authenticated caiu para % tabelas.', n; END IF;

  SELECT count(DISTINCT table_name) INTO n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND privilege_type = 'INSERT' AND grantee = 'authenticated';
  IF n < 100 THEN RAISE EXCEPTION 'FALHA: INSERT de authenticated caiu para % tabelas.', n; END IF;

  -- ---------- 4) a Fiscal (112) está coberta ----------
  SELECT count(*) INTO n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND privilege_type = 'TRUNCATE'
     AND grantee IN ('anon','authenticated') AND table_name LIKE 'fiscal\_%';
  IF n <> 0 THEN RAISE EXCEPTION 'FALHA: % tabela(s) fiscais ainda concedem TRUNCATE.', n; END IF;

  -- ...e continua com as onze tabelas que a 112 criou.
  SELECT count(*) INTO n FROM pg_class
   WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname LIKE 'fiscal\_%';
  IF n <> 11 THEN RAISE EXCEPTION 'FALHA: esperava 11 tabelas fiscais, encontrei %.', n; END IF;

  -- ---------- 5) a Fase 3 continua coberta ----------
  SELECT count(*) INTO n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND privilege_type = 'TRUNCATE'
     AND grantee IN ('anon','authenticated') AND table_name LIKE 'contract\_obligation%';
  IF n <> 0 THEN RAISE EXCEPTION 'FALHA: % tabela(s) de obrigação ainda concedem TRUNCATE.', n; END IF;

  -- ---------- 6) COMPORTAMENTO: tabela nova não herda ----------
  -- A prova que a contagem não dá. Criada aqui pelo mesmo dono sob o qual as
  -- migrations rodam; se o DEFAULT ACL não tivesse sido corrigido, ela nasceria
  -- com TRUNCATE para os dois papéis.
  CREATE TABLE public.__truncate_hardening_probe (id integer);
  SELECT count(*) INTO n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = '__truncate_hardening_probe'
     AND privilege_type = 'TRUNCATE' AND grantee IN ('anon','authenticated');
  IF n <> 0 THEN
    RAISE EXCEPTION 'FALHA: tabela criada agora JÁ nasce com TRUNCATE para o navegador (% concessões).', n;
  END IF;

  -- ...e o resto do DML continua sendo herdado, como o Supabase espera.
  SELECT count(*) INTO n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = '__truncate_hardening_probe'
     AND privilege_type = 'SELECT' AND grantee = 'authenticated';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FALHA: a correção do DEFAULT ACL levou junto o SELECT de authenticated.';
  END IF;

  -- ---------- 7) COMPORTAMENTO: o papel do navegador é recusado ----------
  -- Agindo como `authenticated`, esvaziar a tabela tem que falhar por
  -- privilégio. É esta prova, e não a contagem, que responde "e se alguém
  -- tentar?".
  INSERT INTO public.__truncate_hardening_probe VALUES (1);
  failed := false;
  BEGIN
    SET LOCAL ROLE authenticated;
    BEGIN
      EXECUTE 'TRUNCATE public.__truncate_hardening_probe';
    EXCEPTION WHEN insufficient_privilege THEN failed := true;
    END;
    RESET ROLE;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: authenticated conseguiu esvaziar a tabela.'; END IF;

  failed := false;
  BEGIN
    SET LOCAL ROLE anon;
    BEGIN
      EXECUTE 'TRUNCATE public.__truncate_hardening_probe';
    EXCEPTION WHEN insufficient_privilege THEN failed := true;
    END;
    RESET ROLE;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'FALHA: anon conseguiu esvaziar a tabela.'; END IF;

  -- A linha inserida antes continua lá: nenhuma das tentativas passou.
  SELECT count(*) INTO n FROM public.__truncate_hardening_probe;
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA: a tabela de prova foi esvaziada apesar da recusa.'; END IF;

  DROP TABLE public.__truncate_hardening_probe;

  RAISE NOTICE 'Endurecimento de TRUNCATE: todas as provas passaram.';
END $$;
