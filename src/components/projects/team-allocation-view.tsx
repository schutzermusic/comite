'use client';

import { useState } from "react";
import { ProjectAllocation } from "@/lib/types";
import { HUDCard } from "@/components/ui/hud-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusPill } from "@/components/ui/status-pill";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PrimaryCTA } from "@/components/ui/primary-cta";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle,
  Users,
  TrendingUp,
  Edit,
  Plus,
  Info
} from "lucide-react";
import { AddMemberDialog } from "./add-member-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TeamAllocationViewProps {
  projectId: string;
  allocations: ProjectAllocation[];
  onEditAllocation?: (allocation: ProjectAllocation) => void;
  onAddMember?: (allocation: Omit<ProjectAllocation, 'id'>) => void;
}

export function TeamAllocationView({ 
  projectId, 
  allocations, 
  onEditAllocation,
  onAddMember 
}: TeamAllocationViewProps) {
  const [selectedAllocation, setSelectedAllocation] = useState<ProjectAllocation | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [addMemberDialogOpen, setAddMemberDialogOpen] = useState(false);

  // Calculate KPIs
  const averageCapacity = allocations.length > 0
    ? allocations.reduce((sum, a) => sum + a.allocationPercent, 0) / allocations.length
    : 0;

  const overloadedMembers = allocations.filter(a => a.allocationPercent > 100).length;
  
  const criticalMembers = allocations.filter(a => a.critical).length;

  // Get capacity color
  const getCapacityColor = (percent: number) => {
    if (percent <= 80) return 'emerald';
    if (percent <= 100) return 'yellow';
    return 'red';
  };

  // Get capacity label
  const getCapacityLabel = (percent: number) => {
    if (percent <= 80) return 'Disponível';
    if (percent <= 100) return 'Completo';
    return 'Sobrecarga';
  };

  const handleEdit = (allocation: ProjectAllocation) => {
    setSelectedAllocation(allocation);
    setEditDialogOpen(true);
  };

  const getMemberInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <HUDCard glow glowColor="cyan">
          <div className="flex items-center justify-between mb-2">
            <TrendingUp className="w-6 h-6 text-[#00C8FF]" />
          </div>
          <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Capacidade Média</p>
          <p className="text-3xl font-semibold text-white">{averageCapacity.toFixed(0)}%</p>
          <p className="text-xs text-[rgba(255,255,255,0.50)] mt-1">do time alocado</p>
        </HUDCard>
        <HUDCard glow glowColor={overloadedMembers > 0 ? "red" : "amber"}>
          <div className="flex items-center justify-between mb-2">
            <AlertTriangle className={`w-6 h-6 ${overloadedMembers > 0 ? 'text-[#FF5860]' : 'text-[#FFB04D]'}`} />
          </div>
          <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Sobrecarregados</p>
          <p className="text-3xl font-semibold text-white">{overloadedMembers}</p>
          <p className="text-xs text-[rgba(255,255,255,0.50)] mt-1">acima de 100%</p>
        </HUDCard>
        <HUDCard glow glowColor="green">
          <div className="flex items-center justify-between mb-2">
            <Users className="w-6 h-6 text-[#00FFB4]" />
          </div>
          <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Total da Equipe</p>
          <p className="text-3xl font-semibold text-white">{allocations.length}</p>
          <p className="text-xs text-[rgba(255,255,255,0.50)] mt-1">membros alocados</p>
        </HUDCard>
      </div>

      {/* Team Allocation Cards */}
      <HUDCard>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-semibold text-white orion-text-heading">Alocação da Equipe</h3>
            <p className="text-sm text-[rgba(255,255,255,0.65)]">Capacidade e distribuição de recursos</p>
          </div>
          <PrimaryCTA onClick={() => setAddMemberDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Adicionar Membro
          </PrimaryCTA>
        </div>

        <div className="space-y-4">
          {allocations.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-12 h-12 mx-auto mb-3 text-[rgba(255,255,255,0.20)]" />
              <p className="text-[rgba(255,255,255,0.65)]">Nenhum membro alocado</p>
              <p className="text-sm text-[rgba(255,255,255,0.50)]">Adicione membros para gerenciar a capacidade do projeto</p>
            </div>
          ) : (
            allocations.map((allocation) => {
              const capacityColor = getCapacityColor(allocation.allocationPercent);
              const capacityLabel = getCapacityLabel(allocation.allocationPercent);
              const isOverloaded = allocation.allocationPercent > 100;

              return (
                <div
                  key={allocation.id}
                  className={`p-4 rounded-xl border transition-all ${
                    isOverloaded 
                      ? 'border-[rgba(255,88,96,0.25)] bg-[rgba(255,88,96,0.08)] hover:bg-[rgba(255,88,96,0.12)]' 
                      : 'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.05)]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    {/* Member Info */}
                    <div className="flex items-start gap-3 flex-1">
                      <Avatar className="w-12 h-12 border-2 border-[rgba(255,255,255,0.12)]">
                        <AvatarFallback className="bg-gradient-to-br from-[#FF7A3D] to-[#008751] text-white font-semibold">
                          {getMemberInitials(allocation.memberName)}
                        </AvatarFallback>
                      </Avatar>

                      <div className="flex-1 space-y-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-semibold text-white">{allocation.memberName}</h4>
                            {isOverloaded && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger>
                                    <AlertTriangle className="w-4 h-4 text-[#FF5860]" />
                                  </TooltipTrigger>
                                  <TooltipContent className="bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.08)] text-white">
                                    <p className="text-sm max-w-xs">
                                      <strong>Sobrecarga Detectada</strong>
                                      <br />
                                      Considere redistribuir tarefas ou ajustar prazos.
                                      <br />
                                      Capacidade ideal: até 100%
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </div>
                          <p className="text-sm text-[rgba(255,255,255,0.65)]">{allocation.role}</p>
                        </div>

                        {/* Capacity Bar */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-[rgba(255,255,255,0.85)]">
                              Ocupação
                            </span>
                            <div className="flex items-center gap-2">
                              <StatusPill 
                                variant={
                                  capacityColor === 'emerald' ? 'active' :
                                  capacityColor === 'yellow' ? 'warning' :
                                  'critical'
                                }
                                className="text-xs"
                              >
                                {capacityLabel}
                              </StatusPill>
                              <span className="text-sm font-bold text-white">
                                {allocation.allocationPercent}%
                              </span>
                            </div>
                          </div>
                          
                          <Progress 
                            value={Math.min(allocation.allocationPercent, 200)} 
                            max={200}
                            className={`h-3 ${
                              capacityColor === 'emerald' ? '[&>div]:bg-[#00FFB4]' :
                              capacityColor === 'yellow' ? '[&>div]:bg-[#FFB04D]' :
                              '[&>div]:bg-[#FF5860]'
                            }`}
                          />

                          {allocation.hoursPerWeek && (
                            <p className="text-xs text-[rgba(255,255,255,0.50)]">
                              {allocation.hoursPerWeek}h/semana
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(allocation)}
                      className="border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.08)] text-white"
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </HUDCard>

      {/* Capacity Legend */}
      <HUDCard>
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <Info className="w-4 h-4 text-[rgba(255,255,255,0.65)]" />
          <span className="font-medium text-white">Legenda de Capacidade:</span>
          <div className="flex items-center gap-4 ml-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-[#00FFB4]" />
              <span className="text-[rgba(255,255,255,0.65)]">0-80% (Disponível)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-[#FFB04D]" />
              <span className="text-[rgba(255,255,255,0.65)]">81-100% (Completo)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-[#FF5860]" />
              <span className="text-[rgba(255,255,255,0.65)]">&gt;100% (Sobrecarga)</span>
            </div>
          </div>
        </div>
      </HUDCard>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-[425px] bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.10)]">
          <DialogHeader>
            <DialogTitle className="text-white">Editar Alocação</DialogTitle>
            <DialogDescription className="text-[rgba(255,255,255,0.65)]">
              Ajuste a alocação de {selectedAllocation?.memberName}
            </DialogDescription>
          </DialogHeader>

          {selectedAllocation && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="allocation" className="text-[rgba(255,255,255,0.85)]">Percentual de Alocação (%)</Label>
                <Input
                  id="allocation"
                  type="number"
                  min="0"
                  max="200"
                  defaultValue={selectedAllocation.allocationPercent}
                  placeholder="100"
                  className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="hours" className="text-[rgba(255,255,255,0.85)]">Horas por Semana</Label>
                <Input
                  id="hours"
                  type="number"
                  min="0"
                  max="80"
                  defaultValue={selectedAllocation.hoursPerWeek}
                  placeholder="40"
                  className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="role" className="text-[rgba(255,255,255,0.85)]">Função no Projeto</Label>
                <Input
                  id="role"
                  defaultValue={selectedAllocation.role}
                  placeholder="Ex: Developer, Designer"
                  className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setEditDialogOpen(false)}
              className="border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] text-white hover:bg-[rgba(255,255,255,0.08)]"
            >
              Cancelar
            </Button>
            <Button 
              onClick={() => {
                if (selectedAllocation && onEditAllocation) {
                  onEditAllocation(selectedAllocation);
                }
                setEditDialogOpen(false);
              }}
              className="bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0] font-medium shadow-[0_0_18px_rgba(0,255,180,0.18)]"
            >
              Salvar Alterações
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Member Dialog */}
      <AddMemberDialog
        open={addMemberDialogOpen}
        onOpenChange={setAddMemberDialogOpen}
        projectId={projectId}
        existingAllocations={allocations}
        onAddMember={(allocation) => {
          onAddMember?.(allocation);
          setAddMemberDialogOpen(false);
        }}
      />
    </div>
  );
}

