'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import type { CalendarFilterKey } from '@/lib/types/agenda';

interface Props {
  active: Set<CalendarFilterKey>;
  onToggle: (key: CalendarFilterKey) => void;
}

/** Scope chips (who/what) | state chips (status/deadline). */
const SCOPE_FILTERS: { key: CalendarFilterKey; label: string }[] = [
  { key: 'mine', label: 'Minhas atividades' },
  { key: 'group', label: 'Todas do grupo' },
  { key: 'meetings', label: 'Reuniões' },
  { key: 'tasks', label: 'Tarefas' },
];

const STATE_FILTERS: { key: CalendarFilterKey; label: string }[] = [
  { key: 'pending', label: 'Pendentes' },
  { key: 'done', label: 'Concluídas' },
  { key: 'overdue', label: 'Atrasadas' },
  { key: 'high_priority', label: 'Alta prioridade' },
  { key: 'today', label: 'Hoje' },
  { key: 'this_week', label: 'Esta semana' },
];

function Chip({
  filter,
  on,
  onToggle,
}: {
  filter: { key: CalendarFilterKey; label: string };
  on: boolean;
  onToggle: (key: CalendarFilterKey) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(filter.key)}
      aria-pressed={on}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ig-border-focus',
        on
          ? 'border-ig-border-focus bg-ig-accent-weak text-ig-accent'
          : 'border-ig-border bg-ig-panel text-ig-fg-muted hover:border-ig-border-focus hover:text-ig-fg-strong',
      )}
    >
      {filter.label}
    </button>
  );
}

export function CalendarFilters({ active, onToggle }: Props) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {SCOPE_FILTERS.map((f) => (
        <Chip key={f.key} filter={f} on={active.has(f.key)} onToggle={onToggle} />
      ))}
      <span className="mx-1 hidden h-4 w-px bg-ig-border sm:block" aria-hidden />
      {STATE_FILTERS.map((f) => (
        <Chip key={f.key} filter={f} on={active.has(f.key)} onToggle={onToggle} />
      ))}
    </div>
  );
}
