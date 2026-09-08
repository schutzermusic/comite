-- ============================================================
-- Pós-Fase 7.5 — Production Clean-Slate Gate
-- ============================================================
-- Marca demonstração de forma explícita (default seguro = produção) e remove
-- a autoridade empresarial do bot QA somente depois de provar que existe um
-- administrador humano ativo na mesma conta. O vínculo operacional do bot com
-- a organização demo é preservado.
BEGIN;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.is_demo IS
  'Opt-in explícito para fixtures/runtime demonstrativo. Organizações provisionadas nascem false e vazias.';

-- A organização histórica é o ambiente demonstrativo existente. Nenhuma
-- organização futura herda este estado porque o default é false.
UPDATE public.organizations
   SET is_demo = true,
       updated_at = now()
 WHERE slug = 'insight-energy'
   AND name = 'INSIGHT ENERGY';

DO $$
DECLARE
  qa_user uuid;
  target_enterprise uuid;
  human_admins integer;
BEGIN
  SELECT id INTO qa_user
    FROM auth.users
   WHERE lower(email) = 'qa.workforce@insightapex.dev'
   LIMIT 1;

  IF qa_user IS NULL THEN
    RETURN;
  END IF;

  SELECT eam.enterprise_account_id INTO target_enterprise
    FROM public.enterprise_account_memberships eam
    JOIN public.enterprise_accounts ea ON ea.id = eam.enterprise_account_id
   WHERE eam.user_id = qa_user
     AND eam.role = 'ADMIN'
     AND eam.status = 'ACTIVE'
     AND ea.name = 'INSIGHT ENERGY'
   LIMIT 1;

  IF target_enterprise IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*) INTO human_admins
    FROM public.enterprise_account_memberships eam
    JOIN auth.users u ON u.id = eam.user_id
   WHERE eam.enterprise_account_id = target_enterprise
     AND eam.user_id <> qa_user
     AND eam.role IN ('OWNER','ADMIN')
     AND eam.status = 'ACTIVE'
     AND lower(coalesce(u.email, '')) <> 'qa.workforce@insightapex.dev'
     AND lower(coalesce(u.email, '')) NOT LIKE '%@example.test';

  IF human_admins < 1 THEN
    RAISE EXCEPTION 'CLEAN_SLATE_HUMAN_ENTERPRISE_ADMIN_REQUIRED';
  END IF;

  UPDATE public.enterprise_account_memberships
     SET status = 'REVOKED',
         disabled_at = now(),
         updated_at = now(),
         granted_basis = 'REVOKED_PRODUCTION_CLEAN_SLATE_GATE'
   WHERE enterprise_account_id = target_enterprise
     AND user_id = qa_user
     AND role = 'ADMIN'
     AND status = 'ACTIVE';
END $$;

COMMIT;
