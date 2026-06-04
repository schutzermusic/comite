'use client';

import React from 'react';
import { addDays, endOfWeek, format, startOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CalendarViewMode } from '@/lib/types/agenda';
import { WEEK_OPTS } from './helpers';

interface Props {
  view: CalendarViewMode;
  cursor: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onViewChange: (view: CalendarViewMode) => void;
}

const VIEW_LABELS: { id: CalendarViewMode; label: string }[] = [
  { id: 'month', label: 'Mês' },
  { id: 'week', label: 'Semana' },
  { id: 'day', label: 'Dia' },
  { id: 'agenda', label: 'Agenda' },
];

function titleFor(view: CalendarViewMode, cursor: Date): string {
  switch (view) {
    case 'month':
      return format(cursor, "MMMM 'de' yyyy", { locale: ptBR });
    case 'week': {
      const s = startOfWeek(cursor, WEEK_OPTS);
      const e = endOfWeek(cursor, WEEK_OPTS);
      return `${format(s, 'dd MMM', { locale: ptBR })} – ${format(e, "dd MMM 'de' yyyy", { locale: ptBR })}`;
    }
    case 'day':
      return format(cursor, "EEE, dd 'de' MMM 'de' yyyy", { locale: ptBR });
    case 'agenda':
      return `${format(cursor, 'dd MMM', { locale: ptBR })} – ${format(addDays(cursor, 60), "dd MMM 'de' yyyy", { locale: ptBR })}`;
  }
}

export function CalendarToolbar({ view, cursor, onPrev, onNext, onToday, onViewChange }: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToday}
          className="rounded-lg border border-ig-border-strong bg-ig-panel px-3 py-1.5 text-sm font-medium text-ig-fg-strong transition-colors hover:border-ig-border-focus hover:bg-ig-panel-hover"
        >
          Hoje
        </button>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onPrev}
            aria-label="Anterior"
            className="rounded-lg border border-ig-border-strong bg-ig-panel p-1.5 text-ig-fg-muted transition-colors hover:border-ig-border-focus hover:text-ig-fg-strong"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label="Próximo"
            className="rounded-lg border border-ig-border-strong bg-ig-panel p-1.5 text-ig-fg-muted transition-colors hover:border-ig-border-focus hover:text-ig-fg-strong"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <h2 className="ml-1 text-sm font-semibold capitalize text-ig-fg-strong sm:text-base">{titleFor(view, cursor)}</h2>
      </div>

      <div className="flex items-center gap-0.5 rounded-lg border border-ig-border-subtle bg-ig-panel p-0.5">
        {VIEW_LABELS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => onViewChange(v.id)}
            className={cn(
              'rounded-md px-3 py-1 text-xs font-medium transition-colors',
              view === v.id
                ? 'bg-ig-accent-weak text-ig-accent'
                : 'text-ig-fg-muted hover:bg-ig-panel-hover hover:text-ig-fg-strong',
            )}
          >
            {v.label}
          </button>
        ))}
      </div>
    </div>
  );
}
