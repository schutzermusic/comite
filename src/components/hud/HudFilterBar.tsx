'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Search, Filter, X } from 'lucide-react';
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

export interface HudFilterBarProps {
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  filterGroups?: FilterGroup[];
  activeFiltersCount?: number;
  onClearFilters?: () => void;
  rightContent?: React.ReactNode;
  className?: string;
  compact?: boolean;
}

export function HudFilterBar({
  searchPlaceholder = 'Buscar...',
  searchValue = '',
  onSearchChange,
  filterGroups = [],
  activeFiltersCount = 0,
  onClearFilters,
  rightContent,
  className,
  compact = false,
}: HudFilterBarProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.15 }}
      className={cn(
        'hud-filter-bar flex flex-col md:flex-row items-stretch md:items-stretch gap-2.5',
        compact ? 'p-2.5' : 'p-3.5',
        'rounded-2xl border backdrop-blur-md',
        className
      )}
    >
      {/* Search */}
      {onSearchChange && (
        <div
          className={cn(
            'hud-filter-block flex min-w-0 flex-1 items-center gap-2.5',
            'md:max-w-sm',
            compact ? 'min-h-9 px-2.5 py-1.5' : 'min-h-10 px-3 py-2'
          )}
        >
          <Search className="hud-icon h-4 w-4 shrink-0 opacity-[0.55]" aria-hidden />
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            className={cn(
              'hud-filter-input min-w-0 flex-1 border-0 bg-transparent text-sm leading-snug',
              'shadow-none',
              'placeholder:opacity-50',
              'focus:ring-0 focus:outline-none',
              'transition-colors',
              'py-0.5',
              'min-h-0'
            )}
          />
        </div>
      )}

      {/* Filters */}
      {filterGroups.length > 0 && (
        <div className="flex flex-wrap items-stretch gap-2.5">
          {filterGroups.map((group) => (
            <div
              key={group.id}
              className={cn(
                'hud-filter-block flex min-w-0 flex-col',
                'min-w-[min(100%,10.5rem)]',
                compact ? 'min-h-9 gap-0.5 px-2.5 py-1.5' : 'min-h-10 gap-1 px-3 py-2'
              )}
            >
              <span className="hud-label px-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] opacity-80">
                {group.label}
              </span>
              <select
                value={group.value}
                onChange={(e) => group.onChange(e.target.value)}
                className={cn(
                  'hud-filter-select w-full min-w-0 rounded-md text-left text-sm font-medium',
                  'border-0',
                  'focus:ring-0 focus:outline-none',
                  'transition-[color,opacity] duration-200',
                  'appearance-none',
                  'cursor-pointer',
                  'py-0 pl-0 pr-0',
                  compact ? 'leading-tight' : ''
                )}
              >
                {group.options.map((option) => (
                  <option key={option.value} value={option.value} className="hud-option-bg hud-text">
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ))}

          {/* Clear filters */}
          {activeFiltersCount > 0 && onClearFilters && (
            <button
              onClick={onClearFilters}
              className={cn(
                'hud-filter-clear flex items-center gap-1.5 px-3 rounded-lg self-center',
                'border border-[color-mix(in_oklab,var(--ig-warning)_32%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_14%,transparent)]',
                'text-ig-warning text-sm font-medium',
                'hover:brightness-110',
                'transition-colors',
                compact ? 'h-9' : 'h-10'
              )}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>{activeFiltersCount}</span>
              <X className="w-3.5 h-3.5 ml-1" />
            </button>
          )}
        </div>
      )}

      {/* Right content */}
      {rightContent && (
        <div className="flex items-center gap-2 ml-auto">
          {rightContent}
        </div>
      )}
    </motion.div>
  );
}
