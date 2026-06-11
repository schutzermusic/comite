'use client';

import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Link2, MapPin, Paperclip, Send, X } from 'lucide-react';
import { HudButton, HudInput, HudModal, HudSelect, useHudToast } from '@/components/hud';
import type { EventVisibility, MeetingGuestInput, MeetingReminderToken, OrgMember } from '@/lib/types/agenda';
import { VISIBILITY_LABELS } from '@/lib/types/agenda';
import { createMeeting } from '@/lib/services/agenda';
import { uploadAttachment } from '@/lib/services/agenda-attachments';
import { EmailChipsInput } from './EmailChipsInput';
import { ModuleLinkPicker } from './ModuleLinkPicker';
import { ReminderOffsetsField } from './ReminderOffsetsField';
import type { RelatedLinks } from './module-links';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  members: OrgMember[];
  onCreated: () => void;
  /** Prefill date (click on an empty calendar day). */
  defaultDate?: Date | null;
}

const toDateStr = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const todayStr = () => toDateStr(new Date());

export function NewMeetingModal({ isOpen, onClose, members, onCreated, defaultDate }: Props) {
  const { toast } = useHudToast();
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayStr());
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState('');
  const [meetingLink, setMeetingLink] = useState('');
  const [visibility, setVisibility] = useState<EventVisibility>('personal');
  const [guests, setGuests] = useState<MeetingGuestInput[]>([]);
  const [links, setLinks] = useState<RelatedLinks>({});
  const [reminders, setReminders] = useState<MeetingReminderToken[] | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (isOpen && defaultDate) setDate(toDateStr(defaultDate));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const reset = () => {
    setTitle('');
    setDescription('');
    setDate(todayStr());
    setStartTime('09:00');
    setEndTime('10:00');
    setAllDay(false);
    setLocation('');
    setMeetingLink('');
    setVisibility('personal');
    setGuests([]);
    setLinks({});
    setReminders(null);
    setFiles([]);
    setShowAdvanced(false);
  };

  const handleClose = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast({ title: 'Informe um título para a reunião.', variant: 'destructive' });
      return;
    }
    if (!date || (!allDay && !startTime)) {
      toast({ title: 'Informe data e horário de início.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const event = await createMeeting({
        title: title.trim(),
        description: description.trim() || undefined,
        startsAt: allDay ? `${date}T00:00` : `${date}T${startTime}`,
        endsAt: allDay ? `${date}T23:59` : endTime ? `${date}T${endTime}` : undefined,
        allDay,
        visibility,
        location: location.trim() || undefined,
        meetingLink: meetingLink.trim() || undefined,
        ...links,
        reminderOffsets: reminders,
        guests,
      });

      // Anexos: best-effort após a criação.
      let failedUploads = 0;
      for (const file of files) {
        try {
          await uploadAttachment('event', event.id, file);
        } catch {
          failedUploads += 1;
        }
      }
      if (failedUploads > 0) {
        toast({ title: `${failedUploads} anexo(s) não pôde(ram) ser enviado(s).`, variant: 'destructive' });
      }

      const internal = guests.filter((g) => !g.isExternal).length;
      toast({
        title: 'Reunião agendada!',
        description:
          guests.length > 0
            ? `Convites enviados a ${guests.length} convidado(s)${internal > 0 ? ` · ${internal} interno(s) notificado(s)` : ''}.`
            : undefined,
      });
      reset();
      onCreated();
      onClose();
    } catch (e) {
      toast({ title: 'Falha ao agendar', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <HudModal
      isOpen={isOpen}
      onClose={handleClose}
      title="Nova reunião"
      subtitle="Convide qualquer e-mail — interno ou externo"
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <HudButton variant="ghost" onClick={handleClose} disabled={saving}>
            Cancelar
          </HudButton>
          <HudButton variant="primary" onClick={handleSubmit} isLoading={saving} leftIcon={<Send className="h-4 w-4" />}>
            Agendar e convidar
          </HudButton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <HudInput label="Título *" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Reunião do comitê executivo" />

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted">Descrição / Pauta</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Objetivos e tópicos da reunião…"
            className="w-full rounded-lg border border-ig-border-strong bg-ig-panel px-3 py-2 text-sm text-ig-fg-strong placeholder:text-ig-fg-subtle focus:border-ig-border-focus focus:outline-none"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <HudInput label="Data *" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <HudInput label="Início *" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={allDay} />
          <HudInput label="Término" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={allDay} />
        </div>

        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-ig-fg-muted">
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) => setAllDay(e.target.checked)}
            className="h-4 w-4 rounded border-ig-border accent-[var(--ig-accent)]"
          />
          Dia inteiro
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <HudInput label="Local" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Sala / endereço" leftIcon={<MapPin className="h-4 w-4" />} />
          <HudInput label="Link da reunião" value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)} placeholder="https://meet…" leftIcon={<Link2 className="h-4 w-4" />} />
        </div>

        <HudSelect
          label="Visibilidade"
          value={visibility}
          onChange={(v) => setVisibility(v as EventVisibility)}
          options={(Object.keys(VISIBILITY_LABELS) as EventVisibility[]).map((k) => ({ value: k, label: VISIBILITY_LABELS[k] }))}
        />

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted">Convidados</label>
          <EmailChipsInput members={members} value={guests} onChange={setGuests} placeholder="Qualquer e-mail (interno ou externo) + Enter" />
          <p className="text-[11px] text-ig-fg-subtle">
            E-mails internos são vinculados ao usuário e recebem notificação no app; externos recebem apenas o convite por e-mail.
          </p>
        </div>

        <ReminderOffsetsField kind="meeting" value={reminders} onChange={setReminders} />

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
          </div>
        )}
      </div>
    </HudModal>
  );
}
