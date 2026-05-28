import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { getDefaultRouteForRole, getHighestPriorityRole } from './roles';
import type { CurrentUserContext, Organization, PermissionKey, Profile, Role } from './types';

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
    return { user: null, profile: null, organization: null, roles: [], permissions: [] };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id,user_id,organization_id,full_name,avatar_url,phone,job_title,department,status')
    .eq('user_id', user.id)
    .maybeSingle<Profile>();

  let organization: Organization | null = null;
  let roles: Role[] = [];
  let permissions: PermissionKey[] = [];

  if (profile?.organization_id) {
    const { data: organizationRow } = await supabase
      .from('organizations')
      .select('id,name,slug,status,workspace_name,logo_url,brand_color,email_from_name,notification_name,branding_enabled')
      .eq('id', profile.organization_id)
      .maybeSingle<Organization>();

    organization = organizationRow ?? null;

    const { data: userRoleRows } = await supabase
      .from('user_roles')
      .select('role_id, roles(id,organization_id,key,name,description,is_system_role)')
      .eq('user_id', user.id)
      .eq('organization_id', profile.organization_id)
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
