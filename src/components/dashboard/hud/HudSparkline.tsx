'use client';

import React from 'react';
import { cn } from '@/lib/utils';

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
    if (!values || values.length === 0) return null;

    if (variant === 'line') {
        const domainValues = [...values, ...(forecastValues || []), ...(bandLower || []), ...(bandUpper || [])];
        const max = Math.max(...domainValues);
        const min = Math.min(...domainValues);
        const range = max - min || 1;
        const w = width || values.length * 8;
        const padding = 2;

        const points = values.map((v, i) => {
            const x = padding + (i / (values.length - 1)) * (w - padding * 2);
            const y = padding + (1 - (v - min) / range) * (height - padding * 2);
            return `${x},${y}`;
        });
        const forecastPoints = forecastValues?.map((v, i) => {
            const x = padding + (i / (values.length - 1)) * (w - padding * 2);
            const y = padding + (1 - (v - min) / range) * (height - padding * 2);
            return `${x},${y}`;
        });
        const bandTopPoints = bandUpper?.map((v, i) => {
            const x = padding + (i / (values.length - 1)) * (w - padding * 2);
            const y = padding + (1 - (v - min) / range) * (height - padding * 2);
            return `${x},${y}`;
        });
        const bandBottomPoints = bandLower?.map((v, i) => {
            const x = padding + (i / (values.length - 1)) * (w - padding * 2);
            const y = padding + (1 - (v - min) / range) * (height - padding * 2);
            return `${x},${y}`;
        });

        const areaPoints = [
            `${padding},${height}`,
            ...points,
            `${w - padding},${height}`,
        ].join(' ');
        const bandAreaPoints = bandTopPoints && bandBottomPoints
            ? [...bandTopPoints, ...[...bandBottomPoints].reverse()].join(' ')
            : null;

        const gradientId = `spark-${Math.random().toString(36).slice(2, 8)}`;

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
    const max = Math.max(...values);
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
                        height: `${Math.max((v / max) * 100, 8)}%`,
                        background: color,
                        opacity: i === values.length - 1 ? 1 : 0.5,
                    }}
                />
            ))}
        </div>
    );
}
