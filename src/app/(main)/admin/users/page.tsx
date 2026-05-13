'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Edit, Shield, UserPlus, Users } from 'lucide-react';
import {
  HudBadge,
  HudButton,
  HudEmptyState,
  HudFilterBar,
  HudHeader,
  HudInput,
  HudKpiStrip,
  HudModal,
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
import { logAuditEvent } from '@/lib/audit/log-audit-event';
import { hasPermission } from '@/lib/auth/permissions';
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

export default function AdminUsersPage() {
  const { profile: currentProfile, organization, permissions, loading: authLoading } = useCurrentUser();
  const [profiles, setProfiles] = useState<AdminUserRow[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [editingProfile, setEditingProfile] = useState<AdminUserRow | null>(null);
  const [form, setForm] = useState({ full_name: '', job_title: '', department: '', phone: '', status: 'active' });
  const [selectedRoleId, setSelectedRoleId] = useState('');

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

    setProfiles((profileRows ?? []).map((row) => ({ ...row, roles: rolesByUser.get(row.user_id) ?? [] })));
    setRoles(roleRows ?? []);
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

  const openEdit = (row: AdminUserRow) => {
    setEditingProfile(row);
    setForm({
      full_name: row.full_name ?? '',
      job_title: row.job_title ?? '',
      department: row.department ?? '',
      phone: row.phone ?? '',
      status: row.status,
    });
    setSelectedRoleId('');
  };

  const saveProfile = async () => {
    if (!editingProfile || !organization?.id) return;
    const supabase = createClient();
    await supabase.from('profiles').update(form).eq('id', editingProfile.id);
    await logAuditEvent({
      organizationId: organization.id,
      action: 'user.updated',
      entityType: 'profile',
      entityId: editingProfile.id,
      metadata: { fields: Object.keys(form) },
    });
    setEditingProfile(null);
    await load();
  };

  const assignRole = async () => {
    if (!editingProfile || !organization?.id || !selectedRoleId) return;
    const supabase = createClient();
    await supabase.from('user_roles').upsert({
      user_id: editingProfile.user_id,
      role_id: selectedRoleId,
      organization_id: organization.id,
    });
    await logAuditEvent({
      organizationId: organization.id,
      action: 'role.assigned',
      entityType: 'user_role',
      metadata: { user_id: editingProfile.user_id, role_id: selectedRoleId },
    });
    setSelectedRoleId('');
    await load();
  };

  const removeRole = async (roleId: string) => {
    if (!editingProfile || !organization?.id) return;
    const supabase = createClient();
    await supabase
      .from('user_roles')
      .delete()
      .eq('user_id', editingProfile.user_id)
      .eq('role_id', roleId)
      .eq('organization_id', organization.id);
    await logAuditEvent({
      organizationId: organization.id,
      action: 'role.removed',
      entityType: 'user_role',
      metadata: { user_id: editingProfile.user_id, role_id: roleId },
    });
    await load();
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
        <HudButton variant="ghost" size="sm" leftIcon={<Edit className="h-4 w-4" />} onClick={() => openEdit(row)}>
          Editar
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

  return (
    <HudPageLayout>
      <HudHeader
        title="Admin / Users"
        subtitle="Perfis, status e atribuicao de roles por organizacao."
        icon={<Users size={18} />}
        iconTint="#17C3B2"
        actions={<HudButton variant="secondary" leftIcon={<UserPlus className="h-4 w-4" />}>Convite em breve</HudButton>}
      />
      <HudKpiStrip kpis={kpis} columns={3} />
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

      <HudModal
        isOpen={Boolean(editingProfile)}
        onClose={() => setEditingProfile(null)}
        title="Editar usuario"
        subtitle={editingProfile?.full_name || editingProfile?.user_id}
        size="lg"
        footer={
          <>
            <HudButton variant="secondary" onClick={() => setEditingProfile(null)}>Cancelar</HudButton>
            <HudButton variant="primary" onClick={saveProfile}>Salvar</HudButton>
          </>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
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
          <div className="md:col-span-2 rounded-lg border border-ig-border-subtle bg-ig-panel/40 p-3">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-ig-fg-muted">Roles atribuidas</p>
            <div className="flex flex-wrap gap-2">
              {editingProfile?.roles.map((role) => (
                <button key={role.id} type="button" onClick={() => removeRole(role.id)} className="rounded-lg border border-ig-border-subtle px-3 py-1.5 text-xs text-ig-fg-strong hover:border-ig-danger hover:text-ig-danger">
                  {role.name} x
                </button>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <HudSelect
                value={selectedRoleId}
                onChange={setSelectedRoleId}
                placeholder="Selecionar role"
                options={roles.map((role) => ({ value: role.id, label: role.name }))}
              />
              <HudButton variant="secondary" onClick={assignRole}>Atribuir</HudButton>
            </div>
          </div>
          {currentProfile?.id === editingProfile?.id && (
            <p className="md:col-span-2 text-xs text-ig-fg-subtle">Edicoes no proprio usuario podem exigir refresh para refletir permissoes.</p>
          )}
        </div>
      </HudModal>
    </HudPageLayout>
  );
}
