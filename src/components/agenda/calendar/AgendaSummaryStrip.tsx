'use client';

import React, { useMemo } from 'react';
import {
  AlarmClockOff,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Hourglass,
  TriangleAlert,
} from 'lucide-react';
import { endOfWeek, isWithinInterval, startOfMonth, startOfWeek } from 'date-fns';
import type { CalendarEvent, Task } from '@/lib/types/agenda';

const OPEN_STATUSES = new Set(['todo', 'in_progress', 'waiting', 'blocked']);

export interface AgendaSummary {
  myOpen: number;
  overdue: number;
  meetingsThisWeek: number;
  criticalDeadlines: number;
  waiting: number;
  doneThisMonth: number;
}

export function computeAgendaSummary(
  tasks: Task[],
  events: CalendarEvent[],
  currentUserId: string | null,
): AgendaSummary {
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const monthStart = startOfMonth(now);
  const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const open = tasks.filter((t) => OPEN_STATUSES.has(t.status));

  return {
    myOpen: currentUserId
      ? open.filter((t) => t.assigneeUserId === currentUserId || t.creatorUserId === currentUserId).length
      : 0,
    overdue: open.filter((t) => t.dueAt && t.dueAt < now).length,
    meetingsThisWeek: events.filter(
      (e) =>
        e.type === 'meeting' &&
        e.status !== 'cancelled' &&
        isWithinInterval(e.startsAt, { start: weekStart, end: weekEnd }),
    ).length,
    criticalDeadlines: open.filter(
      (t) =>
        t.dueAt &&
        t.dueAt >= now &&
        t.dueAt <= in48h &&
        (t.priority === 'high' || t.priority === 'critical'),
    ).length,
    waiting: tasks.filter((t) => t.status === 'waiting').length,
    doneThisMonth: tasks.filter((t) => t.status === 'done' && t.completedAt && t.completedAt >= monthStart).length,
  };
}

function Item({
  icon,
  tint,
  label,
  value,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  tint: string;
  label: string;
  value: string;
  hint?: string;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className="group flex min-w-0 items-start gap-3 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-ig-bg-overlay/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ig-border-focus"
    >
      <span
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] transition-transform duration-200 group-hover:scale-105"
        style={{
          backgroundColor: `color-mix(in oklab, ${tint} 14%, transparent)`,
          color: tint,
          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.08), 0 2px 8px color-mix(in oklab, ${tint} 20%, transparent)`,
        }}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-ig-fg-subtle">{label}</p>
        <p className="mt-0.5 truncate text-[13px] font-semibold text-ig-fg-strong" title={value}>
          {value}
        </p>
        {hint && <p className="truncate text-[10px] text-ig-fg-muted">{hint}</p>}
      </div>
    </Tag>
  );
}

/**
 * Executive summary strip above the agenda tabs. Counts are computed from
 * the data the user can see (RLS already scopes the rows).
 */
export function AgendaSummaryStrip({
  tasks,
  events,
  currentUserId,
  onCardClick,
}: {
  tasks: Task[];
  events: CalendarEvent[];
  currentUserId: string | null;
  onCardClick?: (card: keyof AgendaSummary) => void;
}) {
  const s = useMemo(
    () => computeAgendaSummary(tasks, events, currentUserId),
    [tasks, events, currentUserId],
  );

  const click = (card: keyof AgendaSummary) => (onCardClick ? () => onCardClick(card) : undefined);

  return (
    <div
      className="grid grid-cols-1 divide-y divide-ig-border-subtle overflow-hidden rounded-2xl border border-ig-border bg-ig-bg-panel/50 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-6 sm:[&>*]:border-r sm:[&>*]:border-ig-border-subtle sm:[&>*:last-child]:border-r-0"
      style={{
        boxShadow: 'inset 0 0 0 1px var(--ig-edge-e2), 0 4px 24px rgba(0,0,0,0.10)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      <Item
        icon={<ClipboardList className="h-4 w-4" />}
        tint="var(--ig-accent)"
        label="Minhas tarefas abertas"
        value={String(s.myOpen)}
        hint={s.myOpen > 0 ? 'Atribuídas ou criadas por você' : 'Tudo em dia'}
        onClick={click('myOpen')}
      />
      <Item
        icon={<AlarmClockOff className="h-4 w-4" />}
        tint="var(--ig-danger)"
        label="Tarefas atrasadas"
        value={String(s.overdue)}
        hint={s.overdue > 0 ? 'Prazo encerrado' : 'Nenhum atraso'}
        onClick={click('overdue')}
      />
      <Item
        icon={<CalendarDays className="h-4 w-4" />}
        tint="var(--ig-info)"
        label="Reuniões da semana"
        value={String(s.meetingsThisWeek)}
        hint="Semana atual"
        onClick={click('meetingsThisWeek')}
      />
      <Item
        icon={<TriangleAlert className="h-4 w-4" />}
        tint="var(--ig-warning)"
        label="Prazos críticos"
        value={String(s.criticalDeadlines)}
        hint="Alta/crítica vencendo em 48h"
        onClick={click('criticalDeadlines')}
      />
      <Item
        icon={<Hourglass className="h-4 w-4" />}
        tint="var(--ig-chart-3)"
        label="Aguardando terceiros"
        value={String(s.waiting)}
        hint={s.waiting > 0 ? 'Dependem de externos' : '—'}
        onClick={click('waiting')}
      />
      <Item
        icon={<CheckCircle2 className="h-4 w-4" />}
        tint="var(--ig-success)"
        label="Concluídas no mês"
        value={String(s.doneThisMonth)}
        hint="Mês atual"
        onClick={click('doneThisMonth')}
      />
    </div>
  );
}
