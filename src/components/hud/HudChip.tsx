'use client';

import React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export type HudChipVariant = 'critical' | 'warning' | 'info' | 'success' | 'live' | 'neutral';

export interface HudChipProps {
  label: string;
  count?: number;
  variant?: HudChipVariant;
  href?: string;
  className?: string;
  pulseDot?: boolean;
  size?: 'sm' | 'md';
}

/* Dark default + semantic class hooks for .light CSS overrides */
const VARIANT_STYLES: Record<HudChipVariant, { dot: string; chip: string }> = {
  critical: {
    dot: 'bg-red-400',
    chip: 'bg-red-500/[0.08] border-red-500/20 text-red-300 hover:border-red-500/35 hover:bg-red-500/[0.14] hud-chip-critical',
  },
  warning: {
    dot: 'bg-amber-400',
    chip: 'bg-amber-500/[0.06] border-amber-500/18 text-amber-300 hover:border-amber-500/30 hover:bg-amber-500/[0.12] hud-chip-warning',
  },
  info: {
    dot: 'bg-cyan-400',
    chip: 'bg-cyan-500/[0.06] border-cyan-500/18 text-cyan-300 hover:border-cyan-500/30 hover:bg-cyan-500/[0.12] hud-chip-info',
  },
  success: {
    dot: 'bg-emerald-400',
    chip: 'bg-emerald-500/[0.06] border-emerald-500/18 text-emerald-300 hover:border-emerald-500/30 hover:bg-emerald-500/[0.12] hud-chip-success',
  },
  neutral: {
    dot: 'bg-white/40 light:bg-black/30',
    chip: 'bg-white/[0.04] border-white/10 text-white/60 hover:border-white/20 hover:bg-white/[0.08] hud-chip-neutral',
  },
  live: {
    dot: 'bg-emerald-400 animate-pulse',
    chip: 'bg-emerald-500/[0.06] border-emerald-500/[0.15] text-emerald-400 hud-chip-success',
  },
};

const SIZE_STYLES = {
  sm: {
    chip: 'px-2 py-1 text-[10px] gap-1.5',
    dot: 'w-1 h-1',
  },
  md: {
    chip: 'px-2.5 py-1 text-[11px] gap-2',
    dot: 'w-1.5 h-1.5',
  },
};

export function HudChip({
  label,
  count,
  variant = 'info',
  href,
  className,
  pulseDot = false,
  size = 'md',
}: HudChipProps) {
  const styles = VARIANT_STYLES[variant];
  const sizeStyles = SIZE_STYLES[size];

  const inner = (
    <>
      <span
        className={cn(
          'rounded-full inline-block flex-shrink-0',
          sizeStyles.dot,
          styles.dot,
          pulseDot && 'animate-pulse'
        )}
      />
      <span className="truncate">{label}</span>
      {count !== undefined && (
        <span className="font-bold tabular-nums">{count}</span>
      )}
    </>
  );

  const chipClass = cn(
    'inline-flex items-center rounded-full font-semibold tracking-wide border transition-all duration-150 cursor-pointer shrink-0',
    sizeStyles.chip,
    styles.chip,
    className
  );

  if (href) {
    return <Link href={href} className={chipClass}>{inner}</Link>;
  }
  return <span className={chipClass}>{inner}</span>;
}
