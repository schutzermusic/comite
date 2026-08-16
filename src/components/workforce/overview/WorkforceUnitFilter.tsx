'use client';

/**
 * Recorte por lotação / centro de custo — multi-seleção.
 *
 * `FinanceFilterChip` envolve um `<select>` nativo e só faz escolha única, daí
 * este componente existir. Ele reusa os tokens exportados da barra
 * (`FILTER_CHIP_SHELL`, `FILTER_CHIP_LABEL`) para ficar pixel-idêntico aos
 * demais chips sem forkar as 312 linhas de `FinanceFilterBar`.
 *
 * A parte que importa é o badge de capacidade: cada unidade declara o que sabe
 * responder (`carries`), e uma unidade vinda só do lote de folha carrega valor
 * mas não carrega quadro. Mostrar isso ANTES da escolha evita a pior
 * experiência possível — filtrar, ver metade dos KPIs virarem traço e não
 * entender por quê.
 */

import { useEffect, useRef, useState } from 'react';
import { Building2, Check, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FILTER_CHIP_LABEL, FILTER_CHIP_SHELL } from '@/components/finance/shared';
import { describeUnitSelection } from '@/lib/workforce/overview/units';
import type { WorkforceUnit } from '@/lib/workforce/overview/types';

interface WorkforceUnitFilterProps {
  units: WorkforceUnit[];
  selected: string[];
  onChange: (next: string[]) => void;
  className?: string;
}

const ORIGIN_LABEL: Record<WorkforceUnit['origin'], string> = {
  'payroll-batch': 'folha',
  'esocial-lotacao': 'eSocial',
  both: 'folha + eSocial',
};

export function WorkforceUnitFilter({
  units,
  selected,
  onChange,
  className,
}: WorkforceUnitFilterProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  };

  const summary = describeUnitSelection(units, selected);
  const disabled = units.length === 0;

  return (
    <div
      ref={ref}
      className={cn('relative w-full sm:w-[17rem] sm:max-w-[17rem] sm:shrink-0', className)}
    >
      <div className={FILTER_CHIP_SHELL}>
        <span className={FILTER_CHIP_LABEL}>
          <Building2 className="h-3.5 w-3.5 shrink-0" />
          Lotação
        </span>
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          title={disabled ? 'Sem lotação apurada no período' : summary}
          className={cn(
            'flex min-w-0 flex-1 items-center justify-between gap-1 rounded-md px-1 py-0.5',
            'text-sm font-medium text-ig-fg-strong transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ig-border-focus',
            disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-ig-bg-raised/60',
          )}
        >
          <span className="truncate">{disabled ? 'Sem lotação' : summary}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ig-fg-subtle" />
        </button>
        {selected.length > 0 && (
          <button
            type="button"
            aria-label="Limpar recorte por lotação"
            onClick={() => onChange([])}
            className="shrink-0 rounded p-0.5 text-ig-fg-subtle transition-colors hover:text-ig-fg-strong"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && !disabled && (
        <div
          role="listbox"
          aria-multiselectable
          className={cn(
            'absolute left-0 top-[calc(100%+0.35rem)] z-50 max-h-80 w-full min-w-[17rem] overflow-y-auto',
            'rounded-xl border border-ig-border-strong bg-ig-bg-overlay p-1.5 shadow-xl backdrop-blur-xl',
          )}
        >
          {units.map((unit) => {
            const isSelected = selected.includes(unit.id);
            // O que a unidade NÃO carrega é o que interessa avisar.
            const missing = [
              !unit.carries.headcount && 'quadro',
              !unit.carries.movement && 'movimentação',
              !unit.carries.absence && 'faltas',
            ].filter(Boolean) as string[];

            return (
              <button
                key={unit.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => toggle(unit.id)}
                className={cn(
                  'flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
                  isSelected ? 'bg-ig-accent-weak' : 'hover:bg-ig-bg-raised/70',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                    isSelected
                      ? 'border-ig-accent bg-ig-accent text-ig-bg-canvas'
                      : 'border-ig-border-strong',
                  )}
                >
                  {isSelected && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[12.5px] font-medium text-ig-fg-strong">
                      {unit.label}
                    </span>
                    <span className="shrink-0 rounded border border-ig-border-subtle px-1 text-[9px] uppercase tracking-wide text-ig-fg-subtle">
                      {ORIGIN_LABEL[unit.origin]}
                    </span>
                  </span>
                  {missing.length > 0 && (
                    <span className="mt-0.5 block text-[10px] leading-tight text-ig-warning">
                      sem {missing.join(', ')}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
