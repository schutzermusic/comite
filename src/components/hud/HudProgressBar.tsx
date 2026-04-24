'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export type ProgressVariant = 'default' | 'success' | 'warning' | 'danger' | 'info';

export interface HudProgressBarProps {
  value: number;
  max?: number;
  variant?: ProgressVariant;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  labelPosition?: 'inside' | 'right';
  className?: string;
  animated?: boolean;
}

const VARIANT_STYLES: Record<ProgressVariant, string> = {
  default: 'bg-ig-accent',
  success: 'bg-ig-success',
  warning: 'bg-ig-warning',
  danger: 'bg-ig-danger',
  info: 'bg-ig-info',
};

const SIZE_STYLES = {
  sm: 'h-1.5',
  md: 'h-2.5',
  lg: 'h-4',
};

export function HudProgressBar({
  value,
  max = 100,
  variant = 'default',
  size = 'md',
  showLabel = true,
  labelPosition = 'right',
  className,
  animated = true,
}: HudProgressBarProps) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

  // Auto-variant based on percentage
  const autoVariant =
    variant === 'default'
      ? percentage >= 80
        ? 'success'
        : percentage >= 50
        ? 'info'
        : percentage >= 25
        ? 'warning'
        : 'danger'
      : variant;

  return (
    <div className={cn('flex items-center gap-3', className)}>
      {/* Progress track */}
      <div
        className={cn(
          'flex-1 rounded-full overflow-hidden',
          'bg-ig-panel-hover',
          SIZE_STYLES[size]
        )}
      >
        {/* Progress fill */}
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500 ease-out',
            VARIANT_STYLES[autoVariant],
            animated && 'animate-pulse-subtle'
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Label */}
      {showLabel && labelPosition === 'right' && (
        <span className="text-xs font-medium text-ig-fg tabular-nums w-10 text-right">
          {Math.round(percentage)}%
        </span>
      )}

      {/* Inside label */}
      {showLabel && labelPosition === 'inside' && (
        <span className="sr-only">{Math.round(percentage)}%</span>
      )}
    </div>
  );
}
