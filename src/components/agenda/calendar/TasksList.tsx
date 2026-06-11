'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { AlertTriangle, CheckCircle2, ClipboardList, Loader2 } from 'lucide-react';
import { HudButton, HudPanel } from '@/components/hud';
import { cn } from '@/lib/utils';
import type { OrgMember, Task } from '@/lib/types/agenda';
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from '@/lib/types/agenda';
import { completeTask, listMyPendings, listTasks } from '@/lib/services/agenda';
import { dueIntel, memberName, priorityClasses, taskStatusClasses } from './helpers';

interface Props {
  members: OrgMember[];
  reloadToken?: number;
  scope: 'all' | 'mine';
  onSelect: (taskId: string) => void;
  onChanged: () => void;
}

export function TasksList({ members, reloadToken = 0, scope, onSelect, onChanged }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = scope === 'mine' ? await listMyPendings() : await listTasks();
      setTasks(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar tarefas.');
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  const handleComplete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setBusyId(id);
    try {
      await completeTask(id);
      await load();
      onChanged();
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <HudPanel className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-ig-fg-muted" />
      </HudPanel>
    );
  }

  if (error) {
    return (
      <HudPanel className="flex flex-col items-center gap-2 py-16 text-center">
        <AlertTriangle className="h-8 w-8 text-ig-warning" />
        <p className="text-sm font-medium text-ig-fg-strong">Não foi possível carregar as tarefas</p>
        <p className="max-w-md text-xs text-ig-fg-muted">{error}</p>
      </HudPanel>
    );
  }

  if (tasks.length === 0) {
    return (
      <HudPanel className="flex flex-col items-center gap-2 py-16 text-center">
        <ClipboardList className="h-8 w-8 text-ig-fg-subtle" />
        <p className="text-sm text-ig-fg-muted">
          {scope === 'mine' ? 'Você não tem pendências. 🎉' : 'Nenhuma tarefa cadastrada.'}
        </p>
      </HudPanel>
    );
  }

  return (
    <HudPanel noPadding className="p-2">
      <div className="flex flex-col gap-1">
        {tasks.map((task) => {
          const pc = priorityClasses(task.priority);
          const intel = dueIntel(task);
          return (
            <button
              key={task.id}
              type="button"
              onClick={() => onSelect(task.id)}
              className="flex items-center gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel px-3 py-2.5 text-left transition-colors hover:border-ig-border-focus hover:bg-ig-panel-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ig-border-focus"
            >
              <span className={cn('h-8 w-1 flex-shrink-0 rounded-full', pc.dot)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className={cn('truncate text-sm font-medium', task.status === 'done' ? 'text-ig-fg-muted line-through' : 'text-ig-fg-strong')}>
                  {task.title}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ig-fg-muted">
                  <span className={cn('rounded px-1.5 py-0.5', pc.chip, 'border')}>{TASK_PRIORITY_LABELS[task.priority]}</span>
                  <span className={cn('rounded border px-1.5 py-0.5', taskStatusClasses(task.status))}>
                    {TASK_STATUS_LABELS[task.status]}
                  </span>
                  {task.assigneeUserId && <span>· {memberName(members, task.assigneeUserId)}</span>}
                  {task.dueAt && (
                    <span>
                      · {format(task.dueAt, 'dd MMM', { locale: ptBR })}
                    </span>
                  )}
                  {intel.label && (
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 font-medium',
                        intel.overdue
                          ? 'bg-ig-danger/12 text-ig-danger'
                          : intel.atRisk
                            ? 'bg-ig-warning/12 text-ig-warning'
                            : 'bg-ig-panel-hover text-ig-fg-muted',
                      )}
                    >
                      {intel.label}
                    </span>
                  )}
                </div>
              </div>
              {task.status !== 'done' && task.status !== 'cancelled' && (
                <HudButton
                  variant="ghost"
                  size="sm"
                  onClick={(e) => handleComplete(e, task.id)}
                  isLoading={busyId === task.id}
                  leftIcon={<CheckCircle2 className="h-4 w-4" />}
                >
                  Concluir
                </HudButton>
              )}
            </button>
          );
        })}
      </div>
    </HudPanel>
  );
}
