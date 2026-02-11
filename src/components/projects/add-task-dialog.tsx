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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { ProjectTask } from '@/lib/types';
import { users } from '@/lib/mock-data';

interface AddTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  existingTasks?: ProjectTask[];
  onAddTask: (task: Omit<ProjectTask, 'id'>) => void;
}

export function AddTaskDialog({
  open,
  onOpenChange,
  projectId,
  existingTasks = [],
  onAddTask,
}: AddTaskDialogProps) {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    startDate: '',
    endDate: '',
    status: 'not_started' as ProjectTask['status'],
    responsibleId: '',
    milestone: false,
    dependencies: [] as string[],
    progress: 0,
  });

  const handleSubmit = () => {
    if (!formData.name || !formData.startDate || !formData.endDate) {
      toast({
        title: 'Campos obrigatórios',
        description: 'Preencha nome, data de início e data de fim da tarefa.',
        variant: 'destructive',
      });
      return;
    }

    const startDate = new Date(formData.startDate);
    const endDate = new Date(formData.endDate);

    if (endDate < startDate) {
      toast({
        title: 'Data inválida',
        description: 'A data de fim deve ser posterior à data de início.',
        variant: 'destructive',
      });
      return;
    }

    const responsible = users.find(u => u.id === formData.responsibleId);

    onAddTask({
      projectId,
      name: formData.name,
      description: formData.description || undefined,
      startDate,
      endDate,
      status: formData.status,
      responsibleId: formData.responsibleId || undefined,
      responsibleName: responsible?.nome || undefined,
      milestone: formData.milestone,
      dependencies: formData.dependencies,
      progress: formData.progress,
    });

    toast({
      title: 'Tarefa adicionada',
      description: 'A tarefa foi criada com sucesso.',
    });

    // Reset form
    setFormData({
      name: '',
      description: '',
      startDate: '',
      endDate: '',
      status: 'not_started',
      responsibleId: '',
      milestone: false,
      dependencies: [],
      progress: 0,
    });

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.10)]">
        <DialogHeader>
          <DialogTitle className="text-white">Nova Tarefa</DialogTitle>
          <DialogDescription className="text-[rgba(255,255,255,0.65)]">
            Adicione uma nova tarefa ao projeto
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-[rgba(255,255,255,0.85)]">
              Nome da Tarefa *
            </Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Ex: Desenvolvimento do MVP"
              className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description" className="text-[rgba(255,255,255,0.85)]">
              Descrição
            </Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Descreva os detalhes da tarefa..."
              rows={3}
              className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startDate" className="text-[rgba(255,255,255,0.85)]">
                Data de Início *
              </Label>
              <Input
                id="startDate"
                type="date"
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white focus:border-[rgba(0,255,180,0.25)]"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="endDate" className="text-[rgba(255,255,255,0.85)]">
                Data de Fim *
              </Label>
              <Input
                id="endDate"
                type="date"
                value={formData.endDate}
                onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white focus:border-[rgba(0,255,180,0.25)]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="status" className="text-[rgba(255,255,255,0.85)]">
                Status
              </Label>
              <Select
                value={formData.status}
                onValueChange={(value) => setFormData({ ...formData, status: value as ProjectTask['status'] })}
              >
                <SelectTrigger className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.08)] text-white">
                  <SelectItem value="not_started">Não Iniciado</SelectItem>
                  <SelectItem value="in_progress">Em Andamento</SelectItem>
                  <SelectItem value="completed">Concluído</SelectItem>
                  <SelectItem value="delayed">Atrasado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="responsible" className="text-[rgba(255,255,255,0.85)]">
                Responsável
              </Label>
              <Select
                value={formData.responsibleId}
                onValueChange={(value) => setFormData({ ...formData, responsibleId: value })}
              >
                <SelectTrigger className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)]">
                  <SelectValue placeholder="Selecione um responsável" />
                </SelectTrigger>
                <SelectContent className="bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.08)] text-white">
                  <SelectItem value="">Nenhum</SelectItem>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {existingTasks.length > 0 && (
            <div className="space-y-2">
              <Label className="text-[rgba(255,255,255,0.85)]">Dependências (Opcional)</Label>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {existingTasks.map((task) => (
                  <div key={task.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`dep-${task.id}`}
                      checked={formData.dependencies.includes(task.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setFormData({
                            ...formData,
                            dependencies: [...formData.dependencies, task.id],
                          });
                        } else {
                          setFormData({
                            ...formData,
                            dependencies: formData.dependencies.filter((id) => id !== task.id),
                          });
                        }
                      }}
                    />
                    <label
                      htmlFor={`dep-${task.id}`}
                      className="text-sm text-[rgba(255,255,255,0.65)] cursor-pointer"
                    >
                      {task.name}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center space-x-2">
            <Checkbox
              id="milestone"
              checked={formData.milestone}
              onCheckedChange={(checked) => setFormData({ ...formData, milestone: !!checked })}
            />
            <label
              htmlFor="milestone"
              className="text-sm text-[rgba(255,255,255,0.85)] cursor-pointer"
            >
              Marcar como marco (Milestone)
            </label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="progress" className="text-[rgba(255,255,255,0.85)]">
              Progresso (%)
            </Label>
            <Input
              id="progress"
              type="number"
              min="0"
              max="100"
              value={formData.progress}
              onChange={(e) => setFormData({ ...formData, progress: parseInt(e.target.value) || 0 })}
              className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] text-white hover:bg-[rgba(255,255,255,0.08)]"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            className="bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0] font-medium shadow-[0_0_18px_rgba(0,255,180,0.18)]"
          >
            Adicionar Tarefa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

