'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import {
  deriveAccessState,
  listMyOrganizations,
  resolveActiveOrganization,
} from '@/lib/auth/active-organization';
import type { CurrentUserContext, Organization, PermissionKey, Profile, Role } from '@/lib/auth/types';

const ORGANIZATION_COLUMNS =
  'id,name,slug,status,workspace_name,logo_url,brand_color,email_from_name,notification_name,branding_enabled,enterprise_account_id,legal_name,country_code,default_currency,timezone,legal_identifier';

type UserRoleRow = {
  role_id: string;
  roles: Role | null;
};

type RolePermissionRow = {
  permissions: { key: string } | null;
};

type OverrideRow = {
  effect: 'grant' | 'deny';
  permissions: { key: string } | null;
};

const EMPTY_CONTEXT: CurrentUserContext = {
  user: null,
  profile: null,
  organization: null,
  roles: [],
  permissions: [],
  organizations: [],
  accessState: 'NO_ORGANIZATION',
  canProvisionOrganizations: false,
};

export function useCurrentUser() {
  const [context, setContext] = useState<CurrentUserContext>(EMPTY_CONTEXT);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setContext(EMPTY_CONTEXT);
      setLoading(false);
      return EMPTY_CONTEXT;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('id,user_id,organization_id,full_name,avatar_url,phone,job_title,department,status')
      .eq('user_id', user.id)
      .maybeSingle<Profile>();

    let organization: Organization | null = null;
    let roles: Role[] = [];
    let permissions: PermissionKey[] = [];

    /* Fase 7.5: organização ATIVA (vínculo provado no banco), não a do perfil. */
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
      const rolePermSet = new Set<string>();
      if (roleIds.length > 0) {
        const { data: rolePermissionRows } = await supabase
          .from('role_permissions')
          .select('permissions(key)')
          .in('role_id', roleIds)
          .returns<RolePermissionRow[]>();
        for (const row of rolePermissionRows ?? []) {
          if (row.permissions?.key) rolePermSet.add(row.permissions.key);
        }
      }

      // Apply per-user overrides (mirrors the server-side resolution in
      // current_user_has_permission). RLS scopes the result to this user's
      // own row via upo_select_scoped (user_id = auth.uid()).
      const { data: overrideRows } = await supabase
        .from('user_permission_overrides')
        .select('effect, permissions(key)')
        .eq('user_id', user.id)
        .eq('organization_id', activeOrganizationId)
        .returns<OverrideRow[]>();
      for (const row of overrideRows ?? []) {
        const key = row.permissions?.key;
        if (!key) continue;
        if (row.effect === 'grant') rolePermSet.add(key);
        else if (row.effect === 'deny') rolePermSet.delete(key);
      }

      permissions = Array.from(rolePermSet);
    }

    const nextContext: CurrentUserContext = {
      user,
      profile: profile ?? null,
      organization,
      roles,
      permissions,
      organizations,
      accessState: deriveAccessState(activeOrganizationId, organizations),
      canProvisionOrganizations: provision.data === true,
    };

    setContext(nextContext);
    setLoading(false);
    return nextContext;
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });

    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void load();
    });

    return () => subscription.unsubscribe();
  }, [load]);

  return {
    ...context,
    loading,
    refresh: load,
  };
}
