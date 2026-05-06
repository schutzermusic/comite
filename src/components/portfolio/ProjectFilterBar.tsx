'use client';

import { Search, X, LayoutGrid, Table2, SlidersHorizontal, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FilterOption {
  value: string;
  label: string;
}

export interface ProjectFilterGroup {
  id: string;
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}

interface ProjectFilterBarProps {
  searchValue: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder?: string;
  groups: ProjectFilterGroup[];
  viewMode: 'cards' | 'table';
  onViewModeChange: (m: 'cards' | 'table') => void;
  onClearFilters: () => void;
  className?: string;
}

export function ProjectFilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Buscar por nome, código ou cliente…',
  groups,
  viewMode,
  onViewModeChange,
  onClearFilters,
  className,
}: ProjectFilterBarProps) {
  const activeChips = groups
    .filter((g) => g.value && g.value !== 'all')
    .map((g) => ({
      ...g,
      activeOption: g.options.find((o) => o.value === g.value),
    }));

  const activeCount = activeChips.length + (searchValue ? 1 : 0);

  return (
    <section
      className={cn(
        'relative overflow-hidden',
        'glass-tile glass-tile-elevated glass-tile-sheen',
        'p-3 md:p-4',
        className,
      )}
    >
      <div className="relative flex flex-col lg:flex-row lg:items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 hud-text-muted pointer-events-none" />
          <input
            type="text"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className={cn(
              'w-full h-10 pl-9 pr-9 rounded-xl text-sm',
              'border outline-none transition-all duration-200',
              'filter-input',
            )}
          />
          {searchValue && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-white/10 hud-text-muted hover:hud-text"
              aria-label="Limpar busca"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter selects */}
        <div className="flex flex-wrap items-center gap-2">
          {groups.map((g) => (
            <PremiumSelect
              key={g.id}
              label={g.label}
              value={g.value}
              options={g.options}
              onChange={g.onChange}
            />
          ))}
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-2 ml-auto">
          <div
            className="inline-flex items-center rounded-xl p-1 gap-0.5 view-toggle-shell"
            role="tablist"
            aria-label="Modo de visualização"
          >
            <ToggleBtn
              active={viewMode === 'cards'}
              onClick={() => onViewModeChange('cards')}
              icon={<LayoutGrid className="w-3.5 h-3.5" />}
              label="Cards"
            />
            <ToggleBtn
              active={viewMode === 'table'}
              onClick={() => onViewModeChange('table')}
              icon={<Table2 className="w-3.5 h-3.5" />}
              label="Tabela"
            />
          </div>
        </div>
      </div>

      {/* Active filters row */}
      {activeCount > 0 && (
        <>
          <div className="glass-divider mt-3" />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] hud-text-muted">
              <SlidersHorizontal className="w-3 h-3" />
              {activeCount} filtro{activeCount > 1 ? 's' : ''}
            </span>
            {searchValue && (
              <Chip onClear={() => onSearchChange('')}>
                <span className="hud-text-muted">Busca:</span>{' '}
                <span className="hud-text">&ldquo;{searchValue}&rdquo;</span>
              </Chip>
            )}
            {activeChips.map((c) => (
              <Chip key={c.id} onClear={() => c.onChange('all')}>
                <span className="hud-text-muted">{c.label}:</span>{' '}
                <span className="hud-text">{c.activeOption?.label}</span>
              </Chip>
            ))}
            <button
              onClick={onClearFilters}
              className="ml-auto text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              Limpar tudo
            </button>
          </div>
        </>
      )}

      {/* Local CSS for premium controls */}
      <style jsx>{`
        :global(.filter-input) {
          background: rgba(255, 255, 255, 0.04);
          border-color: rgba(255, 255, 255, 0.08);
          color: var(--orion-text-primary);
          box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.18);
        }
        :global(.filter-input::placeholder) {
          color: var(--orion-text-muted);
        }
        :global(.filter-input:focus) {
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(132, 204, 22, 0.42);
          box-shadow:
            inset 0 1px 1px rgba(0, 0, 0, 0.18),
            0 0 0 3px rgba(132, 204, 22, 0.12);
        }
        :global(.light .filter-input) {
          background: #ffffff;
          border-color: rgba(15, 23, 42, 0.12);
          box-shadow: inset 0 1px 1px rgba(15, 23, 42, 0.04);
        }
        :global(.light .filter-input:focus) {
          background: #ffffff;
          border-color: rgba(22, 163, 74, 0.45);
          box-shadow:
            inset 0 1px 1px rgba(15, 23, 42, 0.04),
            0 0 0 3px rgba(22, 163, 74, 0.12);
        }
        :global(.view-toggle-shell) {
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.18);
        }
        :global(.light .view-toggle-shell) {
          background: #ffffff;
          border-color: rgba(15, 23, 42, 0.10);
          box-shadow: inset 0 1px 1px rgba(15, 23, 42, 0.04);
        }
      `}</style>
    </section>
  );
}

function PremiumSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (v: string) => void;
}) {
  const isActive = value !== 'all';
  const activeLabel = options.find((o) => o.value === value)?.label ?? '';
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={cn(
          'h-10 pl-3 pr-8 rounded-xl text-sm font-medium cursor-pointer outline-none',
          'appearance-none transition-all duration-200',
          'filter-select',
        )}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="hud-option-bg">
            {label}: {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 hud-text-muted pointer-events-none"
      />
      {isActive && (
        <span
          className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-400"
          style={{
            boxShadow: '0 0 0 2px rgba(16, 185, 129, 0.25), 0 0 6px rgba(16, 185, 129, 0.45)',
          }}
          title={activeLabel}
        />
      )}
      <style jsx>{`
        .filter-select {
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: var(--orion-text-primary);
          box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.18);
        }
        .filter-select:hover {
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(255, 255, 255, 0.12);
        }
        .filter-select:focus {
          border-color: rgba(132, 204, 22, 0.42);
          box-shadow:
            inset 0 1px 1px rgba(0, 0, 0, 0.18),
            0 0 0 3px rgba(132, 204, 22, 0.12);
        }
        :global(.light) .filter-select {
          background: #ffffff;
          border-color: rgba(15, 23, 42, 0.12);
          box-shadow: inset 0 1px 1px rgba(15, 23, 42, 0.04);
        }
        :global(.light) .filter-select:hover {
          border-color: rgba(15, 23, 42, 0.20);
        }
        :global(.light) .filter-select:focus {
          border-color: rgba(22, 163, 74, 0.45);
          box-shadow:
            inset 0 1px 1px rgba(15, 23, 42, 0.04),
            0 0 0 3px rgba(22, 163, 74, 0.12);
        }
      `}</style>
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12px] font-semibold transition-all duration-200',
        active
          ? 'toggle-btn-active'
          : 'hud-text-muted hover:hud-text',
      )}
    >
      {icon}
      {label}
      <style jsx>{`
        .toggle-btn-active {
          background: linear-gradient(180deg, rgba(16, 185, 129, 0.22), rgba(16, 185, 129, 0.12));
          color: #34d399;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.10),
            0 0 0 1px rgba(16, 185, 129, 0.32),
            0 4px 10px -4px rgba(16, 185, 129, 0.30);
        }
        :global(.light) .toggle-btn-active {
          background: linear-gradient(180deg, #DCFCE7, #BBF7D0);
          color: #166534;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.7),
            0 0 0 1px rgba(22, 163, 74, 0.25),
            0 2px 6px -2px rgba(22, 163, 74, 0.22);
        }
      `}</style>
    </button>
  );
}

function Chip({ children, onClear }: { children: React.ReactNode; onClear: () => void }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px]',
        'border chip-shell',
      )}
    >
      {children}
      <button
        onClick={onClear}
        className="hud-text-muted hover:hud-text rounded-full p-0.5 hover:bg-white/10"
        aria-label="Remover filtro"
      >
        <X className="w-3 h-3" />
      </button>
      <style jsx>{`
        .chip-shell {
          background: rgba(255, 255, 255, 0.04);
          border-color: rgba(255, 255, 255, 0.10);
        }
        :global(.light) .chip-shell {
          background: #ffffff;
          border-color: rgba(15, 23, 42, 0.10);
          box-shadow: 0 1px 1px rgba(15, 23, 42, 0.03);
        }
      `}</style>
    </span>
  );
}

export default ProjectFilterBar;
