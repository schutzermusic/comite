-- ============================================================================
-- 242 — NOTIFICAÇÕES: INQUILINO NA RLS, CONTEÚDO IMUTÁVEL, LEITURA GOVERNADA
--
-- ─── Os defeitos (reproduzidos no QA isolado antes desta migration) ──────
--
--   1. A RLS de `notifications` (026) só olhava `recipient_user_id = auth.uid()`.
--      Quem pertence a DUAS organizações lia, com a organização A ativa, os
--      avisos da B — e o sino somava as duas.
--   2. A política de UPDATE deixava o destinatário reescrever QUALQUER coluna
--      da própria linha: título, corpo, link, tipo — e `organization_id`, isto
--      é, mover a linha para outra organização.
--   3. A política de DELETE apagava a linha: o histórico de entrega que outros
--      livros referenciam (faturamento guarda `notification_id`) sumia.
--   4. As portas de criação provavam o vínculo por `profiles.organization_id`
--      (a organização "de origem") e aceitavam qualquer link, inclusive
--      externo — um aviso interno podia levar para fora do produto.
--
-- ─── A correção ───────────────────────────────────────────────────────────
--
--   • SELECT: destinatário E organização ATIVA (`current_user_organization_id()`).
--   • O navegador não escreve na tabela: sem UPDATE/DELETE/INSERT para
--     `authenticated`/`anon`, nem por política nem por privilégio.
--   • A única mudança que o destinatário faz é GOVERNADA e estreita:
--       notification_mark_read(id)   read_at, uma vez
--       notification_mark_all_read() idem, só na organização ativa
--       notification_dismiss(id)     dismissed_at (arquivar) — a linha fica
--   • Link: nulo ou caminho RELATIVO do app ("/…", nunca "//…" nem esquema).
--     Uma CHECK torna isso estrutural para toda porta, inclusive os crons de
--     lembrete (026/031), que já gravam caminhos relativos. Links absolutos
--     antigos (gerados com a origem do navegador) viram o caminho que eram;
--     qualquer outra coisa vira nulo.
--   • As duas portas de criação exigem vínculo ATIVO na organização (a mesma
--     regra de `current_user_organization_id()` e dos avisos de Decisões).
-- ============================================================================

BEGIN;

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;

CREATE INDEX IF NOT EXISTS notifications_recipient_org_idx
  ON public.notifications (recipient_user_id, organization_id, created_at DESC);

-- Links legados: a origem absoluta que o navegador colava vira o caminho; o resto, nulo.
UPDATE public.notifications
   SET link_url = CASE
     WHEN link_url ~ '^https?://[^/?#]+(/.*)?$' THEN
       COALESCE(NULLIF(regexp_replace(link_url, '^https?://[^/?#]+', ''), ''), '/')
     ELSE NULL
   END
 WHERE link_url IS NOT NULL AND NOT (link_url ~ '^/([^/\\]|$)');
UPDATE public.notifications SET link_url = NULL
 WHERE link_url IS NOT NULL AND NOT (link_url ~ '^/([^/\\]|$)');

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_link_is_app_path;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_link_is_app_path
  CHECK (link_url IS NULL OR (link_url ~ '^/([^/\\]|$)' AND length(link_url) <= 2048));

-- ─── RLS: leitura no inquilino ativo; nenhuma escrita direta ─────────────
DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications
FOR SELECT TO authenticated
USING (recipient_user_id = auth.uid() AND organization_id = public.current_user_organization_id());

DROP POLICY IF EXISTS notifications_update ON public.notifications;
DROP POLICY IF EXISTS notifications_delete ON public.notifications;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.notifications FROM authenticated, anon;
REVOKE ALL ON public.notifications FROM anon;

-- ─── Vínculo ativo: a regra única das portas de criação ──────────────────
CREATE OR REPLACE FUNCTION public.notification_recipient_is_active_member(p_organization_id uuid, p_recipient uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_memberships om
      JOIN public.organizations o ON o.id = om.organization_id
     WHERE om.organization_id = p_organization_id AND om.user_id = p_recipient
       AND om.status = 'ACTIVE' AND o.status = 'active');
$$;
REVOKE ALL ON FUNCTION public.notification_recipient_is_active_member(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notification_link_is_app_path(p_link text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT p_link IS NULL OR (p_link ~ '^/([^/\\]|$)' AND length(p_link) <= 2048);
$$;

-- ─── Porta do NAVEGADOR (026): organização = a ATIVA de quem chama ───────
CREATE OR REPLACE FUNCTION public.create_notification(
  p_recipient uuid,
  p_type      text,
  p_title     text,
  p_body      text DEFAULT NULL,
  p_link      text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_id  uuid;
BEGIN
  v_org := public.current_user_organization_id();
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Usuário sem organização ativa' USING ERRCODE = '42501';
  END IF;
  IF p_recipient IS NULL OR NOT public.notification_recipient_is_active_member(v_org, p_recipient) THEN
    RAISE EXCEPTION 'Destinatário fora da organização' USING ERRCODE = 'check_violation';
  END IF;
  IF coalesce(btrim(p_title), '') = '' OR length(p_title) > 500 OR length(coalesce(p_body, '')) > 4000
     OR coalesce(p_type, '') !~ '^[a-z][a-z0-9_.]{1,63}$' THEN
    RAISE EXCEPTION 'NOTIFICATION_INVALID: tipo, título ou corpo fora do formato.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.notification_link_is_app_path(p_link) THEN
    RAISE EXCEPTION 'NOTIFICATION_LINK_NOT_APP_PATH: o link de um aviso é um caminho do app ("/…").'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.notifications (organization_id, recipient_user_id, type, title, body, link_url)
  VALUES (v_org, p_recipient, p_type, p_title, p_body, p_link)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_notification(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_notification(uuid, text, text, text, text) TO authenticated;

-- ─── Porta do SERVIDOR (195): organização por parâmetro, mesmas regras ──
CREATE OR REPLACE FUNCTION public.create_notification_for(
  p_organization_id uuid,
  p_recipient       uuid,
  p_type            text,
  p_title           text,
  p_body            text DEFAULT NULL,
  p_link            text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_organization_id IS NULL OR p_recipient IS NULL THEN
    RAISE EXCEPTION 'NOTIFICATION_TARGET_REQUIRED: organização e destinatário são obrigatórios.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF current_user IN ('authenticated','anon') THEN
    IF public.current_user_organization_id() IS DISTINCT FROM p_organization_id THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: notificação negada.' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NOT public.notification_recipient_is_active_member(p_organization_id, p_recipient) THEN
    RAISE EXCEPTION 'RECIPIENT_OUTSIDE_ORGANIZATION: destinatário não é membro ativo desta organização.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.notification_link_is_app_path(p_link) THEN
    RAISE EXCEPTION 'NOTIFICATION_LINK_NOT_APP_PATH: o link de um aviso é um caminho do app ("/…").'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.notifications
    (organization_id, recipient_user_id, type, title, body, link_url)
  VALUES (p_organization_id, p_recipient, p_type, p_title, p_body, p_link)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.create_notification_for(uuid, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;

-- ─── Ações GOVERNADAS do destinatário ────────────────────────────────────
-- Identidade = auth.uid(); inquilino = o ativo. Linha alheia, de outra
-- organização ou inexistente dá o mesmo `false`: nada a aprender por tentativa.
CREATE OR REPLACE FUNCTION public.notification_mark_read(p_notification_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_org uuid := public.current_user_organization_id();
  v_n   integer;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: sem sessão ou organização ativa.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.notifications SET read_at = now()
   WHERE id = p_notification_id AND recipient_user_id = auth.uid() AND organization_id = v_org AND read_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END $$;

CREATE OR REPLACE FUNCTION public.notification_mark_all_read()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_org uuid := public.current_user_organization_id();
  v_n   integer;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: sem sessão ou organização ativa.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.notifications SET read_at = now()
   WHERE recipient_user_id = auth.uid() AND organization_id = v_org AND read_at IS NULL AND dismissed_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION public.notification_dismiss(p_notification_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_org uuid := public.current_user_organization_id();
  v_n   integer;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: sem sessão ou organização ativa.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.notifications SET dismissed_at = now(), read_at = coalesce(read_at, now())
   WHERE id = p_notification_id AND recipient_user_id = auth.uid() AND organization_id = v_org AND dismissed_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END $$;

REVOKE ALL ON FUNCTION public.notification_mark_read(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.notification_mark_all_read() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.notification_dismiss(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notification_mark_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notification_mark_all_read() TO authenticated;
GRANT EXECUTE ON FUNCTION public.notification_dismiss(uuid) TO authenticated;

COMMENT ON COLUMN public.notifications.dismissed_at IS
  'Arquivada pelo destinatário (notification_dismiss). A linha permanece: é histórico de entrega.';
COMMENT ON FUNCTION public.notification_mark_read(uuid) IS
  'Única mudança de leitura do destinatário: read_at, na organização ativa. Sem escrita direta na tabela (242).';

COMMIT;
