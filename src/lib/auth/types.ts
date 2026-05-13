import type { User } from '@supabase/supabase-js';

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
  organization: Organization | null;
  roles: Role[];
  permissions: PermissionKey[];
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
