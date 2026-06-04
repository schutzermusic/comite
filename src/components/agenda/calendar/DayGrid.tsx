'use client';

import React from 'react';
import { format, getHours, isSameDay, isToday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import type { CalendarItem, OrgMember } from '@/lib/types/agenda';
import { CalendarItemChip } from './CalendarItemChip';

interface Props {
  cursor: Date;
  items: CalendarItem[];
  members: OrgMember[];
  onSelectItem: (item: CalendarItem) => void;
}

const HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // 06:00–22:00

export function DayGrid({ cursor, items, members, onSelectItem }: Props) {
  const dayItems = items.filter((it) => isSameDay(it.start, cursor));
  const allDay = dayItems.filter((it) => it.allDay);
  const timed = dayItems.filter((it) => !it.allDay);

  const offHours = timed.filter((it) => getHours(it.start) < 6 || getHours(it.start) > 22);
  const today = isToday(cursor);

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-ig-border-subtle bg-ig-base">
      <div className={cn('border-b border-ig-border-subtle px-4 py-2.5', today && 'bg-ig-accent-weak')}>
        <span className="text-sm font-semibold text-ig-fg-strong">
          {format(cursor, "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
        </span>
      </div>

      {(allDay.length > 0 || offHours.length > 0) && (
        <div className="flex flex-col gap-1 border-b border-ig-border-subtle px-4 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-ig-fg-muted">Dia todo / outros horários</span>
          {[...allDay, ...offHours].map((it) => (
            <CalendarItemChip key={`${it.kind}-${it.id}`} item={it} members={members} onClick={onSelectItem} />
          ))}
        </div>
      )}

      <div className="max-h-[560px] overflow-y-auto">
        {HOURS.map((hour) => {
          const hourItems = timed.filter((it) => getHours(it.start) === hour);
          return (
            <div key={hour} className="flex min-h-[48px] gap-3 border-b border-ig-border-subtle/60 px-4 py-1.5 last:border-b-0">
              <span className="w-12 flex-shrink-0 pt-1 text-right text-[11px] tabular-nums text-ig-fg-subtle">
                {String(hour).padStart(2, '0')}:00
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                {hourItems.map((it) => (
                  <CalendarItemChip key={`${it.kind}-${it.id}`} item={it} members={members} onClick={onSelectItem} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
