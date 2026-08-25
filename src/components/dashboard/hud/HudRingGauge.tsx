'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/contexts/ThemeContext';

export interface HudRingGaugeProps {
    value: number;
    max: number;
    label: string;
    size?: number;
    strokeWidth?: number;
    color?: string;
    trackColor?: string;
    className?: string;
    /** Side metrics displayed next to the ring */
    sideMetrics?: Array<{
        value: string | number;
        label: string;
        color?: string;
    }>;
}

/**
 * Cores neutras vindas do chamador não carregam informação — trocá-las pelo
 * token numérico é o que mantém o valor quase preto no light e claro no dark.
 * Tons semânticos (âmbar, vermelho) passam intactos.
 */
const NEUTRAL_METRIC_COLORS = new Set(['#fff', '#ffffff', '#94a3b8', '#64748b']);

function resolveMetricColor(color?: string): string {
    if (!color || NEUTRAL_METRIC_COLORS.has(color.toLowerCase())) {
        return 'var(--ig-fg-numeric)';
    }
    return color;
}

export function HudRingGauge({
    value,
    max,
    label,
    size = 90,
    strokeWidth = 6,
    color = '#84CC16',
    trackColor = 'rgba(132, 204, 22, 0.08)',
    className,
    sideMetrics,
}: HudRingGaugeProps) {
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const progress = Math.min(value / max, 1);
    const dashOffset = circumference * (1 - progress);
    const thresholdStops = [0.33, 0.66, 1];
    const { theme } = useTheme();
    const isLight = theme === 'light';

    const gradientId = `ring-${Math.random().toString(36).slice(2, 8)}`;

    return (
        <div className={cn('flex items-center gap-4', className)}>
            {/* Ring */}
            <div className="cr-ring-gauge relative" style={{ width: size, height: size }}>
                <svg width={size} height={size}>
                    <defs>
                        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0%" stopColor={color} />
                            <stop offset="100%" stopColor={isLight ? '#65A30D' : '#06b6d4'} />
                        </linearGradient>
                        {!isLight && (
                            <filter id={`glow-${gradientId}`}>
                                <feGaussianBlur stdDeviation="2" result="blur" />
                                <feMerge>
                                    <feMergeNode in="blur" />
                                    <feMergeNode in="SourceGraphic" />
                                </feMerge>
                            </filter>
                        )}
                    </defs>

                    {thresholdStops.map((stop, idx) => {
                        const arc = circumference * 0.28;
                        const segmentOffset = circumference * (1 - stop);
                        return (
                            <circle
                                key={`segment-${idx}`}
                                cx={size / 2}
                                cy={size / 2}
                                r={radius}
                                fill="none"
                                stroke={
                                    isLight
                                        ? (idx === 0 ? 'rgba(132,204,22,0.15)' : idx === 1 ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)')
                                        : (idx === 0 ? 'rgba(16,185,129,0.22)' : idx === 1 ? 'rgba(245,158,11,0.24)' : 'rgba(239,68,68,0.24)')
                                }
                                strokeWidth={strokeWidth}
                                strokeDasharray={`${arc} ${circumference - arc}`}
                                strokeDashoffset={segmentOffset}
                            />
                        );
                    })}

                    {/* Track ring */}
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        fill="none"
                        stroke={isLight ? 'rgba(0, 0, 0, 0.06)' : trackColor}
                        strokeWidth={strokeWidth}
                    />
                    {/* Progress ring */}
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        fill="none"
                        stroke={`url(#${gradientId})`}
                        strokeWidth={strokeWidth}
                        strokeLinecap="round"
                        strokeDasharray={circumference}
                        strokeDashoffset={dashOffset}
                        filter={!isLight ? `url(#glow-${gradientId})` : undefined}
                        style={{
                            transition: 'stroke-dashoffset 0.8s cubic-bezier(0.22, 1, 0.36, 1)',
                        }}
                    />

                    {/* Progress endpoint dot */}
                    {(() => {
                        const endAngle = (-90 + progress * 360) * (Math.PI / 180);
                        return (
                            <circle
                                cx={size / 2 + Math.cos(endAngle) * radius}
                                cy={size / 2 + Math.sin(endAngle) * radius}
                                r="3"
                                fill={isLight ? color : 'white'}
                                opacity="0.85"
                                filter={!isLight ? `url(#glow-${gradientId})` : undefined}
                            />
                        );
                    })()}
                </svg>
                {/* Center label */}
                <div className="cr-ring-gauge-label">
                    <span
                        className="text-[2rem] font-bold tabular-nums tracking-tight leading-none text-ig-fg-numeric"
                        style={isLight ? undefined : { textShadow: '0 0 16px rgba(124, 232, 253, 0.24)' }}
                    >
                        {value}
                    </span>
                    <span className={cn(
                        'text-[7px] uppercase tracking-[0.14em] mt-0.5',
                        isLight ? 'text-[#6B7280]' : 'text-white/58'
                    )}>
                        {label}
                    </span>
                </div>
            </div>

            {/* Side metrics */}
            {sideMetrics && sideMetrics.length > 0 && (
                <div className="space-y-2.5 flex-1 min-w-0">
                    {sideMetrics.map((m, i) => (
                        <div key={i}>
                            <p
                                className="text-xl font-bold tabular-nums leading-none"
                                style={{ color: resolveMetricColor(m.color) }}
                            >
                                {m.value}
                            </p>
                            <p className={cn('text-[8px] mt-0.5', isLight ? 'text-[#6B7280]' : 'text-white/40')}>{m.label}</p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
