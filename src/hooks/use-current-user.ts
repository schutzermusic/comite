'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import type { CurrentUserContext, Organization, PermissionKey, Profile, Role } from '@/lib/auth/types';

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

    if (profile?.organization_id) {
      const { data: organizationRow } = await supabase
        .from('organizations')
        .select('id,name,slug,status')
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
        .eq('organization_id', profile.organization_id)
        .returns<OverrideRow[]>();
      for (const row of overrideRows ?? []) {
        const key = row.permissions?.key;
        if (!key) continue;
        if (row.effect === 'grant') rolePermSet.add(key);
        else if (row.effect === 'deny') rolePermSet.delete(key);
      }

      permissions = Array.from(rolePermSet);
    }

    const nextContext = {
      user,
      profile: profile ?? null,
      organization,
      roles,
      permissions,
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
