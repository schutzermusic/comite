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

const VARIANT_STYLES: Record<HudBadgeVariant, string> = {
  default: 'bg-white/[0.08] text-white/80 border-white/[0.10]',
  primary: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/25',
  success: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  warning: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  danger: 'bg-red-500/15 text-red-300 border-red-500/25',
  info: 'bg-blue-500/15 text-blue-300 border-blue-500/25',
  neutral: 'bg-white/[0.05] text-white/60 border-white/[0.08]',
  outline: 'bg-transparent text-white/70 border-white/[0.15]',
  subtle: 'bg-transparent text-white/50 border-transparent',
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
      case 'success': return 'bg-emerald-400';
      case 'warning': return 'bg-amber-400';
      case 'danger': return 'bg-red-400';
      case 'info': return 'bg-blue-400';
      case 'primary': return 'bg-cyan-400';
      default: return 'bg-white/50';
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
