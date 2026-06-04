'use client';

import React from 'react';
import { format, isSameDay, isToday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CalendarItem, OrgMember } from '@/lib/types/agenda';
import { CalendarItemChip } from './CalendarItemChip';

interface Props {
  items: CalendarItem[];
  members: OrgMember[];
  onSelectItem: (item: CalendarItem) => void;
}

/** Flat, day-grouped list (next ~60 days). Empty days are skipped. */
export function AgendaList({ items, members, onSelectItem }: Props) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-ig-border-subtle bg-ig-base py-16 text-center">
        <CalendarDays className="h-8 w-8 text-ig-fg-subtle" />
        <p className="text-sm text-ig-fg-muted">Nenhuma atividade no período.</p>
      </div>
    );
  }

  // Group items by calendar day, preserving chronological order.
  const groups: { day: Date; items: CalendarItem[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && isSameDay(last.day, item.start)) {
      last.items.push(item);
    } else {
      groups.push({ day: item.start, items: [item] });
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {groups.map((group) => (
        <div key={group.day.toISOString()} className="min-w-0">
          <div className="mb-1.5 flex items-center gap-2">
            <span
              className={cn(
                'inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-sm font-semibold',
                isToday(group.day) ? 'bg-ig-accent text-ig-base' : 'text-ig-fg-strong',
              )}
            >
              {format(group.day, 'dd')}
            </span>
            <span className="text-sm font-medium text-ig-fg-strong">
              {format(group.day, "EEEE", { locale: ptBR })}
            </span>
            <span className="text-xs text-ig-fg-muted">{format(group.day, "MMM 'de' yyyy", { locale: ptBR })}</span>
          </div>
          <div className="flex flex-col gap-1 border-l-2 border-ig-border-subtle pl-3">
            {group.items.map((it) => (
              <CalendarItemChip key={`${it.kind}-${it.id}`} item={it} members={members} onClick={onSelectItem} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
