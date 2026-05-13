'use client';

import { MODULE_ACCESS_PERMISSION, hasAllPermissions, hasAnyPermission, hasPermission } from '@/lib/auth/permissions';
import type { PermissionKey } from '@/lib/auth/types';
import { useCurrentUser } from './use-current-user';

export function usePermissions() {
  const { permissions, roles, loading, refresh } = useCurrentUser();

  return {
    permissions,
    roles,
    loading,
    refresh,
    hasPermission: (permissionKey: PermissionKey) => hasPermission(permissions, permissionKey),
    hasAnyPermission: (permissionKeys: PermissionKey[]) => hasAnyPermission(permissions, permissionKeys),
    hasAllPermissions: (permissionKeys: PermissionKey[]) => hasAllPermissions(permissions, permissionKeys),
  };
}

export function useHasPermission(permissionKey: PermissionKey) {
  const { permissions, loading } = useCurrentUser();
  return { allowed: hasPermission(permissions, permissionKey), loading };
}

export function useCanAccessModule(moduleKey: string) {
  const permissionKey = MODULE_ACCESS_PERMISSION[moduleKey];
  const { permissions, loading } = useCurrentUser();
  return {
    allowed: permissionKey ? hasPermission(permissions, permissionKey) : false,
    loading,
  };
}
