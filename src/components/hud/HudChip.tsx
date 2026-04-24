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

/* Semantic tokens — os valores --ig-* trocam entre dark/light automaticamente */
const VARIANT_STYLES: Record<HudChipVariant, { dot: string; chip: string }> = {
  critical: {
    dot: 'bg-ig-danger',
    chip: 'bg-[color-mix(in_oklab,var(--ig-danger)_10%,transparent)] border-[color-mix(in_oklab,var(--ig-danger)_32%,transparent)] text-ig-danger hover:border-[color-mix(in_oklab,var(--ig-danger)_44%,transparent)] hover:bg-[color-mix(in_oklab,var(--ig-danger)_16%,transparent)] hud-chip-critical',
  },
  warning: {
    dot: 'bg-ig-warning',
    chip: 'bg-[color-mix(in_oklab,var(--ig-warning)_10%,transparent)] border-[color-mix(in_oklab,var(--ig-warning)_28%,transparent)] text-ig-warning hover:border-[color-mix(in_oklab,var(--ig-warning)_40%,transparent)] hover:bg-[color-mix(in_oklab,var(--ig-warning)_16%,transparent)] hud-chip-warning',
  },
  info: {
    dot: 'bg-ig-accent',
    chip: 'bg-ig-accent-weak border-ig-border-focus text-ig-accent hover:brightness-110 hud-chip-info',
  },
  success: {
    dot: 'bg-ig-success',
    chip: 'bg-[color-mix(in_oklab,var(--ig-success)_10%,transparent)] border-[color-mix(in_oklab,var(--ig-success)_28%,transparent)] text-ig-success hover:border-[color-mix(in_oklab,var(--ig-success)_40%,transparent)] hover:bg-[color-mix(in_oklab,var(--ig-success)_16%,transparent)] hud-chip-success',
  },
  neutral: {
    dot: 'bg-ig-fg-muted',
    chip: 'bg-ig-panel border-ig-border text-ig-fg-muted hover:border-ig-border-strong hover:bg-ig-panel-hover hud-chip-neutral',
  },
  live: {
    dot: 'bg-ig-success animate-pulse',
    chip: 'bg-[color-mix(in_oklab,var(--ig-success)_10%,transparent)] border-[color-mix(in_oklab,var(--ig-success)_22%,transparent)] text-ig-success hud-chip-success',
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
