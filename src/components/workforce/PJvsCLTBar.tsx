'use client';

import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

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
            <div className="w-2 h-2 rounded-full bg-semantic-info-DEFAULT" />
            <span className="text-orion-text-secondary">PJ</span>
            <span className="text-white font-medium">{pjPercent.toFixed(1)}%</span>
            {pjCost && (
              <span className="text-orion-text-muted">({formatCost(pjCost)})</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {cltCost && (
              <span className="text-orion-text-muted">({formatCost(cltCost)})</span>
            )}
            <span className="text-white font-medium">{cltPercent.toFixed(1)}%</span>
            <span className="text-orion-text-secondary">CLT</span>
            <div className="w-2 h-2 rounded-full bg-semantic-success-DEFAULT" />
          </div>
        </div>
      )}

      {/* Bar */}
      <div className="relative h-3 bg-orion-bg-elevated rounded-full overflow-hidden">
        {/* PJ Section */}
        <motion.div
          className="absolute left-0 top-0 h-full bg-gradient-to-r from-semantic-info-DEFAULT to-semantic-info-light rounded-l-full"
          initial={{ width: 0 }}
          animate={{ width: `${pjPercent}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
        
        {/* CLT Section */}
        <motion.div
          className="absolute right-0 top-0 h-full bg-gradient-to-l from-semantic-success-DEFAULT to-semantic-success-light rounded-r-full"
          initial={{ width: 0 }}
          animate={{ width: `${cltPercent}%` }}
          transition={{ duration: 0.8, ease: 'easeOut', delay: 0.1 }}
        />

        {/* Center divider glow */}
        <div 
          className="absolute top-0 h-full w-px bg-white/20"
          style={{ left: `${pjPercent}%` }}
        />
      </div>
    </div>
  );
}

