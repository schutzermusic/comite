'use client';

import React, { useState, use } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Users,
  FileText,
  Settings,
  UserPlus,
  Trash2,
  Shield,
  Eye,
  Building2,
  Edit,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { HUDCard } from '@/components/ui/hud-card';
import { StatusPill } from '@/components/ui/status-pill';
import { OrionGreenBackground } from '@/components/system/OrionGreenBackground';
import { PrimaryCTA } from '@/components/ui/primary-cta';
import { projects, users as mockUsers, votes } from '@/lib/mock-data';

const comites = projects.map((p, index) => ({
    id: p.id,
    nome: p.comiteResponsavel,
    descricao: `Comitê responsável por projetos ${p.comiteResponsavel.split(' ')[1].toLowerCase()}.`,
    status: index % 3 === 0 ? 'inativo' : 'ativo',
    tipo: ['executivo', 'consultivo', 'fiscal', 'estrategico', 'operacional', 'especial'][index % 6] as any,
    cor: ['#FF7A3D', '#008751', '#4CAF7B', '#FFB347', '#3F51B5', '#9C27B0'][index % 6],
    total_membros: Math.floor(Math.random() * 10) + 5,
    total_pautas: Math.floor(Math.random() * 20) + 1,
    quorum_minimo: 50,
    percentual_aprovacao: 51,
    votacao_anonima: index % 2 === 0,
    presidente_nome: 'Alice Johnson'
}));

const pautas = votes.map(v => ({...v, resultado: 'aprovado'}));


export default function DetalheComitePage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id: comiteId } = use(params);
  const { toast } = useToast();

  const [showAddMember, setShowAddMember] = useState(false);
  const [selectedUser, setSelectedUser] = useState('');
  const [selectedRoleId, setSelectedRoleId] = useState('');

  const comite = comites.find(c => c.id === comiteId);
  const membros = mockUsers.slice(0, 3); // mock
  const roles = [{id: '1', nome: 'Admin', cor: '#FF0000'}, {id: '2', nome: 'Member', cor: '#00FF00'}]; // mock
  const pautasDoComite = pautas.filter(p => p.comite === comite?.nome);
  const availableUsers = mockUsers.filter(u => !membros.some(m => m.email === u.email));

  // Mock current user
  const currentUser = { role: 'admin' };
  const isAdmin = currentUser?.role === 'admin';

  if (!comite) {
    return (
      <OrionGreenBackground className="orion-page">
        <div className="orion-page-content max-w-7xl mx-auto p-6 lg:p-8">
          <HUDCard>
            <div className="p-12 text-center">
              <Building2 className="w-16 h-16 text-[rgba(255,255,255,0.20)] mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">Comitê não encontrado</h3>
              <Button 
                onClick={() => router.push('/comites')}
                className="bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0] font-medium shadow-[0_0_18px_rgba(0,255,180,0.18)]"
              >
                Voltar para Comitês
              </Button>
            </div>
          </HUDCard>
        </div>
      </OrionGreenBackground>
    );
  }

  const getTipoIcon = (tipo: string) => {
    const icons: { [key: string]: React.ElementType } = {
      executivo: Shield,
      consultivo: Users,
      fiscal: Eye,
      estrategico: Building2,
      operacional: Settings,
      especial: FileText,
    };
    return icons[tipo] || Building2;
  };

  const getUserInitials = (name: string) => {
    if (!name) return 'U';
    return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  };
  
  const handleAddMember = () => {
    if(!selectedUser) {
        toast({title: "Erro", description: "Selecione um usuário", variant: 'destructive'})
        return;
    }
    toast({title: 'Membro adicionado com sucesso!'});
    setShowAddMember(false);
    setSelectedUser("");
    setSelectedRoleId("");
  }
  
  const handleRemoveMember = (membroId: string) => {
     toast({title: 'Membro removido com sucesso!'});
  }


  const getStatusVariant = (status: string): "active" | "neutral" | "warning" => {
    if (status === 'ativo') return 'active';
    if (status === 'suspenso') return 'warning';
    return 'neutral';
  };

  // Get icon component for the comite type
  const TipoIcon = getTipoIcon(String(comite.tipo));

  return (
    <OrionGreenBackground className="orion-page">
      <div className="orion-page-content max-w-7xl mx-auto space-y-6">
        <header className="mb-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                size="icon"
                onClick={() => router.push('/comites')}
                className="border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.08)] text-white"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <div>
                <h1 className="text-2xl font-semibold text-white mb-1 tracking-wide">{comite.nome}</h1>
                <div className="flex items-center gap-2 mt-2">
                  <StatusPill variant="info" className="text-xs">
                    {String(comite.tipo)}
                  </StatusPill>
                  <StatusPill variant={getStatusVariant(comite.status)} className="text-xs">
                    {comite.status}
                  </StatusPill>
                </div>
              </div>
            </div>
            {isAdmin && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => router.push(`/comites/${comiteId}/roles`)}
                  className="border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.08)] text-white"
                >
                  <Shield className="w-4 h-4 mr-2" />
                  Gerenciar Roles
                </Button>
                <Button 
                  variant="outline" 
                  size="icon"
                  className="border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.08)] text-white"
                >
                  <Settings className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
        </header>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <HUDCard glow glowColor="green">
              <div className="flex items-center gap-4 mb-6">
                <div className="p-3 rounded-xl bg-[rgba(0,255,180,0.12)] border border-[rgba(0,255,180,0.25)]">
                  <TipoIcon className="w-6 h-6 text-[#00FFB4]" />
                </div>
                <div className="flex-1">
                  <h2 className="text-xl font-semibold text-white">{comite.nome}</h2>
                  <p className="text-sm text-[rgba(255,255,255,0.65)] mt-1">{comite.descricao}</p>
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-semibold mb-3 text-white orion-text-heading">Regras de Votação</h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between py-2 border-b border-[rgba(255,255,255,0.08)]">
                      <span className="text-[rgba(255,255,255,0.65)]">Quórum mínimo</span>
                      <span className="font-semibold text-white">{comite.quorum_minimo}%</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-[rgba(255,255,255,0.08)]">
                      <span className="text-[rgba(255,255,255,0.65)]">Aprovação necessária</span>
                      <span className="font-semibold text-white">{comite.percentual_aprovacao}%</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-[rgba(255,255,255,0.08)]">
                      <span className="text-[rgba(255,255,255,0.65)]">Abstenção</span>
                      <span className="font-semibold text-white">{comite.votacao_anonima ? 'Permitida' : 'Não permitida'}</span>
                    </div>
                    <div className="flex justify-between py-2">
                      <span className="text-[rgba(255,255,255,0.65)]">Tipo de votação</span>
                      <span className="font-semibold text-white">{comite.votacao_anonima ? 'Anônima' : 'Identificada'}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold mb-3 text-white orion-text-heading">Estatísticas</h3>
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between text-sm mb-2">
                        <span className="text-[rgba(255,255,255,0.65)]">Membros Ativos</span>
                        <span className="font-bold text-white">{membros.length}</span>
                      </div>
                      <Progress value={membros.length * 10} className="h-2" />
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-2">
                        <span className="text-[rgba(255,255,255,0.65)]">Pautas Criadas</span>
                        <span className="font-bold text-white">{pautas.length}</span>
                      </div>
                      <Progress value={pautas.length * 5} className="h-2" />
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-2">
                        <span className="text-[rgba(255,255,255,0.65)]">Pautas Aprovadas</span>
                        <span className="font-bold text-white">{pautas.filter(p => p.resultado === 'aprovado').length}</span>
                      </div>
                      <Progress
                        value={pautas.length ? (pautas.filter(p => p.resultado === 'aprovado').length / pautas.length) * 100 : 0}
                        className="h-2"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </HUDCard>

            <HUDCard>
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-lg font-semibold text-white orion-text-heading">Membros do Comitê</h2>
                {isAdmin && (
                  <PrimaryCTA
                    onClick={() => setShowAddMember(true)}
                  >
                    <UserPlus className="w-4 h-4 mr-2" />
                    Adicionar Membro
                  </PrimaryCTA>
                )}
              </div>
              <div className="space-y-3">
                {membros.map((membro) => {
                  const memberRole = roles.find(r => r.id === membro.papelPrincipal);

                  return (
                    <div
                      key={membro.id}
                      className="flex items-center justify-between p-4 border border-[rgba(255,255,255,0.08)] rounded-xl hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <Avatar className="w-10 h-10">
                          <AvatarFallback
                            className="font-semibold text-white bg-gradient-to-br from-[#FF7A3D] to-[#008751]"
                          >
                            {getUserInitials(membro.nome)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium text-white">{membro.nome}</p>
                          <div className="flex gap-2 mt-1 flex-wrap">
                            <StatusPill variant="info" className="text-xs">
                              <Shield className="w-3 h-3 mr-1" />
                              {membro.papelPrincipal || 'Membro'}
                            </StatusPill>
                          </div>
                        </div>
                      </div>
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveMember(membro.id)}
                          className="text-[#FF5860] hover:text-[#FF5860] hover:bg-[rgba(255,88,96,0.12)]"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  );
                })}

                {membros.length === 0 && (
                  <div className="text-center py-12">
                    <Users className="w-12 h-12 text-[rgba(255,255,255,0.20)] mx-auto mb-3" />
                    <p className="text-[rgba(255,255,255,0.65)]">Nenhum membro no comitê</p>
                  </div>
                )}
              </div>
            </HUDCard>
          </div>

          <div className="space-y-6">
            <HUDCard>
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-white orion-text-heading">Informações</h2>
              </div>
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-[rgba(255,255,255,0.65)] mb-2">Status</p>
                  <StatusPill variant={getStatusVariant(comite.status)}>
                    {comite.status}
                  </StatusPill>
                </div>

                {comite.presidente_nome && (
                  <div>
                    <p className="text-sm text-[rgba(255,255,255,0.65)] mb-1">Presidente</p>
                    <p className="font-medium text-white">{comite.presidente_nome}</p>
                  </div>
                )}

                <div>
                  <p className="text-sm text-[rgba(255,255,255,0.65)] mb-2">Cor de Identificação</p>
                  <div
                    className="w-full h-8 rounded-lg border border-[rgba(255,255,255,0.08)]"
                    style={{ backgroundColor: comite.cor }}
                  ></div>
                </div>
              </div>
            </HUDCard>

            <HUDCard>
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-white orion-text-heading">Pautas Recentes</h2>
              </div>
              <div className="space-y-2">
                {pautasDoComite.slice(0, 5).map((pauta) => (
                  <div
                    key={pauta.id}
                    className="py-3 border-b border-[rgba(255,255,255,0.08)] last:border-0 cursor-pointer hover:bg-[rgba(255,255,255,0.05)] -mx-6 px-6 transition-colors rounded-lg"
                    onClick={() => router.push(`/votacoes/${pauta.id}`)}
                  >
                    <p className="font-medium text-sm text-white line-clamp-1">{pauta.titulo}</p>
                    <StatusPill variant="info" className="mt-1 text-xs">
                      {pauta.status}
                    </StatusPill>
                  </div>
                ))}

                {pautasDoComite.length === 0 && (
                  <div className="text-center py-8">
                    <FileText className="w-10 h-10 text-[rgba(255,255,255,0.20)] mx-auto mb-2" />
                    <p className="text-sm text-[rgba(255,255,255,0.65)]">Nenhuma pauta criada</p>
                  </div>
                )}
              </div>
            </HUDCard>
          </div>
        </div>

        <Dialog open={showAddMember} onOpenChange={setShowAddMember}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Adicionar Membro ao Comitê</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label>Selecionar Usuário</Label>
              <Select value={selectedUser} onValueChange={setSelectedUser}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha um usuário" />
                </SelectTrigger>
                <SelectContent>
                  {availableUsers.map((user) => (
                    <SelectItem key={user.id} value={user.email}>
                      <div className="flex items-center gap-3">
                        <div>
                          <p className="font-medium">{user.nome}</p>
                          <p className="text-xs text-slate-500">{user.email}</p>
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Função no Comitê</Label>
              {roles.length > 0 ? (
                <>
                  <Select value={selectedRoleId} onValueChange={setSelectedRoleId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Escolha uma função" />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((role) => (
                        <SelectItem key={role.id} value={role.id}>
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
                </>
              ) : (
                <div className="p-4 border border-amber-200 rounded-lg bg-amber-50">
                  <p className="text-sm text-amber-700">
                    Nenhuma função criada. Crie funções primeiro para atribuir permissões específicas.
                  </p>
                  <Button
                    variant="link"
                    onClick={() => router.push(`/comites/${comiteId}/roles`)}
                    className="text-amber-600 p-0 h-auto mt-2"
                  >
                    Criar Funções
                  </Button>
                </div>
              )}
            </div>

            <Button
              onClick={handleAddMember}
              disabled={!selectedUser}
              className="w-full bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0] font-medium shadow-[0_0_18px_rgba(0,255,180,0.18)]"
            >
              <UserPlus className="w-4 h-4 mr-2" />
              Adicionar Membro
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </OrionGreenBackground>
  );
}
