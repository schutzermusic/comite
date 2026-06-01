'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export interface FinanceChartContainerProps {
  children: React.ReactNode;
  /** Recommended height for the chart in px. Used to prevent layout jumps. */
  minHeight?: number;
  /**
   * Allow internal horizontal scroll. The chart wrapper is always
   * overflow-x clipped — when this is true the inner area scrolls
   * horizontally, when false it just hides any overflow.
   * Defaults to false (most SVG charts auto-fit via ResizeObserver).
   */
  scrollX?: boolean;
  className?: string;
}

/**
 * Standard wrapper for chart cards. Two responsibilities:
 *   1. Provide `min-w-0` so the chart can render inside CSS grids without
 *      pushing the parent wider than the viewport.
 *   2. Isolate horizontal overflow — long monthly labels or dense
 *      categorical charts can scroll INSIDE this wrapper only.
 *
 * Use this around any chart inside Finance cards instead of bare divs.
 */
export function FinanceChartContainer({
  children,
  minHeight,
  scrollX = false,
  className,
}: FinanceChartContainerProps) {
  return (
    <div
      className={cn(
        'relative w-full min-w-0',
        scrollX ? 'overflow-x-auto overflow-y-hidden' : 'overflow-hidden',
        className,
      )}
      style={minHeight ? { minHeight } : undefined}
    >
      {children}
    </div>
  );
}
