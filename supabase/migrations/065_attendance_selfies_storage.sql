-- ============================================================
-- INSIGHT PONTO — selfie evidence storage (portal web)
-- Migration: 065_attendance_selfies_storage
--
-- No portal web (ponto.insightapex.co) o colaborador não tem Face ID /
-- Touch ID do aparelho (WebAuthn) garantido, então a prova de presença é
-- uma SELFIE tirada no momento da marcação. A foto é gravada num bucket
-- PRIVADO e referenciada por uma linha de authentication_evidence
-- (method = 'facial_verification'), exatamente o mesmo caminho que a
-- marcação já consome (attendance_punches.authentication_evidence_id).
--
-- Path convention (isolamento por tenant + pessoa):
--   {organization_id}/{person_id}/{timestamp}-{uuid}.jpg
--
-- O upload é feito pela API (service role, que ignora RLS); as políticas
-- abaixo protegem qualquer acesso direto do cliente.
-- ============================================================
BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('attendance-selfies', 'attendance-selfies', false, 5242880) -- 5 MB
ON CONFLICT (id) DO UPDATE
SET public = false, file_size_limit = EXCLUDED.file_size_limit;

-- ── INSERT: o próprio colaborador (org + person no path) com permissão
--    de uso do ponto; gestores/admin também podem gravar. ─────────────
DROP POLICY IF EXISTS attendance_selfies_insert ON storage.objects;
CREATE POLICY attendance_selfies_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'attendance-selfies'
  AND split_part(name, '/', 1) = current_user_organization_id()::text
  AND (
       (split_part(name, '/', 2) = current_user_person_id()::text
        AND current_user_has_permission('people.attendance_use'))
    OR current_user_has_permission('people.attendance_manage')
    OR current_user_is_admin()
  )
);

-- ── READ: a própria selfie, ou quem administra/audita o ponto. ───────
DROP POLICY IF EXISTS attendance_selfies_read ON storage.objects;
CREATE POLICY attendance_selfies_read ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'attendance-selfies'
  AND split_part(name, '/', 1) = current_user_organization_id()::text
  AND (
       split_part(name, '/', 2) = current_user_person_id()::text
    OR current_user_has_permission('people.attendance_view')
    OR current_user_has_permission('people.attendance_manage')
    OR current_user_is_admin()
  )
);

-- ── DELETE: apenas gestores/admin (marcações são imutáveis; a prova
--    também). ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS attendance_selfies_delete ON storage.objects;
CREATE POLICY attendance_selfies_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'attendance-selfies'
  AND split_part(name, '/', 1) = current_user_organization_id()::text
  AND (
       current_user_has_permission('people.attendance_manage')
    OR current_user_is_admin()
  )
);

COMMIT;

-- ============================================================
-- Rollback (manual):
--   DROP POLICY IF EXISTS attendance_selfies_insert ON storage.objects;
--   DROP POLICY IF EXISTS attendance_selfies_read   ON storage.objects;
--   DROP POLICY IF EXISTS attendance_selfies_delete ON storage.objects;
--   DELETE FROM storage.buckets WHERE id = 'attendance-selfies';
-- ============================================================
