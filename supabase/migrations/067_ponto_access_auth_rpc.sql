-- ============================================================
-- INSIGHT PONTO — auth.users state lookups (service-role only)
-- Migration: 067_ponto_access_auth_rpc
--
-- O status de acesso do colaborador (Ativo / Convite pendente / expirado /
-- bloqueado) depende de campos de auth.users (email_confirmed_at,
-- banned_until) que o PostgREST não expõe. Estas funções SECURITY DEFINER
-- leem SOMENTE os campos mínimos e são concedidas APENAS ao papel
-- `service_role` — jamais a `authenticated`/`anon`. As rotas de admin já
-- usam o service-role client, então só elas conseguem chamar. Nenhum dado
-- sensível (hash de senha, tokens) é retornado.
-- ============================================================
BEGIN;

-- estado de vários usuários (para montar a lista de acesso em lote)
CREATE OR REPLACE FUNCTION public.ponto_auth_user_states(p_user_ids uuid[])
RETURNS TABLE (
  user_id            uuid,
  email              text,
  email_confirmed_at timestamptz,
  banned_until       timestamptz,
  last_sign_in_at    timestamptz,
  created_at         timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT u.id, u.email, u.email_confirmed_at, u.banned_until, u.last_sign_in_at, u.created_at
  FROM auth.users u
  WHERE u.id = ANY(p_user_ids)
$$;

REVOKE ALL ON FUNCTION public.ponto_auth_user_states(uuid[]) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.ponto_auth_user_states(uuid[]) TO service_role;

-- lookup por e-mail (prevenção de auth user duplicado / e-mail em outra org)
CREATE OR REPLACE FUNCTION public.ponto_auth_user_by_email(p_email text)
RETURNS TABLE (
  user_id            uuid,
  email              text,
  email_confirmed_at timestamptz,
  banned_until       timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT u.id, u.email, u.email_confirmed_at, u.banned_until
  FROM auth.users u
  WHERE lower(u.email) = lower(trim(p_email))
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.ponto_auth_user_by_email(text) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.ponto_auth_user_by_email(text) TO service_role;

COMMIT;

-- ============================================================
-- Rollback (manual):
--   DROP FUNCTION IF EXISTS public.ponto_auth_user_states(uuid[]);
--   DROP FUNCTION IF EXISTS public.ponto_auth_user_by_email(text);
-- ============================================================
