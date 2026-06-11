'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { GitBranch, X } from 'lucide-react';
import type { Task } from '@/lib/types/agenda';
import { listTasks } from '@/lib/services/agenda';

/** Single-dependency picker: "bloqueada por" another open task. */
export function TaskDependencyPicker({
  value,
  onChange,
  excludeTaskId,
}: {
  value: string | null;
  onChange: (taskId: string | null) => void;
  excludeTaskId?: string;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listTasks()
      .then((all) => {
        if (!cancelled) setTasks(all);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const candidates = useMemo(
    () =>
      tasks.filter(
        (t) => t.id !== excludeTaskId && t.status !== 'done' && t.status !== 'cancelled',
      ),
    [tasks, excludeTaskId],
  );

  const selected = tasks.find((t) => t.id === value);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return candidates.slice(0, 8);
    return candidates.filter((t) => t.title.toLowerCase().includes(q)).slice(0, 8);
  }, [query, candidates]);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted">
        <GitBranch className="h-3.5 w-3.5" />
        Bloqueada por (dependência)
      </span>
      {selected ? (
        <div className="flex items-center justify-between rounded-lg border border-ig-border bg-ig-panel px-3 py-2">
          <span className="truncate text-sm text-ig-fg-strong">{selected.title}</span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="ml-2 shrink-0 text-ig-fg-muted hover:text-ig-danger"
            aria-label="Remover dependência"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Buscar tarefa aberta…"
            className="w-full rounded-lg border border-ig-border-strong bg-ig-panel px-3 py-2 text-sm text-ig-fg-strong placeholder:text-ig-fg-subtle focus:border-ig-border-focus focus:outline-none"
          />
          {open && filtered.length > 0 && (
            <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-ig-border bg-ig-overlay shadow-lg">
              {filtered.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange(t.id);
                    setQuery('');
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ig-fg-strong transition-colors hover:bg-ig-panel-hover"
                >
                  <GitBranch className="h-3.5 w-3.5 shrink-0 text-ig-accent" />
                  <span className="truncate">{t.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
