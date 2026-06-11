-- ============================================================
-- AGENDA & TAREFAS — Enterprise upgrade
-- Migration: 031_agenda_enterprise
-- Date:      2026-06-10
-- Purpose:   Elevar o módulo Agenda & Tarefas a um command center
--            corporativo:
--              1) Vínculos cross-module (projetos, contratos, riscos,
--                 deliberações, comitês, financeiro, fechamento de folha)
--                 em tasks e calendar_events — inclui correção do tipo
--                 de related_project_id (uuid → text; projects.id é TEXT).
--              2) Novos status de tarefa: waiting | blocked.
--              3) task_comments (thread de comentários).
--              4) Dependência simples entre tarefas (blocked_by_task_id).
--              5) Recorrência (freq/interval/until) — materialização da
--                 próxima ocorrência acontece no client (completeTask),
--                 sem cron: apenas a próxima ocorrência fica visível no
--                 calendário; trade-off documentado e aceito.
--              6) Anexos (bucket agenda-attachments + agenda_attachments).
--              7) Lembretes configuráveis por item (reminder_offsets +
--                 reminder_log) — process_task_reminders() e
--                 process_meeting_reminders() são SUBSTITUÍDAS via
--                 CREATE OR REPLACE com a MESMA assinatura, então os
--                 jobs pg_cron de 028b continuam válidos (não tocar).
--              8) RPC list_entity_email_dispatches() para o drawer de
--                 reunião exibir o status de envio sem exigir audit.view.
-- Dependencies: 026, 027, 028b, 029, 030 (aplicadas).
-- NOTE: Idempotente. Transação única. NUNCA editar migrations 026-030.
--       Cuidado com o gotcha de 030: policies de SELECT de tabelas novas
--       jamais fazem self-SELECT (INSERT...RETURNING-safe).
-- ============================================================

BEGIN;

-- ============================================================
-- 1) Vínculos cross-module + correção de tipo do project id
-- ============================================================

-- projects.id é TEXT (004); as colunas nasceram uuid em 026 e nunca
-- foram escritas — retipar é seguro e necessário antes do FK.
ALTER TABLE public.tasks
  ALTER COLUMN related_project_id TYPE text USING related_project_id::text;
ALTER TABLE public.calendar_events
  ALTER COLUMN related_project_id TYPE text USING related_project_id::text;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS related_risk_id          uuid REFERENCES risks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS related_deliberation_id  uuid REFERENCES deliberations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS related_committee_id     uuid REFERENCES committees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS related_finance_item_id  uuid REFERENCES ledger_entry(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS related_payroll_batch_id uuid REFERENCES payroll_closing_batches(id) ON DELETE SET NULL;

ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS related_risk_id          uuid REFERENCES risks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS related_deliberation_id  uuid REFERENCES deliberations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS related_finance_item_id  uuid REFERENCES ledger_entry(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS related_payroll_batch_id uuid REFERENCES payroll_closing_batches(id) ON DELETE SET NULL;

-- FKs para colunas pré-existentes (026 não os criou): guardados por
-- DO-block porque ADD CONSTRAINT não tem IF NOT EXISTS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_related_project_fk') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_related_project_fk
      FOREIGN KEY (related_project_id) REFERENCES projects(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_related_contract_fk') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_related_contract_fk
      FOREIGN KEY (related_contract_id) REFERENCES contracts(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_events_related_project_fk') THEN
    ALTER TABLE public.calendar_events
      ADD CONSTRAINT calendar_events_related_project_fk
      FOREIGN KEY (related_project_id) REFERENCES projects(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_events_related_contract_fk') THEN
    ALTER TABLE public.calendar_events
      ADD CONSTRAINT calendar_events_related_contract_fk
      FOREIGN KEY (related_contract_id) REFERENCES contracts(id) ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS tasks_related_risk_idx
  ON public.tasks (organization_id, related_risk_id)
  WHERE related_risk_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_related_deliberation_idx
  ON public.tasks (organization_id, related_deliberation_id)
  WHERE related_deliberation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS calendar_events_related_risk_idx
  ON public.calendar_events (organization_id, related_risk_id)
  WHERE related_risk_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS calendar_events_related_deliberation_idx
  ON public.calendar_events (organization_id, related_deliberation_id)
  WHERE related_deliberation_id IS NOT NULL;

-- ============================================================
-- 2) Status de tarefa: + waiting (Aguardando terceiros) + blocked
--    O CHECK inline de 026 foi auto-nomeado tasks_status_check;
--    fallback localiza pelo conteúdo caso o nome difira.
-- ============================================================
DO $$
DECLARE
  v_name text;
BEGIN
  SELECT conname INTO v_name
  FROM pg_constraint
  WHERE conrelid = 'public.tasks'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%in%'
    AND pg_get_constraintdef(oid) NOT ILIKE '%waiting%'
  LIMIT 1;

  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.tasks DROP CONSTRAINT %I', v_name);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tasks'::regclass
      AND conname = 'tasks_status_check'
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_status_check
      CHECK (status IN ('todo','in_progress','waiting','blocked','done','cancelled'));
  END IF;
END;
$$;

-- ============================================================
-- 3) task_comments — thread de comentários da tarefa.
--    RLS copia o idioma do checklist (026): EXISTS unidirecional em
--    tasks; sem self-SELECT (RETURNING-safe).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.task_comments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id           uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  author_user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  body              text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_comments_task_idx
  ON public.task_comments (task_id, created_at);

ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_comments_select ON public.task_comments;
CREATE POLICY task_comments_select ON public.task_comments
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND EXISTS (
    SELECT 1 FROM tasks t
    WHERE t.id = task_comments.task_id
      AND (
           t.creator_user_id = auth.uid()
        OR t.assignee_user_id = auth.uid()
        OR current_user_has_permission('tasks.admin')
        OR current_user_is_admin()
      )
  )
);

DROP POLICY IF EXISTS task_comments_insert ON public.task_comments;
CREATE POLICY task_comments_insert ON public.task_comments
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND author_user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM tasks t
    WHERE t.id = task_comments.task_id
      AND (
           t.creator_user_id = auth.uid()
        OR t.assignee_user_id = auth.uid()
        OR current_user_has_permission('tasks.admin')
        OR current_user_is_admin()
      )
  )
);

DROP POLICY IF EXISTS task_comments_delete ON public.task_comments;
CREATE POLICY task_comments_delete ON public.task_comments
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (author_user_id = auth.uid() OR current_user_is_admin())
);

-- ============================================================
-- 4) Dependência simples: tarefa bloqueada por outra tarefa.
-- ============================================================
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS blocked_by_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_no_self_dependency') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_no_self_dependency
      CHECK (blocked_by_task_id IS DISTINCT FROM id);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS tasks_blocked_by_idx
  ON public.tasks (organization_id, blocked_by_task_id)
  WHERE blocked_by_task_id IS NOT NULL;

-- ============================================================
-- 5) Recorrência (materialização client-side em completeTask)
-- ============================================================
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS recurrence_freq text
    CHECK (recurrence_freq IS NULL OR recurrence_freq IN ('daily','weekly','monthly')),
  ADD COLUMN IF NOT EXISTS recurrence_interval integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS recurrence_until timestamptz;

-- ============================================================
-- 6) Anexos — bucket privado + tabela polimórfica (task | event).
--    Path: {organization_id}/{entity_type}/{entity_id}/{uuid}-{nome}
--    Mesmo padrão de contract-files (006) / payroll (019).
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'agenda-attachments',
  'agenda-attachments',
  false,
  52428800,
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png',
    'image/jpeg',
    'text/plain',
    'text/csv'
  ]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE IF NOT EXISTS public.agenda_attachments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  entity_type       text NOT NULL CHECK (entity_type IN ('task','event')),
  entity_id         uuid NOT NULL,
  file_name         text NOT NULL,
  file_path         text NOT NULL UNIQUE,
  file_size         bigint,
  content_type      text,
  uploaded_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agenda_attachments_entity_idx
  ON public.agenda_attachments (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS agenda_attachments_org_idx
  ON public.agenda_attachments (organization_id, created_at DESC);

ALTER TABLE public.agenda_attachments ENABLE ROW LEVEL SECURITY;

-- SELECT: evento via helper SECURITY DEFINER (sem recursão);
-- tarefa via EXISTS unidirecional em tasks (idioma do checklist).
DROP POLICY IF EXISTS agenda_attachments_select ON public.agenda_attachments;
CREATE POLICY agenda_attachments_select ON public.agenda_attachments
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
    (entity_type = 'event' AND user_can_access_event(entity_id))
    OR (entity_type = 'task' AND EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = agenda_attachments.entity_id
        AND (
             t.creator_user_id = auth.uid()
          OR t.assignee_user_id = auth.uid()
          OR current_user_has_permission('tasks.admin')
          OR current_user_is_admin()
        )
    ))
  )
);

DROP POLICY IF EXISTS agenda_attachments_insert ON public.agenda_attachments;
CREATE POLICY agenda_attachments_insert ON public.agenda_attachments
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND uploaded_by = auth.uid()
  AND (
    (entity_type = 'event' AND user_can_manage_event(entity_id))
    OR (entity_type = 'task' AND EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = agenda_attachments.entity_id
        AND (
             t.creator_user_id = auth.uid()
          OR t.assignee_user_id = auth.uid()
          OR current_user_has_permission('tasks.edit')
          OR current_user_has_permission('tasks.admin')
          OR current_user_is_admin()
        )
    ))
  )
);

DROP POLICY IF EXISTS agenda_attachments_delete ON public.agenda_attachments;
CREATE POLICY agenda_attachments_delete ON public.agenda_attachments
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       uploaded_by = auth.uid()
    OR current_user_is_admin()
    OR (entity_type = 'event' AND user_can_manage_event(entity_id))
    OR (entity_type = 'task' AND EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = agenda_attachments.entity_id
        AND (
             t.creator_user_id = auth.uid()
          OR current_user_has_permission('tasks.admin')
        )
    ))
  )
);

-- Storage: leitura herda a visibilidade da linha em agenda_attachments
-- (RLS da tabela aplica no sub-SELECT — mesmo truque de contract-files).
DROP POLICY IF EXISTS agenda_attachments_storage_read ON storage.objects;
CREATE POLICY agenda_attachments_storage_read
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'agenda-attachments'
  AND EXISTS (
    SELECT 1 FROM agenda_attachments aa
    WHERE aa.file_path = storage.objects.name
      AND aa.organization_id = current_user_organization_id()
  )
);

DROP POLICY IF EXISTS agenda_attachments_storage_insert ON storage.objects;
CREATE POLICY agenda_attachments_storage_insert
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'agenda-attachments'
  AND split_part(name, '/', 1) = current_user_organization_id()::text
  AND (
       current_user_is_admin()
    OR current_user_has_permission('meetings.create')
    OR current_user_has_permission('tasks.create')
  )
);

DROP POLICY IF EXISTS agenda_attachments_storage_delete ON storage.objects;
CREATE POLICY agenda_attachments_storage_delete
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'agenda-attachments'
  AND split_part(name, '/', 1) = current_user_organization_id()::text
  AND (
       current_user_is_admin()
    OR current_user_has_permission('meetings.create')
    OR current_user_has_permission('tasks.create')
  )
);

-- ============================================================
-- 7) Lembretes configuráveis por item.
--    reminder_offsets NULL  → comportamento legado:
--      tasks    ['1d','overdue']   |   meetings ['1h']
--    Tokens válidos:
--      tasks    '3d' | '1d' | 'at_due' | 'overdue'
--      meetings '1d' | '3h' | '1h' | '15m'
--    reminder_log registra {token: timestamp} → idempotência por token.
--    Dual-check com as colunas legadas (*_sent_at) impede refire em
--    linhas já lembradas antes desta migration.
-- ============================================================
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS reminder_offsets jsonb,
  ADD COLUMN IF NOT EXISTS reminder_log jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS reminder_offsets jsonb,
  ADD COLUMN IF NOT EXISTS reminder_log jsonb NOT NULL DEFAULT '{}'::jsonb;

-- MESMO nome/assinatura/retorno de 028b: os jobs pg_cron
-- task-due-reminders e meeting-reminders continuam apontando para cá.
CREATE OR REPLACE FUNCTION public.process_task_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec       RECORD;
  v_token   text;
  v_fire    boolean;
  v_title   text;
  v_body    text;
  v_count   integer := 0;
BEGIN
  FOR rec IN
    SELECT id, organization_id, title, assignee_user_id, creator_user_id,
           due_at, status, reminder_log,
           reminder_1d_sent_at, reminder_overdue_sent_at,
           COALESCE(reminder_offsets, '["1d","overdue"]'::jsonb) AS offsets
    FROM   tasks
    WHERE  deleted_at IS NULL
      AND  status NOT IN ('done', 'cancelled')
      AND  due_at IS NOT NULL
      AND  due_at <= now() + INTERVAL '72 hours'
  LOOP
    FOR v_token IN SELECT jsonb_array_elements_text(rec.offsets)
    LOOP
      -- idempotência: token já disparado OU coluna legada marcada
      CONTINUE WHEN rec.reminder_log ? v_token;
      CONTINUE WHEN v_token = '1d'      AND rec.reminder_1d_sent_at IS NOT NULL;
      CONTINUE WHEN v_token = 'overdue' AND rec.reminder_overdue_sent_at IS NOT NULL;
      -- tarefa bloqueada: lembrete de "vence em breve" é ruído;
      -- apenas o alerta de atraso dispara.
      CONTINUE WHEN rec.status = 'blocked' AND v_token <> 'overdue';

      v_fire := false;
      IF v_token = '3d' AND rec.due_at > now() AND rec.due_at <= now() + INTERVAL '72 hours' THEN
        v_fire := true; v_title := 'Vence em 3 dias'; v_body := rec.title;
      ELSIF v_token = '1d' AND rec.due_at > now() AND rec.due_at <= now() + INTERVAL '24 hours' THEN
        v_fire := true; v_title := 'Vence em 24 h'; v_body := rec.title;
      ELSIF v_token = 'at_due' AND rec.due_at <= now() THEN
        v_fire := true; v_title := 'Prazo vencendo agora'; v_body := rec.title;
      ELSIF v_token = 'overdue' AND rec.due_at < now() THEN
        v_fire := true; v_title := 'Tarefa atrasada'; v_body := rec.title || ' — prazo encerrado';
      END IF;

      CONTINUE WHEN NOT v_fire;

      IF rec.assignee_user_id IS NOT NULL THEN
        INSERT INTO notifications
          (organization_id, recipient_user_id, type, title, body, link_url)
        VALUES
          (rec.organization_id, rec.assignee_user_id,
           CASE WHEN v_token = 'overdue' THEN 'task_overdue' ELSE 'task_reminder' END,
           v_title, v_body, '/reunioes?task=' || rec.id);
        v_count := v_count + 1;
      END IF;

      IF rec.creator_user_id IS NOT NULL
         AND rec.creator_user_id IS DISTINCT FROM rec.assignee_user_id THEN
        INSERT INTO notifications
          (organization_id, recipient_user_id, type, title, body, link_url)
        VALUES
          (rec.organization_id, rec.creator_user_id,
           CASE WHEN v_token = 'overdue' THEN 'task_overdue' ELSE 'task_reminder' END,
           v_title, v_body, '/reunioes?task=' || rec.id);
        v_count := v_count + 1;
      END IF;

      UPDATE tasks
      SET reminder_log = reminder_log || jsonb_build_object(v_token, now()),
          reminder_1d_sent_at      = CASE WHEN v_token = '1d'      THEN now() ELSE reminder_1d_sent_at END,
          reminder_overdue_sent_at = CASE WHEN v_token = 'overdue' THEN now() ELSE reminder_overdue_sent_at END
      WHERE id = rec.id;
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_meeting_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec       RECORD;
  att       RECORD;
  v_token   text;
  v_fire    boolean;
  v_title   text;
  v_count   integer := 0;
BEGIN
  FOR rec IN
    SELECT ce.id, ce.organization_id, ce.title, ce.starts_at, ce.reminder_log,
           ce.reminder_1h_sent_at,
           COALESCE(ce.reminder_offsets, '["1h"]'::jsonb) AS offsets
    FROM   calendar_events ce
    WHERE  ce.deleted_at IS NULL
      AND  ce.status NOT IN ('cancelled', 'completed')
      AND  ce.starts_at BETWEEN now() - INTERVAL '10 minutes'
                            AND now() + INTERVAL '24 hours'
  LOOP
    FOR v_token IN SELECT jsonb_array_elements_text(rec.offsets)
    LOOP
      CONTINUE WHEN rec.reminder_log ? v_token;
      CONTINUE WHEN v_token = '1h' AND rec.reminder_1h_sent_at IS NOT NULL;

      -- janela inferior de -10 min cobre o intervalo do cron (15 min)
      v_fire := false;
      IF v_token = '1d' AND rec.starts_at <= now() + INTERVAL '24 hours' THEN
        v_fire := true; v_title := 'Reunião em 24 horas';
      ELSIF v_token = '3h' AND rec.starts_at <= now() + INTERVAL '3 hours' THEN
        v_fire := true; v_title := 'Reunião em 3 horas';
      ELSIF v_token = '1h' AND rec.starts_at <= now() + INTERVAL '70 minutes' THEN
        v_fire := true; v_title := 'Reunião em 1 hora';
      ELSIF v_token = '15m' AND rec.starts_at <= now() + INTERVAL '15 minutes' THEN
        v_fire := true; v_title := 'Reunião em 15 minutos';
      END IF;

      CONTINUE WHEN NOT v_fire;

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
           'meeting_reminder', v_title, rec.title,
           '/reunioes?event=' || rec.id);
        v_count := v_count + 1;
      END LOOP;

      UPDATE calendar_events
      SET reminder_log = reminder_log || jsonb_build_object(v_token, now()),
          reminder_1h_sent_at = CASE WHEN v_token = '1h' THEN now() ELSE reminder_1h_sent_at END
      WHERE id = rec.id;
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ============================================================
-- 8) list_entity_email_dispatches() — status de envio para quem pode
--    ver a entidade (a policy de email_dispatches exige audit.view;
--    organizador/participante precisam ver o status no drawer).
-- ============================================================
CREATE OR REPLACE FUNCTION public.list_entity_email_dispatches(
  p_entity_type text,
  p_entity_id   uuid
)
RETURNS TABLE (
  target_email  text,
  subject       text,
  status        text,
  error_message text,
  created_at    timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_entity_type = 'calendar_event' THEN
    IF NOT user_can_access_event(p_entity_id) THEN
      RETURN;
    END IF;
  ELSIF p_entity_type = 'task' THEN
    IF NOT EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = p_entity_id
        AND t.organization_id = current_user_organization_id()
        AND (
             t.creator_user_id = auth.uid()
          OR t.assignee_user_id = auth.uid()
          OR current_user_has_permission('tasks.admin')
          OR current_user_is_admin()
        )
    ) THEN
      RETURN;
    END IF;
  ELSE
    RETURN;
  END IF;

  RETURN QUERY
  SELECT d.target_email, d.subject, d.status, d.error_message, d.created_at
  FROM email_dispatches d
  WHERE d.organization_id = current_user_organization_id()
    AND d.related_entity_type = p_entity_type
    AND d.related_entity_id = p_entity_id
  ORDER BY d.created_at DESC
  LIMIT 100;
END;
$$;

REVOKE ALL ON FUNCTION public.list_entity_email_dispatches(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_entity_email_dispatches(text, uuid) TO authenticated;

COMMIT;

-- ============================================================
-- 9) Verificação manual (staging)
--    1. Rodar a migration 2x → no-op (idempotente).
--    2. \d tasks → novos campos; constraint inclui waiting/blocked.
--    3. SELECT * FROM cron.job → task-due-reminders e meeting-reminders
--       continuam agendados (028b intactos).
--    4. SELECT process_task_reminders() → tasks com reminder_offsets
--       custom disparam pelos tokens escolhidos; linhas legadas com
--       reminder_1d_sent_at preenchido NÃO refiram.
--    5. INSERT task com related_project_id de um projeto existente
--       (text) → ok; id inexistente → FK error.
--    6. Como usuário B (não participante): task_comments e
--       agenda_attachments de tarefa alheia → 0 rows.
--    7. list_entity_email_dispatches('calendar_event', <id>) como
--       participante sem audit.view → retorna os envios.
-- ============================================================
