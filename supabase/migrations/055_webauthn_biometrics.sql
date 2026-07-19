-- ============================================================
-- BIOMETRIA WEB (WebAuthn) + leitura de cronograma pelo colaborador
-- Migration: 055_webauthn_biometrics
-- Date:      2026-07-19
-- Purpose:   Face ID/Touch ID no Portal de Ponto Web via WebAuthn
--            (autenticador de plataforma). Guardamos apenas a CHAVE
--            PÚBLICA da credencial — nunca biometria (LGPD/spec §13).
--            1) webauthn_credentials — credenciais registradas por pessoa.
--            2) webauthn_challenges — desafios efêmeros (registro/auth).
--            3) política extra em project_timeline_items: colaborador
--               alocado no projeto pode LER as etapas (para apontar em
--               qual etapa do cronograma está trabalhando).
-- Dependencies:
--   005 (helpers), 038 (people, current_user_person_id())
--   032 (project_timeline_items), 041 (project_allocations)
-- NOTE: Idempotente, transação única, RLS 030-safe.
-- ============================================================

BEGIN;

-- ============================================================
-- 1) webauthn_credentials
-- ============================================================
CREATE TABLE IF NOT EXISTS public.webauthn_credentials (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  person_id         uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id     text NOT NULL,                    -- base64url
  public_key        text NOT NULL,                    -- base64url (COSE)
  counter           bigint NOT NULL DEFAULT 0,
  transports        text[],
  device_label      text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_used_at      timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS webauthn_credentials_credid_idx
  ON public.webauthn_credentials (credential_id);
CREATE INDEX IF NOT EXISTS webauthn_credentials_person_idx
  ON public.webauthn_credentials (organization_id, person_id);

-- ============================================================
-- 2) webauthn_challenges (efêmeros)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.webauthn_challenges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  challenge    text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('registration','authentication')),
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webauthn_challenges_user_idx
  ON public.webauthn_challenges (user_id, kind, created_at DESC);

-- ============================================================
-- 3) RLS — dono (pessoa/usuário) gere as próprias credenciais/desafios
-- ============================================================
ALTER TABLE public.webauthn_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webauthn_challenges  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webauthn_credentials_all ON public.webauthn_credentials;
CREATE POLICY webauthn_credentials_all ON public.webauthn_credentials
FOR ALL TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (person_id = current_user_person_id() OR current_user_is_admin())
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (person_id = current_user_person_id() OR current_user_is_admin())
);

DROP POLICY IF EXISTS webauthn_challenges_all ON public.webauthn_challenges;
CREATE POLICY webauthn_challenges_all ON public.webauthn_challenges
FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 4) Colaborador alocado pode LER as etapas do cronograma do projeto
--    (subquery em OUTRA tabela — 030-safe; não expõe outros projetos)
-- ============================================================
DROP POLICY IF EXISTS project_timeline_items_worker_select ON public.project_timeline_items;
CREATE POLICY project_timeline_items_worker_select ON public.project_timeline_items
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND EXISTS (
    SELECT 1 FROM public.project_allocations a
    WHERE a.project_id = project_timeline_items.project_id
      AND a.person_id = current_user_person_id()
      AND a.status IN ('active','pending_approval')
  )
);

COMMIT;

-- ============================================================
-- ROLLBACK (manual):
--   DROP POLICY IF EXISTS project_timeline_items_worker_select ON project_timeline_items;
--   DROP TABLE IF EXISTS webauthn_challenges, webauthn_credentials;
-- ============================================================
