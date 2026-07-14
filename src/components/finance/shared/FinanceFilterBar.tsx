'use client';

import React from 'react';
import { motion } from 'motion/react';
import { CalendarRange, Layers, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  PERIOD_OPTIONS, SCENARIO_OPTIONS,
  type FinancePeriod, type FinanceScenario,
} from './types';

// ─────────────────────────────────────────────────────────────────────
// Shared HUD/glass filter shell used across every Finance submenu page.
// Visual reference: /financeiro/control-room (FinanceControlBar).
// Fixed-width chips in a wrapping flex row — no horizontal scroll bars.
// When the row fills up, chips flow to the next line. Sticky only on xl+.
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
      className={cn(
        'relative z-20 w-full min-w-0',
        sticky && 'xl:sticky xl:top-3',
        className,
      )}
    >
      <div className="ig-glass w-full min-w-0 overflow-hidden" data-elev={3} data-sweep>
        <span data-ig-noise="" />
        <span data-ig-specular="" />
        <span data-ig-sweep="" />
        <div data-ig-content="" className="px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="flex w-full min-w-0 flex-col gap-2.5 sm:flex-row sm:items-start sm:gap-2">
            <div className="flex min-w-0 w-full flex-1 flex-wrap items-stretch gap-2">
              {renderPeriod && (
                <FinanceFilterChip
                  icon={<CalendarRange className="h-3.5 w-3.5 shrink-0" />}
                  label="Período"
                  value={period}
                  options={PERIOD_OPTIONS}
                  onChange={(v) => onPeriodChange(v as FinancePeriod)}
                  layout="periodSelect"
                />
              )}

              {renderScenario && (
                <FinanceFilterChip
                  icon={<Layers className="h-3.5 w-3.5 shrink-0" />}
                  label="Cenário"
                  value={scenario}
                  options={SCENARIO_OPTIONS}
                  onChange={(v) => onScenarioChange(v as FinanceScenario)}
                  layout="scenarioSelect"
                />
              )}

              {extra}
            </div>

            {rightSlot && (
              <div className="flex w-full shrink-0 flex-wrap items-center gap-2 lg:w-auto lg:justify-end [&_>_button]:h-9 [&_>_button]:min-w-0 [&_>_button]:flex-1 sm:[&_>_button]:flex-none">
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
// Chip shell + fixed standard widths. All chips shrink-0 on sm+ and wrap
// to the next row when the bar runs out of horizontal space.
// ─────────────────────────────────────────────────────────────────────

export const FILTER_CHIP_SHELL =
  'flex h-9 w-full min-w-0 items-center gap-1.5 rounded-lg border border-[color:var(--ig-border-strong)] bg-[color:var(--ig-bg-raised)]/60 px-2 backdrop-blur-sm';

export const FILTER_CHIP_LABEL =
  'flex shrink-0 items-center gap-1.5 pl-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ig-fg-subtle)] whitespace-nowrap';

export const CHIP_DIVIDER = 'mx-0.5 h-4 w-px shrink-0 rounded-full bg-[color:var(--ig-border-strong)]';

export const FILTER_CHIP_LAYOUT = {
  periodSelect: 'w-full sm:w-[12.5rem] sm:max-w-[12.5rem] sm:shrink-0',
  periodRange: 'w-full sm:w-[16rem] sm:max-w-[16rem] sm:shrink-0',
  /** Largura conforme os botões — o chip inteiro quebra de linha, nunca o conteúdo */
  scenarioSegment: 'w-full sm:w-auto sm:max-w-full sm:shrink-0',
  scenarioSelect: 'w-full sm:w-[12.5rem] sm:max-w-[12.5rem] sm:shrink-0',
  grow: 'w-full sm:w-[11rem] sm:max-w-[11rem] sm:shrink-0',
} as const;

export type FinanceFilterChipLayout = keyof typeof FILTER_CHIP_LAYOUT;

export interface FinanceFilterChipProps {
  icon?: React.ReactNode;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  maxValueChars?: number;
  className?: string;
  /** Width preset — defaults to `grow` (11rem standard select). */
  layout?: FinanceFilterChipLayout;
}

export function FinanceFilterChip({
  icon, label, value, options, onChange, maxValueChars, className,
  layout = 'grow',
}: FinanceFilterChipProps) {
  return (
    <div className={cn(FILTER_CHIP_SHELL, FILTER_CHIP_LAYOUT[layout], className)}>
      <span className={FILTER_CHIP_LABEL}>
        {icon}
        {label}
      </span>
      <span className={CHIP_DIVIDER} />
      <BareSelect
        value={value}
        onChange={onChange}
        options={options}
        maxValueChars={maxValueChars}
        className="min-w-0 flex-1"
      />
    </div>
  );
}

// Combined from→to period range — same pattern as FinanceControlBar (control room).
export interface FinanceFilterRangeProps {
  icon?: React.ReactNode;
  label: string;
  fromValue: string;
  toValue: string;
  options: { value: string; label: string }[];
  onChange: (from: string, to: string) => void;
  className?: string;
  layout?: Extract<FinanceFilterChipLayout, 'periodRange'>;
}

export function FinanceFilterRange({
  icon, label, fromValue, toValue, options, onChange, className,
  layout = 'periodRange',
}: FinanceFilterRangeProps) {
  return (
    <div className={cn(FILTER_CHIP_SHELL, FILTER_CHIP_LAYOUT[layout], className)}>
      <span className={FILTER_CHIP_LABEL}>
        {icon}
        {label}
      </span>
      <span className={CHIP_DIVIDER} />
      <div className="flex min-w-0 flex-1 items-center gap-0.5">
        <BareSelect
          value={fromValue}
          onChange={(v) => onChange(v, toValue < v ? v : toValue)}
          options={options}
          className="min-w-0 flex-1"
        />
        <span className="shrink-0 text-[10px] text-[color:var(--ig-fg-subtle)]">→</span>
        <BareSelect
          value={toValue}
          onChange={(v) => onChange(fromValue > v ? v : fromValue, v)}
          options={options}
          className="min-w-0 flex-1"
        />
      </div>
    </div>
  );
}

// Native date input inside the same chip shell (vencimento, emissão, etc.).
export interface FinanceFilterDateFieldProps {
  icon?: React.ReactNode;
  label: string;
  value: string;
  onChange: (value: string) => void;
}

export function FinanceFilterDateField({
  icon, label, value, onChange,
}: FinanceFilterDateFieldProps) {
  return (
    <label className={cn(FILTER_CHIP_SHELL, 'cursor-pointer')}>
      <span className={FILTER_CHIP_LABEL}>
        {icon}
        {label}
      </span>
      <span className={CHIP_DIVIDER} />
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 bg-transparent text-xs font-medium text-[color:var(--ig-fg-strong)] focus:outline-none"
      />
    </label>
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
  className?: string;
  layout?: Extract<FinanceFilterChipLayout, 'scenarioSegment'>;
}

export function FinanceFilterSegment<T extends string>({
  icon, label, value, options, onChange, className,
  layout = 'scenarioSegment',
}: FinanceFilterSegmentProps<T>) {
  return (
    <div className={cn(FILTER_CHIP_SHELL, FILTER_CHIP_LAYOUT[layout], 'overflow-hidden', className)}>
      <span className={FILTER_CHIP_LABEL}>
        {icon}
        {label}
      </span>
      <span className={CHIP_DIVIDER} />
      <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-0.5">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              className={cn(
                'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition-colors whitespace-nowrap',
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
  className?: string;
}

function BareSelect({ value, onChange, options, maxValueChars, className }: BareSelectProps) {
  const style = maxValueChars
    ? { maxWidth: `${maxValueChars}ch` as const }
    : undefined;
  return (
    <div className={cn('relative min-w-0', className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={style}
        className={cn(
          'w-full max-w-full appearance-none cursor-pointer truncate rounded-md',
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
