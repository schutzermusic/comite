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
  default: 'text-white',
  success: 'text-emerald-400',
  warning: 'text-amber-400',
  danger: 'text-red-400',
  info: 'text-cyan-400',
};

const ICON_VARIANT_BG = {
  default: 'from-cyan-500/10 to-emerald-500/10 border-cyan-500/20 text-cyan-300',
  success: 'from-emerald-500/10 to-green-500/10 border-emerald-500/20 text-emerald-300',
  warning: 'from-amber-500/10 to-orange-500/10 border-amber-500/20 text-amber-300',
  danger: 'from-red-500/10 to-rose-500/10 border-red-500/20 text-red-300',
  info: 'from-cyan-500/10 to-blue-500/10 border-cyan-500/20 text-cyan-300',
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
            'flex items-center justify-center rounded-xl bg-gradient-to-br border shrink-0',
            s.iconBox,
            ICON_VARIANT_BG[variant]
          )}
        >
          <span className={s.icon}>{icon}</span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={cn(s.label, 'text-white/50 uppercase tracking-wider font-medium mb-0.5')}>
          {label}
        </p>

        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              s.value,
              'font-bold tabular-nums tracking-tight leading-none',
              VARIANT_COLORS[variant]
            )}
            style={{ textShadow: variant === 'default' ? '0 0 20px rgba(125,235,255,0.15)' : undefined }}
          >
            {prefix && <span className="text-white/50 font-semibold mr-1">{prefix}</span>}
            {value}
            {suffix && <span className="text-white/50 font-semibold ml-1">{suffix}</span>}
          </span>

          {/* Delta indicator */}
          {delta !== undefined && (
            <span
              className={cn(
                s.delta,
                'font-semibold flex items-center gap-0.5 px-1.5 py-0.5 rounded-full',
                isPositive && 'text-emerald-400 bg-emerald-500/10',
                isNegative && 'text-red-400 bg-red-500/10',
                isNeutral && 'text-white/50 bg-white/5'
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
          <p className="text-[10px] text-white/40 mt-0.5">{deltaLabel}</p>
        )}
      </div>
    </div>
  );
}
