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
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
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

export default function GerenciarMembrosPage() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [comiteFilter, setComiteFilter] = useState('all');
  const [categoriaFilter, setCategoriaFilter] = useState('all');

  const [selectedMember, setSelectedMember] = useState<any>(null);
  const [showActivityDialog, setShowActivityDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [editingMembership, setEditingMembership] = useState<any>(null);
  const [newRoleId, setNewRoleId] = useState('');

  const getUserInitials = (name: string | undefined) => {
    if (!name) return 'U';
    return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const membersData = mockUsers.map((user) => {
    const userMemberships = membrosComite.filter((m) => m.usuario_email === user.email);
    const userVotes = votes.filter((v) => v.usuario_email === user.email);
    const userPautas = mockPautas.filter((p) => (p as any).created_by === user.email);
    return { ...user, comites: userMemberships, totalVotos: userVotes.length, totalPautas: userPautas.length };
  });

  type MemberData = (typeof membersData)[number];

  const filteredMembers = membersData.filter((member) => {
    const searchMatch =
      member.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      member.email?.toLowerCase().includes(searchTerm.toLowerCase());
    const comiteMatch = comiteFilter === 'all' || member.comites.some((c) => c.comite_id === comiteFilter);
    const categoriaMatch = categoriaFilter === 'all' || member.categoria === categoriaFilter;
    return searchMatch && comiteMatch && categoriaMatch;
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

  const kpiItems: KpiItem[] = [
    { id: 'total', value: stats.totalMembros, label: 'Total de Membros', variant: 'info', icon: <Users className="w-5 h-5" /> },
    { id: 'ativos', value: stats.membrosAtivos, label: 'Membros Ativos', variant: 'success', icon: <Shield className="w-5 h-5" /> },
    { id: 'membership', value: stats.comMembership, label: 'Em Comitês', variant: 'warning', icon: <Building2 className="w-5 h-5" /> },
    { id: 'media', value: stats.mediaComitesPorMembro, label: 'Média Comitês/Membro', variant: 'info', icon: <Users className="w-5 h-5" /> },
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
          <Avatar className="w-9 h-9">
            <AvatarFallback
              className="font-semibold text-white text-xs"
              style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #10b981 100%)' }}
            >
              {getUserInitials(member.nome)}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium text-white text-sm">{member.nome}</p>
            <div className="flex items-center gap-1.5 text-xs text-white/40">
              <Mail className="w-3 h-3" />
              <span>{member.email}</span>
            </div>
            {member.cargo && (
              <div className="flex items-center gap-1.5 text-xs text-white/40 mt-0.5">
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
          <span className="text-white/30 text-sm">—</span>
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
            <span className="text-sm text-white/30">Nenhum comitê</span>
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
        title="Gerenciar Membros"
        subtitle="Administração completa de membros e suas funções nos comitês"
        icon={<Users className="w-5 h-5" />}
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
            <div className="p-4 rounded-lg bg-white/[0.03] border border-white/[0.06]">
              <p className="text-xs text-white/50 mb-1 uppercase tracking-wider">Membro</p>
              <p className="font-semibold text-white">{editingMembership.usuario_nome}</p>
              <p className="text-sm text-white/50">{editingMembership.comite_nome}</p>
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
                  className="cr-glass-panel relative overflow-hidden rounded-xl p-4"
                >
                  <div className="cr-glass-panel-border" />
                  <div className="cr-glass-panel-specular" />
                  <div className="cr-glass-panel-inner-stroke" />
                  <div className="relative z-[2]">
                    <p className="text-xs text-white/50 mb-1 uppercase tracking-wider">{item.label}</p>
                    <p className="text-xl font-semibold text-white tabular-nums">{item.value}</p>
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
