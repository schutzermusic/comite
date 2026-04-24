'use client';

import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface HudKpiProps {
  value: string | number;
  label: string;
  delta?: number;
  deltaLabel?: string;
  prefix?: string;
  suffix?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  icon?: React.ReactNode;
  className?: string;
}

const SIZE_STYLES = {
  sm: {
    value: 'text-lg',
    label: 'text-[10px]',
    delta: 'text-[9px]',
    iconBox: 'w-8 h-8',
    icon: 'w-4 h-4',
  },
  md: {
    value: 'text-2xl',
    label: 'text-[11px]',
    delta: 'text-[10px]',
    iconBox: 'w-10 h-10',
    icon: 'w-5 h-5',
  },
  lg: {
    value: 'text-3xl',
    label: 'text-xs',
    delta: 'text-[11px]',
    iconBox: 'w-12 h-12',
    icon: 'w-6 h-6',
  },
  xl: {
    value: 'text-4xl',
    label: 'text-xs',
    delta: 'text-xs',
    iconBox: 'w-14 h-14',
    icon: 'w-7 h-7',
  },
};

const VARIANT_COLORS = {
  default: 'text-ig-fg-strong hud-kpi-value-default',
  success: 'text-ig-success hud-kpi-value-success',
  warning: 'text-ig-warning hud-kpi-value-warning',
  danger: 'text-ig-danger hud-kpi-value-danger',
  info: 'text-ig-accent hud-kpi-value-info',
};

const ICON_VARIANT_BG = {
  default: 'bg-ig-accent-weak border-ig-border-focus text-ig-accent',
  success: 'bg-[color-mix(in_oklab,var(--ig-success)_12%,transparent)] border-[color-mix(in_oklab,var(--ig-success)_28%,transparent)] text-ig-success',
  warning: 'bg-[color-mix(in_oklab,var(--ig-warning)_12%,transparent)] border-[color-mix(in_oklab,var(--ig-warning)_28%,transparent)] text-ig-warning',
  danger: 'bg-[color-mix(in_oklab,var(--ig-danger)_12%,transparent)] border-[color-mix(in_oklab,var(--ig-danger)_28%,transparent)] text-ig-danger',
  info: 'bg-[color-mix(in_oklab,var(--ig-info)_12%,transparent)] border-[color-mix(in_oklab,var(--ig-info)_28%,transparent)] text-ig-info',
};

export function HudKpi({
  value,
  label,
  delta,
  deltaLabel,
  prefix,
  suffix,
  size = 'md',
  variant = 'default',
  icon,
  className,
}: HudKpiProps) {
  const s = SIZE_STYLES[size];
  const isPositive = delta !== undefined && delta > 0;
  const isNegative = delta !== undefined && delta < 0;
  const isNeutral = delta !== undefined && delta === 0;

  return (
    <div className={cn('flex items-center gap-3', className)}>
      {/* Icon */}
      {icon && (
        <div
          className={cn(
            'flex items-center justify-center rounded-xl border shrink-0',
            s.iconBox,
            ICON_VARIANT_BG[variant]
          )}
        >
          <span className={s.icon}>{icon}</span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={cn(s.label, 'hud-kpi-label text-ig-fg-muted uppercase tracking-wider font-medium mb-0.5')}>
          {label}
        </p>

        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              s.value,
              'font-bold tabular-nums tracking-tight leading-none',
              VARIANT_COLORS[variant]
            )}
          >
            {prefix && <span className="hud-kpi-prefix text-ig-fg-muted font-semibold mr-1">{prefix}</span>}
            {value}
            {suffix && <span className="hud-kpi-suffix text-ig-fg-muted font-semibold ml-1">{suffix}</span>}
          </span>

          {/* Delta indicator */}
          {delta !== undefined && (
            <span
              className={cn(
                s.delta,
                'font-semibold flex items-center gap-0.5 px-1.5 py-0.5 rounded-full',
                isPositive && 'text-ig-success bg-[color-mix(in_oklab,var(--ig-success)_14%,transparent)]',
                isNegative && 'text-ig-danger bg-[color-mix(in_oklab,var(--ig-danger)_14%,transparent)]',
                isNeutral && 'hud-kpi-delta-neutral text-ig-fg-muted bg-ig-panel'
              )}
            >
              {isPositive && <TrendingUp className="w-3 h-3" />}
              {isNegative && <TrendingDown className="w-3 h-3" />}
              {isNeutral && <Minus className="w-3 h-3" />}
              {isPositive ? '+' : ''}
              {delta}%
            </span>
          )}
        </div>

        {/* Delta label */}
        {deltaLabel && (
          <p className="text-[10px] hud-text-muted mt-0.5">{deltaLabel}</p>
        )}
      </div>
    </div>
  );
}
