'use client';

import { cn } from '@/lib/utils';

export type FilterId = 'all' | 'top5' | 'hasBacklog' | 'noBacklog' | 'multiContract';

export interface FilterChip {
  id: FilterId;
  label: string;
}

export const FILTER_CHIPS: FilterChip[] = [
  { id: 'all', label: 'Todos' },
  { id: 'top5', label: 'Top 5' },
  { id: 'hasBacklog', label: 'Backlog > 0' },
  { id: 'noBacklog', label: 'Backlog = 0' },
  { id: 'multiContract', label: 'Contratos ≥ 3' },
];

interface FilterChipsProps {
  activeFilter: FilterId;
  onFilterChange: (filterId: FilterId) => void;
  className?: string;
}

/**
 * FilterChips
 * 
 * Quick filter toggle chips for portfolio table.
 * Only one filter can be active at a time.
 */
export function FilterChips({ 
  activeFilter, 
  onFilterChange,
  className 
}: FilterChipsProps) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {FILTER_CHIPS.map((chip) => {
        const isActive = activeFilter === chip.id;
        
        return (
          <button
            key={chip.id}
            onClick={() => onFilterChange(chip.id)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200',
              'border focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:ring-offset-1 focus:ring-offset-transparent',
              isActive
                ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-400'
                : 'bg-white/[0.03] border-white/[0.08] text-white/60 hover:bg-white/[0.06] hover:text-white/80 hover:border-white/[0.12]'
            )}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}

export default FilterChips;
