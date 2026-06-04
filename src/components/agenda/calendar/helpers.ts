import {
  addDays,
  addMonths,
  addWeeks,
  endOfDay,
  endOfMonth,
  endOfWeek,
  isBefore,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import type {
  CalendarFilterKey,
  CalendarItem,
  CalendarViewMode,
  OrgMember,
  TaskPriority,
} from '@/lib/types/agenda';

/** Week starts on Monday for pt-BR. */
export const WEEK_OPTS = { weekStartsOn: 1 as const };

/** Visible date range for a given view + reference date. */
export function getRangeForView(view: CalendarViewMode, cursor: Date): { start: Date; end: Date } {
  switch (view) {
    case 'month': {
      // Full 6-week grid (leading/trailing days included).
      const start = startOfWeek(startOfMonth(cursor), WEEK_OPTS);
      const end = endOfWeek(endOfMonth(cursor), WEEK_OPTS);
      return { start, end };
    }
    case 'week':
      return { start: startOfWeek(cursor, WEEK_OPTS), end: endOfWeek(cursor, WEEK_OPTS) };
    case 'day':
      return { start: startOfDay(cursor), end: endOfDay(cursor) };
    case 'agenda':
      return { start: startOfDay(cursor), end: endOfDay(addDays(cursor, 60)) };
  }
}

/** Step the cursor backward/forward by one unit of the current view. */
export function stepCursor(view: CalendarViewMode, cursor: Date, dir: -1 | 1): Date {
  switch (view) {
    case 'month':
      return addMonths(cursor, dir);
    case 'week':
      return addWeeks(cursor, dir);
    case 'day':
      return addDays(cursor, dir);
    case 'agenda':
      return addDays(cursor, dir * 30);
  }
}

export function isOverdue(item: CalendarItem): boolean {
  if (item.kind !== 'task') return false;
  if (item.status === 'done' || item.status === 'cancelled') return false;
  return isBefore(item.start, startOfDay(new Date()));
}

/** Applies the active filter chips to the merged item list. */
export function applyFilters(
  items: CalendarItem[],
  filters: Set<CalendarFilterKey>,
  currentUserId: string | null,
): CalendarItem[] {
  if (filters.size === 0) return items;
  return items.filter((item) => {
    // Type filters (meetings / tasks) are an OR group.
    const typeFilters: CalendarFilterKey[] = [];
    if (filters.has('meetings')) typeFilters.push('meetings');
    if (filters.has('tasks')) typeFilters.push('tasks');
    if (typeFilters.length > 0) {
      const matchType =
        (filters.has('meetings') && item.kind === 'meeting') ||
        (filters.has('tasks') && item.kind === 'task');
      if (!matchType) return false;
    }

    if (filters.has('mine') && currentUserId) {
      const mine = item.ownerUserId === currentUserId || item.assigneeUserId === currentUserId;
      if (!mine) return false;
    }
    if (filters.has('group')) {
      if (item.kind === 'meeting' && item.visibility === 'personal') return false;
    }
    if (filters.has('pending')) {
      const pending = item.status === 'todo' || item.status === 'in_progress' || item.status === 'scheduled';
      if (!pending) return false;
    }
    if (filters.has('done')) {
      const done = item.status === 'done' || item.status === 'completed';
      if (!done) return false;
    }
    if (filters.has('overdue')) {
      if (!isOverdue(item)) return false;
    }
    return true;
  });
}

export function memberName(members: OrgMember[], userId: string | null | undefined): string {
  if (!userId) return '—';
  const m = members.find((x) => x.userId === userId);
  return m?.fullName || m?.email || 'Usuário';
}

/** Priority → token classes for dots/badges. */
export function priorityClasses(priority: TaskPriority): { dot: string; text: string; chip: string } {
  switch (priority) {
    case 'critical':
      return { dot: 'bg-ig-danger', text: 'text-ig-danger', chip: 'bg-ig-danger/12 text-ig-danger border-ig-danger/30' };
    case 'high':
      return { dot: 'bg-ig-warning', text: 'text-ig-warning', chip: 'bg-ig-warning/12 text-ig-warning border-ig-warning/30' };
    case 'medium':
      return { dot: 'bg-ig-info', text: 'text-ig-info', chip: 'bg-ig-info/12 text-ig-info border-ig-info/30' };
    case 'low':
    default:
      return { dot: 'bg-ig-fg-subtle', text: 'text-ig-fg-muted', chip: 'bg-ig-panel-hover text-ig-fg-muted border-ig-border' };
  }
}

/** Normalized accent for an item (meeting=accent, task=by-priority). */
export function itemAccentClass(item: CalendarItem): string {
  if (item.status === 'cancelled') return 'bg-ig-fg-subtle';
  if (item.status === 'done' || item.status === 'completed') return 'bg-ig-success';
  if (item.kind === 'task') return priorityClasses(item.priority ?? 'medium').dot;
  return 'bg-ig-accent';
}
