'use client';

import { cn } from '@/lib/utils';
import { motion } from 'motion/react';

interface PJvsCLTBarProps {
  pjPercent: number;
  cltPercent: number;
  pjCost?: number;
  cltCost?: number;
  showLabels?: boolean;
  className?: string;
}

export function PJvsCLTBar({
  pjPercent,
  cltPercent,
  pjCost,
  cltCost,
  showLabels = true,
  className,
}: PJvsCLTBarProps) {
  const formatCost = (value: number) => {
    if (value >= 1000000) {
      return `R$ ${(value / 1000000).toFixed(1)}M`;
    }
    return `R$ ${(value / 1000).toFixed(0)}K`;
  };

  return (
    <div className={cn('space-y-2', className)}>
      {/* Labels */}
      {showLabels && (
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-ig-info" />
            <span className="text-ig-fg-muted">PJ</span>
            <span className="text-ig-fg-strong font-semibold ig-tabular">{pjPercent.toFixed(1)}%</span>
            {pjCost && (
              <span className="text-ig-fg-subtle ig-tabular">({formatCost(pjCost)})</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {cltCost && (
              <span className="text-ig-fg-subtle ig-tabular">({formatCost(cltCost)})</span>
            )}
            <span className="text-ig-fg-strong font-semibold ig-tabular">{cltPercent.toFixed(1)}%</span>
            <span className="text-ig-fg-muted">CLT</span>
            <div className="w-2 h-2 rounded-full bg-ig-success" />
          </div>
        </div>
      )}

      {/* Bar */}
      <div className="relative h-3 bg-ig-panel border border-ig-border-subtle rounded-full overflow-hidden">
        {/* PJ Section */}
        <motion.div
          className="absolute left-0 top-0 h-full rounded-l-full"
          style={{ background: 'linear-gradient(90deg, var(--ig-info), color-mix(in oklab, var(--ig-info) 70%, transparent))' }}
          initial={{ width: 0 }}
          animate={{ width: `${pjPercent}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />

        {/* CLT Section */}
        <motion.div
          className="absolute right-0 top-0 h-full rounded-r-full"
          style={{ background: 'linear-gradient(270deg, var(--ig-success), color-mix(in oklab, var(--ig-success) 70%, transparent))' }}
          initial={{ width: 0 }}
          animate={{ width: `${cltPercent}%` }}
          transition={{ duration: 0.8, ease: 'easeOut', delay: 0.1 }}
        />

        {/* Center divider glow */}
        <div
          className="absolute top-0 h-full w-px bg-ig-border-strong"
          style={{ left: `${pjPercent}%` }}
        />
      </div>
    </div>
  );
}

