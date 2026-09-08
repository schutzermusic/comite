import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { deriveAccessState, listMyOrganizations, resolveActiveOrganization } from './active-organization';
import { getDefaultRouteForRole, getHighestPriorityRole } from './roles';
import type { CurrentUserContext, Organization, PermissionKey, Profile, Role } from './types';

const ORGANIZATION_COLUMNS =
  'id,name,slug,status,workspace_name,logo_url,brand_color,email_from_name,notification_name,branding_enabled,enterprise_account_id,legal_name,country_code,default_currency,timezone,legal_identifier';

type UserRoleRow = {
  role_id: string;
  roles: Role | null;
};

type RolePermissionRow = {
  permissions: { key: string } | null;
};

export async function getCurrentUserContext(): Promise<CurrentUserContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      user: null, profile: null, organization: null, roles: [], permissions: [],
      organizations: [], accessState: 'NO_ORGANIZATION', canProvisionOrganizations: false,
    };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id,user_id,organization_id,full_name,avatar_url,phone,job_title,department,status')
    .eq('user_id', user.id)
    .maybeSingle<Profile>();

  let organization: Organization | null = null;
  let roles: Role[] = [];
  let permissions: PermissionKey[] = [];

  /*
    A organização ATIVA vem do banco, não do perfil. É a mesma resposta que a
    RLS vai usar na consulta seguinte — e é isso que faz o servidor e a
    fronteira falarem da mesma organização depois de uma troca.
  */
  const active = await resolveActiveOrganization(supabase);
  const activeOrganizationId = active.kind === 'ACTIVE' ? active.organizationId : null;
  const [organizations, provision] = await Promise.all([
    listMyOrganizations(supabase),
    supabase.rpc('current_user_can_provision_organizations'),
  ]);

  if (activeOrganizationId) {
    const { data: organizationRow } = await supabase
      .from('organizations')
      .select(ORGANIZATION_COLUMNS)
      .eq('id', activeOrganizationId)
      .maybeSingle<Organization>();

    organization = organizationRow ?? null;

    const { data: userRoleRows } = await supabase
      .from('user_roles')
      .select('role_id, roles(id,organization_id,key,name,description,is_system_role)')
      .eq('user_id', user.id)
      .eq('organization_id', activeOrganizationId)
      .returns<UserRoleRow[]>();

    roles = (userRoleRows ?? []).map((row) => row.roles).filter(Boolean) as Role[];

    const roleIds = roles.map((role) => role.id);
    if (roleIds.length > 0) {
      const { data: rolePermissionRows } = await supabase
        .from('role_permissions')
        .select('permissions(key)')
        .in('role_id', roleIds)
        .returns<RolePermissionRow[]>();

      permissions = Array.from(
        new Set(
          (rolePermissionRows ?? [])
            .map((row) => row.permissions?.key)
            .filter(Boolean) as string[],
        ),
      );
    }
  }

  return {
    user,
    profile: profile ?? null,
    organization,
    roles,
    permissions,
    organizations,
    accessState: deriveAccessState(activeOrganizationId, organizations),
    canProvisionOrganizations: provision.data === true,
  };
}

export async function requireAuth() {
  const context = await getCurrentUserContext();
  if (!context.user) redirect('/login');
  return context;
}

export async function requirePermission(permissionKey: PermissionKey) {
  const context = await requireAuth();
  if (!context.permissions.includes(permissionKey)) redirect('/access-restricted');
  return context;
}

export async function getAuthenticatedDefaultRoute() {
  const context = await requireAuth();
  const roleKey = getHighestPriorityRole(context.roles.map((role) => role.key));
  return getDefaultRouteForRole(roleKey);
}
