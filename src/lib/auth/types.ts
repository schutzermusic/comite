import type { User } from '@supabase/supabase-js';
import type { OrganizationAccessState, OrganizationOption } from './active-organization';

export type { OrganizationAccessState, OrganizationOption };

export type RoleKey =
  | 'owner_admin'
  | 'ceo_diretoria'
  | 'financeiro'
  | 'gestor_projetos'
  | 'juridico_contratos'
  | 'rh'
  | 'engenharia_pcp'
  | string;

export type PermissionKey = string;

export type Organization = {
  id: string;
  name: string;
  slug: string;
  status: string;
  /** Explicit opt-in for demo fixtures. Provisioned organizations default false. */
  is_demo?: boolean;
  enterprise_account_id?: string | null;
  legal_name?: string | null;
  country_code?: string | null;
  default_currency?: string | null;
  timezone?: string | null;
  legal_identifier?: string | null;
  workspace_name?: string | null;
  logo_url?: string | null;
  brand_color?: string | null;
  email_from_name?: string | null;
  notification_name?: string | null;
  branding_enabled?: boolean | null;
};

export type Profile = {
  id: string;
  user_id: string;
  organization_id: string | null;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  job_title: string | null;
  department: string | null;
  status: string;
};

export type Role = {
  id: string;
  organization_id: string | null;
  key: RoleKey;
  name: string;
  description: string | null;
  is_system_role: boolean;
};

export type CurrentUserContext = {
  user: User | null;
  profile: Profile | null;
  /** A organização ATIVA — não a de origem do perfil (Fase 7.5). */
  organization: Organization | null;
  roles: Role[];
  permissions: PermissionKey[];
  /** Organizações que a pessoa pode ENTRAR, para o seletor global. */
  organizations: OrganizationOption[];
  /** Estado explícito de acesso (§32): nunca um erro genérico. */
  accessState: OrganizationAccessState;
  /** Autoridade de provisionamento empresarial — separada de RBAC. */
  canProvisionOrganizations: boolean;
};

export type PermissionGroup = {
  module: string;
  label: string;
  permissions: Array<{
    key: PermissionKey;
    label: string;
    description?: string;
  }>;
};
