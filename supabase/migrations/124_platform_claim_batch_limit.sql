-- ============================================================
-- PLATAFORMA — o lote da reivindicação não estava sendo respeitado
-- Migration: 124_platform_claim_batch_limit
--
-- ─── O defeito ─────────────────────────────────────────────────────────────
--
-- A 120 escreveu a reivindicação como:
--
--   UPDATE apex_jobs j SET ... FROM (
--     SELECT id FROM apex_jobs WHERE ... LIMIT p_limit FOR UPDATE SKIP LOCKED
--   ) due WHERE j.id = due.id RETURNING j.*;
--
-- Pedir 4 devolvia 8. O plano explica:
--
--   Update on apex_jobs j
--     -> Nested Loop
--          -> Seq Scan on apex_jobs j
--          -> Subquery Scan on due
--               -> Limit
--                    -> LockRows ...
--
-- A subconsulta com LIMIT ficou no lado INTERNO de um laço aninhado, e o lado
-- interno é REEXECUTADO a cada linha externa. Cada reexecução respeita o LIMIT
-- de 4 — mas, como as linhas que ela já travou passam a ser puladas pelo
-- SKIP LOCKED, cada passada devolve QUATRO OUTRAS. O limite valia por
-- reexecução, não pela chamada.
--
-- ─── Por que isso importa ──────────────────────────────────────────────────
--
-- Nenhum trabalho é executado duas vezes: a posse continua exclusiva e o token
-- continua íntegro. O que quebrava era a EXECUÇÃO LIMITADA, que é o que impede
-- a hospedagem de derrubar o trabalhador no meio. Um lote maior que o pedido
-- gasta `attempt_count` em trabalho que o trabalhador não vai executar dentro
-- do orçamento; esses trabalhos ficam PROCESSING até a concessão vencer e o
-- ceifador os devolver — recuperável, e ainda assim uma tentativa queimada a
-- cada volta.
--
-- ─── A correção ────────────────────────────────────────────────────────────
--
-- CTE `AS MATERIALIZED`: a seleção acontece UMA vez, o resultado é congelado, e
-- o UPDATE junta contra esse resultado. `MATERIALIZED` é explícito de propósito
-- — depender de o planejador "não conseguir" embutir uma CTE com FOR UPDATE
-- seria depender de um detalhe de implementação para uma garantia de execução.
--
-- O ceifador ganha a mesma marca pelo mesmo motivo: ele já era materializado na
-- prática, e passa a dizê-lo.
--
-- A 120 NÃO é editada. Migration aplicada é registro.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.apex_jobs_claim(
  p_worker         text,
  p_limit          integer DEFAULT 10,
  p_lease_seconds  integer DEFAULT 300
) RETURNS SETOF public.apex_jobs
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Reivindicação negada.' USING ERRCODE = '42501';
  END IF;
  -- NULL passava por esta guarda e virava `LIMIT NULL`, que é "sem limite".
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'Lote de reivindicação fora do intervalo permitido.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 1 THEN
    RAISE EXCEPTION 'Concessão fora do intervalo permitido.' USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  WITH due AS MATERIALIZED (
    SELECT id FROM public.apex_jobs
     WHERE status = 'PENDING' AND run_after <= now()
     ORDER BY run_after, created_at
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.apex_jobs j
     SET status           = 'PROCESSING',
         locked_at        = now(),
         locked_by        = p_worker,
         lock_token       = gen_random_uuid(),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         -- A tentativa continua sendo contada AQUI, na reivindicação.
         attempt_count    = j.attempt_count + 1
    FROM due
   WHERE j.id = due.id
  RETURNING j.*;
END $$;
REVOKE ALL ON FUNCTION public.apex_jobs_claim(text, integer, integer) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.apex_jobs_claim(text, integer, integer) IS
  'Seleção e posse no MESMO comando, com FOR UPDATE SKIP LOCKED dentro de uma '
  'CTE MATERIALIZED. A materialização não é enfeite: sem ela o planejador põe a '
  'subconsulta limitada do lado interno de um laço aninhado, reexecuta-a por '
  'linha externa e o lote pedido deixa de valer. Dois trabalhadores '
  'concorrentes recebem conjuntos disjuntos. A tentativa é contada na '
  'reivindicação, não na falha.';

CREATE OR REPLACE FUNCTION public.apex_jobs_reap(
  p_limit integer DEFAULT 100,
  p_backoff_seconds integer DEFAULT 60
) RETURNS TABLE (released integer, dead_lettered integer)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Ceifa negada.' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'Lote de ceifa fora do intervalo permitido.' USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  WITH expired AS MATERIALIZED (
    SELECT id, attempt_count, max_attempts
      FROM public.apex_jobs
     WHERE status = 'PROCESSING' AND lease_expires_at < now()
     ORDER BY lease_expires_at
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  ), updated AS (
    UPDATE public.apex_jobs j
       SET status = CASE WHEN e.attempt_count < e.max_attempts THEN 'PENDING' ELSE 'DEAD_LETTER' END,
           run_after = CASE WHEN e.attempt_count < e.max_attempts
                            THEN now() + make_interval(secs => COALESCE(p_backoff_seconds, 60))
                            ELSE j.run_after END,
           completed_at = CASE WHEN e.attempt_count < e.max_attempts THEN NULL ELSE now() END,
           locked_at = NULL, locked_by = NULL,
           -- Invalida o token: o trabalhador antigo não conclui mais nada.
           lock_token = NULL, lease_expires_at = NULL,
           last_error_code = 'lease_expired',
           last_error_safe = 'A concessão expirou sem conclusão; o trabalho foi devolvido à fila.'
      FROM expired e
     WHERE j.id = e.id
    RETURNING j.status
  )
  SELECT count(*) FILTER (WHERE status = 'PENDING')::integer,
         count(*) FILTER (WHERE status = 'DEAD_LETTER')::integer
    FROM updated;
END $$;
REVOKE ALL ON FUNCTION public.apex_jobs_reap(integer, integer) FROM PUBLIC, anon, authenticated;

COMMIT;
