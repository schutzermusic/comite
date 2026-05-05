'use client';

import React from 'react';
import { CalendarRange, SlidersHorizontal } from 'lucide-react';
import { HudSelect } from '@/components/hud';
import { cn } from '@/lib/utils';
import {
  PERIOD_OPTIONS, SCENARIO_OPTIONS,
  type FinancePeriod, type FinanceScenario,
} from './types';

export interface FinanceFilterBarProps {
  period: FinancePeriod;
  onPeriodChange: (p: FinancePeriod) => void;
  scenario?: FinanceScenario;
  onScenarioChange?: (s: FinanceScenario) => void;
  showScenario?: boolean;
  extra?: React.ReactNode;
  rightSlot?: React.ReactNode;
  className?: string;
  sticky?: boolean;
}

export function FinanceFilterBar({
  period, onPeriodChange,
  scenario = 'realized', onScenarioChange,
  showScenario = true,
  extra, rightSlot, className, sticky = true,
}: FinanceFilterBarProps) {
  return (
    <div
      className={cn(
        sticky && 'sticky top-2 z-20',
        'rounded-xl border border-ig-border-subtle bg-ig-panel/85 backdrop-blur-xl',
        'shadow-[0_6px_24px_-12px_rgba(0,0,0,0.4)]',
        'px-3.5 py-2.5 flex flex-wrap items-end gap-3',
        className,
      )}
    >
      <div className="flex items-end gap-1.5 pr-3 border-r border-ig-border-subtle/60">
        <CalendarRange className="w-3.5 h-3.5 text-ig-text-tertiary mb-2.5" strokeWidth={1.6} />
        <HudSelect
          label="Período"
          size="sm"
          value={period}
          onChange={(v) => onPeriodChange(v as FinancePeriod)}
          options={PERIOD_OPTIONS}
        />
      </div>

      {showScenario && onScenarioChange && (
        <div className="flex items-end gap-1.5 pr-3 border-r border-ig-border-subtle/60">
          <SlidersHorizontal className="w-3.5 h-3.5 text-ig-text-tertiary mb-2.5" strokeWidth={1.6} />
          <HudSelect
            label="Cenário"
            size="sm"
            value={scenario}
            onChange={(v) => onScenarioChange(v as FinanceScenario)}
            options={SCENARIO_OPTIONS}
          />
        </div>
      )}

      {extra}

      <div className="ml-auto flex items-center gap-2">{rightSlot}</div>
    </div>
  );
}
