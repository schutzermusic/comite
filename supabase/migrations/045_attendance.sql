-- ============================================================
-- JORNADA — Attendance punches (registro de ponto)
-- Migration: 045_attendance
-- Date:      2026-07-15
-- Purpose:   Fase 5 (spec §4, §6.3, ADR-002/005):
--            attendance_punches — eventos de jornada (entrada,
--            intervalo, retorno, saída). Domínio SEPARADO do
--            apontamento por projeto (time_entries): jornada mede
--            cumprimento de horário; apontamento mede onde o tempo
--            foi aplicado. Conciliáveis, nunca confundidos.
--            Eventos são IMUTÁVEIS (ADR-005): correções criam um
--            novo punch ligado ao original; nada é sobrescrito.
--            Banco de horas, HE e adicional noturno são DERIVADOS
--            no serviço (weekly_hours/5 = jornada diária esperada).
-- Dependencies:
--   005 (helpers, set_updated_at())
--   038 (people, current_user_person_id())
--   046_attendance_perm_seeds (RBAC — data only)
-- NOTE: Idempotent, single transaction, RLS 030-safe (no self-SELECT).
--       DB permissivo quanto à ordem (imports podem chegar fora de
--       ordem); a validação de sequência é guiada pelo serviço.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.attendance_punches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  person_id          uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,

  type               text NOT NULL
                       CHECK (type IN ('clock_in','break_start','break_end','clock_out')),
  occurred_at        timestamptz NOT NULL,
  received_at        timestamptz NOT NULL DEFAULT now(),
  timezone           text NOT NULL DEFAULT 'America/Sao_Paulo',

  source             text NOT NULL DEFAULT 'web'
                       CHECK (source IN ('web','mobile','import','manager_adjustment')),
  status             text NOT NULL DEFAULT 'accepted'
                       CHECK (status IN ('accepted','under_review','corrected','cancelled')),

  -- correction/immutability chain (ADR-005)
  original_punch_id  uuid REFERENCES attendance_punches(id) ON DELETE SET NULL,
  correction_reason  text,
  corrected_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- idempotency for future mobile/offline sync (Fase 4)
  client_event_id    text,
  notes              text,

  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- idempotent mobile sync guard (partial: only when client_event_id set)
CREATE UNIQUE INDEX IF NOT EXISTS attendance_client_event_idx
  ON public.attendance_punches (organization_id, person_id, client_event_id)
  WHERE client_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS attendance_person_time_idx
  ON public.attendance_punches (organization_id, person_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS attendance_org_time_idx
  ON public.attendance_punches (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS attendance_review_idx
  ON public.attendance_punches (organization_id, status)
  WHERE status = 'under_review';

DROP TRIGGER IF EXISTS trg_attendance_updated_at ON public.attendance_punches;
CREATE TRIGGER trg_attendance_updated_at
BEFORE UPDATE ON public.attendance_punches
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- Row Level Security
--   Owner registra o próprio ponto (people.attendance_use).
--   Leitura ampla com people.attendance_view; correções/status por
--   people.attendance_manage. Sem self-SELECT (030-safe): a posse usa
--   o helper SECURITY DEFINER current_user_person_id() (tabela people).
-- ============================================================
ALTER TABLE public.attendance_punches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attendance_select ON public.attendance_punches;
CREATE POLICY attendance_select ON public.attendance_punches
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       person_id = current_user_person_id()
    OR current_user_has_permission('people.attendance_view')
    OR current_user_has_permission('people.attendance_manage')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS attendance_insert ON public.attendance_punches;
CREATE POLICY attendance_insert ON public.attendance_punches
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
       -- own punch
       (person_id = current_user_person_id()
        AND current_user_has_permission('people.attendance_use'))
       -- import / correction / adjustment on behalf of others
    OR current_user_has_permission('people.attendance_manage')
    OR current_user_is_admin()
  )
  AND (created_by IS NULL OR created_by = auth.uid())
);

-- Punches are immutable: only a manager may flip status
-- (corrected/cancelled/under_review). Owners never UPDATE — they
-- submit a correction as a NEW punch with original_punch_id set.
DROP POLICY IF EXISTS attendance_update ON public.attendance_punches;
CREATE POLICY attendance_update ON public.attendance_punches
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('people.attendance_manage') OR current_user_is_admin())
)
WITH CHECK (organization_id = current_user_organization_id());

DROP POLICY IF EXISTS attendance_delete ON public.attendance_punches;
CREATE POLICY attendance_delete ON public.attendance_punches
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('people.attendance_manage') OR current_user_is_admin())
);

COMMIT;

-- ============================================================
-- Manual verification checklist (staging)
--   1. Re-run -> no-op.
--   2. Owner with attendance_use: INSERT own clock_in ... RETURNING -> ok.
--   3. Owner UPDATE any punch -> denied.
--   4. Same client_event_id twice for a person -> unique violation (idempotent).
--   5. Manager: INSERT correction with original_punch_id + UPDATE original
--      status='corrected' -> both coexist (history preserved).
--
-- ROLLBACK (manual): DROP TABLE IF EXISTS attendance_punches;
-- ============================================================
