'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { ProjectAllocation, User } from '@/lib/types';
import { OrgChart } from '@/components/organization/org-chart';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Building2, User as UserIcon } from 'lucide-react';

interface AddMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  existingAllocations?: ProjectAllocation[];
  onAddMember: (allocation: Omit<ProjectAllocation, 'id'>) => void;
}

export function AddMemberDialog({
  open,
  onOpenChange,
  projectId,
  existingAllocations = [],
  onAddMember,
}: AddMemberDialogProps) {
  const { toast } = useToast();
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({
    role: '',
    allocationPercent: 100,
    hoursPerWeek: 40,
  });

  const handleUserSelect = (user: User) => {
    setSelectedUser(user);
    // Auto-fill role based on user's cargo
    if (user.cargo && !formData.role) {
      setFormData({ ...formData, role: user.cargo });
    }
  };

  const handleSubmit = () => {
    if (!selectedUser) {
      toast({
        title: 'Selecione um colaborador',
        description: 'Por favor, selecione um colaborador do organograma.',
        variant: 'destructive',
      });
      return;
    }

    if (!formData.role) {
      toast({
        title: 'Função obrigatória',
        description: 'Por favor, defina a função do colaborador no projeto.',
        variant: 'destructive',
      });
      return;
    }

    if (formData.allocationPercent <= 0 || formData.allocationPercent > 200) {
      toast({
        title: 'Percentual inválido',
        description: 'O percentual de alocação deve estar entre 1% e 200%.',
        variant: 'destructive',
      });
      return;
    }

    // Check if user is already allocated
    const alreadyAllocated = existingAllocations.some(
      (a) => a.memberId === selectedUser.id
    );

    if (alreadyAllocated) {
      toast({
        title: 'Colaborador já alocado',
        description: 'Este colaborador já está alocado neste projeto.',
        variant: 'destructive',
      });
      return;
    }

    onAddMember({
      projectId,
      memberId: selectedUser.id,
      memberName: selectedUser.nome,
      role: formData.role,
      allocationPercent: formData.allocationPercent,
      hoursPerWeek: formData.hoursPerWeek,
      critical: formData.allocationPercent > 100,
    });

    toast({
      title: 'Membro adicionado',
      description: `${selectedUser.nome} foi adicionado ao projeto com sucesso.`,
    });

    // Reset form
    setSelectedUser(null);
    setFormData({
      role: '',
      allocationPercent: 100,
      hoursPerWeek: 40,
    });

    onOpenChange(false);
  };

  // Calculate workload for selected user (mock)
  const getUserWorkload = (userId: string) => {
    const workloads: Record<string, { percent: number; hours: number }> = {
      'user-1': { percent: 85, hours: 34 },
      'user-2': { percent: 120, hours: 48 },
      'user-3': { percent: 60, hours: 24 },
      'user-4': { percent: 90, hours: 36 },
      'user-5': { percent: 40, hours: 16 },
    };
    return workloads[userId] || { percent: 0, hours: 0 };
  };

  const workload = selectedUser ? getUserWorkload(selectedUser.id) : null;
  const newWorkload = selectedUser
    ? {
        percent: (workload?.percent || 0) + formData.allocationPercent,
        hours: (workload?.hours || 0) + formData.hoursPerWeek,
      }
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.10)] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-white">Adicionar Membro à Equipe</DialogTitle>
          <DialogDescription className="text-[rgba(255,255,255,0.65)]">
            Selecione um colaborador do organograma e defina sua alocação no projeto
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="org" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-2 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)]">
            <TabsTrigger
              value="org"
              className="data-[state=active]:bg-[#00FFB4] data-[state=active]:text-[#050D0A] text-[rgba(255,255,255,0.65)]"
            >
              <Building2 className="w-4 h-4 mr-2" />
              Organograma
            </TabsTrigger>
            <TabsTrigger
              value="details"
              className="data-[state=active]:bg-[#00FFB4] data-[state=active]:text-[#050D0A] text-[rgba(255,255,255,0.65)]"
              disabled={!selectedUser}
            >
              <UserIcon className="w-4 h-4 mr-2" />
              Detalhes da Alocação
            </TabsTrigger>
          </TabsList>

          <TabsContent value="org" className="flex-1 overflow-auto mt-4">
            <OrgChart
              onSelectMember={handleUserSelect}
              selectedMemberId={selectedUser?.id}
              showSearch={true}
            />
          </TabsContent>

          <TabsContent value="details" className="flex-1 overflow-auto mt-4">
            {selectedUser ? (
              <div className="space-y-6">
                {/* Selected User Info */}
                <div className="p-4 rounded-xl border border-[rgba(0,255,180,0.25)] bg-[rgba(0,255,180,0.08)]">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#FF7A3D] to-[#008751] flex items-center justify-center text-white font-semibold">
                      {selectedUser.nome
                        .split(' ')
                        .map((n) => n[0])
                        .join('')
                        .toUpperCase()
                        .slice(0, 2)}
                    </div>
                    <div>
                      <h4 className="font-semibold text-white">{selectedUser.nome}</h4>
                      <p className="text-sm text-[rgba(255,255,255,0.65)]">{selectedUser.email}</p>
                      {selectedUser.cargo && (
                        <p className="text-xs text-[rgba(255,255,255,0.50)]">{selectedUser.cargo}</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Current Workload */}
                {workload && (
                  <div className="p-4 rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]">
                    <h5 className="text-sm font-semibold text-white mb-3">Ocupação Atual</h5>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-[rgba(255,255,255,0.65)]">Ocupação Atual</span>
                        <span
                          className={`text-sm font-bold ${
                            workload.percent > 100
                              ? 'text-[#FF5860]'
                              : workload.percent > 80
                              ? 'text-[#FFB04D]'
                              : 'text-[#00FFB4]'
                          }`}
                        >
                          {workload.percent}%
                        </span>
                      </div>
                      <div className="w-full bg-[rgba(255,255,255,0.05)] rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${
                            workload.percent > 100
                              ? 'bg-[#FF5860]'
                              : workload.percent > 80
                              ? 'bg-[#FFB04D]'
                              : 'bg-[#00FFB4]'
                          }`}
                          style={{ width: `${Math.min(workload.percent, 200)}%` }}
                        />
                      </div>
                      <p className="text-xs text-[rgba(255,255,255,0.50)]">
                        {workload.hours}h/semana
                      </p>
                    </div>
                  </div>
                )}

                {/* Allocation Form */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="role" className="text-[rgba(255,255,255,0.85)]">
                      Função no Projeto *
                    </Label>
                    <Input
                      id="role"
                      value={formData.role}
                      onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                      placeholder="Ex: Desenvolvedor Full Stack, Designer UX, Gerente de Projeto"
                      className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="allocation" className="text-[rgba(255,255,255,0.85)]">
                        Percentual de Alocação (%) *
                      </Label>
                      <Input
                        id="allocation"
                        type="number"
                        min="1"
                        max="200"
                        value={formData.allocationPercent}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            allocationPercent: parseInt(e.target.value) || 0,
                          })
                        }
                        className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
                      />
                      <p className="text-xs text-[rgba(255,255,255,0.50)]">
                        100% = tempo integral no projeto
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="hours" className="text-[rgba(255,255,255,0.85)]">
                        Horas por Semana *
                      </Label>
                      <Input
                        id="hours"
                        type="number"
                        min="1"
                        max="80"
                        value={formData.hoursPerWeek}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            hoursPerWeek: parseInt(e.target.value) || 0,
                          })
                        }
                        className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
                      />
                      <p className="text-xs text-[rgba(255,255,255,0.50)]">
                        Horas semanais dedicadas ao projeto
                      </p>
                    </div>
                  </div>

                  {/* Projected Workload */}
                  {newWorkload && (
                    <div className="p-4 rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]">
                      <h5 className="text-sm font-semibold text-white mb-3">
                        Ocupação Após Alocação
                      </h5>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-[rgba(255,255,255,0.65)]">
                            Nova Ocupação
                          </span>
                          <span
                            className={`text-sm font-bold ${
                              newWorkload.percent > 100
                                ? 'text-[#FF5860]'
                                : newWorkload.percent > 80
                                ? 'text-[#FFB04D]'
                                : 'text-[#00FFB4]'
                            }`}
                          >
                            {newWorkload.percent}%
                          </span>
                        </div>
                        <div className="w-full bg-[rgba(255,255,255,0.05)] rounded-full h-2">
                          <div
                            className={`h-2 rounded-full ${
                              newWorkload.percent > 100
                                ? 'bg-[#FF5860]'
                                : newWorkload.percent > 80
                                ? 'bg-[#FFB04D]'
                                : 'bg-[#00FFB4]'
                            }`}
                            style={{ width: `${Math.min(newWorkload.percent, 200)}%` }}
                          />
                        </div>
                        <p className="text-xs text-[rgba(255,255,255,0.50)]">
                          {newWorkload.hours}h/semana total
                        </p>
                        {newWorkload.percent > 100 && (
                          <p className="text-xs text-[#FF5860] flex items-center gap-1">
                            <UserIcon className="w-3 h-3" />
                            Atenção: Colaborador ficará sobrecarregado!
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <UserIcon className="w-12 h-12 mx-auto mb-3 text-[rgba(255,255,255,0.20)]" />
                <p className="text-[rgba(255,255,255,0.65)]">
                  Selecione um colaborador no organograma primeiro
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-4">
          <Button
            variant="outline"
            onClick={() => {
              setSelectedUser(null);
              setFormData({
                role: '',
                allocationPercent: 100,
                hoursPerWeek: 40,
              });
              onOpenChange(false);
            }}
            className="border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] text-white hover:bg-[rgba(255,255,255,0.08)]"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!selectedUser}
            className="bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0] font-medium shadow-[0_0_18px_rgba(0,255,180,0.18)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Adicionar ao Projeto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

