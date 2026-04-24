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
        'hud-filter-bar flex flex-col md:flex-row items-stretch md:items-center gap-3',
        compact ? 'p-3' : 'p-4',
        'rounded-xl border backdrop-blur-sm',
        className
      )}
    >
      {/* Search */}
      {onSearchChange && (
        <div className="relative flex-1 md:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 hud-icon" />
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            className={cn(
              'w-full pl-10 pr-4 rounded-lg text-sm',
              'hud-filter-input border',
              'focus:outline-none',
              'transition-colors',
              compact ? 'h-9' : 'h-10'
            )}
          />
        </div>
      )}

      {/* Filters */}
      {filterGroups.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          {filterGroups.map((group) => (
            <div key={group.id} className="flex flex-col gap-1">
              <span className="text-[11px] font-medium hud-label uppercase tracking-wider px-0.5">
                {group.label}
              </span>
              <select
                value={group.value}
                onChange={(e) => group.onChange(e.target.value)}
                className={cn(
                  'hud-filter-select min-w-[140px] px-3 rounded-lg text-sm font-medium',
                  'border',
                  'focus:outline-none',
                  'transition-colors cursor-pointer',
                  'appearance-none bg-no-repeat bg-[length:16px] bg-[right_8px_center] pr-8',
                  compact ? 'h-9' : 'h-10'
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
                'hud-filter-clear flex items-center gap-1.5 px-3 rounded-lg self-end',
                'border border-amber-500/30 bg-amber-500/15',
                'text-amber-200 text-sm font-medium',
                'hover:bg-amber-500/20 hover:border-amber-500/40',
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
