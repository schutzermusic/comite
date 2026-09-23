-- ============================================================================
-- 214 — Mesma arrumação da 203, para as tabelas que vieram depois dela
--
-- A 212 criou `commercial_opportunity_stage_events` e a 213 criou as tabelas
-- de levantamento e de início de execução. O `GRANT` padrão do schema deixou
-- em `anon` (SELECT/REFERENCES/TRIGGER) e em `authenticated`
-- (REFERENCES/TRIGGER) privilégios que ninguém pediu. A RLS já negava a
-- leitura a `anon` — sem política para ele — mas a regra da 203 é que tabela
-- comercial não carrega privilégio ocioso: um GRANT futuro não pode passar
-- despercebido por já haver outro igual.
-- ============================================================================
BEGIN;

DO $revoke$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'commercial_opportunity_stage_events','commercial_site_surveys',
    'commercial_site_survey_events','commercial_execution_starts'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
                    ON TABLE public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
  END LOOP;
END $revoke$;

COMMIT;
