'use client';

import React from 'react';
import { eachDayOfInterval, format, isSameDay, isSameMonth, isToday } from 'date-fns';
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
  onSelectDay?: (day: Date) => void;
}

const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const MAX_PER_CELL = 3;

export function MonthGrid({ cursor, items, members, onSelectItem, onSelectDay }: Props) {
  const { start, end } = getRangeForView('month', cursor);
  const days = eachDayOfInterval({ start, end });

  const itemsByDay = (day: Date) => items.filter((it) => isSameDay(it.start, day));

  return (
    <div className="min-w-0">
      <div className="grid grid-cols-7 gap-px">
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-ig-fg-muted">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-ig-border-subtle bg-ig-border-subtle">
        {days.map((day) => {
          const dayItems = itemsByDay(day);
          const inMonth = isSameMonth(day, cursor);
          const today = isToday(day);
          return (
            <div
              key={day.toISOString()}
              className={cn(
                'flex min-h-[104px] min-w-0 flex-col gap-1 p-1.5',
                inMonth ? 'bg-ig-base' : 'bg-ig-panel/40',
              )}
            >
              <button
                type="button"
                onClick={() => onSelectDay?.(day)}
                className={cn(
                  'mb-0.5 inline-flex h-6 w-6 items-center justify-center self-start rounded-full text-xs font-medium transition-colors',
                  today
                    ? 'bg-ig-accent text-ig-base'
                    : inMonth
                      ? 'text-ig-fg-strong hover:bg-ig-panel-hover'
                      : 'text-ig-fg-subtle',
                )}
                title={format(day, "EEEE, dd 'de' MMMM", { locale: ptBR })}
              >
                {format(day, 'd')}
              </button>
              <div className="flex min-w-0 flex-col gap-0.5">
                {dayItems.slice(0, MAX_PER_CELL).map((it) => (
                  <CalendarItemChip key={`${it.kind}-${it.id}`} item={it} members={members} onClick={onSelectItem} dense />
                ))}
                {dayItems.length > MAX_PER_CELL && (
                  <button
                    type="button"
                    onClick={() => onSelectDay?.(day)}
                    className="px-1 text-left text-[10px] font-medium text-ig-accent hover:underline"
                  >
                    +{dayItems.length - MAX_PER_CELL} mais
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
