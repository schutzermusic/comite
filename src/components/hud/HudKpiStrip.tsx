'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HudKpi } from './HudKpi';
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
   * Default visual is the unified faceted strip (Organograma standard).
   */
  glass?: boolean;
  /**
   * Legacy alias kept for compatibility — the unified faceted strip already
   * groups all items in a single container.
   */
  connected?: boolean;
  /** Item alignment. Defaults to left (icon + label/value horizontally). */
  align?: 'left' | 'center';
}

const GRID_COLS: Record<NonNullable<HudKpiStripProps['columns']>, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-3',
  4: 'grid-cols-2 md:grid-cols-4',
  5: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-5',
  6: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6',
};

/**
 * Builds the per-cell clip-path so each row of the strip looks faceted at its
 * outer corners. We compute position relative to the row, not the flat array.
 * - first-of-row: bevels left edges
 * - last-of-row: bevels right edges
 * - middle-of-row: subtle trapezoid bottom-cut for HUD rhythm
 */
function clipFor(index: number, total: number, cols: number): string | undefined {
  if (total < 2 || cols < 2) return undefined;
  const colIndex = index % cols;
  const isFirstInRow = colIndex === 0;
  const isLastInRow = colIndex === cols - 1 || index === total - 1;
  if (isFirstInRow) {
    return 'polygon(18px 0,100% 0,100% calc(100% - 18px),calc(100% - 18px) 100%,18px 100%,0 calc(100% - 18px),0 18px)';
  }
  if (isLastInRow) {
    return 'polygon(0 0,calc(100% - 18px) 0,100% 18px,100% calc(100% - 18px),calc(100% - 18px) 100%,0 100%)';
  }
  return 'polygon(0 0,100% 0,calc(100% - 12px) 100%,12px 100%)';
}

export function HudKpiStrip({
  kpis,
  columns = 4,
  className,
  size = 'md',
  align = 'left',
}: HudKpiStripProps) {
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
      {/* Edge glow rails */}
      <div className="pointer-events-none absolute inset-y-3 left-3 w-px bg-ig-accent shadow-[0_0_22px_var(--ig-accent)]" />
      <div className="pointer-events-none absolute inset-y-3 right-3 w-px bg-ig-border-focus" />

      <div className={cn('grid gap-1', GRID_COLS[columns])}>
        {kpis.map((kpi, index) => {
          const Comp: any = kpi.onClick ? 'button' : 'div';
          const isClickable = Boolean(kpi.onClick);
          return (
            <Comp
              key={kpi.id}
              type={isClickable ? 'button' : undefined}
              onClick={kpi.onClick}
              aria-pressed={isClickable ? kpi.active : undefined}
              className={cn(
                'group relative min-w-0 min-h-[5.35rem] overflow-hidden border border-ig-border-subtle',
                'bg-[linear-gradient(135deg,color-mix(in_oklab,var(--ig-bg-panel)_88%,transparent),color-mix(in_oklab,var(--ig-bg-raised)_42%,transparent))]',
                'px-5 py-4',
                'shadow-[inset_0_1px_0_color-mix(in_oklab,var(--ig-border-strong)_80%,transparent)]',
                'transition-all duration-200 ease-out hover:border-ig-border-focus',
                isClickable && [
                  'cursor-pointer text-left focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]',
                  'hover:-translate-y-px hover:shadow-[0_8px_24px_-12px_color-mix(in_oklab,var(--ig-accent)_45%,transparent),inset_0_1px_0_color-mix(in_oklab,var(--ig-border-strong)_80%,transparent)]',
                  'active:translate-y-0',
                ],
                kpi.active && 'border-ig-accent/60 bg-ig-accent-weak/40',
              )}
              style={{ clipPath: clipFor(index, kpis.length, columns) }}
            >
              <span className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-ig-accent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <div className="relative min-w-0">
                <HudKpi
                  value={kpi.value}
                  label={kpi.label}
                  delta={kpi.delta}
                  deltaText={kpi.deltaText}
                  deltaTone={kpi.deltaTone}
                  deltaLabel={kpi.deltaLabel}
                  prefix={kpi.prefix}
                  suffix={kpi.suffix}
                  size={size}
                  variant={kpi.variant}
                  tintValue={kpi.tintValue}
                  icon={kpi.icon}
                  align={align}
                  format={kpi.format}
                  fractionDigits={kpi.fractionDigits}
                />
              </div>
              {isClickable && (
                <ChevronRight
                  aria-hidden
                  className="pointer-events-none absolute right-2.5 bottom-2.5 h-3 w-3 text-ig-fg-subtle opacity-0 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:text-ig-accent"
                  strokeWidth={2.2}
                />
              )}
            </Comp>
          );
        })}
      </div>
    </motion.section>
  );
}
