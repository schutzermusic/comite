-- ============================================================
-- INSIGHT PONTO — attendance review audit trail
-- Migration: 068_attendance_review
--
-- Marcações fora do geofence / com falha de auth entram como
-- 'under_review' (ADR-008). A resolução é um UPDATE de status (accepted /
-- cancelled) por quem tem people.attendance_manage — a política de UPDATE
-- já existe (045). Aqui adicionamos apenas a TRILHA de auditoria da
-- revisão (quem, quando, por quê), sem mudar a imutabilidade do evento.
-- ============================================================
BEGIN;

ALTER TABLE public.attendance_punches
  ADD COLUMN IF NOT EXISTS reviewed_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS review_note  text;

COMMIT;

-- ============================================================
-- Rollback (manual):
--   ALTER TABLE attendance_punches
--     DROP COLUMN IF EXISTS reviewed_by,
--     DROP COLUMN IF EXISTS reviewed_at,
--     DROP COLUMN IF EXISTS review_note;
-- ============================================================
