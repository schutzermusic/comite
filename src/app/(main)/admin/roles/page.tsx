'use client';

import { useEffect, useMemo, useState } from 'react';
import { Info, Lock, Save, Shield, Undo2 } from 'lucide-react';
import {
  HudBadge,
  HudButton,
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

const PROTECTED_ROLE_KEY = 'owner_admin';

export default function AdminRolesPage() {
  const { organization, permissions, loading: authLoading, refresh: refreshUser } = useCurrentUser();
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [search, setSearch] = useState('');
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const canManageRoles = hasPermission(permissions, 'admin.manage_roles');

  // Local edit state — keys the user has staged for the currently-selected role.
  // Only diverges from the server snapshot when the user toggles a pill.
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [draftKeys, setDraftKeys] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const loadRoles = async () => {
    if (!organization?.id || !canManageRoles) return;
    setLoading(true);
    setLoadError(null);
    const supabase = createClient();
    const { data: roleRows, error: rolesError } = await supabase
      .from('roles')
      .select('id,organization_id,key,name,description,is_system_role')
      .or(`organization_id.is.null,organization_id.eq.${organization.id}`)
      .order('is_system_role', { ascending: false })
      .returns<Role[]>();

    if (rolesError) {
      setLoadError(rolesError.message);
      setRoles([]);
      setLoading(false);
      return;
    }

    const roleIds = (roleRows ?? []).map((role) => role.id);
    const { data: rolePermissionRows, error: permsError } = roleIds.length
      ? await supabase
          .from('role_permissions')
          .select('role_id,permissions(key,module,action)')
          .in('role_id', roleIds)
          .returns<RolePermissionRow[]>()
      : { data: [], error: null };

    if (permsError) {
      setLoadError(permsError.message);
    }

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
    setSelectedRoleId((previous) => {
      if (previous && nextRoles.some((role) => role.id === previous)) return previous;
      return nextRoles[0]?.id ?? null;
    });
    setLoading(false);
  };

  useEffect(() => {
    if (!authLoading) void loadRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, canManageRoles, organization?.id]);

  const filteredRoles = useMemo(() => {
    const term = search.toLowerCase();
    return roles.filter((role) => [role.name, role.key, role.description].filter(Boolean).some((value) => String(value).toLowerCase().includes(term)));
  }, [roles, search]);

  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? filteredRoles[0] ?? null;
  const isProtectedRole = selectedRole?.key === PROTECTED_ROLE_KEY;

  // Sync the local draft when the selected role changes (or after a successful save).
  useEffect(() => {
    if (!selectedRole) {
      setEditingRoleId(null);
      setDraftKeys(new Set());
      return;
    }
    if (editingRoleId !== selectedRole.id) {
      setEditingRoleId(selectedRole.id);
      setDraftKeys(new Set(selectedRole.permissionKeys));
      setSaveError(null);
      setSaveNotice(null);
    }
  }, [selectedRole, editingRoleId]);

  const serverKeys = useMemo(() => new Set(selectedRole?.permissionKeys ?? []), [selectedRole]);

  const diff = useMemo(() => {
    const grant: string[] = [];
    const revoke: string[] = [];
    for (const key of draftKeys) {
      if (!serverKeys.has(key)) grant.push(key);
    }
    for (const key of serverKeys) {
      if (!draftKeys.has(key)) revoke.push(key);
    }
    return { grant, revoke };
  }, [draftKeys, serverKeys]);

  const isDirty = diff.grant.length + diff.revoke.length > 0;
  const editable = Boolean(selectedRole) && !isProtectedRole && !saving;

  const togglePermission = (key: string) => {
    if (!editable) return;
    setSaveError(null);
    setSaveNotice(null);
    setDraftKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const discard = () => {
    if (!selectedRole) return;
    setDraftKeys(new Set(selectedRole.permissionKeys));
    setSaveError(null);
    setSaveNotice(null);
  };

  const save = async () => {
    if (!selectedRole || !isDirty || isProtectedRole) return;
    setSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    try {
      const response = await fetch(`/api/admin/roles/${selectedRole.id}/permissions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(diff),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        applied?: number;
        granted?: number;
        revoked?: number;
        audit_warning?: string;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        setSaveError(payload.error ?? `Falha (HTTP ${response.status})`);
        return;
      }
      setSaveNotice(
        `Aplicado: ${payload.granted ?? 0} grant, ${payload.revoked ?? 0} revoke${
          payload.audit_warning ? ' — atenção: audit log falhou' : ''
        }.`,
      );
      // Reload roles + refresh current user perms so sidebar/route gates re-evaluate.
      await loadRoles();
      await refreshUser();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

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
      <HudPanel elevation={1}>
        <div className="flex items-start gap-3 p-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-ig-accent" />
          <p className="text-sm text-ig-fg-muted">
            Clique nas permissões para alternar grant/revoke. A role <strong>owner_admin</strong> é
            protegida e somente leitura — ela garante que pelo menos um administrador funcional
            sempre permaneça na plataforma.
          </p>
        </div>
      </HudPanel>
      {loadError && (
        <HudPanel elevation={1}>
          <div className="flex items-start gap-3 p-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-ig-danger" />
            <p className="text-sm text-ig-danger">Falha ao carregar roles: {loadError}</p>
          </div>
        </HudPanel>
      )}
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
                {selectedRole.is_system_role && <HudStatusPill variant="warning" size="sm">Sistema</HudStatusPill>}
                {isProtectedRole && (
                  <HudStatusPill variant="critical" size="sm">
                    <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" /> Protegida</span>
                  </HudStatusPill>
                )}
                {!isProtectedRole && isDirty && (
                  <HudStatusPill variant="info" size="sm">
                    {diff.grant.length} grant · {diff.revoke.length} revoke pendentes
                  </HudStatusPill>
                )}
              </div>

              {(saveError || saveNotice) && (
                <div className={`rounded-md border p-3 text-sm ${saveError ? 'border-ig-danger/40 text-ig-danger' : 'border-ig-success/40 text-ig-success'}`}>
                  {saveError ?? saveNotice}
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                {PERMISSION_GROUPS.map((group) => {
                  const activeCount = group.permissions.filter((permission) => draftKeys.has(permission.key)).length;
                  return (
                    <div key={group.module} className="rounded-lg border border-ig-border-subtle bg-ig-panel/40 p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <p className="text-sm font-semibold text-ig-fg-strong">{group.label}</p>
                        <HudBadge variant="outline" size="sm">
                          {activeCount}/{group.permissions.length}
                        </HudBadge>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {group.permissions.map((permission) => {
                          const active = draftKeys.has(permission.key);
                          const wasActive = serverKeys.has(permission.key);
                          const changed = active !== wasActive;
                          return (
                            <button
                              key={permission.key}
                              type="button"
                              onClick={() => togglePermission(permission.key)}
                              disabled={!editable}
                              title={`${permission.key}${changed ? ' (modificado)' : ''}`}
                              className={`rounded-full transition ${editable ? 'cursor-pointer hover:opacity-90' : 'cursor-not-allowed'} ${changed ? 'ring-2 ring-ig-accent/60 ring-offset-1 ring-offset-ig-panel' : ''}`}
                            >
                              <HudStatusPill
                                variant={active ? 'active' : 'neutral'}
                                size="sm"
                                className={active ? '' : 'opacity-40'}
                              >
                                {permission.label}
                              </HudStatusPill>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {!isProtectedRole && (
                <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-3 border-t border-ig-border-subtle bg-ig-panel/95 px-4 py-3 backdrop-blur">
                  <p className="text-xs text-ig-fg-subtle">
                    {isDirty
                      ? 'Alterações pendentes — revise antes de salvar.'
                      : 'Nenhuma alteração pendente.'}
                  </p>
                  <div className="flex items-center gap-2">
                    <HudButton
                      variant="ghost"
                      size="sm"
                      onClick={discard}
                      disabled={!isDirty || saving}
                    >
                      <Undo2 className="h-3.5 w-3.5" /> Descartar
                    </HudButton>
                    <HudButton
                      variant="primary"
                      size="sm"
                      onClick={save}
                      disabled={!isDirty || saving}
                    >
                      <Save className="h-3.5 w-3.5" /> {saving ? 'Salvando…' : 'Salvar alterações'}
                    </HudButton>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <HudEmptyState title="Selecione uma role" description="A matriz aparece aqui." />
          )}
        </HudPanel>
      </div>
    </HudPageLayout>
  );
}
