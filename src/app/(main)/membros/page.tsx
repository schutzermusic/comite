'use client';
import React, { useState } from 'react';
import {
  Users,
  Search,
  Filter,
  Shield,
  Briefcase,
  Mail,
  Building2,
  Eye,
  Edit,
  Trash2,
  UserPlus
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { HUDCard } from '@/components/ui/hud-card';
import { StatusPill } from '@/components/ui/status-pill';
import { OrionGreenBackground } from '@/components/system/OrionGreenBackground';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { users as mockUsers, projects, votes, pautas as mockPautas } from '@/lib/mock-data';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ActivityHistory from "@/components/member/ActivityHistory";
import { InviteMemberDialog } from "@/components/member/InviteMemberDialog";
import { Label } from '@/components/ui/label';

const comites = projects.map(p => ({
  id: p.comite_id,
  nome: p.comite_nome,
})).filter((v,i,a) => v.id && a.findIndex(t => (t.id === v.id)) === i) as {id: string, nome: string}[];


const roles = [
    {id: '1', comite_id: 'com-1', nome: 'Admin', cor: '#EF4444'}, 
    {id: '2', comite_id: 'com-2', nome: 'Member', cor: '#3B82F6'},
    {id: '3', comite_id: 'com-3', nome: 'Leitor', cor: '#22C55E'},
];

const membrosComite = [
    {id: 'mc-1', usuario_email: 'alice@insight.com', comite_id: 'com-1', comite_nome: 'Comitê Estratégico', role_id: '1', role_nome: 'Admin'},
    {id: 'mc-2', usuario_email: 'robert@insight.com', comite_id: 'com-1', comite_nome: 'Comitê Estratégico', role_id: '2', role_nome: 'Member'},
    {id: 'mc-3', usuario_email: 'robert@insight.com', comite_id: 'com-2', comite_nome: 'Comitê Técnico', role_id: '2', role_nome: 'Member'},
    {id: 'mc-4', usuario_email: 'carlos@insight.com', comite_id: 'com-2', comite_nome: 'Comitê Técnico', role_id: '2', role_nome: 'Member'},
    {id: 'mc-5', usuario_email: 'diana@insight.com', comite_id: 'com-3', comite_nome: 'Comitê de Inovação', role_id: '3', role_nome: 'Leitor'},
];

export default function GerenciarMembrosPage() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [comiteFilter, setComiteFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [categoriaFilter, setCategoriaFilter] = useState("all");

  const [selectedMember, setSelectedMember] = useState<any>(null);
  const [showActivityDialog, setShowActivityDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [editingMembership, setEditingMembership] = useState<any>(null);
  const [newRoleId, setNewRoleId] = useState("");


  const getUserInitials = (name: string | undefined) => {
    if (!name) return "U";
    return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  };

  const membersData = mockUsers.map(user => {
    const userMemberships = membrosComite.filter(m => m.usuario_email === user.email);
    const userVotes = votes.filter(v => v.usuario_email === user.email);
    const userPautas = mockPautas.filter(p => (p as any).created_by === user.email);

    return {
      ...user,
      comites: userMemberships,
      totalVotos: userVotes.length,
      totalPautas: userPautas.length,
    };
  });

  const filteredMembers = membersData.filter(member => {
    const searchMatch =
      member.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      member.email?.toLowerCase().includes(searchTerm.toLowerCase());

    const comiteMatch = comiteFilter === 'all' ||
      member.comites.some(c => c.comite_id === comiteFilter);

    const roleMatch = roleFilter === 'all' ||
      member.comites.some(c => c.role_id === roleFilter);

    const categoriaMatch = categoriaFilter === 'all' || member.categoria === categoriaFilter;

    return searchMatch && comiteMatch && roleMatch && categoriaMatch;
  });
  
  const handleUpdateRole = () => {
      toast({ title: 'Função atualizada com sucesso!' });
      setShowEditDialog(false);
      setEditingMembership(null);
      setNewRoleId("");
  }
  
  const stats = {
    totalMembros: mockUsers.length,
    membrosAtivos: mockUsers.length, // Mocked
    comMembership: mockUsers.filter(u => membrosComite.some(m => m.usuario_email === u.email)).length,
    mediaComitesPorMembro: mockUsers.length > 0
      ? (membrosComite.length / mockUsers.filter(u => membrosComite.some(m => m.usuario_email === u.email)).length).toFixed(1)
      : 0
  };

  return (
    <OrionGreenBackground className="orion-page">
      <div className="orion-page-content max-w-[1800px] mx-auto space-y-6">
        <header className="mb-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-white mb-1 tracking-wide">Gerenciar Membros</h1>
              <p className="text-sm text-[rgba(255,255,255,0.65)]">Administração completa de membros e suas funções nos comitês</p>
            </div>
            <Button
              onClick={() => setShowInviteDialog(true)}
              className="bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0] font-medium shadow-[0_0_18px_rgba(0,255,180,0.18)]"
            >
              <UserPlus className="w-4 h-4 mr-2" />
              Convidar Novo Membro
            </Button>
          </div>
        </header>

        <section className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <HUDCard glow glowColor="cyan">
            <div className="flex items-center justify-between mb-2">
              <Users className="w-6 h-6 text-[#00C8FF]" />
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Total de Membros</p>
            <p className="text-3xl font-semibold text-white">{stats.totalMembros}</p>
          </HUDCard>

          <HUDCard glow glowColor="green">
            <div className="flex items-center justify-between mb-2">
              <Shield className="w-6 h-6 text-[#00FFB4]" />
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Membros Ativos</p>
            <p className="text-3xl font-semibold text-white">{stats.membrosAtivos}</p>
          </HUDCard>

          <HUDCard glow glowColor="amber">
            <div className="flex items-center justify-between mb-2">
              <Building2 className="w-6 h-6 text-[#FFB04D]" />
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Em Comitês</p>
            <p className="text-3xl font-semibold text-white">{stats.comMembership}</p>
          </HUDCard>

          <HUDCard glow glowColor="cyan">
            <div className="flex items-center justify-between mb-2">
              <Users className="w-6 h-6 text-[#00C8FF]" />
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Média Comitês/Membro</p>
            <p className="text-3xl font-semibold text-white">{stats.mediaComitesPorMembro}</p>
          </HUDCard>
        </section>

        <HUDCard>
          <div className="grid md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[rgba(255,255,255,0.40)]" />
                <Input
                  placeholder="Buscar por nome, email ou cargo..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
                />
              </div>
            </div>
            <Select value={comiteFilter} onValueChange={setComiteFilter}>
              <SelectTrigger className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)] focus:border-[rgba(0,255,180,0.25)]">
                <Filter className="w-4 h-4 mr-2 text-[rgba(255,255,255,0.65)]" />
                <SelectValue placeholder="Comitê" />
              </SelectTrigger>
              <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                <SelectItem value="all" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Todos Comitês</SelectItem>
                {comites.map(c => (
                  <SelectItem key={c.id} value={c.id} className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">{c.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={categoriaFilter} onValueChange={setCategoriaFilter}>
              <SelectTrigger className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)] focus:border-[rgba(0,255,180,0.25)]">
                <Filter className="w-4 h-4 mr-2 text-[rgba(255,255,255,0.65)]" />
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                <SelectItem value="all" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Todas Categorias</SelectItem>
                <SelectItem value="executivo" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Executivo</SelectItem>
                <SelectItem value="gerencial" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Gerencial</SelectItem>
                <SelectItem value="tecnico" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Técnico</SelectItem>
                <SelectItem value="administrativo" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Administrativo</SelectItem>
                <SelectItem value="consultor" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Consultor</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </HUDCard>

        <HUDCard className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-[rgba(255,255,255,0.05)]">
                  <TableHead className="text-[rgba(255,255,255,0.65)] font-medium">Membro</TableHead>
                  <TableHead className="text-[rgba(255,255,255,0.65)] font-medium">Categoria</TableHead>
                  <TableHead className="text-[rgba(255,255,255,0.65)] font-medium">Comitês e Funções</TableHead>
                  <TableHead className="text-center text-[rgba(255,255,255,0.65)] font-medium">Votos</TableHead>
                  <TableHead className="text-center text-[rgba(255,255,255,0.65)] font-medium">Pautas</TableHead>
                  <TableHead className="text-center text-[rgba(255,255,255,0.65)] font-medium">Atividade</TableHead>
                  <TableHead className="text-right text-[rgba(255,255,255,0.65)] font-medium">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMembers.map((member) => (
                  <TableRow key={member.id} className="hover:bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.05)]">
                    <TableCell className="text-[rgba(255,255,255,0.92)]">
                      <div className="flex items-center gap-3">
                        <Avatar className="w-10 h-10">
                          <AvatarFallback
                            className="font-semibold text-white"
                            style={{ background: 'linear-gradient(135deg, #00FFB4 0%, #00C8FF 100%)' }}
                          >
                            {getUserInitials(member.nome)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">{member.nome}</p>
                          <div className="flex items-center gap-2 text-xs text-[rgba(255,255,255,0.40)]">
                            <Mail className="w-3 h-3" />
                            <span>{member.email}</span>
                          </div>
                          {member.papelPrincipal && (
                            <div className="flex items-center gap-2 text-xs text-[rgba(255,255,255,0.40)] mt-1">
                              <Briefcase className="w-3 h-3" />
                              <span>{member.cargo}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {member.categoria && (
                        <StatusPill variant="info">
                          {member.categoria}
                        </StatusPill>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {member.comites.map((comite) => {
                          const role = roles.find(r => r.id === comite.role_id);
                          return (
                            <div key={comite.id} className="flex items-center gap-2">
                              <Badge
                                variant="outline"
                                className="text-xs bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.65)] border-[rgba(255,255,255,0.12)]"
                              >
                                {comite.comite_nome}
                              </Badge>
                              <StatusPill variant="info" className="text-xs">
                                <Shield className="w-3 h-3 mr-1" />
                                {comite.role_nome}
                              </StatusPill>
                            </div>
                          );
                        })}
                        {member.comites.length === 0 && (
                          <span className="text-sm text-[rgba(255,255,255,0.40)]">Nenhum comitê</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <StatusPill variant="success">
                        {member.totalVotos}
                      </StatusPill>
                    </TableCell>
                    <TableCell className="text-center">
                      <StatusPill variant="warning">
                        {member.totalPautas}
                      </StatusPill>
                    </TableCell>
                    <TableCell className="text-center">
                       <Button variant="ghost" size="sm" onClick={() => {
                          setSelectedMember(member);
                          setShowActivityDialog(true);
                        }} className="text-[#00C8FF] hover:bg-[rgba(0,200,255,0.12)]">
                          <Eye className="w-4 h-4 mr-2" />
                          Ver
                        </Button>
                    </TableCell>
                    <TableCell className="text-right">
                       <div className="flex gap-1 justify-end">
                        {member.comites.length > 0 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setEditingMembership(member.comites[0]);
                              setNewRoleId(member.comites[0].role_id || "");
                              setShowEditDialog(true);
                            }}
                            className="text-[#00FFB4] hover:bg-[rgba(0,255,180,0.12)]"
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {filteredMembers.length === 0 && (
              <div className="text-center py-12">
                <Users className="w-16 h-16 text-[rgba(255,255,255,0.20)] mx-auto mb-4" />
                <p className="text-[rgba(255,255,255,0.65)]">Nenhum membro encontrado com os filtros aplicados</p>
              </div>
            )}
          </div>
        </HUDCard>
      
        <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
          <DialogContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
            <DialogHeader>
              <DialogTitle className="text-white font-semibold">Alterar Função do Membro</DialogTitle>
            </DialogHeader>
            {editingMembership && (
              <div className="space-y-4 pt-4">
                <div className="p-4 bg-[rgba(255,255,255,0.05)] rounded-lg border border-[rgba(255,255,255,0.08)]">
                  <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Membro</p>
                  <p className="font-semibold text-white">{editingMembership.usuario_nome}</p>
                  <p className="text-sm text-[rgba(255,255,255,0.65)]">{editingMembership.comite_nome}</p>
                </div>

                <div className="space-y-2">
                  <Label className="text-white">Nova Função</Label>
                  <Select value={newRoleId} onValueChange={setNewRoleId}>
                    <SelectTrigger className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)] focus:border-[rgba(0,255,180,0.25)]">
                      <SelectValue placeholder="Selecione uma função" />
                    </SelectTrigger>
                    <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                      {roles
                        .filter(r => r.comite_id === editingMembership.comite_id)
                        .map((role) => (
                          <SelectItem key={role.id} value={role.id} className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">
                            <div className="flex items-center gap-2">
                              <div 
                                className="w-3 h-3 rounded-full" 
                                style={{ backgroundColor: role.cor }}
                              />
                              <span>{role.nome}</span>
                            </div>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  onClick={handleUpdateRole}
                  disabled={!newRoleId}
                  className="w-full bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0] font-medium shadow-[0_0_18px_rgba(0,255,180,0.18)]"
                >
                  Atualizar Função
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      
        <Dialog open={showActivityDialog} onOpenChange={setShowActivityDialog}>
          <DialogContent className="max-w-2xl bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
            <DialogHeader>
              <DialogTitle className="text-white font-semibold">
                Histórico de Atividades - {selectedMember?.nome}
              </DialogTitle>
            </DialogHeader>
            {selectedMember && (
              <div className="space-y-4 pt-4">
                <div className="grid grid-cols-3 gap-4">
                  <HUDCard glow glowColor="green">
                    <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Total de Votos</p>
                    <p className="text-2xl font-semibold text-white">{selectedMember.totalVotos}</p>
                  </HUDCard>
                  <HUDCard glow glowColor="amber">
                    <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Pautas Criadas</p>
                    <p className="text-2xl font-semibold text-white">{selectedMember.totalPautas}</p>
                  </HUDCard>
                  <HUDCard glow glowColor="cyan">
                    <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Comitês</p>
                    <p className="text-2xl font-semibold text-white">{selectedMember.comites.length}</p>
                  </HUDCard>
                </div>

                <ActivityHistory userEmail={selectedMember.email} />
              </div>
            )}
          </DialogContent>
        </Dialog>

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
      </div>
    </OrionGreenBackground>
  );
}
