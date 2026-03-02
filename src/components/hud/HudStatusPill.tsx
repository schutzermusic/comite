'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export type HudStatusPillVariant =
  | 'active'
  | 'completed'
  | 'pending'
  | 'warning'
  | 'error'
  | 'neutral'
  | 'info'
  | 'critical'
  | 'at_risk';

export interface HudStatusPillProps {
  children: React.ReactNode;
  variant?: HudStatusPillVariant;
  size?: 'sm' | 'md';
  className?: string;
  pulse?: boolean;
}

const VARIANT_STYLES: Record<HudStatusPillVariant, string> = {
  active: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  completed: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/25',
  pending: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  warning: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  error: 'bg-red-500/15 text-red-300 border-red-500/25',
  neutral: 'bg-white/[0.06] text-white/70 border-white/[0.10]',
  info: 'bg-blue-500/15 text-blue-300 border-blue-500/25',
  critical: 'bg-red-500/20 text-red-300 border-red-500/30',
  at_risk: 'bg-orange-500/15 text-orange-300 border-orange-500/25',
};

const SIZE_STYLES = {
  sm: 'text-[10px] px-2 py-0.5',
  md: 'text-xs px-2.5 py-1',
};

export function HudStatusPill({
  children,
  variant = 'neutral',
  size = 'md',
  className,
  pulse = false,
}: HudStatusPillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium border',
        VARIANT_STYLES[variant],
        SIZE_STYLES[size],
        pulse && 'animate-pulse',
        className
      )}
    >
      {children}
    </span>
  );
}
