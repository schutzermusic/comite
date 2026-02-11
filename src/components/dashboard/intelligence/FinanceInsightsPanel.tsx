'use client';

import React from 'react';
import { TrendingUp, TrendingDown, AlertCircle } from 'lucide-react';

interface FinanceInsightsPanelProps {
    receita: {
        value: string;
        trend?: number;
    };
    badi: {
        value: string;
        trend?: number;
    };
    sparklineData?: number[];
    insights: string[];
    className?: string;
}

export function FinanceInsightsPanel({
    receita,
    badi,
    sparklineData = [40, 45, 42, 48, 52, 55, 50, 58, 62, 65, 60, 68],
    insights,
    className = '',
}: FinanceInsightsPanelProps) {
    // Mini area chart
    const maxValue = Math.max(...sparklineData);
    const minValue = Math.min(...sparklineData);
    const range = maxValue - minValue || 1;

    const points = sparklineData.map((value, i) => {
        const x = (i / (sparklineData.length - 1)) * 100;
        const y = 100 - ((value - minValue) / range) * 80 - 10;
        return `${x},${y}`;
    }).join(' ');

    const areaPath = `M0,100 L0,${100 - ((sparklineData[0] - minValue) / range) * 80 - 10} ${points.split(' ').map((p, i) => `L${p}`).join(' ')} L100,100 Z`;

    return (
        <div className={`intel-panel p-4 ${className}`}>
            {/* Header */}
            <h2 className="intel-text-label mb-3">FINANÇAS</h2>

            {/* Mini Chart */}
            <div className="relative h-16 mb-4">
                <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible">
                    {/* Area fill */}
                    <path
                        d={areaPath}
                        fill="url(#financeGradient)"
                        opacity="0.3"
                    />
                    {/* Line */}
                    <polyline
                        points={points}
                        fill="none"
                        stroke="#14B8A6"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                    {/* Gradient definition */}
                    <defs>
                        <linearGradient id="financeGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#14B8A6" />
                            <stop offset="100%" stopColor="transparent" />
                        </linearGradient>
                    </defs>
                </svg>

                {/* Value badge overlay */}
                <div className="absolute top-0 right-0 px-2 py-1 rounded bg-intel-bg-elevated text-xs">
                    <span className="text-intel-text-muted">+ 14.8 mil lido</span>
                </div>

                {/* Chart labels */}
                <div className="absolute bottom-0 left-0 right-0 flex justify-between text-[9px] text-intel-text-muted">
                    <span>Jan</span>
                    <span>Abr</span>
                    <span>Jun</span>
                    <span>Nov</span>
                </div>
            </div>

            {/* Metrics row */}
            <div className="flex items-center gap-4 mb-4">
                <div>
                    <span className="text-xs text-intel-text-muted">Receita</span>
                    <div className="flex items-center gap-1.5">
                        <span className="intel-text-metric text-lg">{receita.value}</span>
                        {receita.trend !== undefined && receita.trend > 0 && (
                            <TrendingUp className="w-3.5 h-3.5 text-intel-accent-teal" />
                        )}
                    </div>
                </div>
                <div className="intel-divider-vertical h-8" />
                <div>
                    <span className="text-xs text-intel-text-muted">BaDI</span>
                    <div className="flex items-center gap-1.5">
                        <span className="intel-text-metric text-lg">{badi.value}</span>
                        {badi.trend !== undefined && badi.trend < 0 && (
                            <TrendingDown className="w-3.5 h-3.5 text-intel-accent-red" />
                        )}
                    </div>
                </div>
            </div>

            {/* Insights bullets */}
            <div className="space-y-2">
                {insights.slice(0, 2).map((insight, i) => (
                    <div key={i} className="flex items-start gap-2">
                        <span className="w-1 h-1 rounded-full bg-intel-accent-teal mt-2 flex-shrink-0" />
                        <p className="intel-text-system text-xs">{insight}</p>
                    </div>
                ))}
            </div>
        </div>
    );
}
