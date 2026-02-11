'use client';

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Shield,
  Plus,
  Edit,
  Trash2,
  Lock,
  ArrowLeft
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { HUDCard } from "@/components/ui/hud-card";
import { StatusPill } from "@/components/ui/status-pill";
import { OrionGreenBackground } from "@/components/system/OrionGreenBackground";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { globalRoles as mockRoles, users as mockUsers } from "@/lib/mock-data";

const PERMISSION_CATEGORIES = [
  {
    name: "Projetos",
    permissions: [
      { key: 'projetos_visualizar', label: 'Visualizar projetos' },
      { key: 'projetos_criar', label: 'Criar projetos' },
      { key: 'projetos_editar', label: 'Editar projetos' },
      { key: 'projetos_deletar', label: 'Deletar projetos' },
    ]
  },
  {
    name: "Comitês",
    permissions: [
      { key: 'comites_visualizar', label: 'Visualizar comitês' },
      { key: 'comites_criar', label: 'Criar comitês' },
      { key: 'comites_editar', label: 'Editar comitês' },
      { key: 'comites_deletar', label: 'Deletar comitês' },
    ]
  },
  {
    name: "Pautas",
    permissions: [
      { key: 'pautas_visualizar', label: 'Visualizar pautas' },
      { key: 'pautas_criar', label: 'Criar pautas' },
      { key: 'pautas_editar', label: 'Editar pautas' },
      { key: 'pautas_deletar', label: 'Deletar pautas' },
      { key: 'pautas_votar', label: 'Votar em pautas' },
      { key: 'pautas_iniciar_votacao', label: 'Iniciar votações' },
    ]
  },
  {
    name: "Reuniões",
    permissions: [
      { key: 'reunioes_visualizar', label: 'Visualizar reuniões' },
      { key: 'reunioes_criar', label: 'Criar reuniões' },
      { key: 'reunioes_editar', label: 'Editar reuniões' },
      { key: 'reunioes_deletar', label: 'Deletar reuniões' },
      { key: 'reunioes_ata', label: 'Registrar atas' },
    ]
  },
  {
    name: "Membros",
    permissions: [
      { key: 'membros_visualizar', label: 'Visualizar membros' },
      { key: 'membros_gerenciar', label: 'Gerenciar membros' },
    ]
  },
  {
    name: "Relatórios",
    permissions: [
      { key: 'relatorios_visualizar', label: 'Visualizar relatórios' },
      { key: 'relatorios_exportar', label: 'Exportar relatórios' },
      { key: 'relatorios_avancados', label: 'Relatórios avançados' },
    ]
  },
  {
    name: "Financeiro",
    permissions: [
      { key: 'financeiro_visualizar', label: 'Visualizar dados financeiros' },
      { key: 'financeiro_editar', label: 'Editar dados financeiros' },
    ]
  },
  {
    name: "Sistema",
    permissions: [
      { key: 'sistema_configuracoes', label: 'Configurações do sistema' },
      { key: 'sistema_usuarios', label: 'Gerenciar usuários' },
      { key: 'sistema_roles', label: 'Gerenciar funções' },
    ]
  },
];

export default function GerenciarRolesGlobal() {
  const router = useRouter();
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [editingRole, setEditingRole] = useState<any>(null);
  const [deletingRole, setDeletingRole] = useState<any>(null);

  const [roles, setRoles] = useState(mockRoles);

  const [formData, setFormData] = useState({
    nome: "",
    descricao: "",
    tipo: "custom",
    nivel_acesso: 1,
    cor: "#64748B",
    permissoes: {} as Record<string, boolean>
  });

  const resetForm = () => {
    setFormData({
      nome: "",
      descricao: "",
      tipo: "custom",
      nivel_acesso: 1,
      cor: "#64748B",
      permissoes: {},
    });
    setEditingRole(null);
  };

  const handleEdit = (role: any) => {
    setEditingRole(role);
    setFormData({
      nome: role.nome,
      descricao: role.descricao || "",
      tipo: role.tipo,
      nivel_acesso: role.nivel_acesso || 1,
      cor: role.cor || "#64748B",
      permissoes: role.permissoes || {}
    });
    setShowDialog(true);
  };

  const handleSubmit = () => {
    if (!formData.nome) {
      toast({ title: 'Erro', description: 'Preencha o nome da função', variant: 'destructive' });
      return;
    }

    if (editingRole) {
      setRoles(roles.map(r => r.id === editingRole.id ? { ...editingRole, ...formData } : r));
      toast({ title: 'Função atualizada com sucesso!' });
    } else {
      setRoles([...roles, { ...formData, id: `role-global-${Date.now()}`, is_system_role: false }]);
      toast({ title: 'Função criada com sucesso!' });
    }

    setShowDialog(false);
    resetForm();
  };

  const handleDelete = () => {
    if (deletingRole) {
        setRoles(roles.filter(r => r.id !== deletingRole.id));
        setShowDeleteDialog(false);
        setDeletingRole(null);
        toast({ title: 'Função excluída com sucesso!' });
    }
  };

  const handlePermissionChange = (key: string, value: boolean) => {
    setFormData(prev => ({
      ...prev,
      permissoes: {
        ...prev.permissoes,
        [key]: value
      }
    }));
  };

  const countPermissions = (role: any) => {
    if (!role || !role.permissoes) return 0;
    return Object.values(role.permissoes).filter(v => v === true).length;
  };

  const getUsersWithRole = (roleId: string) => {
    // This is a mock implementation. In a real app, this would query users.
    const safeRoleId = roleId || '';
    return mockUsers.filter(u => u.papelPrincipal === 'admin' && safeRoleId.includes('admin')).length;
  };

  return (
    <OrionGreenBackground className="orion-page">
      <div className="orion-page-content max-w-[1800px] mx-auto space-y-6">
        <header className="mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                size="icon"
                onClick={() => router.push("/dashboard")}
                className="border-[rgba(0,255,180,0.25)] text-[rgba(255,255,255,0.92)] hover:bg-[rgba(0,255,180,0.12)]"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <div>
                <h1 className="text-2xl font-semibold text-white tracking-wide">Gerenciar Funções Globais</h1>
                <p className="text-sm text-[rgba(255,255,255,0.65)]">Sistema de controle de acesso baseado em funções (RBAC)</p>
              </div>
            </div>
            <Button
              onClick={() => {
                resetForm();
                setShowDialog(true);
              }}
              className="bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0] font-medium shadow-[0_0_18px_rgba(0,255,180,0.18)]"
            >
              <Plus className="w-4 h-4 mr-2" />
              Nova Função
            </Button>
          </div>
        </header>

        <section className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {roles.map((role) => {
            const permCount = countPermissions(role);
            const userCount = getUsersWithRole(role.id);

            return (
              <HUDCard key={role.id} glow className="hover:border-[rgba(0,255,180,0.12)] transition-all">
                <div className="space-y-4">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3">
                      <div className="p-3 rounded-xl bg-[rgba(0,255,180,0.12)] border border-[rgba(0,255,180,0.25)]">
                        <Shield className="w-5 h-5 text-[#00FFB4]" />
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-white">{role.nome}</h3>
                        <StatusPill variant="info" className="mt-1 text-xs">
                          {role.tipo}
                        </StatusPill>
                      </div>
                    </div>
                    {!role.is_system_role && (
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEdit(role)}
                          className="h-8 w-8 text-[#00C8FF] hover:bg-[rgba(0,200,255,0.12)]"
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setDeletingRole(role);
                            setShowDeleteDialog(true);
                          }}
                          className="h-8 w-8 text-[#FF5860] hover:bg-[rgba(255,88,96,0.12)]"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {role.descricao && (
                    <p className="text-sm text-[rgba(255,255,255,0.65)]">{role.descricao}</p>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[rgba(255,255,255,0.65)]">Permissões ativas</span>
                      <span className="font-semibold text-white">{permCount}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[rgba(255,255,255,0.65)]">Usuários com esta função</span>
                      <span className="font-semibold text-white">{userCount}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[rgba(255,255,255,0.65)]">Nível de acesso</span>
                      <StatusPill variant="neutral">{role.nivel_acesso}/10</StatusPill>
                    </div>
                  </div>

                  {role.is_system_role && (
                    <div className="pt-3 border-t border-[rgba(255,255,255,0.05)]">
                      <StatusPill variant="warning">
                        <Lock className="w-3 h-3 mr-1" />
                        Função do Sistema
                      </StatusPill>
                    </div>
                  )}
                </div>
              </HUDCard>
            );
          })}
        </section>

        {roles.length === 0 && (
          <HUDCard>
            <div className="p-12 text-center">
              <Shield className="w-16 h-16 text-[rgba(255,255,255,0.20)] mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">
                Nenhuma função criada
              </h3>
              <p className="text-[rgba(255,255,255,0.65)] mb-6">
                Crie funções para controlar o acesso dos usuários
              </p>
              <Button
                onClick={() => {
                  resetForm();
                  setShowDialog(true);
                }}
                className="bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0] font-medium shadow-[0_0_18px_rgba(0,255,180,0.18)]"
              >
                <Plus className="w-4 h-4 mr-2" />
                Criar Primeira Função
              </Button>
            </div>
          </HUDCard>
        )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
          <DialogHeader>
            <DialogTitle className="text-white font-semibold">
              {editingRole ? 'Editar Função' : 'Nova Função'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-white">Nome da Função</Label>
                <Input
                  value={formData.nome}
                  onChange={(e) => setFormData(prev => ({ ...prev, nome: e.target.value }))}
                  placeholder="Ex: Gerente de Projetos"
                  className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-white">Tipo</Label>
                <Select
                  value={formData.tipo}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, tipo: value }))}
                >
                  <SelectTrigger className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)] focus:border-[rgba(0,255,180,0.25)]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                    <SelectItem value="admin" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Admin</SelectItem>
                    <SelectItem value="project_manager" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Project Manager</SelectItem>
                    <SelectItem value="committee_member" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Committee Member</SelectItem>
                    <SelectItem value="viewer" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Viewer</SelectItem>
                    <SelectItem value="custom" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-white">Descrição</Label>
              <Textarea
                value={formData.descricao}
                onChange={(e) => setFormData(prev => ({ ...prev, descricao: e.target.value }))}
                placeholder="Descreva as responsabilidades desta função..."
                rows={3}
                className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
              />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-white">Nível de Acesso (1-10)</Label>
                <Input
                  type="number"
                  min="1"
                  max="10"
                  value={formData.nivel_acesso}
                  onChange={(e) => setFormData(prev => ({ ...prev, nivel_acesso: parseInt(e.target.value) || 1 }))}
                  className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-white">Cor</Label>
                <Input
                  type="color"
                  value={formData.cor}
                  onChange={(e) => setFormData(prev => ({ ...prev, cor: e.target.value }))}
                  className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] h-10"
                />
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="font-semibold text-white tracking-wide">Permissões</h3>
              {PERMISSION_CATEGORIES.map((category) => (
                <div key={category.name} className="space-y-3 p-4 border border-[rgba(255,255,255,0.08)] rounded-lg bg-[rgba(255,255,255,0.03)]">
                  <h4 className="font-medium text-white">{category.name}</h4>
                  <div className="grid md:grid-cols-2 gap-3">
                    {category.permissions.map((perm) => (
                      <div key={perm.key} className="flex items-center justify-between p-2 bg-[rgba(255,255,255,0.05)] rounded border border-[rgba(255,255,255,0.05)]">
                        <Label htmlFor={perm.key} className="text-sm cursor-pointer text-[rgba(255,255,255,0.92)]">
                          {perm.label}
                        </Label>
                        <Switch
                          id={perm.key}
                          checked={formData.permissoes[perm.key] || false}
                          onCheckedChange={(checked) => handlePermissionChange(perm.key, checked)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} className="border-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.65)] hover:bg-[rgba(255,255,255,0.05)]">
              Cancelar
            </Button>
            <Button
              onClick={handleSubmit}
              className="bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0] font-medium shadow-[0_0_18px_rgba(0,255,180,0.18)]"
            >
              {editingRole ? 'Atualizar' : 'Criar'} Função
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white font-semibold">Excluir Função</AlertDialogTitle>
            <AlertDialogDescription className="text-[rgba(255,255,255,0.65)]">
              Tem certeza que deseja excluir a função "{deletingRole?.nome}"?
              {getUsersWithRole(deletingRole?.id) > 0 && (
                <span className="block mt-2 text-[#FF5860] font-medium">
                  ⚠️ {getUsersWithRole(deletingRole?.id)} usuário(s) possui(em) esta função.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.65)] hover:bg-[rgba(255,255,255,0.05)]">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-[#FF5860] hover:bg-[#FF4040] text-white"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </OrionGreenBackground>
  );
}
