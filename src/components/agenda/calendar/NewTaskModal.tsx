'use client';

import React, { useMemo, useState } from 'react';
import { Plus, User, X } from 'lucide-react';
import { HudButton, HudInput, HudModal, HudSelect, useHudToast } from '@/components/hud';
import { cn } from '@/lib/utils';
import type { MeetingGuestInput, OrgMember, TaskPriority, TaskStatus } from '@/lib/types/agenda';
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from '@/lib/types/agenda';
import { createTask } from '@/lib/services/agenda';
import { EmailChipsInput, isValidEmail } from './EmailChipsInput';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  members: OrgMember[];
  onCreated: () => void;
}

const ASSIGN_EXTERNAL_MSG = 'Tarefas só podem ser atribuídas a usuários internos do grupo.';

/** Internal-only assignee picker. Typing an external e-mail is rejected. */
function AssigneePicker({
  members,
  value,
  onChange,
}: {
  members: OrgMember[];
  value: string | null;
  onChange: (userId: string | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = members.find((m) => m.userId === value);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return members.slice(0, 8);
    return members
      .filter((m) => (m.fullName ?? '').toLowerCase().includes(q) || (m.email ?? '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, members]);

  // External email typed with no internal match → blocked.
  const externalAttempt = query.trim().length > 0 && isValidEmail(query) && filtered.length === 0;

  if (selected) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-ig-border-focus bg-ig-accent-weak px-3 py-2">
        <span className="flex items-center gap-2 text-sm text-ig-accent">
          <User className="h-4 w-4" />
          {selected.fullName || selected.email}
        </span>
        <button type="button" onClick={() => onChange(null)} className="text-ig-fg-muted hover:text-ig-fg-strong" aria-label="Remover responsável">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Buscar usuário interno…"
        className={cn(
          'w-full rounded-lg border bg-ig-panel px-3 py-2 text-sm text-ig-fg-strong placeholder:text-ig-fg-subtle focus:outline-none',
          externalAttempt ? 'border-ig-danger focus:border-ig-danger' : 'border-ig-border-strong focus:border-ig-border-focus',
        )}
      />
      {externalAttempt && <p className="mt-1 text-xs text-ig-danger">{ASSIGN_EXTERNAL_MSG}</p>}
      {open && !externalAttempt && filtered.length > 0 && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-ig-border bg-ig-overlay shadow-lg">
          {filtered.map((m) => (
            <button
              key={m.userId}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(m.userId);
                setQuery('');
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ig-fg-strong transition-colors hover:bg-ig-panel-hover"
            >
              <User className="h-3.5 w-3.5 text-ig-accent" />
              <span className="flex-1 truncate">{m.fullName || m.email}</span>
              <span className="truncate text-xs text-ig-fg-subtle">{m.jobTitle || m.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const todayStr = () => new Date().toISOString().slice(0, 10);

export function NewTaskModal({ isOpen, onClose, members, onCreated }: Props) {
  const { toast } = useHudToast();
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState(todayStr());
  const [dueTime, setDueTime] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [assigneeUserId, setAssigneeUserId] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<string[]>([]);
  const [checklistDraft, setChecklistDraft] = useState('');
  const [notify, setNotify] = useState<MeetingGuestInput[]>([]);

  const reset = () => {
    setTitle('');
    setDescription('');
    setDueDate(todayStr());
    setDueTime('');
    setPriority('medium');
    setStatus('todo');
    setAssigneeUserId(null);
    setChecklist([]);
    setChecklistDraft('');
    setNotify([]);
  };

  const handleClose = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const addChecklistItem = () => {
    const v = checklistDraft.trim();
    if (!v) return;
    setChecklist((prev) => [...prev, v]);
    setChecklistDraft('');
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast({ title: 'Informe um título para a tarefa.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const dueAt = dueDate ? `${dueDate}T${dueTime || '09:00'}` : undefined;
      await createTask({
        title: title.trim(),
        description: description.trim() || undefined,
        dueAt,
        dueAllDay: !dueTime,
        priority,
        status,
        assigneeUserId,
        notifyEmails: notify.map((n) => n.email),
        checklist,
      });
      toast({
        title: 'Tarefa criada!',
        description: assigneeUserId ? 'Responsável notificado no app e por e-mail.' : undefined,
      });
      reset();
      onCreated();
      onClose();
    } catch (e) {
      toast({ title: 'Falha ao criar tarefa', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <HudModal
      isOpen={isOpen}
      onClose={handleClose}
      title="Nova tarefa"
      subtitle="Atribua a um usuário interno do grupo"
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <HudButton variant="ghost" onClick={handleClose} disabled={saving}>
            Cancelar
          </HudButton>
          <HudButton variant="primary" onClick={handleSubmit} isLoading={saving} leftIcon={<Plus className="h-4 w-4" />}>
            Criar tarefa
          </HudButton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <HudInput label="Título *" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Revisar contrato XPTO" />

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted">Descrição</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Detalhes da tarefa…"
            className="w-full rounded-lg border border-ig-border-strong bg-ig-panel px-3 py-2 text-sm text-ig-fg-strong placeholder:text-ig-fg-subtle focus:border-ig-border-focus focus:outline-none"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <HudInput label="Prazo (data)" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          <HudInput label="Hora (opcional)" type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <HudSelect
            label="Prioridade"
            value={priority}
            onChange={(v) => setPriority(v as TaskPriority)}
            options={(Object.keys(TASK_PRIORITY_LABELS) as TaskPriority[]).map((k) => ({ value: k, label: TASK_PRIORITY_LABELS[k] }))}
          />
          <HudSelect
            label="Status"
            value={status}
            onChange={(v) => setStatus(v as TaskStatus)}
            options={(Object.keys(TASK_STATUS_LABELS) as TaskStatus[]).map((k) => ({ value: k, label: TASK_STATUS_LABELS[k] }))}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted">Responsável (interno)</label>
          <AssigneePicker members={members} value={assigneeUserId} onChange={setAssigneeUserId} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted">Checklist</label>
          <div className="flex gap-2">
            <input
              value={checklistDraft}
              onChange={(e) => setChecklistDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addChecklistItem();
                }
              }}
              placeholder="Adicionar item e tecle Enter"
              className="flex-1 rounded-lg border border-ig-border-strong bg-ig-panel px-3 py-2 text-sm text-ig-fg-strong placeholder:text-ig-fg-subtle focus:border-ig-border-focus focus:outline-none"
            />
            <HudButton variant="secondary" onClick={addChecklistItem} leftIcon={<Plus className="h-4 w-4" />}>
              Add
            </HudButton>
          </div>
          {checklist.length > 0 && (
            <ul className="flex flex-col gap-1">
              {checklist.map((c, i) => (
                <li key={`${c}-${i}`} className="flex items-center justify-between rounded-md border border-ig-border-subtle bg-ig-panel px-2.5 py-1.5 text-sm text-ig-fg-strong">
                  <span className="truncate">{c}</span>
                  <button type="button" onClick={() => setChecklist((prev) => prev.filter((_, idx) => idx !== i))} className="text-ig-fg-muted hover:text-ig-danger" aria-label="Remover item">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted">Notificar também (opcional)</label>
          <EmailChipsInput members={members} value={notify} onChange={setNotify} placeholder="E-mails que receberão um aviso (sem ser responsáveis)" />
        </div>
      </div>
    </HudModal>
  );
}
