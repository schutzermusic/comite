'use client';

import { useState } from "react";
import { ProjectTask } from "@/lib/types";
import { HUDCard } from "@/components/ui/hud-card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Badge } from "@/components/ui/badge";
import { PrimaryCTA } from "@/components/ui/primary-cta";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Plus, Calendar, User, Diamond, Filter } from "lucide-react";
import { format, differenceInDays, addDays, startOfMonth, endOfMonth, eachDayOfInterval } from "date-fns";
import { pt } from "date-fns/locale";
import { AddTaskDialog } from "./add-task-dialog";

interface TimelineGanttViewProps {
  projectId: string;
  tasks: ProjectTask[];
  onAddTask?: (task: Omit<ProjectTask, 'id'>) => void;
  onTaskClick?: (task: ProjectTask) => void;
}

export function TimelineGanttView({ projectId, tasks, onAddTask, onTaskClick }: TimelineGanttViewProps) {
  const [dateRange, setDateRange] = useState<'30' | '60' | '90'>('60');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [responsibleFilter, setResponsibleFilter] = useState<string>('all');
  const [selectedTask, setSelectedTask] = useState<ProjectTask | null>(null);
  const [addTaskDialogOpen, setAddTaskDialogOpen] = useState(false);

  // Calculate timeline range
  const today = new Date();
  const timelineStart = startOfMonth(today);
  const timelineEnd = endOfMonth(addDays(today, parseInt(dateRange)));
  const timelineDays = eachDayOfInterval({ start: timelineStart, end: timelineEnd });

  // Filter tasks
  const filteredTasks = tasks.filter(task => {
    if (statusFilter !== 'all' && task.status !== statusFilter) return false;
    if (responsibleFilter !== 'all' && task.responsibleId !== responsibleFilter) return false;
    return true;
  });

  // Auto-update delayed tasks
  const processedTasks = filteredTasks.map(task => {
    const isDelayed = new Date(task.endDate) < today && task.status !== 'completed';
    return {
      ...task,
      status: isDelayed ? 'delayed' as const : task.status
    };
  });

  // Get unique responsible users
  const responsibleUsers = Array.from(new Set(tasks.map(t => t.responsibleId).filter(Boolean)));

  // Calculate task position and width
  const getTaskPosition = (task: ProjectTask) => {
    const start = new Date(task.startDate);
    const end = new Date(task.endDate);
    const totalDays = differenceInDays(timelineEnd, timelineStart);
    const startOffset = differenceInDays(start, timelineStart);
    const duration = differenceInDays(end, start);
    
    return {
      left: `${(startOffset / totalDays) * 100}%`,
      width: `${(duration / totalDays) * 100}%`,
    };
  };

  // Task color by status
  const getTaskColor = (status: ProjectTask['status']) => {
    switch (status) {
      case 'completed':
        return 'bg-[#00FFB4] border-[#00E6A0] shadow-[0_0_12px_rgba(0,255,180,0.3)]';
      case 'in_progress':
        return 'bg-[#00C8FF] border-[#00B0E0] shadow-[0_0_12px_rgba(0,200,255,0.3)]';
      case 'delayed':
        return 'bg-[#FF5860] border-[#FF4040] shadow-[0_0_12px_rgba(255,88,96,0.3)]';
      case 'not_started':
        return 'bg-[rgba(255,255,255,0.20)] border-[rgba(255,255,255,0.30)]';
      default:
        return 'bg-[rgba(255,255,255,0.30)] border-[rgba(255,255,255,0.40)]';
    }
  };

  const handleTaskClick = (task: ProjectTask) => {
    setSelectedTask(task);
    onTaskClick?.(task);
  };

  return (
    <div className="space-y-6">
      {/* Filters & Actions */}
      <HUDCard>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <Filter className="w-4 h-4 text-[rgba(255,255,255,0.65)]" />
            
            <Select value={dateRange} onValueChange={(v) => setDateRange(v as any)}>
              <SelectTrigger className="w-[140px] bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,200,255,0.35)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.08)] text-white">
                <SelectItem value="30">30 dias</SelectItem>
                <SelectItem value="60">60 dias</SelectItem>
                <SelectItem value="90">90 dias</SelectItem>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px] bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,200,255,0.35)]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent className="bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.08)] text-white">
                <SelectItem value="all">Todos Status</SelectItem>
                <SelectItem value="not_started">Não Iniciado</SelectItem>
                <SelectItem value="in_progress">Em Andamento</SelectItem>
                <SelectItem value="completed">Concluído</SelectItem>
                <SelectItem value="delayed">Atrasado</SelectItem>
              </SelectContent>
            </Select>

            <Select value={responsibleFilter} onValueChange={setResponsibleFilter}>
              <SelectTrigger className="w-[160px] bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,200,255,0.35)]">
                <SelectValue placeholder="Responsável" />
              </SelectTrigger>
              <SelectContent className="bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.08)] text-white">
                <SelectItem value="all">Todos</SelectItem>
                {responsibleUsers.map(userId => {
                  const task = tasks.find(t => t.responsibleId === userId);
                  return (
                    <SelectItem key={userId} value={userId!}>
                      {task?.responsibleName || userId}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <PrimaryCTA onClick={() => setAddTaskDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Nova Tarefa
          </PrimaryCTA>
        </div>
      </HUDCard>

      {/* Gantt Chart */}
      <HUDCard className="p-6 overflow-hidden relative">
        <div className="space-y-4">
          {/* Timeline Header */}
          <div className="flex items-center border-b border-[rgba(255,255,255,0.08)] pb-4">
            <div className="w-64 flex-shrink-0 font-semibold text-sm text-white">
              Tarefa
            </div>
            <div className="flex-1 relative">
              <div className="flex justify-between text-xs text-[rgba(255,255,255,0.65)] mb-2">
                {[0, 25, 50, 75, 100].map(percent => {
                  const day = addDays(timelineStart, (timelineDays.length * percent) / 100);
                  return (
                    <div key={percent} className="text-center">
                      {format(day, 'dd MMM', { locale: pt })}
                    </div>
                  );
                })}
              </div>
              <div className="h-px bg-gradient-to-r from-[rgba(255,255,255,0.08)] via-[rgba(0,255,180,0.25)] to-[rgba(255,255,255,0.08)]" />
            </div>
          </div>
          
          {/* Task Rows */}
          <div className="space-y-3 max-h-[600px] overflow-y-auto relative">
            {/* Today Line */}
            <div 
              className="absolute top-0 bottom-0 w-0.5 bg-[#FF5860] pointer-events-none z-10" 
              style={{
                left: `calc(256px + ${(differenceInDays(today, timelineStart) / differenceInDays(timelineEnd, timelineStart)) * 100}%)`,
              }}
            >
              <div className="absolute -top-2 -left-2 w-4 h-4 bg-[#FF5860] rounded-full shadow-[0_0_8px_rgba(255,88,96,0.5)]" />
            </div>
            
            {processedTasks.length === 0 ? (
              <div className="text-center py-12">
                <Calendar className="w-12 h-12 mx-auto mb-3 text-[rgba(255,255,255,0.20)]" />
                <p className="text-[rgba(255,255,255,0.65)]">Nenhuma tarefa encontrada</p>
                <p className="text-sm text-[rgba(255,255,255,0.50)]">Adicione tarefas para visualizar o cronograma</p>
              </div>
            ) : (
              processedTasks.map((task) => {
                const position = getTaskPosition(task);
                return (
                  <div key={task.id} className="flex items-center group relative z-0">
                    {/* Task Name */}
                    <div className="w-64 flex-shrink-0 pr-4">
                      <div className="flex items-center gap-2">
                        {task.milestone && (
                          <Diamond className="w-3 h-3 text-[#FF7A3D] fill-[#FF7A3D]" />
                        )}
                        <span className="text-sm font-medium text-white truncate">
                          {task.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {task.responsibleName && (
                          <span className="text-xs text-[rgba(255,255,255,0.65)] flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {task.responsibleName}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Gantt Bar */}
                    <div className="flex-1 relative h-10">
                      <div
                        className={`absolute top-1/2 -translate-y-1/2 h-8 rounded-md cursor-pointer transition-all duration-200 hover:scale-105 hover:shadow-lg border-2 ${getTaskColor(task.status)}`}
                        style={{
                          left: position.left,
                          width: position.width,
                          minWidth: '40px',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                        }}
                        onClick={() => handleTaskClick(task)}
                      >
                        <div className="px-2 py-1 text-xs font-medium text-white truncate flex items-center justify-center h-full">
                          {task.progress ? `${task.progress}%` : ''}
                        </div>
                      </div>
                    </div>

                    {/* Status Badge */}
                    <div className="w-32 flex-shrink-0 pl-4">
                      <StatusPill 
                        variant={
                          task.status === 'completed' ? 'completed' :
                          task.status === 'in_progress' ? 'active' :
                          task.status === 'delayed' ? 'critical' :
                          'neutral'
                        }
                        className="text-xs"
                      >
                        {task.status === 'completed' ? 'Concluído' :
                         task.status === 'in_progress' ? 'Em Andamento' :
                         task.status === 'delayed' ? 'Atrasado' :
                         'Não Iniciado'}
                      </StatusPill>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </HUDCard>

      {/* Task Detail Drawer */}
      <Sheet open={!!selectedTask} onOpenChange={() => setSelectedTask(null)}>
        <SheetContent className="w-[400px] bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.10)]">
          {selectedTask && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 text-white">
                  {selectedTask.milestone && (
                    <Diamond className="w-4 h-4 text-[#FF7A3D] fill-[#FF7A3D]" />
                  )}
                  {selectedTask.name}
                </SheetTitle>
                <SheetDescription className="text-[rgba(255,255,255,0.65)]">
                  Detalhes da tarefa
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-4">
                <div>
                  <label className="text-sm font-medium text-[rgba(255,255,255,0.85)]">Status</label>
                  <div className="mt-1">
                    <StatusPill 
                      variant={
                        selectedTask.status === 'completed' ? 'completed' :
                        selectedTask.status === 'in_progress' ? 'active' :
                        selectedTask.status === 'delayed' ? 'critical' :
                        'neutral'
                      }
                    >
                      {selectedTask.status === 'completed' ? 'Concluído' :
                       selectedTask.status === 'in_progress' ? 'Em Andamento' :
                       selectedTask.status === 'delayed' ? 'Atrasado' :
                       'Não Iniciado'}
                    </StatusPill>
                  </div>
                </div>

                {selectedTask.description && (
                  <div>
                    <label className="text-sm font-medium text-[rgba(255,255,255,0.85)]">Descrição</label>
                    <p className="mt-1 text-sm text-[rgba(255,255,255,0.65)]">{selectedTask.description}</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-[rgba(255,255,255,0.85)]">Início</label>
                    <p className="mt-1 text-sm text-white">
                      {format(new Date(selectedTask.startDate), 'dd/MM/yyyy')}
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-[rgba(255,255,255,0.85)]">Fim</label>
                    <p className="mt-1 text-sm text-white">
                      {format(new Date(selectedTask.endDate), 'dd/MM/yyyy')}
                    </p>
                  </div>
                </div>

                {selectedTask.responsibleName && (
                  <div>
                    <label className="text-sm font-medium text-[rgba(255,255,255,0.85)]">Responsável</label>
                    <p className="mt-1 text-sm text-white flex items-center gap-2">
                      <User className="w-4 h-4" />
                      {selectedTask.responsibleName}
                    </p>
                  </div>
                )}

                {selectedTask.dependencies && selectedTask.dependencies.length > 0 && (
                  <div>
                    <label className="text-sm font-medium text-[rgba(255,255,255,0.85)]">Dependências</label>
                    <div className="mt-2 space-y-2">
                      {selectedTask.dependencies.map(depId => {
                        const dep = tasks.find(t => t.id === depId);
                        return dep ? (
                          <Badge 
                            key={depId} 
                            variant="outline" 
                            className="text-xs bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.65)] border-[rgba(255,255,255,0.12)]"
                          >
                            {dep.name}
                          </Badge>
                        ) : null;
                      })}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Add Task Dialog */}
      <AddTaskDialog
        open={addTaskDialogOpen}
        onOpenChange={setAddTaskDialogOpen}
        projectId={projectId}
        existingTasks={tasks}
        onAddTask={(task) => {
          onAddTask?.(task);
          setAddTaskDialogOpen(false);
        }}
      />
    </div>
  );
}

