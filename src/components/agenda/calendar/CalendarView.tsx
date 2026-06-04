'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { isWithinInterval } from 'date-fns';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { HudPanel } from '@/components/hud';
import type { CalendarFilterKey, CalendarItem, CalendarViewMode, OrgMember } from '@/lib/types/agenda';
import { listCalendarEvents, listTasks, mergeIntoCalendarItems } from '@/lib/services/agenda';
import { applyFilters, getRangeForView, stepCursor } from './helpers';
import { CalendarToolbar } from './CalendarToolbar';
import { CalendarFilters } from './CalendarFilters';
import { MonthGrid } from './MonthGrid';
import { WeekGrid } from './WeekGrid';
import { DayGrid } from './DayGrid';
import { AgendaList } from './AgendaList';

interface Props {
  members: OrgMember[];
  currentUserId: string | null;
  reloadToken?: number;
  onSelectItem: (item: CalendarItem) => void;
}

export function CalendarView({ members, currentUserId, reloadToken = 0, onSelectItem }: Props) {
  const [view, setView] = useState<CalendarViewMode>('month');
  const [cursor, setCursor] = useState<Date>(new Date());
  const [filters, setFilters] = useState<Set<CalendarFilterKey>>(new Set());
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => getRangeForView(view, cursor), [view, cursor]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [events, tasks] = await Promise.all([listCalendarEvents(range.start, range.end), listTasks()]);
      setItems(mergeIntoCalendarItems(events, tasks));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar a agenda.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [range.start, range.end]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  const visibleItems = useMemo(() => {
    const inRange = items.filter((it) => isWithinInterval(it.start, { start: range.start, end: range.end }));
    return applyFilters(inRange, filters, currentUserId);
  }, [items, range.start, range.end, filters, currentUserId]);

  const toggleFilter = (key: CalendarFilterKey) =>
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <CalendarToolbar
        view={view}
        cursor={cursor}
        onPrev={() => setCursor((c) => stepCursor(view, c, -1))}
        onNext={() => setCursor((c) => stepCursor(view, c, 1))}
        onToday={() => setCursor(new Date())}
        onViewChange={setView}
      />
      <CalendarFilters active={filters} onToggle={toggleFilter} />

      <HudPanel noPadding className="relative p-3">
        {loading && (
          <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-full bg-ig-panel px-2.5 py-1 text-xs text-ig-fg-muted">
            <Loader2 className="h-3 w-3 animate-spin" /> Carregando…
          </div>
        )}

        {error ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <AlertTriangle className="h-8 w-8 text-ig-warning" />
            <p className="text-sm font-medium text-ig-fg-strong">Não foi possível carregar a agenda</p>
            <p className="max-w-md text-xs text-ig-fg-muted">{error}</p>
          </div>
        ) : view === 'month' ? (
          <MonthGrid
            cursor={cursor}
            items={visibleItems}
            members={members}
            onSelectItem={onSelectItem}
            onSelectDay={(day) => {
              setCursor(day);
              setView('day');
            }}
          />
        ) : view === 'week' ? (
          <WeekGrid cursor={cursor} items={visibleItems} members={members} onSelectItem={onSelectItem} />
        ) : view === 'day' ? (
          <DayGrid cursor={cursor} items={visibleItems} members={members} onSelectItem={onSelectItem} />
        ) : (
          <AgendaList items={visibleItems} members={members} onSelectItem={onSelectItem} />
        )}
      </HudPanel>
    </div>
  );
}
