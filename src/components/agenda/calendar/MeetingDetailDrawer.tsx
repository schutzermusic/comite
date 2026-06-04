'use client';

import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarClock, Link2, Loader2, MapPin, Pencil, Users, XCircle } from 'lucide-react';
import { HudButton, HudDrawer, HudInput, useHudToast } from '@/components/hud';
import { cn } from '@/lib/utils';
import type { CalendarEvent } from '@/lib/types/agenda';
import { EVENT_STATUS_LABELS, VISIBILITY_LABELS } from '@/lib/types/agenda';
import { cancelMeeting, getEventById, updateMeeting } from '@/lib/services/agenda';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  eventId: string | null;
  onChanged: () => void;
}

const RESPONSE_LABELS: Record<string, string> = {
  pending: 'Pendente',
  accepted: 'Confirmado',
  declined: 'Recusado',
  tentative: 'Talvez',
};

export function MeetingDetailDrawer({ isOpen, onClose, eventId, onChanged }: Props) {
  const { toast } = useHudToast();
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDate, setEditDate] = useState('');
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');

  useEffect(() => {
    if (!isOpen || !eventId) return;
    setLoading(true);
    setEditing(false);
    getEventById(eventId)
      .then((e) => {
        setEvent(e);
        if (e) {
          setEditDate(format(e.startsAt, 'yyyy-MM-dd'));
          setEditStart(format(e.startsAt, 'HH:mm'));
          setEditEnd(e.endsAt ? format(e.endsAt, 'HH:mm') : '');
        }
      })
      .catch((err) => toast({ title: 'Erro', description: err instanceof Error ? err.message : undefined, variant: 'destructive' }))
      .finally(() => setLoading(false));
  }, [isOpen, eventId, toast]);

  const saveReschedule = async () => {
    if (!event) return;
    setBusy(true);
    try {
      await updateMeeting(event.id, {
        startsAt: new Date(`${editDate}T${editStart}`),
        endsAt: editEnd ? new Date(`${editDate}T${editEnd}`) : null,
      });
      toast({ title: 'Reunião reagendada.' });
      setEditing(false);
      onChanged();
      const fresh = await getEventById(event.id);
      setEvent(fresh);
    } catch (e) {
      toast({ title: 'Falha ao reagendar', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async () => {
    if (!event) return;
    setBusy(true);
    try {
      await cancelMeeting(event.id);
      toast({ title: 'Reunião cancelada.' });
      onChanged();
      onClose();
    } catch (e) {
      toast({ title: 'Falha ao cancelar', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <HudDrawer isOpen={isOpen} onClose={onClose} title={event?.title ?? 'Reunião'} subtitle="Detalhes da reunião" width="460px">
      {loading ? (
        <div className="flex items-center justify-center py-16 text-ig-fg-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : !event ? (
        <p className="py-16 text-center text-sm text-ig-fg-muted">Reunião não encontrada.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-ig-border bg-ig-panel px-2.5 py-0.5 text-xs text-ig-fg-strong">
              {EVENT_STATUS_LABELS[event.status]}
            </span>
            <span className="rounded-full border border-ig-border bg-ig-panel px-2.5 py-0.5 text-xs text-ig-fg-muted">
              {VISIBILITY_LABELS[event.visibility]}
            </span>
          </div>

          {editing ? (
            <div className="flex flex-col gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel p-3">
              <div className="grid grid-cols-3 gap-2">
                <HudInput label="Data" type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                <HudInput label="Início" type="time" value={editStart} onChange={(e) => setEditStart(e.target.value)} />
                <HudInput label="Fim" type="time" value={editEnd} onChange={(e) => setEditEnd(e.target.value)} />
              </div>
              <div className="flex justify-end gap-2">
                <HudButton variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={busy}>
                  Cancelar
                </HudButton>
                <HudButton variant="primary" size="sm" onClick={saveReschedule} isLoading={busy}>
                  Salvar
                </HudButton>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 text-sm text-ig-fg-strong">
              <CalendarClock className="mt-0.5 h-4 w-4 flex-shrink-0 text-ig-accent" />
              <span>
                {format(event.startsAt, "EEE, dd 'de' MMM 'de' yyyy 'às' HH:mm", { locale: ptBR })}
                {event.endsAt ? ` – ${format(event.endsAt, 'HH:mm')}` : ''}
              </span>
            </div>
          )}

          {event.location && (
            <div className="flex items-start gap-2 text-sm text-ig-fg-strong">
              <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-ig-fg-muted" />
              <span>{event.location}</span>
            </div>
          )}
          {event.meetingLink && (
            <div className="flex items-start gap-2 text-sm">
              <Link2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-ig-fg-muted" />
              <a href={event.meetingLink} target="_blank" rel="noreferrer" className="break-all text-ig-accent hover:underline">
                {event.meetingLink}
              </a>
            </div>
          )}

          {event.description && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ig-fg-muted">Pauta</p>
              <p className="whitespace-pre-wrap text-sm text-ig-fg-strong">{event.description}</p>
            </div>
          )}

          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ig-fg-muted">
              <Users className="h-3.5 w-3.5" /> Convidados ({event.attendees?.length ?? 0})
            </p>
            <div className="flex flex-col gap-1">
              {(event.attendees ?? []).map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-md border border-ig-border-subtle bg-ig-panel px-2.5 py-1.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ig-fg-strong">{a.name || a.email}</p>
                    <p className="truncate text-[11px] text-ig-fg-subtle">{a.email}</p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1.5">
                    <span className={cn('text-[10px] uppercase', a.isExternal ? 'text-ig-fg-subtle' : 'text-ig-accent')}>
                      {a.isExternal ? 'externo' : 'interno'}
                    </span>
                    <span className="rounded bg-ig-panel-hover px-1.5 py-0.5 text-[10px] text-ig-fg-muted">
                      {RESPONSE_LABELS[a.responseStatus] ?? a.responseStatus}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {event.status !== 'cancelled' && (
            <div className="mt-2 flex gap-2 border-t border-ig-border-subtle pt-4">
              <HudButton variant="secondary" size="sm" onClick={() => setEditing((v) => !v)} leftIcon={<Pencil className="h-3.5 w-3.5" />}>
                Reagendar
              </HudButton>
              <HudButton variant="danger" size="sm" onClick={doCancel} isLoading={busy} leftIcon={<XCircle className="h-3.5 w-3.5" />}>
                Cancelar reunião
              </HudButton>
            </div>
          )}
        </div>
      )}
    </HudDrawer>
  );
}
