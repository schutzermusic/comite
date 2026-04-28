'use client';

import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

export type HudKpiVariant = 'default' | 'success' | 'warning' | 'danger' | 'info';
export type HudKpiSize = 'sm' | 'md' | 'lg' | 'xl';

export interface HudKpiProps {
  value: string | number;
  label: string;
  delta?: number;
  /** Pre-formatted delta string (overrides numeric delta presentation, e.g. "+8.7%" or "↓ 3.2%"). */
  deltaText?: string;
  /** Color tone for deltaText when provided. */
  deltaTone?: 'success' | 'danger' | 'neutral';
  deltaLabel?: string;
  prefix?: string;
  suffix?: string;
  size?: HudKpiSize;
  variant?: HudKpiVariant;
  /** When true, the value picks up the variant color instead of the default metal-accent. */
  tintValue?: boolean;
  icon?: React.ReactNode;
  /** Compact horizontal alignment used in connected strips. */
  align?: 'left' | 'center';
  className?: string;
}

const SIZE_STYLES: Record<HudKpiSize, {
  value: string;
  label: string;
  delta: string;
  iconBox: string;
  icon: string;
  gap: string;
}> = {
  sm: {
    value: 'text-[1.125rem] leading-none',
    label: 'text-[10px]',
    delta: 'text-[9px]',
    iconBox: 'w-8 h-8',
    icon: 'w-4 h-4',
    gap: 'gap-2.5',
  },
  md: {
    value: 'text-ig-kpi-md',
    label: 'text-[10.5px]',
    delta: 'text-[10px]',
    iconBox: 'w-9 h-9',
    icon: 'w-[18px] h-[18px]',
    gap: 'gap-3',
  },
  lg: {
    value: 'text-ig-kpi-lg',
    label: 'text-[11px]',
    delta: 'text-[11px]',
    iconBox: 'w-11 h-11',
    icon: 'w-5 h-5',
    gap: 'gap-3',
  },
  xl: {
    value: 'text-ig-kpi-xl',
    label: 'text-xs',
    delta: 'text-xs',
    iconBox: 'w-12 h-12',
    icon: 'w-6 h-6',
    gap: 'gap-3.5',
  },
};

const ICON_VARIANT_BG: Record<HudKpiVariant, string> = {
  default: 'bg-ig-accent-weak border-ig-border-focus text-ig-accent',
  success:
    'bg-[color-mix(in_oklab,var(--ig-success)_12%,transparent)] border-[color-mix(in_oklab,var(--ig-success)_28%,transparent)] text-ig-success',
  warning:
    'bg-[color-mix(in_oklab,var(--ig-warning)_12%,transparent)] border-[color-mix(in_oklab,var(--ig-warning)_28%,transparent)] text-ig-warning',
  danger:
    'bg-[color-mix(in_oklab,var(--ig-danger)_12%,transparent)] border-[color-mix(in_oklab,var(--ig-danger)_28%,transparent)] text-ig-danger',
  info:
    'bg-[color-mix(in_oklab,var(--ig-info)_12%,transparent)] border-[color-mix(in_oklab,var(--ig-info)_28%,transparent)] text-ig-info',
};

const VALUE_TINT: Record<HudKpiVariant, string> = {
  default: 'ig-text-metal-accent hud-kpi-value-default',
  success: 'text-ig-success hud-kpi-value-success',
  warning: 'text-ig-warning hud-kpi-value-warning',
  danger: 'text-ig-danger hud-kpi-value-danger',
  info: 'text-ig-info hud-kpi-value-info',
};

export function HudKpi({
  value,
  label,
  delta,
  deltaText,
  deltaTone,
  deltaLabel,
  prefix,
  suffix,
  size = 'md',
  variant = 'default',
  tintValue = false,
  icon,
  align = 'left',
  className,
}: HudKpiProps) {
  const s = SIZE_STYLES[size];
  const isPositive = delta !== undefined && delta > 0;
  const isNegative = delta !== undefined && delta < 0;
  const isNeutral = delta !== undefined && delta === 0;

  const valueClass = tintValue ? VALUE_TINT[variant] : VALUE_TINT.default;

  const isCenter = align === 'center';

  return (
    <div
      className={cn(
        'flex min-w-0',
        isCenter ? 'flex-col items-center text-center' : 'items-center',
        s.gap,
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            'flex items-center justify-center rounded-xl border shrink-0',
            s.iconBox,
            ICON_VARIANT_BG[variant],
          )}
        >
          <span className={cn(s.icon, 'flex items-center justify-center')}>{icon}</span>
        </div>
      )}

      <div className={cn('min-w-0', isCenter ? 'flex flex-col items-center' : 'flex-1')}>
        <p
          className={cn(
            s.label,
            'hud-kpi-label text-ig-fg-muted uppercase font-medium tracking-[0.08em] mb-1 truncate',
            isCenter && 'tracking-[0.1em]',
          )}
        >
          {label}
        </p>

        <div
          className={cn(
            'flex items-baseline gap-2 min-w-0',
            isCenter && 'justify-center flex-wrap gap-x-1.5 gap-y-0.5',
          )}
        >
          <span className={cn(s.value, 'ig-tabular font-semibold leading-none', valueClass)}>
            {prefix && (
              <span className="hud-kpi-prefix text-ig-fg-muted font-semibold mr-1">{prefix}</span>
            )}
            {value}
            {suffix && (
              <span className="hud-kpi-suffix text-ig-fg-muted font-semibold ml-1">{suffix}</span>
            )}
          </span>

          {deltaText !== undefined ? (
            <span
              className={cn(
                s.delta,
                'font-semibold tabular-nums',
                deltaTone === 'success' && 'text-ig-success',
                deltaTone === 'danger' && 'text-ig-danger',
                (deltaTone === 'neutral' || !deltaTone) && 'text-ig-fg-muted',
              )}
            >
              {deltaText}
            </span>
          ) : (
            delta !== undefined && (
              <span
                className={cn(
                  s.delta,
                  'font-semibold flex items-center gap-0.5 px-1.5 py-0.5 rounded-full',
                  isPositive &&
                    'text-ig-success bg-[color-mix(in_oklab,var(--ig-success)_14%,transparent)]',
                  isNegative &&
                    'text-ig-danger bg-[color-mix(in_oklab,var(--ig-danger)_14%,transparent)]',
                  isNeutral && 'hud-kpi-delta-neutral text-ig-fg-muted bg-ig-panel',
                )}
              >
                {isPositive && <TrendingUp className="w-3 h-3" />}
                {isNegative && <TrendingDown className="w-3 h-3" />}
                {isNeutral && <Minus className="w-3 h-3" />}
                {isPositive ? '+' : ''}
                {delta}%
              </span>
            )
          )}
        </div>

        {deltaLabel && (
          <p
            className={cn(
              'text-[10px] hud-text-muted mt-1 truncate',
              isCenter && 'text-center',
            )}
          >
            {deltaLabel}
          </p>
        )}
      </div>
    </div>
  );
}
