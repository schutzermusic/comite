-- ============================================================
-- Fase 7.5 red-team — 149: CONTEXTO EXPLÍCITO E FRONTEIRAS DERIVADAS
-- ============================================================
--
-- 145–148 já estão em produção e permanecem imutáveis. Esta migration
-- corrige quatro achados reproduzidos contra o schema aplicado:
--
--   1. a perda da organização selecionada fazia o resolver escolher outro
--      vínculo ativo por COALESCE;
--   2. PROFILE_PROJECTION reativava um vínculo explicitamente SUSPENDED;
--   3. três policies de administração derivada não conferiam o tenant do
--      objeto-alvo;
--   4. funções SECURITY DEFINER internas continuavam executáveis por anon
--      ou diretamente por authenticated devido aos default privileges.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1) Nunca trocar de organização em silêncio
-- ------------------------------------------------------------
/*
  Sem seleção armazenada, o bootstrap legado só é permitido para a pessoa
  que tem exatamente UM vínculo total e ele está elegível. Contar todos os
  vínculos (inclusive SUSPENDED/REVOKED) é deliberado: depois de perder A,
  uma pessoa que também pertence a B continua tendo dois vínculos e precisa
  selecionar B explicitamente, mesmo que B seja o único elegível.

  Se há seleção armazenada, ela é a única candidata. Tornar-se inelegível
  produz NULL; jamais cai no bootstrap.
*/
CREATE OR REPLACE FUNCTION public.current_user_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH memberships AS (
    SELECT om.organization_id,
           om.status AS membership_status,
           o.status  AS organization_status
      FROM public.organization_memberships om
      JOIN public.organizations o ON o.id = om.organization_id
     WHERE om.user_id = auth.uid()
  ), selected AS (
    SELECT ua.organization_id
      FROM public.user_active_organization ua
     WHERE ua.user_id = auth.uid()
  ), eligible AS (
    SELECT organization_id
      FROM memberships
     WHERE membership_status = 'ACTIVE'
       AND organization_status = 'active'
  )
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM selected) THEN
      (SELECT e.organization_id
         FROM selected s
         JOIN eligible e ON e.organization_id = s.organization_id)
    WHEN (SELECT count(*) FROM memberships) = 1
     AND (SELECT count(*) FROM eligible) = 1 THEN
      (SELECT organization_id FROM eligible)
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.current_user_organization_id() IS
  'Fase 7.5/149: seleção explícita fail-closed. Perder a organização ativa nunca promove outro vínculo; bootstrap legado somente com um único vínculo total elegível.';

-- ------------------------------------------------------------
-- 2) Projeção de perfil não desfaz decisão de governança
-- ------------------------------------------------------------
/*
  INVITED ainda pode virar ACTIVE pelo fluxo legado de perfil. SUSPENDED e
  REVOKED exigem reativação pela RPC governada. A 145 já preservava REVOKED;
  o red-team provou que SUSPENDED precisava da mesma proteção.
*/
CREATE OR REPLACE FUNCTION public.profiles_project_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.organization_id IS NOT NULL
     AND OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN
    UPDATE public.organization_memberships
       SET status = 'SUSPENDED', disabled_at = now(), updated_at = now()
     WHERE organization_id = OLD.organization_id
       AND user_id = OLD.user_id
       AND status = 'ACTIVE';
  END IF;

  IF NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'active' THEN
    INSERT INTO public.organization_memberships
      (organization_id, user_id, status, source, joined_at, created_at)
    VALUES (NEW.organization_id, NEW.user_id, 'ACTIVE', 'PROFILE_PROJECTION', now(), now())
    ON CONFLICT (organization_id, user_id) DO UPDATE
      SET status      = CASE WHEN public.organization_memberships.status = 'INVITED'
                             THEN 'ACTIVE' ELSE public.organization_memberships.status END,
          disabled_at = CASE WHEN public.organization_memberships.status = 'INVITED'
                             THEN NULL ELSE public.organization_memberships.disabled_at END,
          joined_at   = COALESCE(public.organization_memberships.joined_at, now()),
          updated_at  = now();
  ELSE
    UPDATE public.organization_memberships
       SET status = 'SUSPENDED', disabled_at = now(), updated_at = now()
     WHERE organization_id = NEW.organization_id
       AND user_id = NEW.user_id
       AND status = 'ACTIVE';
  END IF;

  RETURN NEW;
END $$;

-- ------------------------------------------------------------
-- 3) Policies que derivam tenant pela linha-pai
-- ------------------------------------------------------------
DROP POLICY IF EXISTS journey_manager_scope_projects_write
  ON public.journey_manager_scope_projects;
CREATE POLICY journey_manager_scope_projects_write
ON public.journey_manager_scope_projects
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1
      FROM public.journey_manager_scopes s
      JOIN public.projects p ON p.id = journey_manager_scope_projects.project_id
     WHERE s.id = journey_manager_scope_projects.scope_id
       AND s.organization_id = public.current_user_organization_id()
       AND p.organization_id = s.organization_id
  )
  AND (public.current_user_has_permission('people.attendance_scope_admin')
       OR public.current_user_is_admin())
)
WITH CHECK (
  EXISTS (
    SELECT 1
      FROM public.journey_manager_scopes s
      JOIN public.projects p ON p.id = journey_manager_scope_projects.project_id
     WHERE s.id = journey_manager_scope_projects.scope_id
       AND s.organization_id = public.current_user_organization_id()
       AND p.organization_id = s.organization_id
  )
  AND (public.current_user_has_permission('people.attendance_scope_admin')
       OR public.current_user_is_admin())
);

DROP POLICY IF EXISTS roles_admin_manage ON public.roles;
CREATE POLICY roles_admin_manage ON public.roles
FOR ALL TO authenticated
USING (
  organization_id = public.current_user_organization_id()
  AND public.current_user_has_permission('admin.manage_roles')
)
WITH CHECK (
  organization_id = public.current_user_organization_id()
  AND public.current_user_has_permission('admin.manage_roles')
  AND is_system_role = false
);

DROP POLICY IF EXISTS role_permissions_admin_manage ON public.role_permissions;
CREATE POLICY role_permissions_admin_manage ON public.role_permissions
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.roles r
     WHERE r.id = role_permissions.role_id
       AND r.organization_id = public.current_user_organization_id()
       AND r.is_system_role = false
  )
  AND public.current_user_has_permission('admin.manage_roles')
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.roles r
     WHERE r.id = role_permissions.role_id
       AND r.organization_id = public.current_user_organization_id()
       AND r.is_system_role = false
  )
  AND public.current_user_has_permission('admin.manage_roles')
);

-- ------------------------------------------------------------
-- 4) SECURITY DEFINER: anon não executa nenhum; triggers não são RPCs
-- ------------------------------------------------------------
/*
  Revogar PUBLIC não remove grants nominais criados pelos default privileges
  do Supabase. Fazemos ambos. Grants nominais de authenticated para as RPCs
  públicas permanecem intactos.
*/
DO $security_definer$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn.signature);
  END LOOP;

  -- Funções de trigger não são endpoints de navegador.
  FOR fn IN
    SELECT DISTINCT p.oid::regprocedure AS signature
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_trigger t ON t.tgfoid = p.oid AND NOT t.tgisinternal
     WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn.signature);
  END LOOP;
END $security_definer$;

-- Workers e auxiliares internos: chamados por funções donas, pg_cron ou
-- service_role; nenhum deles é uma RPC humana.
REVOKE ALL ON FUNCTION public.seed_default_committees(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.process_task_reminders() FROM authenticated;
REVOKE ALL ON FUNCTION public.process_meeting_reminders() FROM authenticated;
REVOKE ALL ON FUNCTION public.approval_request_supersede(uuid,uuid,uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.approval_request_expire(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.approval_requests_expire_due(integer) FROM authenticated;

COMMIT;
