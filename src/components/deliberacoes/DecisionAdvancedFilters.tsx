'use client';

import React, { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { HudButton } from '@/components/hud';
import { cn } from '@/lib/utils';
import type { DeliberacaoPrioridade, SlaStatus } from './types';

export interface AdvancedFilterState {
  prioridade: DeliberacaoPrioridade | 'all';
  comite: string;
  sla: SlaStatus | 'all';
  responsavel: string;
}

export const ADVANCED_FILTERS_EMPTY: AdvancedFilterState = {
  prioridade: 'all',
  comite: 'all',
  sla: 'all',
  responsavel: 'all',
};

export function countAdvancedFilters(f: AdvancedFilterState): number {
  return (
    (f.prioridade !== 'all' ? 1 : 0) +
    (f.comite !== 'all' ? 1 : 0) +
    (f.sla !== 'all' ? 1 : 0) +
    (f.responsavel !== 'all' ? 1 : 0)
  );
}

const PRIORIDADE_OPTIONS: { value: DeliberacaoPrioridade | 'all'; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'critica', label: 'Crítica' },
  { value: 'alta', label: 'Alta' },
  { value: 'media', label: 'Média' },
  { value: 'baixa', label: 'Baixa' },
];

const SLA_OPTIONS: { value: SlaStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'on_track', label: 'No prazo' },
  { value: 'at_risk', label: 'Em risco' },
  { value: 'overdue', label: 'Atrasada' },
];

const SELECT_CLASS = cn(
  'w-full rounded-md border border-ig-border bg-ig-panel px-2.5 py-1.5',
  'text-xs text-ig-fg-strong',
  'focus:outline-none focus:border-ig-border-focus',
  'transition-colors',
);

const FILTER_LABEL =
  'text-[10px] font-semibold uppercase tracking-[0.08em] text-ig-fg-muted mb-1.5 block';

interface DecisionAdvancedFiltersProps {
  value: AdvancedFilterState;
  onChange: (next: AdvancedFilterState) => void;
  comiteOptions: string[];
  responsavelOptions: string[];
}

/**
 * "Filtros avançados" — compact trigger + popover panel. Replaces the old
 * permanent left filter rail: KPIs and the pipeline handle the high-level
 * conditions; this only covers the long-tail dimensions (comitê, responsável,
 * prioridade, SLA) and stays collapsed by default.
 */
export function DecisionAdvancedFilters({
  value,
  onChange,
  comiteOptions,
  responsavelOptions,
}: DecisionAdvancedFiltersProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const activeCount = countAdvancedFilters(value);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <HudButton
        variant="secondary"
        size="sm"
        leftIcon={<SlidersHorizontal className="w-3.5 h-3.5" />}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        Filtros avançados
        {activeCount > 0 && (
          <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-ig-accent-weak px-1 text-[10px] font-bold text-ig-accent tabular-nums">
            {activeCount}
          </span>
        )}
      </HudButton>

      {open && (
        <div
          role="dialog"
          aria-label="Filtros avançados"
          className={cn(
            'absolute right-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-2rem)]',
            'rounded-xl border border-ig-border bg-ig-bg-panel/95 backdrop-blur-md',
            'shadow-[var(--ig-shadow-e3)] p-4 space-y-4',
          )}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ig-fg-strong">
              Filtros avançados
            </h3>
            {activeCount > 0 && (
              <HudButton
                variant="ghost"
                size="sm"
                leftIcon={<X className="w-3 h-3" />}
                onClick={() => onChange(ADVANCED_FILTERS_EMPTY)}
              >
                Limpar
              </HudButton>
            )}
          </div>

          <div>
            <label className={FILTER_LABEL} htmlFor="delib-filter-prioridade">
              Prioridade
            </label>
            <select
              id="delib-filter-prioridade"
              value={value.prioridade}
              onChange={(e) =>
                onChange({ ...value, prioridade: e.target.value as DeliberacaoPrioridade | 'all' })
              }
              className={SELECT_CLASS}
            >
              {PRIORIDADE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={FILTER_LABEL} htmlFor="delib-filter-comite">
              Comitê
            </label>
            <select
              id="delib-filter-comite"
              value={value.comite}
              onChange={(e) => onChange({ ...value, comite: e.target.value })}
              className={SELECT_CLASS}
            >
              <option value="all">Todos</option>
              {comiteOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={FILTER_LABEL} htmlFor="delib-filter-sla">
              SLA
            </label>
            <select
              id="delib-filter-sla"
              value={value.sla}
              onChange={(e) => onChange({ ...value, sla: e.target.value as SlaStatus | 'all' })}
              className={SELECT_CLASS}
            >
              {SLA_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={FILTER_LABEL} htmlFor="delib-filter-responsavel">
              Responsável
            </label>
            <select
              id="delib-filter-responsavel"
              value={value.responsavel}
              onChange={(e) => onChange({ ...value, responsavel: e.target.value })}
              className={SELECT_CLASS}
            >
              <option value="all">Todos</option>
              {responsavelOptions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
