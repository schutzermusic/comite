'use client';

import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface HudMetricProps {
    value: string | number;
    label?: string;
    delta?: number;
    prefix?: string;
    size?: 'sm' | 'md' | 'lg' | 'xl';
    className?: string;
    valueColor?: string;
}

const SIZE_STYLES = {
    sm: { value: 'text-base', label: 'text-[8px]', delta: 'text-[8px]' },
    md: { value: 'text-xl', label: 'text-[9px]', delta: 'text-[9px]' },
    lg: { value: 'text-2xl', label: 'text-[9px]', delta: 'text-[10px]' },
    xl: { value: 'text-[2rem]', label: 'text-[10px]', delta: 'text-[11px]' },
};

export function HudMetric({
    value,
    label,
    delta,
    prefix,
    size = 'md',
    className,
    valueColor,
}: HudMetricProps) {
    const s = SIZE_STYLES[size];
    const isPositive = delta !== undefined && delta >= 0;

    return (
        <div className={cn('space-y-0.5', className)}>
            {label && (
                <p className={cn(s.label, 'text-white/55 uppercase tracking-[0.12em] font-medium')}>
                    {label}
                </p>
            )}
            <div className="flex items-baseline gap-2">
                <span
                    className={cn(
                        s.value,
                        'font-bold tabular-nums tracking-[-0.025em] leading-none text-shadow-sm',
                        valueColor || 'text-white'
                    )}
                    style={{ textShadow: '0 0 18px rgba(125, 235, 255, 0.18)' }}
                >
                    {prefix && (
                        <span className="text-white/50 font-semibold">{prefix} </span>
                    )}
                    {value}
                </span>
                {delta !== undefined && (
                    <span
                        className={cn(
                            s.delta,
                            'font-semibold flex items-center gap-0.5',
                            isPositive ? 'text-emerald-400' : 'text-red-400'
                        )}
                    >
                        {isPositive ? (
                            <TrendingUp className="w-3 h-3" />
                        ) : (
                            <TrendingDown className="w-3 h-3" />
                        )}
                        {isPositive ? '+' : ''}
                        {delta}%
                    </span>
                )}
            </div>
        </div>
    );
}
