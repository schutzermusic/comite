'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Edit,
  KeyRound,
  Lock,
  Plus,
  Shield,
  Trash2,
  Users,
} from 'lucide-react';
import { useHudToast } from '@/hooks/useHudToast';
import { globalRoles as mockRoles, users as mockUsers } from '@/lib/mock-data';
import {
  HudBadge,
  HudButton,
  HudEmptyState,
  HudHeader,
  HudInput,
  HudKpiStrip,
  HudModal,
  HudPageLayout,
  HudPanel,
  HudSelect,
  HudStatusPill,
  type KpiItem,
} from '@/components/hud';

const PERMISSION_CATEGORIES = [
  {
    name: 'Projetos',
    permissions: [
      { key: 'projetos_visualizar', label: 'Visualizar projetos' },
      { key: 'projetos_criar', label: 'Criar projetos' },
      { key: 'projetos_editar', label: 'Editar projetos' },
      { key: 'projetos_deletar', label: 'Deletar projetos' },
    ],
  },
  {
    name: 'Comitês',
    permissions: [
      { key: 'comites_visualizar', label: 'Visualizar comitês' },
      { key: 'comites_criar', label: 'Criar comitês' },
      { key: 'comites_editar', label: 'Editar comitês' },
      { key: 'comites_deletar', label: 'Deletar comitês' },
    ],
  },
  {
    name: 'Pautas',
    permissions: [
      { key: 'pautas_visualizar', label: 'Visualizar pautas' },
      { key: 'pautas_criar', label: 'Criar pautas' },
      { key: 'pautas_editar', label: 'Editar pautas' },
      { key: 'pautas_deletar', label: 'Deletar pautas' },
      { key: 'pautas_votar', label: 'Votar em pautas' },
      { key: 'pautas_iniciar_votacao', label: 'Iniciar votações' },
    ],
  },
  {
    name: 'Reuniões',
    permissions: [
      { key: 'reunioes_visualizar', label: 'Visualizar reuniões' },
      { key: 'reunioes_criar', label: 'Criar reuniões' },
      { key: 'reunioes_editar', label: 'Editar reuniões' },
      { key: 'reunioes_deletar', label: 'Deletar reuniões' },
      { key: 'reunioes_ata', label: 'Registrar atas' },
    ],
  },
  {
    name: 'Membros',
    permissions: [
      { key: 'membros_visualizar', label: 'Visualizar membros' },
      { key: 'membros_gerenciar', label: 'Gerenciar membros' },
    ],
  },
  {
    name: 'Relatórios',
    permissions: [
      { key: 'relatorios_visualizar', label: 'Visualizar relatórios' },
      { key: 'relatorios_exportar', label: 'Exportar relatórios' },
      { key: 'relatorios_avancados', label: 'Relatórios avançados' },
    ],
  },
  {
    name: 'Financeiro',
    permissions: [
      { key: 'financeiro_visualizar', label: 'Visualizar dados financeiros' },
      { key: 'financeiro_editar', label: 'Editar dados financeiros' },
    ],
  },
  {
    name: 'Sistema',
    permissions: [
      { key: 'sistema_configuracoes', label: 'Configurações do sistema' },
      { key: 'sistema_usuarios', label: 'Gerenciar usuários' },
      { key: 'sistema_roles', label: 'Gerenciar funções' },
    ],
  },
];

type GlobalRole = {
  id: string;
  nome: string;
  descricao?: string;
  tipo: string;
  nivel_acesso?: number;
  cor?: string;
  is_system_role?: boolean;
  permissoes?: Record<string, boolean>;
};

type RoleFormData = {
  nome: string;
  descricao: string;
  tipo: string;
  nivel_acesso: number;
  permissoes: Record<string, boolean>;
};

const EMPTY_FORM: RoleFormData = {
  nome: '',
  descricao: '',
  tipo: 'custom',
  nivel_acesso: 1,
  permissoes: {},
};

const ROLE_TYPE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'project_manager', label: 'Project Manager' },
  { value: 'committee_member', label: 'Committee Member' },
  { value: 'viewer', label: 'Viewer' },
  { value: 'custom', label: 'Custom' },
];

const countPermissions = (role: GlobalRole) =>
  Object.values(role.permissoes ?? {}).filter((value) => value).length;

export default function GerenciarRolesGlobal() {
  const router = useRouter();
  const { toast } = useHudToast();
  const [showDialog, setShowDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [editingRole, setEditingRole] = useState<GlobalRole | null>(null);
  const [deletingRole, setDeletingRole] = useState<GlobalRole | null>(null);
  const [roles, setRoles] = useState<GlobalRole[]>(mockRoles);
  const [formData, setFormData] = useState<RoleFormData>(EMPTY_FORM);

  const resetForm = () => {
    setFormData(EMPTY_FORM);
    setEditingRole(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setShowDialog(true);
  };

  const handleEdit = (role: GlobalRole) => {
    setEditingRole(role);
    setFormData({
      nome: role.nome,
      descricao: role.descricao ?? '',
      tipo: role.tipo,
      nivel_acesso: role.nivel_acesso ?? 1,
      permissoes: role.permissoes ?? {},
    });
    setShowDialog(true);
  };

  const handleSubmit = () => {
    if (!formData.nome) {
      toast({ title: 'Erro', description: 'Preencha o nome da função', variant: 'destructive' });
      return;
    }

    if (editingRole) {
      setRoles((currentRoles) =>
        currentRoles.map((role) =>
          role.id === editingRole.id ? { ...editingRole, ...formData } : role
        )
      );
      toast({ title: 'Função atualizada com sucesso!' });
    } else {
      setRoles((currentRoles) => [
        ...currentRoles,
        { ...formData, id: `role-global-${Date.now()}`, is_system_role: false },
      ]);
      toast({ title: 'Função criada com sucesso!' });
    }

    setShowDialog(false);
    resetForm();
  };

  const handleDelete = () => {
    if (!deletingRole) return;

    setRoles((currentRoles) => currentRoles.filter((role) => role.id !== deletingRole.id));
    setShowDeleteDialog(false);
    setDeletingRole(null);
    toast({ title: 'Função excluída com sucesso!' });
  };

  const handlePermissionChange = (key: string, value: boolean) => {
    setFormData((previous) => ({
      ...previous,
      permissoes: {
        ...previous.permissoes,
        [key]: value,
      },
    }));
  };

  const getUsersWithRole = (roleId: string) =>
    mockUsers.filter((user) => user.papelPrincipal === 'admin' && roleId.includes('admin')).length;

  const totalPermissions = roles.reduce((sum, role) => sum + countPermissions(role), 0);

  const kpiItems: KpiItem[] = [
    { id: 'roles', value: roles.length, label: 'Funções', variant: 'info', icon: <Shield className="w-5 h-5" /> },
    { id: 'system', value: roles.filter((role) => role.is_system_role).length, label: 'Sistema', variant: 'warning', icon: <Lock className="w-5 h-5" /> },
    { id: 'custom', value: roles.filter((role) => !role.is_system_role).length, label: 'Customizadas', variant: 'success', icon: <KeyRound className="w-5 h-5" /> },
    { id: 'permissions', value: totalPermissions, label: 'Permissões ativas', variant: 'info', icon: <Users className="w-5 h-5" /> },
  ];

  return (
    <HudPageLayout>
      <HudHeader
        title="Permissões & Roles"
        subtitle="Sistema de controle de acesso baseado em funções (RBAC)"
        icon={<Lock size={18} />}
        iconTint="#EF4B55"
        breadcrumbs={[{ label: 'Permissões' }]}
        actions={
          <div className="flex items-center gap-2">
            <HudButton
              variant="secondary"
              size="md"
              leftIcon={<ArrowLeft className="w-4 h-4" />}
              onClick={() => router.push('/dashboard')}
            >
              Dashboard
            </HudButton>
            <HudButton
              variant="primary"
              size="md"
              leftIcon={<Plus className="w-4 h-4" />}
              onClick={openCreateDialog}
            >
              Nova Função
            </HudButton>
          </div>
        }
      />

      <HudKpiStrip kpis={kpiItems} columns={4} />

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {roles.map((role, index) => {
          const permCount = countPermissions(role);
          const userCount = getUsersWithRole(role.id);

          return (
            <HudPanel key={role.id} elevation={2} delay={index * 0.04} className="h-full">
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="rounded-xl border border-ig-border-focus bg-ig-accent-weak p-3 text-ig-accent">
                      <Shield className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-ig-fg-strong">{role.nome}</h3>
                      <HudStatusPill variant="info" size="sm">
                        {role.tipo}
                      </HudStatusPill>
                    </div>
                  </div>

                  {!role.is_system_role && (
                    <div className="flex gap-1">
                      <HudButton
                        variant="ghost"
                        size="sm"
                        leftIcon={<Edit className="w-4 h-4" />}
                        onClick={() => handleEdit(role)}
                      />
                      <HudButton
                        variant="danger"
                        size="sm"
                        leftIcon={<Trash2 className="w-4 h-4" />}
                        onClick={() => {
                          setDeletingRole(role);
                          setShowDeleteDialog(true);
                        }}
                      />
                    </div>
                  )}
                </div>

                {role.descricao && (
                  <p className="text-sm text-ig-fg-muted">{role.descricao}</p>
                )}

                <div className="space-y-2 border-t border-ig-border pt-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ig-fg-muted">Permissões ativas</span>
                    <span className="font-semibold text-ig-fg-strong tabular-nums">{permCount}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ig-fg-muted">Usuários com esta função</span>
                    <span className="font-semibold text-ig-fg-strong tabular-nums">{userCount}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ig-fg-muted">Nível de acesso</span>
                    <HudStatusPill variant="neutral" size="sm">
                      {role.nivel_acesso ?? 1}/10
                    </HudStatusPill>
                  </div>
                </div>

                {role.is_system_role && (
                  <div className="border-t border-ig-border pt-3">
                    <HudStatusPill variant="warning">
                      <Lock className="w-3 h-3 mr-1" />
                      Função do Sistema
                    </HudStatusPill>
                  </div>
                )}
              </div>
            </HudPanel>
          );
        })}
      </section>

      {roles.length === 0 && (
        <HudPanel>
          <HudEmptyState
            icon="custom"
            customIcon={<Shield className="w-12 h-12" />}
            title="Nenhuma função criada"
            description="Crie funções para controlar o acesso dos usuários"
            action={{ label: 'Criar Primeira Função', onClick: openCreateDialog, variant: 'primary' }}
          />
        </HudPanel>
      )}

      <HudModal
        isOpen={showDialog}
        onClose={() => setShowDialog(false)}
        title={editingRole ? 'Editar Função' : 'Nova Função'}
        size="xl"
        footer={
          <>
            <HudButton variant="secondary" onClick={() => setShowDialog(false)}>
              Cancelar
            </HudButton>
            <HudButton variant="primary" onClick={handleSubmit}>
              {editingRole ? 'Atualizar' : 'Criar'} Função
            </HudButton>
          </>
        }
      >
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <HudInput
              label="Nome da Função"
              value={formData.nome}
              onChange={(event) => setFormData((previous) => ({ ...previous, nome: event.target.value }))}
              placeholder="Ex: Gerente de Projetos"
            />

            <HudSelect
              label="Tipo"
              value={formData.tipo}
              onChange={(value) => setFormData((previous) => ({ ...previous, tipo: value }))}
              options={ROLE_TYPE_OPTIONS}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium hud-label uppercase tracking-wider">
              Descrição
            </label>
            <textarea
              value={formData.descricao}
              onChange={(event) =>
                setFormData((previous) => ({ ...previous, descricao: event.target.value }))
              }
              placeholder="Descreva as responsabilidades desta função..."
              rows={3}
              className="min-h-[96px] w-full resize-y rounded-lg border border-ig-border bg-ig-panel px-4 py-3 text-sm text-ig-fg-strong placeholder:text-ig-fg-subtle focus:border-ig-border-focus focus:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <HudInput
              label="Nível de Acesso (1-10)"
              type="number"
              min="1"
              max="10"
              value={formData.nivel_acesso}
              onChange={(event) =>
                setFormData((previous) => ({
                  ...previous,
                  nivel_acesso: Number.parseInt(event.target.value, 10) || 1,
                }))
              }
            />
          </div>

          <div className="space-y-4">
            <h3 className="font-semibold tracking-wide text-ig-fg-strong">Permissões</h3>
            {PERMISSION_CATEGORIES.map((category) => (
              <div
                key={category.name}
                className="space-y-3 rounded-lg border border-ig-border bg-ig-raised p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <h4 className="font-medium text-ig-fg-strong">{category.name}</h4>
                  <HudBadge variant="subtle" size="sm">
                    {category.permissions.length} itens
                  </HudBadge>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {category.permissions.map((permission) => (
                    <label
                      key={permission.key}
                      htmlFor={permission.key}
                      className="flex cursor-pointer items-center justify-between gap-3 rounded border border-ig-border bg-ig-panel p-2 text-sm text-ig-fg"
                    >
                      <span>{permission.label}</span>
                      <input
                        id={permission.key}
                        type="checkbox"
                        checked={formData.permissoes[permission.key] ?? false}
                        onChange={(event) =>
                          handlePermissionChange(permission.key, event.target.checked)
                        }
                        className="h-4 w-4 accent-[var(--ig-accent)]"
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </HudModal>

      <HudModal
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        title="Excluir Função"
        size="sm"
        footer={
          <>
            <HudButton variant="secondary" onClick={() => setShowDeleteDialog(false)}>
              Cancelar
            </HudButton>
            <HudButton variant="danger" onClick={handleDelete}>
              Excluir
            </HudButton>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-ig-fg-muted">
            Tem certeza que deseja excluir a função "{deletingRole?.nome}"?
          </p>
          {deletingRole && getUsersWithRole(deletingRole.id) > 0 && (
            <p className="text-sm font-medium text-ig-danger">
              {getUsersWithRole(deletingRole.id)} usuário(s) possui(em) esta função.
            </p>
          )}
        </div>
      </HudModal>
    </HudPageLayout>
  );
}
