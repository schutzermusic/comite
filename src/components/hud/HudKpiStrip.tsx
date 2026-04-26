'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { HudKpi } from './HudKpi';
import type { HudKpiProps } from './HudKpi';

export interface KpiItem extends Omit<HudKpiProps, 'className' | 'size'> {
  id: string;
}

export interface HudKpiStripProps {
  kpis: KpiItem[];
  columns?: 2 | 3 | 4 | 6;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  glass?: boolean;
}

export function HudKpiStrip({
  kpis,
  columns = 4,
  className,
  size = 'md',
  glass = true,
}: HudKpiStripProps) {
  const gridCols = {
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-2 md:grid-cols-4',
    6: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      className={cn('grid gap-3', gridCols[columns], className)}
    >
      {kpis.map((kpi, index) => (
        <motion.div
          key={kpi.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 + index * 0.05 }}
          className={cn(
            glass && 'ig-glass relative overflow-hidden rounded-xl',
            !glass && 'rounded-lg',
          )}
          data-elev={glass ? '2' : undefined}
        >
          {glass && (
            <>
              <span data-ig-noise="" />
              <span data-ig-specular="" />
            </>
          )}
          <div data-ig-content="" className={cn('p-3', glass && 'p-4')}>
            <HudKpi
              value={kpi.value}
              label={kpi.label}
              delta={kpi.delta}
              deltaLabel={kpi.deltaLabel}
              prefix={kpi.prefix}
              suffix={kpi.suffix}
              size={size}
              variant={kpi.variant}
              icon={kpi.icon}
            />
          </div>
        </motion.div>
      ))}
    </motion.div>
  );
}
