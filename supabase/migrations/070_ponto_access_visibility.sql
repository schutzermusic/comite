-- ============================================================
-- INSIGHT PONTO — access visibility + reminders + provisioning source
-- Migration: 070_ponto_access_visibility
--
-- Amplia o rastreio do ciclo de acesso do colaborador para a tela de
-- Pessoas e para a automação (auto-provisionamento por alocação + lembretes
-- de convite). Nada aqui é derivável do auth.users:
--
--   access_last_reminder_at  -> quando o último lembrete foi enviado
--   access_reminder_count    -> nº de lembretes enviados
--   access_activated_at      -> quando a conta foi ativada (detectado no cron)
--   access_provision_source  -> origem do convite: manual | allocation | batch
--   access_last_error        -> último erro (e-mail ausente / falha de envio)
--   access_last_error_at
--
-- O STATUS efetivo continua computado no servidor (access-server.ts).
-- ============================================================
BEGIN;

ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS access_last_reminder_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_reminder_count   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS access_activated_at     timestamptz,
  ADD COLUMN IF NOT EXISTS access_provision_source text
      CHECK (access_provision_source IS NULL OR access_provision_source IN ('manual','allocation','batch')),
  ADD COLUMN IF NOT EXISTS access_last_error       text,
  ADD COLUMN IF NOT EXISTS access_last_error_at    timestamptz;

COMMIT;

-- ============================================================
-- Rollback (manual):
--   ALTER TABLE people
--     DROP COLUMN IF EXISTS access_last_reminder_at,
--     DROP COLUMN IF EXISTS access_reminder_count,
--     DROP COLUMN IF EXISTS access_activated_at,
--     DROP COLUMN IF EXISTS access_provision_source,
--     DROP COLUMN IF EXISTS access_last_error,
--     DROP COLUMN IF EXISTS access_last_error_at;
-- ============================================================
