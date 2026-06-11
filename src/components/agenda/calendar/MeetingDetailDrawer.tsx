'use client';

import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  CalendarClock,
  ClipboardList,
  Link2,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Send,
  Users,
  XCircle,
} from 'lucide-react';
import { HudButton, HudDrawer, HudInput, HudSelect, useHudToast } from '@/components/hud';
import { cn } from '@/lib/utils';
import type { CalendarEvent, CreateTaskInput, EventVisibility } from '@/lib/types/agenda';
import { EVENT_STATUS_LABELS, VISIBILITY_LABELS } from '@/lib/types/agenda';
import {
  cancelMeeting,
  getEventById,
  listEntityEmailDispatches,
  resendInvite,
  updateMeeting,
  type EntityEmailDispatch,
} from '@/lib/services/agenda';
import { LinkedModuleSection } from './LinkedModuleSection';
import { AttachmentsSection } from './AttachmentsSection';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  eventId: string | null;
  onChanged: () => void;
  /** Abre o modal "Nova tarefa" pré-preenchido a partir desta reunião. */
  onCreateTask?: (prefill: Partial<CreateTaskInput>) => void;
}

const RESPONSE_LABELS: Record<string, string> = {
  pending: 'Pendente',
  accepted: 'Confirmado',
  declined: 'Recusado',
  tentative: 'Talvez',
};

const DISPATCH_LABELS: Record<string, string> = {
  sent: 'Enviado',
  failed: 'Falhou',
  simulated: 'Simulado',
};

export function MeetingDetailDrawer({ isOpen, onClose, eventId, onChanged, onCreateTask }: Props) {
  const { toast } = useHudToast();
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const [dispatches, setDispatches] = useState<EntityEmailDispatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editLink, setEditLink] = useState('');
  const [editVisibility, setEditVisibility] = useState<EventVisibility>('personal');

  useEffect(() => {
    if (!isOpen || !eventId) return;
    setLoading(true);
    setEditing(false);
    getEventById(eventId)
      .then((e) => {
        setEvent(e);
        if (e) {
          setEditTitle(e.title);
          setEditDescription(e.description ?? '');
          setEditDate(format(e.startsAt, 'yyyy-MM-dd'));
          setEditStart(format(e.startsAt, 'HH:mm'));
          setEditEnd(e.endsAt ? format(e.endsAt, 'HH:mm') : '');
          setEditLocation(e.location ?? '');
          setEditLink(e.meetingLink ?? '');
          setEditVisibility(e.visibility);
        }
      })
      .catch((err) => toast({ title: 'Erro', description: err instanceof Error ? err.message : undefined, variant: 'destructive' }))
      .finally(() => setLoading(false));
    // Status de envio dos convites (RPC: visível para quem acessa a reunião).
    listEntityEmailDispatches('calendar_event', eventId)
      .then(setDispatches)
      .catch(() => setDispatches([]));
  }, [isOpen, eventId, toast]);

  const saveEdit = async () => {
    if (!event) return;
    if (!editTitle.trim()) {
      toast({ title: 'O título não pode ficar vazio.', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      await updateMeeting(event.id, {
        title: editTitle.trim(),
        description: editDescription.trim() || null,
        startsAt: `${editDate}T${editStart}`,
        endsAt: editEnd ? `${editDate}T${editEnd}` : null,
        location: editLocation.trim() || null,
        meetingLink: editLink.trim() || null,
        visibility: editVisibility,
      });
      toast({ title: 'Reunião atualizada.' });
      setEditing(false);
      onChanged();
      const fresh = await getEventById(event.id);
      setEvent(fresh);
    } catch (e) {
      toast({ title: 'Falha ao atualizar', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const doResend = async () => {
    if (!event) return;
    setBusy(true);
    try {
      const count = await resendInvite(event.id);
      toast({
        title: count > 0 ? `Convite reenviado a ${count} convidado(s).` : 'Nenhum convidado para reenviar.',
      });
      const fresh = await listEntityEmailDispatches('calendar_event', event.id);
      setDispatches(fresh);
    } catch (e) {
      toast({ title: 'Falha ao reenviar', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
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

  const createTaskFromMeeting = () => {
    if (!event || !onCreateTask) return;
    onClose();
    onCreateTask({
      title: `Follow-up: ${event.title}`,
      relatedEventId: event.id,
      relatedProjectId: event.relatedProjectId,
      relatedContractId: event.relatedContractId,
      relatedRiskId: event.relatedRiskId,
      relatedDeliberationId: event.relatedDeliberationId,
      relatedCommitteeId: event.relatedCommitteeId,
    });
  };

  return (
    <HudDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={event?.title ?? 'Reunião'}
      subtitle="Detalhes da reunião"
      width="480px"
      footer={
        event && !loading && event.status !== 'cancelled' ? (
          <div className="flex flex-wrap gap-2">
            <HudButton variant="secondary" size="sm" onClick={editing ? saveEdit : () => setEditing(true)} isLoading={busy && editing} leftIcon={<Pencil className="h-3.5 w-3.5" />}>
              {editing ? 'Salvar' : 'Editar'}
            </HudButton>
            <HudButton variant="secondary" size="sm" onClick={doResend} isLoading={busy && !editing} leftIcon={<Send className="h-3.5 w-3.5" />}>
              Reenviar convite
            </HudButton>
            {onCreateTask && (
              <HudButton variant="secondary" size="sm" onClick={createTaskFromMeeting} leftIcon={<ClipboardList className="h-3.5 w-3.5" />}>
                Criar tarefa
              </HudButton>
            )}
            <HudButton variant="danger" size="sm" onClick={doCancel} leftIcon={<XCircle className="h-3.5 w-3.5" />}>
              Cancelar reunião
            </HudButton>
          </div>
        ) : undefined
      }
    >
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
            {event.allDay && (
              <span className="rounded-full border border-ig-border bg-ig-panel px-2.5 py-0.5 text-xs text-ig-fg-muted">
                Dia inteiro
              </span>
            )}
          </div>

          {editing ? (
            <div className="flex flex-col gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel p-3">
              <HudInput label="Título" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted">Descrição / Pauta</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-ig-border-strong bg-ig-panel px-3 py-2 text-sm text-ig-fg-strong focus:border-ig-border-focus focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <HudInput label="Data" type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                <HudInput label="Início" type="time" value={editStart} onChange={(e) => setEditStart(e.target.value)} />
                <HudInput label="Fim" type="time" value={editEnd} onChange={(e) => setEditEnd(e.target.value)} />
              </div>
              <HudInput label="Local" value={editLocation} onChange={(e) => setEditLocation(e.target.value)} leftIcon={<MapPin className="h-4 w-4" />} />
              <HudInput label="Link" value={editLink} onChange={(e) => setEditLink(e.target.value)} leftIcon={<Link2 className="h-4 w-4" />} />
              <HudSelect
                label="Visibilidade"
                value={editVisibility}
                onChange={(v) => setEditVisibility(v as EventVisibility)}
                options={(Object.keys(VISIBILITY_LABELS) as EventVisibility[]).map((k) => ({ value: k, label: VISIBILITY_LABELS[k] }))}
              />
              <div className="flex justify-end">
                <HudButton variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={busy}>
                  Cancelar edição
                </HudButton>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-2 text-sm text-ig-fg-strong">
                <CalendarClock className="mt-0.5 h-4 w-4 flex-shrink-0 text-ig-accent" />
                <span>
                  {format(event.startsAt, "EEE, dd 'de' MMM 'de' yyyy 'às' HH:mm", { locale: ptBR })}
                  {event.endsAt ? ` – ${format(event.endsAt, 'HH:mm')}` : ''}
                </span>
              </div>

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
            </>
          )}

          <LinkedModuleSection entity={event} />

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

          <AttachmentsSection entityType="event" entityId={event.id} />

          {dispatches.length > 0 && (
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ig-fg-muted">
                <Mail className="h-3.5 w-3.5" /> Envios de e-mail
              </p>
              <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto pr-1">
                {dispatches.map((d, i) => (
                  <li key={`${d.targetEmail}-${i}`} className="flex items-center justify-between gap-2 rounded-md border border-ig-border-subtle bg-ig-panel px-2.5 py-1.5 text-xs">
                    <span className="min-w-0 truncate text-ig-fg-strong">{d.targetEmail}</span>
                    <span className="shrink-0 text-[10px] text-ig-fg-subtle">{format(d.createdAt, 'dd/MM HH:mm')}</span>
                    <span
                      className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 text-[10px]',
                        d.status === 'sent'
                          ? 'bg-ig-success/12 text-ig-success'
                          : d.status === 'failed'
                            ? 'bg-ig-danger/12 text-ig-danger'
                            : 'bg-ig-panel-hover text-ig-fg-muted',
                      )}
                      title={d.errorMessage ?? undefined}
                    >
                      {DISPATCH_LABELS[d.status] ?? d.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </HudDrawer>
  );
}
