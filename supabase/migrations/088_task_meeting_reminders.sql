-- ============================================================
-- AGENDA — reconciliação dos jobs de lembrete
-- Migration: 088_task_meeting_reminders
--
-- Este arquivo substitui o antigo 028b, cujo nome não era aceito pelo
-- Supabase CLI. Como a migration 031 já instalou versões enterprise de
-- process_task_reminders() e process_meeting_reminders(), a 088 NÃO redefine
-- essas funções: apenas garante as colunas legadas e agenda os jobs para as
-- implementações atuais.
-- ============================================================
BEGIN;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS reminder_1d_sent_at       timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_overdue_sent_at timestamptz;

ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS reminder_1h_sent_at timestamptz;

DO $outer$
BEGIN
  IF to_regprocedure('public.process_task_reminders()') IS NULL
     OR to_regprocedure('public.process_meeting_reminders()') IS NULL THEN
    RAISE EXCEPTION
      'Funções de lembrete ausentes; aplique a migration 031 antes da 088';
  END IF;

  -- Os nomes são as chaves idempotentes. Reagendar atualiza o comando e evita
  -- jobs duplicados quando o schema foi provisionado manualmente.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'task-due-reminders') THEN
    PERFORM cron.unschedule('task-due-reminders');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'meeting-reminders') THEN
    PERFORM cron.unschedule('meeting-reminders');
  END IF;

  PERFORM cron.schedule(
    'task-due-reminders',
    '0 * * * *',
    'SELECT public.process_task_reminders()'
  );

  PERFORM cron.schedule(
    'meeting-reminders',
    '*/15 * * * *',
    'SELECT public.process_meeting_reminders()'
  );

  RAISE NOTICE
    'Jobs reconciliados: task-due-reminders (horário), meeting-reminders (15 min)';
EXCEPTION
  WHEN undefined_table OR undefined_function OR invalid_schema_name THEN
    -- O restante da agenda continua funcional sem pg_cron. A rota protegida
    -- /api/agenda/reminders/run também pode acionar as mesmas funções.
    RAISE NOTICE
      'pg_cron indisponível; jobs não agendados. As funções de lembrete permanecem instaladas.';
END;
$outer$;

COMMIT;
