-- ============================================================
-- Fase 7.5 — 145: FUNDAÇÃO EMPRESARIAL MULTI-ORGANIZAÇÃO
-- ============================================================
--
-- ─── O que a auditoria encontrou, e por que ela muda o desenho ───────────
--
-- O MD da fase supunha que multi-organização exigiria refatorar a fronteira de
-- inquilino domínio a domínio. A auditoria do banco REAL diz outra coisa:
--
--     387 políticas RLS em `public`
--     362 delas passam por `current_user_organization_id()`
--      34 funções passam por `current_user_organization_id()`
--     TODAS as políticas de `storage.objects` passam por ela
--
-- Ou seja: a fronteira de inquilino deste produto já é UM ponto, não trezentos.
-- O erro seria reescrever 362 políticas para ensinar-lhes multi-organização.
-- O certo é ensinar multi-organização ao ÚNICO lugar que todas consultam.
--
-- Esta migration, portanto, NÃO reescreve a fronteira. Ela troca a FONTE da
-- resposta que a fronteira já pergunta.
--
--   antes:  organização = a do perfil (profiles.organization_id)
--   agora:  organização = a organização ATIVA, provada por vínculo ATIVO
--
-- ─── Por que `profiles` não podia ser a fonte ────────────────────────────
--
-- `profiles.user_id` é UNIQUE. Uma pessoa tem um perfil, logo uma organização.
-- Não é uma limitação de produto — é uma restrição de esquema. Enquanto ela
-- existir, "pertencer a duas organizações" é literalmente inexprimível.
--
-- `profiles` não some: continua sendo o perfil da pessoa e a sua organização
-- DE ORIGEM. O que ele deixa de ser é a prova de acesso. A prova passa a ser
-- `organization_memberships`, e um gatilho mantém o vínculo em dia com o
-- perfil — de modo que todo caminho de provisionamento que hoje escreve perfil
-- continua funcionando, sem inventar acesso nenhum.
--
-- ─── O que esta migration NÃO faz ────────────────────────────────────────
--
--   · não concede a ninguém acesso a organização que já não tivesse;
--   · não inventa autoridade: a titularidade empresarial é derivada, linha a
--     linha, de quem HOJE detém `admin.manage_organization` — que é
--     exatamente quem hoje pode escrever em `organizations` sem restrição;
--   · não copia fato operacional nenhum;
--   · não semeia configuração de negócio.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1) Conta empresarial — o guarda-chuva comercial (§2.1)
-- ------------------------------------------------------------
/*
  A conta empresarial NÃO é inquilino. Ela agrupa organizações para
  administração e registro. Nada operacional pende dela — de propósito: é isso
  que impede que "administrar o grupo" vire "ler os dados de todo mundo".
*/
CREATE TABLE IF NOT EXISTS public.enterprise_accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (btrim(name) <> ''),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status      text NOT NULL DEFAULT 'ACTIVE'
              CHECK (status IN ('ACTIVE','SUSPENDED','ARCHIVED')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 2) Organização — ciclo de vida e ancoragem empresarial (§2.2, §14)
-- ------------------------------------------------------------
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS enterprise_account_id uuid REFERENCES public.enterprise_accounts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS legal_name        text,
  ADD COLUMN IF NOT EXISTS country_code      text,
  ADD COLUMN IF NOT EXISTS default_currency  text,
  ADD COLUMN IF NOT EXISTS timezone          text,
  ADD COLUMN IF NOT EXISTS legal_identifier  text,
  ADD COLUMN IF NOT EXISTS suspended_at      timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at       timestamptz,
  ADD COLUMN IF NOT EXISTS created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provisioning_idempotency_key text;

/*
  `status` já existia em minúsculas com default 'active'. Mantido em
  minúsculas: 362 políticas e um punhado de rotas já leem esse valor, e
  renomear estados é o tipo de mudança que quebra em produção por estética.
*/
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_status_check;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_status_check
  CHECK (status IN ('active','suspended','archived'));

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_lifecycle_coherent;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_lifecycle_coherent CHECK (
    (status = 'suspended') = (suspended_at IS NOT NULL)
    AND (status = 'archived') = (archived_at IS NOT NULL)
  );

-- Idempotência de provisionamento por conta empresarial (§38).
CREATE UNIQUE INDEX IF NOT EXISTS organizations_provisioning_idem
  ON public.organizations (enterprise_account_id, provisioning_idempotency_key)
  WHERE provisioning_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS organizations_enterprise_idx
  ON public.organizations (enterprise_account_id) WHERE enterprise_account_id IS NOT NULL;

-- ------------------------------------------------------------
-- 3) Vínculo pessoa ↔ organização (§6.3)
-- ------------------------------------------------------------
/*
  Vínculo NÃO é papel. Ele responde uma pergunta só: esta pessoa pode ENTRAR
  nesta organização? O que ela pode FAZER lá dentro continua em `user_roles`,
  `user_permission_overrides` e, para decisão de negócio, na autoridade
  declarada da 141. A separação é permanente (§16).
*/
CREATE TABLE IF NOT EXISTS public.organization_memberships (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('INVITED','ACTIVE','SUSPENDED','REVOKED')),
  source           text NOT NULL DEFAULT 'PROFILE_PROJECTION'
                   CHECK (source IN ('PROFILE_PROJECTION','PROVISIONING','INVITE','BACKFILL')),
  invited_at       timestamptz,
  joined_at        timestamptz,
  disabled_at      timestamptz,
  disabled_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

ALTER TABLE public.organization_memberships DROP CONSTRAINT IF EXISTS om_disabled_coherent;
ALTER TABLE public.organization_memberships
  ADD CONSTRAINT om_disabled_coherent CHECK (
    (status IN ('SUSPENDED','REVOKED')) = (disabled_at IS NOT NULL)
  );

-- Os dois caminhos de leitura quentes: "minhas organizações" e "membros desta".
CREATE INDEX IF NOT EXISTS om_user_status_idx
  ON public.organization_memberships (user_id, status);
CREATE INDEX IF NOT EXISTS om_org_status_idx
  ON public.organization_memberships (organization_id, status);

-- ------------------------------------------------------------
-- 4) Vínculo pessoa ↔ conta empresarial (§6.4)
-- ------------------------------------------------------------
/*
  ADMINISTRAR ≠ LER. Esta tabela concede autoridade de PROVISIONAMENTO e
  registro. Ela não aparece em nenhuma política de dado operacional, e a
  bateria de segurança da fase prova isso explicitamente: um administrador
  empresarial que não tenha vínculo com a organização B não lê contrato,
  faturamento, recebível nem documento de B.
*/
CREATE TABLE IF NOT EXISTS public.enterprise_account_memberships (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_account_id uuid NOT NULL REFERENCES public.enterprise_accounts(id) ON DELETE CASCADE,
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role                  text NOT NULL CHECK (role IN ('OWNER','ADMIN')),
  status                text NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE','SUSPENDED','REVOKED')),
  granted_basis         text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  disabled_at           timestamptz,
  disabled_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (enterprise_account_id, user_id)
);

CREATE INDEX IF NOT EXISTS eam_user_status_idx
  ON public.enterprise_account_memberships (user_id, status);

-- ------------------------------------------------------------
-- 5) Contexto de organização ativa (§7)
-- ------------------------------------------------------------
/*
  A escolha da pessoa mora no SERVIDOR, nunca no navegador. E ela é apenas um
  PEDIDO: a linha aqui não autoriza nada sozinha. Quem autoriza é o vínculo,
  reconferido a cada resolução — por isso revogar vínculo derruba o contexto no
  ato, sem precisar caçar sessão nenhuma.
*/
CREATE TABLE IF NOT EXISTS public.user_active_organization (
  user_id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  activated_at    timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 6) Retroalimentação a partir da verdade atual (§29)
-- ------------------------------------------------------------
/*
  Existe exatamente UMA organização em produção e 94 perfis, todos nela. O
  mapeamento é determinístico — não há relação ambígua a adivinhar. Cada perfil
  vira um vínculo, com o mesmo estado que o perfil já tinha: perfil ativo → ACTIVE,
  perfil inativo → SUSPENDED. Ninguém ganha acesso; ninguém perde.
*/
INSERT INTO public.enterprise_accounts (name, slug, status)
SELECT o.name,
       'ea-' || o.slug,
       'ACTIVE'
  FROM public.organizations o
 WHERE o.enterprise_account_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.enterprise_accounts ea WHERE ea.slug = 'ea-' || o.slug);

UPDATE public.organizations o
   SET enterprise_account_id = ea.id
  FROM public.enterprise_accounts ea
 WHERE ea.slug = 'ea-' || o.slug
   AND o.enterprise_account_id IS NULL;

INSERT INTO public.organization_memberships
  (organization_id, user_id, status, source, joined_at, disabled_at, created_at)
SELECT p.organization_id,
       p.user_id,
       CASE WHEN p.status = 'active' THEN 'ACTIVE' ELSE 'SUSPENDED' END,
       'BACKFILL',
       CASE WHEN p.status = 'active' THEN p.created_at END,
       CASE WHEN p.status = 'active' THEN NULL ELSE now() END,
       p.created_at
  FROM public.profiles p
 WHERE p.organization_id IS NOT NULL
ON CONFLICT (organization_id, user_id) DO NOTHING;

/*
  Titularidade empresarial derivada — NÃO inventada.

  Hoje a política `organizations_admin_manage` concede ALL sobre `organizations`
  a quem tem `admin.manage_organization`, SEM predicado de organização. Quem
  detém essa permissão já pode, neste minuto, escrever em qualquer linha de
  `organizations`. Mapear exatamente esse conjunto para ADMIN empresarial
  PRESERVA a autoridade existente; não a amplia. E o passo 9 fecha o buraco que
  a tornava irrestrita.
*/
INSERT INTO public.enterprise_account_memberships
  (enterprise_account_id, user_id, role, status, granted_basis, created_at)
SELECT DISTINCT o.enterprise_account_id,
       ur.user_id,
       'ADMIN',
       'ACTIVE',
       'BACKFILL_FROM_ADMIN_MANAGE_ORGANIZATION',
       now()
  FROM public.user_roles ur
  JOIN public.role_permissions rp ON rp.role_id = ur.role_id
  JOIN public.permissions perm    ON perm.id = rp.permission_id
  JOIN public.organizations o     ON o.id = ur.organization_id
 WHERE perm.key = 'admin.manage_organization'
   AND o.enterprise_account_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.user_permission_overrides upo
      WHERE upo.user_id = ur.user_id
        AND upo.organization_id = ur.organization_id
        AND upo.permission_id = perm.id
        AND upo.effect = 'deny')
ON CONFLICT (enterprise_account_id, user_id) DO NOTHING;

-- A ancoragem empresarial deixa de ser opcional depois do preenchimento.
ALTER TABLE public.organizations
  ALTER COLUMN enterprise_account_id SET NOT NULL;

-- ------------------------------------------------------------
-- 7) O gatilho que mantém perfil e vínculo coerentes
-- ------------------------------------------------------------
/*
  Todo caminho que hoje cria pessoa escreve `profiles`. Se o vínculo não
  acompanhasse, esses caminhos passariam a criar gente sem acesso — e a fase
  teria quebrado o produto para provar um ponto de arquitetura.

  As regras são conservadoras de propósito:
    · perfil ativo em organização X → vínculo ACTIVE em X, se ainda não houver;
    · vínculo REVOKED NÃO ressuscita: governança vence projeção;
    · perfil desativado → vínculo SUSPENDED (é o que hoje já acontece, porque a
      resolução exigia `profiles.status = 'active'`);
    · perfil migrado de A para B → vínculo de A é SUSPENSO. Manter A vivo
      AMPLIARIA acesso em relação ao comportamento de hoje, e ampliar acesso
      numa retroalimentação é precisamente o que a §29 proíbe.
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
      SET status      = CASE WHEN public.organization_memberships.status IN ('INVITED','SUSPENDED')
                             THEN 'ACTIVE' ELSE public.organization_memberships.status END,
          disabled_at = CASE WHEN public.organization_memberships.status IN ('INVITED','SUSPENDED')
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

DROP TRIGGER IF EXISTS profiles_project_membership_trg ON public.profiles;
CREATE TRIGGER profiles_project_membership_trg
  AFTER INSERT OR UPDATE OF organization_id, status ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_project_membership();

-- ------------------------------------------------------------
-- 8) A troca de fonte — o coração da fase (§7)
-- ------------------------------------------------------------
/*
  Uma função. 362 políticas, 34 funções e todas as políticas de Storage passam
  a enxergar multi-organização por causa dela.

  Três garantias que a versão anterior não dava:
    1. a organização precisa ter VÍNCULO ATIVO da pessoa;
    2. a organização precisa estar ela própria ATIVA;
    3. a escolha guardada é reconferida contra (1) e (2) a cada chamada —
       vínculo revogado ou organização suspensa derrubam o contexto no ato.

  Sem escolha guardada, cai no vínculo ativo mais antigo. É determinístico e
  não amplia nada: só entra na conta organização de que a pessoa JÁ é membro.

  A volatilidade sai de VOLATILE para STABLE. Não é ajuste cosmético: sob RLS,
  VOLATILE obriga a reavaliação linha a linha. STABLE é o que a função de fato
  é — dentro de uma instrução, a organização ativa não muda — e devolve ao
  planejador a chance de avaliá-la uma vez só.
*/
CREATE OR REPLACE FUNCTION public.current_user_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH eligible AS (
    SELECT om.organization_id, om.created_at
      FROM public.organization_memberships om
      JOIN public.organizations o ON o.id = om.organization_id
     WHERE om.user_id = auth.uid()
       AND om.status  = 'ACTIVE'
       AND o.status   = 'active'
  )
  SELECT COALESCE(
    (SELECT e.organization_id
       FROM public.user_active_organization ua
       JOIN eligible e ON e.organization_id = ua.organization_id
      WHERE ua.user_id = auth.uid()
      LIMIT 1),
    (SELECT e.organization_id
       FROM eligible e
      ORDER BY e.created_at, e.organization_id
      LIMIT 1)
  );
$$;

COMMENT ON FUNCTION public.current_user_organization_id() IS
  'Fase 7.5: organização ATIVA da pessoa autenticada, provada por vínculo ATIVO em organização ATIVA. Ponto único de fronteira de inquilino — 362 políticas RLS e todas as políticas de Storage dependem dela.';

-- ------------------------------------------------------------
-- 9) Auxiliares de vínculo e autoridade empresarial
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_is_organization_member(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.organization_memberships om
     WHERE om.user_id = auth.uid()
       AND om.organization_id = p_organization_id
       AND om.status = 'ACTIVE');
$$;

/*
  Contas empresariais que a pessoa ADMINISTRA. Devolve conjunto vazio — nunca
  NULL — para que os predicados que a usam falhem fechado.
*/
CREATE OR REPLACE FUNCTION public.current_user_enterprise_admin_accounts()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT eam.enterprise_account_id
    FROM public.enterprise_account_memberships eam
    JOIN public.enterprise_accounts ea ON ea.id = eam.enterprise_account_id
   WHERE eam.user_id = auth.uid()
     AND eam.status  = 'ACTIVE'
     AND ea.status   = 'ACTIVE';
$$;

CREATE OR REPLACE FUNCTION public.current_user_can_provision_organizations()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.current_user_enterprise_admin_accounts());
$$;

/*
  A conta empresarial da organização ativa. É o alvo padrão do
  provisionamento: quem cria organização cria DENTRO do próprio grupo.
*/
CREATE OR REPLACE FUNCTION public.current_user_enterprise_account_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT o.enterprise_account_id
    FROM public.organizations o
   WHERE o.id = public.current_user_organization_id();
$$;

REVOKE ALL ON FUNCTION public.current_user_is_organization_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_enterprise_admin_accounts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_can_provision_organizations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_enterprise_account_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_is_organization_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_enterprise_admin_accounts() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_can_provision_organizations() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_enterprise_account_id() TO authenticated, service_role;

-- ------------------------------------------------------------
-- 10) RLS das tabelas novas
-- ------------------------------------------------------------
/*
  Nenhuma das quatro aceita ESCRITA do navegador. Vínculo, titularidade e
  contexto ativo só mudam por RPC governada (147). Um INSERT direto em
  `organization_memberships` seria auto-concessão de acesso — a §15 chama isso
  pelo nome e proíbe.
*/
ALTER TABLE public.enterprise_accounts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_account_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_active_organization       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS enterprise_accounts_select ON public.enterprise_accounts;
CREATE POLICY enterprise_accounts_select ON public.enterprise_accounts
  FOR SELECT TO authenticated
  USING (
    id IN (SELECT public.current_user_enterprise_admin_accounts())
    OR EXISTS (
      SELECT 1 FROM public.organizations o
       WHERE o.enterprise_account_id = enterprise_accounts.id
         AND public.current_user_is_organization_member(o.id))
  );

DROP POLICY IF EXISTS organization_memberships_select ON public.organization_memberships;
CREATE POLICY organization_memberships_select ON public.organization_memberships
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (organization_id = public.current_user_organization_id()
        AND (public.current_user_has_permission('admin.manage_users') OR public.current_user_is_admin()))
  );

DROP POLICY IF EXISTS enterprise_account_memberships_select ON public.enterprise_account_memberships;
CREATE POLICY enterprise_account_memberships_select ON public.enterprise_account_memberships
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR enterprise_account_id IN (SELECT public.current_user_enterprise_admin_accounts())
  );

DROP POLICY IF EXISTS user_active_organization_select ON public.user_active_organization;
CREATE POLICY user_active_organization_select ON public.user_active_organization
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ------------------------------------------------------------
-- 11) Fechar o buraco de escrita irrestrita em `organizations`
-- ------------------------------------------------------------
/*
  `organizations_admin_manage` era FOR ALL com `current_user_has_permission(
  'admin.manage_organization')` e NENHUM predicado de organização. Com um único
  inquilino isso não tinha consequência visível. Com dois, é escrita
  cross-tenant escancarada: administrador de A editando, suspendendo ou
  apagando a linha de B.

  No lugar entram três políticas, cada uma com o seu escopo:
    · SELECT — organizações de que sou membro, mais as do grupo que administro
      (registro empresarial é administração, e é só nome/estado);
    · UPDATE — apenas a organização ATIVA, e apenas com a permissão;
    · INSERT/DELETE — inexistentes. Criar é RPC governada (147); apagar
      inquilino não é fluxo de usuário (§14).
*/
DROP POLICY IF EXISTS organizations_admin_manage ON public.organizations;
DROP POLICY IF EXISTS organizations_select_own   ON public.organizations;

CREATE POLICY organizations_select_member ON public.organizations
  FOR SELECT TO authenticated
  USING (
    public.current_user_is_organization_member(id)
    OR enterprise_account_id IN (SELECT public.current_user_enterprise_admin_accounts())
  );

CREATE POLICY organizations_update_active ON public.organizations
  FOR UPDATE TO authenticated
  USING (id = public.current_user_organization_id()
         AND public.current_user_has_permission('admin.manage_organization'))
  WITH CHECK (id = public.current_user_organization_id()
         AND public.current_user_has_permission('admin.manage_organization'));

-- ------------------------------------------------------------
-- 12) Vocabulário de permissão empresarial (§44)
-- ------------------------------------------------------------
/*
  Vocabulário, e só. As linhas NÃO são concedidas a papel nenhum — conceder
  aqui seria exatamente o erro que a 141 desfez. A autoridade de
  provisionamento vem de `enterprise_account_memberships`, que é onde ela é
  DECLARADA com base rastreável.
*/
INSERT INTO public.permissions (key, module, action, description) VALUES
  ('enterprise.organizations.create', 'enterprise', 'create',
   'Provisionar nova organização dentro da conta empresarial'),
  ('enterprise.organizations.manage', 'enterprise', 'manage',
   'Administrar o registro e o ciclo de vida das organizações da conta empresarial'),
  ('enterprise.memberships.manage',   'enterprise', 'manage',
   'Administrar vínculos de pessoas com as organizações da conta empresarial')
ON CONFLICT (key) DO NOTHING;

COMMIT;
