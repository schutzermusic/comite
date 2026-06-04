'use client';

import React from 'react';
import { format } from 'date-fns';
import { CheckSquare, MapPin, Users, Video } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CalendarItem, OrgMember } from '@/lib/types/agenda';
import { isOverdue, itemAccentClass, memberName } from './helpers';

interface Props {
  item: CalendarItem;
  members: OrgMember[];
  onClick?: (item: CalendarItem) => void;
  /** Dense single-line variant used inside month cells. */
  dense?: boolean;
}

/**
 * A single calendar entry pill — works for both meetings and tasks.
 * Renders type accent, time, title, and contextual icons (location/link
 * for meetings; checkbox for tasks). Dark/light via ig-* tokens.
 */
export function CalendarItemChip({ item, members, onClick, dense }: Props) {
  const overdue = isOverdue(item);
  const cancelled = item.status === 'cancelled';
  const time = item.allDay ? 'Dia todo' : format(item.start, 'HH:mm');

  return (
    <button
      type="button"
      onClick={() => onClick?.(item)}
      title={item.title}
      className={cn(
        'group flex w-full min-w-0 items-center gap-1.5 rounded-md border text-left transition-colors',
        dense ? 'px-1.5 py-0.5' : 'px-2 py-1.5',
        'border-ig-border-subtle bg-ig-panel hover:border-ig-border-focus hover:bg-ig-panel-hover',
        cancelled && 'opacity-60',
      )}
    >
      <span className={cn('h-3.5 w-1 flex-shrink-0 rounded-full', itemAccentClass(item))} aria-hidden />
      {!dense && (
        <span className="flex-shrink-0 text-ig-fg-muted">
          {item.kind === 'task' ? (
            <CheckSquare className="h-3 w-3" />
          ) : item.meetingLink ? (
            <Video className="h-3 w-3" />
          ) : item.location ? (
            <MapPin className="h-3 w-3" />
          ) : (
            <Users className="h-3 w-3" />
          )}
        </span>
      )}
      <span className="flex-shrink-0 text-[10px] font-medium tabular-nums text-ig-fg-muted">{time}</span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-xs',
          cancelled ? 'text-ig-fg-muted line-through' : 'text-ig-fg-strong',
        )}
      >
        {item.title}
      </span>
      {overdue && !dense && (
        <span className="flex-shrink-0 rounded bg-ig-danger/12 px-1 text-[9px] font-semibold uppercase text-ig-danger">
          atrasada
        </span>
      )}
      {!dense && item.kind === 'task' && item.assigneeUserId && (
        <span className="hidden flex-shrink-0 text-[10px] text-ig-fg-subtle md:inline">
          {memberName(members, item.assigneeUserId).split(' ')[0]}
        </span>
      )}
    </button>
  );
}
