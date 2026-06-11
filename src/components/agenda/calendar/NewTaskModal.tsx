'use client';

import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Link2, Paperclip, Plus, X } from 'lucide-react';
import { HudButton, HudInput, HudModal, HudSelect, useHudToast } from '@/components/hud';
import { cn } from '@/lib/utils';
import type {
  CreateTaskInput,
  MeetingGuestInput,
  OrgMember,
  TaskPriority,
  TaskReminderToken,
  TaskStatus,
} from '@/lib/types/agenda';
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from '@/lib/types/agenda';
import { createTask } from '@/lib/services/agenda';
import { uploadAttachment } from '@/lib/services/agenda-attachments';
import { EmailChipsInput } from './EmailChipsInput';
import { AssigneePicker } from './AssigneePicker';
import { ModuleLinkPicker } from './ModuleLinkPicker';
import { ReminderOffsetsField } from './ReminderOffsetsField';
import { RecurrenceField, type RecurrenceValue } from './RecurrenceField';
import { TaskDependencyPicker } from './TaskDependencyPicker';
import type { RelatedLinks } from './module-links';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  members: OrgMember[];
  onCreated: () => void;
  /** Prefill due date (click on an empty calendar day). */
  defaultDueDate?: Date | null;
  /** Prefill arbitrary fields (e.g. "criar tarefa a partir da reunião"). */
  prefill?: Partial<CreateTaskInput> | null;
}

const toDateStr = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const todayStr = () => toDateStr(new Date());

export function NewTaskModal({ isOpen, onClose, members, onCreated, defaultDueDate, prefill }: Props) {
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
  const [links, setLinks] = useState<RelatedLinks>({});
  const [relatedEventId, setRelatedEventId] = useState<string | null>(null);
  const [blockedBy, setBlockedBy] = useState<string | null>(null);
  const [reminders, setReminders] = useState<TaskReminderToken[] | null>(null);
  const [recurrence, setRecurrence] = useState<RecurrenceValue>({ freq: null, interval: 1, until: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Apply prefills when the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    if (defaultDueDate) setDueDate(toDateStr(defaultDueDate));
    if (prefill) {
      if (prefill.title) setTitle(prefill.title);
      if (prefill.description) setDescription(prefill.description);
      if (prefill.priority) setPriority(prefill.priority);
      if (prefill.relatedEventId) setRelatedEventId(prefill.relatedEventId);
      setLinks((prev) => ({
        ...prev,
        relatedProjectId: prefill.relatedProjectId ?? prev.relatedProjectId,
        relatedContractId: prefill.relatedContractId ?? prev.relatedContractId,
        relatedRiskId: prefill.relatedRiskId ?? prev.relatedRiskId,
        relatedDeliberationId: prefill.relatedDeliberationId ?? prev.relatedDeliberationId,
        relatedCommitteeId: prefill.relatedCommitteeId ?? prev.relatedCommitteeId,
        relatedFinanceItemId: prefill.relatedFinanceItemId ?? prev.relatedFinanceItemId,
        relatedPayrollBatchId: prefill.relatedPayrollBatchId ?? prev.relatedPayrollBatchId,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

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
    setLinks({});
    setRelatedEventId(null);
    setBlockedBy(null);
    setReminders(null);
    setRecurrence({ freq: null, interval: 1, until: '' });
    setFiles([]);
    setShowAdvanced(false);
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
      const task = await createTask({
        title: title.trim(),
        description: description.trim() || undefined,
        dueAt,
        dueAllDay: !dueTime,
        priority,
        status,
        assigneeUserId,
        relatedEventId,
        ...links,
        blockedByTaskId: blockedBy,
        recurrenceFreq: recurrence.freq,
        recurrenceInterval: recurrence.interval,
        recurrenceUntil: recurrence.until || null,
        reminderOffsets: reminders,
        notifyEmails: notify.map((n) => n.email),
        checklist,
      });

      // Anexos: best-effort após a criação (falha não desfaz a tarefa).
      let failedUploads = 0;
      for (const file of files) {
        try {
          await uploadAttachment('task', task.id, file);
        } catch {
          failedUploads += 1;
        }
      }
      if (failedUploads > 0) {
        toast({ title: `${failedUploads} anexo(s) não pôde(ram) ser enviado(s).`, variant: 'destructive' });
      }

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

        <ReminderOffsetsField kind="task" value={reminders} onChange={setReminders} />

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

        {/* Avançado: vínculos, recorrência, dependência, anexos, notificações */}
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1.5 text-left text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted transition-colors hover:text-ig-fg-strong"
        >
          {showAdvanced ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          Opções avançadas
        </button>

        {showAdvanced && (
          <div className="flex flex-col gap-4 rounded-lg border border-ig-border-subtle bg-ig-panel/40 p-3">
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted">
                <Link2 className="h-3.5 w-3.5" />
                Vincular a módulo
              </span>
              <ModuleLinkPicker value={links} onChange={setLinks} />
            </div>

            <RecurrenceField value={recurrence} onChange={setRecurrence} />

            <TaskDependencyPicker value={blockedBy} onChange={setBlockedBy} />

            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted">
                <Paperclip className="h-3.5 w-3.5" />
                Anexos
              </span>
              <input
                type="file"
                multiple
                onChange={(e) => setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])])}
                className="text-xs text-ig-fg-muted file:mr-2 file:rounded-md file:border file:border-ig-border file:bg-ig-panel file:px-2.5 file:py-1 file:text-xs file:text-ig-fg-strong hover:file:bg-ig-panel-hover"
              />
              {files.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex items-center justify-between rounded-md border border-ig-border-subtle bg-ig-panel px-2.5 py-1.5 text-xs text-ig-fg-strong">
                      <span className="truncate">{f.name}</span>
                      <button type="button" onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))} className="text-ig-fg-muted hover:text-ig-danger" aria-label="Remover anexo">
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
        )}

        {relatedEventId && (
          <p className={cn('rounded-md border border-ig-border-subtle bg-ig-accent-weak/40 px-2.5 py-1.5 text-xs text-ig-fg-muted')}>
            Esta tarefa será vinculada à reunião de origem.
          </p>
        )}
      </div>
    </HudModal>
  );
}
