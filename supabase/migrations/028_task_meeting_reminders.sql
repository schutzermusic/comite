-- Migration 028 — Cron de lembretes de tarefas e reuniões
-- Depende de: 026_agenda_calendar.sql (tabelas tasks, calendar_events, notifications)
-- pg_cron deve estar habilitado no projeto Supabase (habilitado por padrão nos planos pagos)

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Colunas de controle de envio (idempotente)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS reminder_1d_sent_at      timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_overdue_sent_at  timestamptz;

ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS reminder_1h_sent_at       timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. process_task_reminders()
--    Cria notificações in-app para tarefas que vencem em ≤24h e para atrasadas.
--    Roda como SECURITY DEFINER → bypasss RLS → pode inserir em notifications
--    sem policy de INSERT aberta. Seguro pois é chamado pelo pg_cron (postgres role).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.process_task_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec     RECORD;
  v_count integer := 0;
BEGIN

  -- ── Vence nas próximas 24 h (ainda não notificado) ─────────────────────
  FOR rec IN
    SELECT id, organization_id, title, assignee_user_id, creator_user_id, due_at
    FROM   tasks
    WHERE  deleted_at IS NULL
      AND  status NOT IN ('done', 'cancelled')
      AND  due_at IS NOT NULL
      AND  due_at BETWEEN now() AND now() + INTERVAL '24 hours'
      AND  reminder_1d_sent_at IS NULL
  LOOP
    -- Notifica responsável
    IF rec.assignee_user_id IS NOT NULL THEN
      INSERT INTO notifications
        (organization_id, recipient_user_id, type, title, body, link_url)
      VALUES
        (rec.organization_id, rec.assignee_user_id,
         'task_reminder', 'Vence em 24 h', rec.title,
         '/reunioes?task=' || rec.id);
      v_count := v_count + 1;
    END IF;

    -- Notifica criador (se diferente do responsável)
    IF rec.creator_user_id IS NOT NULL
       AND rec.creator_user_id IS DISTINCT FROM rec.assignee_user_id THEN
      INSERT INTO notifications
        (organization_id, recipient_user_id, type, title, body, link_url)
      VALUES
        (rec.organization_id, rec.creator_user_id,
         'task_reminder', 'Vence em 24 h', rec.title,
         '/reunioes?task=' || rec.id);
      v_count := v_count + 1;
    END IF;

    UPDATE tasks SET reminder_1d_sent_at = now() WHERE id = rec.id;
  END LOOP;

  -- ── Atrasada — primeiro alerta ──────────────────────────────────────────
  FOR rec IN
    SELECT id, organization_id, title, assignee_user_id, creator_user_id, due_at
    FROM   tasks
    WHERE  deleted_at IS NULL
      AND  status NOT IN ('done', 'cancelled')
      AND  due_at IS NOT NULL
      AND  due_at < now()
      AND  reminder_overdue_sent_at IS NULL
  LOOP
    IF rec.assignee_user_id IS NOT NULL THEN
      INSERT INTO notifications
        (organization_id, recipient_user_id, type, title, body, link_url)
      VALUES
        (rec.organization_id, rec.assignee_user_id,
         'task_overdue', 'Tarefa atrasada',
         rec.title || ' — prazo encerrado',
         '/reunioes?task=' || rec.id);
      v_count := v_count + 1;
    END IF;

    IF rec.creator_user_id IS NOT NULL
       AND rec.creator_user_id IS DISTINCT FROM rec.assignee_user_id THEN
      INSERT INTO notifications
        (organization_id, recipient_user_id, type, title, body, link_url)
      VALUES
        (rec.organization_id, rec.creator_user_id,
         'task_overdue', 'Tarefa atrasada',
         rec.title || ' — prazo encerrado',
         '/reunioes?task=' || rec.id);
      v_count := v_count + 1;
    END IF;

    UPDATE tasks SET reminder_overdue_sent_at = now() WHERE id = rec.id;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. process_meeting_reminders()
--    Notifica todos os participantes 1 h antes do início da reunião.
--    Janela de 50–70 min → compatível com schedule a cada 15 min.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.process_meeting_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec     RECORD;
  att     RECORD;
  v_count integer := 0;
BEGIN
  FOR rec IN
    SELECT ce.id, ce.organization_id, ce.title, ce.starts_at
    FROM   calendar_events ce
    WHERE  ce.deleted_at IS NULL
      AND  ce.status NOT IN ('cancelled', 'completed')
      AND  ce.starts_at BETWEEN now() + INTERVAL '50 minutes'
                            AND now() + INTERVAL '70 minutes'
      AND  ce.reminder_1h_sent_at IS NULL
  LOOP
    FOR att IN
      SELECT user_id
      FROM   calendar_event_attendees
      WHERE  event_id = rec.id
        AND  user_id IS NOT NULL
    LOOP
      INSERT INTO notifications
        (organization_id, recipient_user_id, type, title, body, link_url)
      VALUES
        (rec.organization_id, att.user_id,
         'meeting_reminder', 'Reunião em 1 hora', rec.title,
         '/reunioes?event=' || rec.id);
      v_count := v_count + 1;
    END LOOP;

    UPDATE calendar_events SET reminder_1h_sent_at = now() WHERE id = rec.id;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Agendamentos pg_cron
--    pg_cron está disponível por padrão em projetos Supabase (Dedicated Compute).
--    Em Free/Pro tier pode ser necessário habilitar via Dashboard → Extensions.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- Remove jobs anteriores (idempotente)
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'task-due-reminders') THEN
    PERFORM cron.unschedule('task-due-reminders');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'meeting-reminders') THEN
    PERFORM cron.unschedule('meeting-reminders');
  END IF;
EXCEPTION
  -- Se pg_cron não estiver habilitado, apenas loga e segue (não bloqueia a migration)
  WHEN undefined_table THEN
    RAISE NOTICE 'pg_cron não disponível — ative a extensão no Dashboard do Supabase e re-execute o bloco DO abaixo manualmente.';
  WHEN others THEN
    RAISE NOTICE 'Erro ao acessar cron.job: %', SQLERRM;
END;
$$;

DO $outer$
BEGIN
  -- Tarefas: a cada hora no minuto :00
  PERFORM cron.schedule(
    'task-due-reminders',
    '0 * * * *',
    'SELECT process_task_reminders()'
  );

  -- Reuniões: a cada 15 min (janela 50–70 min garante cobertura)
  PERFORM cron.schedule(
    'meeting-reminders',
    '*/15 * * * *',
    'SELECT process_meeting_reminders()'
  );

  RAISE NOTICE 'Cron jobs registrados: task-due-reminders (horário) e meeting-reminders (a cada 15 min)';
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'pg_cron indisponível. Habilite via Dashboard → Extensions e execute:';
    RAISE NOTICE 'SELECT cron.schedule(''task-due-reminders'', ''0 * * * *'', ''SELECT process_task_reminders()'');';
    RAISE NOTICE 'SELECT cron.schedule(''meeting-reminders'', ''*/15 * * * *'', ''SELECT process_meeting_reminders()'');';
  WHEN others THEN
    RAISE NOTICE 'Erro ao agendar: %', SQLERRM;
END;
$outer$;

COMMIT;
