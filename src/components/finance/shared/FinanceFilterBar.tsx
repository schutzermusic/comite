'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { CalendarRange, Layers, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  PERIOD_OPTIONS, SCENARIO_OPTIONS,
  type FinancePeriod, type FinanceScenario,
} from './types';

// ─────────────────────────────────────────────────────────────────────
// Shared HUD/glass filter shell used across every Finance submenu page.
// Visual reference: /financeiro/control-room (FinanceControlBar).
// The bar wraps cleanly on small screens, keeps actions right-aligned
// on desktop, and exposes compact primitives so page-specific filters
// inside `extra` can match the same chip language.
// ─────────────────────────────────────────────────────────────────────

export interface FinanceFilterBarProps {
  period?: FinancePeriod;
  onPeriodChange?: (p: FinancePeriod) => void;
  scenario?: FinanceScenario;
  onScenarioChange?: (s: FinanceScenario) => void;
  showScenario?: boolean;
  showPeriod?: boolean;
  extra?: React.ReactNode;
  rightSlot?: React.ReactNode;
  className?: string;
  sticky?: boolean;
}

export function FinanceFilterBar({
  period, onPeriodChange,
  scenario, onScenarioChange,
  showScenario = true,
  showPeriod = true,
  extra, rightSlot, className, sticky = true,
}: FinanceFilterBarProps) {
  const renderPeriod = showPeriod && period !== undefined && onPeriodChange;
  const renderScenario = showScenario && scenario !== undefined && onScenarioChange;
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={cn(sticky && 'sticky top-3 z-30', className)}
    >
      <div className="ig-glass" data-elev={3} data-sweep>
        <span data-ig-noise="" />
        <span data-ig-specular="" />
        <span data-ig-sweep="" />
        <div data-ig-content="" className="px-3.5 py-2.5">
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              {renderPeriod && (
                <FinanceFilterChip
                  icon={<CalendarRange className="h-3.5 w-3.5" />}
                  label="Período"
                  value={period}
                  options={PERIOD_OPTIONS}
                  onChange={(v) => onPeriodChange(v as FinancePeriod)}
                />
              )}

              {renderScenario && (
                <FinanceFilterChip
                  icon={<Layers className="h-3.5 w-3.5" />}
                  label="Cenário"
                  value={scenario}
                  options={SCENARIO_OPTIONS}
                  onChange={(v) => onScenarioChange(v as FinanceScenario)}
                />
              )}

              {extra}
            </div>

            {rightSlot && (
              <div className="flex flex-wrap items-center gap-2 lg:justify-end [&_>_button]:h-9">
                {rightSlot}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// FinanceFilterChip — the canonical "icon + UPPERCASE label + value"
// chip. Use this inside `extra` to keep page-specific filters visually
// consistent with the period/scenario chips.
// ─────────────────────────────────────────────────────────────────────

export interface FinanceFilterChipProps {
  icon?: React.ReactNode;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  maxValueChars?: number;
}

export function FinanceFilterChip({
  icon, label, value, options, onChange, maxValueChars,
}: FinanceFilterChipProps) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-[color:var(--ig-border-strong)] bg-[color:var(--ig-bg-raised)]/60 px-2 h-9 backdrop-blur-sm min-w-0">
      <span className="flex items-center gap-1.5 pl-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ig-fg-subtle)] whitespace-nowrap">
        {icon}
        {label}
      </span>
      <BareSelect
        value={value}
        onChange={onChange}
        options={options}
        maxValueChars={maxValueChars}
      />
    </div>
  );
}

// Segmented two-button group used inside `extra` for binary/ternary
// switches like "Visão" / view modes. Same chip shell.
export interface FinanceFilterSegmentProps<T extends string> {
  icon?: React.ReactNode;
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}

export function FinanceFilterSegment<T extends string>({
  icon, label, value, options, onChange,
}: FinanceFilterSegmentProps<T>) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-[color:var(--ig-border-strong)] bg-[color:var(--ig-bg-raised)]/60 px-1.5 h-9 backdrop-blur-sm">
      <span className="flex items-center gap-1.5 pl-2 pr-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ig-fg-subtle)] whitespace-nowrap">
        {icon}
        {label}
      </span>
      <div className="flex items-center gap-0.5">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              className={cn(
                'rounded-md px-2 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap',
                active
                  ? 'bg-[color:var(--ig-accent-weak)] text-[color:var(--ig-accent)] border border-[color:var(--ig-border-focus)]'
                  : 'text-[color:var(--ig-fg-muted)] hover:text-[color:var(--ig-fg-strong)] border border-transparent',
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface BareSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  maxValueChars?: number;
}

function BareSelect({ value, onChange, options, maxValueChars }: BareSelectProps) {
  const style = maxValueChars
    ? { maxWidth: `${maxValueChars}ch` as const }
    : undefined;
  return (
    <div className="relative min-w-0">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={style}
        className={cn(
          'appearance-none cursor-pointer rounded-md max-w-[22ch] truncate',
          'bg-transparent pl-2 pr-6 py-1 text-xs font-medium',
          'text-[color:var(--ig-fg-strong)]',
          'border border-transparent hover:border-[color:var(--ig-border-strong)]',
          'focus:outline-none focus:border-[color:var(--ig-border-focus)]',
          'transition-colors',
        )}
      >
        {options.map((o) => (
          <option
            key={o.value}
            value={o.value}
            className="bg-[color:var(--ig-bg-raised)] text-[color:var(--ig-fg-strong)]"
          >
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1 top-1/2 h-3 w-3 -translate-y-1/2 text-[color:var(--ig-fg-subtle)]" />
    </div>
  );
}
