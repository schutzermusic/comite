-- ============================================================
-- INSIGHT PONTO — selfie retention (LGPD minimização de dados)
-- Migration: 069_attendance_selfie_retention
--
-- A selfie é dado biométrico sensível: deve ser retida só pelo tempo
-- necessário à conciliação do ponto. Esta função LIMPA o ponteiro da foto
-- na authentication_evidence para evidências mais antigas que N dias
-- (default 90) — a linha de evidência PERMANECE (auditoria/NSR), só sem o
-- arquivo. Retorna quantas evidências foram anonimizadas.
--
-- IMPORTANTE: o Supabase NÃO permite DELETE direto em storage.objects — a
-- remoção FÍSICA dos bytes da selfie precisa passar pela Storage API. Por
-- isso a automação de retenção é o script `scripts/purge-attendance-selfies.mjs`
-- (agende-o via cron/agente): ele remove os objetos pela Storage API e então
-- chama esta função para limpar os ponteiros. Esta função sozinha NÃO apaga
-- os arquivos.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.purge_attendance_selfies(p_retention_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff  timestamptz := now() - make_interval(days => greatest(p_retention_days, 1));
  v_cleared integer := 0;
BEGIN
  WITH updated AS (
    UPDATE public.authentication_evidence
       SET provider_reference = NULL,
           metadata = (metadata - 'path') || jsonb_build_object('selfie_purged', true, 'selfie_purged_at', now())
     WHERE method = 'facial_verification'
       AND created_at < v_cutoff
       AND provider_reference IS NOT NULL
    RETURNING id
  )
  SELECT count(*) INTO v_cleared FROM updated;

  RETURN v_cleared;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_attendance_selfies(integer) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.purge_attendance_selfies(integer) TO service_role;

COMMIT;

-- ============================================================
-- Automação (fora do banco, pois exige a Storage API):
--   node scripts/purge-attendance-selfies.mjs 90
-- Agende-o diariamente (cron do host, agente, ou GitHub Action).
--
-- Rollback (manual):
--   DROP FUNCTION IF EXISTS public.purge_attendance_selfies(integer);
-- ============================================================
