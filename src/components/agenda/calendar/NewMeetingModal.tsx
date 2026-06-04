'use client';

import React, { useState } from 'react';
import { Link2, MapPin, Send } from 'lucide-react';
import { HudButton, HudInput, HudModal, HudSelect, useHudToast } from '@/components/hud';
import type { EventVisibility, MeetingGuestInput, OrgMember } from '@/lib/types/agenda';
import { VISIBILITY_LABELS } from '@/lib/types/agenda';
import { createMeeting } from '@/lib/services/agenda';
import { EmailChipsInput } from './EmailChipsInput';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  members: OrgMember[];
  onCreated: () => void;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

export function NewMeetingModal({ isOpen, onClose, members, onCreated }: Props) {
  const { toast } = useHudToast();
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayStr());
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [location, setLocation] = useState('');
  const [meetingLink, setMeetingLink] = useState('');
  const [visibility, setVisibility] = useState<EventVisibility>('personal');
  const [guests, setGuests] = useState<MeetingGuestInput[]>([]);

  const reset = () => {
    setTitle('');
    setDescription('');
    setDate(todayStr());
    setStartTime('09:00');
    setEndTime('10:00');
    setLocation('');
    setMeetingLink('');
    setVisibility('personal');
    setGuests([]);
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
    if (!date || !startTime) {
      toast({ title: 'Informe data e horário de início.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await createMeeting({
        title: title.trim(),
        description: description.trim() || undefined,
        startsAt: `${date}T${startTime}`,
        endsAt: endTime ? `${date}T${endTime}` : undefined,
        visibility,
        location: location.trim() || undefined,
        meetingLink: meetingLink.trim() || undefined,
        guests,
      });
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
          <HudInput label="Início *" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          <HudInput label="Término" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </div>

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
      </div>
    </HudModal>
  );
}
