'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { HudSignal, type HudSignalTone } from '@/components/hud';
import { ListFilter, Search, X } from 'lucide-react';

/**
 * Barra de controle da carteira — um instrumento, não três controles soltos.
 *
 * O que havia antes eram três blocos empilhados com espaçamento próprio: o
 * alternador de visualização numa cápsula de vidro à direita de um título, a
 * busca numa linha, os filtros de risco noutra. Três réguas verticais
 * diferentes para uma única operação ("achar o contrato"), e o controle mais
 * usado — a busca — com o mesmo peso dos outros dois.
 *
 * Aqui a busca é o campo PRIMÁRIO, larga e alta; os filtros de risco são
 * Signal Chips do sistema (o mesmo desenho que a tabela usa nas células, de
 * modo que o chip clicado e o chip lido são a mesma peça); e o alternador de
 * visualização fica na ponta, agrupado num segmento único. Tudo numa
 * superfície só, com um recibo explícito quando há recorte em vigor.
 */

export interface PortfolioFilterChip<T extends string> {
  value: T;
  label: string;
  count: number;
  tone?: HudSignalTone;
}

export interface PortfolioViewOption<T extends string> {
  id: T;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export interface PortfolioCommandBarProps<F extends string, V extends string> {
  query: string;
  onQueryChange: (value: string) => void;
  searchLabel: string;
  resultCount: number;
  totalCount: number;

  filterLabel: string;
  filterValue: F;
  onFilterChange: (value: F) => void;
  filters: readonly PortfolioFilterChip<F>[];
  /** Valor que representa "sem recorte" — usado no recibo e no reset. */
  neutralFilter: F;

  viewLabel?: string;
  view: V;
  onViewChange: (value: V) => void;
  views: readonly PortfolioViewOption<V>[];

  className?: string;
}

export function PortfolioCommandBar<F extends string, V extends string>({
  query, onQueryChange, searchLabel, resultCount, totalCount,
  filterLabel, filterValue, onFilterChange, filters, neutralFilter,
  viewLabel = 'Visualização', view, onViewChange, views,
  className,
}: PortfolioCommandBarProps<F, V>) {
  const filtered = query.trim().length > 0 || filterValue !== neutralFilter;
  const activeChip = filters.find((f) => f.value === filterValue);

  return (
    <div
      data-elev="1"
      className={cn('ig-glass', className)}
    >
      <span data-ig-noise="" />
      <span data-ig-specular="" />
      <div data-ig-content="" className="flex flex-col gap-3 px-3.5 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          {/* ── Busca: o controle primário da barra ──────────────────── */}
          <label className="relative flex min-w-0 flex-1 items-center">
            <Search className="pointer-events-none absolute left-3 h-4 w-4 text-ig-fg-subtle" aria-hidden />
            <input
              type="search"
              aria-label={searchLabel}
              placeholder={searchLabel}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              className={cn(
                'h-10 w-full rounded-[11px] border border-ig-border-subtle pl-9 pr-9',
                'bg-[color-mix(in_oklab,var(--ig-bg-raised)_82%,transparent)]',
                'text-ig-body-sm font-medium text-ig-fg-strong placeholder:font-normal placeholder:text-ig-fg-subtle',
                'shadow-[inset_0_1px_0_color-mix(in_oklab,var(--ig-border-strong)_60%,transparent)]',
                'transition-[border-color,box-shadow] duration-200',
                'focus:border-ig-border-focus focus:outline-none',
                'focus:ring-2 focus:ring-[color-mix(in_oklab,var(--ig-accent)_32%,transparent)]',
                '[&::-webkit-search-cancel-button]:hidden',
              )}
            />
            {query && (
              <button
                type="button"
                onClick={() => onQueryChange('')}
                aria-label="Limpar busca"
                className="absolute right-2.5 rounded p-1 text-ig-fg-subtle transition-colors hover:text-ig-fg-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </label>

          {/* ── Alternador de visualização: um segmento, não três botões ── */}
          <div
            role="group"
            aria-label={viewLabel}
            className={cn(
              'flex shrink-0 items-center gap-0.5 rounded-[11px] border border-ig-border-subtle p-1',
              'bg-[color-mix(in_oklab,var(--ig-bg-raised)_70%,transparent)]',
            )}
          >
            {views.map((item) => {
              const active = item.id === view;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onViewChange(item.id)}
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-ig-caption font-semibold',
                    'transition-[background-color,color,box-shadow] duration-200',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
                    active
                      ? 'bg-[color-mix(in_oklab,var(--ig-accent)_16%,transparent)] text-ig-accent shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--ig-accent)_28%,transparent)]'
                      : 'text-ig-fg-muted hover:bg-[color-mix(in_oklab,var(--ig-accent)_7%,transparent)] hover:text-ig-fg-strong',
                  )}
                >
                  <item.icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Filtros + recibo do recorte ───────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 border-t border-ig-border-subtle pt-3">
          <span className="inline-flex items-center gap-1.5 text-ig-label font-semibold uppercase tracking-[0.1em] text-ig-fg-subtle">
            <ListFilter className="h-3.5 w-3.5" aria-hidden />
            {filterLabel}
          </span>
          <div role="group" aria-label={filterLabel} className="flex flex-wrap items-center gap-1.5">
            {filters.map((chip) => (
              <HudSignal
                key={chip.value}
                size="sm"
                tone={chip.tone ?? 'accent'}
                label={chip.label}
                value={chip.count}
                active={filterValue === chip.value}
                onClick={() => onFilterChange(chip.value)}
                title={`Filtrar: ${chip.label}`}
              />
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span role="status" className="text-ig-caption text-ig-fg-muted">
              <span className="ig-tabular font-semibold text-ig-fg-strong">{resultCount}</span>
              {resultCount === totalCount ? ' contrato(s)' : ` de ${totalCount}`}
            </span>
            {filtered && (
              <button
                type="button"
                onClick={() => { onQueryChange(''); onFilterChange(neutralFilter); }}
                className={cn(
                  'inline-flex items-center gap-1 rounded-[8px] border border-ig-border-subtle px-2 py-1',
                  'text-ig-caption font-medium text-ig-fg-muted transition-colors',
                  'hover:border-ig-border-focus hover:text-ig-fg-strong',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
                )}
                title={activeChip ? `Recorte ativo: ${activeChip.label}` : 'Limpar busca'}
              >
                <X className="h-3 w-3" aria-hidden />
                Limpar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
