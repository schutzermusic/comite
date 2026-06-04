'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import type { CalendarFilterKey } from '@/lib/types/agenda';

interface Props {
  active: Set<CalendarFilterKey>;
  onToggle: (key: CalendarFilterKey) => void;
}

const FILTERS: { key: CalendarFilterKey; label: string }[] = [
  { key: 'mine', label: 'Minhas atividades' },
  { key: 'group', label: 'Todas do grupo' },
  { key: 'meetings', label: 'Reuniões' },
  { key: 'tasks', label: 'Tarefas' },
  { key: 'pending', label: 'Pendentes' },
  { key: 'done', label: 'Concluídas' },
  { key: 'overdue', label: 'Atrasadas' },
];

export function CalendarFilters({ active, onToggle }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {FILTERS.map((f) => {
        const on = active.has(f.key);
        return (
          <button
            key={f.key}
            type="button"
            onClick={() => onToggle(f.key)}
            aria-pressed={on}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              on
                ? 'border-ig-border-focus bg-ig-accent-weak text-ig-accent'
                : 'border-ig-border bg-ig-panel text-ig-fg-muted hover:border-ig-border-focus hover:text-ig-fg-strong',
            )}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}
