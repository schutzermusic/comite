'use client';

import React, { useState } from 'react';
import {
  Users,
  Shield,
  Briefcase,
  Mail,
  Building2,
  Eye,
  Edit,
  UserPlus,
  UserCheck,
} from 'lucide-react';
import { useHudToast } from '@/hooks/useHudToast';
import { users as mockUsers, projects, votes, pautas as mockPautas } from '@/lib/mock-data';
import ActivityHistory from "@/components/member/ActivityHistory";
import { InviteMemberDialog } from "@/components/member/InviteMemberDialog";

import {
  HudPageLayout,
  HudHeader,
  HudKpiStrip,
  HudFilterBar,
  HudPanel,
  HudTable,
  HudButton,
  HudStatusPill,
  HudBadge,
  HudModal,
  HudSelect,
  HudEmptyState,
  type KpiItem,
  type FilterGroup,
  type HudTableColumn,
} from '@/components/hud';

const comites = projects
  .map((p) => ({ id: p.comite_id, nome: p.comite_nome }))
  .filter((v, i, a) => v.id && a.findIndex((t) => t.id === v.id) === i) as { id: string; nome: string }[];

const roles = [
  { id: '1', comite_id: 'com-1', nome: 'Admin', cor: '#EF4444' },
  { id: '2', comite_id: 'com-2', nome: 'Member', cor: '#3B82F6' },
  { id: '3', comite_id: 'com-3', nome: 'Leitor', cor: '#22C55E' },
];

const membrosComite = [
  { id: 'mc-1', usuario_email: 'alice@insight.com', comite_id: 'com-1', comite_nome: 'Comitê Estratégico', role_id: '1', role_nome: 'Admin' },
  { id: 'mc-2', usuario_email: 'robert@insight.com', comite_id: 'com-1', comite_nome: 'Comitê Estratégico', role_id: '2', role_nome: 'Member' },
  { id: 'mc-3', usuario_email: 'robert@insight.com', comite_id: 'com-2', comite_nome: 'Comitê Técnico', role_id: '2', role_nome: 'Member' },
  { id: 'mc-4', usuario_email: 'carlos@insight.com', comite_id: 'com-2', comite_nome: 'Comitê Técnico', role_id: '2', role_nome: 'Member' },
  { id: 'mc-5', usuario_email: 'diana@insight.com', comite_id: 'com-3', comite_nome: 'Comitê de Inovação', role_id: '3', role_nome: 'Leitor' },
];

type MemberMembership = (typeof membrosComite)[number];
type MemberData = (typeof mockUsers)[number] & {
  comites: MemberMembership[];
  totalVotos: number;
  totalPautas: number;
};
type PautaWithCreator = (typeof mockPautas)[number] & { created_by?: string };

export default function GerenciarMembrosPage() {
  const { toast } = useHudToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [comiteFilter, setComiteFilter] = useState('all');
  const [categoriaFilter, setCategoriaFilter] = useState('all');
  // Single-select KPI filter (padrão Contratos): clicar filtra, clicar de novo limpa.
  const [kpiFilter, setKpiFilter] = useState<'com_comite' | 'multi_comite' | null>(null);
  const toggleKpiFilter = (key: 'com_comite' | 'multi_comite') =>
    setKpiFilter((current) => (current === key ? null : key));

  const [selectedMember, setSelectedMember] = useState<MemberData | null>(null);
  const [showActivityDialog, setShowActivityDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [editingMembership, setEditingMembership] = useState<MemberMembership | null>(null);
  const [newRoleId, setNewRoleId] = useState('');

  const getUserInitials = (name: string | undefined) => {
    if (!name) return 'U';
    return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const membersData = mockUsers.map((user) => {
    const userMemberships = membrosComite.filter((m) => m.usuario_email === user.email);
    const userVotes = votes.filter((v) => v.usuario_email === user.email);
    const userPautas = mockPautas.filter((p) => (p as PautaWithCreator).created_by === user.email);
    return { ...user, comites: userMemberships, totalVotos: userVotes.length, totalPautas: userPautas.length };
  });

  const filteredMembers = membersData.filter((member) => {
    const searchMatch =
      member.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      member.email?.toLowerCase().includes(searchTerm.toLowerCase());
    const comiteMatch = comiteFilter === 'all' || member.comites.some((c) => c.comite_id === comiteFilter);
    const categoriaMatch = categoriaFilter === 'all' || member.categoria === categoriaFilter;
    const kpiMatch =
      !kpiFilter
      || (kpiFilter === 'com_comite' ? member.comites.length > 0 : member.comites.length > 1);
    return searchMatch && comiteMatch && categoriaMatch && kpiMatch;
  });

  const handleUpdateRole = () => {
    toast({ title: 'Função atualizada com sucesso!' });
    setShowEditDialog(false);
    setEditingMembership(null);
    setNewRoleId('');
  };

  const stats = {
    totalMembros: mockUsers.length,
    membrosAtivos: mockUsers.length,
    comMembership: mockUsers.filter((u) => membrosComite.some((m) => m.usuario_email === u.email)).length,
    mediaComitesPorMembro:
      mockUsers.length > 0
        ? (membrosComite.length / mockUsers.filter((u) => membrosComite.some((m) => m.usuario_email === u.email)).length).toFixed(1)
        : 0,
  };

  const clearAllFilters = () => {
    setKpiFilter(null);
    setComiteFilter('all');
    setCategoriaFilter('all');
    setSearchTerm('');
  };

  const kpiItems: KpiItem[] = [
    { id: 'total', value: stats.totalMembros, label: 'Total de Membros', variant: 'info', icon: <Users className="w-5 h-5" />, onClick: clearAllFilters },
    { id: 'ativos', value: stats.membrosAtivos, label: 'Membros Ativos', variant: 'success', icon: <Shield className="w-5 h-5" />, onClick: clearAllFilters },
    { id: 'membership', value: stats.comMembership, label: 'Em Comitês', variant: 'warning', icon: <Building2 className="w-5 h-5" />, onClick: () => toggleKpiFilter('com_comite'), active: kpiFilter === 'com_comite' },
    { id: 'media', value: stats.mediaComitesPorMembro, label: 'Média Comitês/Membro', variant: 'info', icon: <Users className="w-5 h-5" />, onClick: () => toggleKpiFilter('multi_comite'), active: kpiFilter === 'multi_comite' },
  ];

  const filterGroups: FilterGroup[] = [
    {
      id: 'comite',
      label: 'Comitê',
      value: comiteFilter,
      options: comites.map((c) => ({ value: c.id, label: c.nome })),
      onChange: setComiteFilter,
    },
    {
      id: 'categoria',
      label: 'Categoria',
      value: categoriaFilter,
      options: [
        { value: 'executivo', label: 'Executivo' },
        { value: 'gerencial', label: 'Gerencial' },
        { value: 'tecnico', label: 'Técnico' },
        { value: 'administrativo', label: 'Administrativo' },
        { value: 'consultor', label: 'Consultor' },
      ],
      onChange: setCategoriaFilter,
    },
  ];

  const tableColumns: HudTableColumn<MemberData>[] = [
    {
      key: 'membro',
      header: 'Membro',
      cell: (member: MemberData) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-ig-border-focus bg-ig-accent-weak text-xs font-semibold text-ig-accent">
            {getUserInitials(member.nome)}
          </div>
          <div>
            <p className="font-medium text-ig-fg-strong text-sm">{member.nome}</p>
            <div className="flex items-center gap-1.5 text-xs text-ig-fg-subtle">
              <Mail className="w-3 h-3" />
              <span>{member.email}</span>
            </div>
            {member.cargo && (
              <div className="flex items-center gap-1.5 text-xs text-ig-fg-subtle mt-0.5">
                <Briefcase className="w-3 h-3" />
                <span>{member.cargo}</span>
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'categoria',
      header: 'Categoria',
      width: '110px',
      cell: (member: MemberData) =>
        member.categoria ? (
          <HudStatusPill variant="info" size="sm">{member.categoria}</HudStatusPill>
        ) : (
          <span className="text-ig-fg-disabled text-sm">—</span>
        ),
    },
    {
      key: 'comites',
      header: 'Comitês e Funções',
      cell: (member: MemberData) => (
        <div className="space-y-1">
          {member.comites.map((comite: MemberData['comites'][number]) => (
            <div key={comite.id} className="flex items-center gap-2">
              <HudBadge variant="outline" size="sm">{comite.comite_nome}</HudBadge>
              <HudStatusPill variant="info" size="sm">
                <Shield className="w-3 h-3 mr-1" />
                {comite.role_nome}
              </HudStatusPill>
            </div>
          ))}
          {member.comites.length === 0 && (
            <span className="text-sm text-ig-fg-disabled">Nenhum comitê</span>
          )}
        </div>
      ),
    },
    {
      key: 'votos',
      header: 'Votos',
      width: '80px',
      align: 'center',
      cell: (member: MemberData) => (
        <HudStatusPill variant="active" size="sm">{member.totalVotos}</HudStatusPill>
      ),
    },
    {
      key: 'pautas',
      header: 'Pautas',
      width: '80px',
      align: 'center',
      cell: (member: MemberData) => (
        <HudStatusPill variant="warning" size="sm">{member.totalPautas}</HudStatusPill>
      ),
    },
    {
      key: 'acoes',
      header: 'Ações',
      width: '140px',
      align: 'right',
      cell: (member: MemberData) => (
        <div className="flex gap-1 justify-end">
          <HudButton
            variant="ghost"
            size="sm"
            leftIcon={<Eye className="w-4 h-4" />}
            onClick={() => {
              setSelectedMember(member);
              setShowActivityDialog(true);
            }}
          >
            Ver
          </HudButton>
          {member.comites.length > 0 && (
            <HudButton
              variant="ghost"
              size="sm"
              leftIcon={<Edit className="w-4 h-4" />}
              onClick={() => {
                setEditingMembership(member.comites[0]);
                setNewRoleId(member.comites[0].role_id || '');
                setShowEditDialog(true);
              }}
            />
          )}
        </div>
      ),
    },
  ];

  return (
    <HudPageLayout>
      <HudHeader
        title="Membros"
        subtitle="Administração completa de membros e suas funções nos comitês"
        icon={<UserCheck size={18} />}
        iconTint="#10B981"
        breadcrumbs={[{ label: 'Membros' }]}
        actions={
          <HudButton
            variant="primary"
            size="md"
            leftIcon={<UserPlus className="w-4 h-4" />}
            onClick={() => setShowInviteDialog(true)}
          >
            Convidar Novo Membro
          </HudButton>
        }
      />

      <HudKpiStrip kpis={kpiItems} columns={4} />

      <HudFilterBar
        searchPlaceholder="Buscar por nome, email ou cargo..."
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        filterGroups={filterGroups}
      />

      <HudPanel noPadding>
        <HudTable
          columns={tableColumns}
          data={filteredMembers}
          keyExtractor={(m) => m.id}
          emptyState={
            <HudEmptyState
              icon="search"
              title="Nenhum membro encontrado"
              description="Nenhum membro encontrado com os filtros aplicados"
            />
          }
        />
      </HudPanel>

      {/* Edit Role Modal */}
      <HudModal
        isOpen={showEditDialog}
        onClose={() => setShowEditDialog(false)}
        title="Alterar Função do Membro"
        size="sm"
        footer={
          <HudButton variant="primary" fullWidth onClick={handleUpdateRole} disabled={!newRoleId}>
            Atualizar Função
          </HudButton>
        }
      >
        {editingMembership && (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-ig-raised border border-ig-border">
              <p className="text-xs text-ig-fg-muted mb-1 uppercase tracking-wider">Membro</p>
              <p className="font-semibold text-ig-fg-strong">{editingMembership.usuario_email}</p>
              <p className="text-sm text-ig-fg-muted">{editingMembership.comite_nome}</p>
            </div>
            <HudSelect
              label="Nova Função"
              value={newRoleId}
              onChange={setNewRoleId}
              options={roles
                .filter((r) => r.comite_id === editingMembership.comite_id)
                .map((role) => ({ value: role.id, label: role.nome }))}
              placeholder="Selecione uma função"
            />
          </div>
        )}
      </HudModal>

      {/* Activity Modal */}
      <HudModal
        isOpen={showActivityDialog}
        onClose={() => setShowActivityDialog(false)}
        title={`Histórico de Atividades — ${selectedMember?.nome || ''}`}
        size="lg"
      >
        {selectedMember && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Total de Votos', value: selectedMember.totalVotos, variant: 'success' as const },
                { label: 'Pautas Criadas', value: selectedMember.totalPautas, variant: 'warning' as const },
                { label: 'Comitês', value: selectedMember.comites.length, variant: 'info' as const },
              ].map((item) => (
                <div
                  key={item.label}
                  className="ig-glass relative overflow-hidden rounded-xl p-4"
                  data-elev="2"
                >
                  <span data-ig-noise="" />
                  <span data-ig-specular="" />
                  <div data-ig-content="">
                    <p className="text-xs text-ig-fg-muted mb-1 uppercase tracking-wider">{item.label}</p>
                    <p className="text-xl font-semibold text-ig-fg-strong tabular-nums">{item.value}</p>
                  </div>
                </div>
              ))}
            </div>
            <ActivityHistory userEmail={selectedMember.email} />
          </div>
        )}
      </HudModal>

      <InviteMemberDialog
        open={showInviteDialog}
        onOpenChange={setShowInviteDialog}
        onSuccess={() => {
          toast({
            title: 'Convite processado',
            description: 'O novo membro receberá as instruções por email/WhatsApp',
          });
        }}
      />
    </HudPageLayout>
  );
}
