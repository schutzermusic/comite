'use client';

import { useEffect, useMemo, useState } from 'react';
import { Lock, Shield } from 'lucide-react';
import {
  HudBadge,
  HudEmptyState,
  HudFilterBar,
  HudHeader,
  HudKpiStrip,
  HudPageLayout,
  HudPanel,
  HudStatusPill,
  HudTable,
  type HudTableColumn,
  type KpiItem,
} from '@/components/hud';
import { AccessRestrictedState } from '@/components/auth/AccessRestrictedState';
import { PERMISSION_GROUPS, hasPermission } from '@/lib/auth/permissions';
import type { Role } from '@/lib/auth/types';
import { useCurrentUser } from '@/hooks/use-current-user';
import { createClient } from '@/utils/supabase/client';

type RolePermissionRow = {
  role_id: string;
  permissions: { key: string; module: string; action: string } | null;
};

type RoleRow = Role & {
  permissionKeys: string[];
};

export default function AdminRolesPage() {
  const { organization, permissions, loading: authLoading } = useCurrentUser();
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [search, setSearch] = useState('');
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const canManageRoles = hasPermission(permissions, 'admin.manage_roles');

  useEffect(() => {
    const load = async () => {
      if (!organization?.id || !canManageRoles) return;
      setLoading(true);
      const supabase = createClient();
      const { data: roleRows } = await supabase
        .from('roles')
        .select('id,organization_id,key,name,description,is_system_role')
        .or(`organization_id.is.null,organization_id.eq.${organization.id}`)
        .order('is_system_role', { ascending: false })
        .returns<Role[]>();

      const roleIds = (roleRows ?? []).map((role) => role.id);
      const { data: rolePermissionRows } = roleIds.length
        ? await supabase
            .from('role_permissions')
            .select('role_id,permissions(key,module,action)')
            .in('role_id', roleIds)
            .returns<RolePermissionRow[]>()
        : { data: [] };

      const permissionsByRole = new Map<string, string[]>();
      (rolePermissionRows ?? []).forEach((row) => {
        if (!row.permissions?.key) return;
        permissionsByRole.set(row.role_id, [...(permissionsByRole.get(row.role_id) ?? []), row.permissions.key]);
      });

      const nextRoles = (roleRows ?? []).map((role) => ({
        ...role,
        permissionKeys: permissionsByRole.get(role.id) ?? [],
      }));
      setRoles(nextRoles);
      setSelectedRoleId((previous) => previous ?? nextRoles[0]?.id ?? null);
      setLoading(false);
    };

    if (!authLoading) void load();
  }, [authLoading, canManageRoles, organization?.id]);

  const filteredRoles = useMemo(() => {
    const term = search.toLowerCase();
    return roles.filter((role) => [role.name, role.key, role.description].filter(Boolean).some((value) => String(value).toLowerCase().includes(term)));
  }, [roles, search]);

  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? filteredRoles[0] ?? null;

  const columns: HudTableColumn<RoleRow>[] = [
    {
      key: 'role',
      header: 'Role',
      cell: (role) => (
        <div>
          <p className="font-medium text-ig-fg-strong">{role.name}</p>
          <p className="text-xs text-ig-fg-subtle">{role.key}</p>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Tipo',
      width: '120px',
      cell: (role) => role.is_system_role ? <HudStatusPill variant="warning" size="sm">Sistema</HudStatusPill> : <HudStatusPill variant="info" size="sm">Custom</HudStatusPill>,
    },
    {
      key: 'permissions',
      header: 'Permissoes',
      width: '130px',
      align: 'center',
      cell: (role) => <HudBadge variant="outline">{role.permissionKeys.length}</HudBadge>,
    },
  ];

  const kpis: KpiItem[] = [
    { id: 'roles', label: 'Roles', value: roles.length, variant: 'info', icon: <Shield className="h-5 w-5" /> },
    { id: 'system', label: 'Sistema', value: roles.filter((role) => role.is_system_role).length, variant: 'warning', icon: <Lock className="h-5 w-5" /> },
    { id: 'perms', label: 'Permissoes', value: PERMISSION_GROUPS.reduce((sum, group) => sum + group.permissions.length, 0), variant: 'success', icon: <Shield className="h-5 w-5" /> },
  ];

  if (!authLoading && !canManageRoles) {
    return <HudPageLayout><AccessRestrictedState /></HudPageLayout>;
  }

  return (
    <HudPageLayout>
      <HudHeader
        title="Admin / Roles"
        subtitle="Matriz RBAC por modulo, role e permissao."
        icon={<Shield size={18} />}
        iconTint="#F59E0B"
      />
      <HudKpiStrip kpis={kpis} columns={3} />
      <HudFilterBar
        searchPlaceholder="Buscar role por nome, chave ou descricao"
        searchValue={search}
        onSearchChange={setSearch}
        onClearFilters={() => setSearch('')}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
        <HudPanel elevation={2} title="Roles">
          <HudTable
            columns={columns}
            data={filteredRoles}
            keyExtractor={(role) => role.id}
            loading={loading || authLoading}
            selectedRowId={selectedRole?.id}
            onRowClick={(role) => setSelectedRoleId(role.id)}
            emptyState={<HudEmptyState title="Nenhuma role encontrada" description="System roles serao criadas pela migracao RBAC." />}
          />
        </HudPanel>
        <HudPanel elevation={2} title={selectedRole ? selectedRole.name : 'Permissoes'}>
          {selectedRole ? (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <HudBadge variant="outline">{selectedRole.key}</HudBadge>
                {selectedRole.is_system_role && <HudStatusPill variant="warning" size="sm">Protegida contra edicao destrutiva</HudStatusPill>}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {PERMISSION_GROUPS.map((group) => {
                  const activeCount = group.permissions.filter((permission) => selectedRole.permissionKeys.includes(permission.key)).length;
                  if (activeCount === 0) return null;
                  return (
                    <div key={group.module} className="rounded-lg border border-ig-border-subtle bg-ig-panel/40 p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <p className="text-sm font-semibold text-ig-fg-strong">{group.label}</p>
                        <HudBadge variant="outline" size="sm">{activeCount}</HudBadge>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {group.permissions.map((permission) => (
                          <HudStatusPill
                            key={permission.key}
                            variant={selectedRole.permissionKeys.includes(permission.key) ? 'active' : 'neutral'}
                            size="sm"
                            className={selectedRole.permissionKeys.includes(permission.key) ? '' : 'opacity-35'}
                          >
                            {permission.label}
                          </HudStatusPill>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <HudEmptyState title="Selecione uma role" description="A matriz aparece aqui." />
          )}
        </HudPanel>
      </div>
    </HudPageLayout>
  );
}
