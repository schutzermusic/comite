-- ============================================================
-- AUTH / ORGANIZATION / RBAC FOUNDATION
-- Migration: 005_auth_rbac_foundation
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  full_name text,
  avatar_url text,
  phone text,
  job_title text,
  department text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  description text,
  is_system_role boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS roles_system_key_unique
ON roles (key)
WHERE organization_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS roles_org_key_unique
ON roles (organization_id, key)
WHERE organization_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  module text NOT NULL,
  action text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id, organization_id)
);

CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  key text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, key)
);

CREATE TABLE IF NOT EXISTS committees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  key text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, key)
);

CREATE TABLE IF NOT EXISTS committee_members (
  committee_id uuid NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  can_vote boolean NOT NULL DEFAULT false,
  can_approve boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (committee_id, user_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_organization_id ON profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_org ON user_roles(user_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_committees_org ON committees(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created ON audit_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id);

DROP TRIGGER IF EXISTS trg_organizations_updated_at ON organizations;
CREATE TRIGGER trg_organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON profiles;
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_roles_updated_at ON roles;
CREATE TRIGGER trg_roles_updated_at BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_departments_updated_at ON departments;
CREATE TRIGGER trg_departments_updated_at BEFORE UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_committees_updated_at ON committees;
CREATE TRIGGER trg_committees_updated_at BEFORE UPDATE ON committees FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION current_user_organization_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.organization_id
  FROM profiles p
  WHERE p.user_id = auth.uid()
    AND p.status = 'active'
  ORDER BY p.created_at ASC
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION current_user_has_permission(permission_key text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    JOIN role_permissions rp ON rp.role_id = r.id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = auth.uid()
      AND ur.organization_id = current_user_organization_id()
      AND p.key = permission_key
  )
$$;

CREATE OR REPLACE FUNCTION current_user_is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid()
      AND ur.organization_id = current_user_organization_id()
      AND r.key = 'owner_admin'
  ) OR current_user_has_permission('admin.manage_users')
$$;

CREATE OR REPLACE FUNCTION seed_default_committees(target_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO committees (organization_id, name, key, description)
  VALUES
    (target_organization_id, 'Diretoria', 'diretoria', 'Comite executivo e diretoria'),
    (target_organization_id, 'Financeiro', 'financeiro', 'Comite financeiro'),
    (target_organization_id, 'Juridico / Contratos', 'juridico_contratos', 'Comite juridico e contratos'),
    (target_organization_id, 'RH', 'rh', 'Comite de pessoas e recursos humanos'),
    (target_organization_id, 'Projetos', 'projetos', 'Comite de projetos'),
    (target_organization_id, 'Engenharia / PCP', 'engenharia_pcp', 'Comite tecnico de engenharia e PCP'),
    (target_organization_id, 'Riscos', 'riscos', 'Comite de riscos'),
    (target_organization_id, 'Comercial', 'comercial', 'Comite comercial'),
    (target_organization_id, 'Compras', 'compras', 'Comite de compras')
  ON CONFLICT (organization_id, key) DO NOTHING;

  INSERT INTO departments (organization_id, name, key)
  VALUES
    (target_organization_id, 'Diretoria', 'diretoria'),
    (target_organization_id, 'Financeiro', 'financeiro'),
    (target_organization_id, 'Juridico / Contratos', 'juridico_contratos'),
    (target_organization_id, 'RH', 'rh'),
    (target_organization_id, 'Projetos', 'projetos'),
    (target_organization_id, 'Engenharia / PCP', 'engenharia_pcp'),
    (target_organization_id, 'Riscos', 'riscos'),
    (target_organization_id, 'Comercial', 'comercial'),
    (target_organization_id, 'Compras', 'compras')
  ON CONFLICT (organization_id, key) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION setup_first_organization(
  organization_name text,
  organization_slug text,
  profile_full_name text DEFAULT NULL,
  profile_job_title text DEFAULT NULL,
  profile_department text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_organization_id uuid;
  owner_role_id uuid;
  normalized_slug text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Profile already exists for this user';
  END IF;

  normalized_slug := lower(regexp_replace(coalesce(organization_slug, organization_name), '[^a-zA-Z0-9]+', '-', 'g'));
  normalized_slug := trim(both '-' from normalized_slug);

  INSERT INTO organizations (name, slug)
  VALUES (organization_name, normalized_slug)
  RETURNING id INTO new_organization_id;

  INSERT INTO profiles (user_id, organization_id, full_name, job_title, department)
  VALUES (auth.uid(), new_organization_id, profile_full_name, profile_job_title, profile_department);

  SELECT id INTO owner_role_id FROM roles WHERE organization_id IS NULL AND key = 'owner_admin' LIMIT 1;

  INSERT INTO user_roles (user_id, role_id, organization_id)
  VALUES (auth.uid(), owner_role_id, new_organization_id);

  PERFORM seed_default_committees(new_organization_id);

  INSERT INTO audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    new_organization_id,
    auth.uid(),
    'organization.created',
    'organization',
    new_organization_id,
    jsonb_build_object('source', 'onboarding')
  );

  RETURN new_organization_id;
END;
$$;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE committees ENABLE ROW LEVEL SECURITY;
ALTER TABLE committee_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_select_own ON organizations;
CREATE POLICY organizations_select_own ON organizations
FOR SELECT TO authenticated
USING (id = current_user_organization_id());

DROP POLICY IF EXISTS organizations_admin_manage ON organizations;
CREATE POLICY organizations_admin_manage ON organizations
FOR ALL TO authenticated
USING (current_user_has_permission('admin.manage_organization'))
WITH CHECK (current_user_has_permission('admin.manage_organization'));

DROP POLICY IF EXISTS profiles_select_scoped ON profiles;
CREATE POLICY profiles_select_scoped ON profiles
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR (
    organization_id = current_user_organization_id()
    AND (
      current_user_has_permission('admin.manage_users')
      OR current_user_has_permission('dashboard.view_executive')
    )
  )
);

DROP POLICY IF EXISTS profiles_insert_admin ON profiles;
CREATE POLICY profiles_insert_admin ON profiles
FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  OR (
    organization_id = current_user_organization_id()
    AND current_user_has_permission('admin.manage_users')
  )
);

DROP POLICY IF EXISTS profiles_update_scoped ON profiles;
CREATE POLICY profiles_update_scoped ON profiles
FOR UPDATE TO authenticated
USING (
  user_id = auth.uid()
  OR (
    organization_id = current_user_organization_id()
    AND current_user_has_permission('admin.manage_users')
  )
)
WITH CHECK (
  user_id = auth.uid()
  OR (
    organization_id = current_user_organization_id()
    AND current_user_has_permission('admin.manage_users')
  )
);

DROP POLICY IF EXISTS roles_select_assigned_or_admin ON roles;
CREATE POLICY roles_select_assigned_or_admin ON roles
FOR SELECT TO authenticated
USING (
  current_user_has_permission('admin.manage_roles')
  OR EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role_id = roles.id
  )
  OR organization_id IS NULL
);

DROP POLICY IF EXISTS roles_admin_manage ON roles;
CREATE POLICY roles_admin_manage ON roles
FOR ALL TO authenticated
USING (current_user_has_permission('admin.manage_roles'))
WITH CHECK (current_user_has_permission('admin.manage_roles'));

DROP POLICY IF EXISTS permissions_read_authenticated ON permissions;
CREATE POLICY permissions_read_authenticated ON permissions
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS role_permissions_select_scoped ON role_permissions;
CREATE POLICY role_permissions_select_scoped ON role_permissions
FOR SELECT TO authenticated
USING (
  current_user_has_permission('admin.manage_roles')
  OR EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role_id = role_permissions.role_id
  )
);

DROP POLICY IF EXISTS role_permissions_admin_manage ON role_permissions;
CREATE POLICY role_permissions_admin_manage ON role_permissions
FOR ALL TO authenticated
USING (current_user_has_permission('admin.manage_roles'))
WITH CHECK (current_user_has_permission('admin.manage_roles'));

DROP POLICY IF EXISTS user_roles_select_scoped ON user_roles;
CREATE POLICY user_roles_select_scoped ON user_roles
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR (
    organization_id = current_user_organization_id()
    AND current_user_has_permission('admin.manage_users')
  )
);

DROP POLICY IF EXISTS user_roles_admin_manage ON user_roles;
CREATE POLICY user_roles_admin_manage ON user_roles
FOR ALL TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('admin.manage_users')
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('admin.manage_users')
);

DROP POLICY IF EXISTS departments_select_org ON departments;
CREATE POLICY departments_select_org ON departments
FOR SELECT TO authenticated
USING (organization_id = current_user_organization_id());

DROP POLICY IF EXISTS departments_admin_manage ON departments;
CREATE POLICY departments_admin_manage ON departments
FOR ALL TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('admin.manage_organization')
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('admin.manage_organization')
);

DROP POLICY IF EXISTS committees_select_org ON committees;
CREATE POLICY committees_select_org ON committees
FOR SELECT TO authenticated
USING (organization_id = current_user_organization_id());

DROP POLICY IF EXISTS committees_manage_members ON committees;
CREATE POLICY committees_manage_members ON committees
FOR ALL TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('committees.manage_members')
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('committees.manage_members')
);

DROP POLICY IF EXISTS committee_members_select_scoped ON committee_members;
CREATE POLICY committee_members_select_scoped ON committee_members
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM committees c
    WHERE c.id = committee_members.committee_id
      AND c.organization_id = current_user_organization_id()
      AND current_user_has_permission('committees.view')
  )
);

DROP POLICY IF EXISTS committee_members_manage ON committee_members;
CREATE POLICY committee_members_manage ON committee_members
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM committees c
    WHERE c.id = committee_members.committee_id
      AND c.organization_id = current_user_organization_id()
      AND current_user_has_permission('committees.manage_members')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM committees c
    WHERE c.id = committee_members.committee_id
      AND c.organization_id = current_user_organization_id()
      AND current_user_has_permission('committees.manage_members')
  )
);

DROP POLICY IF EXISTS audit_logs_select_audit ON audit_logs;
CREATE POLICY audit_logs_select_audit ON audit_logs
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('audit.view')
);

DROP POLICY IF EXISTS audit_logs_insert_authenticated ON audit_logs;
CREATE POLICY audit_logs_insert_authenticated ON audit_logs
FOR INSERT TO authenticated
WITH CHECK (
  actor_user_id = auth.uid()
  AND organization_id = current_user_organization_id()
);

INSERT INTO permissions (key, module, action, description)
VALUES
  ('admin.view', 'admin', 'view', 'Visualizar administracao'),
  ('admin.manage_users', 'admin', 'manage_users', 'Gerenciar usuarios'),
  ('admin.manage_roles', 'admin', 'manage_roles', 'Gerenciar roles'),
  ('admin.manage_organization', 'admin', 'manage_organization', 'Gerenciar organizacao'),
  ('admin.manage_integrations', 'admin', 'manage_integrations', 'Gerenciar integracoes'),
  ('dashboard.view', 'dashboard', 'view', 'Visualizar dashboard'),
  ('dashboard.view_executive', 'dashboard', 'view_executive', 'Visualizar dashboard executivo'),
  ('dashboard.export', 'dashboard', 'export', 'Exportar dashboard'),
  ('projects.view', 'projects', 'view', 'Visualizar projetos'),
  ('projects.create', 'projects', 'create', 'Criar projetos'),
  ('projects.edit', 'projects', 'edit', 'Editar projetos'),
  ('projects.delete', 'projects', 'delete', 'Excluir projetos'),
  ('projects.export', 'projects', 'export', 'Exportar projetos'),
  ('projects.upload', 'projects', 'upload', 'Upload em projetos'),
  ('projects.view_costs', 'projects', 'view_costs', 'Ver custos de projetos'),
  ('projects.view_margin', 'projects', 'view_margin', 'Ver margem de projetos'),
  ('projects.view_all', 'projects', 'view_all', 'Ver todos os projetos'),
  ('projects.view_assigned', 'projects', 'view_assigned', 'Ver projetos atribuidos'),
  ('project_gantt.view', 'project_gantt', 'view', 'Visualizar gantt'),
  ('project_gantt.create', 'project_gantt', 'create', 'Criar gantt'),
  ('project_gantt.edit', 'project_gantt', 'edit', 'Editar gantt'),
  ('project_gantt.delete', 'project_gantt', 'delete', 'Excluir gantt'),
  ('project_gantt.update_progress', 'project_gantt', 'update_progress', 'Atualizar progresso'),
  ('finance.view', 'finance', 'view', 'Visualizar financeiro'),
  ('finance.view_executive', 'finance', 'view_executive', 'Visualizar financeiro executivo'),
  ('finance.create_entry', 'finance', 'create_entry', 'Criar lancamento'),
  ('finance.edit_entry', 'finance', 'edit_entry', 'Editar lancamento'),
  ('finance.delete_entry', 'finance', 'delete_entry', 'Excluir lancamento'),
  ('finance.view_dre', 'finance', 'view_dre', 'Visualizar DRE'),
  ('finance.view_budget_actual', 'finance', 'view_budget_actual', 'Visualizar orcado x realizado'),
  ('finance.view_forecast', 'finance', 'view_forecast', 'Visualizar forecast'),
  ('finance.view_project_costs', 'finance', 'view_project_costs', 'Visualizar custos de projeto'),
  ('finance.view_margin', 'finance', 'view_margin', 'Visualizar margem'),
  ('finance.export', 'finance', 'export', 'Exportar financeiro'),
  ('finance.approve', 'finance', 'approve', 'Aprovar financeiro'),
  ('contracts.view', 'contracts', 'view', 'Visualizar contratos'),
  ('contracts.create', 'contracts', 'create', 'Criar contratos'),
  ('contracts.edit', 'contracts', 'edit', 'Editar contratos'),
  ('contracts.delete', 'contracts', 'delete', 'Excluir contratos'),
  ('contracts.upload_file', 'contracts', 'upload_file', 'Upload contratos'),
  ('contracts.analyze_with_ai', 'contracts', 'analyze_with_ai', 'Analisar contratos com IA'),
  ('contracts.view_values', 'contracts', 'view_values', 'Ver valores contratuais'),
  ('contracts.view_penalties', 'contracts', 'view_penalties', 'Ver penalidades'),
  ('contracts.approve', 'contracts', 'approve', 'Aprovar contratos'),
  ('contracts.export', 'contracts', 'export', 'Exportar contratos'),
  ('risks.view', 'risks', 'view', 'Visualizar riscos'),
  ('risks.create', 'risks', 'create', 'Criar riscos'),
  ('risks.edit', 'risks', 'edit', 'Editar riscos'),
  ('risks.delete', 'risks', 'delete', 'Excluir riscos'),
  ('risks.approve_mitigation', 'risks', 'approve_mitigation', 'Aprovar mitigacao'),
  ('risks.view_all', 'risks', 'view_all', 'Ver todos os riscos'),
  ('risks.view_assigned', 'risks', 'view_assigned', 'Ver riscos atribuidos'),
  ('risks.export', 'risks', 'export', 'Exportar riscos'),
  ('meetings.view', 'meetings', 'view', 'Visualizar reunioes'),
  ('meetings.create', 'meetings', 'create', 'Criar reunioes'),
  ('meetings.edit', 'meetings', 'edit', 'Editar reunioes'),
  ('meetings.delete', 'meetings', 'delete', 'Excluir reunioes'),
  ('meetings.participate', 'meetings', 'participate', 'Participar de reunioes'),
  ('deliberations.view', 'deliberations', 'view', 'Visualizar deliberacoes'),
  ('deliberations.create', 'deliberations', 'create', 'Criar deliberacoes'),
  ('deliberations.view_own', 'deliberations', 'view_own', 'Ver deliberacoes proprias'),
  ('deliberations.view_committee', 'deliberations', 'view_committee', 'Ver deliberacoes do comite'),
  ('deliberations.view_all', 'deliberations', 'view_all', 'Ver todas as deliberacoes'),
  ('deliberations.comment', 'deliberations', 'comment', 'Comentar deliberacoes'),
  ('deliberations.vote', 'deliberations', 'vote', 'Votar deliberacoes'),
  ('deliberations.approve', 'deliberations', 'approve', 'Aprovar deliberacoes'),
  ('deliberations.reject', 'deliberations', 'reject', 'Rejeitar deliberacoes'),
  ('deliberations.close', 'deliberations', 'close', 'Encerrar deliberacoes'),
  ('deliberations.export', 'deliberations', 'export', 'Exportar deliberacoes'),
  ('deliberations.view_confidential', 'deliberations', 'view_confidential', 'Ver deliberacoes confidenciais'),
  ('minutes.view', 'minutes', 'view', 'Visualizar atas'),
  ('minutes.create', 'minutes', 'create', 'Criar atas'),
  ('minutes.edit', 'minutes', 'edit', 'Editar atas'),
  ('minutes.approve', 'minutes', 'approve', 'Aprovar atas'),
  ('minutes.export', 'minutes', 'export', 'Exportar atas'),
  ('people.view', 'people', 'view', 'Visualizar pessoas'),
  ('people.create', 'people', 'create', 'Criar pessoas'),
  ('people.edit', 'people', 'edit', 'Editar pessoas'),
  ('people.delete', 'people', 'delete', 'Excluir pessoas'),
  ('people.view_costs', 'people', 'view_costs', 'Ver custos de pessoas'),
  ('people.view_salary', 'people', 'view_salary', 'Ver salarios'),
  ('people.view_sensitive_data', 'people', 'view_sensitive_data', 'Ver dados sensiveis'),
  ('org_chart.view', 'org_chart', 'view', 'Visualizar organograma'),
  ('org_chart.edit', 'org_chart', 'edit', 'Editar organograma'),
  ('org_chart.export', 'org_chart', 'export', 'Exportar organograma'),
  ('committees.view', 'committees', 'view', 'Visualizar comites'),
  ('committees.create', 'committees', 'create', 'Criar comites'),
  ('committees.edit', 'committees', 'edit', 'Editar comites'),
  ('committees.delete', 'committees', 'delete', 'Excluir comites'),
  ('committees.manage_members', 'committees', 'manage_members', 'Gerenciar membros de comites'),
  ('audit.view', 'audit', 'view', 'Visualizar auditoria'),
  ('audit.export', 'audit', 'export', 'Exportar auditoria')
ON CONFLICT (key) DO UPDATE
SET module = EXCLUDED.module,
    action = EXCLUDED.action,
    description = EXCLUDED.description;

INSERT INTO roles (organization_id, key, name, description, is_system_role)
VALUES
  (NULL, 'owner_admin', 'Owner / Admin', 'Acesso total ao sistema', true),
  (NULL, 'ceo_diretoria', 'CEO / Diretoria', 'Visibilidade executiva da organizacao', true),
  (NULL, 'gestor_projetos', 'Gestor de Projetos', 'Gestao operacional de projetos', true),
  (NULL, 'financeiro', 'Financeiro', 'Operacao financeira e visibilidade executiva', true),
  (NULL, 'juridico_contratos', 'Juridico / Contratos', 'Gestao juridica e contratos', true),
  (NULL, 'rh', 'RH', 'Gestao de pessoas e organizacao', true),
  (NULL, 'engenharia_pcp', 'Engenharia / PCP', 'Planejamento tecnico e execucao', true)
ON CONFLICT (key) WHERE organization_id IS NULL DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_system_role = true;

WITH all_permissions AS (
  SELECT id FROM permissions
),
owner_role AS (
  SELECT id FROM roles WHERE key = 'owner_admin' AND organization_id IS NULL
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT owner_role.id, all_permissions.id
FROM owner_role, all_permissions
ON CONFLICT DO NOTHING;

CREATE TEMP TABLE IF NOT EXISTS role_permission_seed(role_key text, permission_key text) ON COMMIT DROP;
TRUNCATE role_permission_seed;

INSERT INTO role_permission_seed(role_key, permission_key)
VALUES
  ('ceo_diretoria','dashboard.view'),('ceo_diretoria','dashboard.view_executive'),('ceo_diretoria','dashboard.export'),('ceo_diretoria','projects.view'),('ceo_diretoria','projects.view_all'),('ceo_diretoria','projects.export'),('ceo_diretoria','project_gantt.view'),('ceo_diretoria','finance.view'),('ceo_diretoria','finance.view_executive'),('ceo_diretoria','finance.view_dre'),('ceo_diretoria','finance.view_budget_actual'),('ceo_diretoria','finance.view_forecast'),('ceo_diretoria','finance.view_project_costs'),('ceo_diretoria','finance.export'),('ceo_diretoria','contracts.view'),('ceo_diretoria','contracts.view_values'),('ceo_diretoria','contracts.view_penalties'),('ceo_diretoria','contracts.approve'),('ceo_diretoria','risks.view'),('ceo_diretoria','risks.view_all'),('ceo_diretoria','risks.approve_mitigation'),('ceo_diretoria','meetings.view'),('ceo_diretoria','meetings.create'),('ceo_diretoria','meetings.participate'),('ceo_diretoria','deliberations.view'),('ceo_diretoria','deliberations.create'),('ceo_diretoria','deliberations.view_own'),('ceo_diretoria','deliberations.view_committee'),('ceo_diretoria','deliberations.view_all'),('ceo_diretoria','deliberations.comment'),('ceo_diretoria','deliberations.vote'),('ceo_diretoria','deliberations.approve'),('ceo_diretoria','deliberations.reject'),('ceo_diretoria','deliberations.close'),('ceo_diretoria','deliberations.export'),('ceo_diretoria','minutes.view'),('ceo_diretoria','minutes.approve'),('ceo_diretoria','people.view'),('ceo_diretoria','org_chart.view'),('ceo_diretoria','committees.view'),('ceo_diretoria','audit.view'),
  ('financeiro','dashboard.view'),('financeiro','dashboard.view_executive'),('financeiro','projects.view'),('financeiro','projects.view_all'),('financeiro','projects.view_costs'),('financeiro','project_gantt.view'),('financeiro','finance.view'),('financeiro','finance.view_executive'),('financeiro','finance.create_entry'),('financeiro','finance.edit_entry'),('financeiro','finance.view_dre'),('financeiro','finance.view_budget_actual'),('financeiro','finance.view_forecast'),('financeiro','finance.view_project_costs'),('financeiro','finance.export'),('financeiro','finance.approve'),('financeiro','contracts.view'),('financeiro','contracts.view_values'),('financeiro','risks.view'),('financeiro','risks.view_all'),('financeiro','meetings.view'),('financeiro','meetings.create'),('financeiro','meetings.participate'),('financeiro','deliberations.view'),('financeiro','deliberations.create'),('financeiro','deliberations.view_own'),('financeiro','deliberations.view_committee'),('financeiro','deliberations.comment'),('financeiro','deliberations.vote'),('financeiro','minutes.view'),('financeiro','people.view'),('financeiro','org_chart.view'),('financeiro','committees.view'),
  ('gestor_projetos','dashboard.view'),('gestor_projetos','projects.view'),('gestor_projetos','projects.create'),('gestor_projetos','projects.edit'),('gestor_projetos','projects.upload'),('gestor_projetos','projects.view_assigned'),('gestor_projetos','project_gantt.view'),('gestor_projetos','project_gantt.create'),('gestor_projetos','project_gantt.edit'),('gestor_projetos','project_gantt.update_progress'),('gestor_projetos','risks.view'),('gestor_projetos','risks.create'),('gestor_projetos','risks.edit'),('gestor_projetos','risks.view_assigned'),('gestor_projetos','meetings.view'),('gestor_projetos','meetings.create'),('gestor_projetos','meetings.participate'),('gestor_projetos','deliberations.view'),('gestor_projetos','deliberations.create'),('gestor_projetos','deliberations.view_own'),('gestor_projetos','deliberations.view_committee'),('gestor_projetos','deliberations.comment'),('gestor_projetos','minutes.view'),('gestor_projetos','contracts.view'),('gestor_projetos','committees.view'),
  ('juridico_contratos','dashboard.view'),('juridico_contratos','contracts.view'),('juridico_contratos','contracts.create'),('juridico_contratos','contracts.edit'),('juridico_contratos','contracts.upload_file'),('juridico_contratos','contracts.analyze_with_ai'),('juridico_contratos','contracts.view_values'),('juridico_contratos','contracts.view_penalties'),('juridico_contratos','contracts.export'),('juridico_contratos','risks.view'),('juridico_contratos','risks.create'),('juridico_contratos','risks.edit'),('juridico_contratos','meetings.view'),('juridico_contratos','meetings.create'),('juridico_contratos','meetings.participate'),('juridico_contratos','deliberations.view'),('juridico_contratos','deliberations.create'),('juridico_contratos','deliberations.view_own'),('juridico_contratos','deliberations.view_committee'),('juridico_contratos','deliberations.comment'),('juridico_contratos','deliberations.vote'),('juridico_contratos','minutes.view'),('juridico_contratos','projects.view'),('juridico_contratos','committees.view'),
  ('rh','dashboard.view'),('rh','people.view'),('rh','people.create'),('rh','people.edit'),('rh','org_chart.view'),('rh','org_chart.edit'),('rh','meetings.view'),('rh','meetings.create'),('rh','meetings.participate'),('rh','deliberations.view'),('rh','deliberations.create'),('rh','deliberations.view_own'),('rh','deliberations.view_committee'),('rh','deliberations.comment'),('rh','deliberations.vote'),('rh','minutes.view'),('rh','committees.view'),('rh','projects.view'),
  ('engenharia_pcp','dashboard.view'),('engenharia_pcp','projects.view'),('engenharia_pcp','projects.view_assigned'),('engenharia_pcp','projects.edit'),('engenharia_pcp','projects.upload'),('engenharia_pcp','project_gantt.view'),('engenharia_pcp','project_gantt.create'),('engenharia_pcp','project_gantt.edit'),('engenharia_pcp','project_gantt.update_progress'),('engenharia_pcp','risks.view'),('engenharia_pcp','risks.create'),('engenharia_pcp','risks.edit'),('engenharia_pcp','meetings.view'),('engenharia_pcp','meetings.create'),('engenharia_pcp','meetings.participate'),('engenharia_pcp','deliberations.view'),('engenharia_pcp','deliberations.create'),('engenharia_pcp','deliberations.view_own'),('engenharia_pcp','deliberations.view_committee'),('engenharia_pcp','deliberations.comment'),('engenharia_pcp','deliberations.vote'),('engenharia_pcp','minutes.view'),('engenharia_pcp','contracts.view'),('engenharia_pcp','committees.view');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM role_permission_seed s
JOIN roles r ON r.key = s.role_key AND r.organization_id IS NULL
JOIN permissions p ON p.key = s.permission_key
ON CONFLICT DO NOTHING;
