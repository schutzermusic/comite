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

/* Dark-mode default styles + semantic class hooks for light mode overrides */
const VARIANT_STYLES: Record<HudBadgeVariant, string> = {
  default: 'bg-white/[0.08] text-white/80 border-white/[0.10] hud-badge-default',
  primary: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/25 hud-badge-primary',
  success: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25 hud-badge-success',
  warning: 'bg-amber-500/15 text-amber-300 border-amber-500/25 hud-badge-warning',
  danger: 'bg-red-500/15 text-red-300 border-red-500/25 hud-badge-danger',
  info: 'bg-blue-500/15 text-blue-300 border-blue-500/25 hud-badge-info',
  neutral: 'bg-white/[0.05] text-white/60 border-white/[0.08] hud-badge-neutral',
  outline: 'bg-transparent text-white/70 border-white/[0.15] hud-badge-outline',
  subtle: 'bg-transparent text-white/50 border-transparent hud-badge-subtle',
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
      case 'success': return 'bg-emerald-400 light:bg-emerald-600';
      case 'warning': return 'bg-amber-400 light:bg-amber-600';
      case 'danger': return 'bg-red-400 light:bg-red-600';
      case 'info': return 'bg-blue-400 light:bg-blue-600';
      case 'primary': return 'bg-cyan-400 light:bg-cyan-600';
      default: return 'bg-white/50 light:bg-black/30';
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
