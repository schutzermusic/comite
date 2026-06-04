'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { addDays, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { AlertTriangle, CalendarDays, Link2, Loader2, MapPin, Users } from 'lucide-react';
import { HudPanel } from '@/components/hud';
import { cn } from '@/lib/utils';
import type { CalendarEvent, OrgMember } from '@/lib/types/agenda';
import { EVENT_STATUS_LABELS, VISIBILITY_LABELS } from '@/lib/types/agenda';
import { listCalendarEvents } from '@/lib/services/agenda';
import { memberName } from './helpers';

interface Props {
  members: OrgMember[];
  reloadToken?: number;
  onSelect: (eventId: string) => void;
}

/** Upcoming meetings (today → +90 days). */
export function MeetingsList({ members, reloadToken = 0, onSelect }: Props) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listCalendarEvents(new Date(), addDays(new Date(), 90));
      setEvents(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar reuniões.');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

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
        <p className="text-sm font-medium text-ig-fg-strong">Não foi possível carregar as reuniões</p>
        <p className="max-w-md text-xs text-ig-fg-muted">{error}</p>
      </HudPanel>
    );
  }

  if (events.length === 0) {
    return (
      <HudPanel className="flex flex-col items-center gap-2 py-16 text-center">
        <CalendarDays className="h-8 w-8 text-ig-fg-subtle" />
        <p className="text-sm text-ig-fg-muted">Nenhuma reunião agendada para os próximos 90 dias.</p>
      </HudPanel>
    );
  }

  return (
    <HudPanel noPadding className="p-2">
      <div className="flex flex-col gap-1">
        {events.map((ev) => (
          <button
            key={ev.id}
            type="button"
            onClick={() => onSelect(ev.id)}
            className={cn(
              'flex items-center gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel px-3 py-2.5 text-left transition-colors hover:border-ig-border-focus hover:bg-ig-panel-hover',
              ev.status === 'cancelled' && 'opacity-60',
            )}
          >
            <div className="flex w-12 flex-shrink-0 flex-col items-center rounded-md bg-ig-accent-weak py-1">
              <span className="text-[10px] uppercase text-ig-accent">{format(ev.startsAt, 'MMM', { locale: ptBR })}</span>
              <span className="text-base font-semibold text-ig-accent">{format(ev.startsAt, 'dd')}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className={cn('truncate text-sm font-medium text-ig-fg-strong', ev.status === 'cancelled' && 'line-through')}>{ev.title}</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ig-fg-muted">
                <span>{format(ev.startsAt, "EEE HH:mm", { locale: ptBR })}</span>
                <span>· {EVENT_STATUS_LABELS[ev.status]}</span>
                <span>· {VISIBILITY_LABELS[ev.visibility]}</span>
                {ev.location && (
                  <span className="inline-flex items-center gap-0.5">
                    · <MapPin className="h-3 w-3" /> {ev.location}
                  </span>
                )}
                {ev.meetingLink && (
                  <span className="inline-flex items-center gap-0.5">
                    · <Link2 className="h-3 w-3" /> link
                  </span>
                )}
                <span className="inline-flex items-center gap-0.5">
                  · <Users className="h-3 w-3" /> {memberName(members, ev.ownerUserId).split(' ')[0]}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </HudPanel>
  );
}
