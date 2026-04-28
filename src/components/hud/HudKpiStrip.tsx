'use client';

import React from 'react';
import { motion } from 'framer-motion';
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
  /** When true (default), each item is rendered as its own glass card. */
  glass?: boolean;
  /**
   * Renders all items inside a single glass container, separated by hairline dividers.
   * Use this for executive top strips (e.g. financeiro overview).
   */
  connected?: boolean;
  /** Centers content within each cell — recommended in connected mode. */
  align?: 'left' | 'center';
}

const GRID_COLS: Record<NonNullable<HudKpiStripProps['columns']>, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-3',
  4: 'grid-cols-2 md:grid-cols-4',
  5: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-5',
  6: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6',
};

export function HudKpiStrip({
  kpis,
  columns = 4,
  className,
  size = 'md',
  glass = true,
  connected = false,
  align,
}: HudKpiStripProps) {
  const itemAlign: 'left' | 'center' = align ?? (connected ? 'center' : 'left');

  if (connected) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
        className={cn('ig-glass relative overflow-hidden rounded-xl', className)}
        data-elev="2"
      >
        <span data-ig-noise="" />
        <span data-ig-specular="" />
        <div data-ig-content="" className={cn('grid', GRID_COLS[columns])}>
          {kpis.map((kpi) => {
            const Comp: any = kpi.onClick ? 'button' : 'div';
            return (
              <Comp
                key={kpi.id}
                onClick={kpi.onClick}
                className={cn(
                  'flex min-h-[4.25rem] min-w-0 flex-col items-stretch justify-center px-3 py-3',
                  'border-r border-b border-ig-border-subtle last:border-r-0',
                  '[&:nth-last-child(-n+1)]:border-b-0',
                  // collapse bottom borders on the last row in each breakpoint
                  'transition-colors',
                  kpi.onClick && 'cursor-pointer hover:bg-ig-panel-hover/60',
                  kpi.active && 'bg-ig-accent-weak/40',
                )}
                aria-pressed={kpi.onClick ? kpi.active : undefined}
              >
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
                  align={itemAlign}
                />
              </Comp>
            );
          })}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      className={cn('grid gap-3', GRID_COLS[columns], className)}
    >
      {kpis.map((kpi, index) => {
        const Inner: any = kpi.onClick ? 'button' : 'div';
        return (
          <motion.div
            key={kpi.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 + index * 0.04 }}
            className={cn(
              glass && 'ig-glass relative overflow-hidden rounded-xl',
              !glass && 'rounded-lg',
              kpi.active && 'ring-1 ring-ig-accent/60',
            )}
            data-elev={glass ? '2' : undefined}
          >
            {glass && (
              <>
                <span data-ig-noise="" />
                <span data-ig-specular="" />
              </>
            )}
            <Inner
              data-ig-content=""
              onClick={kpi.onClick}
              className={cn(
                'block w-full text-left p-4',
                !glass && 'p-3',
                kpi.onClick && 'transition-colors hover:bg-ig-panel-hover/40 cursor-pointer',
              )}
              aria-pressed={kpi.onClick ? kpi.active : undefined}
            >
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
                align={itemAlign}
              />
            </Inner>
          </motion.div>
        );
      })}
    </motion.div>
  );
}
