'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Edit, Lock, Shield, ShieldCheck, UserPlus, Users, X } from 'lucide-react';
import {
  HudBadge,
  HudButton,
  HudDrawer,
  HudEmptyState,
  HudFilterBar,
  HudHeader,
  HudInput,
  HudKpiStrip,
  HudPageLayout,
  HudPanel,
  HudSelect,
  HudStatusPill,
  HudTable,
  type FilterGroup,
  type HudTableColumn,
  type KpiItem,
} from '@/components/hud';
import { AccessRestrictedState } from '@/components/auth/AccessRestrictedState';
import { AccessCustomizer, type OverrideMap } from '@/components/admin/AccessCustomizer';
import { InviteMemberModal } from '@/components/admin/InviteMemberModal';
import { logAuditEvent } from '@/lib/audit/log-audit-event';
import { PERMISSION_GROUPS, hasPermission } from '@/lib/auth/permissions';
import type { Profile, Role } from '@/lib/auth/types';
import { useCurrentUser } from '@/hooks/use-current-user';
import { createClient } from '@/utils/supabase/client';

type UserRoleRow = {
  user_id: string;
  role_id: string;
  roles: Role | null;
};

type ProfileRow = Profile & {
  organizations: { name: string } | null;
};

type AdminUserRow = ProfileRow & {
  roles: Role[];
};

type RolePermissionRow = {
  role_id: string;
  permissions: { key: string } | null;
};

type OverrideRow = {
  user_id: string;
  effect: 'grant' | 'deny';
  permissions: { key: string } | null;
};

const OWNER_ROLE_KEY = 'owner_admin';

export default function AdminUsersPage() {
  const { user: authUser, organization, permissions, loading: authLoading, refresh: refreshUser } = useCurrentUser();
  const [profiles, setProfiles] = useState<AdminUserRow[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permsByRole, setPermsByRole] = useState<Map<string, string[]>>(new Map());
  const [overridesByUser, setOverridesByUser] = useState<Map<string, OverrideMap>>(new Map());
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [drawerUserId, setDrawerUserId] = useState<string | null>(null);
  const [form, setForm] = useState({ full_name: '', job_title: '', department: '', phone: '', status: 'active' });
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteKey, setInviteKey] = useState(0);
  const [topNotice, setTopNotice] = useState<string | null>(null);

  const canManageUsers = hasPermission(permissions, 'admin.manage_users');

  const load = useCallback(async () => {
    if (!organization?.id || !canManageUsers) return;
    setLoading(true);
    const supabase = createClient();

    const [{ data: profileRows }, { data: roleRows }, { data: userRoleRows }] = await Promise.all([
      supabase
        .from('profiles')
        .select('id,user_id,organization_id,full_name,avatar_url,phone,job_title,department,status,created_at,updated_at,organizations(name)')
        .eq('organization_id', organization.id)
        .returns<ProfileRow[]>(),
      supabase
        .from('roles')
        .select('id,organization_id,key,name,description,is_system_role')
        .or(`organization_id.is.null,organization_id.eq.${organization.id}`)
        .order('is_system_role', { ascending: false })
        .returns<Role[]>(),
      supabase
        .from('user_roles')
        .select('user_id,role_id,roles(id,organization_id,key,name,description,is_system_role)')
        .eq('organization_id', organization.id)
        .returns<UserRoleRow[]>(),
    ]);

    const rolesByUser = new Map<string, Role[]>();
    (userRoleRows ?? []).forEach((row) => {
      if (!row.roles) return;
      rolesByUser.set(row.user_id, [...(rolesByUser.get(row.user_id) ?? []), row.roles]);
    });

    const nextRoles = roleRows ?? [];
    const nextProfiles = (profileRows ?? []).map((row) => ({
      ...row,
      roles: rolesByUser.get(row.user_id) ?? [],
    }));

    // Pull role → permission keys so the drawer can compute effective permissions
    // for the user without an extra round-trip per drawer open.
    const roleIds = nextRoles.map((role) => role.id);
    const permMap = new Map<string, string[]>();
    if (roleIds.length > 0) {
      const { data: rolePermRows } = await supabase
        .from('role_permissions')
        .select('role_id,permissions(key)')
        .in('role_id', roleIds)
        .returns<RolePermissionRow[]>();
      for (const row of rolePermRows ?? []) {
        const key = row.permissions?.key;
        if (!key) continue;
        permMap.set(row.role_id, [...(permMap.get(row.role_id) ?? []), key]);
      }
    }

    // Load every override row in the org. RLS scopes via upo_select_scoped:
    // admins see everyone; the result is keyed by target user_id.
    const { data: overrideRows } = await supabase
      .from('user_permission_overrides')
      .select('user_id, effect, permissions(key)')
      .eq('organization_id', organization.id)
      .returns<OverrideRow[]>();
    const overrideMap = new Map<string, OverrideMap>();
    for (const row of overrideRows ?? []) {
      const key = row.permissions?.key;
      if (!key) continue;
      const existing = overrideMap.get(row.user_id) ?? {};
      existing[key] = row.effect;
      overrideMap.set(row.user_id, existing);
    }

    setProfiles(nextProfiles);
    setRoles(nextRoles);
    setPermsByRole(permMap);
    setOverridesByUser(overrideMap);
    setLoading(false);
  }, [canManageUsers, organization?.id]);

  useEffect(() => {
    if (!authLoading) {
      queueMicrotask(() => {
        void load();
      });
    }
  }, [authLoading, load]);

  const filteredProfiles = useMemo(() => {
    const term = search.toLowerCase();
    return profiles.filter((item) => {
      const roleMatch = roleFilter === 'all' || item.roles.some((role) => role.key === roleFilter);
      const statusMatch = statusFilter === 'all' || item.status === statusFilter;
      const searchMatch = [item.full_name, item.department, item.job_title, item.user_id]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
      return roleMatch && statusMatch && searchMatch;
    });
  }, [profiles, roleFilter, search, statusFilter]);

  const drawerUser = useMemo(
    () => profiles.find((row) => row.user_id === drawerUserId) ?? null,
    [profiles, drawerUserId],
  );

  const drawerInheritedKeys = useMemo(() => {
    if (!drawerUser) return new Set<string>();
    const set = new Set<string>();
    for (const role of drawerUser.roles) {
      for (const key of permsByRole.get(role.id) ?? []) set.add(key);
    }
    return set;
  }, [drawerUser, permsByRole]);

  const drawerOverrides = useMemo<OverrideMap>(() => {
    if (!drawerUser) return {};
    return overridesByUser.get(drawerUser.user_id) ?? {};
  }, [drawerUser, overridesByUser]);

  const effectivePermissions = useMemo(() => {
    const set = new Set(drawerInheritedKeys);
    for (const [key, effect] of Object.entries(drawerOverrides)) {
      if (effect === 'grant') set.add(key);
      else if (effect === 'deny') set.delete(key);
    }
    return set;
  }, [drawerInheritedKeys, drawerOverrides]);

  const isSelf = drawerUser?.user_id === authUser?.id;

  const openDrawer = (row: AdminUserRow) => {
    setDrawerUserId(row.user_id);
    setForm({
      full_name: row.full_name ?? '',
      job_title: row.job_title ?? '',
      department: row.department ?? '',
      phone: row.phone ?? '',
      status: row.status,
    });
    setSelectedRoleId('');
    setActionError(null);
    setActionNotice(null);
  };

  const closeDrawer = () => {
    setDrawerUserId(null);
    setActionError(null);
    setActionNotice(null);
  };

  const saveProfile = async () => {
    if (!drawerUser || !organization?.id) return;
    setBusy(true);
    setActionError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.from('profiles').update(form).eq('id', drawerUser.id);
      if (error) {
        setActionError(error.message);
        return;
      }
      await logAuditEvent({
        organizationId: organization.id,
        action: 'user.updated',
        entityType: 'profile',
        entityId: drawerUser.id,
        metadata: { fields: Object.keys(form) },
      });
      setActionNotice('Perfil atualizado.');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const assignRole = async () => {
    if (!drawerUser || !selectedRoleId) return;
    setBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const response = await fetch(`/api/admin/users/${drawerUser.user_id}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role_id: selectedRoleId }),
      });
      const payload = (await response.json()) as { ok: boolean; error?: string; code?: string };
      if (!response.ok || !payload.ok) {
        setActionError(payload.error ?? `Falha (HTTP ${response.status})`);
        return;
      }
      setActionNotice('Role atribuída.');
      setSelectedRoleId('');
      await load();
      if (isSelf) await refreshUser();
    } finally {
      setBusy(false);
    }
  };

  const removeRole = async (roleId: string, roleKey: string, roleName: string) => {
    if (!drawerUser) return;
    if (!window.confirm(`Remover a role "${roleName}" deste usuário?`)) return;
    setBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const response = await fetch(
        `/api/admin/users/${drawerUser.user_id}/roles?role_id=${encodeURIComponent(roleId)}`,
        { method: 'DELETE' },
      );
      const payload = (await response.json()) as { ok: boolean; error?: string; code?: string };
      if (!response.ok || !payload.ok) {
        setActionError(payload.error ?? `Falha (HTTP ${response.status})`);
        return;
      }
      setActionNotice(`Role "${roleKey}" removida.`);
      await load();
      if (isSelf) await refreshUser();
    } finally {
      setBusy(false);
    }
  };

  const applyOverride = async (permissionKey: string, effect: 'grant' | 'deny' | null) => {
    if (!drawerUser) return;
    setBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const url = `/api/admin/users/${drawerUser.user_id}/overrides${
        effect === null ? `?permission_key=${encodeURIComponent(permissionKey)}` : ''
      }`;
      const response = await fetch(url, {
        method: effect === null ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: effect === null ? undefined : JSON.stringify({ permission_key: permissionKey, effect }),
      });
      const payload = (await response.json()) as { ok: boolean; error?: string; code?: string };
      if (!response.ok || !payload.ok) {
        setActionError(payload.error ?? `Falha (HTTP ${response.status})`);
        return;
      }
      setActionNotice(
        effect === null
          ? `Override removido: ${permissionKey}`
          : `${effect === 'grant' ? 'Concedido' : 'Negado'}: ${permissionKey}`,
      );
      await load();
      if (isSelf) await refreshUser();
    } finally {
      setBusy(false);
    }
  };

  const resetOverrides = async () => {
    if (!drawerUser) return;
    if (!window.confirm('Resetar todos os overrides deste usuário (volta para os defaults das roles)?')) return;
    setBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const response = await fetch(`/api/admin/users/${drawerUser.user_id}/overrides`, { method: 'DELETE' });
      const payload = (await response.json()) as { ok: boolean; error?: string; code?: string };
      if (!response.ok || !payload.ok) {
        setActionError(payload.error ?? `Falha (HTTP ${response.status})`);
        return;
      }
      setActionNotice('Overrides resetados.');
      await load();
      if (isSelf) await refreshUser();
    } finally {
      setBusy(false);
    }
  };

  const filterGroups: FilterGroup[] = [
    {
      id: 'role',
      label: 'Role',
      value: roleFilter,
      onChange: setRoleFilter,
      options: [{ value: 'all', label: 'Todas' }, ...roles.map((role) => ({ value: role.key, label: role.name }))],
    },
    {
      id: 'status',
      label: 'Status',
      value: statusFilter,
      onChange: setStatusFilter,
      options: [
        { value: 'all', label: 'Todos' },
        { value: 'active', label: 'Ativo' },
        { value: 'inactive', label: 'Inativo' },
      ],
    },
  ];

  const columns: HudTableColumn<AdminUserRow>[] = [
    {
      key: 'user',
      header: 'Usuario',
      cell: (row) => (
        <div>
          <p className="font-medium text-ig-fg-strong">{row.full_name || 'Sem nome'}</p>
          <p className="text-xs text-ig-fg-subtle">{row.job_title || row.user_id}</p>
        </div>
      ),
    },
    { key: 'department', header: 'Departamento', cell: (row) => row.department || '-' },
    { key: 'organization', header: 'Organizacao', cell: (row) => row.organizations?.name || organization?.name || '-' },
    {
      key: 'roles',
      header: 'Roles',
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.roles.map((role) => <HudBadge key={role.id} variant="outline" size="sm">{role.name}</HudBadge>)}
          {row.roles.length === 0 && <span className="text-xs text-ig-fg-subtle">Sem role</span>}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '110px',
      cell: (row) => <HudStatusPill variant={row.status === 'active' ? 'active' : 'neutral'} size="sm">{row.status}</HudStatusPill>,
    },
    {
      key: 'actions',
      header: 'Acoes',
      align: 'right',
      width: '110px',
      cell: (row) => (
        <HudButton variant="ghost" size="sm" leftIcon={<Edit className="h-4 w-4" />} onClick={() => openDrawer(row)}>
          Acessos
        </HudButton>
      ),
    },
  ];

  const kpis: KpiItem[] = [
    { id: 'users', label: 'Usuarios', value: profiles.length, variant: 'info', icon: <Users className="h-5 w-5" /> },
    { id: 'active', label: 'Ativos', value: profiles.filter((item) => item.status === 'active').length, variant: 'success', icon: <Shield className="h-5 w-5" /> },
    { id: 'roles', label: 'Roles', value: roles.length, variant: 'warning', icon: <Shield className="h-5 w-5" /> },
  ];

  if (!authLoading && !canManageUsers) {
    return <HudPageLayout><AccessRestrictedState /></HudPageLayout>;
  }

  const assignableRoles = roles.filter((role) => !drawerUser?.roles.some((current) => current.id === role.id));

  return (
    <HudPageLayout>
      <HudHeader
        title="Admin / Users"
        subtitle="Perfis, status e atribuicao de roles por organizacao."
        icon={<Users size={18} />}
        iconTint="#17C3B2"
        actions={
          <HudButton
            variant="primary"
            leftIcon={<UserPlus className="h-4 w-4" />}
            onClick={() => {
              setTopNotice(null);
              setInviteKey((value) => value + 1);
              setInviteOpen(true);
            }}
          >
            Convidar membro
          </HudButton>
        }
      />
      <HudKpiStrip kpis={kpis} columns={3} />
      {topNotice && (
        <div className="rounded-md border border-ig-success/40 bg-ig-success/5 p-3 text-sm text-ig-success">
          {topNotice}
        </div>
      )}
      <HudFilterBar
        searchPlaceholder="Buscar por nome, departamento, cargo ou user id"
        searchValue={search}
        onSearchChange={setSearch}
        filterGroups={filterGroups}
        onClearFilters={() => {
          setSearch('');
          setRoleFilter('all');
          setStatusFilter('all');
        }}
      />
      <HudPanel elevation={2}>
        <HudTable
          columns={columns}
          data={filteredProfiles}
          keyExtractor={(row) => row.id}
          loading={loading || authLoading}
          emptyState={<HudEmptyState title="Nenhum usuario encontrado" description="Profiles aparecerao aqui apos onboarding ou convite." />}
        />
      </HudPanel>

      <HudDrawer
        isOpen={Boolean(drawerUser)}
        onClose={closeDrawer}
        title={drawerUser?.full_name || 'Usuário'}
        subtitle={drawerUser?.user_id}
        width="540px"
      >
        {drawerUser && (
          <div className="flex h-full flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <HudStatusPill variant={drawerUser.status === 'active' ? 'active' : 'neutral'} size="sm">
                {drawerUser.status}
              </HudStatusPill>
              {isSelf && (
                <HudStatusPill variant="info" size="sm">
                  <span className="inline-flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3" /> Você
                  </span>
                </HudStatusPill>
              )}
              {drawerUser.roles.some((role) => role.key === OWNER_ROLE_KEY) && (
                <HudStatusPill variant="critical" size="sm">
                  <span className="inline-flex items-center gap-1">
                    <Lock className="h-3 w-3" /> Owner/Admin
                  </span>
                </HudStatusPill>
              )}
            </div>

            {(actionError || actionNotice) && (
              <div className={`rounded-md border p-3 text-sm ${actionError ? 'border-ig-danger/40 text-ig-danger' : 'border-ig-success/40 text-ig-success'}`}>
                {actionError ?? actionNotice}
              </div>
            )}

            <HudPanel elevation={1} title="Perfil">
              <div className="grid gap-3">
                <HudInput label="Nome" value={form.full_name} onChange={(event) => setForm((prev) => ({ ...prev, full_name: event.target.value }))} />
                <HudInput label="Cargo" value={form.job_title} onChange={(event) => setForm((prev) => ({ ...prev, job_title: event.target.value }))} />
                <HudInput label="Departamento" value={form.department} onChange={(event) => setForm((prev) => ({ ...prev, department: event.target.value }))} />
                <HudInput label="Telefone" value={form.phone} onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} />
                <HudSelect
                  label="Status"
                  value={form.status}
                  onChange={(value) => setForm((prev) => ({ ...prev, status: value }))}
                  options={[{ value: 'active', label: 'Ativo' }, { value: 'inactive', label: 'Inativo' }]}
                />
                <div className="flex justify-end">
                  <HudButton variant="primary" size="sm" onClick={saveProfile} disabled={busy}>
                    Salvar perfil
                  </HudButton>
                </div>
              </div>
            </HudPanel>

            <HudPanel elevation={1} title="Roles atribuídas">
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {drawerUser.roles.map((role) => (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => removeRole(role.id, role.key, role.name)}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-full border border-ig-border-subtle px-3 py-1 text-xs text-ig-fg-strong transition hover:border-ig-danger hover:text-ig-danger disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {role.name}
                      <X className="h-3 w-3" />
                    </button>
                  ))}
                  {drawerUser.roles.length === 0 && (
                    <span className="text-xs text-ig-fg-subtle">Nenhuma role atribuída.</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <HudSelect
                    value={selectedRoleId}
                    onChange={setSelectedRoleId}
                    placeholder={assignableRoles.length ? 'Selecionar role' : 'Sem roles disponíveis'}
                    options={assignableRoles.map((role) => ({ value: role.id, label: role.name }))}
                  />
                  <HudButton variant="secondary" size="sm" onClick={assignRole} disabled={busy || !selectedRoleId}>
                    Atribuir
                  </HudButton>
                </div>
              </div>
            </HudPanel>

            <HudPanel
              elevation={1}
              title={`Acesso efetivo (${effectivePermissions.size})`}
            >
              <AccessCustomizer
                inheritedKeys={drawerInheritedKeys}
                overrides={drawerOverrides}
                onOverrideChange={applyOverride}
                onReset={resetOverrides}
                disabled={busy}
              />
              <p className="mt-3 text-[11px] leading-snug text-ig-fg-subtle">
                Resolução: <strong>(roles ∪ grants) − denies</strong>. As alterações persistem como
                overrides por usuário e refletem em sidebar/rotas via <code>current_user_has_permission</code>.
              </p>
            </HudPanel>
          </div>
        )}
      </HudDrawer>

      <InviteMemberModal
        key={inviteKey}
        isOpen={inviteOpen}
        onClose={() => setInviteOpen(false)}
        roles={roles}
        permsByRole={permsByRole}
        onSubmit={async (payload) => {
          const response = await fetch('/api/admin/invitations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const json = (await response.json()) as { ok: boolean; error?: string; code?: string; email?: string };
          if (response.ok && json.ok) {
            setTopNotice(`Convite enviado para ${json.email ?? payload.email}.`);
            await load();
            return { ok: true };
          }
          return { ok: false, error: json.error ?? `Falha (HTTP ${response.status})`, code: json.code };
        }}
      />
    </HudPageLayout>
  );
}
