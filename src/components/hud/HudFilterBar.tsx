'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { LayoutGrid, List, Search, SlidersHorizontal, Table2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterGroup {
  id: string;
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}

export type ViewMode = 'cards' | 'table' | 'list';

export interface HudFilterBarProps {
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  filterGroups?: FilterGroup[];
  activeFiltersCount?: number;
  onClearFilters?: () => void;
  /** Optional view toggle (cards/table/list). Show only modes you pass. */
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  viewModes?: ViewMode[];
  /** Optional advanced-filter button on the right edge. */
  onAdvancedFilters?: () => void;
  rightContent?: React.ReactNode;
  className?: string;
  /** Legacy: kept for compat. Visual is unified now. */
  compact?: boolean;
}

const VIEW_ICON: Record<ViewMode, React.ComponentType<{ className?: string }>> = {
  cards: LayoutGrid,
  table: Table2,
  list: List,
};

const VIEW_LABEL: Record<ViewMode, string> = {
  cards: 'Cards',
  table: 'Tabela',
  list: 'Lista',
};

export function HudFilterBar({
  searchPlaceholder = 'Buscar...',
  searchValue = '',
  onSearchChange,
  filterGroups = [],
  activeFiltersCount = 0,
  onClearFilters,
  viewMode,
  onViewModeChange,
  viewModes = ['cards', 'table'],
  onAdvancedFilters,
  rightContent,
  className,
}: HudFilterBarProps) {
  const showViewToggle = viewMode && onViewModeChange;

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      className={cn(
        'relative overflow-hidden rounded-[22px] border border-ig-border-focus/30',
        'bg-[linear-gradient(180deg,color-mix(in_oklab,var(--ig-bg-panel)_88%,transparent),color-mix(in_oklab,var(--ig-bg-raised)_34%,transparent))]',
        'p-3 shadow-[var(--ig-shadow-e1),inset_0_1px_0_color-mix(in_oklab,var(--ig-border-strong)_65%,transparent)]',
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-ig-info to-transparent opacity-70" />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {onSearchChange && (
            <label className="flex h-12 min-w-0 items-center gap-2 rounded-xl border border-ig-border-subtle bg-ig-panel/70 px-4 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--ig-border-strong)_45%,transparent)] transition-colors focus-within:border-ig-border-focus focus-within:shadow-[var(--ig-focus-ring-outer)] sm:w-[25rem]">
              <Search className="h-4 w-4 shrink-0 text-ig-fg-muted" />
              <input
                type="text"
                value={searchValue}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder={searchPlaceholder}
                className="min-w-0 flex-1 border-0 bg-transparent text-sm text-ig-fg-strong outline-none placeholder:text-ig-fg-subtle focus:ring-0"
              />
              {searchValue && (
                <button
                  type="button"
                  onClick={() => onSearchChange('')}
                  aria-label="Limpar busca"
                  className="rounded-md p-1 text-ig-fg-muted transition-colors hover:bg-ig-panel-hover hover:text-ig-fg-strong"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </label>
          )}

          {filterGroups.map((group) => (
            <label
              key={group.id}
              className="flex h-12 min-w-[13rem] flex-col justify-center rounded-xl border border-ig-border-subtle bg-ig-panel/70 px-4 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--ig-border-strong)_45%,transparent)] transition-colors focus-within:border-ig-border-focus"
            >
              <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-ig-fg-subtle">
                {group.label}
              </span>
              <select
                value={group.value}
                onChange={(event) => group.onChange(event.target.value)}
                className="mt-0.5 cursor-pointer appearance-none border-0 bg-transparent p-0 text-sm font-medium text-ig-fg-strong outline-none focus:ring-0"
              >
                {group.options.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    className="bg-[color:var(--ig-bg-raised)] text-[color:var(--ig-fg-strong)]"
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {showViewToggle && (
            <div className="flex h-12 items-center gap-1 rounded-xl border border-ig-border-subtle bg-ig-panel/70 p-1 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--ig-border-strong)_45%,transparent)]">
              {viewModes.map((mode) => {
                const Icon = VIEW_ICON[mode];
                const isActive = viewMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onViewModeChange!(mode)}
                    aria-pressed={isActive}
                    title={VIEW_LABEL[mode]}
                    className={cn(
                      'flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors',
                      isActive
                        ? 'bg-ig-accent-weak text-ig-accent shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--ig-accent)_40%,transparent)]'
                        : 'text-ig-fg-muted hover:bg-ig-panel-hover hover:text-ig-fg-strong',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{VIEW_LABEL[mode]}</span>
                  </button>
                );
              })}
            </div>
          )}

          {onAdvancedFilters && (
            <button
              type="button"
              onClick={onAdvancedFilters}
              className="flex h-12 w-12 items-center justify-center rounded-xl border border-ig-border-subtle bg-ig-panel/70 text-ig-accent shadow-[inset_0_1px_0_color-mix(in_oklab,var(--ig-border-strong)_45%,transparent)] transition-colors hover:border-ig-border-focus hover:bg-ig-accent-weak focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]"
              aria-label="Filtros avançados"
              title="Filtros avançados"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>
          )}

          {onClearFilters && (
            <button
              type="button"
              onClick={onClearFilters}
              className="flex h-12 items-center gap-2 rounded-xl border border-ig-border-subtle bg-ig-panel/70 px-5 text-sm font-semibold text-ig-fg-strong shadow-[inset_0_1px_0_color-mix(in_oklab,var(--ig-border-strong)_45%,transparent)] transition-colors hover:border-ig-border-focus hover:bg-ig-panel-hover focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]"
            >
              {activeFiltersCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-ig-accent px-1.5 text-[10px] font-semibold text-ig-bg-canvas">
                  {activeFiltersCount}
                </span>
              )}
              <X className="h-4 w-4 text-ig-fg-muted" />
              Limpar filtros
            </button>
          )}

          {rightContent}
        </div>
      </div>
    </motion.section>
  );
}
