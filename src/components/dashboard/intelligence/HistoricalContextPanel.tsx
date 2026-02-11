'use client';

import React, { useRef, useEffect, useState } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface HistoricalContextPanelProps {
    title?: string;
    source?: string;
    mainMetric: {
        value: string;
        trend?: number;
        trendLabel?: string;
    };
    secondaryMetrics?: {
        label: string;
        value: string;
        trend?: number;
    }[];
    systemMessage?: string;
    sparklineData?: number[];
    className?: string;
}

export function HistoricalContextPanel({
    title = 'HISTORICO',
    source = 'PORPOLID',
    mainMetric,
    secondaryMetrics = [],
    systemMessage,
    sparklineData = [40, 42, 45, 48, 52, 55, 58, 62],
    className = '',
}: HistoricalContextPanelProps) {
    // Mini sparkline calculation
    const maxValue = Math.max(...sparklineData);
    const minValue = Math.min(...sparklineData);
    const range = maxValue - minValue || 1;

    const points = sparklineData.map((value, i) => {
        const x = (i / (sparklineData.length - 1)) * 80;
        const y = 24 - ((value - minValue) / range) * 20;
        return `${x},${y}`;
    }).join(' ');

    return (
        <div className={`intel-panel p-4 relative overflow-hidden ${className}`}>
            {/* Globe background (CSS-based atmospheric effect) */}
            <div className="absolute inset-0 pointer-events-none">
                {/* Earth gradient simulation */}
                <div
                    className="absolute bottom-0 right-0 w-48 h-48 rounded-full opacity-30"
                    style={{
                        background: 'radial-gradient(ellipse at 60% 60%, rgba(20, 184, 166, 0.15) 0%, rgba(20, 120, 100, 0.1) 40%, transparent 70%)',
                        transform: 'translate(30%, 30%)',
                    }}
                />
                {/* Atmosphere glow */}
                <div
                    className="absolute bottom-0 right-0 w-56 h-56 rounded-full opacity-20"
                    style={{
                        background: 'radial-gradient(ellipse at 50% 50%, rgba(20, 184, 166, 0.1) 0%, transparent 60%)',
                        transform: 'translate(35%, 35%)',
                        filter: 'blur(8px)',
                    }}
                />
            </div>

            {/* Content */}
            <div className="relative z-10">
                {/* Header */}
                <div className="flex items-center gap-2 mb-3">
                    <h2 className="intel-text-label">{title}</h2>
                    <span className="text-[10px] text-intel-accent-teal uppercase tracking-wider">● {source}</span>
                </div>

                {/* Main metric */}
                <div className="mb-3">
                    <div className="flex items-baseline gap-2">
                        <span className="intel-text-metric text-2xl">{mainMetric.value}</span>
                        {mainMetric.trend !== undefined && (
                            <span className={`flex items-center gap-1 text-sm ${mainMetric.trend >= 0 ? 'text-intel-accent-teal' : 'text-intel-accent-red'}`}>
                                {mainMetric.trend >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                                {Math.abs(mainMetric.trend)}%
                            </span>
                        )}
                    </div>
                </div>

                {/* Secondary metrics row */}
                {secondaryMetrics.length > 0 && (
                    <div className="flex items-center gap-4 mb-4">
                        {secondaryMetrics.map((metric, i) => (
                            <React.Fragment key={metric.label}>
                                {i > 0 && <div className="intel-divider-vertical h-4" />}
                                <div className="flex items-center gap-2">
                                    <span className={`text-xs ${metric.trend !== undefined && metric.trend >= 0 ? 'text-intel-accent-teal' : 'text-intel-accent-red'}`}>
                                        {metric.trend !== undefined && (metric.trend >= 0 ? '+' : '')}{metric.value}
                                    </span>
                                    {metric.trend !== undefined && (
                                        <span className={`text-xs ${metric.trend >= 0 ? 'text-intel-accent-teal' : 'text-intel-accent-red'}`}>
                                            ➚ {Math.abs(metric.trend)}%
                                        </span>
                                    )}
                                </div>
                            </React.Fragment>
                        ))}
                    </div>
                )}

                {/* Mini sparkline */}
                <div className="mb-4">
                    <svg width="80" height="24" viewBox="0 0 80 24" className="opacity-80">
                        <polyline
                            points={points}
                            fill="none"
                            stroke="#14B8A6"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                    <div className="flex justify-between text-[9px] text-intel-text-muted mt-0.5" style={{ width: '80px' }}>
                        <span>Jan</span>
                        <span>Jun</span>
                        <span>Set</span>
                    </div>
                </div>

                {/* System message */}
                {systemMessage && (
                    <p className="intel-text-system text-xs max-w-[180px]">
                        {systemMessage}
                    </p>
                )}
            </div>
        </div>
    );
}
