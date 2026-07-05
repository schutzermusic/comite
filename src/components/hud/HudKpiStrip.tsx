'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatKpiValue } from './HudKpi';
import type { HudKpiProps } from './HudKpi';

export interface KpiItem extends Omit<HudKpiProps, 'className' | 'size' | 'align'> {
  id: string;
  /** Optional click handler. When provided the item becomes a button. */
  onClick?: () => void;
  /** Highlights the item as the active selection (filter strips). */
  active?: boolean;
}

export interface HudKpiStripProps {
  kpis: KpiItem[];
  columns?: 2 | 3 | 4 | 5 | 6;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  /**
   * Legacy: when false, render items as separate glass cards with gaps.
   * Default visual is the unified executive band (Contratos standard).
   */
  glass?: boolean;
  /**
   * Legacy alias kept for compatibility — the unified executive band already
   * groups all items in a single container.
   */
  connected?: boolean;
  /** Item alignment. Defaults to left (label row on top, value below). */
  align?: 'left' | 'center';
}

const GRID_COLS: Record<NonNullable<HudKpiStripProps['columns']>, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-3',
  4: 'grid-cols-2 md:grid-cols-4',
  5: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-5',
  6: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6',
};

type Tone = NonNullable<HudKpiProps['variant']>;

const TONE_TEXT: Record<Tone, string> = {
  default: 'text-ig-fg-strong',
  success: 'text-ig-success',
  warning: 'text-ig-warning',
  danger: 'text-ig-danger',
  info: 'text-ig-info',
};

const VALUE_SIZE: Record<NonNullable<HudKpiStripProps['size']>, string> = {
  sm: 'text-base',
  md: 'text-lg',
  lg: 'text-xl',
};

/** Cell surface — mirrors the Contratos Executive Band MetricCell. */
const CELL_SURFACE =
  'relative min-w-0 overflow-hidden rounded-xl border border-ig-border-subtle ' +
  'bg-[linear-gradient(135deg,color-mix(in_oklab,var(--ig-bg-panel)_88%,transparent),color-mix(in_oklab,var(--ig-bg-raised)_42%,transparent))] ' +
  'shadow-[inset_0_1px_0_color-mix(in_oklab,var(--ig-border-strong)_80%,transparent)]';

/**
 * Executive KPI band — the unified glass command strip used at the top of
 * every module, in the visual language of the Contratos Executive Band:
 * rounded cells, small inline icon + uppercase label, tabular value with an
 * optional delta at the baseline and a muted sub line. Clickable cells act
 * as filter/navigation toggles with hairline hover, accent-tint active state
 * (plus a non-color "filtro" tag) and a visible focus ring.
 */
export function HudKpiStrip({
  kpis,
  columns = 4,
  className,
  size = 'md',
  align = 'left',
}: HudKpiStripProps) {
  const isCenter = align === 'center';

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.05 }}
      className={cn(
        'relative overflow-hidden rounded-[24px] border border-ig-border-focus/35',
        'bg-[linear-gradient(180deg,color-mix(in_oklab,var(--ig-bg-panel)_92%,transparent),color-mix(in_oklab,var(--ig-bg-raised)_58%,transparent))]',
        'p-1 shadow-[var(--ig-shadow-e2),inset_0_0_0_1px_color-mix(in_oklab,var(--ig-border-focus)_20%,transparent)]',
        className,
      )}
    >
      {/* Edge glow rails — glow kept restrained (Contratos signature) */}
      <div className="pointer-events-none absolute inset-y-3 left-3 w-px bg-ig-accent shadow-[0_0_12px_color-mix(in_oklab,var(--ig-accent)_70%,transparent)]" />
      <div className="pointer-events-none absolute inset-y-3 right-3 w-px bg-ig-border-focus" />

      <div className={cn('relative grid gap-1', GRID_COLS[columns])}>
        {kpis.map((kpi) => {
          const Comp: React.ElementType = kpi.onClick ? 'button' : 'div';
          const isClickable = Boolean(kpi.onClick);
          const active = Boolean(kpi.active);
          const variant: Tone = kpi.variant ?? 'default';
          const valueTone = kpi.tintValue ? TONE_TEXT[variant] : TONE_TEXT.default;
          const displayValue = formatKpiValue(kpi.value, kpi.format ?? 'auto', kpi.fractionDigits);
          const isPositive = kpi.delta !== undefined && kpi.delta > 0;
          const isNegative = kpi.delta !== undefined && kpi.delta < 0;
          return (
            <Comp
              key={kpi.id}
              type={isClickable ? 'button' : undefined}
              onClick={kpi.onClick}
              aria-pressed={isClickable ? active : undefined}
              title={isClickable ? (active ? 'Remover seleção' : 'Selecionar indicador') : undefined}
              className={cn(
                CELL_SURFACE,
                'group px-4 py-3 text-left transition-all duration-200 ease-out',
                isClickable && [
                  'cursor-pointer hover:-translate-y-px hover:border-ig-border-focus',
                  'hover:shadow-[0_8px_24px_-12px_color-mix(in_oklab,var(--ig-accent)_35%,transparent),inset_0_1px_0_color-mix(in_oklab,var(--ig-border-strong)_80%,transparent)]',
                  'focus-visible:outline-none focus-visible:border-ig-border-focus focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
                  'active:translate-y-0',
                ],
                // color-mix on the raw accent (not accent-weak) so the tint reads
                // at ~10% in BOTH themes.
                active && 'border-ig-accent/55 bg-[color-mix(in_oklab,var(--ig-accent)_10%,transparent)]',
              )}
            >
              <span
                className={cn(
                  'pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-ig-accent to-transparent transition-opacity',
                  active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                )}
              />
              <div
                className={cn(
                  'flex items-center gap-1.5',
                  active ? 'text-ig-accent' : 'text-ig-fg-muted',
                  isCenter && 'justify-center',
                )}
              >
                {kpi.icon && (
                  <span
                    className={cn(
                      'flex shrink-0 items-center justify-center [&_svg]:h-3.5 [&_svg]:w-3.5',
                      active ? 'text-ig-accent' : variant === 'default' ? 'text-ig-fg-subtle' : TONE_TEXT[variant],
                    )}
                  >
                    {kpi.icon}
                  </span>
                )}
                <span className="truncate text-[10px] font-semibold uppercase tracking-[0.12em]">{kpi.label}</span>
                {/* Non-color active indication (a11y): explicit tag, not just tint */}
                {active && (
                  <span className="ml-auto shrink-0 rounded-full border border-[color-mix(in_oklab,var(--ig-accent)_40%,transparent)] bg-[color-mix(in_oklab,var(--ig-accent)_14%,transparent)] px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.08em] text-ig-accent">
                    filtro
                  </span>
                )}
              </div>

              <div className={cn('mt-1 flex min-w-0 items-baseline gap-2', isCenter && 'justify-center')}>
                <p
                  className={cn(
                    'ig-tabular truncate leading-tight',
                    VALUE_SIZE[size],
                    active ? 'font-bold' : 'font-semibold',
                    valueTone,
                  )}
                >
                  {kpi.prefix && <span className="mr-1 font-semibold text-ig-fg-muted">{kpi.prefix}</span>}
                  {displayValue}
                  {kpi.suffix && <span className="ml-1 font-semibold text-ig-fg-muted">{kpi.suffix}</span>}
                </p>
                {kpi.deltaText !== undefined ? (
                  <span
                    className={cn(
                      'shrink-0 text-[10px] font-semibold tabular-nums',
                      kpi.deltaTone === 'success' && 'text-ig-success',
                      kpi.deltaTone === 'danger' && 'text-ig-danger',
                      (kpi.deltaTone === 'neutral' || !kpi.deltaTone) && 'text-ig-fg-muted',
                    )}
                  >
                    {kpi.deltaText}
                  </span>
                ) : (
                  kpi.delta !== undefined && (
                    <span
                      className={cn(
                        'flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                        isPositive && 'text-ig-success bg-[color-mix(in_oklab,var(--ig-success)_14%,transparent)]',
                        isNegative && 'text-ig-danger bg-[color-mix(in_oklab,var(--ig-danger)_14%,transparent)]',
                        !isPositive && !isNegative && 'bg-ig-panel text-ig-fg-muted',
                      )}
                    >
                      {isPositive && <TrendingUp className="h-3 w-3" />}
                      {isNegative && <TrendingDown className="h-3 w-3" />}
                      {!isPositive && !isNegative && <Minus className="h-3 w-3" />}
                      {isPositive ? '+' : ''}
                      {kpi.delta}%
                    </span>
                  )
                )}
              </div>

              {kpi.deltaLabel && (
                <p className={cn('mt-0.5 truncate text-[11px]', active ? 'text-ig-fg-strong' : 'text-ig-fg-muted', isCenter && 'text-center')}>
                  {kpi.deltaLabel}
                </p>
              )}
            </Comp>
          );
        })}
      </div>
    </motion.section>
  );
}
