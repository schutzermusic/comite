'use client';

import React from 'react';
import { eachDayOfInterval, format, isSameDay, isToday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import type { CalendarItem, OrgMember } from '@/lib/types/agenda';
import { getRangeForView } from './helpers';
import { CalendarItemChip } from './CalendarItemChip';

interface Props {
  cursor: Date;
  items: CalendarItem[];
  members: OrgMember[];
  onSelectItem: (item: CalendarItem) => void;
}

/**
 * Week view as 7 column-agendas (one per day). Avoids an hourly grid so it
 * stays readable on narrow widths with zero horizontal overflow.
 */
export function WeekGrid({ cursor, items, members, onSelectItem }: Props) {
  const { start, end } = getRangeForView('week', cursor);
  const days = eachDayOfInterval({ start, end });

  return (
    <div className="grid min-w-0 grid-cols-1 gap-px overflow-hidden rounded-lg border border-ig-border-subtle bg-ig-border-subtle sm:grid-cols-2 lg:grid-cols-7">
      {days.map((day) => {
        const dayItems = items.filter((it) => isSameDay(it.start, day));
        const today = isToday(day);
        return (
          <div key={day.toISOString()} className="flex min-h-[200px] min-w-0 flex-col bg-ig-base">
            <div
              className={cn(
                'flex items-center justify-between border-b border-ig-border-subtle px-2.5 py-2',
                today && 'bg-ig-accent-weak',
              )}
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ig-fg-muted">
                {format(day, 'EEE', { locale: ptBR })}
              </span>
              <span
                className={cn(
                  'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold',
                  today ? 'bg-ig-accent text-ig-base' : 'text-ig-fg-strong',
                )}
              >
                {format(day, 'd')}
              </span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1 p-1.5">
              {dayItems.length === 0 ? (
                <span className="px-1 py-2 text-[11px] text-ig-fg-subtle">—</span>
              ) : (
                dayItems.map((it) => (
                  <CalendarItemChip key={`${it.kind}-${it.id}`} item={it} members={members} onClick={onSelectItem} />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
