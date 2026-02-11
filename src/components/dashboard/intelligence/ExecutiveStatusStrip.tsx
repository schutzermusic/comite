'use client';

import React from 'react';
import { AlertCircle, AlertTriangle, Clock, TrendingUp } from 'lucide-react';

interface AnomalyItem {
    id: string;
    text: string;
    severity: 'critical' | 'high' | 'medium';
    icon?: React.ReactNode;
}

interface ExecutiveStatusStripProps {
    title?: string;
    statusLabel: string;
    statusTrend: string;
    statusDescription: string;
    anomalies: AnomalyItem[];
    lastUpdate: string;
    isLive?: boolean;
    className?: string;
}

export function ExecutiveStatusStrip({
    title = 'ESTADO ATUAL DA GOVERNANÇA',
    statusLabel,
    statusTrend,
    statusDescription,
    anomalies,
    lastUpdate,
    isLive = true,
    className = '',
}: ExecutiveStatusStripProps) {
    const getSeverityIcon = (severity: AnomalyItem['severity']) => {
        switch (severity) {
            case 'critical':
                return <AlertCircle className="w-3.5 h-3.5 text-intel-accent-red" />;
            case 'high':
                return <AlertTriangle className="w-3.5 h-3.5 text-intel-accent-amber" />;
            default:
                return <AlertCircle className="w-3.5 h-3.5 text-intel-accent-teal" />;
        }
    };

    const getSeverityColor = (severity: AnomalyItem['severity']) => {
        switch (severity) {
            case 'critical':
                return 'text-intel-accent-red';
            case 'high':
                return 'text-intel-accent-amber';
            default:
                return 'text-intel-text-secondary';
        }
    };

    return (
        <div className={`intel-panel intel-beam-line p-5 ${className}`}>
            {/* Top row: Title */}
            <div className="flex items-center justify-between mb-4">
                <h2 className="intel-text-label">{title}</h2>

                {/* Right side controls */}
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 text-intel-text-muted">
                        <span className="text-xs">Última atualização</span>
                        <span className="text-xs font-medium text-intel-text-secondary">{lastUpdate}</span>
                    </div>

                    {isLive && (
                        <div className="intel-status-live">
                            AO VIVO
                        </div>
                    )}

                    {/* Minimal action dots */}
                    <div className="flex gap-1.5 ml-2">
                        <button className="w-6 h-6 rounded-full bg-intel-bg-elevated border border-intel-border-subtle flex items-center justify-center hover:border-intel-border-DEFAULT transition-colors">
                            <div className="w-1 h-1 rounded-full bg-intel-text-muted" />
                        </button>
                        <button className="w-6 h-6 rounded-full bg-intel-bg-elevated border border-intel-border-subtle flex items-center justify-center hover:border-intel-border-DEFAULT transition-colors">
                            <div className="flex gap-0.5">
                                <div className="w-1 h-1 rounded-full bg-intel-text-muted" />
                                <div className="w-1 h-1 rounded-full bg-intel-text-muted" />
                                <div className="w-1 h-1 rounded-full bg-intel-text-muted" />
                            </div>
                        </button>
                    </div>
                </div>
            </div>

            {/* Main content row */}
            <div className="flex items-start justify-between gap-8">
                {/* Left: Main status */}
                <div className="flex-1">
                    <div className="flex items-baseline gap-3 mb-2">
                        <span className="intel-text-metric intel-text-metric-xl">{statusLabel}</span>
                        <span className="flex items-center gap-1 text-intel-accent-teal text-lg font-medium">
                            <TrendingUp className="w-4 h-4" />
                            {statusTrend}
                        </span>
                    </div>
                    <p className="intel-text-system max-w-md">
                        {statusDescription}
                    </p>
                </div>

                {/* Right: Anomaly bullets */}
                <div className="flex-shrink-0 space-y-2">
                    {anomalies.slice(0, 3).map((anomaly) => (
                        <div
                            key={anomaly.id}
                            className="flex items-center gap-2.5 text-sm"
                        >
                            {anomaly.icon || getSeverityIcon(anomaly.severity)}
                            <span className={`${getSeverityColor(anomaly.severity)}`}>
                                {anomaly.text}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
