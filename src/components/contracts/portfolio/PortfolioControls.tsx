'use client';

import type { ReactNode } from 'react';
import { Search, X, SlidersHorizontal } from 'lucide-react';

/** Search stays local to the current workspace and never changes its data origin. */
export function PortfolioSearch({ value, onChange, label, count, children }: {
  value: string; onChange: (value: string) => void; label: string; count: number; children?: ReactNode;
}) {
  return <div className="portfolio-toolbar">
    <label className="portfolio-search">
      <Search size={16} aria-hidden />
      <input type="search" aria-label={label} placeholder={label} value={value} onChange={(e) => onChange(e.target.value)} />
      {value && <button type="button" aria-label="Limpar busca" onClick={() => onChange('')}><X size={15} /></button>}
    </label>
    {children}
    <span className="portfolio-result-count" role="status">{count} resultado{count === 1 ? '' : 's'}</span>
  </div>;
}

export function PortfolioFilters<T extends string>({ label, value, onChange, options }: {
  label: string; value: T; onChange: (value: T) => void;
  options: readonly { value: T; label: string; count?: number }[];
}) {
  return <div className="portfolio-filters" role="group" aria-label={label}>
    {options.map((option) => <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
      {option.label}{option.count !== undefined && <span>{option.count}</span>}
    </button>)}
  </div>;
}

export function PortfolioEmpty({ title = 'Nenhum resultado neste filtro', description = 'Tente outro termo ou ajuste os filtros para ampliar a busca.', onReset }: {
  title?: string; description?: string; onReset?: () => void;
}) {
  return <div className="portfolio-empty">
    <span className="portfolio-empty-icon"><SlidersHorizontal size={22} aria-hidden /></span>
    <div><p className="dossier-row-title">{title}</p><p className="dossier-meta mt-1">{description}</p></div>
    {onReset && <button type="button" className="portfolio-action" onClick={onReset}>Limpar filtros</button>}
  </div>;
}

export function matchesPortfolioSearch(query: string, ...values: (string | null | undefined)[]) {
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  return normalize(values.filter(Boolean).join(' ')).includes(normalize(query.trim()));
}
