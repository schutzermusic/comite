'use client';

import React, { useState, use } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Plus,
  Shield,
  Edit,
  Trash2,
  Save,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { projects } from '@/lib/mock-data';
import Link from 'next/link';

const PERMISSION_GROUPS = {
  committee: {
    label: 'Gerenciar Comitê',
    permissions: [
      { key: 'view_committee_details', label: 'Visualizar detalhes do comitê' },
      { key: 'edit_committee_details', label: 'Editar informações do comitê' },
      { key: 'manage_members', label: 'Gerenciar membros' },
      { key: 'manage_roles', label: 'Gerenciar roles e permissões' },
    ],
  },
  pautas: {
    label: 'Gerenciar Pautas',
    permissions: [
      { key: 'create_pautas', label: 'Criar pautas' },
      { key: 'edit_own_pautas', label: 'Editar próprias pautas' },
      { key: 'edit_all_pautas', label: 'Editar todas as pautas' },
      { key: 'delete_own_pautas', label: 'Excluir próprias pautas' },
      { key: 'delete_all_pautas', label: 'Excluir todas as pautas' },
      { key: 'start_voting', label: 'Iniciar votação' },
      { key: 'close_voting', label: 'Encerrar votação' },
      { key: 'vote_on_pautas', label: 'Votar em pautas' },
    ],
  },
  meetings: {
    label: 'Gerenciar Reuniões',
    permissions: [
      { key: 'schedule_meetings', label: 'Agendar reuniões' },
      { key: 'edit_meetings', label: 'Editar reuniões' },
      { key: 'cancel_meetings', label: 'Cancelar reuniões' },
      { key: 'create_meeting_minutes', label: 'Criar atas de reunião' },
    ],
  },
  reports: {
    label: 'Gerenciar Relatórios',
    permissions: [
      { key: 'view_reports', label: 'Visualizar relatórios' },
      { key: 'create_reports', label: 'Criar relatórios' },
      { key: 'approve_reports', label: 'Aprovar relatórios' },
    ],
  },
};

const CORES_PREDEFINIDAS = [
  '#64748B',
  '#FF7A3D',
  '#008751',
  '#3B82F6',
  '#8B5CF6',
  '#EC4899',
  '#EF4444',
  '#F59E0B',
];

const mockRoles = [
    {
        id: 'role-1',
        nome: 'Administrador',
        descricao: 'Acesso total a todas as funcionalidades do comitê.',
        cor: '#EF4444',
        is_default: false,
        permissoes: Object.fromEntries(Object.values(PERMISSION_GROUPS).flatMap(g => g.permissions).map(p => [p.key, true]))
    },
    {
        id: 'role-2',
        nome: 'Membro',
        descricao: 'Participa de votações e reuniões.',
        cor: '#3B82F6',
        is_default: true,
        permissoes: {
            view_committee_details: true,
            vote_on_pautas: true,
        }
    },
    {
        id: 'role-3',
        nome: 'Secretário',
        descricao: 'Responsável por agendar reuniões e registrar atas.',
        cor: '#F59E0B',
        is_default: false,
        permissoes: {
            view_committee_details: true,
            create_pautas: true,
            schedule_meetings: true,
            edit_meetings: true,
            create_meeting_minutes: true,
        }
    }
];


export default function GerenciarRolesPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id: comiteId } = use(params);
  const { toast } = useToast();

  const [roles, setRoles] = useState(mockRoles);
  const [showRoleDialog, setShowRoleDialog] = useState(false);
  const [editingRole, setEditingRole] = useState<any>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [roleToDelete, setRoleToDelete] = useState<any>(null);

  const [formData, setFormData] = useState({
    nome: '',
    descricao: '',
    cor: '#64748B',
    is_default: false,
    permissoes: {} as Record<string, boolean>,
  });

  const comite = projects.find((p) => p.id === comiteId);

  const resetForm = () => {
    setFormData({
      nome: '',
      descricao: '',
      cor: '#64748B',
      is_default: false,
      permissoes: {},
    });
    setEditingRole(null);
  };

  const handleOpenCreate = () => {
    resetForm();
    setShowRoleDialog(true);
  };

  const handleOpenEdit = (role: any) => {
    setEditingRole(role);
    setFormData({
      nome: role.nome,
      descricao: role.descricao || '',
      cor: role.cor || '#64748B',
      is_default: role.is_default || false,
      permissoes: role.permissoes || {},
    });
    setShowRoleDialog(true);
  };

  const handleSubmit = () => {
    if (!formData.nome) {
      toast({
        title: 'Erro',
        description: 'Preencha o nome da role',
        variant: 'destructive',
      });
      return;
    }

    const data = formData;

    if (editingRole) {
      setRoles(roles.map(r => r.id === editingRole.id ? {...editingRole, ...data} : r));
      toast({ title: 'Role atualizada com sucesso!' });
    } else {
      setRoles([...roles, { id: `role-${Date.now()}`, ...data }]);
      toast({ title: 'Role criada com sucesso!' });
    }
    setShowRoleDialog(false);
    resetForm();
  };

  const handleDelete = () => {
    if(!roleToDelete) return;
    setRoles(roles.filter(r => r.id !== roleToDelete.id));
    toast({ title: 'Role excluída com sucesso!' });
    setShowDeleteDialog(false);
    setRoleToDelete(null);
  }

  const handlePermissionChange = (key: string, value: boolean) => {
    setFormData((prev) => ({
      ...prev,
      permissoes: {
        ...prev.permissoes,
        [key]: value,
      },
    }));
  };

  const countPermissions = (role: any) => {
    if (!role.permissoes) return 0;
    return Object.values(role.permissoes).filter((v) => v === true).length;
  };

  if (!comite) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div
          className="animate-spin rounded-full h-12 w-12 border-b-2"
          style={{ borderColor: '#008751' }}
        ></div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => router.push(`/comites/${comiteId}`)}
            className="border-green-300 hover:bg-green-50"
          >
            <ArrowLeft className="w-4 h-4" style={{ color: '#008751' }} />
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-slate-900">
              Gerenciar Roles
            </h1>
            <p className="text-slate-600">{comite.nome}</p>
          </div>
        </div>
        <Button
          onClick={handleOpenCreate}
          style={{
            background: 'linear-gradient(135deg, #008751 0%, #006B40 100%)',
          }}
        >
          <Plus className="w-4 h-4 mr-2" />
          Nova Role
        </Button>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {roles.map((role) => (
          <Card
            key={role.id}
            className="border-2 shadow-lg hover:shadow-xl transition-all"
            style={{ borderColor: role.cor }}
          >
            <CardHeader
              className="border-b"
              style={{ backgroundColor: `${role.cor}10` }}
            >
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <div
                    className="p-2 rounded-lg"
                    style={{ backgroundColor: role.cor }}
                  >
                    <Shield className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{role.nome}</CardTitle>
                    {role.is_default && (
                      <Badge className="mt-1 bg-green-100 text-green-700">
                        Padrão
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleOpenEdit(role)}
                    className="h-8 w-8"
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setRoleToDelete(role);
                      setShowDeleteDialog(true);
                    }}
                    className="h-8 w-8 text-red-600"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              <p className="text-sm text-slate-600 mb-4 line-clamp-2">
                {role.descricao || 'Sem descrição'}
              </p>

              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <span className="text-sm text-slate-600">
                  Permissões ativas
                </span>
                <span
                  className="text-xl font-bold"
                  style={{ color: role.cor }}
                >
                  {countPermissions(role)}
                </span>
              </div>

              <div className="mt-4 space-y-2">
                {Object.entries(PERMISSION_GROUPS).map(
                  ([groupKey, group]) => {
                    const activeInGroup = group.permissions.filter(
                      (p) => role.permissoes?.[p.key] === true
                    ).length;

                    if (activeInGroup === 0) return null;

                    return (
                      <div key={groupKey} className="text-xs">
                        <span className="text-slate-500">{group.label}:</span>
                        <span className="ml-2 font-semibold">
                          {activeInGroup}
                        </span>
                      </div>
                    );
                  }
                )}
              </div>
            </CardContent>
          </Card>
        ))}

        {roles.length === 0 && (
          <Card className="col-span-full border-dashed border-2 border-slate-300">
            <CardContent className="p-12 text-center">
              <Shield className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">
                Nenhuma role criada
              </h3>
              <p className="text-slate-600 mb-4">
                Crie roles personalizadas para gerenciar permissões dos membros
              </p>
              <Button
                onClick={handleOpenCreate}
                style={{
                  background:
                    'linear-gradient(135deg, #008751 0%, #006B40 100%)',
                }}
              >
                <Plus className="w-4 h-4 mr-2" />
                Criar Primeira Role
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={showRoleDialog} onOpenChange={setShowRoleDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingRole ? 'Editar Role' : 'Nova Role'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 pt-4">
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label>Nome da Role *</Label>
                <Input
                  value={formData.nome}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, nome: e.target.value }))
                  }
                  placeholder="Ex: Secretário Executivo"
                />
              </div>

              <div className="space-y-2">
                <Label>Cor de Identificação</Label>
                <div className="flex gap-2">
                  {CORES_PREDEFINIDAS.map((cor) => (
                    <button
                      key={cor}
                      type="button"
                      onClick={() =>
                        setFormData((prev) => ({ ...prev, cor }))
                      }
                      className={`w-10 h-10 rounded-lg border-2 transition-all ${
                        formData.cor === cor
                          ? 'border-slate-900 scale-110'
                          : 'border-slate-200'
                      }`}
                      style={{ backgroundColor: cor }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea
                value={formData.descricao}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    descricao: e.target.value,
                  }))
                }
                placeholder="Descreva as responsabilidades desta role..."
                rows={2}
              />
            </div>

            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <Label>Role padrão para novos membros</Label>
              <Switch
                checked={formData.is_default}
                onCheckedChange={(checked) =>
                  setFormData((prev) => ({ ...prev, is_default: checked }))
                }
              />
            </div>

            <div className="space-y-6 border-t pt-6">
              <h3 className="font-semibold text-lg">Permissões</h3>

              {Object.entries(PERMISSION_GROUPS).map(
                ([groupKey, group]) => (
                  <div key={groupKey} className="space-y-3">
                    <h4 className="font-medium text-slate-700">
                      {group.label}
                    </h4>
                    <div className="grid gap-3 pl-4">
                      {group.permissions.map((permission) => (
                        <div
                          key={permission.key}
                          className="flex items-center justify-between p-3 bg-slate-50 rounded-lg"
                        >
                          <Label className="cursor-pointer">
                            {permission.label}
                          </Label>
                          <Switch
                            checked={formData.permissoes[permission.key] || false}
                            onCheckedChange={(checked) =>
                              handlePermissionChange(permission.key, checked)
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )
              )}
            </div>

            <div className="flex gap-3 justify-end pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => {
                  setShowRoleDialog(false);
                  resetForm();
                }}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleSubmit}
                style={{
                  background:
                    'linear-gradient(135deg, #008751 0%, #006B40 100%)',
                }}
              >
                <Save className="w-4 h-4 mr-2" />
                {editingRole ? 'Atualizar' : 'Criar'} Role
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Role</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir a role "{roleToDelete?.nome}"?
              Membros com esta role perderão suas permissões associadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
