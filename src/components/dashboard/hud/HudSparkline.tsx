'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { barHeightPct, sparklineGeometry, svgSafeId } from './geometry';

export interface HudSparklineProps {
    values: number[];
    forecastValues?: number[];
    bandLower?: number[];
    bandUpper?: number[];
    color?: string;
    height?: number;
    width?: number;
    className?: string;
    /** Use SVG line vs bar chart */
    variant?: 'line' | 'bar';
}

export function HudSparkline({
    values,
    forecastValues,
    bandLower,
    bandUpper,
    color = '#10b981',
    height = 28,
    width,
    className,
    variant = 'bar',
}: HudSparklineProps) {
    const reactId = React.useId();
    if (!values || values.length === 0) return null;

    if (variant === 'line') {
        const w = width || values.length * 8;
        const padding = 2;
        // Menos de dois pontos finitos não é tendência: nada é desenhado.
        const geo = sparklineGeometry({ values, forecast: forecastValues, bandLower, bandUpper, width: w, height, padding });
        if (!geo) return null;
        const points = geo.points;
        const forecastPoints = geo.forecast ?? undefined;
        const bandTopPoints = geo.bandTop ?? undefined;
        const bandBottomPoints = geo.bandBottom ?? undefined;

        const areaPoints = [
            `${padding},${height}`,
            ...points,
            `${w - padding},${height}`,
        ].join(' ');
        const bandAreaPoints = bandTopPoints && bandBottomPoints
            ? [...bandTopPoints, ...[...bandBottomPoints].reverse()].join(' ')
            : null;

        const gradientId = svgSafeId('spark', reactId);

        const glowId = `glow-${gradientId}`;

        return (
            <svg
                width={w}
                height={height}
                className={cn('flex-shrink-0', className)}
                viewBox={`0 0 ${w} ${height}`}
            >
                <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity="0.45" />
                        <stop offset="60%" stopColor={color} stopOpacity="0.08" />
                        <stop offset="100%" stopColor={color} stopOpacity="0.01" />
                    </linearGradient>
                    <filter id={glowId}>
                        <feGaussianBlur stdDeviation="2" result="blur" />
                        <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                </defs>
                <polygon
                    points={areaPoints}
                    fill={`url(#${gradientId})`}
                />
                {bandAreaPoints && (
                    <polygon
                        points={bandAreaPoints}
                        fill="rgba(132, 218, 236, 0.12)"
                        stroke="rgba(132, 218, 236, 0.2)"
                        strokeWidth="0.6"
                    />
                )}
                <polyline
                    points={points.join(' ')}
                    fill="none"
                    stroke={color}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    filter={`url(#${glowId})`}
                    style={{ filter: `drop-shadow(0 0 4px ${color})` }}
                />
                {forecastPoints && (
                    <polyline
                        points={forecastPoints.join(' ')}
                        fill="none"
                        stroke="rgba(170, 226, 241, 0.82)"
                        strokeDasharray="2.4 2.2"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                )}
            </svg>
        );
    }

    // Bar variant (default)
    const max = Math.max(0, ...values.filter(Number.isFinite));
    return (
        <div
            className={cn('cr-sparkline', className)}
            style={{ height }}
        >
            {values.map((v, i) => (
                <div
                    key={i}
                    className="cr-sparkline-bar"
                    style={{
                        height: `${barHeightPct(v, max)}%`,
                        background: color,
                        opacity: i === values.length - 1 ? 1 : 0.5,
                    }}
                />
            ))}
        </div>
    );
}
