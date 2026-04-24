'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export type HudBadgeVariant =
  | 'default'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral'
  | 'outline'
  | 'subtle';

export interface HudBadgeProps {
  children: React.ReactNode;
  variant?: HudBadgeVariant;
  size?: 'sm' | 'md';
  className?: string;
  dot?: boolean;
  dotColor?: string;
}

/* Semantic tokens — trocam valor entre dark/light via --ig-* CSS vars */
const VARIANT_STYLES: Record<HudBadgeVariant, string> = {
  default: 'bg-ig-panel-hover text-ig-fg border-ig-border-strong hud-badge-default',
  primary: 'bg-ig-accent-weak text-ig-accent border-ig-border-focus hud-badge-primary',
  success: 'bg-[color-mix(in_oklab,var(--ig-success)_14%,transparent)] text-ig-success border-[color-mix(in_oklab,var(--ig-success)_32%,transparent)] hud-badge-success',
  warning: 'bg-[color-mix(in_oklab,var(--ig-warning)_14%,transparent)] text-ig-warning border-[color-mix(in_oklab,var(--ig-warning)_32%,transparent)] hud-badge-warning',
  danger: 'bg-[color-mix(in_oklab,var(--ig-danger)_14%,transparent)] text-ig-danger border-[color-mix(in_oklab,var(--ig-danger)_32%,transparent)] hud-badge-danger',
  info: 'bg-[color-mix(in_oklab,var(--ig-info)_14%,transparent)] text-ig-info border-[color-mix(in_oklab,var(--ig-info)_32%,transparent)] hud-badge-info',
  neutral: 'bg-ig-panel text-ig-fg-muted border-ig-border hud-badge-neutral',
  outline: 'bg-transparent text-ig-fg border-ig-border-strong hud-badge-outline',
  subtle: 'bg-transparent text-ig-fg-muted border-transparent hud-badge-subtle',
};

const SIZE_STYLES = {
  sm: 'text-[10px] px-2 py-0.5',
  md: 'text-xs px-2.5 py-1',
};

export function HudBadge({
  children,
  variant = 'default',
  size = 'md',
  className,
  dot = false,
  dotColor,
}: HudBadgeProps) {
  const getDotColor = () => {
    if (dotColor) return dotColor;
    switch (variant) {
      case 'success': return 'bg-ig-success';
      case 'warning': return 'bg-ig-warning';
      case 'danger': return 'bg-ig-danger';
      case 'info': return 'bg-ig-info';
      case 'primary': return 'bg-ig-accent';
      default: return 'bg-ig-fg-muted';
    }
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md font-medium border',
        VARIANT_STYLES[variant],
        SIZE_STYLES[size],
        className
      )}
    >
      {dot && (
        <span className={cn('w-1.5 h-1.5 rounded-full', getDotColor())} />
      )}
      {children}
    </span>
  );
}
