-- ============================================================
-- INSIGHT PONTO — employee access (invitation lifecycle)
-- Migration: 066_ponto_access
--
-- Dá ao cadastro de pessoa (people) o estado de ACESSO ao app de Ponto.
-- O vínculo de login continua sendo people.profile_id -> profiles.id ->
-- auth.users (não duplicamos identidade). Aqui guardamos apenas o que NÃO
-- é derivável do auth.users:
--
--   access_invited_at   -> quando o último convite foi enviado
--                          (base para expiração exibida + rate-limit)
--   access_invite_count -> nº de convites enviados (telemetria/auditoria)
--   access_blocked      -> bloqueio administrativo do acesso
--   access_blocked_at / access_blocked_by
--
-- O STATUS efetivo (Sem acesso / Convite pendente / Ativo / Convite
-- expirado / Acesso bloqueado) é COMPUTADO no servidor combinando estas
-- colunas com auth.users (email_confirmed_at, banned_until), lidos via
-- service role — nunca expostos por RLS ao cliente.
--
-- Cria ainda a role de sistema `ponto_field_worker`, que concede APENAS
-- `people.attendance_use` (bater o próprio ponto) — princípio do menor
-- privilégio para o colaborador de campo.
-- ============================================================
BEGIN;

-- 1) colunas de acesso no cadastro de pessoa ----------------------------
ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS access_invited_at   timestamptz,
  ADD COLUMN IF NOT EXISTS access_invite_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS access_blocked      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS access_blocked_at   timestamptz,
  ADD COLUMN IF NOT EXISTS access_blocked_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2) role de sistema do colaborador de campo ----------------------------
INSERT INTO public.roles (organization_id, key, name, description, is_system_role)
VALUES (NULL, 'ponto_field_worker', 'Ponto — Colaborador de Campo',
        'Acesso restrito ao app de Ponto: registrar apenas o próprio ponto.', true)
ON CONFLICT (key) WHERE organization_id IS NULL DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_system_role = true;

-- concede SOMENTE people.attendance_use (semeada em 046) ----------------
WITH r AS (
  SELECT id FROM public.roles WHERE key = 'ponto_field_worker' AND organization_id IS NULL
),
p AS (
  SELECT id FROM public.permissions WHERE key = 'people.attendance_use'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

COMMIT;

-- ============================================================
-- Rollback (manual):
--   DELETE FROM role_permissions WHERE role_id =
--     (SELECT id FROM roles WHERE key='ponto_field_worker' AND organization_id IS NULL);
--   DELETE FROM roles WHERE key='ponto_field_worker' AND organization_id IS NULL;
--   ALTER TABLE people
--     DROP COLUMN IF EXISTS access_invited_at, DROP COLUMN IF EXISTS access_invite_count,
--     DROP COLUMN IF EXISTS access_blocked, DROP COLUMN IF EXISTS access_blocked_at,
--     DROP COLUMN IF EXISTS access_blocked_by;
-- ============================================================
