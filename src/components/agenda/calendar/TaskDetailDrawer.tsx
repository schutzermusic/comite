'use client';

import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  BellRing,
  CalendarClock,
  CheckCircle2,
  GitBranch,
  History,
  Loader2,
  Pencil,
  Plus,
  Repeat,
  Square,
  User,
} from 'lucide-react';
import { HudButton, HudDrawer, HudInput, HudSelect, useHudToast } from '@/components/hud';
import { cn } from '@/lib/utils';
import type { OrgMember, Task, TaskPriority, TaskStatus } from '@/lib/types/agenda';
import {
  RECURRENCE_FREQ_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_REMINDER_LABELS,
  TASK_STATUS_LABELS,
} from '@/lib/types/agenda';
import {
  addChecklistItem,
  completeTask,
  getTaskById,
  reassignTask,
  toggleChecklistItem,
  updateTask,
  updateTaskStatus,
} from '@/lib/services/agenda';
import { dueIntel, memberName, priorityClasses, taskStatusClasses } from './helpers';
import { LinkedModuleSection } from './LinkedModuleSection';
import { TaskCommentsThread } from './TaskCommentsThread';
import { AttachmentsSection } from './AttachmentsSection';

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
  const [blocker, setBlocker] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // Edit mode (título, descrição, prazo, prioridade).
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editDueTime, setEditDueTime] = useState('');
  const [editPriority, setEditPriority] = useState<TaskPriority>('medium');

  const [checklistDraft, setChecklistDraft] = useState('');

  const reload = async (id: string) => {
    const fresh = await getTaskById(id);
    setTask(fresh);
    if (fresh?.blockedByTaskId) {
      getTaskById(fresh.blockedByTaskId).then(setBlocker).catch(() => setBlocker(null));
    } else {
      setBlocker(null);
    }
  };

  useEffect(() => {
    if (!isOpen || !taskId) return;
    setLoading(true);
    setEditing(false);
    reload(taskId)
      .catch((err) => toast({ title: 'Erro', description: err instanceof Error ? err.message : undefined, variant: 'destructive' }))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, taskId]);

  const startEditing = () => {
    if (!task) return;
    setEditTitle(task.title);
    setEditDescription(task.description ?? '');
    setEditDueDate(task.dueAt ? format(task.dueAt, 'yyyy-MM-dd') : '');
    setEditDueTime(task.dueAt && !task.dueAllDay ? format(task.dueAt, 'HH:mm') : '');
    setEditPriority(task.priority);
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!task) return;
    if (!editTitle.trim()) {
      toast({ title: 'O título não pode ficar vazio.', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      await updateTask(task.id, {
        title: editTitle.trim(),
        description: editDescription.trim() || null,
        dueAt: editDueDate ? `${editDueDate}T${editDueTime || '09:00'}` : null,
        dueAllDay: !editDueTime,
        priority: editPriority,
      });
      toast({ title: 'Tarefa atualizada.' });
      setEditing(false);
      await reload(task.id);
      onChanged();
    } catch (e) {
      toast({ title: 'Falha ao atualizar', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

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
    if (blocker && blocker.status !== 'done' && blocker.status !== 'cancelled') {
      const ok = window.confirm(
        `Esta tarefa depende de "${blocker.title}", que ainda está aberta. Concluir mesmo assim?`,
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      const spawnedId = await completeTask(task.id);
      toast({
        title: 'Tarefa concluída!',
        description: spawnedId ? 'Próxima ocorrência criada automaticamente.' : undefined,
      });
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

  const addItem = async () => {
    const title = checklistDraft.trim();
    if (!task || !title) return;
    try {
      await addChecklistItem(task.id, title);
      setChecklistDraft('');
      await reload(task.id);
    } catch (e) {
      toast({ title: 'Falha ao adicionar item', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  const pc = task ? priorityClasses(task.priority) : null;
  const intel = task ? dueIntel(task) : null;

  return (
    <HudDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={task?.title ?? 'Tarefa'}
      subtitle="Detalhes da tarefa"
      width="480px"
      footer={
        task && !loading ? (
          <div className="flex flex-wrap gap-2">
            {task.status !== 'done' && (
              <HudButton variant="primary" size="sm" onClick={markDone} isLoading={busy} leftIcon={<CheckCircle2 className="h-4 w-4" />} className="flex-1">
                Marcar como concluída
              </HudButton>
            )}
            <HudButton variant="secondary" size="sm" onClick={editing ? saveEdit : startEditing} isLoading={busy && editing} leftIcon={<Pencil className="h-3.5 w-3.5" />} className="flex-1">
              {editing ? 'Salvar alterações' : 'Editar'}
            </HudButton>
          </div>
        ) : undefined
      }
    >
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
            <span className={cn('rounded-full border px-2.5 py-0.5 text-xs', taskStatusClasses(task.status))}>
              {TASK_STATUS_LABELS[task.status]}
            </span>
            {intel?.label && (
              <span
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-xs',
                  intel.overdue
                    ? 'border-ig-danger/30 bg-ig-danger/12 text-ig-danger'
                    : intel.atRisk
                      ? 'border-ig-warning/30 bg-ig-warning/12 text-ig-warning'
                      : 'border-ig-border bg-ig-panel text-ig-fg-muted',
                )}
              >
                {intel.label}
              </span>
            )}
            {task.recurrenceFreq && (
              <span className="flex items-center gap-1 rounded-full border border-ig-border bg-ig-panel px-2.5 py-0.5 text-xs text-ig-fg-muted">
                <Repeat className="h-3 w-3" />
                {RECURRENCE_FREQ_LABELS[task.recurrenceFreq]}
              </span>
            )}
          </div>

          {editing ? (
            <div className="flex flex-col gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel p-3">
              <HudInput label="Título" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted">Descrição</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-ig-border-strong bg-ig-panel px-3 py-2 text-sm text-ig-fg-strong focus:border-ig-border-focus focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <HudInput label="Prazo" type="date" value={editDueDate} onChange={(e) => setEditDueDate(e.target.value)} />
                <HudInput label="Hora" type="time" value={editDueTime} onChange={(e) => setEditDueTime(e.target.value)} />
                <HudSelect
                  label="Prioridade"
                  value={editPriority}
                  onChange={(v) => setEditPriority(v as TaskPriority)}
                  options={(Object.keys(TASK_PRIORITY_LABELS) as TaskPriority[]).map((k) => ({ value: k, label: TASK_PRIORITY_LABELS[k] }))}
                />
              </div>
              <div className="flex justify-end">
                <HudButton variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={busy}>
                  Cancelar edição
                </HudButton>
              </div>
            </div>
          ) : (
            <>
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
            </>
          )}

          {blocker && (
            <div
              className={cn(
                'flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs',
                blocker.status === 'done' || blocker.status === 'cancelled'
                  ? 'border-ig-border-subtle bg-ig-panel text-ig-fg-muted'
                  : 'border-ig-warning/30 bg-ig-warning/10 text-ig-warning',
              )}
            >
              <GitBranch className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate">
                Bloqueada por: <strong>{blocker.title}</strong> ({TASK_STATUS_LABELS[blocker.status]})
              </span>
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

          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ig-fg-muted">Checklist</p>
            <div className="flex flex-col gap-1">
              {(task.checklist ?? []).map((c) => (
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
              <div className="flex gap-2">
                <input
                  value={checklistDraft}
                  onChange={(e) => setChecklistDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void addItem();
                    }
                  }}
                  placeholder="Novo item + Enter"
                  className="flex-1 rounded-md border border-ig-border-subtle bg-ig-panel px-2.5 py-1.5 text-sm text-ig-fg-strong placeholder:text-ig-fg-subtle focus:border-ig-border-focus focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void addItem()}
                  className="flex items-center justify-center rounded-md border border-ig-border bg-ig-panel px-2 text-ig-fg-muted transition-colors hover:bg-ig-panel-hover hover:text-ig-fg-strong"
                  aria-label="Adicionar item ao checklist"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          <LinkedModuleSection entity={task} />

          {task.reminderOffsets && task.reminderOffsets.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ig-fg-muted">
                <BellRing className="h-3.5 w-3.5" /> Lembretes
              </span>
              <div className="flex flex-wrap gap-1.5">
                {task.reminderOffsets.map((t) => (
                  <span key={t} className="rounded-full border border-ig-border bg-ig-panel px-2 py-0.5 text-[11px] text-ig-fg-muted">
                    {TASK_REMINDER_LABELS[t]}
                  </span>
                ))}
              </div>
            </div>
          )}

          <AttachmentsSection entityType="task" entityId={task.id} />

          <TaskCommentsThread taskId={task.id} members={members} />

          <div className="flex flex-col gap-2 border-t border-ig-border-subtle pt-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-ig-fg-muted">Alterar status</label>
              <HudSelect
                value={task.status}
                onChange={(v) => changeStatus(v as TaskStatus)}
                options={(Object.keys(TASK_STATUS_LABELS) as TaskStatus[]).map((k) => ({ value: k, label: TASK_STATUS_LABELS[k] }))}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1 border-t border-ig-border-subtle pt-3 text-[11px] text-ig-fg-subtle">
            <span className="flex items-center gap-1.5 font-semibold uppercase tracking-wide text-ig-fg-muted">
              <History className="h-3.5 w-3.5" /> Histórico
            </span>
            <span>Criada por {memberName(members, task.creatorUserId)} em {format(task.createdAt, 'dd/MM/yyyy HH:mm')}</span>
            <span>Última atualização em {format(task.updatedAt, 'dd/MM/yyyy HH:mm')}</span>
            {task.completedAt && <span>Concluída em {format(task.completedAt, 'dd/MM/yyyy HH:mm')}</span>}
          </div>
        </div>
      )}
    </HudDrawer>
  );
}
