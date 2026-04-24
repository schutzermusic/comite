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
  active: 'bg-[color-mix(in_oklab,var(--ig-success)_14%,transparent)] text-ig-success border-[color-mix(in_oklab,var(--ig-success)_32%,transparent)] hud-status-pill-active',
  completed: 'bg-ig-accent-weak text-ig-accent border-ig-border-focus hud-status-pill-completed',
  pending: 'bg-[color-mix(in_oklab,var(--ig-warning)_14%,transparent)] text-ig-warning border-[color-mix(in_oklab,var(--ig-warning)_32%,transparent)] hud-status-pill-pending',
  warning: 'bg-[color-mix(in_oklab,var(--ig-warning)_14%,transparent)] text-ig-warning border-[color-mix(in_oklab,var(--ig-warning)_32%,transparent)] hud-status-pill-warning',
  error: 'bg-[color-mix(in_oklab,var(--ig-danger)_14%,transparent)] text-ig-danger border-[color-mix(in_oklab,var(--ig-danger)_32%,transparent)] hud-status-pill-error',
  neutral: 'bg-ig-panel-hover text-ig-fg-muted border-ig-border-strong hud-status-pill-neutral',
  info: 'bg-[color-mix(in_oklab,var(--ig-info)_14%,transparent)] text-ig-info border-[color-mix(in_oklab,var(--ig-info)_32%,transparent)] hud-status-pill-info',
  critical: 'bg-[color-mix(in_oklab,var(--ig-danger)_20%,transparent)] text-ig-danger border-[color-mix(in_oklab,var(--ig-danger)_40%,transparent)] hud-status-pill-critical',
  at_risk: 'bg-[color-mix(in_oklab,var(--ig-warning)_14%,transparent)] text-ig-warning border-[color-mix(in_oklab,var(--ig-warning)_32%,transparent)] hud-status-pill-at_risk',
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
