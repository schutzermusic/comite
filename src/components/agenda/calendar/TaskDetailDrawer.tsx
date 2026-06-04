'use client';

import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarClock, CheckCircle2, Loader2, Square, User } from 'lucide-react';
import { HudButton, HudDrawer, HudSelect, useHudToast } from '@/components/hud';
import { cn } from '@/lib/utils';
import type { OrgMember, Task, TaskStatus } from '@/lib/types/agenda';
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from '@/lib/types/agenda';
import { completeTask, getTaskById, reassignTask, toggleChecklistItem, updateTaskStatus } from '@/lib/services/agenda';
import { priorityClasses } from './helpers';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  taskId: string | null;
  members: OrgMember[];
  onChanged: () => void;
}

export function TaskDetailDrawer({ isOpen, onClose, taskId, members, onChanged }: Props) {
  const { toast } = useHudToast();
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = async (id: string) => {
    const fresh = await getTaskById(id);
    setTask(fresh);
  };

  useEffect(() => {
    if (!isOpen || !taskId) return;
    setLoading(true);
    getTaskById(taskId)
      .then(setTask)
      .catch((err) => toast({ title: 'Erro', description: err instanceof Error ? err.message : undefined, variant: 'destructive' }))
      .finally(() => setLoading(false));
  }, [isOpen, taskId, toast]);

  const changeStatus = async (status: TaskStatus) => {
    if (!task) return;
    setBusy(true);
    try {
      await updateTaskStatus(task.id, status);
      await reload(task.id);
      onChanged();
    } catch (e) {
      toast({ title: 'Falha ao atualizar', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const markDone = async () => {
    if (!task) return;
    setBusy(true);
    try {
      await completeTask(task.id);
      toast({ title: 'Tarefa concluída!' });
      await reload(task.id);
      onChanged();
    } catch (e) {
      toast({ title: 'Falha ao concluir', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const doReassign = async (userId: string) => {
    if (!task) return;
    setBusy(true);
    try {
      await reassignTask(task.id, userId || null);
      toast({ title: 'Tarefa reatribuída.' });
      await reload(task.id);
      onChanged();
    } catch (e) {
      toast({ title: 'Falha ao reatribuir', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const toggleItem = async (id: string, completed: boolean) => {
    if (!task) return;
    try {
      await toggleChecklistItem(id, completed);
      await reload(task.id);
    } catch (e) {
      toast({ title: 'Falha ao atualizar item', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  const pc = task ? priorityClasses(task.priority) : null;

  return (
    <HudDrawer isOpen={isOpen} onClose={onClose} title={task?.title ?? 'Tarefa'} subtitle="Detalhes da tarefa" width="460px">
      {loading ? (
        <div className="flex items-center justify-center py-16 text-ig-fg-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : !task ? (
        <p className="py-16 text-center text-sm text-ig-fg-muted">Tarefa não encontrada.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('rounded-full border px-2.5 py-0.5 text-xs', pc?.chip)}>
              {TASK_PRIORITY_LABELS[task.priority]}
            </span>
            <span className="rounded-full border border-ig-border bg-ig-panel px-2.5 py-0.5 text-xs text-ig-fg-strong">
              {TASK_STATUS_LABELS[task.status]}
            </span>
          </div>

          {task.dueAt && (
            <div className="flex items-center gap-2 text-sm text-ig-fg-strong">
              <CalendarClock className="h-4 w-4 text-ig-accent" />
              {format(task.dueAt, "EEE, dd 'de' MMM 'de' yyyy", { locale: ptBR })}
              {!task.dueAllDay ? ` às ${format(task.dueAt, 'HH:mm')}` : ''}
            </div>
          )}

          {task.description && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ig-fg-muted">Descrição</p>
              <p className="whitespace-pre-wrap text-sm text-ig-fg-strong">{task.description}</p>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ig-fg-muted">
              <User className="h-3.5 w-3.5" /> Responsável
            </label>
            <HudSelect
              value={task.assigneeUserId ?? ''}
              onChange={doReassign}
              placeholder="Sem responsável"
              options={[
                { value: '', label: 'Sem responsável' },
                ...members.map((m) => ({ value: m.userId, label: m.fullName || m.email || 'Usuário' })),
              ]}
            />
          </div>

          {task.checklist && task.checklist.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ig-fg-muted">Checklist</p>
              <div className="flex flex-col gap-1">
                {task.checklist.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleItem(c.id, !c.completed)}
                    className="flex items-center gap-2 rounded-md border border-ig-border-subtle bg-ig-panel px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-ig-panel-hover"
                  >
                    {c.completed ? (
                      <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-ig-success" />
                    ) : (
                      <Square className="h-4 w-4 flex-shrink-0 text-ig-fg-subtle" />
                    )}
                    <span className={cn('truncate', c.completed ? 'text-ig-fg-muted line-through' : 'text-ig-fg-strong')}>{c.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2 border-t border-ig-border-subtle pt-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-ig-fg-muted">Alterar status</label>
              <HudSelect
                value={task.status}
                onChange={(v) => changeStatus(v as TaskStatus)}
                options={(Object.keys(TASK_STATUS_LABELS) as TaskStatus[]).map((k) => ({ value: k, label: TASK_STATUS_LABELS[k] }))}
              />
            </div>
            {task.status !== 'done' && (
              <HudButton variant="primary" onClick={markDone} isLoading={busy} leftIcon={<CheckCircle2 className="h-4 w-4" />} fullWidth>
                Marcar como concluída
              </HudButton>
            )}
          </div>
        </div>
      )}
    </HudDrawer>
  );
}
