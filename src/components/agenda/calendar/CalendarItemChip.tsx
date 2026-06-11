'use client';

import React from 'react';
import { format } from 'date-fns';
import { CheckSquare, MapPin, Users, Video } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CalendarItem, OrgMember, TaskStatus } from '@/lib/types/agenda';
import { EVENT_STATUS_LABELS, TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from '@/lib/types/agenda';
import { isOverdue, itemAccentClass, memberName } from './helpers';

interface Props {
  item: CalendarItem;
  members: OrgMember[];
  onClick?: (item: CalendarItem) => void;
  /** Dense single-line variant used inside month cells. */
  dense?: boolean;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function buildTooltip(item: CalendarItem, members: OrgMember[]): string {
  const lines: string[] = [item.title];
  lines.push(item.allDay ? 'Dia todo' : `Horário: ${format(item.start, 'HH:mm')}`);
  if (item.kind === 'task') {
    lines.push(`Status: ${TASK_STATUS_LABELS[item.status as TaskStatus] ?? item.status}`);
    if (item.priority) lines.push(`Prioridade: ${TASK_PRIORITY_LABELS[item.priority]}`);
    if (item.assigneeUserId) lines.push(`Responsável: ${memberName(members, item.assigneeUserId)}`);
  } else {
    lines.push(`Status: ${EVENT_STATUS_LABELS[item.status as keyof typeof EVENT_STATUS_LABELS] ?? item.status}`);
    if (item.location) lines.push(`Local: ${item.location}`);
  }
  if (isOverdue(item)) lines.push('⚠ Atrasada');
  return lines.join('\n');
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
  const assigneeName = item.kind === 'task' && item.assigneeUserId ? memberName(members, item.assigneeUserId) : null;

  return (
    <button
      type="button"
      onClick={() => onClick?.(item)}
      title={buildTooltip(item, members)}
      className={cn(
        'group flex w-full min-w-0 items-center gap-1.5 rounded-md border text-left transition-colors',
        dense ? 'px-1.5 py-0.5' : 'px-2 py-1.5',
        'border-ig-border-subtle bg-ig-panel hover:border-ig-border-focus hover:bg-ig-panel-hover',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ig-border-focus',
        overdue && 'border-ig-danger/40',
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
          cancelled ? 'text-ig-fg-muted line-through' : overdue ? 'text-ig-danger' : 'text-ig-fg-strong',
        )}
      >
        {item.title}
      </span>
      {overdue && !dense && (
        <span className="flex-shrink-0 rounded bg-ig-danger/12 px-1 text-[9px] font-semibold uppercase text-ig-danger">
          atrasada
        </span>
      )}
      {!dense && assigneeName && (
        <span
          className="flex h-4.5 w-4.5 flex-shrink-0 items-center justify-center rounded-full bg-ig-accent-weak text-[8px] font-semibold text-ig-accent"
          style={{ height: 18, width: 18 }}
          title={assigneeName}
        >
          {initials(assigneeName)}
        </span>
      )}
    </button>
  );
}
